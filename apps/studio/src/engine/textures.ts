/**
 * The project's texture sets in the studio: stored (IndexedDB), registered with the asset registry so the renderer can draw
 * them, and restored whenever a world that names them is opened. Bundled worlds carry no stored sets; their records name a `base`
 * folder the maps are served from.
 */
import type { StoreApi } from 'zustand';
import { TEXTURE_TIERS, type TextureSetDef, type TextureTier, type WorldDoc } from '@aether/core';
import { registerBundledTextureSets, registerTextureSet, textureSet, unregisterTextureSet, type TextureMapName } from '@aether/assets';
import type { MapEncoder } from '@aether/procgen/photo-texture';
import { createLogger } from '../lib/log';
import { checkSetFiles, openTextureStore, type TextureStore } from '../assets/textureStore';
import type { History } from '@aether/core';

const log = createLogger('textures');

/** Where bundled worlds serve their texture maps from (the site root, honouring Vite's base). */
const SITE_ROOT = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/';

/** Browser WebP encoder for the texture maps (canvas); falls back to PNG when WebP encoding is unavailable. */
export const webpEncoder: MapEncoder = async (rgba, size, _map, quality) => {
  const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength) as ArrayBuffer), size, size), 0, 0);
  const blob = canvas instanceof OffscreenCanvas ? await canvas.convertToBlob({ type: 'image/webp', quality }) : await new Promise<Blob | null>((res) => (canvas as HTMLCanvasElement).toBlob(res, 'image/webp', quality));
  if (!blob) throw new Error('image encoding failed');
  return new Uint8Array(await blob.arrayBuffer());
};

/** What the controller needs of the studio. */
export interface TextureHost {
  readonly history: History;
  readonly store?: StoreApi<unknown>;
}

/** A texture set to keep: record and encoded files. */
export interface TextureSetFilesInput {
  id: string;
  def: TextureSetDef;
  files: ReadonlyArray<{ tier: TextureTier; map: TextureMapName; bytes: Uint8Array }>;
}

export class TextureController {
  private store: Promise<TextureStore> | null = null;
  private readonly urls = new Map<string, string[]>();
  private readonly cleanups: Array<() => void> = [];
  private disposed = false;
  /** Called when a set became drawable (the studio re-renders). */
  onChange: (() => void) | null = null;

  constructor(private readonly host: TextureHost) {
    this.cleanups.push(host.history.subscribe((world) => void this.sync(world)));
    void this.sync(host.history.current);
  }

  private open(): Promise<TextureStore> {
    this.store ??= openTextureStore();
    return this.store;
  }

  /** Register every set the world names that is not registered yet (stored sets, then bundled ones by `base`). */
  async sync(world: WorldDoc): Promise<void> {
    const defs = world.textures;
    if (!defs) return;
    const missing = Object.entries(defs).filter(([id]) => !textureSet(id));
    if (missing.length === 0) return;
    const bundled = Object.fromEntries(missing.filter(([, d]) => d.base !== undefined));
    if (Object.keys(bundled).length > 0) registerBundledTextureSets(bundled, SITE_ROOT);
    const rest = missing.filter(([id]) => !textureSet(id));
    if (rest.length === 0) return;
    const store = await this.open();
    for (const [id, def] of rest) {
      const rec = await store.get(id).catch(() => null);
      if (!rec || this.disposed) continue;
      const urls: string[] = [];
      const tiers: Record<number, { albedo: string; orm: string; normal: string }> = {};
      for (const tier of def.tiers) {
        const u = (map: TextureMapName): string => {
          const url = URL.createObjectURL(rec.files.get(`${map}.${tier}`) as Blob);
          urls.push(url);
          return url;
        };
        tiers[tier] = { albedo: u('albedo'), orm: u('orm'), normal: u('normal') };
      }
      this.urls.set(id, urls);
      registerTextureSet({ id, def, tiers });
    }
    this.onChange?.();
  }

  /**
   * Keep a set in the project's store and register it. Resolves false (and keeps nothing) when the files break the caps; the
   * world record (`setMeta textures`) is the caller's patch.
   */
  async add(set: TextureSetFilesInput): Promise<{ ok: true } | { ok: false; error: string }> {
    const err = checkSetFiles(set.def, set.files);
    if (err) return { ok: false, error: err };
    try {
      const store = await this.open();
      await store.put(set.id, set.def, set.files);
    } catch (e) {
      // The session still draws it; it just will not survive a reload.
      log.warn('texture set not persisted', e);
    }
    this.register(set);
    this.onChange?.();
    return { ok: true };
  }

  private register(set: TextureSetFilesInput): void {
    const old = this.urls.get(set.id);
    if (old) for (const u of old) URL.revokeObjectURL(u);
    const urls: string[] = [];
    const tiers: Record<number, { albedo: string; orm: string; normal: string }> = {};
    for (const tier of set.def.tiers) {
      const url = (map: TextureMapName): string => {
        const f = set.files.find((x) => x.tier === tier && x.map === map);
        const u = URL.createObjectURL(new Blob([f?.bytes as Uint8Array<ArrayBuffer>], { type: 'image/webp' }));
        urls.push(u);
        return u;
      };
      tiers[tier] = { albedo: url('albedo'), orm: url('orm'), normal: url('normal') };
    }
    this.urls.set(set.id, urls);
    registerTextureSet({ id: set.id, def: set.def, tiers });
  }

  /** The stored files of a set (for packages); null when it is not in this browser's store. */
  async files(id: string): Promise<Array<{ name: string; data: Uint8Array }> | null> {
    const rec = await (await this.open()).get(id).catch(() => null);
    if (!rec) return null;
    const out: Array<{ name: string; data: Uint8Array }> = [];
    for (const tier of rec.def.tiers) for (const map of ['albedo', 'orm', 'normal'] as const) out.push({ name: `${id}.${map}.${tier}.webp`, data: new Uint8Array(await (rec.files.get(`${map}.${tier}`) as Blob).arrayBuffer()) });
    return out;
  }

  /** Forget a set (store and registry). */
  async remove(id: string): Promise<void> {
    for (const u of this.urls.get(id) ?? []) URL.revokeObjectURL(u);
    this.urls.delete(id);
    unregisterTextureSet(id);
    await (await this.open()).remove(id).catch(() => undefined);
  }

  dispose(): void {
    this.disposed = true;
    for (const c of this.cleanups.splice(0)) c();
    for (const [id, urls] of this.urls) {
      for (const u of urls) URL.revokeObjectURL(u);
      unregisterTextureSet(id);
    }
    this.urls.clear();
  }
}

export { TEXTURE_TIERS };
