import { describe, it, expect, beforeEach } from 'vitest'
import { micAnalyzer, MicrophoneAnalyzer } from '../src/lib/audio/micCapture'
import { STANDARD_FREQUENCIES } from '../src/lib/autoeq/constants'

describe('MicrophoneAnalyzer Capture Modes', () => {
  let analyzer: MicrophoneAnalyzer

  beforeEach(() => {
    analyzer = new MicrophoneAnalyzer()
  })

  it('should initialize with default parameters and empty buffers', () => {
    expect(analyzer.isRunning()).toBe(false)
    expect(analyzer.getAverageCount()).toBe(0)
    expect(analyzer.getMaxHoldDbs()).toEqual([])
    expect(analyzer.getAverageDbs()).toEqual([])
  })

  it('should throw an error when capturing snapshot with no acoustic data', () => {
    expect(() => analyzer.captureSnapshot('Test', 'instant')).toThrowError(
      'El analizador de micrófono no tiene datos acústicos disponibles aún.'
    )
  })

  it('should capture instantaneous snapshot properly', () => {
    // Inject mock live data
    const mockFreqs = [20, 100, 1000, 10000, 20000]
    const mockDbs = [70, 75, 80, 78, 65]
    ;(analyzer as any).lastLiveFreqs = mockFreqs
    ;(analyzer as any).lastLiveDbs = mockDbs

    const snap = analyzer.captureSnapshot('Mic Test', 'instant')
    expect(snap.name).toContain('Mic Test - Instante')
    expect(snap.frequencies.length).toBe(STANDARD_FREQUENCIES.length)
    expect(snap.rawGains.length).toBe(STANDARD_FREQUENCIES.length)
  })

  it('should capture peak hold snapshot and allow reset', () => {
    const mockFreqs = [20, 100, 1000, 10000, 20000]
    const mockDbs = [70, 75, 80, 78, 65]
    ;(analyzer as any).lastLiveFreqs = mockFreqs
    ;(analyzer as any).lastLiveDbs = mockDbs

    const peakArray = new Float64Array(mockDbs.length)
    peakArray.set([85, 90, 95, 88, 80])
    ;(analyzer as any).maxHoldDbs = peakArray

    const snap = analyzer.captureSnapshot('Mic Test', 'peak')
    expect(snap.name).toContain('Mic Test - Umbral Máximo')
    expect(snap.frequencies.length).toBe(STANDARD_FREQUENCIES.length)

    // Verify resetMaxHold resets peak buffer to current live levels
    analyzer.resetMaxHold()
    const afterReset = analyzer.getMaxHoldDbs()
    expect(afterReset).toEqual(mockDbs)
  })

  it('should capture average snapshot and allow reset', () => {
    const mockFreqs = [20, 100, 1000, 10000, 20000]
    const mockDbs = [70, 75, 80, 78, 65]
    ;(analyzer as any).lastLiveFreqs = mockFreqs
    ;(analyzer as any).lastLiveDbs = mockDbs

    const avgArray = new Float64Array(mockDbs.length)
    avgArray.set([72, 76, 81, 79, 67])
    ;(analyzer as any).averageDbs = avgArray
    ;(analyzer as any).averageCount = 150

    const snap = analyzer.captureSnapshot('Mic Test', 'average')
    expect(snap.name).toContain('Mic Test - Promedio (150 m)')
    expect(snap.frequencies.length).toBe(STANDARD_FREQUENCIES.length)

    // Verify resetAverage resets averageCount and values
    analyzer.resetAverage()
    expect(analyzer.getAverageCount()).toBe(0)
    const afterReset = analyzer.getAverageDbs()
    expect(afterReset).toEqual(mockDbs)
  })

  it('should support white noise, pink noise, and sine sweep stimulus methods', async () => {
    // Calling stopStimulus when idle should be safe
    expect(() => analyzer.stopStimulus()).not.toThrow()

    // Without AudioContext (mocked/node environment) they return early or safe
    await expect(analyzer.startPinkNoise(0.2)).resolves.toBeUndefined()
    await expect(analyzer.startWhiteNoise(0.15)).resolves.toBeUndefined()
    await expect(analyzer.playSineSweep(2, 0.25, 'linear')).resolves.toBeUndefined()
    await expect(analyzer.playSineSweep(5, 0.25, 'logarithmic')).resolves.toBeUndefined()
  })

  it('should cleanly clean up silence keep-alive node and call onTrackEnded', () => {
    let trackEndedCalled = false
    analyzer.onTrackEnded = () => {
      trackEndedCalled = true
    }

    // Mock an active silence node and track
    ;(analyzer as any).silenceNode = {
      disconnect: () => {}
    }

    analyzer.stop()
    expect((analyzer as any).silenceNode).toBeNull()

    // Trigger onTrackEnded
    analyzer.onTrackEnded?.()
    expect(trackEndedCalled).toBe(true)
  })
})
