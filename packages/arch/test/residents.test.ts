import { describe, expect, it } from 'vitest';
import { Entity, createWorld, applyPatches, type WorldDoc } from '@aether/core';
import { applyArchOps } from '../src/ops';
import { compileBuilding } from '../src/compile';
import { checkBuilding } from '../src/nav';
import { planResidents, MAX_RESIDENTS, type KeepOut, type ResidentRoom } from '../src/residents';
import { APARTMENT } from './fixtures';

const WITH = { ...APARTMENT, residents: 3 };

function residents(c: ReturnType<typeof compileBuilding>) {
  return c.entities.filter((e) => e.arch?.role === 'resident');
}

/** Distance from a point to the nearest edge of a polygon. */
function edgeDist(p: [number, number], poly: ReadonlyArray<[number, number]>): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as [number, number];
    const b = poly[(i + 1) % poly.length] as [number, number];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz));
  }
  return best;
}

describe('residents', () => {
  it('an empty plan has nobody; a plan with residents gets that many rigged, talking people', () => {
    expect(residents(compileBuilding(APARTMENT))).toHaveLength(0);
    const people = residents(compileBuilding(WITH));
    expect(people).toHaveLength(3);
    for (const p of people) {
      const e = Entity.parse(p);
      expect(e.character?.wardrobe).toBeDefined();
      expect(e.npc?.dialogue?.nodes['start']).toBeDefined();
      expect(e.physics?.body).toBe('kinematic');
      expect(e.tags).toContain('resident');
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(residents(compileBuilding(WITH)))).toBe(JSON.stringify(residents(compileBuilding(WITH))));
  });

  it('puts people in living spaces, never in bathrooms or storerooms', () => {
    const c = compileBuilding({ ...WITH, residents: 8 });
    const kinds = new Map(c.rooms.map((r) => [r.id, r.type]));
    for (const p of residents(c)) {
      const type = kinds.get(p.arch?.room ?? '');
      expect(type).toBeDefined();
      expect(['bathroom', 'storage', 'laundry', 'garage']).not.toContain(type);
    }
  });

  it('keeps every resident off doorways, the lanes between doors, furniture and the spawn', () => {
    const c = compileBuilding(WITH);
    const openings = c.entities.filter((e) => e.arch?.role === 'opening').map((e) => [e.transform?.position?.[0] ?? 0, e.transform?.position?.[2] ?? 0] as [number, number]);
    for (const p of residents(c)) {
      const at: [number, number] = [p.transform?.position?.[0] ?? 0, p.transform?.position?.[2] ?? 0];
      for (const o of openings) expect(Math.hypot(at[0] - o[0], at[1] - o[1])).toBeGreaterThan(1.5);
      expect(Math.hypot(at[0] - c.spawn[0], at[1] - c.spawn[2])).toBeGreaterThan(2.5);
    }
  });

  it('leaves the house walkable: every door still reachable and clear with the people in the world', () => {
    const c = compileBuilding(WITH);
    let world: WorldDoc = createWorld();
    world = applyPatches(world, c.patches).world;
    world = { ...world, player: { ...world.player, spawn: c.spawn, yaw: c.spawnYaw } };
    const report = checkBuilding(world, c.id);
    expect(report.passed).toBe(true);
    expect(report.reachable).toBe(report.rooms);
  });

  it('respects the plan spawn override and rotates with the building', () => {
    const c = compileBuilding({ ...WITH, spawn: { at: [3, 2], yaw: 90 } });
    expect(c.spawn[0]).toBeCloseTo(3, 1);
    expect(c.spawn[2]).toBeCloseTo(2, 1);
    expect(c.spawnYaw).toBeCloseTo(90, 5);
    const moved = compileBuilding({ ...WITH, origin: [20, -10] });
    const base = residents(compileBuilding(WITH));
    const shifted = residents(moved);
    expect(shifted).toHaveLength(base.length);
    base.forEach((p, i) => {
      expect((shifted[i]?.transform?.position?.[0] ?? 0) - (p.transform?.position?.[0] ?? 0)).toBeCloseTo(20, 1);
      expect((shifted[i]?.transform?.position?.[2] ?? 0) - (p.transform?.position?.[2] ?? 0)).toBeCloseTo(-10, 1);
    });
  });

  it('a recompile replaces the residents instead of piling them up, set_residents changes them, and removing the building removes them', () => {
    const count = (w: WorldDoc): number => Object.values(w.entities).filter((e) => e.arch?.role === 'resident').length;
    const w1 = applyArchOps(createWorld(), [{ op: 'create_building', plan: WITH, walkthrough: true }]).target;
    expect(count(w1)).toBe(3);
    const w2 = applyArchOps(w1, [{ op: 'create_building', plan: { ...WITH, residents: 2 }, walkthrough: true }]).target;
    expect(count(w2)).toBe(2);
    const w3 = applyArchOps(w2, [{ op: 'set_residents', building: WITH.id, count: 4 }]).target;
    expect(count(w3)).toBe(4);
    expect(count(applyArchOps(w3, [{ op: 'set_residents', building: WITH.id, count: 0 }]).target)).toBe(0);
    expect(count(applyArchOps(w3, [{ op: 'remove_building', building: WITH.id }]).target)).toBe(0);
  });
});

describe('planResidents', () => {
  const room = (id: string, type: ResidentRoom['type'], x0: number, z0: number, x1: number, z1: number, blockers: ResidentRoom['blockers'] = []): ResidentRoom => ({
    id,
    type,
    name: id,
    polygon: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]],
    blockers,
    level: 0,
    elevation: 0.2,
  });

  it('caps the count, skips rooms nobody uses and rooms with no clear floor', () => {
    const rooms = [room('living', 'living', 0, 0, 6, 5), room('bath', 'bathroom', 6, 0, 9, 5), room('tight', 'kitchen', 9, 0, 10.2, 1.2)];
    const spots = planResidents(rooms, [], 99, 1);
    expect(spots.length).toBeLessThanOrEqual(MAX_RESIDENTS);
    expect(spots.every((s) => s.room === 'living')).toBe(true);
    expect(planResidents(rooms, [], 0, 1)).toEqual([]);
  });

  it('stays clear of blockers, doorways and the lane between two doorways', () => {
    const sofa: [number, number][] = [[1, 1], [3.4, 1], [3.4, 2], [1, 2]];
    const rooms = [room('living', 'living', 0, 0, 8, 6, [sofa])];
    const keep: KeepOut[] = [
      { at: [0, 3], r: 1.55, level: 0 },
      { at: [8, 3], r: 1.55, level: 0 },
    ];
    const spots = planResidents(rooms, keep, 2, 4);
    expect(spots.length).toBeGreaterThan(0);
    for (const s of spots) {
      expect(Math.abs(s.at[1] - 3)).toBeGreaterThanOrEqual(1.0);
      expect(edgeDist(s.at, sofa)).toBeGreaterThanOrEqual(0.6);
      expect(edgeDist(s.at, rooms[0]?.polygon ?? [])).toBeGreaterThanOrEqual(0.6);
      expect(Math.hypot(s.facing[0], s.facing[1])).toBeCloseTo(1, 5);
    }
  });
});
