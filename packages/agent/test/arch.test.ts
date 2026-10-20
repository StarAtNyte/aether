import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, summarizeWorld, type WorldDoc } from '@aether/core';
import { applyArchOps, checkBuildings } from '@aether/arch';
import { planArch } from '../src/providers/mock/arch';

/** Offline planner themes for real-life architecture (the studio's showcase prompts). */
const THEMES = [
  'a modern two-bedroom apartment',
  'scandinavian living room with a fireplace',
  'a small café interior',
  'a two-storey villa with a pool',
  'an office floor with meeting rooms',
  'an industrial loft',
  'a japandi bedroom',
  'a three-bedroom apartment with a classic style',
];

function build(prompt: string, base: WorldDoc = createWorld()): { world: WorldDoc; lines: string[] } {
  const plan = planArch(prompt, summarizeWorld(base));
  expect(plan, prompt).not.toBeNull();
  const env = applyPatches(base, plan!.patches);
  expect(env.errors).toEqual([]);
  const res = applyArchOps(env.world, plan!.arch!.ops);
  expect(res.errors, prompt).toEqual([]);
  const after = applyPatches(env.world, res.patches);
  expect(after.errors).toEqual([]);
  return { world: after.world, lines: res.lines };
}

describe('offline architecture planner', () => {
  for (const prompt of THEMES) {
    it(`"${prompt}" builds a physically usable interior`, () => {
      const { world } = build(prompt);
      const reports = checkBuildings(world, '*', 0.8);
      expect(reports).toHaveLength(1);
      const r = reports[0]!;
      // Every room reachable on foot, doors swing free, furniture grounded without overlaps.
      expect(r.issues).toEqual([]);
      expect(r.passed).toBe(true);
      expect(r.rooms).toBeGreaterThan(0);
      // A walkthrough spawn, a navigable test and real light sources.
      expect(world.player.mode).toBe('firstPerson');
      expect(world.tests.some((t) => t.kind === 'navigable')).toBe(true);
      expect(Object.values(world.entities).some((e) => e.light !== undefined && e.arch?.role === 'light')).toBe(true);
      // Buildings stand on a site (forecourt or terrace), not bare lawn.
      expect(Object.values(world.entities).some((e) => e.arch?.role === 'site')).toBe(true);
    });
  }

  it('uses realistic proportions: doors 0.8–1.4 m wide, ceilings 2.6–3.5 m, rooms of a sensible size', () => {
    for (const prompt of THEMES) {
      const plan = planArch(prompt, '');
      const op = plan!.arch!.ops[0] as { plan: { levels: Array<{ height: number; rooms: Array<{ rect: number[] }>; doors: Array<{ width?: number; kind?: string }> }> } };
      for (const l of op.plan.levels) {
        expect(l.height).toBeGreaterThanOrEqual(2.6);
        expect(l.height).toBeLessThanOrEqual(3.5);
        for (const d of l.doors) if (d.kind !== 'opening') expect(d.width ?? 0.9).toBeGreaterThanOrEqual(0.8);
        for (const r of l.rooms) {
          const [x0, z0, x1, z1] = r.rect as [number, number, number, number];
          expect(Math.min(x1 - x0, z1 - z0)).toBeGreaterThanOrEqual(1.5);
        }
      }
    }
  });

  it('edits the existing building instead of starting over', () => {
    const { world } = build('a modern two-bedroom apartment');
    const edit = planArch('make it scandinavian with marble floors in the kitchen and a gable roof', summarizeWorld(world));
    expect(edit?.patches).toEqual([]);
    const ops = edit!.arch!.ops as Array<{ op: string }>;
    expect(ops.map((o) => o.op)).toEqual(expect.arrayContaining(['set_style', 'set_roof', 'set_material']));
    const res = applyArchOps(world, ops);
    expect(res.errors).toEqual([]);
    expect(res.reports.every((r) => r.passed)).toBe(true);
  });

  it('adds and removes the people of a house by prompt, keeping the house walkable', () => {
    const { world } = build('a modern two-bedroom apartment');
    const people = (w: WorldDoc): number => Object.values(w.entities).filter((e) => e.arch?.role === 'resident').length;
    expect(people(world)).toBe(0);
    const add = planArch('add two people to the living room', summarizeWorld(world));
    const ops = add!.arch!.ops as Array<{ op: string; count?: number }>;
    expect(ops).toEqual([{ op: 'set_residents', building: expect.any(String), count: 2 }]);
    const res = applyArchOps(world, ops as never);
    expect(res.errors).toEqual([]);
    expect(people(res.target)).toBe(2);
    expect(res.reports.every((r) => r.passed)).toBe(true);
    const few = planArch('invite a few guests', summarizeWorld(res.target));
    expect((few!.arch!.ops as Array<{ count?: number }>)[0]?.count).toBe(3);
    const gone = planArch('remove the people', summarizeWorld(res.target));
    expect(gone!.arch!.ops).toEqual([{ op: 'set_residents', building: expect.any(String), count: 0 }]);
    expect(people(applyArchOps(res.target, gone!.arch!.ops as never).target)).toBe(0);
  });

  it('leaves games and block worlds to the other planners', () => {
    expect(planArch('a minecraft village of block houses', '')).toBeNull();
    expect(planArch('a coin collecting game in a haunted house', '')).toBeNull();
    expect(planArch('a castle on a hill', '')).toBeNull();
  });
});
