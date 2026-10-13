/**
 * Procedural surface detail for the materials that otherwise read as flat
 * colored plastic: glowing lava cracks and rippled water. The pixel data is
 * generated in plain TypeScript (seamlessly tileable, deterministic), so the
 * look is identical on the WebGPU and WebGL2 backends and needs no image
 * assets. Geometry carries box-projected metre UVs (see
 * `partToBufferGeometry`), so one tile covers the same real-world area on
 * a 2 m pond and a 260 m sea.
 */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { rng } from '@aether/core';

/** Surfaces with procedural detail. */
export type SurfaceKind = 'lava' | 'water';

/** Texture edge length in pixels (power of two, tileable). */
export const SURFACE_TEXTURE_SIZE = 128;
/** Real-world size of one texture tile in metres, per surface. */
export const SURFACE_TILE_METRES: Readonly<Record<SurfaceKind, number>> = Object.freeze({ lava: 11, water: 7 });
/** Lava crust brightness in the emissive mask (cracks are 1). */
export const LAVA_CRUST_GLOW = 0.12;
/** Water normal map strength. */
export const WATER_NORMAL_SCALE = 0.45;
/** Flow speed of the surface detail in tiles per second (applied while frames are drawn). */
export const SURFACE_FLOW: Readonly<Record<SurfaceKind, readonly [number, number]>> = Object.freeze({
  lava: Object.freeze([0.004, 0.011]) as readonly [number, number],
  water: Object.freeze([0.012, -0.008]) as readonly [number, number],
});

const LAVA_SEED = 0x1a7a;
const WATER_SEED = 0x3a7e;
/** Worley cells per tile side (lava plates). */
const LAVA_CELLS = 5;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Tileable value noise on a `period`-cell lattice, sampled at (x, y) in cell units. */
function tileNoise(lattice: Float32Array, period: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const at = (i: number, j: number): number => lattice[(((j % period) + period) % period) * period + (((i % period) + period) % period)] as number;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
  const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
  return a + (b - a) * sy;
}

/** Tileable fractal noise in [0, 1] with `octaves` octaves starting at `period` cells per tile. */
function tileFbm(random: () => number, size: number, period: number, octaves: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const p = period << o;
    const lattice = new Float32Array(p * p);
    for (let i = 0; i < lattice.length; i++) lattice[i] = random();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const k = y * size + x;
        out[k] = (out[k] as number) + amp * tileNoise(lattice, p, (x / size) * p, (y / size) * p);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / total;
  return out;
}

/**
 * Lava: RGBA8 color and emissive-mask pixels. Worley plates of dark crust
 * separated by bright cracks (distance to the second-nearest feature point
 * minus the nearest), with fractal mottling on the crust. Both images tile.
 */
export function lavaPixels(size = SURFACE_TEXTURE_SIZE): { color: Uint8Array; emissive: Uint8Array } {
  const n = Math.max(8, Math.floor(size));
  const random = rng(LAVA_SEED);
  const cells = LAVA_CELLS;
  const points = new Float32Array(cells * cells * 2);
  for (let i = 0; i < cells * cells; i++) {
    points[i * 2] = 0.05 + random() * 0.9;
    points[i * 2 + 1] = 0.05 + random() * 0.9;
  }
  const mottle = tileFbm(random, n, 4, 3);
  const color = new Uint8Array(n * n * 4);
  const emissive = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const px = (x / n) * cells;
      const py = (y / n) * cells;
      const cx = Math.floor(px);
      const cy = Math.floor(py);
      let f1 = Infinity;
      let f2 = Infinity;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const gx = cx + dx;
          const gy = cy + dy;
          const wi = (((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells);
          const fx = gx + (points[wi * 2] as number) - px;
          const fy = gy + (points[wi * 2 + 1] as number) - py;
          const d = Math.hypot(fx, fy);
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) f2 = d;
        }
      }
      const m = mottle[y * n + x] as number;
      // Cracks: narrow where plates meet, widened a little by the mottling.
      const crack = 1 - smoothstep(0.015, 0.06 + 0.07 * m, f2 - f1);
      // Plate centers cool to crust; plate rims stay warm.
      const warm = Math.max(crack, smoothstep(0.55, 0.05, f1) * 0.25 * m);
      const glow = LAVA_CRUST_GLOW + (1 - LAVA_CRUST_GLOW) * Math.min(1, warm);
      const o = (y * n + x) * 4;
      const crust = 0.32 + 0.4 * m;
      color[o] = Math.round(255 * Math.min(1, crust + crack * 0.68));
      color[o + 1] = Math.round(255 * Math.min(1, crust * 0.62 + crack * 0.42));
      color[o + 2] = Math.round(255 * Math.min(1, crust * 0.5 + crack * 0.08));
      color[o + 3] = 255;
      const e = Math.round(255 * glow);
      emissive[o] = e;
      emissive[o + 1] = Math.round(e * (0.55 + 0.45 * crack));
      emissive[o + 2] = Math.round(e * 0.35 * crack);
      emissive[o + 3] = 255;
    }
  }
  return { color, emissive };
}

