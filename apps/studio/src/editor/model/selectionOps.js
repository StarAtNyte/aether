/**
 * Editor operations on a selection, as World IR patches (pure, so each is
 * one undoable history commit and fully unit-tested): duplicate, group,
 * ungroup, re-parent (keeping world poses), align, distribute, hide, lock,
 * drop to ground and select-all.
 */
import { getEntity, hasOwn, uniqueId, worldTransform } from '@aether/core';
import { localFromWorld, reparentTransform, worldDeltaToLocal } from './transforms';
/** Selected ids whose ancestor is not also selected (operating on those moves the rest). */
export function topLevel(world, ids) {
    const set = new Set(ids.filter((id) => hasOwn(world.entities, id)));
    return [...set].filter((id) => {
        let p = getEntity(world, id)?.parent ?? null;
        for (let guard = 0; p !== null && guard < 128; guard++) {
            if (set.has(p))
                return false;
            p = getEntity(world, p)?.parent ?? null;
        }
        return true;
    });
}
/** `id` and all of its descendants, parents first. */
export function subtree(world, id) {
    const children = new Map();
    for (const e of Object.values(world.entities)) {
        if (e.parent === null)
            continue;
        const list = children.get(e.parent);
        if (list)
            list.push(e.id);
        else
            children.set(e.parent, [e.id]);
    }
    const out = [id];
    for (let i = 0; i < out.length && out.length < 5000; i++)
        for (const c of children.get(out[i]) ?? [])
            out.push(c);
    return out;
}
/** A mesh id derived from an entity id that is free in `world` (and `taken`). */
export function freeMeshId(world, base, taken = new Set()) {
    const stem = `${base}`.replace(/[^a-z0-9_-]/g, '-').slice(0, 56) || 'mesh';
    for (let n = 1; n < 10_000; n++) {
        const id = n === 1 ? `${stem}-mesh` : `${stem}-mesh-${n}`;
        if (!hasOwn(world.meshes, id) && !taken.has(id))
            return id;
    }
    throw new Error('no free mesh id');
}
/**
 * Clone entity subtrees with fresh ids. References inside the cloned set
 * (parents, joint targets, scatter surfaces) are remapped; mesh assets are
 * copied so editing a copy never edits the original. Top-level clones are
 * offset in world space by `offset`.
 */
export function cloneSubtrees(world, rootIds, opts = {}) {
    const roots = topLevel(world, rootIds);
    const order = [];
    for (const r of roots)
        for (const id of subtree(world, r))
            if (!order.includes(id))
                order.push(id);
    const taken = new Set();
    const map = new Map();
    for (const id of order) {
        const nid = uniqueId(world, id, taken);
        taken.add(nid);
        map.set(id, nid);
    }
    const meshSource = opts.meshes ?? world.meshes;
    const meshTaken = new Set();
    const patches = [];
    const offset = opts.offset ?? [0, 0, 0];
    const rootSet = new Set(roots);
    for (const id of order) {
        const e = getEntity(world, id);
        const nid = map.get(id);
        let shape = e.shape;
        if (shape.kind === 'mesh' && hasOwn(meshSource, shape.mesh)) {
            const meshId = freeMeshId(world, nid, meshTaken);
            meshTaken.add(meshId);
            patches.push({ op: 'setMesh', mesh: { ...meshSource[shape.mesh], id: meshId } });
            shape = { kind: 'mesh', mesh: meshId };
        }
        else if (shape.kind === 'scatter' && shape.onSurface && map.has(shape.onSurface)) {
            shape = { ...shape, onSurface: map.get(shape.onSurface) };
        }
        const parent = e.parent !== null && map.has(e.parent) ? map.get(e.parent) : e.parent;
        let transform = e.transform;
        if (rootSet.has(id) && (offset[0] !== 0 || offset[1] !== 0 || offset[2] !== 0)) {
            const d = worldDeltaToLocal(world, id, offset);
            transform = { ...transform, position: [transform.position[0] + d[0], transform.position[1] + d[1], transform.position[2] + d[2]] };
        }
        const { locked: _unlocked, ...unlocked } = e;
        const clone = { ...unlocked, id: nid, parent, transform, shape };
        if (e.joint && e.joint.target !== 'world' && map.has(e.joint.target))
            clone.joint = { ...e.joint, target: map.get(e.joint.target) };
        if (e.name)
            clone.name = rootSet.has(id) ? copyName(e.name) : e.name;
        patches.push({ op: 'add', entity: clone });
    }
    return { patches, ids: order.map((id) => map.get(id)), roots: roots.map((id) => map.get(id)) };
}
/** "Tree" → "Tree copy", "Tree copy" → "Tree copy 2". */
export function copyName(name) {
    const m = /^(.*) copy(?: (\d+))?$/.exec(name);
    if (!m)
        return `${name} copy`.slice(0, 120);
    return `${m[1]} copy ${Number(m[2] ?? 1) + 1}`.slice(0, 120);
}
/** Duplicate the selection (Ctrl+D): copies offset by one grid step along +X. */
export function duplicatePatches(world, ids, offset = [1, 0, 0]) {
    const r = cloneSubtrees(world, ids, { offset });
    return { patches: r.patches, ids: r.roots };
}
/**
 * Group the selection under a new empty entity at `center` (world). The
 * group goes under the selection's common parent (else the root); members
 * keep their world poses.
 */
