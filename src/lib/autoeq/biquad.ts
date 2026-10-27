/**
 * Digital Biquad Filter implementation (Robert Bristow-Johnson Audio EQ Cookbook)
 */

export type BiquadFilterType = 'PK' | 'LSC' | 'HSC' | 'HP' | 'LP'

export interface BiquadFilterConfig {
  id: string
  enabled: boolean
  type: BiquadFilterType
  fc: number     // Center frequency in Hz (20 - 20,000)
  gain: number   // Gain in dB (-24 to +24)
  q: number      // Quality factor Q (0.1 to 10)
}

export interface BiquadCoefficients {
  b0: number
  b1: number
  b2: number
  a0: number
  a1: number
  a2: number
}

/**
 * Calculates normalized biquad coefficients
 */
export function calculateBiquadCoefficients(
  filter: BiquadFilterConfig,
  fs = 48000
): BiquadCoefficients {
  const { type, fc, gain, q } = filter
  // Clamp fc to Nyquist limit
  const clampedFc = Math.min(Math.max(10, fc), fs * 0.499)
  const clampedQ = Math.max(0.1, q)

  const w0 = (2 * Math.PI * clampedFc) / fs
  const cosW0 = Math.cos(w0)
  const sinW0 = Math.sin(w0)
  const alpha = sinW0 / (2 * clampedQ)
  const A = Math.pow(10, gain / 40) // sqrt(10^(gain/20))

  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0

  switch (type) {
    case 'PK': { // Peaking EQ
      b0 = 1 + alpha * A
      b1 = -2 * cosW0
      b2 = 1 - alpha * A
      a0 = 1 + alpha / A
      a1 = -2 * cosW0
      a2 = 1 - alpha / A
      break
    }
    case 'LSC': { // Low Shelf
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha
      b0 = A * ((A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha)
      b1 = 2 * A * ((A - 1) - (A + 1) * cosW0)
      b2 = A * ((A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha)
      a0 = (A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha
      a1 = -2 * ((A - 1) + (A + 1) * cosW0)
      a2 = (A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha
      break
    }
    case 'HSC': { // High Shelf
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha
      b0 = A * ((A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha)
      b1 = -2 * A * ((A - 1) + (A + 1) * cosW0)
      b2 = A * ((A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha)
      a0 = (A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha
      a1 = 2 * ((A - 1) - (A + 1) * cosW0)
      a2 = (A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha
      break
    }
    case 'HP': { // High Pass
      b0 = (1 + cosW0) / 2
      b1 = -(1 + cosW0)
      b2 = (1 + cosW0) / 2
      a0 = 1 + alpha
      a1 = -2 * cosW0
      a2 = 1 - alpha
      break
    }
    case 'LP': { // Low Pass
      b0 = (1 - cosW0) / 2
      b1 = 1 - cosW0
      b2 = (1 - cosW0) / 2
      a0 = 1 + alpha
      a1 = -2 * cosW0
      a2 = 1 - alpha
      break
    }
  }

  // Normalize by a0
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a0: 1,
    a1: a1 / a0,
    a2: a2 / a0
  }
}

/**
 * Evaluates the dB magnitude response of a biquad filter across an array of frequencies
 */
export function evaluateBiquadResponse(
  filter: BiquadFilterConfig,
  freqs: number[],
  fs = 48000
): number[] {
  if (!filter.enabled) {
    return freqs.map(() => 0)
  }
  if (filter.type !== 'HP' && filter.type !== 'LP' && Math.abs(filter.gain) < 0.001) {
    return freqs.map(() => 0)
  }

  const { b0, b1, b2, a1, a2 } = calculateBiquadCoefficients(filter, fs)
  const result = new Array<number>(freqs.length)

  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i]
    if (f >= fs / 2) {
      result[i] = 0
      continue
    }

    const phi = (2 * Math.PI * f) / fs
    const cosPhi = Math.cos(phi)
    const sinPhi = Math.sin(phi)
    const cos2Phi = Math.cos(2 * phi)
    const sin2Phi = Math.sin(2 * phi)

    // Numerator: B(e^jw) = b0 + b1*e^-jw + b2*e^-j2w
    const numReal = b0 + b1 * cosPhi + b2 * cos2Phi
    const numImag = -b1 * sinPhi - b2 * sin2Phi
    const numMagSq = numReal * numReal + numImag * numImag

    // Denominator: A(e^jw) = 1 + a1*e^-jw + a2*e^-j2w
    const denReal = 1 + a1 * cosPhi + a2 * cos2Phi
    const denImag = -a1 * sinPhi - a2 * sin2Phi
    const denMagSq = denReal * denReal + denImag * denImag

    if (denMagSq < 1e-12) {
      result[i] = 0
    } else {
      const magSq = numMagSq / denMagSq
      result[i] = 10 * Math.log10(Math.max(1e-12, magSq))
    }
  }

  return result
}

/**
 * Evaluates the compound dB magnitude response of multiple cascaded biquad filters
 */
export function evaluateCompoundResponse(
  filters: BiquadFilterConfig[],
  freqs: number[],
  fs = 48000
): number[] {
  const compound = new Array<number>(freqs.length).fill(0)

  for (const filter of filters) {
    if (!filter.enabled) continue
    const resp = evaluateBiquadResponse(filter, freqs, fs)
    for (let i = 0; i < freqs.length; i++) {
      compound[i] += resp[i]
    }
  }

  return compound
}
