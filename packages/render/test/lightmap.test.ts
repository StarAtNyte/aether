import { describe, expect, it } from 'vitest';
import { LightVolumeBaker, TraceScene, partsField, planVolumeGrid, type V3 } from '../src/environment/light-volume';
import { LAYER_CHROMA, LAYER_LAMP, LAYER_SUN0, LUM, lightmapLayers, partCount, relightCoefficients, scaleCount, type RelightLighting } from '../src/environment/relight';
import {
  CHART_PAD,
  LightmapBaker,
  LOG_STOPS,
  decodePart,
  decodeTexel,
  encodePart,
  decodeVis,
  encodeVis,
  dequantizeUv,
  meshTriangleCount,
  planLightmap,
  quantizeUv,
  rasterizeTexels,
  unwrapLightmap,
  type LightmapBakeInput,
  type LightmapMesh,
  type LightmapResult,
} from '../src/environment/lightmap';

type Q = [V3, V3, V3, V3];

function box(out: number[], lo: V3, hi: V3): void {
  const [x0, y0, z0] = lo;
  const [x1, y1, z1] = hi;
  const q = (a: number[], b: number[], c: number[], d: number[]): void => {
    out.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
  q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
  q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
  q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
  q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
}

/** The 6 × 3 × 6 m room of the volume tests: the solid shell for tracing and the room-side surfaces as lightmap meshes. */
function room(window: boolean): { scene: TraceScene; meshes: LightmapMesh[] } {
  const t: number[] = [];
  box(t, [-3.2, -0.2, -3.2], [3.2, 0, 3.2]);
  box(t, [-3.2, 3, -3.2], [3.2, 3.2, 3.2]);
  box(t, [-3.2, 0, -3.2], [3.2, 3, -3]);
  box(t, [-3.2, 0, 3], [3.2, 3, 3.2]);
  box(t, [-3.2, 0, -3], [-3, 3, 3]);
  if (window) {
    box(t, [3, 0, -3], [3.2, 3, -1]);
    box(t, [3, 0, 1], [3.2, 3, 3]);
    box(t, [3, 0, -1], [3.2, 0.8, 1]);
    box(t, [3, 2.4, -1], [3.2, 3, 1]);
  } else box(t, [3, 0, -3], [3.2, 3, 3]);
  const positions = Float32Array.from(t);
  const scene = new TraceScene({ positions, albedo: new Float32Array((positions.length / 9) * 3).fill(0.7) });
  const quad = (a: V3, b: V3, c: V3, d: V3, n: V3): LightmapMesh => ({
    positions: Float32Array.from([...a, ...b, ...c, ...d]),
    normals: Float32Array.from([...n, ...n, ...n, ...n]),
    index: Uint32Array.from([0, 1, 2, 0, 2, 3]),
  });
  const q: Array<[Q, V3]> = [
    [[[-3, 0, 3], [3, 0, 3], [3, 0, -3], [-3, 0, -3]], [0, 1, 0]],
    [[[-3, 3, -3], [3, 3, -3], [3, 3, 3], [-3, 3, 3]], [0, -1, 0]],
    [[[-3, 0, -3], [3, 0, -3], [3, 3, -3], [-3, 3, -3]], [0, 0, 1]],
    [[[3, 0, 3], [-3, 0, 3], [-3, 3, 3], [3, 3, 3]], [0, 0, -1]],
    [[[-3, 0, 3], [-3, 0, -3], [-3, 3, -3], [-3, 3, 3]], [1, 0, 0]],
  ];
  const meshes = q.map(([c, n]) => quad(c[0], c[1], c[2], c[3], n));
  return { scene, meshes };
}

const SUN = { direction: (() => { const l = Math.hypot(0.6, 0.5); return [0.6 / l, 0.5 / l, 0] as V3; })(), irradiance: [3, 2.9, 2.7] as V3 };
const unit = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
/** A few keys (the default 15 would make every bake slow): the test sun, a mirrored one, one overhead, one from the side. */
const KEYS: V3[] = [SUN.direction, unit([-0.6, 0.5, 0]), [0, 1, 0], unit([0.3, 0.3, 0.9])];
const LIGHT: RelightLighting = { sun: SUN, ambient: { a: [0.5, 0.55, 0.6], b: [0.2, 0.25, 0.35] }, lampScale: 1 };
const GROUND = { y: -0.2, albedo: [0.25, 0.3, 0.2] as V3 };

function volumeFor(scene: TraceScene) {
  const grid = planVolumeGrid([-3.2, -0.2, -3.2], [3.2, 3.2, 3.2], 0.6)!;
  const baker = new LightVolumeBaker({ grid, scene, sunKeys: KEYS, ground: GROUND, lamps: [], rays: 32, passes: 2 });
  baker.run();
  return { grid, ...partsField(baker.probes, baker.data, baker.light, baker.parts) };
}

function bakeInput(window: boolean, samples = 24, maxSize = 256): { input: LightmapBakeInput; meshes: LightmapMesh[] } {
  const { scene, meshes } = room(window);
  const layout = unwrapLightmap(meshes, maxSize)!;
  const v = volumeFor(scene);
  return { meshes, input: { scene, proxies: [], meshes, layout, grid: v.grid, field: v.field, stride: v.stride, codes: v.codes, sunKeys: KEYS, ground: GROUND, lamps: [], samples } };
}

/** Mean decoded bounce (red) of the covered texels, parts weighted by the coefficients of `light`. */
function meanBounce(r: LightmapResult, light: RelightLighting): number {
  const coeffs = relightCoefficients(KEYS, light);
  let s = 0, n = 0;
  for (let y = 0; y < r.size; y++) for (let x = 0; x < r.size; x++) {
    const t = decodeTexel(r, x, y);
    if (!t) continue;
    n++;
    t.parts.forEach((v, p) => (s += coeffs[p * 3]! * v[0]));
  }
  return s / n;
}

describe('lightmap visibility byte', () => {
  it('keeps a covered texel away from the no-data value, also after a lossy image moves it a few steps', () => {
    expect(encodeVis(0)).toBeGreaterThanOrEqual(16);
    expect(encodeVis(1)).toBe(255);
    for (const v of [0, 0.004, 0.02, 0.5, 1]) expect(Math.abs(decodeVis(encodeVis(v)) - v)).toBeLessThan(0.005);
    expect(encodeVis(0) - 5).toBeGreaterThan(8);
  });
});

describe('lightmap: plan', () => {
  it('maps a quality to an atlas edge and a ray count, with a clamped override', () => {
    expect(planLightmap('low')).toMatchObject({ size: 256, samples: 24, density: 10 });
    expect(planLightmap('high')).toMatchObject({ size: 1024, samples: 96, density: 32 });
    expect(planLightmap('medium', 5000).samples).toBe(1024);
    expect(planLightmap('medium', 1).samples).toBe(8);
    expect(planLightmap('medium', Number.NaN).samples).toBe(48);
  });
});

describe('lightmap: unwrap', () => {
  it('gives every face of a room its own chart inside the atlas, with padding, and shrinks the atlas to need', () => {
    const { meshes } = room(false);
    const layout = unwrapLightmap(meshes, 1024, 20)!;
    expect(layout).not.toBeNull();
    expect(layout.charts).toBe(5);
    expect([256, 512, 1024]).toContain(layout.size);
    expect(layout.size).toBeLessThan(1024);
    expect(layout.density).toBeLessThanOrEqual(20);
    for (const uv of layout.uv) {
      expect(uv).not.toBeNull();
      for (const v of uv!) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    // Every triangle covers real area in texels.
    for (const uv of layout.uv) {
      for (let t = 0; t < uv!.length / 6; t++) {
        const S = layout.size;
        const a = (uv![t * 6 + 2]! - uv![t * 6]!) * S * ((uv![t * 6 + 5]! - uv![t * 6 + 1]!) * S) - (uv![t * 6 + 4]! - uv![t * 6]!) * S * ((uv![t * 6 + 3]! - uv![t * 6 + 1]!) * S);
        expect(Math.abs(a)).toBeGreaterThan(1);
      }
    }
  });

  it('never lets two charts overlap and keeps the empty texel free', () => {
    const { meshes } = room(true);
    const layout = unwrapLightmap(meshes, 256)!;
    const tex = rasterizeTexels(meshes, layout);
    // Rasterising the faces one at a time must cover exactly as many texels as the whole.
    let sum = 0;
    for (let i = 0; i < meshes.length; i++) {
      const only = meshes.map((_, k) => (k === i ? meshes[k]! : { positions: new Float32Array(0), normals: new Float32Array(0), index: new Uint32Array(0) }));
      const l2 = { ...layout, uv: layout.uv.map((u, k) => (k === i ? u : null)) };
      sum += rasterizeTexels(only, l2).covered;
    }
    expect(sum).toBe(tex.covered);
    expect(tex.cov[0]).toBe(0);
    expect(tex.covered).toBeGreaterThan(100);
  });

  it('drops the largest mesh when the surfaces cannot fit at a usable density', () => {
    const big: LightmapMesh = { positions: Float32Array.from([0, 0, 0, 400, 0, 0, 400, 0, 400, 0, 0, 400]), normals: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), index: Uint32Array.from([0, 3, 2, 0, 2, 1]) };
    const small: LightmapMesh = { positions: Float32Array.from([0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1]), normals: big.normals, index: Uint32Array.from([0, 3, 2, 0, 2, 1]) };
    // 400 m × 400 m at 4 texels/m needs 1600² texels: it cannot fit 256².
    const layout = unwrapLightmap([big, small], 256)!;
    expect(layout).not.toBeNull();
    expect(layout.uv[0]).toBeNull();
    expect(layout.uv[1]).not.toBeNull();
  });

  it('round-trips the stored 16-bit coordinates within a fraction of a texel', () => {
    const { meshes } = room(false);
    const layout = unwrapLightmap(meshes, 256)!;
    const uv = layout.uv[0]!;
    const back = dequantizeUv(quantizeUv(uv));
    for (let i = 0; i < uv.length; i++) expect(Math.abs(back[i]! - uv[i]!) * layout.size).toBeLessThan(0.05);
    expect(meshTriangleCount(meshes[0]!)).toBe(2);
    expect(CHART_PAD).toBeGreaterThanOrEqual(2);
  });
});

let memo: LightmapResult | null = null;
/** One shared bake of the windowed room for the tests that only read the result. */
function litWindow(): LightmapResult {
  return (memo ??= new LightmapBaker(bakeInput(true, 12).input).run());
}

describe('lightmap: bake', () => {
  it('is deterministic and does not depend on how the work is sliced', () => {
    const { input } = bakeInput(true, 12);
    const whole = new LightmapBaker(input).run();
    const b = new LightmapBaker(input);
    let t = 0;
    while (!b.step(1, () => (t += 0.4))) {
      /* slices */
    }
    expect(Array.from(b.output!.rgba)).toEqual(Array.from(whole.rgba));
    expect(Array.from(b.output!.scales)).toEqual(Array.from(whole.scales));
    expect(whole.rays).toBeGreaterThan(0);
    expect(b.progress).toBe(1);
  });

  it('a bake split into shares keeps only its own texels and finishes close to the whole bake', () => {
    const { input } = bakeInput(true, 12);
    const whole = new LightmapBaker(input).run();
    const count = 3;
    const shares = Array.from({ length: count }, (_, index) => {
      const b = new LightmapBaker({ ...input, split: { index, count } });
      b.run();
      return b.gathered();
    });
    const covered = shares.reduce((n, s) => n + s.vis.length, 0);
    expect(covered).toBe(whole.texels);
    expect(shares[0]!.bounce.length).toBe(shares[0]!.vis.length * partCount(KEYS.length) * 3);
    const split = new LightmapBaker(input).finishFrom(shares);
    let diff = 0;
    for (let i = 0; i < whole.rgba.length; i++) diff += Math.abs((whole.rgba[i] as number) - (split.rgba[i] as number));
    expect(diff / whole.rgba.length).toBeLessThan(3);
    expect(split.texels).toBe(whole.texels);
  });

  it('darkens the sky visibility of a floor deep in the room and corners, and lights it under the window', () => {
    const { input } = bakeInput(true, 32);
    const out = new LightmapBaker(input).run();
    const S = out.size;
    const tex = rasterizeTexels(input.meshes, input.layout);
    const at = (px: number, py: number, pz: number, ny: number): { vis: number } => {
      // The covered floor/ceiling texel closest to a point.
      let best = -1;
      let bd = Infinity;
      for (let o = 0; o < S * S; o++) {
        if (tex.cov[o] !== 1 || Math.sign(tex.nrm[o * 3 + 1]!) !== Math.sign(ny) || Math.abs(tex.nrm[o * 3 + 1]!) < 0.9) continue;
        const d = (tex.pos[o * 3]! - px) ** 2 + (tex.pos[o * 3 + 1]! - py) ** 2 + (tex.pos[o * 3 + 2]! - pz) ** 2;
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      return decodeTexel(out, best % S, Math.floor(best / S))!;
    };
    const nearWindow = at(2.4, 0, 0, 1).vis;
    const farCorner = at(-2.9, 0, -2.9, 1).vis;
    expect(nearWindow).toBeGreaterThan(farCorner);
    expect(farCorner).toBeLessThan(0.55);
    // Every covered texel carries data; empty texels none.
    for (let o = 0; o < S * S; o++) {
      if (tex.cov[o] === 0) expect(out.rgba[o * 4 + 3]).toBe(0);
      else expect(out.rgba[o * 4 + 3]).toBeGreaterThan(0);
    }
  });

  it('sees no sky in a sealed room and finds sun bounce only when the sun comes in', () => {
    const sealed = new LightmapBaker(bakeInput(false, 16).input).run();
    const lit = new LightmapBaker(bakeInput(true, 16).input).run();
    const meanVis = (r: LightmapResult): number => {
      let s = 0, n = 0;
      for (let o = 0; o < r.size * r.size; o++) {
        const a = r.rgba[o * 4 + 3]!;
        if (!a) continue;
        n++;
        s += decodeVis(a);
      }
      return s / n;
    };
    expect(meanVis(sealed)).toBeLessThan(0.05);
    expect(meanVis(lit)).toBeGreaterThan(meanVis(sealed) + 0.005);
    expect(meanBounce(lit, LIGHT)).toBeGreaterThan(meanBounce(sealed, LIGHT));
  });

  it('stores the layers, the same visibility in every layer, and decodes within the quantisation', () => {
    const out = litWindow();
    const S = out.size;
    const L = lightmapLayers(KEYS.length);
    expect(out.keys).toBe(KEYS.length);
    expect(out.layers).toBe(L);
    expect(out.rgba.length).toBe(L * S * S * 4);
    expect(out.scales.length).toBe(scaleCount(KEYS.length));
    expect(out.scales[LAYER_CHROMA]).toBe(1);
    const layer = S * S * 4;
    let covered = 0;
    for (let o = 0; o < S * S; o++) {
      const a = out.rgba[o * 4 + 3]!;
      for (let p = 1; p < L; p++) expect(out.rgba[p * layer + o * 4 + 3]).toBe(a);
      if (a) covered++;
    }
    // Padding around the charts carries data too, so the covered texels are at least the charts'.
    expect(covered).toBeGreaterThanOrEqual(out.texels);
    // An empty texel decodes to null; a covered one to every part.
    const empty = out.rgba.findIndex((_v, i) => i % 4 === 3 && i < layer && out.rgba[i] === 0);
    expect(empty).toBeGreaterThanOrEqual(0);
    expect(decodeTexel(out, (empty >> 2) % S, Math.floor(empty / 4 / S))).toBeNull();
    const full = out.rgba.findIndex((_v, i) => i % 4 === 3 && i < layer && out.rgba[i] !== 0);
    expect(decodeTexel(out, (full >> 2) % S, Math.floor(full / 4 / S))!.parts).toHaveLength(partCount(KEYS.length));
    // Scales are the maxima: some key is lit, the lamp layer is empty (no lamps).
    expect(Math.max(...Array.from(out.scales).slice(LAYER_CHROMA + 1))).toBeGreaterThan(0);
    for (let o = 0; o < S * S; o++) for (let c = 0; c < 3; c++) expect(out.rgba[LAYER_LAMP * layer + o * 4 + c]).toBe(0);
  });

  it('log-codes unsigned values with under 2.5 % error over 1..2^-15, and signed ones with a sqrt code', () => {
    expect(LOG_STOPS).toBe(16);
    expect(encodePart(0, false)).toBe(0);
    expect(encodePart(1, false)).toBe(255);
    expect(decodePart(0, false)).toBe(0);
    for (let e = 0; e >= -15; e -= 0.25) {
      const v = 2 ** e;
      const back = decodePart(encodePart(v, false), false);
      expect(Math.abs(back - v) / v).toBeLessThan(0.025);
    }
    // Below the range it is black, above it clips.
    expect(encodePart(2 ** -17, false)).toBe(0);
    expect(encodePart(5, false)).toBe(255);
    for (const v of [0.01, 0.1, 0.5, 1]) for (const sv of [v, -v]) expect(Math.abs(decodePart(encodePart(sv, true), true) - sv)).toBeLessThan(0.02);
    expect(encodePart(0, true)).toBe(128);
  });

  it('luminance plus chroma reconstruct each key as the stored luminance in the stored colour', () => {
    const out = litWindow();
    const S = out.size;
    const N = S * S;
    let checked = 0;
    for (let o = 0; o < N && checked < 400; o++) {
      if (!out.rgba[o * 4 + 3]) continue;
      const t = decodeTexel(out, o % S, Math.floor(o / S))!;
      const ch = [0, 1, 2].map((c) => out.rgba[LAYER_CHROMA * N * 4 + o * 4 + c]! / 255);
      const cl = LUM[0] * ch[0]! + LUM[1] * ch[1]! + LUM[2] * ch[2]!;
      for (let k = 0; k < KEYS.length; k++) {
        const l = decodePart(out.rgba[(LAYER_SUN0 + Math.floor(k / 3)) * N * 4 + o * 4 + (k % 3)]!, false) * out.scales[LAYER_SUN0 + k]!;
        const rgb = t.parts[3 + k]!;
        if (cl > 0) {
          expect(LUM[0] * rgb[0] + LUM[1] * rgb[1] + LUM[2] * rgb[2]).toBeCloseTo(l, 4);
          for (let c = 0; c < 3; c++) expect(rgb[c]).toBeCloseTo((l * ch[c]!) / cl, 4);
        }
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('the summed parts follow the coefficients: twice the sun irradiance is more bounce, no light is none', () => {
    const out = litWindow();
    const dark: RelightLighting = { sun: null, ambient: { a: [0, 0, 0], b: [0, 0, 0] }, lampScale: 0 };
    const one = meanBounce(out, { ...dark, sun: { direction: SUN.direction, irradiance: [1, 1, 1] } });
    const two = meanBounce(out, { ...dark, sun: { direction: SUN.direction, irradiance: [2, 2, 2] } });
    expect(one).toBeGreaterThan(0);
    expect(two).toBeCloseTo(one * 2, 6);
    expect(meanBounce(out, dark)).toBe(0);
    // Sun plus lamps equals the sum of each alone.
    const sunOnly = meanBounce(out, { ...dark, sun: { direction: SUN.direction, irradiance: [1, 1, 1] } });
    const skyOnly = meanBounce(out, { ...dark, ambient: { a: [1, 1, 1], b: [0, 0, 0] } });
    const both = meanBounce(out, { ...dark, sun: { direction: SUN.direction, irradiance: [1, 1, 1] }, ambient: { a: [1, 1, 1], b: [0, 0, 0] } });
    expect(both).toBeCloseTo(sunOnly + skyOnly, 6);
  });

  it('smooths noise: neighbouring sky-visibility texels of a lit ceiling differ by little', () => {
    const { input } = bakeInput(true, 16, 512);
    const out = new LightmapBaker(input).run();
    const S = out.size;
    const tex = rasterizeTexels(input.meshes, input.layout);
    const diffs: number[] = [];
    for (let o = 0; o < S * S - 1; o++) {
      if (tex.cov[o] !== 1 || tex.cov[o + 1] !== 1) continue;
      diffs.push(Math.abs(out.rgba[o * 4 + 3]! - out.rgba[(o + 1) * 4 + 3]!));
    }
    diffs.sort((p, q) => p - q);
    expect(diffs.length).toBeGreaterThan(100);
    // Raw 16-ray estimates differ by tens of codes; the filtered ones almost never by more than a few.
    expect(diffs[Math.floor(diffs.length * 0.95)]!).toBeLessThan(10);
  });
});
