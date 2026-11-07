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
  combineVolume,
  PART_FLOATS,
  storeVolumeParts,
  type VolumeGrid,
} from '../src/environment/light-volume';
import { PART_LAMP, PART_SKY1, PART_SUN0, partCount, relightCoefficients, volumeLightFloats, type RelightLighting } from '../src/environment/relight';

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

const SUN_KEY: [number, number, number] = [0.6 / Math.hypot(0.6, 0.5), 0.5 / Math.hypot(0.6, 0.5), 0];

/** The light the old single-time bake was made for: the sun on the key, a sky, lamps at full strength. */
const LIGHT: RelightLighting = {
  sun: { direction: SUN_KEY, irradiance: [3, 2.9, 2.7] },
  ambient: { a: [0.5, 0.55, 0.6], b: [0.2, 0.25, 0.35] },
  lampScale: 1,
};

/** Bake and weight the parts for `light`: the classic 20-float volume. */
function bakeVolume(inp: VolumeBakeInput, light: RelightLighting = LIGHT): Float32Array {
  const baker = new LightVolumeBaker(inp);
  baker.run();
  return combineVolume(baker.probes, baker.data, baker.light, baker.parts, relightCoefficients(inp.sunKeys, light), new Float32Array(baker.probes * FLOATS_PER_PROBE));
}

