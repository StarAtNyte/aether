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
import type { MeshPart } from '../types';
import { RefCache } from '../refcache';

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
  g.setAttribute('position', new BufferAttribute(positions, 3));
  if (normals instanceof Float32Array && normals.length === positions.length) g.setAttribute('normal', new BufferAttribute(normals, 3));
  if (colors instanceof Float32Array && colors.length === vertexCount * 3) g.setAttribute('color', new BufferAttribute(colors, 3));
  if (indices.length > 0) g.setIndex(new BufferAttribute(narrowIndices(indices, vertexCount), 1));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  // Parts with a physically based finish (architecture) carry authored metre UVs (boards along a
  // floor, courses along a wall); everything else gets box-projected metre UVs.
  const authored = part.material?.finish !== undefined && part.uvs instanceof Float32Array && part.uvs.length === vertexCount * 2;
  const uvs = authored ? (part.uvs as Float32Array) : boxProjectedUvs(positions, g.getAttribute('normal').array as Float32Array);
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

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
