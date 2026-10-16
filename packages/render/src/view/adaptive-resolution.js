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
    lowFps: 40,
    highFps: 56,
    minScale: 0.5,
    /** Multiplicative step per change. */
    step: 0.8,
    /** Seconds below `lowFps` before scaling down. */
    downAfter: 1.5,
    /** Seconds above `highFps` before trying to scale up again. */
    upAfter: 5,
    /** Longest wait before an upscale attempt after repeated failures (s). */
    maxUpAfter: 60,
    /** An upscale undone within this many seconds counts as failed (s). */
    failWindow: 8,
    /** Frame deltas above this break the "continuous" streak (s). */
    maxContinuousDt: 0.25,
});
/** Frame-time driven resolution scale controller. */
export class AdaptiveResolution {
    /** Current scale in [minScale, 1]. */
    scale = 1;
    /** Whether the controller may change the scale. */
    enabled = true;
    o;
    fps = 0;
    below = 0;
    above = 0;
    upWait;
    sinceUpscale = Number.POSITIVE_INFINITY;
    changes = 0;
    /** Ring of recent continuous frame times (s) and a scratch copy for the percentile. */
    window = new Float32Array(WINDOW);
    sorted = new Float32Array(WINDOW);
    cursor = 0;
    filled = 0;
    constructor(opts = {}) {
        this.o = { ...ADAPTIVE_DEFAULTS, ...opts };
        this.upWait = this.o.upAfter;
    }
    /** Number of scale changes so far (diagnostics). */
    get changeCount() {
        return this.changes;
    }
    /** Smoothed frame rate of the current continuous streak (0 when none). */
    /** Frame rate implied by the p90 frame time of the recent window (0 = no data). */
    get smoothedFps() {
        return this.fps;
    }
    /** 90th-percentile frame time of the window (allocation-free: typed-array sort of a scratch copy). */
    p90() {
        const n = this.filled;
        const s = this.sorted.subarray(0, n);
        for (let i = 0; i < n; i++)
            s[i] = this.window[i];
        s.sort();
        return s[Math.min(n - 1, Math.floor(n * 0.9))];
    }
    /**
     * Record one drawn frame. `dt` is the time since the previous drawn frame
     * (seconds); pass `continuous: false` when the previous animation frame
     * did not draw. Returns true when {@link scale} changed.
     */
    record(dt, continuous) {
        if (!this.enabled || !(dt > 0) || !Number.isFinite(dt))
            return false;
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
        if (this.filled < WINDOW)
            this.filled++;
        this.fps = 1 / this.p90();
        if (this.fps < this.o.lowFps) {
            this.below += dt;
            this.above = 0;
        }
        else if (this.fps > this.o.highFps) {
            this.above += dt;
            this.below = 0;
        }
        else {
            this.below = 0;
            this.above = 0;
        }
        if (this.below >= this.o.downAfter && this.scale > this.o.minScale) {
            if (this.sinceUpscale < this.o.failWindow)
                this.upWait = Math.min(this.o.maxUpAfter, this.upWait * 2);
            return this.set(Math.max(this.o.minScale, this.scale * this.o.step));
        }
        if (this.above >= this.upWait && this.scale < 1) {
            this.sinceUpscale = 0;
            return this.set(Math.min(1, this.scale / this.o.step));
        }
        return false;
    }
    /** Back to full scale (new renderer, budget change, user request). */
    reset() {
        this.scale = 1;
        this.fps = 0;
        this.filled = 0;
        this.below = 0;
        this.above = 0;
        this.upWait = this.o.upAfter;
        this.sinceUpscale = Number.POSITIVE_INFINITY;
    }
    set(next) {
        // Two decimals, like the pixel ratio itself.
        const rounded = Math.round(next * 100) / 100;
        this.below = 0;
        this.above = 0;
        this.fps = 0;
        this.filled = 0;
        if (rounded === this.scale)
            return false;
        this.scale = rounded;
        this.changes++;
        return true;
    }
}
