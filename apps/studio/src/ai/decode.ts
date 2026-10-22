/**
 * Image data URL to pixels in the browser, reduced so the longer side is at most `maxSide`. The photo flow measures
 * the aspect of a reference photo and compares renders with it; a failed decode only costs the objective score.
 */
import { createLogger } from '../lib/log';
import { dataUrlToBlob } from './quality';

const log = createLogger('decode');

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Decoded pixels (RGBA, row-major). */
export interface DecodedImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Decode `dataUrl` (PNG, JPEG or WebP) at most `maxSide` pixels on its longer side; null when it cannot be decoded. */
export async function decodeImageData(dataUrl: string, maxSide: number): Promise<DecodedImage | null> {
  try {
    const blob = dataUrlToBlob(dataUrl);
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    try {
      const side = Math.max(16, Math.min(1024, Math.round(maxSide)));
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Ctx | null;
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h);
      return { width: w, height: h, data: px.data };
    } finally {
      bitmap.close();
    }
  } catch (err) {
    log.warn('image decode unavailable', err);
    return null;
  }
}

/**
 * Tiles laid left to right in one PNG: each cropped to its `box` (0..1 of the image) and scaled to one height, the longer
 * side at most `maxSide`, a thin gap between them. Null when an image cannot be decoded or no canvas is available.
 */
export async function composeTiles(tiles: ReadonlyArray<{ dataUrl: string; box?: readonly [number, number, number, number] }>, maxSide = 1024): Promise<string | null> {
  const bitmaps: ImageBitmap[] = [];
  try {
    const crops: Array<{ b: ImageBitmap; sx: number; sy: number; sw: number; sh: number }> = [];
    for (const t of tiles.slice(0, 4)) {
      const blob = dataUrlToBlob(t.dataUrl);
      if (!blob) return null;
      const b = await createImageBitmap(blob);
      bitmaps.push(b);
      const [x0, y0, x1, y1] = t.box ?? [0, 0, 1, 1];
      const sx = Math.max(0, Math.min(b.width - 1, Math.floor(x0 * b.width)));
      const sy = Math.max(0, Math.min(b.height - 1, Math.floor(y0 * b.height)));
      crops.push({ b, sx, sy, sw: Math.max(1, Math.min(b.width - sx, Math.ceil((x1 - x0) * b.width))), sh: Math.max(1, Math.min(b.height - sy, Math.ceil((y1 - y0) * b.height))) });
    }
    if (crops.length === 0) return null;
    const gap = 6;
    const h0 = Math.min(...crops.map((c) => c.sh));
    const widths = crops.map((c) => (c.sw / c.sh) * h0);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (crops.length - 1);
    const k = Math.min(3, Math.max(64, Math.min(1024, maxSide)) / Math.max(total, h0));
    const W = Math.max(1, Math.round(total * k));
    const H = Math.max(1, Math.round(h0 * k));
    const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = canvas.getContext('2d') as Ctx | null;
    if (!ctx) return null;
    ctx.fillStyle = '#202020';
    ctx.fillRect(0, 0, W, H);
    let x = 0;
    crops.forEach((c, i) => {
      const w = Math.round((widths[i] ?? 0) * k);
      ctx.drawImage(c.b, c.sx, c.sy, c.sw, c.sh, x, 0, w, H);
      x += w + Math.round(gap * k);
    });
    if (canvas instanceof HTMLCanvasElement) return canvas.toDataURL('image/png');
    const out = await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
    return await new Promise<string | null>((res) => {
      const r = new FileReader();
      r.onload = () => res(typeof r.result === 'string' ? r.result : null);
      r.onerror = () => res(null);
      r.readAsDataURL(out);
    });
  } catch (err) {
    log.warn('image compose unavailable', err);
    return null;
  } finally {
    for (const b of bitmaps) b.close();
  }
}
