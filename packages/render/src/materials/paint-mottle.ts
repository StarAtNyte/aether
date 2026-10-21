/**
 * Painted walls and ceilings: a faint albedo mottle in world space (roller passes at about a metre, a finer tone at
 * a decimetre), at most a few percent, so a large white wall is not a single flat value. Albedo only: no normal or
 * roughness change (those banded into blotches under grazing lamp light before). Two noise lookups per fragment, on
 * the tiers that also run the anti-tiling lookups (not on software rasterisers or in low-memory mode).
 */
import type { MeshStandardMaterial } from 'three';
import { T, type Nd } from './tsl-lite';

/** Strength of the metre-scale and the decimetre-scale mottle (linear albedo multipliers at full noise). */
export const PAINT_MOTTLE: readonly [number, number] = [0.035, 0.015];

let node: Nd | null = null;

/** Give a paint material its mottle (shared node). */
export function applyPaintMottle(m: MeshStandardMaterial): void {
  if (!node) {
    const p = T.positionWorld;
    const big = T.mx_noise_float(p.mul(0.9));
    const fine = T.mx_noise_float(p.mul(9.5).add(T.vec3(3.1, 7.4, 1.7)));
    const k = T.float(1).add(big.mul(PAINT_MOTTLE[0])).add(fine.mul(PAINT_MOTTLE[1]));
    const base = T.materialColor;
    node = T.vec4(base.rgb.mul(k), base.w);
  }
  (m as unknown as { colorNode: unknown }).colorNode = node;
}
