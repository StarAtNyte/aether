/**
 * Image generation for textures: an optional capability, never required.
 *
 * An {@link ImageGenerator} turns a prompt (and optionally a reference picture) into an image. Two real ones exist:
 *
 * - the local bridge's Codex backend (`POST /v1/image`: the Codex CLI's built-in `image_gen` tool, on the user's ChatGPT login);
 * - an OpenAI-compatible Images API (`POST {base}/v1/images/generations` or `/edits`, with the user's own key).
 *
 * {@link imageChain} tries them in order. When none is configured (or all fail) the texture tool falls back to the texture derived
 * from the user's photo and then to the procedural library, so the offline path is unchanged.
 */
import { ProviderError, errorMessage } from './providers/errors';
import { postJson, type RetryPolicy } from './providers/transport';

/** What the texture tool asks of an image model. */
export interface ImageRequest {
  /** What to draw (already phrased as a flat, front-on material swatch; see {@link texturePrompt}). */
  prompt: string;
  /** Edge in pixels (square). Models round to what they support. */
  size?: 512 | 1024;
  /** A reference picture (PNG / JPEG / WebP data URL) the image should follow (a crop of the user's photo). */
  reference?: string;
  signal?: AbortSignal;
}

/** One generated image. */
export interface GeneratedImage {
  /** `data:image/png;base64,…` (or webp / jpeg). */
  dataUrl: string;
  /** Model name where known. */
  model: string;
  /** Which generator made it (`codex`, `openai`). */
  via: string;
}

/** An image model. */
export interface ImageGenerator {
  id: string;
  label: string;
  generate(req: ImageRequest): Promise<GeneratedImage>;
}

/** The prompt for a seamless PBR swatch: flat, front-on, evenly lit, no objects, no text. */
export function texturePrompt(subject: string, opts: { tileable?: boolean; refine?: boolean } = {}): string {
  const s = subject.replace(/\s+/g, ' ').trim().slice(0, 300);
  return [
    `A flat, square, top-down close-up photograph of ${s}, filling the whole frame edge to edge.`,
    'Orthographic, perfectly front-on, even soft diffuse light with no cast shadows, no highlights or glare, no vignetting, neutral white balance.',
    opts.tileable === false ? '' : 'It must tile seamlessly: the pattern continues across all four edges with no border, no frame, no obvious repeating blemish.',
    'Only the material itself: no objects, no furniture, no people, no text, no logo, no horizon, no perspective.',
    opts.refine ? 'Keep the colour, pattern and scale of the reference picture, but remove its lighting, shadows and any objects, and sharpen the fine detail.' : 'Realistic, high detail, true-to-life colour.',
  ]
    .filter(Boolean)
    .join(' ');
}

const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** True for a data URL of a PNG, JPEG or WebP image. */
export function isImageDataUrl(s: string): boolean {
  return IMAGE_DATA_URL.test(s);
}

/** Options of {@link createOpenAiImageGenerator}. */
export interface OpenAiImageOptions {
  apiKey: string;
  /** Default `https://api.openai.com`. */
  baseUrl?: string;
  /** Default `gpt-image-1`. */
  model?: string;
  /** `low` | `medium` | `high` (default medium). */
  quality?: 'low' | 'medium' | 'high';
  fetch?: typeof fetch;
  retry?: RetryPolicy;
}

const dataUrlBytes = (dataUrl: string): { mime: string; bytes: Uint8Array } => {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.*)$/.exec(dataUrl);
  if (!m) throw new ProviderError('bad_request', 'the reference is not a PNG, JPEG or WebP data URL');
  const bin = atob(m[2] as string);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1] as string, bytes };
};

