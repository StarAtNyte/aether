/**
 * Frame timing statistics with exponential moving averages (no allocations).
 */

/** EMA smoothing factor per frame. */
const ALPHA = 0.08;

/** Smoothed FPS and CPU frame time. */
export class FrameStats {
  fps = 0;
  frameMs = 0;
  private primed = false;

  /** Record one frame: `dt` seconds since the previous frame and `cpuMs` spent rendering. */
  record(dt: number, cpuMs: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const fps = 1 / dt;
    const ms = Number.isFinite(cpuMs) && cpuMs >= 0 ? cpuMs : 0;
    if (!this.primed) {
      this.fps = fps;
      this.frameMs = ms;
      this.primed = true;
      return;
    }
    this.fps += (fps - this.fps) * ALPHA;
    this.frameMs += (ms - this.frameMs) * ALPHA;
  }
}
