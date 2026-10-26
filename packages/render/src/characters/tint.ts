/**
 * Outfit and hair recolouring for the cast.
 *
 * Each body ships a small mask image (built offline from the mesh and the
 * colour texture): left half = body map (R top: jacket, shirt, dress;
 * G bottom: trousers, skirt), right half = head map (R hair); zero on skin,
 * shoes and hands. A variant ("the same man in a red jacket") is baked on the
 * CPU once, when it is first needed: masked texels move to the target colour
 * while keeping their own shading (the target is scaled by the texel's
 * luminance over the region's mean luminance, in linear light), so a green
 * coat still shows its folds and seams. The result is an ordinary base
 * colour texture, so every backend and every material path renders it the same.
 *
 * Variants share textures and materials by key (`bodyId|top|bottom|hair`):
 * a crowd of red guards uploads one set.
 */
import { CanvasTexture, Color, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace, type Material, type MeshStandardMaterial, type Object3D, type Texture } from 'three';

import { recolorPixels, maskWeight } from './tint-pixels';
export { recolorPixels, maskWeight } from './tint-pixels';
import { TintBakeClient, type TintOperation } from './tint-bake-client';

/** Tint request. Hex strings (#rrggbb, sRGB); omitted parts keep the original colours. */
export interface Tint {
  top?: string;
  bottom?: string;
  hair?: string;
}

/** Mean luminance (linear) of the recolourable regions, from the build. */
export interface TintRefs {
  top: number;
  bottom: number;
  hair: number;
}

/** Fallback region luminances when the build recorded none. */
export const DEFAULT_REFS: TintRefs = { top: 0.12, bottom: 0.1, hair: 0.06 };

