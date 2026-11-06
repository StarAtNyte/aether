/**
 * The page's side of a cooked load (cook/format.ts): open a world's cooked package, check that it was cooked from this IR
 * by this build's generators, and hand its parts to the renderer:
 *
 * - the geometry index goes to the generation lanes (gen-pool.ts `setCook`), which read the packs instead of generating
 *   and seed the geometry cache (geometry/ddc.ts) with what they read;
 * - the program set of the tier in effect goes to the program cache (gpu/program-cache.ts): the renderer's boot pre-warm
 *   links its boot pairs while the world loads, the rest at rest after the first picture; the session's save keeps the
 *   programs it used in IndexedDB for the editor and later visits;
 * - the opening view, the start mode and an optional bundled lightmap folder go to the host.
 *
 * Anything missing, malformed or stale makes {@link openCookedPackage} answer `ok: false`, and the host loads live.
 */
import type { RenderTier } from '../gpu/finishing';
import type { ProgramStore } from '../gpu/program-cache';
import { DDC_CODE_VERSION } from '../geometry/ddc';
import { MAX_MANIFEST_BYTES, MAX_PROGRAM_SET_BYTES, parseCookedProgramSet, parseCookManifest, readProgramSetFile, worldIrHash, type CookedProgramSet, type CookManifest, type LaneCookIndex } from './format';

/** Longest wait for the manifest (ms): a slow host must not hold the live path back for long. */
export const MANIFEST_TIMEOUT_MS = 4000;

/** What a cooked load did (probes, the debug overlay). */
export interface CookedStats {
  /** Manifest fetch and check, ms. */
  openMs: number;
  /** Program sets fetched (by tier) and how long each took. */
  programs: Partial<Record<RenderTier, { ms: number; pairs: number } | null>>;
}

/** An opened cooked package. */
export interface CookedPackage {
  readonly manifest: CookManifest;
  /** Absolute URL of the cook's folder (ends in `/`). */
  readonly base: string;
  /** The geometry index of the generation lanes. */
  readonly laneIndex: LaneCookIndex;
  /** Absolute URL of the bundled lightmap folder, or null. */
  readonly lightmapBase: string | null;
  readonly stats: CookedStats;
  /** The program set of `tier` (fetched once; null when the cook has none or it does not load). */
  programs(tier: RenderTier): Promise<CookedProgramSet | null>;
  /** A program store that serves the cooked sets on top of `inner` and writes them into it (see {@link cookedProgramStore}). */
  programStore(inner: ProgramStore | null): ProgramStore;
}

/** Result of {@link openCookedPackage}. */
export type CookedOpen = { ok: true; pkg: CookedPackage } | { ok: false; reason: string };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** localStorage key of the packages whose spot check failed on this device (their `dir`s, newest last). */
const DISTRUST_KEY = 'aether-cook-distrust';
const MAX_DISTRUSTED = 32;

