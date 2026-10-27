import { STANDARD_FREQUENCIES } from './constants'
import type { TargetCurveDefinition } from './constants'
import { interpolateCubicSpline } from './interpolation'

export type FilterSlope = 6 | 12 | 18 | 24 | 36 | 48
export type FilterTopology = 'butterworth' | 'linkwitz-riley' | 'bessel' | 'custom'

export interface TargetParameters {
  bassBoostGain: number // dB, e.g. -12 to +12 dB (default 0)
  bassBoostFc: number   // Hz, e.g. 60 to 200 Hz (default 105 Hz)
  bassBoostQ: number    // Quality factor, e.g. 0.2 to 2.5 (default 0.707)
  trebleShelfGain: number // dB, e.g. -12 to +12 dB (default 0)
  trebleShelfFc: number   // Hz, e.g. 2000 to 16000 Hz (default 10000 Hz)
  trebleShelfQ: number    // Quality factor, e.g. 0.2 to 2.5 (default 0.707)
  trebleTilt: number    // dB/octave pivoted at 1 kHz, e.g. -2 to +2 (default 0)
  maxBoost: number      // Maximum allowed EQ boost dB, e.g. 4 to 20 dB (default 8)
  limitTrebleBoost: boolean // Optional treble boost attenuation above 10 kHz (default true)
  hpfEnabled: boolean   // High Pass Filter enabled
  hpfFc: number         // High Pass cutoff frequency in Hz (default 20 Hz)
  hpfSlope: FilterSlope // 6, 12, 18, 24, 36, 48 dB/oct (default 12)
  hpfQ: number          // Quality / Resonance factor (0.2 to 3.0, default 0.707)
  hpfType: FilterTopology // 'butterworth' | 'linkwitz-riley' | 'bessel' | 'custom'
  lpfEnabled: boolean   // Low Pass Filter enabled
  lpfFc: number         // Low Pass cutoff frequency in Hz (default 20000 Hz)
  lpfSlope: FilterSlope // 6, 12, 18, 24, 36, 48 dB/oct (default 12)
  lpfQ: number          // Quality / Resonance factor (0.2 to 3.0, default 0.707)
  lpfType: FilterTopology // 'butterworth' | 'linkwitz-riley' | 'bessel' | 'custom'
}

export const DEFAULT_TARGET_PARAMS: TargetParameters = {
  bassBoostGain: 0,
  bassBoostFc: 105,
  bassBoostQ: 0.707,
  trebleShelfGain: 0,
  trebleShelfFc: 10000,
  trebleShelfQ: 0.707,
  trebleTilt: 0,
  maxBoost: 8,
  limitTrebleBoost: true,
  hpfEnabled: false,
  hpfFc: 20,
  hpfSlope: 12,
  hpfQ: 0.707,
  hpfType: 'butterworth',
  lpfEnabled: false,
  lpfFc: 20000,
  lpfSlope: 12,
  lpfQ: 0.707,
  lpfType: 'butterworth'
}

/**
 * Computes an adjusted target curve based on a base target curve and user tweak parameters.
 */
