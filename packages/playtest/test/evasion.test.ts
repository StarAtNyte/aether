import { describe, expect, it } from 'vitest';
import type { EntityInput, Vec3, WorldDoc } from '@aether/core';
import { playtest } from '../src';
import { mockApply } from '../../agent/test/helpers';
import { coin, gameWorld, winAt } from './helpers';

const LANTERNS = 'a night forest adventure: collect 5 lanterns, avoid the wolves, reach the shrine to win';

function wolf(id: string, at: Vec3, over: Partial<NonNullable<EntityInput['npc']>> = {}): EntityInput {
  return {
    id,
    tags: ['npc', 'wolf'],
    shape: { kind: 'primitive', primitive: 'capsule', size: [0.6, 1, 0.6] },
    transform: { position: at },
    physics: { body: 'kinematic' },
    npc: { role: 'wolf', faction: 'wolves', archetype: 'predator', speed: 2, runSpeed: 4.5, perception: { sight: 20, fov: 360, hearing: 12, memory: 8, alert: 20 }, attack: { range: 1.4, damage: 10, cooldown: 0.9 }, leash: 60, wander: 4, ...over },
  };
}

function hits(w: WorldDoc): number {
  return Object.values(w.entities).filter((e) => e.npc?.archetype === 'predator').length;
}

describe('the playtest bot keeps out of enemies’ reach', () => {
  it('wins the offline Lantern Hunt with its wolf pack, before and after "make the wolves slower"', async () => {
    const built = (await mockApply(LANTERNS)).result.world;
    expect(hits(built)).toBeGreaterThanOrEqual(3);
    const first = await playtest(built, { trace: true });
    expect(first.status, first.summary).toBe('passed');
    expect(first.objectives.filter((o) => o.required).every((o) => o.status === 'done')).toBe(true);
    // The lantern by the den is taken too: the pack does not pin the bot.
    expect(first.trace?.events.filter((e) => e.kind === 'pickup')).toHaveLength(5);
    expect(first.stats?.evasions ?? 0).toBeGreaterThan(0);

    const slower = await mockApply('make the wolves slower', built);
    const npc = Object.values(slower.result.world.entities).find((e) => e.npc?.archetype === 'predator')?.npc;
    const before = Object.values(built.entities).find((e) => e.npc?.archetype === 'predator')?.npc;
    expect(npc?.runSpeed ?? 99).toBeLessThan(before?.runSpeed ?? 0);
    const second = await playtest(slower.result.world, { trace: false });
    expect(second.status, second.summary).toBe('passed');

    // Twice slower still verifies (the verdict does not flip with gentler enemies).
    const slowest = await mockApply('make the wolves slower', slower.result.world);
    const third = await playtest(slowest.result.world, { trace: false });
    expect(third.status, third.summary).toBe('passed');
  }, 240_000);

  it('plays the same way every time (deterministic)', async () => {
    const built = (await mockApply(LANTERNS)).result.world;
    const a = await playtest(built, { trace: false });
    const b = await playtest(built, { trace: false });
    expect(b.steps).toBe(a.steps);
    expect(b.seconds).toBe(a.seconds);
    expect(b.path).toEqual(a.path);
  }, 120_000);

  it('routes round a pack that sits between the spawn and the coins instead of walking into it', async () => {
    // Three hard-biting wolves camp on the straight line to the coins (three bites end the game); the player is faster than they run.
    const bite = { attack: { range: 1.4, damage: 34, cooldown: 0.9 } };
    const world = gameWorld(
      [coin('c1', [0, 1, -22]), coin('c2', [4, 1, -24]), wolf('w1', [0, 0, -11], bite), wolf('w2', [1.5, 0, -12], bite), wolf('w3', [-1.5, 0, -12], bite)],
      { rules: [winAt(2)], state: { score: 0, health: 100 } },
    );
    const r = await playtest(world, { trace: false });
    expect(r.status, r.summary).toBe('passed');
    expect(r.findings.some((f) => f.code === 'lost')).toBe(false);
  }, 120_000);

  it('waits for a calm guard to move off the coin it stands by, then takes it', async () => {
    // A short-sighted guard stands over the coin for a few seconds before walking its beat; one blow ends the game.
    const guard: EntityInput = {
      id: 'guard',
      tags: ['npc'],
      shape: { kind: 'primitive', primitive: 'capsule', size: [0.6, 1.8, 0.6] },
      transform: { position: [0, 0.9, -13] },
      physics: { body: 'kinematic' },
      npc: { role: 'guard', faction: 'watch', archetype: 'guard', speed: 1.6, runSpeed: 3, perception: { sight: 2.6, fov: 100, hearing: 0, memory: 1, alert: 0 }, attack: { range: 1.6, damage: 100, cooldown: 1 }, leash: 6, waypoints: [[0, 0, -13], [12, 0, -13]], patrol: { mode: 'pingpong', wait: 4 } },
    };
    const world = gameWorld([coin('c1', [0, 1, -12]), guard], { rules: [winAt(1)], state: { score: 0, health: 100 } });
    const r = await playtest(world, { trace: false });
    expect(r.status, r.summary).toBe('passed');
  }, 120_000);
});
