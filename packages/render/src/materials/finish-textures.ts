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

/** The maps of one finish. */
export interface FinishMaps {
  map: Texture;
  /** R = ambient occlusion, G = roughness (bind as `aoMap` and `roughnessMap`). */
  orm: Texture;
  normal: Texture;
  /** Pixels arrived (false while the neutral placeholder is shown). */
  ready: boolean;
}

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

  /** Maps of `id` (created on first use; pixels fill in asynchronously). */
  get(id: MaterialFinish): FinishMaps {
    const hit = this.maps.get(id);
    if (hit) return hit;
    const def = FINISHES[id];
    const ph = placeholder(id, this.size);
    const maps: FinishMaps = { map: texture(ph.albedo, this.size, def.tile), orm: texture(ph.orm, this.size, def.tile), normal: texture(ph.normal, this.size, def.tile), ready: false };
    this.maps.set(id, maps);
    const size = this.size;
    this.synth(id, size).then(
      (px) => {
        if (this.disposed || this.maps.get(id) !== maps || px.size !== size) return;
        fill(maps.map, px.albedo);
        fill(maps.orm, px.orm);
        fill(maps.normal, px.normal);
        maps.ready = true;
        this.onUpdate?.();
      },
      (e: unknown) => log.warn(`finish "${id}" textures failed: ${errorMessage(e)}`),
    );
    return maps;
  }

  /** Release every texture. */
  dispose(): void {
    this.disposed = true;
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
