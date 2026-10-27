import { describe, it, expect, beforeEach } from 'vitest'
import {
  CONFIG_STORAGE_KEY,
  CURVES_STORAGE_KEY,
  loadPersistedConfig,
  savePersistedConfig,
  loadPersistedCurves,
  savePersistedCurves,
  clearAllPersistedData,
  type PersistedConfig,
  DEFAULT_PLOT_SETTINGS,
  DEFAULT_MIC_SETTINGS,
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_OVERLAY_COLORS
} from '../src/lib/storage/localStorage'

if (typeof localStorage === 'undefined') {
  let store: Record<string, string> = {}
  const mockStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = String(val) },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
    key: (idx: number) => Object.keys(store)[idx] ?? null,
    get length() { return Object.keys(store).length }
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    writable: true
  })
}

describe('LocalStorage Persistence (localStorage.ts)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('should return null when nothing is stored', () => {
    expect(loadPersistedConfig()).toBeNull()
    expect(loadPersistedCurves()).toBeNull()
  })

  it('should safely save and load complete configuration', () => {
    const sampleConfig: PersistedConfig = {
      version: 1,
      theme: 'light',
      selectedTargetId: 'diffuse-field',
      customTarget: null,
      targetParams: {
        bassBoostGain: 4.5,
        bassBoostFc: 120,
        trebleTilt: -1.2,
        maxBoost: 9
      },
      globalSmoothing: '1/6',
      normalizeAt1k: true,
      showDelta: true,
      deltaSecondaryCurveId: 'curve-test-2',
      activeReferenceCurveId: 'curve-test-1',
      maxFiltersCount: 10,
      overlayColors: {
        target: '#FFFFFF',
        autoeq: 'oklab(0.72 -0.046 -0.100)',
        equalized: '#00ff88',
        delta: '#FF0000'
      },
      plotSettings: {
        showTarget: false,
        showEqCurve: true,
        showEqualized: true,
        showGradient: false,
        useSpline: true
      },
      micSettings: {
        calOffset: 95,
        fftSize: 8192,
        compositeFft: false,
        windowFunction: 'welch',
        rtaCurveColor: '#00FF88',
        maxHoldCurveColor: '#FF5500',
        averageCurveColor: '#00D4FF',
        selectedDeviceId: 'mic-device-123',
        captureMode: 'peak',
        sweepType: 'linear',
        sweepDuration: 10
      },
      exportSettings: {
        activeTab: 'eqapo',
        sampleRate: 96000,
        bitDepth: 32,
        taps: 32768,
        phaseMode: 'linear',
        channelMode: 'mono',
        normalizePeak: false
      }
    }

    const saved = savePersistedConfig(sampleConfig)
    expect(saved).toBe(true)

    const loaded = loadPersistedConfig()
    expect(loaded).toEqual(sampleConfig)
    expect(loaded?.theme).toBe('light')
    expect(loaded?.selectedTargetId).toBe('diffuse-field')
    expect(loaded?.targetParams?.bassBoostGain).toBe(4.5)
    expect(loaded?.plotSettings?.useSpline).toBe(true)
    expect(loaded?.micSettings?.windowFunction).toBe('welch')
    expect(loaded?.exportSettings?.sampleRate).toBe(96000)
  })

  it('should safely save and load curves', () => {
    const sampleCurves = [
      {
        id: 'c1',
        name: 'My Custom Headphone',
        color: '#FF0000',
        visible: true,
        frequencies: [20, 1000, 20000],
        rawGains: [5, 0, -3],
        smoothedGains: [5, 0, -3],
        smoothing: 'none' as const,
        offsetDb: 2
      }
    ]

    const saved = savePersistedCurves(sampleCurves)
    expect(saved).toBe(true)

    const loaded = loadPersistedCurves<typeof sampleCurves[0]>()
    expect(loaded).toHaveLength(1)
    expect(loaded?.[0].name).toBe('My Custom Headphone')
    expect(loaded?.[0].offsetDb).toBe(2)
    expect(loaded?.[0].color).toBe('#FF0000')
  })

  it('should handle corrupt JSON gracefully without crashing', () => {
    localStorage.setItem(CONFIG_STORAGE_KEY, '{invalid json corrupted!')
    localStorage.setItem(CURVES_STORAGE_KEY, '[not a real json')

    expect(loadPersistedConfig()).toBeNull()
    expect(loadPersistedCurves()).toBeNull()
  })

  it('should clear all persisted data when requested', () => {
    savePersistedConfig({
      version: 1,
      theme: 'dark',
      selectedTargetId: 'test',
      customTarget: null,
      targetParams: { bassBoostGain: 0, bassBoostFc: 105, trebleTilt: 0, maxBoost: 8 },
      globalSmoothing: 'none',
      normalizeAt1k: false,
      showDelta: false,
      deltaSecondaryCurveId: null,
      activeReferenceCurveId: null,
      maxFiltersCount: 7,
      overlayColors: DEFAULT_OVERLAY_COLORS,
      plotSettings: DEFAULT_PLOT_SETTINGS,
      micSettings: DEFAULT_MIC_SETTINGS,
      exportSettings: DEFAULT_EXPORT_SETTINGS
    })

    expect(loadPersistedConfig()).not.toBeNull()
    clearAllPersistedData()
    expect(loadPersistedConfig()).toBeNull()
  })
})
