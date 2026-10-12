/**
 * Conversion of procgen `MeshPart`s (plain typed arrays) into three.js
 * `BufferGeometry`. Typed arrays are shared, not copied (generator outputs are
 * immutable), except for indices which are narrowed to 16 bits when possible.
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
 * Build a `BufferGeometry` from one mesh part. Validates array lengths
 * (positions/normals/uvs/colors per vertex, triangle-multiple indices) and
 * computes bounding volumes for frustum culling.
 */
export function partToBufferGeometry(part: MeshPart): BufferGeometry {
  const { positions, normals, indices, uvs, colors } = part;
  if (!(positions instanceof Float32Array) || positions.length % 3 !== 0) throw new InvalidMeshError('positions must be a Float32Array of xyz triples');
  const vertexCount = positions.length / 3;
  if (!(indices instanceof Uint32Array) || indices.length % 3 !== 0) throw new InvalidMeshError('indices must be a Uint32Array of triangles');
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  if (normals instanceof Float32Array && normals.length === positions.length) g.setAttribute('normal', new BufferAttribute(normals, 3));
  if (uvs instanceof Float32Array && uvs.length === vertexCount * 2) g.setAttribute('uv', new BufferAttribute(uvs, 2));
  if (colors instanceof Float32Array && colors.length === vertexCount * 3) g.setAttribute('color', new BufferAttribute(colors, 3));
  if (indices.length > 0) g.setIndex(new BufferAttribute(narrowIndices(indices, vertexCount), 1));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
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
