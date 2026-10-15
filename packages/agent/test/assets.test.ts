/**
 * The agent and the asset library: the search_assets tool, the prompt's
 * library summary, and the offline planner placing real library models for
 * everyday nouns (with fallbacks), keeping nature / gameplay procedural, and
 * dressing the city street with library models when the catalog is loaded.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createWorld, type WorldDoc } from '@aether/core';
import { loadCatalog, setCatalog } from '@aether/assets';
import { executeTool } from '../src/executor';
import { buildSystemPrompt } from '../src/prompt';
import { MemoryHost, mockApply, TEST_CATALOGS } from './helpers';

function assetIds(world: WorldDoc): string[] {
  return Object.values(world.entities).flatMap((e) => (e.shape.kind === 'asset' ? [e.shape.id] : []));
}

afterEach(() => {
  setCatalog(null);
});

describe('search_assets tool', () => {
  it('returns real-size library matches the model can place directly', async () => {
    await loadCatalog();
    const host = new MemoryHost();
    const out = await executeTool({ host } as never, 'search_assets', { query: 'couch', limit: 3 });
    expect(out.isError).toBe(false);
    expect(out.content).toMatch(/^sofa/m);
    expect(out.content).toContain('size ');
    expect(out.content).toContain('{"kind":"asset","id":"<id>"}');
    const anim = await executeTool({ host } as never, 'search_assets', { query: 'woman', category: 'characters' });
    expect(anim.content).toContain('animated');
    const sky = await executeTool({ host } as never, 'search_assets', { query: 'sunset', category: 'sky' });
    expect(sky.content).toContain('setEnvironment');
  });

  it('validates input and reports no match', async () => {
    await loadCatalog();
    const host = new MemoryHost();
    expect((await executeTool({ host } as never, 'search_assets', { query: 'x'.repeat(500) })).isError).toBe(true);
    expect((await executeTool({ host } as never, 'search_assets', { query: 'sofa', category: 'spaceships' })).isError).toBe(true);
    const none = await executeTool({ host } as never, 'search_assets', { query: 'zzzz qqqq' });
    expect(none.content).toContain('No library asset');
  });

  it('the system prompt lists the library when a summary is supplied', async () => {
    const plain = buildSystemPrompt(TEST_CATALOGS);
    expect(plain).not.toContain('## Asset library');
    expect(plain).toContain('{kind:"asset"');
    const withLib = buildSystemPrompt({ ...TEST_CATALOGS, assetSummary: '- furniture (95): sofa, armchair' });
    expect(withLib).toContain('## Asset library');
    expect(withLib).toContain('sofa, armchair');
  });
});

/** A small existing world, so "add …" requests are edits rather than new worlds. */
async function meadow(): Promise<WorldDoc> {
  const { result } = await mockApply('a meadow');
  expect(result.errors).toEqual([]);
  return result.world;
}

/** Asset ids added by an edit. */
function added(before: WorldDoc, after: WorldDoc): string[] {
  return Object.values(after.entities).flatMap((e) => (!before.entities[e.id] && e.shape.kind === 'asset' ? [e.shape.id] : []));
}

describe('offline planner with the asset library', () => {
  it('places library models for everyday nouns, with fallbacks', async () => {
    await loadCatalog();
    const w = await meadow();
    const { result } = await mockApply('add 2 sofas', w);
    expect(result.errors).toEqual([]);
    expect(added(w, result.world)).toEqual(['sofa', 'sofa']);
    const car = await mockApply('add a police car', w);
    expect(added(w, car.result.world)).toEqual(['police-car']);
    const chair = Object.values((await mockApply('add a chair', w)).result.world.entities).find((e) => !w.entities[e.id] && e.shape.kind === 'asset');
    expect(chair?.shape).toMatchObject({ kind: 'asset', fallback: { kind: 'procedural', generator: 'chair' } });
  });

  it('knows nouns outside its built-in vocabulary through the catalog', async () => {
    await loadCatalog();
    const w = await meadow();
    const { result } = await mockApply('add a fridge', w);
    expect(result.errors).toEqual([]);
    expect(added(w, result.world)).toEqual(['fridge']);
  });

  it('keeps nature and gameplay pieces procedural', async () => {
    await loadCatalog();
    const w = await meadow();
    expect(added(w, (await mockApply('add 3 trees', w)).result.world)).toEqual([]);
    expect(added(w, (await mockApply('add 5 coins', w)).result.world)).toEqual([]);
  });

  it('brings characters and animals to life', async () => {
    await loadCatalog();
    const w = await meadow();
    const villager = Object.values((await mockApply('add a villager', w)).result.world.entities).find((e) => !w.entities[e.id] && (e.shape.kind === 'asset' || e.character !== undefined));
    const dog = Object.values((await mockApply('add a dog', w)).result.world.entities).find((e) => !w.entities[e.id] && e.shape.kind === 'asset');
    expect(villager?.tags).toContain('npc');
    // People are real animated humans (a cast member), not a library model.
    expect(villager?.character).toBeDefined();
    // Characters are intelligent NPCs (perception, behaviour graph, dialogue), not the legacy greeter.
    expect(villager?.npc).toMatchObject({ archetype: 'villager', role: 'villager' });
    expect(Object.keys(villager?.npc?.dialogue?.nodes ?? {}).length).toBeGreaterThan(1);
    expect(dog?.npc?.wander).toBeGreaterThan(0);
  });

  it('dresses the city street with library models and an HDR sky when the catalog is loaded', async () => {
    await loadCatalog();
    const { result } = await mockApply('a city street with traffic');
    expect(result.errors).toEqual([]);
    const ids = assetIds(result.world);
    expect(ids.filter((i) => i === 'road' || i === 'road-crossing').length).toBeGreaterThanOrEqual(10);
    expect(ids).toContain('sports-car');
    expect(ids.some((i) => i.startsWith('man') || i.startsWith('woman'))).toBe(true);
    expect(result.world.environment.hdri).toBe('sky-partly-cloudy');
    const player = result.world.player.controls;
    expect(player && result.world.entities[player]?.shape).toMatchObject({ kind: 'asset', id: 'sports-car', fallback: { kind: 'procedural', generator: 'car' } });
  });

  it('without a catalog everything stays procedural (never empty)', async () => {
    setCatalog(null);
    const { result } = await mockApply('a city street with traffic', createWorld());
    expect(result.errors).toEqual([]);
    expect(assetIds(result.world)).toEqual([]);
    expect(Object.keys(result.world.entities).length).toBeGreaterThan(20);
  });
});
