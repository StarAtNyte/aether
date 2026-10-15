/** Small convex-polygon helpers of the scene tools (plan frame, metres). */
import { pointInPolygon, pointSegmentDistance, type P2 } from '../math2';

/** Result of a separating-axis test: how deep two convex polygons overlap and which way to push `a` out of `b`. */
export interface Penetration {
  depth: number;
  /** Unit axis along which `a` should move to separate (away from `b`). */
  axis: P2;
}

/** Penetration of convex polygon `a` into `b`, or null when they are apart (or touch within `margin`). */
export function penetration(a: readonly P2[], b: readonly P2[], margin = 0.005): Penetration | null {
  let best: Penetration | null = null;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as P2;
      const q = poly[(i + 1) % poly.length] as P2;
      const nx = q[1] - p[1];
      const nz = p[0] - q[0];
      const len = Math.hypot(nx, nz);
      if (len < 1e-9) continue;
      const ux = nx / len;
      const uz = nz / len;
      let amin = Infinity;
      let amax = -Infinity;
      let bmin = Infinity;
      let bmax = -Infinity;
      for (const v of a) {
        const d = v[0] * ux + v[1] * uz;
        amin = Math.min(amin, d);
        amax = Math.max(amax, d);
      }
      for (const v of b) {
        const d = v[0] * ux + v[1] * uz;
        bmin = Math.min(bmin, d);
        bmax = Math.max(bmax, d);
      }
      const o1 = amax - bmin;
      const o2 = bmax - amin;
      if (o1 <= margin || o2 <= margin) return null;
      const depth = Math.min(o1, o2);
      if (!best || depth < best.depth) best = { depth, axis: o1 < o2 ? [-ux, -uz] : [ux, uz] };
    }
  }
  return best;
}

/** Smallest distance between two convex polygons (0 when they overlap). */
export function polygonGap(a: readonly P2[], b: readonly P2[]): number {
  if (penetration(a, b, -1e-9)) return 0;
  let best = Infinity;
  for (const [from, to] of [[a, b], [b, a]] as const) {
    for (const v of from) {
      for (let i = 0; i < to.length; i++) {
        const p = to[i] as P2;
        const q = to[(i + 1) % to.length] as P2;
        best = Math.min(best, pointSegmentDistance(v[0], v[1], p[0], p[1], q[0], q[1]));
      }
    }
  }
  return best;
}

/** Centre of a polygon's vertices. */
export function meanPoint(poly: readonly P2[]): P2 {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  const n = Math.max(1, poly.length);
  return [x / n, z / n];
}

/** True when every vertex of `inner` lies inside `outer` (a simple polygon). */
export function polygonInside(inner: readonly P2[], outer: readonly P2[]): boolean {
  return inner.every((p) => pointInPolygon(p[0], p[1], outer));
}

/** Round to millimetres. */
export function mm(v: number): number {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
}

/** Round to centimetres (for text). */
export function cmr(v: number): number {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}

/** Compass words for a plan vector (x east, z south): "1.20 m east, 0.40 m north". */
export function describeOffset(dx: number, dz: number): string {
  const parts: string[] = [];
  if (Math.abs(dx) >= 0.005) parts.push(`${cmr(Math.abs(dx)).toFixed(2)} m ${dx > 0 ? 'east' : 'west'}`);
  if (Math.abs(dz) >= 0.005) parts.push(`${cmr(Math.abs(dz)).toFixed(2)} m ${dz > 0 ? 'south' : 'north'}`);
  return parts.length > 0 ? parts.join(', ') : 'the same spot';
}

/** The compass word of a unit vector (the nearest axis). */
export function compassWord(x: number, z: number): 'north' | 'south' | 'east' | 'west' {
  return Math.abs(x) > Math.abs(z) ? (x > 0 ? 'east' : 'west') : z > 0 ? 'south' : 'north';
}
