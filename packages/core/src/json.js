/**
 * Small, allocation-conscious helpers for plain JSON-like data.
 */
/** `Object.hasOwn` wrapper — ALWAYS use this for lookups keyed by untrusted ids. */
export function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}
/** True for `{}`-style objects (not arrays, class instances, Maps, Dates…). */
export function isPlainObject(v) {
    if (v === null || typeof v !== 'object' || Array.isArray(v))
        return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
}
/**
 * Structural equality for JSON-like values.
 * Keys whose value is `undefined` are treated as absent (JSON semantics).
 * Reference-equal inputs short-circuit, which makes comparing structurally
 * shared documents cheap.
 */
export function deepEqual(a, b) {
    if (a === b)
        return true;
    if (typeof a !== typeof b)
        return false;
    if (typeof a === 'number')
        return Number.isNaN(a) && Number.isNaN(b);
    if (a === null || b === null || typeof a !== 'object')
        return false;
    const aIsArray = Array.isArray(a);
    if (aIsArray !== Array.isArray(b))
        return false;
    if (aIsArray) {
        const aa = a;
        const bb = b;
        if (aa.length !== bb.length)
            return false;
        for (let i = 0; i < aa.length; i++)
            if (!deepEqual(aa[i], bb[i]))
                return false;
        return true;
    }
    const ao = a;
    const bo = b;
    let aCount = 0;
    for (const k in ao) {
        if (!hasOwn(ao, k))
            continue;
        const av = ao[k];
        if (av === undefined)
            continue;
        aCount++;
        if (!hasOwn(bo, k) || !deepEqual(av, bo[k]))
            return false;
    }
    let bCount = 0;
    for (const k in bo)
        if (hasOwn(bo, k) && bo[k] !== undefined)
            bCount++;
    return aCount === bCount;
}
/**
 * Deterministic JSON serialization with sorted object keys (for cache keys and
 * content hashes). Follows `JSON.stringify` conventions: `undefined`/functions
 * are omitted in objects and become `null` in arrays, non-finite numbers become
 * `null`, `toJSON()` is honoured. Throws `TypeError` on cycles and bigint.
 */
export function stableStringify(v) {
    const parts = [];
    writeStable(v, parts, new Set());
    return parts.join('');
}
function writeStable(v, out, stack) {
    if (v !== null && typeof v === 'object' && typeof v.toJSON === 'function') {
        v = v.toJSON();
    }
    switch (typeof v) {
        case 'string':
            out.push(JSON.stringify(v));
            return;
        case 'number':
            out.push(Number.isFinite(v) ? String(v) : 'null');
            return;
        case 'boolean':
            out.push(v ? 'true' : 'false');
            return;
        case 'bigint':
            throw new TypeError('stableStringify: bigint is not serializable');
        case 'undefined':
        case 'function':
        case 'symbol':
            out.push('null');
            return;
        default:
            break;
    }
    if (v === null) {
        out.push('null');
        return;
    }
    const obj = v;
    if (stack.has(obj))
        throw new TypeError('stableStringify: cyclic structure');
    stack.add(obj);
    if (Array.isArray(obj)) {
        out.push('[');
        for (let i = 0; i < obj.length; i++) {
            if (i > 0)
                out.push(',');
            writeStable(obj[i], out, stack);
        }
        out.push(']');
    }
    else {
        const rec = obj;
        const keys = Object.keys(rec).sort();
        out.push('{');
        let first = true;
        for (const k of keys) {
            const val = rec[k];
            if (val === undefined || typeof val === 'function' || typeof val === 'symbol')
                continue;
            if (!first)
                out.push(',');
            first = false;
            out.push(JSON.stringify(k), ':');
            writeStable(val, out, stack);
        }
        out.push('}');
    }
    stack.delete(obj);
}
/** Truncate a string for inclusion in messages, appending an ellipsis. */
export function truncate(s, max) {
    return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}
/** Levenshtein distance with an early-exit bound (used for "did you mean" hints). */
export function editDistance(a, b, bound = 8) {
    if (Math.abs(a.length - b.length) > bound)
        return bound + 1;
    let prev = new Array(b.length + 1);
    let cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++)
        prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        cur[0] = i;
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
            const v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
            cur[j] = v;
            if (v < rowMin)
                rowMin = v;
        }
        if (rowMin > bound)
            return bound + 1;
        [prev, cur] = [cur, prev];
    }
    return prev[b.length] ?? bound + 1;
}
/** Closest candidate to `word` (case-insensitive), or undefined when nothing is reasonably close. */
export function closestMatch(word, candidates) {
    const w = word.toLowerCase();
    const bound = Math.max(1, Math.min(4, Math.floor(w.length / 3) + 1));
    let best;
    let bestD = bound + 1;
    let scanned = 0;
    for (const c of candidates) {
        if (++scanned > 10_000)
            break;
        const lc = c.toLowerCase();
        const d = lc === w ? 0 : lc.includes(w) || w.includes(lc) ? 1 : editDistance(w, lc, bound);
        if (d < bestD) {
            bestD = d;
            best = c;
        }
    }
    return best;
}
