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
