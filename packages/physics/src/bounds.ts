/**
 * World-space bounds of an entity's colliders, from the document alone (no
 * physics world needed). Used by verification zones and by the logic runtime's
 * NPC navigation, which needs the footprint of generated buildings and assets.
 */
import type { EntityId, Vec3, WorldDoc } from '@aether/core';
import { entityPose } from './plan';
import { collidersBounds } from './shapes';
import { resolveShapeColliders } from './source';
import type { ColliderProvider } from './types';
import { rotate } from './vec';

/**
 * Axis-aligned world bounds of the entity's own colliders (scale and rotation
 * applied), expanded by `margin` on every side. Null when it has no extent or
 * is unknown.
 */
export function entityWorldBounds(world: WorldDoc, id: EntityId, margin = 0, provider?: ColliderProvider): { min: Vec3; max: Vec3 } | null {
  const e = Object.hasOwn(world.entities, id) ? world.entities[id] : undefined;
  if (!e) return null;
  const local = collidersBounds(resolveShapeColliders(e, 'auto', world, provider).colliders);
  if (!local) return null;
  const pose = entityPose(world, id);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const x of [local.min[0], local.max[0]]) {
    for (const y of [local.min[1], local.max[1]]) {
      for (const z of [local.min[2], local.max[2]]) {
        const p = rotate(pose.quaternion, [x * pose.scale[0], y * pose.scale[1], z * pose.scale[2]]);
        for (let k = 0; k < 3; k++) {
          const v = (p[k] as number) + (pose.position[k] as number);
          if (v < (min[k] as number)) min[k] = v;
          if (v > (max[k] as number)) max[k] = v;
        }
      }
    }
  }
  return { min: [min[0] - margin, min[1] - margin, min[2] - margin], max: [max[0] + margin, max[1] + margin, max[2] + margin] };
}

/** Most boxes returned per entity by {@link entityColliderBounds}. */
export const MAX_COLLIDER_BOXES = 24;

/**
 * World-space bounds of each of the entity's colliders separately (a tree is a
 * thin trunk plus a canopy high above, not one fat box). At most
 * {@link MAX_COLLIDER_BOXES}; empty when it has none or is unknown.
 */
export function entityColliderBounds(world: WorldDoc, id: EntityId): Array<{ min: Vec3; max: Vec3 }> {
  const e = Object.hasOwn(world.entities, id) ? world.entities[id] : undefined;
  if (!e) return [];
  const colliders = resolveShapeColliders(e, 'auto', world).colliders;
  const pose = entityPose(world, id);
  const out: Array<{ min: Vec3; max: Vec3 }> = [];
  for (const c of colliders.slice(0, MAX_COLLIDER_BOXES)) {
    const local = collidersBounds([c]);
    if (!local) continue;
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const x of [local.min[0], local.max[0]]) {
      for (const y of [local.min[1], local.max[1]]) {
        for (const z of [local.min[2], local.max[2]]) {
          const p = rotate(pose.quaternion, [x * pose.scale[0], y * pose.scale[1], z * pose.scale[2]]);
          for (let k = 0; k < 3; k++) {
            const v = (p[k] as number) + (pose.position[k] as number);
            if (v < (min[k] as number)) min[k] = v;
            if (v > (max[k] as number)) max[k] = v;
          }
        }
      }
    }
    out.push({ min, max });
  }
  return out;
}

/** An axis-aligned box in world space. */
export interface Aabb {
  min: Vec3;
  max: Vec3;
}

/**
 * World-space AABB of the collider geometry of `id` (transform, rotation and
 * scale applied), or null when it has none. Never throws; an optional
 * provider resolves asset colliders.
 */
export function entityBounds(world: WorldDoc, id: EntityId, provider?: ColliderProvider): Aabb | null {
  try {
    const b = entityWorldBounds(world, id, 0, provider);
    return b && b.min.every(Number.isFinite) && b.max.every(Number.isFinite) ? b : null;
  } catch {
    return null;
  }
}
