/**
 * Reading and writing world / entity state variables with the same key
 * semantics as `readStateKey` from @aether/core:
 *
 * - "score"           → world state `score`
 * - "door-1.open"     → entity `door-1` state `open` (entity wins over a same-named world key)
 * - "door-1.stats.hp" → nested value inside entity state
 * - "stats.hp"        → nested value inside world state `stats` when no entity "stats" exists
 *
 * All writes are prototype-pollution safe and bounded in size.
 */
import { hasOwn, inspectUntrusted, isForbiddenKey, isPlainObject, LIMITS } from '@aether/core';
/** Maximum keys in one entity's state record. */
export const MAX_ENTITY_STATE_KEYS = 256;
/** Maximum nesting of a state key path ("a.b.c…"). */
const MAX_PATH_SEGMENTS = 8;
/** Maximum JSON nodes in one written value. */
const MAX_VALUE_NODES = 2000;
/** Maximum string length inside one written value. */
const MAX_VALUE_STRING = 10_000;
function getPath(root, segments, from) {
    let cur = root;
    for (let i = from; i < segments.length; i++) {
        const seg = segments[i];
        if (Array.isArray(cur)) {
            if (!/^\d+$/.test(seg))
                return undefined;
            cur = cur[Number(seg)];
        }
        else if (isPlainObject(cur)) {
            cur = hasOwn(cur, seg) ? cur[seg] : undefined;
        }
        else {
            return undefined;
        }
        if (cur === undefined)
            return undefined;
    }
    return cur;
}
/** Read a state key (see module docs for semantics). */
export function readState(scope, key) {
    const dot = key.indexOf('.');
    if (dot > 0) {
        const es = scope.entityState(key.slice(0, dot));
        if (es)
            return getPath(es, key.slice(dot + 1).split('.'), 0);
    }
    if (hasOwn(scope.world, key))
        return scope.world[key];
    return dot > 0 ? getPath(scope.world, key.split('.'), 0) : undefined;
}
/** Validate a value before it is stored (size, depth, forbidden keys). Throws on violation. */
export function assertStorable(value) {
    if (value === null || typeof value !== 'object') {
        if (typeof value === 'string' && value.length > MAX_VALUE_STRING)
            throw new Error('state value string is too long');
        if (typeof value === 'number' && !Number.isFinite(value))
            throw new Error('state value must be a finite number');
        return;
    }
    const res = inspectUntrusted(value, { maxDepth: 16, maxNodes: MAX_VALUE_NODES, maxStringLength: MAX_VALUE_STRING });
    if (!res.ok)
        throw new Error(`state value rejected: ${res.message}`);
}
function cloneJson(v) {
    return v !== null && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
}
function setPath(root, segments, value, maxRootKeys) {
    if (segments.length === 0 || segments.length > MAX_PATH_SEGMENTS)
        throw new Error('state key path is empty or too deep');
    let cur = root;
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (seg.length === 0 || isForbiddenKey(seg))
            throw new Error(`forbidden state key segment "${seg}"`);
        if (i === 0 && !hasOwn(cur, seg) && Object.keys(cur).length >= maxRootKeys) {
            throw new Error(`too many state variables (max ${maxRootKeys})`);
        }
        if (i === segments.length - 1) {
            cur[seg] = value;
            return;
        }
        const next = hasOwn(cur, seg) ? cur[seg] : undefined;
        if (isPlainObject(next)) {
            cur = next;
        }
        else {
            const fresh = {};
            cur[seg] = fresh;
            cur = fresh;
        }
    }
}
/**
 * Write a state key. Returns the previous value. Values are deep-copied so
 * later mutations of the source (e.g. the world document) never leak in.
 * Throws on forbidden keys, size limits or too many variables.
 */
export function writeState(scope, key, value) {
    if (key.length === 0 || key.length > 200)
        throw new Error('state key must be 1–200 characters');
    assertStorable(value);
    const before = readState(scope, key);
    const stored = cloneJson(value);
    const dot = key.indexOf('.');
    if (dot > 0) {
        const es = scope.entityState(key.slice(0, dot));
        if (es) {
            setPath(es, key.slice(dot + 1).split('.'), stored, MAX_ENTITY_STATE_KEYS);
            return before;
        }
        const head = key.slice(0, dot);
        if (!hasOwn(scope.world, key) && hasOwn(scope.world, head) && isPlainObject(scope.world[head])) {
            setPath(scope.world, key.split('.'), stored, LIMITS.MAX_STATE_KEYS);
            return before;
        }
    }
    setPath(scope.world, [key], stored, LIMITS.MAX_STATE_KEYS);
    return before;
}
/** Deep copy of a state record (used for initial state and resets). */
export function cloneState(rec) {
    const out = {};
    for (const k of Object.keys(rec)) {
        if (isForbiddenKey(k))
            continue;
        out[k] = cloneJson(rec[k]);
    }
    return out;
}
/** Short human-readable rendering of a state value for logs. */
export function showValue(v) {
    if (v === undefined)
        return 'unset';
    if (typeof v === 'number')
        return String(Math.round(v * 1000) / 1000);
    const s = JSON.stringify(v);
    return s.length > 40 ? `${s.slice(0, 37)}...` : s;
}
