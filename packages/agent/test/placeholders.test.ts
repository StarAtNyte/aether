import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { getBuiltinGenerator } from '@aether/procgen';
import { describe, expect, it } from 'vitest';
import { findPlaceholders, generatorForName, placeholderFindings, withPlaceholders } from '../src/placeholders';

function world(entities: Array<Record<string, unknown>>): WorldDoc {
  const out = applyPatches(createWorld(), entities.map((entity) => ({ op: 'add', entity })) as never);
  expect(out.errors).toEqual([]);
  return out.world;
}
const box = (id: string, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id, name, shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, ...extra });

describe('placeholder pieces', () => {
  it('names a box crate, a cylinder barrel and a floodlight pole, with the generator that draws each', () => {
    const w = world([box('c1', 'Ammunition crate'), { id: 'b1', name: 'Oil barrel', shape: { kind: 'primitive', primitive: 'cylinder', size: [0.6, 0.9, 0.6] } }, { id: 'f1', name: 'Floodlight mast', shape: { kind: 'primitive', primitive: 'cylinder', size: [0.2, 6, 0.2] } }]);
    const byId = Object.fromEntries(findPlaceholders(w).map((p) => [p.id, p.generator]));
    expect(byId).toEqual({ c1: 'crate', b1: 'barrel', f1: 'lamp-post' });
    const f = placeholderFindings(w).find((x) => x.entities.includes('c1'));
    expect(f?.code).toBe('placeholder_prop');
    expect(f?.fix).toContain('generator:"crate"');
  });

  it('leaves generated props, opted-out primitives and unrelated names alone', () => {
    const w = world([
      { id: 'g1', name: 'Crate', shape: { kind: 'procedural', generator: 'crate' } },
      box('t1', 'Supply crate', { tags: ['trigger'] }),
      box('d1', 'Desk lamp'),
      { id: 'm1', name: 'Ship mast', shape: { kind: 'primitive', primitive: 'cylinder', size: [0.2, 8, 0.2] } },
      box('w1', 'Wall'),
    ]);
    expect(findPlaceholders(w)).toEqual([]);
  });

  it('reports a group stacked from primitives once, for the group, not per part', () => {
    const parts = Array.from({ length: 6 }, (_, i) => box(`wall-${i}`, '', { parent: 'barrels' }));
    const w = world([{ id: 'barrels', name: 'Barrel stack', shape: { kind: 'none' } }, ...parts]);
    const found = findPlaceholders(w);
    expect(found.map((p) => p.id)).toEqual(['barrels']);
    expect(found[0]?.parts).toBe(6);
    expect(placeholderFindings(w)[0]?.message).toContain('built from 6 primitive parts');
  });

  it('names an NPC drawn as a capsule (people are rigged humans), not one with a character', () => {
    const npc = { role: 'guard', archetype: 'guard' };
    const capsule = { kind: 'primitive', primitive: 'capsule', size: [0.56, 1.7, 0.56] };
    const w = world([{ id: 'p1', name: 'Guard', shape: capsule, npc }, { id: 'p2', name: 'Guard', shape: capsule, npc, character: { wardrobe: 'guard' } }]);
    const f = placeholderFindings(w);
    expect(f.map((x) => x.code)).toEqual(['placeholder_person']);
    expect(f[0]?.entities).toEqual(['p1']);
  });

  it('suggests only generators this build has', () => {
    const g = generatorForName('Shipping container');
    if (getBuiltinGenerator('shipping-container')) expect(g?.generator).toBe('shipping-container');
    else expect(g).toBeNull();
  });

  it('adds its findings to a review snapshot and replaces them on the next round', () => {
    const w = world([box('c1', 'Wooden crate')]);
    const snap = { findings: [], score: 100, keys: new Set<string>() } as never;
    const once = withPlaceholders(snap, w);
    const twice = withPlaceholders(once, w);
    expect(twice.findings.filter((f) => f.code === 'placeholder_prop')).toHaveLength(1);
    expect(twice.score).toBeLessThan(100);
  });
});