/** An OpenAI-compatible Images API generator (the user's own key; the browser may call it directly). */
export function createOpenAiImageGenerator(opts: OpenAiImageOptions): ImageGenerator {
  const base = (opts.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '');
  const model = opts.model ?? 'gpt-image-1';
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const read = (body: unknown): string => {
    const first = (body as { data?: Array<{ b64_json?: unknown; url?: unknown }> } | null)?.data?.[0];
    if (typeof first?.b64_json === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(first.b64_json)) return `data:image/png;base64,${first.b64_json}`;
    throw new ProviderError('invalid_response', 'the image service returned no image (only base64 results are accepted)');
  };
  return {
    id: 'openai',
    label: `OpenAI images (${model})`,
    async generate(req: ImageRequest): Promise<GeneratedImage> {
      const size = req.size === 512 ? '1024x1024' : '1024x1024';
      if (!req.reference) {
        const body = await postJson({
          url: `${base}/v1/images/generations`,
          headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
          body: { model, prompt: req.prompt, size, n: 1, quality: opts.quality ?? 'medium' },
          fetch: doFetch,
          ...(req.signal ? { signal: req.signal } : {}),
          policy: { maxRetries: 1, timeoutMs: 240_000, ...opts.retry },
          maxResponseBytes: 24 * 1024 * 1024,
          describeError: (_s, b) => String((b as { error?: { message?: unknown } } | null)?.error?.message ?? '').slice(0, 200),
        });
        return { dataUrl: read(body), model, via: 'openai' };
      }
      // With a reference the Images edit endpoint takes multipart form data.
      const ref = dataUrlBytes(req.reference);
      const form = new FormData();
      form.set('model', model);
      form.set('prompt', req.prompt);
      form.set('size', size);
      form.set('quality', opts.quality ?? 'medium');
      form.set('image', new Blob([ref.bytes as Uint8Array<ArrayBuffer>], { type: ref.mime }), `reference.${ref.mime.slice(6)}`);
      let res: Response;
      try {
        res = await doFetch(`${base}/v1/images/edits`, { method: 'POST', headers: { authorization: `Bearer ${opts.apiKey}` }, body: form, ...(req.signal ? { signal: req.signal } : {}) });
      } catch (e) {
        throw new ProviderError('network', `the image service could not be reached: ${errorMessage(e).slice(0, 120)}`);
      }
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      if (!res.ok) throw new ProviderError(res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate_limit' : 'server', `the image service refused the request (${res.status}): ${String((json as { error?: { message?: unknown } } | null)?.error?.message ?? '').slice(0, 160)}`, { status: res.status });
      return { dataUrl: read(json), model, via: 'openai' };
    },
  };
}

/** Options of {@link createBridgeImageGenerator}. */
export interface BridgeImageOptions {
  /** The bridge origin, or (local app) the page-relative `/api/local` base. */
  baseUrl: string;
  /** Bearer token of the paired bridge; absent for the local app, which authenticates by its session cookie. */
  token?: string;
  backend?: 'codex';
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** An image generator that asks the local bridge (Codex's built-in image tool on the user's ChatGPT login). */
export function createBridgeImageGenerator(opts: BridgeImageOptions): ImageGenerator {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const path = opts.token === undefined ? '/image' : '/v1/image';
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  return {
    id: 'codex',
    label: 'Codex image tool (your ChatGPT login, via the local bridge)',
    async generate(req: ImageRequest): Promise<GeneratedImage> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.max(10_000, Math.min(900_000, opts.timeoutMs ?? 360_000)));
      const onAbort = (): void => ctrl.abort();
      req.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const res = await doFetch(`${base}${path}`, {
          method: 'POST',
          headers: { ...(opts.token !== undefined ? { authorization: `Bearer ${opts.token}` } : {}), 'content-type': 'application/json' },
          body: JSON.stringify({ backend: opts.backend ?? 'codex', prompt: req.prompt, ...(req.size ? { size: req.size } : {}), ...(req.reference ? { reference: req.reference } : {}) }),
          signal: ctrl.signal,
        });
        const json = (await res.json().catch(() => null)) as { image?: unknown; model?: unknown; error?: { message?: unknown } } | null;
        if (!res.ok || typeof json?.image !== 'string' || !isImageDataUrl(json.image)) throw new ProviderError(res.status === 429 ? 'rate_limit' : 'server', String(json?.error?.message ?? `the bridge could not make an image (${res.status})`).slice(0, 240), { status: res.status });
        return { dataUrl: json.image, model: typeof json.model === 'string' ? json.model.slice(0, 64) : 'codex-image', via: 'codex' };
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

/** Try each generator in order; the first image wins, the reasons of the failures are kept. Null when the list is empty. */
export function imageChain(list: readonly ImageGenerator[]): ImageGenerator | null {
  if (list.length === 0) return null;
  if (list.length === 1) return list[0] as ImageGenerator;
  return {
    id: list.map((g) => g.id).join('+'),
    label: list.map((g) => g.label).join(', then '),
    async generate(req: ImageRequest): Promise<GeneratedImage> {
      const why: string[] = [];
      for (const g of list) {
        try {
          return await g.generate(req);
        } catch (e) {
          if (req.signal?.aborted) throw e;
          why.push(`${g.id}: ${errorMessage(e).slice(0, 160)}`);
        }
      }
      throw new ProviderError('server', `no image model could make it (${why.join('; ')})`);
    },
  };
}
