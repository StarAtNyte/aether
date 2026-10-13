/**
 * "Materialize" animation: when the agent builds or edits a world, new
 * entities grow out of the ground in a ripple that starts at the heart of
 * the scene and travels outward. It scales each entity's `content` group
 * only (never the entity transform, so physics, picking and the document
 * are untouched) and costs nothing once finished.
 *
 * Per-frame work is allocation-free: parallel arrays, swap-remove.
 */
import type { Object3D } from 'three';

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
export function easeOutBack(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** Ease-out cubic, 0 → 1. */
export function easeOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 3);
}

/** Stagger delay (s) of an entity at horizontal distance `distance` (m) from the ripple center. */
export function growDelay(distance: number): number {
  if (!Number.isFinite(distance) || distance <= 0) return 0;
  return Math.min(GROW_MAX_DELAY, (distance / GROW_RIPPLE_RADIUS) * GROW_MAX_DELAY);
}

/** Scale of a growing entity `elapsed` seconds after its wave started. */
export function growScale(elapsed: number, delay: number, overshoot: boolean): number {
  const t = (elapsed - delay) / GROW_DURATION;
  if (t <= 0) return MIN_SCALE;
  if (t >= 1) return 1;
  return Math.max(MIN_SCALE, overshoot ? easeOutBack(t) : easeOutCubic(t));
}

/** Drives the grow-in of many content groups. */
export class GrowIn {
  private readonly targets: Object3D[] = [];
  private readonly delays: number[] = [];
  private readonly overshoot: boolean[] = [];
  private readonly clocks: number[] = [];
  /** Targets hidden but not started yet (waiting for their geometry). */
  private readonly pending = new Set<Object3D>();
  private suspended = false;

  /** Number of entities currently animating or waiting. */
  get size(): number {
    return this.targets.length + this.pending.size;
  }

  /** True while anything animates (the renderer keeps drawing frames). */
  get active(): boolean {
    return this.targets.length > 0;
  }

  /** Hide `target` until {@link start} (call before its geometry streams in). */
  hide(target: Object3D): void {
    this.pending.add(target);
    setScale(target, MIN_SCALE);
  }

  /** Start growing `target` after `delay` seconds. `overshoot` adds a playful pop (small props). */
  start(target: Object3D, delay: number, overshoot: boolean): void {
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
  update(dt: number): boolean {
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const target = this.targets[i] as Object3D;
      // Removed from the scene (entity deleted / rebuilt): drop it.
      if (!target.parent) {
        this.removeAt(i);
        continue;
      }
      const clock = (this.clocks[i] as number) + step;
      this.clocks[i] = clock;
      const s = growScale(clock, this.delays[i] as number, this.overshoot[i] as boolean);
      if (!this.suspended) setScale(target, s);
      if (s === 1 && clock >= (this.delays[i] as number) + GROW_DURATION) this.removeAt(i);
    }
    return this.targets.length > 0;
  }

  /**
   * Run `fn` with every animating or pending target at full scale (for
   * bounds, framing and shadow fitting), then restore the animation state.
   */
  withFullScale<T>(fn: () => T): T {
    if (this.targets.length === 0 && this.pending.size === 0) return fn();
    this.suspended = true;
    for (const t of this.targets) setScale(t, 1);
    for (const t of this.pending) setScale(t, 1);
    try {
      return fn();
    } finally {
      this.suspended = false;
      for (let i = 0; i < this.targets.length; i++) {
        const t = this.targets[i] as Object3D;
        setScale(t, growScale(this.clocks[i] as number, this.delays[i] as number, this.overshoot[i] as boolean));
      }
      for (const t of this.pending) setScale(t, MIN_SCALE);
    }
  }

  /** Jump every animation to its end state. */
  finishAll(): void {
    for (const t of this.targets) setScale(t, 1);
    for (const t of this.pending) setScale(t, 1);
    this.targets.length = 0;
    this.delays.length = 0;
    this.overshoot.length = 0;
    this.clocks.length = 0;
    this.pending.clear();
  }

  private removeAt(i: number): void {
    const last = this.targets.length - 1;
    if (i !== last) {
      this.targets[i] = this.targets[last] as Object3D;
      this.delays[i] = this.delays[last] as number;
      this.overshoot[i] = this.overshoot[last] as boolean;
      this.clocks[i] = this.clocks[last] as number;
    }
    this.targets.pop();
    this.delays.pop();
    this.overshoot.pop();
    this.clocks.pop();
  }
}

function setScale(target: Object3D, s: number): void {
  target.scale.setScalar(s);
  target.updateMatrix();
}
