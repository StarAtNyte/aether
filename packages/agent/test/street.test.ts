import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { dwellingDoorAt, furnitureById, furnitureSize } from '@aether/arch';
import { describe, expect, it } from 'vitest';
import { landPatches, LandInput } from '../src/land';
import { ToolInputs } from '../src/tools';

function street(input: unknown, world: WorldDoc = createWorld()): { world: WorldDoc; summary: string; refused: boolean } {
  const r = landPatches(world, LandInput.parse({ op: 'street', ...(input as object) }));
  if (r.refused) return { world, summary: r.summary, refused: true };
  const out = applyPatches(world, r.patches);
  expect(out.errors).toEqual([]);
  return { world: out.world, summary: r.summary, refused: false };
}

const scatters = (w: WorldDoc) => Object.values(w.entities).filter((e) => e.shape.kind === 'scatter');
const of = (e: { shape: { kind: string; of?: { kind: string; generator?: string } } }) => (e.shape.kind === 'scatter' && e.shape.of?.kind === 'procedural' ? (e.shape.of.generator ?? '') : '');

describe('shape_land street', () => {
  const line = [[-40, 0], [40, 0]];

  it('builds a village street: a road, houses of the regional types on both sides, fences, gardens and lamps in few entities', () => {
    const { world, summary, refused } = street({ points: line, houses: { types: ['mediterranean', 'stone-cottage'], variants: 2 } });
    expect(refused).toBe(false);
    const houses = scatters(world).filter((e) => of(e) === 'furn-dwelling');
    const count = houses.reduce((n, e) => n + (e.shape.kind === 'scatter' ? (e.shape.points?.length ?? 0) : 0), 0);
    expect(count).toBeGreaterThanOrEqual(10);
    expect(count).toBeLessThanOrEqual(30);
    // Few entities for many houses: instanced by look and by the way they face.
    expect(houses.length).toBeLessThanOrEqual(12);
    const kinds = new Set(houses.map((e) => (e.shape.kind === 'scatter' && e.shape.of.kind === 'procedural' ? (e.shape.of.params as { type?: string }).type : '')));
    expect(kinds).toEqual(new Set(['mediterranean', 'stone-cottage']));
    for (const g of ['furn-fence', 'furn-garden', 'furn-street-lamp']) expect(scatters(world).some((e) => of(e) === g), g).toBe(true);
    expect(Object.values(world.entities).filter((e) => e.light).length).toBeGreaterThan(0);
    expect(Object.values(world.entities).some((e) => e.tags.includes('path'))).toBe(true);
    expect(summary).toMatch(/dwellings/);
    // Houses are solid.
    expect(houses.every((e) => e.physics?.body === 'static')).toBe(true);
  });

  it('turns every house to face the road and keeps it off the road and out of its neighbour', () => {
    const { world } = street({ points: line, width: 6, houses: { types: ['brick-terrace'], variants: 1, gap: 0.5, gableFront: 0 } });
    const dwelling = furnitureById('furn-dwelling');
    if (!dwelling) throw new Error('missing');
    const placed: Array<{ x: number; z: number; w: number }> = [];
    for (const e of scatters(world)) {
      if (of(e) !== 'furn-dwelling' || e.shape.kind !== 'scatter') continue;
      const yaw = e.transform.rotation[1];
      const params = e.shape.of.kind === 'procedural' ? (e.shape.of.params as Record<string, never>) : {};
      const [w] = furnitureSize(dwelling, params);
      for (const [lx, , lz] of e.shape.points ?? []) {
        const a = (yaw * Math.PI) / 180;
        const x = lx * Math.cos(a) + lz * Math.sin(a);
        const z = -lx * Math.sin(a) + lz * Math.cos(a);
        // The front (local +Z) looks at the road (z = 0): its direction in the world points towards it.
        const fz = Math.cos(a);
        expect(z * fz, `house at (${x.toFixed(1)}, ${z.toFixed(1)})`).toBeLessThan(0);
        // Clear of the road (half width 3) by the pavement and front garden.
        expect(Math.abs(z)).toBeGreaterThan(3 + 1);
        placed.push({ x, z, w });
      }
    }
    expect(placed.length).toBeGreaterThan(6);
    expect(placed.some((p) => p.z > 0) && placed.some((p) => p.z < 0)).toBe(true);
    for (const side of [1, -1]) {
      const row = placed.filter((p) => Math.sign(p.z) === side).sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i++) expect((row[i] as { x: number }).x - (row[i - 1] as { x: number }).x).toBeGreaterThan(3.5);
    }
  });

  it('puts the gate of each lot in line with its door', () => {
    const { world } = street({ points: line, houses: { types: ['stone-cottage'], variants: 1, sides: 'left', maxCount: 4 }, lamps: false });
    const gates = scatters(world)
      .filter((e) => of(e) === 'furn-fence' && e.shape.kind === 'scatter' && e.shape.of.kind === 'procedural' && (e.shape.of.params as { gate?: boolean }).gate === true)
      .flatMap((e) => (e.shape.kind === 'scatter' ? (e.shape.points ?? []).map((p) => ({ p, yaw: e.transform.rotation[1] })) : []));
    expect(gates.length).toBe(4);
    const doors: number[] = [];
    for (const e of scatters(world)) {
      if (of(e) !== 'furn-dwelling' || e.shape.kind !== 'scatter' || e.shape.of.kind !== 'procedural') continue;
      const params = e.shape.of.params as Record<string, never>;
      const [dx, dz] = dwellingDoorAt(params);
      const a = (e.transform.rotation[1] * Math.PI) / 180;
      for (const [lx, , lz] of e.shape.points ?? []) {
        const hx = lx * Math.cos(a) + lz * Math.sin(a);
        const hz = -lx * Math.sin(a) + lz * Math.cos(a);
        // World x of the door (the street runs along X).
        doors.push(hx + dx * Math.cos(a) + dz * Math.sin(a));
        void hz;
      }
    }
    const gx = gates.map((g) => {
      const a = (g.yaw * Math.PI) / 180;
      return g.p[0] * Math.cos(a) + g.p[2] * Math.sin(a);
    });
    for (const d of doors) expect(gx.some((x) => Math.abs(x - d) < 1.2), `door at ${d.toFixed(1)}`).toBe(true);
  });

  it('follows the ground: houses stand on the lowest corner of a slope', () => {
    const w1 = applyPatches(createWorld(), landPatches(createWorld(), LandInput.parse({ op: 'land', kind: 'meadow', size: 300, plot: { x: 0, z: 0, radius: 12 }, relief: 30 })).patches).world;
    const { world } = street({ points: [[-20, 60], [20, 60]], houses: { types: ['nordic'], variants: 1, maxCount: 4 } }, w1);
    const ys = scatters(world).filter((e) => of(e) === 'furn-dwelling').flatMap((e) => (e.shape.kind === 'scatter' ? (e.shape.points ?? []).map((p) => p[1]) : []));
    expect(ys.length).toBeGreaterThan(1);
    expect(Math.max(...ys.map(Math.abs))).toBeGreaterThan(0.2);
  });

  it('refuses a line that is too short and bad input', () => {
    expect(street({ points: [[0, 0], [5, 0]] }).refused).toBe(true);
    expect(LandInput.safeParse({ op: 'street', points: [[0, 0]] }).success).toBe(false);
    expect(LandInput.safeParse({ op: 'street', points: line, houses: { types: ['castle'] } }).success).toBe(false);
  });

  it('is offered to the model with its houses, fences, gardens and lamps', () => {
    expect(ToolInputs.shape_land.safeParse({ op: 'street', points: line, houses: { types: ['machiya'] }, lamps: { every: 20 } }).success).toBe(true);
  });
});
