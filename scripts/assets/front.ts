/**
 * Which way a converted SimReady piece faces, decided from its geometry (pure, no I/O).
 *
 * The library's convention is that the front faces +Z. The source datasets are authored in different frames, so the bounding
 * box alone cannot tell: a chair is square, a toilet is longer along its front, a sofa along its width. Pieces that have a
 * back (a chair's backrest, a sofa's back, a toilet's cistern) give it away: their upper part sits off the middle of the
 * footprint, towards the back, so the front is the opposite side.
 */

/** Types whose upper part leans to the back. */
export const BACKED_TYPES: ReadonlySet<string> = new Set(['chair', 'armchair', 'sofa', 'couch', 'bench', 'stool', 'toilet', 'seat', 'loveseat']);

/** Fronts checked by eye in the world renders that no geometry rule finds (a forklift's forks, not its width). Rotation in degrees. */
export const FRONT_OVERRIDES: Readonly<Record<string, number>> = Object.freeze({
  'simready-vehicle-forklift-red-c01': 180,
  'simready-vehicle-forklift-blue-c01': 180,
});

/** Bump when a rule above changes: `bulk --reprocess` re-converts the pieces it affects that were built with an older one. */
export const FRONT_FIX_REV = 1;

export interface FrontDecision {
  rot: number | null;
  sure: boolean;
  why: string;
}

/**
 * Rotation about Y (degrees, the build's `rot`: x' = x cos + z sin, z' = -x sin + z cos) that turns the front direction
 * (dx, dz), one of the four axes, onto +Z.
 */
export function rotToFace(dx: number, dz: number): number {
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 270 : 90;
  return dz > 0 ? 0 : 180;
}

/**
 * Front of a backed piece from its vertices (`xyz` triples, Y up, metres), or null when the shape does not show a back: the
 * centroid of the top 30 % of the height is compared with the footprint's centre; it must sit off by at least 8 % of the
 * footprint's extent along one axis and be clearly dominated by that axis.
 */
export function backedFront(xyz: ArrayLike<number>): FrontDecision | null {
  const n = Math.floor(xyz.length / 3);
  if (n < 12) return null;
  let y0 = Infinity;
  let y1 = -Infinity;
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const [x, y, z] = [xyz[i * 3] as number, xyz[i * 3 + 1] as number, xyz[i * 3 + 2] as number];
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
    lo[0] = Math.min(lo[0] as number, x);
    hi[0] = Math.max(hi[0] as number, x);
    lo[1] = Math.min(lo[1] as number, z);
    hi[1] = Math.max(hi[1] as number, z);
  }
  const h = y1 - y0;
  if (!(h > 0.05)) return null;
  const cx = ((lo[0] as number) + (hi[0] as number)) / 2;
  const cz = ((lo[1] as number) + (hi[1] as number)) / 2;
  let sx = 0;
  let sz = 0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    if ((xyz[i * 3 + 1] as number) < y0 + 0.7 * h) continue;
    sx += xyz[i * 3] as number;
    sz += xyz[i * 3 + 2] as number;
    k++;
  }
  if (k < 4) return null;
  const ox = sx / k - cx;
  const oz = sz / k - cz;
  const ex = (hi[0] as number) - (lo[0] as number);
  const ez = (hi[1] as number) - (lo[1] as number);
  const rx = Math.abs(ox) / Math.max(1e-6, ex);
  const rz = Math.abs(oz) / Math.max(1e-6, ez);
  const [r, big, small] = rx >= rz ? [rx, rx, rz] : [rz, rz, rx];
  if (r < 0.08 || big < 2 * small) return null;
  // The back is on the side of the offset; the front is the opposite.
  const [fx, fz] = rx >= rz ? [-Math.sign(ox), 0] : [0, -Math.sign(oz)];
  const rot = rotToFace(fx, fz);
  return { rot: rot === 0 ? null : rot, sure: true, why: `back of the ${rx >= rz ? 'x' : 'z'} side (offset ${(r * 100).toFixed(0)} % of the footprint)` };
}
