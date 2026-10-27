/**
 * High-Precision WAV (RIFF WAVE) Audio Encoder
 * Supports 16-bit PCM, 24-bit PCM, and 32-bit IEEE Float (Mono and Stereo).
 */

export type BitDepth = 16 | 24 | 32
export type ChannelMode = 'mono' | 'stereo'

export interface WavEncodingOptions {
  sampleRate: number
  bitDepth: BitDepth
  channels: ChannelMode
}

/**
 * Encodes audio samples to a WAV binary buffer
 * @param samples Float64Array or Float32Array with values typically in [-1.0, +1.0]
 */
export function encodeWav(
  samples: Float64Array | Float32Array,
  options: WavEncodingOptions
): Uint8Array {
  const { sampleRate, bitDepth, channels } = options
  const numChannels = channels === 'stereo' ? 2 : 1
  const numSamples = samples.length
  const bytesPerSample = bitDepth / 8
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = numSamples * blockAlign

  // WAV format code: 1 = PCM integer, 3 = IEEE Float
  const formatCode = bitDepth === 32 ? 3 : 1

  // Header is 44 bytes for standard PCM / IEEE float
  const totalBufferSize = 44 + dataSize
  const buffer = new ArrayBuffer(totalBufferSize)
  const view = new DataView(buffer)

  // Write ASCII string helper
  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  // 1. RIFF Chunk Descriptor
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true) // ChunkSize = 36 + SubChunk2Size
  writeString(8, 'WAVE')

  // 2. "fmt " Subchunk
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)             // Subchunk1Size = 16
  view.setUint16(20, formatCode, true)     // AudioFormat: 1 = PCM, 3 = IEEE Float
  view.setUint16(22, numChannels, true)    // NumChannels
  view.setUint32(24, sampleRate, true)     // SampleRate
  view.setUint32(28, byteRate, true)       // ByteRate
  view.setUint16(32, blockAlign, true)     // BlockAlign
  view.setUint16(34, bitDepth, true)       // BitsPerSample

  // 3. "data" Subchunk
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  // 4. Sample data encoding
  let offset = 44

  if (bitDepth === 16) {
    for (let i = 0; i < numSamples; i++) {
      // Clamp between -1.0 and +1.0
      const clamped = Math.max(-1.0, Math.min(1.0, samples[i]))
      const val = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF
      const int16 = Math.round(val)

      view.setInt16(offset, int16, true)
      offset += 2

      if (numChannels === 2) {
        view.setInt16(offset, int16, true)
        offset += 2
      }
    }
  } else if (bitDepth === 24) {
    for (let i = 0; i < numSamples; i++) {
      const clamped = Math.max(-1.0, Math.min(1.0, samples[i]))
      const val = clamped < 0 ? clamped * 0x800000 : clamped * 0x7FFFFF
      const int24 = Math.round(val)

      // 3 bytes little endian
      const b0 = int24 & 0xFF
      const b1 = (int24 >> 8) & 0xFF
      const b2 = (int24 >> 16) & 0xFF

      view.setUint8(offset, b0)
      view.setUint8(offset + 1, b1)
      view.setUint8(offset + 2, b2)
      offset += 3

      if (numChannels === 2) {
        view.setUint8(offset, b0)
        view.setUint8(offset + 1, b1)
        view.setUint8(offset + 2, b2)
        offset += 3
      }
    }
  } else if (bitDepth === 32) {
    for (let i = 0; i < numSamples; i++) {
      const f32 = samples[i]
      view.setFloat32(offset, f32, true)
      offset += 4

      if (numChannels === 2) {
        view.setFloat32(offset, f32, true)
        offset += 4
      }
    }
  }

  return new Uint8Array(buffer)
}

/**
 * Initiates browser download of a WAV file
 */
export function downloadWavFile(
  wavData: Uint8Array,
  filename = 'AutoEq-Convolution-IR.wav'
) {
  const blob = new Blob([wavData.buffer as ArrayBuffer], { type: 'audio/wav' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
