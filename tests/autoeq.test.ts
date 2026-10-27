import { describe, it, expect } from 'vitest'
import { parseFrequencyResponseFile } from '../src/lib/parser/parseFR'
import { smoothFrequencyResponse } from '../src/lib/autoeq/smoothing'
import {
  calculateBiquadCoefficients,
  evaluateBiquadResponse,
  evaluateCompoundResponse,
  BiquadFilterConfig
} from '../src/lib/autoeq/biquad'
import {
  STANDARD_FREQUENCIES,
  generateStandardFrequencies,
  WAVELET_GRAPHIC_EQ_FREQUENCIES
} from '../src/lib/autoeq/constants'
import {
  buildGraphicEqBands,
  evaluateGraphicEqResponse,
  formatGraphicEqApoDirective
} from '../src/lib/autoeq/graphicEq'
import {
  normalizeAt1kHz,
  calculateEqualization,
  buildTargetCurve,
  DEFAULT_TARGET_PARAMS
} from '../src/lib/autoeq/targets'
import { BUILT_IN_TARGETS } from '../src/lib/autoeq/constants'
import { generateImpulseResponse } from '../src/lib/autoeq/impulseResponse'
import { encodeWav } from '../src/lib/audio/wavEncoder'
import {
  generateEqualizerApoConfig,
  generateGraphicEqString,
  generateRewText,
  generateCsv,
  cleanExportFilename,
  generateDetailedWavFilename
} from '../src/lib/autoeq/exporters'

describe('File Parser (parseFR)', () => {
  it('should parse standard CSV measurement data', () => {
    const csvData = `frequency,raw
20.0,75.2
100.0,80.5
1000.0,85.0
10000.0,78.2
`
    const parsed = parseFrequencyResponseFile(csvData, 'TestHeadphone.csv')
    expect(parsed.name).toBe('TestHeadphone')
    expect(parsed.frequencies).toEqual([20, 100, 1000, 10000])
    expect(parsed.rawGains).toEqual([75.2, 80.5, 85.0, 78.2])
  })

  it('should parse REW format with header comments and space delimiters', () => {
    const rewData = `* Room EQ Wizard format
* Measurement: Left Ear
* Format: Frequency(Hz) SPL(dB) Phase(deg)
20.50 72.10 0.0
50.00 78.40 0.0
1000.00 84.00 0.0
20000.00 68.50 0.0
`
    const parsed = parseFrequencyResponseFile(rewData, 'REW_Measurement.txt')
    expect(parsed.name).toBe('REW_Measurement')
    expect(parsed.frequencies.length).toBe(4)
    expect(parsed.frequencies[0]).toBe(20.5)
    expect(parsed.rawGains[2]).toBe(84.0)
  })

  it('should sort frequencies and eliminate duplicates', () => {
    const rawData = `1000 80
100 70
1000 82
50 65
`
    const parsed = parseFrequencyResponseFile(rawData, 'Unsorted.txt')
    expect(parsed.frequencies).toEqual([50, 100, 1000])
    expect(parsed.rawGains).toEqual([65, 70, 80])
  })
})

describe('Biquad Filters (RBJ Audio EQ Cookbook)', () => {
  it('should compute peaking filter response with accurate center gain', () => {
    const filter: BiquadFilterConfig = {
      id: 'test-1',
      enabled: true,
      type: 'PK',
      fc: 1000,
      gain: 6.0,
      q: 1.41
    }

    const testFreqs = [20, 500, 1000, 2000, 20000]
    const resp = evaluateBiquadResponse(filter, testFreqs, 48000)

    // Gain at center frequency (1000 Hz) should be exactly +6.0 dB
    expect(resp[2]).toBeCloseTo(6.0, 1)

    // Far from center frequency, gain should decay toward 0 dB
    expect(Math.abs(resp[0])).toBeLessThan(0.1) // 20 Hz
    expect(Math.abs(resp[4])).toBeLessThan(0.1) // 20 kHz
  })

  it('should compute compound response of multiple filters', () => {
    const f1: BiquadFilterConfig = { id: 'f1', enabled: true, type: 'PK', fc: 100, gain: 3.0, q: 1.0 }
    const f2: BiquadFilterConfig = { id: 'f2', enabled: true, type: 'PK', fc: 1000, gain: -4.0, q: 2.0 }

    const freqs = [100, 1000]
    const compound = evaluateCompoundResponse([f1, f2], freqs, 48000)

    expect(compound[0]).toBeCloseTo(3.0, 1)
    expect(compound[1]).toBeCloseTo(-4.0, 1)
  })
})

