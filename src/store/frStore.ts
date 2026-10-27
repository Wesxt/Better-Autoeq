import { createStore } from 'solid-js/store'
import { createSignal, createEffect } from 'solid-js'
import { STANDARD_FREQUENCIES, BUILT_IN_TARGETS } from '../lib/autoeq/constants'
import type { TargetCurveDefinition } from '../lib/autoeq/constants'
import { interpolateCubicSpline, interpolateLog } from '../lib/autoeq/interpolation'
import { smoothFrequencyResponse } from '../lib/autoeq/smoothing'
import type { SmoothingType } from '../lib/autoeq/smoothing'
import { buildTargetCurve, calculateEqualization, DEFAULT_TARGET_PARAMS } from '../lib/autoeq/targets'
import type { TargetParameters } from '../lib/autoeq/targets'
import type { BiquadFilterConfig } from '../lib/autoeq/biquad'
import { evaluateCompoundResponse } from '../lib/autoeq/biquad'
import { optimizePEQ } from '../lib/autoeq/optimizer'
import { generateImpulseResponse, evaluateFirFrequencyResponse } from '../lib/autoeq/impulseResponse'
import {
  buildGraphicEqBands,
  evaluateGraphicEqResponse,
  type GraphicEqBand,
  type GraphicEqBandCount
} from '../lib/autoeq/graphicEq'
import { audioPreview } from '../lib/audio/audioPreview'
import {
  type PlotSettings,
  type MicSettings,
  type MicCaptureMode,
  type SweepType,
  type ExportSettings,
  type OverlayColors,
  type PersistedConfig,
  type AutoEqMethod,
  DEFAULT_PLOT_SETTINGS,
  DEFAULT_MIC_SETTINGS,
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_OVERLAY_COLORS,
  loadPersistedConfig,
  savePersistedConfig,
  loadPersistedCurves,
  savePersistedCurves,
  loadPersistedPeq,
  savePersistedPeq,
  clearAllPersistedData
} from '../lib/storage/localStorage'

export type { PlotSettings, MicSettings, MicCaptureMode, SweepType, ExportSettings, OverlayColors, AutoEqMethod, GraphicEqBand, GraphicEqBandCount }

export interface FrequencyCurve {
  id: string
  name: string
  color: string
  visible: boolean
  frequencies: number[]
  rawGains: number[]
  smoothedGains: number[]
  smoothing: SmoothingType
  offsetDb: number
}

// Design color palette: Studio Cobalt, Crimson, & Professional Audio Neutrals (OKLab / Hex)
export const CURVE_COLORS = [
  'oklab(0.62 -0.050 -0.136)', // Studio Cobalt (Primary Active)
  '#FFFFFF',                   // Pure White
  'oklab(0.72 -0.046 -0.100)', // Studio Cerulean Sky
  '#C5C6C0',                   // Warm Studio Silver
  'oklab(0.82 -0.033 -0.056)', // Studio Steel Ice
  'oklab(0.75 0.036 0.135)',   // Studio Warm Amber
  'oklab(0.72 -0.120 -0.010)', // Studio Mint
  '#FF0000',                   // Crimson Vivid Red
  '#950101',                   // Deep Crimson Blood
  '#3D0000'                    // Studio Dark Wine Maroon
]

// Sample demonstration curves: Sennheiser HD600 and Harman IEM
const SAMPLE_HD600_POINTS: [number, number][] = [
  [20, 68.2], [30, 72.1], [50, 76.5], [80, 80.8], [100, 82.2], [200, 84.1],
  [500, 84.5], [1000, 84.0], [1500, 85.2], [2000, 86.8], [3000, 92.4], [3500, 91.0],
  [4000, 88.5], [5000, 85.2], [6000, 84.8], [7000, 84.0], [8000, 83.5], [9000, 84.2],
  [10000, 83.0], [12000, 79.5], [15000, 76.0], [20000, 69.0]
]

