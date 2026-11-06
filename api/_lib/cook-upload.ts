/**
 * The upload side of publishing a cooked world from the editor (docs/ARCHITECTURE-STREAMING.md, "Publishing from the
 * editor"). The publisher's browser cooks the world (packages/render/src/cook/pack.ts) and sends it here; this stores it on
 * the public dataset under `users/<anon>/<world>/`, in the layout of a template's package:
 *
 *   users/<anon>/<world>/manifest.json            the manifest, written last
 *   users/<anon>/<world>/<id>/packs/<nnnn>.bin    geometry
 *   users/<anon>/<world>/<id>/programs/<t>.bin    program sets
 *
 * `<world>` is the first 16 hex of the IR hash (a changed world is a new path), `<id>` the cook's folder. Three requests,
 * all POST with `?op=`:
 *
 * - `id`: a new anonymous id and its key (an HMAC of the id under a server secret). The browser keeps both in
 *   localStorage and sends them as `x-aether-anon` / `x-aether-key`. This is not authentication: it only keeps one browser
 *   from writing into another's folder, and gives the rate limits something to count.
 * - `blob`: one file's bytes (at most {@link MAX_FILE_BYTES}, under the platform's 4.5 MB request cap). It goes to the
 *   dataset's LFS storage, not into a commit; the answer is its SHA-256.
 * - `commit`: the manifest and the SHA-256 of each file it names. The manifest is checked in full (cook/manifest.ts
 *   `parseCookManifest`, file names, sizes, totals), every file must already be in LFS storage, then one commit adds the
 *   files and a second the manifest: a reader never sees a manifest whose files are not there.
 *
 * The Hugging Face write token stays on the server: it is never in a response, a log line or an error message.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookFiles, parseCookManifest, type CookManifest } from '../../packages/render/src/cook/manifest.js';

/** The dataset of cooked packages. */
export const COOKED_REPO = 'StarAtNyte1/aether-cooked';
/** Largest file of a package (one request; the platform caps a request body at 4.5 MB). */
export const MAX_FILE_BYTES = 4_000_000;
/** Largest package (all files). */
export const MAX_PACKAGE_BYTES = 60 * 1024 * 1024;
/** Most files in a package. */
export const MAX_FILES = 40;
/** Largest manifest (and commit request). */
export const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

/** Allowed file names inside the cook folder. */
const FILE_NAME = /^(?:packs\/\d{4}\.bin|programs\/(?:low|medium|high|ultra)\.bin)$/;
const HEX16 = /^[0-9a-f]{16}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** Limits per window, per anonymous id and per address. */
export const LIMITS = {
  windowMs: 60 * 60 * 1000,
  idsPerIp: 10,
  blobsPerAnon: 160,
  blobBytesPerAnon: 150 * 1024 * 1024,
  blobsPerIp: 320,
  blobBytesPerIp: 300 * 1024 * 1024,
  commitsPerAnon: 6,
  commitsPerIp: 12,
} as const;

/** Fixed-window counters in memory (per server instance: a soft limit). */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; used: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  /** Take `amount` from `key`'s budget of `limit` per `windowMs`; false (nothing taken) when it would go over. */
  take(key: string, amount: number, limit: number, windowMs: number): boolean {
    const t = this.now();
    if (this.windows.size > 20_000) for (const [k, w] of this.windows) if (t - w.start >= windowMs) this.windows.delete(k);
    let w = this.windows.get(key);
    if (!w || t - w.start >= windowMs) this.windows.set(key, (w = { start: t, used: 0 }));
    if (w.used + amount > limit) return false;
    w.used += amount;
    return true;
  }
}

