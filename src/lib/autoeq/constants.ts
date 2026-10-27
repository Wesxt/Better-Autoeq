// Frequency Response Constants and Standard Frequencies (20 Hz - 20,000 Hz)

export const DEFAULT_F_MIN = 20
export const DEFAULT_F_MAX = 20000
export const DEFAULT_STEP = 1.01 // ~695 points uniformly distributed in log space
export const DEFAULT_FS = 48000
export const DEFAULT_PREAMP = 0.0
export const PREAMP_HEADROOM = 0.2 // dB headroom to prevent inter-sample clipping

/**
 * Generate standard logarithmic frequency points: 20 * (step ** i) up to 20,000 Hz
 */
export function generateStandardFrequencies(fMin = DEFAULT_F_MIN, fMax = DEFAULT_F_MAX, step = DEFAULT_STEP): number[] {
  const frequencies: number[] = []
  let f = fMin
  while (f <= fMax) {
    frequencies.push(Math.round(f * 10) / 10)
    f *= step
  }
  if (frequencies[frequencies.length - 1] < fMax) {
    frequencies.push(fMax)
  }
  return frequencies
}

export const STANDARD_FREQUENCIES = generateStandardFrequencies()

/**
 * Standard 127 frequencies used by AutoEq and strictly required by the Android app Wavelet for custom GraphicEQ import.
 * Starts at 20 Hz and terminates at 19,871 Hz in exact integer log-spaced frequency points.
 */
export const WAVELET_GRAPHIC_EQ_FREQUENCIES: readonly number[] = [
  20, 21, 22, 23, 24, 26, 27, 29, 30, 32, 34, 36, 38, 40, 43, 45, 48, 50, 53, 56,
  59, 63, 66, 70, 74, 78, 83, 87, 92, 97, 103, 109, 115, 121, 128, 136, 143, 151,
  160, 169, 178, 188, 199, 210, 222, 235, 248, 262, 277, 292, 309, 326, 345, 364,
  385, 406, 429, 453, 479, 506, 534, 565, 596, 630, 665, 703, 743, 784, 829, 875,
  924, 977, 1032, 1090, 1151, 1216, 1284, 1357, 1433, 1514, 1599, 1689, 1784, 1885,
  1991, 2103, 2221, 2347, 2479, 2618, 2766, 2921, 3086, 3260, 3443, 3637, 3842, 4058,
  4287, 4528, 4783, 5052, 5337, 5637, 5955, 6290, 6644, 7018, 7414, 7831, 8272, 8738,
  9230, 9749, 10298, 10878, 11490, 12137, 12821, 13543, 14305, 15110, 15961, 16860,
  17809, 18812, 19871
]

/**
 * Built-in Target Curves (normalized around 1 kHz = 0 dB)
 */
export interface TargetCurveDefinition {
  id: string
  name: string
  description: string
  // Sparse control points [Hz, dB]
  points: [number, number][]
}

export const BUILT_IN_TARGETS: TargetCurveDefinition[] = [
  {
    id: 'harman-in-ear-2019',
    name: 'Harman In-Ear (2019v2)',
    description: 'Harman research target for in-ear monitors with sub-bass shelf and ear gain at ~3 kHz',
    points: [
      [20, 9.4], [30, 9.1], [40, 8.4], [50, 7.3], [60, 6.0], [80, 3.8], [100, 2.3],
      [150, 0.9], [200, 0.4], [500, 0.0], [1000, 0.0], [1500, 2.8], [2000, 6.4],
      [2700, 10.1], [3000, 10.4], [4000, 7.8], [5000, 4.4], [6000, 2.8], [7000, 1.9],
      [8000, 1.2], [10000, -1.0], [12000, -3.5], [15000, -5.5], [20000, -8.0]
    ]
  },
  {
    id: 'harman-over-ear-2018',
    name: 'Harman Over-Ear (2018)',
    description: 'Harman research target for over-ear headphones with 5 dB bass shelf and 3 kHz pinna compensation',
    points: [
      [20, 5.8], [30, 5.7], [40, 5.4], [50, 4.9], [70, 3.8], [100, 2.4], [150, 1.1],
      [200, 0.5], [500, 0.0], [1000, 0.0], [1500, 2.1], [2000, 4.8], [3000, 7.9],
      [3500, 7.2], [4000, 5.3], [5000, 3.1], [6000, 2.0], [8000, 0.5], [10000, -1.5],
      [12000, -4.0], [15000, -6.5], [20000, -10.0]
    ]
  },
  {
    id: 'ief-neutral-v2',
    name: 'Crinacle IEF Neutral v2',
    description: 'Neutral diffuse-field derived target with natural pinna gain and flat bass extension',
    points: [
      [20, 0.0], [50, 0.0], [100, 0.0], [200, 0.0], [500, 0.0], [1000, 0.0],
      [1500, 2.5], [2000, 5.5], [2700, 8.5], [3000, 8.8], [4000, 6.0], [5000, 3.0],
      [6000, 1.5], [8000, 0.0], [10000, -1.5], [12000, -3.0], [15000, -5.0], [20000, -8.0]
    ]
  },
  {
    id: 'diffuse-field',
    name: 'Diffuse Field (DF)',
    description: 'Classic diffuse field compensation curve representing equal energy from all directions',
    points: [
      [20, -1.5], [50, -1.0], [100, -0.5], [200, 0.0], [500, 0.0], [1000, 0.0],
      [1500, 2.0], [2000, 5.0], [3000, 11.5], [4000, 9.0], [5000, 5.0], [6000, 3.5],
      [8000, 4.0], [10000, 2.0], [12000, -1.0], [15000, -4.0], [20000, -9.0]
    ]
  },
  {
    id: 'free-field',
    name: 'Free Field (FF)',
    description: 'Free field sound incidence (direct frontal speaker simulation in anechoic environment)',
    points: [
      [20, 0.0], [50, 0.0], [100, 0.0], [200, 0.0], [500, 0.0], [1000, 0.0],
      [1500, 1.5], [2000, 3.5], [3000, 13.0], [4000, 8.5], [5000, 4.0], [6000, 2.0],
      [8000, 5.0], [10000, 3.0], [12000, 0.0], [15000, -3.0], [20000, -8.0]
    ]
  },
  {
    id: 'flat-target',
    name: 'Flat (0 dB Linear)',
    description: 'Completely flat target for speaker calibration or raw measurement deviation analysis',
    points: [
      [20, 0.0], [100, 0.0], [1000, 0.0], [10000, 0.0], [20000, 0.0]
    ]
  }
]