const SAMPLE_IEM_POINTS: [number, number][] = [
  [20, 88.5], [30, 88.2], [50, 86.0], [80, 82.5], [100, 80.0], [200, 79.2],
  [500, 80.5], [1000, 82.0], [1500, 86.0], [2000, 90.5], [2800, 96.0], [3500, 93.5],
  [5000, 88.0], [6000, 86.5], [8000, 89.0], [10000, 85.0], [12000, 81.0], [15000, 78.0], [20000, 72.0]
]

const initialHd600Raw = interpolateCubicSpline(
  SAMPLE_HD600_POINTS.map(p => p[0]),
  SAMPLE_HD600_POINTS.map(p => p[1]),
  STANDARD_FREQUENCIES
)
const initialIemRaw = interpolateCubicSpline(
  SAMPLE_IEM_POINTS.map(p => p[0]),
  SAMPLE_IEM_POINTS.map(p => p[1]),
  STANDARD_FREQUENCIES
)

export interface AppState {
  curves: FrequencyCurve[]
  activeReferenceCurveId: string | null
  selectedTargetId: string
  customTarget: TargetCurveDefinition | null
  targetParams: TargetParameters
  globalSmoothing: SmoothingType
  normalizeAt1k: boolean
  showDelta: boolean
  deltaSecondaryCurveId: string | null
  peqFilters: BiquadFilterConfig[]
  selectedEqMethod: AutoEqMethod
  firTaps: number
  firPhase: 'minimum' | 'linear'
  firSampleRate: number
  graphicEqBandsCount: GraphicEqBandCount
  graphicEqBands: GraphicEqBand[]
  isMicModalOpen: boolean
  isExportModalOpen: boolean
  maxFiltersCount: number
  theme: 'dark' | 'light'
  overlayColors: OverlayColors
  plotSettings: PlotSettings
  micSettings: MicSettings
  exportSettings: ExportSettings
}

// Carga inicial segura desde LocalStorage
const persistedConfig = loadPersistedConfig()
const persistedCurves = loadPersistedCurves<FrequencyCurve>()
const persistedPeq = loadPersistedPeq()

const initialTheme = persistedConfig?.theme || (typeof localStorage !== 'undefined' ? (localStorage.getItem('better_autoeq_theme') as 'dark' | 'light') : null) || 'dark'
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', initialTheme)
}

const defaultSampleCurves: FrequencyCurve[] = [
  {
    id: 'curve-sample-1',
    name: 'Sennheiser HD 600 (Sample)',
    color: 'oklab(0.62 -0.050 -0.136)', // Studio Cobalt Primary
    visible: true,
    frequencies: [...STANDARD_FREQUENCIES],
    rawGains: initialHd600Raw,
    smoothedGains: [...initialHd600Raw],
    smoothing: 'none',
    offsetDb: 0
  },
  {
    id: 'curve-sample-2',
    name: 'Reference IEM Measurement (Sample)',
    color: '#ffffff', // Pure White
    visible: true,
    frequencies: [...STANDARD_FREQUENCIES],
    rawGains: initialIemRaw,
    smoothedGains: [...initialIemRaw],
    smoothing: 'none',
    offsetDb: 0
  }
]

// Validación de curvas persistidas
let initialCurves = defaultSampleCurves
if (persistedCurves && Array.isArray(persistedCurves) && persistedCurves.length > 0) {
  const valid = persistedCurves.filter(c => c && c.id && c.name && Array.isArray(c.frequencies) && Array.isArray(c.rawGains))
  if (valid.length > 0) {
    initialCurves = valid.map(c => ({
      ...c,
      smoothedGains: Array.isArray(c.smoothedGains) && c.smoothedGains.length === c.frequencies.length
        ? c.smoothedGains
        : smoothFrequencyResponse(c.frequencies, c.rawGains, c.smoothing || 'none')
    }))
  }
}

// Comprobación de curva activa de referencia
let initialActiveRef = persistedConfig?.activeReferenceCurveId || initialCurves[0]?.id || 'curve-sample-1'
if (!initialCurves.some(c => c.id === initialActiveRef)) {
  initialActiveRef = initialCurves[0]?.id || 'curve-sample-1'
}

