/**
 * Blossoms and wild flowers: the two additional foliage card kinds, the flowering crown of `tree-broadleaf`
 * and the `wildflowers` generator.
 */
import { describe, expect, it } from 'vitest';
import { MaterialSpec } from '@aether/core';
import { FOLIAGE_ALPHA_CUT, foliagePixels, generateBuiltinSync, validateOutput, type FoliageKind } from '../src/index';
import { sanitizeMaterial } from '../src/material';

const NEW_KINDS: FoliageKind[] = ['blossom', 'flower'];

describe('blossom and flower cards', () => {
  for (const kind of NEW_KINDS) {
    it(`${kind}: a cut-out card with solid and empty areas, deterministic`, () => {
      const a = foliagePixels(kind, 128);
      const b = foliagePixels(kind, 128);
      expect(a.size).toBe(128);
      expect(Array.from(a.rgba.slice(0, 4000))).toEqual(Array.from(b.rgba.slice(0, 4000)));
      let solid = 0;
      for (let i = 3; i < a.rgba.length; i += 4) if ((a.rgba[i] as number) >= FOLIAGE_ALPHA_CUT) solid++;
      const share = solid / (a.rgba.length / 4);
      expect(share).toBeGreaterThan(0.04);
      expect(share).toBeLessThan(0.7);
    });
    it(`${kind}: the card is a neutral ratio the vertex colours tint (no strong hue of its own)`, () => {
      const { rgba } = foliagePixels(kind, 128);
      let n = 0;
      let spread = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        if ((rgba[i + 3] as number) < FOLIAGE_ALPHA_CUT) continue;
        n++;
        spread += Math.max(rgba[i] as number, rgba[i + 1] as number, rgba[i + 2] as number) - Math.min(rgba[i] as number, rgba[i + 1] as number, rgba[i + 2] as number);
      }
      expect(n).toBeGreaterThan(0);
      expect(spread / n / 255).toBeLessThan(0.3);
    });
    it(`${kind}: the material schema and the sandbox sanitiser accept it`, () => {
      expect(MaterialSpec.safeParse({ foliage: kind }).success).toBe(true);
      expect(sanitizeMaterial({ foliage: kind }).foliage).toBe(kind);
    });
  }
});

describe('flowering crown', () => {
  it('blossom above 0.5 swaps the leaf cards for blossom cards; below it stays leafy', () => {
    const pink = generateBuiltinSync('tree-broadleaf', { height: 7, color: '#f1a9c0', blossom: 1 }, 5);
    const leafy = generateBuiltinSync('tree-broadleaf', { height: 7, blossom: 0 }, 5);
    expect(validateOutput(pink).ok).toBe(true);
    expect(pink.parts.find((p) => p.material.foliage !== undefined)?.material.foliage).toBe('blossom');
    expect(leafy.parts.find((p) => p.material.foliage !== undefined)?.material.foliage).toBe('broadleaf');
  });
  it('a blossom crown is pink where the tint says so', () => {
    const out = generateBuiltinSync('tree-broadleaf', { height: 7, color: '#f1a9c0', blossom: 1 }, 5);
    const leaves = out.parts.find((p) => p.material.foliage !== undefined)!;
    let r = 0;
    let g = 0;
    const colors = leaves.colors!;
    for (let i = 0; i < colors.length; i += 3) {
      r += colors[i] as number;
      g += colors[i + 1] as number;
    }
    expect(r).toBeGreaterThan(g);
  });
});

describe('wildflowers', () => {
  it('is a valid, light, grounded patch of flower cards with a collider', () => {
    const out = generateBuiltinSync('wildflowers', { size: 0.5, color: '#f2c230' }, 3);
    expect(validateOutput(out).ok).toBe(true);
    const tris = out.parts.reduce((a, p) => a + p.indices.length / 3, 0);
    expect(tris).toBeLessThanOrEqual(30);
    expect(out.parts[0]?.material.foliage).toBe('flower');
    expect(out.bounds.min[1]).toBeCloseTo(0, 2);
    expect(out.colliders.length).toBeGreaterThan(0);
  });
  it('the colour param tints the heads: a red patch is redder at the top than at the root', () => {
    const out = generateBuiltinSync('wildflowers', { size: 0.5, color: '#e8484a', cards: 1 }, 3);
    const part = out.parts[0]!;
    const c = part.colors!;
    // Vertex order of a card: two bottom corners, then two top corners.
    const bottom = c[0] as number;
    const bottomG = c[1] as number;
    const topR = c[6] as number;
    const topG = c[7] as number;
    expect(topR / Math.max(1e-6, topG)).toBeGreaterThan(bottom / Math.max(1e-6, bottomG));
  });
  it('a mixed meadow varies colour between patches and is deterministic per seed', () => {
    const a = generateBuiltinSync('wildflowers', { variant: 1, cards: 6 }, 1);
    const b = generateBuiltinSync('wildflowers', { variant: 1, cards: 6 }, 1);
    expect(Array.from(a.parts[0]!.colors!)).toEqual(Array.from(b.parts[0]!.colors!));
    const tops = new Set<string>();
    const c = a.parts[0]!.colors!;
    for (let i = 6; i < c.length; i += 12) tops.add(`${c[i]!.toFixed(2)},${c[i + 1]!.toFixed(2)},${c[i + 2]!.toFixed(2)}`);
    expect(tops.size).toBeGreaterThan(2);
  });
});
