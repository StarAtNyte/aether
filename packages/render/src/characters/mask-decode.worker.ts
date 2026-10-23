/**
 * Mask-decode worker (module worker): decodes a character mask image (webp) into RGBA pixels off the page. The decode and
 * the read-back of a 2048 px image cost hundreds of milliseconds on the main thread; here they stall only this worker.
 */
interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = async (e: MessageEvent): Promise<void> => {
  const { id, blob } = e.data as { id: number; blob: Blob };
  try {
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    try {
      const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2d context for the character masks');
      ctx.drawImage(bmp, 0, 0);
      const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
      scope.postMessage({ id, width: img.width, height: img.height, data: img.data.buffer }, [img.data.buffer]);
    } finally {
      bmp.close();
    }
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
export {};