/** The decoded mask image: RGBA bytes, left half body, right half head. */
export interface TintMasks {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Stable key of a tint (for caches). */
export function tintKey(t: Tint | undefined): string {
  if (!t) return '';
  return `${(t.top ?? '').toLowerCase()}|${(t.bottom ?? '').toLowerCase()}|${(t.hair ?? '').toLowerCase()}`;
}

/** True when a tint changes anything. */
export function hasTint(t: Tint | undefined): boolean {
  return Boolean(t && (t.top || t.bottom || t.hair));
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function linearColor(hex: string | undefined): [number, number, number] | null {
  if (!hex || !HEX.test(hex)) return null;
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

/** Recolour a body base-colour image in place (top and bottom regions). */
export function recolorBody(rgba: Uint8ClampedArray, width: number, height: number, masks: TintMasks, tint: Tint, refs: TintRefs): void {
  const top = linearColor(tint.top);
  const bottom = linearColor(tint.bottom);
  if (top) recolorPixels(rgba, width, height, top, refs.top, maskWeight(masks, 0, 0, width, height));
  if (bottom) recolorPixels(rgba, width, height, bottom, refs.bottom, maskWeight(masks, 0, 1, width, height));
}

/** Recolour a head base-colour image in place (the painted hair). */
export function recolorHead(rgba: Uint8ClampedArray, width: number, height: number, masks: TintMasks, tint: Tint, refs: TintRefs): void {
  const hair = linearColor(tint.hair);
  if (hair) recolorPixels(rgba, width, height, hair, refs.hair, maskWeight(masks, 1, 0, width, height));
}

/** Recolour the hair cards (the whole image is hair; alpha is kept). */
export function recolorHairCards(rgba: Uint8ClampedArray, width: number, height: number, tint: Tint, refs: TintRefs): void {
  const hair = linearColor(tint.hair);
  if (hair) recolorPixels(rgba, width, height, hair, refs.hair, () => 1);
}

let maskWorker: Worker | null = null;
let maskId = 0;
const maskWaiting = new Map<number, { resolve(m: TintMasks): void; reject(e: Error): void }>();

/** The shared decode worker (null where workers are unavailable or it failed once). */
function maskDecoder(): Worker | null {
  if (maskWorker) return maskWorker;
  if (typeof Worker === 'undefined') return null;
  try {
    const w = new Worker(new URL('./mask-decode.worker.ts', import.meta.url), { type: 'module', name: 'aether-mask-decode' });
    w.onmessage = (e: MessageEvent): void => {
      const d = e.data as { id: number; width?: number; height?: number; data?: ArrayBuffer; error?: string };
      const job = maskWaiting.get(d.id);
      if (!job) return;
      maskWaiting.delete(d.id);
      if (d.data && d.width && d.height) job.resolve({ width: d.width, height: d.height, data: new Uint8ClampedArray(d.data) });
      else job.reject(new Error(d.error ?? 'mask decode failed'));
    };
    w.onerror = (): void => {
      for (const job of maskWaiting.values()) job.reject(new Error('mask decode worker failed'));
      maskWaiting.clear();
      w.terminate();
      maskWorker = null;
    };
    maskWorker = w;
    return w;
  } catch {
    return null;
  }
}

/** Decode a mask image file (webp, opaque) into pixels, in a worker where there is one. Browser only. */
export async function decodeMasks(blob: Blob): Promise<TintMasks> {
  const w = maskDecoder();
  if (w) {
    try {
      return await new Promise<TintMasks>((resolve, reject) => {
        const id = ++maskId;
        maskWaiting.set(id, { resolve, reject });
        w.postMessage({ id, blob });
      });
    } catch {
      // Fall through to the page's own decode.
    }
  }
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context for the character masks');
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { width: img.width, height: img.height, data: img.data };
  } finally {
    bmp.close();
  }
}

/**
 * A recoloured copy of a texture: its image is drawn to a canvas, `apply`
 * edits the pixels, and the result is a new sRGB texture with the source's
 * sampling settings. Browser only. Returns null when the source has no
 * drawable image.
 */
export function bakeTexture(source: Texture, apply: (rgba: Uint8ClampedArray, width: number, height: number) => void, pixels?: CanvasImageSource & { width: number; height: number }): CanvasTexture | null {
  // A block-compressed (KTX2) map has no drawable image: the caller passes the original image instead.
  if ((source as { isCompressedTexture?: boolean }).isCompressedTexture && !pixels) return null;
  const image = (pixels ?? source.image) as { width?: number; height?: number } | null;
  if (!image || !image.width || !image.height) return null;
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image as CanvasImageSource, 0, 0);
  const img = ctx.getImageData(0, 0, image.width, image.height);
  apply(img.data, img.width, img.height);
  ctx.putImageData(img, 0, 0);
  return tintTexture(canvas, source);
}

/** Apply the existing tint sampling policy to a newly baked canvas. */
function tintTexture(canvas: OffscreenCanvas, source: Texture): CanvasTexture {
  const t = new CanvasTexture(canvas as unknown as HTMLCanvasElement);
  t.colorSpace = SRGBColorSpace;
  t.flipY = source.flipY;
  t.wrapS = source.wrapS;
  t.wrapT = source.wrapT;
  t.anisotropy = Math.max(4, source.anisotropy);
  // Always a full mip chain: a minified photographic texture without one shimmers as salt-and-pepper noise.
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.premultiplyAlpha = false;
  t.channel = source.channel;
  t.needsUpdate = true;
  return t;
}

/** Which texture set of the model a material is (from the names the build gives them). */
export type Part = 'body' | 'head' | 'hair';

/** The part a material belongs to. */
export function partOf(material: Material): Part {
  return /hair/i.test(material.name) ? 'hair' : /head/i.test(material.name) ? 'head' : 'body';
}

/**
 * Clone `source` with a recoloured base colour map for its part. The baked
 * texture is returned too so the owner can dispose it. The source is untouched.
 */
export function tintedMaterial(source: MeshStandardMaterial, part: Part, tint: Tint, refs: TintRefs, masks: TintMasks | null, original?: ImageBitmap | null): { material: MeshStandardMaterial; texture: CanvasTexture | null } {
  const m = source.clone();
  m.name = `${source.name}-tint`;
  if (!source.map) return { material: m, texture: null };
  let apply: ((rgba: Uint8ClampedArray, w: number, h: number) => void) | null = null;
  if (part === 'hair' && tint.hair) apply = (px, w, h) => recolorHairCards(px, w, h, tint, refs);
  else if (part === 'head' && tint.hair && masks) apply = (px, w, h) => recolorHead(px, w, h, masks, tint, refs);
  else if (part === 'body' && (tint.top || tint.bottom) && masks) apply = (px, w, h) => recolorBody(px, w, h, masks, tint, refs);
  if (!apply) return { material: m, texture: null };
  const texture = bakeTexture(source.map, apply, original ?? undefined);
  if (texture) m.map = texture;
  return { material: m, texture };
}

const tintBakes = new TintBakeClient();

/** Bake readback and recoloring off-thread; source images and textures remain usable by other variants. */
export async function tintedMaterialAsync(source: MeshStandardMaterial, part: Part, tint: Tint, refs: TintRefs, masks: TintMasks | null, original?: ImageBitmap | null): Promise<ReturnType<typeof tintedMaterial>> {
  const fallback = async (): Promise<ReturnType<typeof tintedMaterial>> => {
    // Worker failure must not join every queued variant into one uninterrupted microtask chain.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    return tintedMaterial(source, part, tint, refs, masks, original);
  };
  if (!tintBakes.available || !source.map || ((source.map as Texture & { isCompressedTexture?: boolean }).isCompressedTexture && !original)) return fallback();
  const operations: TintOperation[] = [];
  if (part === 'hair' && tint.hair) {
    const target = linearColor(tint.hair); if (target) operations.push({ target, ref: refs.hair });
  } else if (part === 'head' && tint.hair && masks) {
    const target = linearColor(tint.hair); if (target) operations.push({ target, ref: refs.hair, half: 1, channel: 0 });
  } else if (part === 'body' && (tint.top || tint.bottom) && masks) {
    const top = linearColor(tint.top), bottom = linearColor(tint.bottom);
    if (top) operations.push({ target: top, ref: refs.top, half: 0, channel: 0 });
    if (bottom) operations.push({ target: bottom, ref: refs.bottom, half: 0, channel: 1 });
  }
  if (!operations.length) return fallback();
  const image = (original ?? source.map.image) as (ImageBitmapSource & { width: number; height: number }) | null;
  if (!image?.width || !image?.height) return fallback();
  let owned: ImageBitmap | null = null;
  try {
    const bitmap = image instanceof ImageBitmap ? image : (owned = await createImageBitmap(image));
    const result = await tintBakes.bake(bitmap, masks, operations);
    if (!result) return fallback();
    const canvas = new OffscreenCanvas(result.width, result.height), ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return fallback();
    ctx.putImageData(new ImageData(result.pixels, result.width, result.height), 0, 0);
    const texture = tintTexture(canvas, source.map), material = source.clone();
    material.name = `${source.name}-tint`; material.map = texture;
    return { material, texture };
  } catch { return fallback(); }
  finally { owned?.close(); }
}

/** Collect the distinct materials of a model. */
export function materialsOf(root: Object3D): Material[] {
  const set = new Set<Material>();
  root.traverse((o) => {
    const mesh = o as { isMesh?: boolean; material?: Material | Material[] };
    if (!mesh.isMesh || !mesh.material) return;
    if (Array.isArray(mesh.material)) for (const m of mesh.material) set.add(m);
    else set.add(mesh.material);
  });
  return [...set];
}

interface GlbJson {
  materials?: Array<{ name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index?: number } } }>;
  textures?: Array<{ source?: number; extensions?: Record<string, { source?: number } | undefined> }>;
  images?: Array<{ bufferView?: number; mimeType?: string }>;
  bufferViews?: Array<{ byteOffset?: number; byteLength: number }>;
}

