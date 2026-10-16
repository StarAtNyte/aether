/**
 * Ambient life through the level tools: the assistant names species, count and area; the code measures where each animal
 * fits (ground not steep and not under water, clear air, water deep enough and away from the bank) and refuses the rest
 * with the measured reason.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyPatches, type EntityInput, type WorldDoc } from '@aether/core';
import { initPhysics } from '@aether/physics';
import { LIFE_SPECIES, LIFE_SPECIES_IDS, planLife, runLevelTool } from '../src';
import { gameWorld, slab } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

/** A bank (x < -10, top y = 0), a lake bed 2 m down (x >= -10) with water up to y = -0.2, and a roof 15 m up over the north. */
function lakeLevel(): WorldDoc {
  const water: EntityInput = { id: 'lake', name: 'Lake', tags: ['water'], shape: { kind: 'primitive', primitive: 'box', size: [40, 0.2, 60] }, transform: { position: [10, -0.3, 0] }, material: { preset: 'water' } };
  return gameWorld(
    [
      slab('bed', [0, -2.5, 0], [60, 1, 60]),
      slab('bank', [-20, -0.5, 0], [20, 1, 60]),
      slab('rock', [-22, 0.5, 20], [2, 1, 2], { name: 'Rock' }),
      slab('roof', [-20, 15, -20], [16, 0.5, 16], { name: 'Roof' }),
      water,
    ],
    { environment: { ground: null } },
    [-20, 0.5, 0],
  );
}

const life = (item: Record<string, unknown>) => ({ items: [{ role: 'life', ...item }] });
const place = (w: WorldDoc, item: Record<string, unknown>) => runLevelTool(w, 'place_level_items', life(item));

describe('life: species table', () => {
  it('lists habitats and sensible altitude bands', () => {
    expect(LIFE_SPECIES_IDS).toEqual(expect.arrayContaining(['deer', 'cat', 'bird', 'hawk', 'seagull', 'crow', 'fish', 'koi', 'duck', 'butterfly']));
    expect(LIFE_SPECIES['hawk']?.altitude?.[0]).toBeGreaterThan(LIFE_SPECIES['bird']?.altitude?.[1] ?? 99);
    expect(LIFE_SPECIES['fish']?.habitat).toBe('water');
    expect(LIFE_SPECIES['duck']?.habitat).toBe('surface');
  });
});

