/**
 * Adaptive resolution: lowers the drawing-buffer scale when continuous
 * rendering (play mode, camera flights, animated weather) stays below
 * {@link ADAPTIVE_DEFAULTS.lowFps}, and restores it when there is headroom.
 *
 * - Decisions use the 90th-percentile frame time of the last 48 frames, not
 *   the mean: a scene that averages 50 fps but stutters every few frames is
 *   treated as slow (p90 frame-time governor).
 * - Only back-to-back frames count (an on-demand editor that skips frames or
 *   a hidden tab never looks "slow").
 * - Hysteresis: downscale after `downAfter` seconds below `lowFps`; upscale
 *   only after `upAfter` seconds above `highFps`, and an upscale that has to
 *   be undone soon doubles the wait before the next attempt (no oscillation
 *   between two sizes, so the drawing buffer is not reallocated over and over).
 * - The scale multiplies the GPU budget's pixel ratio, so it never exceeds
 *   the budget (low-memory mode included); it only ever reduces it.
 *
 * Allocation-free per frame.
 */

/** Frames in the percentile window. */
const WINDOW = 48;

/** Tunables of {@link AdaptiveResolution}. */
export const ADAPTIVE_DEFAULTS = Object.freeze({
  lowFps: 50,
  highFps: 57,
  /** The frame rate a down step aims at: the pixel count (scale squared) follows the frame time, so the step is sqrt(fps / target). */
  targetFps: 58,
  minScale: 0.5,
  /** Largest multiplicative step per change (a frame rate just under `lowFps` takes this one). */
  step: 0.9,
  /** Smallest step: a very slow frame rate does not drop below this at once (the next step follows after `downAfter`). */
  minStep: 0.6,
  /** Seconds below `lowFps` before scaling down. */
  downAfter: 1,
  /** Seconds above `highFps` before trying to scale up again. */
  upAfter: 5,
  /** Longest wait before an upscale attempt after repeated failures (s). */
  maxUpAfter: 60,
  /** An upscale undone within this many seconds counts as failed (s). */
  failWindow: 8,
  /** Frame deltas above this break the "continuous" streak (s). */
  maxContinuousDt: 0.25,
});

/** Options of {@link AdaptiveResolution}. */
export type AdaptiveOptions = Partial<typeof ADAPTIVE_DEFAULTS>;

/** Frame-time driven resolution scale controller. */
export class AdaptiveResolution {
  /** Current scale in [minScale, 1]. */
  scale = 1;
  /** Whether the controller may change the scale. */
  enabled = true;
  /** The lowest scale in force (the options' `minScale` unless {@link setFloor} lowered it). */
  private floor: number;
  private readonly o: typeof ADAPTIVE_DEFAULTS;
  private fps = 0;
  private below = 0;
  private above = 0;
  private upWait: number;
  private sinceUpscale = Number.POSITIVE_INFINITY;
  private changes = 0;
  /** Ring of recent continuous frame times (s) and a scratch copy for the percentile. */
  private readonly window = new Float32Array(WINDOW);
  private readonly sorted = new Float32Array(WINDOW);
  private cursor = 0;
  private filled = 0;

  constructor(opts: AdaptiveOptions = {}) {
    this.o = { ...ADAPTIVE_DEFAULTS, ...opts };
    this.upWait = this.o.upAfter;
    this.floor = this.o.minScale;
  }

  /**
   * Lower (or restore, with no argument) the floor: a chain that upsamples with a sharpening step can go below the
   * option's `minScale`. A scale already below a restored floor is raised to it.
   */
  setFloor(floor: number = this.o.minScale): boolean {
    this.floor = Math.max(0.1, Math.min(1, floor));
    return this.scale < this.floor ? this.set(this.floor) : false;
  }

  /** Number of scale changes so far (diagnostics). */
  get changeCount(): number {
    return this.changes;
  }

  /** Smoothed frame rate of the current continuous streak (0 when none). */
  /** Frame rate implied by the p90 frame time of the recent window (0 = no data). */
  get smoothedFps(): number {
    return this.fps;
  }

  /** 90th-percentile frame time of the window (allocation-free: typed-array sort of a scratch copy). */
  private p90(): number {
    const n = this.filled;
    const s = this.sorted;
    for (let i = 0; i < n; i++) s[i] = this.window[i] as number;
    s.fill(Infinity, n);
    s.sort();
    return s[Math.min(n - 1, Math.floor(n * 0.9))] as number;
  }

  /**
   * Record one drawn frame. `dt` is the time since the previous drawn frame
   * (seconds); pass `continuous: false` when the previous animation frame
   * did not draw. Optional `gpuSeconds` is fresh GPU p90 for this exact size
   * and pipeline; clear headroom prevents CPU delays from reducing pixels.
   * Returns true when {@link scale} changed.
   */
  record(dt: number, continuous: boolean, gpuSeconds?: number): boolean {
    if (!this.enabled || !(dt > 0) || !Number.isFinite(dt)) return false;
    this.sinceUpscale += dt;
    if (!continuous || dt > this.o.maxContinuousDt) {
      this.fps = 0;
      this.filled = 0;
      this.below = 0;
      this.above = 0;
      return false;
    }
    this.window[this.cursor] = dt;
    this.cursor = (this.cursor + 1) % WINDOW;
    if (this.filled < WINDOW) this.filled++;
    this.fps = 1 / this.p90();
    // Clear GPU headroom means reducing pixels cannot fix the observed CPU delay.
    // Leave margin for the next upscale's extra pixels; absent evidence retains the old policy.
    const gpuHeadroom = gpuSeconds !== undefined && Number.isFinite(gpuSeconds) && gpuSeconds > 0 && gpuSeconds < .8 / this.o.targetFps;
    if (this.fps < this.o.lowFps && !gpuHeadroom) {
      this.below += dt;
      this.above = 0;
    } else if (this.fps > this.o.highFps || gpuHeadroom) {
      this.above += dt;
      this.below = 0;
    } else {
      this.below = 0;
      this.above = 0;
    }
    if (this.below >= this.o.downAfter && this.scale > this.floor) {
      if (this.sinceUpscale < this.o.failWindow) this.upWait = Math.min(this.o.maxUpAfter, this.upWait * 2);
      const factor = Math.max(this.o.minStep, Math.min(this.o.step, Math.sqrt(Math.max(this.fps, 1) / this.o.targetFps)));
      return this.set(Math.max(this.floor, this.scale * factor));
    }
    if (this.above >= this.upWait && this.scale < 1) {
      this.sinceUpscale = 0;
      return this.set(Math.min(1, this.scale / 0.8));
    }
    return false;
  }

  /** Back to full scale (new renderer, budget change, user request). */
  reset(): void {
    this.scale = 1;
    this.fps = 0;
    this.filled = 0;
    this.below = 0;
    this.above = 0;
    this.upWait = this.o.upAfter;
    this.sinceUpscale = Number.POSITIVE_INFINITY;
  }

  private set(next: number): boolean {
    // Two decimals, like the pixel ratio itself.
    const rounded = Math.round(next * 100) / 100;
    this.below = 0;
    this.above = 0;
    this.fps = 0;
    this.filled = 0;
    if (rounded === this.scale) return false;
    this.scale = rounded;
    this.changes++;
    return true;
  }
}
