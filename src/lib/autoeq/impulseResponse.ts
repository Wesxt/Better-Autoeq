import { interpolateLog } from './interpolation'
import { PREAMP_HEADROOM } from './constants'

export interface ImpulseResponseOptions {
  fs?: number             // Sample rate: 44100, 48000, 88200, 96000, 192000
  taps?: number           // Number of samples/taps: 4096, 8192, 16384, 32768, 65536
  phase?: 'minimum' | 'linear'
  normalize?: boolean     // Normalize peak to -0.2 dBFS
  preamp?: number         // Additional preamp in dB
}

export const DEFAULT_IR_OPTIONS: ImpulseResponseOptions = {
  fs: 48000,
  taps: 8192,
  phase: 'minimum',
  normalize: true,
  preamp: 0.0
}

/**
 * Radix-2 Fast Fourier Transform (in-place)
 */
function fft(real: Float64Array, imag: Float64Array, inverse = false) {
  const n = real.length
  let j = 0
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tr = real[i]; real[i] = real[j]; real[j] = tr
      const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti
    }
    let k = n >> 1
    while (k <= j) {
      j -= k
      k >>= 1
    }
    j += k
  }

  const dir = inverse ? 1 : -1
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const angle = (dir * 2 * Math.PI) / len
    const wStepR = Math.cos(angle)
    const wStepI = Math.sin(angle)

    for (let i = 0; i < n; i += len) {
      let wr = 1.0
      let wi = 0.0
      for (let k = 0; k < half; k++) {
        const uR = real[i + k]
        const uI = imag[i + k]
        const vR = real[i + k + half] * wr - imag[i + k + half] * wi
        const vI = real[i + k + half] * wi + imag[i + k + half] * wr

        real[i + k] = uR + vR
        imag[i + k] = uI + vI
        real[i + k + half] = uR - vR
        imag[i + k + half] = uI - vI

        const nextWr = wr * wStepR - wi * wStepI
        wi = wr * wStepI + wi * wStepR
        wr = nextWr
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      real[i] /= n
      imag[i] /= n
    }
  }
}

/**
 * Generates an impulse response from an equalization curve (dB) across frequencies
 */
