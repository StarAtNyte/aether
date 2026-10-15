import { describe, expect, it } from 'vitest';
import { creaseFor, isFacetedPart, normalsAreSoft, softenedNormals, softenKeyed, softenPart, CREASE_DEGREES } from '../src/geometry/soften';
import { buildLodChain } from '../src/virtual/lod-chain';
import { weldPositions } from '../src/virtual/simplify';
import type { GeneratorOutput, KeyedOutput, MeshPart } from '../src/types';

/** A flat-shaded "roof": two quads meeting at a ridge, `angle` degrees apart, every triangle with its own vertices. */
function roof(angleDeg: number, material: MeshPart['material'] = { preset: 'grass' }): MeshPart {
  const a = (angleDeg * Math.PI) / 180 / 2;
  const left = [-Math.cos(a), Math.sin(a)];
  const right = [Math.cos(a), Math.sin(a)];
  // Ridge along z at x=0,y=1; eaves at (±cos, 1 - sin)...: quads from the ridge down each side.
  const ridge = (z: number): [number, number, number] => [0, 1, z];
  const eaveL = (z: number): [number, number, number] => [left[0]! * 2, 1 - left[1]! * 2, z];
  const eaveR = (z: number): [number, number, number] => [right[0]! * 2, 1 - right[1]! * 2, z];
  const tri = (p: number[][], flip: boolean): number[][] => (flip ? [p[0]!, p[2]!, p[1]!] : p);
  const tris: number[][][] = [
    tri([ridge(0), eaveL(0), eaveL(1)], false),
    tri([ridge(0), eaveL(1), ridge(1)], false),
    tri([ridge(0), ridge(1), eaveR(1)], false),
    tri([ridge(0), eaveR(1), eaveR(0)], false),
    // a few more faces so the part counts as faceted (n >= 6 and most vertices duplicated)
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  for (const t of tris) {
    const [p0, p1, p2] = t as [number[], number[], number[]];
    const u = [p1![0]! - p0![0]!, p1![1]! - p0![1]!, p1![2]! - p0![2]!];
    const v = [p2![0]! - p0![0]!, p2![1]! - p0![1]!, p2![2]! - p0![2]!];
    let n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const l = Math.hypot(n[0]!, n[1]!, n[2]!);
    n = n.map((c) => c / l);
    for (const p of t) {
      positions.push(...(p as number[]));
      normals.push(...n);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: Uint32Array.from(positions.map((_, i) => i).filter((i) => i % 3 === 0).map((i) => i / 3)), material };
}

/** The normal stored at the ridge vertex of triangle `t` (vertex 0 of that triangle). */
function ridgeNormal(normals: Float32Array, t: number): [number, number, number] {
  return [normals[t * 9]!, normals[t * 9 + 1]!, normals[t * 9 + 2]!];
}

describe('creaseFor', () => {
  it('only organic presets soften, unless flat shading was asked for', () => {
    expect(creaseFor({ preset: 'grass' })).toBe(CREASE_DEGREES.grass);
    expect(creaseFor({ preset: 'leaf' })).toBe(CREASE_DEGREES.leaf);
    expect(creaseFor({ preset: 'stone' })).toBeLessThan(CREASE_DEGREES.grass ?? 0);
    for (const preset of ['plastic', 'metal', 'glass', 'crystal', 'neon', 'brick', 'wood', 'concrete'] as const) expect(creaseFor({ preset }), preset).toBeNull();
    expect(creaseFor({ preset: 'leaf', flatShading: true })).toBeNull();
    expect(creaseFor(undefined)).toBeNull();
    expect(creaseFor({})).toBeNull();
    expect(creaseFor({ preset: '__proto__' as never })).toBeNull();
  });
});

describe('softenedNormals', () => {
  it('blends faces that meet below the crease angle and keeps sharp ones', () => {
    const shallow = roof(40);
    const out = softenedNormals(shallow, 75);
    expect(out).not.toBeNull();
    // Triangle 0 (left side) and triangle 3 (right side) share the ridge position: after blending they agree and point up.
    const l = ridgeNormal(out as Float32Array, 0);
    const r = ridgeNormal(out as Float32Array, 3);
    expect(l[1]).toBeCloseTo(r[1], 5);
    expect(l[0]).toBeCloseTo(r[0], 5);
    expect(l[1]).toBeGreaterThan(0.95);
    // The authored flat normals differ (that is what made it look faceted).
    expect(Math.abs(ridgeNormal(shallow.normals, 0)[0] - ridgeNormal(shallow.normals, 3)[0])).toBeGreaterThan(0.5);
    // Faces whose normals differ by 40° are blended below a 75° crease but kept apart by a 38° one; 100° stays sharp.
    const sharp = softenedNormals(roof(40), 38) as Float32Array;
    const hard = softenedNormals(roof(100), 75) as Float32Array;
    expect(Math.abs(ridgeNormal(hard, 0)[0] - ridgeNormal(hard, 3)[0])).toBeGreaterThan(0.5);
    expect(Math.abs(ridgeNormal(sharp, 0)[0] - ridgeNormal(sharp, 3)[0])).toBeGreaterThan(0.5);
  });
  it('returns unit normals', () => {
    const out = softenedNormals(roof(30), 75) as Float32Array;
    for (let v = 0; v < out.length / 3; v++) expect(Math.hypot(out[v * 3]!, out[v * 3 + 1]!, out[v * 3 + 2]!)).toBeCloseTo(1, 4);
  });
  it('leaves smooth (indexed) parts and malformed parts alone', () => {
    const smooth: MeshPart = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 2, 0, 0, 2, 0, 1]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3, 1, 4, 5, 1, 5, 2]),
      material: { preset: 'grass' },
    };
    expect(isFacetedPart(smooth.positions, weldPositions(smooth.positions))).toBe(false);
    expect(softenedNormals(smooth, 75)).toBeNull();
    expect(softenPart(smooth)).toBe(smooth);
    expect(softenedNormals({ ...smooth, indices: new Uint32Array([0, 1, 99]) }, 75)).toBeNull();
    expect(softenedNormals({ ...smooth, normals: new Float32Array(3) }, 75)).toBeNull();
    expect(softenedNormals({ ...smooth, indices: new Uint32Array(0) }, 75)).toBeNull();
  });
});

