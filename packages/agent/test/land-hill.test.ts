import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { landPatches, LandInput, worldGround } from '../src/land';
import { executeTool, type ExecutorContext } from '../src/executor';
import { MemoryHost } from './helpers';

function apply(world: WorldDoc, input: unknown): WorldDoc {
  const out = applyPatches(world, landPatches(world, LandInput.parse(input)).patches);
  expect(out.errors).toEqual([]);
  return out.world;
}

describe('shape_land: hills, lakes and the notes on primitive water and hills', () => {
  it('raises a natural mound with a level summit where a shrine can stand', () => {
    const w0 = apply(createWorld(), { op: 'land', kind: 'meadow', plot: { x: 0, z: 0, radius: 30 } });
    const { patches, summary } = landPatches(w0, LandInput.parse({ op: 'mound', x: 10, z: -12, size: 20, height: 4, top: 0.3 }));
    expect(summary).toContain('summit at y =');
    const out = applyPatches(w0, patches);
    expect(out.errors).toEqual([]);
    const hill = Object.values(out.world.entities).find((e) => e.shape.kind === 'procedural' && e.shape.generator === 'mound');
    expect(hill?.tags).toContain('hill');
    // A new land keeps the hill.
    const w2 = apply(out.world, { op: 'land', kind: 'forest' });
    expect(Object.values(w2.entities).some((e) => e.shape.kind === 'procedural' && e.shape.generator === 'mound')).toBe(true);
  });

  it('builds a lake basin with water', () => {
    const w = apply(createWorld(), { op: 'land', kind: 'meadow', plot: { x: 0, z: 0, radius: 15 }, lake: { x: 0, z: -40, radius: 14 } });
    expect(Object.values(w.entities).some((e) => e.tags.includes('lake') && e.material?.preset === 'water')).toBe(true);
    expect(worldGround(w)(0, -40)).toBeLessThan(-1);
  });

  it('apply_patches points a box of water and a cylinder hill at shape_land', async () => {
    const host = new MemoryHost();
    const ctx = { host, provider: {} as never, coderSystem: '', builtinGenerators: new Set<string>(), usage: { inputTokens: 0, outputTokens: 0 } } as unknown as ExecutorContext;
    const out = await executeTool(ctx, 'apply_patches', {
      patches: [
        { op: 'add', entity: { id: 'river', shape: { kind: 'primitive', primitive: 'box', size: [6, 0.2, 60] }, material: { preset: 'water' } } },
        { op: 'add', entity: { id: 'shrine-hill', shape: { kind: 'primitive', primitive: 'cylinder', size: [12, 3, 12] } } },
      ],
    });
    expect(out.content).toContain('stream:{z, half}');
    expect(out.content).toContain('op:"mound"');
  });
});
