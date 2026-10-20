/**
 * "add a window to the kitchen" when the kitchen wall already has one: the new window joins the wall's evenly
 * spread windows instead of being compiled on top of the first one and silently dropped.
 */
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { applyArchOps, planOf } from '../src/index';

const PLAN = {
  id: 'flat',
  levels: [
    {
      height: 2.8,
      rooms: [
        { id: 'living', type: 'living', rect: [0, 0, 6, 5] },
        { id: 'kitchen', type: 'kitchen', rect: [6, 0, 12, 5] },
      ],
      doors: [{ between: ['living', 'outside'], side: 'south', main: true }, { between: ['living', 'kitchen'], kind: 'opening', width: 1.6 }],
      windows: [{ room: 'kitchen', side: 'north', width: 1.2 }],
    },
  ],
};

/** Window frames on the kitchen's north wall (z = 0, x between 6 and 12). */
function windowsOf(world: WorldDoc, _room: string): number {
  return Object.values(world.entities).filter((e) => /-win\d+$/.test(e.id) && Math.abs(e.transform.position[2]) < 0.2 && e.transform.position[0] > 6 && e.transform.position[0] < 12).length;
}

describe('add_window', () => {
  it('a second window on the same wall is spread beside the first, not dropped', () => {
    const base = createWorld();
    const first = applyArchOps(base, [{ op: 'create_building', plan: PLAN }]);
    expect(first.errors).toEqual([]);
    const world = applyPatches(base, first.patches).world;
    const before = windowsOf(world, 'kitchen');
    expect(before).toBe(1);
    const res = applyArchOps(world, [{ op: 'add_window', building: 'flat', level: 0, window: { room: 'kitchen', side: 'north', width: 1.2 } }]);
    expect(res.errors).toEqual([]);
    const after = applyPatches(world, res.patches).world;
    expect(windowsOf(after, 'kitchen')).toBe(2);
    expect(planOf(after, 'flat')?.levels[0]?.windows.filter((w) => w.room === 'kitchen')).toHaveLength(1);
  });
});
