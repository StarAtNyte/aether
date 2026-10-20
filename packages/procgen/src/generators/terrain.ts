/**
 * Terrain generators (terrain, island, mountain): fbm/ridged heightfields with
 * height- and slope-based vertex colors and exact heightfield colliders.
 * Output meshes are centered in x/z with their lowest point at y = 0.
 */
import { canyonHalfWidth, canyonMeander, riverHalfWidth, riverMeander, streamCourse } from '@aether/core';
import type { InternalApi } from '../api';
import type { GeneratorOutput } from '../types';
import { mixLinear, type RGB } from '../color';
import { Mesh } from '../kernel/mesh';
import { defineGenerator, lin, MAT, pColor, pInt, pNum, pVariant, shade } from './kit';

interface TerrainPalette {
  sand: RGB;
  grass: RGB;
  grassDark: RGB;
  rock: RGB;
  snow: RGB;
}

interface TerrainShape {
  size: number;
  resolution: number;
  /** When set, heights are rescaled so the total relief equals this many meters. */
  fitHeight?: number;
  /**
   * Leave out the flat border at the lowest height from the render mesh (the
   * collider keeps it). A peak standing on a world ground plane then has no
   * square plate z-fighting with — and differently colored than — the ground.
   */
  trimFlat?: boolean;
  /** Raw height in meters at (x, z). */
  height(x: number, z: number): number;
  /** Strength of the meadow colour variation (default 1; 0 for none). */
  variation?: number;
  /**
   * Color for a vertex: t = normalized height (0 lowest … 1 highest),
   * h = height above the lowest point in meters, slope = 1 - normal.y.
   */
  color(t: number, h: number, slope: number, x: number, z: number, out: RGB): void;
  /**
   * Layer weights of a vertex (same inputs as `color`): grass, rock, dry ground (sand, soil, pebbles),
   * snow, written into `out` (they are normalised afterwards). Absent: plain vertex colours.
   */
  splat?(t: number, h: number, slope: number, x: number, z: number, out: Splat): void;
  /** A rectangle (x0, z0, x1, z1) left out of the render mesh (a pool basin sunk into the plot shows through it); the collider keeps it. */
  cut?: readonly [number, number, number, number];
}

/** Layer weights: grass, rock, dry ground, snow. */
type Splat = [number, number, number, number];

/** Wet pebbles and silt of a stream bed (linear RGB). */
const STREAM_BED: RGB = lin('#5e5646');

/** Normalized height removed from the bottom of a mountain (its foothill plate). */
const MOUNTAIN_BASE = 0.05;

/** Relative height (share of the relief) below which a trimmed border counts as flat. */
const FLAT_EPSILON = 0.002;

/**
 * Drop triangles whose three vertices all sit within `eps` of y = 0. The
 * vertices stay (bounds and the base-at-y=0 contract are unchanged); only
 * the index buffer shrinks.
 */
export function trimFlatTriangles(mesh: Mesh, eps: number): void {
  const pos = mesh.positions;
  const idx = mesh.indices;
  const out = new Uint32Array(idx.length);
  let n = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] as number;
    const b = idx[i + 1] as number;
    const c = idx[i + 2] as number;
    if ((pos[a * 3 + 1] as number) <= eps && (pos[b * 3 + 1] as number) <= eps && (pos[c * 3 + 1] as number) <= eps) continue;
    out[n++] = a;
    out[n++] = b;
    out[n++] = c;
  }
  // Never trim everything (a degenerate, completely flat input keeps its plate).
  if (n > 0 && n < idx.length) mesh.indices = out.slice(0, n);
}

/** Drop the triangles whose centre lies inside the rectangle (x0, z0, x1, z1). */
function cutRect(mesh: Mesh, [x0, z0, x1, z1]: readonly [number, number, number, number]): void {
  if (!(x1 > x0 && z1 > z0)) return;
  const pos = mesh.positions;
  const idx = mesh.indices;
  const out = new Uint32Array(idx.length);
  let n = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] as number;
    const b = idx[i + 1] as number;
    const c = idx[i + 2] as number;
    const x = ((pos[a * 3] as number) + (pos[b * 3] as number) + (pos[c * 3] as number)) / 3;
    const z = ((pos[a * 3 + 2] as number) + (pos[b * 3 + 2] as number) + (pos[c * 3 + 2] as number)) / 3;
    if (x > x0 && x < x1 && z > z0 && z < z1) continue;
    out[n++] = a;
    out[n++] = b;
    out[n++] = c;
  }
  if (n > 0 && n < idx.length) mesh.indices = out.slice(0, n);
}

