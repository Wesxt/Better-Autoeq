/**
 * Real-time FPS Meter for uPlot canvas rendering
 * Tracks frame timestamps and calculates smooth, accurate frames-per-second
 */
export class FpsMeter {
  private frameTimestamps: number[] = []
  private lastFps: number = 0
  private lastUpdateTime: number = performance.now()
  private updateIntervalMs: number = 250 // Refresh readout every 250ms for smooth reading
  private idleTimeoutMs: number = 400
  private onFpsUpdate?: (fps: number) => void
  private idleTimerId: number | null = null

  constructor(onFpsUpdate?: (fps: number) => void, updateIntervalMs = 250) {
    this.onFpsUpdate = onFpsUpdate
    this.updateIntervalMs = updateIntervalMs
  }

  /**
   * Register a rendered frame (called on uPlot draw/animation frame)
   */
  public tick(): void {
    const now = performance.now()
    this.frameTimestamps.push(now)

    // Keep timestamps from the last 1000ms
    const oneSecAgo = now - 1000
    while (this.frameTimestamps.length > 0 && this.frameTimestamps[0] < oneSecAgo) {
      this.frameTimestamps.shift()
    }

    if (now - this.lastUpdateTime >= this.updateIntervalMs) {
      this.calculateFps()
      this.lastUpdateTime = now
    }

    // Schedule idle check
    if (this.idleTimerId !== null) {
      window.clearTimeout(this.idleTimerId)
    }
    this.idleTimerId = window.setTimeout(() => {
      this.checkIdle()
    }, this.idleTimeoutMs)
  }

  /**
   * Check if the chart is currently idle (no frames drawn recently)
   */
  public checkIdle(): void {
    const now = performance.now()
    if (
      this.frameTimestamps.length === 0 ||
      now - this.frameTimestamps[this.frameTimestamps.length - 1] >= this.idleTimeoutMs
    ) {
      if (this.lastFps !== 0) {
        this.lastFps = 0
        this.frameTimestamps = []
        if (this.onFpsUpdate) {
          this.onFpsUpdate(0)
        }
      }
    }
  }

  private calculateFps(): void {
    if (this.frameTimestamps.length < 2) {
      this.lastFps = this.frameTimestamps.length
    } else {
      const timeSpan =
        (this.frameTimestamps[this.frameTimestamps.length - 1] - this.frameTimestamps[0]) / 1000
      if (timeSpan > 0) {
        const rawFps = (this.frameTimestamps.length - 1) / timeSpan
        this.lastFps = Math.round(rawFps * 10) / 10
      }
    }

    if (this.onFpsUpdate) {
      this.onFpsUpdate(this.lastFps)
    }
  }

  public getFps(): number {
    return this.lastFps
  }

  public reset(): void {
    if (this.idleTimerId !== null) {
      window.clearTimeout(this.idleTimerId)
      this.idleTimerId = null
    }
    this.frameTimestamps = []
    this.lastFps = 0
    if (this.onFpsUpdate) {
      this.onFpsUpdate(0)
    }
  }

  public destroy(): void {
    this.reset()
    this.onFpsUpdate = undefined
  }
}
