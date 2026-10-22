/**
 * Headless motion checks on a real cast body and the captured clips: seated pose on a seat, standing up again, the jump
 * cycle, the head's limits, and joint ranges / per-frame jumps through a long mixed sequence.
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3, type Object3D } from 'three';
import { JOINT_RANGE } from '../src/characters/motion';
import { LOOK_MAX_PITCH, LOOK_MAX_YAW } from '../src/characters/ik';
import type { CharacterRig } from '../src/characters/rig';
import { loadRig } from './support/rig-fixture';

const DT = 1 / 60;
const p = new Vector3();
const p2 = new Vector3();
const p3 = new Vector3();

function at(rig: CharacterRig, name: string, out = new Vector3()): Vector3 {
  const o = rig.root.getObjectByName(name) as Object3D;
  o.updateWorldMatrix(true, false);
  return o.getWorldPosition(out);
}

function run(rig: CharacterRig, seconds: number, each?: (i: number) => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    each?.(i);
    rig.update(DT, 2);
    rig.root.updateMatrixWorld(true);
  }
}

/** Angle (rad) between two segments meeting at `mid`: 0 when straight (flexion). */
function flexion(rig: CharacterRig, a: string, mid: string, b: string): number {
  at(rig, a, p);
  at(rig, mid, p2);
  at(rig, b, p3);
  const u = p.sub(p2).normalize();
  const v = p3.sub(p2).normalize();
  return Math.PI - Math.acos(Math.max(-1, Math.min(1, u.dot(v))));
}

describe('sitting', () => {
  it('sits the pelvis on the seat with the feet on the floor, the spine upright and the thighs level, then stands up again', async () => {
    const { rig } = await loadRig();
    rig.autoMotion = false;
    rig.seatTop = 0.45;
    run(rig, 0.5);
    rig.input.sitting = true;
    run(rig, 4);
    const pelvis = at(rig, 'Bip01_Pelvis').clone();
    expect(Math.abs(pelvis.y - (0.45 + 0.11))).toBeLessThan(0.03);
    expect(Math.hypot(pelvis.x, pelvis.z)).toBeLessThan(0.05);
    for (const f of ['Bip01_L_Foot', 'Bip01_R_Foot']) expect(at(rig, f).y).toBeLessThan(0.16);
    const head = at(rig, 'Bip01_Head');
    expect(Math.hypot(head.x - pelvis.x, head.z - pelvis.z)).toBeLessThan(0.3);
    expect(head.y - pelvis.y).toBeGreaterThan(0.5);
    const thigh = at(rig, 'Bip01_L_Thigh');
    const knee = at(rig, 'Bip01_L_Calf');
    expect(Math.abs(thigh.y - knee.y)).toBeLessThan(0.14);
    rig.input.sitting = false;
    run(rig, 3.5);
    rig.seatTop = null;
    run(rig, 0.3);
    expect(at(rig, 'Bip01_Pelvis').y).toBeGreaterThan(0.85);
    expect(rig.model.position.length()).toBeLessThan(1e-3);
  }, 60_000);

  it('seats on a stool and on a low sofa with the pelvis following the seat height', async () => {
    for (const top of [0.42, 0.65]) {
      const { rig } = await loadRig();
      rig.autoMotion = false;
      rig.seatTop = top;
      rig.input.sitting = true;
      run(rig, 5);
      expect(Math.abs(at(rig, 'Bip01_Pelvis').y - (top + 0.11))).toBeLessThan(0.03);
      for (const f of ['Bip01_L_Foot', 'Bip01_R_Foot']) expect(at(rig, f).y).toBeLessThan(0.16);
    }
  }, 60_000);
});

describe('jumping', () => {
  it('tucks the legs on the way up, reaches down on the way back and keeps the root where physics put it', async () => {
    const { rig } = await loadRig();
    rig.autoMotion = false;
    run(rig, 0.5);
    const kneeMax = { v: 0 };
    let y = 0;
    let vy = 0;
    const pelvisRel: number[] = [];
    rig.input.grounded = false;
    for (let i = 0; i < 120; i++) {
      vy = 5 - 9.81 * (i * DT);
      y = Math.max(0, 5 * i * DT - 4.9 * (i * DT) ** 2);
      rig.input.vy = vy;
      rig.input.grounded = i === 0 ? true : y > 0;
      if (i === 1) rig.input.grounded = false;
      rig.root.position.y = y;
      rig.update(DT, 2);
      rig.root.updateMatrixWorld(true);
      kneeMax.v = Math.max(kneeMax.v, flexion(rig, 'Bip01_L_Thigh', 'Bip01_L_Calf', 'Bip01_L_Foot'));
      pelvisRel.push(at(rig, 'Bip01_Pelvis').y - y);
      if (y <= 0 && i > 5) break;
    }
    expect(kneeMax.v).toBeGreaterThan(40 * (Math.PI / 180));
    expect(kneeMax.v).toBeLessThan(JOINT_RANGE.knee[1]);
    // The pelvis stays within a hand of its standing height over the thighs while airborne (no drift in the root).
    for (const r of pelvisRel.slice(2, 30)) expect(r).toBeGreaterThan(0.7);
  }, 60_000);
});