describe('place_level_items role "life"', () => {
  it('puts deer on the bank, none in the water, each on the measured ground', async () => {
    const w = lakeLevel();
    const r = await place(w, { id: 'herd', species: 'deer', count: 6, x: -20, z: 0, radius: 9 });
    expect(r.ok).toBe(true);
    expect(r.accepted).toBeGreaterThanOrEqual(4);
    const next = applyPatches(w, r.patches);
    expect(next.errors).toEqual([]);
    expect(Object.keys(next.world.entities).filter((id) => id.startsWith('herd-')).length).toBe(r.accepted);
    for (const p of r.patches) {
      if (p.op !== 'add') continue;
      const e = p.entity;
      expect(e.shape).toMatchObject({ kind: 'asset', id: 'deer' });
      expect(e.transform.position[0]).toBeLessThan(-10);
      expect(e.transform.position[1]).toBeCloseTo(0, 1);
      expect(e.npc?.archetype).toBe('prey');
      expect(e.tags).toContain('animal');
    }
    expect(r.text).toContain('herd:');
    expect(r.text).toMatch(/slopes/);
  });

  it('refuses deer asked for in the lake, with the reason', async () => {
    const r = await place(lakeLevel(), { id: 'wet', species: 'deer', count: 3, x: 10, z: 0, radius: 5 });
    expect(r.ok).toBe(false);
    expect(r.accepted).toBe(0);
    expect(r.text).toMatch(/under water/);
  });

  it('puts fish in deep water away from the bank, below the surface, and keeps their roaming inside', async () => {
    const r = await place(lakeLevel(), { id: 'school', species: 'fish', count: 8, x: 10, z: 0, radius: 12 });
    expect(r.ok).toBe(true);
    expect(r.accepted).toBeGreaterThanOrEqual(5);
    for (const p of r.patches) {
      if (p.op !== 'add') continue;
      const y = p.entity.transform.position[1];
      expect(y).toBeLessThan(-0.2);
      expect(y).toBeGreaterThan(-2.0);
      const wander = p.entity.behaviors.find((b) => b.type === 'wander');
      expect(wander).toBeTruthy();
      const x = p.entity.transform.position[0];
      // The roaming circle stays inside the lake (x from -10 to 30).
      expect(x - Number(wander?.params['radius'])).toBeGreaterThan(-10);
    }
    expect(r.text).toMatch(/depths 1\.8 to 1\.8 m/);
  });

  it('refuses fish on dry ground and in water that is too shallow', async () => {
    const dry = await place(lakeLevel(), { id: 'oops', species: 'fish', count: 2, x: -20, z: 0, radius: 3 });
    expect(dry.ok).toBe(false);
    expect(dry.text).toMatch(/no water there/);
    // A puddle: water 0.05 m over a bed.
    const shallow = gameWorld(
      [slab('bed', [0, -0.5, 0], [30, 1, 30]), { id: 'puddle', name: 'Pond', shape: { kind: 'primitive', primitive: 'box', size: [20, 0.1, 20] }, transform: { position: [0, 0.05, 0] }, material: { preset: 'water' } }],
      {},
      [0, 1, 25],
    );
    const r = await place(shallow, { id: 'f', species: 'koi', count: 2, x: 0, z: 0, radius: 3 });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/too shallow/);
  });

  it('puts ducks on the surface', async () => {
    const r = await place(lakeLevel(), { id: 'ducks', species: 'duck', count: 3, x: 10, z: 5, radius: 8 });
    expect(r.ok).toBe(true);
    for (const p of r.patches) if (p.op === 'add') expect(p.entity.transform.position[1]).toBeCloseTo(-0.23, 1);
  });

  it('flies a flock in clear air above the terrain, circling, never inside the roof', async () => {
    const w = lakeLevel();
    const r = await place(w, { id: 'flock', species: 'crow', count: 10, x: -20, z: -20, radius: 14 });
    expect(r.ok).toBe(true);
    for (const p of r.patches) {
      if (p.op !== 'add') continue;
      const [x, y, z] = p.entity.transform.position;
      // 6 to 20 m above the ground or above the roof top (15.25), never inside the roof slab.
      const insideRoof = Math.abs(x + 20) < 8 && Math.abs(z + 20) < 8 && y > 14.5 && y < 16;
      expect(insideRoof).toBe(false);
      expect(p.entity.behaviors.map((b) => b.type)).toEqual(['orbit', 'bob']);
      expect(p.entity.shape).toMatchObject({ animation: 'fly' });
    }
  });

  it('keeps a hawk high, a butterfly low, and perches a bird on the surface at x,z', async () => {
    const w = lakeLevel();
    const hawk = await place(w, { id: 'h', species: 'hawk', count: 1, x: -20, z: 10, radius: 30 });
    const hy = hawk.patches[0]?.op === 'add' ? hawk.patches[0].entity.transform.position[1] : -99;
    expect(hy).toBeGreaterThanOrEqual(25);
    expect(hawk.patches[0]?.op === 'add' ? hawk.patches[0].entity.shape : null).toMatchObject({ animation: 'glide' });
    const fly = await place(w, { id: 'b', species: 'butterfly', count: 4, x: -22, z: 10, radius: 4 });
    for (const p of fly.patches) if (p.op === 'add') expect(p.entity.transform.position[1]).toBeLessThan(2.2);
    const perched = await place(w, { id: 'p', species: 'bird', count: 1, x: -22, z: 20, perch: true, radius: 1 });
    expect(perched.ok).toBe(true);
    const e = perched.patches[0]?.op === 'add' ? perched.patches[0].entity : null;
    expect(e?.transform.position[1]).toBeCloseTo(1, 1);
    expect(e?.shape).toMatchObject({ animation: 'perch' });
    expect(e?.behaviors).toEqual([]);
  });

  it('refuses an unknown or missing species and a repeated id', async () => {
    const w = lakeLevel();
    expect((await place(w, { id: 'x', species: 'dragon', x: -20, z: 0 })).text).toMatch(/species/);
    expect((await place(w, { id: 'y', x: -20, z: 0 })).text).toMatch(/species/);
    const twice = await runLevelTool(w, 'place_level_items', { items: [{ role: 'life', id: 'a', species: 'cat', x: -20, z: 0 }, { role: 'life', id: 'a', species: 'cat', x: -20, z: 3 }] });
    expect(twice.text).toMatch(/used twice/);
  });

  it('rejects more than 24 animals in one group and bounds the area', async () => {
    const w = lakeLevel();
    expect((await place(w, { id: 'many', species: 'bird', count: 25, x: 0, z: 0 })).ok).toBe(false);
    expect((await place(w, { id: 'wide', species: 'bird', count: 2, x: 0, z: 0, radius: 9999 })).ok).toBe(false);
  });
});

describe('planLife', () => {
  const probe = {
    surface: () => ({ y: 0, slopeDeg: 2, id: null }),
    clear: () => true,
    water: [],
  };
  it('is deterministic for the same request', () => {
    const req = { id: 'g', species: 'deer', count: 5, x: 0, z: 0, radius: 10, yaw: 0 };
    expect(planLife(req, probe).placed.map((p) => p.position)).toEqual(planLife(req, probe).placed.map((p) => p.position));
  });
  it('keeps members apart and inside the area', () => {
    const plan = planLife({ id: 'g', species: 'sheep', count: 12, x: 5, z: 5, radius: 8, yaw: 0 }, probe);
    expect(plan.placed.length).toBeGreaterThanOrEqual(10);
    for (const a of plan.placed) {
      expect(Math.hypot(a.position[0] - 5, a.position[2] - 5)).toBeLessThanOrEqual(8.01);
      for (const b of plan.placed) if (a !== b) expect(Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2])).toBeGreaterThan(0.9);
    }
  });
  it('refuses steep ground with the angle', () => {
    const plan = planLife({ id: 'g', species: 'deer', count: 2, x: 0, z: 0, radius: 4, yaw: 0 }, { ...probe, surface: () => ({ y: 0, slopeDeg: 50, id: null }) });
    expect(plan.placed).toEqual([]);
    expect(plan.refused.join(' ')).toMatch(/too steep \(50 deg\)/);
  });
});