describe('softenPart / softenOutput', () => {
  it('softens an organic faceted part once and keeps positions, indices and colours', () => {
    const part = roof(40);
    const soft = softenPart(part);
    expect(soft).not.toBe(part);
    expect(softenPart(part)).toBe(soft);
    expect(soft.positions).toBe(part.positions);
    expect(soft.indices).toBe(part.indices);
    expect(soft.normals).not.toBe(part.normals);
    expect(normalsAreSoft(soft.positions, soft.indices, soft.normals)).toBe(true);
    expect(normalsAreSoft(part.positions, part.indices, part.normals)).toBe(false);
  });
  it('does not touch plain materials or explicit flat shading', () => {
    const plastic = roof(140, { preset: 'plastic' });
    expect(softenPart(plastic)).toBe(plastic);
    const flat = roof(140, { preset: 'leaf', flatShading: true });
    expect(softenPart(flat)).toBe(flat);
  });
  it('softens by the entity material: a bare generator part takes the entity preset, and the key tells soft from flat', () => {
    const out = (p: MeshPart): GeneratorOutput => ({ parts: [p], colliders: [], bounds: { min: [0, 0, 0], max: [1, 1, 1] }, stats: { triangles: 4, ms: 0 } });
    const bare = roof(40, {});
    const keyed: KeyedOutput = { key: 'proc|hill', output: out(bare) };
    const soft = softenKeyed(keyed, { preset: 'grass' });
    expect(soft).not.toBe(keyed);
    expect(soft.key).not.toBe(keyed.key);
    expect(soft.key.startsWith('proc|hill|soft')).toBe(true);
    expect(softenKeyed(keyed, { preset: 'grass' }).output).toBe(soft.output);
    expect(soft.output.colliders).toBe(keyed.output.colliders);
    expect(soft.output.parts[0]!.positions).toBe(bare.positions);
    // The same output under a plain entity material stays flat and keeps its own key.
    expect(softenKeyed(keyed, { preset: 'plastic' })).toBe(keyed);
    expect(softenKeyed(keyed, undefined)).toBe(keyed);
    // In a multi-part output a part that styles itself (a preset of its own) keeps its look; a bare part takes the entity's.
    const bareB = roof(40, {});
    const metal = roof(40, { preset: 'metal' });
    const multi: KeyedOutput = { key: 'proc|tree', output: { ...out(bareB), parts: [bareB, metal] } };
    const softMulti = softenKeyed(multi, { preset: 'grass' });
    expect(softMulti.output.parts[0]).not.toBe(bareB);
    expect(softMulti.output.parts[1]).toBe(metal);
    // Different creases produce different keys for the same output.
    expect(softenKeyed(keyed, { preset: 'stone' }).key).not.toBe(soft.key);
  });
  it('returns the input when the part is already smooth even for an organic material', () => {
    const smooth: MeshPart = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 2, 0, 0, 2, 0, 1]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3, 1, 4, 5, 1, 5, 2]),
      material: {},
    };
    const keyed: KeyedOutput = { key: 'proc|flat', output: { parts: [smooth], colliders: [], bounds: { min: [0, 0, 0], max: [2, 0, 1] }, stats: { triangles: 4, ms: 0 } } };
    expect(softenKeyed(keyed, { preset: 'grass' })).toBe(keyed);
    expect(softenKeyed(keyed, { preset: 'grass' })).toBe(keyed);
  });
});

describe('LOD chain of softened parts', () => {
  it('keeps the blended normals when a faceted part is simplified (no flat popping between levels)', () => {
    // A fan of many small shallow faces so simplification keeps some.
    const n = 40;
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      const x0 = i * 0.5;
      const h0 = Math.sin(i * 0.3) * 0.2;
      const h1 = Math.sin((i + 1) * 0.3) * 0.2;
      const quad = [
        [x0, h0, 0],
        [x0 + 0.5, h1, 0],
        [x0 + 0.5, h1, 1],
        [x0, h0, 1],
      ];
      for (const t of [[0, 1, 2], [0, 2, 3]]) {
        for (const k of t) {
          positions.push(...(quad[k] as number[]));
          normals.push(0, 1, 0);
          indices.push(indices.length);
        }
      }
    }
    const part: MeshPart = { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: Uint32Array.from(indices), material: { preset: 'grass' } };
    const soft = softenPart(part);
    const chain = buildLodChain([soft], [0.4]);
    if (chain.length > 1) {
      const lod = chain[1]!.parts[0]!;
      expect(normalsAreSoft(lod.positions, lod.indices, lod.normals)).toBe(true);
    }
    expect(chain[0]!.parts[0]).toBe(soft);
  });
});
