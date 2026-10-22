/**
 * place_items with real library models: `model:<id>`, `model: "auto"`, `fit` and the recolour of upholstery.
 * Anchoring, collisions and usability treat the model like the part it stands in for.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { applyPatches, createWorld, type Entity, type WorldDoc } from '@aether/core';
import { catalogEntry, loadCatalog, setCatalog } from '@aether/assets';
import { runDesignTool } from '../src/index';

const PLAN = {
  id: 'home',
  name: 'Test home',
  style: 'modern',
  brief: 'A living room with a window.',
  levels: [
    {
      height: 2.9,
      rooms: [{ id: 'living', type: 'living', rect: [0, 0, 5, 4] }],
      openings: [
        { kind: 'window', room: 'living', wall: 'north', along: 2.5, width: 1.6, height: 1.3, sill: 0.9, id: 'win-n' },
        { kind: 'door', room: 'living', wall: 'south', to: 'outside', along: 4, width: 0.9, main: true, id: 'front' },
      ],
    },
  ],
  furniture: [],
};

function shell(): WorldDoc {
  const r = runDesignTool(createWorld({}), 'design_plan', { plan: PLAN });
  expect(r.ok, r.text).toBe(true);
  const res = applyPatches(createWorld({}), r.patches);
  expect(res.errors).toEqual([]);
  return res.world;
}

function place(world: WorldDoc, items: unknown[]): { text: string; ok: boolean; world: WorldDoc } {
  const r = runDesignTool(world, 'place_items', { items });
  return { text: r.text, ok: r.ok, world: r.world };
}

const pieces = (w: WorldDoc): Entity[] => Object.values(w.entities).filter((e) => e.tags?.includes('placed'));

beforeAll(async () => {
  await loadCatalog();
});
afterEach(() => undefined);

describe('place_items with library models', () => {
  it('places a model by id as the part it stands in for, with the part as fallback', () => {
    const r = place(shell(), [{ kind: 'model:sofa-02', room: 'living', wall: 'west', align: 'centre', id: 'couch' }]);
    expect(r.ok, r.text).toBe(true);
    const sofa = pieces(r.world).find((e) => e.id.endsWith('couch'))!;
    expect(sofa.shape).toMatchObject({ kind: 'asset', id: 'sofa-02', fallback: { kind: 'procedural', generator: 'furn-sofa' } });
    expect(sofa.arch?.kind).toBe('sofa');
  });

  it('scales a model to the wanted size and recolours upholstery', () => {
    const natural = catalogEntry('sofa-02')!.size;
    const r = place(shell(), [{ kind: 'model:sofa-02', room: 'living', wall: 'west', align: 'centre', id: 'couch', fit: [natural[0] * 0.8, 0, 0], params: { color: '#aa3322' } }]);
    expect(r.ok, r.text).toBe(true);
    const sofa = pieces(r.world).find((e) => e.id.endsWith('couch'))!;
    const fit = (sofa.shape as { fitSize?: number }).fitSize!;
    expect(fit).toBeCloseTo(Math.max(...natural) * 0.8, 2);
    expect(sofa.material?.color).toBe('#aa3322');
  });

  it('lets the finder choose with model auto, by the building style', () => {
    const r = place(shell(), [{ kind: 'armchair', model: 'auto', room: 'living', at: [2.5, 2.2], id: 'chair' }]);
    expect(r.ok, r.text).toBe(true);
    const chair = pieces(r.world).find((e) => e.id.endsWith('chair'))!;
    expect(chair.shape.kind).toBe('asset');
    expect(String((chair.shape as { id: string }).id)).toMatch(/^armchair-/);
  });

  it('places the parametric part, and says so, when auto finds nothing for the kind', () => {
    const r = place(shell(), [{ kind: 'rug', model: 'auto', room: 'living', at: [2.5, 2], id: 'ward' }]);
    expect(r.ok, r.text).toBe(true);
    const w = pieces(r.world).find((e) => e.id.endsWith('ward'))!;
    expect(w.shape.kind).toBe('procedural');
    expect(r.text).toMatch(/no library model fits/);
  });

  it('refuses an unknown model and keeps the usual collision checks for a known one', () => {
    const bad = place(shell(), [{ kind: 'model:no-such-thing', room: 'living', wall: 'west', align: 'centre' }]);
    expect(bad.text).toMatch(/unknown library model/);
    const first = place(shell(), [{ kind: 'model:sofa-02', room: 'living', at: [2.5, 2], id: 'a' }]);
    expect(first.ok).toBe(true);
    const second = place(first.world, [{ kind: 'model:sofa-02', room: 'living', at: [2.6, 2], id: 'b' }]);
    expect(second.text).toMatch(/refused|overlap/i);
  });
});
