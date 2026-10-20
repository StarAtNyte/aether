/** The `npcs` world test on a generated terrain with relief: NPCs standing on its slopes are on walkable floor. */
import { describe, expect, it } from 'vitest';
import { createWorld, type EntityInput, type Vec3 } from '@aether/core';
import { initPhysics, PhysicsWorld, verify } from '../src';

const TERRAIN: EntityInput = { id: 'forest-ground', shape: { kind: 'procedural', generator: 'terrain', params: { size: 120, height: 10 }, seed: 7 }, transform: { position: [0, 0, 0] }, physics: { body: 'static' } };

describe('npcs test on terrain', () => {
  it('passes for wolves set on the slopes of a generated terrain, with a patrol across them', async () => {
    await initPhysics();
    const base = createWorld({ entities: { 'forest-ground': TERRAIN }, environment: { ground: null } });
    const pw = await PhysicsWorld.create(base);
    const groundAt = (x: number, z: number): Vec3 => {
      const hit = pw.raycast([x, 200, z], [0, -1, 0], 400);
      return [x, hit ? hit.point[1] : 0, z];
    };
    // Points on the terrain whose height differs (so the old flat-level grid could not see all of them).
    const spots = [groundAt(6, 4), groundAt(-5, 9), groundAt(10, -8)];
    pw.dispose();
    const heights = spots.map((p) => p[1]);
    expect(Math.max(...heights) - Math.min(...heights), JSON.stringify(heights)).toBeGreaterThan(0.3);
    expect(Math.max(...heights), JSON.stringify(heights)).toBeGreaterThan(3);
    const wolf = (id: string, at: Vec3, waypoints: Vec3[]): EntityInput =>
      ({ id, name: 'Wolf', shape: { kind: 'asset', id: 'grey-wolf' }, transform: { position: at }, physics: { body: 'kinematic' }, npc: { role: 'wolf', archetype: 'predator', speed: 1.5, runSpeed: 3, radius: 0.4, height: 0.9, waypoints } }) as EntityInput;
    const world = createWorld({
      entities: { 'forest-ground': TERRAIN, 'wolf-1': wolf('wolf-1', spots[0] as Vec3, [spots[1] as Vec3, spots[2] as Vec3]) },
      environment: { ground: null },
      tests: [{ id: 'wolves', kind: 'npcs', target: '#npc' }],
    });
    world.entities['wolf-1']?.tags.push('npc');
    const report = await verify(world, { budgetMs: 20_000 });
    const r = report.results.find((x) => x.id === 'wolves');
    expect(r?.message ?? '').not.toMatch(/cannot walk on|not on walkable floor/);
  }, 60_000);
});
