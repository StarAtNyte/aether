/**
 * Camera director: a cinematic fly-through around the meaningful content.
 *
 * `tourKeys` composes a loop of camera keys around the content sphere —
 * sweeping low passes alternating with high reveals, each looking at the
 * centre or at a focus point — starting and ending at the current camera so
 * the tour begins and returns without a cut. `CameraTour` plays the keys on
 * a uniform Catmull-Rom spline (positions and look targets)
 * with an ease-in/ease-out timeline. Allocation-free per frame.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import type { Vec3 } from '@aether/core';

/** One camera key: where the camera is and what it looks at. */
export interface TourKey {
  pos: Vec3;
  target: Vec3;
}

/** Default tour length (s). */
export const TOUR_SECONDS = 26;

/**
 * Keys of a loop around `center` (content radius `radius`), beginning and
 * ending at the current camera pose. `focus` points (statues, set-pieces)
 * become look targets of the low passes. Never below `floorY`.
 */
export function tourKeys(from: TourKey, center: Vec3, radius: number, focus: readonly Vec3[] = [], floorY = 0.5): TourKey[] {
  const r = Math.max(2, Number.isFinite(radius) ? radius : 10);
  const start = Math.atan2(from.pos[0] - center[0], from.pos[2] - center[2]);
  const keys: TourKey[] = [from];
  const stops = 6;
  for (let i = 1; i <= stops; i++) {
    const a = start + (i / (stops + 1)) * Math.PI * 2;
    const low = i % 2 === 1;
    const dist = r * (low ? 0.75 : 1.55);
    const height = Math.max(floorY, center[1] + r * (low ? 0.12 : 0.65));
    const f = focus.length > 0 ? focus[(i - 1) % focus.length] : undefined;
    const target: Vec3 = low && f ? [f[0], f[1], f[2]] : [center[0], center[1] + r * (low ? 0.05 : 0.1), center[2]];
    keys.push({ pos: [center[0] + Math.sin(a) * dist, height, center[2] + Math.cos(a) * dist], target });
  }
  keys.push({ pos: [...from.pos], target: [...from.target] });
  return keys;
}

const _look = new Vector3();

/** Plays a key loop on a camera. */
export class CameraTour {
  private readonly duration: number;

  /** Keys packed as pos xyz + target xyz (typed: no boxed element loads per frame). */
  private readonly data: Float64Array;
  private readonly count: number;

  constructor(keys: readonly TourKey[], duration = TOUR_SECONDS) {
    this.duration = Math.max(1, Number.isFinite(duration) ? duration : TOUR_SECONDS);
    this.count = keys.length;
    this.data = new Float64Array(keys.length * 6);
    keys.forEach((k, i) => this.data.set([...k.pos, ...k.target], i * 6));
  }

  /** True until the last key is reached. */
  get active(): boolean {
    return (this.io[0] as number) < 1 && this.count >= 2;
  }

  /** Progress 0..1. */
  get progress(): number {
    return this.io[0] as number;
  }

  /**
   * Per-frame scalars in a typed array (doubles stored into object fields or
   * passed across calls get boxed): [t, eased, pending dt, floor y].
   */
  readonly io = Float64Array.from([0, 0, 0, Number.NEGATIVE_INFINITY]);

  /** Write the pose at the current eased progress into `pos` / `target`. */
  private place(pos: Vector3, target: Vector3): void {
    const n = this.count;
    const x = Math.min(0.999999, Math.max(0, this.io[1] as number)) * (n - 1);
    const i = x | 0;
    const f = x - i;
    const d = this.data;
    const a = Math.max(0, i - 1) * 6;
    const b = i * 6;
    const c = Math.min(n - 1, i + 1) * 6;
    const e = Math.min(n - 1, i + 2) * 6;
    // Catmull-Rom basis weights, inline (no calls taking or returning doubles: no boxing).
    const f2 = f * f;
    const f3 = f2 * f;
    const w0 = 0.5 * (-f + 2 * f2 - f3);
    const w1 = 0.5 * (2 - 5 * f2 + 3 * f3);
    const w2 = 0.5 * (f + 4 * f2 - 3 * f3);
    const w3 = 0.5 * (-f2 + f3);
    pos.x = w0 * (d[a] as number) + w1 * (d[b] as number) + w2 * (d[c] as number) + w3 * (d[e] as number);
    pos.y = w0 * (d[a + 1] as number) + w1 * (d[b + 1] as number) + w2 * (d[c + 1] as number) + w3 * (d[e + 1] as number);
    pos.z = w0 * (d[a + 2] as number) + w1 * (d[b + 2] as number) + w2 * (d[c + 2] as number) + w3 * (d[e + 2] as number);
    target.x = w0 * (d[a + 3] as number) + w1 * (d[b + 3] as number) + w2 * (d[c + 3] as number) + w3 * (d[e + 3] as number);
    target.y = w0 * (d[a + 4] as number) + w1 * (d[b + 4] as number) + w2 * (d[c + 4] as number) + w3 * (d[e + 4] as number);
    target.z = w0 * (d[a + 5] as number) + w1 * (d[b + 5] as number) + w2 * (d[c + 5] as number) + w3 * (d[e + 5] as number);
  }

  /**
   * Advance by `dt` seconds and place `camera`; `floorY` keeps it above the
   * ground. Returns the look target in `outTarget`. False once finished.
   */
  update(dt: number, camera: PerspectiveCamera, outTarget: Vector3, floorY = Number.NEGATIVE_INFINITY): boolean {
    this.io[2] = dt;
    this.io[3] = floorY;
    return this.step(camera, outTarget);
  }

  /** {@link update} with dt / floor taken from {@link io} (the allocation-free per-frame call). */
  step(camera: PerspectiveCamera, outTarget: Vector3): boolean {
    if (!this.active) return false;
    const io = this.io;
    const dt = io[2] as number;
    const t = Math.min(1, (io[0] as number) + Math.max(0, Number.isFinite(dt) ? dt : 0) / this.duration);
    io[0] = t;
    // Smooth start and stop over the whole loop.
    io[1] = t * t * (3 - 2 * t);
    this.place(camera.position, outTarget);
    if (camera.position.y < (io[3] as number)) camera.position.y = io[3] as number;
    _look.copy(outTarget);
    camera.lookAt(_look);
    return true;
  }
}
