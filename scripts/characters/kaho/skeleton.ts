/**
 * Kaho's skeleton: the shared Biped (hierarchy and rest rotations of the
 * library's female body), with only the bone offsets changed for anime
 * proportions, plus a few secondary bones (skirt panels, ponytail, side locks)
 * the runtime swings.
 *
 * Rest rotations are kept exactly, so the female motion set (local rotation
 * tracks per bone) plays on this body unchanged; the rig scales the root's
 * height by this body's hip over the motion set's.
 */
import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';

/** One bone as read from the library body (local transform, parent by name). */
export interface SourceBone {
  name: string;
  parent: string | null;
  t: [number, number, number];
  r: [number, number, number, number];
}

/** One bone of the built skeleton. */
export interface KBone {
  name: string;
  parent: number;
  t: Vector3;
  r: Quaternion;
  /** World bind pose (computed). */
  world: Matrix4;
  pos: Vector3;
}

/** Face bones of the library body are dropped (the toon face is painted). */
export const DROP_BONE = /Eye|Eyebrow|Mouth|Lip|Jaw|Tongue|Cheek|Caninus|Masseter|Nose|Nub$|Footsteps/i;

/**
 * Scale of each bone's offset from its parent (in world axes of the bind pose), by bone name.
 * Legs are long and the torso and arms short, for about 6.7 heads at 1.58 m.
 */
export interface Proportions {
  leg: number;
  foot: number;
  torso: number;
  neck: number;
  arm: number;
  hand: number;
  shoulder: number;
  /** Half the distance between the hip joints (m). */
  hipHalf: number;
}

export const KAHO_PROPORTIONS: Proportions = { leg: 0.93, foot: 0.82, torso: 0.8, neck: 1.0, arm: 0.88, hand: 0.8, shoulder: 0.8, hipHalf: 0.074 };

function offsetScale(name: string, p: Proportions): [number, number, number] | null {
  if (/_(Calf|Foot)$/.test(name)) return [p.leg, p.leg, p.leg];
  if (/_Toe0$/.test(name)) return [p.foot, p.foot, p.foot];
  if (/Bip01_Spine\d?$/.test(name)) return [p.torso, p.torso, p.torso];
  if (/Bip01_Neck$/.test(name)) return [p.torso, p.torso, p.torso];
  if (/Bip01_Head$/.test(name)) return [p.neck, p.neck, p.neck];
  if (/_Clavicle$/.test(name)) return [p.shoulder, p.torso, p.torso];
  if (/_UpperArm$/.test(name)) return [p.shoulder, p.shoulder, p.shoulder];
  if (/_(Forearm|Hand)$/.test(name)) return [p.arm, p.arm, p.arm];
  if (/_Finger/.test(name)) return [p.hand, p.hand, p.hand];
  return null;
}

/**
 * Build the proportioned skeleton from the library body's bones: world rest
 * rotations unchanged, joint positions moved. `hip` is the resulting root height.
 */