/**
 * Water: RGBA8 tangent-space normal-map pixels (flat = 128,128,255) of a
 * tileable ripple height field (fractal chop over faint crossing swells), and a
 * subtle brightness map so large lakes are not one flat color.
 */
export function waterPixels(size = SURFACE_TEXTURE_SIZE): { normal: Uint8Array; color: Uint8Array } {
  const n = Math.max(8, Math.floor(size));
  const random = rng(WATER_SEED);
  const chop = tileFbm(random, n, 4, 4);
  const tone = tileFbm(random, n, 2, 2);
  const height = new Float32Array(n * n);
  const tau = Math.PI * 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n;
      const v = y / n;
      // Integer wave numbers keep the field tileable.
      const waves = Math.sin(tau * (3 * u + 2 * v)) * 0.08 + Math.sin(tau * (-2 * u + 5 * v) + 1.3) * 0.06 + Math.sin(tau * (7 * u - 3 * v) + 0.4) * 0.04;
      height[y * n + x] = waves + ((chop[y * n + x] as number) - 0.5) * 2;
    }
  }
  const normal = new Uint8Array(n * n * 4);
  const color = new Uint8Array(n * n * 4);
  const at = (x: number, y: number): number => height[(((y % n) + n) % n) * n + (((x % n) + n) % n)] as number;
  const strength = 1.8;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const sx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const sy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(sx, sy, 1);
      const o = (y * n + x) * 4;
      normal[o] = Math.round(((-sx / l) * 0.5 + 0.5) * 255);
      normal[o + 1] = Math.round(((-sy / l) * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      normal[o + 3] = 255;
      const t = Math.round(255 * (0.86 + 0.14 * (tone[y * n + x] as number)));
      color[o] = t;
      color[o + 1] = t;
      color[o + 2] = t;
      color[o + 3] = 255;
    }
  }
  return { normal, color };
}

/** Textures of one surface kind. */
export interface SurfaceMaps {
  map: Texture;
  emissiveMap: Texture | null;
  normalMap: Texture | null;
}

function makeTexture(pixels: Uint8Array, size: number, srgb: boolean, tileMetres: number): DataTexture {
  const tex = new DataTexture(pixels, size, size, RGBAFormat);
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.repeat.set(1 / tileMetres, 1 / tileMetres);
  tex.needsUpdate = true;
  return tex;
}

function scrollTexture(tex: Texture | null, flow: readonly [number, number], dt: number): void {
  if (!tex) return;
  tex.offset.x = (tex.offset.x + flow[0] * dt) % 1;
  tex.offset.y = (tex.offset.y + flow[1] * dt) % 1;
}

function scrollMaps(maps: SurfaceMaps, flow: readonly [number, number], dt: number): void {
  scrollTexture(maps.map, flow, dt);
  scrollTexture(maps.emissiveMap, flow, dt);
  scrollTexture(maps.normalMap, flow, dt);
}

/**
 * Lazily created, shared surface textures (one set per material cache).
 * {@link advance} scrolls them (slow lava flow, drifting ripples) without
 * allocating; {@link dispose} frees the GPU copies.
 */
export class SurfaceTextures {
  private lava: SurfaceMaps | null = null;
  private water: SurfaceMaps | null = null;

  /** Textures of `kind`, created on first use. */
  get(kind: SurfaceKind): SurfaceMaps {
    if (kind === 'lava') {
      if (!this.lava) {
        const px = lavaPixels();
        const tile = SURFACE_TILE_METRES.lava;
        this.lava = { map: makeTexture(px.color, SURFACE_TEXTURE_SIZE, true, tile), emissiveMap: makeTexture(px.emissive, SURFACE_TEXTURE_SIZE, true, tile), normalMap: null };
      }
      return this.lava;
    }
    if (!this.water) {
      const px = waterPixels();
      const tile = SURFACE_TILE_METRES.water;
      this.water = { map: makeTexture(px.color, SURFACE_TEXTURE_SIZE, true, tile), emissiveMap: null, normalMap: makeTexture(px.normal, SURFACE_TEXTURE_SIZE, false, tile) };
    }
    return this.water;
  }

  /** True once any surface texture exists (callers skip {@link advance} otherwise). */
  get active(): boolean {
    return this.lava !== null || this.water !== null;
  }

  /** Scroll the textures by `dt` seconds of flow. Zero allocations. */
  advance(dt: number): void {
    if (!(dt > 0)) return;
    if (this.lava) scrollMaps(this.lava, SURFACE_FLOW.lava, dt);
    if (this.water) scrollMaps(this.water, SURFACE_FLOW.water, dt);
  }

  /** Release every texture. */
  dispose(): void {
    for (const maps of [this.lava, this.water]) {
      maps?.map.dispose();
      maps?.emissiveMap?.dispose();
      maps?.normalMap?.dispose();
    }
    this.lava = null;
    this.water = null;
  }
}
