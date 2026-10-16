/**
 * Parameter resolution for generators: defaults, clamping, integer rounding,
 * enum/color validation and lenient coercion of LLM-written values. Unknown
 * params are ignored; prototype-polluting keys are never read or written.
 */
import { isForbiddenKey } from '@aether/core';
import { normalizeHex } from './color';
function typeDefault(spec) {
    switch (spec.type) {
        case 'number':
        case 'int':
            return spec.min !== undefined ? spec.min : 0;
        case 'boolean':
            return false;
        case 'color':
            return '#cccccc';
        case 'enum':
            return spec.options?.[0] ?? '';
    }
}
function toNumber(v) {
    if (typeof v === 'number')
        return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '' && v.length < 64) {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    if (typeof v === 'boolean')
        return v ? 1 : 0;
    return null;
}
function coerce(spec, v) {
    switch (spec.type) {
        case 'number':
        case 'int': {
            let n = toNumber(v);
            if (n === null)
                return undefined;
            if (spec.type === 'int')
                n = Math.round(n);
            if (spec.min !== undefined && n < spec.min)
                n = spec.type === 'int' ? Math.ceil(spec.min) : spec.min;
            if (spec.max !== undefined && n > spec.max)
                n = spec.type === 'int' ? Math.floor(spec.max) : spec.max;
            return n;
        }
        case 'boolean':
            if (typeof v === 'boolean')
                return v;
            if (v === 'true' || v === 1 || v === '1' || v === 'yes')
                return true;
            if (v === 'false' || v === 0 || v === '0' || v === 'no')
                return false;
            return undefined;
        case 'color':
            return normalizeHex(v) ?? undefined;
        case 'enum': {
            if (typeof v !== 'string')
                return undefined;
            const opts = spec.options ?? [];
            if (opts.includes(v))
                return v;
            const lower = v.toLowerCase();
            return opts.find((o) => o.toLowerCase() === lower);
        }
    }
}
/**
 * Resolve `params` against `spec`: every spec key gets a valid value (the
 * given one when coercible, otherwise the spec default, otherwise a type
 * default). Numbers are clamped to [min, max]; ints rounded; colors
 * normalized to "#rrggbb"; enums matched case-insensitively. Keys not in
 * `spec` are ignored.
 */
export function resolveParams(spec, params) {
    const out = {};
    const given = typeof params === 'object' && params !== null && !Array.isArray(params) ? params : {};
    for (const key of Object.keys(spec)) {
        if (isForbiddenKey(key))
            continue;
        const s = spec[key];
        if (!s)
            continue;
        const fromParams = Object.hasOwn(given, key) ? coerce(s, given[key]) : undefined;
        if (fromParams !== undefined) {
            out[key] = fromParams;
            continue;
        }
        const fromDefault = coerce(s, s.default);
        out[key] = fromDefault !== undefined ? fromDefault : (coerce(s, typeDefault(s)) ?? typeDefault(s));
    }
    return out;
}
/** Wrap resolved params for typed access; falls back to safe values on type mismatch. */
export function paramReader(p) {
    const get = (k) => (Object.hasOwn(p, k) ? p[k] : undefined);
    return {
        num: (k) => {
            const v = get(k);
            return typeof v === 'number' && Number.isFinite(v) ? v : 0;
        },
        int: (k) => {
            const v = get(k);
            return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
        },
        bool: (k) => get(k) === true,
        color: (k) => normalizeHex(get(k)) ?? '#cccccc',
        str: (k) => {
            const v = get(k);
            return typeof v === 'string' ? v : '';
        },
    };
}
