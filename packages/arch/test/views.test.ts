import { describe, expect, it } from 'vitest';
import { buildWall, compileBuilding, furnitureById, SECTION_CAP, variantsFor, WallParams } from '../src/index';

function maxY(out: ReturnType<typeof buildWall>): number {
  let m = -Infinity;
  for (const p of out.parts) for (let i = 1; i < p.positions.length; i += 3) m = Math.max(m, p.positions[i] as number);
  return m;
}

describe('wall section cut (view-only)', () => {
  const base = WallParams.parse({
    length: 5,
    height: 2.8,
    thickness: 0.2,
    openings: [
      { kind: 'door', offset: 1, width: 0.9, height: 2.1 },
      { kind: 'window', offset: 3.5, width: 1.2, height: 1.3, sill: 0.9 },
    ],
  });

  it('draws the wall only up to the cut, with a dark cap on the cut face', () => {
    const full = buildWall(base);
    const cut = buildWall({ ...base, cut: 1.05 });
    expect(maxY(full)).toBeCloseTo(2.8);
    expect(maxY(cut)).toBeCloseTo(1.05);
    expect(cut.parts.some((p) => p.material.color === SECTION_CAP.color)).toBe(true);
    expect(full.parts.some((p) => p.material.color === SECTION_CAP.color)).toBe(false);
  });

  it('fills window holes below the cut and keeps doorways open', () => {
    const cut = buildWall({ ...base, cut: 1.05 });
    // Colliders of the cut wall: the doorway stays free, the window strip is solid.
    const blocks = cut.colliders.filter((c) => c.kind === 'box');
    const covers = (x: number): boolean => blocks.some((c) => c.kind === 'box' && Math.abs(c.offset[0] - x) <= c.halfExtents[0] && c.offset[1] - c.halfExtents[1] <= 0.5 && c.offset[1] + c.halfExtents[1] >= 0.5);
    expect(covers(1)).toBe(false);
    expect(covers(3.5)).toBe(true);
  });

  it('ignores a cut at or above the wall height and rejects invalid cuts', () => {
    const same = buildWall({ ...base, cut: 3.2 });
    expect(maxY(same)).toBeCloseTo(2.8);
    expect(WallParams.safeParse({ ...base, cut: 0 }).success).toBe(false);
    expect(WallParams.safeParse({ ...base, cut: Number.NaN }).success).toBe(false);
  });
});

describe('walkthrough finish variants', () => {
  it('only name params the piece really has', () => {
    for (const kind of ['sofa', 'armchair', 'rug', 'bed']) {
      const variants = variantsFor({ kind });
      expect(variants?.length).toBeGreaterThan(1);
      const def = furnitureById(`furn-${kind}`);
      expect(def).toBeDefined();
      for (const v of variants ?? []) for (const key of Object.keys(v)) expect(Object.keys(def!.params)).toContain(key);
    }
    expect(variantsFor({ kind: 'lamp' })).toBeUndefined();
  });

  it('compiled furniture carries its variants, lamps can switch off', () => {
    const b = compileBuilding({ id: 'flat', levels: [{ rooms: [{ id: 'living', type: 'living', rect: [0, 0, 7, 5] }, { id: 'bed', type: 'bedroom', rect: [7, 0, 11, 5] }], doors: [{ between: ['living', 'outside'], main: true }, { between: ['living', 'bed'] }] }] });
    const sofa = b.entities.find((e) => e.arch?.kind === 'sofa');
    expect(sofa?.arch?.variants?.length).toBe(4);
    const lamps = b.entities.filter((e) => e.light !== undefined);
    expect(lamps.length).toBeGreaterThan(0);
    for (const l of lamps) {
      expect(l.arch?.role).toBe('light');
      const gen = l.shape?.kind === 'procedural' ? furnitureById(l.shape.generator) : undefined;
      expect(gen?.params['lit']).toBeDefined();
    }
    // A light switch next to a door, in the room it controls.
    const sw = b.entities.find((e) => e.arch?.role === 'switch');
    expect(sw?.arch?.room).toMatch(/^flat-l0-/);
  });
});
