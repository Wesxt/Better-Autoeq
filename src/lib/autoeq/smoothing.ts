/**
 * Fractional-octave smoothing for frequency response data.
 * Applies Gaussian-weighted smoothing in log2 frequency space.
 */

export type SmoothingType = 'none' | '1/1' | '1/2' | '1/3' | '1/6' | '1/12' | '1/24' | '1/48'

export const OCTAVE_FRACTIONS: Record<SmoothingType, number | null> = {
  'none': null,
  '1/1': 1,
  '1/2': 2,
  '1/3': 3,
  '1/6': 6,
  '1/12': 12,
  '1/24': 24,
  '1/48': 48,
}

/**
 * Apply fractional-octave smoothing
 * @param freqs array of frequencies in Hz
 * @param gains array of dB gains corresponding to freqs
 * @param smoothing fraction of octave (e.g. '1/3') or null for no smoothing
 * @param trebleSmoothing if true, increases smoothing above 6 kHz up to 1/3 octave (AutoEq method)
 */
export function smoothFrequencyResponse(
  freqs: number[],
  gains: number[],
  smoothing: SmoothingType = '1/6',
  trebleSmoothing = false
): number[] {
  const fraction = OCTAVE_FRACTIONS[smoothing]
  if (fraction === null && !trebleSmoothing) {
    return [...gains]
  }

  const n = freqs.length
  if (n <= 1) return [...gains]

  const log2Freqs = freqs.map(f => Math.log2(Math.max(1, f)))
  const smoothed = new Array<number>(n)

  for (let i = 0; i < n; i++) {
    const f0 = freqs[i]
    const logF0 = log2Freqs[i]

    // Determine effective fractional octave width at this frequency
    let octWidth = fraction !== null ? 1 / fraction : 0

    if (trebleSmoothing && f0 > 6000) {
      // Transition from current smoothing to 1/3 octave (width = 1/3) between 6kHz and 10kHz
      const t = Math.min(1, Math.max(0, (f0 - 6000) / 4000))
      const trebleWidth = 1 / 3
      octWidth = Math.max(octWidth, octWidth * (1 - t) + trebleWidth * t)
    }

    if (octWidth <= 0.001) {
      smoothed[i] = gains[i]
      continue
    }

    // Standard deviation in octaves (FWHM = octWidth)
    const sigma = octWidth / (2 * Math.sqrt(2 * Math.LN2))
    const halfWindow = octWidth * 1.5 // Evaluate up to 3 sigma

    const minLog = logF0 - halfWindow
    const maxLog = logF0 + halfWindow

    let sumGainWeight = 0
    let sumWeight = 0

    // Search window indices around i
    let j = i
    while (j >= 0 && log2Freqs[j] >= minLog) {
      const dLog = log2Freqs[j] - logF0
      const w = Math.exp(-0.5 * (dLog / sigma) * (dLog / sigma))
      sumGainWeight += gains[j] * w
      sumWeight += w
      j--
    }

    j = i + 1
    while (j < n && log2Freqs[j] <= maxLog) {
      const dLog = log2Freqs[j] - logF0
      const w = Math.exp(-0.5 * (dLog / sigma) * (dLog / sigma))
      sumGainWeight += gains[j] * w
      sumWeight += w
      j++
    }

    smoothed[i] = sumWeight > 0 ? sumGainWeight / sumWeight : gains[i]
  }

  return smoothed
}
