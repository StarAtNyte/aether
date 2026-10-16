import { deepEqual, hasOwn } from '../json';
import { deepMerge, diffForMerge, ENTITY_MERGE, ENVIRONMENT_MERGE, PLAYER_MERGE, RULE_MERGE, VOXEL_MERGE } from '../merge';
import { scatterCount } from '../validate';
import { applyPatches } from './apply';
function entityPatches(from, to, out) {
    const fe = from.entities;
    const te = to.entities;
    const removed = new Set();
    const added = [];
    const changed = [];
    for (const id of Object.keys(fe)) {
        if (!hasOwn(te, id))
            removed.add(id);
        else if (fe[id] !== te[id] && !deepEqual(fe[id], te[id]))
            changed.push(id);
    }
    for (const id of Object.keys(te))
        if (!hasOwn(fe, id))
            added.push(id);
    const addedSet = new Set(added);
    // A. detach
    const base = new Map();
    for (const id of changed) {
        const a = fe[id];
        const b = te[id];
        const set = {};
        if (a.parent !== null && a.parent !== b.parent)
            set['parent'] = null;
        if (a.joint && !deepEqual(a.joint, b.joint))
            set['joint'] = null;
        if (a.shape.kind === 'scatter' && a.shape.onSurface !== undefined && (b.shape.kind !== 'scatter' || b.shape.onSurface !== a.shape.onSurface)) {
            set['shape'] = { onSurface: null };
        }
        if (Object.keys(set).length > 0) {
            out.push({ op: 'update', id, set });
            base.set(id, deepMerge(a, set, ENTITY_MERGE));
        }
        else {
            base.set(id, a);
        }
    }
    // B. remove deleted subtrees
    for (const id of removed) {
        const parent = fe[id].parent;
        if (parent === null || !removed.has(parent))
            out.push({ op: 'remove', id, recursive: true });
    }
    // C. add, parent-first, deferring references between new entities
    const restore = [];
    const emitted = new Set();
    const emit = (id) => {
        if (emitted.has(id))
            return;
        emitted.add(id);
        const e = te[id];
        if (e.parent !== null && addedSet.has(e.parent))
            emit(e.parent);
        let stripped = e;
        if (e.joint && e.joint.target !== 'world' && addedSet.has(e.joint.target)) {
            const { joint: _deferred, ...rest } = stripped;
            stripped = rest;
        }
        if (e.shape.kind === 'scatter' && e.shape.onSurface !== undefined && addedSet.has(e.shape.onSurface)) {
            const { onSurface: _deferred, ...shape } = e.shape;
            stripped = { ...stripped, shape };
        }
        out.push({ op: 'add', entity: stripped });
        if (stripped !== e)
            restore.push({ id, from: stripped, to: e });
    };
    for (const id of added)
        emit(id);
    // D. updates (shrinking scatter first)
    const updates = changed.map((id) => ({ id, from: base.get(id), to: te[id] }));
    updates.push(...restore);
    const delta = (u) => scatterCount(u.to) - scatterCount(u.from);
    const ordered = updates.map((u, i) => ({ u, i, d: delta(u) })).sort((x, y) => (x.d <= 0) === (y.d <= 0) ? x.i - y.i : x.d <= 0 ? -1 : 1);
    for (const { u } of ordered) {
        const set = diffForMerge(u.from, u.to, ENTITY_MERGE);
        if (set)
            out.push({ op: 'update', id: u.id, set });
    }
    return removed;
}
function mapPatches(from, to, remove, define, out) {
    for (const id of Object.keys(from))
        if (!hasOwn(to, id))
            out.push(remove(id));
    for (const id of Object.keys(to)) {
        const def = to[id];
        if (!hasOwn(from, id) || !deepEqual(from[id], def))
            out.push(define(def));
    }
}
function rulePatches(a, b, out) {
    if (a === b || deepEqual(a, b))
        return;
    const bIds = new Set(b.map((r) => r.id));
    for (const r of a)
        if (!bIds.has(r.id))
            out.push({ op: 'removeRule', id: r.id });
    const kept = a.filter((r) => bIds.has(r.id));
    let k = 0;
    while (k < kept.length && k < b.length && kept[k].id === b[k].id)
        k++;
    for (let i = 0; i < k; i++) {
        const set = diffForMerge(kept[i], b[i], RULE_MERGE);
        if (set)
            out.push({ op: 'updateRule', id: b[i].id, set });
    }
    const keptIds = new Set(kept.map((r) => r.id));
    for (let i = k; i < b.length; i++) {
        const r = b[i];
        if (keptIds.has(r.id))
            out.push({ op: 'removeRule', id: r.id });
        out.push({ op: 'addRule', rule: r });
    }
}
function testPatches(a, b, out) {
    if (a === b || deepEqual(a, b))
        return;
    const bIds = new Set(b.map((t) => t.id));
    for (const t of a)
        if (!bIds.has(t.id))
            out.push({ op: 'removeTest', id: t.id });
    const kept = a.filter((t) => bIds.has(t.id));
    let k = 0;
    while (k < kept.length && k < b.length && deepEqual(kept[k], b[k]))
        k++;
    const keptIds = new Set(kept.map((t) => t.id));
    for (let i = k; i < b.length; i++) {
        const t = b[i];
        if (keptIds.has(t.id))
            out.push({ op: 'removeTest', id: t.id });
        out.push({ op: 'addTest', test: t });
    }
}
/**
 * Patches that transform `from` into `to` (both must be valid worlds).
 * `applyPatches(from, patchesBetween(from, to)).world` deep-equals `to`
 * (see the module note for the single JSON-null limitation).
 */
