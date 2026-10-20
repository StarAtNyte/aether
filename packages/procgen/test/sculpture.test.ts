import { describe, expect, it } from 'vitest';
import { generateBuiltinSync, validateOutput } from '../src/index';

/** Directed edges without a reverse edge (0 for a closed surface). */
function openEdges(indices: Uint32Array, positions: Float32Array): number {
  const key = (v: number): string => `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]}`;
  const edges = new Set<string>();
  for (let i = 0; i < indices.length; i += 3) {
    for (let k = 0; k < 3; k++) edges.add(`${key(indices[i + k]!)}|${key(indices[i + ((k + 1) % 3)]!)}`);
  }
  let open = 0;
  for (const e of edges) {
    const [a, b] = e.split('|');
    if (!edges.has(`${b}|${a}`)) open++;
  }
  return open;
}

describe('colossus (high-detail sculpture)', () => {
  it('builds a closed, smooth, grounded mesh per variant with the requested height', () => {
    for (const variant of [0, 1, 2]) {
      const out = generateBuiltinSync('colossus', { variant, detail: 1, height: 10 }, 4);
      const v = validateOutput(out);
      expect(v.ok).toBe(true);
      expect(out.parts).toHaveLength(1);
      const p = out.parts[0]!;
      expect(p.indices.length / 3).toBe(12 * 64 * 64);
      expect(openEdges(p.indices, p.positions)).toBe(0);
      expect(out.bounds.min[1]).toBeCloseTo(0, 3);
      expect(out.bounds.max[1]).toBeCloseTo(10, 3);
      expect(p.material.flatShading).toBeUndefined();
      expect(p.colors?.length).toBe(p.positions.length);
      expect(out.colliders.length).toBeGreaterThan(0);
      expect(out.colliders.some((c) => c.kind === 'trimesh')).toBe(false);
    }
  });

  it('scales tessellation with detail and stays deterministic', () => {
    const a = generateBuiltinSync('colossus', { detail: 2 }, 9);
    expect(a.parts[0]!.indices.length / 3).toBe(12 * 128 * 128);
    const b = generateBuiltinSync('colossus', { detail: 2 }, 9);
    expect(Array.from(b.parts[0]!.positions.subarray(0, 300))).toEqual(Array.from(a.parts[0]!.positions.subarray(0, 300)));
  });
});

describe('terrain canyon variant', () => {
  it('has a flat floor at exactly y = 0 along Z and high walls', () => {
    const out = generateBuiltinSync('terrain', { variant: 3, size: 400, height: 50, resolution: 64 }, 2);
    const p = out.parts[0]!.positions;
    let floor = 0;
    let high = 0;
    for (let i = 0; i < p.length; i += 3) {
      if (Math.abs(p[i]!) < 4) {
        expect(p[i + 1]).toBe(0);
        floor++;
      }
      if (Math.abs(p[i]!) > 150 && p[i + 1]! > 30) high++;
    }
    expect(floor).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(0);
    expect(out.colliders.some((c) => c.kind === 'heightfield')).toBe(true);
  });
});

describe('terrain river valley variant', () => {
  it('carves a flat riverbed at y = 0 that follows riverMeander, with banks rising away from it', async () => {
    const { riverMeander, riverHalfWidth } = await import('@aether/core');
    const size = 400;
    const out = generateBuiltinSync('terrain', { variant: 4, size, height: 30, resolution: 96 }, 5);
    const p = out.parts[0]!.positions;
    let bed = 0;
    let bank = 0;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i]!;
      const z = p[i + 2]!;
      const d = Math.abs(x - riverMeander(z, size));
      if (d < riverHalfWidth(size) * 0.6) {
        expect(p[i + 1]).toBe(0);
        bed++;
      }
      if (d > size * 0.25 && p[i + 1]! > 6) bank++;
    }
    expect(bed).toBeGreaterThan(50);
    expect(bank).toBeGreaterThan(50);
    expect(out.colliders.some((c) => c.kind === 'heightfield')).toBe(true);
  });
});

describe('terrain estate variant', () => {
  const size = 300;
  const base = { variant: 5, size, height: 40, resolution: 120, padX: 10, padZ: -5, padRadius: 22 } as const;

  /** Heights (m above the lowest point) of the mesh vertices within `r` of (cx, cz). */
  function heightsNear(out: ReturnType<typeof generateBuiltinSync>, cx: number, cz: number, r: number): number[] {
    const p = out.parts[0]!.positions;
    const hs: number[] = [];
    for (let i = 0; i < p.length; i += 3) if (Math.hypot(p[i]! - cx, p[i + 2]! - cz) < r) hs.push(p[i + 1]!);
    return hs;
  }

  it('keeps the plot exactly level, rolls gently beyond it and closes the horizon with hills', () => {
    const out = generateBuiltinSync('terrain', base, 7);
    const plot = heightsNear(out, 10, -5, 22 - 3);
    expect(plot.length).toBeGreaterThan(40);
    expect(Math.max(...plot) - Math.min(...plot)).toBeLessThan(1e-6);
    // The rim is far higher than the plot; the meadow just outside the plot is within a couple of metres of it.
    const rim = heightsNear(out, 0, 140, 12);
    expect(Math.min(...rim) - plot[0]!).toBeGreaterThan(5);
    const meadow = heightsNear(out, 10 + 30, -5, 5);
    expect(Math.max(...meadow) - plot[0]!).toBeLessThan(4);
    expect(out.colliders.some((c) => c.kind === 'heightfield')).toBe(true);
  });

  it('carves a lake basin below the plot and keeps a level lane for a drive', () => {
    const out = generateBuiltinSync('terrain', { ...base, lakeX: 10, lakeZ: 60, lakeRadius: 14, lakeDepth: 3, laneX: 10, laneZ: 40, laneRadius: 4 }, 7);
    const plot = heightsNear(out, 10, -5, 15)[0]!;
    const lake = heightsNear(out, 10, 60, 4);
    expect(Math.max(...lake)).toBeLessThan(plot - 2);
    // The lowest point of the whole mesh is the lake bed (the terrain contract: lowest vertex at y = 0).
    const all = out.parts[0]!.positions;
    let lowest = Infinity;
    for (let i = 1; i < all.length; i += 3) lowest = Math.min(lowest, all[i]!);
    expect(lowest).toBeCloseTo(0, 5);
    expect(Math.min(...lake)).toBeLessThan(0.6);
    const lane = heightsNear(out, 10, 30, 3);
    expect(lane.length).toBeGreaterThan(3);
    expect(Math.max(...lane) - Math.min(...lane)).toBeLessThan(1e-6);
    expect(lane[0]!).toBeCloseTo(plot, 5);
  });

  it('is deterministic and ignores estate params in the other variants', () => {
    const a = generateBuiltinSync('terrain', base, 7).parts[0]!.positions;
    const b = generateBuiltinSync('terrain', base, 7).parts[0]!.positions;
    expect(Array.from(a)).toEqual(Array.from(b));
    const plain = generateBuiltinSync('terrain', { variant: 0, size: 60, height: 6, resolution: 32 }, 3).parts[0]!.positions;
    const plainWithEstate = generateBuiltinSync('terrain', { variant: 0, size: 60, height: 6, resolution: 32, padRadius: 30, lakeRadius: 10 }, 3).parts[0]!.positions;
    expect(Array.from(plainWithEstate)).toEqual(Array.from(plain));
  });
});
