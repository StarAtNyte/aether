import { maskWeight, recolorPixels } from './tint-pixels';
import type { TintBakeResult, TintOperation } from './tint-bake-client';
import type { TintMasks } from './tint';
const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void };
scope.onmessage = event => {
  const { id, image, masks, operations } = event.data as { id: number; image: ImageBitmap; masks: TintMasks | null; operations: TintOperation[] };
  let result: TintBakeResult | null = null;
  try {
    if (!Number.isSafeInteger(id) || !(image instanceof ImageBitmap) || !image.width || !image.height || !Array.isArray(operations)
      || operations.length > 2 || operations.some(op => !Array.isArray(op.target) || op.target.length !== 3 || !op.target.every(Number.isFinite) || !Number.isFinite(op.ref)
        || (op.half !== undefined && (op.half !== 0 && op.half !== 1)) || (op.channel !== undefined && (op.channel !== 0 && op.channel !== 1)))) throw new Error('Invalid tint request');
    if (masks && (!(masks.data instanceof Uint8ClampedArray) || masks.width < 2 || masks.height < 1 || masks.data.length !== masks.width * masks.height * 4)) throw new Error('Invalid tint masks');
    const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('No worker canvas');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    for (const op of operations) {
      if (op.half !== undefined && (!masks || op.channel === undefined)) throw new Error('Missing tint mask');
      recolorPixels(pixels, image.width, image.height, op.target, op.ref, op.half === undefined ? () => 1 : maskWeight(masks!, op.half, op.channel!, image.width, image.height));
    }
    result = { width: image.width, height: image.height, pixels };
  } catch { /* Keep the synchronous path available when worker canvas support is incomplete. */ }
  finally { if (image instanceof ImageBitmap) image.close(); }
  scope.postMessage({ id, result }, result ? [result.pixels.buffer] : []);
};
