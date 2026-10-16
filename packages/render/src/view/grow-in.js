/** Grow duration of one entity in seconds. */
export const GROW_DURATION = 0.7;
/** Longest stagger delay in seconds (the outermost entities start this late). */
export const GROW_MAX_DELAY = 0.9;
/** Distance (m) from the ripple center at which the stagger delay reaches {@link GROW_MAX_DELAY}. */
export const GROW_RIPPLE_RADIUS = 60;
/** Entities larger than this (bounding radius, m) grow without overshoot (no bouncing mountains). */
export const GROW_OVERSHOOT_MAX_RADIUS = 12;
/** Smallest scale used while hidden (non-zero keeps matrices invertible). */
const MIN_SCALE = 1e-3;
/** Ease-out with a gentle overshoot ("pop"), 0 → 1. */
export function easeOutBack(t) {
    const x = Math.max(0, Math.min(1, t));
    const c1 = 1.4;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
/** Ease-out cubic, 0 → 1. */
export function easeOutCubic(t) {
    const x = Math.max(0, Math.min(1, t));
    return 1 - Math.pow(1 - x, 3);
}
/** Stagger delay (s) of an entity at horizontal distance `distance` (m) from the ripple center. */
export function growDelay(distance) {
    if (!Number.isFinite(distance) || distance <= 0)
        return 0;
    return Math.min(GROW_MAX_DELAY, (distance / GROW_RIPPLE_RADIUS) * GROW_MAX_DELAY);
}
/** Scale of a growing entity `elapsed` seconds after its wave started. */
export function growScale(elapsed, delay, overshoot) {
    const t = (elapsed - delay) / GROW_DURATION;
    if (t <= 0)
        return MIN_SCALE;
    if (t >= 1)
        return 1;
    return Math.max(MIN_SCALE, overshoot ? easeOutBack(t) : easeOutCubic(t));
}
/** Drives the grow-in of many content groups. */
export class GrowIn {
    targets = [];
    delays = [];
    overshoot = [];
    clocks = [];
    /** Targets hidden but not started yet (waiting for their geometry). */
    pending = new Set();
    suspended = false;
    /** Number of entities currently animating or waiting. */
    get size() {
        return this.targets.length + this.pending.size;
    }
    /** True while anything animates (the renderer keeps drawing frames). */
    get active() {
        return this.targets.length > 0;
    }
    /** Hide `target` until {@link start} (call before its geometry streams in). */
    hide(target) {
        this.pending.add(target);
        setScale(target, MIN_SCALE);
    }
    /** Start growing `target` after `delay` seconds. `overshoot` adds a playful pop (small props). */
    start(target, delay, overshoot) {
        this.pending.delete(target);
        const i = this.targets.indexOf(target);
        if (i >= 0) {
            this.delays[i] = delay;
            this.overshoot[i] = overshoot;
            this.clocks[i] = 0;
            return;
        }
        this.targets.push(target);
        this.delays.push(Math.max(0, delay));
        this.overshoot.push(overshoot);
        this.clocks.push(0);
        setScale(target, MIN_SCALE);
    }
    /** Advance every animation by `dt` seconds. Returns true while anything animates. Zero allocations. */
    update(dt) {
        const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
        for (let i = this.targets.length - 1; i >= 0; i--) {
            const target = this.targets[i];
            // Removed from the scene (entity deleted / rebuilt): drop it.
            if (!target.parent) {
                this.removeAt(i);
                continue;
            }
            const clock = this.clocks[i] + step;
            this.clocks[i] = clock;
            const s = growScale(clock, this.delays[i], this.overshoot[i]);
            if (!this.suspended)
                setScale(target, s);
            if (s === 1 && clock >= this.delays[i] + GROW_DURATION)
                this.removeAt(i);
        }
        return this.targets.length > 0;
    }
    /**
     * Run `fn` with every animating or pending target at full scale (for
     * bounds, framing and shadow fitting), then restore the animation state.
     */
    withFullScale(fn) {
        if (this.targets.length === 0 && this.pending.size === 0)
            return fn();
        this.suspended = true;
        for (const t of this.targets)
            setScale(t, 1);
        for (const t of this.pending)
            setScale(t, 1);
        try {
            return fn();
        }
        finally {
            this.suspended = false;
            for (let i = 0; i < this.targets.length; i++) {
                const t = this.targets[i];
                setScale(t, growScale(this.clocks[i], this.delays[i], this.overshoot[i]));
            }
            for (const t of this.pending)
                setScale(t, MIN_SCALE);
        }
    }
    /** Jump every animation to its end state. */
    finishAll() {
        for (const t of this.targets)
            setScale(t, 1);
        for (const t of this.pending)
            setScale(t, 1);
        this.targets.length = 0;
        this.delays.length = 0;
        this.overshoot.length = 0;
        this.clocks.length = 0;
        this.pending.clear();
    }
    removeAt(i) {
        const last = this.targets.length - 1;
        if (i !== last) {
            this.targets[i] = this.targets[last];
            this.delays[i] = this.delays[last];
            this.overshoot[i] = this.overshoot[last];
            this.clocks[i] = this.clocks[last];
        }
        this.targets.pop();
        this.delays.pop();
        this.overshoot.pop();
        this.clocks.pop();
    }
}
function setScale(target, s) {
    target.scale.setScalar(s);
    target.updateMatrix();
}
