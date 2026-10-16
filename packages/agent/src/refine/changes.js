/**
 * Property-level changes between two worlds: the ground truth of "what did
 * this edit touch?". Used by the compact diff in the chat ("Sofa · material
 * colour: #9a958d → #1f5d3a"), by the over-edit guard and by the eval.
 *
 * Paths are dotted ("transform.position", "shape.params.color",
 * "behaviors.0.params.speed"). Short numeric tuples (vectors, colours as
 * RGB) are compared and reported as one leaf.
 */
import { deepEqual, hasOwn } from '@aether/core';
/** Upper bound of changes reported by {@link worldChanges}. */
export const MAX_CHANGES = 2_000;
const MAX_DEPTH = 8;
function isTuple(v) {
    return Array.isArray(v) && v.length <= 4 && v.every((x) => typeof x === 'number');
}
/** A list of plain strings/numbers (dialogue lines, tags) is one value, not many. */
function isPlainList(v) {
    return Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean');
}
function isObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function walk(scope, id, path, a, b, out, depth) {
    if (out.length >= MAX_CHANGES || a === b)
        return;
    if (a === undefined) {
        // A new object is reported leaf by leaf ("material.color"), except a whole new entity or rule.
        if (isObject(b) && path !== '' && depth < MAX_DEPTH && Object.keys(b).length > 0) {
            for (const k of Object.keys(b))
                walk(scope, id, `${path}.${k}`, undefined, b[k], out, depth + 1);
            return;
        }
        out.push({ scope, id, path, kind: 'add', to: b });
        return;
    }
    if (b === undefined) {
        if (isObject(a) && path !== '' && depth < MAX_DEPTH && Object.keys(a).length > 0) {
            for (const k of Object.keys(a))
                walk(scope, id, `${path}.${k}`, a[k], undefined, out, depth + 1);
            return;
        }
        out.push({ scope, id, path, kind: 'remove', from: a });
        return;
    }
    if (isObject(a) && isObject(b) && depth < MAX_DEPTH) {
        for (const k of Object.keys(a))
            walk(scope, id, path ? `${path}.${k}` : k, a[k], hasOwn(b, k) ? b[k] : undefined, out, depth + 1);
        for (const k of Object.keys(b))
            if (!hasOwn(a, k))
                walk(scope, id, path ? `${path}.${k}` : k, undefined, b[k], out, depth + 1);
        return;
    }
    if (Array.isArray(a) && Array.isArray(b) && !(isTuple(a) && isTuple(b)) && !(isPlainList(a) && isPlainList(b)) && depth < MAX_DEPTH && a.length <= 64 && b.length <= 64) {
        const n = Math.max(a.length, b.length);
        for (let i = 0; i < n; i++)
            walk(scope, id, path ? `${path}.${i}` : String(i), a[i], b[i], out, depth + 1);
        return;
    }
    if (!deepEqual(a, b))
        out.push({ scope, id, path, kind: 'set', from: a, to: b });
}
function keyed(scope, a, b, out) {
    if (a === b)
        return;
    for (const id of Object.keys(a)) {
        if (!hasOwn(b, id))
            out.push({ scope, id, path: '', kind: 'remove', from: a[id] });
        else if (a[id] !== b[id])
            walk(scope, id, '', a[id], b[id], out, 0);
    }
    for (const id of Object.keys(b))
        if (!hasOwn(a, id))
            out.push({ scope, id, path: '', kind: 'add', to: b[id] });
}
/** Every changed leaf from `a` to `b` (capped at {@link MAX_CHANGES}). */
export function worldChanges(a, b) {
    const out = [];
    if (a === b)
        return out;
    keyed('entity', a.entities, b.entities, out);
    walk('environment', '', '', a.environment, b.environment, out, 0);
    walk('player', '', '', a.player, b.player, out, 0);
    const ra = Object.fromEntries(a.rules.map((r) => [r.id, r]));
    const rb = Object.fromEntries(b.rules.map((r) => [r.id, r]));
    keyed('rule', ra, rb, out);
    walk('state', '', '', a.state, b.state, out, 0);
    if (!deepEqual(a.hud, b.hud))
        out.push({ scope: 'hud', id: '', path: '', kind: 'set', from: a.hud, to: b.hud });
    keyed('test', Object.fromEntries(a.tests.map((t) => [t.id, t])), Object.fromEntries(b.tests.map((t) => [t.id, t])), out);
    keyed('generator', a.generators, b.generators, out);
    keyed('script', a.scripts, b.scripts, out);
    keyed('mesh', a.meshes, b.meshes, out);
    if (a.name !== b.name)
        out.push({ scope: 'meta', id: '', path: 'name', kind: 'set', from: a.name, to: b.name });
    if (a.description !== b.description)
        out.push({ scope: 'meta', id: '', path: 'description', kind: 'set', from: a.description, to: b.description });
    if (!deepEqual(a.intro, b.intro))
        walk('meta', '', 'intro', a.intro, b.intro, out, 1);
    if (!deepEqual(a.voxel, b.voxel))
        walk('voxel', '', '', a.voxel, b.voxel, out, 0);
    return out;
}
/** Ids of entities with at least one change (added, removed or modified). */
export function changedEntityIds(changes) {
    const ids = new Set();
    for (const c of changes)
        if (c.scope === 'entity')
            ids.add(c.id);
    return [...ids];
}
