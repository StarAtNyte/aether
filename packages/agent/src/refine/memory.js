/**
 * What the next prompt can refer to. Plain data (JSON-safe), tiny, and free
 * of the parser so hosts can hold it without loading the fast path.
 */
import { inspectUntrusted, isEntityId } from '@aether/core';
/** An empty memory. */
export const EMPTY_MEMORY = Object.freeze({ targets: [], handled: [] });
const MAX_IDS = 256;
const MAX_COMMAND_JSON = 4_000;
const COMMAND_OPS = new Set([
    'paint', 'move', 'rotate', 'scale', 'resize', 'shape', 'remove', 'add', 'duplicate', 'rename', 'visibility', 'light', 'speed', 'behavior', 'door', 'dialogue', 'env', 'game', 'density', 'physics', 'voxel', 'repeat',
]);
function ids(v) {
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && isEntityId(x)).slice(0, MAX_IDS) : [];
}
/** Entity ids from an untrusted list (selection from a host): valid slugs only, bounded. */
export function sanitizeSelection(v) {
    return ids(v);
}
/**
 * Memory handed back by a host is untrusted until proven otherwise: keep only
 * well-formed ids and a size-bounded, plain-JSON command with a known op.
 */
export function sanitizeMemory(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v))
        return EMPTY_MEMORY;
    const m = v;
    const out = { targets: ids(m['targets']), handled: ids(m['handled']) };
    const rooms = ids(m['rooms']);
    if (rooms.length > 0)
        out.rooms = rooms;
    const last = m['last'];
    if (typeof last === 'object' && last !== null && !Array.isArray(last) && typeof last['op'] === 'string' && COMMAND_OPS.has(last['op'])) {
        const safe = inspectUntrusted(last, { maxDepth: 8, maxNodes: 400, maxStringLength: 400 });
        if (safe.ok) {
            try {
                const json = JSON.stringify(last);
                if (json.length <= MAX_COMMAND_JSON)
                    out.last = JSON.parse(json);
            }
            catch {
                /* not JSON: dropped */
            }
        }
    }
    return out;
}
