import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial } from 'three';
import { primitiveOutput } from '@aether/procgen';
import { lavaPixels, LAVA_CRUST_GLOW, SURFACE_FLOW, SURFACE_TEXTURE_SIZE, SURFACE_TILE_METRES, SurfaceTextures, waterPixels } from '../src/materials/surface-textures';
import { MaterialCache, createMaterial } from '../src/materials/material-cache';
import { resolveMaterial } from '../src/materials/presets';
import { boxProjectedUvs, partToBufferGeometry } from '../src/geometry/buffer-geometry';

const N = SURFACE_TEXTURE_SIZE;

/** Mean absolute difference between the left/right (or top/bottom) edges vs. two adjacent interior columns. */
function seam(px: Uint8Array, horizontal: boolean): { edge: number; interior: number } {
  let edge = 0;
  let interior = 0;
  for (let k = 0; k < N; k++) {
    const at = (i: number): number => (horizontal ? (k * N + i) * 4 : (i * N + k) * 4);
    edge += Math.abs(px[at(0)]! - px[at(N - 1)]!);
    interior += Math.abs(px[at(N / 2)]! - px[at(N / 2 - 1)]!);
  }
  return { edge: edge / N, interior: interior / N };
}

describe('surface textures', () => {
  it('lava: tileable, deterministic crust with glowing cracks', () => {
    const a = lavaPixels();
    const b = lavaPixels();
    expect(a.color).toEqual(b.color);
    expect(a.color.length).toBe(N * N * 4);
    for (const px of [a.color, a.emissive]) {
      for (const horizontal of [true, false]) {
        const s = seam(px, horizontal);
        // Wrapping across the tile edge is no rougher than any neighbouring pixels (+ slack).
        expect(s.edge).toBeLessThan(s.interior * 3 + 12);
      }
    }
    let crust = 0;
    let crack = 0;
    for (let i = 0; i < N * N; i++) {
      const r = a.emissive[i * 4]!;
      if (r <= Math.round(255 * LAVA_CRUST_GLOW) + 30) crust++;
      if (r > 200) crack++;
    }
    expect(crust / (N * N)).toBeGreaterThan(0.4);
    expect(crack / (N * N)).toBeGreaterThan(0.03);
    expect(crack / (N * N)).toBeLessThan(0.4);
  });

  it('water: unit tangent-space normals around +Z, tileable', () => {
    const { normal, color } = waterPixels();
    let tilted = 0;
    for (let i = 0; i < N * N; i++) {
      const x = normal[i * 4]! / 127.5 - 1;
      const y = normal[i * 4 + 1]! / 127.5 - 1;
      const z = normal[i * 4 + 2]! / 127.5 - 1;
      expect(Math.hypot(x, y, z)).toBeGreaterThan(0.95);
      expect(Math.hypot(x, y, z)).toBeLessThan(1.05);
      expect(z).toBeGreaterThan(0.3);
      if (z < 0.995) tilted++;
    }
    expect(tilted / (N * N)).toBeGreaterThan(0.5);
    const s = seam(normal, true);
    expect(s.edge).toBeLessThan(s.interior * 3 + 12);
    expect(color[0]!).toBeGreaterThan(200);
  });

  it('SurfaceTextures caches per kind, scrolls without exceeding one tile and disposes', () => {
    const t = new SurfaceTextures();
    expect(t.active).toBe(false);
    const lava = t.get('lava');
    expect(t.get('lava')).toBe(lava);
    expect(lava.emissiveMap).not.toBeNull();
    expect(lava.map.repeat.x).toBeCloseTo(1 / SURFACE_TILE_METRES.lava, 10);
    const water = t.get('water');
    expect(water.normalMap).not.toBeNull();
    expect(t.active).toBe(true);
    t.advance(10);
    expect(lava.map.offset.y).toBeCloseTo((SURFACE_FLOW.lava[1] * 10) % 1, 10);
    for (let i = 0; i < 1000; i++) t.advance(1);
    expect(Math.abs(water.map.offset.x)).toBeLessThan(1);
    t.advance(Number.NaN);
    t.dispose();
    expect(t.active).toBe(false);
  });
});

describe('textured presets', () => {
  it('lava and water carry their surface; other presets none', () => {
    expect(resolveMaterial({ preset: 'lava' }).surface).toBe('lava');
    expect(resolveMaterial({ preset: 'water', color: '#123456' }).surface).toBe('water');
    expect(resolveMaterial({ preset: 'stone' }).surface).toBeNull();
    expect(resolveMaterial(undefined).surface).toBeNull();
  });

  it('the cache gives lava glowing crack maps and water a ripple normal map; ghosts stay plain', () => {
    const cache = new MaterialCache();
    const lava = cache.acquire({ preset: 'lava' }).material as MeshStandardMaterial;
    expect(lava.map).not.toBeNull();
    expect(lava.emissiveMap).not.toBeNull();
    const water = cache.acquire({ preset: 'water' }).material as MeshStandardMaterial;
    expect(water.normalMap).not.toBeNull();
    expect(water.emissiveMap).toBeNull();
    const plain = cache.acquire({ preset: 'stone' }).material as MeshStandardMaterial;
    expect(plain.map).toBeNull();
    const ghost = cache.acquire({ preset: 'lava' }, {}, 'ghost').material as MeshStandardMaterial;
    expect(ghost.map).toBeNull();
    // Lava whose glow was switched off does not keep an emissive mask.
    const cold = createMaterial(resolveMaterial({ preset: 'lava', emissiveIntensity: 0 }), 'standard', cache.surfaces);
    expect(cold.emissiveMap).toBeNull();
    cold.dispose();
    cache.dispose();
  });
});

describe('box-projected uvs', () => {
  it('projects each vertex on the plane facing its dominant normal, in metres', () => {
    const positions = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const normals = new Float32Array([0, 1, 0, 0, 0, -1, 1, 0, 0]);
    expect(Array.from(boxProjectedUvs(positions, normals))).toEqual([1, 3, 4, 5, 9, 8]);
  });

  it('a 30 m lava pit spans 30 m of texture coordinates on its top face', () => {
    const out = primitiveOutput({ kind: 'primitive', primitive: 'cylinder', size: [30, 0.1, 30] });
    const g = partToBufferGeometry(out.parts[0]!);
    const uv = g.getAttribute('uv');
    const normal = g.getAttribute('normal');
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < uv.count; i++) {
      if (normal.getY(i) < 0.9) continue;
      lo = Math.min(lo, uv.getX(i));
      hi = Math.max(hi, uv.getX(i));
    }
    expect(hi - lo).toBeCloseTo(30, 0);
    g.dispose();
  });
});
