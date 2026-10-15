import { describe, expect, it } from 'vitest';
import { compileBuilding, type BuildingPlanInput } from '@aether/arch';
import type { Json } from '@aether/core';
import { generateBuiltinSync, validateOutput } from '../src/index';

const PLAN: BuildingPlanInput = {
  id: 'wide',
  name: 'Wide doors',
  style: 'mediterranean',
  levels: [
    {
      height: 3.2,
      rooms: [
        { id: 'living', type: 'living', rect: [0, 0, 9, 5], finish: { finish: 'wallpaper-floral' }, dado: { height: 1.0, material: { finish: 'panelling' }, rail: true } },
        { id: 'court', type: 'terrace', rect: [0, 5, 9, 9] },
        { id: 'bed', type: 'bedroom', rect: [9, 0, 14, 5], walls: { north: { finish: 'wallpaper-damask' } } },
      ],
      doors: [
        { between: ['living', 'outside'], side: 'south', kind: 'sliding', width: 3.8, style: 'glass' },
        { between: ['living', 'bed'] },
        { between: ['living', 'outside'], side: 'north', main: true },
      ],
    },
  ],
};

describe('every procedural entity of a compiled building generates', () => {
  it('wide sliding doors, papered and panelled walls, downlit ceilings, trees and parts all build valid geometry', () => {
    const b = compileBuilding(PLAN);
    const generators = new Set<string>();
    for (const e of b.entities) {
      const shape = e.shape;
      if (!shape || shape.kind !== 'procedural') continue;
      generators.add(shape.generator);
      const out = generateBuiltinSync(shape.generator, (shape.params ?? {}) as Record<string, Json>, shape.seed ?? 1);
      expect(validateOutput(out).ok, `${e.id} (${shape.generator})`).toBe(true);
      expect(out.parts.length, `${e.id} has geometry`).toBeGreaterThan(0);
    }
    expect(generators.has('arch-door')).toBe(true);
    expect(generators.has('arch-wall')).toBe(true);
    expect(generators.has('furn-part')).toBe(true);
    // The 3.8 m sliding leaf is a real slab, not an error placeholder.
    const leaf = b.entities.find((e) => e.arch?.kind === 'sliding' && e.arch.role === 'door');
    const shape = leaf?.shape as unknown as { generator: string; params: Record<string, number> };
    expect(shape.params['width']).toBeGreaterThan(3.3);
    const out = generateBuiltinSync(shape.generator, shape.params as Record<string, Json>, 1);
    expect(out.bounds.max[0] - out.bounds.min[0]).toBeGreaterThan(3.3);
  });

  it('furn-tree builds in all three species with a bounded triangle count', () => {
    for (const species of ['olive', 'cypress', 'umbrella-pine']) {
      for (const height of [2, 5, 12]) {
        const out = generateBuiltinSync('furn-tree', { species, height }, 7);
        expect(validateOutput(out).ok, `${species} ${height}`).toBe(true);
        expect(out.stats.triangles).toBeGreaterThan(300);
        expect(out.stats.triangles).toBeLessThan(60_000);
        // Trunk at the origin, crown above it.
        expect(out.bounds.min[1]).toBeGreaterThanOrEqual(-0.05);
        expect(out.bounds.max[1]).toBeGreaterThan(height * 0.6);
        expect(out.bounds.max[1]).toBeLessThan(height * 1.4);
      }
    }
  });
});
