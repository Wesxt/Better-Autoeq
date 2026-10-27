/**
 * High-performance Fast Fourier Transform (FFT) and Windowing Engine for Acoustic Analysis
 */

export type WindowFunctionType =
  | 'standard'
  | 'hann'
  | 'hamming'
  | 'blackman-harris'
  | 'flattop'
  | 'welch'
  | 'rectangular'

export interface WindowInfo {
  id: WindowFunctionType
  label: string
  description: string
}

export const AVAILABLE_WINDOWS: WindowInfo[] = [
  {
    id: 'standard',
    label: 'Estándar (Nativa Web Audio)',
    description: 'Ventana predeterminada de Web Audio (Blackman acelerado por hardware)'
  },
  {
    id: 'hann',
    label: 'Hann (Hanning)',
    description: 'Propósito general, excelente compromiso de resolución y atenuación de lóbulos'
  },
  {
    id: 'hamming',
    label: 'Hamming',
    description: 'Lóbulo principal estrecho, buena separación de frecuencias cercanas'
  },
  {
    id: 'blackman-harris',
    label: 'Blackman-Harris (4T)',
    description: 'Estándar en REW y metrología acústica, mínimo fuga espectral (-92 dB)'
  },
  {
    id: 'flattop',
    label: 'Flat-Top',
    description: 'Máxima precisión en calibración de nivel y amplitud de picos SPL'
  },
  {
    id: 'welch',
    label: 'Welch (Parabólica / Riesz)',
    description: 'Ventana parabólica óptima para estimación espectral promediada con caída rápida de lóbulos (-12 dB/oct)'
  },
  {
    id: 'rectangular',
    label: 'Rectangular (Sin ventana)',
    description: 'Sin atenuación en extremos; ideal para barridos y transitorios puros'
  }
]

export const FFT_RESOLUTIONS = [
  { size: 1024, label: '1024 (Rápido)', binWidth48k: '46.9 Hz/bin' },
  { size: 2048, label: '2048 (Equilibrado)', binWidth48k: '23.4 Hz/bin' },
  { size: 4096, label: '4096 (Estándar RTA)', binWidth48k: '11.7 Hz/bin' },
  { size: 8192, label: '8192 (Alta resolución)', binWidth48k: '5.9 Hz/bin' },
  { size: 16384, label: '16384 (Ultra graves)', binWidth48k: '2.9 Hz/bin' }
] as const

// Cache for window weights and FFT bit-reversal tables
const windowCache = new Map<string, Float32Array>()
const twiddleRealCache = new Map<number, Float32Array>()
const twiddleImagCache = new Map<number, Float32Array>()
const bitRevCache = new Map<number, Uint32Array>()

/**
 * Precompute or retrieve window weights with coherent gain normalization
 */
export function getWindowWeights(type: WindowFunctionType, N: number): Float32Array {
  const cacheKey = `${type}_${N}`
  const cached = windowCache.get(cacheKey)
  if (cached) return cached

  const weights = new Float32Array(N)
  let sum = 0

  for (let i = 0; i < N; i++) {
    let w = 1
    const phase = (2 * Math.PI * i) / (N - 1)

    switch (type) {
      case 'hann':
        w = 0.5 - 0.5 * Math.cos(phase)
        break
      case 'hamming':
        w = 0.54 - 0.46 * Math.cos(phase)
        break
      case 'blackman-harris': {
        const a0 = 0.35875
        const a1 = 0.48829
        const a2 = 0.14128
        const a3 = 0.01168
        w =
          a0 -
          a1 * Math.cos(phase) +
          a2 * Math.cos(2 * phase) -
          a3 * Math.cos(3 * phase)
        break
      }
      case 'flattop': {
        const a0 = 0.21557895
        const a1 = 0.41663158
        const a2 = 0.277263158
        const a3 = 0.083578947
        const a4 = 0.006947368
        w =
          a0 -
          a1 * Math.cos(phase) +
          a2 * Math.cos(2 * phase) -
          a3 * Math.cos(3 * phase) +
          a4 * Math.cos(4 * phase)
        break
      }
      case 'welch': {
        const half = (N - 1) / 2
        const k = half > 0 ? (i - half) / half : 0
        w = Math.max(0, 1 - k * k)
        break
      }
      case 'rectangular':
      case 'standard':
      default:
        w = 1
        break
    }
    weights[i] = w
    sum += w
  }

  // Coherent gain normalization factor so 0 dBFS sine yields 0 dBFS bin
  const normFactor = sum > 0 ? (N / sum) : 1
  for (let i = 0; i < N; i++) {
    weights[i] *= normFactor
  }

  windowCache.set(cacheKey, weights)
  return weights
}

