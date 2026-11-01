import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { surfaceKindOf, worldSurfaceStats } from '../src';
import { createGeneratorApi } from '../src/api';
import type { SandboxRunner } from '../src/types';

/** A sandbox that runs the generator source in this process: enough for the measuring code. */
const inProcess: SandboxRunner = {
  async run(req: { source: string; params: Record<string, unknown>; seed: number }) {
    const api = createGeneratorApi(req.seed);
    new Function('params', 'api', req.source)(req.params, api);
    return api.build();
  },
  dispose: () => undefined,
} as unknown as SandboxRunner;

describe('surfaceKindOf', () => {
  it('counts a finish, a texture, a preset, splat and foliage as real surfaces and a plain colour as flat', () => {
    expect(surfaceKindOf({ color: '#c9a27a' })).toBe('flat');
    expect(surfaceKindOf({ color: '#c9a27a', vertexColors: true, roughness: 0.9 })).toBe('flat');
    expect(surfaceKindOf({ preset: 'plastic' })).toBe('flat');
    expect(surfaceKindOf({ finish: 'plaster', color: '#c9a27a' })).toBe('finished');
    expect(surfaceKindOf({ preset: 'stone' })).toBe('finished');
    expect(surfaceKindOf({ splat: true, vertexColors: true })).toBe('finished');
    expect(surfaceKindOf({ foliage: 'broadleaf' })).toBe('finished');
    expect(surfaceKindOf({ color: '#fff' }, { finish: 'brick' })).toBe('finished');
  });
});

describe('worldSurfaceStats', () => {
  it('measures the flat share of custom generators by surface area', async () => {
    const world = createWorld({
      generators: {
        flat: { id: 'flat', description: 'plain', params: {}, source: "api.add(api.box(10,2,10), {color:'#aa8866'}); return api.build();" },
        real: { id: 'real', description: 'finished', params: {}, source: "api.add(api.box(10,2,10), {finish:'plaster', color:'#aa8866'}); return api.build();" },
      } as never,
      entities: {
        a: { id: 'a', shape: { kind: 'procedural', generator: 'flat', params: {} } },
        b: { id: 'b', shape: { kind: 'procedural', generator: 'flat', params: {} }, transform: { position: [20, 0, 0] } },
        c: { id: 'c', shape: { kind: 'procedural', generator: 'real', params: {} }, transform: { position: [40, 0, 0] } },
      } as never,
    });
    const s = await worldSurfaceStats(world, inProcess);
    expect(s.area).toBeGreaterThan(0);
    expect(s.flatShare).toBeCloseTo(2 / 3, 2);
    expect(s.generators[0]?.generator).toBe('flat');
    expect(s.generators[0]?.entities).toEqual(['a', 'b']);
  });
});
