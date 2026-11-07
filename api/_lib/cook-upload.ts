/**
 * The upload side of publishing a cooked world from the editor (docs/ARCHITECTURE-STREAMING.md, "Publishing from the
 * editor"). The publisher's browser cooks the world (packages/render/src/cook/pack.ts) and sends it here; this stores it on
 * the public dataset under `users/<anon>/<world>/`, in the layout of a template's package:
 *
 *   users/<anon>/<world>/manifest.json               the manifest, written last
 *   users/<anon>/<world>/<id>/world.json.gz          the world (the share payload, gzipped): short links carry none
 *   users/<anon>/<world>/<id>/packs/<nnnn>.bin       geometry
 *   users/<anon>/<world>/<id>/programs/<t>.bin       program sets
 *   users/<anon>/<world>/<id>/light/…                 baked light of a building (`<key>.lmap`, `<key>.lvol`, `index.json`)
 *
 * `<world>` is the first 16 hex of the IR hash (a changed world is a new path), `<id>` the cook's folder. Every request is
 * a POST with `?op=`:
 *
 * - `id`: a new anonymous id and its key (an HMAC of the id under a server secret). The browser keeps both in
 *   localStorage and sends them as `x-aether-anon` / `x-aether-key`. This is not authentication: it only keeps one browser
 *   from writing into another's folder, and gives the limits something to count.
 * - `begin`: the world id and the package's size. The limits are counted on the dataset itself ({@link QUOTA}: this id's
 *   publishes in the last hour, everyone's, and what this id already stores); the answer is a signed ticket, sent as
 *   `x-aether-ticket` with every later request, good for {@link TICKET_MS}.
 * - `blob`: one chunk of at most {@link CHUNK_BYTES} (the platform caps a request body at 4.5 MB). It goes to the dataset's
 *   LFS storage, not into a commit; the answer is its SHA-256. A file of at most {@link CHUNK_BYTES} is one blob.
 * - `assemble`: a larger file (at most {@link MAX_FILE_BYTES}) from its chunks, stored first by `blob`: the chunks are read
 *   back from LFS storage and checked, joined, checked against the file's SHA-256, and the file stored.
 * - `commit`: the manifest and the SHA-256 of each file it names. The manifest is checked in full (cook/manifest.ts
 *   `parseCookManifest`, file names, sizes, totals), every file must already be in LFS storage, then one commit adds the
 *   files and a second the manifest: a reader never sees a manifest whose files are not there.
 *
 * The Hugging Face write token stays on the server: it is never in a response, a log line or an error message.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookFiles, parseCookManifest, WORLD_FILE, type CookManifest } from '../../packages/render/src/cook/manifest.js';

/** The dataset of cooked packages. */
export const COOKED_REPO = 'StarAtNyte1/aether-cooked';
/** Largest request body of one chunk (the platform caps a request body at 4.5 MB). */
export const CHUNK_BYTES = 4_000_000;
/** Largest file of a package (sent in chunks when larger than {@link CHUNK_BYTES}). */
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
/** Largest package (all files). */
export const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;
/** Most files in a package. */
export const MAX_FILES = 120;
/** Most chunks of one file. */
export const MAX_PARTS = Math.ceil(MAX_FILE_BYTES / 1_000_000);
/** Largest manifest (and commit request): one request. */
export const MAX_MANIFEST_BYTES = CHUNK_BYTES;
/** How long a `begin` ticket is good for. */
export const TICKET_MS = 60 * 60 * 1000;

/** Allowed file names inside the cook folder. */
const FILE_NAME = /^(?:packs\/\d{4}\.bin|programs\/(?:low|medium|high|ultra)\.bin|world\.json\.gz|light\/(?:lm\d+-[0-9a-f]{32}\.lmap|lv\d+-[0-9a-f]{32}\.lvol|index\.json))$/;
/** The baked light's folder in a package, and the largest index of it. */
const LIGHT_BASE = 'light/';
const MAX_LIGHT_INDEX_BYTES = 4096;
const HEX16 = /^[0-9a-f]{16}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Limits counted on the dataset (its commits and files, read through the Hub API): they hold across function instances and
 * cold starts, with no store of their own. A publish is the commit that points `users/<anon>/<world>` at a package.
 */
