/**
 * People and the bot on a narrow flight.
 *
 * The planner house with three bedrooms and a family of four, its stair drawn at [3.06, 0.66] (a 1 m flight along the
 * north wall, the stairwell's railing above it): a resident walked the upstairs walkway beside the stairwell towards
 * the bot, which stood its ground and was pushed against the railing until the watchdog marked the way bad and
 * the walkthrough ended "the player got stuck on villa-l1-rail0".
 *
 * Both sides give way now: a resident in a building stops and steps aside (right, left, else back) for a player who is
 * ahead of it, and the bot, near a stair or its stairwell, steps away from a resident in its way and waits (bounded),
 * or waits at the foot of the stair while one is on the flight.
 */
import { applyArchOps } from '@aether/arch';
import { createWorld, type WorldDoc } from '@aether/core';
import { ensureAssetCatalog } from '@aether/physics';
import { describe, expect, it } from 'vitest';
import { walkthrough } from '../src';
import { Session, STEP } from '../src/session';
import { planArch } from '../../agent/src/providers/mock/arch';

const TEXT = 'a 3 bedroom two-storey house for a family of four';

async function house(text: string, at: readonly [number, number]): Promise<WorldDoc> {
  const plan = (planArch(text, '')?.arch?.ops[0] as { plan: { levels: Array<{ stairs: unknown[] }> } }).plan;
  plan.levels[0]!.stairs = [{ at, heading: 'east', width: 1 }];
  const built = applyArchOps(createWorld(), [{ op: 'create_building', plan }]);
  expect(built.errors).toEqual([]);
  await ensureAssetCatalog(built.target);
  return built.target;
}

describe('residents and the bot on the stair', () => {
  for (const at of [[3.06, 0.66], [0.2, 1.2], [1.46, 0.66]] as const) {
    it(`three bedrooms, a family of four, stair drawn at (${at[0]}, ${at[1]}): every room is walked, nothing stuck`, async () => {
      const r = await walkthrough(await house(TEXT, at), { trace: false });
      expect(r.status, r.summary).toBe('passed');
      expect(r.findings.filter((f) => f.code === 'stuck' || f.code === 'clipping')).toEqual([]);
    }, 300_000);
  }

  it('a resident who walks the way towards the player steps aside instead of pushing the player into the railing', async () => {
    const world = await house(TEXT, [3.06, 0.66]);
    const session = await Session.create(world, { trace: false });
    // The player stands on the upstairs walkway beside the stairwell, where the resident passes at about 46 s.
    session.character.teleport([5.2, 3.4, 1.75]);
    let moved = 0;
    for (let i = 0; i < Math.round(70 / STEP) && !session.over; i++) {
      session.tick({ forward: 0, right: 0, jump: false, yawDeg: session.yawDeg });
      const p = session.position;
      moved = Math.max(moved, Math.hypot(p[0] - 5.2, p[2] - 1.75));
      // Never lifted onto the railing (the floor is at 3.25).
      expect(p[1]).toBeLessThan(3.6);
    }
    expect(moved).toBeLessThan(0.35);
  }, 300_000);
});