function distrusted(): string[] {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(DISTRUST_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((d): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Remember that the package in `dir` failed a spot check here (gen-pool.ts `onCookMismatch`): later loads of it on this
 * device go live without trying it. Never throws.
 */
export function distrustCookedPackage(dir: string): void {
  try {
    const list = distrusted().filter((d) => d !== dir);
    list.push(dir);
    globalThis.localStorage?.setItem(DISTRUST_KEY, JSON.stringify(list.slice(-MAX_DISTRUSTED)));
  } catch {
    // No storage: the next load tries the package again and its spot check fails again.
  }
}

async function readJson(res: Response, max: number): Promise<unknown> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > max) throw new Error('too large');
  const text = await res.text();
  if (text.length > max) throw new Error('too large');
  return JSON.parse(text);
}

/**
 * Open the cooked package whose manifest is at `manifestUrl` for `world` (the parsed IR). `genVersion` defaults to this
 * build's geometry code version. Never throws.
 */
export async function openCookedPackage(manifestUrl: string, world: object, opts: { genVersion?: string; fetch?: FetchLike; timeoutMs?: number } = {}): Promise<CookedOpen> {
  const t0 = performance.now();
  const doFetch: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? MANIFEST_TIMEOUT_MS);
  let raw: unknown;
  let url: URL;
  try {
    url = new URL(manifestUrl, typeof document !== 'undefined' ? document.baseURI : undefined);
    const res = await doFetch(url.href, { signal: ctrl.signal, credentials: 'same-origin', cache: 'no-cache' });
    if (!res.ok) return { ok: false, reason: `no cooked package (HTTP ${res.status})` };
    // JSON, or plain text as Hugging Face serves a dataset's .json files; an HTML page (a static host's fallback) is no package.
    if (!/json|text\/plain/i.test(res.headers.get('content-type') ?? '')) return { ok: false, reason: 'no cooked package' };
    raw = await readJson(res, MAX_MANIFEST_BYTES);
  } catch (e) {
    return { ok: false, reason: `no cooked package (${e instanceof Error ? e.message.slice(0, 80) : 'error'})` };
  } finally {
    clearTimeout(timer);
  }
  const parsed = parseCookManifest(raw);
  if (!parsed.ok) return { ok: false, reason: `cooked manifest rejected: ${parsed.error}` };
  const m = parsed.manifest;
  const gen = opts.genVersion ?? DDC_CODE_VERSION;
  if (m.genVersion !== gen) return { ok: false, reason: `stale cook: generator code ${m.genVersion}, this build ${gen}` };
  let ir: string;
  try {
    ir = await worldIrHash(world);
  } catch {
    return { ok: false, reason: 'the world cannot be hashed' };
  }
  if (ir !== m.irHash) return { ok: false, reason: 'stale cook: the world changed since it was cooked' };
  if (distrusted().includes(m.dir)) return { ok: false, reason: 'cooked geometry failed a spot check on this device' };
  const base = new URL(m.dir.endsWith('/') ? m.dir : `${m.dir}/`, url).href;
  const stats: CookedStats = { openMs: Math.round(performance.now() - t0), programs: {} };
  const sets = new Map<RenderTier, Promise<CookedProgramSet | null>>();
  const programs = (tier: RenderTier): Promise<CookedProgramSet | null> => {
    let p = sets.get(tier);
    if (!p) {
      const f = m.programs[tier];
      const at = performance.now();
      p = f
        ? doFetch(new URL(f.file, base).href, { credentials: 'same-origin' })
            .then(async (res) => {
              if (!res.ok || Number(res.headers.get('content-length') ?? '0') > MAX_PROGRAM_SET_BYTES) return null;
              // Format 3 is gzipped JSON (`<tier>.bin`), format 2 plain JSON (`<tier>.json`, older cooks).
              return parseCookedProgramSet(await readProgramSetFile(new Uint8Array(await res.arrayBuffer())), tier);
            })
            .catch(() => null)
            .then((set) => {
              stats.programs[tier] = set ? { ms: Math.round(performance.now() - at), pairs: set.pairs.length } : null;
              return set;
            })
        : Promise.resolve(null);
      sets.set(tier, p);
    }
    return p;
  };
  const pkg: CookedPackage = {
    manifest: m,
    base,
    laneIndex: { packs: m.packs.map((p) => new URL(p.file, base).href), entries: m.entries, ...(m.fingerprints ? { fingerprints: m.fingerprints } : {}) },
    lightmapBase: m.lightmap ? new URL(m.lightmap.base.endsWith('/') ? m.lightmap.base : `${m.lightmap.base}/`, base).href : null,
    stats,
    programs,
    programStore: (inner) => cookedProgramStore(inner, programs),
  };
  return { ok: true, pkg };
}

/**
 * A program store with the cooked sets beside `inner` (the browser's own, IndexedDB). `getSet` is the browser's own set of
 * the tier, recorded from what it drew (a cooked set never displaces it); `boot(tier)` is the cooked set's boot pairs (what
 * the cook's load of that tier drew before its first picture) and `later(tier)` the rest of it, linked at rest after the first
 * picture; `getSources` falls back to the cooked sources. Nothing cooked is written into `inner`: the session's save keeps
 * the programs it used, the cooked ones among them, as any other. Without `inner` it serves the cooked sets alone.
 */
export function cookedProgramStore(inner: ProgramStore | null, cooked: (tier: RenderTier) => Promise<CookedProgramSet | null>): ProgramStore {
  const sources = new Map<string, string>();
  const load = async (tier: RenderTier): Promise<CookedProgramSet | null> => {
    const set = await cooked(tier);
    if (set) for (const [h, code] of Object.entries(set.sources)) sources.set(h, code);
    return set;
  };
  const keys = (pairs: ReadonlyArray<[string, string]>): Set<string> => new Set(pairs.map(([v, f]) => `${v}:${f}`));
  return {
    async getSet(tier) {
      return inner ? inner.getSet(tier).catch(() => null) : null;
    },
    async putSet(tier, set) {
      await inner?.putSet(tier, set);
    },
    async getSources(hashes) {
      const out = inner ? await inner.getSources(hashes).catch(() => new Map<string, string>()) : new Map<string, string>();
      for (const h of hashes) {
        if (out.has(h)) continue;
        const code = sources.get(h);
        if (code !== undefined) out.set(h, code);
      }
      return out;
    },
    async putSources(s) {
      await inner?.putSources(s);
    },
    async prune(keep) {
      await inner?.prune(keep);
    },
    async boot(tier) {
      const set = await load(tier);
      return set && set.boot > 0 ? keys(set.pairs.slice(0, set.boot)) : null;
    },
    async later(tier) {
      const set = await load(tier);
      return set && set.pairs.length > set.boot ? keys(set.pairs.slice(set.boot)) : null;
    },
  };
}
