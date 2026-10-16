/**
 * GPU geometry of an editable mesh asset (`mesh` shapes). One set of vertex
 * attributes (position, normal, colour, uv) is SHARED by one index-only
 * geometry per material slot, so a live edit updates each attribute once and
 * every slot sees it. A hidden full-index geometry recomputes normals.
 *
 * The arrays are private copies of the decoded document data, so in-place
 * previews (sculpting, gizmo drags of components) never touch the cached,
 * immutable document data.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import { boxProjectedUvs } from './buffer-geometry';
function indexAttribute(values, vertexCount) {
    return new BufferAttribute(vertexCount <= 65_536 ? Uint16Array.from(values) : Uint32Array.from(values), 1);
}
/** Build the bundle for `data` with `slotCount` material slots (≥ 1). */
export function buildMeshGeometry(data, slotCount) {
    const vertexCount = data.positions.length / 3;
    const triangleCount = data.indices.length / 3;
    const slots = Math.max(1, Math.min(16, slotCount));
    const position = new BufferAttribute(data.positions.slice(), 3);
    const full = new BufferGeometry();
    full.setAttribute('position', position);
    full.setIndex(indexAttribute(data.indices, vertexCount));
    full.computeVertexNormals();
    const normal = full.getAttribute('normal');
    const hasColors = !!data.colors && data.colors.length === vertexCount * 3;
    const color = new BufferAttribute(hasColors ? data.colors.slice() : new Float32Array(vertexCount * 3).fill(1), 3);
    full.setAttribute('color', color);
    const uvArray = data.uvs && data.uvs.length === vertexCount * 2 ? data.uvs.slice() : boxProjectedUvs(position.array, normal.array);
    const uv = new BufferAttribute(uvArray, 2);
    full.setAttribute('uv', uv);
    full.computeBoundingBox();
    full.computeBoundingSphere();
    // Partition triangles by material slot.
    const perSlot = Array.from({ length: slots }, () => []);
    for (let t = 0; t < triangleCount; t++) {
        const s = data.faceMaterials ? Math.min(slots - 1, data.faceMaterials[t]) : 0;
        perSlot[s].push(t);
    }
    const out = [];
    for (let s = 0; s < slots; s++) {
        const tris = perSlot[s];
        if (tris.length === 0)
            continue;
        let geometry;
        if (slots === 1 || tris.length === triangleCount) {
            geometry = new BufferGeometry();
            geometry.setIndex(full.getIndex());
        }
        else {
            const idx = new Array(tris.length * 3);
            for (let i = 0; i < tris.length; i++) {
                const t = tris[i];
                idx[i * 3] = data.indices[t * 3];
                idx[i * 3 + 1] = data.indices[t * 3 + 1];
                idx[i * 3 + 2] = data.indices[t * 3 + 2];
            }
            geometry = new BufferGeometry();
            geometry.setIndex(indexAttribute(idx, vertexCount));
        }
        geometry.setAttribute('position', position);
        geometry.setAttribute('normal', normal);
        geometry.setAttribute('uv', uv);
        geometry.setAttribute('color', color);
        geometry.boundingBox = full.boundingBox?.clone() ?? null;
        geometry.boundingSphere = full.boundingSphere?.clone() ?? null;
        out.push({ slot: s, geometry, triangles: Uint32Array.from(tris) });
    }
    let disposed = false;
    return {
        full,
        slots: out,
        position,
        normal,
        color,
        hasColors,
        vertexCount,
        triangleCount,
        dispose() {
            if (disposed)
                return;
            disposed = true;
            for (const s of out)
                s.geometry.dispose();
            full.dispose();
        },
    };
}
/**
 * Write preview data into a mounted bundle (positions and/or colours of the
 * same vertex count), recompute normals and bounds, and flag the GPU upload.
 * Returns false when the sizes do not match (the caller should rebuild).
 */
export function previewMeshGeometry(bundle, positions, colors) {
    if (positions) {
        if (positions.length !== bundle.position.array.length)
            return false;
        bundle.position.array.set(positions);
        bundle.position.needsUpdate = true;
        bundle.full.computeVertexNormals();
        bundle.normal.needsUpdate = true;
        bundle.full.computeBoundingBox();
        bundle.full.computeBoundingSphere();
        // Copy into the slots' existing bounds (no allocation per preview frame).
        for (const s of bundle.slots) {
            if (bundle.full.boundingBox && s.geometry.boundingBox)
                s.geometry.boundingBox.copy(bundle.full.boundingBox);
            if (bundle.full.boundingSphere && s.geometry.boundingSphere)
                s.geometry.boundingSphere.copy(bundle.full.boundingSphere);
        }
    }
    if (colors) {
        if (colors.length !== bundle.color.array.length)
            return false;
        bundle.color.array.set(colors);
        bundle.color.needsUpdate = true;
    }
    return true;
}