export function proportionSkeleton(src: readonly SourceBone[], p: Proportions = KAHO_PROPORTIONS): { bones: KBone[]; hip: number } {
  const kept = src.filter((b) => !DROP_BONE.test(b.name));
  // Old world positions and rotations.
  const objs = new Map<string, Object3D>();
  for (const b of kept) {
    const o = new Object3D();
    o.name = b.name;
    o.position.fromArray(b.t);
    o.quaternion.fromArray(b.r);
    objs.set(b.name, o);
  }
  for (const b of kept) if (b.parent) objs.get(b.parent)?.add(objs.get(b.name) as Object3D);
  const top = objs.get('Bip01');
  if (!top) throw new Error('no Bip01');
  top.updateMatrixWorld(true);
  const oldPos = new Map<string, Vector3>();
  const worldQ = new Map<string, Quaternion>();
  for (const [n, o] of objs) {
    oldPos.set(n, o.getWorldPosition(new Vector3()));
    worldQ.set(n, o.getWorldQuaternion(new Quaternion()));
  }
  // New world positions, parents first (src is in parent-first order).
  const newPos = new Map<string, Vector3>();
  for (const b of kept) {
    const old = oldPos.get(b.name) as Vector3;
    if (!b.parent) {
      newPos.set(b.name, old.clone());
      continue;
    }
    const pOld = oldPos.get(b.parent) as Vector3;
    const pNew = newPos.get(b.parent) as Vector3;
    const off = old.clone().sub(pOld);
    if (/_Thigh$/.test(b.name)) {
      // Thighs hang from the spine in the Biped: place the hip joints at the pelvis, a set distance apart.
      const pelvis = newPos.get('Bip01_Pelvis') as Vector3;
      newPos.set(b.name, new Vector3(Math.sign(old.x) * p.hipHalf, pelvis.y, old.z));
      continue;
    }
    const s = offsetScale(b.name, p);
    if (s) off.set(off.x * s[0], off.y * s[1], off.z * s[2]);
    newPos.set(b.name, pNew.clone().add(off));
  }
  // Drop everything so the soles stay on the floor: lowest of the feet's joints keeps its old height.
  const footOld = (oldPos.get('Bip01_L_Toe0') as Vector3).y;
  const ankleOld = (oldPos.get('Bip01_L_Foot') as Vector3).y;
  const ankleNew = (newPos.get('Bip01_L_Foot') as Vector3).y;
  // The ankle sits at foot-scaled height above the floor.
  const wantAnkle = footOld + (ankleOld - footOld) * p.foot;
  const drop = ankleNew - wantAnkle;
  for (const v of newPos.values()) v.y -= drop;
  // Local translations from the new world positions, rest rotations untouched.
  const index = new Map<string, number>();
  const bones: KBone[] = [];
  for (const b of kept) {
    const parent = b.parent ? (index.get(b.parent) ?? -1) : -1;
    const wp = newPos.get(b.name) as Vector3;
    let t: Vector3;
    if (parent < 0) t = wp.clone();
    else {
      const pq = worldQ.get(b.parent as string) as Quaternion;
      t = wp.clone().sub(newPos.get(b.parent as string) as Vector3).applyQuaternion(pq.clone().invert());
    }
    index.set(b.name, bones.length);
    bones.push({ name: b.name, parent, t, r: new Quaternion().fromArray(b.r), world: new Matrix4(), pos: new Vector3() });
  }
  updateWorld(bones);
  return { bones, hip: (bones[0] as KBone).pos.y };
}

/** Recompute world matrices and positions (bones in parent-first order). */
export function updateWorld(bones: KBone[]): void {
  for (const b of bones) {
    const local = new Matrix4().compose(b.t, b.r, new Vector3(1, 1, 1));
    b.world = b.parent < 0 ? local : (bones[b.parent] as KBone).world.clone().multiply(local);
    b.pos = new Vector3().setFromMatrixPosition(b.world);
  }
}

/**
 * Add a secondary bone at world position `at` under `parent`, with a world
 * rest rotation of identity (the runtime swings it in world terms).
 */
export function addSecondary(bones: KBone[], name: string, parent: string, at: Vector3): number {
  const pi = bones.findIndex((b) => b.name === parent);
  if (pi < 0) throw new Error(`no parent ${parent}`);
  const p = bones[pi] as KBone;
  const pq = new Quaternion().setFromRotationMatrix(p.world);
  const inv = pq.clone().invert();
  const t = at.clone().sub(p.pos).applyQuaternion(inv);
  bones.push({ name, parent: pi, t, r: inv, world: new Matrix4(), pos: new Vector3() });
  updateWorld(bones);
  return bones.length - 1;
}

/** Index of a bone by name (throws when missing). */
export function boneIndex(bones: readonly KBone[], name: string): number {
  const i = bones.findIndex((b) => b.name === name);
  if (i < 0) throw new Error(`no bone ${name}`);
  return i;
}
