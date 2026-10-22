import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { AGENT_TOOLS, ToolInputs } from '../src/tools';
import { BakeLightInput, bakePatches, bakeText } from '../src/bake-edit';
import { lookText } from '../src/look-edit';
import { executeTool, type ExecutorContext } from '../src/executor';

describe('bake_light tool', () => {
  it('is a strict tool with a quality enum and a described cost', () => {
    const t = AGENT_TOOLS.find((x) => x.name === 'bake_light')!;
    expect(t).toBeDefined();
    expect(t.inputSchema).toMatchObject({ type: 'object', additionalProperties: false, required: ['quality'] });
    expect(t.description).toMatch(/lightmap/);
    expect(t.description).toMatch(/falls back to the probe light/);
    expect(ToolInputs.bake_light.safeParse({ quality: 'high', samples: 200 }).success).toBe(true);
    expect(ToolInputs.bake_light.safeParse({ quality: 'ultra' }).success).toBe(false);
    expect(ToolInputs.bake_light.safeParse({ quality: 'low', samples: 3 }).success).toBe(false);
    expect(ToolInputs.bake_light.safeParse({}).success).toBe(false);
  });

  it('stores the decision in environment.lightBake as one patch, and says what happens', () => {
    const w0 = createWorld();
    const input = BakeLightInput.parse({ quality: 'medium' });
    const { patches, summary } = bakePatches(w0, input);
    expect(patches).toHaveLength(1);
    expect(summary).toMatch(/512 px atlas, 48 rays/);
    expect(summary).toMatch(/falls back to the probe light/);
    const w1 = applyPatches(w0, patches).world;
    expect(w1.environment.lightBake).toEqual({ quality: 'medium' });
    expect(bakeText(w1)).toMatch(/medium/);
    expect(lookText(w1)).toMatch(/baked light: medium/);
    // Same request again changes nothing; another quality, with samples, replaces it and a null drops the override.
    expect(bakePatches(w1, input).patches).toEqual([]);
    const w2 = applyPatches(w1, bakePatches(w1, BakeLightInput.parse({ quality: 'high', samples: 160 })).patches).world;
    expect(w2.environment.lightBake).toEqual({ quality: 'high', samples: 160 });
    const w3 = applyPatches(w2, bakePatches(w2, BakeLightInput.parse({ quality: 'high' })).patches).world;
    expect(w3.environment.lightBake).toEqual({ quality: 'high' });
    const off = applyPatches(w3, bakePatches(w3, BakeLightInput.parse({ quality: 'off' })).patches).world;
    expect(off.environment.lightBake).toEqual({ quality: 'off' });
    expect(bakeText(off)).toMatch(/off/);
  });

  it('runs through the executor and is refused with a readable error on bad input', async () => {
    let world = createWorld();
    const host = {
      getWorld: () => world,
      applyPatches: (p: never[]) => {
        const r = applyPatches(world, p);
        world = r.world;
        return { applied: p, errors: r.errors };
      },
    } as unknown as ExecutorContext['host'];
    const ctx = { host } as unknown as ExecutorContext;
    const ok = await executeTool(ctx, 'bake_light', { quality: 'low', message: 'flat bedroom' });
    expect(ok.isError).toBe(false);
    expect(ok.edited).toBe(true);
    expect(world.environment.lightBake).toEqual({ quality: 'low' });
    const bad = await executeTool(ctx, 'bake_light', { quality: 'nope' });
    expect(bad.isError).toBe(true);
    expect(bad.content).toMatch(/Invalid bake_light input/);
  });
});
