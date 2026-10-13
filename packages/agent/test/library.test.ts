import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, summarizeWorld, type GeneratorDef } from '@aether/core';
import { WorldAgent } from '../src/agent';
import { LIBRARY_REF_LIMITS, libraryDefinitions, referencedGenerators } from '../src/library-refs';
import { buildSystemPrompt } from '../src/prompt';
import { createMockProvider } from '../src/providers/mock/index';
import { findLibraryItems, type MockLibraryItem } from '../src/providers/mock/library';
import { planMock } from '../src/providers/mock/planner';
import { MemoryHost, TEST_CATALOGS, collect } from './helpers';

const LIBRARY: MockLibraryItem[] = [
  { id: 'pagoda', keywords: ['pagoda'], size: [6, 12, 6] },
  { id: 'toy-tank', keywords: ['toy tank', 'army tank'], size: [3, 2, 4] },
  { id: 'lighthouse', keywords: ['lighthouse', 'light house'], size: [3, 11, 3] },
];

const DEFS: Record<string, GeneratorDef> = {
  pagoda: { id: 'pagoda', description: 'pagoda', params: {}, source: "api.add(api.cone(2, 4, 8).translate(0, 2, 0), { color: '#aa3333' }); api.autoColliders('box'); return api.build();" },
  lighthouse: { id: 'lighthouse', description: 'lighthouse', params: {}, source: "api.add(api.cylinder(1, 1, 8, 12).translate(0, 4, 0), { color: '#ffffff' }); api.autoColliders('box'); return api.build();" },
};
const resolve = async (id: string): Promise<GeneratorDef | null> => DEFS[id] ?? null;

describe('findLibraryItems', () => {
  it('matches whole words, plurals and counts, preferring the longer phrase', () => {
    expect(findLibraryItems('three pagodas by a lake', LIBRARY)).toEqual([{ item: LIBRARY[0], keyword: 'pagoda', count: 3 }]);
    expect(findLibraryItems('an army tank', LIBRARY).map((h) => h.keyword)).toEqual(['army tank']);
    expect(findLibraryItems('a fish tank', LIBRARY)).toEqual([]);
    expect(findLibraryItems('pagodaland', LIBRARY)).toEqual([]);
    expect(findLibraryItems('a pagoda', [])).toEqual([]);
  });

  it('caps counts and hits', () => {
    expect(findLibraryItems('500 pagodas', LIBRARY)[0]?.count).toBe(12);
  });
});

describe('referencedGenerators / libraryDefinitions', () => {
  it('finds procedural refs in entities and scatters, ignoring malformed ids', () => {
    const ids = referencedGenerators([
      { op: 'add', entity: { id: 'a', shape: { kind: 'procedural', generator: 'pagoda' } } },
      { op: 'add', entity: { id: 'b', shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'lighthouse' }, count: 3, area: [5, 5] } } },
      { op: 'add', entity: { id: 'c', shape: { kind: 'procedural', generator: '__proto__' } } },
      { op: 'add', entity: { id: 'd', shape: { kind: 'primitive', generator: 'rock' } } },
    ]);
    expect([...ids].sort()).toEqual(['lighthouse', 'pagoda']);
  });

  it('is bounded on deep or huge input', () => {
    let deep: unknown = { kind: 'procedural', generator: 'pagoda' };
    for (let i = 0; i < LIBRARY_REF_LIMITS.MAX_DEPTH + 4; i++) deep = { x: deep };
    expect(referencedGenerators([deep]).size).toBe(0);
  });

  it('defines only what is missing: not built in, not in the world, not in the batch', async () => {
    const world = createWorld();
    world.generators['lighthouse'] = DEFS['lighthouse'] as GeneratorDef;
    const patches = [
      { op: 'add', entity: { id: 'a', shape: { kind: 'procedural', generator: 'pagoda' } } },
      { op: 'add', entity: { id: 'b', shape: { kind: 'procedural', generator: 'lighthouse' } } },
      { op: 'add', entity: { id: 'c', shape: { kind: 'procedural', generator: 'rock' } } },
      { op: 'add', entity: { id: 'd', shape: { kind: 'procedural', generator: 'mystery' } } },
    ];
    const defs = await libraryDefinitions(patches, world, new Set(['rock']), resolve);
    expect(defs.map((d) => d.generator.id)).toEqual(['pagoda']);
    const inBatch = await libraryDefinitions([{ op: 'defineGenerator', generator: { id: 'pagoda' } }, ...patches], createWorld(), new Set(), resolve);
    expect(inBatch.map((d) => d.generator.id)).toEqual(['lighthouse']);
  });

  it('drops resolver failures and mismatched ids', async () => {
    const patches = [{ op: 'add', entity: { id: 'a', shape: { kind: 'procedural', generator: 'pagoda' } } }];
    expect(await libraryDefinitions(patches, createWorld(), new Set(), async () => { throw new Error('offline'); })).toEqual([]);
    expect(await libraryDefinitions(patches, createWorld(), new Set(), async () => ({ ...(DEFS['lighthouse'] as GeneratorDef) }))).toEqual([]);
  });
});

