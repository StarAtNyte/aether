import { deepEqual, hasOwn, isPlainObject } from './json';
/** Entity merge rules. */
export const ENTITY_MERGE = {
    nullable: new Set(['parent']),
    discriminants: { shape: 'kind', 'shape.of': 'kind' },
};
/** Rule merge rules. */
export const RULE_MERGE = { nullable: new Set(), discriminants: { when: 'on' } };
/** Environment merge rules. */
export const ENVIRONMENT_MERGE = { nullable: new Set(['fog', 'ground']), discriminants: {} };
/** Player merge rules. */
export const PLAYER_MERGE = { nullable: new Set(), discriminants: {} };
/** Voxel terrain merge rules (`setVoxel`; arrays such as `edits` and `blocks` replace). */
export const VOXEL_MERGE = { nullable: new Set(), discriminants: {} };
function childPath(path, key) {
    return path ? `${path}.${key}` : key;
}
function discriminantChanged(cfg, path, base, next) {
    const disc = cfg.discriminants[path];
    return disc !== undefined && hasOwn(next, disc) && next[disc] !== base[disc];
}
/** Copy a replacement object, dropping `null` except at nullable paths. */
function stripNulls(v, cfg, path) {
    if (!isPlainObject(v))
        return v;
    const out = {};
    for (const key of Object.keys(v)) {
        const cp = childPath(path, key);
        const cv = v[key];
        if (cv === null && !cfg.nullable.has(cp))
            continue;
        out[key] = stripNulls(cv, cfg, cp);
    }
    return out;
}
/**
 * Deep-merge `patch` into `base` (never mutates either). Callers must have
 * screened `patch` with `inspectUntrusted` (no prototype keys).
 */
export function deepMerge(base, patch, cfg, path = '') {
    const out = isPlainObject(base) ? { ...base } : {};
    for (const key of Object.keys(patch)) {
        const v = patch[key];
        const cp = childPath(path, key);
        if (v === null) {
            if (cfg.nullable.has(cp))
                out[key] = null;
            else
                delete out[key];
        }
        else if (isPlainObject(v)) {
            const prev = out[key];
            out[key] =
                isPlainObject(prev) && !discriminantChanged(cfg, cp, prev, v)
                    ? deepMerge(prev, v, cfg, cp)
                    : stripNulls(v, cfg, cp);
        }
        else if (v !== undefined) {
            out[key] = v;
        }
    }
    return out;
}
/**
 * Smallest `set` such that `deepMerge(from, set)` deep-equals `to`, or
 * `undefined` when they are already equal.
 */
export function diffForMerge(from, to, cfg, path = '') {
    const a = isPlainObject(from) ? from : {};
    const b = isPlainObject(to) ? to : {};
    const set = {};
    let changed = false;
    for (const key of Object.keys(b)) {
        const tv = b[key];
        if (tv === undefined)
            continue;
        const fv = hasOwn(a, key) ? a[key] : undefined;
        if (fv === tv || deepEqual(fv, tv))
            continue;
        const cp = childPath(path, key);
        if (isPlainObject(fv) && isPlainObject(tv) && !discriminantChanged(cfg, cp, fv, tv)) {
            const sub = diffForMerge(fv, tv, cfg, cp);
            if (sub)
                set[key] = sub;
        }
        else {
            set[key] = tv;
        }
        changed = true;
    }
    for (const key of Object.keys(a)) {
        if (a[key] === undefined)
            continue;
        if (!hasOwn(b, key) || b[key] === undefined) {
            set[key] = null;
            changed = true;
        }
    }
    return changed ? set : undefined;
}