let initialDeltaSec = persistedConfig?.deltaSecondaryCurveId || (initialCurves.length > 1 ? initialCurves[1]?.id : null)
if (initialDeltaSec && !initialCurves.some(c => c.id === initialDeltaSec)) {
  initialDeltaSec = initialCurves.find(c => c.id !== initialActiveRef)?.id || null
}

const [state, setState] = createStore<AppState>({
  curves: initialCurves,
  activeReferenceCurveId: initialActiveRef,
  selectedTargetId: persistedConfig?.selectedTargetId || 'harman-over-ear-2018',
  customTarget: persistedConfig?.customTarget || null,
  targetParams: {
    ...DEFAULT_TARGET_PARAMS,
    bassBoostGain: 0,
    bassBoostFc: 105,
    bassBoostQ: typeof persistedConfig?.targetParams?.bassBoostQ === 'number'
      ? persistedConfig.targetParams.bassBoostQ
      : 0.707,
    trebleShelfGain: 0,
    trebleShelfFc: 10000,
    trebleShelfQ: typeof persistedConfig?.targetParams?.trebleShelfQ === 'number'
      ? persistedConfig.targetParams.trebleShelfQ
      : 0.707,
    trebleTilt: 0,
    maxBoost: 8,
    limitTrebleBoost: typeof persistedConfig?.targetParams?.limitTrebleBoost === 'boolean'
      ? persistedConfig.targetParams.limitTrebleBoost
      : true,
    hpfEnabled: typeof persistedConfig?.targetParams?.hpfEnabled === 'boolean'
      ? persistedConfig.targetParams.hpfEnabled
      : false,
    hpfFc: typeof persistedConfig?.targetParams?.hpfFc === 'number'
      ? persistedConfig.targetParams.hpfFc
      : 20,
    hpfSlope: persistedConfig?.targetParams?.hpfSlope || 12,
    hpfQ: typeof persistedConfig?.targetParams?.hpfQ === 'number'
      ? persistedConfig.targetParams.hpfQ
      : 0.707,
    hpfType: persistedConfig?.targetParams?.hpfType || 'butterworth',
    lpfEnabled: typeof persistedConfig?.targetParams?.lpfEnabled === 'boolean'
      ? persistedConfig.targetParams.lpfEnabled
      : false,
    lpfFc: typeof persistedConfig?.targetParams?.lpfFc === 'number'
      ? persistedConfig.targetParams.lpfFc
      : 20000,
    lpfSlope: persistedConfig?.targetParams?.lpfSlope || 12,
    lpfQ: typeof persistedConfig?.targetParams?.lpfQ === 'number'
      ? persistedConfig.targetParams.lpfQ
      : 0.707,
    lpfType: persistedConfig?.targetParams?.lpfType || 'butterworth',
    ...(persistedConfig?.targetParams || {})
  },
  globalSmoothing: persistedConfig?.globalSmoothing || 'none',
  normalizeAt1k: typeof persistedConfig?.normalizeAt1k === 'boolean' ? persistedConfig.normalizeAt1k : false,
  showDelta: typeof persistedConfig?.showDelta === 'boolean' ? persistedConfig.showDelta : false,
  deltaSecondaryCurveId: initialDeltaSec,
  peqFilters: persistedPeq || [],
  selectedEqMethod: persistedConfig?.selectedEqMethod || 'peq',
  firTaps: persistedConfig?.firTaps || 8192,
  firPhase: persistedConfig?.firPhase || 'minimum',
  firSampleRate: persistedConfig?.firSampleRate || 48000,
  graphicEqBandsCount: persistedConfig?.graphicEqBandsCount || 31,
  graphicEqBands: [],
  isMicModalOpen: false,
  isExportModalOpen: false,
  maxFiltersCount: typeof persistedConfig?.maxFiltersCount === 'number'
    ? Math.min(20, Math.max(3, persistedConfig.maxFiltersCount))
    : 7,
  theme: initialTheme,
  overlayColors: {
    ...DEFAULT_OVERLAY_COLORS,
    ...(persistedConfig?.overlayColors || {})
  },
  plotSettings: {
    ...DEFAULT_PLOT_SETTINGS,
    ...(persistedConfig?.plotSettings || {})
  },
  micSettings: {
    ...DEFAULT_MIC_SETTINGS,
    ...(persistedConfig?.micSettings || {})
  },
  exportSettings: {
    ...DEFAULT_EXPORT_SETTINGS,
    ...(persistedConfig?.exportSettings || {})
  }
})


