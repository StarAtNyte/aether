import { describe, expect, it } from 'vitest';
import { Patch } from '@aether/core';
import { MAX_LISTED_IDS, patchChips, patchLabel, summarizePatches } from '../src/lib/patchSummary';

const p = (x: unknown): Patch => Patch.parse(x);

describe('summarizePatches', () => {
  it('counts each category and builds the chip label', () => {
    const patches: Patch[] = [];
    for (let i = 0; i < 12; i++) patches.push(p({ op: 'add', entity: { id: `e-${i}` } }));
    patches.push(p({ op: 'update', id: 'e-1', set: { name: 'x' } }), p({ op: 'update', id: 'e-2', set: {} }), p({ op: 'rename', id: 'e-3', newId: 'e-33' }));
    patches.push(p({ op: 'addRule', rule: { id: 'r', when: { on: 'start' }, then: [{ do: 'reset' }] } }), p({ op: 'removeRule', id: 'q' }));
    const s = summarizePatches(patches);
    expect(s.addedCount).toBe(12);
    expect(s.updatedCount).toBe(3);
    expect(s.rules).toBe(2);
    expect(s.updated).toContain('e-3 → e-33');
    expect(patchLabel(s)).toBe('＋ 12 entities · ✎ 3 · rules 2');
  });

  it('caps listed ids but keeps exact counts', () => {
    const patches = Array.from({ length: 100 }, (_, i) => p({ op: 'remove', id: `r-${i}` }));
    const s = summarizePatches(patches);
    expect(s.removedCount).toBe(100);
    expect(s.removed).toHaveLength(MAX_LISTED_IDS);
    expect(patchChips(s)).toEqual(['− 100']);
  });

  it('tracks generators, scripts, tests and world-level ops', () => {
    const s = summarizePatches([
      p({ op: 'defineGenerator', generator: { id: 'gen-a', description: 'd', source: 'return api.build();' } }),
      p({ op: 'removeScript', id: 'old' }),
      p({ op: 'addTest', test: { id: 't', kind: 'noOverlap' } }),
      p({ op: 'setEnvironment', set: { sky: 'night' } }),
      p({ op: 'setState', key: 'score', value: 0 }),
    ]);
    expect(s.generators).toEqual(['gen-a']);
    expect(s.scripts).toEqual(['−old']);
    expect(s.tests).toBe(1);
    expect(s.world).toBe(2);
    expect(patchLabel(s)).toBe('generators 1 · scripts 1 · tests 1 · world 2');
  });

  it('labels an empty batch', () => {
    expect(patchLabel(summarizePatches([]))).toBe('no changes');
    expect(patchChips(summarizePatches([p({ op: 'add', entity: { id: 'one' } })]))).toEqual(['＋ 1 entity']);
  });
});
