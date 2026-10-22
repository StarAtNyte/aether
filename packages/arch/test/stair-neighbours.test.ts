/**
 * What a stair needs beyond its own landings, found by sweeping generated houses with the walkthrough bot
 * (packages/playtest/test/stair-sweep.test.ts): the floor in front of a hinged door where the leaf swings, the
 * stairwell of the stair below, the landing that stair comes out onto, and the lane between two stairwells.
 * Each case is a house the sweep showed the bot could not walk (or the building check refused) with the stair
 * where the plan check used to accept it; `checkStair` now says why, and `settleStairs` moves the stair.
 */
import { describe, expect, it } from 'vitest';
import { parsePlan } from '../src/compile';
import type { PlanStair } from '../src/plan';
import { checkStair, settleStairs, stairInDoorSwing, levelDoors } from '../src/stair-fit';
import { generateHouse } from './support/house-gen';

/** The generated house `seed` (no furniture) with the stairs of level `li` replaced. */
function houseWith(seed: number, stairs: Array<[number, PlanStair]>): ReturnType<typeof parsePlan> {
  const plan = generateHouse(seed, { furnish: false }).plan as { levels: Array<{ stairs?: PlanStair[] }> };
  for (const level of plan.levels) level.stairs = [];
  for (const [li, s] of stairs) (plan.levels[li] as { stairs: PlanStair[] }).stairs.push(s);
  return parsePlan(plan);
}

const U_WEST: PlanStair = { at: [3.92, 1.61], heading: 'west', shape: 'u', width: 0.9, turn: 'right' };

describe('a stair beside a hinged door', () => {
  it('doors know which way their leaf swings and where the hinge is', () => {
    const plan = houseWith(37, [[0, U_WEST]]);
    const door = levelDoors(plan)[1]?.find((d) => d.swing);
    // The upstairs door between the landing and the bedroom swings into the bedroom (the stair's room), to the west.
    expect(door?.swing?.into[0]).toBeCloseTo(-1, 5);
    expect(door?.swing?.leaf).toBeGreaterThan(0.7);
  });

  it('refuses a stairwell balustrade that leaves a pocket beside the hinge, with the measurement', () => {
    const plan = houseWith(37, [[0, U_WEST]]);
    const check = checkStair(plan, 0, U_WEST);
    expect(check.problems.some((p) => /upstairs the stairwell balustrade stands \d\.\d\d m in front of the door house-l1-d0 .* where the leaf swings/.test(p)), check.problems.join('; ')).toBe(true);
  });

  it('a stair flush with the hinge side leaves no pocket and the doorway in front is walked straight', () => {
    const plan = houseWith(37, [[0, U_WEST]]);
    const door = levelDoors(plan)[1]?.find((d) => d.swing);
    expect(door).toBeDefined();
    if (!door) return;
    const box = (x0: number, z0: number, x1: number, z1: number): Array<[number, number]> => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const [dx, dz] = door.at;
    const into = door.swing?.into ?? [-1, 0];
    // Something right in the doorway's line, within the leaf's swing: refused.
    const ahead = box(dx + into[0] * 0.5 - 0.3, dz - 0.3, dx + into[0] * 0.5 + 0.3, dz + 0.3);
    expect(stairInDoorSwing(door, ahead)).not.toBeNull();
    // Far from the door: clear.
    const far = box(dx + into[0] * 3 - 0.3, dz - 0.3, dx + into[0] * 3 + 0.3, dz + 0.3);
    expect(stairInDoorSwing(door, far)).toBeNull();
  });

  it('create_building moves it to a stair that works', () => {
    const plan = houseWith(37, [[0, U_WEST]]);
    const settled = settleStairs(plan);
    expect(settled.failing).toEqual([]);
    expect(settled.moved).toHaveLength(1);
    const s = settled.plan.levels[0]?.stairs[0] as PlanStair;
    expect(checkStair(settled.plan, 0, s).problems).toEqual([]);
  });
});

describe('stairs on consecutive storeys', () => {
  it('a flight cannot start over the stairwell of the stair below', () => {
    // Level 0's stair arrives in the west room of level 1; this L stair starts inside the hole it leaves.
    const below: PlanStair = { at: [0.61, 4.32], heading: 'north', shape: 'u', width: 0.9, turn: 'right' };
    const above: PlanStair = { at: [3.52, 0.66], heading: 'west', shape: 'l', width: 1, turn: 'left' };
    const plan = houseWith(36, [[0, below], [1, above]]);
    const check = checkStair(plan, 1, above);
    expect(check.problems.some((p) => /stands in the stairwell of the stair from level 0/.test(p)), check.problems.join('; ')).toBe(true);
  });

  it('nor on the landing the stair below comes out onto', () => {
    const plan = houseWith(15, [[0, { at: [3.1, 1.5], heading: 'south', shape: 'straight', width: 0.9, turn: 'left' }], [1, { at: [5.48, 6.84], heading: 'west', shape: 'straight', width: 1, turn: 'left' }]]);
    const check = checkStair(plan, 1, plan.levels[1]?.stairs[0] as PlanStair);
    expect(check.problems.some((p) => /stands on the landing where the stair from level 0/.test(p)), check.problems.join('; ')).toBe(true);
  });

  it('nor leave a lane between the two stairwells that no walker fits', () => {
    const plan = houseWith(23, [[0, { at: [1.61, 5.65], heading: 'north', shape: 'u', width: 0.9, turn: 'left' }], [1, { at: [0.86, 7.84], heading: 'east', shape: 'l', width: 1, turn: 'left' }]]);
    const check = checkStair(plan, 1, plan.levels[1]?.stairs[0] as PlanStair);
    expect(check.problems.some((p) => /it leaves \d\.\d\d m between itself and the stairwell of the stair from level 0/.test(p) && /narrower than the 0\.80 m a walker needs/.test(p)), check.problems.join('; ')).toBe(true);
  });
});