/** Shared heightfield pipeline: sample, mesh, paint, heightfield collider. */
function buildTerrain(api: InternalApi, shape: TerrainShape): GeneratorOutput {
  const res = shape.resolution;
  const size = shape.size;
  const n = res + 1;
  const raw = new Float64Array(n * n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const h = shape.height(-size / 2 + (ix * size) / res, -size / 2 + (iz * size) / res);
      const v = Number.isFinite(h) ? h : 0;
      raw[iz * n + ix] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const natural = Math.max(1e-6, hi - lo);
  const scale = shape.fitHeight !== undefined ? shape.fitHeight / natural : 1;
  const range = Math.max(0.01, natural * scale);
  for (let i = 0; i < raw.length; i++) raw[i] = ((raw[i] as number) - lo) * scale;
  const mesh = api.grid(res, res, size, size, raw);
  // Meadow variation: broad dry and lush patches and a finer mottling over the palette, so a lawn never reads as one flat colour.
  const vary = shape.variation ?? 1;
  const noise = api.noise;
  mesh.paintFn((x, y, z, _nx, ny, _nz, out) => {
    shape.color(y / range, y, 1 - ny, x, z, out);
    if (vary <= 0) return;
    const broad = noise.fbm2(x * 0.03 + 7.1, z * 0.03 - 3.3, 3);
    const fine = noise.noise2(x * 0.24, z * 0.24);
    const k = vary * (ny > 0.7 ? 1 : 0.4);
    out[0] *= 1 + k * (0.3 * broad + 0.09 * fine);
    out[1] *= 1 + k * (0.12 * broad + 0.08 * fine);
    out[2] *= 1 - k * (0.26 * broad - 0.05 * fine);
    // Hillside character: sun-bleached straw patches on the broad swells, darker lush clover in the hollows, and a
    // mid-scale mottle, so a slope shows several greens instead of one.
    const patchy = noise.fbm2(x * 0.011 + 31.7, z * 0.011 - 17.2, 2);
    const mid = noise.fbm2(x * 0.085 - 5.5, z * 0.085 + 9.1, 2);
    const straw = Math.min(1, Math.max(0, (patchy - 0.02) / 0.3)) * k;
    out[0] *= 1 + 0.5 * straw;
    out[1] *= 1 + 0.06 * straw;
    out[2] *= 1 - 0.5 * straw;
    const lush = Math.min(1, Math.max(0, (-patchy - 0.05) / 0.3)) * k;
    out[0] *= 1 - 0.22 * lush;
    out[1] *= 1 - 0.08 * lush;
    out[2] *= 1 - 0.12 * lush;
    const m = 1 + k * 0.22 * mid;
    out[0] *= m;
    out[1] *= 1 + k * 0.14 * mid;
    out[2] *= m;
  });
  const layer = shape.splat;
  if (layer && mesh instanceof Mesh) {
    const pos = mesh.positions;
    const nrm = mesh.normals;
    const nv = pos.length / 3;
    const sp = new Float32Array(nv * 4);
    const w: Splat = [1, 0, 0, 0];
    for (let i = 0; i < nv; i++) {
      const y = pos[i * 3 + 1] as number;
      w[0] = 1;
      w[1] = 0;
      w[2] = 0;
      w[3] = 0;
      layer(y / range, y, 1 - (nrm[i * 3 + 1] as number), pos[i * 3] as number, pos[i * 3 + 2] as number, w);
      const sum = Math.max(1e-6, w[0] + w[1] + w[2] + w[3]);
      for (let k = 0; k < 4; k++) sp[i * 4 + k] = Math.max(0, w[k] as number) / sum;
    }
    mesh.splat = sp;
  }
  if (shape.trimFlat === true && mesh instanceof Mesh) trimFlatTriangles(mesh, range * FLAT_EPSILON);
  if (shape.cut && mesh instanceof Mesh) cutRect(mesh, shape.cut);
  api.add(mesh, layer ? MAT.terrain : MAT.ground);
  const heights = new Float32Array(n * n);
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) heights[ix * n + iz] = (raw[iz * n + ix] as number) / range;
  }
  api.collider({ kind: 'heightfield', rows: res, cols: res, heights, size: [size, range, size] });
  return api.build({ recenter: false });
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function palette(grass: string): TerrainPalette {
  return {
    sand: lin('#d9c690'),
    grass: lin(grass),
    grassDark: lin(shade(grass, -0.3)),
    rock: lin('#7f766a'),
    snow: lin('#f2f5f8'),
  };
}

