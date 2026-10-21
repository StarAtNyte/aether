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
