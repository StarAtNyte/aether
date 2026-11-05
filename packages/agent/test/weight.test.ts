import { describe, expect, it } from 'vitest';
import type { WorldDoc } from '@aether/core';
import { WEIGHT_LIMITS, weightFindings } from '../src/weight';

const base = { id: '', name: '', parent: null, tags: [], transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, behaviors: [], state: {}, visible: true, castShadow: true, receiveShadow: true, template: false };
const box = (id: string, x: number, rot = 0): Record<string, unknown> => ({ ...base, id, transform: { position: [x, 0, 0], rotation: [0, rot, 0], scale: [1, 1, 1] }, shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, material: { color: '#888888' } });
const lamp = (id: string, shadow: boolean): Record<string, unknown> => ({ ...base, id, shape: { kind: 'none' }, light: { type: 'point', color: '#ffffff', intensity: 1, range: 5, angle: 30, castShadow: shadow } });
const world = (entities: Array<Record<string, unknown>>): WorldDoc => ({ entities: Object.fromEntries(entities.map((e) => [e.id as string, e])) }) as unknown as WorldDoc;

describe('weight checks', () => {
  it('flags identical pieces placed one by one, but not when they turn differently', () => {
    const same = Array.from({ length: WEIGHT_LIMITS.REPEATS }, (_, i) => box(`b${i}`, i));
    expect(weightFindings(world(same)).map((f) => f.code)).toEqual(['repeat_pieces']);
    const turned = Array.from({ length: WEIGHT_LIMITS.REPEATS }, (_, i) => box(`b${i}`, i, i * 10));
    expect(weightFindings(world(turned))).toEqual([]);
    const few = same.slice(0, WEIGHT_LIMITS.REPEATS - 1);
    expect(weightFindings(world(few))).toEqual([]);
  });

  it('flags shadow-casting lamps past the allowance', () => {
    const lamps = Array.from({ length: WEIGHT_LIMITS.SHADOW_LAMPS + 1 }, (_, i) => lamp(`l${i}`, true));
    const f = weightFindings(world(lamps));
    expect(f.map((x) => x.code)).toEqual(['shadow_lamps']);
    expect(f[0]!.entities).toHaveLength(WEIGHT_LIMITS.SHADOW_LAMPS + 1);
    expect(weightFindings(world(lamps.slice(0, WEIGHT_LIMITS.SHADOW_LAMPS)))).toEqual([]);
  });

  it('ignores hidden pieces and templates', () => {
    const hidden = Array.from({ length: WEIGHT_LIMITS.REPEATS }, (_, i) => ({ ...box(`b${i}`, i), visible: false }));
    expect(weightFindings(world(hidden))).toEqual([]);
  });
});

describe('streamed product weight', () => {
  const product = (id: string, asset: string, x: number): Record<string, unknown> => ({ ...base, id, transform: { position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { kind: 'asset', id: asset } });
  const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `abo-b0${String(i).padStart(8, '0')}`);

  it('passes a furnished room and warns, then fails, as distinct products pile up', () => {
    // No index installed: each product counts as the pack median (1.4 MB, 20k triangles).
    expect(weightFindings(world(ids(12).map((a, i) => product(`p${i}`, a, i))))).toEqual([]);
    const heavy = weightFindings(world(ids(60).map((a, i) => product(`p${i}`, a, i))));
    expect(heavy.map((f) => [f.code, f.severity])).toEqual([['streamed_products', 'warning']]);
    const huge = weightFindings(world(ids(140).map((a, i) => product(`p${i}`, a, i))));
    expect(huge.map((f) => [f.code, f.severity])).toEqual([['streamed_products', 'error']]);
    expect(huge[0]!.message).toMatch(/140 distinct streamed products/);
  });

  it('counts a reused product once for bytes but every copy for triangles', () => {
    const chairs = Array.from({ length: 160 }, (_, i) => product(`c${i}`, 'abo-b000000001', i));
    const f = weightFindings(world(chairs)).filter((x) => x.code === 'streamed_products');
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toMatch(/^1 distinct streamed products .* download about 1 MB and draw 3\.2 M triangles/);
  });
});
