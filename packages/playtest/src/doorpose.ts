/**
 * Doors in their open pose. The bot plans on a copy of the world in which
 * every openable door stands open (so the opening it has to fit through is
 * the real one: a swung leaf folds against a jamb and narrows the doorway).
 * The maths mirrors the `door` behavior of `@aether/logic` (slide offset,
 * or a swing about the hinge edge).
 */
import { eulerDegToQuat, quatMultiply, quatToEulerDeg, rotateVec3, worldTransform, type Entity, type EntityId, type Json, type Quat, type Vec3, type WorldDoc } from '@aether/core';
import { zoneShapeOf } from '@aether/logic';
import type { DoorInfo } from './goals';

function num(v: Json | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function yawQuat(deg: number): Quat {
  const h = (deg * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
}

/** World pose of a door entity when fully open, or null when it cannot be worked out. */
export function openDoorPose(world: WorldDoc, door: DoorInfo): { position: Vec3; quaternion: Quat } | null {
  const e = world.entities[door.id];
  if (!e) return null;
  const b = e.behaviors.find((x) => x.type === 'door' && x.enabled);
  if (!b) return null;
  let base;
  try {
    base = worldTransform(world, door.id);
  } catch {
    return null;
  }
  const half = zoneShapeOf(e).half;
  const baseQ: Quat = [base.quaternion[0], base.quaternion[1], base.quaternion[2], base.quaternion[3]];
  if (b.params['motion'] === 'swing') {
    const theta = Math.max(-180, Math.min(180, num(b.params['swingAngle'], 90)));
    const hinge = b.params['hinge'];
    const hingeX = hinge === 'center' ? 0 : (hinge === 'right' ? 1 : -1) * half[0];
    const h = rotateVec3(baseQ, [hingeX, 0, 0]);
    const v: Vec3 = [-h[0], -h[1], -h[2]];
    const yq = yawQuat(theta);
    const v2 = rotateVec3(yq, v);
    return {
      position: [base.position[0] + (v2[0] - v[0]), base.position[1] + (v2[1] - v[1]), base.position[2] + (v2[2] - v[2])],
      quaternion: quatMultiply(yq, baseQ),
    };
  }
  const raw = b.params['slide'];
  let slide: Vec3 = Array.isArray(raw) && raw.length === 3 && raw.every((n) => typeof n === 'number') ? [raw[0] as number, raw[1] as number, raw[2] as number] : [0, 0, 0];
  if (slide[0] === 0 && slide[1] === 0 && slide[2] === 0) slide = [0, half[1] * 2, 0];
  return { position: [base.position[0] + slide[0], base.position[1] + slide[1], base.position[2] + slide[2]], quaternion: baseQ };
}

/**
 * A copy of `world` where each given door is moved to its open pose. Doors
 * under a parent are converted back to the parent's frame. Doors that cannot
 * be posed are left as they are.
 */
export function withDoorsOpen(world: WorldDoc, doors: readonly DoorInfo[]): WorldDoc {
  const doc = structuredClone(world);
  for (const d of doors) {
    const pose = openDoorPose(world, d);
    const e = doc.entities[d.id] as Entity | undefined;
    if (!pose || !e) continue;
    let position = pose.position;
    let quaternion = pose.quaternion;
    if (e.parent !== null) {
      let pt;
      try {
        pt = worldTransform(world, e.parent as EntityId);
      } catch {
        continue;
      }
      const inv: Quat = [-pt.quaternion[0], -pt.quaternion[1], -pt.quaternion[2], pt.quaternion[3]];
      const rel = rotateVec3(inv, [position[0] - pt.position[0], position[1] - pt.position[1], position[2] - pt.position[2]]);
      position = [rel[0] / (pt.scale[0] || 1), rel[1] / (pt.scale[1] || 1), rel[2] / (pt.scale[2] || 1)];
      quaternion = quatMultiply(inv, quaternion);
    }
    e.transform.position = position;
    e.transform.rotation = quatToEulerDeg(quaternion);
    // The leaf stays solid (it is part of the doorway now); it just no longer moves.
    e.behaviors = e.behaviors.filter((x) => x.type !== 'door');
  }
  return doc;
}

export { eulerDegToQuat };