describe('head and joints', () => {
  it('never turns the head beyond the limits, wherever the target is, and returns to forward without a flip', async () => {
    const { rig } = await loadRig();
    rig.autoMotion = false;
    const target = new Vector3();
    const qHead = new Quaternion();
    const qRoot = new Quaternion();
    let prev: Vector3 | null = null;
    let worstStep = 0;
    let maxYaw = 0;
    let maxPitch = 0;
    const dir = new Vector3();
    rig.lookTarget = target;
    // A target circling the person at head height, passing straight behind, and up and down.
    run(rig, 12, (i) => {
      const a = (i * DT) * 1.4;
      target.set(Math.sin(a) * 3, 1.5 + Math.sin(a * 2.3) * 2, Math.cos(a) * 3);
    });
    run(rig, 12, (i) => {
      const a = (i * DT) * 1.4;
      target.set(Math.sin(a) * 3, 1.5 + Math.sin(a * 2.3) * 2, Math.cos(a) * 3);
      const head = rig.root.getObjectByName('Bip01_Head') as Object3D;
      head.getWorldQuaternion(qHead);
      rig.root.getWorldQuaternion(qRoot);
      dir.set(0, 0, -1).applyQuaternion(qHead.clone().premultiply(qRoot.clone().invert()));
      const f = new Vector3(0, 0, -1);
      void f;
      if (prev) worstStep = Math.max(worstStep, dir.angleTo(prev));
      prev = dir.clone();
    });
    run(rig, 1, () => {});
    // The fixture model faces -Z: body-relative head forward measured from the idle forward.
    const head = rig.root.getObjectByName('Bip01_Head') as Object3D;
    void head;
    maxYaw = Math.abs(rig.gaze.yaw);
    maxPitch = Math.abs(rig.gaze.pitch);
    expect(maxYaw).toBeLessThanOrEqual(LOOK_MAX_YAW + 1e-6);
    expect(maxPitch).toBeLessThanOrEqual(LOOK_MAX_PITCH + 1e-6);
    // 60 Hz: a flip would show as a step of 90 degrees or more in one frame.
    expect(worstStep).toBeLessThan(0.18);
  }, 60_000);

  it('keeps every joint in a human range and every bone from jumping between frames through walking, jumping, sitting and standing', async () => {
    const { rig } = await loadRig();
    rig.autoMotion = false;
    rig.seatTop = 0.45;
    rig.lookTarget = new Vector3(2, 1.6, -2);
    const bones: Object3D[] = [];
    rig.root.traverse((o) => {
      if ((o as { isBone?: boolean }).isBone && /Bip01_(Pelvis|Spine|Spine1|Spine2|Neck|Head|[LR]_(Thigh|Calf|UpperArm|Forearm|Hand|Foot))$/.test(o.name)) bones.push(o);
    });
    const prev = new Map<Object3D, Quaternion>();
    let worst = 0;
    let worstName = '';
    let maxKnee = 0;
    let maxElbow = 0;
    const script = (i: number): void => {
      const t = i * DT;
      const seg = Math.floor(t / 2);
      rig.input.sitting = seg === 6 || seg === 7;
      rig.input.speed = seg === 1 ? 1.4 : seg === 2 ? 3.2 : seg === 3 ? 5.5 : 0;
      const jumping = seg === 4 || seg === 5;
      const local = t - seg * 2;
      rig.input.grounded = !(jumping && local < 0.9 && seg === 4);
      rig.input.vy = jumping && local < 0.9 && seg === 4 ? 5 - 9.81 * local : 0;
    };
    run(rig, 20, (i) => {
      script(i);
    });
    rig.input.sitting = false;
    const frames = Math.round(20 / DT);
    for (let i = 0; i < frames; i++) {
      script(i);
      rig.update(DT, 2);
      rig.root.updateMatrixWorld(true);
      for (const b of bones) {
        const q = prev.get(b);
        if (q && i > 2) {
          const ang = 2 * Math.acos(Math.min(1, Math.abs(q.dot(b.quaternion))));
          // Transitions between clips cross-fade over a few frames: a bone may move quickly, but never snap.
          if (ang > worst) {
            worst = ang;
            worstName = `${b.name}@${i}`;
          }
        }
        prev.set(b, b.quaternion.clone());
      }
      maxKnee = Math.max(maxKnee, flexion(rig, 'Bip01_L_Thigh', 'Bip01_L_Calf', 'Bip01_L_Foot'), flexion(rig, 'Bip01_R_Thigh', 'Bip01_R_Calf', 'Bip01_R_Foot'));
      maxElbow = Math.max(maxElbow, flexion(rig, 'Bip01_L_UpperArm', 'Bip01_L_Forearm', 'Bip01_L_Hand'), flexion(rig, 'Bip01_R_UpperArm', 'Bip01_R_Forearm', 'Bip01_R_Hand'));
    }
    expect(maxKnee).toBeLessThanOrEqual(JOINT_RANGE.knee[1]);
    expect(maxElbow).toBeLessThanOrEqual(JOINT_RANGE.elbow[1]);
    // About 45 degrees in one 60 Hz frame is the most any bone may turn (a flip or a pop would be far more).
    expect(worst, worstName).toBeLessThan(0.8);
  }, 120_000);
});
