import { LIMITS } from '../limits';
import { chunksByteLength, decodeChunks, encodeChunks } from './base64';
/** Largest coordinate magnitude accepted in a mesh (meters). */
export const MAX_MESH_COORDINATE = 100_000;
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function swapBytes(bytes, width) {
    for (let i = 0; i + width <= bytes.length; i += width) {
        for (let a = i, b = i + width - 1; a < b; a++, b--) {
            const t = bytes[a];
            bytes[a] = bytes[b];
            bytes[b] = t;
        }
    }
}
function toBytes(view) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    if (LITTLE_ENDIAN || view.BYTES_PER_ELEMENT === 1)
        return bytes;
    const copy = bytes.slice();
    swapBytes(copy, view.BYTES_PER_ELEMENT);
    return copy;
}
function fromBytes(bytes, width) {
    if (!LITTLE_ENDIAN && width > 1)
        swapBytes(bytes, width);
    return bytes;
}
/** sRGB (0..1) → linear. */
export function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
/** Linear (0..1) → sRGB. */
export function linearToSrgb(c) {
    const v = c <= 0 ? 0 : c >= 1 ? 1 : c;
    return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}
/** sRGB byte → linear float lookup (exact inverse of the encoder's quantisation). */
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++)
    SRGB_TO_LINEAR[i] = srgbToLinear(i / 255);
