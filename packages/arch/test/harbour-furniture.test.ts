import { describe, expect, it } from 'vitest';
import { buildFurniture, furnitureByKind, furnitureSize } from '../src/furniture/index';
import type { ArchOutput, ArchPart } from '../src/types';

const CASES: Array<[string, Record<string, unknown>]> = [
  ['boat', {}],
  ['boat', { variant: 'dinghy' }],
  ['boat', { variant: 'fishing', hull: '#a8322a' }],
  ['boat', { variant: 'sailboat', length: 9 }],
  ['boat', { variant: 'motorboat', length: 5 }],
  ['bollard', {}],
  ['bollard', { variant: 'cleat' }],
  ['bollard', { variant: 'pile', height: 3 }],
  ['lobster-pot', {}],
  ['seagull', {}],
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

describe('harbour parts', () => {
  for (const [kind, params] of CASES) {
    it(`${kind} ${JSON.stringify(params)} is a small, sane mesh`, () => {
      const def = furnitureByKind(kind);
      expect(def, kind).toBeDefined();
      const out = buildFurniture(def!, params as never, 3);
      expect(tris(out)).toBeGreaterThan(8);
      expect(tris(out), 'under the per-piece budget').toBeLessThan(6000);
      expect(out.parts.length).toBeLessThanOrEqual(8);
      expect(out.colliders.length).toBeGreaterThan(0);
      const b = bounds(out);
      expect(b.every(Number.isFinite)).toBe(true);
      const size = furnitureSize(def!, params as never);
      expect(b[3]! - b[0]!).toBeLessThan(size[0] + 1);
      expect(b[5]! - b[2]!).toBeLessThan(size[2] + 1);
      for (const part of out.parts) expect(winding(part), `${kind} winding`).toBeGreaterThan(0.9);
    });
  }
  it('a boat floats: the keel is under the waterline and the bow points to +Z', () => {
    const out = buildFurniture(furnitureByKind('boat')!, { variant: 'fishing' } as never, 1);
    const b = bounds(out);
    expect(b[1]).toBeLessThan(-0.3);
    expect(b[4]).toBeGreaterThan(0.9);
    expect(b[5]! - b[2]!).toBeGreaterThan(8);
  });
  it('is found by its everyday names', () => {
    for (const w of ['rowboat', 'fishing boat', 'sailing boat', 'mooring bollard', 'cleat', 'lobster pot', 'gull']) expect(furnitureByKind(w), w).toBeDefined();
  });
});
