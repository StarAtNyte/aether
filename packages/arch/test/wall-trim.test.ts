import { describe, expect, it } from 'vitest';
import { buildWall } from '../src/wall';
import { buildStructure } from '../src/structure';
import { WallParams } from '../src/params';
import { skirtingSection } from '../src/wall-trim';
import type { ArchOutput, ArchPart } from '../src/types';

const OPENINGS = [
  { kind: 'door', offset: 1, width: 0.9, height: 2.1 },
  { kind: 'window', offset: 4.2, width: 1.2, height: 1.3, sill: 0.9 },
];

function wall(extra: Record<string, unknown> = {}): { out: ArchOutput; p: WallParams } {
  const p = WallParams.parse({ length: 6, height: 2.8, thickness: 0.28, openings: OPENINGS, ...extra });
  return { out: buildWall(p), p };
}

const tris = (out: ArchOutput): number => out.parts.reduce((s, q) => s + q.indices.length / 3, 0);
const partBy = (out: ArchOutput, pred: (m: ArchPart['material']) => boolean): ArchPart | undefined => out.parts.find((q) => pred(q.material));

function bounds(q: ArchPart): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < q.positions.length; k += 3) {
    for (let a = 0; a < 3; a++) {
      const v = q.positions[k + a] as number;
      if (v < min[a]!) min[a] = v;
      if (v > max[a]!) max[a] = v;
    }
  }
  return { min, max };
}

/** Share of triangles whose winding agrees with their vertex normals. */
function windingAgreement(q: ArchPart): number {
  const p = q.positions;
  const n = q.normals;
  let ok = 0;
  let total = 0;
  for (let k = 0; k < q.indices.length; k += 3) {
    const a = (q.indices[k] as number) * 3;
    const b = (q.indices[k + 1] as number) * 3;
    const c = (q.indices[k + 2] as number) * 3;
    const u = [0, 1, 2].map((i) => (p[b + i] as number) - (p[a + i] as number));
    const v = [0, 1, 2].map((i) => (p[c + i] as number) - (p[a + i] as number));
    const g = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    if (Math.hypot(g[0]!, g[1]!, g[2]!) < 1e-9) continue;
    const nn = [0, 1, 2].map((i) => (n[a + i] as number) + (n[b + i] as number) + (n[c + i] as number));
    total++;
    if (g[0]! * nn[0]! + g[1]! * nn[1]! + g[2]! * nn[2]! > 0) ok++;
  }
  return total === 0 ? 1 : ok / total;
}

const ser = (o: ArchOutput): string => JSON.stringify(o.parts.map((q) => [q.material, Array.from(q.positions), Array.from(q.indices)])) + JSON.stringify(o.colliders);

