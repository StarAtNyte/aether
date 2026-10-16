/**
 * Inspector editing helpers (pure). Raw JSON edits are untrusted input:
 * size-capped, prototype-pollution guarded and schema-validated before they
 * become an `update` patch computed with `patchesBetween`.
 */
import { Entity, inspectUntrusted, patchesBetween } from '@aether/core';
import { MAX_ENTITY_JSON_CHARS } from '../config';
/** Pretty JSON of an entity for the raw editor. */
export function entityToJson(e) {
    return JSON.stringify(e, null, 2);
}
/** Parse and validate edited entity JSON. The id must stay `expectedId` (renames use the id field). */
export function parseEntityJson(text, expectedId) {
    if (text.length > MAX_ENTITY_JSON_CHARS)
        return { ok: false, error: `Too large (limit ${Math.round(MAX_ENTITY_JSON_CHARS / 1024)} KB).` };
    let value;
    try {
        value = JSON.parse(text);
    }
    catch (err) {
        return { ok: false, error: `Invalid JSON: ${err instanceof Error ? err.message.slice(0, 160) : 'parse error'}` };
    }
    const guard = inspectUntrusted(value);
    if (!guard.ok)
        return { ok: false, error: `${guard.path ? `${guard.path}: ` : ''}${guard.message}` };
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return { ok: false, error: 'An entity must be a JSON object.' };
    const r = Entity.safeParse(value);
    if (!r.success) {
        const issue = r.error.issues[0];
        return { ok: false, error: issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'Invalid entity.' };
    }
    if (r.data.id !== expectedId)
        return { ok: false, error: `The id must stay "${expectedId}" — rename it with the ID field instead.` };
    return { ok: true, entity: r.data };
}
/** Minimal patches that replace `entity` (same id) in `world`; empty when nothing changed. */
export function entityReplacePatches(world, entity) {
    if (!Object.prototype.hasOwnProperty.call(world.entities, entity.id))
        return [];
    return patchesBetween(world, { ...world, entities: { ...world.entities, [entity.id]: entity } });
}
/** Default params of a catalog entry (behavior or generator). */
export function defaultParams(params) {
    const out = {};
    for (const key of Object.keys(params)) {
        const spec = params[key];
        if (spec)
            out[key] = spec.default;
    }
    return out;
}
/** Parse a comma/space separated tag list into clean, unique tags. */
export function parseTags(text) {
    const out = [];
    for (const raw of text.split(/[\s,]+/)) {
        const t = raw.replace(/^#/, '').trim().slice(0, 40);
        if (t && !out.includes(t))
            out.push(t);
        if (out.length >= 32)
            break;
    }
    return out;
}
