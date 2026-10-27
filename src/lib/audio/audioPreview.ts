import type { BiquadFilterConfig } from '../autoeq/biquad'
import { PREAMP_HEADROOM } from '../autoeq/constants'

/** Audio source that feeds the real-time EQ chain */
export type PreviewSource = 'track' | 'white' | 'pink'

export interface PreviewState {
  isPlaying: boolean
  isBypassed: boolean
  source: PreviewSource
}

const NOISE_DURATION_S = 10 // Looped noise buffer length (long enough to avoid audible periodicity)
const NOISE_RMS_DBFS = -18 // Target RMS level for generated noise (leaves headroom for EQ boosts)
const PARAM_SMOOTHING_S = 0.015 // Time constant used to glide filter params (avoids zipper noise/clicks)

function mapFilterType(type: BiquadFilterConfig['type']): BiquadFilterType {
  switch (type) {
    case 'LSC': return 'lowshelf'
    case 'HSC': return 'highshelf'
    case 'HP': return 'highpass'
    case 'LP': return 'lowpass'
    case 'PK':
    default: return 'peaking'
  }
}

export class AudioPreviewEngine {
  private audioCtx: AudioContext | null = null
  private sourceNode: AudioBufferSourceNode | null = null
  private preampGainNode: GainNode | null = null
  private biquadNodes: BiquadFilterNode[] = []
  private stereoUpmixNode: GainNode | null = null
  private channelSplitterNode: ChannelSplitterNode | null = null
  private leftGainNode: GainNode | null = null
  private rightGainNode: GainNode | null = null
  private channelMergerNode: ChannelMergerNode | null = null
  private masterGainNode: GainNode | null = null
  private _referenceAnalyser: AnalyserNode | null = null

  /** User-loaded or synthesized music track */
  private trackBuffer: AudioBuffer | null = null
  /** Lazily generated noise buffers */
  private noiseBuffers: Partial<Record<'white' | 'pink', AudioBuffer>> = {}

  private source: PreviewSource = 'track'
  private isPlaying = false
  private isBypassed = false
  private startTime = 0
  private pauseOffset = 0
  private leftVolume = 0.8
  private rightVolume = 0.8

  /** Last filters received from the store (kept even before the AudioContext exists) */
  private currentFilters: BiquadFilterConfig[] = []
  private currentPreampLinear = 1

  private onStateChange?: (isPlaying: boolean, isBypassed: boolean, source: PreviewSource) => void
  private volumeListeners = new Set<(left: number, right: number) => void>()

  constructor() {}

  public setCallback(cb: (isPlaying: boolean, isBypassed: boolean, source: PreviewSource) => void) {
    this.onStateChange = cb
    this.notifyState()
  }

  public onVolumeChange(cb: (left: number, right: number) => void): () => void {
    this.volumeListeners.add(cb)
    cb(this.leftVolume, this.rightVolume)
    return () => {
      this.volumeListeners.delete(cb)
    }
  }

  private notifyVolumeChange() {
    for (const cb of this.volumeListeners) {
      cb(this.leftVolume, this.rightVolume)
    }
  }

  public get referenceAnalyser(): AnalyserNode | null {
    return this._referenceAnalyser
  }

  private initContext() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()

      // Upmix node ensures mono sources are duplicated across L and R before splitting
      this.stereoUpmixNode = this.audioCtx.createGain()
      this.stereoUpmixNode.channelCount = 2
      this.stereoUpmixNode.channelCountMode = 'explicit'
      this.stereoUpmixNode.channelInterpretation = 'speakers'

      this.channelSplitterNode = this.audioCtx.createChannelSplitter(2)
      this.leftGainNode = this.audioCtx.createGain()
      this.leftGainNode.gain.value = this.leftVolume
      this.rightGainNode = this.audioCtx.createGain()
      this.rightGainNode.gain.value = this.rightVolume
      this.channelMergerNode = this.audioCtx.createChannelMerger(2)

      this.masterGainNode = this.audioCtx.createGain()
      this.masterGainNode.gain.value = 1.0

      this._referenceAnalyser = this.audioCtx.createAnalyser()
      this._referenceAnalyser.fftSize = 4096
      this._referenceAnalyser.smoothingTimeConstant = 0.5