export function generateImpulseResponse(
  freqs: number[],
  equalization: number[],
  options: ImpulseResponseOptions = DEFAULT_IR_OPTIONS
): Float64Array {
  const opts = { ...DEFAULT_IR_OPTIONS, ...options }
  const fs = opts.fs ?? 48000
  const n = opts.taps ?? 8192
  const isMinimumPhase = opts.phase === 'minimum'

  // Frequency grid for FFT: 0 Hz to fs/2 (n/2 + 1 bins)
  const numBins = (n >> 1) + 1
  const binFreqs = new Array<number>(numBins)
  for (let i = 0; i < numBins; i++) {
    binFreqs[i] = (i * fs) / n
  }

  // Interpolate equalization curve (dB) onto uniform FFT bins
  // We clamp DC (0 Hz) to the gain at lowest frequency (20 Hz)
  const clampedFreqs = [0, ...freqs, fs / 2]
  const clampedEq = [equalization[0], ...equalization, equalization[equalization.length - 1]]
  const binEq = interpolateLog(clampedFreqs, clampedEq, binFreqs)

  // Calculate maximum equalization gain across audible band (20 Hz to 20 kHz)
  let maxEqGain = -Infinity
  for (let i = 0; i < numBins; i++) {
    const f = binFreqs[i]
    if (f >= 20 && f <= Math.min(20000, fs / 2)) {
      if (binEq[i] > maxEqGain) {
        maxEqGain = binEq[i]
      }
    }
  }
  if (!Number.isFinite(maxEqGain)) {
    maxEqGain = 0
  }

  // Preamp calculation:
  // If normalize is enabled: calculate anti-clipping preamp so the peak gain is -PREAMP_HEADROOM (-0.2 dBFS)
  let antiClipPreamp = 0
  if (opts.normalize) {
    antiClipPreamp = maxEqGain > 0 ? -(maxEqGain + PREAMP_HEADROOM) : -PREAMP_HEADROOM
  }

  // Add optional user manual preamp adjustment
  const userPreamp = typeof opts.preamp === 'number' ? opts.preamp : 0
  const totalPreamp = antiClipPreamp + userPreamp

  // Apply total preamp across the frequency spectrum
  for (let i = 0; i < numBins; i++) {
    binEq[i] += totalPreamp
  }

  // Tame extreme infrasonic sub-bass below 15 Hz to prevent DC offset
  for (let i = 0; i < numBins; i++) {
    if (binFreqs[i] < 15 && binEq[i] > -PREAMP_HEADROOM) {
      binEq[i] = -PREAMP_HEADROOM
    }
  }

  // Convert dB gain to linear amplitude: A = 10^(dB / 20)
  const linearMag = new Float64Array(numBins)
  for (let i = 0; i < numBins; i++) {
    linearMag[i] = Math.pow(10, binEq[i] / 20)
  }

  // Construct full symmetric spectrum for real FFT (length n)
  const specReal = new Float64Array(n)
  const specImag = new Float64Array(n)

  for (let i = 0; i < numBins; i++) {
    specReal[i] = linearMag[i]
  }
  for (let i = 1; i < numBins - 1; i++) {
    specReal[n - i] = linearMag[i] // Hermitian symmetry for real signals
  }

  if (isMinimumPhase) {
    // Oppenheim-Schafer / Kolmogorov Real Cepstrum Method
    // 1. Take log of magnitude spectrum
    const logSpecReal = new Float64Array(n)
    const logSpecImag = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      logSpecReal[i] = Math.log(Math.max(1e-12, specReal[i]))
    }

    // 2. IFFT to get the real cepstrum c[n]
    fft(logSpecReal, logSpecImag, true)

    // 3. Fold cepstrum to make it causal (minimum phase):
    // c_min[0] = c[0]
    // c_min[n] = 2*c[n] for 1 <= n < n/2
    // c_min[n/2] = c[n/2]
    // c_min[n] = 0 for n/2 < n < n
    const half = n >> 1
    for (let i = 1; i < half; i++) {
      logSpecReal[i] *= 2
      logSpecImag[i] *= 2
    }
    for (let i = half + 1; i < n; i++) {
      logSpecReal[i] = 0
      logSpecImag[i] = 0
    }

    // 4. FFT back to frequency domain
    fft(logSpecReal, logSpecImag, false)

    // 5. Complex exponential: H_min(w) = exp(C_min(w)) = exp(R) * (cos(I) + j*sin(I))
    for (let i = 0; i < n; i++) {
      const expR = Math.exp(logSpecReal[i])
      specReal[i] = expR * Math.cos(logSpecImag[i])
      specImag[i] = expR * Math.sin(logSpecImag[i])
    }

    // 6. IFFT to time domain to get minimum phase impulse response h[n]
    fft(specReal, specImag, true)
  } else {
    // Linear phase: apply linear phase shift e^(-j * w * n/2)
    const half = n >> 1
    for (let i = 0; i < n; i++) {
      const angle = (-2 * Math.PI * i * half) / n
      const mag = specReal[i]
      specReal[i] = mag * Math.cos(angle)
      specImag[i] = mag * Math.sin(angle)
    }
    fft(specReal, specImag, true)
  }

  // Apply Hann window at edges to taper tail to zero
  const windowLength = Math.min(128, n >> 4)
  for (let i = 0; i < windowLength; i++) {
    const w = 0.5 * (1 - Math.cos((Math.PI * i) / windowLength))
    specReal[n - 1 - i] *= w
  }

  // Time-domain safety ceiling:
  // With frequency response normalized to <= -0.2 dBFS, time samples are naturally within safe limits.
  // We ensure no sample exceeds 0.98 (-0.17 dBFS) to guarantee clean, unclipped integer PCM exports.
  let maxTimePeak = 0
  for (let i = 0; i < n; i++) {
    const absVal = Math.abs(specReal[i])
    if (absVal > maxTimePeak) {
      maxTimePeak = absVal
    }
  }

  if (maxTimePeak > 0.98) {
    const scale = 0.98 / maxTimePeak
    for (let i = 0; i < n; i++) {
      specReal[i] *= scale
    }
  }

  return specReal
}

/**
 * Computes the exact frequency response (magnitude in dB) of a FIR impulse response across arbitrary frequencies
 */
export function evaluateFirFrequencyResponse(
  ir: Float64Array,
  fs: number,
  evalFreqs: number[]
): number[] {
  const n = ir.length
  const specReal = new Float64Array(ir)
  const specImag = new Float64Array(n)
  fft(specReal, specImag, false)

  const numBins = (n >> 1) + 1
  const binFreqs = new Array<number>(numBins)
  const binMags = new Array<number>(numBins)

  for (let i = 0; i < numBins; i++) {
    binFreqs[i] = (i * fs) / n
    const r = specReal[i]
    const im = specImag[i]
    const mag = Math.sqrt(r * r + im * im)
    binMags[i] = 20 * Math.log10(Math.max(1e-9, mag))
  }

  return interpolateLog(binFreqs, binMags, evalFreqs)
}