// Signals for derived AutoEq data
export const [targetCurve, setTargetCurve] = createSignal<number[]>([])
export const [equalizationCurve, setEqualizationCurve] = createSignal<number[]>([])
export const [peqCompoundCurve, setPeqCompoundCurve] = createSignal<number[]>([])
export const [firCompoundCurve, setFirCompoundCurve] = createSignal<number[]>([])
export const [graphicEqCompoundCurve, setGraphicEqCompoundCurve] = createSignal<number[]>([])
export const [equalizedResultCurve, setEqualizedResultCurve] = createSignal<number[]>([])

/**
 * Returns the compound frequency response of the currently active EQ method
 */
export function activeEqualizationCurve(): number[] {
  switch (state.selectedEqMethod) {
    case 'fir':
      return firCompoundCurve()
    case 'graphiceq':
      return graphicEqCompoundCurve()
    case 'ideal':
      return equalizationCurve()
    case 'peq':
    default:
      return peqCompoundCurve()
  }
}

/**
 * Synchronously recalculates the equalized result curve based on active measurement and current EQ method
 */
export function updateActiveEqualizedCurve() {
  const activeCurve = state.curves.find(c => c.id === state.activeReferenceCurveId)
  if (!activeCurve) return
  const activeEq = activeEqualizationCurve()
  const equalized = new Array<number>(STANDARD_FREQUENCIES.length)
  for (let i = 0; i < STANDARD_FREQUENCIES.length; i++) {
    equalized[i] = Math.round((activeCurve.smoothedGains[i] + (activeEq[i] ?? 0)) * 100) / 100
  }
  setEqualizedResultCurve(equalized)
}

/**
 * Recomputes Target, Equalization, and PEQ / FIR / GraphicEQ filters when inputs change
 */
export function recomputeAutoEq() {
  const activeCurve = state.curves.find(c => c.id === state.activeReferenceCurveId)
  if (!activeCurve) return

  // 1. Get active target definition
  let targetDef: TargetCurveDefinition | undefined
  if (state.selectedTargetId === 'custom' && state.customTarget) {
    targetDef = state.customTarget
  } else {
    targetDef = BUILT_IN_TARGETS.find(t => t.id === state.selectedTargetId) || BUILT_IN_TARGETS[0]
  }

  // 2. Build target curve with current bass boost and tilt
  const tCurve = buildTargetCurve(targetDef, STANDARD_FREQUENCIES, state.targetParams)
  setTargetCurve(tCurve)

  // 3. Compute equalization curve (target - measurement)
  const measurementGains = activeCurve.smoothedGains
  const eqCurve = calculateEqualization(
    STANDARD_FREQUENCIES,
    measurementGains,
    tCurve,
    state.targetParams.maxBoost,
    state.targetParams.limitTrebleBoost
  )
  setEqualizationCurve(eqCurve)

  // 4. Optimize PEQ filters
  const filters = optimizePEQ(STANDARD_FREQUENCIES, eqCurve, {
    maxFilters: state.maxFiltersCount,
    maxGain: state.targetParams.maxBoost,
    minGain: -16,
    maxFc: state.targetParams.limitTrebleBoost ? 16000 : 20000,
    hpf: {
      enabled: state.targetParams.hpfEnabled,
      fc: state.targetParams.hpfFc,
      slope: state.targetParams.hpfSlope,
      q: state.targetParams.hpfQ
    },
    lpf: {
      enabled: state.targetParams.lpfEnabled,
      fc: state.targetParams.lpfFc,
      slope: state.targetParams.lpfSlope,
      q: state.targetParams.lpfQ
    }
  })
  setState('peqFilters', filters)

  // 5. Evaluate compound PEQ response
  const peqCompound = evaluateCompoundResponse(filters, STANDARD_FREQUENCIES)
  setPeqCompoundCurve(peqCompound)

  // 6. Compute FIR response
  try {
    const ir = generateImpulseResponse(STANDARD_FREQUENCIES, eqCurve, {
      fs: state.firSampleRate,
      taps: state.firTaps,
      phase: state.firPhase,
      normalize: false,
      preamp: 0
    })
    const firResponse = evaluateFirFrequencyResponse(ir, state.firSampleRate, STANDARD_FREQUENCIES)
    setFirCompoundCurve(firResponse)
  } catch (e) {
    console.warn('[AutoEq] Error evaluating FIR:', e)
    setFirCompoundCurve(eqCurve)
  }

  // 7. Compute GraphicEQ bands and response
  try {
    const geqBands = buildGraphicEqBands(state.graphicEqBandsCount, STANDARD_FREQUENCIES, eqCurve)
    setState('graphicEqBands', geqBands)
    const geqResponse = evaluateGraphicEqResponse(geqBands, STANDARD_FREQUENCIES)
    setGraphicEqCompoundCurve(geqResponse)
  } catch (e) {
    console.warn('[AutoEq] Error evaluating GraphicEQ:', e)
    setGraphicEqCompoundCurve(eqCurve)
  }

  // 8. Compute equalized result based on currently active EQ method
  updateActiveEqualizedCurve()

  // Update audio preview filter engine with PEQ filters
  let maxGain = 0
  for (const g of peqCompound) if (g > maxGain) maxGain = g
  audioPreview.updateFilters(filters, maxGain)
}

