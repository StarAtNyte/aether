import { describe, expect, it } from 'vitest';
import { createGeneratorApi } from '../src/api';
import { resolveParams } from '../src/params';
import type { ParamSpec } from '@aether/core';
import { PROCGEN_LIMITS } from '../src/limits';

describe('createGeneratorApi', () => {
  it('merges parts with identical materials (key order independent) into one draw call', () => {
    const api = createGeneratorApi(1);
    api.add(api.box(1, 1, 1), { color: '#ff0000', roughness: 0.5 });
    api.add(api.box(1, 1, 1).translate(2, 0, 0), { roughness: 0.5, color: '#FF0000' });
    api.add(api.sphere(0.5), { color: '#00ff00' });
    const out = api.build();
    expect(out.parts).toHaveLength(2);
    expect(out.parts[0]?.positions.length).toBe(48 * 3);
    expect(out.parts[0]?.indices.length).toBe(72);
    expect(Math.max(...(out.parts[0]?.indices ?? []))).toBe(47);
  });

  it('marks vertex-colored meshes and backfills white for uncolored ones in the same part', () => {
    const api = createGeneratorApi(1);
    api.add(api.box(1, 1, 1).vertexColor(() => '#000000'), { preset: 'wood' });
    api.add(api.box(1, 1, 1).translate(3, 0, 0), { preset: 'wood', vertexColors: true });
    const out = api.build();
    expect(out.parts).toHaveLength(1);
    const part = out.parts[0];
    expect(part?.material.vertexColors).toBe(true);
    expect(part?.colors?.[0]).toBe(0);
    expect(part?.colors?.[24 * 3]).toBe(1);
  });

  it('build() puts the base on y = 0 and centers x/z, moving colliders along', () => {
    const api = createGeneratorApi(1);
    api.add(api.box(2, 2, 2).translate(10, 5, -4), {});
    api.collider({ kind: 'box', halfExtents: [1, 1, 1], offset: [10, 5, -4] });
    const out = api.build();
    expect(out.bounds.min).toEqual([-1, 0, -1]);
    expect(out.bounds.max).toEqual([1, 2, 1]);
    expect(out.colliders[0]).toMatchObject({ kind: 'box', offset: [0, 1, 0] });
    const raw = createGeneratorApi(1);
    raw.add(raw.box(2, 2, 2).translate(10, 5, -4), {});
    expect(raw.build({ recenter: false }).bounds.min).toEqual([9, 4, -5]);
  });

  it('derives box or hull colliders automatically', () => {
    const api = createGeneratorApi(1);
    api.add(api.box(1, 1, 1), {});
    api.add(api.cylinder(0.2, 0.2, 3).translate(3, 0, 0), {});
    const boxes = api.build();
    expect(boxes.colliders.length).toBe(2);
    expect(boxes.colliders.every((c) => c.kind === 'box')).toBe(true);
    const api2 = createGeneratorApi(1);
    api2.add(api2.sphere(1), {});
    api2.autoColliders('hull');
    const hull = api2.build();
    expect(hull.colliders[0]?.kind).toBe('hull');
    if (hull.colliders[0]?.kind === 'hull') {
      expect(hull.colliders[0].points.length % 3).toBe(0);
      expect(hull.colliders[0].points.length / 3).toBeLessThanOrEqual(48);
      expect(hull.colliders[0].points.length / 3).toBeGreaterThanOrEqual(12);
    }
    expect(() => api2.autoColliders('mesh' as 'box')).toThrow(TypeError);
  });

  it('autoColliders("trimesh") follows the surface instead of boxing it', () => {
    const api = createGeneratorApi(1);
    api.add(api.heightfield(8, 8, 16, 16, (x) => (x > 0 ? 10 : 0)), {});
    api.autoColliders('trimesh');
    const out = api.build({ recenter: false });
    const c = out.colliders[0];
    expect(c?.kind).toBe('trimesh');
    if (c?.kind === 'trimesh') {
      expect(c.positions.length / 3).toBeGreaterThanOrEqual(64);
      expect(c.indices.length % 3).toBe(0);
      expect(Math.max(...c.indices)).toBeLessThan(c.positions.length / 3);
    }
  });

  it('is deterministic per seed (rng, noise, geometry)', () => {
    const a = createGeneratorApi(99);
    const b = createGeneratorApi(99);
    const c = createGeneratorApi(100);
    expect(a.rng()).toBe(b.rng());
    expect(a.noise3(1.5, 2.5, 3.5)).toBe(b.noise3(1.5, 2.5, 3.5));
    expect(a.fbm2(0.3, 0.7)).toBe(b.fbm2(0.3, 0.7));
    expect(a.rng()).not.toBe(c.rng());
  });

  it('validates materials and colliders from untrusted callers', () => {
    const api = createGeneratorApi(1);
    expect(() => api.add(api.box(1, 1, 1), { color: 'blurple' })).toThrow(/material.color/);
    expect(() => api.add(api.box(1, 1, 1), { preset: 'unobtainium' as 'wood' })).toThrow(/preset/);
    expect(() => api.add({} as never, {})).toThrow(/mesh created by the api/);
    api.add(api.box(1, 1, 1), { roughness: 7, metalness: -1, emissiveIntensity: 1e9, __proto__: { polluted: true } } as never);
    const out = api.build();
    expect(out.parts[0]?.material).toEqual({ roughness: 1, metalness: 0, emissiveIntensity: 50 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(() => api.collider({ kind: 'box', halfExtents: [1, Number.NaN, 1], offset: [0, 0, 0] })).toThrow();
    expect(() => api.collider({ kind: 'laser' } as never)).toThrow(/kind/);
    expect(() => api.collider({ kind: 'hull', points: new Float32Array(6), offset: [0, 0, 0] })).toThrow(/at least 4/);
    expect(() => api.collider({ kind: 'heightfield', rows: 2, cols: 2, heights: new Float32Array(4), size: [1, 1, 1] })).toThrow(/length/);
  });

  it('caps distinct materials at MAX_PARTS', () => {
    const api = createGeneratorApi(1);
    for (let i = 0; i < PROCGEN_LIMITS.MAX_PARTS; i++) api.add(api.box(1, 1, 1), { roughness: i / 100 });
    expect(() => api.add(api.box(1, 1, 1), { roughness: 0.99 })).toThrow(/distinct materials/);
  });

  it('caps allocations through the shared vertex budget', () => {
    const api = createGeneratorApi(1, { maxVertices: 1000 });
    expect(() => {
      for (let i = 0; i < 100; i++) api.box(1, 1, 1);
    }).toThrow(/budget/);
  });

  it('color() and mix() handle hex input', () => {
    const api = createGeneratorApi(1);
    expect(api.color('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(api.mix('#000000', '#ffffff', 0.25)).toBe('#404040');
    expect(() => api.color('nope')).toThrow(TypeError);
  });

  it('limb spans exactly between two points', () => {
    const api = createGeneratorApi(1);
    const m = api.limb([0, 0, 0], [0, 2, 2], 0.1, 0.1, 8);
    const b = m.bounds();
    expect(b.max[1]).toBeCloseTo(2 + 0.1 * Math.SQRT1_2, 3);
    expect(b.max[2]).toBeCloseTo(2 + 0.1 * Math.SQRT1_2, 3);
  });
});

describe('resolveParams', () => {
  const spec: Record<string, ParamSpec> = {
    height: { type: 'number', default: 5, min: 1, max: 10 },
    count: { type: 'int', default: 3, min: 1, max: 9 },
    color: { type: 'color', default: '#336699' },
    lit: { type: 'boolean', default: false },
    style: { type: 'enum', default: 'round', options: ['round', 'square'] },
  };

  it('fills defaults and ignores unknown keys', () => {
    expect(resolveParams(spec, { bogus: 1 })).toEqual({ height: 5, count: 3, color: '#336699', lit: false, style: 'round' });
  });

  it('clamps, rounds and coerces', () => {
    const r = resolveParams(spec, { height: 99, count: 2.6, color: 'RED', lit: 'true', style: 'SQUARE' });
    expect(r).toEqual({ height: 10, count: 3, color: '#e53935', lit: true, style: 'square' });
    expect(resolveParams(spec, { height: '-4', count: -100 })).toMatchObject({ height: 1, count: 1 });
    expect(resolveParams(spec, { height: Number.NaN, count: 'abc', color: '#12', lit: 'maybe', style: 'hex' })).toEqual(
      resolveParams(spec, {}),
    );
  });

  it('repairs invalid defaults in untrusted specs and ignores forbidden keys', () => {
    const bad: Record<string, ParamSpec> = {
      a: { type: 'number', default: 'x', min: 2 },
      b: { type: 'color', default: 'nope' },
      c: { type: 'enum', default: 'z', options: ['p', 'q'] },
      d: { type: 'int', default: 50, max: 10 },
    };
    expect(resolveParams(bad, {})).toEqual({ a: 2, b: '#cccccc', c: 'p', d: 10 });
    const evil = JSON.parse('{"__proto__": {"type": "number", "default": 1}, "ok": {"type": "number", "default": 2}}') as Record<string, ParamSpec>;
    const out = resolveParams(evil, JSON.parse('{"__proto__": 5}') as Record<string, never>);
    expect(out).toEqual({ ok: 2 });
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it('tolerates non-object params', () => {
    expect(resolveParams(spec, null as never)).toEqual(resolveParams(spec, {}));
    expect(resolveParams(spec, [] as never)).toEqual(resolveParams(spec, {}));
  });

  it('roundedBox keeps the box extent, bevels the corners and has smooth unit normals', () => {
    const api = createGeneratorApi(1);
    const m = api.roundedBox(4, 2, 3, 0.3, 2);
    const out = (() => { api.add(m, { color: '#ffffff' }); return api.build(); })();
    const p = out.parts[0]!;
    const xs = Array.from({ length: p.positions.length / 3 }, (_, i) => p.positions[i * 3] as number);
    expect(Math.max(...xs)).toBeCloseTo(2, 5);
    expect(Math.min(...xs)).toBeCloseTo(-2, 5);
    // The corner of a plain box is at (2, 1, 1.5); a rounded one stays inside it.
    for (let i = 0; i < p.positions.length; i += 3) {
      const d = Math.hypot(Math.max(0, Math.abs(p.positions[i] as number) - 1.7), Math.max(0, Math.abs((p.positions[i + 1] as number) - 1) - 0.7), Math.max(0, Math.abs(p.positions[i + 2] as number) - 1.2));
      expect(d).toBeLessThanOrEqual(0.3 + 1e-6);
    }
    for (let i = 0; i < p.normals.length; i += 3) expect(Math.hypot(p.normals[i] as number, p.normals[i + 1] as number, p.normals[i + 2] as number)).toBeCloseTo(1, 5);
    expect(p.indices.length).toBeGreaterThan(36);
  });
});
