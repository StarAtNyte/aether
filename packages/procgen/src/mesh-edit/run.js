/**
 * Mesh operation requests: a zod-validated, JSON-safe description of an edit
 * that runs the same way on the main thread and inside the compute worker.
 */
import { z } from 'zod';
import { checkMeshData } from '@aether/core';
import { deleteFaces, extrudeFaces, flipFaces, insetFaces, mergeByDistance, orientOutward, smoothMesh, softWeights, subdivide, transformVertices, unwrapUVs } from './ops';
const MAX_SELECTION = 131_072;
const Indices = z.array(z.number().int().min(0).max(131_071)).max(MAX_SELECTION);
const Finite = z.number().refine(Number.isFinite, 'must be finite');
/** A mesh edit request. */
export const MeshOp = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('extrude'), faces: Indices.min(1), distance: Finite.refine((v) => Math.abs(v) <= 1000, 'distance too large') }),
    z.object({ kind: z.literal('inset'), faces: Indices.min(1), amount: z.number().min(0).max(0.95) }),
    z.object({ kind: z.literal('subdivide'), faces: Indices.nullable(), smooth: z.boolean().default(false) }),
    z.object({ kind: z.literal('smooth'), vertices: Indices.nullable(), iterations: z.number().int().min(1).max(50).default(2), factor: z.number().min(0).max(1).default(0.5), radius: z.number().min(0).max(1000).default(0) }),
    z.object({ kind: z.literal('merge'), distance: z.number().min(1e-6).max(10) }),
    z.object({ kind: z.literal('flip'), faces: Indices.nullable() }),
    z.object({ kind: z.literal('orient') }),
    z.object({ kind: z.literal('unwrap'), mode: z.enum(['box', 'planar']), scale: z.number().positive().max(1000).default(1) }),
    z.object({ kind: z.literal('delete'), faces: Indices.min(1) }),
    z.object({ kind: z.literal('transform'), vertices: Indices.min(1), matrix: z.array(Finite).length(16), softRadius: z.number().min(0).max(1000).default(0) }),
]);
/** Run a (validated) mesh operation synchronously. Throws with a readable message on failure. */
export function runMeshOp(input, mesh) {
    const parsed = MeshOp.safeParse(input);
    if (!parsed.success)
        throw new Error(`invalid mesh operation: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    const op = parsed.data;
    const before = checkMeshData(mesh);
    if (before)
        throw new Error(`invalid mesh: ${before}`);
    let result;
    switch (op.kind) {
        case 'extrude':
            result = { mesh: extrudeFaces(mesh, op.faces, op.distance) };
            break;
        case 'inset':
            result = { mesh: insetFaces(mesh, op.faces, op.amount) };
            break;
        case 'subdivide':
            result = { mesh: subdivide(mesh, op.faces, { smooth: op.smooth }) };
            break;
        case 'smooth': {
            const weights = op.vertices ? softWeights(mesh, op.vertices, op.radius) : null;
            result = { mesh: smoothMesh(mesh, { iterations: op.iterations, factor: op.factor, weights }) };
            break;
        }
        case 'merge': {
            const r = mergeByDistance(mesh, op.distance);
            result = { mesh: r.mesh, note: r.removed === 0 ? 'No vertices were close enough to merge.' : `Merged ${r.removed} ${r.removed === 1 ? 'vertex' : 'vertices'}.` };
            break;
        }
        case 'flip':
            result = { mesh: flipFaces(mesh, op.faces) };
            break;
        case 'orient': {
            const r = orientOutward(mesh);
            result = { mesh: r.mesh, note: r.flipped === 0 ? 'Normals were already consistent.' : `Flipped ${r.flipped} ${r.flipped === 1 ? 'face' : 'faces'}.` };
            break;
        }
        case 'unwrap':
            result = { mesh: unwrapUVs(mesh, op.mode, op.scale) };
            break;
        case 'delete':
            result = { mesh: deleteFaces(mesh, op.faces) };
            break;
        case 'transform': {
            const weights = softWeights(mesh, op.vertices, op.softRadius);
            result = { mesh: { ...mesh, positions: transformVertices(mesh.positions, weights, op.matrix) } };
            break;
        }
    }
    const after = checkMeshData(result.mesh);
    if (after)
        throw new Error(`the operation produced an invalid mesh: ${after}`);
    return result;
}
/** Transferable buffers of mesh data (for zero-copy worker messages). */
export function meshTransferables(mesh) {
    const out = new Set();
    for (const a of [mesh.positions, mesh.indices, mesh.colors, mesh.uvs, mesh.faceMaterials])
        if (a && a.buffer instanceof ArrayBuffer)
            out.add(a.buffer);
    return [...out];
}
/** Rebuild typed-array mesh data from a structured-clone message, checking every field. */
export function parseMeshMessage(v) {
    if (typeof v !== 'object' || v === null)
        return null;
    const r = v;
    const positions = r['positions'];
    const indices = r['indices'];
    const colors = r['colors'];
    const uvs = r['uvs'];
    const faceMaterials = r['faceMaterials'];
    if (!(positions instanceof Float32Array) || !(indices instanceof Uint32Array))
        return null;
    if (colors !== null && !(colors instanceof Float32Array))
        return null;
    if (uvs !== null && !(uvs instanceof Float32Array))
        return null;
    if (faceMaterials !== null && !(faceMaterials instanceof Uint8Array))
        return null;
    const mesh = { positions, indices, colors: colors, uvs: uvs, faceMaterials: faceMaterials };
    return checkMeshData(mesh) === null ? mesh : null;
}
