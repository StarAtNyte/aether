/**
 * Modelled character props and worn gear: the carbine is a real carbine (long, with a magazine below and a stock behind
 * the grip) in a few draws, gear pieces stay small in triangles and draws, and role gear follows hold and wardrobe.
 */
import { CharacterSpec } from '@aether/core';
import { defaultGear, resolveLook } from '@aether/assets';
import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { buildProp } from '../src/characters/props';
import { buildGear, disposeGear, type GearFit } from '../src/characters/gear';

function stats(root: Object3D): { draws: number; triangles: number } {
  let draws = 0;
  let triangles = 0;
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    draws++;
    const g = m.geometry;
    triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return { draws, triangles };
}

const FIT: GearFit = { headTop: 1.76, cx: 0, cz: 0.01, rx: 0.075, rz: 0.095, chinY: 1.525, faceZ: -0.09, jawRx: 0.07, jawRz: 0.1, chestY: 1.36, chestFront: -0.12, chestBack: 0.1, chestHalf: 0.16, shoulderY: 1.5, waistY: 1.06 };

describe('modelled props', () => {
  it('the carbine is about 1.1 m long with the muzzle forward, a magazine under the receiver and a stock behind the grip, in four draws', () => {
    const prop = buildProp('rifle');
    expect(prop?.shouldered).toBeDefined();
    const box = new Box3().setFromObject(prop!.group);
    const size = box.getSize(new Vector3());
    expect(size.z).toBeGreaterThan(1.0);
    expect(size.z).toBeLessThan(1.25);
    expect(box.min.z).toBeLessThan(-0.75);
    expect(box.max.z).toBeGreaterThan(0.3);
    expect(box.min.y).toBeLessThan(-0.18);
    const s = stats(prop!.group);
    expect(s.draws).toBe(4);
    expect(s.triangles).toBeLessThan(3500);
    for (const c of prop!.group.children) expect((c as Mesh).receiveShadow).toBe(true);
    prop?.dispose();
  });

  it('axe, sword and spear are merged per material and stay light', () => {
    for (const kind of ['axe', 'sword', 'spear'] as const) {
      const prop = buildProp(kind)!;
      const s = stats(prop.group);
      expect(s.draws).toBeLessThanOrEqual(3);
      expect(s.triangles).toBeLessThan(1500);
      prop.dispose();
    }
  });
});

describe('worn gear', () => {
  it('a heavy wears a helmet on the head, plates on the spine, shoulder plates on the arms and a groin plate', () => {
    const pieces = buildGear(['helmet', 'heavy-armor'], FIT, 'guard');
    expect(pieces.map((p) => p.bone).sort()).toEqual(['head', 'lUpper', 'pelvis', 'rUpper', 'spine']);
    let draws = 0;
    let triangles = 0;
    for (const p of pieces) {
      const s = stats(p.group);
      draws += s.draws;
      triangles += s.triangles;
    }
    expect(draws).toBeLessThanOrEqual(8);
    expect(triangles).toBeLessThan(6000);
    const torso = new Box3().setFromObject(pieces.find((p) => p.bone === 'spine')!.group);
    expect(torso.min.z).toBeLessThan(FIT.chestFront);
    expect(torso.max.z).toBeGreaterThan(FIT.chestBack);
    disposeGear(pieces);
  });

  it('head covers sit on the head, above the chin', () => {
    for (const g of ['helmet', 'beanie', 'cap'] as const) {
      const [piece] = buildGear([g], FIT, 'bandit');
      const box = new Box3().setFromObject(piece!.group);
      expect(box.max.y).toBeGreaterThan(FIT.headTop);
      expect(box.max.y).toBeLessThan(FIT.headTop + 0.05);
      expect(box.min.y).toBeGreaterThan(FIT.chinY);
      disposeGear([piece!]);
    }
  });

  it('pieces of one look share materials across people', () => {
    const a = buildGear(['beanie', 'chest-rig'], FIT, 'bandit');
    const b = buildGear(['beanie', 'chest-rig'], FIT, 'bandit');
    const mats = (ps: typeof a): unknown[] => ps.flatMap((p) => p.group.children.map((c) => (c as Mesh).material));
    expect(mats(a)).toEqual(mats(b));
    disposeGear([...a, ...b]);
  });

  it('role gear follows hold and wardrobe, and an explicit list wins', () => {
    expect(defaultGear('rifle', 'guard', 1)).toEqual(['helmet', 'plate-carrier']);
    expect(defaultGear('rifle', 'guard', 1.12)).toEqual(['helmet', 'heavy-armor']);
    expect(defaultGear('rifle', 'bandit')).toEqual(['beanie', 'scarf', 'chest-rig']);
    expect(defaultGear('sword', 'guard')).toEqual([]);
    expect(resolveLook({ hold: 'rifle', wardrobe: 'bandit', scale: 1 }, 'r').gear).toEqual(['beanie', 'scarf', 'chest-rig']);
    expect(resolveLook({ hold: 'rifle', wardrobe: 'guard', gear: [], scale: 1 }, 'r').gear).toEqual([]);
    expect(resolveLook({ hold: 'axe', gear: ['scarf', 'cap'], scale: 1 }, 'r').gear).toEqual(['scarf', 'cap']);
    expect(CharacterSpec.safeParse({ gear: ['helmet', 'plate-carrier'] }).success).toBe(true);
    expect(CharacterSpec.safeParse({ gear: ['jetpack'] }).success).toBe(false);
  });
});
