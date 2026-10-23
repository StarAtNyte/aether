import { describe, expect, it } from 'vitest';
import { LightVolumeBaker, TraceScene, planVolumeGrid, type V3 } from '../src/environment/light-volume';
import {
  CHART_PAD,
  LightmapBaker,
  decodeTexel,
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

function volumeFor(scene: TraceScene) {
  const grid = planVolumeGrid([-3.2, -0.2, -3.2], [3.2, 3.2, 3.2], 0.6)!;
  const base = { grid, scene, sun: SUN, ambient: { a: [0.5, 0.55, 0.6] as V3, b: [0.2, 0.25, 0.35] as V3 }, ground: { y: -0.2, albedo: [0.25, 0.3, 0.2] as V3 }, lamps: [], rays: 32, passes: 2 };
  return { grid, data: new LightVolumeBaker(base).run(), base };
}

function bakeInput(window: boolean, samples = 24, maxSize = 256): { input: LightmapBakeInput; meshes: LightmapMesh[] } {
  const { scene, meshes } = room(window);
  const layout = unwrapLightmap(meshes, maxSize)!;
  const v = volumeFor(scene);
  return { meshes, input: { scene, proxies: [], meshes, layout, grid: v.grid, volume: v.data, sun: SUN, ambient: v.base.ambient, ground: v.base.ground, lamps: [], samples } };
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
    expect(planLightmap('medium', 5000).samples).toBe(512);
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
    expect(b.output!.scale).toBe(whole.scale);
    expect(whole.rays).toBeGreaterThan(0);
    expect(b.progress).toBe(1);
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
      return decodeTexel(out.rgba, out.scale, best % S, Math.floor(best / S), S)!;
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

  it('sees no sky in a sealed room and finds sun bounce on the ceiling only when the sun comes in', () => {
    const sealed = new LightmapBaker(bakeInput(false, 16).input).run();
    const lit = new LightmapBaker(bakeInput(true, 16).input).run();
    const mean = (r: { rgba: Uint8Array; scale: number }, ch: 'vis' | 'b'): number => {
      let s = 0;
      let n = 0;
      for (let o = 0; o < r.rgba.length / 4; o++) {
        if (!r.rgba[o * 4 + 3]) continue;
        n++;
        s += ch === 'vis' ? decodeVis(r.rgba[o * 4 + 3]!) : ((r.rgba[o * 4]! / 255) ** 2 * r.scale);
      }
      return s / n;
    };
    expect(mean(sealed, 'vis')).toBeLessThan(0.05);
    expect(mean(lit, 'vis')).toBeGreaterThan(mean(sealed, 'vis') + 0.005);
    expect(mean(lit, 'b')).toBeGreaterThan(mean(sealed, 'b'));
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
