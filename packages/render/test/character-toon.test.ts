/**
 * Toon bodies: the spring chains swing back toward the pose and stay out of their colliders, the pose steps on twos,
 * and the cast entry `kaho` resolves only when named.
 */
import { bodyCredits, castById, characterCredit, isToonBody, lookFromText, resolveLook } from '@aether/assets';
import { Bone, BufferGeometry, Group, Mesh, MeshStandardMaterial, Texture, Vector3, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { closestOnSegment, rateAt, SpringSystem } from '../src/characters/springs';
import { clothClearCpu } from '../src/characters/cloth-clear';
import { poseStep, TOON_POSE_FPS } from '../src/characters/system';
import { toonPartOf, ToonShading } from '../src/characters/toon';

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
  it('kaho is a toon female body of the original cast, used only when named', () => {
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
    expect(c.assets.join(' ')).toContain('motion set');
  });

  it('credits the VRM bodies of Kaho and Mio (the Cloudwatch Harbour cast) to the VRM model they are converted from; the live Kaho and Mio are this project\'s own', () => {
    expect(bodyCredits(['kaho', 'mio'])).toHaveLength(0);
    const c = bodyCredits(['kaho-vrm', 'mio-vrm']);
    expect(c).toHaveLength(1);
    expect(c[0]?.author).toContain('pixiv');
    expect(c[0]?.licence).toBe('VRM Public License 1.0');
    expect(c[0]?.licenceUrl).toBe('https://vrm.dev/licenses/1.0/');
    expect(c[0]?.assets.join(' ')).toMatch(/kaho-vrm .*mio-vrm/);
    expect(characterCredit(['kaho-vrm', 'mio-vrm']).assets.join(' ')).not.toContain("this project's own bodies");
  });
});

describe('toon outfit tints', () => {
  it('tints only the clothes and hair of a VRM body, never skin, face, eyes or shoes', () => {
    for (const n of ['kaho-vrm-Tops_01_CLOTH', 'mio-vrm-Tops_01_CLOTH-outline']) expect(toonPartOf(n), n).toBe('top');
    expect(toonPartOf('kaho-vrm-Bottoms_01_CLOTH')).toBe('bottom');
    for (const n of ['kaho-vrm-Hair_00_HAIR', 'kaho-vrm-HairBack_00_HAIR', 'kaho-vrm-HairBack_00_HAIR-outline']) expect(toonPartOf(n), n).toBe('hair');
    for (const n of ['kaho-vrm-Body_00_SKIN', 'kaho-vrm-Face_00_SKIN', 'kaho-vrm-EyeIris_00_EYE', 'kaho-vrm-EyeWhite_00_EYE', 'kaho-vrm-FaceBrow_00_FACE', 'kaho-vrm-Shoes_01_CLOTH', 'kaho-toon', ''])
      expect(toonPartOf(n), n).toBeNull();
  });

  it('gives tinted parts a shared tinted pair per colour, leaves the source materials alone and frees a pair with its last wearer', () => {
    const atlas = (name: string): Texture => Object.assign(new Texture(), { name });
    const maps = { top: atlas('top'), skin: atlas('skin'), hair: atlas('hair') };
    const body = (): { scene: Group; sources: MeshStandardMaterial[] } => {
      const scene = new Group();
      const sources: MeshStandardMaterial[] = [];
      for (const [part, map] of [['Tops_01_CLOTH', maps.top], ['Body_00_SKIN', maps.skin], ['Hair_00_HAIR', maps.hair]] as const)
        for (const kind of ['body', 'outline'] as const) {
          const m = new MeshStandardMaterial({ map });
          m.name = `kaho-vrm-${part}${kind === 'outline' ? '-outline' : ''}`;
          m.userData['toon'] = kind;
          sources.push(m);
          scene.add(new Mesh(new BufferGeometry(), m));
        }
      return { scene, sources };
    };
    const toon = new ToonShading();
    const plain = body();
    expect(toon.apply(plain.scene)).toEqual([]);
    const a = body();
    const b = body();
    const c = body();
    const red = { top: '#e08a8a', hair: '#a05050' };
    const ka = toon.apply(a.scene, red);
    const kb = toon.apply(b.scene, red);
    const kc = toon.apply(c.scene, { top: '#8ab4e0' });
    // Top and hair, body and outline each: two tinted pairs for red, one for blue.
    expect(ka).toHaveLength(4);
    expect(kc).toHaveLength(2);
    expect(toon.tintedCount).toBe(3);
    const mat = (s: Group, i: number): Material => (s.children[i] as Mesh).material as Material;
    // The same colour shares materials; another colour has its own; skin is the plain shared pair everywhere.
    expect(mat(a.scene, 0)).toBe(mat(b.scene, 0));
    expect(mat(a.scene, 0)).not.toBe(mat(c.scene, 0));
    expect(mat(a.scene, 0)).not.toBe(mat(plain.scene, 0));
    expect(mat(a.scene, 0).name).toBe('toon-body-tint');
    expect(mat(a.scene, 1).name).toBe('toon-outline-tint');
    for (const s of [a, b, c]) expect(mat(s.scene, 2)).toBe(mat(plain.scene, 2));
    expect(mat(c.scene, 4)).toBe(mat(plain.scene, 4));
    // The loaded materials and atlases are untouched (no colour change, no new textures).
    for (const s of [a, b, c]) for (const m of s.sources) expect(m.color.getHex()).toBe(0xffffff);
    toon.release(ka);
    expect(toon.tintedCount).toBe(3);
    toon.release(kb);
    expect(toon.tintedCount).toBe(1);
    toon.release(kc);
    expect(toon.tintedCount).toBe(0);
    toon.dispose();
  });
});
