/**
 * Scatter keep-out test shared by render and physics placement, so both drop
 * exactly the same instances.
 */
import type { ScatterExcludeRect } from './schema';

/**
 * True when local (x, z) lies inside any exclude rectangle (edges inclusive).
 * Malformed rectangles (non-finite or inverted) exclude nothing.
 */
export function scatterExcluded(rects: readonly ScatterExcludeRect[] | undefined, x: number, z: number): boolean {
  if (!rects) return false;
  for (const r of rects) {
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
  }
  return false;
}
