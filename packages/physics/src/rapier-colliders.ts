/**
 * LocalCollider → Rapier ColliderDesc, plus material-based default density.
 */
import type { ColliderDesc as RapierColliderDesc } from '@dimforge/rapier3d-compat';
import type { MaterialPreset } from '@aether/core';
import { rapier } from './rapier';
import type { LocalCollider } from './shapes';

/**
 * Relative densities per material preset (water = 1). Kept in a narrow band
 * so stacks of mixed materials remain solver-friendly; an explicit
 * `physics.mass` or `physics.density` always wins.
 */
const PRESET_DENSITY: Readonly<Record<MaterialPreset, number>> = {
  plastic: 1, wood: 0.6, stone: 2.4, brick: 1.9, concrete: 2.3, metal: 4, gold: 6, glass: 2.5, water: 1, ice: 0.9,
  grass: 1, dirt: 1.5, sand: 1.6, snow: 0.4, lava: 2.6, neon: 1, rubber: 1.1, fabric: 0.3, leaf: 0.3, bark: 0.7,
  crystal: 2.6, emissive: 1,
};

/** Default density for an entity's material preset (1 when unknown). */
export function presetDensity(preset: MaterialPreset | undefined): number {
  return preset ? PRESET_DENSITY[preset] : 1;
}

/**
 * Build a Rapier collider descriptor. Returns `null` when Rapier rejects the
 * geometry (e.g. a degenerate convex hull) and the caller should fall back.
 */
export function toRapierDesc(c: LocalCollider): RapierColliderDesc | null {
  const R = rapier();
  const s = c.shape;
  let desc: RapierColliderDesc | null;
  switch (s.kind) {
    case 'box':
      desc = R.ColliderDesc.cuboid(s.half[0], s.half[1], s.half[2]);
      break;
    case 'ball':
      desc = R.ColliderDesc.ball(s.radius);
      break;
    case 'capsule':
      desc = s.halfHeight > 1e-6 ? R.ColliderDesc.capsule(s.halfHeight, s.radius) : R.ColliderDesc.ball(s.radius);
      break;
    case 'cylinder':
      desc = R.ColliderDesc.cylinder(s.halfHeight, s.radius);
      break;
    case 'cone':
      desc = R.ColliderDesc.cone(s.halfHeight, s.radius);
      break;
    case 'hull':
      desc = R.ColliderDesc.convexHull(s.points);
      if (!desc) desc = hullFallbackBox(s.points);
      break;
    case 'trimesh':
      desc = R.ColliderDesc.trimesh(s.positions, s.indices);
      break;
    case 'heightfield':
      // procgen stores heights X-major (heights[ix * (rows + 1) + iz]) = Rapier's column-major layout
      // with rows along Z and columns along X, so it is passed through unchanged.
      // FIX_INTERNAL_EDGES: without it, fast bodies catch the seams between the triangles of a
      // flat heightfield and are kicked into the air (a kart hopping metres high on a flat floor).
      desc = R.ColliderDesc.heightfield(s.rows, s.cols, s.heights, { x: s.scale[0], y: s.scale[1], z: s.scale[2] }, R.HeightFieldFlags.FIX_INTERNAL_EDGES);
      break;
  }
  if (!desc) return null;
  desc.setTranslation(c.position[0], c.position[1], c.position[2]);
  desc.setRotation({ x: c.rotation[0], y: c.rotation[1], z: c.rotation[2], w: c.rotation[3] });
  return desc;
}

/** Box around a point cloud whose hull Rapier could not compute (coplanar/degenerate). */
function hullFallbackBox(points: Float32Array): RapierColliderDesc {
  const R = rapier();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = points[i + k] as number;
      if (v < (min[k] as number)) min[k] = v;
      if (v > (max[k] as number)) max[k] = v;
    }
  }
  const half = (k: number): number => Math.max(5e-3, ((max[k] as number) - (min[k] as number)) / 2);
  // Express the box as an 8-point hull so its (possibly off-origin) center is preserved.
  const cx = ((min[0] as number) + (max[0] as number)) / 2;
  const cy = ((min[1] as number) + (max[1] as number)) / 2;
  const cz = ((min[2] as number) + (max[2] as number)) / 2;
  return R.ColliderDesc.convexHull(new Float32Array([
    cx - half(0), cy - half(1), cz - half(2), cx + half(0), cy - half(1), cz - half(2),
    cx - half(0), cy + half(1), cz - half(2), cx + half(0), cy + half(1), cz - half(2),
    cx - half(0), cy - half(1), cz + half(2), cx + half(0), cy - half(1), cz + half(2),
    cx - half(0), cy + half(1), cz + half(2), cx + half(0), cy + half(1), cz + half(2),
  ])) ?? R.ColliderDesc.cuboid(half(0), half(1), half(2));
}
