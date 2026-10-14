/**
 * Terrain generators (terrain, island, mountain): fbm/ridged heightfields with
 * height- and slope-based vertex colors and exact heightfield colliders.
 * Output meshes are centered in x/z with their lowest point at y = 0.
 */
import { canyonHalfWidth, canyonMeander, riverHalfWidth, riverMeander } from '@aether/core';
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
  /**
   * Color for a vertex: t = normalized height (0 lowest … 1 highest),
   * h = height above the lowest point in meters, slope = 1 - normal.y.
   */
  color(t: number, h: number, slope: number, x: number, z: number, out: RGB): void;
}

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
  mesh.paintFn((x, y, z, _nx, ny, _nz, out) => shape.color(y / range, y, 1 - ny, x, z, out));
  if (shape.trimFlat === true && mesh instanceof Mesh) trimFlatTriangles(mesh, range * FLAT_EPSILON);
  api.add(mesh, MAT.ground);
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
    resolution: pInt(128, 16, 256, 'grid cells per side (detail)'),
    roughness: pNum(0.5, 0, 1, '0 smooth hills … 1 rugged'),
    color: pColor('#5a8f3c', 'grass color'),
    variant: pVariant(4, '0 hills, 1 plateaus (terraced), 2 valley, 3 canyon (flat floor at y = 0 along Z, stratified walls), 4 river valley (meandering riverbed at y = 0 along Z between soft grassy banks)'),
  },
  run(p, api) {
    const size = p.num('size');
    const H = p.num('height');
    const rough = p.num('roughness');
    const variant = p.int('variant');
    if (variant === 3) return canyonTerrain(api, size, H, rough, p.int('resolution'), p.color('color'));
    if (variant === 4) return riverValley(api, size, H, rough, p.int('resolution'), p.color('color'));
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
  const sandstone = lin('#b0603a');
  const pale = lin('#d7a370');
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
      const strata = (Math.floor(t) + smoothstep(0.55, 1, t - Math.floor(t))) / steps;
      const plateau = 0.78 + 0.22 * (0.5 + 0.5 * n.fbm2(x * freq, z * freq, 3 + Math.round(rough * 3)));
      return strata * plateau * H;
    },
    color(t, _h, slope, x, z, out) {
      const w = 0.05 * n.noise2(x * 0.2, z * 0.2);
      // Banded sandstone walls, grassy plateau, dusty floor.
      const band = 0.5 + 0.5 * Math.sin((t + w) * 38);
      mixLinear(sandstone, pale, band * 0.6, out);
      mixLinear(out, pal.grass, smoothstep(0.82, 0.9, t + w) * (1 - smoothstep(0.3, 0.5, slope)), out);
      if (t < 0.01) mixLinear(pal.sand, sandstone, 0.35 + w * 2, out);
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
      // A gentle bank (rounded shoulder), then rolling hills that grow away from the water.
      const bank = smoothstep(0, size * 0.05, d) * 0.22;
      const hills = smoothstep(size * 0.03, size * 0.3, d) * (0.45 + 0.55 * (0.5 + 0.5 * n.fbm2(x * freq, z * freq, oct)));
      return (bank + hills * 0.78) * H;
    },
    color(t, h, slope, x, z, out) {
      const w = 0.05 * n.noise2(x * 0.25, z * 0.25);
      mixLinear(pal.grassDark, pal.grass, smoothstep(0.05, 0.6, t + w), out);
      mixLinear(out, pal.rock, smoothstep(0.32, 0.55, slope + w), out);
      // Wet pebbles on the riverbed and the first metre of bank.
      mixLinear(bed, out, smoothstep(0.15, 1.2, h + w * 4), out);
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
    });
  },
});

/** Terrain generators in catalog order. */
export const TERRAIN_GENERATORS = [terrain, island, mountain];