export function groupPatches(world, ids, center, name = 'Group') {
    const members = topLevel(world, ids);
    if (members.length === 0)
        return null;
    const parents = new Set(members.map((id) => getEntity(world, id)?.parent ?? null));
    const parent = parents.size === 1 ? [...parents][0] : null;
    const id = uniqueId(world, 'group');
    const groupTransform = localFromWorld(world, parent, { position: center, quaternion: [0, 0, 0, 1], scale: [1, 1, 1] });
    const group = {
        id, name, parent, tags: [], transform: groupTransform, shape: { kind: 'none' }, behaviors: [], state: {},
        visible: true, castShadow: true, receiveShadow: true, template: false,
    };
    // Resolve member transforms against a world where the group exists.
    const withGroup = { ...world, entities: { ...world.entities, [id]: group } };
    const patches = [{ op: 'add', entity: group }];
    for (const m of members)
        patches.push({ op: 'update', id: m, set: { parent: id, transform: reparentTransform(withGroup, m, id) } });
    return { patches, id };
}
/** Ungroup: children move to the group's parent (keeping world poses) and the group is removed. */
export function ungroupPatches(world, groupId) {
    const g = getEntity(world, groupId);
    if (!g)
        return null;
    const children = Object.values(world.entities).filter((e) => e.parent === groupId).map((e) => e.id);
    const patches = children.map((c) => ({ op: 'update', id: c, set: { parent: g.parent, transform: reparentTransform(world, c, g.parent) } }));
    patches.push({ op: 'remove', id: groupId, recursive: false });
    return { patches, children };
}
/** True when `ancestor` is `id` or one of its ancestors. */
export function isAncestorOrSelf(world, ancestor, id) {
    let cur = id;
    for (let guard = 0; cur !== null && guard < 128; guard++) {
        if (cur === ancestor)
            return true;
        cur = getEntity(world, cur)?.parent ?? null;
    }
    return false;
}
/**
 * Re-parent entities under `parent` (null: the root) keeping their world
 * poses. Returns an error message for impossible moves (into itself or a
 * descendant).
 */
