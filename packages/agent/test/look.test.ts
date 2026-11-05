/**
 * Look development by tool: tune_look turns the assistant's decision (after it viewed renders) into ordinary
 * environment patches. The renderer's constants are only the defaults; what the model sets is stored in the World IR.
 */
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, Environment } from '@aether/core';
import { executeTool } from '../src/executor';
import { lookPatches, lookText, TuneLookInput } from '../src/look-edit';
import { AGENT_TOOLS } from '../src/tools';
import { buildSystemPrompt } from '../src/prompt';
import { MemoryHost, TEST_CATALOGS } from './helpers';

const run = async (host: MemoryHost, input: unknown) => executeTool({ host } as never, 'tune_look', input);

describe('tune_look surroundings', () => {
  it('sets the exterior context as one patch, merges later fields into it and removes it on reset', async () => {
    const host = new MemoryHost(createWorld());
    const a = await run(host, { surroundings: 'woodland', treeDensity: 0.4, message: 'empty lawn under a pale sky' });
    expect(a.isError).toBe(false);
    expect(a.content).toContain('surroundings.preset default → woodland');
    expect(host.world.environment.surroundings).toEqual({ preset: 'woodland', trees: 0.4 });
    expect(Environment.safeParse(host.world.environment).success).toBe(true);
    await run(host, { hills: 60, farFields: true });
    expect(host.world.environment.surroundings).toEqual({ preset: 'woodland', trees: 0.4, hills: 60, fields: true });
    await run(host, { reset: ['surroundings'] });
    expect(host.world.environment.surroundings).toBeUndefined();
    expect(host.commits).toHaveLength(3);
  });

  it('rejects values outside the ranges and lists the exterior in the look text', async () => {
    const host = new MemoryHost(createWorld());
    expect((await run(host, { treeDensity: 3 })).isError).toBe(true);
    expect(lookText(createWorld())).toContain('surroundings: none');
  });
});

describe('tune_look', () => {
  it('stores the look in the World IR as one undo step and reports each value before and after', async () => {
    const host = new MemoryHost(createWorld());
    const out = await run(host, { exposure: 1.4, temperature: 0.2, interiorWarmth: 0.8, foliageTint: '#ffd9a0', message: 'room reads cold and dark' });
    expect(out.isError).toBe(false);
    expect(out.edited).toBe(true);
    expect(out.content).toContain('exposure 1 → 1.4');
    expect(out.content).toContain('grade.temperature default → 0.2');
    expect(out.content).toContain('look.interiorWarmth default → 0.8');
    expect(host.commits).toHaveLength(1);
    expect(host.commits[0]?.message).toBe('room reads cold and dark');
    const env = host.world.environment;
    expect(env.exposure).toBe(1.4);
    expect(env.grade?.temperature).toBe(0.2);
    expect(env.look).toEqual({ interiorWarmth: 0.8, foliageTint: '#ffd9a0' });
    // The whole document still parses: the look is part of the IR, not a side channel.
    expect(Environment.safeParse(env).success).toBe(true);
  });

  it('merges into what is there and resets named parameters to the default', async () => {
    const host = new MemoryHost(createWorld());
    await run(host, { interiorWarmth: 0.8, vignette: 0.5, saturation: 1.3 });
    await run(host, { vignette: 0.1, reset: ['interiorWarmth', 'saturation'] });
    const env = host.world.environment;
    expect(env.look).toEqual({ vignette: 0.1 });
    expect(env.grade?.saturation).toBeUndefined();
  });

  it('creates fog only with a density, then keeps it when the colour changes', async () => {
    const host = new MemoryHost(createWorld());
    const refused = await run(host, { fogColor: '#aabbcc' });
    expect(refused.isError).toBe(true);
    expect(refused.content).toContain('fogDensity');
    expect(host.commits).toHaveLength(0);
    await run(host, { fogColor: '#aabbcc', fogDensity: 0.02 });
    await run(host, { fogColor: '#ccbbaa' });
    expect(host.world.environment.fog).toEqual({ color: '#ccbbaa', density: 0.02 });
    await run(host, { reset: ['fog'] });
    expect(host.world.environment.fog).toBeNull();
  });

  it('rejects values outside the ranges and says nothing changed when the values are already set', async () => {
    const host = new MemoryHost(createWorld());
    const bad = await run(host, { saturation: 9, sunTint: 'orange' });
    expect(bad.isError).toBe(true);
    expect(bad.content).toContain('Invalid tune_look input');
    await run(host, { exposure: 1.2 });
    const again = await run(host, { exposure: 1.2 });
    expect(again.edited).toBe(false);
    expect(again.content).toContain('already set');
    expect(host.commits).toHaveLength(1);
  });

  it('the detail lives in the tool description, not in the system prompt', () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'tune_look');
    expect(tool?.description).toContain('interiorWarmth');
    expect(tool?.description).toContain('foliageTint');
    expect(tool?.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    const prompt = buildSystemPrompt(TEST_CATALOGS);
    expect(prompt).not.toContain('interiorWarmth');
  });

  it('lookText names the defaults for the model that is about to tune', () => {
    const w = applyPatches(createWorld(), lookPatches(createWorld(), TuneLookInput.parse({ interiorWarmth: 0.9 })).patches).world;
    const text = lookText(w);
    expect(text).toContain('interiorWarmth 0.9');
    expect(text).toContain('vignette 0.22 (default)');
    expect(text).toContain('fog: none');
  });
});

describe('look bounds', () => {
  it('holds an extreme grade and softens a dyeing light tint', async () => {
    const { softTint, GRADE_BOUNDS, LIGHT_TINT_MAX_CHROMA } = await import('../src/look-edit');
    expect(softTint('#ffffff', LIGHT_TINT_MAX_CHROMA)).toBe('#ffffff');
    expect(softTint('#ffe2c2', LIGHT_TINT_MAX_CHROMA)).toBe('#ffe2c2');
    const soft = softTint('#ff8040', LIGHT_TINT_MAX_CHROMA);
    const n = parseInt(soft.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    expect(1 - Math.min(...c) / Math.max(...c)).toBeLessThanOrEqual(LIGHT_TINT_MAX_CHROMA + 0.01);
    expect(GRADE_BOUNDS.saturation?.[1]).toBeLessThanOrEqual(1.25);
  });
});
