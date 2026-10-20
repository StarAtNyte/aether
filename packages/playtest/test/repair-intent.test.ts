import { describe, expect, it } from 'vitest';
import type { EntityInput } from '@aether/core';
import { selfRepair, type SelfRepairResult } from '../src';
import { gameWorld } from './helpers';

function brief(r: SelfRepairResult): string {
  return JSON.stringify({ passed: r.passed, sentence: r.sentence, rounds: r.rounds.map((x) => x.report.summary) });
}

function tier(id: string, y: number, diameter: number, height: number): EntityInput {
  return { id, name: id, shape: { kind: 'primitive', primitive: 'cylinder', size: [diameter, height, diameter] }, transform: { position: [0, y, -32] }, physics: { body: 'static' } };
}

/** The shrine on a stepped hill whose last tier is a 3 m wall (the acceptance run's world, reduced). */
function shrineOnHill(topHeight: number): EntityInput[] {
  const top = 3 + topHeight;
  return [
    tier('hill-base', 0.5, 32, 1),
    tier('hill-mid', 2, 22, 2),
    tier('hill-top', 3 + topHeight / 2, 12, topHeight),
    { id: 'shrine', name: 'Shrine', tags: ['focus'], shape: { kind: 'primitive', primitive: 'box', size: [4, 5, 1] }, transform: { position: [0, top + 2.5, -32] }, physics: { body: 'static' } },
    { id: 'shrine-light', shape: { kind: 'none' }, transform: { position: [0, top + 3, -29] }, light: { type: 'spot', color: '#ffb070', intensity: 25, range: 22, angle: 60, castShadow: false } },
    { id: 'summit-zone', name: 'Shrine goal', shape: { kind: 'none' }, transform: { position: [0, top + 1, -30] }, behaviors: [{ type: 'goal', params: { margin: 1.5, text: 'The shrine glows. You win!' } }] },
  ];
}

describe('self-repair keeps a goal where it belongs', () => {
  it('builds steps up to a goal on a summit instead of moving the goal off the hill', async () => {
    const world = gameWorld(shrineOnHill(3), {}, [0, 1, 8]);
    const r = await selfRepair(world);
    expect(r.passed, brief(r)).toBe(true);
    // The goal and the shrine are where they were.
    expect(r.world.entities['summit-zone']?.transform.position).toEqual(world.entities['summit-zone']?.transform.position);
    expect(r.world.entities['shrine']?.transform.position).toEqual(world.entities['shrine']?.transform.position);
    expect(r.applied.some((a) => /^Built \d+ steps up hill-top so Shrine goal \(summit-zone\) can be reached where it is/.test(a.sentence)), brief(r)).toBe(true);
    const steps = Object.values(r.world.entities).filter((e) => e.tags.includes('steps'));
    expect(steps.length).toBeGreaterThan(3);
    expect(steps.every((e) => e.attachedTo === 'hill-top' && e.physics?.body === 'static')).toBe(true);
  }, 240_000);

  it('says so plainly when no steps reach it, and leaves the goal at the shrine', async () => {
    // A 40 m column: too high for a flight of steps or blocks.
    const world = gameWorld(shrineOnHill(40), {}, [0, 1, 8]);
    const r = await selfRepair(world, { maxRounds: 2 });
    expect(r.passed).toBe(false);
    expect(r.world.entities['summit-zone']?.transform.position).toEqual(world.entities['summit-zone']?.transform.position);
    expect(r.applied.some((a) => a.patches.some((p) => p.op === 'update' && p.id === 'summit-zone'))).toBe(false);
    expect(r.sentence).toMatch(/I left Shrine goal \(summit-zone\) at Shrine \(shrine\), where it belongs/);
  }, 240_000);
});
