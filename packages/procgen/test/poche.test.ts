import { describe, expect, it } from 'vitest';
import { FINISHES } from '@aether/arch';
import { SECTION_CAP } from '@aether/arch';
import { finishPixels } from '../src/finish-pixels';

describe('section poche', () => {
  it('is the finish of the cut face of a sectioned wall', () => {
    expect(SECTION_CAP.finish).toBe('poche');
    expect(FINISHES.poche.pattern).toBe('hatch');
  });

  it('is a dark solid with fine diagonal hatch lines that repeat across the tile', () => {
    const px = finishPixels('poche', 128);
    const n = 128;
    const lum: number[] = [];
    for (let i = 0; i < n * n; i++) lum.push(px.albedo[i * 4] as number);
    const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
    const max = Math.max(...lum);
    const min = Math.min(...lum);
    // Lines are clearly lighter than the solid, and the solid is the larger share.
    expect(max).toBeGreaterThan(min * 1.8);
    const dark = lum.filter((v) => v < (max + min) / 2).length / lum.length;
    expect(dark).toBeGreaterThan(0.6);
    expect(mean).toBeLessThan(max);
    // Diagonal: a pixel and the one a tile edge to the right (n px) are the same, and shifting by one step along (1,-1) keeps the value.
    for (const [x, y] of [[5, 9], [40, 77], [101, 3]] as const) {
      // (the faint grain differs from pixel to pixel, the lines do not)
      expect(Math.abs((lum[y * n + x] as number) - (lum[((y + 1) % n) * n + ((x - 1 + n) % n)] as number))).toBeLessThan(10);
    }
  });
});
