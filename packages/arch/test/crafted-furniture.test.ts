import { describe, expect, it } from 'vitest';
import { FURNITURE, buildFurniture, furnitureByKind, furnitureSize } from '../src/furniture/index';
import { slotNames } from '../src/furniture/slots';
import { KIND_SYNONYMS } from '../src/photo/description';
import type { ArchOutput, ArchPart } from '../src/types';

const CASES: Array<[string, Record<string, unknown>]> = [
  ['sink', {}],
  ['sink', { style: 'wall-hung' }],
  ['sink', { style: 'vessel' }],
  ['sink', { style: 'utility', bowls: 2 }],
  ['sink', { style: 'utility', bowls: 1, drainer: false }],
  ['cane-chair', {}],
  ['cane-chair', { variant: 'bar', height: 0.7 }],
  ['cane-chair', { variant: 'stool', height: 0.5 }],
  ['rug', { pattern: 'diamonds' }],
  ['rug', { pattern: 'kilim', width: 3, depth: 2 }],
  ['rug', { pattern: 'shag' }],
  ['rug', { pattern: 'shag', shape: 'round', width: 5, depth: 4 }],
  ['fridge', { layout: 'bottom-freezer' }],
  ['fridge', { layout: 'single', height: 0.85, width: 0.6 }],
  ['fridge', { layout: 'side-by-side', width: 0.95 }],
  ['fridge', { layout: 'french', width: 0.9 }],
  ['oven', {}],
  ['oven', { width: 1.1 }],
  ['extractor', {}],
];

const tris = (o: ArchOutput): number => o.parts.reduce((a, p) => a + p.indices.length / 3, 0);
function bounds(o: ArchOutput): number[] {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of o.parts) for (let k = 0; k < p.positions.length; k += 3) for (let a = 0; a < 3; a++) {
    const v = p.positions[k + a] as number;
    b[a] = Math.min(b[a] as number, v);
    b[a + 3] = Math.max(b[a + 3] as number, v);
  }
  return b;
}
function winding(q: ArchPart): number {
  let ok = 0;
  let total = 0;
  const p = q.positions;
  const n = q.normals;
  for (let k = 0; k < q.indices.length; k += 3) {
    const [a, b, c] = [0, 1, 2].map((i) => (q.indices[k + i] as number) * 3) as [number, number, number];
    const u = [0, 1, 2].map((i) => (p[b + i] as number) - (p[a + i] as number));
    const v = [0, 1, 2].map((i) => (p[c + i] as number) - (p[a + i] as number));
    const g = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    if (Math.hypot(g[0]!, g[1]!, g[2]!) < 1e-10) continue;
    const s = [0, 1, 2].map((i) => (n[a + i] as number) + (n[b + i] as number) + (n[c + i] as number));
    total++;
    if (g[0]! * s[0]! + g[1]! * s[1]! + g[2]! * s[2]! > 0) ok++;
  }
  return total === 0 ? 1 : ok / total;
}

describe('crafted procedural furniture', () => {
  for (const [kind, params] of CASES) {
    it(`${kind} ${JSON.stringify(params)} builds under 10k triangles with sane bounds`, () => {
      const def = furnitureByKind(kind);
      expect(def, kind).toBeDefined();
      const out = buildFurniture(def!, params as never, 3);
      expect(tris(out)).toBeGreaterThan(20);
      expect(tris(out)).toBeLessThan(10_000);
      if (kind !== 'rug') expect(out.colliders.length).toBeGreaterThan(0);
      const b = bounds(out);
      const size = furnitureSize(def!, params as never);
      expect(b.every(Number.isFinite)).toBe(true);
      expect(b[1]!).toBeGreaterThan(-0.02);
      // The drawn piece stays within a little more than its declared footprint and height.
      expect(b[3]! - b[0]!).toBeLessThan(size[0] + 0.5);
      expect(b[5]! - b[2]!).toBeLessThan(size[2] + 0.5);
      expect(b[4]!).toBeLessThan(size[1] + 0.3);
      for (const part of out.parts) expect(winding(part)).toBeGreaterThan(0.97);
    });
  }

  it('is deterministic', () => {
    const d = furnitureByKind('rug')!;
    const a = buildFurniture(d, { pattern: 'shag' }, 5);
    const b = buildFurniture(d, { pattern: 'shag' }, 5);
    expect(Array.from(a.parts[0]!.positions)).toEqual(Array.from(b.parts[0]!.positions));
  });

  it('clamps and defaults params', () => {
    const sink = furnitureByKind('sink')!;
    expect(furnitureSize(sink, { style: 'nonsense', width: 99 } as never)[0]).toBe(1.8 > 0 ? furnitureSize(sink, { width: 1.8 })[0] : 0);
    expect(furnitureSize(furnitureByKind('cane-chair')!, { variant: 'stool', height: 9 } as never)[1]).toBeLessThanOrEqual(0.8);
    expect(furnitureSize(furnitureByKind('fridge')!, { height: 0.1 } as never)[1]).toBeCloseTo(0.8);
  });

  it('is registered with ids, slots and photo aliases', () => {
    for (const k of ['sink', 'cane-chair', 'oven', 'extractor']) {
      expect(FURNITURE.find((f) => f.kind === k)?.id).toBe(`furn-${k}`);
      expect(slotNames(k).length, k).toBeGreaterThan(0);
    }
    expect(KIND_SYNONYMS['rattan-chair']).toBe('cane-chair');
    expect(KIND_SYNONYMS['pedestal-sink']).toBe('sink');
    expect(KIND_SYNONYMS['refrigerator']).toBe('fridge');
  });
});
