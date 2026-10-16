/**
 * Message protocol of the DAG worker, validated on both ends. The worker
 * only runs our own trusted geometry code, but replies are still checked
 * structurally (types, lengths, index ranges) before the main thread draws
 * with them, so a corrupted or hostile reply can never index out of bounds.
 */
import { LOD_STRIDE } from './cluster-dag';
/** Largest mesh the worker accepts (vertices, triangle indices). */
export const MAX_DAG_VERTICES = 2_000_000;
export const MAX_DAG_INDICES = 12_000_000;
function isObj(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/** Validate a request inside the worker (null when malformed or too large). */
export function parseDagRequest(v) {
    if (!isObj(v) || v.type !== 'dag' || typeof v.id !== 'number' || !Number.isSafeInteger(v.id))
        return null;
    const { positions, indices } = v;
    if (!(positions instanceof Float32Array) || !(indices instanceof Uint32Array))
        return null;
    if (positions.length % 3 !== 0 || indices.length % 3 !== 0)
        return null;
    if (positions.length / 3 > MAX_DAG_VERTICES || indices.length > MAX_DAG_INDICES)
        return null;
    const n = positions.length / 3;
    for (let i = 0; i < indices.length; i++)
        if (indices[i] >= n)
            return null;
    for (let i = 0; i < positions.length; i++)
        if (!Number.isFinite(positions[i]))
            return null;
    return { type: 'dag', id: v.id, positions, indices };
}
/** Structural validation of a DAG for a mesh with `vertexCount` vertices (O(size)). */
export function validateDag(v, vertexCount) {
    if (!isObj(v))
        return null;
    const d = v;
    if (!(d.indices instanceof Uint32Array) || !(d.offsets instanceof Uint32Array) || !(d.spheres instanceof Float32Array) || !(d.cones instanceof Float32Array))
        return null;
    if (!(d.lod instanceof Float32Array) || !(d.source instanceof Int32Array) || !(d.groupOffsets instanceof Uint32Array) || !(d.groupClusters instanceof Uint32Array) || !(d.roots instanceof Uint32Array))
        return null;
    if (!Number.isSafeInteger(d.count) || d.count < 0 || d.vertexCount !== vertexCount || !Number.isSafeInteger(d.baseTriangles) || !Array.isArray(d.levelTriangles))
        return null;
    const n = d.count;
    if (d.offsets.length !== n + 1 || d.spheres.length !== n * 4 || d.cones.length !== n * 4 || d.lod.length !== n * LOD_STRIDE || d.source.length !== n)
        return null;
    if (d.offsets[0] !== 0 || d.offsets[n] > d.indices.length)
        return null;
    for (let c = 0; c < n; c++) {
        const a = d.offsets[c];
        const b = d.offsets[c + 1];
        if (b < a || (b - a) % 3 !== 0)
            return null;
    }
    for (let i = 0; i < d.indices.length; i++)
        if (d.indices[i] >= vertexCount)
            return null;
    const groups = d.groupOffsets.length - 1;
    if (groups < 0 || d.groupOffsets[0] !== 0 || d.groupOffsets[groups] !== d.groupClusters.length)
        return null;
    for (let g = 0; g < groups; g++)
        if (d.groupOffsets[g + 1] < d.groupOffsets[g])
            return null;
    for (let i = 0; i < d.groupClusters.length; i++)
        if (d.groupClusters[i] >= n)
            return null;
    for (let c = 0; c < n; c++) {
        const s = d.source[c];
        if (s < -1 || s >= groups)
            return null;
    }
    if (d.roots.length > n)
        return null;
    for (let i = 0; i < d.roots.length; i++)
        if (d.roots[i] >= n)
            return null;
    for (let i = 0; i < d.lod.length; i++) {
        const x = d.lod[i];
        if (x !== x || x === -Infinity)
            return null;
    }
    return d;
}
/** Buffers of a DAG to transfer (zero-copy). */
export function dagTransferables(d) {
    return [d.indices, d.offsets, d.spheres, d.cones, d.lod, d.source, d.groupOffsets, d.groupClusters, d.roots].map((a) => a.buffer);
}
