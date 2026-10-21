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
  packFreeDistances,
  probeSees,
  unpackFreeDistances,
  FREE_STEPS,
  GEOMETRY_OFFSET,
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

/**
 * Two 3 × 3 × 3 m rooms side by side along x, split by a 0.12 m wall at x = 0 (thinner than a probe spacing): the
 * east room has a full-height opening to the sky in its +x wall, the west room is sealed.
 */
function twoRooms(): TraceScene {
  const t: number[] = [];
  box(t, [-3.2, -0.2, -1.7], [3.2, 0, 1.7]); // floor slab
  box(t, [-3.2, 3, -1.7], [3.2, 3.2, 1.7]); // ceiling slab
  box(t, [-3.2, 0, -1.7], [3.2, 3, -1.5]); // -z wall
  box(t, [-3.2, 0, 1.5], [3.2, 3, 1.7]); // +z wall
  box(t, [-3.2, 0, -1.5], [-3, 3, 1.5]); // west wall
  box(t, [-0.06, 0, -1.5], [0.06, 3, 1.5]); // thin party wall
  box(t, [3, 0, -1.5], [3.2, 0.3, 1.5]); // east: a low sill, open above
  const positions = Float32Array.from(t);
  return new TraceScene({ positions, albedo: new Float32Array((positions.length / 9) * 3).fill(0.7) });
}

describe('light volume: leaks', () => {
  it('packs and unpacks free distances exactly in half precision', () => {
    const codes = [0, 7, 3, 5, 1, 6];
    const [a, b] = packFreeDistances(codes);
    expect(a).toBeLessThan(512);
    expect(b).toBeLessThan(512);
    const out = new Float32Array(6);
    unpackFreeDistances(a, b, out);
    expect(out[1]).toBe(2);
    expect(out[0]).toBe(0);
    expect(out[2]).toBeCloseTo(3 / FREE_STEPS, 6);
    expect(out[5]).toBeCloseTo(6 / FREE_STEPS, 6);
    // A probe with a wall 0.2 spacings to its +x does not see a point 0.5 spacings that way; it sees one to its -x.
    const free = [2, 0.2, 2, 2, 2, 2];
    expect(probeSees(0.5, 0, 0, free)).toBe(0);
    expect(probeSees(-0.5, 0.3, 0, free)).toBe(1);
  });

  it('a probe a few centimetres off a wall still sees the points between itself and the wall, a buried probe sees none', () => {
    // Free distance toward the wall quantised down to 0 (the wall is 0.06 spacings away): the point 0.05 spacings that way is
    // in front of the wall and was rejected, leaving a hairline of unfiltered light along every corner and ceiling join.
    const nearWall = [2, 0, 2, 2, 2, 2];
    expect(probeSees(0.05, 0, 0, nearWall)).toBeGreaterThan(0.3);
    // ...but a point well beyond the wall (a thin wall's far side, 0.12 m / 0.45 m = 0.27 spacings away) is still hidden.
    expect(probeSees(0.27, 0, 0, nearWall)).toBe(0);
    expect(probeSees(0.02, 0, 0, [0, 0, 0, 0, 0, 0])).toBe(0);
    // The code holds the low end of a step: a wall 0.5 spacings away reads 3/7 (0.43), a point 0.49 spacings that way is in
    // front of it and is seen; the far side of a 0.12 m wall (0.5 + 0.27 spacings) is not.
    const quantised = [2, 3 / FREE_STEPS, 2, 2, 2, 2];
    expect(probeSees(0.49, 0, 0, quantised)).toBe(1);
    expect(probeSees(0.5 + 0.27, 0, 0, quantised)).toBe(0);
  });

  it('a thin wall keeps the sunlit room out of the dark room beside it', () => {
    const g = planVolumeGrid([-3.2, -0.2, -1.7], [3.2, 3.2, 1.7], 0.45)!;
    const baker = new LightVolumeBaker(input(twoRooms(), g, { rays: 48, passes: 3 }));
    const data = baker.run();
    // Probes carry their free distances: one just west of the party wall sees no further east than the wall.
    const sp = g.spacing;
    const ix = Math.round((-0.2 - g.min[0]) / sp);
    const iy = Math.round((1.5 - g.min[1]) / sp);
    const iz = Math.round((0 - g.min[2]) / sp);
    const j = ix + g.nx * (iy + g.ny * iz);
    const free = new Float32Array(6);
    unpackFreeDistances(data[j * FLOATS_PER_PROBE + GEOMETRY_OFFSET]!, data[j * FLOATS_PER_PROBE + GEOMETRY_OFFSET + 1]!, free);
    const px = g.min[0] + ix * sp;
    if (px < -0.06) expect(free[1]! * sp).toBeLessThan(-0.06 - px + sp / FREE_STEPS + 1e-6);
    // The dark room's face of the party wall reads its own darkness, not the lit room 0.12 m away.
    const darkFace = sampleVolume(g, data, -0.06 - 0.1, 1.5, 0, [-1, 0, 0]);
    const litFace = sampleVolume(g, data, 0.06 + 0.1, 1.5, 0, [1, 0, 0]);
    expect(litFace.vis).toBeGreaterThan(0.04);
    expect(darkFace.vis).toBeLessThan(litFace.vis * 0.25);
    expect(darkFace.vis).toBeLessThan(0.03);
    const lum = (s: { bounce: [number, number, number] }): number => s.bounce[0] + s.bounce[1] + s.bounce[2];
    expect(lum(darkFace)).toBeLessThan(lum(litFace) * 0.03);
  });
});

describe('light volume: atlas and sampling', () => {
  it('packs five padded sub-volumes of half floats into the fixed allocation', () => {
    const g: VolumeGrid = { min: [0, 0, 0], spacing: 1, nx: 2, ny: 2, nz: 3 };
    const alloc = { nx: 4, ny: 3, nz: 5 };
    const data = new Float32Array(12 * FLOATS_PER_PROBE);
    for (let i = 0; i < 12; i++) for (let k = 0; k < FLOATS_PER_PROBE; k++) data[i * FLOATS_PER_PROBE + k] = i + k / 16;
    const atlas = packVolumeAtlas(g, data, alloc);
    expect(atlasDepth(alloc)).toBe(ATLAS_SUBVOLUMES * 7);
    expect(atlas.length).toBe(4 * 3 * ATLAS_SUBVOLUMES * 7 * 4);
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
