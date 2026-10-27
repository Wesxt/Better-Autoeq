import type { BiquadFilterConfig } from './biquad'
import { evaluateBiquadResponse } from './biquad'
import { STANDARD_FREQUENCIES } from './constants'

export interface OptimizerOptions {
  maxFilters?: number
  fs?: number
  minFc?: number
  maxFc?: number
  maxGain?: number
  minGain?: number
  includeShelves?: boolean
  hpf?: {
    enabled: boolean
    fc: number
    slope?: number
    q?: number
  }
  lpf?: {
    enabled: boolean
    fc: number
    slope?: number
    q?: number
  }
}

export const DEFAULT_OPTIMIZER_OPTIONS: OptimizerOptions = {
  maxFilters: 7,
  fs: 48000,
  minFc: 20,
  maxFc: 16000,
  maxGain: 12,
  minGain: -16,
  includeShelves: true
}

/**
 * Finds local extrema (peaks and valleys) in the target equalization curve
 */
function findExtrema(freqs: number[], curve: number[]): { index: number; freq: number; gain: number; isPeak: boolean }[] {
  const extrema: { index: number; freq: number; gain: number; isPeak: boolean }[] = []
  const n = freqs.length

  for (let i = 2; i < n - 2; i++) {
    const f = freqs[i]
    if (f < 25 || f > 16000) continue

    const prev2 = curve[i - 2]
    const prev1 = curve[i - 1]
    const curr = curve[i]
    const next1 = curve[i + 1]
    const next2 = curve[i + 2]

    // Peak
    if (curr > prev1 && curr > prev2 && curr > next1 && curr > next2 && Math.abs(curr) > 0.5) {
      extrema.push({ index: i, freq: f, gain: curr, isPeak: true })
    }
    // Valley
    else if (curr < prev1 && curr < prev2 && curr < next1 && curr < next2 && Math.abs(curr) > 0.5) {
      extrema.push({ index: i, freq: f, gain: curr, isPeak: false })
    }
  }

  // Sort by absolute deviation from 0
  extrema.sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain))
  return extrema
}

/**
 * Optimizes parametric EQ filters to match the target equalization curve
 */