export function patchesBetween(from, to) {
    if (from === to)
        return [];
    const out = [];
    // Meshes first: added/updated entities may reference new mesh assets.
    if (from.meshes !== to.meshes) {
        for (const id of Object.keys(to.meshes)) {
            const m = to.meshes[id];
            if (!hasOwn(from.meshes, id) || (from.meshes[id] !== m && !deepEqual(from.meshes[id], m)))
                out.push({ op: 'setMesh', mesh: m });
        }
    }
    const removed = entityPatches(from, to, out);
    mapPatches(from.generators, to.generators, (id) => ({ op: 'removeGenerator', id }), (generator) => ({ op: 'defineGenerator', generator }), out);
    mapPatches(from.scripts, to.scripts, (id) => ({ op: 'removeScript', id }), (script) => ({ op: 'defineScript', script }), out);
    rulePatches(from.rules, to.rules, out);
    testPatches(from.tests, to.tests, out);
    const env = diffForMerge(from.environment, to.environment, ENVIRONMENT_MERGE);
    if (env)
        out.push({ op: 'setEnvironment', set: env });
    if (from.voxel !== to.voxel && !deepEqual(from.voxel, to.voxel)) {
        if (to.voxel === undefined)
            out.push({ op: 'setVoxel', set: null });
        else if (from.voxel === undefined)
            out.push({ op: 'setVoxel', set: to.voxel });
        else {
            const set = diffForMerge(from.voxel, to.voxel, VOXEL_MERGE);
            if (set)
                out.push({ op: 'setVoxel', set });
        }
    }
    let playerBase = from.player;
    if (playerBase.controls !== undefined && removed.has(playerBase.controls)) {
        const { controls: _cleared, ...rest } = playerBase;
        playerBase = rest;
    }
    const player = diffForMerge(playerBase, to.player, PLAYER_MERGE);
    if (player)
        out.push({ op: 'setPlayer', set: player });
    if (from.state !== to.state) {
        for (const key of Object.keys(to.state)) {
            const v = to.state[key];
            if (!hasOwn(from.state, key) || !deepEqual(from.state[key], v))
                out.push({ op: 'setState', key, value: v });
        }
        for (const key of Object.keys(from.state))
            if (!hasOwn(to.state, key))
                out.push({ op: 'setState', key, value: null });
    }
    if (from.hud !== to.hud && !deepEqual(from.hud, to.hud))
        out.push({ op: 'setHud', hud: to.hud });
    const meta = { op: 'setMeta' };
    if (from.name !== to.name)
        meta.name = to.name;
    if (from.description !== to.description)
        meta.description = to.description;
    if (from.seed !== to.seed)
        meta.seed = to.seed;
    if (from.intro !== to.intro && !deepEqual(from.intro, to.intro))
        meta.intro = to.intro ?? null;
    if (meta.name !== undefined || meta.description !== undefined || meta.seed !== undefined || meta.intro !== undefined)
        out.push(meta);
    // Removing an entity drops its unused mesh automatically; remove the rest explicitly.
    if (from.meshes !== to.meshes) {
        const after = applyPatches(from, out).world;
        for (const id of Object.keys(from.meshes))
            if (!hasOwn(to.meshes, id) && hasOwn(after.meshes, id))
                out.push({ op: 'removeMesh', id });
    }
    return out;
}
/**
 * Undo patches for `patches` applied to `before`: applying the result to
 * `applyPatches(before, patches).world` yields a world deep-equal to `before`.
 * Patches that failed to apply are naturally ignored.
 */
export function invertPatches(before, patches) {
    const after = applyPatches(before, patches).world;
    return patchesBetween(after, before);
}
