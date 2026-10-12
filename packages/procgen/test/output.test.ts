import { describe, expect, it } from 'vitest';
import { PrimitiveShape } from '@aether/core';
import { createGeneratorApi, fallbackOutput, primitiveOutput, validateOutput, PROCGEN_LIMITS } from '../src/index';
import type { GeneratorOutput, MeshPart } from '../src/types';
import { expectValidPart, signedVolume } from './helpers';

function sample(): GeneratorOutput {
  const api = createGeneratorApi(1);
  api.add(api.box(1, 1, 1), { color: '#ffffff' });
  return api.build();
}

function withPart(patch: Partial<Record<keyof MeshPart, unknown>>): unknown {
  const out = sample();
  return { ...out, parts: [{ ...out.parts[0], ...patch }] };
}

describe('validateOutput', () => {
  it('accepts api.build() output and recomputes bounds/triangles', () => {
    const out = sample();
    const forged = { ...out, bounds: { min: [0, 0, 0], max: [999, 999, 999] }, stats: { triangles: 1, ms: -5 } };
    const v = validateOutput(forged);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.output.bounds.max).toEqual([0.5, 1, 0.5]);
      expect(v.output.stats.triangles).toBe(12);
      expect(v.output.stats.ms).toBe(0);
      expect(v.output.parts[0]?.positions).toBe(out.parts[0]?.positions);
    }
  });

  it.each<[string, unknown, RegExp]>([
    ['non-object', 42, /api\.build/],
    ['missing parts', {}, /parts must be an array/],
    ['empty parts', { parts: [], colliders: [] }, /no geometry/],
    ['plain array positions', withPart({ positions: [0, 0, 0] }), /Float32Array/],
    ['wrong index type', withPart({ indices: new Uint16Array(3) }), /Uint32Array/],
    ['index out of range', withPart({ indices: new Uint32Array([0, 1, 999]) }), /out of range/],
    ['NaN position', withPart({ positions: Object.assign(new Float32Array(72), { 5: Number.NaN }) }), /NaN/],
    ['huge coordinate', withPart({ positions: Object.assign(new Float32Array(72), { 0: 1e9 }) }), /out of range/],
    ['normals mismatch', withPart({ normals: new Float32Array(3) }), /normals/],
    ['bad uvs', withPart({ uvs: new Float32Array(5) }), /uvs/],
    ['bad colors', withPart({ colors: new Float32Array(7) }), /colors/],
    ['bad material', withPart({ material: { color: 'javascript:alert(1)' } }), /material/],
    ['bad collider', { ...sample(), colliders: [{ kind: 'box', halfExtents: [1, 1], offset: [0, 0, 0] }] }, /colliders\[0\]/],
    ['too many parts', { parts: new Array(PROCGEN_LIMITS.MAX_PARTS + 1).fill(sample().parts[0]), colliders: [] }, /too many parts/],
    ['too many colliders', { ...sample(), colliders: new Array(PROCGEN_LIMITS.MAX_COLLIDERS + 1).fill({ kind: 'sphere', radius: 1, offset: [0, 0, 0] }) }, /too many colliders/],
  ])('rejects %s', (_name, input, re) => {
    const v = validateOutput(input);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(re);
  });

  it('rejects outputs over the 2M vertex cap', () => {
    const n = 700_000;
    const part = { positions: new Float32Array(n * 3), normals: new Float32Array(n * 3), indices: new Uint32Array(3), material: {} };
    const v = validateOutput({ parts: [part, part, part], colliders: [] });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(/2000000 vertices/);
  });

  it('copies collider arrays and keeps warnings bounded', () => {
    const points = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const v = validateOutput({ ...sample(), colliders: [{ kind: 'hull', points, offset: [0, 0, 0] }], warnings: ['x'.repeat(1000), 5] });
    expect(v.ok).toBe(true);
    if (v.ok) {
      const c = v.output.colliders[0];
      expect(c?.kind === 'hull' && c.points !== points).toBe(true);
      expect(v.output.warnings).toEqual(['x'.repeat(200)]);
    }
  });
});

