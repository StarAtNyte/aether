import { describe, expect, it } from 'vitest';
import { buildWall, compileBuilding, furnitureById, SECTION_CAP, variantsFor, WallParams, type BuildingPlanInput } from '../src/index';

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

describe('doors and windows on long merged walls (regression)', () => {
  // An east facade running past a kitchen, a hall and a bedroom is one merged wall whose stored
  // room sides only name the kitchen: the hall's front door used to swing outwards.
  const plan: BuildingPlanInput = {
    id: 'flat',
    levels: [
      {
        rooms: [
          { id: 'kitchen', type: 'kitchen', rect: [0, 0, 10, 5] },
          { id: 'hall', type: 'hall', rect: [0, 5, 10, 6.6] },
          { id: 'bed', type: 'bedroom', rect: [0, 6.6, 10, 10.6] },
        ],
        doors: [
          { between: ['hall', 'outside'], side: 'east', main: true },
          { between: ['hall', 'kitchen'], kind: 'opening', width: 1.6 },
          { between: ['hall', 'bed'] },
        ],
        windows: [{ room: 'bed', side: 'east', count: 1, width: 1.2 }],
      },
    ],
  };

  /** Plan position of the free edge of a swing door leaf when fully open (the door behaviour's maths). */
  function openTip(e: { transform?: { position?: number[]; rotation?: number[] }; shape?: unknown; behaviors?: Array<{ params?: Record<string, unknown> }> }): [number, number] {
    const p = e.behaviors?.[0]?.params ?? {};
    const width = (e.shape as { params: { width: number } }).params.width;
    const hingeX = p['hinge'] === 'right' ? width / 2 : -width / 2;
    const yaw = ((e.transform?.rotation?.[1] ?? 0) * Math.PI) / 180;
    const th = ((p['swingAngle'] as number) * Math.PI) / 180;
    const rot = (x: number, z: number, a: number): [number, number] => [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
    const base = [e.transform?.position?.[0] ?? 0, e.transform?.position?.[2] ?? 0] as const;
    const h = rot(hingeX, 0, yaw);
    const pivot = [base[0] + h[0], base[1] + h[1]];
    const back = rot(-h[0], -h[1], th);
    const far = rot(-hingeX, 0, yaw + th);
    return [pivot[0]! + back[0] + far[0], pivot[1]! + back[1] + far[1]];
  }

  it('every swing door opens into its room, never outdoors', () => {
    const b = compileBuilding(plan);
    const leaves = b.entities.filter((e) => e.arch?.role === 'door' && e.behaviors?.[0]?.params?.['motion'] === 'swing');
    expect(leaves.length).toBeGreaterThanOrEqual(2);
    for (const leaf of leaves) {
      const [x, z] = openTip(leaf as Parameters<typeof openTip>[0]);
      // Inside the building outline [0..10] × [0..10.6].
      expect(x, leaf.id).toBeLessThan(10);
      expect(x).toBeGreaterThan(0);
      expect(z).toBeGreaterThan(0);
      expect(z).toBeLessThan(10.6);
    }
  });

  it('windows put their interior sill on the room side', () => {
    const b = compileBuilding(plan);
    const win = b.entities.find((e) => e.arch?.role === 'window' && e.arch.room === 'flat-l0-bed' && Math.abs((e.transform?.position?.[0] ?? 0) - 10) < 0.01);
    expect(win).toBeDefined();
    const params = (win!.shape as unknown as { params: { interior: 'a' | 'b' } }).params;
    // East wall runs along +Z or −Z; side B is the left of a→b. Interior = west (x < 10).
    const yaw = ((win!.transform?.rotation?.[1] ?? 0) * Math.PI) / 180;
    const nB: [number, number] = [Math.sin(yaw), Math.cos(yaw)];
    const interiorX = (params.interior === 'b' ? 1 : -1) * nB[0];
    expect(interiorX).toBeLessThan(0);
  });
});

describe('pool (regression)', () => {
  it('keeps the water above the ground plane', () => {
    for (const plinth of [0.05, 0.15, 0.6]) {
      const b = compileBuilding({ id: 'v', plinth, levels: [{ rooms: [{ id: 'living', type: 'living', rect: [0, 0, 6, 5] }], doors: [{ between: ['living', 'outside'], main: true }] }], site: { terrace: [[-3, -3], [12, -3], [12, 12], [-3, 12]], pool: { at: [6, 9], width: 6, length: 3 } } });
      const pool = b.entities.find((e) => e.arch?.role === 'pool');
      const y = pool?.transform?.position?.[1] ?? 0;
      const freeboard = (pool?.shape as unknown as { params: { freeboard: number } }).params.freeboard;
      expect(y - freeboard, `plinth ${plinth}`).toBeGreaterThan(0.005);
    }
  });
});
