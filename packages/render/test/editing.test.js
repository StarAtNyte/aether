import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { encodeMesh } from '@aether/core';
import { buildMeshGeometry, previewMeshGeometry } from '../src/geometry/mesh-asset';
import { scatterPlacements } from '../src/geometry/scatter';
import { MESH_TRIANGLES_KEY } from '../src/sync/scene-sync';
import { SelectionGizmo, readLocal, topLevelTargets } from '../src/view/selection-gizmo';
import { EditOverlay } from '../src/view/edit-overlay';
import { rectsOverlap } from '../src/world-renderer';
import { makeSync, patch, world } from './helpers';
/** Two-slot box: bottom/top faces slot 1, sides slot 0. */
function slab() {
    const positions = new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, -1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]);
    const faceMaterials = new Uint8Array([1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    return { positions, indices, colors: null, uvs: null, faceMaterials };
}
function meshWorld(extra = {}) {
    return patch(world([]), [
        { op: 'setMesh', mesh: encodeMesh('slab-mesh', slab(), { materials: [{ preset: 'stone' }, { preset: 'wood' }] }) },
        { op: 'add', entity: { id: 'slab', shape: { kind: 'mesh', mesh: 'slab-mesh' }, ...extra } },
    ]);
}
describe('mesh geometry bundle', () => {
    it('shares vertex attributes between material slots and maps faces back to document triangles', () => {
        const b = buildMeshGeometry(slab(), 2);
        expect(b.slots.map((s) => s.slot)).toEqual([0, 1]);
        for (const s of b.slots)
            expect(s.geometry.getAttribute('position')).toBe(b.position);
        expect([...b.slots[1].triangles]).toEqual([0, 1, 2, 3]);
        expect(b.hasColors).toBe(false);
        expect(b.color.array[0]).toBe(1);
        b.dispose();
    });
    it('previews positions and colours in place (normals and bounds follow)', () => {
        const b = buildMeshGeometry(slab(), 2);
        const pos = b.position.array.slice();
        for (let i = 1; i < pos.length; i += 3)
            pos[i] = pos[i] * 3;
        const versionBefore = b.position.version;
        expect(previewMeshGeometry(b, pos, null)).toBe(true);
        expect(b.position.version).toBeGreaterThan(versionBefore);
        expect(b.full.boundingBox.max.y).toBeCloseTo(3);
        expect(b.slots[0].geometry.boundingBox.max.y).toBeCloseTo(3);
        expect(previewMeshGeometry(b, new Float32Array(3), null)).toBe(false);
        expect(previewMeshGeometry(b, null, new Float32Array(24).fill(0.5))).toBe(true);
        b.dispose();
    });
});
describe('SceneSync mesh shapes', () => {
    it('mounts one mesh per slot, exposes trimesh colliders and rebuilds when the asset changes', async () => {
        const { sync } = makeSync();
        const w = meshWorld();
        await sync.setWorld(w);
        const node = sync.node('slab');
        expect(node.bindings.length).toBe(2);
        expect(sync.getOutput('slab')?.colliders[0]?.kind).toBe('trimesh');
        const bundle = sync.meshBundle('slab');
        // Edit the asset: the node is rebuilt with the new data.
        const data = slab();
        data.positions[13] = 5;
        const w2 = patch(w, [{ op: 'setMesh', mesh: encodeMesh('slab-mesh', data, { materials: [{ preset: 'stone' }, { preset: 'wood' }] }) }]);
        await sync.setWorld(w2);
        expect(sync.meshBundle('slab')).not.toBe(bundle);
        expect(sync.meshBundle('slab').position.array[13]).toBe(5);
        // Dynamic bodies get a hull instead of a trimesh.
        await sync.setWorld(patch(w2, [{ op: 'update', id: 'slab', set: { physics: { body: 'dynamic' } } }]));
        expect(sync.getOutput('slab')?.colliders[0]?.kind).toBe('hull');
        sync.dispose();
    });
    it('previews without touching the document and switches to vertex colours when painting', async () => {
        const { sync } = makeSync();
        const w = meshWorld();
        await sync.setWorld(w);
        const before = w.meshes['slab-mesh'];
        const colors = new Float32Array(24).fill(0.2);
        expect(sync.previewMesh('slab', null, colors)).toBe(true);
        const mat = sync.node('slab').bindings[0].mesh.material;
        expect(mat.vertexColors).toBe(true);
        expect(w.meshes['slab-mesh']).toBe(before);
        expect(sync.previewMesh('missing', null, colors)).toBe(false);
        sync.dispose();
    });
    it('raycast hits report document triangle indices', async () => {
        const { sync } = makeSync();
        await sync.setWorld(meshWorld());
        sync.root.updateMatrixWorld(true);
        const ray = new Raycaster(new Vector3(0, 5, 0), new Vector3(0, -1, 0));
        const hits = ray.intersectObject(sync.root, true);
        const hit = hits[0];
        const tris = hit.object.userData[MESH_TRIANGLES_KEY];
        // The top face lives in slot 1 as triangles 2 and 3 of the document.
        expect([2, 3]).toContain(tris[hit.faceIndex]);
        sync.dispose();
    });
});
describe('painted scatter placements', () => {
    it('uses the painted points and seeded scale / yaw', () => {
        const p = scatterPlacements({ count: 1, area: [1, 1], seed: 3, scaleRange: [0.5, 2], randomYaw: true, points: [[1, 2, 3], [-4, 0, 5]] });
        expect(p.count).toBe(2);
        expect([p.x[0], p.y[0], p.z[0]]).toEqual([1, 2, 3]);
        expect(p.scale[1]).toBeGreaterThanOrEqual(0.5);
        const q = scatterPlacements({ count: 1, area: [1, 1], seed: 3, scaleRange: [0.5, 2], randomYaw: true, points: [[1, 2, 3], [-4, 0, 5]] });
        expect([...q.yaw]).toEqual([...p.yaw]);
    });
});
function fakeTc() {
    const listeners = new Map();
    const helperObj = new Group();
    return {
        object: undefined,
        dragging: false,
        axis: null,
        enabled: true,
        helperObj,
        setMode() { },
        setSize() { },
        setSpace() { },
        setTranslationSnap() { },
        setRotationSnap() { },
        setScaleSnap() { },
        attach(o) {
            this.object = o;
        },
        detach() {
            this.object = undefined;
        },
        getHelper: () => helperObj,
        addEventListener(type, fn) {
            listeners.set(type, [...(listeners.get(type) ?? []), fn]);
        },
        emit(type, value) {
            for (const fn of listeners.get(type) ?? [])
                fn({ value });
        },
        dispose() { },
    };
}
function controls() {
    return { enabled: true, enableDamping: false, dampingFactor: 0, target: new Vector3(), update: () => true, dispose() { } };
}
describe('SelectionGizmo', () => {
    it('moves several objects with one drag and commits every local transform once', async () => {
        const tc = fakeTc();
        const scene = new Group();
        const a = new Group();
        a.position.set(1, 0, 0);
        const parent = new Group();
        parent.position.set(10, 0, 0);
        parent.scale.set(2, 2, 2);
        const b = new Group();
        b.position.set(0, 1, 0);
        parent.add(b);
        scene.add(a, parent);
        scene.updateMatrixWorld(true);
        const orbit = controls();
        const gizmo = new SelectionGizmo(async () => tc, (o) => scene.add(o), orbit, () => undefined);
        const commits = [];
        const live = [];
        await gizmo.attach([{ id: 'a', object: a }, { id: 'b', object: b }], 'translate', { pivot: 'center' }, (c) => commits.push(c), (ids) => live.push([...ids]));
        const pivot = tc.object;
        tc.dragging = true;
        tc.emit('dragging-changed', true);
        expect(orbit.enabled).toBe(false);
        pivot.position.x += 3;
        tc.emit('objectChange');
        expect(live).toEqual([['a', 'b']]);
        expect(a.position.x).toBeCloseTo(4);
        // b is under a 2× parent: a world move of 3 is a local move of 1.5.
        expect(b.position.x).toBeCloseTo(1.5);
        tc.dragging = false;
        tc.emit('dragging-changed', false);
        tc.emit('mouseUp');
        expect(commits).toHaveLength(1);
        expect(commits[0].changes.map((c) => c.id)).toEqual(['a', 'b']);
        expect(commits[0].changes[1].position).toEqual([1.5, 1, 0]);
        gizmo.dispose();
    });
    it('rotates each object about its own origin with the individual pivot', async () => {
        const tc = fakeTc();
        const scene = new Group();
        const a = new Group();
        a.position.set(5, 0, 0);
        scene.add(a);
        scene.updateMatrixWorld(true);
        const gizmo = new SelectionGizmo(async () => tc, (o) => scene.add(o), null, () => undefined);
        const commits = [];
        await gizmo.attach([{ id: 'a', object: a }], 'rotate', { pivot: 'individual' }, (c) => commits.push(c));
        const pivot = tc.object;
        tc.dragging = true;
        tc.emit('dragging-changed', true);
        pivot.rotation.y = Math.PI / 2;
        tc.emit('objectChange');
        expect(a.position.x).toBeCloseTo(5);
        expect(a.rotation.y).toBeCloseTo(Math.PI / 2);
        tc.emit('mouseUp');
        expect(commits[0].changes[0].rotation[1]).toBeCloseTo(90);
        gizmo.dispose();
    });
    it('snaps the selection onto a surface under the pointer', async () => {
        const tc = fakeTc();
        const scene = new Group();
        const crate = new Mesh();
        scene.add(crate);
        scene.updateMatrixWorld(true);
        const gizmo = new SelectionGizmo(async () => tc, (o) => scene.add(o), null, () => undefined, () => ({ point: new Vector3(7, 2, -1), vertex: null }));
        await gizmo.attach([{ id: 'crate', object: crate }], 'translate', { surfaceSnap: true }, () => undefined);
        tc.dragging = true;
        tc.emit('dragging-changed', true);
        tc.emit('objectChange');
        expect(crate.position.toArray()).toEqual([7, 2, -1]);
        gizmo.dispose();
    });
    it('drops children of selected parents and reads rounded local transforms', () => {
        const p = new Group();
        const c = new Group();
        p.add(c);
        expect(topLevelTargets([{ id: 'p', object: p }, { id: 'c', object: c }]).map((t) => t.id)).toEqual(['p']);
        c.position.set(1.23456, 0, 0);
        expect(readLocal('c', c).position).toEqual([1.235, 0, 0]);
    });
});
describe('edit overlay and marquee', () => {
    it('draws mesh components under the target and tears them down', () => {
        const overlay = new EditOverlay();
        const target = new Group();
        const bundle = buildMeshGeometry(slab(), 1);
        overlay.setComponents({ target, bundle, mode: 'vertex', edges: new Uint32Array([0, 1, 1, 2]), selectedVertices: [0], selectedEdges: [], selectedFaces: [2] });
        expect(target.children.some((o) => o.name === 'edit:components')).toBe(true);
        expect(overlay.editing).toBe(true);
        overlay.setComponents(null);
        expect(target.children.some((o) => o.name === 'edit:components')).toBe(false);
        overlay.setBrush({ point: [0, 0, 0], normal: [0, 1, 0], radius: 2 });
        overlay.setJoint({ anchor: [0, 1, 0], axis: [0, 1, 0], target: [0, 0, 0], type: 'revolute' });
        overlay.dispose();
        bundle.dispose();
    });
    it('rectangle overlap', () => {
        expect(rectsOverlap(0, 0, 1, 1, 0.5, 0.5, 2, 2)).toBe(true);
        expect(rectsOverlap(0, 0, 1, 1, 1.5, 1.5, 2, 2)).toBe(false);
    });
});