export function reparentPatches(world, ids, parent) {
    if (parent !== null && !getEntity(world, parent))
        return { error: `"${parent}" no longer exists.` };
    const members = topLevel(world, ids).filter((id) => getEntity(world, id)?.parent !== parent);
    for (const id of members)
        if (parent !== null && isAncestorOrSelf(world, id, parent))
            return { error: `Cannot move "${id}" into itself or one of its children.` };
    return { patches: members.map((id) => ({ op: 'update', id, set: { parent, transform: reparentTransform(world, id, parent) } })) };
}
function translate(world, id, delta) {
    if (Math.abs(delta[0]) + Math.abs(delta[1]) + Math.abs(delta[2]) < 1e-6)
        return null;
    const e = getEntity(world, id);
    if (!e)
        return null;
    const d = worldDeltaToLocal(world, id, delta);
    const p = e.transform.position;
    const r = (v) => Math.round(v * 10_000) / 10_000;
    return { op: 'update', id, set: { transform: { position: [r(p[0] + d[0]), r(p[1] + d[1]), r(p[2] + d[2])] } } };
}
/** Align the selection's bounds on one axis to the selection's min / centre / max (needs ≥ 2). */
export function alignPatches(world, bounds, axis, mode) {
    const ids = topLevel(world, [...bounds.keys()]);
    if (ids.length < 2)
        return [];
    let lo = Infinity;
    let hi = -Infinity;
    for (const id of ids) {
        const b = bounds.get(id);
        lo = Math.min(lo, b.min[axis]);
        hi = Math.max(hi, b.max[axis]);
    }
    const target = mode === 'min' ? lo : mode === 'max' ? hi : (lo + hi) / 2;
    const out = [];
    for (const id of ids) {
        const b = bounds.get(id);
        const cur = mode === 'min' ? b.min[axis] : mode === 'max' ? b.max[axis] : (b.min[axis] + b.max[axis]) / 2;
        const delta = [0, 0, 0];
        delta[axis] = target - cur;
        const p = translate(world, id, delta);
        if (p)
            out.push(p);
    }
    return out;
}
/** Distribute the selection's centres evenly on one axis between the outermost two (needs ≥ 3). */
export function distributePatches(world, bounds, axis) {
    const ids = topLevel(world, [...bounds.keys()]);
    if (ids.length < 3)
        return [];
    const centre = (id) => {
        const b = bounds.get(id);
        return (b.min[axis] + b.max[axis]) / 2;
    };
    const sorted = [...ids].sort((a, b) => centre(a) - centre(b));
    const first = centre(sorted[0]);
    const last = centre(sorted[sorted.length - 1]);
    const step = (last - first) / (sorted.length - 1);
    const out = [];
    sorted.forEach((id, i) => {
        const delta = [0, 0, 0];
        delta[axis] = first + step * i - centre(id);
        const p = translate(world, id, delta);
        if (p)
            out.push(p);
    });
    return out;
}
/** Drop each selected entity so its bounds rest on y = `floor` (default 0). */
export function dropToGroundPatches(world, bounds, floor = 0) {
    const out = [];
    for (const id of topLevel(world, [...bounds.keys()])) {
        const b = bounds.get(id);
        const p = translate(world, id, [0, floor - b.min[1], 0]);
        if (p)
            out.push(p);
    }
    return out;
}
/** Set `visible` / `locked` on entities (only those that change). */
export function flagPatches(world, ids, flag, value) {
    const out = [];
    for (const id of ids) {
        const e = getEntity(world, id);
        if (!e)
            continue;
        const cur = flag === 'visible' ? e.visible : e.locked === true;
        if (cur === value)
            continue;
        out.push({ op: 'update', id, set: flag === 'locked' ? { locked: value ? true : null } : { visible: value } });
    }
    return out;
}
/** Every selectable entity: visible, unlocked, not a template. */
export function selectableIds(world) {
    return Object.values(world.entities)
        .filter((e) => e.visible && !e.locked && !e.template)
        .map((e) => e.id);
}
/** World position of an entity (origin), or null. */
export function worldPosition(world, id) {
    try {
        return worldTransform(world, id).position;
    }
    catch {
        return null;
    }
}
