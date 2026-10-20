/**
 * A leap whose arc passes through a hazard is not a way across: the bot takes the bridge instead of jumping the
 * river and being carried back to the start over and over (acceptance: Codex's forest after "make the wolves patrol
 * along the river bank" failed with "the player got stuck on forest-ground").
 */
import { describe, expect, it } from 'vitest';
import type { EntityInput, Vec3 } from '@aether/core';
import { playtest } from '../src';
import { coin, gameWorld, slab, winAt } from './helpers';

/** Spray over the 3 m gorge between the banks, from x0 to x1: any leap across it passes through. */
function spray(id: string, x0: number, x1: number): EntityInput {
  return {
    id,
    name: 'River',
    shape: { kind: 'primitive', primitive: 'box', size: [x1 - x0, 0.4, 3] },
    transform: { position: [(x0 + x1) / 2, 1.8, -1.5] as Vec3 },
    behaviors: [{ type: 'hazard', params: { mode: 'respawn', text: 'The current carries you back.' } }],
  };
}

function world(withBridge: boolean): ReturnType<typeof gameWorld> {
  const entities: EntityInput[] = [slab('south-bank', [0, 0.5, 6], [40, 1, 12]), slab('north-bank', [0, 0.5, -9], [40, 1, 12]), coin('lantern', [0, 1.6, -10])];
  if (withBridge) entities.push(spray('river-w', -20, 5), spray('river-e', 9, 20), slab('bridge', [7, 0.95, -1.5], [2.4, 0.1, 3.4]));
  else entities.push(spray('river', -20, 20));
  return gameWorld(entities, { rules: [winAt(1)], state: { score: 0 }, environment: { ground: null } }, [0, 1.1, 6]);
}

describe('hazards under a jump', () => {
  it('crosses by the bridge instead of leaping through the river', async () => {
    const r = await playtest(world(true), { trace: true });
    expect(r.status, r.summary).toBe('passed');
    // It went round by the bridge (it never touched the water, so no trip back to the start).
    const xs = (r.path ?? []).map((p) => p[0]);
    expect(Math.max(...xs)).toBeGreaterThan(5);
    expect(r.findings.some((f) => f.code === 'stuck')).toBe(false);
  }, 120_000);

  it('without a bridge the far bank is honestly out of reach, not a respawn loop blamed on the floor', async () => {
    const r = await playtest(world(false), { maxSimSeconds: 60 });
    expect(r.status).not.toBe('passed');
    expect(r.findings.some((f) => f.code === 'stuck' && f.entities.includes('south-bank'))).toBe(false);
    expect(r.findings.some((f) => f.code === 'unreachable_objective' || f.code === 'stuck')).toBe(true);
  }, 120_000);
});
