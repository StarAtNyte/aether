/**
 * Texture maps of the physically based finishes (`material.finish`): one
 * shared albedo / ORM (occlusion, roughness) / normal set per finish,
 * created on first use and filled asynchronously.
 *
 * The textures exist (with neutral pixels) from the moment a material asks
 * for them, so the material's shader is compiled once with its maps bound;
 * the pixels are synthesised off the main thread (the compute worker, see
 * `ComputeClient.finish`) and copied into the same textures when they
 * arrive. Nothing recompiles, and the page never blocks on texture work.
 */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, RepeatWrapping, type Texture } from 'three';
import { FINISHES } from '@aether/arch';
import type { MaterialFinish } from '@aether/core';
import { FINISH_TEXTURE_SIZE, finishAlbedoScale, finishPixels, type FinishPixels } from '@aether/procgen';
import { errorMessage, log } from '../log';
import { SplatArrays } from './splat-arrays';

/** The maps of one finish. */
export interface FinishMaps {
  map: Texture;
  /** R = ambient occlusion, G = roughness (bind as `aoMap` and `roughnessMap`). */
  orm: Texture;
  normal: Texture;
  /** Pixels arrived (false while the neutral placeholder is shown). */
  ready: boolean;
  /** Photographed maps are shown (procedural results arriving later are ignored). */
  photo: boolean;
}

/** URLs of a finish's photographed maps and the real-world size of one tile (metres). */
export interface PhotoFinishSource {
  tile: number;
  albedo: string;
  orm: string;
  normal: string;
  /** The same maps at 256 px; used when the finish textures are 256 px or smaller. */
  small?: { albedo: string; orm: string; normal: string };
}

/** Resolves the photo maps of a finish (null: keep the procedural ones). */
export type PhotoResolver = (finish: MaterialFinish) => PhotoFinishSource | null;

/** Decodes an image URL into `size × size` RGBA8 pixels. Injected so tests can fake it. */
export type PixelLoader = (url: string, size: number) => Promise<Uint8Array>;

/** Browser pixel loader: fetch → `createImageBitmap` → (Offscreen)canvas resample. */
export const browserPixelLoader: PixelLoader = async (url, size) => {
  if (typeof createImageBitmap !== 'function') throw new Error('image decoding is unavailable');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  try {
    const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.drawImage(bmp, 0, 0, size, size);
    return new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer);
  } finally {
    bmp.close();
  }
};

/** Synthesises the pixels of a finish (worker or inline). */
export type FinishSynth = (finish: MaterialFinish, size: number) => Promise<FinishPixels>;

/** Finishes rendered without maps (pure reflections: their pattern would be invisible). */
const PLAIN: ReadonlySet<MaterialFinish> = new Set<MaterialFinish>(['mirror', 'glass', 'chrome']);

/** True when finish `id` is drawn with texture maps. */
export function finishHasMaps(id: MaterialFinish): boolean {
  return !PLAIN.has(id);
}

function texture(data: Uint8Array, size: number, tile: number): DataTexture {
  const tex = new DataTexture(data, size, size, RGBAFormat);
  // Albedo holds linear ratios (see finishPixels); no colour-space conversion anywhere.
  tex.colorSpace = NoColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.repeat.set(1 / tile, 1 / tile);
  tex.needsUpdate = true;
  return tex;
}

/** Neutral pixels shown until the synthesised ones arrive. */
function placeholder(id: MaterialFinish, size: number): FinishPixels {
  const def = FINISHES[id];
  const n = size * size * 4;
  const albedo = new Uint8Array(n);
  const orm = new Uint8Array(n);
  const normal = new Uint8Array(n);
  const a = Math.round(255 / finishAlbedoScale(def));
  const r = Math.round(Math.min(1, def.roughness) * 255);
  for (let i = 0; i < n; i += 4) {
    albedo[i] = a;
    albedo[i + 1] = a;
    albedo[i + 2] = a;
    albedo[i + 3] = 255;
    orm[i] = 255;
    orm[i + 1] = r;
    orm[i + 3] = 255;
    normal[i] = 128;
    normal[i + 1] = 128;
    normal[i + 2] = 255;
    normal[i + 3] = 255;
  }
  return { size, albedo, orm, normal };
}

/** Inline synthesis one macrotask later (Node, tests, no worker). */
const inlineSynth: FinishSynth = (finish, size) =>
  new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(finishPixels(finish, size));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    }, 0);
  });

/** Lazily created, shared finish textures (one set per material cache). */
export class FinishTextures {
  private readonly maps = new Map<MaterialFinish, FinishMaps>();
  private synth: FinishSynth = inlineSynth;
  private onUpdate: (() => void) | null = null;
  private size = FINISH_TEXTURE_SIZE;
  private disposed = false;

