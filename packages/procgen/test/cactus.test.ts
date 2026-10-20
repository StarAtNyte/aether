import { describe, expect, it } from 'vitest';
import { generateBuiltinSync } from '../src/index';

describe('cactus', () => {
  it('builds every variant with a flat base, ribs, colliders and a modest budget, deterministically', () => {
    for (const variant of [0, 1, 2]) {
      const out = generateBuiltinSync('cactus', { variant, height: 6, arms: 3 }, 11);
      const tris = out.parts.reduce((s, p) => s + p.indices.length / 3, 0);
      expect(tris, `variant ${variant}`).toBeGreaterThan(200);
      expect(tris, `variant ${variant}`).toBeLessThan(20_000);
      expect(out.colliders.length).toBeGreaterThan(0);
      let minY = Infinity;
      for (const p of out.parts) for (let i = 1; i < p.positions.length; i += 3) minY = Math.min(minY, p.positions[i] as number);
      expect(minY).toBeGreaterThan(-0.05);
      expect(minY).toBeLessThan(0.05);
      expect(JSON.stringify(generateBuiltinSync('cactus', { variant, height: 6, arms: 3 }, 11).parts.map((p) => p.positions.length))).toBe(JSON.stringify(out.parts.map((p) => p.positions.length)));
    }
  });
});
