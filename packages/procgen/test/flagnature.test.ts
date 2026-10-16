/**
 * Outdoor flagship polish at the generator level: billowing clouds (smooth, not faceted), the canoe hull, bare winter
 * broadleaf trees and the river valley's flat, walkable floodplain with a clear waterline.
 */
import { riverHalfWidth, riverMeander } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { generateBuiltinSync } from '../src/index';
import type { GeneratorOutput } from '../src/types';

const triangles = (out: GeneratorOutput): number => out.parts.reduce((s, p) => s + p.indices.length / 3, 0);

describe('cloud', () => {
  it('is a smooth, vertex-coloured mass of puffs, not faceted blobs', () => {
    const out = generateBuiltinSync('cloud', { size: 20, variant: 0 }, 5);
    const part = out.parts[0];
    expect(part).toBeDefined();
    expect(part?.material.flatShading).not.toBe(true);
    expect(part?.colors).toBeDefined();
    // Smooth shading shares vertices between faces: far fewer vertices than three per triangle.
    expect((part?.positions.length ?? 0) / 3).toBeLessThan(triangles(out) * 3 * 0.75);
    expect(triangles(out)).toBeGreaterThan(2000);
  });

  it('is darker underneath than on top (a sunlit crown over a blue-grey belly)', () => {
    const out = generateBuiltinSync('cloud', { size: 24, variant: 0, color: '#ffffff' }, 9);
    const part = out.parts[0];
    if (!part?.colors) throw new Error('no vertex colours');
    const lum = (i: number): number => (part.colors?.[i * 3] ?? 0) * 0.3 + (part.colors?.[i * 3 + 1] ?? 0) * 0.55 + (part.colors?.[i * 3 + 2] ?? 0) * 0.15;
    let low = 0;
    let lowN = 0;
    let high = 0;
    let highN = 0;
    const mid = (out.bounds.min[1] + out.bounds.max[1]) / 2;
    for (let i = 0; i < part.positions.length / 3; i++) {
      if ((part.positions[i * 3 + 1] ?? 0) < mid) {
        low += lum(i);
        lowN++;
      } else {
        high += lum(i);
        highN++;
      }
    }
    expect(high / highN).toBeGreaterThan(low / lowN);
  });
});

describe('canoe (boat variant 3)', () => {
  const out = generateBuiltinSync('boat', { length: 4.6, variant: 3 }, 3);

  it('lies along Z (bow at -Z, the engine forward axis), narrow and shallow, sitting on y = 0', () => {
    const size = [out.bounds.max[0] - out.bounds.min[0], out.bounds.max[1] - out.bounds.min[1], out.bounds.max[2] - out.bounds.min[2]];
    expect(size[2]).toBeGreaterThan(4.3);
    expect(size[0]).toBeGreaterThan(0.9);
    expect(size[0]).toBeLessThan(1.5);
    expect(size[1]).toBeLessThan(0.9);
    expect(out.bounds.min[1]).toBeCloseTo(0, 3);
  });

  it('has real wall thickness (an outer and an inner skin) and a convex hull collider', () => {
    // Outer skin, inner skin, gunwale strip, thwarts and floor slats: well over a thousand triangles (one shell alone is 720).
    expect(triangles(out)).toBeGreaterThan(1200);
    expect(out.colliders.some((c) => c.kind === 'hull')).toBe(true);
    expect(out.colliders.some((c) => c.kind === 'trimesh')).toBe(false);
    expect(triangles(out)).toBeLessThan(3000);
  });

  it('is symmetric about its middle (the same canoe from both ends)', () => {
    const mid = (out.bounds.min[2] + out.bounds.max[2]) / 2;
    expect(Math.abs(mid)).toBeLessThan(0.05);
  });
});

describe('tree-broadleaf leaf share', () => {
  const foliageParts = (o: GeneratorOutput): number => o.parts.filter((p) => p.material.foliage !== undefined).length;
  it('leaf 0 is a bare winter tree: no foliage, more twigs, still a trunk collider', () => {
    const bare = generateBuiltinSync('tree-broadleaf', { height: 6, leaf: 0 }, 11);
    const full = generateBuiltinSync('tree-broadleaf', { height: 6, leaf: 1 }, 11);
    expect(foliageParts(bare)).toBe(0);
    expect(foliageParts(full)).toBeGreaterThan(0);
    const wood = (o: GeneratorOutput): number => o.parts.filter((p) => p.material.foliage === undefined).reduce((s, p) => s + p.indices.length / 3, 0);
    expect(wood(bare)).toBeGreaterThan(wood(full));
    expect(bare.colliders.length).toBeGreaterThan(0);
  });
});

describe('river valley floodplain', () => {
  const SIZE = 320;
  const out = generateBuiltinSync('terrain', { size: SIZE, height: 44, resolution: 200, roughness: 0.5, variant: 4 }, 0x4c71);
  const hf = out.colliders.find((c) => c.kind === 'heightfield');
  if (!hf || hf.kind !== 'heightfield') throw new Error('no heightfield');
  const n = hf.rows + 1;
  const at = (ix: number, iz: number): number => (hf.heights[Math.min(hf.cols, Math.max(0, ix)) * n + Math.min(hf.rows, Math.max(0, iz))] as number) * hf.size[1];
  const height = (x: number, z: number): number => {
    const fx = ((x + SIZE / 2) / SIZE) * hf.cols;
    const fz = ((z + SIZE / 2) / SIZE) * hf.rows;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    return at(ix, iz) * (1 - tx) * (1 - tz) + at(ix + 1, iz) * tx * (1 - tz) + at(ix, iz + 1) * (1 - tx) * tz + at(ix + 1, iz + 1) * tx * tz;
  };
  const slopeDeg = (x: number, z: number): number => {
    const dx = (height(x + 1.2, z) - height(x - 1.2, z)) / 2.4;
    const dz = (height(x, z + 1.2) - height(x, z - 1.2)) / 2.4;
    return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
  };
  const HALF = riverHalfWidth(SIZE);

  it('keeps the strip beside the water walkable (camps, paths and trees stand there), on both banks all along the valley', () => {
    for (let z = -120; z <= 130; z += 10) {
      for (const side of [-1, 1]) {
        for (let d = 3; d <= 30; d += 3) expect(slopeDeg(riverMeander(z, SIZE) + side * (HALF + d), z), `z ${z} side ${side} d ${d}`).toBeLessThan(18);
      }
    }
  });

  it('lifts the bank above the 0.38 m water within a few metres, so the water has an edge and trees do not stand in it', () => {
    for (let z = -120; z <= 130; z += 20) {
      for (const side of [-1, 1]) {
        const bed = height(riverMeander(z, SIZE), z);
        expect(bed).toBeCloseTo(0, 3);
        expect(height(riverMeander(z, SIZE) + side * (HALF + 6), z)).toBeGreaterThan(0.5);
      }
    }
  });

  it('still rises into real valley walls away from the floodplain', () => {
    let high = 0;
    for (let z = -140; z <= 140; z += 14) if (height(riverMeander(z, SIZE) + HALF + 110, z) > 8) high++;
    expect(high).toBeGreaterThan(5);
  });
});
