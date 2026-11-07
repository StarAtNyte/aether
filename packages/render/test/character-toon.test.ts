/**
 * Toon bodies: the spring chains swing back toward the pose and stay out of their colliders, the pose steps on twos,
 * and the cast entry `kaho` resolves only when named.
 */
import { castById, characterCredit, isToonBody, lookFromText, resolveLook } from '@aether/assets';
import { Bone, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { closestOnSegment, rateAt, SpringSystem } from '../src/characters/springs';
import { poseStep, TOON_POSE_FPS } from '../src/characters/system';

function chain(): { root: Bone; a: Bone; b: Bone } {
  const root = new Bone();
  root.name = 'root';
  const a = new Bone();
  a.name = 'a';
  a.position.set(0, -0.1, 0);
  const b = new Bone();
  b.name = 'b';
  b.position.set(0, -0.1, 0);
  root.add(a);
  a.add(b);
  root.updateMatrixWorld(true);
  return { root, a, b };
}

const tipOf = (b: Bone): Vector3 => new Vector3(0, -0.1, 0).applyMatrix4(b.matrixWorld);

describe('spring chains', () => {
  it('lags behind a sideways move, then settles back to the pose', () => {
    const { root, b } = chain();
    const s = new SpringSystem(root, [{ name: 't', bones: ['a', 'b'], tip: [0, -0.1, 0], stiffness: 0.2, drag: 0.2, gravity: 0, radius: 0.01, limit: 1.2 }]);
    expect(s.size).toBe(2);
    s.update(1 / 60);
    root.position.x = 0.1;
    root.updateMatrixWorld(true);
    s.update(1 / 60);
    // The tail trails the move.
    expect(tipOf(b).x).toBeLessThan(0.1);
    for (let i = 0; i < 400; i++) {
      root.updateMatrixWorld(true);
      s.update(1 / 60);
    }
    expect(tipOf(b).x).toBeCloseTo(0.1, 2);
    // Bone lengths are kept.
    expect(tipOf(b).distanceTo(new Vector3().setFromMatrixPosition(b.matrixWorld))).toBeCloseTo(0.1, 4);
  });

  it('keeps the tail out of a collider capsule', () => {
    const { root, b } = chain();
    const s = new SpringSystem(root, [{ name: 't', bones: ['a', 'b'], tip: [0, -0.1, 0], stiffness: 0.05, drag: 0.1, gravity: 1, radius: 0.01, limit: 2 }], [{ bone: 'root', head: [-0.1, -0.2, 0.02], tail: [0.1, -0.2, 0.02], radius: 0.05 }]);
    for (let i = 0; i < 200; i++) {
      root.updateMatrixWorld(true);
      s.update(1 / 60);
    }
    const tip = tipOf(b);
    const c = closestOnSegment(tip, new Vector3(-0.1, -0.2, 0.02), new Vector3(0.1, -0.2, 0.02), new Vector3());
    expect(tip.distanceTo(c)).toBeGreaterThan(0.05);
  });

  it('rates are frame-rate independent', () => {
    expect(rateAt(0.2, 1 / 60)).toBeCloseTo(0.2, 6);
    expect(1 - rateAt(0.2, 1 / 30)).toBeCloseTo((1 - 0.2) ** 2, 6);
    expect(rateAt(0, 1)).toBe(0);
  });
});

describe('pose on twos', () => {
  it('holds the pose until a 12 Hz step is due, then hands over all the gathered time', () => {
    expect(TOON_POSE_FPS).toBe(12);
    expect(poseStep(1 / 60, 12)).toBe(0);
    expect(poseStep(4 / 60, 12)).toBe(0);
    expect(poseStep(5 / 60, 12)).toBeCloseTo(5 / 60, 6);
    expect(poseStep(0.3, 12)).toBeCloseTo(0.3, 6);
    // Realistic bodies step every frame.
    expect(poseStep(1 / 60, 0)).toBeCloseTo(1 / 60, 6);
  });
});

describe('the toon cast', () => {
  it('kaho is a toon female body of the project, used only when named', () => {
    const k = castById('kaho');
    expect(k?.gender).toBe('female');
    expect(k && isToonBody(k)).toBe(true);
    expect(resolveLook({ body: 'kaho' }, 'x').body.id).toBe('kaho');
    for (let i = 0; i < 200; i++) expect(resolveLook({ gender: 'female' }, `seed-${i}`).body.id).not.toBe('kaho');
    expect(lookFromText('an anime girl')?.body).toBe('kaho');
  });

  it('credits her motions to Rocketbox but not her body', () => {
    const c = characterCredit(['kaho']);
    expect(c.assets.some((a) => a.startsWith('kaho ('))).toBe(false);
    expect(c.assets.join(' ')).toContain('kaho');
    expect(c.assets.join(' ')).toContain('MIT');
  });
});
