import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { CeilingParams, buildCeiling, readScene, reviewFindings } from '../src/index';
import { PHOTO_BUILDING_ID, RoomDescription, buildChecklist, deriveBuild, memoryCaller, runBuild } from '../src/photo/index';

const rect: Array<[number, number]> = [
  [0, 0],
  [5, 0],
  [5, 4],
  [0, 4],
];

function bounds(out: ReturnType<typeof buildCeiling>): { minY: number; maxY: number; tris: number; downFacing: number; total: number } {
  let minY = Infinity;
  let maxY = -Infinity;
  let tris = 0;
  let down = 0;
  let total = 0;
  for (const p of out.parts) {
    for (let i = 1; i < p.positions.length; i += 3) {
      minY = Math.min(minY, p.positions[i] as number);
      maxY = Math.max(maxY, p.positions[i] as number);
    }
    tris += p.indices.length / 3;
    for (let i = 1; i < p.normals.length; i += 3) {
      total++;
      if ((p.normals[i] as number) < 0) down++;
    }
  }
  return { minY, maxY, tris, downFacing: down, total };
}

describe('vaulted ceiling', () => {
  it('slopes from the eaves (y = -rise) up to the ridge (y = 0), facing down, along either axis', () => {
    for (const ridge of ['x', 'z'] as const) {
      const out = buildCeiling(CeilingParams.parse({ polygon: rect, vault: { rise: 1.6, ridge } }));
      const b = bounds(out);
      expect(b.minY).toBeCloseTo(-1.6, 5);
      expect(b.maxY).toBeCloseTo(0, 5);
      expect(b.tris).toBe(4);
      expect(b.downFacing).toBe(b.total);
    }
  });

  it('adds exposed trusses, bounded in cost, and keeps non-rectangular rooms flat', () => {
    const plain = bounds(buildCeiling(CeilingParams.parse({ polygon: rect, vault: { rise: 1.6 } })));
    const trussed = bounds(buildCeiling(CeilingParams.parse({ polygon: rect, vault: { rise: 1.6, trusses: 6 } })));
    expect(trussed.tris).toBeGreaterThan(plain.tris + 6 * 4 * 6);
    expect(trussed.tris).toBeLessThan(2500);
    expect(trussed.minY).toBeGreaterThanOrEqual(-1.6 - 0.2);
    const lShape: Array<[number, number]> = [[0, 0], [5, 0], [5, 2], [2, 2], [2, 4], [0, 4]];
    const flat = bounds(buildCeiling(CeilingParams.parse({ polygon: lShape, vault: { rise: 1.6 } })));
    expect(flat.minY).toBe(0);
    expect(flat.maxY).toBe(0);
    expect(CeilingParams.safeParse({ polygon: rect, vault: { rise: 9 } }).success).toBe(false);
  });

  const desc = RoomDescription.parse({
    footprint: { width: 5, depth: 4, ceiling: 2.5 },
    camera: { x: 4.5, z: 3.6, heading: -40 },
    ceiling: { cornice: { height: 0.1 }, vault: { rise: 1.4, trusses: 3 } },
    openings: [{ id: 'win', kind: 'window', wall: 'west', along: 2, width: 1.2, height: 1.4, sill: 0.8 }],
    items: [
      { id: 'bed', kind: 'bed', wall: 'north', along: 2.5, gap: 0 },
      { id: 'curtain', kind: 'curtain', opening: 'win', params: { width: 0.7, height: 2.5 } },
    ],
  });

  it('is derived with a taller level, a ridge along the longer side and no crown moulding', () => {
    const b = deriveBuild(desc);
    const lvl = b.plan.levels[0]!;
    expect(lvl.height).toBeCloseTo(2.5 + 1.4 + 0.22, 2);
    expect(lvl.rooms[0]).toMatchObject({ vault: { rise: 1.4, ridge: 'x', trusses: 3 } });
    expect(b.plan.levels[0]!.rooms[0]?.cornice).toBeUndefined();
    expect(buildChecklist(desc).some((c) => c.id === 'vault')).toBe(true);
    expect(buildChecklist(desc).some((c) => c.id === 'cornice')).toBe(false);
    // Without a vault the ceiling stays as it was.
    const flat = deriveBuild({ ...desc, ceiling: { cornice: { height: 0.1 } } });
    expect(flat.plan.levels[0]!.height).toBeCloseTo(2.72, 2);
    expect(flat.plan.levels[0]!.rooms[0]?.cornice).toMatchObject({ height: 0.1 });
  });

  it('builds the room with the vault, curtains to the eaves (the described drop) and no checker error', async () => {
    const mem = memoryCaller(createWorld({}));
    const run = await runBuild(mem.world(), deriveBuild(desc), mem.call);
    expect(run.shellOk).toBe(true);
    const ceil = Object.values(run.world.entities).find((e) => e.arch?.role === 'ceiling');
    expect((ceil?.shape as { params?: { vault?: { rise: number } } }).params?.vault?.rise).toBe(1.4);
    const scene = readScene(run.world, PHOTO_BUILDING_ID)!;
    const curtains = scene.items.filter((i) => i.kind === 'curtain');
    expect(curtains.length).toBeGreaterThanOrEqual(1);
    for (const c of curtains) expect(c.y1 - c.y0).toBeLessThanOrEqual(2.5 + 0.01);
    expect(reviewFindings(run.world, PHOTO_BUILDING_ID).filter((f) => f.severity === 'error')).toEqual([]);
  });
});
