import { describe, expect, it } from 'vitest';
import {
  ATLAS_SUBVOLUMES,
  FLOATS_PER_PROBE,
  LightVolumeBaker,
  TraceScene,
  atlasDepth,
  packVolumeAtlas,
  planVolumeGrid,
  sampleVolume,
  toHalf,
  VOLUME_ALLOC,
  type VolumeBakeInput,
  type VolumeGrid,
} from '../src/environment/light-volume';

/** Triangles of an axis-aligned box (outward winding) appended to `out`. */
function box(out: number[], lo: [number, number, number], hi: [number, number, number]): void {
  const [x0, y0, z0] = lo;
  const [x1, y1, z1] = hi;
  const q = (a: number[], b: number[], c: number[], d: number[]): void => {
    out.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // +z
  q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]); // -z
  q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]); // +x
  q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); // -x
  q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]); // +y
  q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); // -y
}

/**
 * A 6 × 3 × 6 m room (walls 0.2 m thick, floor and ceiling slabs), with a 2 m wide window gap in the +x wall when
 * `window` is set. Albedo 0.7 everywhere.
 */
function room(window: boolean): TraceScene {
  const t: number[] = [];
  box(t, [-3.2, -0.2, -3.2], [3.2, 0, 3.2]); // floor slab
  box(t, [-3.2, 3, -3.2], [3.2, 3.2, 3.2]); // ceiling slab
  box(t, [-3.2, 0, -3.2], [3.2, 3, -3]); // -z wall
  box(t, [-3.2, 0, 3], [3.2, 3, 3.2]); // +z wall
  box(t, [-3.2, 0, -3], [-3, 3, 3]); // -x wall
  if (window) {
    box(t, [3, 0, -3], [3.2, 3, -1]);
    box(t, [3, 0, 1], [3.2, 3, 3]);
    box(t, [3, 0, -1], [3.2, 0.8, 1]); // sill
    box(t, [3, 2.4, -1], [3.2, 3, 1]); // lintel
  } else {
    box(t, [3, 0, -3], [3.2, 3, 3]);
  }
  const positions = Float32Array.from(t);
  const albedo = new Float32Array((positions.length / 9) * 3).fill(0.7);
  return new TraceScene({ positions, albedo });
}

function input(scene: TraceScene, grid: VolumeGrid, extra: Partial<VolumeBakeInput> = {}): VolumeBakeInput {
  return {
    grid,
    scene,
    sun: { direction: [0.6, 0.5, 0].map((v, _i, a) => v / Math.hypot(...a)) as unknown as [number, number, number], irradiance: [3, 2.9, 2.7] },
    ambient: { a: [0.5, 0.55, 0.6], b: [0.2, 0.25, 0.35] },
    ground: { y: -0.2, albedo: [0.25, 0.3, 0.2] },
    lamps: [],
    rays: 32,
    passes: 2,
    ...extra,
  };
}

const ROOM_GRID = planVolumeGrid([-3.2, -0.2, -3.2], [3.2, 3.2, 3.2], 0.6)!;

describe('light volume: grid plan', () => {
  it('covers the box with a margin and respects the probe budget', () => {
    const g = planVolumeGrid([0, 0, 0], [12, 6, 10])!;
    expect(g.nx * g.ny * g.nz).toBeLessThanOrEqual(22_000);
    expect(g.min[0]).toBeLessThan(0);
    expect(g.min[0] + (g.nx - 1) * g.spacing).toBeGreaterThan(12);
    expect(g.min[1] + (g.ny - 1) * g.spacing).toBeGreaterThan(6);
    const huge = planVolumeGrid([0, 0, 0], [400, 50, 400])!;
    expect(huge.nx).toBeLessThanOrEqual(VOLUME_ALLOC.nx);
    expect(huge.ny).toBeLessThanOrEqual(VOLUME_ALLOC.ny);
    expect(huge.nz).toBeLessThanOrEqual(VOLUME_ALLOC.nz);
    expect(huge.spacing).toBeGreaterThan(1);
  });
  it('rejects empty, inverted and non-finite boxes', () => {
    expect(planVolumeGrid([0, 0, 0], [0, 1, 1])).toBeNull();
    expect(planVolumeGrid([1, 1, 1], [0, 0, 0])).toBeNull();
    expect(planVolumeGrid([Number.NaN, 0, 0], [1, 1, 1])).toBeNull();
    expect(planVolumeGrid([0, 0, 0], [1, 1, Number.POSITIVE_INFINITY])).toBeNull();
  });
});