const terrain = defineGenerator({
  id: 'terrain',
  description: 'Rolling landscape heightfield (fbm noise) with sand, grass, rock and snow coloring by height and slope. Exact heightfield collider.',
  category: 'terrain',
  params: {
    size: pNum(60, 10, 1000, 'width and depth in meters'),
    height: pNum(6, 0, 200, 'max elevation difference in meters'),
    resolution: pInt(128, 16, 384, 'grid cells per side (detail)'),
    roughness: pNum(0.5, 0, 1, '0 smooth hills … 1 rugged'),
    color: pColor('#5a8f3c', 'grass color'),
    variant: pVariant(5, '0 hills, 1 plateaus (terraced), 2 valley, 3 canyon (flat floor at y = 0 along Z, stratified walls), 4 river valley (meandering riverbed at y = 0 along Z between soft grassy banks), 5 estate (a level plot for a house, meadow swells and a ring of hills; optional lake basin)'),
    padRadius: pNum(20, 0, 200, 'estate (variant 5): radius of the level plot in meters'),
    padX: pNum(0, -500, 500, 'estate: plot centre x'),
    padZ: pNum(0, -500, 500, 'estate: plot centre z'),
    lakeRadius: pNum(0, 0, 300, 'estate: lake basin radius in meters (0 = no lake)'),
    lakeX: pNum(0, -500, 500, 'estate: lake centre x'),
    lakeZ: pNum(0, -500, 500, 'estate: lake centre z'),
    lakeDepth: pNum(2.5, 0.2, 30, 'estate: lake depth below the shore in meters'),
    laneX: pNum(0, -500, 500, 'estate: far end x of a level lane (a drive) running from the plot centre'),
    laneZ: pNum(0, -500, 500, 'estate: far end z of the lane'),
    laneRadius: pNum(0, 0, 60, 'estate: half width of the level lane in meters (0 = none)'),
    cutX0: pNum(0, -500, 500, 'estate: a rectangle left open in the ground (x0, z0 to x1, z1) for a sunk pool; 0 size = none'),
    cutZ0: pNum(0, -500, 500, 'estate: cut z0'),
    cutX1: pNum(0, -500, 500, 'estate: cut x1'),
    cutZ1: pNum(0, -500, 500, 'estate: cut z1'),
    streamHalf: pNum(0, 0, 30, 'estate: half width of a stream carved across the land along X in meters (0 = none); its centre line is streamCourse(x, streamZ, streamBend) in @aether/core'),
    streamZ: pNum(0, -500, 500, 'estate: mean z of the stream'),
    streamBend: pNum(5, 0, 60, 'estate: amplitude of the stream bends in meters'),
    streamDepth: pNum(1.4, 0.3, 8, 'estate: depth of the stream bed below the banks in meters'),
    snowCover: pNum(0, 0, 1, 'estate: snow lying on the land (0 none, 1 all but the steepest rock)'),
  },
  run(p, api) {
    const size = p.num('size');
    const H = p.num('height');
    const rough = p.num('roughness');
    const variant = p.int('variant');
    if (variant === 3) return canyonTerrain(api, size, H, rough, p.int('resolution'), p.color('color'));
    if (variant === 4) return riverValley(api, size, H, rough, p.int('resolution'), p.color('color'));
    if (variant === 5) {
      return estateTerrain(api, size, H, rough, p.int('resolution'), p.color('color'), {
        pad: [p.num('padX'), p.num('padZ'), p.num('padRadius')],
        lake: [p.num('lakeX'), p.num('lakeZ'), p.num('lakeRadius'), p.num('lakeDepth')],
        lane: [p.num('laneX'), p.num('laneZ'), p.num('laneRadius')],
        cut: [p.num('cutX0'), p.num('cutZ0'), p.num('cutX1'), p.num('cutZ1')],
        stream: [p.num('streamHalf'), p.num('streamZ'), p.num('streamBend'), p.num('streamDepth')],
        snow: p.num('snowCover'),
      });
    }
    const freq = 2.2 / size;
    const oct = 3 + Math.round(rough * 3);
    const pal = palette(p.color('color'));
    const n = api.noise;
    return buildTerrain(api, {
      size,
      resolution: p.int('resolution'),
      fitHeight: H,
      height(x, z) {
        let v = 0.5 + 0.5 * n.fbm2(x * freq, z * freq, oct);
        v = v * (1 - rough * 0.35) + rough * 0.35 * n.ridged2(x * freq * 1.7, z * freq * 1.7, 4);
        if (variant === 1) v = Math.round(v * 5) / 5 + (v * 5 - Math.round(v * 5)) * 0.06;
        if (variant === 2) v *= 0.35 + 0.65 * Math.min(1, Math.abs(x) / (size * 0.35));
        return v * H;
      },
      color(t, _h, slope, x, z, out) {
        const w = 0.06 * n.noise2(x * 0.3, z * 0.3);
        mixLinear(pal.grassDark, pal.grass, smoothstep(0.1, 0.55, t + w), out);
        mixLinear(pal.sand, out, smoothstep(0.03, 0.1, t + w * 0.5), out);
        mixLinear(out, pal.rock, Math.max(smoothstep(0.28, 0.5, slope + w), smoothstep(0.72, 0.85, t)), out);
        if (H > 12) mixLinear(out, pal.snow, smoothstep(0.86, 0.94, t + w) * (1 - smoothstep(0.45, 0.6, slope)), out);
      },
      splat(t, _h, slope, x, z, out) {
        const w = 0.06 * n.noise2(x * 0.3, z * 0.3);
        const snow = H > 12 ? smoothstep(0.86, 0.94, t + w) * (1 - smoothstep(0.45, 0.6, slope)) : 0;
        const rock = Math.max(smoothstep(0.28, 0.5, slope + w), smoothstep(0.72, 0.85, t)) * (1 - snow);
        const dry = (1 - smoothstep(0.03, 0.1, t + w * 0.5)) * (1 - snow) * (1 - rock);
        out[3] = snow;
        out[1] = rock;
        out[2] = dry;
        out[0] = Math.max(0, 1 - snow - rock - dry);
      },
    });
  },
});