describe('Smoothing & AutoEq Logic', () => {
  it('should smooth noisy frequency responses', () => {
    const freqs = [100, 150, 200, 300, 400, 500, 700, 1000]
    const noisyGains = [80, 86, 78, 87, 79, 86, 78, 85]

    const smoothed = smoothFrequencyResponse(freqs, noisyGains, '1/3')
    expect(smoothed.length).toBe(freqs.length)

    // Smoothed values should have lower variance than raw peaks
    const maxRaw = Math.max(...noisyGains)
    const maxSmoothed = Math.max(...smoothed)
    expect(maxSmoothed).toBeLessThan(maxRaw)
  })

  it('should normalize gain at 1 kHz to 0 dB', () => {
    const freqs = [20, 100, 1000, 10000]
    const gains = [70, 78, 85, 75]
    const normalized = normalizeAt1kHz(freqs, gains, 0)

    expect(normalized[2]).toBeCloseTo(0, 4)
    expect(normalized[0]).toBeCloseTo(-15, 4)
  })

  it('should calculate equalization respecting max boost clamp', () => {
    const freqs = [100, 1000, 10000]
    const measurement = [70, 80, 60] // Deep 20 dB drop at 10 kHz
    const target = [75, 80, 75]       // Needs +15 dB at 10 kHz

    const eq = calculateEqualization(freqs, measurement, target, 8)
    // 10 kHz should be clamped to max boost (+8 dB)
    expect(eq[2]).toBeLessThanOrEqual(8.0)
  })

  it('should compute independent High-Pass Filter with configurable slopes and Q resonance', () => {
    const flatTarget = {
      id: 'flat',
      name: 'Flat',
      description: 'Flat target',
      points: [[20, 0], [1000, 0], [20000, 0]] as [number, number][]
    }
    const freqs = [10, 20, 40, 80, 1000]

    // 1. Butterworth 12 dB/oct with Fc = 40 Hz: at 40 Hz attenuation should be ~ -3.0 dB
    const hpf12 = buildTargetCurve(flatTarget, freqs, {
      ...DEFAULT_TARGET_PARAMS,
      hpfEnabled: true,
      hpfFc: 40,
      hpfSlope: 12,
      hpfQ: 0.707
    })
    expect(hpf12[2]).toBeCloseTo(-3.01, 1) // 40 Hz is cutoff
    expect(hpf12[4]).toBeCloseTo(0, 1)     // 1000 Hz passband is unchanged
    expect(hpf12[1]).toBeLessThan(-10)     // 20 Hz (one octave down) is rolled off > 12 dB

    // 2. Linkwitz-Riley 24 dB/oct with Fc = 40 Hz: at 40 Hz attenuation is -6.0 dB
    const hpf24 = buildTargetCurve(flatTarget, freqs, {
      ...DEFAULT_TARGET_PARAMS,
      hpfEnabled: true,
      hpfFc: 40,
      hpfSlope: 24,
      hpfQ: 0.707
    })
    expect(hpf24[2]).toBeCloseTo(-6.02, 1)
    expect(hpf24[1]).toBeLessThan(-20)     // One octave down rolls off > 24 dB

    // 3. High Q resonance (Q = 1.41) produces a resonant bump before cutoff
    const hpfResonant = buildTargetCurve(flatTarget, [30, 40, 50, 60, 1000], {
      ...DEFAULT_TARGET_PARAMS,
      hpfEnabled: true,
      hpfFc: 40,
      hpfSlope: 12,
      hpfQ: 1.41
    })
    // Near 50-60 Hz there should be a resonant peak (> 0 dB)
    expect(hpfResonant[2]).toBeGreaterThan(0)
  })

  it('should compute independent Low-Pass Filter with configurable slopes', () => {
    const flatTarget = {
      id: 'flat',
      name: 'Flat',
      description: 'Flat target',
      points: [[20, 0], [1000, 0], [20000, 0]] as [number, number][]
    }
    const freqs = [1000, 5000, 10000, 20000]

    // Butterworth 12 dB/oct with Fc = 10000 Hz: at 10 kHz attenuation is ~ -3.0 dB
    const lpf12 = buildTargetCurve(flatTarget, freqs, {
      ...DEFAULT_TARGET_PARAMS,
      lpfEnabled: true,
      lpfFc: 10000,
      lpfSlope: 12,
      lpfQ: 0.707
    })
    expect(lpf12[0]).toBeCloseTo(0, 1)     // 1000 Hz passband is unchanged
    expect(lpf12[2]).toBeCloseTo(-3.01, 1) // 10000 Hz is cutoff
    expect(lpf12[3]).toBeLessThan(-10)     // 20000 Hz (one octave up) is rolled off > 12 dB

    // 48 dB/oct Brickwall slope at 10000 Hz: at 20 kHz rolls off > 45 dB
    const lpf48 = buildTargetCurve(flatTarget, freqs, {
      ...DEFAULT_TARGET_PARAMS,
      lpfEnabled: true,
      lpfFc: 10000,
      lpfSlope: 48,
      lpfQ: 0.707
    })
    expect(lpf48[3]).toBeLessThan(-45)
  })

  it('should compute Bass Shelf and High Shelf with configurable Q quality / resonance', () => {
    const flatTarget = {
      id: 'flat',
      name: 'Flat',
      description: 'Flat target',
      points: [[20, 0], [1000, 0], [20000, 0]] as [number, number][]
    }
    const freqs = [20, 105, 1000, 10000, 20000]

    // 1. Bass Shelf +6 dB with Fc = 105 Hz: at 20 Hz it should be close to +6 dB, at 105 Hz ~ +3 dB, at 1 kHz ~ 0 dB
    const bassShelf = buildTargetCurve(flatTarget, freqs, {
      ...DEFAULT_TARGET_PARAMS,
      bassBoostGain: 6.0,
      bassBoostFc: 105,
      bassBoostQ: 0.707
    })
    expect(bassShelf[0]).toBeCloseTo(6.0, 1) // 20 Hz
    expect(bassShelf[1]).toBeCloseTo(3.0, 1) // 105 Hz (half gain)
    expect(bassShelf[2]).toBeCloseTo(0.0, 1) // 1000 Hz

    // 2. High Shelf +4 dB with Fc = 10000 Hz: at 1000 Hz ~ 0 dB, at 10000 Hz ~ +2 dB, at 20000 Hz ~ +4 dB
    const trebleShelf = buildTargetCurve(flatTarget, freqs, {
      ...DEFAULT_TARGET_PARAMS,
      trebleShelfGain: 4.0,
      trebleShelfFc: 10000,
      trebleShelfQ: 0.707
    })
    expect(trebleShelf[2]).toBeCloseTo(0.0, 1) // 1000 Hz
    expect(trebleShelf[3]).toBeCloseTo(2.0, 1) // 10000 Hz (half gain)
    expect(trebleShelf[4]).toBeGreaterThan(3.5) // 20000 Hz (1 octave up reaches ~3.76 dB)

    // 3. High Q resonance creates an overshoot near corner frequency
    const resonantBass = buildTargetCurve(flatTarget, [20, 80, 105, 150, 1000], {
      ...DEFAULT_TARGET_PARAMS,
      bassBoostGain: 6.0,
      bassBoostFc: 105,
      bassBoostQ: 1.8
    })
    // Near 80-90 Hz with Q = 1.8 there is a resonant overshoot > +6 dB
    expect(resonantBass[1]).toBeGreaterThan(6.0)
  })
})