describe('offline planner with the library', () => {
  it('makes a named library object the centrepiece of a bare scene', () => {
    const plan = planMock('a pagoda', '', LIBRARY);
    const hero = plan.patches.find((p) => JSON.stringify(p).includes('"generator":"pagoda"'));
    expect(hero).toBeDefined();
    expect(JSON.stringify(hero)).toContain('"focus"');
    expect(JSON.stringify(hero)).toContain('"position":[0,0,0]');
    expect(plan.message.toLowerCase()).toContain('pagoda');
  });

  it('adds library objects to an existing world on request', () => {
    const world = applyPatches(createWorld(), [{ op: 'add', entity: { id: 'tree-1', transform: { position: [0, 0, 0] }, shape: { kind: 'procedural', generator: 'tree-oak' } } }]).world;
    const summary = summarizeWorld(world);
    const plan = planMock('add a red pagoda', summary, LIBRARY);
    const add = plan.patches.find((p) => JSON.stringify(p).includes('"generator":"pagoda"'));
    expect(add).toBeDefined();
    expect(JSON.stringify(add)).toContain('#e63946');
  });

  it('without a library, unknown nouns stay unmapped (previous behaviour)', () => {
    expect(JSON.stringify(planMock('a pagoda', '', []).patches)).not.toContain('"generator":"pagoda"');
  });

  it('end to end: the agent defines the library generator before the entity that uses it', async () => {
    const host = new MemoryHost();
    const agent = new WorldAgent({ provider: createMockProvider({ library: LIBRARY }), catalogs: TEST_CATALOGS, resolveGenerator: resolve, maxRepairs: 0 });
    const events = await collect(agent.run('a lighthouse', host));
    expect(events.some((e) => e.type === 'generator' && e.ok && e.def.id === 'lighthouse')).toBe(true);
    expect(host.world.generators['lighthouse']).toBeDefined();
    const entity = Object.values(host.world.entities).find((e) => e.shape.kind === 'procedural' && e.shape.generator === 'lighthouse');
    expect(entity).toBeDefined();
    expect(events.filter((e) => e.type === 'patches').every((e) => e.type === 'patches' && e.result.errors.length === 0)).toBe(true);
  });
});

describe('prompt', () => {
  it('lists library generators in their own section only when present', () => {
    expect(buildSystemPrompt(TEST_CATALOGS)).not.toContain('## Library generators');
    const p = buildSystemPrompt({ ...TEST_CATALOGS, libraryGenerators: [{ id: 'pagoda', description: 'Tiered pagoda', category: 'architecture', params: {} }] });
    expect(p).toContain('## Library generators');
    expect(p).toContain('- pagoda: Tiered pagoda');
  });
});
