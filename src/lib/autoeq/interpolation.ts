/**
 * Logarithmic frequency interpolation
 * Interpolates [freq, gain] data onto target frequencies in log10(frequency) space.
 */

export function interpolateLog(
  srcFreqs: number[],
  srcGains: number[],
  targetFreqs: number[]
): number[] {
  if (srcFreqs.length === 0 || srcGains.length === 0) {
    return targetFreqs.map(() => 0)
  }

  if (srcFreqs.length === 1) {
    return targetFreqs.map(() => srcGains[0])
  }

  // Pre-calculate log10 of frequencies
  const logSrc = srcFreqs.map(f => Math.log10(Math.max(1, f)))
  const n = srcFreqs.length

  const result: number[] = new Array(targetFreqs.length)

  for (let j = 0; j < targetFreqs.length; j++) {
    const tf = Math.max(1, targetFreqs[j])
    const logT = Math.log10(tf)

    // Handle out of bounds
    if (logT <= logSrc[0]) {
      result[j] = srcGains[0]
      continue
    }
    if (logT >= logSrc[n - 1]) {
      result[j] = srcGains[n - 1]
      continue
    }

    // Binary search for interval [i, i+1]
    let low = 0
    let high = n - 1
    while (high - low > 1) {
      const mid = (low + high) >> 1
      if (logSrc[mid] <= logT) {
        low = mid
      } else {
        high = mid
      }
    }

    // Linear interpolation in log space
    const x0 = logSrc[low]
    const x1 = logSrc[high]
    const y0 = srcGains[low]
    const y1 = srcGains[high]
    const t = (logT - x0) / (x1 - x0)
    result[j] = y0 + t * (y1 - y0)
  }

  return result
}

/**
 * Natural / Monotonic cubic spline interpolation in log10(frequency) space
 * Provides smoother curves through sparse target points.
 */
export function interpolateCubicSpline(
  srcFreqs: number[],
  srcGains: number[],
  targetFreqs: number[]
): number[] {
  const n = srcFreqs.length
  if (n < 3) {
    return interpolateLog(srcFreqs, srcGains, targetFreqs)
  }

  const x = srcFreqs.map(f => Math.log10(Math.max(1, f)))
  const y = srcGains

  // Monotone cubic Hermite spline (Fritsch-Carlson algorithm) to prevent overshoot
  const dx = new Float64Array(n - 1)
  const m = new Float64Array(n - 1)
  for (let i = 0; i < n - 1; i++) {
    dx[i] = x[i + 1] - x[i]
    m[i] = (y[i + 1] - y[i]) / dx[i]
  }

  const d = new Float64Array(n)
  d[0] = m[0]
  d[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      d[i] = 0
    } else {
      d[i] = (m[i - 1] + m[i]) / 2
    }
  }

  // Adjust tangents to preserve monotonicity
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      d[i] = 0
      d[i + 1] = 0
    } else {
      const alpha = d[i] / m[i]
      const beta = d[i + 1] / m[i]
      const dist = alpha * alpha + beta * beta
      if (dist > 9) {
        const tau = 3 / Math.sqrt(dist)
        d[i] = tau * alpha * m[i]
        d[i + 1] = tau * beta * m[i]
      }
    }
  }

  const result: number[] = new Array(targetFreqs.length)

  for (let j = 0; j < targetFreqs.length; j++) {
    const tf = Math.max(1, targetFreqs[j])
    const xVal = Math.log10(tf)

    if (xVal <= x[0]) {
      result[j] = y[0]
      continue
    }
    if (xVal >= x[n - 1]) {
      result[j] = y[n - 1]
      continue
    }

    // Binary search
    let low = 0
    let high = n - 1
    while (high - low > 1) {
      const mid = (low + high) >> 1
      if (x[mid] <= xVal) {
        low = mid
      } else {
        high = mid
      }
    }

    const h = dx[low]
    const t = (xVal - x[low]) / h
    const t2 = t * t
    const t3 = t2 * t

    const h00 = 2 * t3 - 3 * t2 + 1
    const h10 = t3 - 2 * t2 + t
    const h01 = -2 * t3 + 3 * t2
    const h11 = t3 - t2

    result[j] = h00 * y[low] + h10 * h * d[low] + h01 * y[low + 1] + h11 * h * d[low + 1]
  }

  return result
}