/**
 * Canyon: a flat floor (exactly y = 0) running along Z, meandering a little,
 * with terraced sandstone walls rising to a rolling plateau.
 */
function canyonTerrain(api: InternalApi, size: number, H: number, rough: number, resolution: number, grass: string): GeneratorOutput {
  const n = api.noise;
  const freq = 2.2 / size;
  const floorHalf = canyonHalfWidth(size);
  const pal = palette(grass);
  const sandstone = lin('#b56a42');
  const pale = lin('#e0c49a');
  const deepRed = lin('#8f4529');
  const varnishTone = lin('#4a3328');
  const floorSand = lin('#d8bc8c');
  return buildTerrain(api, {
    size,
    resolution,
    fitHeight: H,
    height(x, z) {
      const meander = canyonMeander(z, size);
      const d = Math.abs(x - meander) - floorHalf - n.noise2(z * 0.02, 3.7) * size * 0.012;
      if (d <= 0) return 0;
      const wall = smoothstep(0, size * 0.09, d);
      // Strata: terraces with slightly sloped treads.
      const steps = 7;
      const t = wall * steps;
      const strata = (Math.floor(t) + smoothstep(0.35, 1, t - Math.floor(t) + 0.08 * n.noise2(x * 0.06, z * 0.06))) / steps;
      const plateau = 0.78 + 0.22 * (0.5 + 0.5 * n.fbm2(x * freq, z * freq, 3 + Math.round(rough * 3)));
      // Weathering: vertical gullies running down the face and crags of a few metres, so a wall is rock and not a smooth ramp of terraces.
      const gully = n.ridged2(x * 0.045, z * 0.014, 3) - 0.5;
      const crag = n.fbm2(x * 0.11, z * 0.11, 3);
      const weather = (gully * 0.05 + crag * 0.025) * wall * smoothstep(0.02, 0.2, wall);
      return Math.max(0, strata * plateau + weather) * H;
    },
    color(t, _h, slope, x, z, out) {
      const w = 0.05 * n.noise2(x * 0.2, z * 0.2);
      // Banded sandstone walls: deep red, orange and cream strata of uneven thickness, desert varnish (dark streaks running
      // down the steep faces), a grassy plateau and a dusty, pebbly floor.
      const band = 0.5 + 0.5 * Math.sin((t + w) * 38 + 2.2 * Math.sin((t + w) * 9.7));
      mixLinear(deepRed, sandstone, smoothstep(0.15, 0.55, band), out);
      mixLinear(out, pale, smoothstep(0.72, 0.95, band) * 0.85, out);
      const steep = smoothstep(0.35, 0.7, slope);
      if (steep > 0) {
        const streak = n.noise2((x + z) * 0.42, t * 3.1) * 0.6 + n.noise2((x - z) * 1.3, t * 9) * 0.4;
        const varnish = steep * Math.max(0, streak) * 0.75;
        mixLinear(out, varnishTone, varnish, out);
      }
      mixLinear(out, pal.grass, smoothstep(0.82, 0.9, t + w) * (1 - smoothstep(0.3, 0.5, slope)), out);
      if (t < 0.01) {
        mixLinear(floorSand, sandstone, 0.18 + w * 2, out);
        const grit = 0.92 + 0.16 * n.noise2(x * 0.9, z * 0.9);
        out[0] *= grit;
        out[1] *= grit;
        out[2] *= grit;
      }
    },
    splat(t, _h, slope, x, z, out) {
      const w = 0.05 * n.noise2(x * 0.2, z * 0.2);
      const grassTop = smoothstep(0.82, 0.9, t + w) * (1 - smoothstep(0.3, 0.5, slope));
      const floor = t < 0.01 ? 1 : 0;
      const wall = (1 - grassTop) * (1 - floor);
      out[0] = grassTop;
      out[1] = wall;
      out[2] = floor;
      out[3] = 0;
    },
  });
}