function input(scene: TraceScene, grid: VolumeGrid, extra: Partial<VolumeBakeInput> = {}): VolumeBakeInput {
  return {
    grid,
    scene,
    sunKeys: [SUN_KEY],
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
    const data = bakeVolume(input(scene, g, { rays: 64 }));
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
    const data = bakeVolume(input(scene, ROOM_GRID));
    const byWindow = sampleVolume(ROOM_GRID, data, 2.4, 1.5, 0, [1, 0, 0]);
    const back = sampleVolume(ROOM_GRID, data, -2.5, 1.5, 0, [1, 0, 0]);
    expect(byWindow.vis).toBeGreaterThan(back.vis);
    expect(back.vis).toBeLessThan(0.15);
    const ceiling = sampleVolume(ROOM_GRID, data, 0, 2.7, 0, [0, -1, 0]);
    expect(ceiling.vis).toBeLessThan(0.05);
    expect(ceiling.bounce[0]).toBeGreaterThan(0.02);
    // A closed room sees no sky at all.
    const closed = bakeVolume(input(room(false), ROOM_GRID));
    const inside = sampleVolume(ROOM_GRID, closed, 0, 1.5, 0, [0, 1, 0]);
    expect(inside.vis).toBeLessThan(0.02);
    expect(inside.bounce[0]).toBeLessThan(ceiling.bounce[0]);
  });

  it('lamps light a closed room through the bounce', () => {
    const scene = room(false);
    const noSun = { ...LIGHT, sun: null };
    const dark = bakeVolume(input(scene, ROOM_GRID), noSun);
    const lampInput = input(scene, ROOM_GRID, { lamps: [{ position: [0, 2.2, 0], color: [20, 16, 12], range: 8 }] });
    const lit = bakeVolume(lampInput, noSun);
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
    expect(sliced.light.every((v) => Number.isFinite(v))).toBe(true);
    // The base data carries no light: it all lives in the parts.
    for (let i = 0; i < sliced.probes; i++) for (let k = 4; k < GEOMETRY_OFFSET; k++) expect(whole[i * FLOATS_PER_PROBE + k]).toBe(0);
    expect(sliced.parts).toBe(partCount(1));
    expect(sliced.light.length).toBe(sliced.probes * volumeLightFloats(1));
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

describe('light volume: re-lightable parts', () => {
  const baker = new LightVolumeBaker(input(room(true), ROOM_GRID, { lamps: [{ position: [0, 2.2, 0], color: [20, 16, 12], range: 8 }] }));
  baker.run();
  const F = FLOATS_PER_PROBE;
  const combine = (l: RelightLighting): Float32Array =>
    combineVolume(baker.probes, baker.data, baker.light, baker.parts, relightCoefficients([SUN_KEY], l), new Float32Array(baker.probes * F));
  const dark: RelightLighting = { sun: null, ambient: { a: [0, 0, 0], b: [0, 0, 0] }, lampScale: 0 };
  /** The light floats of a combined volume (everything but visibility and free distances). */
  const lightOf = (v: Float32Array): number[] => {
    const o: number[] = [];
    for (let i = 0; i < baker.probes; i++) for (let k = 4; k < GEOMETRY_OFFSET; k++) o.push(v[i * F + k]!);
    return o;
  };
  const probe = (v: Float32Array): number => lightOf(v).reduce((a, b) => a + Math.abs(b), 0);

  it('a sun of irradiance X is twice the light of X/2, and no light is no bounce', () => {
    const withSun = (x: number): Float32Array => combine({ ...dark, sun: { direction: SUN_KEY, irradiance: [x, x, x] } });
    const a = lightOf(withSun(1)), b = lightOf(withSun(2));
    expect(probe(withSun(1))).toBeGreaterThan(0.1);
    for (let i = 0; i < a.length; i++) expect(b[i]!).toBeCloseTo(a[i]! * 2, 4);
    expect(probe(combine(dark))).toBe(0);
  });

  it('the lamp part scales linearly with the lamps scale', () => {
    const a = lightOf(combine({ ...dark, lampScale: 0.25 })), b = lightOf(combine({ ...dark, lampScale: 1 }));
    expect(probe(combine({ ...dark, lampScale: 1 }))).toBeGreaterThan(0.1);
    for (let i = 0; i < a.length; i++) expect(b[i]!).toBeCloseTo(a[i]! * 4, 4);
    const coeffs = relightCoefficients([SUN_KEY], { ...dark, lampScale: 1 });
    expect(coeffs[PART_LAMP * 3]).toBe(1);
  });

  it('weights add: the sun plus the lamps is the sum of each alone', () => {
    const sun = lightOf(combine({ ...dark, sun: { direction: SUN_KEY, irradiance: [2, 2, 2] } }));
    const lamp = lightOf(combine({ ...dark, lampScale: 0.5 }));
    const both = lightOf(combine({ ...dark, sun: { direction: SUN_KEY, irradiance: [2, 2, 2] }, lampScale: 0.5 }));
    for (let i = 0; i < both.length; i++) expect(both[i]!).toBeCloseTo(sun[i]! + lamp[i]!, 4);
  });

  it('the sky gradient part is signed (negative light floats appear)', () => {
    const grad = combine({ ...dark, ambient: { a: [0, 0, 0], b: [1, 1, 1] } });
    let neg = 0;
    for (let i = 0; i < baker.probes; i++) for (let k = 4; k < GEOMETRY_OFFSET; k++) {
      if (grad[i * F + k]! < -1e-6) neg++;
    }
    expect(neg).toBeGreaterThan(0);
    expect(PART_SKY1).toBe(1);
  });
});

describe('light volume: stored parts', () => {
  const probes = 3;
  const keys = 3;
  const parts = partCount(keys);
  const rng = ((): (() => number) => {
    let x = 12345;
    return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  })();

  /** RGB parts per probe (the form the bake works in): sky and lamp arbitrary, the keys sharing one colour per probe. */
  function rgbParts(): Float32Array {
    const src = new Float32Array(probes * parts * PART_FLOATS);
    for (let i = 0; i < probes; i++) {
      const o = i * parts * PART_FLOATS;
      for (let k = 0; k < PART_SUN0 * PART_FLOATS; k++) src[o + k] = rng() * 2 - 0.5;
      const colour = [0.5 + rng(), 0.4 + rng(), 0.3 + rng()];
      for (let k = 0; k < keys; k++) {
        const sh = [0.2 + rng(), rng() - 0.5, rng() - 0.5, rng() - 0.5];
        for (let c = 0; c < 3; c++) for (let j = 0; j < 4; j++) src[o + (PART_SUN0 + k) * PART_FLOATS + c * 4 + j] = colour[c]! * sh[j]!;
      }
    }
    return src;
  }

  function store(src: Float32Array): Float32Array {
    const LF = volumeLightFloats(keys);
    const light = new Float32Array(probes * LF);
    for (let i = 0; i < probes; i++) storeVolumeParts(src, i * parts * PART_FLOATS, keys, light, i * LF);
    return light;
  }

  it('is 40 + 4 floats per key per probe', () => {
    expect(volumeLightFloats(0)).toBe(40);
    expect(volumeLightFloats(keys)).toBe(40 + 4 * keys);
    expect(store(rgbParts()).length).toBe(probes * volumeLightFloats(keys));
  });

  it('combining the compressed parts equals combining the RGB parts when the keys at a probe share a colour', () => {
    const src = rgbParts();
    const light = store(src);
    const data = new Float32Array(probes * FLOATS_PER_PROBE);
    const coeffs = new Float32Array(parts * 3);
    for (let k = 0; k < coeffs.length; k++) coeffs[k] = rng() * 2 - 0.5;
    const out = combineVolume(probes, data, light, parts, coeffs, new Float32Array(probes * FLOATS_PER_PROBE));
    for (let i = 0; i < probes; i++) {
      for (let c = 0; c < 3; c++) {
        for (let j = 0; j < 4; j++) {
          let want = 0;
          for (let p = 0; p < parts; p++) want += coeffs[p * 3 + c]! * src[(i * parts + p) * PART_FLOATS + c * 4 + j]!;
          expect(out[i * FLOATS_PER_PROBE + 4 + c * 4 + j]!).toBeCloseTo(want, 4);
        }
      }
    }
  });

  it('keys of differing colour are approximated by their shared chroma, the luminance stays right', () => {
    const src = rgbParts();
    const o = (PART_SUN0 + 1) * PART_FLOATS;
    // Make key 1 of probe 0 red while the others are grey: the stored form cannot keep both colours.
    for (let j = 0; j < 4; j++) {
      src[o + j] = src[o + j]! * 3;
      src[o + 8 + j] = src[o + 8 + j]! * 0.2;
    }
    const light = store(src);
    const coeffs = new Float32Array(parts * 3);
    coeffs[(PART_SUN0 + 1) * 3 + 0] = coeffs[(PART_SUN0 + 1) * 3 + 1] = coeffs[(PART_SUN0 + 1) * 3 + 2] = 1;
    const out = combineVolume(probes, new Float32Array(probes * FLOATS_PER_PROBE), light, parts, coeffs, new Float32Array(probes * FLOATS_PER_PROBE));
    const lum = (c0: number, c1: number, c2: number): number => 0.2126 * c0 + 0.7152 * c1 + 0.0722 * c2;
    // Luminance of the constant term (red, green, blue weighted) is the key's own.
    expect(lum(out[4]!, out[8]!, out[12]!)).toBeCloseTo(lum(src[o]!, src[o + 4]!, src[o + 8]!), 4);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('a probe no sun reaches reads the sun keys as zero without NaN', () => {
    const src = new Float32Array(probes * parts * PART_FLOATS);
    const light = store(src);
    const coeffs = new Float32Array(parts * 3).fill(2);
    const out = combineVolume(probes, new Float32Array(probes * FLOATS_PER_PROBE), light, parts, coeffs, new Float32Array(probes * FLOATS_PER_PROBE));
    expect(out.every((v) => v === 0)).toBe(true);
  });
});

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
    const data = bakeVolume(input(twoRooms(), g, { rays: 48, passes: 3 }));
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
