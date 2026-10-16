/**
 * Conversion of procgen `MeshPart`s (plain typed arrays) into three.js
 * `BufferGeometry`. Typed arrays are shared, not copied (generator outputs are
 * immutable), except for indices which are narrowed to 16 bits when possible.
 *
 * Texture coordinates are box-projected in metres (see
 * {@link boxProjectedUvs}) rather than taken from the part: the only
 * textured materials are tiling surface details (lava, water) that must
 * keep a constant real-world scale on any size of mesh.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import { RefCache } from '../refcache';
/** Thrown for malformed mesh data (never happens with validated procgen output). */
export class InvalidMeshError extends Error {
    name = 'InvalidMeshError';
}
const MAX_UINT16_VERTICES = 65_536;
function narrowIndices(indices, vertexCount) {
    if (vertexCount > MAX_UINT16_VERTICES)
        return indices;
    return Uint16Array.from(indices);
}
/**
 * Box-projected UVs in metres: each vertex is projected onto the plane
 * facing its dominant normal axis (top/bottom → x,z; front/back → x,y;
 * sides → z,y). Seamless on flat surfaces, which is where tiling surface
 * detail is used.
 */
export function boxProjectedUvs(positions, normals) {
    const count = positions.length / 3;
    const uvs = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
        const nx = Math.abs(normals[i * 3]);
        const ny = Math.abs(normals[i * 3 + 1]);
        const nz = Math.abs(normals[i * 3 + 2]);
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        if (ny >= nx && ny >= nz) {
            uvs[i * 2] = x;
            uvs[i * 2 + 1] = z;
        }
        else if (nz >= nx) {
            uvs[i * 2] = x;
            uvs[i * 2 + 1] = y;
        }
        else {
            uvs[i * 2] = z;
            uvs[i * 2 + 1] = y;
        }
    }
    return uvs;
}
/**
 * Metre UVs for layered terrain: plain top-down (x, z). Every layer samples with them, so the tangent
 * frame of the normal maps matches; the rock layer adds side projections in the shader (triplanar)
 * where the ground leans over, and there is no seam where a dominant axis would flip.
 */
export function terrainUvs(positions) {
    const n = positions.length / 3;
    const uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
        uvs[i * 2] = positions[i * 3];
        uvs[i * 2 + 1] = positions[i * 3 + 2];
    }
    return uvs;
}
/**
 * Build a `BufferGeometry` from one mesh part. Validates array lengths
 * (positions/normals/uvs/colors per vertex, triangle-multiple indices) and
 * computes bounding volumes for frustum culling.
 */
export function partToBufferGeometry(part) {
    const { positions, normals, indices, colors } = part;
    if (!(positions instanceof Float32Array) || positions.length % 3 !== 0)
        throw new InvalidMeshError('positions must be a Float32Array of xyz triples');
    const vertexCount = positions.length / 3;
    if (!(indices instanceof Uint32Array) || indices.length % 3 !== 0)
        throw new InvalidMeshError('indices must be a Uint32Array of triangles');
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    if (normals instanceof Float32Array && normals.length === positions.length)
        g.setAttribute('normal', new BufferAttribute(normals, 3));
    if (colors instanceof Float32Array && colors.length === vertexCount * 3)
        g.setAttribute('color', new BufferAttribute(colors, 3));
    if (part.material?.splat === true) {
        // Terrain layer weights; a part that asks for layering without weights is plain grass.
        if (part.splat instanceof Float32Array && part.splat.length === vertexCount * 4)
            g.setAttribute('splat', new BufferAttribute(part.splat, 4));
        else {
            const w = new Float32Array(vertexCount * 4);
            for (let i = 0; i < vertexCount; i++)
                w[i * 4] = 1;
            g.setAttribute('splat', new BufferAttribute(w, 4));
        }
    }
    if (indices.length > 0)
        g.setIndex(new BufferAttribute(narrowIndices(indices, vertexCount), 1));
    if (!g.getAttribute('normal'))
        g.computeVertexNormals();
    // Parts with a physically based finish (architecture) carry authored metre UVs (boards along a
    // floor, courses along a wall); everything else gets box-projected metre UVs.
    const authored = (part.material?.finish !== undefined || part.material?.foliage !== undefined) && part.uvs instanceof Float32Array && part.uvs.length === vertexCount * 2;
    const uvs = authored
        ? part.uvs
        : part.material?.splat === true
            ? terrainUvs(positions)
            : boxProjectedUvs(positions, g.getAttribute('normal').array);
    g.setAttribute('uv', new BufferAttribute(uvs, 2));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
}
/** Cache key of the geometry of part `index` of the output identified by `outputKey`. */
export function partKey(outputKey, index) {
    return `${outputKey}#${index}`;
}
/** Reference-counted geometry cache keyed by generator output key + part index. */
export class GeometryCache {
    cache = new RefCache((g) => g.dispose());
    /** Get (and retain) the geometry of a part, converting it on first use. */
    acquire(outputKey, index, part) {
        const key = partKey(outputKey, index);
        return { key, geometry: this.cache.acquire(key, () => partToBufferGeometry(part)) };
    }
    /** Release one reference. */
    release(key) {
        this.cache.release(key);
    }
    /** Current reference count. */
    refs(key) {
        return this.cache.refs(key);
    }
    /** Number of live geometries. */
    get size() {
        return this.cache.size;
    }
    /** Dispose every geometry. */
    dispose() {
        this.cache.clear();
    }
}