/**
 * Estate: a level plot (exactly one height inside `pad`) for a house and its garden, gentle meadow swells around it
 * and a bowl of hills that closes the horizon, with an optional lake basin. The plot's own height is `h(padX, padZ)`
 * (the lowest point of the mesh is at y = 0, so a lake sits below the plot): place the entity at `y = -h(padX, padZ)`.
 */
function estateTerrain(
  api: InternalApi,
  size: number,
  H: number,
  rough: number,
  resolution: number,
  grass: string,
  o: { pad: readonly [number, number, number]; lake: readonly [number, number, number, number]; lane: readonly [number, number, number]; cut?: readonly [number, number, number, number]; stream?: readonly [number, number, number, number]; snow?: number },
): GeneratorOutput {
  const n = api.noise;
  const freq = 2.2 / size;
  const pal = palette(grass);
  const oct = 3 + Math.round(rough * 3);
  const [px, pz, pr] = o.pad;
  const [lx, lz, lr, ld] = o.lake;
  const lane = o.lane;
  const [sh, sz, sb, sd] = o.stream ?? [0, 0, 0, 0];
  const snowCover = o.snow ?? 0;
  /** Snow lying at (x, z): everywhere but steep rock, thinning in drifts. */
  const snowAt = (slope: number, x: number, z: number, w: number): number => snowCover * (1 - smoothstep(0.42, 0.62, slope + w)) * (0.82 + 0.18 * n.noise2(x * 0.07, z * 0.07));
  const blend = Math.max(14, pr * 0.9);
  /** Depth (metres, >= 0) the stream cuts at (x, z): a flat bed, banks that ease out over 2.5 m plus a little noise. */
  const streamCut = (x: number, z: number): number => {
    if (sh <= 0) return 0;
    const d = Math.abs(z - streamCourse(x, sz, sb)) - sh * (1 + 0.12 * n.noise2(x * 0.05, 4.2));
    // Banks ease out over at least 3 m and never steeper than a walkable slope, however deep the bed.
    const bank = Math.max(3, sd * 2.4);
    if (d >= bank) return 0;
    if (d <= 0) return sd;
    return sd * (1 - smoothstep(0, bank, d));
  };
  return buildTerrain(api, {
    size,
    resolution,
    ...(o.cut ? { cut: o.cut } : {}),
    height(x, z) {
      const dTrue = Math.hypot(x - px, z - pz);
      let d = dTrue;
      if (lane[2] > 0) {
        // Distance to the lane's centre line (a segment from the plot centre), as if it were part of the plot.
        const sx = lane[0] - px;
        const sz = lane[1] - pz;
        const t = Math.min(1, Math.max(0, ((x - px) * sx + (z - pz) * sz) / Math.max(1e-6, sx * sx + sz * sz)));
        const dl = Math.hypot(x - (px + sx * t), z - (pz + sz * t));
        d = Math.min(dTrue, pr + Math.max(0, dl - lane[2]));
      }
      const swell = 0.5 + 0.5 * n.fbm2(x * freq * 1.3 + 4.1, z * freq * 1.3 - 8.7, oct);
      const ridge = n.ridged2(x * freq * 0.9 + 5, z * freq * 0.9 - 2, 4);
      const near = smoothstep(pr, pr + blend, d);
      const mid = smoothstep(pr + blend, size * 0.34, d);
      const far = smoothstep(size * 0.16, size * 0.5, dTrue);
      // Meadow swells (a metre or two) around the plot, rising hills towards the rim.
      let h = near * 0.025 * H * swell + mid * 0.16 * H * swell + far * far * H * (0.35 + 0.65 * ridge);
      if (lr > 0) {
        const dl = Math.hypot(x - lx, z - lz);
        const basin = 1 - smoothstep(lr * 0.55, lr * 1.2, dl);
        h = h * (1 - basin) - ld * Math.pow(basin, 1.4) + 0.12 * ld * basin * n.noise2(x * 0.2, z * 0.2);
      }
      const cut = streamCut(x, z);
      if (cut > 0) h -= cut + 0.08 * cut * n.noise2(x * 0.4, z * 0.4);
      return h;
    },
    color(t, h, slope, x, z, out) {
      const w = 0.05 * n.noise2(x * 0.25, z * 0.25);
      mixLinear(pal.grassDark, pal.grass, smoothstep(0.02, 0.5, t + w), out);
      mixLinear(out, pal.rock, smoothstep(0.3, 0.52, slope + w), out);
      if (lr > 0) mixLinear(pal.sand, out, smoothstep(ld - 1.3, ld - 0.4, h + w * 3), out);
      if (sh > 0) mixLinear(out, STREAM_BED, Math.min(1, streamCut(x, z) / Math.max(0.2, sd * 0.45)) * 0.9, out);
      if (snowCover > 0) mixLinear(out, pal.snow, snowAt(slope, x, z, w), out);
    },
    splat(_t, h, slope, x, z, out) {
      const w = 0.05 * n.noise2(x * 0.25, z * 0.25);
      const rock = smoothstep(0.3, 0.52, slope + w);
      const wet = Math.max(lr > 0 ? 1 - smoothstep(ld - 1.3, ld - 0.4, h + w * 3) : 0, sh > 0 ? Math.min(1, streamCut(x, z) / Math.max(0.2, sd * 0.45)) : 0);
      const snow = snowCover > 0 ? snowAt(slope, x, z, w) * (1 - wet) : 0;
      out[1] = rock * (1 - wet) * (1 - snow);
      out[2] = wet;
      out[3] = snow;
      out[0] = Math.max(0, 1 - out[1] - out[2] - out[3]);
    },
  });
}

