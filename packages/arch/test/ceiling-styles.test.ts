import { describe, expect, it } from 'vitest';
import { buildCeiling } from '../src/elements';
import { buildStructure } from '../src/structure';
import { CeilingParams } from '../src/params';
import type { ArchOutput } from '../src/types';

const POLY = [[-0.14, -0.14], [4.14, -0.14], [4.14, 5.14], [-0.14, 5.14]];
const FACES = [0, 0, 4, 5];
const base = { polygon: POLY, faces: FACES, downlights: [[1, 1], [3, 4]] };
const make = (extra: Record<string, unknown>): ArchOutput => buildCeiling(CeilingParams.parse({ ...base, ...extra }));

function stats(o: ArchOutput): { tris: number; min: number[]; max: number[]; bad: number; verts: number } {
  let tris = 0;
  let verts = 0;
  let bad = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of o.parts) {
    const { positions: P, normals: N, indices: I } = part;
    verts += P.length / 3;
    tris += I.length / 3;
    for (let k = 0; k < P.length; k += 3) for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a] as number, P[k + a] as number);
      max[a] = Math.max(max[a] as number, P[k + a] as number);
    }
    for (let t = 0; t < I.length; t += 3) {
      const [a, b, c] = [I[t] as number, I[t + 1] as number, I[t + 2] as number];
      const e1 = [0, 1, 2].map((d) => (P[b * 3 + d] as number) - (P[a * 3 + d] as number));
      const e2 = [0, 1, 2].map((d) => (P[c * 3 + d] as number) - (P[a * 3 + d] as number));
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      if (Math.hypot(n[0]!, n[1]!, n[2]!) < 1e-10) continue;
      const vn = [0, 1, 2].map((d) => (N[a * 3 + d] as number) + (N[b * 3 + d] as number) + (N[c * 3 + d] as number));
      if (n[0]! * vn[0]! + n[1]! * vn[1]! + n[2]! * vn[2]! < 0) bad++;
    }
  }
  return { tris, verts, bad, min, max };
}

describe('ceiling styles', () => {
  it('flat without style or cornice is the plain ceiling', () => {
    const a = make({});
    const b = make({ style: 'flat' });
    expect(stats(a).tris).toBe(stats(b).tris);
    expect(stats(a).max[1]).toBeCloseTo(0.0, 1);
  });

  for (const style of ['coved', 'barrel', 'coffered', 'beamed', 'tray'] as const) {
    it(`${style}: bounded, sane winding, deterministic`, () => {
      const o = make({ style, rise: style === 'barrel' ? 0.8 : undefined });
      const s = stats(o);
      expect(s.tris).toBeGreaterThan(8);
      expect(s.tris).toBeLessThan(12000);
      expect(s.bad).toBe(0);
      expect(s.min[0]).toBeGreaterThan(-0.2);
      expect(s.max[0]).toBeLessThan(4.2);
      expect(stats(make({ style, rise: style === 'barrel' ? 0.8 : undefined })).verts).toBe(s.verts);
    });
  }

  it('coved springs radius below the plane and the field is at y = 0', () => {
    const s = stats(make({ style: 'coved', rise: 0.3 }));
    expect(s.min[1]).toBeCloseTo(-0.3, 2);
    expect(s.max[1]).toBeLessThanOrEqual(0.001);
  });

  it('barrel has its crown at 0 and eaves rise lower; ribs add geometry', () => {
    const s = stats(make({ style: 'barrel', rise: 0.8, ridge: 'z' }));
    expect(s.min[1]).toBeCloseTo(-0.8, 2);
    expect(s.max[1]).toBeCloseTo(0, 2);
    expect(stats(make({ style: 'barrel', rise: 0.8, ridge: 'z', trusses: 3 })).tris).toBeGreaterThan(s.tris);
  });

  it('coffered recesses the panels up by depth and keeps the ribs at the plane', () => {
    const s = stats(make({ style: 'coffered', coffers: { nx: 3, nz: 4, rib: 0.12, depth: 0.15 } }));
    expect(s.max[1]).toBeCloseTo(0.15, 3);
    expect(s.min[1]).toBeGreaterThan(-0.05);
    // A rib colour makes a second material.
    expect(make({ style: 'coffered', beamColor: '#5a3b22' }).parts.length).toBeGreaterThan(make({ style: 'coffered' }).parts.length);
  });

  it('beamed hangs the beams below the plane, running along the shorter side by default', () => {
    const o = make({ style: 'beamed', beams: { count: 3, width: 0.2, depth: 0.25 } });
    const s = stats(o);
    expect(s.min[1]).toBeCloseTo(-0.25, 3);
    const x = stats(make({ style: 'beamed', beams: { count: 2, width: 0.2, depth: 0.25, dir: 'x' } }));
    expect(x.min[1]).toBeCloseTo(-0.25, 3);
  });

  it('tray raises the central field by the drop; downlights inside it rise with it', () => {
    const o = make({ style: 'tray', tray: { inset: 0.6, drop: 0.14 } });
    expect(stats(o).max[1]).toBeCloseTo(0.14, 3);
  });
});

