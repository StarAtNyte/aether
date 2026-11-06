/**
 * Publish a cooked copy of the world on screen (docs/ARCHITECTURE-STREAMING.md, "Publishing from the editor"). The editor
 * has already generated the world, so the package is made here, in the publisher's browser, from what it holds:
 *
 * - the geometry-cache entries of the world's generator outputs (Cache Storage, geometry/ddc.ts), packed per cell with the
 *   cook's own packer (render cook/pack.ts);
 * - the program sets this page recorded, per tier (the load's own programs first);
 * - the opening view and the start mode.
 *
 * The files go one request each to the upload function (api/cook-upload.ts), which stores them on the public dataset under
 * `users/<anon>/<world>/`, the manifest last. The share link then names `c=<anon>.<world>` and the player opens it cooked,
 * or live when the package is missing or stale. Loaded with the Publish hub, never by the editor's first page.
 */
import type { WorldDoc } from '@aether/core';
import { cookManifest, DDC_CACHE_NAME, DDC_CODE_VERSION, encodeProgramSetFile, packGeometry, profileForStartMode, programSetBody, sourceHash, worldIrHash, worldOutputKeys, type CookManifest, type StartMode } from '@aether/render';

/** The upload function, on this site. */
export const COOK_UPLOAD_ENDPOINT = '/api/cook-upload';
/** Largest file one request carries (api/_lib/cook-upload.ts `MAX_FILE_BYTES`). */
export const MAX_FILE_BYTES = 4_000_000;
/** Largest package (api/_lib/cook-upload.ts `MAX_PACKAGE_BYTES`). */
export const MAX_PACKAGE_BYTES = 60 * 1024 * 1024;
/** Packs are cut a little under the request cap. */
const PACK_TARGET = 3_500_000;
/** Where this browser keeps its anonymous id and key. */
export const ANON_KEY = 'aether.cook.anon';

/** What the cook reads from the renderer. */
export interface CookRenderer {
  openingPose(): { position: [number, number, number]; target: [number, number, number]; fov?: number } | null;
  sessionPrograms(): Array<{ tier: 'low' | 'medium' | 'high' | 'ultra'; boot: number; pairs: Array<[string, string]> }>;
}

export interface CookPublishInput {
  /** The world as the player will read it (the share link's own, decoded). */
  world: WorldDoc;
  renderer: CookRenderer;
  startMode: StartMode;
  signal: AbortSignal;
  onProgress(fraction: number, label: string): void;
  endpoint?: string;
  fetch?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** Cache Storage (tests pass a fake). */
  caches?: Pick<CacheStorage, 'open'>;
}

export interface CookPublishResult {
  /** The `c=` value of the share link: `<anon>.<world>`. */
  ref: string;
  /** Path of the manifest on the dataset. */
  path: string;
  files: number;
  bytes: number;
  entries: number;
  programs: number;
}

/** A package made in the browser, before upload. */
export interface BrowserPackage {
  manifest: CookManifest;
  files: Map<string, Uint8Array>;
  bytes: number;
  /** Entries left out (over the request cap or unreadable): a viewer generates them. */
  skipped: number;
}

function concat(parts: Uint8Array[], bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** Make the package of `world` from this page's geometry cache and program record. */
export async function cookInBrowser(input: Pick<CookPublishInput, 'world' | 'renderer' | 'startMode' | 'signal' | 'onProgress' | 'caches'>): Promise<BrowserPackage> {
  const { world, renderer, startMode, signal } = input;
  const genVersion = DDC_CODE_VERSION;
  const irHash = await worldIrHash(world);
  const pose = renderer.openingPose();
  const opening: CookManifest['opening'] = pose ? { position: [...pose.position], target: [...pose.target], ...(pose.fov !== undefined ? { fov: pose.fov } : {}) } : null;
  const rec = { world, irHash, genVersion, startMode, opening };

  // The world's outputs that this page's lanes stored (cheap outputs are not stored: a viewer generates those).
  const wanted = await worldOutputKeys(world, genVersion);
  const store = input.caches ?? (typeof caches !== 'undefined' ? caches : null);
  const requests = new Map<string, Request>();
  const cache = store ? await store.open(DDC_CACHE_NAME).catch(() => null) : null;
  if (cache) {
    for (const req of await cache.keys()) {
      const key = new URL(req.url).pathname.split('/').pop() ?? '';
      if (wanted.has(key)) requests.set(key, req);
    }
  }
  const files = new Map<string, Uint8Array>();
  const geometry = await packGeometry(rec, {
    keys: requests.keys(),
    read: async (key) => {
      const res = await cache?.match(requests.get(key)!);
      return res ? new Uint8Array(await res.arrayBuffer()) : null;
    },
    writePack: (file, parts, bytes) => void files.set(file, concat(parts, bytes)),
    packTarget: PACK_TARGET,
    maxEntryBytes: MAX_FILE_BYTES,
    onEntry: (done, total) => input.onProgress(total > 0 ? (0.4 * done) / total : 0, 'Packing geometry'),
    signal,
  });

  // Program sets: the load's own programs first (linked eagerly by a viewer), the rest at rest after its first picture.
  const programs: CookManifest['programs'] = {};
  for (const { tier, boot, pairs } of renderer.sessionPrograms()) {
    if (signal.aborted) throw signal.reason;
    const sources: Record<string, string> = {};
    const hashed = pairs.map(([v, f]) => {
      const hv = sourceHash(v), hf = sourceHash(f);
      sources[hv] = v;
      sources[hf] = f;
      return [hv, hf] as [string, string];
    });
    const body = programSetBody(tier, { pairs: hashed.slice(0, boot), sources }, { pairs: hashed.slice(boot), sources });
    if (!body) continue;
    const bytes = await encodeProgramSetFile(body);
    if (bytes.byteLength > MAX_FILE_BYTES) continue;
    const file = `programs/${tier}.bin`;
    files.set(file, bytes);
    programs[tier] = { file, bytes: bytes.byteLength, programs: body.pairs.length };
  }
  input.onProgress(0.45, 'Packed');
  const manifest = await cookManifest(rec, profileForStartMode(startMode), geometry, programs);
  let bytes = 0;
  for (const b of files.values()) bytes += b.byteLength;
  return { manifest, files, bytes, skipped: geometry.stats.tooLarge + geometry.stats.malformed };
}

class UploadError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function call(f: typeof fetch, url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const res = await f(url, init);
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* not JSON: a host without the function answers with a page */
  }
  if (!res.ok) throw new UploadError(res.status, typeof body.error === 'string' ? body.error : res.status === 404 ? 'this site has no upload service (publish from the hosted studio)' : `HTTP ${res.status}`);
  return body;
}

