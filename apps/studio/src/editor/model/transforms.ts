/**
 * World ↔ local transform math on documents (same composition as core
 * `worldTransform`: T·R·S per level, scale component-wise). Used to keep an
 * entity where it is in the world when it is re-parented, grouped,
 * ungrouped, pasted or aligned.
 */
import { eulerDegToQuat, getEntity, quatMultiply, quatToEulerDeg, rotateVec3, worldTransform, type EntityId, type Quat, type Transform, type Vec3, type WorldDoc, type WorldTransform } from '@aether/core';

const round = (v: number, step: number): number => {
  const r = Math.round(v / step) * step;
  return Object.is(r, -0) ? 0 : r;
};

/** Inverse of a unit quaternion. */
function conj(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

function safeScale(v: number): number {
  return Math.abs(v) < 1e-9 ? 1e-9 : v;
}

/** World transform of the parent of a would-be child (identity for the root). */
export function parentWorld(world: WorldDoc, parent: EntityId | null): WorldTransform {
  if (parent === null || !getEntity(world, parent)) return { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] };
  return worldTransform(world, parent);
}

/** Local transform under `parent` that reproduces the world transform `w` (rounded for tidy documents). */
export function localFromWorld(world: WorldDoc, parent: EntityId | null, w: WorldTransform): Transform {
  const p = parentWorld(world, parent);
  const inv = conj(p.quaternion);
  const d: Vec3 = [w.position[0] - p.position[0], w.position[1] - p.position[1], w.position[2] - p.position[2]];
  const r = rotateVec3(inv, d);
  const position: Vec3 = [round(r[0] / safeScale(p.scale[0]), 0.0001), round(r[1] / safeScale(p.scale[1]), 0.0001), round(r[2] / safeScale(p.scale[2]), 0.0001)];
  const q = quatMultiply(inv, w.quaternion);
  const e = quatToEulerDeg(q);
  const rotation: Vec3 = [round(e[0], 0.01), round(e[1], 0.01), round(e[2], 0.01)];
  const scale: Vec3 = [round(w.scale[0] / safeScale(p.scale[0]), 0.0001), round(w.scale[1] / safeScale(p.scale[1]), 0.0001), round(w.scale[2] / safeScale(p.scale[2]), 0.0001)];
  return { position, rotation, scale };
}

/** The local transform `id` needs under `newParent` to stay where it is in the world. */
export function reparentTransform(world: WorldDoc, id: EntityId, newParent: EntityId | null): Transform {
  return localFromWorld(world, newParent, worldTransform(world, id));
}

/** Convert a world-space translation into the local space of `id`'s parent. */
export function worldDeltaToLocal(world: WorldDoc, id: EntityId, delta: Vec3): Vec3 {
  const e = getEntity(world, id);
  const p = parentWorld(world, e?.parent ?? null);
  const r = rotateVec3(conj(p.quaternion), delta);
  return [r[0] / safeScale(p.scale[0]), r[1] / safeScale(p.scale[1]), r[2] / safeScale(p.scale[2])];
}

/** World transform from a local transform under `parent`. */
export function worldFromLocal(world: WorldDoc, parent: EntityId | null, t: Transform): WorldTransform {
  const p = parentWorld(world, parent);
  const s: Vec3 = [t.position[0] * p.scale[0], t.position[1] * p.scale[1], t.position[2] * p.scale[2]];
  const r = rotateVec3(p.quaternion, s);
  return {
    position: [p.position[0] + r[0], p.position[1] + r[1], p.position[2] + r[2]],
    quaternion: quatMultiply(p.quaternion, eulerDegToQuat(t.rotation)),
    scale: [t.scale[0] * p.scale[0], t.scale[1] * p.scale[1], t.scale[2] * p.scale[2]],
  };
}
