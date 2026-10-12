/**
 * Decides which entities become rigid bodies and which physics-less
 * descendants contribute compound colliders to an ancestor's body. Pure
 * functions over the World IR so `sync` can diff plans cheaply.
 */
import type { Entity, EntityId, PhysicsSpec, Vec3, WorldDoc } from '@aether/core';
import { eulerDegToQuat, LIMITS, stableStringify, worldTransform } from '@aether/core';
import type { Quat } from './types';
import { quatConjugate, quatMul, rotateInv } from './vec';

/** Pose of an entity in world space (scale kept separately; bodies are unscaled). */
export interface Pose {
  position: Vec3;
  quaternion: Quat;
  scale: Vec3;
}

/** A physics-less descendant whose shape is attached to its owner's body. */
export interface CompositePart {
  entity: Entity;
  /** Pose relative to the owner body frame. */
  position: Vec3;
  quaternion: Quat;
  /** World scale of the part. */
  scale: Vec3;
}

/** Everything needed to (re)build one rigid body. */
export interface BodyPlan {
  id: EntityId;
  entity: Entity;
  physics: PhysicsSpec;
  pose: Pose;
  parts: CompositePart[];
  /** Changes when the body must be rebuilt (shape, physics, scale, parts). */
  bodyKey: string;
  /** Changes when only the pose moved. */
  poseKey: string;
  /** Changes when the joint must be rebuilt. */
  jointKey: string;
}

/** Index of children per parent id (one O(n) pass). */
export function childIndex(world: WorldDoc): Map<EntityId, EntityId[]> {
  const idx = new Map<EntityId, EntityId[]>();
  for (const id of Object.keys(world.entities)) {
    const parent = (world.entities[id] as Entity).parent;
    if (parent === null) continue;
    const list = idx.get(parent);
    if (list) list.push(id);
    else idx.set(parent, [id]);
  }
  return idx;
}

/** True when the entity and all of its ancestors are non-template (it exists at runtime). */
export function isInstantiated(world: WorldDoc, id: EntityId): boolean {
  let cur: Entity | undefined = Object.hasOwn(world.entities, id) ? world.entities[id] : undefined;
  let depth = 0;
  while (cur) {
    if (cur.template) return false;
    if (cur.parent === null) return true;
    if (++depth > LIMITS.MAX_HIERARCHY_DEPTH) return false;
    cur = Object.hasOwn(world.entities, cur.parent) ? world.entities[cur.parent] : undefined;
  }
  return false;
}

/** True when `id` should own a rigid body. */
export function hasBody(world: WorldDoc, id: EntityId): boolean {
  const e = Object.hasOwn(world.entities, id) ? world.entities[id] : undefined;
  return !!e && !!e.physics && isInstantiated(world, id);
}

/** World pose of an entity (safe: broken chains fall back to the local transform). */
export function entityPose(world: WorldDoc, id: EntityId): Pose {
  try {
    const t = worldTransform(world, id);
    return { position: t.position, quaternion: t.quaternion, scale: t.scale };
  } catch {
    const e = world.entities[id] as Entity;
    return { position: [...e.transform.position], quaternion: eulerDegToQuat(e.transform.rotation), scale: [...e.transform.scale] };
  }
}

/** Express world pose `p` relative to frame `frame` (rigid). */
export function relativePose(frame: Pose, p: Pose): { position: Vec3; quaternion: Quat } {
  const d: Vec3 = [p.position[0] - frame.position[0], p.position[1] - frame.position[1], p.position[2] - frame.position[2]];
  const inv = quatConjugate(frame.quaternion);
  return { position: rotateInv(frame.quaternion, d), quaternion: quatMul(inv, p.quaternion) };
}

/**
 * Physics-less descendants of `ownerId` that carry a shape and whose nearest
 * physics ancestor is the owner (compound colliders). Lights-only, invisible,
 * template and scatter descendants are skipped, as are entities tagged
 * `nocollide`.
 */
export function compositeParts(world: WorldDoc, ownerId: EntityId, children: Map<EntityId, EntityId[]>, ownerPose: Pose): CompositePart[] {
  const parts: CompositePart[] = [];
  const stack = [...(children.get(ownerId) ?? [])];
  let guard = 0;
  while (stack.length > 0 && guard++ < LIMITS.MAX_ENTITIES) {
    const id = stack.pop() as EntityId;
    const e = world.entities[id];
    if (!e || e.template || e.physics) continue; // own body (or template) ends the subtree
    for (const c of children.get(id) ?? []) stack.push(c);
    if (!e.visible || e.tags.includes('nocollide')) continue;
    if (e.shape.kind !== 'primitive' && e.shape.kind !== 'procedural' && e.shape.kind !== 'model') continue;
    const pose = entityPose(world, id);
    const rel = relativePose(ownerPose, pose);
    parts.push({ entity: e, position: rel.position, quaternion: rel.quaternion, scale: pose.scale });
  }
  parts.sort((a, b) => (a.entity.id < b.entity.id ? -1 : a.entity.id > b.entity.id ? 1 : 0));
  return parts;
}

function r6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** Build the plan for one body owner. */
export function planBody(world: WorldDoc, id: EntityId, children: Map<EntityId, EntityId[]>): BodyPlan {
  const entity = world.entities[id] as Entity;
  const physics = entity.physics as PhysicsSpec;
  const pose = entityPose(world, id);
  const parts = compositeParts(world, id, children, pose);
  const bodyKey = stableStringify({
    physics,
    shape: entity.shape,
    material: entity.material?.preset ?? null,
    scale: pose.scale.map(r6),
    parts: parts.map((p) => ({ id: p.entity.id, shape: p.entity.shape, pos: p.position.map(r6), rot: p.quaternion.map(r6), scale: p.scale.map(r6) })),
  });
  const poseKey = `${pose.position.map(r6).join(',')}|${pose.quaternion.map(r6).join(',')}`;
  const jointKey = entity.joint ? stableStringify(entity.joint) : '';
  return { id, entity, physics, pose, parts, bodyKey, poseKey, jointKey };
}

/** Plans for every body owner in the world (document order). */
export function planWorld(world: WorldDoc): BodyPlan[] {
  const children = childIndex(world);
  const out: BodyPlan[] = [];
  for (const id of Object.keys(world.entities)) if (hasBody(world, id)) out.push(planBody(world, id, children));
  return out;
}

/** Nearest ancestor of `id` that owns a body (for composite-part change tracking). */
export function bodyOwnerOf(world: WorldDoc, id: EntityId): EntityId | null {
  let cur = Object.hasOwn(world.entities, id) ? world.entities[id] : undefined;
  let depth = 0;
  while (cur && depth++ <= LIMITS.MAX_HIERARCHY_DEPTH) {
    if (cur.physics) return hasBody(world, cur.id) ? cur.id : null;
    if (cur.parent === null) return null;
    cur = Object.hasOwn(world.entities, cur.parent) ? world.entities[cur.parent] : undefined;
  }
  return null;
}