export const QUOTA = {
  windowMs: 60 * 60 * 1000,
  /** Publishes of one anonymous id per window. */
  publishesPerAnon: 6,
  /** Publishes of everyone per window (new ids are free: this bounds what many of them can do). */
  publishesPerWindow: 60,
  /** What one anonymous id may keep on the dataset. */
  storedBytesPerAnon: 1024 * 1024 * 1024,
  worldsPerAnon: 50,
} as const;

/** Soft limits per window, in memory per function instance: a first line in front of {@link QUOTA}. */
export const LIMITS = {
  windowMs: 60 * 60 * 1000,
  idsPerIp: 10,
  beginsPerIp: 30,
  blobsPerAnon: 400,
  blobBytesPerAnon: 600 * 1024 * 1024,
  blobsPerIp: 800,
  blobBytesPerIp: 1200 * 1024 * 1024,
  assemblesPerAnon: 120,
  commitsPerAnon: 12,
  commitsPerIp: 24,
} as const;

/** Fixed-window counters in memory (per server instance: a soft limit). */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; used: number }>();
  constructor(readonly now: () => number = Date.now) {}

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
  /** Signs anonymous ids and tickets (default: derived from the token, so no second secret is needed). */
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

const hmac = (deps: UploadDeps, text: string): string => createHmac('sha256', signingKey(deps)).update(text).digest('base64url');

/** The key of an anonymous id. */
export function anonKey(anon: string, deps: UploadDeps): string {
  return hmac(deps, `anon:${anon}`);
}

/** What a ticket carries: the id, the world, the package's declared bytes and its expiry (ms since the epoch). */
export interface Ticket {
  anon: string;
  world: string;
  bytes: number;
  exp: number;
}

/** A signed ticket (`<anon>.<world>.<bytes>.<exp>.<hmac>`). */
export function signTicket(t: Ticket, deps: UploadDeps): string {
  const body = `${t.anon}.${t.world}.${t.bytes}.${t.exp}`;
  return `${body}.${hmac(deps, `ticket:${body}`)}`;
}

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function checkTicket(req: Request, anon: string, deps: UploadDeps): Ticket {
  const m = /^([0-9a-f]{16})\.([0-9a-f]{16})\.(\d{1,12})\.(\d{1,15})\.([A-Za-z0-9_-]{43})$/.exec(req.headers.get('x-aether-ticket') ?? '');
  if (!m) throw new HttpError(401, 'no upload ticket: begin the upload first');
  if (!equal(m[5]!, hmac(deps, `ticket:${m[1]}.${m[2]}.${m[3]}.${m[4]}`))) throw new HttpError(401, 'the upload ticket does not match');
  const t: Ticket = { anon: m[1]!, world: m[2]!, bytes: Number(m[3]), exp: Number(m[4]) };
  if (t.anon !== anon) throw new HttpError(401, 'the upload ticket is for another id');
  if (t.exp <= deps.limiter.now()) throw new HttpError(401, 'the upload ticket has expired: begin the upload again');
  return t;
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
  if (!equal(key, anonKey(anon, deps))) throw new HttpError(401, 'the anonymous id does not match its key');
  return anon;
}

async function readBody(req: Request, max: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > max) throw new HttpError(413, `the request is larger than ${max} bytes`);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > max) throw new HttpError(413, `the request is larger than ${max} bytes`);
  return bytes;
}

