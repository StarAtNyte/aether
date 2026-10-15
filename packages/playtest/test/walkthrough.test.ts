import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, summarizeWorld, type WorldDoc } from '@aether/core';
import { applyArchOps } from '@aether/arch';
import { planArch } from '../../agent/src/providers/mock/arch';
import { selfRepair, walkthrough } from '../src';

/** A building from the offline architecture planner (the studio's own showcase prompts). */
function house(prompt: string): WorldDoc {
  const base = createWorld();
  const plan = planArch(prompt, summarizeWorld(base));
  if (!plan?.arch) throw new Error(`no plan for ${prompt}`);
  const env = applyPatches(base, plan.patches);
  const res = applyArchOps(env.world, plan.arch.ops);
  return applyPatches(env.world, res.patches).world;
}

describe('walkthrough bot', () => {
  it('walks a two-bedroom apartment: every room, every door', async () => {
    const r = await walkthrough(house('a modern two-bedroom apartment'));
    expect(r.kind).toBe('walkthrough');
    expect(r.status, r.summary).toBe('passed');
    expect(r.objectives.every((o) => o.status === 'done')).toBe(true);
    expect(r.objectives.length).toBeGreaterThanOrEqual(5);
    expect(r.trace?.events.filter((e) => e.kind === 'door').length).toBeGreaterThan(0);
    expect(r.summary).toMatch(/^Verified walkable/);
  }, 120_000);

  it('walks an office floor with meeting rooms', async () => {
    const r = await walkthrough(house('an office floor with meeting rooms'));
    expect(r.status, r.summary).toBe('passed');
  }, 120_000);

  it('finds a doorway too narrow for the player and widens it', async () => {
    const world = house('a small café interior');
    const before = await walkthrough(world);
    expect(before.status, before.summary).toBe('failed');
    const narrow = before.findings.find((f) => f.code === 'door_blocked');
    expect(narrow, before.summary).toBeDefined();
    expect(narrow?.message).toMatch(/too narrow for the player/);
    const r = await selfRepair(world, { kind: 'walkthrough', maxRounds: 3 });
    expect(r.passed, r.sentence).toBe(true);
    expect(r.applied[0]?.sentence).toMatch(/^Widened the washroom door from 0\.8 m to 0\.9 m/);
    expect(r.report.status).toBe('passed');
  }, 180_000);

  it('says so honestly when a world has no building', async () => {
    const r = await walkthrough(createWorld());
    expect(r.status).toBe('inconclusive');
    expect(r.summary).toMatch(/Nothing to walk through/);
  });
});