  /** Route synthesis (e.g. to the compute worker) and get notified when pixels land. */
  configure(opts: { synth?: FinishSynth; onUpdate?: () => void; size?: number }): void {
    if (opts.synth) this.synth = opts.synth;
    if (opts.onUpdate) this.onUpdate = opts.onUpdate;
    // Only before any texture exists: sizes of live textures never change.
    if (opts.size !== undefined && this.maps.size === 0) this.size = Math.max(16, Math.min(1024, 2 ** Math.round(Math.log2(opts.size))));
  }

  /** Texture edge length in pixels. */
  get textureSize(): number {
    return this.size;
  }

  /** Number of finishes with live textures. */
  get count(): number {
    return this.maps.size;
  }

  private photos: PhotoResolver | null = null;
  private pixelLoader: PixelLoader = browserPixelLoader;

  /**
   * Use photographed maps (asset library "material" entries) for the finishes
   * that have them: existing finishes are upgraded in place (same textures,
   * no shader recompile), later ones load the photos directly. Pass `null`
   * to stop using photos for finishes created from now on.
   */
  usePhotos(resolver: PhotoResolver | null, loader: PixelLoader = browserPixelLoader): void {
    this.photos = resolver;
    this.pixelLoader = loader;
    if (!resolver) return;
    for (const [id, maps] of this.maps) if (!maps.photo) this.loadPhoto(id, maps);
  }

  private loadPhoto(id: MaterialFinish, maps: FinishMaps): boolean {
    const src = this.photos?.(id);
    if (!src || !finishHasMaps(id)) return false;
    const size = this.size;
    const urls = size <= 256 && src.small ? src.small : src;
    Promise.all([this.pixelLoader(urls.albedo, size), this.pixelLoader(urls.orm, size), this.pixelLoader(urls.normal, size)]).then(
      ([albedo, orm, normal]) => {
        if (this.disposed || this.maps.get(id) !== maps) return;
        const n = size * size * 4;
        if (albedo.length !== n || orm.length !== n || normal.length !== n) return;
        fill(maps.map, albedo);
        fill(maps.orm, orm);
        fill(maps.normal, normal);
        // Texture transforms are uniforms: retiling to the photo's real size recompiles nothing.
        const k = 1 / Math.max(0.05, src.tile);
        for (const t of [maps.map, maps.orm, maps.normal]) t.repeat.set(k, k);
        maps.photo = true;
        maps.ready = true;
        this.refreshStacks(maps);
        this.onUpdate?.();
      },
      (e: unknown) => log.warn(`photo maps of "${id}" failed (procedural kept): ${errorMessage(e)}`),
    );
    return true;
  }

  /** Maps of `id` (created on first use; pixels fill in asynchronously). */
  get(id: MaterialFinish): FinishMaps {
    const hit = this.maps.get(id);
    if (hit) return hit;
    const def = FINISHES[id];
    const ph = placeholder(id, this.size);
    const maps: FinishMaps = { map: texture(ph.albedo, this.size, def.tile), orm: texture(ph.orm, this.size, def.tile), normal: texture(ph.normal, this.size, def.tile), ready: false, photo: false };
    this.maps.set(id, maps);
    const size = this.size;
    // The procedural maps are synthesised regardless: they show if the photos fail to load.
    this.loadPhoto(id, maps);
    this.synth(id, size).then(
      (px) => {
        if (this.disposed || this.maps.get(id) !== maps || px.size !== size || maps.photo) return;
        fill(maps.map, px.albedo);
        fill(maps.orm, px.orm);
        fill(maps.normal, px.normal);
        maps.ready = true;
        this.refreshStacks(maps);
        this.onUpdate?.();
      },
      (e: unknown) => log.warn(`finish "${id}" textures failed: ${errorMessage(e)}`),
    );
    return maps;
  }

  private readonly stacks = new Map<string, SplatArrays>();

  /**
   * The maps of `ids` packed as texture arrays (one layer per finish, in order), shared by every material that asks for
   * the same list. The arrays follow their finishes: pixels that arrive later are copied in.
   */
  stack(ids: readonly MaterialFinish[]): SplatArrays {
    const key = ids.join('|');
    let hit = this.stacks.get(key);
    if (!hit) {
      hit = new SplatArrays(
        ids.map((id) => this.get(id)),
        this.size,
      );
      this.stacks.set(key, hit);
    }
    return hit;
  }

  private refreshStacks(maps: FinishMaps): void {
    for (const s of this.stacks.values()) s.refreshSource(maps);
  }

  /** Release every texture. */
  dispose(): void {
    this.disposed = true;
    for (const s of this.stacks.values()) s.dispose();
    this.stacks.clear();
    for (const m of this.maps.values()) {
      m.map.dispose();
      m.orm.dispose();
      m.normal.dispose();
    }
    this.maps.clear();
  }
}

function fill(tex: Texture, data: Uint8Array): void {
  const img = tex.image as { data: Uint8Array };
  img.data.set(data);
  tex.needsUpdate = true;
}
