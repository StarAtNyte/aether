/**
 * The loaded catalog. The catalog JSON (~100 KB) is not needed for a first
 * frame, so it is loaded lazily (its own chunk in the studio bundle) by
 * {@link loadCatalog}; synchronous consumers (physics collider derivation,
 * the planner) read whatever {@link getCatalog} has, and every async entry
 * point that may meet an `asset` shape awaits {@link loadCatalog} first.
 */
import { Catalog, type CatalogEntry } from './schema';

let current: Catalog | null = null;
let byId = new Map<string, CatalogEntry>();
let loading: Promise<Catalog> | null = null;

/** Set by the studio's build when it ships a subset of the library (see scripts/vite/asset-library.ts). */
declare const __AETHER_LIB_LEAN__: boolean | undefined;

/** Files the lean build ships next to the bundle; every other library file is fetched from `base`. */
interface Remote {
  base: string;
  shipped: ReadonlySet<string>;
}
let remote: Remote | null = null;

/** Install (or clear with `null`) the on-demand source of the library files a lean build does not ship. */
export function setLibraryRemote(r: { base: string; shipped: readonly string[] } | null): void {
  remote = r ? { base: r.base, shipped: new Set(r.shipped) } : null;
}

/** Fetch the lean build's index (`remote.json`, next to the shipped files); absent when the whole library ships. */
async function loadRemote(base: string): Promise<void> {
  if (typeof __AETHER_LIB_LEAN__ === 'undefined' || !__AETHER_LIB_LEAN__ || typeof fetch === 'undefined') return;
  try {
    const res = await fetch(`${base}remote.json`);
    if (!res.ok) return;
    const j = (await res.json()) as { base?: unknown; shipped?: unknown };
    if (typeof j.base === 'string' && Array.isArray(j.shipped)) setLibraryRemote({ base: j.base, shipped: j.shipped.filter((x): x is string => typeof x === 'string') });
  } catch {
    /* no index: every file is looked up locally */
  }
}

function install(c: Catalog): Catalog {
  current = c;
  byId = new Map(c.entries.map((e) => [e.id, e]));
  return c;
}

/** Install a catalog (validated). Tests and alternative hosts use this; pass `null` to clear. */
export function setCatalog(c: unknown): Catalog | null {
  loading = null;
  if (c === null) {
    current = null;
    byId = new Map();
    return null;
  }
  return install(Catalog.parse(c));
}

/** The installed catalog, or null before {@link loadCatalog} resolved. */
export function getCatalog(): Catalog | null {
  return current;
}

/** Entry by id from the installed catalog (null when unknown or not loaded). */
export function catalogEntry(id: string): CatalogEntry | null {
  return byId.get(id) ?? null;
}

/**
 * Load (once) and install the bundled library catalog. Resolves to an empty
 * catalog when the library has not been built, so callers never fail.
 */
export function loadCatalog(): Promise<Catalog> {
  if (current) return Promise.resolve(current);
  loading ??= import('../../../assets/catalog.json')
    .then(async (m: { default: unknown }) => {
      const c = Catalog.parse(m.default);
      // The lean build's index first: once the catalog is installed, synchronous readers build URLs from it.
      await loadRemote(c.base);
      return install(c);
    })
    .catch(() => install({ version: 1, base: '/assets/lib/', packs: [], entries: [] }));
  return loading;
}

/** Public URL of a library file (`m/sofa.0123abcd.glb` → `/assets/lib/m/sofa.0123abcd.glb`), or its CDN URL when a lean build does not ship it. */
export function libraryUrl(path: string, catalog: Pick<Catalog, 'base'> | null = current): string {
  if (remote && !remote.shipped.has(path)) return `${remote.base}${path}`;
  return `${catalog?.base ?? '/assets/lib/'}${path}`;
}

/** Library-relative path of a library URL (local or CDN), or null when the URL is not a library file. */
export function libraryPathOf(url: string, base: string = current?.base ?? '/assets/lib/'): string | null {
  if (url.startsWith(base)) return url.slice(base.length);
  if (remote && url.startsWith(remote.base)) return url.slice(remote.base.length);
  return null;
}

/**
 * True for a URL under the lean build's CDN base (set by the build, never by a world): the renderer may fetch
 * it although it is not a same-origin path.
 */
export function isLibraryRemoteUrl(url: string): boolean {
  return remote !== null && url.startsWith(remote.base) && !url.slice(remote.base.length).includes('..');
}