export function buildTargetCurve(
  targetDef: TargetCurveDefinition,
  freqs: number[] = STANDARD_FREQUENCIES,
  params: TargetParameters = DEFAULT_TARGET_PARAMS
): number[] {
  // 1. Interpolate base target points to the desired frequencies
  const baseFreqs = targetDef.points.map(p => p[0])
  const baseGains = targetDef.points.map(p => p[1])
  const targetGains = interpolateCubicSpline(baseFreqs, baseGains, freqs)

  const bbGain = params.bassBoostGain
  const bbFc = Math.max(20, params.bassBoostFc)
  const bbQ = Math.max(0.1, params.bassBoostQ ?? 0.707)
  const tsGain = params.trebleShelfGain ?? 0
  const tsFc = Math.max(1000, params.trebleShelfFc ?? 10000)
  const tsQ = Math.max(0.1, params.trebleShelfQ ?? 0.707)
  const tilt = params.trebleTilt
  const hpfEnabled = !!params.hpfEnabled
  const hpfFc = Math.max(10, params.hpfFc ?? 20)
  const hpfSlope = params.hpfSlope || 12
  const hpfQ = Math.max(0.1, params.hpfQ || 0.707)
  const lpfEnabled = !!params.lpfEnabled
  const lpfFc = Math.max(50, params.lpfFc ?? 20000)
  const lpfSlope = params.lpfSlope || 12
  const lpfQ = Math.max(0.1, params.lpfQ || 0.707)

  const result = new Array<number>(freqs.length)
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i]
    let gain = targetGains[i]

    // 2. Bass shelf contribution (low-shelf with configurable Q quality / resonance)
    if (Math.abs(bbGain) > 0.001) {
      const A = Math.pow(10, bbGain / 40)
      const u = f / bbFc
      const u2 = u * u
      const num = Math.pow(A - u2, 2) + (A * u2) / (bbQ * bbQ)
      const den = Math.pow(1 - A * u2, 2) + (A * u2) / (bbQ * bbQ)
      const magSq = Math.max(1e-12, (A * A * num) / Math.max(1e-12, den))
      gain += 10 * Math.log10(magSq)
    }

    // 3. High shelf contribution (high-shelf with configurable Q quality / resonance)
    if (Math.abs(tsGain) > 0.001) {
      const A = Math.pow(10, tsGain / 40)
      const u = f / tsFc
      const u2 = u * u
      const num = Math.pow(A * u2 - 1, 2) + (A * u2) / (tsQ * tsQ)
      const den = Math.pow(u2 - A, 2) + (A * u2) / (tsQ * tsQ)
      const magSq = Math.max(1e-12, (A * A * num) / Math.max(1e-12, den))
      gain += 10 * Math.log10(magSq)
    }

    // 4. Treble tilt contribution: tilt * log2(f / 1000)
    if (tilt !== 0) {
      const octaves = Math.log2(Math.max(1, f) / 1000)
      gain += tilt * octaves
    }

    // 5. High Pass Filter (Independent, configurable slope 6-48 dB/oct & Q/resonance)
    if (hpfEnabled && hpfFc > 5) {
      const y = hpfFc / Math.max(1, f)
      let lossDb = 0
      if (hpfSlope % 12 === 6) {
        lossDb += 10 * Math.log10(1 + y * y)
      }
      const numBiquads = Math.floor(hpfSlope / 12)
      if (numBiquads > 0) {
        const biquadTerm = Math.max(1e-12, Math.pow(1 - y * y, 2) + (y * y) / (hpfQ * hpfQ))
        lossDb += numBiquads * 10 * Math.log10(biquadTerm)
      }
      gain -= lossDb
    }

    // 6. Low Pass Filter (Independent, configurable slope 6-48 dB/oct & Q/resonance)
    if (lpfEnabled && lpfFc < 24000) {
      const x = f / Math.max(1, lpfFc)
      let lossDb = 0
      if (lpfSlope % 12 === 6) {
        lossDb += 10 * Math.log10(1 + x * x)
      }
      const numBiquads = Math.floor(lpfSlope / 12)
      if (numBiquads > 0) {
        const biquadTerm = Math.max(1e-12, Math.pow(1 - x * x, 2) + (x * x) / (lpfQ * lpfQ))
        lossDb += numBiquads * 10 * Math.log10(biquadTerm)
      }
      gain -= lossDb
    }

    result[i] = gain
  }

  return result
}

/**
 * Normalizes an array of gains so that the value at 1 kHz (or closest) equals targetGain (default 0 dB)
 */
export function normalizeAt1kHz(freqs: number[], gains: number[], targetGain = 0): number[] {
  let closestIdx = 0
  let minDiff = Infinity
  for (let i = 0; i < freqs.length; i++) {
    const diff = Math.abs(freqs[i] - 1000)
    if (diff < minDiff) {
      minDiff = diff
      closestIdx = i
    }
  }

  const offset = gains[closestIdx] - targetGain
  return gains.map(g => g - offset)
}

/**
 * Calculates nominal alignment offset between measurement and target
 * Computes the mean difference in the critical midrange (200 Hz - 2000 Hz)
 */
export function calculateAlignmentOffset(
  freqs: number[],
  measurement: number[],
  target: number[],
  fMin = 200,
  fMax = 2000
): number {
  let sumDiff = 0
  let count = 0

  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i]
    if (f >= fMin && f <= fMax) {
      sumDiff += measurement[i] - target[i]
      count++
    }
  }

  return count > 0 ? sumDiff / count : 0
}

/**
 * Calculate raw equalization curve: Target - Measurement
 * With optional maximum boost limiter and optional high-treble attenuation
 */
export function calculateEqualization(
  freqs: number[],
  measurement: number[],
  target: number[],
  maxBoost = 8,
  limitTrebleBoost = true,
  trebleLimitFc = 10000
): number[] {
  const n = freqs.length
  const eq = new Array<number>(n)

  // Calculate alignment offset so overall average difference in 200-2000 Hz is centered
  const offset = calculateAlignmentOffset(freqs, measurement, target)

  for (let i = 0; i < n; i++) {
    const f = freqs[i]
    // Raw inverted error (Target - (Measurement - offset))
    let rawEq = target[i] - (measurement[i] - offset)

    // Limit maximum positive boost
    if (rawEq > maxBoost) {
      rawEq = maxBoost
    }

    // In ultra-high treble (> 10 kHz), optionally attenuate positive boosts to prevent harshness, comb-filtering artifacts and tweeter damage
    if (limitTrebleBoost && f > trebleLimitFc) {
      const span = Math.max(1000, 20000 - trebleLimitFc)
      const trebleAtten = Math.min(1, (f - trebleLimitFc) / span)
      if (rawEq > 0) {
        rawEq *= (1 - 0.75 * trebleAtten)
      }
    }

    eq[i] = Math.round(rawEq * 100) / 100
  }

  return eq
}
