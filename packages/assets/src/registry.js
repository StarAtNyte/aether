/**
 * The loaded catalog. The catalog JSON (~100 KB) is not needed for a first
 * frame, so it is loaded lazily (its own chunk in the studio bundle) by
 * {@link loadCatalog}; synchronous consumers (physics collider derivation,
 * the planner) read whatever {@link getCatalog} has, and every async entry
 * point that may meet an `asset` shape awaits {@link loadCatalog} first.
 */
import { Catalog } from './schema';
let current = null;
let byId = new Map();
let loading = null;
function install(c) {
    current = c;
    byId = new Map(c.entries.map((e) => [e.id, e]));
    return c;
}
/** Install a catalog (validated). Tests and alternative hosts use this; pass `null` to clear. */
export function setCatalog(c) {
    loading = null;
    if (c === null) {
        current = null;
        byId = new Map();
        return null;
    }
    return install(Catalog.parse(c));
}
/** The installed catalog, or null before {@link loadCatalog} resolved. */
export function getCatalog() {
    return current;
}
/** Entry by id from the installed catalog (null when unknown or not loaded). */
export function catalogEntry(id) {
    return byId.get(id) ?? null;
}
/**
 * Load (once) and install the bundled library catalog. Resolves to an empty
 * catalog when the library has not been built, so callers never fail.
 */
export function loadCatalog() {
    if (current)
        return Promise.resolve(current);
    loading ??= import('../../../assets/catalog.json')
        .then((m) => install(Catalog.parse(m.default)))
        .catch(() => install({ version: 1, base: '/assets/lib/', packs: [], entries: [] }));
    return loading;
}
/** Public URL of a library file (`m/sofa.0123abcd.glb` → `/assets/lib/m/sofa.0123abcd.glb`). */
export function libraryUrl(path, catalog = current) {
    return `${catalog?.base ?? '/assets/lib/'}${path}`;
}