/** What the handler needs. */
export interface UploadDeps {
  /** The Hugging Face write token. */
  token: string;
  repo?: string;
  /** Signs anonymous ids (default: derived from the token, so no second secret is needed). */
  secret?: string;
  limiter: RateLimiter;
  fetch?: typeof fetch;
  /** Folder of published worlds on the dataset (default `users`; the local end-to-end test uses `users/_test`). */
  root?: string;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function reply(status: number, body: object): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

function signingKey(deps: UploadDeps): Buffer {
  return createHash('sha256').update(`aether-cook-anon\u0000${deps.secret ?? deps.token}`).digest();
}

/** The key of an anonymous id. */
export function anonKey(anon: string, deps: UploadDeps): string {
  return createHmac('sha256', signingKey(deps)).update(`anon:${anon}`).digest('base64url');
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  const ip = (fwd ? fwd.split(',')[0] : req.headers.get('x-real-ip')) ?? '';
  return ip.trim().slice(0, 64) || 'unknown';
}

function checkAnon(req: Request, deps: UploadDeps): string {
  const anon = req.headers.get('x-aether-anon') ?? '';
  const key = req.headers.get('x-aether-key') ?? '';
  if (!HEX16.test(anon)) throw new HttpError(401, 'missing or malformed anonymous id');
  const want = Buffer.from(anonKey(anon, deps));
  const got = Buffer.from(key);
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new HttpError(401, 'the anonymous id does not match its key');
  return anon;
}

async function readBody(req: Request, max: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > max) throw new HttpError(413, `the request is larger than ${max} bytes`);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > max) throw new HttpError(413, `the request is larger than ${max} bytes`);
  return bytes;
}

// --- The hub ---------------------------------------------------------------------------------------------------------

interface LfsObject {
  oid: string;
  size: number;
  actions?: { upload?: { href: string; header?: Record<string, string> }; verify?: { href: string; header?: Record<string, string> } };
  error?: { code: number; message: string };
}

/** The few Hugging Face Hub calls the upload makes (LFS batch, upload and verify; commit). Errors carry no response text. */
export class Hub {
  private readonly get: typeof fetch;
  constructor(private readonly token: string, private readonly repo: string = COOKED_REPO, f?: typeof fetch) {
    this.get = f ?? fetch;
  }

  private async lfsBatch(objects: Array<{ oid: string; size: number }>): Promise<LfsObject[]> {
    const res = await this.get(`https://huggingface.co/datasets/${this.repo}.git/info/lfs/objects/batch`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, accept: 'application/vnd.git-lfs+json', 'content-type': 'application/vnd.git-lfs+json' },
      body: JSON.stringify({ operation: 'upload', transfers: ['basic'], hash_algo: 'sha256', objects, ref: { name: 'main' } }),
    });
    if (!res.ok) throw new HttpError(502, `the storage refused the upload (HTTP ${res.status})`);
    const body = (await res.json()) as { objects?: LfsObject[] };
    return Array.isArray(body.objects) ? body.objects : [];
  }

  /** Put `bytes` (SHA-256 `oid`) into LFS storage, unless it is there already. */
  async uploadBlob(bytes: Uint8Array, oid: string): Promise<void> {
    const [obj] = await this.lfsBatch([{ oid, size: bytes.byteLength }]);
    if (!obj || obj.error) throw new HttpError(502, 'the storage refused the upload');
    const up = obj.actions?.upload;
    if (!up) return;
    if (up.header && 'chunk_size' in up.header) throw new HttpError(502, 'the storage asked for a multipart upload');
    const put = await this.get(up.href, { method: 'PUT', headers: { ...(up.header ?? {}) }, body: bytes as Uint8Array<ArrayBuffer> });
    if (!put.ok) throw new HttpError(502, `the storage refused the upload (HTTP ${put.status})`);
    const verify = obj.actions?.verify;
    if (verify) {
      const v = await this.get(verify.href, { method: 'POST', headers: { ...(verify.header ?? {}), accept: 'application/vnd.git-lfs+json', 'content-type': 'application/vnd.git-lfs+json' }, body: JSON.stringify({ oid, size: bytes.byteLength }) });
      if (!v.ok) throw new HttpError(502, `the storage did not verify the upload (HTTP ${v.status})`);
    }
  }

  /** The oids of `objects` not in LFS storage yet. */
  async missing(objects: Array<{ oid: string; size: number }>): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < objects.length; i += 100) {
      for (const o of await this.lfsBatch(objects.slice(i, i + 100))) if (o.error || o.actions?.upload) out.push(o.oid);
    }
    return out;
  }

  /** One commit on main. */
  async commit(summary: string, ops: Array<{ key: 'file' | 'lfsFile'; value: Record<string, unknown> }>): Promise<void> {
    const lines = [{ key: 'header', value: { summary, description: '' } }, ...ops].map((l) => JSON.stringify(l)).join('\n');
    const res = await this.get(`https://huggingface.co/api/datasets/${this.repo}/commit/main`, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/x-ndjson' }, body: lines });
    if (!res.ok) throw new HttpError(502, `the dataset refused the commit (HTTP ${res.status})`);
  }
}

