/**
 * Copy / paste of entities across projects. The clipboard payload is plain
 * JSON (written to the system clipboard as text and mirrored in
 * localStorage, which works without clipboard permissions). Pasted data is
 * untrusted: it is size-capped, screened for prototype-pollution keys and
 * validated with zod before it becomes `add` patches with fresh ids.
 */
import { z } from 'zod';
import { Entity, GeneratorDef, hasOwn, inspectUntrusted, MeshAsset, quatToEulerDeg, ScriptDef, worldTransform } from '@aether/core';
import { cloneSubtrees, subtree, topLevel } from './selectionOps';
/** Clipboard format marker. */
export const CLIPBOARD_KIND = 'aether/entities';
/** Largest clipboard text accepted (characters). */
export const MAX_CLIPBOARD_CHARS = 24 * 1024 * 1024;
/** Most entities in one clipboard payload. */
export const MAX_CLIPBOARD_ENTITIES = 1000;
const Payload = z.object({
    kind: z.literal(CLIPBOARD_KIND),
    version: z.literal(1),
    entities: z.array(Entity).min(1).max(MAX_CLIPBOARD_ENTITIES),
    meshes: z.record(z.string(), MeshAsset).default({}),
    generators: z.record(z.string(), GeneratorDef).default({}),
    scripts: z.record(z.string(), ScriptDef).default({}),
});
/**
 * Build the payload for `ids` (with their subtrees). Top-level entities get
 * their WORLD transform and no parent, so they paste where they were; custom
 * generators, scripts and meshes they use travel with them.
 */
export function copyPayload(world, ids) {
    const roots = topLevel(world, ids);
    if (roots.length === 0)
        return null;
    const entities = [];
    const meshes = {};
    const generators = {};
    const scripts = {};
    const rootSet = new Set(roots);
    for (const r of roots) {
        for (const id of subtree(world, r)) {
            if (entities.length >= MAX_CLIPBOARD_ENTITIES)
                break;
            const e = world.entities[id];
            if (!e)
                continue;
            let copy = { ...e };
            if (rootSet.has(id)) {
                const w = worldTransform(world, id);
                const euler = quatToEulerDeg(w.quaternion).map((v) => Math.round(v * 100) / 100);
                copy = { ...copy, parent: null, transform: { position: w.position, rotation: euler, scale: w.scale } };
            }
            entities.push(copy);
            const shape = e.shape.kind === 'scatter' ? e.shape.of : e.shape;
            if (shape.kind === 'procedural' && hasOwn(world.generators, shape.generator))
                generators[shape.generator] = world.generators[shape.generator];
            if (e.shape.kind === 'mesh' && hasOwn(world.meshes, e.shape.mesh))
                meshes[e.shape.mesh] = world.meshes[e.shape.mesh];
            for (const b of e.behaviors) {
                const sid = b.type === 'script' ? b.params['script'] : undefined;
                if (typeof sid === 'string' && hasOwn(world.scripts, sid))
                    scripts[sid] = world.scripts[sid];
            }
        }
    }
    return { kind: CLIPBOARD_KIND, version: 1, entities, meshes, generators, scripts };
}
/** Serialise a payload for the clipboard. */
export function serializePayload(p) {
    return JSON.stringify(p);
}
/** Parse untrusted clipboard text; null when it is not an Aether payload or is invalid. */
export function parsePayload(text) {
    if (typeof text !== 'string' || text.length === 0)
        return null;
    if (text.length > MAX_CLIPBOARD_CHARS)
        return { ok: false, error: 'The clipboard content is too large to paste.' };
    if (!text.includes(CLIPBOARD_KIND))
        return null;
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        return null;
    }
    const guard = inspectUntrusted(value);
    if (!guard.ok)
        return { ok: false, error: `The clipboard content was rejected (${guard.message}).` };
    const r = Payload.safeParse(value);
    if (!r.success)
        return { ok: false, error: `The clipboard content is not valid (${r.error.issues[0]?.message ?? 'invalid'}).` };
    return { ok: true, payload: r.data };
}
/**
 * Patches that paste a payload into `world` with fresh ids. Custom
 * generators / scripts are defined when missing (an existing one with the
 * same id is kept); meshes are copied under new ids. `offset` moves the
 * pasted roots (world space).
 */
export function pastePatches(world, payload, offset = [0, 0, 0]) {
    const patches = [];
    for (const [id, def] of Object.entries(payload.generators))
        if (!hasOwn(world.generators, id) && def.id === id)
            patches.push({ op: 'defineGenerator', generator: def });
    for (const [id, def] of Object.entries(payload.scripts))
        if (!hasOwn(world.scripts, id) && def.id === id)
            patches.push({ op: 'defineScript', script: def });
    // Stage the payload next to the destination entities so the cloning logic (fresh ids
    // unique in the destination, reference remapping, mesh copies) is shared with duplicate.
    const entities = {};
    for (const e of payload.entities)
        if (!hasOwn(entities, e.id))
            entities[e.id] = e;
    const known = (id) => hasOwn(entities, id) || hasOwn(world.entities, id);
    for (const id of Object.keys(entities)) {
        let e = entities[id];
        // A payload may come from another project (or be hand-edited): drop references that cannot resolve.
        if (e.parent !== null && !hasOwn(entities, e.parent))
            e = { ...e, parent: null };
        if (e.joint && e.joint.target !== 'world' && !known(e.joint.target)) {
            const { joint: _dropped, ...rest } = e;
            e = rest;
        }
        if (e.shape.kind === 'scatter' && e.shape.onSurface !== undefined && !known(e.shape.onSurface)) {
            const { onSurface: _dropped, ...shape } = e.shape;
            e = { ...e, shape };
        }
        if (e.shape.kind === 'mesh' && !hasOwn(payload.meshes, e.shape.mesh))
            e = { ...e, shape: { kind: 'none' } };
        entities[id] = e;
    }
    const roots = Object.values(entities).filter((e) => e.parent === null).map((e) => e.id);
    const staged = { ...world, entities: { ...world.entities, ...entities } };
    const clone = cloneSubtrees(staged, roots, { offset, meshes: payload.meshes });
    patches.push(...clone.patches);
    return { patches, ids: clone.roots };
}