describe('wall trim', () => {
  it('is deterministic and leaves a plain wall alone', () => {
    const a = wall({ dadoB: { height: 1, style: 'shaker' }, nichesA: [{ offset: 2.6, width: 0.6, height: 1.4 }] });
    const b = wall({ dadoB: { height: 1, style: 'shaker' }, nichesA: [{ offset: 2.6, width: 0.6, height: 1.4 }] });
    expect(ser(a.out)).toBe(ser(b.out));
    // New fields at their defaults add nothing.
    const plain = wall();
    const dflt = wall({ dadoA: { height: 1 } });
    const flat = wall({ dadoA: { height: 1, style: 'flat', panels: 5 } });
    expect(ser(dflt.out)).toBe(ser(flat.out));
    expect(tris(plain.out)).toBeLessThan(tris(dflt.out) + 1000);
  });

  it('skirting profiles have the requested height and depth', () => {
    for (const profile of ['square', 'bevel', 'ogee', 'stepped'] as const) {
      const sec = skirtingSection(profile, 0.2, 0.04);
      expect(Math.max(...sec.map((q) => q[1]))).toBeCloseTo(0.2, 6);
      expect(Math.max(...sec.map((q) => q[0]))).toBeCloseTo(0.04, 6);
      expect(sec[sec.length - 1]?.[0]).toBe(0);
    }
    const base = wall({ skirting: 'b' });
    const baseSkirt = partBy(base.out, (m) => m.color === '#f1eee8');
    expect(baseSkirt).toBeDefined();
    const tris0 = (baseSkirt as ArchPart).indices.length / 3;
    let prev = tris0;
    for (const [profile, more] of [['bevel', false], ['ogee', true], ['stepped', true]] as const) {
      const { out } = wall({ skirting: 'b', skirtingStyle: { height: 0.3, depth: 0.05, profile } });
      const q = partBy(out, (m) => m.color === '#f1eee8') as ArchPart;
      const bb = bounds(q);
      expect(bb.max[1]).toBeCloseTo(0.3, 5);
      expect(bb.min[1]).toBeCloseTo(0, 5);
      // Side B: proud of z = +t by the depth.
      expect(bb.max[2]).toBeCloseTo(0.14 + 0.05, 5);
      if (more) expect(q.indices.length / 3).toBeGreaterThan(prev);
      prev = Math.min(prev, q.indices.length / 3);
    }
  });

  it('skirting stops at doorways', () => {
    const { out } = wall({ skirting: 'b', skirtingStyle: { height: 0.12, depth: 0.02, profile: 'ogee' } });
    const q = partBy(out, (m) => m.color === '#f1eee8') as ArchPart;
    // No skirting vertex inside the doorway (0.55..1.45) except exactly at its jambs.
    for (let k = 0; k < q.positions.length; k += 3) {
      const x = q.positions[k] as number;
      expect(x > 0.5501 && x < 1.4499).toBe(false);
    }
  });

  it('picture rail sits at its height and breaks at a tall opening', () => {
    const { out } = wall({ railB: { y: 2.2, material: { finish: 'paint', color: '#aabbcc' } } });
    const q = partBy(out, (m) => m.color === '#aabbcc') as ArchPart;
    const bb = bounds(q);
    expect(bb.min[1]).toBeCloseTo(2.2 - 0.0225, 5);
    expect(bb.max[1]).toBeCloseTo(2.2 + 0.0225, 5);
    expect(bb.max[2]).toBeCloseTo(0.14 + 0.03, 5);
    // The door (to 2.1 m) does not reach the rail: it runs across it; a window ending at 2.2 does not either.
    const low = wall({ railB: { y: 1.0, material: { finish: 'paint', color: '#aabbcc' } } });
    const r = partBy(low.out, (m) => m.color === '#aabbcc') as ArchPart;
    for (let k = 0; k < r.positions.length; k += 3) {
      const x = r.positions[k] as number;
      expect(x > 3.601 && x < 4.799).toBe(false); // window 3.6..4.8 spans y 0.9..2.2
      expect(x > 0.551 && x < 1.449).toBe(false); // door
    }
  });

  it('panel styles add moulding on the dado and keep clear of openings', () => {
    const flat = wall({ dadoB: { height: 1.2, style: 'flat' } });
    const dadoMat = (out: ArchOutput): ArchPart => partBy(out, (m) => m.finish === 'panelling') as ArchPart;
    const flatTris = dadoMat(flat.out).indices.length / 3;
    const counts: Record<string, number> = {};
    for (const style of ['shaker', 'raised', 'batten', 'beadboard'] as const) {
      const { out } = wall({ dadoB: { height: 1.2, style } });
      const q = dadoMat(out);
      counts[style] = q.indices.length / 3;
      expect(counts[style]).toBeGreaterThan(flatTris + 40);
      // Mouldings stand proud of the face (z = +0.14) by at most 3 cm.
      expect(bounds(q).max[2]).toBeLessThanOrEqual(0.14 + 0.03 + 1e-6);
      expect(bounds(q).max[2]).toBeGreaterThan(0.14 + 0.003);
      // Keep 6 cm clear of the door opening (0.55..1.45): no moulding vertex above the door's... the door reaches the dado top.
      for (let k = 0; k < q.positions.length; k += 3) {
        const x = q.positions[k] as number;
        const z = q.positions[k + 2] as number;
        if (z > 0.14 + 0.002) expect(x > 0.5501 && x < 1.4499).toBe(false);
      }
    }
    expect(counts['raised']).toBeGreaterThan(counts['shaker'] as number);
    // More panels per metre, more strips.
    const dense = wall({ dadoB: { height: 1.2, style: 'shaker', panels: 6 } });
    expect(dadoMat(dense.out).indices.length).toBeGreaterThan(dadoMat(wall({ dadoB: { height: 1.2, style: 'shaker', panels: 2 } }).out).indices.length);
  });

  it('full-height panelling leaves no plain face above the dado', () => {
    const full = wall({ openings: [], dadoB: { height: 2.8, style: 'shaker', rail: true } });
    const face = partBy(full.out, (m) => m.finish === 'plaster') as ArchPart;
    // Side B face quads are all inside the dado part: the plaster part holds only side A, ends, top.
    const bb = bounds(face);
    for (let k = 0; k < face.positions.length; k += 3) expect(face.positions[k + 2]! > 0.14 - 1e-6 && face.positions[k + 1]! > 0.01 && face.positions[k + 1]! < 2.79).toBe(false);
    expect(bb.max[1]).toBeGreaterThan(2.7);
    const dado = partBy(full.out, (m) => m.finish === 'panelling') as ArchPart;
    expect(bounds(dado).max[1]).toBeLessThanOrEqual(2.8 + 1e-6);
    // Two rows of frames on a tall covering: more strips than one row would make.
    expect(dado.indices.length / 3).toBeGreaterThan(300);
  });

  it('caps the number of strips on a long wall', () => {
    const { out } = wall({ length: 40, openings: [], dadoA: { height: 1.2, style: 'beadboard' }, dadoB: { height: 2.4, style: 'shaker', panels: 8 } });
    expect(tris(out)).toBeLessThan(25_000);
    const { out: out2 } = wall({ length: 40, openings: [], dadoA: { height: 1.2, style: 'batten' } });
    expect(tris(out2)).toBeLessThan(25_000);
  });

  it('niches recess the face, take shelves and an arched head, and keep the collider', () => {
    const plain = wall({ openings: [] });
    const rect = wall({ openings: [], nichesB: [{ offset: 3, width: 0.8, height: 1.4, sill: 0.7, depth: 0.2, shelves: 2, color: '#334455' }] });
    const q = partBy(rect.out, (m) => m.color === '#334455') as ArchPart;
    expect(q).toBeDefined();
    const bb = bounds(q);
    expect(bb.min[0]).toBeCloseTo(2.6, 5);
    expect(bb.max[0]).toBeCloseTo(3.4, 5);
    expect(bb.min[1]).toBeCloseTo(0.7, 5);
    expect(bb.max[1]).toBeCloseTo(2.1, 5);
    // Back plane 20 cm behind the face (side B: z = +0.14 - 0.2).
    expect(bb.min[2]).toBeCloseTo(0.14 - 0.2, 5);
    expect(bb.max[2]).toBeCloseTo(0.14, 5);
    // The collider is untouched.
    expect(JSON.stringify(rect.out.colliders)).toBe(JSON.stringify(plain.out.colliders));
    // Shelves add two boxes (12 triangles each) over the unshelved niche.
    const bare = wall({ openings: [], nichesB: [{ offset: 3, width: 0.8, height: 1.4, sill: 0.7, depth: 0.2, shelves: 0, color: '#334455' }] });
    const qb = partBy(bare.out, (m) => m.color === '#334455') as ArchPart;
    expect(q.indices.length / 3 - qb.indices.length / 3).toBe(24);
    // The face has a hole where the niche is.
    const faceTris = (o: ArchOutput): number => (partBy(o, (m) => m.finish === 'plaster') as ArchPart).indices.length / 3;
    expect(faceTris(rect.out)).toBeGreaterThan(faceTris(plain.out));
    // Arched head: a rounded top (12 segments) and more triangles than the square niche.
    const arch = wall({ openings: [], nichesA: [{ offset: 3, width: 0.8, height: 1.4, sill: 0.7, depth: 0.2, color: '#334455', arched: true }] });
    const qa = partBy(arch.out, (m) => m.color === '#334455') as ArchPart;
    expect(qa.indices.length).toBeGreaterThan(qb.indices.length);
    expect(bounds(qa).max[1]).toBeCloseTo(2.1, 5);
    // Side A faces -Z: the recess goes towards +Z.
    expect(bounds(qa).max[2]).toBeCloseTo(-0.14 + 0.2, 5);
    expect(bounds(qa).min[2]).toBeCloseTo(-0.14, 5);
  });

  it('skips a niche that touches an opening or the wall end', () => {
    const base = wall({ nichesB: [{ offset: 4.2, width: 0.8, height: 1.0, sill: 0.5 }, { offset: 0.2, width: 0.8, height: 1.0, sill: 0.5 }] });
    const none = wall({});
    expect(ser(base.out)).toBe(ser(none.out));
  });

  it('ignores details in a section cut', () => {
    const { out } = wall({ cut: 1.0, dadoB: { height: 0.8, style: 'shaker' }, railB: { y: 0.9, material: { finish: 'paint' } }, nichesB: [{ offset: 3, width: 0.5, height: 0.4, sill: 0.3 }] });
    const plain = wall({ cut: 1.0, dadoB: { height: 0.8 }, railB: { y: 0.9, material: { finish: 'paint' } } });
    expect(tris(out)).toBeLessThanOrEqual(tris(plain.out) + 8);
  });

  it('draws every detail with winding that agrees with its normals', () => {
    for (const style of ['shaker', 'raised', 'batten', 'beadboard'] as const) {
      const { out } = wall({
        dadoA: { height: 1.2, style },
        dadoB: { height: 2.8, style },
        skirtingStyle: { height: 0.2, depth: 0.04, profile: 'ogee' },
        railA: { y: 2.3, material: { finish: 'paint', color: '#aabbcc' } },
        nichesA: [{ offset: 3, width: 0.7, height: 1.5, sill: 0.5, shelves: 2, arched: true, color: '#334455' }],
        nichesB: [{ offset: 2.5, width: 0.7, height: 1.2, sill: 0.5, shelves: 1 }],
      });
      for (const q of out.parts) expect(windingAgreement(q), `${style} ${JSON.stringify(q.material)}`).toBeGreaterThanOrEqual(0.97);
    }
    for (const profile of ['square', 'bevel', 'ogee', 'stepped'] as const) {
      const { out } = wall({ skirting: 'both', skirtingStyle: { height: 0.25, depth: 0.05, profile } });
      for (const q of out.parts) expect(windingAgreement(q), profile).toBeGreaterThanOrEqual(0.97);
    }
  });

  it('builds through the structure registry and respects mitred extensions', () => {
    const out = buildStructure('arch-wall', { length: 4, height: 2.6, thickness: 0.28, startA: 0.14, endB: 0.14, dadoB: { height: 1.1, style: 'raised' }, skirtingStyle: { height: 0.15, profile: 'ogee', depth: 0.03 }, railB: { y: 2.3, material: { finish: 'paint' } }, nichesA: [{ offset: 2, width: 0.7, height: 1.2, arched: true, shelves: 1 }] });
    expect(out.parts.length).toBeGreaterThan(2);
    expect(tris(out)).toBeLessThan(25_000);
    for (const q of out.parts) {
      expect(q.positions.length / 3).toBe(q.normals.length / 3);
      expect(q.uvs.length / 2).toBe(q.positions.length / 3);
      for (const v of q.positions) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