// --- Validation ------------------------------------------------------------------------------------------------------

/** A commit request, checked. */
export interface CheckedCommit {
  world: string;
  manifest: CookManifest;
  files: Array<{ file: string; oid: string; size: number }>;
}

/** Check a commit request's body (untrusted). Throws an {@link HttpError} (400) naming the first problem. */
export function checkCommit(body: unknown): CheckedCommit {
  const bad = (m: string): never => {
    throw new HttpError(400, m);
  };
  if (typeof body !== 'object' || body === null) return bad('not an object');
  const { world, manifest: raw, files } = body as Record<string, unknown>;
  if (typeof world !== 'string' || !HEX16.test(world)) return bad('bad world id');
  const parsed = parseCookManifest(raw);
  if (!parsed.ok) return bad(`manifest rejected: ${parsed.error}`);
  const m = parsed.manifest;
  if (m.irHash.slice(0, 16) !== world) return bad('the world id is not the manifest IR hash');
  if (!/^[0-9a-f]{16}\/$/.test(m.dir)) return bad('bad cook folder');
  if (m.lightmap !== null) return bad('lightmaps are not accepted');
  m.packs.forEach((p, i) => {
    if (p.file !== `packs/${String(i).padStart(4, '0')}.bin`) bad(`bad pack name ${p.file.slice(0, 40)}`);
  });
  for (const [tier, p] of Object.entries(m.programs)) if (p!.file !== `programs/${tier}.bin`) bad(`bad program set name ${p!.file.slice(0, 40)}`);
  const names = cookFiles(m);
  if (names.length === 0) return bad('the package has no files');
  if (names.length > MAX_FILES) return bad(`more than ${MAX_FILES} files`);
  if (new Set(names).size !== names.length) return bad('a file is named twice');
  const sizes = new Map<string, number>([...m.packs.map((p) => [p.file, p.bytes] as const), ...Object.values(m.programs).map((p) => [p!.file, p!.bytes] as const)]);
  let total = 0;
  for (const [n, size] of sizes) {
    if (!FILE_NAME.test(n)) return bad(`file name not allowed: ${n.slice(0, 40)}`);
    if (size <= 0 || size > MAX_FILE_BYTES) return bad(`${n} is ${size} bytes (at most ${MAX_FILE_BYTES})`);
    total += size;
  }
  if (total > MAX_PACKAGE_BYTES) return bad(`the package is ${total} bytes (at most ${MAX_PACKAGE_BYTES})`);
  if (typeof files !== 'object' || files === null || Array.isArray(files)) return bad('bad file list');
  const given = Object.entries(files as Record<string, unknown>);
  if (given.length !== names.length) return bad('the file list does not match the manifest');
  const out: CheckedCommit['files'] = [];
  for (const [n, oid] of given) {
    if (!sizes.has(n)) return bad(`file not in the manifest: ${n.slice(0, 40)}`);
    if (typeof oid !== 'string' || !HEX64.test(oid)) return bad(`bad hash for ${n}`);
    out.push({ file: n, oid, size: sizes.get(n)! });
  }
  return { world, manifest: m, files: out };
}

