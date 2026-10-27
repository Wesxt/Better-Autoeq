import type { BiquadFilterConfig } from './biquad'
import { evaluateCompoundResponse } from './biquad'
import { interpolateLog } from './interpolation'
import { PREAMP_HEADROOM, WAVELET_GRAPHIC_EQ_FREQUENCIES } from './constants'
import type { BitDepth, ChannelMode } from '../audio/wavEncoder'

/**
 * Standard GraphicEQ frequency points (127 exact integer points log-spaced from 20 Hz to 19,871 Hz for Wavelet & AutoEq)
 */
export function getGraphicEqFrequencies(): number[] {
  return [...WAVELET_GRAPHIC_EQ_FREQUENCIES]
}

/**
 * Generates EqualizerAPO and Wavelet compatible GraphicEQ string from equalization curve
 */
export function generateGraphicEqString(
  freqs: number[],
  equalization: number[],
  normalize = true,
  preamp = 0
): string {
  const graphicFreqs = getGraphicEqFrequencies()
  const graphicGains = interpolateLog(freqs, equalization, graphicFreqs)

  // Find max gain to compute headroom
  let maxGain = -Infinity
  for (const g of graphicGains) {
    if (g > maxGain) maxGain = g
  }

  const offset = normalize && maxGain > 0 ? -(maxGain + PREAMP_HEADROOM) : 0
  const totalOffset = offset + preamp

  const points = graphicFreqs.map((f, i) => {
    let g = graphicGains[i] + totalOffset
    // Prevent bass boost below 20Hz
    if (i === 0 && g > 0) g = 0
    return `${Math.round(f)} ${g.toFixed(1)}`
  })

  return `GraphicEQ: ${points.join('; ')}`
}

/**
 * Generates EqualizerAPO Parametric EQ config.txt string
 */
export function generateEqualizerApoConfig(
  filters: BiquadFilterConfig[],
  freqs: number[],
  preampOffset = 0
): string {
  if (filters.length === 0) {
    return 'Preamp: 0.0 dB\n# No filters configured\n'
  }

  // Calculate compound maximum gain to prevent digital clipping
  const compound = evaluateCompoundResponse(filters, freqs)
  let maxGain = 0
  for (const g of compound) {
    if (g > maxGain) maxGain = g
  }

  // Auto-calculated preamp with headroom
  const calculatedPreamp = maxGain > 0 ? -(maxGain + PREAMP_HEADROOM) + preampOffset : preampOffset

  let output = `Preamp: ${calculatedPreamp.toFixed(1)} dB\n`

  filters.forEach((filt, index) => {
    if (!filt.enabled) return
    const typeStr = filt.type // PK, LSC, HSC, HP, LP
    if (filt.type === 'HP' || filt.type === 'LP') {
      output += `Filter ${index + 1}: ON ${typeStr} Fc ${Math.round(filt.fc)} Hz Q ${filt.q.toFixed(2)}\n`
    } else {
      output += `Filter ${index + 1}: ON ${typeStr} Fc ${Math.round(filt.fc)} Hz Gain ${filt.gain.toFixed(1)} dB Q ${filt.q.toFixed(2)}\n`
    }
  })

  return output
}

/**
 * Generates REW measurement format text
 */
export function generateRewText(
  freqs: number[],
  gains: number[],
  title = 'Frequency Response'
): string {
  let output = `* ${title}\n`
  output += `* Frequency Response data\n`
  output += `* Format: Freq(Hz) SPL(dB)\n`
  for (let i = 0; i < freqs.length; i++) {
    output += `${freqs[i].toFixed(2)} ${gains[i].toFixed(2)}\n`
  }
  return output
}

/**
 * Generates CSV data with multiple columns
 */
export function generateCsv(
  freqs: number[],
  columns: { name: string; values: number[] }[]
): string {
  const header = ['frequency', ...columns.map(c => c.name)].join(',')
  const rows: string[] = [header]

  for (let i = 0; i < freqs.length; i++) {
    const row = [freqs[i].toFixed(2), ...columns.map(c => (c.values[i] !== undefined ? c.values[i].toFixed(2) : ''))]
    rows.push(row.join(','))
  }

  return rows.join('\n')
}

/**
 * Initiates browser download of text data
 */
