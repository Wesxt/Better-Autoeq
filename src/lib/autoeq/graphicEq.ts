import type { BiquadFilterConfig } from './biquad'
import { evaluateCompoundResponse } from './biquad'
import { interpolateLog } from './interpolation'
import { WAVELET_GRAPHIC_EQ_FREQUENCIES } from './constants'

export type GraphicEqBandCount = 10 | 15 | 31 | 127

export const ISO_31_FREQUENCIES = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000
]

export const ISO_15_FREQUENCIES = [
  25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600,
  2500, 4000, 6300, 10000, 16000
]

export const ISO_10_FREQUENCIES = [
  31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000
]

export interface GraphicEqBand {
  id: string
  fc: number
  gain: number
  q: number
}

/**
 * Returns standard center frequencies for a given Graphic EQ band count
 */
export function getGraphicFrequenciesForCount(count: GraphicEqBandCount): number[] {
  switch (count) {
    case 10: return [...ISO_10_FREQUENCIES]
    case 15: return [...ISO_15_FREQUENCIES]
    case 127: return [...WAVELET_GRAPHIC_EQ_FREQUENCIES]
    case 31:
    default:
      return [...ISO_31_FREQUENCIES]
  }
}

/**
 * Returns the standard Q factor for an octave subdivision
 */
export function getGraphicQForCount(count: GraphicEqBandCount): number {
  switch (count) {
    case 10: return 1.414 // 1 octave
    case 15: return 2.145 // 2/3 octave
    case 127: return 18.25 // ~1/12.7 octave
    case 31:
    default:
      return 4.318 // 1/3 octave
  }
}

/**
 * Samples the target equalization curve at Graphic EQ center frequencies
 */
export function buildGraphicEqBands(
  count: GraphicEqBandCount,
  stdFreqs: number[],
  eqGains: number[]
): GraphicEqBand[] {
  const centerFreqs = getGraphicFrequenciesForCount(count)
  const q = getGraphicQForCount(count)
  const sampledGains = interpolateLog(stdFreqs, eqGains, centerFreqs)

  return centerFreqs.map((fc, i) => {
    const rawGain = Number.isFinite(sampledGains[i]) ? sampledGains[i] : 0
    const clampedGain = Math.round(Math.max(-24, Math.min(24, rawGain)) * 10) / 10
    return {
      id: `geq-${count}-${i + 1}`,
      fc,
      gain: clampedGain,
      q
    }
  })
}

/**
 * Evaluates the compound frequency response of a Graphic EQ band bank across standard frequencies
 */
export function evaluateGraphicEqResponse(
  bands: GraphicEqBand[],
  evalFreqs: number[],
  fs = 48000
): number[] {
  if (bands.length === 0) {
    return new Array(evalFreqs.length).fill(0)
  }

  // When dealing with 127 bands (Wavelet / AutoEq high-res curve), interpolate directly in log-frequency space,
  // matching Equalizer APO and Wavelet's exact continuous GraphicEQ FIR implementation.
  if (bands.length >= 100) {
    const bandFreqs = bands.map(b => b.fc)
    const bandGains = bands.map(b => b.gain)
    return interpolateLog(bandFreqs, bandGains, evalFreqs)
  }

  const biquads: BiquadFilterConfig[] = bands.map((b) => ({
    id: b.id,
    enabled: true,
    type: 'PK',
    fc: b.fc,
    gain: b.gain,
    q: b.q
  }))

  return evaluateCompoundResponse(biquads, evalFreqs, fs)
}

/**
 * Formats graphic bands as Equalizer APO GraphicEQ directive
 */
export function formatGraphicEqApoDirective(bands: GraphicEqBand[], preamp = 0): string {
  let maxGain = -Infinity
  for (const b of bands) {
    if (b.gain > maxGain) maxGain = b.gain
  }
  const antiClip = maxGain > 0 ? -(maxGain + 0.2) : 0
  const totalOffset = antiClip + preamp

  const points = bands.map((b) => {
    const g = (b.gain + totalOffset).toFixed(1)
    const fcStr = b.fc % 1 === 0 ? Math.round(b.fc).toString() : b.fc.toString()
    return `${fcStr} ${g}`
  })

  return `GraphicEQ: ${points.join('; ')}`
}