// --- The handler -----------------------------------------------------------------------------------------------------

/** Handle one request (the platform's function: api/cook-upload.ts). Never throws; never echoes the token. */
export async function handleCookUpload(req: Request, deps: UploadDeps): Promise<Response> {
  try {
    if (req.method !== 'POST') return reply(405, { error: 'use POST' });
    const op = new URL(req.url).searchParams.get('op');
    const ip = clientIp(req);
    const L = deps.limiter;
    const hub = new Hub(deps.token, deps.repo ?? COOKED_REPO, deps.fetch);
    if (op === 'id') {
      if (!L.take(`id:${ip}`, 1, LIMITS.idsPerIp, LIMITS.windowMs)) throw new HttpError(429, 'too many new ids from this address; try again later');
      const anon = randomBytes(8).toString('hex');
      return reply(200, { anon, key: anonKey(anon, deps) });
    }
    if (op === 'blob') {
      const anon = checkAnon(req, deps);
      const bytes = await readBody(req, MAX_FILE_BYTES);
      if (bytes.byteLength === 0) throw new HttpError(400, 'empty file');
      const n = bytes.byteLength;
      if (!L.take(`blob:${anon}`, 1, LIMITS.blobsPerAnon, LIMITS.windowMs) || !L.take(`blobB:${anon}`, n, LIMITS.blobBytesPerAnon, LIMITS.windowMs) || !L.take(`blob:${ip}`, 1, LIMITS.blobsPerIp, LIMITS.windowMs) || !L.take(`blobB:${ip}`, n, LIMITS.blobBytesPerIp, LIMITS.windowMs)) {
        throw new HttpError(429, 'upload limit reached; try again in an hour');
      }
      const oid = createHash('sha256').update(bytes).digest('hex');
      await hub.uploadBlob(bytes, oid);
      return reply(200, { oid, size: n });
    }
    if (op === 'commit') {
      const anon = checkAnon(req, deps);
      const raw = await readBody(req, MAX_MANIFEST_BYTES);
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        throw new HttpError(400, 'not JSON');
      }
      const c = checkCommit(body);
      if (!L.take(`commit:${anon}`, 1, LIMITS.commitsPerAnon, LIMITS.windowMs) || !L.take(`commit:${ip}`, 1, LIMITS.commitsPerIp, LIMITS.windowMs)) throw new HttpError(429, 'publish limit reached; try again in an hour');
      const gone = await hub.missing(c.files.map((f) => ({ oid: f.oid, size: f.size })));
      if (gone.length > 0) throw new HttpError(409, `${gone.length} file${gone.length > 1 ? 's were' : ' was'} not uploaded first`);
      const root = `${deps.root ?? 'users'}/${anon}/${c.world}`;
      const id = c.manifest.dir.replace(/\/$/, '');
      // Files first, the manifest last.
      await hub.commit(`Add cooked package ${root}/${id}`, c.files.map((f) => ({ key: 'lfsFile', value: { path: `${root}/${id}/${f.file}`, algo: 'sha256', oid: f.oid, size: f.size } })));
      const text = JSON.stringify(c.manifest);
      await hub.commit(`Point ${root} at cooked package ${id}`, [{ key: 'file', value: { path: `${root}/manifest.json`, content: Buffer.from(text).toString('base64'), encoding: 'base64' } }]);
      return reply(200, { path: `${root}/manifest.json`, ref: `${anon}.${c.world}` });
    }
    return reply(404, { error: 'unknown op' });
  } catch (e) {
    if (e instanceof HttpError) return reply(e.status, { error: e.message });
    // Anything else (a network failure to the hub): no detail, which could carry a URL or a header.
    return reply(502, { error: 'the upload failed' });
  }
}
