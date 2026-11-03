/**
 * Conversion of procgen `MeshPart`s (plain typed arrays) into three.js
 * `BufferGeometry`. Typed arrays are shared, not copied (generator outputs are
 * immutable), except for indices which are narrowed to 16 bits when possible.
 *
 * Texture coordinates run in metres on every surface (see metre-uvs.ts):
 * authored UVs are kept where they are already metric and projected per
 * triangle elsewhere, so a finish or a tiling surface detail keeps its
 * real-world scale on any size of mesh. Splitting corners for the
 * projection copies the vertex streams of that part.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import type { MeshPart } from '../types';
import { setPositionBounds } from './position-bounds';
import { RefCache } from '../refcache';
import { metreUvMesh } from './metre-uvs';

/** Thrown for malformed mesh data (never happens with validated procgen output). */
export class InvalidMeshError extends Error {
  override name = 'InvalidMeshError';
}

const MAX_UINT16_VERTICES = 65_536;

function narrowIndices(indices: Uint32Array, vertexCount: number): Uint16Array | Uint32Array {
  if (vertexCount > MAX_UINT16_VERTICES) return indices;
  return Uint16Array.from(indices);
}

/**
 * Box-projected UVs in metres: each vertex is projected onto the plane
 * facing its dominant normal axis (top/bottom → x,z; front/back → x,y;
 * sides → z,y). Seamless on flat surfaces, which is where tiling surface
 * detail is used.
 */
export function boxProjectedUvs(positions: Float32Array, normals: Float32Array): Float32Array {
  const count = positions.length / 3;
  const uvs = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const nx = Math.abs(normals[i * 3] as number);
    const ny = Math.abs(normals[i * 3 + 1] as number);
    const nz = Math.abs(normals[i * 3 + 2] as number);
    const x = positions[i * 3] as number;
    const y = positions[i * 3 + 1] as number;
    const z = positions[i * 3 + 2] as number;
    if (ny >= nx && ny >= nz) {
      uvs[i * 2] = x;
      uvs[i * 2 + 1] = z;
    } else if (nz >= nx) {
      uvs[i * 2] = x;
      uvs[i * 2 + 1] = y;
    } else {
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
export function terrainUvs(positions: Float32Array): Float32Array {
  const n = positions.length / 3;
  const uvs = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    uvs[i * 2] = positions[i * 3] as number;
    uvs[i * 2 + 1] = positions[i * 3 + 2] as number;
  }
  return uvs;
}

/**
 * Build a `BufferGeometry` from one mesh part. Validates array lengths
 * (positions/normals/uvs/colors per vertex, triangle-multiple indices) and
 * computes bounding volumes for frustum culling.
 */
export function partToBufferGeometry(part: MeshPart): BufferGeometry {
  const { positions, normals, indices, colors } = part;
  if (!(positions instanceof Float32Array) || positions.length % 3 !== 0) throw new InvalidMeshError('positions must be a Float32Array of xyz triples');
  const vertexCount = positions.length / 3;
  if (!(indices instanceof Uint32Array) || indices.length % 3 !== 0) throw new InvalidMeshError('indices must be a Uint32Array of triangles');
  const g = new BufferGeometry();
  const hasNormals = normals instanceof Float32Array && normals.length === positions.length;
  const hasColors = colors instanceof Float32Array && colors.length === vertexCount * 3;
  const splat = part.material?.splat === true;
  // Falling water and foliage cards read their authored UVs as they are (u across the sheet, v metres down from the lip; the
  // leaf atlas). Terrain samples top-down metre UVs. Everything else gets metre UVs: authored ones are kept where they are
  // already metric (boards along a floor, courses along a wall), the rest projected per triangle (see metre-uvs.ts).
  const keep = (part.material?.foliage !== undefined || part.material?.waterKind === 'fall') && part.uvs instanceof Float32Array && part.uvs.length === vertexCount * 2;
  const authored = part.material?.finish !== undefined && part.uvs instanceof Float32Array && part.uvs.length === vertexCount * 2;
  if (!keep && !splat && indices.length > 0) {
    let nrm = hasNormals ? normals : null;
    if (!nrm) {
      const tmp = new BufferGeometry();
      tmp.setAttribute('position', new BufferAttribute(positions, 3));
      tmp.setIndex(new BufferAttribute(indices, 1));
      tmp.computeVertexNormals();
      nrm = tmp.getAttribute('normal').array as Float32Array;
    }
    const r = metreUvMesh({ positions, normals: nrm, indices, colors: hasColors ? colors : null, uvs: authored ? (part.uvs as Float32Array) : null });
    const n = r.positions.length / 3;
    g.setAttribute('position', new BufferAttribute(r.positions, 3));
    g.setAttribute('normal', new BufferAttribute(r.normals, 3));
    if (r.colors) g.setAttribute('color', new BufferAttribute(r.colors, 3));
    g.setIndex(new BufferAttribute(narrowIndices(r.indices, n), 1));
    g.setAttribute('uv', new BufferAttribute(r.uvs, 2));
    // Corners were split: anything that pairs the part's own arrays with this geometry (cluster LOD) must use these instead.
    if (r.positions !== positions) g.userData[SPLIT_SOURCE_KEY] = { positions: r.positions, indices: r.indices };
    setPositionBounds(g, r.positions);
    return g;
  }
  g.setAttribute('position', new BufferAttribute(positions, 3));
  if (hasNormals) g.setAttribute('normal', new BufferAttribute(normals, 3));
  if (hasColors) g.setAttribute('color', new BufferAttribute(colors, 3));
  if (splat) {
    // Terrain layer weights; a part that asks for layering without weights is plain grass.
    if (part.splat instanceof Float32Array && part.splat.length === vertexCount * 4) g.setAttribute('splat', new BufferAttribute(part.splat, 4));
    else {
      const w = new Float32Array(vertexCount * 4);
      for (let i = 0; i < vertexCount; i++) w[i * 4] = 1;
      g.setAttribute('splat', new BufferAttribute(w, 4));
    }
  }
  if (indices.length > 0) g.setIndex(new BufferAttribute(narrowIndices(indices, vertexCount), 1));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const uvs = keep ? (part.uvs as Float32Array) : splat ? terrainUvs(positions) : boxProjectedUvs(positions, g.getAttribute('normal').array as Float32Array);
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  setPositionBounds(g, positions);
  return g;
}

/** `userData` key of a geometry whose vertices were split for its UVs: `{ positions, indices }` matching its attributes. */
export const SPLIT_SOURCE_KEY = 'aetherSplitSource';

/** Cache key of the geometry of part `index` of the output identified by `outputKey`. */
export function partKey(outputKey: string, index: number): string {
  return `${outputKey}#${index}`;
}

/** Reference-counted geometry cache keyed by generator output key + part index. */
export class GeometryCache {
  private readonly cache = new RefCache<BufferGeometry>((g) => g.dispose());

  /** Get (and retain) the geometry of a part, converting it on first use. */
  acquire(outputKey: string, index: number, part: MeshPart): { key: string; geometry: BufferGeometry } {
    const key = partKey(outputKey, index);
    return { key, geometry: this.cache.acquire(key, () => partToBufferGeometry(part)) };
  }

  /** Release one reference. */
  release(key: string): void {
    this.cache.release(key);
  }

  /** Current reference count. */
  refs(key: string): number {
    return this.cache.refs(key);
  }

  /** Number of live geometries. */
  get size(): number {
    return this.cache.size;
  }

  /** Dispose every geometry. */
  dispose(): void {
    this.cache.clear();
  }
}
