/**
 * Defensive checks for untrusted input (LLM output, network payloads, files).
 *
 * Runs BEFORE zod so that hostile structures never reach code that assigns
 * object keys: prototype-pollution keys, exotic objects, excessive nesting,
 * oversized strings and node-count bombs are rejected up front.
 */
import { LIMITS } from './limits';
import { isPlainObject } from './json';
/** Keys that can mutate prototypes when assigned on plain objects. */
export const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** True when `key` must never be used as an object key or id. */
export function isForbiddenKey(key) {
    return FORBIDDEN_KEYS.has(key);
}
const DEFAULT_GUARD = {
    maxDepth: LIMITS.MAX_INPUT_DEPTH,
    maxNodes: LIMITS.MAX_INPUT_NODES,
    maxStringLength: LIMITS.MAX_STRING_LENGTH,
};
function pathToString(node) {
    const keys = [];
    for (let n = node; n; n = n.parent)
        keys.push(n.key);
    return keys.reverse().join('.');
}
/**
 * Walk an untrusted JSON-like value iteratively (no recursion, so no stack
 * overflow on deep input) and verify it is safe to hand to zod and to merge.
 */
export function inspectUntrusted(value, limits = {}) {
    const lim = { ...DEFAULT_GUARD, ...limits };
    const stack = [{ v: value, depth: 0, path: null }];
    let nodes = 0;
    while (stack.length > 0) {
        const item = stack.pop();
        const { v, depth, path } = item;
        if (++nodes > lim.maxNodes) {
            return { ok: false, path: pathToString(path), message: `input is too large (more than ${lim.maxNodes} values)` };
        }
        switch (typeof v) {
            case 'string':
                if (v.length > lim.maxStringLength) {
                    return { ok: false, path: pathToString(path), message: `string is too long (${v.length} > ${lim.maxStringLength} characters)` };
                }
                continue;
            case 'number':
            case 'boolean':
            case 'undefined':
                continue;
            case 'object':
                break;
            default:
                return { ok: false, path: pathToString(path), message: `unsupported value of type ${typeof v}` };
        }
        if (v === null)
            continue;
        if (depth >= lim.maxDepth) {
            return { ok: false, path: pathToString(path), message: `input is nested deeper than ${lim.maxDepth} levels` };
        }
        if (Array.isArray(v)) {
            for (let i = 0; i < v.length; i++)
                stack.push({ v: v[i], depth: depth + 1, path: { parent: path, key: String(i) } });
            continue;
        }
        if (!isPlainObject(v)) {
            return { ok: false, path: pathToString(path), message: 'only plain JSON objects are allowed' };
        }
        for (const key of Object.keys(v)) {
            if (FORBIDDEN_KEYS.has(key)) {
                return { ok: false, path: pathToString({ parent: path, key }), message: `forbidden key "${key}"` };
            }
            stack.push({ v: v[key], depth: depth + 1, path: { parent: path, key } });
        }
    }
    return { ok: true, nodes };
}
