/**
 * Deterministic scatter placement shared by physics (and reusable by any
 * renderer that wants instances exactly where their colliders are).
 */
import type { ScatterShape, Vec3 } from '@aether/core';
import { rng } from '@aether/core';

/** One scatter instance in the scatter entity's local frame. */
export interface ScatterInstance {
  /** Local x/z; y = 0 unless projected onto a surface. */
  position: Vec3;
  /** Uniform scale factor. */
  scale: number;
  /** Rotation about Y in degrees. */
  yawDeg: number;
}

const MAX_SPACING_ATTEMPTS = 12;

/**
 * Compute instance transforms for a scatter shape. Same input → same output
 * on every platform (seeded sfc32). `minSpacing` is best effort: each instance
 * tries several candidates and keeps the first one far enough away, else the
 * one farthest from its neighbors. Cost O(count) using a
 * spatial hash.
 */
export function scatterInstances(shape: Pick<ScatterShape, 'count' | 'area' | 'seed' | 'scaleRange' | 'randomYaw' | 'minSpacing'> & Partial<Pick<ScatterShape, 'points'>>, maxCount = Infinity): ScatterInstance[] {
  if (shape.points) {
    // Hand-painted points: positions as stored; scale and yaw from the seeded stream (same as render).
    const random = rng(shape.seed ?? 1);
    const lo = Number.isFinite(shape.scaleRange?.[0]) ? (shape.scaleRange[0] as number) : 1;
    const hi = Number.isFinite(shape.scaleRange?.[1]) ? (shape.scaleRange[1] as number) : lo;
    const out: ScatterInstance[] = [];
    const n = Math.max(0, Math.min(shape.points.length, maxCount));
    for (let i = 0; i < n; i++) {
      const p = shape.points[i] as Vec3;
      const scale = Math.max(1e-3, lo + (hi - lo) * random());
      const yawDeg = shape.randomYaw === false ? 0 : random() * 360;
      out.push({ position: [p[0], p[1], p[2]], scale, yawDeg });
    }
    return out;
  }
  const count = Math.max(0, Math.min(Math.floor(shape.count), maxCount));
  const random = rng(shape.seed ?? 1);
  const w = Number.isFinite(shape.area[0]) ? Math.abs(shape.area[0]) : 0;
  const d = Number.isFinite(shape.area[1]) ? Math.abs(shape.area[1]) : 0;
  const lo = Number.isFinite(shape.scaleRange?.[0]) ? (shape.scaleRange[0] as number) : 1;
  const hi = Number.isFinite(shape.scaleRange?.[1]) ? (shape.scaleRange[1] as number) : lo;
  const spacing = shape.minSpacing && shape.minSpacing > 0 ? shape.minSpacing : 0;
  const cell = spacing > 0 ? spacing : 1;
  const grid = new Map<string, Array<[number, number]>>();
  /** Squared distance to the nearest accepted instance (capped at spacing²). */
  const nearest2 = (x: number, z: number): number => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    let best = spacing * spacing;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const bucket = grid.get(`${cx + i},${cz + j}`);
        if (!bucket) continue;
        for (const [px, pz] of bucket) best = Math.min(best, (px - x) ** 2 + (pz - z) ** 2);
      }
    }
    return best;
  };
  const out: ScatterInstance[] = [];
  for (let i = 0; i < count; i++) {
    // Best-candidate sampling: keep the first candidate that is far enough, else the farthest one.
    let x = 0;
    let z = 0;
    let bestD = -1;
    for (let attempt = 0; attempt < (spacing > 0 ? MAX_SPACING_ATTEMPTS : 1); attempt++) {
      const cx = (random() - 0.5) * w;
      const cz = (random() - 0.5) * d;
      const d2 = spacing > 0 ? nearest2(cx, cz) : 0;
      if (d2 > bestD) {
        bestD = d2;
        x = cx;
        z = cz;
      }
      if (spacing === 0 || d2 >= spacing * spacing) break;
    }
    if (spacing > 0) {
      const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push([x, z]);
      else grid.set(key, [[x, z]]);
    }
    const scale = Math.max(1e-3, lo + (hi - lo) * random());
    const yawDeg = shape.randomYaw === false ? 0 : random() * 360;
    out.push({ position: [x, 0, z], scale, yawDeg });
  }
  return out;
}
