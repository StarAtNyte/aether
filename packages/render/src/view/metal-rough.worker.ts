/**
 * Metal-rough merge worker (module worker): the glTF export keeps roughness in the green channel and metalness in the blue
 * channel of one texture. three's exporter builds that texture on the main thread (a full-size read-back per texture, seconds
 * for a furnished room); this does the same composite here, off the page. Same rules as the exporter: the base is cyan
 * (no roughness map reads as 1, no metalness map as 1), sRGB maps are converted to linear.
 */
interface Source {
  bitmap?: ImageBitmap;
  data?: Uint8ClampedArray;
  width: number;
  height: number;
  srgb: boolean;
}
interface Request {
  id: number;
  rough: Source | null;
  metal: Source | null;
}
interface WorkerScope {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const lut = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 256;
  lut[i] = Math.floor((c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4)) * 256);
}

/** RGBA bytes of a source scaled to w x h. */
function pixels(s: Source, w: number, h: number, ctx: OffscreenCanvasRenderingContext2D): Uint8ClampedArray {
  const c = ctx.canvas;
  c.width = w;
  c.height = h;
  ctx.clearRect(0, 0, w, h);
  if (s.bitmap) {
    ctx.drawImage(s.bitmap, 0, 0, w, h);
    s.bitmap.close();
  } else if (s.data) {
    const tmp = new OffscreenCanvas(s.width, s.height);
    const t = tmp.getContext('2d');
    if (!t) throw new Error('no 2d context');
    t.putImageData(new ImageData(s.data as Uint8ClampedArray<ArrayBuffer>, s.width, s.height), 0, 0);
    ctx.drawImage(tmp, 0, 0, w, h);
  }
  return ctx.getImageData(0, 0, w, h).data;
}

scope.onmessage = (e: MessageEvent<Request>): void => {
  const { id, rough, metal } = e.data;
  try {
    const w = Math.max(rough?.width ?? 0, metal?.width ?? 0);
    const h = Math.max(rough?.height ?? 0, metal?.height ?? 0);
    if (w <= 0 || h <= 0) throw new Error('empty maps');
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < out.length; i += 4) {
      out[i] = 0;
      out[i + 1] = 255;
      out[i + 2] = 255;
      out[i + 3] = 255;
    }
    if (metal) {
      const d = pixels(metal, w, h, ctx);
      for (let i = 2; i < d.length; i += 4) out[i] = metal.srgb ? (lut[d[i] as number] as number) : (d[i] as number);
    }
    if (rough) {
      const d = pixels(rough, w, h, ctx);
      for (let i = 1; i < d.length; i += 4) out[i] = rough.srgb ? (lut[d[i] as number] as number) : (d[i] as number);
    }
    scope.postMessage({ id, data: out.buffer, width: w, height: h }, [out.buffer]);
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
export {};
