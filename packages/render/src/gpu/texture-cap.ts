/**
 * Largest image texture an integrated GPU uploads.
 *
 * An integrated GPU holds its textures in system memory, next to the decoded copy the page keeps for each. A hillside
 * town with twenty walking characters carried 75 colour / normal / roughness maps of 1024 px (5.6 MB each with mips on
 * the GPU, as much again decoded): most of a 5 GB browser on a 14 GB laptop. Here an image texture larger than the cap is
 * drawn once into a canvas of the capped size just before its first upload, and the texture keeps only that copy. Render
 * targets, compressed, data, cube, array, video and canvas-backed (generated) textures are left alone.
 */

type Drawable = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

interface TextureLike {
  image: unknown;
  isRenderTargetTexture?: boolean;
  isDepthTexture?: boolean;
  isFramebufferTexture?: boolean;
  isCompressedTexture?: boolean;
  isDataTexture?: boolean;
  isCubeTexture?: boolean;
  isDataArrayTexture?: boolean;
  isData3DTexture?: boolean;
  isVideoTexture?: boolean;
  isCanvasTexture?: boolean;
  userData?: Record<string, unknown>;
}

const resized = new WeakMap<object, Drawable>();

function drawable(image: unknown): image is Drawable {
  if (!image || typeof image !== 'object') return false;
  return (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) || (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement);
}

/** The size an image of `w` × `h` is drawn at under `cap` (aspect kept, at least 1 px). Pure. */
export function cappedSize(w: number, h: number, cap: number): [number, number] {
  const m = Math.max(w, h);
  if (!(cap > 0) || !(m > cap)) return [w, h];
  const k = cap / m;
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** Draw `image` at its capped size (one canvas per source image, shared by every texture that uses it). */
function shrink(image: Drawable, cap: number): Drawable | null {
  const hit = resized.get(image);
  if (hit) return hit;
  const w = (image as { width: number }).width, h = (image as { height: number }).height;
  const [tw, th] = cappedSize(w, h, cap);
  if (tw === w && th === h) return null;
  const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(tw, th) : Object.assign(document.createElement('canvas'), { width: tw, height: th });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image as CanvasImageSource, 0, 0, tw, th);
  resized.set(image, canvas);
  return canvas;
}

/** Install the cap on a renderer (0 or less: none). Safe to call again with a new cap. */
export function capTextureSize(renderer: unknown, cap: number): void {
  const r = renderer as { _textures?: { updateTexture?: (t: TextureLike, o?: unknown) => unknown; __aetherCap?: number; __aetherCapped?: boolean } };
  const textures = r._textures;
  if (!textures || typeof textures.updateTexture !== 'function') return;
  textures.__aetherCap = cap;
  if (textures.__aetherCapped) return;
  textures.__aetherCapped = true;
  const update = textures.updateTexture;
  textures.updateTexture = function (this: typeof textures, t: TextureLike, o?: unknown): unknown {
    const c = this.__aetherCap ?? 0;
    if (c > 0 && t && !t.isRenderTargetTexture && !t.isDepthTexture && !t.isFramebufferTexture && !t.isCompressedTexture && !t.isDataTexture && !t.isCubeTexture && !t.isDataArrayTexture && !t.isData3DTexture && !t.isVideoTexture && !t.isCanvasTexture && t.userData?.['aetherFullSize'] !== true && drawable(t.image)) {
      try {
        const small = shrink(t.image, c);
        if (small) t.image = small;
      } catch {
        // Upload the original.
      }
    }
    return update.call(this, t, o);
  };
}

/** The cap installed on a renderer by {@link capTextureSize} (0: none). Compressed files cannot be shrunk on upload, so loaders pick a lighter file instead. */
export function installedTextureCap(renderer: unknown): number {
  const cap = (renderer as { _textures?: { __aetherCap?: number } } | null)?._textures?.__aetherCap;
  return typeof cap === 'number' && cap > 0 ? cap : 0;
}
