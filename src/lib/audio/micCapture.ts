import { STANDARD_FREQUENCIES } from '../autoeq/constants'
import { interpolateLog } from '../autoeq/interpolation'
import { computeFftMagnitudeDb, type WindowFunctionType } from './fft'

export interface MicCaptureState {
  isActive: boolean
  isRecordingSweep: boolean
  isStimulusPlaying: boolean
  stimulusType: 'pink-noise' | 'sine-sweep'
  fftSize: number
  calibrationOffset: number // dB offset to calibrate to SPL
  compositeFft: boolean
  windowFunction: WindowFunctionType
}

export class MicrophoneAnalyzer {
  private audioCtx: AudioContext | null = null
  private playbackCtx: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private analyserNode: AnalyserNode | null = null
  private stimulusSource: AudioNode | null = null
  private stimulusGain: GainNode | null = null
  private stimulusSplitter: ChannelSplitterNode | null = null
  private stimulusLeftGain: GainNode | null = null
  private stimulusRightGain: GainNode | null = null
  private stimulusMerger: ChannelMergerNode | null = null
  private stimulusAudioEl: HTMLAudioElement | null = null
  private stimulusBlobUrl: string | null = null
  private leftVolume = 0.8
  private rightVolume = 0.8
  private stimulusResolver: (() => void) | null = null
  private silenceNode: GainNode | null = null
  private keepAliveDest: MediaStreamAudioDestinationNode | null = null

  // Active Sine Sweep tracking for frequency-gated peak/average capture & glitch rejection
  private isSweepActive = false
  private sweepStartPerfTime = 0
  private sweepDurationSec = 5
  private sweepType: 'logarithmic' | 'linear' = 'logarithmic'
  private sweepFStart = 20
  private sweepFEnd = 20000

  // FFT read pacing to prevent WebAudio thread starvation on 120Hz/144Hz/240Hz displays
  private lastFftReadTime = 0
  private lowFftFrameToggle = false

  // Composite Multi-FFT (MTW) analyser nodes for specialized frequency bands
  private analyserLow: AnalyserNode | null = null // 16384 (bass resolution: 2.9 Hz/bin)
  private analyserMid: AnalyserNode | null = null // 4096 (mid resolution: 11.7 Hz/bin)
  private analyserHigh: AnalyserNode | null = null // 1024 (high speed: 46.9 Hz/bin)

  private fftBuffer: Float32Array<ArrayBuffer> | null = null
  private fftBufferLow: Float32Array<ArrayBuffer> | null = null
  private fftBufferMid: Float32Array<ArrayBuffer> | null = null
  private fftBufferHigh: Float32Array<ArrayBuffer> | null = null
  private timeBuffer: Float32Array<ArrayBuffer> | null = null

  // Transfer function tracking
  private referenceAnalyser: AnalyserNode | null = null
  private refFftBuffer: Float32Array<ArrayBuffer> | null = null
  private smoothedTransferFunction: Float64Array | null = null
  public enableLiveTransferFunction = false

  private smoothedSpectrum: Float64Array | null = null
  private animationFrameId: number | null = null

  // Max Hold (Umbral Máximo) & Average (Promedio Leq) tracking
  private maxHoldDbs: Float64Array | null = null
  private averagePowerSum: Float64Array | null = null
  private averageCount = 0
  private averageDbs: Float64Array | null = null

  // Background Noise Floor (Ruido de fondo) profiling & cancellation
  public noiseCancellationEnabled = false
  private isMeasuringNoiseFloor = false
  private noiseFloorStartTime = 0
  private noiseFloorDurationMs = 15000
  private noiseFloorPowerSum: Float64Array | null = null
  private noiseFloorCount = 0
  private noiseFloorProfile: Float64Array | null = null
  private noiseFloorAverageDb: number | null = null

  public onNoiseFloorProgress?: (elapsedSec: number, totalSec: number, percent: number) => void
  public onNoiseFloorComplete?: (averageNoiseDb: number) => void

  private onSpectrumUpdate?: (
    freqs: number[],
    dBs: number[],
    peakDb: number,
    maxHoldDbs: number[],
    averageDbs: number[],
    averageCount: number,
    tfDbs?: number[]
  ) => void

  public fftSize = 4096
  public compositeFft = false
  public windowFunction: WindowFunctionType = 'standard'
  public calibrationOffset = 100 // dB offset to translate dBFS to realistic ~70-90 dB SPL
  public smoothingAlpha = 0.75 // Smooth exponential moving average for RTA
  public temporalSmoothing = true
  public bandIntegration = true
  public selectedDeviceId: string | null = null
  public onTrackEnded?: () => void

  private micCalibration: { freqs: number[]; offsetsDb: number[] } | null = null

  // Cached last live spectrum for snapshot capture
  private lastLiveFreqs: number[] = []
  private lastLiveDbs: number[] = []

  constructor() {}

  public setCalibration(freqs: number[], gains: number[]): void {
    this.micCalibration = {
      freqs: [...freqs],
      offsetsDb: gains.map(g => -g) // Invert the gain to make it a corrective offset
    }
  }

  public clearCalibration(): void {
    this.micCalibration = null
  }

  public setTemporalSmoothing(enabled: boolean): void {
    this.temporalSmoothing = enabled
    if (this.analyserNode) {
      this.analyserNode.smoothingTimeConstant = enabled ? 0.2 : 0
    }
  }

  public setBandIntegration(enabled: boolean): void {
    this.bandIntegration = enabled
  }

  private getCalibrationOffsetAt(freq: number): number {
    if (!this.micCalibration || this.micCalibration.freqs.length === 0) return 0
    const { freqs, offsetsDb } = this.micCalibration
    if (freq <= freqs[0]) return offsetsDb[0]
    if (freq >= freqs[freqs.length - 1]) return offsetsDb[offsetsDb.length - 1]

    for (let i = 0; i < freqs.length - 1; i++) {
      if (freq >= freqs[i] && freq <= freqs[i + 1]) {
        const logF = Math.log10(freq)
        const logF0 = Math.log10(freqs[i])
        const logF1 = Math.log10(freqs[i + 1])
        const t = (logF - logF0) / (logF1 - logF0)
        return offsetsDb[i] + t * (offsetsDb[i + 1] - offsetsDb[i])
      }
    }
    return 0
  }

  public setReferenceAnalyser(analyser: AnalyserNode | null): void {
    this.referenceAnalyser = analyser
    if (analyser) {
      this.refFftBuffer = new Float32Array(analyser.frequencyBinCount)
    } else {
      this.refFftBuffer = null
    }
  }

  public isRunning(): boolean {
    return this.mediaStream !== null && this.mediaStream.active
  }