/**
 * River valley: a meandering flat riverbed (exactly y = 0) along Z between
 * soft, grassy banks rising to rolling hills — the place for water planes,
 * boats and riverside paths (the curve is `riverMeander` in @aether/core).
 */
function riverValley(api: InternalApi, size: number, H: number, rough: number, resolution: number, grass: string): GeneratorOutput {
  const n = api.noise;
  const freq = 2.2 / size;
  const half = riverHalfWidth(size);
  const pal = palette(grass);
  const bed = lin('#8c7f66');
  const oct = 3 + Math.round(rough * 3);
  return buildTerrain(api, {
    size,
    resolution,
    fitHeight: H,
    height(x, z) {
      const d = Math.abs(x - riverMeander(z, size)) - half - n.noise2(z * 0.03, 1.9) * size * 0.006;
      if (d <= 0) return 0;
      // A flat, walkable floodplain beside the water (a few degrees, about 2 m above the bed on the 320 m valley), then the valley
      // walls: rolling hills that grow away from the floodplain, so camps, paths and trees have somewhere flat to stand.
      const bank = smoothstep(0, size * 0.1, d) * 0.05;
      // The waterline: the bed climbs 0.7 m within the first 5 m, so the water (0.38 m) has a clear edge and trees never stand in it.
      const lip = (smoothstep(0, 5, d) * 0.7) / H;
      const hills = smoothstep(size * 0.1, size * 0.4, d) * (0.45 + 0.55 * (0.5 + 0.5 * n.fbm2(x * freq, z * freq, oct)));
      return (bank + lip + hills * 0.82) * H;
    },
    color(t, h, slope, x, z, out) {
      const w = 0.05 * n.noise2(x * 0.25, z * 0.25);
      mixLinear(pal.grassDark, pal.grass, smoothstep(0.05, 0.6, t + w), out);
      mixLinear(out, pal.rock, smoothstep(0.32, 0.55, slope + w), out);
      // Wet pebbles on the riverbed and the first metre of bank.
      mixLinear(bed, out, smoothstep(0.2, 1.0, h + w * 2), out);
    },
    splat(_t, h, slope, x, z, out) {
      const w = 0.05 * n.noise2(x * 0.25, z * 0.25);
      const rock = smoothstep(0.32, 0.55, slope + w);
      const wet = 1 - smoothstep(0.2, 1.0, h + w * 2);
      out[1] = rock * (1 - wet);
      out[2] = wet;
      out[0] = Math.max(0, 1 - out[1] - out[2]);
      out[3] = 0;
    },
  });
}

