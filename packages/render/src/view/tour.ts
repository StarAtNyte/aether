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

  /** Seconds at which each key is reached (null: the keys are evenly spaced in time). */
  private readonly times: Float64Array | null;

  /**
   * `times` (seconds from the start, one per key, rising) paces the keys: a long transit can take longer than a short
   * close-up arc. Without it the keys are evenly spaced over `duration`; with it the duration is the last key's time.
   */
  constructor(keys: readonly TourKey[], duration = TOUR_SECONDS, times?: readonly number[]) {
    const timed = times && times.length === keys.length && keys.length >= 2 && times.every((x, i) => Number.isFinite(x) && (i === 0 || x > (times[i - 1] as number)));
    this.times = timed ? Float64Array.from(times) : null;
    const total = timed ? (times[times.length - 1] as number) - (times[0] as number) : duration;
    this.duration = Math.max(1, Number.isFinite(total) ? total : TOUR_SECONDS);
    this.count = keys.length;
    this.data = new Float64Array(keys.length * 6);
    keys.forEach((k, i) => this.data.set([...k.pos, ...k.target], i * 6));
  }

  /** Total length (s). */
  get seconds(): number {
    return this.duration;
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
    // Timed keys: the eased time picks the segment and the share of it (stored as the key position over the whole loop).
    const times = this.times;
    if (times) {
      const n = this.count;
      const at = (times[0] as number) + (io[1] as number) * this.duration;
      let i = 0;
      while (i < n - 2 && at >= (times[i + 1] as number)) i++;
      const t0 = times[i] as number;
      const t1 = times[i + 1] as number;
      io[1] = (i + Math.min(1, Math.max(0, (at - t0) / (t1 - t0)))) / (n - 1);
    }
    this.place(camera.position, outTarget);
    if (camera.position.y < (io[3] as number)) camera.position.y = io[3] as number;
    _look.copy(outTarget);
    camera.lookAt(_look);
    return true;
  }
}

/** One part of a large scene worth a close look: the centre of a cluster of built pieces and its size. */
export interface TourSection {
  center: Vec3;
  /** Half the width of the cluster (m). */
  size: number;
  /** How much is there (sum of the pieces' volumes, relative); larger sections come first and get more time. */
  weight: number;
}

/** Content radius (m) from which a scene gets the drone tour (sections, close orbits, high transits) instead of one loop. */
export const DRONE_TOUR_RADIUS = 45;

/**
 * Sections of a scene from its pieces' boxes: greedy clusters of pieces within `reach` of a cluster's centre, the
 * heaviest kept (at most `max`). Pieces flatter than 1.5 m (paving, water, ground covers) do not make a section.
 */
export function tourSections(items: ReadonlyArray<{ min: Vec3; max: Vec3 }>, radius: number, max = 6): TourSection[] {
  const reach = Math.max(14, radius * 0.2);
  const pieces = items
    .map((b) => ({ c: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] as Vec3, h: b.max[1] - b.min[1], w: Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]), top: b.max[1] }))
    .filter((p) => p.h > 1.5 && p.w < radius * 1.2 && p.c.every(Number.isFinite))
    .map((p) => ({ ...p, v: p.h * Math.max(1, p.w) * Math.max(1, p.w) }))
    .sort((a, b) => b.v - a.v);
  const clusters: Array<{ sx: number; sy: number; sz: number; n: number; v: number; ext: number; c: Vec3 }> = [];
  for (const p of pieces) {
    let home = clusters.find((k) => Math.hypot(k.c[0] - p.c[0], k.c[2] - p.c[2]) < reach);
    if (!home) {
      home = { sx: 0, sy: 0, sz: 0, n: 0, v: 0, ext: 0, c: p.c };
      clusters.push(home);
    }
    home.sx += p.c[0] * p.v;
    home.sy += p.c[1] * p.v;
    home.sz += p.c[2] * p.v;
    home.n += p.v;
    home.v += p.v;
    home.c = [home.sx / home.n, home.sy / home.n, home.sz / home.n];
    home.ext = Math.max(home.ext, Math.hypot(home.c[0] - p.c[0], home.c[2] - p.c[2]) + p.w / 2);
  }
  return clusters
    .sort((a, b) => b.v - a.v)
    .slice(0, max)
    .map((k) => ({ center: k.c, size: Math.max(6, Math.min(reach * 1.2, k.ext)), weight: k.v }));
}

/** What the scene answers while the tour is planned: the ground height under a point, and whether a camera at `from` sees `to`. */
export interface TourProbe {
  ground(x: number, z: number): number;
  clear(from: Vec3, to: Vec3): boolean;
}

