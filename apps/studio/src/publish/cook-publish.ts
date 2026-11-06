/**
 * Publish a cooked copy of the world on screen (docs/ARCHITECTURE-STREAMING.md, "Publishing from the editor"). The editor
 * has already generated most of the world, so the package is made here, in the publisher's browser:
 *
 * - the world itself (`world.json.gz`: the share payload, gzipped), so the share link is short and carries no world;
 * - the geometry-cache entries of every generator output the world draws (Cache Storage, geometry/ddc.ts), the ones the
 *   editor did not keep (cheap outputs, spawn templates never drawn) generated first, packed per cell with the cook's own
 *   packer (render cook/pack.ts);
 * - the program sets this page recorded, per tier (the load's own programs first);
 * - the opening view and the start mode.
 *
 * The files go to the upload function (api/cook-upload.ts) one request each, a file over the request cap in chunks it
 * joins again; it stores them on the public dataset under `users/<anon>/<world>/`, the manifest last. The share link then
 * is `#c=<anon>.<world>&m=<start mode>`: the player reads the world from the package and opens it cooked, or live when the
 * package is stale. Loaded with the Publish hub, never by the editor's first page.
 */
import type { WorldDoc } from '@aether/core';
import { loadCatalog } from '@aether/assets';
import { assetGeneratorShape, cookManifest, DDC_CACHE_NAME, DDC_CODE_VERSION, encodeProgramSetFile, packGeometry, profileForStartMode, programSetBody, sourceHash, WORLD_FILE, worldIrHash, worldOutputKeys, type CookManifest, type StartMode } from '@aether/render';
import { decodeWorldFile, encodeWorldFile, type ShareMeta } from './share';

/** The upload function, on this site. */
export const COOK_UPLOAD_ENDPOINT = '/api/cook-upload';
/** Largest request body: one chunk (api/_lib/cook-upload.ts `CHUNK_BYTES`). */
export const CHUNK_BYTES = 4_000_000;
/** Largest file (api/_lib/cook-upload.ts `MAX_FILE_BYTES`): sent in chunks above {@link CHUNK_BYTES}. */
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
/** Largest package (api/_lib/cook-upload.ts `MAX_PACKAGE_BYTES`). */
export const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;
/** Packs are cut a little under the request cap (an entry larger than this gets a pack of its own, sent in chunks). */
const PACK_TARGET = 3_500_000;
/** Where this browser keeps its anonymous id and key. */
export const ANON_KEY = 'aether.cook.anon';
/** Longest wait for the cache writes of the outputs generated for the package (ms, without progress). */
const WRITE_WAIT_MS = 15_000;

/** What the cook reads from the renderer. */
export interface CookRenderer {
  openingPose(): { position: [number, number, number]; target: [number, number, number]; fov?: number } | null;
  /** Tour stops of the player's tour bar (WorldRenderer.viewStops); absent: the player computes them. */
  viewStops?(): Array<{ position: [number, number, number]; target: [number, number, number]; fov?: number; name?: string }>;
  sessionPrograms(): Array<{ tier: 'low' | 'medium' | 'high' | 'ultra'; boot: number; pairs: Array<[string, string]> }>;
  /** Generate into the geometry cache the outputs named (WorldRenderer.storeOutputsForCook); absent: they are left out. */
  storeOutputsForCook?(missing: ReadonlySet<string>, opts: { signal?: AbortSignal; onProgress?(done: number, total: number): void }): Promise<{ generated: number; failed: number }>;
}

export interface CookPublishInput {
  world: WorldDoc;
  /** The title screen (stored with the world). */
  meta?: ShareMeta;
  /** The replay seal (stored with the world when small enough). */
  proof?: object | null;
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
  /** Outputs generated for the package (the editor had not kept them). */
  generated: number;
  programs: number;
}

