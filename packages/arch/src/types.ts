/**
 * Output types of @aether/arch geometry builders. They are structurally
 * identical to @aether/procgen's `MeshPart` / `ColliderDesc` (procgen wraps
 * these builders as built-in generators), so no conversion is needed. Kept
 * here so this package depends on @aether/core only.
 */
import type { MaterialSpec, Vec3 } from '@aether/core';
import type { MeshData } from './mesh';

/** One drawable part: mesh data in the entity's local frame plus its material. UVs are metres. */
export interface ArchPart extends MeshData {
  material: MaterialSpec;
}

/** Physics collider in the entity's local frame (procgen `ColliderDesc` subset). */
export type ArchCollider =
  | { kind: 'box'; halfExtents: Vec3; offset: Vec3; rotation?: Vec3 }
  | { kind: 'hull'; points: Float32Array; offset: Vec3 }
  | { kind: 'trimesh'; positions: Float32Array; indices: Uint32Array };

/** Geometry of one architectural element or piece of furniture. */
export interface ArchOutput {
  parts: ArchPart[];
  colliders: ArchCollider[];
}
