import { describe, expect, it } from 'vitest';
import type { Json } from '@aether/core';
import { generateBuiltinSync } from '../src/index';
import type { GeneratorOutput } from '../src/types';
import { sameGeometry, windingMismatch } from './helpers';

const tris = (o: GeneratorOutput): number => o.parts.reduce((s, p) => s + p.indices.length / 3, 0);

/** Every case: id, params, triangle ceiling, draw (material) ceiling. */
const CASES: Array<[string, Record<string, Json>, number, number]> = [
  ['shipping-container', {}, 4500, 1],
  ['shipping-container', { length: 12.19 }, 7000, 1],
  ['shipping-container', { variant: 1, wear: 1 }, 4500, 1],
  ['shipping-container', { variant: 2, length: 12.19 }, 7500, 1],
  ['sandbag-wall', {}, 6000, 1],
  ['sandbag-wall', { length: 8, courses: 6, variant: 1 }, 7500, 1],
  ['sandbag-wall', { length: 5, bend: 120 }, 7500, 1],
  ['sandbag-wall', { variant: 2 }, 6000, 1],
  ['radio-mast', {}, 4000, 6],
  ['radio-mast', { height: 40, variant: 1 }, 7000, 6],
  ['radio-mast', { height: 30, variant: 2 }, 7000, 6],
  ['crate', { variant: 3 }, 1500, 3],
  ['barrel', { variant: 1 }, 2600, 1],
  ['barrel', { variant: 2 }, 2800, 2],
  ['fence', { variant: 3, height: 2.2 }, 3000, 1],
  ['fence', { variant: 3, height: 4, length: 60 }, 8000, 1],
  ['lamp-post', { variant: 3, height: 8 }, 1000, 3],
];

describe('outpost props and new variants', () => {
  for (const [id, params, maxTris, maxDraws] of CASES) {
    it(`${id} ${JSON.stringify(params)} builds within budget with colliders, deterministically`, () => {
      const a = generateBuiltinSync(id, params, 11);
      expect(tris(a)).toBeGreaterThan(100);
      expect(tris(a)).toBeLessThan(maxTris);
      expect(a.parts.length).toBeLessThanOrEqual(maxDraws);
      expect(a.colliders.length).toBeGreaterThan(0);
      expect(a.colliders.every((c) => c.kind === 'box' || c.kind === 'cylinder')).toBe(true);
      expect(a.bounds.min[1]).toBeCloseTo(0, 4);
      for (const p of a.parts) expect(windingMismatch(p.positions, p.normals, p.indices)).toBeLessThan(0.001);
      sameGeometry(a, generateBuiltinSync(id, params, 11));
      // Another seed varies the object (bags, codes, dents, lots).
      if (id !== 'fence' && id !== 'lamp-post' && id !== 'radio-mast') {
        const b = generateBuiltinSync(id, params, 12);
        const pa = a.parts[0]?.positions ?? new Float32Array();
        const pb = b.parts[0]?.positions ?? new Float32Array();
        const ca = a.parts[0]?.colors ?? new Float32Array();
        const cb = b.parts[0]?.colors ?? new Float32Array();
        expect(pa.length !== pb.length || pa.some((v, i) => v !== pb[i]) || ca.some((v, i) => v !== cb[i])).toBe(true);
      }
    });
  }

  it('a shipping container has real ISO proportions: 2.438 m wide, 2.591 m (high cube 2.896 m) tall', () => {
    const std = generateBuiltinSync('shipping-container', { length: 6.06 }, 1);
    expect(std.bounds.max[0] - std.bounds.min[0]).toBeCloseTo(6.06, 1);
    expect(std.bounds.max[2] - std.bounds.min[2]).toBeCloseTo(2.44, 1);
    expect(std.bounds.max[1]).toBeCloseTo(2.591, 2);
    expect(generateBuiltinSync('shipping-container', { variant: 1 }, 1).bounds.max[1]).toBeCloseTo(2.896, 2);
    // The walls are corrugated: many differently facing facets, not one flat face per side.
    const normals = std.parts[0]!.normals;
    const dirs = new Set<string>();
    for (let i = 0; i < normals.length; i += 3) dirs.add(`${(normals[i] as number).toFixed(2)},${(normals[i + 2] as number).toFixed(2)}`);
    expect(dirs.size).toBeGreaterThan(8);
  });

  it('a sandbag wall stacks its courses to the asked height and bends into an arc', () => {
    const low = generateBuiltinSync('sandbag-wall', { courses: 2 }, 1);
    const high = generateBuiltinSync('sandbag-wall', { courses: 6 }, 1);
    expect(high.bounds.max[1]).toBeGreaterThan(low.bounds.max[1] + 0.35);
    const bent = generateBuiltinSync('sandbag-wall', { length: 6, bend: 90 }, 1);
    expect(bent.bounds.max[2] - bent.bounds.min[2]).toBeGreaterThan(1);
    expect(bent.colliders.length).toBeGreaterThan(2);
  });

  it('a radio mast reaches its height, glows (status light, beacon) and guys only when asked', () => {
    const m = generateBuiltinSync('radio-mast', { height: 20 }, 1);
    expect(m.bounds.max[1]).toBeGreaterThan(20);
    expect(m.parts.some((p) => p.material.preset === 'emissive')).toBe(true);
    const free = generateBuiltinSync('radio-mast', { height: 20, guyed: false }, 1);
    expect(free.bounds.max[0] - free.bounds.min[0]).toBeLessThan(m.bounds.max[0] - m.bounds.min[0]);
  });
});
