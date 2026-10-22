/**
 * Image codec of the lightmap files: WebP through the browser's own canvas (no dependency), with the raw form as the
 * fallback when a browser cannot encode WebP. Browser only; everything else about the asset is pure
 * (`lightmap-asset.ts`).
 */

type Canvas2D = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(w: number, h: number): Canvas2D | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
  } catch {
    /* no canvas */
  }
  return null;
}

/** Encode stacked RGBA (`size` × `2·size`, opaque) as WebP at `quality` (0..1); null when the browser cannot. */
export async function encodeWebp(stacked: Uint8Array, size: number, quality: number): Promise<Uint8Array | null> {
  const canvas = makeCanvas(size, size * 2);
  const ctx = canvas?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
  if (!canvas || !ctx) return null;
  try {
    ctx.putImageData(new ImageData(Uint8ClampedArray.from(stacked), size, size * 2), 0, 0);
    const blob: Blob | null =
      'convertToBlob' in canvas ? await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/webp', quality }) : await new Promise<Blob | null>((resolve) => (canvas as HTMLCanvasElement).toBlob(resolve, 'image/webp', quality));
    if (!blob || blob.type !== 'image/webp') return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

/** Decode WebP bytes to stacked RGBA of `size` × `2·size`; null when decoding fails or the image has another size. */
export async function decodeWebp(bytes: Uint8Array, size: number): Promise<Uint8Array | null> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes.slice().buffer], { type: 'image/webp' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    try {
      if (bmp.width !== size || bmp.height !== size * 2) return null;
      const canvas = makeCanvas(size, size * 2);
      const ctx = canvas?.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
      if (!canvas || !ctx) return null;
      ctx.drawImage(bmp, 0, 0);
      const data = ctx.getImageData(0, 0, size, size * 2).data;
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
    } finally {
      bmp.close();
    }
  } catch {
    return null;
  }
}
