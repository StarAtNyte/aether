/**
 * The offline generator library: procedural generators for common objects
 * that are not built in (lighthouse, pagoda, piano…), written ahead of time
 * by a coding model and validated (sandbox run, output checks, silhouette
 * check) by `scripts/build-generator-library.ts`. They ship as JSON and load
 * lazily, one file per generator.
 *
 * Library generators are ordinary custom generators: they are defined into a
 * world with `defineGenerator` and always execute in the generator sandbox,
 * exactly like model-written code at runtime.
 */
import { GeneratorDef } from '@aether/core';
import { LIBRARY_ENTRIES, LIBRARY_LOADERS } from './library-index';
import { staticCheckSource } from './sandbox/static-check';
/** All library generators (catalog only). */
export const GENERATOR_LIBRARY = LIBRARY_ENTRIES;
const BY_ID = new Map(GENERATOR_LIBRARY.map((e) => [e.id, e]));
const cache = new Map();
/** True when `id` names a library generator. */
export function isLibraryGenerator(id) {
    return BY_ID.has(id);
}
/**
 * Load and validate one library generator (null when unknown or invalid).
 * Shipped JSON is still treated as untrusted: schema + static check.
 */
export function loadLibraryGenerator(id) {
    const loader = Object.prototype.hasOwnProperty.call(LIBRARY_LOADERS, id) ? LIBRARY_LOADERS[id] : undefined;
    if (!loader)
        return Promise.resolve(null);
    let p = cache.get(id);
    if (!p) {
        p = loader()
            .then((mod) => {
            const raw = typeof mod === 'object' && mod !== null && 'default' in mod ? mod.default : mod;
            const def = typeof raw === 'object' && raw !== null ? raw.def : undefined;
            const parsed = GeneratorDef.safeParse(def);
            if (!parsed.success || parsed.data.id !== id || !staticCheckSource(parsed.data.source).ok)
                return null;
            return parsed.data;
        })
            .catch(() => null);
        cache.set(id, p);
    }
    return p;
}
function singular(w) {
    if (w.endsWith('ies') && w.length > 4)
        return `${w.slice(0, -3)}y`;
    if (/(ches|shes|xes|sses)$/.test(w))
        return w.slice(0, -2);
    if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3)
        return w.slice(0, -1);
    return w;
}
/**
 * Library generators mentioned in free text (whole-word keyword matches,
 * plural-insensitive, longest keyword first), at most `max`.
 */
export function matchLibrary(text, max = 3) {
    const words = (text.toLowerCase().match(/[a-z]+/g) ?? []).map(singular);
    const joined = ` ${words.join(' ')} `;
    const hits = [];
    for (const entry of GENERATOR_LIBRARY) {
        let best = null;
        for (const k of entry.keywords) {
            const kw = ` ${k.split(/\s+/).map(singular).join(' ')} `;
            const at = joined.indexOf(kw);
            if (at >= 0 && (!best || kw.length > best.len))
                best = { at, len: kw.length };
        }
        if (best)
            hits.push({ entry, ...best });
    }
    hits.sort((a, b) => a.at - b.at || b.len - a.len);
    return hits.slice(0, Math.max(0, max)).map((h) => h.entry);
}
