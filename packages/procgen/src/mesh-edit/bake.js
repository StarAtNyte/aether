/**
 * Baking: turn a generator output (procedural, primitive or AI-written) into
 * one editable {@link MeshData} with material slots, and back into colliders.
 */
import { LIMITS, stableStringify } from '@aether/core';
/** Most material slots a mesh asset can hold. */
export const MAX_MATERIAL_SLOTS = 16;
/**
 * Merge every part of a generator output into one indexed mesh. Distinct part
 * materials become slots (extra materials beyond 16 share the last slot).
 * Parts without vertex colours get white (so material colours are unchanged);
 * UVs are kept only when every part has them. Throws when the output exceeds
 * the mesh limits.
 */
export function bakeOutput(output) {
    let nv = 0;
    let ni = 0;
    for (const part of output.parts) {
        nv += part.positions.length / 3;
        ni += part.indices.length;
    }
    if (nv > LIMITS.MAX_MESH_VERTICES)
        throw new Error(`this object is too detailed to edit as a mesh (${nv} vertices, max ${LIMITS.MAX_MESH_VERTICES})`);
    if (ni / 3 > LIMITS.MAX_MESH_TRIANGLES)
        throw new Error(`this object is too detailed to edit as a mesh (${ni / 3} triangles, max ${LIMITS.MAX_MESH_TRIANGLES})`);
    if (nv < 3 || ni < 3)
        throw new Error('this object has no geometry to bake');
    const anyColors = output.parts.some((p) => !!p.colors);
    const allUvs = output.parts.every((p) => !!p.uvs);
    const positions = new Float32Array(nv * 3);
    const indices = new Uint32Array(ni);
    const colors = anyColors ? new Float32Array(nv * 3).fill(1) : null;
    const uvs = allUvs ? new Float32Array(nv * 2) : null;
    const faceMaterials = new Uint8Array(ni / 3);
    const materials = [];
    const slotByKey = new Map();
    let vo = 0;
    let io = 0;
    for (const part of output.parts) {
        const material = { ...part.material };
        // A baked mesh carries no terrain layer weights: it keeps its vertex colours.
        delete material.splat;
        const key = stableStringify(material);
        let slot = slotByKey.get(key);
        if (slot === undefined) {
            if (materials.length < MAX_MATERIAL_SLOTS) {
                slot = materials.length;
                materials.push(material);
            }
            else
                slot = MAX_MATERIAL_SLOTS - 1;
            slotByKey.set(key, slot);
        }
        positions.set(part.positions, vo * 3);
        if (colors && part.colors)
            colors.set(part.colors, vo * 3);
        if (uvs && part.uvs)
            uvs.set(part.uvs, vo * 2);
        for (let i = 0; i < part.indices.length; i++)
            indices[io + i] = part.indices[i] + vo;
        faceMaterials.fill(slot, io / 3, (io + part.indices.length) / 3);
        vo += part.positions.length / 3;
        io += part.indices.length;
    }
    return { data: { positions, indices, colors, uvs, faceMaterials: materials.length > 1 ? faceMaterials : null }, materials };
}
/** Most hull points handed to physics (subsampled evenly). */
export const MAX_HULL_POINTS = 1024;
/**
 * Colliders of an editable mesh: a triangle mesh for static/kinematic bodies
 * (exact, concave) and a convex hull for dynamic bodies (Rapier cannot
 * simulate concave dynamic trimeshes robustly).
 */
export function meshColliders(data, body = 'static') {
    if (body === 'dynamic') {
        const n = data.positions.length / 3;
        const stride = Math.max(1, Math.ceil(n / MAX_HULL_POINTS));
        const count = Math.ceil(n / stride);
        const points = new Float32Array(count * 3);
        for (let i = 0, o = 0; i < n && o < count; i += stride, o++) {
            points[o * 3] = data.positions[i * 3];
            points[o * 3 + 1] = data.positions[i * 3 + 1];
            points[o * 3 + 2] = data.positions[i * 3 + 2];
        }
        if (stride === 1)
            return [{ kind: 'hull', points, offset: [0, 0, 0] }];
        // Keep the extreme vertex along each axis so a subsampled hull keeps the full size.
        const extremes = new Set();
        for (let k = 0; k < 3; k++) {
            let lo = 0;
            let hi = 0;
            for (let i = 0; i < n; i++) {
                const v = data.positions[i * 3 + k];
                if (v < data.positions[lo * 3 + k])
                    lo = i;
                if (v > data.positions[hi * 3 + k])
                    hi = i;
            }
            extremes.add(lo);
            extremes.add(hi);
        }
        const all = new Float32Array(points.length + extremes.size * 3);
        all.set(points);
        let o = points.length;
        for (const i of extremes) {
            all[o++] = data.positions[i * 3];
            all[o++] = data.positions[i * 3 + 1];
            all[o++] = data.positions[i * 3 + 2];
        }
        return [{ kind: 'hull', points: all, offset: [0, 0, 0] }];
    }
    return [{ kind: 'trimesh', positions: data.positions.slice(), indices: data.indices.slice() }];
}
