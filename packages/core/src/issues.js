import { closestMatch, hasOwn, isPlainObject, truncate } from './json';
/** Join path segments with dots ("rules.0.then.1"). */
export function joinPath(path) {
    return path.map((p) => String(p)).join('.');
}
function fmtValue(v) {
    return typeof v === 'string' ? v : JSON.stringify(v) ?? String(v);
}
function describe(issue) {
    switch (issue.code) {
        case 'invalid_value': {
            const values = issue.values ?? [];
            if (values.length === 1)
                return `must be ${fmtValue(values[0])}`;
            return `must be one of ${values.map(fmtValue).join('|')}`;
        }
        case 'invalid_type': {
            const received = /received (\w+)/.exec(issue.message)?.[1];
            if (received === 'undefined')
                return `is required (${issue.expected ?? 'value'})`;
            return `must be ${issue.expected ?? 'a valid value'}${received ? ` (received ${received})` : ''}`;
        }
        case 'too_small':
        case 'too_big': {
            const small = issue.code === 'too_small';
            const bound = String(small ? issue.minimum : issue.maximum);
            if (issue.origin === 'array' || issue.origin === 'set')
                return `must have ${small ? 'at least' : 'at most'} ${bound} item(s)`;
            if (issue.origin === 'string')
                return `must be ${small ? 'at least' : 'at most'} ${bound} character(s)`;
            const cmp = small ? (issue.inclusive === false ? '>' : '>=') : issue.inclusive === false ? '<' : '<=';
            return `must be ${cmp} ${bound}`;
        }
        case 'invalid_format':
            if (issue.message === 'ids are lowercase slugs') {
                return 'must be a lowercase slug like "red-car" (a-z, 0-9, "-", "_"; max 64 chars; starts with a letter or digit)';
            }
            if (issue.message === 'color must be #rrggbb')
                return 'must be a hex color "#rrggbb"';
            return issue.message.startsWith('Invalid') ? 'has an invalid format' : `is invalid: ${issue.message}`;
        case 'not_multiple_of':
            return issue.message.replace(/^Invalid number: /, 'must be ');
        case 'unrecognized_keys':
            return `has unknown field(s) ${(issue.keys ?? []).join(', ')}`;
        default:
            return issue.message.replace(/^Invalid input: /, '');
    }
}
function collect(issue, base, out) {
    const path = [...base, ...issue.path];
    if (issue.code === 'invalid_union') {
        if (issue.discriminator !== undefined && issue.options) {
            out.push({ path: joinPath(path), message: `must be one of ${issue.options.map(fmtValue).join('|')}` });
            return;
        }
        const branches = issue.errors ?? [];
        let best;
        for (const b of branches)
            if (b.length > 0 && (!best || b.length < best.length))
                best = b;
        if (best) {
            for (const sub of best)
                collect(sub, path, out);
            return;
        }
        out.push({ path: joinPath(path), message: 'does not match any allowed form' });
        return;
    }
    if (issue.code === 'invalid_key' && issue.issues && issue.issues.length > 0) {
        const key = String(path[path.length - 1] ?? '');
        const inner = issue.issues.map(describe).join('; ');
        out.push({ path: joinPath(path.slice(0, -1)), message: `key "${truncate(key, 64)}" ${inner}` });
        return;
    }
    out.push({ path: joinPath(path), message: describe(issue) });
}
/** Convert a zod error into dotted-path issues. `base` is prepended to every path. */
export function zodIssues(error, base = []) {
    const out = [];
    for (const raw of error.issues)
        collect(raw, base, out);
    return out;
}
/** "physics.body must be one of …" (or just the message when the path is empty). */
export function issueText(issue) {
    return issue.path ? `${issue.path} ${issue.message}` : issue.message;
}
/** Render up to `max` issues as a single "; "-separated sentence. */
export function issuesText(issues, max = 6) {
    const shown = issues.slice(0, max).map(issueText).join('; ');
    return issues.length > max ? `${shown}; …and ${issues.length - max} more` : shown;
}
const WRAPPERS = new Set(['default', 'optional', 'nullable', 'prefault', 'readonly', 'catch', 'nonoptional']);
function defOf(s) {
    const zod = s?._zod;
    return zod && isPlainObjectLike(zod.def) ? zod.def : undefined;
}
function isPlainObjectLike(v) {
    return v !== null && typeof v === 'object';
}
function unwrap(s) {
    let d = defOf(s);
    for (let i = 0; d && i < 16 && WRAPPERS.has(String(d['type'])); i++)
        d = defOf(d['innerType']);
    return d;
}
function literalValues(s) {
    const d = unwrap(s);
    return d && d['type'] === 'literal' && Array.isArray(d['values']) ? d['values'] : [];
}
function safeParses(schema, value) {
    const parse = schema?.safeParse;
    return typeof parse === 'function' ? parse.call(schema, value).success : false;
}
function unknownKeyIssue(path, key, valid) {
    const full = [...path, key].join('.');
    const hint = closestMatch(key, valid);
    const list = valid.length <= 24 ? ` (valid: ${valid.join(', ')})` : '';
    return { path: full, message: `is not a known field${hint ? ` — did you mean '${hint}'?` : ''}${list}` };
}
/**
 * Report keys in `value` that `schema` does not declare (recursively through
 * objects, arrays, records and unions). Returns at most `max` issues.
 * Values that do not structurally match are skipped — zod reports those.
 */
export function findUnknownKeys(value, schema, path = [], max = 8) {
    const out = [];
    walkUnknown(value, schema, [...path], out, max);
    return out;
}
function walkUnknown(value, schema, path, out, max) {
    if (out.length >= max)
        return;
    const d = unwrap(schema);
    if (!d)
        return;
    switch (d['type']) {
        case 'object': {
            if (!isPlainObject(value))
                return;
            const shape = d['shape'];
            for (const key of Object.keys(value)) {
                if (!hasOwn(shape, key)) {
                    out.push(unknownKeyIssue(path, key, Object.keys(shape)));
                    if (out.length >= max)
                        return;
                    continue;
                }
                path.push(key);
                walkUnknown(value[key], shape[key], path, out, max);
                path.pop();
            }
            return;
        }
        case 'array': {
            if (!Array.isArray(value))
                return;
            for (let i = 0; i < value.length && out.length < max; i++) {
                path.push(String(i));
                walkUnknown(value[i], d['element'], path, out, max);
                path.pop();
            }
            return;
        }
        case 'record': {
            if (!isPlainObject(value))
                return;
            const valueType = d['valueType'];
            if (unwrap(valueType)?.['type'] === 'lazy')
                return; // free-form Json
            for (const key of Object.keys(value)) {
                path.push(key);
                walkUnknown(value[key], valueType, path, out, max);
                path.pop();
                if (out.length >= max)
                    return;
            }
            return;
        }
        case 'union': {
            const options = Array.isArray(d['options']) ? d['options'] : [];
            const disc = d['discriminator'];
            if (typeof disc === 'string') {
                if (!isPlainObject(value))
                    return;
                const tag = value[disc];
                for (const opt of options) {
                    const shape = unwrap(opt)?.['shape'];
                    if (shape && hasOwn(shape, disc) && literalValues(shape[disc]).includes(tag)) {
                        walkUnknown(value, opt, path, out, max);
                        return;
                    }
                }
                return;
            }
            for (const opt of options) {
                if (safeParses(opt, value)) {
                    walkUnknown(value, opt, path, out, max);
                    return;
                }
            }
            return;
        }
        default:
            return;
    }
}
