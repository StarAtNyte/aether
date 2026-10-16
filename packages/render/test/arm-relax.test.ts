/**
 * Airborne arms: the authored jump and fall poses spread the arms like a T-pose from a chase camera, so the rig brings the upper
 * arms in by turning them about the model's forward axis in world space. The helper must turn the bone's WORLD rotation by exactly
 * that delta, whatever the parent and the model orientation are.
 */
import { Euler, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { armRelaxed, boneTurned } from '../src/characters/rig';

const q = (x: number, y: number, z: number): Quaternion => new Quaternion().setFromEuler(new Euler(x, y, z));
const angleBetween = (a: Quaternion, b: Quaternion): number => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));

describe('armRelaxed', () => {
  it('turns the bone about the model forward axis in world space, for any parent and model orientation', () => {
    const cases: Array<[Quaternion, Quaternion, Quaternion]> = [
      [q(0.2, 0.7, -0.4), q(0, 0, 0), q(0, 0, 0)],
      [q(0.5, -1.2, 0.3), q(-0.3, 0.4, 0.9), q(0, Math.PI, 0)],
      [q(-1.0, 0.1, 0.6), q(0.8, 2.4, -0.2), q(0.1, 0.5, 0)],
    ];
    for (const [local, parent, model] of cases) {
      for (const angle of [0.4, -0.4, 0.77]) {
        const before = parent.clone().multiply(local);
        const after = parent.clone().multiply(armRelaxed(local.clone(), parent, model, angle).clone());
        // World delta = after * before^-1 must be a rotation by `angle` about the model's forward axis.
        const delta = after.clone().multiply(before.clone().invert());
        const forward = new Vector3(0, 0, 1).applyQuaternion(model);
        const expected = new Quaternion().setFromAxisAngle(forward, angle);
        expect(angleBetween(delta, expected)).toBeLessThan(1e-5);
      }
    }
  });

  it('zero angle leaves the local rotation unchanged', () => {
    const local = q(0.3, -0.8, 1.1);
    const out = armRelaxed(local.clone(), q(0.5, 0.2, -0.7), q(0, Math.PI, 0), 0);
    expect(angleBetween(out, local)).toBeLessThan(1e-6);
  });

  it('opposite arms get opposite turns that cancel', () => {
    const local = q(0.3, -0.8, 1.1);
    const parent = q(0.1, 0.2, 0.3);
    const model = q(0, 0, 0);
    const there = armRelaxed(local.clone(), parent, model, 0.5).clone();
    const back = armRelaxed(there.clone(), parent, model, -0.5).clone();
    expect(angleBetween(back, local)).toBeLessThan(1e-5);
  });
});

describe('boneTurned (paddle stroke axis)', () => {
  it('swings about the model-space left axis whatever the model faces, as a world rotation', () => {
    const local = q(0.4, -0.2, 0.9);
    const parent = q(-0.3, 0.8, 0.2);
    for (const model of [q(0, 0, 0), q(0, Math.PI, 0), q(0.2, 1.1, -0.3)]) {
      const before = parent.clone().multiply(local);
      const after = parent.clone().multiply(boneTurned(local.clone(), parent, model, new Vector3(1, 0, 0), 0.5).clone());
      const delta = after.clone().multiply(before.clone().invert());
      const left = new Vector3(1, 0, 0).applyQuaternion(model);
      expect(angleBetween(delta, new Quaternion().setFromAxisAngle(left, 0.5))).toBeLessThan(1e-5);
    }
  });
});
