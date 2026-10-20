/**
 * NPC navigation over hills: with the host's terrain height the grid drapes over the terrain, so a wolf standing
 * on a slope is on walkable floor and can be routed across it (acceptance: Codex's wolves on a gently rising forest
 * floor failed "stands on ground it cannot walk on" until it built flat stone discs for them).
 */
import { describe, expect, it } from 'vitest';
import type { EntityInput, Vec3 } from '@aether/core';
import { NAV_MAX_PATH, analyzeNpcs, buildNavFor, terrainSampler } from '../src';
import { worldOf } from './helpers';

/** A round hill: 6 m high at the origin, falling 0.3 m per metre (about 17 degrees). */
const hillAt = (x: number, z: number): number => Math.max(0, 6 - 0.3 * Math.hypot(x, z));
/** A cliff: a 4 m step at x = 30 (too steep to walk). */
const withCliff = (x: number, z: number): number => hillAt(x, z) + (x > 30 ? 4 : 0);

const TERRAIN: EntityInput = { id: 'forest-ground', shape: { kind: 'procedural', generator: 'terrain', params: { size: 200 } }, transform: { position: [0, 0, 0] }, physics: { body: 'static' } };

function wolf(id: string, at: [number, number], waypoints: Array<[number, number]> = []): EntityInput {
  const y = hillAt(at[0], at[1]);
  return {
    id,
    name: 'Wolf',
    shape: { kind: 'asset', id: 'grey-wolf' },
    transform: { position: [at[0], y, at[1]] },
    physics: { body: 'kinematic' },
    npc: { role: 'wolf', archetype: 'predator', speed: 2, runSpeed: 4, radius: 0.4, height: 0.9, waypoints: waypoints.map(([x, z]): Vec3 => [x, hillAt(x, z), z]) },
  } as EntityInput;
}

describe('NPC navigation over terrain', () => {
  it('a wolf on the slope stands on walkable floor and its patrol across the hill is reachable', () => {
    const w = worldOf([TERRAIN, wolf('wolf-1', [8, 3], [[-6, 2], [2, -9]])]);
    w.environment.ground = null;
    // Without the terrain height a hill is a flat floor at its base: the wolf 3 m up the slope has no floor.
    expect(analyzeNpcs(w, {}).errors.join(' ')).toMatch(/stands on ground it cannot walk on/);
    const a = analyzeNpcs(w, { bounds: { terrainHeight: hillAt } });
    expect(a.errors).toEqual([]);
  });

  it('a rock on the hill still blocks, measured from the ground under it', () => {
    const rock: EntityInput = { id: 'rock', shape: { kind: 'primitive', primitive: 'box', size: [2, 2, 2] }, transform: { position: [0, hillAt(0, 0) + 0.8, 0] }, physics: { body: 'static' } };
    const w = worldOf([TERRAIN, rock]);
    w.environment.ground = null;
    const g = buildNavFor(w, { refY: 4.5, radius: 0.4, height: 0.9, points: [[0, 0, 0]] }, { terrainHeight: hillAt });
    expect(g.walkable(0, 0)).toBe(false);
    expect(g.walkable(5, 0)).toBe(true);
    expect(g.floorAt(5, 0, NaN)).toBeCloseTo(hillAt(5.25, 0.25), 0);
  });

  it('a cliff is not walked up', () => {
    const w = worldOf([TERRAIN]);
    w.environment.ground = null;
    const g = buildNavFor(w, { refY: 0, radius: 0.4, height: 0.9, points: [[25, 0, 0], [35, 0, 0]] }, { terrainHeight: withCliff });
    const out = new Float32Array(NAV_MAX_PATH * 2);
    // Both sides are floor, but nothing joins them across the 4 m step (the search may only go round, and there is no round).
    expect(g.walkable(25, 0)).toBe(true);
    expect(g.walkable(35, 0)).toBe(true);
    expect(g.findPath(25, 0, 35, 0, out)).toBe(0);
  });

  it('the sampler reads the first terrain hit under a point, through trees and rocks above it', () => {
    const w = worldOf([TERRAIN, { id: 'pine', shape: { kind: 'primitive', primitive: 'cone', size: [3, 8, 3] }, transform: { position: [4, 4, 4] }, physics: { body: 'static' } }]);
    const sample = terrainSampler(w, (x, _y, z) => [{ id: 'pine', point: [x, 8, z] }, { id: 'forest-ground', point: [x, 1.25, z] }]);
    expect(sample?.(4, 4)).toBe(1.25);
    expect(terrainSampler(worldOf([{ id: 'crate', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, physics: { body: 'static' } }]), () => [])).toBeUndefined();
  });
});
