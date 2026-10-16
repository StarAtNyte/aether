/**
 * Static merging of building parts: the unique, static meshes of a
 * parametric building (walls, floors, ceilings, windows, furniture … —
 * entities with `arch` metadata) that share a material are merged into one
 * mesh per material under their storey, so a furnished apartment draws a few
 * dozen meshes instead of several hundred (and the shadow pass likewise).
 *
 * Like {@link StaticBatches} it is a render-only layer over the scene graph:
 * every entity keeps its own meshes, moved to {@link BATCHED_LAYER} (raycast,
 * never drawn), so picking, selection boxes, bounds, physics and overrides
 * work unchanged. The merged copy lives in the storey's object (parent of the
 * members' entities), so exploded and single-storey views move and hide it.
 *
 * Members that change — moved, re-materialised (x-ray), rebuilt (a sectioned
 * wall, a lamp switched off), hidden by a view, removed — are evicted: they
 * draw themselves again and their group is re-merged without them on the next
 * {@link update}. Intact, visible members rejoin on the next {@link rebuild}
 * (content change).
 * Merged geometry is owned here and disposed on regroup / clear; member
 * geometry and materials belong to the shared caches.
 */
import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Mesh } from 'three';
import { BATCHED_LAYER } from './static-batches';
/** Smallest group worth merging (fewer meshes draw as they are). */
export const MIN_MERGE = 3;
/** Largest merged mesh (vertices); bigger groups split into several meshes. */
export const MAX_MERGE_VERTICES = 400_000;
/** Most parts a merged entity may have (bigger compound shapes stay as they are). */
const MAX_PARTS = 32;
/** A node whose meshes may be merged: a static, untouched part of a building. */
export function mergeable(node) {
    if (node.transient || node.placeholder || node.pending || node.failed || node.overridden || node.instances > 0)
        return false;
    if (node.virtual.length > 0 || node.field)
        return false;
    const e = node.entity;
    if (!e.arch || e.template || e.visible === false || e.shape.kind !== 'procedural')
        return false;
    if (e.behaviors.length > 0)
        return false;
    if (e.physics && e.physics.body !== 'static')
        return false;
    if (node.bindings.length === 0 || node.bindings.length > MAX_PARTS || node.geometryKeys.length !== node.bindings.length)
        return false;
    return true;
}
/** A mesh of a mergeable node that can join a merge (opaque, shared single material, indexed). */
function mergeablePart(b) {
    if (b.ownedMaterial || b.seeThrough)
        return false;
    const m = b.mesh.material;
    if (Array.isArray(m) || m.transparent)
        return false;
    const g = b.mesh.geometry;
    return g.index !== null && g.getAttribute('position') !== undefined && g.getAttribute('normal') !== undefined;
}
const _inv = new Matrix4();
const _rel = new Matrix4();
const _nrm = new Matrix3();
/** Merged building geometry under one scene root. */
export class StaticMerges {
    merges = [];
    /** Meshes evicted since the last rebuild (they draw themselves until content changes). */
    evicted = new WeakSet();
    saved = 0;
    /** Draw calls saved per pass by the current merges. */
    get drawCallsSaved() {
        return this.saved;
    }
    /** Number of merged meshes. */
    get count() {
        return this.merges.length;
    }
    /**
     * Regroup the mergeable meshes of `nodes` (call after content changed).
     * Merges whose member list is unchanged are kept (no new geometry).
     * @returns true when merges were created or removed
     */
    rebuild(nodes) {
        const groups = new Map();
        for (const node of nodes) {
            if (!mergeable(node) || !node.content.visible || !node.object.visible)
                continue;
            const parent = node.object.parent;
            if (!parent)
                continue;
            for (const b of node.bindings) {
                if (!mergeablePart(b))
                    continue;
                const mesh = b.mesh;
                if (!mesh.visible)
                    continue;
                // Content changed since the eviction: an intact member may rejoin.
                this.evicted.delete(mesh);
                const g = mesh.geometry;
                const attrs = `${g.getAttribute('uv') ? 'u' : ''}${g.getAttribute('color') ? 'c' : ''}`;
                const key = `${parent.uuid}|${b.materialKey}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}|${attrs}`;
                let list = groups.get(key);
                if (!list) {
                    list = { parent, material: mesh.material, meshes: [] };
                    groups.set(key, list);
                }
                list.meshes.push(mesh);
            }
        }
        const keep = new Set();
        const create = [];
        for (const [key, g] of groups) {
            if (g.meshes.length < MIN_MERGE)
                continue;
            const same = this.merges.find((m) => !keep.has(m) && m.key === key && !m.stale && sameMeshes(m, g.meshes));
            if (same)
                keep.add(same);
            else
                create.push({ key, ...g });
        }
        const removed = this.merges.filter((m) => !keep.has(m));
        const still = new Set();
        for (const c of create)
            for (const m of c.meshes)
                still.add(m);
        for (const m of keep)
            for (const x of m.members)
                still.add(x.mesh);
        for (const m of removed)
            this.release(m, still);
        this.merges = [...keep];
        for (const c of create)
            this.create(c.key, c.parent, c.material, c.meshes);
        this.recount();
        return removed.length > 0 || create.length > 0;
    }
    /**
     * Check members (call each drawn frame, world matrices current): evict the
     * ones that moved, changed or were hidden, and re-merge their groups.
     * Allocation-free unless something changed.
     * @returns true when a merge changed (the frame must be drawn)
     */
    update() {
        let changed = false;
        for (let i = this.merges.length - 1; i >= 0; i--) {
            const merge = this.merges[i];
            _inv.copy(merge.parent.matrixWorld).invert();
            const members = merge.members;
            // Index loop: no iterator object per merge per frame.
            for (let j = 0; j < members.length; j++) {
                const m = members[j];
                if (this.evicted.has(m.mesh))
                    continue;
                if (!memberIntact(m, merge.parent)) {
                    this.evict(m.mesh);
                    merge.stale = true;
                    continue;
                }
                _rel.multiplyMatrices(_inv, m.mesh.matrixWorld);
                const e = _rel.elements;
                for (let k = 0; k < 16; k++) {
                    if (Math.abs(e[k] - m.rel[k]) > 1e-5) {
                        this.evict(m.mesh);
                        merge.stale = true;
                        break;
                    }
                }
            }
            if (merge.stale) {
                changed = true;
                const left = merge.members.filter((m) => !this.evicted.has(m.mesh) && memberIntact(m, merge.parent)).map((m) => m.mesh);
                this.release(merge, new Set(left));
                this.merges.splice(i, 1);
                if (left.length >= MIN_MERGE)
                    this.create(merge.key, merge.parent, merge.material, left);
            }
        }
        if (changed)
            this.recount();
        return changed;
    }
    evict(mesh) {
        this.evicted.add(mesh);
        mesh.layers.set(0);
    }
    create(key, parent, material, meshes) {
        parent.updateMatrixWorld(true);
        _inv.copy(parent.matrixWorld).invert();
        // Split very large groups so one merged buffer stays bounded.
        let start = 0;
        while (start < meshes.length) {
            let verts = 0;
            let end = start;
            while (end < meshes.length) {
                const n = meshes[end].geometry.getAttribute('position').count;
                if (end > start && verts + n > MAX_MERGE_VERTICES)
                    break;
                verts += n;
                end++;
            }
            const slice = meshes.slice(start, end);
            start = end;
            if (slice.length < MIN_MERGE)
                continue;
            const members = slice.map((mesh) => {
                _rel.multiplyMatrices(_inv, mesh.matrixWorld);
                return { mesh, geometry: mesh.geometry, material: mesh.material, rel: Float64Array.from(_rel.elements) };
            });
            const geometry = mergeGeometries(members);
            const mesh = new Mesh(geometry, material);
            mesh.name = 'aether:merged';
            const first = slice[0];
            mesh.castShadow = first.castShadow;
            mesh.receiveShadow = first.receiveShadow;
            mesh.matrixAutoUpdate = false;
            // Picking goes through the members (BATCHED_LAYER); the merged copy is never hit.
            mesh.raycast = () => undefined;
            for (const m of slice)
                m.layers.set(BATCHED_LAYER);
            parent.add(mesh);
            mesh.updateMatrixWorld(true);
            this.merges.push({ key, parent, material, mesh, members, stale: false });
        }
    }
    /** Remove a merge; members not in `still` go back to the default layer. */
    release(m, still) {
        for (const x of m.members)
            if (!still.has(x.mesh) && x.mesh.layers.isEnabled(BATCHED_LAYER))
                x.mesh.layers.set(0);
        m.mesh.removeFromParent();
        m.mesh.geometry.dispose();
    }
    recount() {
        this.saved = this.merges.reduce((n, m) => n + m.members.length - 1, 0);
    }
    /** Remove every merge and give members back to the default layer (also forgets evictions). */
    clear() {
        for (const m of this.merges)
            this.release(m, new Set());
        this.merges = [];
        this.saved = 0;
    }
}
/** The member is still attached under its merge parent, visible, with the merged geometry and material. */
function memberIntact(m, parent) {
    if (m.mesh.geometry !== m.geometry || m.mesh.material !== m.material)
        return false;
    for (let o = m.mesh; o; o = o.parent) {
        if (o === parent)
            return true;
        if (!o.visible)
            return false;
    }
    return false;
}
function sameMeshes(m, meshes) {
    if (m.members.length !== meshes.length)
        return false;
    for (let i = 0; i < meshes.length; i++) {
        const a = m.members[i];
        if (a.mesh !== meshes[i] || a.mesh.geometry !== a.geometry || a.mesh.material !== a.material)
            return false;
    }
    return true;
}
/** Merge member geometries, transformed into the parent's frame (positions, normals, uvs, colours, indices). */
export function mergeGeometries(members) {
    let verts = 0;
    let idx = 0;
    const first = members[0]?.geometry;
    const hasUv = first?.getAttribute('uv') !== undefined;
    const hasColor = first?.getAttribute('color') !== undefined;
    for (const m of members) {
        verts += m.geometry.getAttribute('position').count;
        idx += m.geometry.index?.count ?? 0;
    }
    const pos = new Float32Array(verts * 3);
    const nrm = new Float32Array(verts * 3);
    const uv = hasUv ? new Float32Array(verts * 2) : null;
    const col = hasColor ? new Float32Array(verts * 3) : null;
    const index = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
    let vo = 0;
    let io = 0;
    const mat = new Matrix4();
    for (const m of members) {
        const g = m.geometry;
        mat.fromArray(m.rel);
        _nrm.getNormalMatrix(mat);
        const e = mat.elements;
        const n = _nrm.elements;
        const p = g.getAttribute('position');
        const q = g.getAttribute('normal');
        const count = p.count;
        for (let i = 0; i < count; i++) {
            const x = p.getX(i);
            const y = p.getY(i);
            const z = p.getZ(i);
            const o = (vo + i) * 3;
            pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
            pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
            pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
            const nx = q.getX(i);
            const ny = q.getY(i);
            const nz = q.getZ(i);
            let ox = n[0] * nx + n[3] * ny + n[6] * nz;
            let oy = n[1] * nx + n[4] * ny + n[7] * nz;
            let oz = n[2] * nx + n[5] * ny + n[8] * nz;
            const len = Math.hypot(ox, oy, oz) || 1;
            ox /= len;
            oy /= len;
            oz /= len;
            nrm[o] = ox;
            nrm[o + 1] = oy;
            nrm[o + 2] = oz;
        }
        const u = g.getAttribute('uv');
        if (uv && u)
            for (let i = 0; i < count; i++) {
                uv[(vo + i) * 2] = u.getX(i);
                uv[(vo + i) * 2 + 1] = u.getY(i);
            }
        const c = g.getAttribute('color');
        if (col && c)
            for (let i = 0; i < count; i++) {
                col[(vo + i) * 3] = c.getX(i);
                col[(vo + i) * 3 + 1] = c.getY(i);
                col[(vo + i) * 3 + 2] = c.getZ(i);
            }
        const gi = g.index;
        if (gi)
            for (let i = 0; i < gi.count; i++)
                index[io + i] = gi.getX(i) + vo;
        io += gi?.count ?? 0;
        vo += count;
    }
    const out = new BufferGeometry();
    out.setAttribute('position', new BufferAttribute(pos, 3));
    out.setAttribute('normal', new BufferAttribute(nrm, 3));
    if (uv)
        out.setAttribute('uv', new BufferAttribute(uv, 2));
    if (col)
        out.setAttribute('color', new BufferAttribute(col, 3));
    out.setIndex(new BufferAttribute(index, 1));
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
}