export function downloadTextFile(content: string, filename: string, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/**
 * Sanitizes a curve name into a clean, professional filename without mangled accents or symbol noise.
 * Examples:
 *  "Medición Micrófono - Promedio (2546 m) (21:53:51)" -> "Medicion_Microfono-Promedio_2546m_21h53"
 *  "Sennheiser HD 600 (Sample)" -> "Sennheiser_HD_600_Sample"
 */
export function cleanExportFilename(name: string): string {
  if (!name) return 'AutoEq'

  // 1. Normalize unicode diacritics (e.g. ó -> o, í -> i, ñ -> n)
  let clean = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // 2. Clean up timestamp formats: (21:53:51) -> 21h53
  clean = clean.replace(/\((\d{1,2}):(\d{2}):\d{2}\)/g, '$1h$2')
  clean = clean.replace(/\((\d{1,2}):(\d{2})\)/g, '$1h$2')

  // 3. Clean up sample count formats: (2546 m) -> 2546m
  clean = clean.replace(/\((\d+)\s*m\)/gi, '$1m')

  // 4. Replace parentheses with space
  clean = clean.replace(/[()]/g, ' ')

  // 5. Replace any invalid or special filename characters
  clean = clean.replace(/[^a-zA-Z0-9.\-_\s]/g, '_')

  // 6. Clean up whitespace and consecutive underscores / dashes
  clean = clean.replace(/\s*-\s*/g, '-')
  clean = clean.replace(/\s+/g, '_')
  clean = clean.replace(/_+/g, '_')
  clean = clean.replace(/-+/g, '-')
  clean = clean.replace(/^[-_]+|[-_]+$/g, '')

  return clean || 'AutoEq'
}

export interface DetailedWavFilenameOptions {
  baseName: string
  targetName?: string | null
  sampleRate: number
  bitDepth: BitDepth
  phaseMode: 'minimum' | 'linear'
  taps: number
  channelMode: ChannelMode
  preampDb?: number
}

/**
 * Formats a clean, descriptive, and comprehensive filename for convolution impulse responses (.wav)
 * detailing all essential audio engineering & DSP parameters:
 *  - Source measurement / reference curve
 *  - Target calibration curve (if applicable)
 *  - Convolution filter tag
 *  - Precise sample rate (e.g. 44.1kHz, 48kHz, 96kHz)
 *  - Bit depth format (e.g. 32bitFloat, 24bit, 16bit)
 *  - Phase mode (MinPhase / LinPhase)
 *  - Filter resolution / taps count (e.g. 65536taps)
 *  - Channel mode (Stereo / Mono)
 *  - Effective anti-clipping preamp (e.g. -10.9dB)
 */
export function generateDetailedWavFilename(options: DetailedWavFilenameOptions): string {
  const {
    baseName,
    targetName,
    sampleRate,
    bitDepth,
    phaseMode,
    taps,
    channelMode,
    preampDb
  } = options

  const cleanBase = cleanExportFilename(baseName)
  const cleanTarget = targetName ? cleanExportFilename(targetName) : null

  // Include target only if it's not already redundant in the base curve name
  const targetTag = cleanTarget && !cleanBase.toLowerCase().includes(cleanTarget.toLowerCase())
    ? `_to_${cleanTarget}`
    : ''

  // Sub-kHz accurate sample rate formatting (e.g. 44.1kHz, 48kHz, 88.2kHz, 96kHz, 192kHz)
  const srStr = sampleRate % 1000 === 0
    ? `${sampleRate / 1000}kHz`
    : `${(sampleRate / 1000).toFixed(1).replace(/\.0$/, '')}kHz`

  // 32-bit is IEEE Float; 16/24 are standard PCM
  const bitStr = bitDepth === 32 ? '32bitFloat' : `${bitDepth}bit`

  // Phase mode tag
  const phaseStr = phaseMode === 'minimum' ? 'MinPhase' : 'LinPhase'

  // Filter resolution taps count
  const tapsStr = `${taps}taps`

  // Channels tag
  const chanStr = channelMode === 'stereo' ? 'Stereo' : 'Mono'

  // Preamp offset tag (anti-clipping / normalization level)
  let preampStr = ''
  if (typeof preampDb === 'number') {
    const rounded = Math.round(preampDb * 10) / 10
    preampStr = `_${rounded > 0 ? `+${rounded}` : `${rounded}`}dB`
  }

  return `${cleanBase}${targetTag}_Convolution_${srStr}_${bitStr}_${phaseStr}_${tapsStr}_${chanStr}${preampStr}`
}

