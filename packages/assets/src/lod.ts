/**
 * Level-of-detail selection for library models. The build script writes
 * LOD files for dense models (LOD1 ≈ 50 %, LOD2 ≈ 15 % of the triangles);
 * the renderer picks one by projected size on screen.
 */
import type { CatalogEntry } from './schema';

/** Projected-height thresholds (fraction of the viewport height) below which a lower LOD is used. */
export const LOD_SCREEN_FRACTIONS: readonly [number, number] = [0.25, 0.08];

/**
 * Fraction of the viewport height covered by an object of `height` metres at
 * `distance` metres, for a camera with vertical field of view `fovYDeg`.
 */
export function screenFraction(height: number, distance: number, fovYDeg: number): number {
  if (!(distance > 1e-6)) return Infinity;
  const half = Math.tan((Math.max(1, Math.min(179, fovYDeg)) * Math.PI) / 360);
  return height / (2 * distance * half);
}

/**
 * LOD index (0 = full detail) for an entry seen at `distance` metres.
 * `bias` > 1 keeps full detail longer (studio renders), < 1 drops it sooner
 * (low-memory mode). Never returns an index the entry does not have.
 */
export function selectLod(entry: Pick<CatalogEntry, 'size' | 'lods'>, distance: number, fovYDeg: number, scale = 1, bias = 1): number {
  const n = entry.lods.length;
  if (n === 0) return 0;
  const extent = Math.max(entry.size[0], entry.size[1], entry.size[2]) * Math.abs(scale);
  const f = screenFraction(extent, distance, fovYDeg) * bias;
  if (f >= LOD_SCREEN_FRACTIONS[0]) return 0;
  if (f >= LOD_SCREEN_FRACTIONS[1] || n === 1) return 1;
  return 2;
}

/**
 * Camera distances at which LOD switches happen for an entry (for three.js
 * `LOD.addLevel`), one per available LOD file.
 */
export function lodDistances(entry: Pick<CatalogEntry, 'size' | 'lods'>, fovYDeg: number, scale = 1, bias = 1): number[] {
  const extent = Math.max(entry.size[0], entry.size[1], entry.size[2]) * Math.abs(scale) * bias;
  const half = Math.tan((Math.max(1, Math.min(179, fovYDeg)) * Math.PI) / 360);
  return entry.lods.map((_, i) => extent / (2 * half * LOD_SCREEN_FRACTIONS[i]!));
}