const island = defineGenerator({
  id: 'island',
  description: 'Tropical island: radial falloff heightfield with sandy beach ring, grassy interior and rocky high ground. Lowest point (sea floor) at y = 0.',
  category: 'terrain',
  params: {
    size: pNum(30, 8, 500, 'diameter in meters'),
    height: pNum(4, 0.5, 80, 'peak height in meters'),
    resolution: pInt(96, 16, 256, 'grid cells per side'),
    beach: pNum(0.15, 0, 0.5, 'beach width as a fraction of the radius'),
    color: pColor('#6aa84f', 'grass color'),
    sandColor: pColor('#e3d39a', 'beach color'),
    variant: pVariant(2, '0 round, 1 elongated, 2 twin hills'),
  },
  run(p, api) {
    const size = p.num('size');
    const H = p.num('height');
    const beach = p.num('beach');
    const variant = p.int('variant');
    const R = size / 2;
    const n = api.noise;
    const sea = H * 0.12;
    const pal = palette(p.color('color'));
    const sand = lin(p.color('sandColor'));
    const wet = lin(shade(p.color('sandColor'), -0.25));
    return buildTerrain(api, {
      size,
      resolution: p.int('resolution'),
      height(x, z) {
        const dx = x / R;
        let dz = z / R;
        if (variant === 1) dz *= 1.6;
        let d = Math.hypot(dx, dz);
        if (variant === 2) d = Math.min(Math.hypot(dx - 0.3, dz), Math.hypot(dx + 0.35, dz + 0.1)) * 1.25;
        d += 0.15 * n.fbm2(x * 3 / size, z * 3 / size, 3);
        const fall = 1 - smoothstep(0.35, 0.92, d);
        const bumps = 0.75 + 0.35 * n.fbm2(x * 4 / size + 9, z * 4 / size - 3, 4);
        return sea + (H - sea) * Math.pow(fall, 1.4) * bumps - sea * smoothstep(0.85, 1.05, d);
      },
      color(t, h, slope, x, z, out) {
        const beachTop = sea + (H - sea) * beach * 0.6;
        const w = 0.05 * n.noise2(x * 0.5, z * 0.5);
        mixLinear(wet, sand, smoothstep(sea * 0.4, sea * 1.1, h), out);
        const g = smoothstep(beachTop, beachTop + H * 0.06, h + w * H);
        mixLinear(out, pal.grass, g, out);
        mixLinear(out, pal.grassDark, g * smoothstep(0.45, 0.8, t + w), out);
        mixLinear(out, pal.rock, smoothstep(0.35, 0.55, slope + w) * g, out);
      },
      splat(_t, h, slope, x, z, out) {
        const beachTop = sea + (H - sea) * beach * 0.6;
        const w = 0.05 * n.noise2(x * 0.5, z * 0.5);
        const g = smoothstep(beachTop, beachTop + H * 0.06, h + w * H);
        const rock = smoothstep(0.35, 0.55, slope + w) * g;
        out[2] = 1 - g;
        out[1] = rock;
        out[0] = Math.max(0, g - rock);
        out[3] = 0;
      },
    });
  },
});

