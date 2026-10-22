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

/** sRGB byte to linear (256 entries) and linear to sRGB byte (4096 entries). */
const TO_LINEAR = new Float32Array(256);
const TO_SRGB = new Uint8Array(4096);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
for (let i = 0; i < 4096; i++) {
  const l = i / 4095;
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  TO_SRGB[i] = Math.max(0, Math.min(255, Math.round(c * 255)));
}

function linearColor(hex: string | undefined): [number, number, number] | null {
  if (!hex || !HEX.test(hex)) return null;
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

const LUM_CLAMP_LO = 0.3;
const LUM_CLAMP_HI = 2.4;

/**
 * Recolour RGBA pixels in place toward `target` (linear RGB), keeping each
 * texel's own shading: `ref` is the region's mean luminance and `weight(x, y)`
 * the 0..1 strength of the recolour at that texel.
 */
export function recolorPixels(rgba: Uint8ClampedArray, width: number, height: number, target: readonly [number, number, number], ref: number, weight: (x: number, y: number) => number): void {
  const inv = 1 / Math.max(1e-4, ref);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = weight(x, y);
      if (w <= 0.004) continue;
      const i = (y * width + x) * 4;
      const r = TO_LINEAR[rgba[i] as number] as number;
      const g = TO_LINEAR[rgba[i + 1] as number] as number;
      const b = TO_LINEAR[rgba[i + 2] as number] as number;
      const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
      const k = Math.max(LUM_CLAMP_LO, Math.min(LUM_CLAMP_HI, lum * inv));
      const nr = r + (target[0] * k - r) * w;
      const ng = g + (target[1] * k - g) * w;
      const nb = b + (target[2] * k - b) * w;
      rgba[i] = TO_SRGB[Math.min(4095, Math.max(0, Math.round(nr * 4095)))] as number;
      rgba[i + 1] = TO_SRGB[Math.min(4095, Math.max(0, Math.round(ng * 4095)))] as number;
      rgba[i + 2] = TO_SRGB[Math.min(4095, Math.max(0, Math.round(nb * 4095)))] as number;
    }
  }
}

/** Weight function reading one mask channel of one half (0 = body, 1 = head) of the mask image. */
export function maskWeight(masks: TintMasks, half: 0 | 1, channel: 0 | 1, width: number, height: number): (x: number, y: number) => number {
  const halfW = masks.width >> 1;
  const sx = halfW / width;
  const sy = masks.height / height;
  return (x, y) => {
    const mx = Math.min(halfW - 1, Math.floor(x * sx)) + half * halfW;
    const my = Math.min(masks.height - 1, Math.floor(y * sy));
    return (masks.data[(my * masks.width + mx) * 4 + channel] as number) / 255;
  };
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

/** Decode a mask image file (webp, opaque) into pixels. Browser only. */
export async function decodeMasks(blob: Blob): Promise<TintMasks> {
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
