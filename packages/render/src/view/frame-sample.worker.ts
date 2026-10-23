/**
 * Frame-sample worker (module worker): reduces a 16x16 snapshot of the viewport to the numbers the black-screen watchdog
 * judges. Reading an image back waits for the GPU to finish the frame, which can take seconds while the first programs
 * build; here that wait stalls this worker, not the page.
 */
import { measureFrame, type FrameSample } from '../gpu/watchdog';

interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

scope.onmessage = (e: MessageEvent): void => {
  const d = e.data as { id?: unknown; bitmap?: unknown } | null;
  const id = typeof d?.id === 'number' ? d.id : -1;
  let sample: FrameSample | null = null;
  try {
    const bmp = d?.bitmap as ImageBitmap | undefined;
    if (bmp && typeof OffscreenCanvas === 'function') {
      canvas ??= new OffscreenCanvas(16, 16);
      ctx ??= canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(bmp, 0, 0, 16, 16);
        sample = measureFrame(ctx.getImageData(0, 0, 16, 16).data);
      }
      bmp.close();
    }
  } catch {
    sample = null;
  }
  scope.postMessage({ id, sample });
};
