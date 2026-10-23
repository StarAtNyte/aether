/**
 * The depth network behind `measure_room`: Depth Anything V2 Small (Apache-2.0, ONNX, unsigned 8-bit weights, 27 MB) run on the CPU
 * with onnxruntime-web (WebAssembly; the same code runs in Node and in a browser). Offline-safe by design: every failure
 * (no network, a wrong checksum, a runtime that cannot start) returns `{ ok: false, reason }` and the photo flow goes on without
 * the advisory numbers.
 *
 * The weights are not in git. They are fetched on first use from a pinned Hugging Face revision, checked against a pinned
 * SHA-256 and cached (Node: `$AETHER_HOME/models` or `~/.local/share/aether/models`; browser: the Cache API).
 * `AETHER_DEPTH=off` turns the tool off; `AETHER_DEPTH_MODEL=/path/model.onnx` uses a local copy (still checked).
 * Licence, source and checksum are recorded in docs/THIRD_PARTY.md.
 */
import type { DisparityMap } from '@aether/arch/photo';

export const DEPTH_MODEL = {
  name: 'depth-anything-v2-small-uint8',
  file: 'dav2s-uint8.onnx',
  url: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model_uint8.onnx',
  sha256: 'fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d',
  bytes: 27258801,
} as const;

export interface DepthRaster {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export type DepthResult = { ok: true; map: DisparityMap; image: string } | { ok: false; reason: string };

const isNode = typeof process !== 'undefined' && !!process.versions?.node && typeof (globalThis as { window?: unknown }).window === 'undefined';
/** Hides a Node-only module name from the browser bundler. */
const nodeImport = (name: string): Promise<any> => import(/* @vite-ignore */ name);

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The checked weights, or the reason they are not available. */
export async function loadDepthWeights(): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }> {
  const env = (k: string): string | undefined => (typeof process !== 'undefined' ? process.env?.[k] : undefined);
  if (env('AETHER_DEPTH') === 'off') return { ok: false, reason: 'depth estimation is turned off (AETHER_DEPTH=off)' };
  try {
    if (isNode) {
      const fs = await nodeImport('node:fs/promises');
      const path = await nodeImport('node:path');
      const os = await nodeImport('node:os');
      const dir = path.join(env('AETHER_HOME') ?? path.join(os.homedir(), '.local', 'share', 'aether'), 'models');
      const file = env('AETHER_DEPTH_MODEL') ?? path.join(dir, DEPTH_MODEL.file);
      const cached = await fs.readFile(file).then((b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength), () => null);
      if (cached && (await sha256Hex(cached)) === DEPTH_MODEL.sha256) return { ok: true, bytes: cached };
      if (env('AETHER_DEPTH_MODEL')) return { ok: false, reason: `AETHER_DEPTH_MODEL is missing or its SHA-256 differs from the pinned ${DEPTH_MODEL.sha256.slice(0, 12)}` };
      const got = await download();
      if (!got.ok) return got;
      await fs.mkdir(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.part`;
      await fs.writeFile(tmp, got.bytes);
      await fs.rename(tmp, file);
      return got;
    }
    const cache = typeof caches !== 'undefined' ? await caches.open('aether-models') : null;
    const hit = cache ? await cache.match(DEPTH_MODEL.url) : null;
    if (hit) {
      const bytes = new Uint8Array(await hit.arrayBuffer());
      if ((await sha256Hex(bytes)) === DEPTH_MODEL.sha256) return { ok: true, bytes };
    }
    const got = await download();
    if (got.ok && cache) await cache.put(DEPTH_MODEL.url, new Response(got.bytes as unknown as BodyInit)).catch(() => undefined);
    return got;
  } catch (err) {
    return { ok: false, reason: `the depth model could not be loaded (${err instanceof Error ? err.message : String(err)})` };
  }
}

async function download(): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }> {
  try {
    const res = await fetch(DEPTH_MODEL.url, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) return { ok: false, reason: `the depth model is not cached and could not be fetched (HTTP ${res.status})` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if ((await sha256Hex(bytes)) !== DEPTH_MODEL.sha256) return { ok: false, reason: 'the downloaded depth model does not match its pinned SHA-256 and was discarded' };
    return { ok: true, bytes };
  } catch (err) {
    return { ok: false, reason: `the depth model is not cached and could not be fetched (${err instanceof Error ? err.message : String(err)}); offline, so no depth numbers` };
  }
}

type Session = { run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>; inputNames: readonly string[]; outputNames: readonly string[] };
let sessionPromise: Promise<{ ort: any; session: Session } | { reason: string }> | null = null;

function getSession(): Promise<{ ort: any; session: Session } | { reason: string }> {
  sessionPromise ??= (async () => {
    const w = await loadDepthWeights();
    if (!w.ok) return { reason: w.reason };
    try {
      const ort: any = await import('onnxruntime-web');
      const cores = isNode ? ((await nodeImport('node:os')).availableParallelism?.() ?? 2) : (navigator.hardwareConcurrency ?? 2);
      ort.env.wasm.numThreads = Math.max(1, Math.min(4, Math.floor(cores / 2)));
      ort.env.logLevel = 'error';
      const session = (await ort.InferenceSession.create(w.bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })) as Session;
      return { ort, session };
    } catch (err) {
      return { reason: `the depth runtime could not start (${err instanceof Error ? err.message : String(err)})` };
    }
  })();
  return sessionPromise;
}

/** Forget a failed start (so a later call can retry, for example once the network is back). */
export function resetDepthSession(): void {
  sessionPromise = null;
}

/** Bilinear resize of RGBA to w x h, returning planar CHW floats normalised with the ImageNet mean and deviation. */
export function preprocess(img: DepthRaster, w: number, h: number): Float32Array {
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const out = new Float32Array(3 * w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(img.height - 1, ((y + 0.5) * img.height) / h - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(img.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, Math.min(img.width - 1, ((x + 0.5) * img.width) / w - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(img.width - 1, x0 + 1);
      const tx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const p = (yy: number, xx: number): number => img.data[(yy * img.width + xx) * 4 + c] as number;
        const v = (p(y0, x0) * (1 - tx) + p(y0, x1) * tx) * (1 - ty) + (p(y1, x0) * (1 - tx) + p(y1, x1) * tx) * ty;
        out[c * w * h + y * w + x] = (v / 255 - (mean[c] as number)) / (std[c] as number);
      }
    }
  }
  return out;
}

/** Network input size for a picture: long side near 518, both sides multiples of 14 (the model's patch size). */
export function inputSize(width: number, height: number): { w: number; h: number } {
  const long = 518;
  const s = long / Math.max(width, height);
  const r = (v: number): number => Math.max(14, Math.round((v * s) / 14) * 14);
  return { w: r(width), h: r(height) };
}

/** Relative depth of the photo. `raster` is RGBA; a larger one is fine (it is resized). */
export async function estimateDepthMap(raster: DepthRaster): Promise<DepthResult> {
  const s = await getSession();
  if ('reason' in s) {
    resetDepthSession();
    return { ok: false, reason: s.reason };
  }
  try {
    const { w, h } = inputSize(raster.width, raster.height);
    const input = new s.ort.Tensor('float32', preprocess(raster, w, h), [1, 3, h, w]);
    const out = await s.session.run({ [s.session.inputNames[0] as string]: input });
    const t = out[s.session.outputNames[0] as string] as { data: Float32Array; dims: readonly number[] };
    const oh = t.dims[t.dims.length - 2] as number;
    const ow = t.dims[t.dims.length - 1] as number;
    const map: DisparityMap = { width: ow, height: oh, data: t.data };
    return { ok: true, map, image: depthImage(map) };
  } catch (err) {
    return { ok: false, reason: `the depth network failed (${err instanceof Error ? err.message : String(err)})` };
  }
}

// ---- a depth picture the model can look at (PNG without compression, so no zlib is needed) ----

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = (CRC[(c ^ (b[i] as number)) & 255] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** RGB PNG (stored deflate blocks). */
export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  const blocks = Math.ceil(raw.length / 65535);
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z[0] = 0x78; z[1] = 0x01;
  let o = 2;
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * 65535, Math.min(raw.length, (i + 1) * 65535));
    z[o++] = i === blocks - 1 ? 1 : 0;
    z[o++] = part.length & 255; z[o++] = part.length >> 8;
    z[o++] = ~part.length & 255; z[o++] = (~part.length >> 8) & 255;
    z.set(part, o);
    o += part.length;
  }
  let a = 1, b = 0;
  for (let i = 0; i < raw.length; i++) { a = (a + (raw[i] as number)) % 65521; b = (b + a) % 65521; }
  const ad = ((b << 16) | a) >>> 0;
  z[o++] = ad >>> 24; z[o++] = (ad >>> 16) & 255; z[o++] = (ad >>> 8) & 255; z[o++] = ad & 255;
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const c = new Uint8Array(12 + data.length);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
    c.set(data, 8);
    dv.setUint32(8 + data.length, crc32(c.subarray(4, 8 + data.length)));
    return c;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z.subarray(0, o)), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let k = 0;
  for (const p of parts) { png.set(p, k); k += p.length; }
  return png;
}

function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Near = warm, far = cool (a simple turbo-like ramp), as a PNG data URL. */
export function depthImage(map: DisparityMap): string {
  const v = Array.from({ length: map.width * map.height }, (_, i) => Number(map.data[i])).sort((a, b) => a - b);
  const lo = v[Math.floor(v.length * 0.02)] as number;
  const hi = v[Math.floor(v.length * 0.98)] as number;
  const rgb = new Uint8Array(map.width * map.height * 3);
  for (let i = 0; i < map.width * map.height; i++) {
    const t = Math.max(0, Math.min(1, (Number(map.data[i]) - lo) / (hi - lo || 1)));
    const ch = (c: number): number => Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * (t - c)))));
    rgb[i * 3] = ch(0.75); rgb[i * 3 + 1] = ch(0.5); rgb[i * 3 + 2] = ch(0.25);
  }
  return `data:image/png;base64,${toBase64(encodePng(map.width, map.height, rgb))}`;
}