/** A package made in the browser, before upload. */
export interface BrowserPackage {
  manifest: CookManifest;
  files: Map<string, Uint8Array>;
  bytes: number;
  /** Entries left out (over the file cap, or not generated): a viewer generates them. */
  skipped: number;
  /** Outputs generated for the package. */
  generated: number;
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

const keyOf = (req: Request): string => new URL(req.url).pathname.split('/').pop() ?? '';

/** The cache entries of `wanted` present in `cache`. */
async function presentKeys(cache: Cache | null, wanted: ReadonlyMap<string, unknown>): Promise<Map<string, Request>> {
  const out = new Map<string, Request>();
  if (!cache) return out;
  for (const req of await cache.keys()) {
    const key = keyOf(req);
    if (wanted.has(key)) out.set(key, req);
  }
  return out;
}

/** Make the package of `world`: the world file, the geometry (generating what is missing) and the program record. */
export async function cookInBrowser(input: Pick<CookPublishInput, 'world' | 'meta' | 'proof' | 'renderer' | 'startMode' | 'signal' | 'onProgress' | 'caches'>): Promise<BrowserPackage> {
  const { renderer, startMode, signal } = input;
  const genVersion = DDC_CODE_VERSION;
  // The world exactly as the player reads it from the file: its IR hash is what the player and the cooked load check.
  const worldFile = await encodeWorldFile(input.world, input.meta ?? {}, input.proof ?? null);
  const decoded = await decodeWorldFile(worldFile);
  if (!decoded.ok) throw new Error(decoded.error);
  const world = decoded.payload.world;
  const irHash = await worldIrHash(world);
  const pose = renderer.openingPose();
  const opening: CookManifest['opening'] = pose ? { position: [...pose.position], target: [...pose.target], ...(pose.fov !== undefined ? { fov: pose.fov } : {}) } : null;
  const views = world.views ? undefined : renderer.viewStops?.().map((v) => ({ position: v.position, target: v.target, ...(v.fov !== undefined ? { fov: v.fov } : {}), ...(v.name !== undefined ? { name: v.name } : {}) }));
  const rec = { world, irHash, genVersion, startMode, opening, ...(views && views.length > 0 ? { views } : {}) };

  // Every output the world draws: those this page's lanes stored, then the rest generated into the cache.
  await loadCatalog().catch(() => undefined);
  const wanted = await worldOutputKeys(world, genVersion, assetGeneratorShape);
  const store = input.caches ?? (typeof caches !== 'undefined' ? caches : null);
  const cache = store ? await store.open(DDC_CACHE_NAME).catch(() => null) : null;
  let requests = await presentKeys(cache, wanted);
  let generated = 0;
  const missing = new Set([...wanted.keys()].filter((k) => !requests.has(k)));
  if (missing.size > 0 && cache && renderer.storeOutputsForCook) {
    input.onProgress(0.02, `Generating ${missing.size} pieces the editor did not keep`);
    const r = await renderer.storeOutputsForCook(missing, { signal, onProgress: (done, total) => input.onProgress(0.02 + (0.2 * done) / Math.max(1, total), `Generating ${done} of ${total} pieces`) });
    generated = r.generated;
    // The lanes write each entry just after its reply: wait until they are all there, or stop arriving.
    let last = requests.size;
    let since = Date.now();
    for (;;) {
      if (signal.aborted) throw signal.reason;
      requests = await presentKeys(cache, wanted);
      if (requests.size >= wanted.size) break;
      if (requests.size !== last) {
        last = requests.size;
        since = Date.now();
      } else if (Date.now() - since > WRITE_WAIT_MS) break;
      await new Promise((res) => setTimeout(res, 400));
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
    onEntry: (done, total) => input.onProgress(0.22 + (0.2 * done) / Math.max(1, total), 'Packing geometry'),
    signal,
    asset: assetGeneratorShape,
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
  files.set(WORLD_FILE, worldFile);
  input.onProgress(0.45, 'Packed');
  const manifest: CookManifest = { ...(await cookManifest(rec, profileForStartMode(startMode), geometry, programs)), ir: { file: WORLD_FILE, bytes: worldFile.byteLength, sha256: await bytesHex(worldFile) } };
  let bytes = 0;
  for (const b of files.values()) bytes += b.byteLength;
  return { manifest, files, bytes, skipped: geometry.stats.tooLarge + geometry.stats.malformed + (wanted.size - requests.size), generated };
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

async function bytesHex(b: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>));
  let s = '';
  for (const x of d) s += x.toString(16).padStart(2, '0');
  return s;
}

/** Upload a package made by {@link cookInBrowser}: a ticket, every file (in chunks above the request cap), then the manifest. */
export async function uploadPackage(pkg: BrowserPackage, input: Pick<CookPublishInput, 'signal' | 'onProgress' | 'endpoint' | 'fetch' | 'storage'>): Promise<{ ref: string; path: string }> {
  const f = input.fetch ?? ((u, i) => fetch(u, i));
  const endpoint = input.endpoint ?? COOK_UPLOAD_ENDPOINT;
  const storage = input.storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : input.storage;
  const { signal } = input;
  const world = pkg.manifest.irHash.slice(0, 16);
  for (let attempt = 0; ; attempt++) {
    const id = await identity(f, endpoint, storage, signal);
    const who = { 'x-aether-anon': id.anon, 'x-aether-key': id.key };
    try {
      const begun = await call(f, `${endpoint}?op=begin`, { method: 'POST', headers: { ...who, 'content-type': 'application/json' }, body: JSON.stringify({ world, bytes: pkg.bytes, files: pkg.files.size }), signal });
      if (typeof begun.ticket !== 'string') throw new UploadError(502, 'the upload service gave no ticket');
      const headers = { ...who, 'x-aether-ticket': begun.ticket };
      let sent = 0;
      const blob = async (bytes: Uint8Array, name: string): Promise<string> => {
        const r = await call(f, `${endpoint}?op=blob`, { method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream' }, body: bytes as Uint8Array<ArrayBuffer>, signal });
        const oid = await bytesHex(bytes);
        if (r.oid !== oid) throw new UploadError(502, `${name} arrived damaged`);
        sent += bytes.byteLength;
        input.onProgress(0.45 + (0.5 * sent) / Math.max(1, pkg.bytes), `Uploading ${Math.round(sent / 1e5) / 10} of ${Math.round(pkg.bytes / 1e5) / 10} MB`);
        return oid;
      };
      const oids: Record<string, string> = {};
      for (const [file, bytes] of pkg.files) {
        if (bytes.byteLength <= CHUNK_BYTES) {
          oids[file] = await blob(bytes, file);
          continue;
        }
        // Larger than one request: its chunks, then the function joins them into the file.
        const parts: Array<{ oid: string; size: number }> = [];
        for (let at = 0; at < bytes.byteLength; at += CHUNK_BYTES) {
          const chunk = bytes.subarray(at, Math.min(bytes.byteLength, at + CHUNK_BYTES));
          parts.push({ oid: await blob(chunk, file), size: chunk.byteLength });
        }
        const oid = await bytesHex(bytes);
        const r = await call(f, `${endpoint}?op=assemble`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ oid, size: bytes.byteLength, parts }), signal });
        if (r.oid !== oid) throw new UploadError(502, `${file} arrived damaged`);
        oids[file] = oid;
      }
      input.onProgress(0.97, 'Publishing');
      const r = await call(f, `${endpoint}?op=commit`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ world, manifest: pkg.manifest, files: oids }), signal });
      if (typeof r.ref !== 'string' || typeof r.path !== 'string') throw new UploadError(502, 'the upload service gave no path');
      return { ref: r.ref, path: r.path };
    } catch (e) {
      // A key the server no longer signs (its secret changed): forget it and ask for a new id, once.
      if (e instanceof UploadError && e.status === 401 && attempt === 0 && /anonymous id/.test(e.message)) {
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
  if (pkg.bytes > MAX_PACKAGE_BYTES) throw new Error(`the cooked world is ${Math.round(pkg.bytes / 1e6)} MB, over the ${Math.round(MAX_PACKAGE_BYTES / 1048576)} MB limit`);
  const up = await uploadPackage(pkg, input);
  input.onProgress(1, 'Published');
  return { ref: up.ref, path: up.path, files: pkg.files.size, bytes: pkg.bytes, entries: Object.keys(pkg.manifest.entries).length, generated: pkg.generated, programs: Object.values(pkg.manifest.programs).reduce((n, p) => n + (p?.programs ?? 0), 0) };
}