describe('light volume: tracer', () => {
  it('finds the closest face and any-hit occlusion', () => {
    const t: number[] = [];
    box(t, [-1, -1, 4], [1, 1, 5]);
    box(t, [-1, -1, 8], [1, 1, 9]);
    const s = new TraceScene({ positions: Float32Array.from(t), albedo: new Float32Array(t.length / 3).fill(0.5) });
    const hit = s.intersect(0, 0, 0, 0, 0, 1, 100);
    expect(hit).toBeGreaterThanOrEqual(0);
    expect(s.hitT).toBeCloseTo(4, 5);
    const n: [number, number, number] = [0, 0, 0];
    s.normal(hit, n);
    expect(n[2]).toBeCloseTo(-1, 5);
    expect(s.intersect(0, 0, 0, 0, 0, -1, 100)).toBe(-1);
    expect(s.occluded(0, 0, 0, 0, 0, 1, 3.9)).toBe(false);
    expect(s.occluded(0, 0, 0, 0, 0, 1, 4.1)).toBe(true);
    expect(s.intersect(5, 0, 0, 0, 0, 1, 100)).toBe(-1);
  });
  it('handles an empty scene and malformed input', () => {
    const empty = new TraceScene({ positions: new Float32Array(0), albedo: new Float32Array(0) });
    expect(empty.intersect(0, 0, 0, 0, 1, 0, 10)).toBe(-1);
    const bad = new TraceScene({ positions: Float32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0]), albedo: Float32Array.from([Number.NaN, 2, -1]) });
    expect(bad.albedo[0]).toBe(0.5);
    expect(bad.albedo[1]).toBeCloseTo(0.95, 5);
    expect(bad.albedo[2]).toBe(0);
    expect(bad.intersect(0, 1, 0, 0, -1, 0, 10)).toBe(-1);
  });
});

