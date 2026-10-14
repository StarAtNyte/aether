import { describe, expect, it } from 'vitest';
import { createWorld, applyPatches } from '@aether/core';
import { BuildingPlan, applyArchOps, checkBuilding, doorAtFraction, doorAtOp, drawRoomCandidates, drawRoomOp, nextRoomId, pickWall, planOf, roomShape, snapPlanPoint, windowAtOp, PlanError, type P2 } from '../src/index';

const PLAN = BuildingPlan.parse({
  id: 'flat',
  levels: [
    {
      height: 2.8,
      rooms: [
        { id: 'living', type: 'living', rect: [0, 0, 6, 5] },
        { id: 'kitchen', type: 'kitchen', rect: [6, 0, 10, 5] },
      ],
      doors: [
        { between: ['living', 'outside'], side: 'south', main: true },
        { between: ['living', 'kitchen'], kind: 'opening', width: 1.6 },
      ],
    },
  ],
});

function built(): ReturnType<typeof createWorld> {
  const res = applyArchOps(createWorld(), [{ op: 'create_building', plan: PLAN }]);
  expect(res.errors).toEqual([]);
  return res.target;
}

describe('snapPlanPoint', () => {
  const level = PLAN.levels[0]!;
  it('snaps to a nearby room corner first', () => {
    expect(snapPlanPoint([5.85, 4.9], level)).toEqual([6, 5]);
  });
  it('slides onto a nearby edge at grid steps', () => {
    expect(snapPlanPoint([3.04, 5.2], level)).toEqual([3, 5]);
  });
  it('falls back to the grid away from rooms and survives junk input', () => {
    expect(snapPlanPoint([20.04, 30.06], level)).toEqual([20, 30.1]);
    expect(snapPlanPoint([Number.NaN, Number.POSITIVE_INFINITY], null)).toEqual([0, 0]);
  });
});

describe('roomShape', () => {
  it('turns axis rectangles into rect and other outlines into polygons', () => {
    expect(roomShape([[0, 5], [6, 5], [6, 9], [0, 9]])).toEqual({ rect: [0, 5, 6, 9] });
    const l = roomShape([[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]]);
    expect('polygon' in l && l.polygon.length).toBe(6);
  });
  it('refuses degenerate, tiny and self-crossing outlines with a hint', () => {
    expect(() => roomShape([[0, 0], [1, 0]])).toThrow(PlanError);
    expect(() => roomShape([[0, 0], [1, 0], [1, 1], [0, 1]])).toThrow(/smaller/);
    expect(() => roomShape([[0, 0], [4, 4], [4, 0], [0, 4]])).toThrow(/crosses/);
  });
});

describe('drawRoomOp', () => {
  it('adds a room with a door to the neighbour sharing the longest wall, and the result passes the checks', () => {
    const world = built();
    const plan = planOf(world, 'flat');
    const op = drawRoomOp(plan, 0, [[0, 5], [6, 5], [6, 9], [0, 9]], 'bedroom');
    expect(op).toMatchObject({ op: 'add_room', level: 0, room: { id: 'bedroom', type: 'bedroom', rect: [0, 5, 6, 9] }, doors: [{ between: ['living', 'bedroom'] }] });
    const res = applyArchOps(world, [op]);
    expect(res.errors).toEqual([]);
    const after = applyPatches(world, res.patches);
    expect(after.errors).toEqual([]);
    const report = checkBuilding(after.world, 'flat');
    expect(report.rooms).toBe(3);
    expect(report.passed).toBe(true);
  });
  it('refuses rooms overlapping existing ones', () => {
    expect(() => drawRoomOp(PLAN, 0, [[5, 1], [8, 1], [8, 4], [5, 4]], 'office')).toThrow(/overlaps/);
  });
  it('gives the first room of an empty-looking site an entrance', () => {
    const op = drawRoomOp(PLAN, 0, [[20, 0], [24, 0], [24, 4], [20, 4]], 'studio');
    expect(op['doors']).toEqual([{ between: ['studio', 'outside'], width: 1 }]);
  });
  it('makes unique ids', () => {
    expect(nextRoomId(PLAN, 'living')).toBe('living-2');
    expect(nextRoomId(PLAN, 'office')).toBe('office');
  });
});

describe('drawRoomCandidates', () => {
  it('offers the main door first, then other spots, other neighbours and an entrance', () => {
    const c = drawRoomCandidates(PLAN, 0, [[0, 5], [10, 5], [10, 9], [0, 9]], 'bedroom');
    expect(c[0]).toEqual(drawRoomOp(PLAN, 0, [[0, 5], [10, 5], [10, 9], [0, 9]], 'bedroom'));
    const doors = c.map((op) => (op['doors'] as Array<Record<string, unknown>>)[0]);
    expect(doors[1]).toMatchObject({ at: 0.12 });
    expect(doors[2]).toMatchObject({ at: 0.88 });
    // The bedroom also touches the kitchen: a door to it is an alternative.
    expect(doors.some((d) => (d?.['between'] as string[])[0] === 'kitchen')).toBe(true);
    expect(doors.at(-1)).toMatchObject({ between: ['bedroom', 'outside'] });
    expect(c.length).toBeLessThanOrEqual(8);
  });
});

describe('opening tools', () => {
  const level = PLAN.levels[0]!;
  it('picks the shared wall between two rooms and the exterior wall with its side', () => {
    expect(pickWall(level, [6.1, 2.5])?.between).toEqual(['living', 'kitchen']);
    const ext = pickWall(level, [8, 5.2]);
    expect(ext?.between).toEqual(['kitchen', 'outside']);
    expect(ext?.side).toBe('south');
    expect(pickWall(level, [3, 2.5])).toBeNull();
  });
  it('places a door at the clicked point (inverse of the compiler placement)', () => {
    const span = { edge: { a: [0, 0] as P2, b: [6, 0] as P2, length: 6, dir: [1, 0] as P2, out: [0, -1] as P2, side: 'north' as const }, t0: 0, t1: 6 };
    expect(doorAtFraction(span, 0.6, 0.9)).toBe(0);
    expect(doorAtFraction(span, 3, 0.9)).toBeCloseTo(0.5);
    expect(doorAtFraction(span, 5.4, 0.9)).toBe(1);
    const op = doorAtOp(PLAN, 0, [8, 5.1]);
    expect(op).toMatchObject({ op: 'add_door', door: { between: ['kitchen', 'outside'], side: 'south' } });
  });
  it('adds windows only on outside walls', () => {
    expect(windowAtOp(PLAN, 0, [3, -0.1])).toMatchObject({ op: 'add_window', window: { room: 'living', side: 'north' } });
    expect(() => windowAtOp(PLAN, 0, [6, 2.5])).toThrow(/outside walls/);
  });
  it('an added door and window compile and keep the building usable', () => {
    const world = built();
    const plan = planOf(world, 'flat');
    const res = applyArchOps(world, [doorAtOp(plan, 0, [8, 5.1]), windowAtOp(plan, 0, [8, -0.1])]);
    expect(res.errors).toEqual([]);
    expect(res.reports[0]?.passed).toBe(true);
  });
});
