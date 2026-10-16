import { describe, expect, it } from 'vitest';
import { rng } from '@aether/core';
import { generateBuiltinSync } from '../src/index';
import { FLOOR_HEIGHT, towerSections } from '../src/generators/skyline';
import { finishPixels } from '../src/finish-pixels';

describe('towerSections', () => {
  it('stacks volumes on whole floors, narrower towards the top, with no gaps', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const sections = towerSections(30, 24, 120, 3, rng(seed));
      expect(sections.length).toBeGreaterThan(1);
      let y = 0;
      let prev = Infinity;
      for (const s of sections) {
        expect(s.y0).toBe(y);
        expect(s.y1).toBeGreaterThan(s.y0);
        expect(s.y0 % FLOOR_HEIGHT).toBe(0);
        expect(s.y1 % FLOOR_HEIGHT).toBe(0);
        expect(s.width % FLOOR_HEIGHT).toBe(0);
        expect(s.depth % FLOOR_HEIGHT).toBe(0);
        expect(s.width).toBeLessThanOrEqual(prev);
        prev = s.width;
        y = s.y1;
      }
      expect(y).toBe(120);
    }
  });

  it('never lets an upper volume overhang the one below it', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const sections = towerSections(36, 30, 150, 3, rng(seed));
      for (let i = 1; i < sections.length; i++) {
        const lo = sections[i - 1]!;
        const hi = sections[i]!;
        expect(hi.dx - hi.width / 2).toBeGreaterThanOrEqual(lo.dx - lo.width / 2 - 1e-9);
        expect(hi.dx + hi.width / 2).toBeLessThanOrEqual(lo.dx + lo.width / 2 + 1e-9);
        expect(hi.dz - hi.depth / 2).toBeGreaterThanOrEqual(lo.dz - lo.depth / 2 - 1e-9);
        expect(hi.dz + hi.depth / 2).toBeLessThanOrEqual(lo.dz + lo.depth / 2 + 1e-9);
      }
    }
  });

  it('a plain slab has one section', () => {
    expect(towerSections(24, 24, 60, 0, rng(1))).toHaveLength(1);
  });
});

describe('skyline-tower generator', () => {
  it('is deterministic, cheap, and puts the facade finish on its walls', () => {
    const a = generateBuiltinSync('skyline-tower', { height: 150, setbacks: 3, variant: 0 }, 7);
    const b = generateBuiltinSync('skyline-tower', { height: 150, setbacks: 3, variant: 0 }, 7);
    expect(JSON.stringify(a.parts.map((p) => [p.material, p.indices.length]))).toBe(JSON.stringify(b.parts.map((p) => [p.material, p.indices.length])));
    const facade = a.parts.find((p) => p.material?.finish === 'facade');
    expect(facade).toBeDefined();
    const tris = a.parts.reduce((n, p) => n + p.indices.length / 3, 0);
    expect(tris).toBeLessThan(250);
    // Authored metre UVs reach the height of the tower (the renderer keeps them for finish materials).
    const uv = facade!.uvs as Float32Array;
    let maxV = 0;
    for (let i = 1; i < uv.length; i += 2) maxV = Math.max(maxV, uv[i] as number);
    expect(maxV).toBeGreaterThan(30);
  });

  it('different seeds give different window phases', () => {
    const phases = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const out = generateBuiltinSync('skyline-tower', { height: 60 }, seed);
      const facade = out.parts.find((p) => p.material?.finish === 'facade');
      phases.add(`${facade!.uvs![0]}:${facade!.uvs![1]}`);
    }
    expect(phases.size).toBeGreaterThan(2);
  });

  it('has one box collider around its base volume', () => {
    const out = generateBuiltinSync('skyline-tower', { height: 90, setbacks: 2 }, 1);
    expect(out.colliders).toHaveLength(1);
    expect(out.colliders[0]?.kind).toBe('box');
  });
});

describe('facade finish', () => {
  it('has recessed glass, mullions and a lit-window mask', () => {
    const px = finishPixels('facade', 128);
    let lit = 0;
    let glassy = 0;
    let wall = 0;
    for (let i = 0; i < 128 * 128; i++) {
      if ((px.orm[i * 4 + 2] as number) > 0) lit++;
      const rough = px.orm[i * 4 + 1] as number;
      if (rough < 80) glassy++;
      if (rough > 120) wall++;
    }
    const total = 128 * 128;
    expect(lit / total).toBeGreaterThan(0.2);
    expect(lit / total).toBeLessThan(0.6);
    expect(glassy).toBeGreaterThan(total * 0.15);
    expect(wall).toBeGreaterThan(total * 0.15);
    // Glass is darker than the wall around it.
    let darkest = 255;
    let lightest = 0;
    for (let i = 0; i < total; i++) {
      darkest = Math.min(darkest, px.albedo[i * 4] as number);
      lightest = Math.max(lightest, px.albedo[i * 4] as number);
    }
    expect(lightest - darkest).toBeGreaterThan(60);
  });
});