describe('fallbackOutput', () => {
  it('is a visible grounded magenta crate with a box collider and the reason as a warning', () => {
    const out = fallbackOutput('boom: something broke');
    expect(validateOutput(out).ok).toBe(true);
    expect(out.bounds.min[1]).toBeCloseTo(0, 6);
    expect(out.bounds.max[1]).toBeCloseTo(1, 6);
    expect(out.parts.some((p) => p.material.color === '#ff3dbb')).toBe(true);
    expect(out.colliders).toEqual([{ kind: 'box', halfExtents: [0.5, 0.5, 0.5], offset: [0, 0.5, 0] }]);
    expect(out.warnings?.[0]).toContain('boom');
    expect(fallbackOutput('x'.repeat(5000)).warnings?.[0]?.length).toBeLessThan(250);
  });
});

describe('primitiveOutput', () => {
  const prim = (primitive: string, size: [number, number, number]): GeneratorOutput =>
    primitiveOutput(PrimitiveShape.parse({ kind: 'primitive', primitive, size }), { color: '#336699' });

  it('box: exact size, centered, matching box collider', () => {
    const out = prim('box', [2, 3, 4]);
    expect(out.bounds).toEqual({ min: [-1, -1.5, -2], max: [1, 1.5, 2] });
    expect(out.colliders).toEqual([{ kind: 'box', halfExtents: [1, 1.5, 2], offset: [0, 0, 0] }]);
    expect(out.parts[0]?.material).toEqual({ color: '#336699' });
  });

  it('sphere: diameter = size[0]', () => {
    const out = prim('sphere', [3, 9, 9]);
    expect(out.bounds.max[1]).toBeCloseTo(1.5, 5);
    expect(out.colliders[0]).toEqual({ kind: 'sphere', radius: 1.5, offset: [0, 0, 0] });
  });

  it('cylinder/cone: diameter = size[0], height = size[1]', () => {
    const cyl = prim('cylinder', [2, 4, 0]);
    expect(cyl.bounds.max[1]).toBeCloseTo(2, 6);
    expect(cyl.bounds.max[0]).toBeCloseTo(1, 3);
    expect(cyl.colliders[0]).toEqual({ kind: 'cylinder', radius: 1, halfHeight: 2, offset: [0, 0, 0] });
    const cone = prim('cone', [2, 4, 0]);
    expect(cone.colliders[0]?.kind).toBe('hull');
    expect(signedVolume({ positions: cone.parts[0]?.positions ?? new Float32Array(), indices: cone.parts[0]?.indices ?? new Uint32Array() })).toBeGreaterThan(0);
  });

  it('capsule: total height = size[1]', () => {
    const out = prim('capsule', [1, 3, 1]);
    expect(out.bounds.max[1]).toBeCloseTo(1.5, 5);
    expect(out.colliders[0]).toEqual({ kind: 'capsule', radius: 0.5, halfHeight: 1, offset: [0, 0, 0] });
  });

  it('torus: outer diameter = size[0], tube thickness = size[1], compound ring colliders', () => {
    const out = prim('torus', [4, 1, 0]);
    expect(out.bounds.max[0]).toBeCloseTo(2, 5);
    expect(out.colliders.length).toBe(12);
  });

  it('plane: size[0] × size[2] in XZ at y=0 with a thin box collider just below', () => {
    const out = prim('plane', [10, 0, 6]);
    expect(out.bounds).toEqual({ min: [-5, 0, -3], max: [5, 0, 3] });
    expect(out.colliders[0]).toMatchObject({ kind: 'box', offset: [0, -0.005, 0] });
  });

  it('all primitives produce valid parts and tolerate bad material/size', () => {
    for (const kind of ['box', 'sphere', 'cylinder', 'cone', 'capsule', 'torus', 'plane'] as const) {
      const out = primitiveOutput({ kind: 'primitive', primitive: kind, size: [0, -1, 1e9] }, { color: 'not a color' } as never);
      for (const p of out.parts) expectValidPart(p);
      expect(out.parts[0]?.material).toEqual({});
      expect(validateOutput(out).ok).toBe(true);
    }
  });
});