describe('Convolution Impulse Response & WAV Encoder', () => {
  it('should generate a minimum phase impulse response without NaNs or infinities', () => {
    const freqs = [20, 100, 1000, 10000, 20000]
    const eq = [2.0, 1.0, 0.0, -2.0, -4.0]

    const ir = generateImpulseResponse(freqs, eq, {
      fs: 48000,
      taps: 4096,
      phase: 'minimum',
      normalize: true
    })

    expect(ir.length).toBe(4096)

    // Verify all samples are finite numbers
    for (let i = 0; i < ir.length; i++) {
      expect(Number.isFinite(ir[i])).toBe(true)
    }

    // Peak sample must never clip (< 1.0) and be a valid impulse response
    let peak = 0
    for (let i = 0; i < ir.length; i++) {
      if (Math.abs(ir[i]) > peak) peak = Math.abs(ir[i])
    }
    expect(peak).toBeLessThanOrEqual(1.0)
    expect(peak).toBeGreaterThan(0.01)
  })

  it('should encode 16-bit, 24-bit, and 32-bit Float WAV files with valid RIFF headers', () => {
    const samples = new Float64Array(1024)
    // Simple 1 kHz sine burst
    for (let i = 0; i < 1024; i++) {
      samples[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 48000)
    }

    // 1. Test 16-bit Stereo
    const wav16 = encodeWav(samples, { sampleRate: 48000, bitDepth: 16, channels: 'stereo' })
    expect(wav16.length).toBe(44 + 1024 * 2 * 2) // 44 header + 1024 samples * 2 channels * 2 bytes
    const str16 = String.fromCharCode(...wav16.slice(0, 4))
    expect(str16).toBe('RIFF')
    const wave16 = String.fromCharCode(...wav16.slice(8, 12))
    expect(wave16).toBe('WAVE')

    // 2. Test 24-bit Stereo
    const wav24 = encodeWav(samples, { sampleRate: 48000, bitDepth: 24, channels: 'stereo' })
    expect(wav24.length).toBe(44 + 1024 * 2 * 3) // 44 header + 1024 * 2 channels * 3 bytes

    // 3. Test 32-bit Float Mono
    const wav32 = encodeWav(samples, { sampleRate: 96000, bitDepth: 32, channels: 'mono' })
    expect(wav32.length).toBe(44 + 1024 * 1 * 4) // 44 header + 1024 * 1 channel * 4 bytes
  })
})