const mountain = defineGenerator({
  id: 'mountain',
  description: 'Rugged mountain: ridged-noise peak with grassy foothills, rocky slopes and a snow cap. Exact heightfield collider.',
  category: 'terrain',
  params: {
    size: pNum(40, 10, 1000, 'base width in meters'),
    height: pNum(25, 3, 400, 'peak height in meters'),
    resolution: pInt(96, 16, 256, 'grid cells per side'),
    snowLine: pNum(0.7, 0, 1, 'normalized height where snow starts (1 = no snow)'),
    color: pColor('#7d7468', 'rock color'),
    groundColor: pColor('#5b8a3c', 'foothill color (match the world ground so the peak rises out of it)'),
    variant: pVariant(2, '0 single peak, 1 ridge, 2 volcano crater'),
  },
  run(p, api) {
    const size = p.num('size');
    const H = p.num('height');
    const variant = p.int('variant');
    const snowLine = p.num('snowLine');
    const R = size / 2;
    const n = api.noise;
    const rockC = lin(p.color('color'));
    const rockD = lin(shade(p.color('color'), -0.3));
    const grass = lin(p.color('groundColor'));
    const snow = lin('#f4f7fa');
    return buildTerrain(api, {
      size,
      resolution: p.int('resolution'),
      trimFlat: true,
      height(x, z) {
        let d = variant === 1 ? Math.hypot((x / R) * 0.55, z / R) : Math.hypot(x / R, z / R);
        d += 0.12 * n.fbm2(x * 2 / size, z * 2 / size, 3);
        const fall = Math.max(0, 1 - d);
        const ridge = n.ridged2(x * 3.2 / size, z * 3.2 / size, 5);
        let h = Math.pow(fall, 1.5) * (0.55 + 0.6 * ridge);
        if (variant === 2) h -= 0.55 * smoothstep(0.22, 0.05, d) * Math.pow(fall, 1.5);
        // The lowest foothills sink to exactly 0 (then trimmed from the mesh), so the
        // peak rises cleanly out of the world ground instead of sitting on a plate.
        return Math.max(0, h - MOUNTAIN_BASE) * H;
      },
      color(t, _h, slope, x, z, out) {
        const w = 0.05 * n.noise2(x * 0.4, z * 0.4);
        mixLinear(rockD, rockC, 0.5 + 0.5 * n.noise2(x * 0.15, z * 0.9), out);
        mixLinear(grass, out, smoothstep(0.08, 0.25, t + w) * 0.85 + smoothstep(0.3, 0.5, slope) * 0.15, out);
        if (snowLine < 1) mixLinear(out, snow, smoothstep(snowLine, snowLine + 0.08, t + w) * (1 - smoothstep(0.55, 0.75, slope)), out);
      },
      splat(t, _h, slope, x, z, out) {
        const w = 0.05 * n.noise2(x * 0.4, z * 0.4);
        const snowAmount = snowLine < 1 ? smoothstep(snowLine, snowLine + 0.08, t + w) * (1 - smoothstep(0.55, 0.75, slope)) : 0;
        const grassAmount = (smoothstep(0.08, 0.25, t + w) * 0.85 + smoothstep(0.3, 0.5, slope) * 0.15);
        const lowland = 1 - grassAmount;
        out[3] = snowAmount;
        out[0] = lowland * 0.9 * (1 - snowAmount);
        out[2] = lowland * 0.1 * (1 - snowAmount);
        out[1] = Math.max(0, (1 - out[0] - out[2] - snowAmount));
      },
    });
  },
});

const mound = defineGenerator({
  id: 'mound',
  description: 'Natural hill or knoll to stand things on (a shrine, a lookout, a castle): grassy slopes easing into the ground, rock where it is steep, an optional level summit. Exact heightfield collider.',
  category: 'terrain',
  params: {
    size: pNum(24, 4, 300, 'base diameter in meters'),
    height: pNum(5, 0.5, 60, 'summit height in meters'),
    top: pNum(0.25, 0, 0.6, 'level summit as a share of the base (0 = rounded top)'),
    roughness: pNum(0.35, 0, 1, '0 smooth swell … 1 rocky knoll'),
    color: pColor('#6a9a45', 'grass color (match the world ground)'),
    resolution: pInt(64, 16, 160, 'grid cells per side'),
    variant: pVariant(1, '0 round hill, 1 long ridge'),
  },
  run(p, api) {
    const size = p.num('size');
    const H = p.num('height');
    const top = p.num('top');
    const rough = p.num('roughness');
    const variant = p.int('variant');
    const R = size / 2;
    const n = api.noise;
    const pal = palette(p.color('color'));
    return buildTerrain(api, {
      size,
      resolution: p.int('resolution'),
      trimFlat: true,
      height(x, z) {
        let d = variant === 1 ? Math.hypot((x / R) * 0.6, z / R) : Math.hypot(x / R, z / R);
        d += 0.08 * n.fbm2(x * 1.6 / size + 3.1, z * 1.6 / size - 1.7, 3);
        if (d >= 1) return 0;
        // Flat summit inside `top`, a smooth shoulder down to the foot, no lip where it meets the ground.
        const u = top > 0 ? Math.max(0, (d - top) / Math.max(1e-3, 1 - top)) : d;
        const shape = 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, u));
        const crag = rough * 0.18 * n.ridged2(x * 4 / size, z * 4 / size, 4) * Math.sin(Math.PI * Math.min(1, u));
        return Math.max(0, (shape * (1 + crag) - 0.004)) * H;
      },
      color(t, _h, slope, x, z, out) {
        const w = 0.05 * n.noise2(x * 0.3, z * 0.3);
        mixLinear(pal.grassDark, pal.grass, smoothstep(0.05, 0.7, t + w), out);
        mixLinear(out, pal.rock, smoothstep(0.42, 0.65, slope + w), out);
      },
      splat(_t, _h, slope, x, z, out) {
        const w = 0.05 * n.noise2(x * 0.3, z * 0.3);
        out[1] = smoothstep(0.42, 0.65, slope + w);
        out[2] = 0;
        out[3] = 0;
        out[0] = 1 - out[1];
      },
    });
  },
});

/** Terrain generators in catalog order. */
export const TERRAIN_GENERATORS = [terrain, island, mountain, mound];