/** Decoded size in bytes of a mesh with these counts and channels. */
export function meshByteSize(vertexCount, triangleCount, channels = {}) {
    let bytes = vertexCount * 12 + triangleCount * 6;
    if (channels.colors)
        bytes += vertexCount * 3;
    if (channels.uvs)
        bytes += vertexCount * 8;
    if (channels.faceMaterials)
        bytes += triangleCount;
    return bytes;
}
/** Decoded size in bytes of an asset (from its declared counts; cheap). */
export function meshAssetBytes(asset) {
    return meshByteSize(asset.vertexCount, asset.triangleCount, { colors: !!asset.colors, uvs: !!asset.uvs, faceMaterials: !!asset.faceMaterials });
}
/** Check mesh data in memory (sizes, finite values, index ranges). Returns an error message or null. */
export function checkMeshData(data, materialSlots = 16) {
    const { positions, indices, colors, uvs, faceMaterials } = data;
    if (positions.length === 0 || positions.length % 3 !== 0)
        return 'positions must hold xyz triples';
    const vc = positions.length / 3;
    if (vc < 3)
        return 'a mesh needs at least 3 vertices';
    if (vc > LIMITS.MAX_MESH_VERTICES)
        return `mesh has ${vc} vertices (max ${LIMITS.MAX_MESH_VERTICES})`;
    if (indices.length === 0 || indices.length % 3 !== 0)
        return 'indices must hold triangles (3 per face)';
    const tc = indices.length / 3;
    if (tc > LIMITS.MAX_MESH_TRIANGLES)
        return `mesh has ${tc} triangles (max ${LIMITS.MAX_MESH_TRIANGLES})`;
    for (let i = 0; i < positions.length; i++) {
        const v = positions[i];
        if (!Number.isFinite(v) || v > MAX_MESH_COORDINATE || v < -MAX_MESH_COORDINATE)
            return 'positions must be finite and within ±100 km';
    }
    for (let i = 0; i < indices.length; i++)
        if (indices[i] >= vc)
            return `index ${indices[i]} out of range (${vc} vertices)`;
    if (colors && colors.length !== vc * 3)
        return 'colors must hold one rgb triple per vertex';
    if (colors)
        for (let i = 0; i < colors.length; i++)
            if (!Number.isFinite(colors[i]))
                return 'colors must be finite';
    if (uvs && uvs.length !== vc * 2)
        return 'uvs must hold one uv pair per vertex';
    if (uvs)
        for (let i = 0; i < uvs.length; i++)
            if (!Number.isFinite(uvs[i]) || Math.abs(uvs[i]) > 1e6)
                return 'uvs must be finite';
    if (faceMaterials) {
        if (faceMaterials.length !== tc)
            return 'faceMaterials must hold one slot per triangle';
        const slots = Math.max(1, materialSlots);
        for (let i = 0; i < faceMaterials.length; i++)
            if (faceMaterials[i] >= slots)
                return `material slot ${faceMaterials[i]} does not exist`;
    }
    return null;
}
/** Encode mesh data as a document asset. Throws when the data is invalid or too large. */
export function encodeMesh(id, data, opts = {}) {
    const materials = (opts.materials ?? []).slice(0, 16);
    const err = checkMeshData(data, materials.length);
    if (err)
        throw new Error(`cannot encode mesh: ${err}`);
    const vc = data.positions.length / 3;
    const tc = data.indices.length / 3;
    const idx16 = new Uint16Array(data.indices.length);
    for (let i = 0; i < idx16.length; i++)
        idx16[i] = data.indices[i];
    const asset = {
        id,
        vertexCount: vc,
        triangleCount: tc,
        positions: encodeChunks(toBytes(data.positions)),
        indices: encodeChunks(toBytes(idx16)),
        materials,
    };
    if (data.colors) {
        const c = new Uint8Array(vc * 3);
        for (let i = 0; i < c.length; i++)
            c[i] = Math.round(linearToSrgb(data.colors[i]) * 255);
        asset.colors = encodeChunks(c);
    }
    if (data.uvs)
        asset.uvs = encodeChunks(toBytes(data.uvs));
    if (data.faceMaterials)
        asset.faceMaterials = encodeChunks(data.faceMaterials);
    if (opts.source)
        asset.source = opts.source;
    return asset;
}
/** Re-encode only the channels that differ, sharing unchanged chunk arrays with `prev` (smaller history). */
export function encodeMeshUpdate(prev, prevData, next) {
    const fresh = encodeMesh(prev.id, next, { materials: prev.materials, ...(prev.source ? { source: prev.source } : {}) });
    const same = (a, b) => {
        if (a === b)
            return true;
        if (!a || !b || a.length !== b.length)
            return false;
        for (let i = 0; i < a.length; i++)
            if (a[i] !== b[i])
                return false;
        return true;
    };
    if (fresh.vertexCount === prev.vertexCount && same(prevData.positions, next.positions))
        fresh.positions = prev.positions;
    if (fresh.triangleCount === prev.triangleCount && same(prevData.indices, next.indices))
        fresh.indices = prev.indices;
    if (prev.colors && fresh.colors && same(prevData.colors, next.colors))
        fresh.colors = prev.colors;
    if (prev.uvs && fresh.uvs && same(prevData.uvs, next.uvs))
        fresh.uvs = prev.uvs;
    if (prev.faceMaterials && fresh.faceMaterials && same(prevData.faceMaterials, next.faceMaterials))
        fresh.faceMaterials = prev.faceMaterials;
    return fresh;
}
/** Decode and validate an asset. Throws an Error with a readable message when it is malformed. */
export function decodeMesh(asset) {
    const vc = asset.vertexCount;
    const tc = asset.triangleCount;
    if (vc > LIMITS.MAX_MESH_VERTICES || tc > LIMITS.MAX_MESH_TRIANGLES)
        throw new Error('mesh exceeds the vertex or triangle limit');
    const positions = new Float32Array(fromBytes(decodeChunks(asset.positions, vc * 12), 4).buffer, 0, vc * 3);
    const idx16 = new Uint16Array(fromBytes(decodeChunks(asset.indices, tc * 6), 2).buffer, 0, tc * 3);
    const indices = new Uint32Array(tc * 3);
    for (let i = 0; i < indices.length; i++)
        indices[i] = idx16[i];
    let colors = null;
    if (asset.colors) {
        const c = decodeChunks(asset.colors, vc * 3);
        colors = new Float32Array(vc * 3);
        for (let i = 0; i < c.length; i++)
            colors[i] = SRGB_TO_LINEAR[c[i]];
    }
    const uvs = asset.uvs ? new Float32Array(fromBytes(decodeChunks(asset.uvs, vc * 8), 4).buffer, 0, vc * 2) : null;
    const faceMaterials = asset.faceMaterials ? decodeChunks(asset.faceMaterials, tc) : null;
    const data = { positions, indices, colors, uvs, faceMaterials };
    const err = checkMeshData(data, asset.materials.length);
    if (err)
        throw new Error(err);
    return data;
}
/** Cheap structural check without decoding the payload (declared sizes vs. chunk lengths). */
export function checkMeshAssetSizes(asset) {
    try {
        const vc = asset.vertexCount;
        const tc = asset.triangleCount;
        if (chunksByteLength(asset.positions) !== vc * 12)
            return 'positions size does not match vertexCount';
        if (chunksByteLength(asset.indices) !== tc * 6)
            return 'indices size does not match triangleCount';
        if (asset.colors && chunksByteLength(asset.colors) !== vc * 3)
            return 'colors size does not match vertexCount';
        if (asset.uvs && chunksByteLength(asset.uvs) !== vc * 8)
            return 'uvs size does not match vertexCount';
        if (asset.faceMaterials && chunksByteLength(asset.faceMaterials) !== tc)
            return 'faceMaterials size does not match triangleCount';
        return null;
    }
    catch (err) {
        return err instanceof Error ? err.message : 'invalid mesh data';
    }
}
const decoded = new WeakMap();
/**
 * Decoded data of an asset, cached per (immutable) asset object. The result
 * is shared: copy it before mutating ({@link cloneMeshData}).
 */
export function decodeMeshCached(asset) {
    const hit = decoded.get(asset);
    if (hit)
        return hit;
    const data = decodeMesh(asset);
    decoded.set(asset, data);
    return data;
}
/** Deep copy of mesh data (all typed arrays copied). */
export function cloneMeshData(d) {
    return {
        positions: d.positions.slice(),
        indices: d.indices.slice(),
        colors: d.colors ? d.colors.slice() : null,
        uvs: d.uvs ? d.uvs.slice() : null,
        faceMaterials: d.faceMaterials ? d.faceMaterials.slice() : null,
    };
}
/** Axis-aligned bounds of mesh positions ([min, max]; zeros for an empty mesh). */
export function meshBounds(positions) {
    if (positions.length < 3)
        return { min: [0, 0, 0], max: [0, 0, 0] };
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            const v = positions[i + k];
            if (v < min[k])
                min[k] = v;
            if (v > max[k])
                max[k] = v;
        }
    }
    return { min, max };
}