describe('Exporters (EqualizerAPO, GraphicEQ, REW, CSV)', () => {
  it('should generate valid EqualizerAPO config text', () => {
    const filters: BiquadFilterConfig[] = [
      { id: '1', enabled: true, type: 'PK', fc: 64, gain: 3.5, q: 1.41 },
      { id: '2', enabled: true, type: 'LSC', fc: 105, gain: 4.0, q: 0.71 }
    ]

    const config = generateEqualizerApoConfig(filters, STANDARD_FREQUENCIES)
    expect(config).toContain('Preamp:')
    expect(config).toContain('Filter 1: ON PK Fc 64 Hz Gain 3.5 dB Q 1.41')
    expect(config).toContain('Filter 2: ON LSC Fc 105 Hz Gain 4.0 dB Q 0.71')
  })

  it('should generate valid GraphicEQ string with exact 127 integer points ending at 19871 for Wavelet and EqualizerAPO', () => {
    const eq = STANDARD_FREQUENCIES.map(() => 1.5)
    const graphicEq = generateGraphicEqString(STANDARD_FREQUENCIES, eq, false, 0)
    expect(graphicEq.startsWith('GraphicEQ: ')).toBe(true)
    expect(graphicEq).toContain('20 ')
    expect(graphicEq).toContain('19871 ')
    expect(graphicEq).not.toContain('20000 ')

    const pairs = graphicEq.replace('GraphicEQ: ', '').split('; ')
    expect(pairs.length).toBe(127)
    expect(pairs[0].startsWith('20 ')).toBe(true)
    expect(pairs[126].startsWith('19871 ')).toBe(true)

    // Verify all frequency points are integers
    for (const pair of pairs) {
      const [freqStr, gainStr] = pair.split(' ')
      const freq = Number(freqStr)
      expect(Number.isInteger(freq)).toBe(true)
      expect(Number.isFinite(Number(gainStr))).toBe(true)
    }
  })

  it('should verify WAVELET_GRAPHIC_EQ_FREQUENCIES standard compatibility', () => {
    expect(WAVELET_GRAPHIC_EQ_FREQUENCIES.length).toBe(127)
    expect(WAVELET_GRAPHIC_EQ_FREQUENCIES[0]).toBe(20)
    expect(WAVELET_GRAPHIC_EQ_FREQUENCIES[WAVELET_GRAPHIC_EQ_FREQUENCIES.length - 1]).toBe(19871)
    // Strictly increasing
    for (let i = 1; i < WAVELET_GRAPHIC_EQ_FREQUENCIES.length; i++) {
      expect(WAVELET_GRAPHIC_EQ_FREQUENCIES[i]).toBeGreaterThan(WAVELET_GRAPHIC_EQ_FREQUENCIES[i - 1])
    }
  })

  it('should build and format 127 GraphicEQ bands correctly', () => {
    const eq = STANDARD_FREQUENCIES.map(() => -2.0)
    const bands = buildGraphicEqBands(127, STANDARD_FREQUENCIES, eq)
    expect(bands.length).toBe(127)
    expect(bands[0].fc).toBe(20)
    expect(bands[126].fc).toBe(19871)

    const formatted = formatGraphicEqApoDirective(bands, 0)
    expect(formatted.startsWith('GraphicEQ: ')).toBe(true)
    expect(formatted).toContain('20 ')
    expect(formatted).toContain('19871 ')
    const pairs = formatted.replace('GraphicEQ: ', '').split('; ')
    expect(pairs.length).toBe(127)

    const resp = evaluateGraphicEqResponse(bands, STANDARD_FREQUENCIES)
    expect(resp.length).toBe(STANDARD_FREQUENCIES.length)
    expect(resp[0]).toBeCloseTo(-2.0, 1)
  })

  it('should clean and sanitize curve names for export filenames without mangling', () => {
    expect(cleanExportFilename('Medición Micrófono - Promedio (2546 m) (21:53:51)')).toBe('Medicion_Microfono-Promedio_2546m_21h53')
    expect(cleanExportFilename('Sennheiser HD 600 (Sample)')).toBe('Sennheiser_HD_600_Sample')
    expect(cleanExportFilename('Soundcore 300')).toBe('Soundcore_300')
    expect(cleanExportFilename('CMM22112 (inverso) (Custom)')).toBe('CMM22112_inverso_Custom')
  })

  it('should generate detailed, professional convolution filenames with all DSP parameters', () => {
    const fn1 = generateDetailedWavFilename({
      baseName: 'Medición Micrófono - Promedio (2546 m) (21:53:51)',
      targetName: 'CMM22112 (inverso)',
      sampleRate: 48000,
      bitDepth: 32,
      phaseMode: 'linear',
      taps: 65536,
      channelMode: 'mono',
      preampDb: -13.6
    })
    expect(fn1).toBe(
      'Medicion_Microfono-Promedio_2546m_21h53_to_CMM22112_inverso_Convolution_48kHz_32bitFloat_LinPhase_65536taps_Mono_-13.6dB'
    )

    const fn2 = generateDetailedWavFilename({
      baseName: 'Sennheiser HD 600 (Sample)',
      targetName: 'Harman Over-Ear (2018)',
      sampleRate: 44100,
      bitDepth: 24,
      phaseMode: 'minimum',
      taps: 16384,
      channelMode: 'stereo',
      preampDb: -10.9
    })
    expect(fn2).toBe(
      'Sennheiser_HD_600_Sample_to_Harman_Over-Ear_2018_Convolution_44.1kHz_24bit_MinPhase_16384taps_Stereo_-10.9dB'
    )

    const fn3 = generateDetailedWavFilename({
      baseName: 'Soundcore 300',
      targetName: null,
      sampleRate: 96000,
      bitDepth: 16,
      phaseMode: 'minimum',
      taps: 4096,
      channelMode: 'stereo',
      preampDb: 0
    })
    expect(fn3).toBe('Soundcore_300_Convolution_96kHz_16bit_MinPhase_4096taps_Stereo_0dB')
  })
})
