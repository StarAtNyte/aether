import { describe, expect, it } from 'vitest';
import { createWorld, decodeMesh, type WorldDoc } from '@aether/core';
import { primitiveOutput } from '@aether/procgen';
import { AGENT_TOOLS, ToolInputs } from '../src/tools';
import { executeTool, type ExecutorContext } from '../src/executor';
import { MemoryHost } from './helpers';

function sphereWorld(): WorldDoc {
  return createWorld({
    entities: {
      ball: { id: 'ball', transform: { position: [10, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { kind: 'primitive', primitive: 'sphere', size: [2, 2, 2] } },
      statue: { id: 'statue', shape: { kind: 'asset', id: 'some-model' } },
    },
  } as never);
}

describe('sculpt tool', () => {
  it('is a strict tool with capped strokes', () => {
    const t = AGENT_TOOLS.find((x) => x.name === 'sculpt')!;
    expect(t.inputSchema).toMatchObject({ type: 'object', additionalProperties: false, required: ['id', 'strokes'] });
    const stroke = { mode: 'raise', at: [0, 0, 0], radius: 0.1, strength: 0.5 };
    expect(ToolInputs.sculpt.safeParse({ id: 'a', strokes: [stroke] }).success).toBe(true);
    expect(ToolInputs.sculpt.safeParse({ id: 'a', strokes: Array(65).fill(stroke) }).success).toBe(false);
    expect(ToolInputs.sculpt.safeParse({ id: 'a', strokes: [{ ...stroke, mode: 'pinch' }] }).success).toBe(false);
  });

  it('bakes a primitive, raises only near the point, and commits one undoable step keeping the source', async () => {
    const host = new MemoryHost(sphereWorld());
    const ctx = { host } as unknown as ExecutorContext;
    const out = await executeTool(ctx, 'sculpt', { id: 'ball', strokes: [{ mode: 'raise', at: [10, 2, 0], radius: 0.5, strength: 1, repeat: 3 }] });
    expect(out.isError, out.content).toBe(false);
    expect(out.content).toMatch(/vertices moved/);
    expect(host.commits).toHaveLength(1);
    const commit = host.commits[0]!;
    expect(commit.result.errors).toEqual([]);
    expect(commit.result.applied.map((p) => p.op)).toEqual(['setMesh', 'update']);
    const e = host.world.entities['ball']!;
    expect(e.shape).toEqual({ kind: 'mesh', mesh: 'ball-mesh' });
    const asset = host.world.meshes['ball-mesh']!;
    expect(asset.source?.shape).toMatchObject({ kind: 'primitive', primitive: 'sphere' });

    // Compare with the unsculpted bake: only vertices within the radius of the top (local [0, 1, 0]) moved, and upward.
    const before = primitiveOutput({ kind: 'primitive', primitive: 'sphere', size: [2, 2, 2] }).parts[0]!.positions;
    const after = decodeMesh(asset).positions;
    expect(after.length).toBe(before.length);
    let moved = 0;
    for (let i = 0; i < before.length; i += 3) {
      const d = Math.hypot(after[i]! - before[i]!, after[i + 1]! - before[i + 1]!, after[i + 2]! - before[i + 2]!);
      const far = Math.hypot(before[i]!, before[i + 1]! - 1, before[i + 2]!);
      if (far >= 0.5) expect(d).toBe(0);
      if (d > 0) {
        moved++;
        expect(after[i + 1]!).toBeGreaterThan(before[i + 1]!);
      }
    }
    expect(moved).toBeGreaterThan(0);

    // A second call edits the mesh in place (one setMesh, the source still kept).
    const again = await executeTool(ctx, 'sculpt', { id: 'ball', strokes: [{ mode: 'lower', at: [10, 1, 1], radius: 0.4, strength: 0.5, to: [10, 1, -1] }] });
    expect(again.isError, again.content).toBe(false);
    expect(host.commits[1]!.result.applied.map((p) => p.op)).toEqual(['setMesh']);
    expect(host.world.meshes['ball-mesh']!.source?.shape.kind).toBe('primitive');
  });

  it('bakes a built-in procedural object through its generator', async () => {
    const host = new MemoryHost(createWorld({ entities: { rock: { id: 'rock', shape: { kind: 'procedural', generator: 'rock', params: {} } } } } as never));
    const ctx = { host } as unknown as ExecutorContext;
    const out = await executeTool(ctx, 'sculpt', { id: 'rock', strokes: [{ mode: 'noise', at: [0, 0.5, 0], radius: 2, strength: 1 }] });
    expect(out.isError, out.content).toBe(false);
    const asset = host.world.meshes['rock-mesh']!;
    expect(asset.source?.shape).toMatchObject({ kind: 'procedural', generator: 'rock' });
  });

  it('refuses models and says when a stroke misses the surface', async () => {
    const host = new MemoryHost(sphereWorld());
    const ctx = { host } as unknown as ExecutorContext;
    const model = await executeTool(ctx, 'sculpt', { id: 'statue', strokes: [{ mode: 'raise', at: [0, 0, 0], radius: 1, strength: 1 }] });
    expect(model.isError).toBe(true);
    expect(model.content).toMatch(/imported model/);
    const miss = await executeTool(ctx, 'sculpt', { id: 'ball', strokes: [{ mode: 'raise', at: [50, 1, 0], radius: 0.2, strength: 1 }] });
    expect(miss.isError).toBe(true);
    expect(miss.content).toMatch(/touched nothing/);
    expect(host.commits).toHaveLength(0);
  });
});
