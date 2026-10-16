/**
 * Favourite library assets (per browser, localStorage). Stored ids are
 * untrusted on read: only slug-shaped strings are kept, capped in count.
 */
import { readJson, writeJson } from '../lib/storage';
/** localStorage key. */
export const FAVORITES_KEY = 'aether.assets.favorites';
/** Most favourites kept. */
export const MAX_FAVORITES = 200;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Read favourites (validated, deduplicated, capped). */
export function readFavorites(storage) {
    const raw = readJson(storage, FAVORITES_KEY);
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const v of raw) {
        if (typeof v === 'string' && SLUG.test(v) && !out.includes(v))
            out.push(v);
        if (out.length >= MAX_FAVORITES)
            break;
    }
    return out;
}
/** Toggle one favourite and persist; returns the new list. */
export function toggleFavorite(storage, current, id) {
    if (!SLUG.test(id))
        return [...current];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [id, ...current].slice(0, MAX_FAVORITES);
    writeJson(storage, FAVORITES_KEY, next);
    return next;
}