describe('cornice', () => {
  const profiles = ['plain', 'cove', 'classic', 'stepped'] as const;
  for (const profile of profiles) {
    it(`${profile}: hangs height below the plane, closes to the faces, faces the room`, () => {
      const flat = stats(make({}));
      const o = make({ cornice: { height: 0.15, depth: 0.12, profile } });
      const s = stats(o);
      expect(s.tris).toBeGreaterThan(flat.tris);
      expect(s.min[1]).toBeCloseTo(-0.15, 3);
      expect(s.bad).toBe(0);
      // Nothing pokes out of the wall faces beyond the 4 mm that sinks into them, except the ceiling itself.
      const cornicePart = o.parts[o.parts.length - 1]!;
      const P = cornicePart.positions;
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < P.length; k += 3) {
        lo = Math.min(lo, P[k] as number);
        hi = Math.max(hi, P[k] as number);
      }
      expect(lo).toBeGreaterThanOrEqual(-0.0041);
      expect(hi).toBeLessThanOrEqual(4.0041);
    });
  }

  it('the mitred ring is closed: every projecting edge meets the next side at the corner', () => {
    const o = make({ cornice: { height: 0.1, depth: 0.1, profile: 'plain' }, downlights: [] });
    const part = o.parts.find((p) => p.material.color === '#f4f2ee' && p.positions.length < 400)!;
    const P = part.positions;
    // The inner-bottom corner of the plain profile at the north-west corner must exist.
    let found = false;
    for (let k = 0; k < P.length; k += 3) if (Math.abs((P[k] as number) - 0.1) < 1e-6 && Math.abs((P[k + 1] as number) + 0.1) < 1e-6 && Math.abs((P[k + 2] as number) - 0.1) < 1e-6) found = true;
    expect(found).toBe(true);
  });

  it('takes the cornice colour and is skipped on barrel and vaulted ceilings', () => {
    const o = make({ cornice: { color: '#ffeedd' } });
    expect(o.parts.some((p) => p.material.color === '#ffeedd')).toBe(true);
    const barrel = make({ style: 'barrel', cornice: { color: '#ffeedd' } });
    expect(barrel.parts.some((p) => p.material.color === '#ffeedd')).toBe(false);
    const vault = make({ vault: { rise: 0.9, ridge: 'x', trusses: 0 }, cornice: { color: '#ffeedd' } });
    expect(vault.parts.some((p) => p.material.color === '#ffeedd')).toBe(false);
  });
});

describe('vaulted is unchanged', () => {
  it('gable vault geometry: 2 planes, trusses add beams', () => {
    const plain = stats(make({ vault: { rise: 1, ridge: 'z', trusses: 0 } }));
    expect(plain.verts).toBe(8);
    expect(plain.tris).toBe(4);
    expect(plain.min[1]).toBeCloseTo(-1, 3);
    expect(stats(make({ vault: { rise: 1, ridge: 'z', trusses: 2 } })).tris).toBeGreaterThan(plain.tris);
  });
});

describe('through the structure generator', () => {
  it('parses and builds arch-ceiling with the style fields', () => {
    const out = buildStructure('arch-ceiling', { ...base, style: 'coffered', cornice: { height: 0.1, depth: 0.1, profile: 'classic' }, coffers: { nx: 2, nz: 2 } });
    expect(out.parts.length).toBeGreaterThan(0);
    expect(() => buildStructure('arch-ceiling', { ...base, style: 'nonsense' })).toThrow();
  });
});
