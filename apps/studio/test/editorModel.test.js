import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, decodeMesh, encodeMesh, worldTransform } from '@aether/core';
import { primitiveOutput } from '@aether/procgen';
import { alignPatches, copyName, distributePatches, dropToGroundPatches, duplicatePatches, flagPatches, groupPatches, reparentPatches, selectableIds, topLevel, ungroupPatches } from '../src/editor/model/selectionOps';
import { copyPayload, parsePayload, pastePatches, serializePayload } from '../src/editor/model/clipboard';
import { bakePatches, regeneratePatches } from '../src/editor/model/bake';
import { dabCandidates, erasePoints, PointGrid, scatterEntity, spacingFor } from '../src/editor/model/scatterPaint';
import { localFromWorld, reparentTransform, worldDeltaToLocal } from '../src/editor/model/transforms';
import { DEFAULT_BRUSH, DEFAULT_GIZMO, mergeBrush, mergeGizmo } from '../src/state/store';
import { gizmoOptionsOf } from '../src/engine/editor/gizmoOptions';
function build(entities) {
    const r = applyPatches(createWorld(), entities.map((entity) => ({ op: 'add', entity })));
    expect(r.errors).toEqual([]);
    return r.world;
}
const box = (id, position, extra = {}) => ({
    id,
    name: id,
    transform: { position },
    shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] },
    ...extra,
});
function commit(world, patches) {
    const r = applyPatches(world, patches);
    expect(r.errors).toEqual([]);
    return r.world;
}
const near = (a, b, eps = 1e-3) => {
    a.forEach((v, i) => expect(Math.abs(v - (b[i] ?? 0))).toBeLessThan(eps));
};
describe('transforms', () => {
    it('re-parenting keeps the world pose under rotated, scaled parents', () => {
        const w = build([
            { id: 'parent', transform: { position: [5, 1, 0], rotation: [0, 90, 0], scale: [2, 2, 2] } },
            box('child', [3, 0, -1], { transform: { position: [3, 0, -1], rotation: [0, 30, 0] } }),
        ]);
        const before = worldTransform(w, 'child');
        const t = reparentTransform(w, 'child', 'parent');
        const moved = commit(w, [{ op: 'update', id: 'child', set: { parent: 'parent', transform: t } }]);
        const after = worldTransform(moved, 'child');
        near(after.position, before.position);
        near(after.scale, before.scale);
        near(after.quaternion.map(Math.abs), before.quaternion.map(Math.abs));
    });
    it('converts world deltas into the parent space', () => {
        const w = build([{ id: 'p', transform: { rotation: [0, 90, 0], scale: [2, 2, 2] } }, box('c', [0, 0, 0], { parent: 'p' })]);
        near(worldDeltaToLocal(w, 'c', [2, 0, 0]), [0, 0, 1]);
        expect(localFromWorld(w, null, { position: [1, 2, 3], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] }).position).toEqual([1, 2, 3]);
    });
});
describe('selection operations', () => {
    it('duplicates subtrees with fresh ids, remapped references and offset roots', () => {
        const w = build([box('table', [0, 0, 0]), box('cup', [0, 1, 0], { parent: 'table' }), box('door', [3, 0, 0], { joint: { type: 'revolute', target: 'table' } })]);
        const r = duplicatePatches(w, ['table', 'cup', 'door'], [2, 0, 0]);
        const out = commit(w, r.patches);
        expect(r.ids.sort()).toEqual(['door-2', 'table-2']);
        expect(out.entities['cup-2']?.parent).toBe('table-2');
        expect(out.entities['door-2']?.joint?.target).toBe('table-2');
        expect(out.entities['table-2']?.transform.position).toEqual([2, 0, 0]);
        expect(out.entities['cup-2']?.transform.position).toEqual([0, 1, 0]);
        expect(out.entities['table-2']?.name).toBe('table copy');
        expect(copyName('Tree copy')).toBe('Tree copy 2');
    });
    it('duplicating a mesh entity copies its mesh asset', () => {
        const base = build([box('b', [0, 0, 0])]);
        const baked = bakePatches(base, 'b', undefined);
        if ('error' in baked)
            throw new Error(baked.error);
        const w = commit(base, baked.patches);
        const r = duplicatePatches(w, ['b']);
        const out = commit(w, r.patches);
        const meshes = Object.keys(out.meshes);
        expect(meshes.length).toBe(2);
        const copy = out.entities[r.ids[0]];
        expect(copy.shape.kind === 'mesh' && copy.shape.mesh).not.toBe(w.entities['b'].shape.kind === 'mesh' && w.entities['b'].shape.mesh);
    });
    it('groups under the common parent and ungroups back to the same world poses', () => {
        const w = build([box('a', [1, 0, 0], { transform: { position: [1, 0, 0], rotation: [0, 45, 0] } }), box('b', [3, 0, 2])]);
        const g = groupPatches(w, ['a', 'b'], [2, 0, 1]);
        if (!g)
            throw new Error('no group');
        const grouped = commit(w, g.patches);
        expect(grouped.entities['a']?.parent).toBe(g.id);
        near(worldTransform(grouped, 'a').position, [1, 0, 0]);
        near(worldTransform(grouped, 'b').position, [3, 0, 2]);
        const u = ungroupPatches(grouped, g.id);
        if (!u)
            throw new Error('no ungroup');
        const back = commit(grouped, u.patches);
        expect(back.entities[g.id]).toBeUndefined();
        expect(back.entities['a']?.parent).toBeNull();
        near(back.entities['a'].transform.position, [1, 0, 0]);
        near(back.entities['a'].transform.rotation, [0, 45, 0]);
    });
    it('refuses to re-parent into a descendant', () => {
        const w = build([box('a', [0, 0, 0]), box('b', [0, 1, 0], { parent: 'a' })]);
        const r = reparentPatches(w, ['a'], 'b');
        expect('error' in r && r.error).toMatch(/itself or one of its children/);
        const ok = reparentPatches(w, ['b'], null);
        expect('patches' in ok && ok.patches.length).toBe(1);
    });
    it('aligns, distributes and drops to the ground using bounds', () => {
        const w = build([box('a', [0, 2, 0]), box('b', [4, 1, 3]), box('c', [10, 0, 7])]);
        const bounds = new Map([
            ['a', { min: [-0.5, 1.5, -0.5], max: [0.5, 2.5, 0.5] }],
            ['b', { min: [3.5, 0.5, 2.5], max: [4.5, 1.5, 3.5] }],
            ['c', { min: [9.5, -0.5, 6.5], max: [10.5, 0.5, 7.5] }],
        ]);
        const aligned = commit(w, alignPatches(w, bounds, 1, 'min'));
        expect(aligned.entities['a']?.transform.position[1]).toBeCloseTo(0);
        expect(aligned.entities['b']?.transform.position[1]).toBeCloseTo(0);
        const dist = commit(w, distributePatches(w, bounds, 0));
        expect(dist.entities['b']?.transform.position[0]).toBeCloseTo(5);
        const dropped = commit(w, dropToGroundPatches(w, bounds));
        expect(dropped.entities['a']?.transform.position[1]).toBeCloseTo(0.5);
    });
    it('hides, locks and lists selectable entities', () => {
        const w = build([box('a', [0, 0, 0]), box('b', [1, 0, 0]), { id: 'tpl', template: true }]);
        const locked = commit(w, flagPatches(w, ['a'], 'locked', true));
        expect(locked.entities['a']?.locked).toBe(true);
        expect(selectableIds(locked)).toEqual(['b']);
        const unlocked = commit(locked, flagPatches(locked, ['a'], 'locked', false));
        expect(unlocked.entities['a']?.locked).toBeUndefined();
        expect(flagPatches(w, ['a'], 'visible', true)).toEqual([]);
        expect(topLevel(build([box('p', [0, 0, 0]), box('k', [0, 0, 0], { parent: 'p' })]), ['p', 'k'])).toEqual(['p']);
    });
});
describe('clipboard', () => {
    it('copies world poses with dependencies and pastes with fresh ids', () => {
        const w = build([{ id: 'p', transform: { position: [10, 0, 0] } }, box('child', [1, 0, 0], { parent: 'p' })]);
        const payload = copyPayload(w, ['child']);
        if (!payload)
            throw new Error('no payload');
        expect(payload.entities[0]?.parent).toBeNull();
        expect(payload.entities[0]?.transform.position).toEqual([11, 0, 0]);
        const parsed = parsePayload(serializePayload(payload));
        if (!parsed || !parsed.ok)
            throw new Error('parse failed');
        const r = pastePatches(w, parsed.payload, [0, 0, 0]);
        const out = commit(w, r.patches);
        expect(r.ids).toEqual(['child-2']);
        expect(out.entities['child-2']?.transform.position).toEqual([11, 0, 0]);
    });
    it('rejects hostile payloads and ignores foreign text', () => {
        expect(parsePayload('hello')).toBeNull();
        const evil = '{"kind":"aether/entities","version":1,"entities":[{"id":"x","__proto__":{"polluted":true}}]}';
        const r = parsePayload(evil);
        expect(r && !r.ok && r.error).toMatch(/rejected/);
        const bad = parsePayload('{"kind":"aether/entities","version":1,"entities":[{"id":"BAD ID"}]}');
        expect(bad && !bad.ok).toBe(true);
        expect({}['polluted']).toBeUndefined();
    });
    it('pastes into another project, dropping references that cannot resolve', () => {
        const src = build([box('wheel', [0, 0, 0], { joint: { type: 'revolute', target: 'car' } }), box('car', [0, 1, 0])]);
        const payload = copyPayload(src, ['wheel']);
        if (!payload)
            throw new Error('no payload');
        const dest = build([box('other', [5, 0, 0])]);
        const r = pastePatches(dest, payload);
        const out = commit(dest, r.patches);
        expect(out.entities['wheel']?.joint).toBeUndefined();
    });
});
describe('bake', () => {
    it('bakes a primitive into a mesh with a source link and regenerates it', () => {
        const w = build([box('b', [0, 0, 0], { physics: { body: 'static', collider: 'heightfield' } })]);
        const r = bakePatches(w, 'b', primitiveOutput({ kind: 'primitive', primitive: 'box', size: [1, 1, 1] }));
        if ('error' in r)
            throw new Error(r.error);
        const baked = commit(w, r.patches);
        const shape = baked.entities['b'].shape;
        expect(shape.kind).toBe('mesh');
        expect(baked.entities['b'].physics?.collider).toBe('auto');
        const asset = baked.meshes[r.meshId];
        expect(asset.source?.shape.kind).toBe('primitive');
        expect(decodeMesh(asset).indices.length).toBe(36);
        const g = regeneratePatches(baked, 'b');
        if ('error' in g)
            throw new Error(g.error);
        const back = commit(baked, g.patches);
        expect(back.entities['b'].shape.kind).toBe('primitive');
        expect(back.meshes).toEqual({});
    });
    it('refuses non-bakeable shapes', () => {
        const w = build([{ id: 'empty' }]);
        expect('error' in bakePatches(w, 'empty', undefined)).toBe(true);
        const m = commit(createWorld(), [{ op: 'setMesh', mesh: encodeMesh('m', { positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), colors: null, uvs: null, faceMaterials: null }) }, { op: 'add', entity: { id: 'raw', shape: { kind: 'mesh', mesh: 'm' } } }]);
        expect('error' in regeneratePatches(m, 'raw')).toBe(true);
    });
});
describe('scatter paint', () => {
    it('candidates stay in the brush and spacing rejects crowding', () => {
        const c = dabCandidates(10, -5, 2, 5, 3);
        expect(c.length).toBeGreaterThan(0);
        for (const [x, z] of c)
            expect(Math.hypot(x - 10, z + 5)).toBeLessThanOrEqual(2 + 1e-9);
        expect(dabCandidates(0, 0, 2, 5, 3)).toEqual(dabCandidates(0, 0, 2, 5, 3));
        const g = new PointGrid(spacingFor(4));
        g.add(0, 0);
        expect(g.near(0.1, 0.1, spacingFor(4))).toBe(true);
        expect(g.near(5, 5, spacingFor(4))).toBe(false);
    });
    it('erases inside the radius and builds valid scatter entities', () => {
        const r = erasePoints([[0, 0, 0], [5, 0, 5], [1, 2, 0]], 0, 0, 2);
        expect(r.removed).toBe(2);
        const w = commit(createWorld(), [{ op: 'add', entity: { ...scatterEntity('grass-painted', 'grass-tuft', 'Grass'), shape: { ...scatterEntity('grass-painted', 'grass-tuft', 'Grass').shape, points: [[1, 0, 1]], count: 1 } } }]);
        expect(w.entities['grass-painted']?.shape.kind).toBe('scatter');
    });
});
describe('editor settings', () => {
    it('keeps gizmo and brush settings in range', () => {
        expect(mergeGizmo(DEFAULT_GIZMO, { grid: -3, angle: 500, pivot: 'nope' }).grid).toBe(0.01);
        expect(mergeGizmo(DEFAULT_GIZMO, { angle: 500 }).angle).toBe(90);
        expect(mergeBrush(DEFAULT_BRUSH, { size: 1e9, color: 'red', scatterItem: '../x' })).toMatchObject({ size: 100, color: DEFAULT_BRUSH.color, scatterItem: DEFAULT_BRUSH.scatterItem });
    });
    it('inverts snapping while Ctrl is held', () => {
        const on = gizmoOptionsOf({ ...DEFAULT_GIZMO, snap: true }, false);
        expect(on.translationSnap).toBe(DEFAULT_GIZMO.grid);
        expect(gizmoOptionsOf({ ...DEFAULT_GIZMO, snap: true }, true).translationSnap).toBeNull();
        expect(gizmoOptionsOf(DEFAULT_GIZMO, true).rotationSnapDeg).toBe(DEFAULT_GIZMO.angle);
    });
});