async function readJson(req: Request, max: number): Promise<unknown> {
  const raw = await readBody(req, max);
  try {
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new HttpError(400, 'not JSON');
  }
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

// --- The hub ---------------------------------------------------------------------------------------------------------

interface LfsAction {
  href: string;
  header?: Record<string, string>;
}

interface LfsObject {
  oid: string;
  size: number;
  actions?: { upload?: LfsAction; verify?: LfsAction; download?: LfsAction };
  error?: { code: number; message: string };
}

const LFS_HEADERS = { accept: 'application/vnd.git-lfs+json', 'content-type': 'application/vnd.git-lfs+json' };

/**
 * The Hugging Face Hub calls the upload makes: LFS batch (upload, verify, download), commit, and the reads the limits are
 * counted from (commits, file tree). Errors carry no response text.
 */
export class Hub {
  private readonly get: typeof fetch;
  constructor(private readonly token: string, private readonly repo: string = COOKED_REPO, f?: typeof fetch) {
    this.get = f ?? fetch;
  }

  private async lfsBatch(operation: 'upload' | 'download', objects: Array<{ oid: string; size: number }>): Promise<LfsObject[]> {
    const res = await this.get(`https://huggingface.co/datasets/${this.repo}.git/info/lfs/objects/batch`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, ...LFS_HEADERS },
      body: JSON.stringify({ operation, transfers: ['basic', 'multipart'], hash_algo: 'sha256', objects, ref: { name: 'main' } }),
    });
    if (!res.ok) throw new HttpError(502, `the storage refused the ${operation} (HTTP ${res.status})`);
    const body = (await res.json()) as { objects?: LfsObject[] };
    return Array.isArray(body.objects) ? body.objects : [];
  }

  /** Put `bytes` (SHA-256 `oid`) into LFS storage, unless it is there already (one PUT, or the parts the storage asks for). */
  async uploadBlob(bytes: Uint8Array, oid: string): Promise<void> {
    const [obj] = await this.lfsBatch('upload', [{ oid, size: bytes.byteLength }]);
    if (!obj || obj.error) throw new HttpError(502, 'the storage refused the upload');
    const up = obj.actions?.upload;
    if (!up) return;
    const header = up.header ?? {};
    if ('chunk_size' in header) {
      // Multipart: one presigned URL per part (keys "1", "2", …), each part `chunk_size` bytes, then the completion.
      const size = Number(header['chunk_size']);
      const urls = Object.entries(header)
        .filter(([k]) => /^\d+$/.test(k))
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, u]) => u);
      if (!(size > 0) || urls.length !== Math.ceil(bytes.byteLength / size)) throw new HttpError(502, 'the storage asked for an unexpected multipart upload');
      const parts: Array<{ partNumber: number; etag: string }> = [];
      for (let i = 0; i < urls.length; i++) {
        const put = await this.get(urls[i]!, { method: 'PUT', body: bytes.subarray(i * size, (i + 1) * size) as Uint8Array<ArrayBuffer> });
        const etag = put.headers.get('etag');
        if (!put.ok || !etag) throw new HttpError(502, `the storage refused part ${i + 1} (HTTP ${put.status})`);
        parts.push({ partNumber: i + 1, etag });
      }
      const done = await this.get(up.href, { method: 'POST', headers: LFS_HEADERS, body: JSON.stringify({ oid, parts }) });
      if (!done.ok) throw new HttpError(502, `the storage did not complete the upload (HTTP ${done.status})`);
    } else {
      const put = await this.get(up.href, { method: 'PUT', headers: { ...header }, body: bytes as Uint8Array<ArrayBuffer> });
      if (!put.ok) throw new HttpError(502, `the storage refused the upload (HTTP ${put.status})`);
    }
    const verify = obj.actions?.verify;
    if (verify) {
      const v = await this.get(verify.href, { method: 'POST', headers: { ...(verify.header ?? {}), ...LFS_HEADERS }, body: JSON.stringify({ oid, size: bytes.byteLength }) });
      if (!v.ok) throw new HttpError(502, `the storage did not verify the upload (HTTP ${v.status})`);
    }
  }

  /** Read back an object from LFS storage (committed or not), checked against its size and SHA-256. */
  async download(oid: string, size: number): Promise<Uint8Array> {
    const [obj] = await this.lfsBatch('download', [{ oid, size }]);
    const dl = obj?.actions?.download;
    if (!obj || obj.error || !dl) throw new HttpError(409, 'a chunk was not uploaded first');
    const res = await this.get(dl.href, { headers: { ...(dl.header ?? {}) } });
    if (!res.ok) throw new HttpError(502, `the storage did not return a chunk (HTTP ${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength !== size || sha256(bytes) !== oid) throw new HttpError(502, 'a chunk came back damaged');
    return bytes;
  }

  /** The oids of `objects` not in LFS storage yet. */
  async missing(objects: Array<{ oid: string; size: number }>): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < objects.length; i += 100) {
      for (const o of await this.lfsBatch('upload', objects.slice(i, i + 100))) if (o.error || o.actions?.upload) out.push(o.oid);
    }
    return out;
  }

  /** One commit on main. */
  async commit(summary: string, ops: Array<{ key: 'file' | 'lfsFile'; value: Record<string, unknown> }>): Promise<void> {
    const lines = [{ key: 'header', value: { summary, description: '' } }, ...ops].map((l) => JSON.stringify(l)).join('\n');
    const res = await this.get(`https://huggingface.co/api/datasets/${this.repo}/commit/main`, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/x-ndjson' }, body: lines });
    if (!res.ok) throw new HttpError(502, `the dataset refused the commit (HTTP ${res.status})`);
  }

  /**
   * Titles of the commits on main since `since` (ms), newest first, reading at most `maxPages` pages of 100. `complete` is
   * false when the window holds more commits than that.
   */
  async commitsSince(since: number, maxPages = 5): Promise<{ titles: string[]; complete: boolean }> {
    const titles: string[] = [];
    for (let p = 0; p < maxPages; p++) {
      const res = await this.get(`https://huggingface.co/api/datasets/${this.repo}/commits/main?limit=100&p=${p}`, { headers: { authorization: `Bearer ${this.token}` } });
      if (!res.ok) throw new HttpError(503, `the dataset's history could not be read (HTTP ${res.status}); try again later`);
      const page = (await res.json()) as Array<{ title?: unknown; date?: unknown }>;
      if (!Array.isArray(page)) throw new HttpError(503, "the dataset's history could not be read; try again later");
      for (const c of page) {
        const at = Date.parse(String(c.date ?? ''));
        if (!(at >= since)) return { titles, complete: true };
        titles.push(String(c.title ?? ''));
      }
      if (page.length < 100) return { titles, complete: true };
    }
    return { titles, complete: false };
  }

  /** Every file under `path` on main (none when the path does not exist), with its size. */
  async tree(path: string, maxPages = 20): Promise<Array<{ path: string; size: number }>> {
    const out: Array<{ path: string; size: number }> = [];
    let url: string | null = `https://huggingface.co/api/datasets/${this.repo}/tree/main/${path}?recursive=true&expand=false`;
    for (let p = 0; url && p < maxPages; p++) {
      const res: Response = await this.get(url, { headers: { authorization: `Bearer ${this.token}` } });
      if (res.status === 404) return out;
      if (!res.ok) throw new HttpError(503, `the dataset could not be listed (HTTP ${res.status}); try again later`);
      const page = (await res.json()) as Array<{ type?: unknown; path?: unknown; size?: unknown; lfs?: { size?: unknown } }>;
      if (!Array.isArray(page)) throw new HttpError(503, 'the dataset could not be listed; try again later');
      for (const e of page) if (e.type === 'file' && typeof e.path === 'string') out.push({ path: e.path, size: Number(e.lfs?.size ?? e.size) || 0 });
      const next: RegExpExecArray | null = /<(https:\/\/huggingface\.co\/[^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '');
      url = next ? next[1]! : null;
    }
    return out;
  }
}

// --- Limits on the dataset -------------------------------------------------------------------------------------------

/** The commit title of a publish (the manifest commit): what {@link checkQuota} counts. */
export function publishTitle(base: string, id: string): string {
  return `Point ${base} at cooked package ${id}`;
}

/**
 * Check {@link QUOTA} on the dataset before `anon` publishes `world` (`bytes` more): its publishes in the window, everyone's,
 * and what it stores. Throws a 429 (or 503 when the dataset cannot be read: no unchecked upload).
 */
export async function checkQuota(hub: Hub, root: string, anon: string, world: string, bytes: number, now: number): Promise<void> {
  const recent = await hub.commitsSince(now - QUOTA.windowMs);
  const publishes = recent.titles.filter((t) => t.startsWith(`Point ${root}/`));
  if (!recent.complete || publishes.length >= QUOTA.publishesPerWindow) throw new HttpError(429, 'publishing is busy; try again in an hour');
  if (publishes.filter((t) => t.startsWith(`Point ${root}/${anon}/`)).length >= QUOTA.publishesPerAnon) throw new HttpError(429, 'publish limit reached; try again in an hour');
  const files = await hub.tree(`${root}/${anon}`);
  const stored = files.reduce((n, f) => n + f.size, 0);
  if (stored + bytes > QUOTA.storedBytesPerAnon) throw new HttpError(429, `this browser's published worlds already take ${Math.round(stored / 1048576)} MB (at most ${QUOTA.storedBytesPerAnon / 1048576} MB)`);
  const worlds = new Set(files.filter((f) => /\/manifest\.json$/.test(f.path)).map((f) => f.path));
  if (!worlds.has(`${root}/${anon}/${world}/manifest.json`) && worlds.size >= QUOTA.worldsPerAnon) throw new HttpError(429, `this browser has published ${worlds.size} worlds (at most ${QUOTA.worldsPerAnon})`);
}

// --- Validation ------------------------------------------------------------------------------------------------------

/** A commit request, checked. */
export interface CheckedCommit {
  world: string;
  manifest: CookManifest;
  files: Array<{ file: string; oid: string; size: number }>;
  bytes: number;
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
  // Baked light: in `light/`, every file listed (one index, at least one lightmap and one volume).
  const light = m.lightmap;
  if (light !== null) {
    if (light.base !== LIGHT_BASE || !light.version || !light.files) return bad('baked light must be in light/, versioned, its files listed');
    const names = light.files.map((f) => f.file);
    if (names.filter((n) => n === `${LIGHT_BASE}index.json`).length !== 1 || !names.some((n) => n.endsWith('.lmap')) || !names.some((n) => n.endsWith('.lvol'))) return bad('baked light needs one index.json, a .lmap and a .lvol');
    if (light.files.some((f) => f.file === `${LIGHT_BASE}index.json` && f.bytes > MAX_LIGHT_INDEX_BYTES)) return bad('the baked light index is too large');
  }
  if (!m.ir || m.ir.file !== WORLD_FILE) return bad(`the package has no ${WORLD_FILE}`);
  m.packs.forEach((p, i) => {
    if (p.file !== `packs/${String(i).padStart(4, '0')}.bin`) bad(`bad pack name ${p.file.slice(0, 40)}`);
  });
  for (const [tier, p] of Object.entries(m.programs)) if (p!.file !== `programs/${tier}.bin`) bad(`bad program set name ${p!.file.slice(0, 40)}`);
  const names = cookFiles(m);
  if (names.length > MAX_FILES) return bad(`more than ${MAX_FILES} files`);
  if (new Set(names).size !== names.length) return bad('a file is named twice');
  const sizes = new Map<string, number>([...m.packs.map((p) => [p.file, p.bytes] as const), ...Object.values(m.programs).map((p) => [p!.file, p!.bytes] as const), [m.ir.file, m.ir.bytes], ...(light?.files ?? []).map((f) => [f.file, f.bytes] as const)]);
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
    if (n === m.ir.file && oid !== m.ir.sha256) return bad(`the hash of ${WORLD_FILE} is not the manifest's`);
    out.push({ file: n, oid, size: sizes.get(n)! });
  }
  return { world, manifest: m, files: out, bytes: total };
}

