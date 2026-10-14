import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, summarizeWorld, validateWorld, type WorldDoc } from '@aether/core';
import { planMock } from '../src/providers/mock/planner';
import { parseVoxelSummary, planVoxel } from '../src/providers/mock/voxel';

function apply(world: WorldDoc, request: string): { world: WorldDoc; message: string } {
  const plan = planMock(request, summarizeWorld(world));
  const r = applyPatches(world, plan.patches);
  expect(r.errors).toEqual([]);
  expect(validateWorld(r.world).ok).toBe(true);
  return { world: r.world, message: plan.message };
}

describe('offline planner: block worlds', () => {
  it('builds a survival world from a minecraft-like prompt', () => {
    const { world, message } = apply(createWorld(), 'a minecraft-like survival world');
    expect(world.voxel?.preset).toBe('survival');
    expect(world.voxel?.game.mode).toBe('survival');
    expect(world.voxel?.game.startItems.length).toBeGreaterThan(0);
    expect(world.environment.ground).toBeNull();
    expect(world.player.mode).toBe('firstPerson');
    expect(message).toMatch(/Play/);
  });

  it('builds a village of block houses with varied palettes', () => {
    const { world } = apply(createWorld(), 'a village of block houses');
    const houses = world.voxel?.edits.filter((e) => e.shape === 'structure' && e.structure === 'house') ?? [];
    expect(houses.length).toBe(7);
    expect(new Set(houses.map((h) => (h.shape === 'structure' ? h.palette.wall : '')))).not.toHaveProperty('size', 1);
    expect(world.voxel?.preset).toBe('plains');
  });

  it('draws pixel art in the sky', () => {
    const { world } = apply(createWorld(), 'pixel art heart in the sky over a blocky world');
    const art = world.voxel?.edits.find((e) => e.shape === 'pixels');
    expect(art).toBeTruthy();
    expect(art?.shape === 'pixels' && art.at[1]).toBeGreaterThan(10);
  });

  it('edits an existing block world: castle on the hill, night, creative mode', () => {
    let { world } = apply(createWorld(), 'a minecraft-like survival world');
    ({ world } = apply(world, 'build a stone castle on the hill'));
    expect(world.voxel?.edits.some((e) => e.shape === 'structure' && e.structure === 'castle')).toBe(true);
    ({ world } = apply(world, 'make it night'));
    expect(world.voxel?.game.startHour).toBeGreaterThanOrEqual(19);
    ({ world } = apply(world, 'switch to creative mode'));
    expect(world.voxel?.game.mode).toBe('creative');
    ({ world } = apply(world, 'write "HELLO" in blocks'));
    expect(world.voxel?.edits.some((e) => e.shape === 'text' && e.text === 'HELLO')).toBe(true);
  });

  it('replaces a scene with entities when a new block world is requested', () => {
    const start = createWorld({ entities: { box: { id: 'box', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] } } } });
    const { world } = apply(start, 'a minecraft-like survival world');
    expect(Object.keys(world.entities)).toHaveLength(0);
    expect(world.voxel).toBeTruthy();
  });

  it('leaves ordinary requests to the regular planner', () => {
    expect(planVoxel('a cozy forest camp with a campfire', summarizeWorld(createWorld()))).toBeNull();
    expect(planVoxel('a haunted castle at night', summarizeWorld(createWorld()))).toBeNull();
  });

  it('parses the voxel lines of a summary', () => {
    const { world } = apply(createWorld(), 'a village of block houses');
    const v = parseVoxelSummary(summarizeWorld(world));
    expect(v?.preset).toBe('plains');
    expect(v?.edits).toBe(world.voxel?.edits.length);
  });
});
