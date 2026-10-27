/**
 * Universal Frequency Response Parser for .txt and .csv files.
 * Supports REW, Crinacle/Squiglink, AutoEq, Oratory1990, and standard delimited tables.
 */

export interface ParsedMeasurement {
  name: string
  frequencies: number[]
  rawGains: number[]
}

export function parseFrequencyResponseFile(
  content: string,
  fileName = 'Measurement'
): ParsedMeasurement {
  const lines = content.split(/\r?\n/)
  const rawPoints: { f: number; gain: number }[] = []

  // Clean filename for the measurement curve name
  const cleanName = fileName.replace(/\.[^/.]+$/, '').trim() || 'Measurement'

  let freqColIdx = -1
  let gainColIdx = -1

  for (let line of lines) {
    line = line.trim()
    if (!line) continue

    // Ignore comment lines
    if (line.startsWith('*') || line.startsWith('#') || line.startsWith('//')) {
      continue
    }

    // Determine delimiter: comma, tab, semicolon, or whitespace
    let parts: string[]
    if (line.includes(',')) {
      parts = line.split(',')
    } else if (line.includes('\t')) {
      parts = line.split('\t')
    } else if (line.includes(';')) {
      parts = line.split(';')
    } else {
      parts = line.split(/\s+/)
    }

    parts = parts.map(p => p.trim()).filter(p => p.length > 0)
    if (parts.length < 2) continue

    // Check if this is a header row
    const firstLower = parts[0].toLowerCase()
    if (firstLower.includes('freq') || firstLower.includes('hz')) {
      // Find column indices
      for (let i = 0; i < parts.length; i++) {
        const col = parts[i].toLowerCase()
        if (col.includes('freq') || col.includes('hz')) {
          freqColIdx = i
        } else if (col.includes('raw') || col.includes('spl') || col.includes('db') || col.includes('gain') || col.includes('mag')) {
          if (gainColIdx === -1) gainColIdx = i
        }
      }
      continue
    }

    const fIdx = freqColIdx !== -1 ? freqColIdx : 0
    const gIdx = gainColIdx !== -1 ? gainColIdx : 1

    const f = parseFloat(parts[fIdx])
    const gain = parseFloat(parts[gIdx])

    if (!isNaN(f) && !isNaN(gain) && f > 0) {
      rawPoints.push({ f, gain })
    }
  }

  if (rawPoints.length === 0) {
    throw new Error(`No valid frequency and dB data points found in "${fileName}".`)
  }

  // Sort ascending by frequency
  rawPoints.sort((a, b) => a.f - b.f)

  // Remove duplicate frequencies (keep first)
  const frequencies: number[] = []
  const rawGains: number[] = []
  let lastF = -1

  for (const pt of rawPoints) {
    if (Math.abs(pt.f - lastF) > 0.001) {
      frequencies.push(pt.f)
      rawGains.push(pt.gain)
      lastF = pt.f
    }
  }

  return {
    name: cleanName,
    frequencies,
    rawGains
  }
}