function getBitReversal(N: number): Uint32Array {
  const cached = bitRevCache.get(N)
  if (cached) return cached

  const table = new Uint32Array(N)
  const bits = Math.round(Math.log2(N))
  for (let i = 0; i < N; i++) {
    let rev = 0
    let temp = i
    for (let j = 0; j < bits; j++) {
      rev = (rev << 1) | (temp & 1)
      temp >>= 1
    }
    table[i] = rev
  }

  bitRevCache.set(N, table)
  return table
}

function getTwiddleFactors(N: number): { real: Float32Array; imag: Float32Array } {
  let real = twiddleRealCache.get(N)
  let imag = twiddleImagCache.get(N)
  if (real && imag) return { real, imag }

  const halfN = N / 2
  real = new Float32Array(halfN)
  imag = new Float32Array(halfN)
  for (let i = 0; i < halfN; i++) {
    const angle = (-2 * Math.PI * i) / N
    real[i] = Math.cos(angle)
    imag[i] = Math.sin(angle)
  }

  twiddleRealCache.set(N, real)
  twiddleImagCache.set(N, imag)
  return { real, imag }
}

const workRealCache = new Map<number, Float32Array>()
const workImagCache = new Map<number, Float32Array>()

/**
 * Radix-2 Cooley-Tukey In-Place FFT
 * Computes frequency spectrum magnitude in dBFS directly from time-domain PCM samples
 */
export function computeFftMagnitudeDb(
  timeBuffer: Float32Array,
  windowType: WindowFunctionType,
  outputDbBuffer: Float32Array
): void {
  const N = timeBuffer.length
  const halfN = N / 2

  // 1. Apply window weights
  const weights = getWindowWeights(windowType, N)
  const bitRev = getBitReversal(N)

  // Use cached reusable work buffers to avoid GC pauses
  let real = workRealCache.get(N)
  let imag = workImagCache.get(N)
  if (!real || !imag) {
    real = new Float32Array(N)
    imag = new Float32Array(N)
    workRealCache.set(N, real)
    workImagCache.set(N, imag)
  }

  // Bit reversal permutation with window application
  for (let i = 0; i < N; i++) {
    const rev = bitRev[i]
    real[rev] = timeBuffer[i] * weights[i]
    imag[rev] = 0
  }

  // 2. Cooley-Tukey butterfly stages
  for (let len = 2; len <= N; len <<= 1) {
    const halfLen = len >> 1
    const { real: twReal, imag: twImag } = getTwiddleFactors(len)

    for (let i = 0; i < N; i += len) {
      for (let j = 0; j < halfLen; j++) {
        const uReal = real[i + j]
        const uImag = imag[i + j]

        const tReal = twReal[j]
        const tImag = twImag[j]

        const vReal = real[i + j + halfLen] * tReal - imag[i + j + halfLen] * tImag
        const vImag = real[i + j + halfLen] * tImag + imag[i + j + halfLen] * tReal

        real[i + j] = uReal + vReal
        imag[i + j] = uImag + vImag
        real[i + j + halfLen] = uReal - vReal
        imag[i + j + halfLen] = uImag - vImag
      }
    }
  }

  // 3. Compute magnitude in dBFS for positive frequency bins [0 ... halfN - 1]
  const scale = 2 / N
  for (let k = 0; k < halfN; k++) {
    const r = real[k] * scale
    const im = imag[k] * scale
    const magSq = r * r + im * im
    if (magSq > 1e-13) {
      // 10 * log10(magSq) = 20 * log10(magnitude)
      const db = 10 * Math.log10(magSq)
      outputDbBuffer[k] = Math.max(-130, Math.min(0, db))
    } else {
      outputDbBuffer[k] = -130
    }
  }
}