/** An assemble request, checked: the file's hash and size, and its chunks in order. */
export function checkAssemble(body: unknown): { oid: string; size: number; parts: Array<{ oid: string; size: number }> } {
  const bad = (m: string): never => {
    throw new HttpError(400, m);
  };
  if (typeof body !== 'object' || body === null) return bad('not an object');
  const { oid, size, parts } = body as Record<string, unknown>;
  if (typeof oid !== 'string' || !HEX64.test(oid)) return bad('bad hash');
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= CHUNK_BYTES || size > MAX_FILE_BYTES) return bad(`a file to assemble is ${CHUNK_BYTES + 1} to ${MAX_FILE_BYTES} bytes`);
  if (!Array.isArray(parts) || parts.length < 2 || parts.length > MAX_PARTS) return bad(`2 to ${MAX_PARTS} chunks`);
  let sum = 0;
  const out: Array<{ oid: string; size: number }> = [];
  for (const p of parts as unknown[]) {
    const q = p as Record<string, unknown> | null;
    if (!q || typeof q.oid !== 'string' || !HEX64.test(q.oid) || typeof q.size !== 'number' || !Number.isInteger(q.size) || q.size <= 0 || q.size > CHUNK_BYTES) return bad('bad chunk');
    sum += q.size;
    out.push({ oid: q.oid, size: q.size });
  }
  if (sum !== size) return bad('the chunks do not add up to the file');
  return { oid, size, parts: out };
}

