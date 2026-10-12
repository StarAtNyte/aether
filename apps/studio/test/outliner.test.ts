import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { buildOutlinerRows, matchesFilter, rowKind, visibleRange } from '../src/lib/outliner';

const world = createWorld({
  entities: {
    house: { id: 'house', name: 'House', tags: ['building'], shape: { kind: 'procedural', generator: 'house' } },
    door: { id: 'door', name: 'Door', parent: 'house', shape: { kind: 'primitive', primitive: 'box' }, physics: { body: 'dynamic' } },
    knob: { id: 'knob', parent: 'door', shape: { kind: 'primitive', primitive: 'sphere' } },
    lamp: { id: 'lamp', light: { type: 'point' } },
    trees: { id: 'trees', shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'cone' }, count: 5, area: [4, 4] } },
    coin: { id: 'coin', template: true, behaviors: [{ type: 'spin' }] },
  },
});

describe('outliner rows', () => {
  it('flattens the hierarchy depth-first in document order', () => {
    const rows = buildOutlinerRows(world, '', new Set());
    expect(rows.map((r) => [r.id, r.depth])).toEqual([
      ['house', 0],
      ['door', 1],
      ['knob', 2],
      ['lamp', 0],
      ['trees', 0],
      ['coin', 0],
    ]);
    expect(rows[0]?.childCount).toBe(1);
    expect(rows[1]?.dynamic).toBe(true);
    expect(rows[5]?.hasBehaviors).toBe(true);
    expect(rows[2]?.name).toBe('knob');
  });

  it('reuses row objects for unchanged entities across commits (memoized rows skip re-render)', () => {
    const before = buildOutlinerRows(world, '', new Set());
    const r = applyPatches(world, [{ op: 'update', id: 'lamp', set: { name: 'Lamp 2' } }]);
    expect(r.errors).toEqual([]);
    const after = buildOutlinerRows(r.world, '', new Set());
    const byId = (rows: typeof before, id: string) => rows.find((x) => x.id === id);
    expect(byId(after, 'house')).toBe(byId(before, 'house'));
    expect(byId(after, 'trees')).toBe(byId(before, 'trees'));
    expect(byId(after, 'lamp')).not.toBe(byId(before, 'lamp'));
    expect(byId(after, 'lamp')?.name).toBe('Lamp 2');
    // Same entity at a different depth (flat filter view) gets its own row.
    expect(buildOutlinerRows(world, 'knob', new Set())[0]?.depth).toBe(0);
  });

  it('hides children of collapsed nodes', () => {
    const rows = buildOutlinerRows(world, '', new Set(['house']));
    expect(rows.map((r) => r.id)).toEqual(['house', 'lamp', 'trees', 'coin']);
  });

  it('filters flat by text and #tag', () => {
    expect(buildOutlinerRows(world, 'door', new Set()).map((r) => r.id)).toEqual(['door']);
    expect(buildOutlinerRows(world, '#build', new Set()).map((r) => r.id)).toEqual(['house']);
    expect(buildOutlinerRows(world, 'HOUSE', new Set()).map((r) => r.id)).toEqual(['house']);
  });

  it('classifies kinds', () => {
    const e = world.entities;
    expect([e['house'], e['door'], e['lamp'], e['trees'], e['coin']].map((x) => (x ? rowKind(x) : null))).toEqual(['procedural', 'primitive', 'light', 'scatter', 'template']);
    expect(matchesFilter(e['house']!, '  ')).toBe(true);
  });

  it('computes virtualized ranges', () => {
    expect(visibleRange(1000, 28, 0, 280, 0)).toEqual({ start: 0, end: 10 });
    expect(visibleRange(1000, 28, 2800, 280, 5)).toEqual({ start: 95, end: 115 });
    expect(visibleRange(10, 28, 99999, 280)).toEqual({ start: 10, end: 10 });
    expect(visibleRange(0, 28, 0, 280)).toEqual({ start: 0, end: 0 });
  });

  it('builds 5000 rows quickly', () => {
    const entities: Record<string, { id: string; parent?: string }> = {};
    for (let i = 0; i < 5000; i++) entities[`e-${i}`] = { id: `e-${i}`, ...(i > 0 ? { parent: `e-${Math.floor((i - 1) / 4)}` } : {}) };
    const big = createWorld({ entities });
    const t0 = performance.now();
    const rows = buildOutlinerRows(big, '', new Set());
    expect(rows).toHaveLength(5000);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