  /**
   * Cross-browser & mobile-safe wrapper for getUserMedia.
   * Handles modern navigator.mediaDevices.getUserMedia, legacy webkit/moz prefixes,
   * and detects insecure HTTP LAN origins on mobile where mediaDevices is undefined.
   */
  private requestUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      return navigator.mediaDevices.getUserMedia(constraints)
    }

    const navAny = navigator as unknown as {
      getUserMedia?: (
        c: MediaStreamConstraints,
        onSuccess: (s: MediaStream) => void,
        onError: (e: unknown) => void
      ) => void
      webkitGetUserMedia?: (
        c: MediaStreamConstraints,
        onSuccess: (s: MediaStream) => void,
        onError: (e: unknown) => void
      ) => void
      mozGetUserMedia?: (
        c: MediaStreamConstraints,
        onSuccess: (s: MediaStream) => void,
        onError: (e: unknown) => void
      ) => void
      msGetUserMedia?: (
        c: MediaStreamConstraints,
        onSuccess: (s: MediaStream) => void,
        onError: (e: unknown) => void
      ) => void
    }

    const legacyGetUserMedia =
      navAny?.getUserMedia ||
      navAny?.webkitGetUserMedia ||
      navAny?.mozGetUserMedia ||
      navAny?.msGetUserMedia

    if (typeof legacyGetUserMedia === 'function') {
      return new Promise<MediaStream>((resolve, reject) => {
        legacyGetUserMedia.call(navigator, constraints, resolve, reject)
      })
    }

    const isSecure = typeof window !== 'undefined' ? window.isSecureContext : true
    if (!isSecure) {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'http://...'
      const err = new Error(
        `El navegador móvil bloqueó la API del micrófono (navigator.mediaDevices es undefined) porque la conexión actual (${origin}) usa HTTP sin cifrar fuera de localhost.`
      )
      err.name = 'InsecureContextError'
      return Promise.reject(err)
    }

    const err = new Error(
      'Este navegador o WebView no soporta captura de audio mediante getUserMedia.'
    )
    err.name = 'MediaDevicesNotSupportedError'
    return Promise.reject(err)
  }

  /**
   * Requests a raw unprocessed microphone stream with progressive constraint fallbacks
   */
  private async acquireMicStream(deviceId: string | null): Promise<MediaStream> {
    const rawAudioConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      googEchoCancellation: false,
      googAutoGainControl: false,
      googAutoGainControl2: false,
      googNoiseSuppression: false,
      googHighpassFilter: false,
      googTypingNoiseDetection: false,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {})
    } as MediaTrackConstraints

    const isFatalError = (err: unknown): boolean => {
      const name = (err as { name?: string })?.name
      return (
        name === 'InsecureContextError' ||
        name === 'MediaDevicesNotSupportedError' ||
        name === 'NotAllowedError' ||
        name === 'PermissionDeniedError' ||
        name === 'SecurityError'
      )
    }

    try {
      return await this.requestUserMedia({ audio: rawAudioConstraints })
    } catch (err1) {
      if (isFatalError(err1)) throw err1
      try {
        return await this.requestUserMedia({
          audio: {
            deviceId: deviceId ? { ideal: deviceId } : undefined,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        })
      } catch (err2) {
        if (isFatalError(err2)) throw err2
        return await this.requestUserMedia({ audio: true })
      }
    }
  }

  /**
   * Enumerate available microphone input devices
   */
  public async getAudioDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return []
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      return devices.filter(d => d.kind === 'audioinput')
    } catch {
      return []
    }
  }

  /**
   * Dynamically switch input microphone without stopping the RTA analyser or clearing the plot
   */
  public async switchDevice(deviceId: string): Promise<void> {
    this.selectedDeviceId = deviceId

    if (!this.isRunning() || !this.audioCtx || !this.analyserNode) {
      return
    }

    const newStream = await this.acquireMicStream(deviceId)

    // Stop previous tracks and disconnect old source
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop())
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect()
    }

    // Attach new stream to existing analyser
    this.mediaStream = newStream
    this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream)
    this.sourceNode.connect(this.analyserNode)

    // Re-route through off-screen keep-alive node (never connect to audioCtx.destination)
    if (this.silenceNode) {
      try {
        this.sourceNode.connect(this.silenceNode)
      } catch (e) {
        console.warn('[micCapture] Could not reconnect silence node on device switch:', e)
      }
    }

    if (this.compositeFft) {
      this.setupCompositeNodes()
    }

    // Monitor track lifecycle on new stream
    const switchTracks = this.mediaStream.getAudioTracks()
    if (switchTracks.length > 0) {
      const track = switchTracks[0]
      track.onended = () => {
        console.warn('[micCapture] Audio track ended unexpectedly')
        if (this.onTrackEnded) {
          this.onTrackEnded()
        }
      }
      track.onmute = () => {
        console.warn('[micCapture] Audio track muted by OS or hardware')
      }
      track.onunmute = () => {
        console.log('[micCapture] Audio track unmuted')
      }
    }
  }

  public setFftSize(newSize: number): void {
    this.fftSize = newSize
    if (this.analyserNode) {
      try {
        this.analyserNode.fftSize = newSize
        this.fftBuffer = new Float32Array(this.analyserNode.frequencyBinCount)
        if (this.timeBuffer && this.timeBuffer.length !== newSize) {
          this.timeBuffer = new Float32Array(newSize)
        }
      } catch (e) {
        console.warn('Error cambiando fftSize:', e)
      }
    }
  }

  public setCompositeFft(enabled: boolean): void {
    this.compositeFft = enabled
    if (this.isRunning() && this.audioCtx && this.sourceNode) {
      if (enabled) {
        this.setupCompositeNodes()
      } else {
        this.teardownCompositeNodes()
      }
    }
  }

  public setWindowFunction(win: WindowFunctionType): void {
    this.windowFunction = win
    if (win !== 'standard' && this.fftSize) {
      if (!this.timeBuffer || this.timeBuffer.length !== this.fftSize) {
        this.timeBuffer = new Float32Array(this.fftSize)
      }
    }
  }

  private setupCompositeNodes(): void {
    if (!this.audioCtx || !this.sourceNode) return
    this.teardownCompositeNodes()

    try {
      this.analyserLow = this.audioCtx.createAnalyser()
      this.analyserLow.fftSize = 16384
      this.analyserLow.smoothingTimeConstant = 0.2
      this.fftBufferLow = new Float32Array(this.analyserLow.frequencyBinCount)

      this.analyserMid = this.audioCtx.createAnalyser()
      this.analyserMid.fftSize = 4096
      this.analyserMid.smoothingTimeConstant = 0.2
      this.fftBufferMid = new Float32Array(this.analyserMid.frequencyBinCount)

      this.analyserHigh = this.audioCtx.createAnalyser()
      this.analyserHigh.fftSize = 1024
      this.analyserHigh.smoothingTimeConstant = 0.2
      this.fftBufferHigh = new Float32Array(this.analyserHigh.frequencyBinCount)

      this.sourceNode.connect(this.analyserLow)
      this.sourceNode.connect(this.analyserMid)
      this.sourceNode.connect(this.analyserHigh)
    } catch (e) {
      console.warn('Composite nodes setup fallback:', e)
    }
  }

  private teardownCompositeNodes(): void {
    if (this.analyserLow && this.sourceNode) {
      try { this.sourceNode.disconnect(this.analyserLow) } catch {}
      this.analyserLow = null
    }
    if (this.analyserMid && this.sourceNode) {
      try { this.sourceNode.disconnect(this.analyserMid) } catch {}
      this.analyserMid = null
    }
    if (this.analyserHigh && this.sourceNode) {
      try { this.sourceNode.disconnect(this.analyserHigh) } catch {}
      this.analyserHigh = null
    }
    this.fftBufferLow = null
    this.fftBufferMid = null
    this.fftBufferHigh = null
  }

  public async start(
    onUpdate: (
      freqs: number[],
      dBs: number[],
      peakDb: number,
      maxHoldDbs: number[],
      averageDbs: number[],
      averageCount: number,
      tfDbs?: number[]
    ) => void
  ): Promise<void> {
    this.onSpectrumUpdate = onUpdate

    // 1. Create or resume AudioContext
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.audioCtx = new AudioCtxClass()
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume()
    }

    // 2. Request raw unprocessed microphone stream (disable all OS/Browser AEC, AGC, and Noise Suppression)
    this.mediaStream = await this.acquireMicStream(this.selectedDeviceId)

    // 3. Connect nodes
    this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream)
    this.analyserNode = this.audioCtx.createAnalyser()
    this.analyserNode.fftSize = this.fftSize
    this.analyserNode.minDecibels = -120
    this.analyserNode.maxDecibels = 0
    this.analyserNode.smoothingTimeConstant = this.temporalSmoothing ? 0.2 : 0

    this.sourceNode.connect(this.analyserNode)

    // Keep-alive routing via off-screen MediaStreamAudioDestinationNode:
    // CRITICAL: Never connect MediaStreamAudioSourceNode to audioCtx.destination!
    // Connecting mic input to audioCtx.destination forces Chromium's shared AudioRendererMixer
    // to synchronize the speaker DAC callback with the microphone capture FIFO clock, causing
    // periodic 128-sample dropouts ("golpeteos") during Sine Sweeps.
    // Routing into an off-screen createMediaStreamDestination() keeps the capture graph active
    // indefinitely without ever touching the physical speaker output mixer.
    try {
      this.silenceNode = this.audioCtx.createGain()
      this.silenceNode.gain.setValueAtTime(0, this.audioCtx.currentTime)
      this.keepAliveDest = this.audioCtx.createMediaStreamDestination()
      this.sourceNode.connect(this.silenceNode)
      this.silenceNode.connect(this.keepAliveDest)
    } catch (e) {
      console.warn('[micCapture] Could not attach off-screen keep-alive node:', e)
    }

    // AudioContext state watchdog: auto-resume if OS or browser suspends the audio context
    this.audioCtx.onstatechange = () => {
      if (this.isRunning() && this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {})
      }
    }

    // MediaStreamTrack lifecycle monitoring
    const tracks = this.mediaStream.getAudioTracks()
    if (tracks.length > 0) {
      const track = tracks[0]
      track.onended = () => {
        console.warn('[micCapture] Audio track ended by OS or device disconnect')
        if (this.onTrackEnded) {
          this.onTrackEnded()
        }
      }
      track.onmute = () => {
        console.warn('[micCapture] Audio track muted by OS or hardware')
      }
      track.onunmute = () => {
        console.log('[micCapture] Audio track unmuted')
      }
    }

    if (this.compositeFft) {
      this.setupCompositeNodes()
    }

    this.fftBuffer = new Float32Array(this.analyserNode.frequencyBinCount)
    if (!this.timeBuffer || this.timeBuffer.length !== this.fftSize) {
      this.timeBuffer = new Float32Array(this.fftSize)
    }

    // Number of log-spaced display bands across 20 Hz to 20,000 Hz
    const numDisplayBands = 240
    this.smoothedSpectrum = new Float64Array(numDisplayBands)
    this.smoothedSpectrum.fill(-120)

    this.smoothedTransferFunction = new Float64Array(numDisplayBands)
    this.smoothedTransferFunction.fill(0)

    this.maxHoldDbs = new Float64Array(numDisplayBands)
    this.maxHoldDbs.fill(0)

    this.averagePowerSum = new Float64Array(numDisplayBands)
    this.averagePowerSum.fill(0)
    this.averageCount = 0

    this.averageDbs = new Float64Array(numDisplayBands)
    this.averageDbs.fill(0)

    this.loop()
  }

  private loop = () => {
    if (!this.analyserNode || !this.fftBuffer || !this.audioCtx || !this.smoothedSpectrum) return

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {})
    }

    const nowPerf = performance.now()
    // Native monitor refresh rate pacing: allow up to 240+ FPS (3.5ms minimum frame time)
    // so 120Hz, 144Hz, 165Hz, and 240Hz displays run at full native fluidity
    if (nowPerf - this.lastFftReadTime < 3.5) {
      this.animationFrameId = requestAnimationFrame(this.loop)
      return
    }
    this.lastFftReadTime = nowPerf
    this.lowFftFrameToggle = !this.lowFftFrameToggle

    const fs = this.audioCtx.sampleRate

    // 1. Fill primary FFT buffer with native hardware data or custom windowed FFT
    // During compositeFft (when not sweeping), only native getFloatFrequencyData is needed for peak VU
    const useCustomWindow = this.windowFunction !== 'standard' && (!this.compositeFft || this.isSweepActive)
    if (useCustomWindow) {
      if (!this.timeBuffer || this.timeBuffer.length !== this.analyserNode.fftSize) {
        this.timeBuffer = new Float32Array(this.analyserNode.fftSize)
      }
      this.analyserNode.getFloatTimeDomainData(this.timeBuffer)
      computeFftMagnitudeDb(this.timeBuffer, this.windowFunction, this.fftBuffer)
    } else {
      this.analyserNode.getFloatFrequencyData(this.fftBuffer)
    }

    // 2. If composite FFT is active (and not in a moving Sine Sweep where 16384-pt 341ms latency causes crossover dips),
    // fill composite multi-resolution buffers
    const useCompositeNow = this.compositeFft && !this.isSweepActive && this.analyserLow && this.analyserMid && this.analyserHigh
    if (useCompositeNow) {
      if (this.fftBufferLow && this.lowFftFrameToggle) {
        this.analyserLow!.getFloatFrequencyData(this.fftBufferLow)
      }
      if (this.fftBufferMid) this.analyserMid!.getFloatFrequencyData(this.fftBufferMid)
      if (this.fftBufferHigh) this.analyserHigh!.getFloatFrequencyData(this.fftBufferHigh)
    }

    // Capture reference audio if live transfer function is enabled
    if (this.enableLiveTransferFunction && this.referenceAnalyser && this.refFftBuffer) {
      this.referenceAnalyser.getFloatFrequencyData(this.refFftBuffer)
    }

    const binCount = this.analyserNode.frequencyBinCount
    const primaryBinWidth = fs / this.analyserNode.fftSize

    // Calculate live peak input level in dBFS
    let peakDb = -120
    for (let i = 0; i < binCount; i++) {
      const v = this.fftBuffer[i]
      if (Number.isFinite(v) && v > peakDb) {
        peakDb = v
      }
    }

    // Helper to sample band power from an FFT buffer with sub-bin interpolation and sweep peak recovery
    const getBandPower = (buffer: Float32Array, bCount: number, bWidth: number, fLow: number, fHigh: number): number => {
      const fCenter = Math.sqrt(fLow * fHigh)
      const exactBin = fCenter / bWidth

      // When band integration is disabled (Raw FFT mode), sample the exact FFT bin directly without fractional-octave summing
      if (!this.bandIntegration && !this.isSweepActive) {
        const b = Math.max(1, Math.min(bCount - 1, Math.round(exactBin)))
        const raw = buffer[b]
        return Number.isFinite(raw) ? Math.max(-130, Math.min(0, raw)) : -130
      }

      const idxLow = Math.max(1, Math.min(bCount - 1, Math.floor(fLow / bWidth)))
      const idxHigh = Math.max(idxLow, Math.min(bCount - 1, Math.ceil(fHigh / bWidth)))

      // Narrowband / low-frequency interpolation between adjacent FFT bins
      if (fHigh - fLow <= bWidth * 1.35 || idxHigh <= idxLow + 1) {
        const b0 = Math.max(1, Math.min(bCount - 1, Math.floor(exactBin)))
        const b1 = Math.min(bCount - 1, b0 + 1)
        const frac = Math.max(0, Math.min(1, exactBin - b0))
        const raw0 = Number.isFinite(buffer[b0]) ? Math.max(-130, Math.min(0, buffer[b0])) : -130
        const raw1 = Number.isFinite(buffer[b1]) ? Math.max(-130, Math.min(0, buffer[b1])) : -130
        const interpDb = raw0 + frac * (raw1 - raw0)

        if (this.isSweepActive) {
          // Parabolic peak recovery on the stronger bin to prevent FFT scalloping dips between bin centers
          const kPeak = raw1 > raw0 ? b1 : b0
          const y0 = Number.isFinite(buffer[kPeak]) ? buffer[kPeak] : -130
          const yL = kPeak > 1 && Number.isFinite(buffer[kPeak - 1]) ? buffer[kPeak - 1] : y0
          const yR = kPeak < bCount - 1 && Number.isFinite(buffer[kPeak + 1]) ? buffer[kPeak + 1] : y0
          const denom = yL - 2 * y0 + yR
          let parabolicPeak = y0
          if (denom < -0.05) {
            const delta = 0.5 * (yL - yR) / denom
            if (Math.abs(delta) <= 0.65) {
              parabolicPeak = y0 - 0.25 * (yL - yR) * delta
            }
          }
          // Weight by proximity to exactBin so adjacent bins transition smoothly without stair-steps
          const dist = Math.abs(exactBin - kPeak)
          const windowWeight = Math.max(0, 1 - dist * 0.85)
          const blended = windowWeight * Math.min(0, parabolicPeak) + (1 - windowWeight) * interpDb
          return Math.max(-130, Math.min(0, Math.max(interpDb, blended)))
        }

        return Math.max(-130, Math.min(0, interpDb))
      }

      // Multi-bin band (mid/high frequencies)
      if (this.isSweepActive) {
        // For a pure sine sweep, extract the parabolic main-lobe peak within [idxLow, idxHigh]
        // so level is consistent with low frequencies and unaffected by band bin count
        let maxVal = -130
        let kMax = idxLow
        for (let k = idxLow; k <= idxHigh; k++) {
          const raw = buffer[k]
          if (Number.isFinite(raw) && raw > maxVal) {
            maxVal = raw
            kMax = k
          }
        }
        if (maxVal <= -130) return -130
        const yL = kMax > 1 && Number.isFinite(buffer[kMax - 1]) ? buffer[kMax - 1] : maxVal
        const yR = kMax < bCount - 1 && Number.isFinite(buffer[kMax + 1]) ? buffer[kMax + 1] : maxVal
        const denom = yL - 2 * maxVal + yR
        let peakEst = maxVal
        if (denom < -0.05) {
          const delta = 0.5 * (yL - yR) / denom
          if (Math.abs(delta) <= 0.65) {
            peakEst = maxVal - 0.25 * (yL - yR) * delta
          }
        }
        return Math.max(-130, Math.min(0, peakEst))
      }

      let sumPower = 0
      let validBins = 0
      for (let k = idxLow; k <= idxHigh; k++) {
        const raw = buffer[k]
        if (Number.isFinite(raw) && raw > -130) {
          sumPower += Math.pow(10, raw / 10)
          validBins++
        }
      }
      const val = validBins > 0 && sumPower > 0 ? 10 * Math.log10(sumPower) : -130
      return Math.max(-130, Math.min(0, val))
    }

    // Active Sine Sweep frequency gate computation
    let sweepElapsedSec = 0
    let fGateLow = 10
    let fGateHigh = 24000
    if (this.isSweepActive) {
      sweepElapsedSec = (nowPerf - this.sweepStartPerfTime) / 1000
      const getSweepFreqAt = (sec: number): number => {
        const u = Math.max(0, Math.min(1, sec / Math.max(0.1, this.sweepDurationSec)))
        return this.sweepType === 'linear'
          ? this.sweepFStart + (this.sweepFEnd - this.sweepFStart) * u
          : this.sweepFStart * Math.pow(this.sweepFEnd / this.sweepFStart, u)
      }
      // Account for output buffer latency, room acoustics, and low-frequency FFT window integration time
      fGateLow = getSweepFreqAt(sweepElapsedSec - 0.70) * 0.65
      fGateHigh = getSweepFreqAt(sweepElapsedSec + 0.16) * 1.42
    }

    const numPoints = this.smoothedSpectrum.length
    const logMin = Math.log10(20)
    const logMax = Math.log10(20000)
    const logStep = (logMax - logMin) / (numPoints - 1)

    const freqs: number[] = new Array(numPoints)
    const dBs: number[] = new Array(numPoints)

    this.averageCount++

    for (let p = 0; p < numPoints; p++) {
      const f = Math.pow(10, logMin + p * logStep)
      freqs[p] = f

      const fLow = Math.pow(10, logMin + (p - 0.5) * logStep)
      const fHigh = Math.pow(10, logMin + (p + 0.5) * logStep)

      let bandDb: number

      if (useCompositeNow && this.fftBufferLow && this.fftBufferMid && this.fftBufferHigh) {
        const binWidthLow = fs / 16384
        const binWidthMid = fs / 4096
        const binWidthHigh = fs / 1024

        // Multi-Time Window (MTW) blending
        if (f < 200) {
          bandDb = getBandPower(this.fftBufferLow, 8192, binWidthLow, fLow, fHigh)
        } else if (f < 300) {
          const t = (f - 200) / 100
          const weightMid = 0.5 - 0.5 * Math.cos(Math.PI * t)
          const dbLow = getBandPower(this.fftBufferLow, 8192, binWidthLow, fLow, fHigh)
          const dbMid = getBandPower(this.fftBufferMid, 2048, binWidthMid, fLow, fHigh)
          bandDb = (1 - weightMid) * dbLow + weightMid * dbMid
        } else if (f < 2000) {
          bandDb = getBandPower(this.fftBufferMid, 2048, binWidthMid, fLow, fHigh)
        } else if (f < 3000) {
          const t = (f - 2000) / 1000
          const weightHigh = 0.5 - 0.5 * Math.cos(Math.PI * t)
          const dbMid = getBandPower(this.fftBufferMid, 2048, binWidthMid, fLow, fHigh)
          const dbHigh = getBandPower(this.fftBufferHigh, 512, binWidthHigh, fLow, fHigh)
          bandDb = (1 - weightHigh) * dbMid + weightHigh * dbHigh
        } else {
          bandDb = getBandPower(this.fftBufferHigh, 512, binWidthHigh, fLow, fHigh)
        }
      } else {
        // Coherent single FFT (always used during Sine Sweeps to avoid MTW window-delay crossover steps)
        bandDb = getBandPower(this.fftBuffer, binCount, primaryBinWidth, fLow, fHigh)
      }

      // Apply calibration if loaded
      bandDb += this.getCalibrationOffsetAt(f)

      // Live transfer function tracking (Mic vs Reference)
      if (this.enableLiveTransferFunction && this.referenceAnalyser && this.refFftBuffer && this.smoothedTransferFunction) {
        const refBandDb = getBandPower(
          this.refFftBuffer,
          this.referenceAnalyser.frequencyBinCount,
          fs / this.referenceAnalyser.fftSize,
          fLow,
          fHigh
        )

        // Only compute TF if the reference signal has significant energy in this band
        if (refBandDb > -75) {
          // TF = Output (Mic) - Input (Ref)
          // (Note: we don't add calibrationOffset here, because it's relative)
          const instantTf = bandDb - refBandDb
          const alphaTf = 0.95 // slower moving average for TF stability
          this.smoothedTransferFunction[p] = this.smoothedTransferFunction[p] === 0
            ? instantTf
            : alphaTf * this.smoothedTransferFunction[p] + (1 - alphaTf) * instantTf
        }
      }

      const inSweepGate = !this.isSweepActive || (sweepElapsedSec >= -0.25 && f >= fGateLow && f <= fGateHigh)

      // Asymmetric exponential moving average smoothing:
      // Fast attack so moving sine sweeps don't lose peak amplitude or create jagged teeth; smooth release for visual stability
      if (this.isSweepActive) {
        if (inSweepGate && bandDb > this.smoothedSpectrum[p]) {
          // Fast attack inside active sweep window
          this.smoothedSpectrum[p] = 0.12 * this.smoothedSpectrum[p] + 0.88 * bandDb
        } else {
          // Smooth decay (and suppress out-of-band pops/clicks outside the sweep frequency gate)
          const targetDb = inSweepGate ? bandDb : Math.min(bandDb, this.smoothedSpectrum[p])
          this.smoothedSpectrum[p] = 0.82 * this.smoothedSpectrum[p] + 0.18 * targetDb
        }
      } else if (!this.temporalSmoothing) {
        // Zero temporal smoothing: 100% instantaneous raw frame value
        this.smoothedSpectrum[p] = bandDb
      } else {
        const alpha = bandDb > this.smoothedSpectrum[p]
          ? Math.min(0.45, this.smoothingAlpha * 0.6)
          : this.smoothingAlpha
        this.smoothedSpectrum[p] = alpha * this.smoothedSpectrum[p] + (1 - alpha) * bandDb
      }

      const liveSpl = this.smoothedSpectrum[p] + this.calibrationOffset
      let splClamped = Math.max(0, Math.min(130, Math.round(liveSpl * 10) / 10))

      // Accumulate raw acoustic power for background noise floor profiling
      if (this.isMeasuringNoiseFloor && this.noiseFloorPowerSum) {
        this.noiseFloorPowerSum[p] += Math.pow(10, splClamped / 10)
      }

      // Background noise cancellation via acoustic power spectral subtraction
      if (this.noiseCancellationEnabled && this.noiseFloorProfile && !this.isMeasuringNoiseFloor) {
        const noiseDb = this.noiseFloorProfile[p]
        if (noiseDb !== undefined) {
          const rawPower = Math.pow(10, splClamped / 10)
          const noisePower = Math.pow(10, noiseDb / 10)
          // P_clean = P_raw - P_noise (standard ISO/acoustics formula)
          if (rawPower > noisePower * 1.05) {
            const cleanPower = rawPower - noisePower
            const cleanDb = 10 * Math.log10(cleanPower)
            splClamped = Math.max(0, Math.min(130, Math.round(cleanDb * 10) / 10))
          } else {
            // Signal is at or below ambient room noise floor: attenuate down to eliminate background hum
            splClamped = Math.max(0, Math.min(130, Math.round((noiseDb - 15) * 10) / 10))
          }
        }
      }

      dBs[p] = splClamped

      // 1. Max Hold / Umbral Máximo (gated to active frequency window during Sine Sweep to reject out-of-band noise/pops)
      if (this.maxHoldDbs && inSweepGate) {
        if (this.maxHoldDbs[p] === 0 || splClamped > this.maxHoldDbs[p]) {
          this.maxHoldDbs[p] = splClamped
        }
      }

      // 2. Average / Promedio (RMS acoustic energy integration: Leq)
      if (this.averagePowerSum && this.averageDbs && inSweepGate) {
        const linearPower = Math.pow(10, splClamped / 10)
        this.averagePowerSum[p] += linearPower
        const meanPower = this.averagePowerSum[p] / this.averageCount
        const avgDb = 10 * Math.log10(Math.max(1e-12, meanPower))
        this.averageDbs[p] = Math.max(0, Math.min(130, Math.round(avgDb * 10) / 10))
      }
    }

    // Handle noise floor calibration timer and profile calculation
    if (this.isMeasuringNoiseFloor) {
      this.noiseFloorCount++
      const elapsedMs = performance.now() - this.noiseFloorStartTime
      const totalMs = this.noiseFloorDurationMs
      const elapsedSec = elapsedMs / 1000
      const totalSec = totalMs / 1000
      const percent = Math.min(100, Math.round((elapsedMs / totalMs) * 100))

      if (this.onNoiseFloorProgress) {
        this.onNoiseFloorProgress(elapsedSec, totalSec, percent)
      }

      if (elapsedMs >= totalMs) {
        this.isMeasuringNoiseFloor = false
        if (this.noiseFloorPowerSum && this.noiseFloorCount > 0) {
          this.noiseFloorProfile = new Float64Array(numPoints)
          let totalLinear = 0
          for (let i = 0; i < numPoints; i++) {
            const avgPow = this.noiseFloorPowerSum[i] / this.noiseFloorCount
            this.noiseFloorProfile[i] = 10 * Math.log10(Math.max(1e-12, avgPow))
            totalLinear += avgPow
          }
          this.noiseFloorAverageDb = Math.round((10 * Math.log10(Math.max(1e-12, totalLinear / numPoints))) * 10) / 10
          this.noiseCancellationEnabled = true
          if (this.onNoiseFloorComplete) {
            this.onNoiseFloorComplete(this.noiseFloorAverageDb)
          }
        }
      }
    }

    this.lastLiveFreqs = freqs
    this.lastLiveDbs = dBs

    const maxHoldArr = this.maxHoldDbs ? Array.from(this.maxHoldDbs) : dBs
    const averageArr = this.averageDbs ? Array.from(this.averageDbs) : dBs
    
    // Convert TF offset to standard +SPL mapping if it is active
    let tfArr: number[] | undefined
    if (this.enableLiveTransferFunction && this.smoothedTransferFunction) {
      tfArr = Array.from(this.smoothedTransferFunction).map(v => v === 0 ? -120 : v + this.calibrationOffset)
    }

    if (this.onSpectrumUpdate) {
      this.onSpectrumUpdate(freqs, dBs, peakDb, maxHoldArr, averageArr, this.averageCount, tfArr)
    }

    this.animationFrameId = requestAnimationFrame(this.loop)
  }

  /**
   * Resets the Peak Hold envelope to current values
   */
  public resetMaxHold(): void {
    if (this.maxHoldDbs && this.lastLiveDbs.length > 0) {
      for (let i = 0; i < this.maxHoldDbs.length; i++) {
        this.maxHoldDbs[i] = this.lastLiveDbs[i] ?? 0
      }
    } else if (this.maxHoldDbs) {
      this.maxHoldDbs.fill(0)
    }
  }

  /**
   * Resets the running energy average accumulator
   */
  public resetAverage(): void {
    this.averageCount = 0
    if (this.averagePowerSum) {
      this.averagePowerSum.fill(0)
    }
    if (this.averageDbs && this.lastLiveDbs.length > 0) {
      for (let i = 0; i < this.averageDbs.length; i++) {
        this.averageDbs[i] = this.lastLiveDbs[i] ?? 0
      }
    } else if (this.averageDbs) {
      this.averageDbs.fill(0)
    }
  }

  public getMaxHoldDbs(): number[] {
    return this.maxHoldDbs ? Array.from(this.maxHoldDbs) : []
  }

  public getAverageDbs(): number[] {
    return this.averageDbs ? Array.from(this.averageDbs) : []
  }

  public getAverageCount(): number {
    return this.averageCount
  }

  /**
   * Freezes and captures current spectrum as a standardized frequency response curve
   */
  public captureSnapshot(
    name = 'Medición Micrófono',
    mode: 'instant' | 'peak' | 'average' = 'instant'
  ): { name: string; frequencies: number[]; rawGains: number[] } {
    if (!this.lastLiveFreqs.length || !this.lastLiveDbs.length) {
      throw new Error('El analizador de micrófono no tiene datos acústicos disponibles aún.')
    }

    let sourceDbs: number[]
    let modeSuffix = 'Instante'

    if (mode === 'peak' && this.maxHoldDbs) {
      sourceDbs = Array.from(this.maxHoldDbs)
      modeSuffix = 'Umbral Máximo'
    } else if (mode === 'average' && this.averageDbs && this.averageCount > 0) {
      sourceDbs = Array.from(this.averageDbs)
      modeSuffix = `Promedio (${this.averageCount} m)`
    } else {
      sourceDbs = [...this.lastLiveDbs]
      modeSuffix = 'Instante'
    }

    // Interpolate onto standard log frequency grid (695 points from 20 Hz to 20,000 Hz)
    const standardGains = interpolateLog(this.lastLiveFreqs, sourceDbs, STANDARD_FREQUENCIES)
    const cleanGains = standardGains.map(g => Math.round((Number.isFinite(g) ? g : 70) * 10) / 10)

    const now = new Date()
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

    if (this.noiseCancellationEnabled && this.noiseFloorProfile) {
      modeSuffix += ' [Sin Ruido]'
    }

    return {
      name: `${name} - ${modeSuffix} (${timeStr})`,
      frequencies: [...STANDARD_FREQUENCIES],
      rawGains: cleanGains
    }
  }

  /**
   * Starts noise floor calibration. Measures ambient background noise for 10s to 30s.
   */
  public startNoiseFloorCalibration(durationSec = 15): void {
    const clampedSec = Math.max(10, Math.min(30, durationSec))
    this.stopStimulus()
    this.isMeasuringNoiseFloor = true
    this.noiseFloorStartTime = performance.now()
    this.noiseFloorDurationMs = clampedSec * 1000
    this.noiseFloorCount = 0
    const len = this.smoothedSpectrum ? this.smoothedSpectrum.length : 240
    this.noiseFloorPowerSum = new Float64Array(len)
  }

  public cancelNoiseFloorCalibration(): void {
    this.isMeasuringNoiseFloor = false
    this.noiseFloorPowerSum = null
    this.noiseFloorCount = 0
  }

  public clearNoiseFloorProfile(): void {
    this.noiseFloorProfile = null
    this.noiseFloorAverageDb = null
    this.noiseCancellationEnabled = false
    this.isMeasuringNoiseFloor = false
    this.noiseFloorPowerSum = null
    this.noiseFloorCount = 0
  }

  public isProfilingNoiseFloor(): boolean {
    return this.isMeasuringNoiseFloor
  }

  public hasNoiseFloorProfile(): boolean {
    return this.noiseFloorProfile !== null
  }

  public getNoiseFloorAverageDb(): number | null {
    return this.noiseFloorAverageDb
  }

  public getNoiseFloorProfile(): number[] | null {
    return this.noiseFloorProfile ? Array.from(this.noiseFloorProfile) : null
  }

  private async ensurePlaybackContext(): Promise<AudioContext | null> {
    if (typeof window === 'undefined') return null
    const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtxClass) return null
    if (!this.playbackCtx || this.playbackCtx.state === 'closed') {
      // Dedicated playback context with 'playback' latency hint prevents buffer underruns
      // and isolates speaker DAC clock from microphone capture FIFO clock drift
      this.playbackCtx = new AudioCtxClass({ latencyHint: 'playback' })
    }
    if (this.playbackCtx.state === 'suspended') {
      await this.playbackCtx.resume()
    }
    return this.playbackCtx
  }

  private connectStimulusToOutput(ctx: AudioContext, node: AudioNode, isStereo = false): void {
    const now = ctx.currentTime
    this.stimulusLeftGain = ctx.createGain()
    this.stimulusLeftGain.gain.setValueAtTime(this.leftVolume, now)
    this.stimulusRightGain = ctx.createGain()
    this.stimulusRightGain.gain.setValueAtTime(this.rightVolume, now)
    this.stimulusMerger = ctx.createChannelMerger(2)

    if (isStereo) {
      this.stimulusSplitter = ctx.createChannelSplitter(2)
      node.connect(this.stimulusSplitter)
      this.stimulusSplitter.connect(this.stimulusLeftGain, 0, 0)
      this.stimulusSplitter.connect(this.stimulusRightGain, 1, 0)
    } else {
      node.connect(this.stimulusLeftGain)
      node.connect(this.stimulusRightGain)
    }

    this.stimulusLeftGain.connect(this.stimulusMerger, 0, 0)
    this.stimulusRightGain.connect(this.stimulusMerger, 0, 1)
    this.stimulusMerger.connect(ctx.destination)
  }


  public setLeftVolume(v: number): void {
    this.leftVolume = Math.max(0, Math.min(1, v))
    if (this.playbackCtx && this.stimulusLeftGain) {
      this.stimulusLeftGain.gain.setTargetAtTime(this.leftVolume, this.playbackCtx.currentTime, 0.015)
    }
    if (this.stimulusAudioEl) {
      this.stimulusAudioEl.volume = Math.max(this.leftVolume, this.rightVolume)
    }
  }

  public getLeftVolume(): number {
    return this.leftVolume
  }

  public setRightVolume(v: number): void {
    this.rightVolume = Math.max(0, Math.min(1, v))
    if (this.playbackCtx && this.stimulusRightGain) {
      this.stimulusRightGain.gain.setTargetAtTime(this.rightVolume, this.playbackCtx.currentTime, 0.015)
    }
    if (this.stimulusAudioEl) {
      this.stimulusAudioEl.volume = Math.max(this.leftVolume, this.rightVolume)
    }
  }

  public getRightVolume(): number {
    return this.rightVolume
  }

  public setChannelVolumes(left: number, right: number): void {
    this.leftVolume = Math.max(0, Math.min(1, left))
    this.rightVolume = Math.max(0, Math.min(1, right))
    if (this.playbackCtx) {
      const now = this.playbackCtx.currentTime
      this.stimulusLeftGain?.gain.setTargetAtTime(this.leftVolume, now, 0.015)
      this.stimulusRightGain?.gain.setTargetAtTime(this.rightVolume, now, 0.015)
    }
    if (this.stimulusAudioEl) {
      this.stimulusAudioEl.volume = Math.max(this.leftVolume, this.rightVolume)
    }
  }

  /**
   * Encodes stereo Float32 Left/Right channels into an in-memory 32-bit IEEE Float WAV Blob
   * for hardware-buffered HTMLAudioElement playback (immune to 128-sample WebAudio thread glitches).
   */
  private createStereoFloatWavBlob(left: Float32Array, right: Float32Array, sampleRate: number): Blob {
    const numSamples = left.length
    const numChannels = 2
    const bytesPerSample = 4
    const dataBytes = numSamples * numChannels * bytesPerSample
    const buffer = new ArrayBuffer(44 + dataBytes)
    const view = new DataView(buffer)

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i))
      }
    }

    writeStr(0, 'RIFF')
    view.setUint32(4, 36 + dataBytes, true)
    writeStr(8, 'WAVE')
    writeStr(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 3, true) // 3 = IEEE 32-bit Float PCM
    view.setUint16(22, numChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true)
    view.setUint16(32, numChannels * bytesPerSample, true)
    view.setUint16(34, 32, true)
    writeStr(36, 'data')
    view.setUint32(40, dataBytes, true)

    const floatOut = new Float32Array(buffer, 44, numSamples * 2)
    for (let i = 0; i < numSamples; i++) {
      floatOut[i * 2] = left[i]
      floatOut[i * 2 + 1] = right[i]
    }

    return new Blob([buffer], { type: 'audio/wav' })
  }

  /**
   * Starts playing continuous Pink Noise stimulus for steady-state acoustic measurement.
   * Uses a 25-second decorrelated stereo AudioBuffer with fresh random seeds and Paul Kellet filter
   * to eliminate periodic repetition loops, predictability, and inter-channel comb filtering.
   */
  public async startPinkNoise(volume = 1.0): Promise<void> {
    this.stopStimulus()
    const ctx = await this.ensurePlaybackContext()
    if (!ctx) return

    const bufferSize = ctx.sampleRate * 25 // 25 seconds long decorrelated buffer
    const noiseBuffer = ctx.createBuffer(2, bufferSize, ctx.sampleRate)
    const left = noiseBuffer.getChannelData(0)
    const right = noiseBuffer.getChannelData(1)

    // Paul Kellet's 3-pole pinking filter with independent seeds for L & R (decorrelated stereo)
    let b0L = 0, b1L = 0, b2L = 0, b3L = 0, b4L = 0, b5L = 0, b6L = 0
    let b0R = 0, b1R = 0, b2R = 0, b3R = 0, b4R = 0, b5R = 0, b6R = 0
    let maxAbs = 0

    for (let i = 0; i < bufferSize; i++) {
      const wL = Math.random() * 2 - 1
      b0L = 0.99886 * b0L + wL * 0.0555179
      b1L = 0.99332 * b1L + wL * 0.0750759
      b2L = 0.96900 * b2L + wL * 0.1538520
      b3L = 0.86650 * b3L + wL * 0.3104856
      b4L = 0.55000 * b4L + wL * 0.5329522
      b5L = -0.7616 * b5L - wL * 0.0168980
      const sL = b0L + b1L + b2L + b3L + b4L + b5L + b6L + wL * 0.5362
      b6L = wL * 0.115926
      left[i] = sL
      const absL = Math.abs(sL)
      if (absL > maxAbs) maxAbs = absL

      const wR = Math.random() * 2 - 1
      b0R = 0.99886 * b0R + wR * 0.0555179
      b1R = 0.99332 * b1R + wR * 0.0750759
      b2R = 0.96900 * b2R + wR * 0.1538520
      b3R = 0.86650 * b3R + wR * 0.3104856
      b4R = 0.55000 * b4R + wR * 0.5329522
      b5R = -0.7616 * b5R - wR * 0.0168980
      const sR = b0R + b1R + b2R + b3R + b4R + b5R + b6R + wR * 0.5362
      b6R = wR * 0.115926
      right[i] = sR
      const absR = Math.abs(sR)
      if (absR > maxAbs) maxAbs = absR
    }

    // Peak normalize to 0.85 (-1.4 dBFS) to provide full, solid acoustic test level without DAC clipping
    if (maxAbs > 0) {
      const norm = 0.85 / maxAbs
      for (let i = 0; i < bufferSize; i++) {
        left[i] *= norm
        right[i] *= norm
      }
    }

    // 4096-sample cosine cross-fade at ends for seamless loop
    const fadeLen = Math.min(4096, Math.floor(bufferSize * 0.01))
    for (let i = 0; i < fadeLen; i++) {
      const w = 0.5 * (1 - Math.cos((Math.PI * i) / fadeLen))
      left[i] *= w
      left[bufferSize - 1 - i] *= w
      right[i] *= w
      right[bufferSize - 1 - i] *= w
    }

    const pinkNoise = ctx.createBufferSource()
    pinkNoise.buffer = noiseBuffer
    pinkNoise.loop = true

    const now = ctx.currentTime
    const targetGain = Math.max(0, Math.min(1.0, volume))
    this.stimulusGain = ctx.createGain()
    this.stimulusGain.gain.setValueAtTime(0, now)
    this.stimulusGain.gain.linearRampToValueAtTime(targetGain, now + 0.05)

    pinkNoise.connect(this.stimulusGain)
    this.connectStimulusToOutput(ctx, this.stimulusGain, true)

    pinkNoise.start(now)
    this.stimulusSource = pinkNoise
  }

  /**
   * Starts playing continuous White Noise stimulus (flat PSD across all frequencies).
   * Uses a 25-second decorrelated stereo AudioBuffer to eliminate repetition loops.
   */
  public async startWhiteNoise(volume = 1.0): Promise<void> {
    this.stopStimulus()
    const ctx = await this.ensurePlaybackContext()
    if (!ctx) return

    const bufferSize = ctx.sampleRate * 25 // 25 seconds long decorrelated buffer
    const noiseBuffer = ctx.createBuffer(2, bufferSize, ctx.sampleRate)
    const left = noiseBuffer.getChannelData(0)
    const right = noiseBuffer.getChannelData(1)

    for (let i = 0; i < bufferSize; i++) {
      left[i] = (Math.random() * 2 - 1) * 0.70
      right[i] = (Math.random() * 2 - 1) * 0.70
    }

    // 4096-sample cosine cross-fade at ends for seamless loop
    const fadeLen = Math.min(4096, Math.floor(bufferSize * 0.01))
    for (let i = 0; i < fadeLen; i++) {
      const w = 0.5 * (1 - Math.cos((Math.PI * i) / fadeLen))
      left[i] *= w
      left[bufferSize - 1 - i] *= w
      right[i] *= w
      right[bufferSize - 1 - i] *= w
    }

    const whiteNoise = ctx.createBufferSource()
    whiteNoise.buffer = noiseBuffer
    whiteNoise.loop = true

    const now = ctx.currentTime
    const targetGain = Math.max(0, Math.min(1.0, volume))
    this.stimulusGain = ctx.createGain()
    this.stimulusGain.gain.setValueAtTime(0, now)
    this.stimulusGain.gain.linearRampToValueAtTime(targetGain, now + 0.05)

    whiteNoise.connect(this.stimulusGain)
    this.connectStimulusToOutput(ctx, this.stimulusGain, true)

    whiteNoise.start(now)
    this.stimulusSource = whiteNoise
  }

  /**
   * Plays a pre-rendered 64-bit phase-continuous Sine Sweep (configurable fStart - fEnd up to 22,000 Hz)
   * via a hardware-buffered stereo WAV stream to eliminate WebAudio 128-sample quantum dropouts.
   */
  public async playSineSweep(
    durationSec = 5,
    volume = 1.0,
    type: 'logarithmic' | 'linear' = 'logarithmic',
    fStart = 20,
    fEnd = 20000
  ): Promise<void> {
    this.stopStimulus()
    if (typeof window === 'undefined' || typeof Audio === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return Promise.resolve()
    }

    const sampleRate = this.audioCtx?.sampleRate || 48000
    const startFreq = Math.max(10, Math.min(fStart, 22000))
    const endFreq = Math.min(22000, Math.max(startFreq + 10, fEnd), sampleRate * 0.48)

    // Pre-roll silence (100ms), smooth raised-cosine lead-in (300ms), main sweep, lead-out (200ms), post-roll silence (100ms)
    const preSilenceSec = 0.10
    const fadeInSec = Math.min(0.30, durationSec * 0.08)
    const sweepSec = Math.max(1, durationSec)
    const fadeOutSec = Math.min(0.20, durationSec * 0.06)
    const postSilenceSec = 0.10

    const totalSec = preSilenceSec + fadeInSec + sweepSec + fadeOutSec + postSilenceSec
    const totalSamples = Math.ceil(totalSec * sampleRate)
    const preSamples = Math.floor(preSilenceSec * sampleRate)
    const fadeInSamples = Math.floor(fadeInSec * sampleRate)
    const sweepSamples = Math.floor(sweepSec * sampleRate)
    const fadeOutSamples = Math.floor(fadeOutSec * sampleRate)

    const monoData = new Float32Array(totalSamples)

    // 64-bit continuous phase accumulation guarantees zero phase discontinuities
    let phase = 0.0
    const twoPiOverFs = (2.0 * Math.PI) / sampleRate
    const freqRatio = endFreq / startFreq
    // Direct volume control with peak 0.90 (-0.9 dBFS) to prevent DAC inter-sample clipping
    const safeAmplitude = Math.max(0.01, Math.min(0.90, volume * 0.90))

    // 1. Smooth raised-cosine fade-in lead-in (transitions from 0.85*startFreq to startFreq so envelope is 1.0 at fStart)
    const leadInStartFreq = Math.max(12, startFreq * 0.85)
    for (let i = 0; i < fadeInSamples; i++) {
      const u = i / Math.max(1, fadeInSamples)
      const freq = leadInStartFreq + (startFreq - leadInStartFreq) * u
      const env = 0.5 * (1.0 - Math.cos(Math.PI * u))
      monoData[preSamples + i] = Math.sin(phase) * env * safeAmplitude
      phase += twoPiOverFs * freq
      if (phase >= 2.0 * Math.PI) phase -= 2.0 * Math.PI
    }

    // 2. Main measurement sweep at 100% constant envelope amplitude across [startFreq, endFreq]
    const sweepOffset = preSamples + fadeInSamples
    for (let i = 0; i < sweepSamples; i++) {
      const u = i / Math.max(1, sweepSamples - 1)
      const freq = type === 'linear'
        ? startFreq + (endFreq - startFreq) * u
        : startFreq * Math.pow(freqRatio, u)
      monoData[sweepOffset + i] = Math.sin(phase) * safeAmplitude
      phase += twoPiOverFs * freq
      if (phase >= 2.0 * Math.PI) phase -= 2.0 * Math.PI
    }

    // 3. Smooth raised-cosine fade-out lead-out down to exact 0.0
    const fadeOutOffset = sweepOffset + sweepSamples
    for (let i = 0; i < fadeOutSamples; i++) {
      const u = i / Math.max(1, fadeOutSamples - 1)
      const env = 0.5 * (1.0 + Math.cos(Math.PI * u))
      monoData[fadeOutOffset + i] = Math.sin(phase) * env * safeAmplitude
      phase += twoPiOverFs * endFreq
      if (phase >= 2.0 * Math.PI) phase -= 2.0 * Math.PI
    }

    const maxChVol = Math.max(0.001, Math.max(this.leftVolume, this.rightVolume))
    const normL = this.leftVolume / maxChVol
    const normR = this.rightVolume / maxChVol
    const leftData = new Float32Array(totalSamples)
    const rightData = new Float32Array(totalSamples)
    for (let i = 0; i < totalSamples; i++) {
      const s = monoData[i]
      leftData[i] = s * normL
      rightData[i] = s * normR
    }

    const wavBlob = this.createStereoFloatWavBlob(leftData, rightData, sampleRate)
    const blobUrl = URL.createObjectURL(wavBlob)
    this.stimulusBlobUrl = blobUrl

    // Reset Max Hold & Average cleanly before sweep starts so pre-sweep noise doesn't contaminate the curve
    if (this.maxHoldDbs) {
      this.maxHoldDbs.fill(0)
    }
    this.averageCount = 0
    if (this.averagePowerSum) {
      this.averagePowerSum.fill(0)
    }
    if (this.averageDbs) {
      this.averageDbs.fill(0)
    }
    if (this.smoothedSpectrum) {
      this.smoothedSpectrum.fill(-120)
    }

    this.isSweepActive = true
    this.sweepStartPerfTime = performance.now() + (preSilenceSec + fadeInSec) * 1000
    this.sweepDurationSec = sweepSec
    this.sweepType = type
    this.sweepFStart = startFreq
    this.sweepFEnd = endFreq

    return new Promise((resolve) => {
      const audioEl = new Audio(blobUrl)
      audioEl.volume = Math.max(0, Math.min(1, Math.max(this.leftVolume, this.rightVolume)))
      this.stimulusAudioEl = audioEl

      this.stimulusResolver = () => {
        this.isSweepActive = false
        resolve()
      }

      audioEl.onplaying = () => {
        this.sweepStartPerfTime = performance.now() + (preSilenceSec + fadeInSec) * 1000
      }

      audioEl.onended = () => {
        this.isSweepActive = false
        // Light 3-point despike pass on maxHoldDbs to smooth any residual inter-bin ripple
        if (this.maxHoldDbs && this.maxHoldDbs.length > 4) {
          const copy = Float64Array.from(this.maxHoldDbs)
          for (let i = 1; i < copy.length - 1; i++) {
            if (copy[i] > 0 && copy[i - 1] > 0 && copy[i + 1] > 0) {
              this.maxHoldDbs[i] = Math.round((0.22 * copy[i - 1] + 0.56 * copy[i] + 0.22 * copy[i + 1]) * 10) / 10
            }
          }
        }
        this.stopStimulus()
        resolve()
      }

      audioEl.onerror = () => {
        this.isSweepActive = false
        this.stopStimulus()
        resolve()
      }

      audioEl.play().catch(() => {
        this.isSweepActive = false
        this.stopStimulus()
        resolve()
      })
    })
  }

  public stopStimulus(): void {
    this.isSweepActive = false
    if (this.stimulusResolver) {
      const res = this.stimulusResolver
      this.stimulusResolver = null
      res()
    }

    if (this.stimulusAudioEl) {
      const el = this.stimulusAudioEl
      this.stimulusAudioEl = null
      try {
        el.pause()
        el.src = ''
      } catch {}
    }

    if (this.stimulusBlobUrl) {
      const url = this.stimulusBlobUrl
      this.stimulusBlobUrl = null
      try {
        URL.revokeObjectURL(url)
      } catch {}
    }

    const oldSource = this.stimulusSource
    const oldGain = this.stimulusGain
    const oldSplitter = this.stimulusSplitter
    const oldLeft = this.stimulusLeftGain
    const oldRight = this.stimulusRightGain
    const oldMerger = this.stimulusMerger

    this.stimulusSource = null
    this.stimulusGain = null
    this.stimulusSplitter = null
    this.stimulusLeftGain = null
    this.stimulusRightGain = null
    this.stimulusMerger = null

    if (this.playbackCtx && this.playbackCtx.state === 'running' && oldGain && oldSource) {
      const now = this.playbackCtx.currentTime
      try {
        oldGain.gain.cancelScheduledValues(now)
        oldGain.gain.setValueAtTime(oldGain.gain.value, now)
        oldGain.gain.linearRampToValueAtTime(0, now + 0.03)
      } catch {}
      setTimeout(() => {
        try {
          if (typeof (oldSource as AudioScheduledSourceNode).stop === 'function') {
            (oldSource as AudioScheduledSourceNode).stop()
          }
        } catch {}
        try { oldSource.disconnect() } catch {}
        try { oldGain.disconnect() } catch {}
        try { oldSplitter?.disconnect() } catch {}
        try { oldLeft?.disconnect() } catch {}
        try { oldRight?.disconnect() } catch {}
        try { oldMerger?.disconnect() } catch {}
      }, 35)
    } else {
      if (oldSource) {
        try {
          if (typeof (oldSource as AudioScheduledSourceNode).stop === 'function') {
            (oldSource as AudioScheduledSourceNode).stop()
          }
        } catch {}
        try { oldSource.disconnect() } catch {}
      }
      try { oldGain?.disconnect() } catch {}
      try { oldSplitter?.disconnect() } catch {}
      try { oldLeft?.disconnect() } catch {}
      try { oldRight?.disconnect() } catch {}
      try { oldMerger?.disconnect() } catch {}
    }
  }

  public stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    this.cancelNoiseFloorCalibration()
    this.stopStimulus()
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop())
      this.mediaStream = null
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }
    if (this.silenceNode) {
      try {
        this.silenceNode.disconnect()
      } catch {}
      this.silenceNode = null
    }
    this.keepAliveDest = null
    this.teardownCompositeNodes()
    if (this.analyserNode) {
      this.analyserNode.disconnect()
      this.analyserNode = null
    }
    this.averageCount = 0
  }
}

export const micAnalyzer = new MicrophoneAnalyzer()
