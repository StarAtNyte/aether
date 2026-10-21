/**
 * Leaf cards with real-sized clusters and 2 × 2 card variants per atlas.
 */
import { describe, expect, it } from 'vitest';
import { FOLIAGE_CELLS, foliageCellUv, foliagePixels, generateBuiltinSync } from '../src/index';
import { cardBudget } from '../src/generators/flora';

describe('foliage atlas variants', () => {
  it('holds four different cards', () => {
    const { size, rgba } = foliagePixels('shrub', 128);
    const c = size / FOLIAGE_CELLS;
    const cell = (i: number): number[] => {
      const out: number[] = [];
      const ox = (i % 2) * c;
      const oy = Math.floor(i / 2) * c;
      for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) out.push(rgba[((oy + y) * size + ox + x) * 4 + 3]!);
      return out;
    };
    const cells = [0, 1, 2, 3].map(cell);
    for (let i = 1; i < 4; i++) expect(cells[i]).not.toEqual(cells[0]);
  });

  it('maps a cell to its quarter of the texture and clamps bad cells', () => {
    expect(foliageCellUv(0)).toEqual([0, 0, 0.5, 0.5]);
    expect(foliageCellUv(3)).toEqual([0.5, 0.5, 1, 1]);
    expect(foliageCellUv(99)).toEqual([0.5, 0.5, 1, 1]);
    expect(foliageCellUv(Number.NaN)).toEqual([0, 0, 0.5, 0.5]);
  });

  it('every card of a crown samples one cell only, and the crown uses several', () => {
    const out = generateBuiltinSync('shrub', { size: 1.2 }, 3);
    const uv = out.parts.find((p) => p.material.foliage !== undefined)!.uvs!;
    const cells = new Set<string>();
    // Four corners per card, both faces share them.
    for (let v = 0; v + 7 < uv.length; v += 8) {
      const us = [uv[v]!, uv[v + 2]!, uv[v + 4]!, uv[v + 6]!];
      const vs = [uv[v + 1]!, uv[v + 3]!, uv[v + 5]!, uv[v + 7]!];
      const cu = Math.min(...us) < 0.5 - 1e-6 ? 0 : 1;
      const cv = Math.min(...vs) < 0.5 - 1e-6 ? 0 : 1;
      for (const u of us) expect(cu === 0 ? u <= 0.5 + 1e-6 : u >= 0.5 - 1e-6).toBe(true);
      for (const w of vs) expect(cv === 0 ? w <= 0.5 + 1e-6 : w >= 0.5 - 1e-6).toBe(true);
      cells.add(`${cu}${cv}`);
    }
    expect(cells.size).toBeGreaterThan(2);
  });
});

describe('real-sized leaf clusters', () => {
  it('shrinks big cards to the real size and adds cards to keep the cover', () => {
    const b = cardBudget(100, 1, 0.5, 1000);
    expect(b.size).toBe(0.5);
    expect(b.count).toBe(400);
  });
  it('never grows a card past its old size, and stops adding cards at the cap', () => {
    expect(cardBudget(100, 0.3, 0.5, 1000)).toEqual({ count: 100, size: 0.3 });
    const capped = cardBudget(100, 2, 0.4, 500);
    expect(capped.count).toBe(500);
    expect(capped.size).toBeGreaterThan(0.4);
    expect(capped.size).toBeLessThan(2);
    // Cover is kept at the cap: count × size² is unchanged.
    expect(capped.count * capped.size ** 2).toBeCloseTo(100 * 4, 6);
  });
  it('a large shrub gets more, smaller cards than before; a small one is unchanged in kind', () => {
    const big = generateBuiltinSync('shrub', { size: 3 }, 1);
    const small = generateBuiltinSync('shrub', { size: 0.8 }, 1);
    const cards = (o: typeof big): number => o.parts.find((p) => p.material.foliage !== undefined)!.indices.length / 12;
    expect(cards(big)).toBeGreaterThan(cards(small));
    expect(cardBudget(130, 3 * 0.3, 0.42, 420).size).toBeLessThan(0.9);
  });
});
