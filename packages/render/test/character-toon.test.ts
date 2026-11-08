/**
 * Toon bodies: the spring chains swing back toward the pose and stay out of their colliders, the pose steps on twos,
 * and the cast entry `kaho` resolves only when named.
 */
import { castById, characterCredit, isToonBody, lookFromText, resolveLook } from '@aether/assets';
import { Bone, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { closestOnSegment, rateAt, SpringSystem } from '../src/characters/springs';
import { clothClearCpu } from '../src/characters/cloth-clear';
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

  it('a chain with a collider filter clears its capsules along the whole link and ignores the others', () => {
    // One straight link 0.4 m down; a leg capsule crossing it 0.55 of the way down (neither its tail nor its middle).
    const root = new Bone();
    root.name = 'root';
    const panel = new Bone();
    panel.name = 'panel';
    root.add(panel);
    const leg = new Bone();
    leg.name = 'L_Thigh';
    root.add(leg);
    const hand = new Bone();
    hand.name = 'hand';
    root.add(hand);
    root.updateMatrixWorld(true);
    const def = { name: 'skirt0', bones: ['panel'], tip: [0, -0.4, 0] as [number, number, number], stiffness: 0.3, drag: 0.2, gravity: 0, radius: 0.005, limit: 1.6, collide: ['Thigh'] };
    const caps = [
      { bone: 'L_Thigh', head: [-0.1, -0.22, 0.01] as [number, number, number], tail: [0.1, -0.22, 0.01] as [number, number, number], radius: 0.04 },
      // on the hand: not the panel's business (it would push it the other way)
      { bone: 'hand', head: [-0.1, -0.3, -0.02] as [number, number, number], tail: [0.1, -0.3, -0.02] as [number, number, number], radius: 0.05 },
    ];
    const s = new SpringSystem(root, [def], caps);
    for (let i = 0; i < 120; i++) {
      root.updateMatrixWorld(true);
      s.update(1 / 60);
    }
    const head = new Vector3().setFromMatrixPosition(panel.matrixWorld);
    const tail = new Vector3(0, -0.4, 0).applyMatrix4(panel.matrixWorld);
    const a = new Vector3(-0.1, -0.22, 0.01);
    const b = new Vector3(0.1, -0.22, 0.01);
    for (let f = 0.45; f <= 1; f += 0.05) {
      const p = head.clone().lerp(tail, f);
      expect(p.distanceTo(closestOnSegment(p, a, b, new Vector3()))).toBeGreaterThan(0.04);
    }
    // pushed away from the thigh (toward -z), not by the hand's capsule
    expect(tail.z).toBeLessThan(-0.02);
    expect(s.posedCapsules(['Thigh'])).toHaveLength(1);
  });

  it('cloth vertices leave the leg capsules, never toward the body axis', () => {
    const caps = [{ a: new Vector3(0.08, 0.8, 0), b: new Vector3(0.08, 0.45, 0), radius: 0.07 }];
    // in front of the thigh, inside it: out to the surface
    const p = clothClearCpu(new Vector3(0.08, 0.6, 0.05), caps);
    expect(p.distanceTo(new Vector3(0.08, 0.6, 0))).toBeCloseTo(0.07, 5);
    // between the thigh and the body's axis (the nearest way out points inward): left where it is
    const q = clothClearCpu(new Vector3(0.03, 0.6, 0.0), caps);
    expect(q.x).toBeCloseTo(0.03, 6);
    // not cloth: unchanged
    expect(clothClearCpu(new Vector3(0.08, 0.6, 0.05), caps, 0).z).toBeCloseTo(0.05, 6);
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
