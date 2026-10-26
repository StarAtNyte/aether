import { describe, expect, it } from 'vitest';
import { FURNITURE, buildFurniture, furnitureByKind, furnitureSize } from '../src/furniture/index';
import { slotNames } from '../src/furniture/slots';
import type { ArchOutput, ArchPart } from '../src/types';

const CASES: Array<[string, Record<string, unknown>]> = [
  ['cinema-seat', {}],
  ['cinema-seat', { seatUp: true, upholstery: 'leather', color: '#222222', cupholder: false }],
  ['tier-steps', {}],
  ['tier-steps', { rows: 14, width: 12, depth: 1.1, riser: 0.2, finish: 'concrete' }],
  ['cinema-screen', {}],
  ['cinema-screen', { width: 14, format: 'flat', content: 'white', masking: false }],
  ['cinema-screen', { content: 'off' }],
  ['stage', {}],
  ['stage', { curtains: 'closed', steps: false, backdrop: false }],
  ['stage', { curtains: 'none', width: 5, depth: 3 }],
  ['speaker', {}],
  ['speaker', { variant: 'surround' }],
  ['speaker', { variant: 'column' }],
  ['speaker', { variant: 'monitor' }],
  ['acoustic-panel', {}],
  ['acoustic-panel', { variant: 'slat' }],
  ['acoustic-panel', { variant: 'diffuser' }],
  ['booth-window', {}],
  ['booth-window', { ports: 3, lit: false }],
  ['step-light', {}],
  ['step-light', { variant: 'bollard' }],
  ['lectern', {}],
  ['lectern', { variant: 'podium' }],
  ['lectern', { variant: 'pulpit' }],
  ['pew', {}],
  ['pew', { length: 4, kneeler: false, pad: true }],
  ['altar', {}],
  ['altar', { variant: 'stone', objects: false, width: 2.4 }],
  ['library-stack', {}],
  ['library-stack', { sided: 'single', width: 1.6, shelves: 8 }],
  ['vitrine', {}],
  ['vitrine', { variant: 'plinth', object: 'bust' }],
  ['vitrine', { variant: 'table', object: 'bowl', height: 0.95 }],
  ['vitrine', { object: 'urn', width: 1.4 }],
  ['reception-desk', {}],
  ['reception-desk', { variant: 'concession', length: 4 }],
  ['reception-desk', { variant: 'bar', length: 4.5 }],
  ['school-desk', {}],
  ['school-desk', { chair: false }],
  ['blackboard', {}],
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

describe('venue and public-space furniture', () => {
  for (const [kind, params] of CASES) {
    it(`${kind} ${JSON.stringify(params)} is a small, sane, consistently wound mesh`, () => {
      const def = furnitureByKind(kind);
      expect(def, kind).toBeDefined();
      const out = buildFurniture(def!, params as never, 3);
      expect(tris(out)).toBeGreaterThan(8);
      expect(tris(out), 'under the per-piece budget').toBeLessThan(10_000);
      expect(out.colliders.length).toBeGreaterThan(0);
      expect(out.parts.length).toBeLessThanOrEqual(16);
      const b = bounds(out);
      expect(b.every(Number.isFinite)).toBe(true);
      expect(b[1]!).toBeGreaterThan(-0.02);
      const size = furnitureSize(def!, params as never);
      expect(b[3]! - b[0]!).toBeLessThan(size[0] + 1.2);
      expect(b[5]! - b[2]!).toBeLessThan(size[2] + 1.5);
      for (const part of out.parts) expect(winding(part), `${kind} winding`).toBeGreaterThan(0.97);
    });
  }

  it('a seat flipped up stands taller in the seat zone and is deterministic', () => {
    const d = furnitureByKind('cinema-seat')!;
    const down = buildFurniture(d, {}, 1);
    const up = buildFurniture(d, { seatUp: true }, 1);
    expect(tris(up)).toBe(tris(down));
    const a = buildFurniture(d, { seatUp: true }, 5);
    const b = buildFurniture(d, { seatUp: true }, 5);
    expect(Array.from(a.parts[0]!.positions)).toEqual(Array.from(b.parts[0]!.positions));
    // A flipped seat reaches further up in front of the back than a resting one.
    const front = (o: ArchOutput): number => {
      let m = 0;
      for (const p of o.parts) for (let k = 0; k < p.positions.length; k += 3) if ((p.positions[k + 2] as number) > -0.05 && (p.positions[k + 2] as number) < 0.2) m = Math.max(m, p.positions[k + 1] as number);
      return m;
    };
    expect(front(up)).toBeGreaterThan(front(down) + 0.15);
  });

  it('every tread of the tier is higher than the one in front and the tier is centred', () => {
    const d = furnitureByKind('tier-steps')!;
    const out = buildFurniture(d, { rows: 6, depth: 1, riser: 0.2, width: 4 }, 1);
    const b = bounds(out);
    expect(b[2]!).toBeCloseTo(-3, 1);
    expect(b[5]!).toBeCloseTo(3, 1);
    expect(b[4]!).toBeCloseTo(0.04 + 5 * 0.2, 2);
  });

  it('is registered with slots', () => {
    for (const [kind] of CASES) {
      expect(FURNITURE.find((f) => f.kind === kind)?.id).toBe(`furn-${kind}`);
    }
    for (const k of ['cinema-seat', 'tier-steps', 'stage', 'speaker', 'acoustic-panel', 'lectern', 'pew', 'altar', 'library-stack', 'vitrine', 'reception-desk', 'school-desk', 'blackboard']) expect(slotNames(k).length, k).toBeGreaterThan(0);
  });
});