// Actions
export const frActions = {
  addCurve(
    name: string,
    frequencies: number[],
    rawGains: number[],
    smoothing: SmoothingType = state.globalSmoothing,
    customColor?: string
  ) {
    const nextColor = customColor || CURVE_COLORS[state.curves.length % CURVE_COLORS.length]

    // Faithfully project data onto the standard logarithmic frequency grid
    let stdRawGains: number[]
    if (frequencies.length === STANDARD_FREQUENCIES.length && frequencies.every((f, i) => Math.abs(f - STANDARD_FREQUENCIES[i]) < 0.01)) {
      stdRawGains = [...rawGains]
    } else {
      stdRawGains = interpolateLog(frequencies, rawGains, STANDARD_FREQUENCIES)
    }

    const smoothed = smoothFrequencyResponse(STANDARD_FREQUENCIES, stdRawGains, smoothing)
    const newId = `curve-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`

    const newCurve: FrequencyCurve = {
      id: newId,
      name,
      color: nextColor,
      visible: true,
      frequencies: [...STANDARD_FREQUENCIES],
      rawGains: stdRawGains,
      smoothedGains: smoothed,
      smoothing,
      offsetDb: 0
    }

    setState('curves', (prev) => [...prev, newCurve])
    if (!state.activeReferenceCurveId || state.curves.length === 1) {
      setState('activeReferenceCurveId', newId)
    }
    recomputeAutoEq()
    return newId
  },

  removeCurve(id: string) {
    setState('curves', prev => prev.filter(c => c.id !== id))
    if (state.activeReferenceCurveId === id) {
      const remaining = state.curves[0]?.id || null
      setState('activeReferenceCurveId', remaining)
    }
    recomputeAutoEq()
  },

  toggleCurveVisibility(id: string) {
    setState('curves', c => c.id === id, 'visible', v => !v)
  },

  setActiveReference(id: string) {
    setState('activeReferenceCurveId', id)
    recomputeAutoEq()
  },

  setCurveColor(id: string, color: string) {
    setState('curves', c => c.id === id, 'color', color)
  },

  setOverlayColor(key: keyof OverlayColors, color: string) {
    setState('overlayColors', key, color)
  },

  setCurveOffset(id: string, offsetDb: number) {
    setState('curves', c => c.id === id, 'offsetDb', offsetDb)
  },

  setCurveSmoothing(id: string, smoothing: SmoothingType) {
    const curve = state.curves.find(c => c.id === id)
    if (!curve) return
    const smoothed = smoothFrequencyResponse(curve.frequencies, curve.rawGains, smoothing)
    setState('curves', c => c.id === id, {
      smoothing,
      smoothedGains: smoothed
    })
    if (state.activeReferenceCurveId === id) {
      recomputeAutoEq()
    }
  },

  setGlobalSmoothing(smoothing: SmoothingType) {
    setState('globalSmoothing', smoothing)
    state.curves.forEach(c => {
      this.setCurveSmoothing(c.id, smoothing)
    })
  },

  setTarget(targetId: string) {
    setState('selectedTargetId', targetId)
    recomputeAutoEq()
  },

  setCustomTarget(target: TargetCurveDefinition) {
    setState('customTarget', target)
    setState('selectedTargetId', 'custom')
    recomputeAutoEq()
  },

  setTargetParams(params: Partial<TargetParameters>) {
    setState('targetParams', prev => ({ ...prev, ...params }))
    recomputeAutoEq()
  },

  setMaxFilters(count: number) {
    setState('maxFiltersCount', count)
    recomputeAutoEq()
  },

  toggleFilterEnabled(filterId: string) {
    setState('peqFilters', f => f.id === filterId, 'enabled', e => !e)
    const compound = evaluateCompoundResponse(state.peqFilters, STANDARD_FREQUENCIES)
    setPeqCompoundCurve(compound)
    updateActiveEqualizedCurve()

    let maxGain = 0
    for (const g of compound) if (g > maxGain) maxGain = g
    audioPreview.updateFilters(state.peqFilters, maxGain)
  },

  updateFilterParam(filterId: string, param: 'fc' | 'gain' | 'q' | 'type', value: number | string) {
    setState('peqFilters', f => f.id === filterId, param as any, value)
    const compound = evaluateCompoundResponse(state.peqFilters, STANDARD_FREQUENCIES)
    setPeqCompoundCurve(compound)
    updateActiveEqualizedCurve()

    let maxGain = 0
    for (const g of compound) if (g > maxGain) maxGain = g
    audioPreview.updateFilters(state.peqFilters, maxGain)
  },

  addFilter(partial?: Partial<BiquadFilterConfig>) {
    const newId = `filter-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
    const newFilter: BiquadFilterConfig = {
      id: newId,
      enabled: true,
      type: partial?.type || 'PK',
      fc: partial?.fc ?? 1000,
      gain: partial?.gain ?? 0,
      q: partial?.q ?? 1.41,
      ...partial
    }
    setState('peqFilters', prev => [...prev, newFilter])
    const compound = evaluateCompoundResponse(state.peqFilters, STANDARD_FREQUENCIES)
    setPeqCompoundCurve(compound)
    updateActiveEqualizedCurve()

    let maxGain = 0
    for (const g of compound) if (g > maxGain) maxGain = g
    audioPreview.updateFilters(state.peqFilters, maxGain)
    scheduleSave()
  },

  removeFilter(filterId: string) {
    setState('peqFilters', prev => prev.filter(f => f.id !== filterId))
    const compound = evaluateCompoundResponse(state.peqFilters, STANDARD_FREQUENCIES)
    setPeqCompoundCurve(compound)
    updateActiveEqualizedCurve()

    let maxGain = 0
    for (const g of compound) if (g > maxGain) maxGain = g
    audioPreview.updateFilters(state.peqFilters, maxGain)
    scheduleSave()
  },

  setEqMethod(method: AutoEqMethod) {
    setState('selectedEqMethod', method)
    updateActiveEqualizedCurve()
    scheduleSave()
  },

  setFirTaps(taps: number) {
    setState('firTaps', taps)
    const eqCurve = equalizationCurve()
    if (eqCurve.length > 0) {
      try {
        const ir = generateImpulseResponse(STANDARD_FREQUENCIES, eqCurve, {
          fs: state.firSampleRate,
          taps: taps,
          phase: state.firPhase,
          normalize: false,
          preamp: 0
        })
        const firResponse = evaluateFirFrequencyResponse(ir, state.firSampleRate, STANDARD_FREQUENCIES)
        setFirCompoundCurve(firResponse)
        if (state.selectedEqMethod === 'fir') {
          updateActiveEqualizedCurve()
        }
      } catch (e) {
        console.warn('[AutoEq] Error recalculating FIR taps:', e)
      }
    }
    scheduleSave()
  },

  setFirPhase(phase: 'minimum' | 'linear') {
    setState('firPhase', phase)
    const eqCurve = equalizationCurve()
    if (eqCurve.length > 0) {
      try {
        const ir = generateImpulseResponse(STANDARD_FREQUENCIES, eqCurve, {
          fs: state.firSampleRate,
          taps: state.firTaps,
          phase: phase,
          normalize: false,
          preamp: 0
        })
        const firResponse = evaluateFirFrequencyResponse(ir, state.firSampleRate, STANDARD_FREQUENCIES)
        setFirCompoundCurve(firResponse)
        if (state.selectedEqMethod === 'fir') {
          updateActiveEqualizedCurve()
        }
      } catch (e) {
        console.warn('[AutoEq] Error recalculating FIR phase:', e)
      }
    }
    scheduleSave()
  },

  setFirSampleRate(sr: number) {
    setState('firSampleRate', sr)
    const eqCurve = equalizationCurve()
    if (eqCurve.length > 0) {
      try {
        const ir = generateImpulseResponse(STANDARD_FREQUENCIES, eqCurve, {
          fs: sr,
          taps: state.firTaps,
          phase: state.firPhase,
          normalize: false,
          preamp: 0
        })
        const firResponse = evaluateFirFrequencyResponse(ir, sr, STANDARD_FREQUENCIES)
        setFirCompoundCurve(firResponse)
        if (state.selectedEqMethod === 'fir') {
          updateActiveEqualizedCurve()
        }
      } catch (e) {
        console.warn('[AutoEq] Error recalculating FIR sample rate:', e)
      }
    }
    scheduleSave()
  },

  setGraphicEqBandsCount(count: GraphicEqBandCount) {
    setState('graphicEqBandsCount', count)
    const eqCurve = equalizationCurve()
    if (eqCurve.length > 0) {
      try {
        const geqBands = buildGraphicEqBands(count, STANDARD_FREQUENCIES, eqCurve)
        setState('graphicEqBands', geqBands)
        const geqResponse = evaluateGraphicEqResponse(geqBands, STANDARD_FREQUENCIES)
        setGraphicEqCompoundCurve(geqResponse)
        if (state.selectedEqMethod === 'graphiceq') {
          updateActiveEqualizedCurve()
        }
      } catch (e) {
        console.warn('[AutoEq] Error recalculating GraphicEQ bands:', e)
      }
    }
    scheduleSave()
  },

  updateGraphicEqBandGain(bandId: string, gain: number) {
    setState('graphicEqBands', b => b.id === bandId, 'gain', gain)
    const geqResponse = evaluateGraphicEqResponse(state.graphicEqBands, STANDARD_FREQUENCIES)
    setGraphicEqCompoundCurve(geqResponse)
    if (state.selectedEqMethod === 'graphiceq') {
      updateActiveEqualizedCurve()
    }
  },

  toggleNormalizeAt1k() {
    setState('normalizeAt1k', prev => !prev)
  },

  toggleShowDelta() {
    setState('showDelta', prev => !prev)
  },

  setDeltaSecondaryCurve(id: string) {
    setState('deltaSecondaryCurveId', id)
  },

  openMicModal() {
    setState('isMicModalOpen', true)
  },

  closeMicModal() {
    setState('isMicModalOpen', false)
  },

  openExportModal() {
    setState('isExportModalOpen', true)
  },

  closeExportModal() {
    setState('isExportModalOpen', false)
  },

  setPlotSetting<K extends keyof PlotSettings>(key: K, value: PlotSettings[K]) {
    setState('plotSettings', key, value)
    scheduleSave()
  },

  togglePlotSetting(key: keyof PlotSettings) {
    setState('plotSettings', key, v => !v)
    scheduleSave()
  },

  setMicSetting<K extends keyof MicSettings>(key: K, value: MicSettings[K]) {
    setState('micSettings', key, value)
    scheduleSave()
  },

  setExportSetting<K extends keyof ExportSettings>(key: K, value: ExportSettings[K]) {
    setState('exportSettings', key, value)
    scheduleSave()
  },

  resetAllSettings() {
    clearAllPersistedData()
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  },

  toggleTheme() {
    const nextTheme = state.theme === 'dark' ? 'light' : 'dark'
    setState('theme', nextTheme)
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', nextTheme)
      localStorage.setItem('better_autoeq_theme', nextTheme)
    }
    scheduleSave()
  }
}

let saveDebounceTimer: any = null

export function scheduleSave() {
  if (typeof window === 'undefined') return
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer)
  saveDebounceTimer = setTimeout(() => {
    saveImmediate()
  }, 250)
}

export function saveImmediate() {
  if (typeof localStorage === 'undefined') return
  try {
    const configToSave: PersistedConfig = {
      version: 1,
      theme: state.theme,
      selectedTargetId: state.selectedTargetId,
      customTarget: state.customTarget,
      targetParams: { ...state.targetParams },
      globalSmoothing: state.globalSmoothing,
      normalizeAt1k: state.normalizeAt1k,
      showDelta: state.showDelta,
      deltaSecondaryCurveId: state.deltaSecondaryCurveId,
      activeReferenceCurveId: state.activeReferenceCurveId,
      maxFiltersCount: state.maxFiltersCount,
      selectedEqMethod: state.selectedEqMethod,
      firTaps: state.firTaps,
      firPhase: state.firPhase,
      firSampleRate: state.firSampleRate,
      graphicEqBandsCount: state.graphicEqBandsCount,
      overlayColors: { ...state.overlayColors },
      plotSettings: { ...state.plotSettings },
      micSettings: { ...state.micSettings },
      exportSettings: { ...state.exportSettings }
    }

    savePersistedConfig(configToSave)
    savePersistedCurves(state.curves)
    if (state.peqFilters && state.peqFilters.length > 0) {
      savePersistedPeq(state.peqFilters)
    }
  } catch (err) {
    console.warn('[Better-AutoEq] Error in saveImmediate:', err)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', saveImmediate)
  window.addEventListener('pagehide', saveImmediate)
}

// Reactively track changes across all persisted properties
createEffect(() => {
  void state.theme
  void state.selectedTargetId
  void state.customTarget
  void state.targetParams.bassBoostGain
  void state.targetParams.bassBoostFc
  void state.targetParams.trebleShelfGain
  void state.targetParams.trebleShelfFc
  void state.targetParams.trebleTilt
  void state.targetParams.maxBoost
  void state.targetParams.limitTrebleBoost
  void state.targetParams.hpfEnabled
  void state.targetParams.hpfFc
  void state.targetParams.lpfEnabled
  void state.targetParams.lpfFc
  void state.globalSmoothing
  void state.normalizeAt1k
  void state.showDelta
  void state.deltaSecondaryCurveId
  void state.activeReferenceCurveId
  void state.maxFiltersCount
  void state.selectedEqMethod
  void state.firTaps
  void state.firPhase
  void state.firSampleRate
  void state.graphicEqBandsCount
  void state.overlayColors.target
  void state.overlayColors.autoeq
  void state.overlayColors.equalized
  void state.overlayColors.delta
  void state.plotSettings.showTarget
  void state.plotSettings.showEqCurve
  void state.plotSettings.showEqualized
  void state.plotSettings.showGradient
  void state.plotSettings.useSpline
  void state.micSettings.calOffset
  void state.micSettings.fftSize
  void state.micSettings.compositeFft
  void state.micSettings.windowFunction
  void state.micSettings.rtaCurveColor
  void state.micSettings.selectedDeviceId
  void state.exportSettings.activeTab
  void state.exportSettings.sampleRate
  void state.exportSettings.bitDepth
  void state.exportSettings.taps
  void state.exportSettings.phaseMode
  void state.exportSettings.channelMode
  void state.exportSettings.normalizePeak

  for (const c of state.curves) {
    void c.id
    void c.name
    void c.color
    void c.visible
    void c.offsetDb
    void c.smoothing
  }

  scheduleSave()
})

// Initial calculation on load
recomputeAutoEq()

export { state }