/** This browser's anonymous id and key (asked for once, kept in localStorage). */
async function identity(f: typeof fetch, endpoint: string, storage: CookPublishInput['storage'], signal: AbortSignal): Promise<{ anon: string; key: string }> {
  try {
    const kept = JSON.parse(storage?.getItem(ANON_KEY) ?? 'null') as { anon?: unknown; key?: unknown } | null;
    if (kept && typeof kept.anon === 'string' && typeof kept.key === 'string') return { anon: kept.anon, key: kept.key };
  } catch {
    /* asked for again */
  }
  const r = await call(f, `${endpoint}?op=id`, { method: 'POST', signal });
  if (typeof r.anon !== 'string' || typeof r.key !== 'string') throw new UploadError(502, 'the upload service gave no id');
  storage?.setItem(ANON_KEY, JSON.stringify({ anon: r.anon, key: r.key }));
  return { anon: r.anon, key: r.key };
}

const bytesHex = async (b: Uint8Array): Promise<string> => {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>));
  let s = '';
  for (const x of d) s += x.toString(16).padStart(2, '0');
  return s;
};

/** Upload a package made by {@link cookInBrowser}: every file, then the manifest. */
export async function uploadPackage(pkg: BrowserPackage, input: Pick<CookPublishInput, 'signal' | 'onProgress' | 'endpoint' | 'fetch' | 'storage'>): Promise<{ ref: string; path: string }> {
  const f = input.fetch ?? ((u, i) => fetch(u, i));
  const endpoint = input.endpoint ?? COOK_UPLOAD_ENDPOINT;
  const storage = input.storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : input.storage;
  const { signal } = input;
  for (let attempt = 0; ; attempt++) {
    const id = await identity(f, endpoint, storage, signal);
    const headers = { 'x-aether-anon': id.anon, 'x-aether-key': id.key };
    try {
      const oids: Record<string, string> = {};
      let sent = 0;
      for (const [file, bytes] of pkg.files) {
        const r = await call(f, `${endpoint}?op=blob`, { method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream' }, body: bytes as Uint8Array<ArrayBuffer>, signal });
        const oid = await bytesHex(bytes);
        if (r.oid !== oid) throw new UploadError(502, `${file} arrived damaged`);
        oids[file] = oid;
        sent += bytes.byteLength;
        input.onProgress(0.45 + (0.5 * sent) / Math.max(1, pkg.bytes), `Uploading ${Math.round(sent / 1e5) / 10} of ${Math.round(pkg.bytes / 1e5) / 10} MB`);
      }
      input.onProgress(0.97, 'Publishing');
      const world = pkg.manifest.irHash.slice(0, 16);
      const r = await call(f, `${endpoint}?op=commit`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ world, manifest: pkg.manifest, files: oids }), signal });
      if (typeof r.ref !== 'string' || typeof r.path !== 'string') throw new UploadError(502, 'the upload service gave no path');
      return { ref: r.ref, path: r.path };
    } catch (e) {
      // A key the server no longer signs (its secret changed): forget it and ask for a new id, once.
      if (e instanceof UploadError && e.status === 401 && attempt === 0) {
        storage?.removeItem(ANON_KEY);
        continue;
      }
      throw e;
    }
  }
}

/** Cook the world here and publish it. */
export async function cookAndPublish(input: CookPublishInput): Promise<CookPublishResult> {
  input.onProgress(0, 'Reading the world');
  const pkg = await cookInBrowser(input);
  if (pkg.files.size === 0) throw new Error('nothing to cook: this page holds no generated geometry or shaders for the world yet');
  if (pkg.bytes > MAX_PACKAGE_BYTES) throw new Error(`the cooked world is ${Math.round(pkg.bytes / 1e6)} MB, over the ${Math.round(MAX_PACKAGE_BYTES / 1048576)} MB limit; the link still opens it live`);
  const up = await uploadPackage(pkg, input);
  input.onProgress(1, 'Published');
  return { ref: up.ref, path: up.path, files: pkg.files.size, bytes: pkg.bytes, entries: Object.keys(pkg.manifest.entries).length, programs: Object.values(pkg.manifest.programs).reduce((n, p) => n + (p?.programs ?? 0), 0) };
}
