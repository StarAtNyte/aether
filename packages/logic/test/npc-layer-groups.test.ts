/**
 * Floor grids in a large place: NPCs of one size that walk far apart (residents of different houses along a street)
 * get grids of their own, so the cell stays fine enough for a doorway; a compact group keeps one shared build.
 */
import { describe, expect, it } from 'vitest';
import type { EntityInput } from '@aether/core';
import { groupLayerPoints, LAYER_GROUP_SPAN, NavLayers, type LayerPoint } from '../src/npc/layers';
import { worldOf } from './helpers';

/** One wall of a building, so the world counts as built (layered grids). */
const wall: EntityInput = { id: 'w', shape: { kind: 'procedural', generator: 'arch-wall', params: {} }, transform: { position: [0, 0, 0] }, physics: { body: 'static' } };
const at = (x: number, z: number): LayerPoint => ({ x, y: 0.15, z });
const house = (x: number, z: number): LayerPoint[] => [at(x, z), at(x + 3, z + 2), at(x - 2, z + 4)];

describe('NPC floor-grid groups', () => {
  it('keeps NPCs that fit one fine grid together, as before', () => {
    const world = worldOf([wall], [], { player: { spawn: [0, 1, 0] } });
    const g = groupLayerPoints(world, [
      { size: '1|4', points: house(-6, 0) },
      { size: '1|4', points: house(6, 3) },
    ]);
    expect(g.groups).toHaveLength(1);
    expect(g.groups[0]?.local).toBe(false);
    expect(g.of).toEqual([0, 0]);
  });

  it('gives residents of houses far apart grids of their own at the doorway cell', () => {
    const world = worldOf([wall], [], { player: { spawn: [0, 1, 0] } });
    const entries = [
      { size: '1|4', points: house(-20, 28) },
      { size: '1|4', points: house(2, 28) },
      { size: '1|4', points: house(-20, -30) },
      { size: '1|4', points: house(-18, 30) },
    ];
    const g = groupLayerPoints(world, entries);
    expect(g.groups.length).toBe(3);
    expect(g.groups.every((x) => x.local)).toBe(true);
    // Neighbours in one house share a group; a group never spans more than the fine grid allows.
    expect(g.of[3]).toBe(g.of[0]);
    for (const grp of g.groups) {
      const xs = grp.points.map((p) => p.x);
      const zs = grp.points.map((p) => p.z);
      expect(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs))).toBeLessThanOrEqual(LAYER_GROUP_SPAN);
      const layers = NavLayers.build(world, { radius: 0.3, height: 1.8, points: grp.points, local: grp.local });
      expect(layers?.grids[0]?.cell).toBeCloseTo(0.25, 5);
    }
    // One build over everyone (the old behaviour) grows the cell past what a 0.9 m doorway needs.
    const all = NavLayers.build(world, { radius: 0.3, height: 1.8, points: entries.flatMap((e) => e.points) });
    expect(all?.grids[0]?.cell).toBeGreaterThan(0.3);
  });

  it('never groups NPCs of different sizes', () => {
    const world = worldOf([wall], [], { player: { spawn: [0, 1, 0] } });
    const g = groupLayerPoints(world, [
      { size: '1|4', points: house(0, 0) },
      { size: '2|4', points: house(1, 0) },
    ]);
    expect(g.of[0]).not.toBe(g.of[1]);
  });
});
