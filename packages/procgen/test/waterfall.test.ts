import { describe, expect, it } from 'vitest';
import { generateBuiltinSync } from '../src/index';

describe('waterfall-sheet', () => {
  const params = { variant: 1, height: 45, width: 17, strands: 3, pool: true, color: '#f2fbfa', throwSpeed: 2.2 };

  it('draws layered falling-water ribbons carrying the shader data in their vertex colours', () => {
    const out = generateBuiltinSync('waterfall-sheet', params, 1);
    const fall = out.parts.filter((p) => p.material.waterKind === 'fall');
    expect(fall).toHaveLength(1);
    const part = fall[0]!;
    expect(part.material.vertexColors).toBe(true);
    const colors = part.colors!;
    expect(colors.length).toBe(part.positions.length);
    // r: fraction of the fall, 0 at the lip and 1 at the pool; g: layer opacity, some layers fainter than the core.
    let lip = Infinity, base = -Infinity, faint = 0;
    for (let i = 0; i < colors.length; i += 3) {
      lip = Math.min(lip, colors[i]!);
      base = Math.max(base, colors[i]!);
      if (colors[i + 1]! < 0.7) faint++;
    }
    expect(lip).toBeLessThan(0.02);
    expect(base).toBeGreaterThan(0.98);
    expect(faint).toBeGreaterThan(0);
  });

  it('stays light enough for a laptop', () => {
    const out = generateBuiltinSync('waterfall-sheet', { ...params, strands: 7, height: 120, width: 60 }, 2);
    const tris = out.parts.reduce((n, p) => n + p.indices.length / 3, 0);
    expect(tris).toBeLessThan(3000);
  });
});
