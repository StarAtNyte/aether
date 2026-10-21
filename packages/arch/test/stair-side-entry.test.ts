/**
 * A stair whose first riser stands against a wall cannot be stepped onto from the front, so its foot is entered from
 * the side. The side of the first treads is a wedge: a body pressed against the wall behind the foot has its far edge
 * over treads taller than the 0.35 m the controller climbs. The house a model built had its L stair tucked into the
 * hall's south-east corner (first riser 2 cm from the south wall): the plan check and the building check both called
 * it fine (a clear 0.6 m x 0.9 m strip beside the first treads) and the walkthrough bot wedged against the wall
 * beside the flight and never got upstairs. The side entry now counts only with floor behind the first riser.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { applyArchOps, checkBuilding, parsePlan } from '../src/index';
import { checkStair, stairSideBehind, stairSideReach } from '../src/stair-fit';
import type { PlanStair } from '../src/plan';

const PLAN = JSON.parse(readFileSync(fileURLToPath(new URL('./plans/house-stair-foot-wall.plan.json', import.meta.url)), 'utf8')) as Record<string, unknown>;

function build(plan: unknown, exactStairs: boolean): { world: WorldDoc; lines: string[] } {
  const base = createWorld();
  const res = applyArchOps(base, [{ op: 'create_building', plan, exactStairs }]);
  expect(res.errors).toEqual([]);
  return { world: applyPatches(base, res.patches).world, lines: res.lines };
}

describe('stairs entered from the side', () => {
  it('the controller steps onto the side of the first treads only near the foot', () => {
    // 0.175 m risers on 0.27 m goings: the body's centre at most 0.32 m along (measured with the controller), and it
    // stands 0.375 m from a wall, so the wall behind the first riser must be 5 cm back.
    expect(stairSideReach(0.27, 0.175)).toBeCloseTo(0.32, 2);
    expect(stairSideBehind(0.27, 0.175)).toBeCloseTo(0.055, 2);
    // Shallow treads are climbed from further along the flight.
    expect(stairSideBehind(0.4, 0.15)).toBe(0);
  });

  it('refuses the stair tucked against the wall at its foot, with the measurement', () => {
    const plan = parsePlan(PLAN);
    const s = plan.levels[0]?.stairs[0] as PlanStair;
    const check = checkStair(plan, 0, s);
    expect(check.problems).toHaveLength(1);
    expect(check.problems[0]).toMatch(/no clear landing to step on at its foot: 0\.01 m of floor in front of the first riser/);
  });

  it('the building check agrees when the stair is built as drawn, and create_building moves it to one that works', () => {
    const drawn = build(PLAN, true).world;
    const report = checkBuilding(drawn, 'house');
    expect(report.reachable).toBeLessThan(report.rooms);
    expect(report.issues.some((i) => i.entities.includes('house-l0-stair0') && /no landing a walker can step onto/.test(i.message))).toBe(true);
    const settled = build(PLAN, false);
    expect(settled.lines.some((l) => l.startsWith('stair moved: level 0 stair'))).toBe(true);
    expect(checkBuilding(settled.world, 'house').passed).toBe(true);
  });
});
