/**
 * Procedural bone control applied after the animation mixer: head and neck
 * look-at, and two-bone arm IK for carrying. Both express a world-space
 * rotation delta D on a bone whose parent has world rotation P:
 *
 *   local' = (P⁻¹ · D · P) · local
 *
 * so they work on any rest pose. Allocation-free after construction (scratch
 * objects are module-level).
 */
import { Quaternion, Vector3, type Bone, type Object3D } from 'three';

const _q = new Quaternion();
const _q2 = new Quaternion();
const _q3 = new Quaternion();
const _p = new Quaternion();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _v4 = new Vector3();
const UP = new Vector3(0, 1, 0);

/** Apply a world-space rotation `delta` to `bone` (its parent's world matrix must be current). */
export function rotateBoneWorld(bone: Object3D, delta: Quaternion): void {
  const parent = bone.parent;
  if (parent) parent.getWorldQuaternion(_p);
  else _p.identity();
  // local' = P⁻¹ · D · P · local
  _q.copy(_p).invert().multiply(delta).multiply(_p);
  bone.quaternion.premultiply(_q);
}

/** Head tracking state: smoothed yaw and pitch (radians, relative to the body). */
export interface LookState {
  yaw: number;
  pitch: number;
}

/** Distribution of the look rotation over the spine, neck and head. */
const LOOK_SPLIT = { spine: 0.18, neck: 0.32, head: 0.5 } as const;
/** Largest head turn (radians) before the target is out of reach. */
export const LOOK_MAX_YAW = (75 * Math.PI) / 180;
export const LOOK_MAX_PITCH = (35 * Math.PI) / 180;

/** Bones used for looking. */
export interface LookBones {
  spine: Object3D | null;
  neck: Object3D | null;
  head: Object3D | null;
}

/**
 * Turn the head toward `state.yaw` / `state.pitch`. `bodyYaw` is the world
 * yaw of the body (radians, forward = −Z at 0); `right` is the world axis the
 * pitch rotates about. Bones are visited parent first and their world
 * matrices refreshed so each sees its parent's new pose.
 */
export function applyLook(bones: LookBones, state: LookState, bodyYaw: number): void {
  if (Math.abs(state.yaw) < 1e-4 && Math.abs(state.pitch) < 1e-4) return;
  _v1.set(Math.cos(bodyYaw), 0, -Math.sin(bodyYaw)); // body right (world)
  for (const [bone, share] of [[bones.spine, LOOK_SPLIT.spine], [bones.neck, LOOK_SPLIT.neck], [bones.head, LOOK_SPLIT.head]] as const) {
    if (!bone) continue;
    bone.parent?.updateWorldMatrix(true, false);
    _q2.setFromAxisAngle(UP, state.yaw * share);
    // Positive pitch looks up: a rotation about the body's right axis raises a −Z-facing forward vector.
    _q3.setFromAxisAngle(_v1, state.pitch * share);
    _q2.premultiply(_q3);
    rotateBoneWorld(bone, _q2);
  }
}

/**
 * Two-bone IK: bend `upper` and `lower` so `end` reaches `target` (world),
 * with the elbow pushed toward `pole` (world). Works on the bones' current
 * pose, so call it after the mixer. Out-of-reach targets stretch straight.
 */
export function solveTwoBone(upper: Bone, lower: Bone, end: Object3D, target: Vector3, pole: Vector3, weight = 1): void {
  if (weight <= 0) return;
  upper.updateWorldMatrix(true, false);
  lower.updateWorldMatrix(true, false);
  end.updateWorldMatrix(true, false);
  const a = upper.getWorldPosition(_v1);
  const b = lower.getWorldPosition(_v2);
  const c = end.getWorldPosition(_v3);
  const l1 = a.distanceTo(b);
  const l2 = b.distanceTo(c);
  const toTarget = _v4.copy(target).sub(a);
  const dist = Math.min(toTarget.length(), (l1 + l2) * 0.999);
  if (dist < 1e-4 || l1 < 1e-4 || l2 < 1e-4) return;
  toTarget.normalize();
  // Law of cosines: angle at the shoulder between the target line and the upper arm.
  const cosA = Math.max(-1, Math.min(1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
  const angA = Math.acos(cosA);
  // Elbow direction: perpendicular to the target line, toward the pole.
  const pv = new Vector3().copy(pole).sub(a);
  pv.addScaledVector(toTarget, -pv.dot(toTarget));
  if (pv.lengthSq() < 1e-8) pv.set(0, -1, 0).addScaledVector(toTarget, toTarget.y);
  pv.normalize();
  const elbow = new Vector3().copy(toTarget).multiplyScalar(Math.cos(angA) * l1).addScaledVector(pv, Math.sin(angA) * l1).add(a);
  // Rotate the upper arm so it points shoulder → elbow.
  const curUpper = new Vector3().copy(b).sub(a).normalize();
  const wantUpper = new Vector3().copy(elbow).sub(a).normalize();
  const dU = new Quaternion().setFromUnitVectors(curUpper, wantUpper);
  if (weight < 1) dU.slerp(new Quaternion(), 1 - weight);
  rotateBoneWorld(upper, dU);
  lower.updateWorldMatrix(true, false);
  end.updateWorldMatrix(true, false);
  // Rotate the forearm so it points elbow → target.
  const b2 = lower.getWorldPosition(_v2);
  const c2 = end.getWorldPosition(_v3);
  const curLower = new Vector3().copy(c2).sub(b2).normalize();
  const want = new Vector3().copy(target).sub(b2);
  if (want.lengthSq() < 1e-8) return;
  want.normalize();
  const dL = new Quaternion().setFromUnitVectors(curLower, want);
  if (weight < 1) dL.slerp(new Quaternion(), 1 - weight);
  rotateBoneWorld(lower, dL);
}
