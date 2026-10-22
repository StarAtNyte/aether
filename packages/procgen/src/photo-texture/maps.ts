/**
 * The three maps of a texture set from one seamless, de-lit tile: albedo (ratios around 1 of the surface's colour), occlusion /
 * roughness / (unused) and a tangent-space normal map, in the encoding of the finish library (`finishPixels`), so the renderer binds
 * them exactly like a procedural finish.
 *
 * Nothing here pretends to measure relief or gloss from a flat photograph. The heuristics are stated: relief from the luminance of the
 * mid-sized pattern (darker reads lower), occlusion from cavities of the same luminance, roughness from the material class with the
 * photograph's fine variation, and fine grain (weave, fibre, plaster) from the library finish of the same class so the surface
 * keeps detail finer than the photograph resolves. The provenance stays "photographed": the colour and the pattern are the photo's.
 */
import type { MaterialFinish } from '@aether/core';
import { FINISHES } from '@aether/arch';
import { finishPixels } from '../finish-pixels';
import { blurPlane, luminance, newImage, resize, type FImage } from './raster';

/** Albedo ratios are stored divided by this (see `TextureSetDef.albedoScale`). */
export const ALBEDO_SCALE = 2.5;

/** The stored maps of one tier (RGBA8, `size x size`). */
export interface PbrMaps {
  size: number;
  albedo: Uint8Array;
  orm: Uint8Array;
  normal: Uint8Array;
}

/** What kind of surface a tile is: decides roughness, relief and the fine grain added. */
export interface SurfaceClass {
  /** Library finish whose roughness, relief strength and fine grain stand in. */
  finish: MaterialFinish;
  /** Share of the library finish's fine albedo grain mixed in (0 none). */
  grain: number;
  /** Strength of the relief taken from the photograph's luminance. */
  relief: number;
  /** Strength of the library finish's own relief mixed in. */
  fineRelief: number;
  /** Roughness of the surface (defaults to the finish's). */
  roughness?: number;
}

/** Surface classes of the words the description uses for a finish or material. */
export const SURFACE_CLASSES: Readonly<Record<string, SurfaceClass>> = Object.freeze({
  paint: { finish: 'plaster', grain: 0.12, relief: 0.15, fineRelief: 0.5, roughness: 0.78 },
  plaster: { finish: 'plaster', grain: 0.2, relief: 0.25, fineRelief: 0.8, roughness: 0.9 },
  wallpaper: { finish: 'wallpaper', grain: 0.1, relief: 0.2, fineRelief: 0.4, roughness: 0.8 },
  fabric: { finish: 'fabric', grain: 0.5, relief: 0.7, fineRelief: 1, roughness: 0.94 },
  velvet: { finish: 'velvet', grain: 0.35, relief: 0.4, fineRelief: 0.8, roughness: 0.82 },
  leather: { finish: 'leather', grain: 0.45, relief: 0.5, fineRelief: 1, roughness: 0.52 },
  carpet: { finish: 'carpet', grain: 0.5, relief: 0.6, fineRelief: 1, roughness: 0.98 },
  wood: { finish: 'oak', grain: 0.25, relief: 0.35, fineRelief: 0.5, roughness: 0.5 },
  tile: { finish: 'tile', grain: 0, relief: 0.3, fineRelief: 0.4, roughness: 0.25 },
  stone: { finish: 'stone', grain: 0.2, relief: 0.5, fineRelief: 0.6, roughness: 0.7 },
  brick: { finish: 'brick', grain: 0.25, relief: 0.6, fineRelief: 0.7, roughness: 0.85 },
  concrete: { finish: 'concrete', grain: 0.25, relief: 0.4, fineRelief: 0.8, roughness: 0.82 },
});

/** The class of a finish or material word ("oak", "wallpaper-floral", "linen", "velvet"); the paint class when nothing fits. */
export function surfaceClassOf(word: string | undefined): SurfaceClass {
  const w = (word ?? '').toLowerCase();
  const table: Array<[RegExp, string]> = [
    [/velvet|suede|plush/, 'velvet'],
    [/leather|vinyl|pleather/, 'leather'],
    [/carpet|rug|pile|wool/, 'carpet'],
    [/fabric|linen|cotton|curtain|drape|upholster|duvet|bed|cushion|throw|sheet|cloth|textile|sofa|tweed|boucle/, 'fabric'],
    [/wallpaper|paper/, 'wallpaper'],
    [/oak|walnut|ash|wood|timber|plank|parquet|herringbone|bamboo|laminate|veneer|slat|panel/, 'wood'],
    [/tile|ceramic|porcelain|marble|terrazzo/, 'tile'],
    [/brick/, 'brick'],
    [/stone|slate|granite|limestone|cobble/, 'stone'],
    [/concrete|cement|screed/, 'concrete'],
    [/plaster|stucco|render|lime/, 'plaster'],
  ];
  for (const [re, key] of table) if (re.test(w)) return SURFACE_CLASSES[key] as SurfaceClass;
  return SURFACE_CLASSES['paint'] as SurfaceClass;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** The fine grain of each library finish, computed once (the three tiers of every set read it). */
const GRAIN = new Map<MaterialFinish, ReturnType<typeof fineGrainOf>>();
function fineGrain(finish: MaterialFinish): ReturnType<typeof fineGrainOf> {
  let g = GRAIN.get(finish);
  if (!g) {
    g = fineGrainOf(finish);
    GRAIN.set(finish, g);
  }
  return g;
}

/** High-pass ratio of a luminance plane (value over its blurred self), the fine grain of a library finish. */
function fineGrainOf(finish: MaterialFinish): { grain: Float32Array; rough: Float32Array; dx: Float32Array; dy: Float32Array; ao: Float32Array; n: number } {
  const n = 256;
  const px = finishPixels(finish, n);
  const lum = new Float32Array(n * n);
  const rough = new Float32Array(n * n);
  const ao = new Float32Array(n * n);
  const dx = new Float32Array(n * n);
  const dy = new Float32Array(n * n);
  let rm = 0;
  for (let i = 0; i < n * n; i++) {
    lum[i] = (0.2126 * (px.albedo[i * 4] as number) + 0.7152 * (px.albedo[i * 4 + 1] as number) + 0.0722 * (px.albedo[i * 4 + 2] as number)) / 255;
    rough[i] = (px.orm[i * 4 + 1] as number) / 255;
    ao[i] = (px.orm[i * 4] as number) / 255;
    rm += rough[i] as number;
    // Decode the stored slope (the normal's xy as 0..255 around 128).
    dx[i] = ((px.normal[i * 4] as number) - 127.5) / 127.5;
    dy[i] = ((px.normal[i * 4 + 1] as number) - 127.5) / 127.5;
  }
  rm /= n * n;
  const low = blurPlane(lum, n, n, 5, true);
  const grain = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    grain[i] = (lum[i] as number) / Math.max(1e-3, low[i] as number);
    rough[i] = (rough[i] as number) / Math.max(1e-3, rm);
  }
  return { grain, rough, dx, dy, ao, n };
}