/** Largest original body file fetched for its pixels (bytes). */
const MAX_ORIGINAL_BYTES = 32 * 1024 * 1024;
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;

/**
 * The embedded base colour images of a GLB by material name (pure: no decoding). Null when the bytes are not
 * a GLB with a JSON chunk. Images inside `EXT_texture_webp` count as the texture's source.
 */
export function glbBaseColourImages(buf: Uint8Array): Map<string, { bytes: Uint8Array; mime: string }> | null {
  if (buf.byteLength < 28) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) return null;
  const jsonLen = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK || 20 + jsonLen + 8 > buf.byteLength) return null;
  let json: GlbJson;
  try {
    json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen))) as GlbJson;
  } catch {
    return null;
  }
  const binStart = 20 + jsonLen + 8;
  const out = new Map<string, { bytes: Uint8Array; mime: string }>();
  for (const mat of json.materials ?? []) {
    const ti = mat.pbrMetallicRoughness?.baseColorTexture?.index;
    if (ti === undefined || !mat.name || out.has(mat.name)) continue;
    const tex = json.textures?.[ti];
    const src = tex?.extensions?.['EXT_texture_webp']?.source ?? tex?.source;
    const img = src === undefined ? undefined : json.images?.[src];
    const bv = img?.bufferView === undefined ? undefined : json.bufferViews?.[img.bufferView];
    if (!img || !bv) continue;
    const start = binStart + (bv.byteOffset ?? 0);
    if (start + bv.byteLength > buf.byteLength) continue;
    out.set(mat.name, { bytes: buf.subarray(start, start + bv.byteLength), mime: img.mimeType ?? 'image/png' });
  }
  return out;
}

/**
 * Base colour images of the GLB at `url` by material name, decoded from its embedded images (no mesh decoding).
 * A body loaded from its KTX2 twin has block-compressed maps the CPU cannot read; outfit and hair tints are
 * baked from these original images instead. Browser only; null when the file cannot be read. The caller
 * closes the bitmaps.
 */
export async function originalBaseColours(url: string): Promise<Map<string, ImageBitmap> | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_ORIGINAL_BYTES) return null;
    const images = glbBaseColourImages(buf);
    if (!images) return null;
    const out = new Map<string, ImageBitmap>();
    for (const [name, img] of images) out.set(name, await createImageBitmap(new Blob([img.bytes.slice()], { type: img.mime }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
    return out;
  } catch {
    return null;
  }
}
