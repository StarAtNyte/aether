import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { runDesignTool } from '@aether/arch';
import { findAboModels, loadCatalog } from '@aether/assets';
import { executeTool, type ExecutorContext } from '../src/executor';
import { MemoryHost } from './helpers';

const ctx = (): ExecutorContext => ({ host: new MemoryHost(), provider: {} as never, coderSystem: '', builtinGenerators: new Set<string>(), usage: { inputTokens: 0, outputTokens: 0 } }) as unknown as ExecutorContext;

const PLAN = {
  id: 'flat', name: 'Flat', style: 'modern', brief: 'A living room.',
  levels: [{ height: 2.8, rooms: [{ id: 'living', type: 'living', rect: [0, 0, 6, 5] }], openings: [{ kind: 'door', room: 'living', wall: 'south', to: 'outside', along: 1, width: 0.9, main: true }] }],
  furniture: [],
};

describe('streamed real products (Amazon Berkeley Objects) in the agent tools', () => {
  it('find_model lists real products first for an interior piece, and none for a stylised look', async () => {
    const sofa = await executeTool(ctx(), 'find_model', { what: 'chesterfield sofa' });
    expect(sofa.isError).toBe(false);
    expect(sofa.content).toMatch(/Real products \(Amazon Berkeley Objects/);
    expect(sofa.content).toMatch(/abo-[a-z0-9]{10} — [^\n]*Chesterfield[^\n]*sofa; [^\n]*MB/);
    expect(sofa.content).toContain('"kind":"model:<abo-id>"');
    const toy = await executeTool(ctx(), 'find_model', { what: 'sofa', look: 'low-poly' });
    expect(toy.content).not.toContain('Real products');
    const found = await executeTool(ctx(), 'search_assets', { query: 'chesterfield' });
    expect(found.content).toMatch(/abo-[a-z0-9]{10}/);
  });

  it('place_items takes a product by id at its real size and mounts it as the product mounts', async () => {
    await loadCatalog();
    let w = createWorld({});
    w = applyPatches(w, runDesignTool(w, 'design_plan', { plan: PLAN }).patches).world;
    const id = (text: string): string => findAboModels({ text, limit: 1 })[0]!.entry.id;
    const pendant = findAboModels({ text: 'pendant light', limit: 1 })[0]!.entry;
    const sofa = findAboModels({ text: 'sofa', limit: 1 })[0]!.entry;
    const r = runDesignTool(w, 'place_items', {
      items: [
        { kind: `model:${sofa.id}`, room: 'living', id: 'sofa', wall: 'north', align: 'centre' },
        { kind: `model:${id('wall art')}`, room: 'living', id: 'art', wall: 'north', align: 'centre' },
        { kind: `model:${id('pendant light')}`, room: 'living', id: 'pendant', at: [3, 2.5] },
      ],
    });
    w = applyPatches(w, r.patches).world;
    const placed = Object.values(w.entities).filter((e) => e.shape.kind === 'asset' && e.shape.id.startsWith('abo-'));
    expect(placed.map((e) => e.id).sort()).toEqual(['flat-art', 'flat-pendant', 'flat-sofa']);
    const s = w.entities['flat-sofa']!;
    expect(s.shape.kind === 'asset' && s.shape.id).toBe(sofa.id);
    expect(s.shape.kind === 'asset' && s.shape.fitSize).toBeUndefined();
    expect(s.transform.position[1]).toBe(0);
    expect(w.entities['flat-art']!.transform.position[1]).toBeGreaterThan(0.8);
    // A pendant hangs from the ceiling: its top is at the ceiling (2.8 m less the slab).
    expect(w.entities['flat-pendant']!.transform.position[1] + pendant.size[1]).toBeGreaterThan(2.4);
  });
});
