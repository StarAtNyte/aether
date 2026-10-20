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

/** Windows of a room as compiled (role window, room entity id `${building}-l${level}-${room}`). */
function roomWindows(world: WorldDoc, building: string, room: string, level = 0): Array<{ x: number; z: number }> {
  return Object.values(world.entities)
    .filter((e) => e.arch?.role === 'window' && e.arch.room === `${building}-l${level}-${room}`)
    .map((e) => ({ x: e.transform.position[0], z: e.transform.position[2] }));
}

const AUTO = {
  id: 'home',
  levels: [
    {
      height: 2.9,
      rooms: [
        { id: 'living', type: 'living', rect: [0, 0, 6, 5] },
        { id: 'kitchen', type: 'kitchen', rect: [6, 0, 10, 5] },
        { id: 'bed', type: 'bedroom', rect: [10, 0, 14, 5] },
      ],
      doors: [{ between: ['living', 'outside'], side: 'south', main: true }, { between: ['living', 'kitchen'], kind: 'opening', width: 1.6 }, { between: ['kitchen', 'bed'] }],
    },
  ],
};

describe('add_window without a side', () => {
  it('puts the window on an empty exterior wall when the room has one', () => {
    const base = createWorld();
    const plan = { ...AUTO, levels: [{ ...AUTO.levels[0], autoWindows: false, windows: [{ room: 'kitchen', side: 'north', count: 1, width: 1.2 }] }] };
    const world = applyPatches(base, applyArchOps(base, [{ op: 'create_building', plan }]).patches).world;
    const res = applyArchOps(world, [{ op: 'add_window', building: 'home', window: { room: 'kitchen' } }]);
    expect(res.errors).toEqual([]);
    expect(res.lines.join(' ')).toMatch(/1 window\(s\) 1\.2 m wide on the south wall of kitchen \(centred/);
    const now = roomWindows(applyPatches(world, res.patches).world, 'home', 'kitchen');
    expect(now).toHaveLength(2);
    expect(now.some((w) => Math.abs(w.z - 5) < 0.2 && Math.abs(w.x - 8) < 0.05)).toBe(true);
  });

  it('keeps the automatic windows of the room and adds one (re-spreading a full row)', () => {
    const base = createWorld();
    const world = applyPatches(base, applyArchOps(base, [{ op: 'create_building', plan: AUTO }]).patches).world;
    const before = roomWindows(world, 'home', 'kitchen');
    expect(before.length).toBeGreaterThan(0);
    const res = applyArchOps(world, [{ op: 'add_window', building: 'home', window: { room: 'kitchen' } }]);
    expect(res.errors).toEqual([]);
    expect(res.lines.join(' ')).toMatch(/1 window\(s\) on the north wall of kitchen \(the row there re-spread evenly\)/);
    const after = applyPatches(world, res.patches).world;
    const now = roomWindows(after, 'home', 'kitchen');
    expect(now).toHaveLength(before.length + 1);
    // The windows on the other walls stay where they were.
    for (const w of before.filter((b) => b.z > 1)) expect(now.some((n) => Math.abs(n.x - w.x) < 0.01 && Math.abs(n.z - w.z) < 0.01)).toBe(true);
    // No compile note about a window that did not fit, and the house stays usable.
    expect(res.compiled.flatMap((c) => c.notes).filter((n) => /window/.test(n))).toEqual([]);
    expect(res.reports.every((r) => r.passed)).toBe(true);
  });

  it('a side named on a wall with automatic windows adds one instead of replacing them', () => {
    const base = createWorld();
    const world = applyPatches(base, applyArchOps(base, [{ op: 'create_building', plan: AUTO }]).patches).world;
    const before = roomWindows(world, 'home', 'kitchen').length;
    const res = applyArchOps(world, [{ op: 'add_window', building: 'home', level: 0, window: { room: 'kitchen', side: 'south', width: 1 } }]);
    expect(res.errors).toEqual([]);
    expect(roomWindows(applyPatches(world, res.patches).world, 'home', 'kitchen')).toHaveLength(before + 1);
  });

  it('finds the room on its storey when no level is given', () => {
    const plan = { ...AUTO, levels: [AUTO.levels[0], { height: 2.9, rooms: [{ id: 'study', type: 'office', rect: [0, 0, 6, 5] }], doors: [], autoWindows: false }] };
    const base = createWorld();
    const world = applyPatches(base, applyArchOps(base, [{ op: 'create_building', plan, walkthrough: false }]).patches).world;
    const res = applyArchOps(world, [{ op: 'add_window', building: 'home', window: { room: 'study', count: 2 } }]);
    expect(res.errors).toEqual([]);
    expect(res.lines.join(' ')).toMatch(/level 1: 2 window/);
    expect(roomWindows(applyPatches(world, res.patches).world, 'home', 'study', 1)).toHaveLength(2);
  });

  it('refuses with the measured clear wall when nothing fits', () => {
    const base = createWorld();
    const world = applyPatches(base, applyArchOps(base, [{ op: 'create_building', plan: AUTO }]).patches).world;
    const res = applyArchOps(world, [{ op: 'add_window', building: 'home', window: { room: 'kitchen', width: 6 } }]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]?.code).toBe('no_wall_space');
    expect(res.errors[0]?.hint).toMatch(/Widest clear stretch per exterior wall .*north \d+\.\d\d m/);
  });
});