// --- The handler -----------------------------------------------------------------------------------------------------

/** Handle one request (the platform's function: api/cook-upload.ts). Never throws; never echoes the token. */
export async function handleCookUpload(req: Request, deps: UploadDeps): Promise<Response> {
  try {
    if (req.method !== 'POST') return reply(405, { error: 'use POST' });
    const op = new URL(req.url).searchParams.get('op');
    const ip = clientIp(req);
    const L = deps.limiter;
    const W = LIMITS.windowMs;
    const root = deps.root ?? 'users';
    const hub = new Hub(deps.token, deps.repo ?? COOKED_REPO, deps.fetch);
    if (op === 'id') {
      if (!L.take(`id:${ip}`, 1, LIMITS.idsPerIp, W)) throw new HttpError(429, 'too many new ids from this address; try again later');
      const anon = randomBytes(8).toString('hex');
      return reply(200, { anon, key: anonKey(anon, deps) });
    }
    if (op === 'begin') {
      const anon = checkAnon(req, deps);
      const body = (await readJson(req, 4096)) as Record<string, unknown> | null;
      const world = body?.['world'], bytes = body?.['bytes'], files = body?.['files'];
      if (typeof world !== 'string' || !HEX16.test(world)) throw new HttpError(400, 'bad world id');
      if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) throw new HttpError(400, 'bad size');
      if (bytes > MAX_PACKAGE_BYTES) throw new HttpError(413, `the package is ${bytes} bytes (at most ${MAX_PACKAGE_BYTES})`);
      if (typeof files !== 'number' || !Number.isInteger(files) || files <= 0 || files > MAX_FILES) throw new HttpError(413, `1 to ${MAX_FILES} files`);
      if (!L.take(`begin:${ip}`, 1, LIMITS.beginsPerIp, W)) throw new HttpError(429, 'too many uploads from this address; try again later');
      const now = L.now();
      await checkQuota(hub, root, anon, world, bytes, now);
      const exp = now + TICKET_MS;
      return reply(200, { ticket: signTicket({ anon, world, bytes, exp }, deps), exp, chunk: CHUNK_BYTES, maxFile: MAX_FILE_BYTES, maxPackage: MAX_PACKAGE_BYTES });
    }
    if (op === 'blob') {
      const anon = checkAnon(req, deps);
      const ticket = checkTicket(req, anon, deps);
      const bytes = await readBody(req, CHUNK_BYTES);
      if (bytes.byteLength === 0) throw new HttpError(400, 'empty file');
      const n = bytes.byteLength;
      // A ticket carries its package once (twice with retries), whatever the instance's other counts.
      const spent = `blobT:${ticket.anon}.${ticket.world}.${ticket.exp}`;
      if (!L.take(spent, n, ticket.bytes * 2 + CHUNK_BYTES, TICKET_MS)) throw new HttpError(429, 'more was uploaded than the package holds');
      if (!L.take(`blob:${anon}`, 1, LIMITS.blobsPerAnon, W) || !L.take(`blobB:${anon}`, n, LIMITS.blobBytesPerAnon, W) || !L.take(`blob:${ip}`, 1, LIMITS.blobsPerIp, W) || !L.take(`blobB:${ip}`, n, LIMITS.blobBytesPerIp, W)) {
        throw new HttpError(429, 'upload limit reached; try again in an hour');
      }
      const oid = sha256(bytes);
      await hub.uploadBlob(bytes, oid);
      return reply(200, { oid, size: n });
    }
    if (op === 'assemble') {
      const anon = checkAnon(req, deps);
      checkTicket(req, anon, deps);
      const a = checkAssemble(await readJson(req, 64 * 1024));
      if (!L.take(`assemble:${anon}`, 1, LIMITS.assemblesPerAnon, W)) throw new HttpError(429, 'upload limit reached; try again in an hour');
      const whole = new Uint8Array(a.size);
      let at = 0;
      for (const p of a.parts) {
        whole.set(await hub.download(p.oid, p.size), at);
        at += p.size;
      }
      if (sha256(whole) !== a.oid) throw new HttpError(400, 'the chunks do not make the file');
      await hub.uploadBlob(whole, a.oid);
      return reply(200, { oid: a.oid, size: a.size });
    }
    if (op === 'commit') {
      const anon = checkAnon(req, deps);
      const ticket = checkTicket(req, anon, deps);
      const c = checkCommit(await readJson(req, MAX_MANIFEST_BYTES));
      if (c.world !== ticket.world) throw new HttpError(401, 'the upload ticket is for another world');
      if (!L.take(`commit:${anon}`, 1, LIMITS.commitsPerAnon, W) || !L.take(`commit:${ip}`, 1, LIMITS.commitsPerIp, W)) throw new HttpError(429, 'publish limit reached; try again in an hour');
      await checkQuota(hub, root, anon, c.world, c.bytes, L.now());
      const gone = await hub.missing(c.files.map((f) => ({ oid: f.oid, size: f.size })));
      if (gone.length > 0) throw new HttpError(409, `${gone.length} file${gone.length > 1 ? 's were' : ' was'} not uploaded first`);
      const base = `${root}/${anon}/${c.world}`;
      const id = c.manifest.dir.replace(/\/$/, '');
      // Files first, the manifest last.
      await hub.commit(`Add cooked package ${base}/${id}`, c.files.map((f) => ({ key: 'lfsFile', value: { path: `${base}/${id}/${f.file}`, algo: 'sha256', oid: f.oid, size: f.size } })));
      const text = JSON.stringify(c.manifest);
      await hub.commit(publishTitle(base, id), [{ key: 'file', value: { path: `${base}/manifest.json`, content: Buffer.from(text).toString('base64'), encoding: 'base64' } }]);
      return reply(200, { path: `${base}/manifest.json`, ref: `${anon}.${c.world}` });
    }
    return reply(404, { error: 'unknown op' });
  } catch (e) {
    if (e instanceof HttpError) return reply(e.status, { error: e.message });
    // Anything else (a network failure to the hub): no detail, which could carry a URL or a header.
    return reply(502, { error: 'the upload failed' });
  }
}
