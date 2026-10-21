/**
 * Texture byte accounting. three.js tracks `renderer.info.memory.texturesSize` per uploaded texture,
 * but counts every compressed texture as 1 byte and leaves out generated mip levels. This corrects
 * both on one renderer's `info`: compressed textures count the bytes of their (transcoded) mip levels,
 * which is what the GPU holds, and textures whose mip chain the GPU generates count it (a third more).
 * The numbers feed `WorldRenderer.memoryStats().texturesMB` and the KTX2 measurements.
 */
import { LinearMipmapLinearFilter, LinearMipmapNearestFilter, NearestMipmapLinearFilter, NearestMipmapNearestFilter, type Texture } from 'three';

const MIPMAP_FILTERS: ReadonlySet<number> = new Set([LinearMipmapLinearFilter, LinearMipmapNearestFilter, NearestMipmapLinearFilter, NearestMipmapNearestFilter]);

interface MipLike {
  data?: { byteLength: number } | null;
}

/** Bytes of a compressed texture's mip levels (all layers), or null when it carries no level data. Pure. */
export function compressedBytes(tex: { mipmaps?: readonly MipLike[] | null; isCompressedTexture?: boolean }): number | null {
  if (!tex.isCompressedTexture || !tex.mipmaps || tex.mipmaps.length === 0) return null;
  let total = 0;
  for (const m of tex.mipmaps) total += m.data?.byteLength ?? 0;
  return total > 0 ? total : null;
}

/** True when the GPU builds the texture's mip chain itself (three's `generateMipmaps` with a mip filter, no explicit levels). Pure. */
export function generatesMips(tex: Pick<Texture, 'generateMipmaps' | 'minFilter'> & { mipmaps?: readonly unknown[] | null; isCompressedTexture?: boolean }): boolean {
  return !tex.isCompressedTexture && tex.generateMipmaps && MIPMAP_FILTERS.has(tex.minFilter) && (!tex.mipmaps || tex.mipmaps.length === 0);
}

interface InfoLike {
  _getTextureMemorySize?: (texture: Texture) => number;
  createTexture?: (texture: Texture) => void;
  destroyTexture?: (texture: Texture) => void;
}

/** What a live texture is: a render target, block-compressed, a decoded image or raw data. */
export type TextureKind = 'target' | 'compressed' | 'image' | 'data';

/** Bytes of the renderer's live textures by kind. */
export type TextureBreakdown = Record<TextureKind, { count: number; bytes: number }>;

/** The kind of a texture (pure). */
export function textureKind(t: { isRenderTargetTexture?: boolean; isDepthTexture?: boolean; isCompressedTexture?: boolean; image?: unknown }): TextureKind {
  if (t.isRenderTargetTexture || t.isDepthTexture) return 'target';
  if (t.isCompressedTexture) return 'compressed';
  const img = t.image as { data?: unknown } | null | undefined;
  if (img && typeof img === 'object' && !('data' in img && img.data)) return 'image';
  return 'data';
}

const PATCHED = new WeakSet<object>();
/**
 * Live textures per renderer `info`, held weakly: a texture the app drops without `dispose()` must still be
 * collectable (the tracker must never be what keeps it, or its GPU copy, alive).
 */
interface LiveSet {
  entries: Set<{ ref: WeakRef<Texture>; bytes: number; kind: TextureKind }>;
  byTexture: WeakMap<Texture, { ref: WeakRef<Texture>; bytes: number; kind: TextureKind }>;
}
const LIVE = new WeakMap<object, LiveSet>();

/** Live texture bytes of a renderer by kind (after {@link trackCompressedTextureBytes}); null when not tracked. */
export function textureBreakdown(renderer: { info: unknown }): TextureBreakdown | null {
  const live = LIVE.get(renderer.info as object);
  if (!live) return null;
  const out: TextureBreakdown = { target: { count: 0, bytes: 0 }, compressed: { count: 0, bytes: 0 }, image: { count: 0, bytes: 0 }, data: { count: 0, bytes: 0 } };
  for (const e of live.entries) {
    if (!e.ref.deref()) {
      live.entries.delete(e);
      continue;
    }
    const k = out[e.kind];
    k.count++;
    k.bytes += e.bytes;
  }
  return out;
}

/** Install the corrected accounting on `renderer.info` (idempotent; a no-op when three's internals differ). */
export function trackCompressedTextureBytes(renderer: { info: unknown }): void {
  const info = renderer.info as InfoLike | null;
  if (!info || PATCHED.has(info) || typeof info._getTextureMemorySize !== 'function') return;
  const base = info._getTextureMemorySize.bind(info);
  info._getTextureMemorySize = (texture: Texture): number => {
    const c = compressedBytes(texture as Texture & { mipmaps?: MipLike[]; isCompressedTexture?: boolean });
    if (c !== null) return c;
    const size = base(texture);
    return generatesMips(texture as Texture & { mipmaps?: unknown[] }) ? Math.round((size * 4) / 3) : size;
  };
  const live: LiveSet = { entries: new Set(), byTexture: new WeakMap() };
  LIVE.set(info, live);
  if (typeof info.createTexture === 'function' && typeof info.destroyTexture === 'function' && typeof WeakRef === 'function') {
    const create = info.createTexture.bind(info);
    const destroy = info.destroyTexture.bind(info);
    const size = info._getTextureMemorySize;
    info.createTexture = (texture: Texture): void => {
      create(texture);
      const e = { ref: new WeakRef(texture), bytes: size(texture), kind: textureKind(texture as Texture & { isRenderTargetTexture?: boolean; isDepthTexture?: boolean; isCompressedTexture?: boolean }) };
      live.entries.add(e);
      live.byTexture.set(texture, e);
    };
    info.destroyTexture = (texture: Texture): void => {
      destroy(texture);
      const e = live.byTexture.get(texture);
      if (e) live.entries.delete(e);
      live.byTexture.delete(texture);
    };
  }
  PATCHED.add(info);
}
