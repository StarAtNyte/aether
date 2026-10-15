import { applyPatches, validateWorld, type Entity, type WorldDoc } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { applyArchOps } from '../src/ops';
import { buildWall } from '../src/wall';
import { DesignPlan, designToBuildingPlan } from '../src/scene/design';
import { WallParams } from '../src/params';

const PLAN = {
  id: 'flat',
  name: 'Flat',
  style: 'modern',
  levels: [
    {
      rooms: [
        { id: 'living', type: 'living', rect: [0, 0, 6, 5] },
        { id: 'bed', type: 'bedroom', rect: [6, 0, 10, 5] },
      ],
      doors: [{ between: ['living', 'bed'] }, { between: ['living', 'outside'], main: true }],
    },
  ],
} as const;

function empty(): WorldDoc {
  const r = validateWorld({});
  if (!r.ok) throw new Error('invalid');
  return r.world;
}

function built(ops: Parameters<typeof applyArchOps>[1] = []): { world: WorldDoc; errors: number } {
  const first = applyArchOps(empty(), [{ op: 'create_building', plan: PLAN }, ...ops]);
  return { world: applyPatches(empty(), first.patches).world, errors: first.errors.length };
}

interface Face {
  wall: Entity;
  side: 'a' | 'b';
  finish: string | undefined;
}

/** Wall faces of a building seen from inside `room` (the room lies on side B when `side` is b). */
function wallFaces(w: WorldDoc): Face[] {
  const out: Face[] = [];
  for (const e of Object.values(w.entities)) {
    if (e.arch?.role !== 'wall' || e.shape.kind !== 'procedural') continue;
    const p = e.shape.params as Record<string, { finish?: string }>;
    out.push({ wall: e, side: 'a', finish: p['finishA']?.finish });
    out.push({ wall: e, side: 'b', finish: p['finishB']?.finish });
  }
  return out;
}

describe('per-wall finishes', () => {
  it('papers exactly one wall of a room and leaves the others alone', () => {
    const base = built();
    const papered = built([{ op: 'set_wall', building: 'flat', room: 'bed', wall: 'north', material: { finish: 'wallpaper-floral', color: '#d8e0cf' } }]);
    expect(papered.errors).toBe(0);
    const count = (w: WorldDoc): number => wallFaces(w).filter((f) => f.finish === 'wallpaper-floral').length;
    expect(count(base.world)).toBe(0);
    expect(count(papered.world)).toBe(1);
    // The papered face is on the north wall (z = 0) at x >= 6: its wall starts at x 6 and runs along z = 0.
    const face = wallFaces(papered.world).find((f) => f.finish === 'wallpaper-floral');
    const t = face?.wall.transform.position ?? [0, 0, 0];
    expect(Math.abs(t[2])).toBeLessThan(0.01);
    expect(t[0]).toBeGreaterThanOrEqual(5.99);
    // No other room's finish changed: every non-papered face is paint, tile, plaster or the exterior finish.
    for (const f of wallFaces(papered.world)) if (f.finish !== 'wallpaper-floral') expect(['paint', 'tile', 'plaster', 'brick', 'stone', 'concrete']).toContain(f.finish);
  });

  it('wallpapers all walls of a room, tinted by the colour, and clears again', () => {
    const on = built([{ op: 'set_wall', building: 'flat', room: 'bed', wall: 'all', material: { finish: 'wallpaper-stripe' } }]);
    expect(wallFaces(on.world).filter((f) => f.finish === 'wallpaper-stripe').length).toBeGreaterThanOrEqual(4);
    const off = built([
      { op: 'set_wall', building: 'flat', room: 'bed', wall: 'all', material: { finish: 'wallpaper-stripe' } },
      { op: 'set_wall', building: 'flat', room: 'bed', wall: 'all', clear: true },
    ]);
    expect(wallFaces(off.world).filter((f) => f.finish === 'wallpaper-stripe').length).toBe(0);
  });

  it('adds a dado with a chair rail that splits the face at its height', () => {
    const w = built([{ op: 'set_wall', building: 'flat', room: 'living', wall: 'all', dado: { height: 1.0, material: { finish: 'panelling', color: '#e4e0d8' }, rail: true } }]);
    const dados = Object.values(w.world.entities).filter((e) => e.arch?.role === 'wall' && e.shape.kind === 'procedural' && (e.shape.params['dadoA'] || e.shape.params['dadoB']));
    expect(dados.length).toBeGreaterThan(0);
  });

  it('refuses an empty set_wall with a hint', () => {
    const r = applyArchOps(empty(), [{ op: 'create_building', plan: PLAN }, { op: 'set_wall', building: 'flat', room: 'bed', wall: 'north' }]);
    expect(r.errors[0]?.code).toBe('empty_wall_op');
  });
});

describe('wall dado geometry', () => {
  const params = (dado: boolean): WallParams =>
    WallParams.parse({ length: 4, height: 2.7, thickness: 0.15, openings: [{ kind: 'door', offset: 2, width: 0.9, height: 2.1 }], finishA: { finish: 'paint', color: '#cccccc' }, ...(dado ? { dadoA: { height: 1.1, material: { finish: 'panelling' }, rail: true } } : {}) });
  it('puts the lower part and the rail in the dado material and keeps the face above', () => {
    const out = buildWall(params(true));
    const materials = out.parts.map((p) => p.material.finish);
    expect(materials).toContain('panelling');
    const dado = out.parts.find((p) => p.material.finish === 'panelling');
    let maxY = 0;
    for (let i = 1; i < (dado?.positions.length ?? 0); i += 3) maxY = Math.max(maxY, dado?.positions[i] ?? 0);
    expect(maxY).toBeGreaterThan(1.1);
    expect(maxY).toBeLessThan(1.2);
    // Colliders are unchanged by the covering.
    expect(buildWall(params(false)).colliders.length).toBe(out.colliders.length);
  });
});

describe('design plans carry wall coverings', () => {
  it('the AI-first design path passes finish, per-wall accents and dado into the building plan and the compiled walls', () => {
    const design = DesignPlan.parse({
      id: 'flat',
      name: 'Flat',
      style: 'modern',
      levels: [
        {
          rooms: [
            { id: 'living', type: 'living', rect: [0, 0, 6, 5], finish: { finish: 'wallpaper-stripe', color: '#d9dfcf' }, dado: { height: 1, material: { finish: 'panelling' }, rail: true } },
            { id: 'bed', type: 'bedroom', rect: [6, 0, 10, 5], walls: { north: { finish: 'wallpaper-floral' } } },
          ],
          openings: [{ kind: 'door', room: 'living', wall: 'south', along: 3, width: 1, to: 'outside', main: true }, { kind: 'door', room: 'living', wall: 'east', along: 2.5, width: 0.9, to: 'bed' }],
        },
      ],
    });
    const plan = designToBuildingPlan(design);
    const rooms = plan.levels[0]?.rooms ?? [];
    expect(rooms.find((r) => r.id === 'living')?.finish?.finish).toBe('wallpaper-stripe');
    expect(rooms.find((r) => r.id === 'living')?.dado?.height).toBe(1);
    expect(rooms.find((r) => r.id === 'bed')?.walls?.north?.finish).toBe('wallpaper-floral');
    const r = applyArchOps(empty(), [{ op: 'create_building', plan }]);
    expect(r.errors).toEqual([]);
    const world = applyPatches(empty(), r.patches).world;
    const finishes = wallFaces(world).map((f) => f.finish);
    expect(finishes).toContain('wallpaper-stripe');
    expect(finishes).toContain('wallpaper-floral');
  });
});