/**
 * A drone tour of a large scene: from the current view it rises to a reveal of the whole place, then for each section
 * glides in, arcs round it close up (a quarter turn, looking at it) and climbs out high toward the next, and finally returns
 * to the starting view. Keys keep a drone's clearance over the ground and are raised until they see what they look at.
 * Returns the keys and the time of each (seconds from the start), so transits move at a drone's pace and close orbits slow.
 */
export function droneTourKeys(from: TourKey, sections: readonly TourSection[], center: Vec3, radius: number, probe: TourProbe): { keys: TourKey[]; times: number[] } {
  const keys: TourKey[] = [from];
  const times: number[] = [0];
  let t = 0;
  let at: Vec3 = from.pos;
  const settle = (p: Vec3, target: Vec3, clearance: number): Vec3 => {
    const out: Vec3 = [p[0], Math.max(p[1], probe.ground(p[0], p[2]) + clearance), p[2]];
    for (let k = 0; k < 6 && !probe.clear(out, target); k++) out[1] += Math.max(4, clearance);
    return out;
  };
  const push = (pos: Vec3, target: Vec3, speed: number, minSeconds: number): void => {
    const d = Math.hypot(pos[0] - at[0], pos[1] - at[1], pos[2] - at[2]);
    t += Math.max(minSeconds, d / speed);
    keys.push({ pos, target });
    times.push(t);
    at = pos;
  };
  const R = Math.max(10, radius);
  const cruise = Math.max(9, R * 0.12);
  // Reveal: up and back from the start toward the whole place.
  const a0 = Math.atan2(from.pos[0] - center[0], from.pos[2] - center[2]);
  push(settle([center[0] + Math.sin(a0) * R * 1.25, center[1] + R * 0.55, center[2] + Math.cos(a0) * R * 1.25], center, R * 0.2), center, cruise, 4);
  // Sections in a short path from the reveal (nearest next).
  const left = [...sections];
  while (left.length > 0) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (Math.hypot(left[i]!.center[0] - at[0], left[i]!.center[2] - at[2]) < Math.hypot(left[bi]!.center[0] - at[0], left[bi]!.center[2] - at[2])) bi = i;
    const s = left.splice(bi, 1)[0]!;
    const c = s.center;
    const look: Vec3 = [c[0], c[1], c[2]];
    const close = Math.max(7, s.size * 1.25);
    const lift = Math.max(3, s.size * 0.35);
    // Come in along the line from where the drone is, then arc a quarter turn round the section.
    const aIn = Math.atan2(at[0] - c[0], at[2] - c[2]);
    const turn = Math.PI / 2 * (keys.length % 2 === 0 ? 1 : -1);
    push(settle([c[0] + Math.sin(aIn) * close * 2.2, c[1] + lift * 2.2, c[2] + Math.cos(aIn) * close * 2.2], look, 6), look, cruise, 3);
    for (const f of [0, 0.5, 1]) {
      const a = aIn + turn * f;
      push(settle([c[0] + Math.sin(a) * close, c[1] + lift, c[2] + Math.cos(a) * close], look, 2.5), look, Math.max(2.5, close * 0.18), 3.5);
    }
    // Climb out high, already turning toward what comes next.
    const next = left.length > 0 ? left[0]!.center : center;
    const aOut = aIn + turn;
    push(settle([c[0] + Math.sin(aOut) * close * 2, c[1] + Math.max(lift * 4, R * 0.25), c[2] + Math.cos(aOut) * close * 2], next, R * 0.12), [(c[0] + next[0]) / 2, (c[1] + next[1]) / 2, (c[2] + next[2]) / 2], cruise, 3);
  }
  push([...from.pos], [...from.target], cruise, 4);
  return { keys, times };
}

/** A title or tour shot looks at most this far (radians) below the horizon, and this far above it. */
export const TITLE_PITCH_DOWN = (30 * Math.PI) / 180;
export const TITLE_PITCH_UP = (6 * Math.PI) / 180;

/** The key with its look kept between `maxDown` below and `maxUp` above the horizon (same camera, same distance to the subject). */
export function composeKey(key: TourKey, maxDown: number, maxUp: number): TourKey {
  const dx = key.target[0] - key.pos[0];
  const dy = key.target[1] - key.pos[1];
  const dz = key.target[2] - key.pos[2];
  const horiz = Math.hypot(dx, dz);
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6 || horiz < 1e-6 || !Number.isFinite(dist)) return key;
  const pitch = Math.atan2(dy, horiz);
  const p = Math.min(maxUp, Math.max(-maxDown, pitch));
  if (p === pitch) return key;
  const ch = Math.cos(p) * dist;
  return { pos: key.pos, target: [key.pos[0] + (dx / horiz) * ch, key.pos[1] + Math.sin(p) * dist, key.pos[2] + (dz / horiz) * ch] };
}