      this.stereoUpmixNode.connect(this.channelSplitterNode)
      this.channelSplitterNode.connect(this.leftGainNode, 0)
      this.channelSplitterNode.connect(this.rightGainNode, 1)
      this.leftGainNode.connect(this.channelMergerNode, 0, 0)
      this.rightGainNode.connect(this.channelMergerNode, 0, 1)
      this.channelMergerNode.connect(this.masterGainNode)
      this.masterGainNode.connect(this._referenceAnalyser)
      this._referenceAnalyser.connect(this.audioCtx.destination)

      this.preampGainNode = this.audioCtx.createGain()
      // Materialize any filters that arrived before the context was created
      this.rebuildFilterNodes()
    }
  }

  /**
   * Loads an audio file from an uploaded File or Blob
   */
  public async loadAudioFile(file: File | Blob): Promise<string> {
    this.initContext()
    if (!this.audioCtx) throw new Error('AudioContext unavailable')

    const arrayBuffer = await file.arrayBuffer()
    this.trackBuffer = await this.audioCtx.decodeAudioData(arrayBuffer)
    this.stop()
    this.source = 'track'
    this.notifyState()
    return 'name' in file ? (file as File).name : 'Custom Track'
  }

  /**
   * Generates a sample high-fidelity test groove (synth chords + bass) if no custom file is uploaded
   */
  public async loadDefaultSampleTrack(): Promise<void> {
    this.initContext()
    if (!this.audioCtx) return

    const sampleRate = this.audioCtx.sampleRate
    const duration = 8 // 8 seconds loop
    const buffer = this.audioCtx.createBuffer(2, sampleRate * duration, sampleRate)
    const left = buffer.getChannelData(0)
    const right = buffer.getChannelData(1)

    // Synthesize test track with rich spectral content across 30 Hz - 18 kHz
    for (let i = 0; i < buffer.length; i++) {
      const t = i / sampleRate
      const bassFreq = 65.4 // C2 ~65Hz
      const midFreq1 = 261.6 // C4
      const midFreq2 = 329.6 // E4
      const midFreq3 = 392.0 // G4

      // Sub-bass sine
      const bass = 0.3 * Math.sin(2 * Math.PI * bassFreq * t)
      // Warm chord pads with harmonics
      const pad = 0.15 * (
        Math.sin(2 * Math.PI * midFreq1 * t) +
        0.5 * Math.sin(2 * Math.PI * midFreq2 * t) +
        0.5 * Math.sin(2 * Math.PI * midFreq3 * t)
      )
      // High frequency sparkle / air
      const sparkle = 0.05 * Math.sin(2 * Math.PI * 7800 * t) * Math.sin(2 * Math.PI * 2 * t)

      const sample = (bass + pad + sparkle) * 0.7
      left[i] = sample
      right[i] = sample
    }

    this.trackBuffer = buffer
    this.pauseOffset = 0
  }

  /**
   * Generates a stereo (uncorrelated L/R) noise buffer normalized to NOISE_RMS_DBFS.
   * Pink noise uses Paul Kellet's refined filter (-3 dB/octave, accurate within ±0.05 dB above 9 Hz).
   */
  private generateNoise(kind: 'white' | 'pink'): AudioBuffer {
    const ctx = this.audioCtx!
    const sr = ctx.sampleRate
    const length = Math.floor(sr * NOISE_DURATION_S)
    const buffer = ctx.createBuffer(2, length, sr)
    const targetRms = Math.pow(10, NOISE_RMS_DBFS / 20)

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch)
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0

      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1
        if (kind === 'white') {
          data[i] = white
        } else {
          b0 = 0.99886 * b0 + white * 0.0555179
          b1 = 0.99332 * b1 + white * 0.0750759
          b2 = 0.96900 * b2 + white * 0.1538520
          b3 = 0.86650 * b3 + white * 0.3104856
          b4 = 0.55000 * b4 + white * 0.5329522
          b5 = -0.7616 * b5 - white * 0.0168980
          data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362
          b6 = white * 0.115926
        }
      }

      // Remove DC and normalize RMS
      let mean = 0
      for (let i = 0; i < length; i++) mean += data[i]
      mean /= length
      let sumSq = 0
      for (let i = 0; i < length; i++) {
        data[i] -= mean
        sumSq += data[i] * data[i]
      }
      const rms = Math.sqrt(sumSq / length) || 1
      const scale = targetRms / rms
      for (let i = 0; i < length; i++) data[i] *= scale

      // Short crossfade between end and start so the loop point is seamless
      const fade = Math.min(Math.floor(sr * 0.05), Math.floor(length / 4))
      for (let i = 0; i < fade; i++) {
        const w = i / fade
        data[i] = data[i] * w + data[length - fade + i] * (1 - w)
      }
    }
    return buffer
  }

  private getActiveBuffer(): AudioBuffer | null {
    if (this.source === 'track') return this.trackBuffer
    if (!this.noiseBuffers[this.source]) {
      this.noiseBuffers[this.source] = this.generateNoise(this.source)
    }
    return this.noiseBuffers[this.source]!
  }

  /**
   * Updates the Web Audio BiquadFilterNode chain to match current PEQ filters.
   * When the filter topology is unchanged, parameters glide smoothly without
   * reconnecting nodes so the EQ can be tweaked live without clicks.
   */
  public updateFilters(filters: BiquadFilterConfig[], compoundMaxGain = 0): void {
    this.currentFilters = filters.map(f => ({ ...f }))

    // Calculate preamp attenuation to avoid clipping
    const preampDb = compoundMaxGain > 0 ? -(compoundMaxGain + PREAMP_HEADROOM) : 0
    this.currentPreampLinear = Math.pow(10, preampDb / 20)

    if (!this.audioCtx) return

    const now = this.audioCtx.currentTime
    this.preampGainNode?.gain.setTargetAtTime(this.isBypassed ? 1.0 : this.currentPreampLinear, now, PARAM_SMOOTHING_S)

    const active = this.currentFilters.filter(f => f.enabled)
    const sameTopology =
      active.length === this.biquadNodes.length &&
      active.every((f, i) => this.biquadNodes[i].type === mapFilterType(f.type))

    if (sameTopology) {
      active.forEach((f, i) => {
        const node = this.biquadNodes[i]
        node.frequency.setTargetAtTime(f.fc, now, PARAM_SMOOTHING_S)
        node.gain.setTargetAtTime(f.gain, now, PARAM_SMOOTHING_S)
        node.Q.setTargetAtTime(f.q, now, PARAM_SMOOTHING_S)
      })
      return
    }

    this.rebuildFilterNodes()
    if (this.isPlaying && this.sourceNode) {
      this.connectChain()
    }
  }

  private rebuildFilterNodes(): void {
    if (!this.audioCtx) return
    this.biquadNodes.forEach(node => node.disconnect())
    this.biquadNodes = []

    const now = this.audioCtx.currentTime
    for (const f of this.currentFilters) {
      if (!f.enabled) continue
      const biquad = this.audioCtx.createBiquadFilter()
      biquad.type = mapFilterType(f.type)
      biquad.frequency.setValueAtTime(f.fc, now)
      biquad.gain.setValueAtTime(f.gain, now)
      biquad.Q.setValueAtTime(f.q, now)
      this.biquadNodes.push(biquad)
    }

    this.preampGainNode?.gain.setValueAtTime(this.isBypassed ? 1.0 : this.currentPreampLinear, now)
  }

  private connectChain(): void {
    if (!this.audioCtx || !this.sourceNode || !this.stereoUpmixNode || !this.preampGainNode) return

    // Disconnect everything upstream of stereo upmix / channel splitter
    this.sourceNode.disconnect()
    this.preampGainNode.disconnect()
    this.biquadNodes.forEach(n => n.disconnect())

    if (this.isBypassed || this.biquadNodes.length === 0) {
      // Direct bypass to stereo channel stage
      this.sourceNode.connect(this.stereoUpmixNode)
    } else {
      // Connect through preamp -> biquad cascade -> stereo channel stage
      this.preampGainNode.gain.setValueAtTime(this.currentPreampLinear, this.audioCtx.currentTime)
      this.sourceNode.connect(this.preampGainNode)
      let prevNode: AudioNode = this.preampGainNode
      for (const biquad of this.biquadNodes) {
        prevNode.connect(biquad)
        prevNode = biquad
      }
      prevNode.connect(this.stereoUpmixNode)
    }
  }

  public async play(): Promise<void> {
    this.initContext()
    if (!this.audioCtx) return

    if (this.source === 'track' && !this.trackBuffer) {
      await this.loadDefaultSampleTrack()
    }
    const buffer = this.getActiveBuffer()
    if (!buffer) return

    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume()
    }

    if (this.sourceNode) {
      try { this.sourceNode.stop() } catch { }
      this.sourceNode.disconnect()
    }

    this.sourceNode = this.audioCtx.createBufferSource()
    this.sourceNode.buffer = buffer
    this.sourceNode.loop = true

    this.connectChain()

    const offset = this.pauseOffset % buffer.duration
    this.sourceNode.start(0, offset)
    this.startTime = this.audioCtx.currentTime - offset
    this.isPlaying = true
    this.notifyState()
  }

  public pause(): void {
    if (!this.isPlaying || !this.audioCtx) return
    this.pauseOffset = (this.audioCtx.currentTime - this.startTime) % (this.sourceNode?.buffer?.duration || 1)
    if (this.sourceNode) {
      try { this.sourceNode.stop() } catch { }
      this.sourceNode.disconnect()
      this.sourceNode = null
    }
    this.isPlaying = false
    this.notifyState()
  }

  public stop(): void {
    this.pauseOffset = 0
    if (this.sourceNode) {
      try { this.sourceNode.stop() } catch { }
      this.sourceNode.disconnect()
      this.sourceNode = null
    }
    this.isPlaying = false
    this.notifyState()
  }

  /**
   * Switches the audio source (music track, white noise or pink noise).
   * Playback continues seamlessly through the EQ chain if it was already running.
   */
  public async setSource(source: PreviewSource): Promise<void> {
    if (source === this.source) return
    const wasPlaying = this.isPlaying
    this.stop()
    this.source = source
    this.notifyState()
    if (wasPlaying) await this.play()
  }

  public getSource(): PreviewSource {
    return this.source
  }

  /** Sets both Left and Right channel output volume (0..1) */
  public setVolume(v: number): void {
    this.setChannelVolumes(v, v)
  }

  public getVolume(): number {
    return (this.leftVolume + this.rightVolume) / 2
  }

  /** Sets the Left channel output volume (0..1) */
  public setLeftVolume(v: number): void {
    this.leftVolume = Math.max(0, Math.min(1, v))
    if (this.audioCtx && this.leftGainNode) {
      this.leftGainNode.gain.setTargetAtTime(this.leftVolume, this.audioCtx.currentTime, PARAM_SMOOTHING_S)
    }
    this.notifyVolumeChange()
  }

  public getLeftVolume(): number {
    return this.leftVolume
  }

  /** Sets the Right channel output volume (0..1) */
  public setRightVolume(v: number): void {
    this.rightVolume = Math.max(0, Math.min(1, v))
    if (this.audioCtx && this.rightGainNode) {
      this.rightGainNode.gain.setTargetAtTime(this.rightVolume, this.audioCtx.currentTime, PARAM_SMOOTHING_S)
    }
    this.notifyVolumeChange()
  }

  public getRightVolume(): number {
    return this.rightVolume
  }

  /** Sets both Left and Right channel output volumes simultaneously (0..1) */
  public setChannelVolumes(left: number, right: number): void {
    this.leftVolume = Math.max(0, Math.min(1, left))
    this.rightVolume = Math.max(0, Math.min(1, right))
    if (this.audioCtx) {
      const now = this.audioCtx.currentTime
      this.leftGainNode?.gain.setTargetAtTime(this.leftVolume, now, PARAM_SMOOTHING_S)
      this.rightGainNode?.gain.setTargetAtTime(this.rightVolume, now, PARAM_SMOOTHING_S)
    }
    this.notifyVolumeChange()
  }

  public toggleBypass(): boolean {
    this.isBypassed = !this.isBypassed
    if (this.isPlaying) {
      this.connectChain()
    }
    this.notifyState()
    return this.isBypassed
  }

  private notifyState() {
    if (this.onStateChange) {
      this.onStateChange(this.isPlaying, this.isBypassed, this.source)
    }
  }
}

export const audioPreview = new AudioPreviewEngine()
