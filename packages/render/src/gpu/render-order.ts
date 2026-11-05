/**
 * Draw order of opaque items. three.js (r186) sorts them by group, render order and depth only, so alpha-tested
 * materials (leaves, fences, cut-outs) and plain ones interleave object by object. The sun's shadow pass draws every
 * caster with one override material and copies each caster's `alphaTest` onto it; every switch between "tested" and
 * "not tested" bumps that material's version, and a bumped version makes three recompute the full program cache key of
 * every following object (a walk over the whole node graph: 20 % of a frame's CPU on a house). Putting the alpha-tested
 * items last turns about 230 version bumps per pass into one, and costs nothing in the colour pass (alpha-tested
 * surfaces are drawn after the solid ones, as is usual).
 */

/** The fields of three's render items that the sort reads. */
export interface SortItem {
  id: number;
  groupOrder: number;
  renderOrder: number;
  z: number;
  material: { alphaTest?: number; id?: number; type?: string };
}

/**
 * Group opaque draws by material (its class, then the material itself) before depth: consecutive draws of one material
 * share a program and its bindings, so a town's view switches program a few dozen times instead of once every other
 * draw. The draw submission is the frame's bottleneck on integrated GPUs, not overdraw (docs/ARCHITECTURE-STREAMING.md
 * 1.5). Opt out with `globalThis.__AETHER_SORT_BY_MATERIAL = false` (front to back only).
 */
const byMaterial = (globalThis as { __AETHER_SORT_BY_MATERIAL?: boolean }).__AETHER_SORT_BY_MATERIAL !== false;

/** `Array.sort` comparator: group, render order, alpha-tested last, material, then front to back, then creation order. */
export function opaqueSort(a: SortItem, b: SortItem): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  const ta = (a.material.alphaTest ?? 0) > 0 ? 1 : 0;
  const tb = (b.material.alphaTest ?? 0) > 0 ? 1 : 0;
  if (ta !== tb) return ta - tb;
  if (byMaterial) {
    const ma = a.material, mb = b.material;
    if (ma !== mb && ma.id !== undefined && mb.id !== undefined) {
      if (ma.type !== mb.type) return (ma.type ?? '') < (mb.type ?? '') ? -1 : 1;
      return ma.id - mb.id;
    }
  }
  if (a.z !== b.z) return a.z - b.z;
  return a.id - b.id;
}

/**
 * Render order of layered terrain (and the ground): drawn after every other opaque item, so houses, trunks and crowns
 * cover it first and its heavy per-pixel material (about 28 texture reads) runs only where the ground is actually visible.
 */
export const TERRAIN_RENDER_ORDER = 1;