describe('light volume: bake', () => {
  it('sees the whole sky outdoors (vis 1 upward, 0 downward) when nothing is around', () => {
    const scene = new TraceScene({ positions: new Float32Array(0), albedo: new Float32Array(0) });
    const g = planVolumeGrid([0, 0, 0], [2, 2, 2], 1)!;
    const data = new LightVolumeBaker(input(scene, g, { rays: 64 })).run();
    const up = sampleVolume(g, data, 1, 1, 1, [0, 1, 0]);
    const down = sampleVolume(g, data, 1, 1, 1, [0, -1, 0]);
    const side = sampleVolume(g, data, 1, 1, 1, [1, 0, 0]);
    expect(up.vis).toBeGreaterThan(0.92);
    expect(down.vis).toBeLessThan(0.08);
    expect(side.vis).toBeGreaterThan(0.4);
    expect(side.vis).toBeLessThan(0.6);
    // The sunlit ground bounces up onto downward-facing surfaces.
    expect(down.bounce[1]).toBeGreaterThan(0.1);
  });

  it('a room with a window: dark at the back, brighter by the window, ceilings lit by the bounce', () => {
    const scene = room(true);
    const data = new LightVolumeBaker(input(scene, ROOM_GRID)).run();
    const byWindow = sampleVolume(ROOM_GRID, data, 2.4, 1.5, 0, [1, 0, 0]);
    const back = sampleVolume(ROOM_GRID, data, -2.5, 1.5, 0, [1, 0, 0]);
    expect(byWindow.vis).toBeGreaterThan(back.vis);
    expect(back.vis).toBeLessThan(0.15);
    const ceiling = sampleVolume(ROOM_GRID, data, 0, 2.7, 0, [0, -1, 0]);
    expect(ceiling.vis).toBeLessThan(0.05);
    expect(ceiling.bounce[0]).toBeGreaterThan(0.02);
    // A closed room sees no sky at all.
    const closed = new LightVolumeBaker(input(room(false), ROOM_GRID)).run();
    const inside = sampleVolume(ROOM_GRID, closed, 0, 1.5, 0, [0, 1, 0]);
    expect(inside.vis).toBeLessThan(0.02);
    expect(inside.bounce[0]).toBeLessThan(ceiling.bounce[0]);
  });

  it('lamps light a closed room through the bounce', () => {
    const scene = room(false);
    const dark = new LightVolumeBaker(input(scene, ROOM_GRID, { sun: null })).run();
    const lit = new LightVolumeBaker(input(scene, ROOM_GRID, { sun: null, lamps: [{ position: [0, 2.2, 0], color: [20, 16, 12], range: 8 }] })).run();
    const a = sampleVolume(ROOM_GRID, dark, -1, 1, 1, [0, 1, 0]);
    const b = sampleVolume(ROOM_GRID, lit, -1, 1, 1, [0, 1, 0]);
    expect(b.bounce[0]).toBeGreaterThan(a.bounce[0] + 0.1);
    // Warm lamp, warm bounce.
    expect(b.bounce[0]).toBeGreaterThan(b.bounce[2]);
  });

  it('is deterministic and independent of how the work is sliced', () => {
    const scene = room(true);
    const whole = new LightVolumeBaker(input(scene, ROOM_GRID)).run();
    const sliced = new LightVolumeBaker(input(scene, ROOM_GRID));
    let clock = 0;
    let steps = 0;
    while (!sliced.step(3, () => (clock += 1))) steps++;
    expect(steps).toBeGreaterThan(10);
    expect(sliced.progress).toBe(1);
    expect(Array.from(sliced.data)).toEqual(Array.from(whole));
    expect(whole.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('flags probes buried in walls and fills them from free neighbours', () => {
    const t: number[] = [];
    box(t, [-0.5, -5, -5], [0.5, 5, 5]); // a 1 m thick slab through the grid's centre plane
    const scene = new TraceScene({ positions: Float32Array.from(t), albedo: new Float32Array(t.length / 3).fill(0.5) });
    const g: VolumeGrid = { min: [-1, 0, 0], spacing: 1, nx: 3, ny: 2, nz: 2 };
    const baker = new LightVolumeBaker(input(scene, g));
    baker.run();
    expect(baker.valid[1]).toBe(0);
    expect(baker.valid[0]).toBe(1);
    expect(baker.valid[2]).toBe(1);
    // Filled: the buried probe holds a blend of its neighbours, not zeros.
    expect(baker.data[1 * FLOATS_PER_PROBE]).toBeGreaterThan(0);
  });
});

describe('light volume: atlas and sampling', () => {
  it('packs four padded sub-volumes of half floats into the fixed allocation', () => {
    const g: VolumeGrid = { min: [0, 0, 0], spacing: 1, nx: 2, ny: 2, nz: 3 };
    const alloc = { nx: 4, ny: 3, nz: 5 };
    const data = new Float32Array(12 * FLOATS_PER_PROBE);
    for (let i = 0; i < 12; i++) for (let k = 0; k < FLOATS_PER_PROBE; k++) data[i * FLOATS_PER_PROBE + k] = i + k / 16;
    const atlas = packVolumeAtlas(g, data, alloc);
    expect(atlasDepth(alloc)).toBe(ATLAS_SUBVOLUMES * 7);
    expect(atlas.length).toBe(4 * 3 * 28 * 4);
    const at = (x: number, y: number, z: number): number => atlas[(x + alloc.nx * (y + alloc.ny * z)) * 4]!;
    // Sub-volume 1 (red), probe (1, 0, 2): slice 1·7 + 1 + 2.
    expect(at(1, 0, 7 + 1 + 2)).toBe(toHalf(1 + 2 * (0 + 2 * 2) + 4 / 16));
    // Padding slices copy the edges; texels outside the grid stay zero.
    expect(at(0, 0, 7)).toBe(at(0, 0, 8));
    expect(at(0, 0, 7 + 4)).toBe(at(0, 0, 7 + 3));
    expect(at(3, 2, 8)).toBe(0);
    // Re-packing into the same buffer reuses it.
    const again = packVolumeAtlas(g, data, alloc, atlas);
    expect(again).toBe(atlas);
    expect(atlasDepth()).toBe(ATLAS_SUBVOLUMES * (VOLUME_ALLOC.nz + 2));
  });
  it('converts to half precision', () => {
    expect(toHalf(0)).toBe(0);
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(0.5)).toBe(0x3800);
    expect(toHalf(Number.NaN)).toBe(0);
    expect(toHalf(1e9)).toBe(toHalf(65000));
  });
  it('reads non-finite positions at the centre without NaN', () => {
    const g: VolumeGrid = { min: [0, 0, 0], spacing: 1, nx: 2, ny: 2, nz: 2 };
    const data = new Float32Array(8 * FLOATS_PER_PROBE).fill(0.25);
    const s = sampleVolume(g, data, Number.NaN, 0, 0, [0, 1, 0]);
    expect(Number.isFinite(s.vis)).toBe(true);
    expect(s.vis).toBeCloseTo(0.5, 5);
  });
});
