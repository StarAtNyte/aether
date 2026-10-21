/**
 * Optional image → 3D mesh providers (OFF by default). The reference
 * implementation targets TRELLIS.2 (MIT; 24 GB VRAM) running on the user's
 * own machine or their own Modal account behind a tiny HTTP wrapper — see
 * docs/IMAGE_TO_3D.md. Nothing is deployed or paid for by the project, and
 * no model code ships here: TRELLIS.2's GLB export imports nvdiffrast /
 * nvdiffrec (NVIDIA licences, research or evaluation only), which is the
 * wrapper's concern and the reason the route stays opt-in.
 *
 * Wire protocol (what the wrapper must implement):
 *   POST <endpoint>   Content-Type: application/json
 *   { "image": "<base64>", "mime": "image/png|image/jpeg|image/webp", "seed": <int>, "format": "glb" }
 *   → 200, Content-Type: model/gltf-binary (or application/octet-stream), body = GLB bytes
 *
 * Every returned model is untrusted: it must pass {@link validateGltf} (no
 * external URIs, budgets, sanitised names) before anyone renders it.
 */
import { validateGltf, type GltfReport } from './import/glb';
import { validateImage } from './import/image';

/** A provider that turns one image into a GLB model. */
export interface ImageTo3DProvider {
  readonly id: string;
  /** Generate a model; resolves to a validated, sanitised GLB. */
  generate(image: Uint8Array, opts?: { seed?: number; signal?: AbortSignal }): Promise<{ glb: Uint8Array; report: GltfReport }>;
}

/** Options of {@link createTrellisProvider}. */
export interface TrellisOptions {
  /** Wrapper endpoint: `http://127.0.0.1:…` / `http://localhost:…`, or an `https:` URL (e.g. the user's Modal app). */
  endpoint: string;
  /** Optional bearer token for the wrapper (never logged). */
  token?: string;
  /** Request timeout (default 300 s, max 900 s). */
  timeoutMs?: number;
  /** Largest accepted response (default 64 MB). */
  maxOutputBytes?: number;
  /** Injected fetch (tests). */
  fetch?: typeof fetch;
}

/** True for endpoints the provider may call: loopback over http, anything else only over https without credentials. */
export function isAllowedEndpoint(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]');
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Provider for a TRELLIS.2 HTTP wrapper (local or the user's own cloud account). */
export function createTrellisProvider(opts: TrellisOptions): ImageTo3DProvider {
  if (!isAllowedEndpoint(opts.endpoint)) throw new Error('image-to-3D endpoint must be http://127.0.0.1 / localhost or https');
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = Math.max(1000, Math.min(900_000, opts.timeoutMs ?? 300_000));
  const maxBytes = Math.max(1024, Math.min(256 * 1024 * 1024, opts.maxOutputBytes ?? 64 * 1024 * 1024));
  return {
    id: 'trellis2',
    async generate(image, gen = {}) {
      const img = validateImage(image);
      if (!img.ok) throw new Error(`reference image rejected: ${img.error}`);
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = gen.signal ? AbortSignal.any([gen.signal, timeout]) : timeout;
      const res = await doFetch(opts.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
        body: JSON.stringify({ image: toBase64(image), mime: img.info.mime, seed: Math.max(0, Math.floor(gen.seed ?? 1)) % 2 ** 31, format: 'glb' }),
        signal,
        redirect: 'error',
      });
      if (!res.ok) throw new Error(`image-to-3D service responded ${res.status}`);
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared > maxBytes) throw new Error('the generated model is too large');
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) throw new Error('the generated model is too large');
      const r = validateGltf(buf, { maxBytes });
      if (!r.ok) throw new Error(`the generated model was rejected: ${r.error}`);
      return { glb: r.glb, report: r.report };
    },
  };
}