export function optimizePEQ(
  freqs: number[] = STANDARD_FREQUENCIES,
  equalization: number[],
  options: OptimizerOptions = DEFAULT_OPTIMIZER_OPTIONS
): BiquadFilterConfig[] {
  const opts = { ...DEFAULT_OPTIMIZER_OPTIONS, ...options }
  const baseMaxFilters = opts.maxFilters ?? 7
  const fs = opts.fs ?? 48000
  const maxGain = opts.maxGain ?? 12
  const minGain = opts.minGain ?? -16

  const residual = [...equalization]
  const filters: BiquadFilterConfig[] = []
  let filterCount = 0

  // 1. Explicit High Pass Filter stage(s)
  if (opts.hpf?.enabled && opts.hpf.fc > 5) {
    const slope = opts.hpf.slope || 12
    const stages = Math.max(1, Math.min(4, Math.round(slope / 12)))
    for (let s = 0; s < stages; s++) {
      const hpfFilter: BiquadFilterConfig = {
        id: `filter-hpf-${s + 1}`,
        enabled: true,
        type: 'HP',
        fc: opts.hpf.fc,
        gain: 0,
        q: opts.hpf.q || 0.71
      }
      filters.push(hpfFilter)
      filterCount++
      const hpfResp = evaluateBiquadResponse(hpfFilter, freqs, fs)
      for (let i = 0; i < freqs.length; i++) {
        residual[i] -= hpfResp[i]
      }
    }
  }

  // 2. Explicit Low Pass Filter stage(s)
  if (opts.lpf?.enabled && opts.lpf.fc < 24000) {
    const slope = opts.lpf.slope || 12
    const stages = Math.max(1, Math.min(4, Math.round(slope / 12)))
    for (let s = 0; s < stages; s++) {
      const lpfFilter: BiquadFilterConfig = {
        id: `filter-lpf-${s + 1}`,
        enabled: true,
        type: 'LP',
        fc: opts.lpf.fc,
        gain: 0,
        q: opts.lpf.q || 0.71
      }
      filters.push(lpfFilter)
      filterCount++
      const lpfResp = evaluateBiquadResponse(lpfFilter, freqs, fs)
      for (let i = 0; i < freqs.length; i++) {
        residual[i] -= lpfResp[i]
      }
    }
  }

  // Target max filters ensures at least 4 peaking filters remain after HP/LP
  const effectiveMaxFilters = Math.max(baseMaxFilters, filterCount + 4)
  if (opts.includeShelves) {
    // Average sub-bass gain below 100 Hz
    let bassSum = 0
    let bassCount = 0
    for (let i = 0; i < freqs.length; i++) {
      if (freqs[i] <= 100) {
        bassSum += residual[i]
        bassCount++
      }
    }
    const avgBass = bassCount > 0 ? bassSum / bassCount : 0

    if (Math.abs(avgBass) > 1.8) {
      const clampedGain = Math.max(minGain, Math.min(maxGain, avgBass))
      const shelf: BiquadFilterConfig = {
        id: `filter-shelf-low`,
        enabled: true,
        type: 'LSC',
        fc: 105,
        gain: Math.round(clampedGain * 10) / 10,
        q: 0.71
      }
      filters.push(shelf)
      filterCount++

      // Subtract shelf response from residual
      const shelfResp = evaluateBiquadResponse(shelf, freqs, fs)
      for (let i = 0; i < freqs.length; i++) {
        residual[i] -= shelfResp[i]
      }
    }
  }

  // Iteratively pick dominant extrema and fit peaking filters
  while (filterCount < effectiveMaxFilters) {
    const extrema = findExtrema(freqs, residual)
    if (extrema.length === 0) break

    // Pick top extremum that is not too close to an existing filter
    let bestExtremum = null
    for (const ext of extrema) {
      const isTooClose = filters.some(filt => {
        const ratio = Math.max(filt.fc, ext.freq) / Math.min(filt.fc, ext.freq)
        return ratio < 1.25 // within ~1/3 octave of existing filter
      })
      if (!isTooClose) {
        bestExtremum = ext
        break
      }
    }

    if (!bestExtremum || Math.abs(bestExtremum.gain) < 0.8) {
      break
    }

    // Estimate Q factor based on width of the peak/dip
    const centerIdx = bestExtremum.index
    const halfGain = bestExtremum.gain / 2
    let leftIdx = centerIdx
    let rightIdx = centerIdx

    while (leftIdx > 0 && Math.abs(residual[leftIdx]) >= Math.abs(halfGain)) {
      leftIdx--
    }
    while (rightIdx < freqs.length - 1 && Math.abs(residual[rightIdx]) >= Math.abs(halfGain)) {
      rightIdx++
    }

    const fLow = freqs[leftIdx]
    const fHigh = freqs[rightIdx]
    let estimatedQ = 1.41
    if (fHigh > fLow && fLow > 0) {
      const bw = (fHigh - fLow) / bestExtremum.freq
      if (bw > 0.05) {
        estimatedQ = Math.max(0.5, Math.min(5.0, 1 / bw))
      }
    }

    const targetGain = Math.max(minGain, Math.min(maxGain, bestExtremum.gain))

    const newFilter: BiquadFilterConfig = {
      id: `filter-${filterCount + 1}`,
      enabled: true,
      type: 'PK',
      fc: Math.round(bestExtremum.freq),
      gain: Math.round(targetGain * 10) / 10,
      q: Math.round(estimatedQ * 100) / 100
    }

    // Fine-tune filter gain with local least squares step
    const testResp = evaluateBiquadResponse(newFilter, freqs, fs)
    let dotResidual = 0
    let dotTest = 0
    for (let i = 0; i < freqs.length; i++) {
      dotResidual += residual[i] * testResp[i]
      dotTest += testResp[i] * testResp[i]
    }
    if (dotTest > 0) {
      const scale = dotResidual / dotTest
      if (scale > 0.3 && scale < 2.0) {
        newFilter.gain = Math.round(Math.max(minGain, Math.min(maxGain, newFilter.gain * scale)) * 10) / 10
      }
    }

    filters.push(newFilter)
    filterCount++

    // Update residual
    const finalFilterResp = evaluateBiquadResponse(newFilter, freqs, fs)
    for (let i = 0; i < freqs.length; i++) {
      residual[i] -= finalFilterResp[i]
    }
  }

  // Sort filters by frequency
  filters.sort((a, b) => a.fc - b.fc)
  filters.forEach((f, idx) => {
    f.id = `filter-${idx + 1}`
  })

  return filters
}
