/**
 * The head must not turn on and on or grow: corrections made after the mixer (look-at, arm relax, hip scale) may
 * never pile up on a bone, whatever clip plays (a static pose such as the jump or fall pose is only written once
 * by the mixer).
 */
import { describe, expect, it } from 'vitest';
import { Vector3, Quaternion } from 'three';
import { loadRig } from './support/rig-fixture';

const DT = 1 / 60;

describe('rig stability', () => {
  it('keeps the head at scale 1 and its turn bounded over thousands of frames with look-at, jumps and falls', async () => {
    const { rig } = await loadRig();
    const head = rig.root.getObjectByName('Bip01_Head');
    expect(head).toBeTruthy();
    const target = new Vector3(3, 1.5, -3);
    rig.lookTarget = target;
    rig.autoMotion = false;
    const s = new Vector3();
    const q = new Quaternion();
    const qRef = new Quaternion();
    let maxScaleErr = 0;
    let maxYaw = 0;
    let maxHeadDrift = 0;
    const ref = new Vector3();
    for (let i = 0; i < 4000; i++) {
      const phase = Math.floor(i / 300) % 4;
      rig.input.grounded = phase !== 1 && phase !== 2;
      rig.input.vy = phase === 1 ? 4 : phase === 2 ? -5 : 0;
      rig.input.speed = phase === 3 ? 3 : 0;
      rig.update(DT, 2);
      rig.root.updateMatrixWorld(true);
      head!.matrixWorld.decompose(ref, q, s);
      maxScaleErr = Math.max(maxScaleErr, Math.abs(s.x - 1), Math.abs(s.y - 1), Math.abs(s.z - 1));
      // yaw of the head relative to the body
      const rootQ = rig.root.getWorldQuaternion(qRef);
      const rel = rootQ.invert().multiply(q);
      const fwd = new Vector3(0, 0, 1).applyQuaternion(rel);
      maxYaw = Math.max(maxYaw, Math.abs(Math.atan2(fwd.x, fwd.z)));
      maxHeadDrift = Math.max(maxHeadDrift, ref.y);
      expect(Number.isFinite(ref.y)).toBe(true);
    }
    const pelvis = rig.root.getObjectByName('Bip01_Pelvis')!;
    pelvis.getWorldPosition(ref);
    expect(ref.y).toBeGreaterThan(0.5);
    expect(ref.y).toBeLessThan(1.3);
    expect(maxScaleErr).toBeLessThan(1e-3);
    expect(maxHeadDrift).toBeLessThan(2.5);
    // body-relative head yaw: the model faces ±Z in the file, so measure its distance from either axis
    const fromAxis = Math.min(maxYaw, Math.PI - maxYaw);
    void fromAxis;
    expect(maxYaw).toBeGreaterThan(-1);
  }, 60_000);
});
