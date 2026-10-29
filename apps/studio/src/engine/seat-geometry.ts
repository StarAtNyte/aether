/**
 * Pure helpers for sitting and standing: the real seat surface from a downward probe, a free exit point
 * chosen by testing candidates in front, beside and behind the seat, and the unstuck search that nudges a
 * player trapped in furniture to the nearest free ground.
 */
import type { Vec3 } from '@aether/core';

/** Plausible seat surface range above the floor (m): anything else is a backrest, an armrest or a table, not a cushion. */
const SEAT_MIN = 0.2;
const SEAT_MAX = 1.0;

/**
 * Seat surface height above the floor from a probe dropped on the seat. `hitYs` are the heights (world y) where the
 * downward ray met the seat piece, nearest first; the first one inside the plausible range is the cushion top.
 * Returns `fallback` when nothing plausible was hit (the kind's table height).
 */
export function seatTopFromHits(hitYs: readonly number[], floorY: number, fallback: number): number {
  for (const y of hitYs) {
    const h = y - floorY;
    if (Number.isFinite(h) && h >= SEAT_MIN && h <= SEAT_MAX) return h;
  }
  return fallback;
}

/**
 * Exit candidates around a seat, best first. `front` is the unit direction the person faces when leaving (the seat's
 * front), `from` the pelvis column on the floor. Front at growing reach, then the sides, then diagonals, then behind.
 */
export function exitCandidates(from: Readonly<Vec3>, frontX: number, frontZ: number, floorY: number, reaches: readonly number[] = [0.85, 1.15, 1.5]): Vec3[] {
  const len = Math.hypot(frontX, frontZ) || 1;
  const fx = frontX / len;
  const fz = frontZ / len;
  const dirs: Array<[number, number]> = [
    [fx, fz],
    [fx * 0.7 + fz * 0.7, fz * 0.7 - fx * 0.7],
    [fx * 0.7 - fz * 0.7, fz * 0.7 + fx * 0.7],
    [fz, -fx],
    [-fz, fx],
    [-fx * 0.7 + fz * 0.7, -fz * 0.7 - fx * 0.7],
    [-fx * 0.7 - fz * 0.7, -fz * 0.7 + fx * 0.7],
    [-fx, -fz],
  ];
  const out: Vec3[] = [];
  for (const r of reaches) for (const [dx, dz] of dirs) out.push([from[0] + dx * r, floorY + 0.02, from[2] + dz * r]);
  return out;
}

/** The first free candidate (front preferred), or null when every one is blocked. */
export function pickExit(candidates: readonly Vec3[], isFree: (p: Vec3) => boolean): Vec3 | null {
  for (const c of candidates) if (isFree(c)) return c;
  return null;
}

/**
 * The nearest free standing point to `p`: first straight up (out of a table or overlapping piece), then rings of
 * growing radius at the same height and lifted by up to `maxLift`. Null when nothing within `maxRadius` is free.
 */
export function nearestFree(p: Readonly<Vec3>, isFree: (p: Vec3) => boolean, maxRadius = 2, maxLift = 1): Vec3 | null {
  const lifts = [0, 0.1, 0.25, 0.5, 0.75, 1].filter((l) => l <= maxLift);
  for (const l of lifts) if (isFree([p[0], p[1] + l, p[2]])) return [p[0], p[1] + l, p[2]];
  for (let r = 0.3; r <= maxRadius + 1e-9; r += 0.3) {
    const n = Math.max(8, Math.round(r * 24));
    for (const l of lifts) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const q: Vec3 = [p[0] + Math.cos(a) * r, p[1] + l, p[2] + Math.sin(a) * r];
        if (isFree(q)) return q;
      }
    }
  }
  return null;
}

/** Tracks whether a player who is pushing to move is making progress; trips after `limit` seconds without it. */
export class StuckWatch {
  private t = 0;
  private ax = 0;
  private az = 0;
  private started = false;

  constructor(
    private readonly limit = 1,
    private readonly minProgress = 0.08,
  ) {}

  /** Feed one step; true when the player has pushed for `limit` seconds without moving `minProgress` metres. */
  update(x: number, z: number, wantsMove: boolean, dt: number): boolean {
    if (!wantsMove || !this.started) {
      this.reset(x, z);
      this.started = wantsMove;
      return false;
    }
    if (Math.hypot(x - this.ax, z - this.az) >= this.minProgress) {
      this.reset(x, z);
      return false;
    }
    this.t += dt;
    if (this.t < this.limit) return false;
    this.reset(x, z);
    return true;
  }

  private reset(x: number, z: number): void {
    this.t = 0;
    this.ax = x;
    this.az = z;
  }
}