/** Sample a `n x n` plane tiled `f` times across `size` texels (nearest, wrap). */
function tiled(plane: Float32Array, n: number, f: number, x: number, y: number, size: number): number {
  const u = ((x * f * n) / size) % n;
  const v = ((y * f * n) / size) % n;
  return plane[(Math.floor(v) % n) * n + (Math.floor(u) % n)] as number;
}

/** Options of {@link buildMaps}. */
export interface BuildMapsOptions {
  /** Real-world edge of the tile in metres (sets how many times the library grain repeats). */
  tileMetres: number;
  cls: SurfaceClass;
  /** Edge length of the stored tier. */
  size: number;
}

/** The maps of one tier from a seamless ratio tile (any size, resampled). */
export function buildMaps(tile: FImage, opts: BuildMapsOptions): PbrMaps {
  const size = opts.size;
  const cls = opts.cls;
  const ratio = resize(tile, size, size, true);
  const n = size * size;
  const def = FINISHES[cls.finish];
  const f = Math.max(1, Math.round(opts.tileMetres / def.tile));
  const fine = cls.grain > 0 || cls.fineRelief > 0 ? fineGrain(cls.finish) : null;
  // Fine grain on the albedo.
  const albedo = new Uint8Array(n * 4);
  const lum = luminance(ratio);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const g = fine && cls.grain > 0 ? tiled(fine.grain, fine.n, f, x, y, size) ** cls.grain : 1;
      for (let c = 0; c < 3; c++) {
        const v = (ratio.data[i * 3 + c] as number) * g;
        albedo[i * 4 + c] = Math.round(clamp01(v / ALBEDO_SCALE) * 255);
      }
      albedo[i * 4 + 3] = 255;
    }
  }
  // Relief from the photograph: the mid-sized pattern of the luminance (darker reads lower).
  const mid = blurPlane(lum, size, size, Math.max(1.5, size / 220), true);
  const wide = blurPlane(lum, size, size, Math.max(4, size / 28), true);
  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) height[i] = (mid[i] as number) - (wide[i] as number);
  const orm = new Uint8Array(n * 4);
  const normal = new Uint8Array(n * 4);
  const baseRough = cls.roughness ?? def.roughness;
  const photoStrength = cls.relief * 5.5 * (size / 256);
  const cav = blurPlane(lum, size, size, Math.max(2, size / 40), true);
  for (let y = 0; y < size; y++) {
    const yd = (y + size - 1) % size;
    const yu = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xl = (x + size - 1) % size;
      const xr = (x + 1) % size;
      let dx = ((height[y * size + xr] as number) - (height[y * size + xl] as number)) * photoStrength;
      let dy = ((height[yu * size + x] as number) - (height[yd * size + x] as number)) * photoStrength;
      let rough = baseRough;
      let ao = 1;
      if (fine) {
        dx += tiled(fine.dx, fine.n, f, x, y, size) * -0.9 * cls.fineRelief * (0.5 + def.bump);
        dy += tiled(fine.dy, fine.n, f, x, y, size) * -0.9 * cls.fineRelief * (0.5 + def.bump);
        rough = baseRough * (0.85 + 0.15 * tiled(fine.rough, fine.n, f, x, y, size));
        ao = 0.82 + 0.18 * tiled(fine.ao, fine.n, f, x, y, size);
      }
      // Pale specks on a surface read smoother, dark crevices rougher and occluded.
      const l = lum[i] as number;
      rough = clamp01(rough * (1 - 0.18 * Math.max(-1, Math.min(1, (l - 1) * 2))));
      ao = clamp01(ao * (1 - 0.55 * clamp01(((cav[i] as number) - l) * 1.6)));
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      normal[i * 4] = Math.round((-dx / len * 0.5 + 0.5) * 255);
      normal[i * 4 + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255);
      normal[i * 4 + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      normal[i * 4 + 3] = 255;
      orm[i * 4] = Math.round(ao * 255);
      orm[i * 4 + 1] = Math.round(rough * 255);
      orm[i * 4 + 2] = 0;
      orm[i * 4 + 3] = 255;
    }
  }
  void newImage;
  return { size, albedo, orm, normal };
}
