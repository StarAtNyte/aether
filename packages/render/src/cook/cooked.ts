/**
 * The page's side of a cooked load (cook/format.ts): open a world's cooked package, check that it was cooked from this IR
 * by this build's generators, and hand its parts to the renderer:
 *
 * - the geometry index goes to the generation lanes (gen-pool.ts `setCook`), which read the packs instead of generating
 *   and seed the geometry cache (geometry/ddc.ts) with what they read;
 * - the program sets seed the tier's program set (gpu/program-cache.ts): the renderer's boot pre-warm links them while
 *   the world loads, and the session's save keeps them in IndexedDB for the editor and later visits;
 * - the opening view, the start mode and an optional bundled lightmap folder go to the host.
 *
 * Anything missing, malformed or stale makes {@link openCookedPackage} answer `ok: false`, and the host loads live.
 */
import type { RenderTier } from '../gpu/finishing';
import { mergeSet, SET_CAP, type ProgramStore, type StoredSet } from '../gpu/program-cache';
import { DDC_CODE_VERSION } from '../geometry/ddc';
import { MAX_MANIFEST_BYTES, MAX_PROGRAM_SET_BYTES, parseCookedProgramSet, parseCookManifest, worldIrHash, type CookedProgramSet, type CookManifest, type LaneCookIndex } from './format';

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
    if (!/json/i.test(res.headers.get('content-type') ?? '')) return { ok: false, reason: 'no cooked package' };
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
            .then(async (res) => (res.ok ? parseCookedProgramSet(await readJson(res, MAX_PROGRAM_SET_BYTES), tier) : null))
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
    laneIndex: { packs: m.packs.map((p) => new URL(p.file, base).href), entries: m.entries },
    lightmapBase: m.lightmap ? new URL(m.lightmap.base.endsWith('/') ? m.lightmap.base : `${m.lightmap.base}/`, base).href : null,
    stats,
    programs,
    programStore: (inner) => cookedProgramStore(inner, programs),
  };
  return { ok: true, pkg };
}

/**
 * A program store with the cooked sets on top: `getSet(tier)` answers the stored set merged with the cooked one (the cooked
 * pairs most recent, so the pre-warm links them first), `getSources` falls back to the cooked sources, and the first read of
 * a tier writes the cooked set and its sources into `inner` (in the background), so the session's own save and later
 * visits, the editor's included, keep them. Without `inner` it serves the cooked sets alone.
 */
export function cookedProgramStore(inner: ProgramStore | null, cooked: (tier: RenderTier) => Promise<CookedProgramSet | null>): ProgramStore {
  const sources = new Map<string, string>();
  const seeded = new Map<RenderTier, Promise<void>>();
  const merged = async (tier: RenderTier): Promise<StoredSet | null> => {
    const [prev, set] = await Promise.all([inner ? inner.getSet(tier).catch(() => null) : Promise.resolve(null), cooked(tier)]);
    if (!set) return prev;
    for (const [h, code] of Object.entries(set.sources)) sources.set(h, code);
    // One session ahead of the stored set: the cooked pairs come first in the pre-warm order.
    const session = (prev?.session ?? 0) + 1;
    return mergeSet(prev, set.pairs.map(([v, f]) => ({ v, f })), SET_CAP[tier], session);
  };
  return {
    async getSet(tier) {
      const set = await merged(tier);
      if (inner && set && !seeded.has(tier)) {
        const own = new Map<string, string>();
        for (const e of set.entries) for (const h of [e.v, e.f]) {
          const code = sources.get(h);
          if (code !== undefined) own.set(h, code);
        }
        seeded.set(tier, inner.putSources(own).then(() => inner.putSet(tier, set)).catch(() => undefined));
      }
      return set;
    },
    async putSet(tier, set) {
      await seeded.get(tier);
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
      await Promise.all([...seeded.values()]);
      await inner?.prune(keep);
    },
    async boot(tier) {
      const set = await cooked(tier);
      return set && set.boot > 0 ? new Set(set.pairs.slice(0, set.boot).map(([v, f]) => `${v}:${f}`)) : null;
    },
  };
}
