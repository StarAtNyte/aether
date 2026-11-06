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
 *
 * The work on the vertex streams ({@link preparePart}: metre UVs, 16-bit
 * indices, bounds) is pure and runs in the generation workers; a part that
 * arrives with its `prepared` streams only wraps them here.
 */
import { BufferAttribute, BufferGeometry, Box3, Sphere } from 'three';
import type { MeshPart, PreparedPart } from '../types';
import { setPositionBounds } from './position-bounds';
import { RefCache } from '../refcache';
import { metreUvMesh } from './metre-uvs';
import { isKitOfPieces, VIRTUAL_MIN_TRIANGLES } from '../virtual/kit';

/** Thrown for malformed mesh data (never happens with validated procgen output). */
export class InvalidMeshError extends Error {
  override name = 'InvalidMeshError';
}

const MAX_UINT16_VERTICES = 65_536;

/** Version of {@link preparePart}'s output: part of the persistent geometry cache key (bump on any change). */
export const PREPARE_VERSION = 3;

/**
 * Whether a part is a kit of small pieces (see virtual/kit.ts), computed only for parts big enough to be drawn as
 * virtual geometry (undefined below that size: nobody asks).
 */
function kitOf(part: MeshPart): boolean | undefined {
  return part.indices.length / 3 >= VIRTUAL_MIN_TRIANGLES ? isKitOfPieces(part.positions, part.indices) : undefined;
}

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

/** Bounding box and sphere of packed xyz positions, exactly as {@link setPositionBounds} sets them; null when not finite. */
function streamBounds(positions: Float32Array): Float64Array | null {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  if (positions.length === 0 || !Number.isFinite(minX + minY + minZ + maxX + maxY + maxZ)) return null;
  const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5, cz = (minZ + maxZ) * 0.5;
  let radiusSq = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i]! - cx, dy = positions[i + 1]! - cy, dz = positions[i + 2]! - cz;
    radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
  }
  return Float64Array.of(minX, minY, minZ, maxX, maxY, maxZ, cx, cy, cz, Math.sqrt(radiusSq));
}

/**
 * The render-ready streams of one mesh part (pure, no three.js: runs in the generation workers). Null when the part
 * has no usable normals or no triangles' worth of data (the main thread then builds it the old way).
 */
export function preparePart(part: MeshPart): PreparedPart | null {
  const { positions, normals, indices, colors } = part;
  if (!(positions instanceof Float32Array) || positions.length % 3 !== 0) return null;
  if (!(indices instanceof Uint32Array) || indices.length % 3 !== 0) return null;
  const vertexCount = positions.length / 3;
  if (!(normals instanceof Float32Array) || normals.length !== positions.length) return null;
  const hasColors = colors instanceof Float32Array && colors.length === vertexCount * 3;
  const splat = part.material?.splat === true;
  // Falling water and foliage cards read their authored UVs as they are (u across the sheet, v metres down from the lip; the
  // leaf atlas). Terrain samples top-down metre UVs. Everything else gets metre UVs: authored ones are kept where they are
  // already metric (boards along a floor, courses along a wall), the rest projected per triangle (see metre-uvs.ts).
  const keep = (part.material?.foliage !== undefined || part.material?.waterKind === 'fall') && part.uvs instanceof Float32Array && part.uvs.length === vertexCount * 2;
  const authored = part.material?.finish !== undefined && part.uvs instanceof Float32Array && part.uvs.length === vertexCount * 2;
  if (!keep && !splat && indices.length > 0) {
    const r = metreUvMesh({ positions, normals, indices, colors: hasColors ? colors : null, uvs: authored ? (part.uvs as Float32Array) : null });
    const n = r.positions.length / 3;
    const split = r.positions !== positions;
    const narrowed = narrowIndices(r.indices, n);
    return {
      positions: r.positions,
      normals: r.normals,
      indices: narrowed,
      uvs: r.uvs,
      colors: r.colors,
      splat: null,
      // A 32-bit copy of 16-bit indices is not kept: the few readers (cluster LOD of big parts) widen the index on demand.
      splitIndices: split && narrowed === r.indices ? r.indices : null,
      ...(split ? { split: true } : {}),
      bounds: streamBounds(r.positions),
      ...withKit(part),
    };
  }
  let weights: Float32Array | null = null;
  if (splat) {
    // Terrain layer weights; a part that asks for layering without weights is plain grass.
    if (part.splat instanceof Float32Array && part.splat.length === vertexCount * 4) weights = part.splat;
    else {
      weights = new Float32Array(vertexCount * 4);
      for (let i = 0; i < vertexCount; i++) weights[i * 4] = 1;
    }
  }
  return {
    positions,
    normals,
    indices: indices.length > 0 ? narrowIndices(indices, vertexCount) : indices,
    uvs: keep ? (part.uvs as Float32Array) : splat ? terrainUvs(positions) : boxProjectedUvs(positions, normals),
    colors: hasColors ? colors : null,
    splat: weights,
    splitIndices: null,
    bounds: streamBounds(positions),
    ...withKit(part),
  };
}

function withKit(part: MeshPart): { kit?: boolean } {
  const kit = kitOf(part);
  return kit === undefined ? {} : { kit };
}

/** Prepare every part of an output in place (generation workers; parts that cannot be prepared are left alone). */
export function prepareOutputParts(parts: MeshPart[]): void {
  for (const part of parts) {
    if (part.prepared) continue;
    const prepared = preparePart(part);
    if (prepared) part.prepared = prepared;
  }
}

/** Wrap prepared streams in a geometry (main thread: no per-vertex work). */
function preparedGeometry(p: PreparedPart): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(p.positions, 3));
  g.setAttribute('normal', new BufferAttribute(p.normals, 3));
  if (p.colors) g.setAttribute('color', new BufferAttribute(p.colors, 3));
  if (p.splat) g.setAttribute('splat', new BufferAttribute(p.splat, 4));
  if (p.indices.length > 0) g.setIndex(new BufferAttribute(p.indices, 1));
  g.setAttribute('uv', new BufferAttribute(p.uvs, 2));
  // Corners were split: anything that pairs the part's own arrays with this geometry (cluster LOD) must use these instead.
  if (p.splitIndices || p.split) g.userData[SPLIT_SOURCE_KEY] = { positions: p.positions, indices: p.splitIndices };
  const b = p.bounds;
  if (b && b.length === 10) {
    const box = new Box3();
    box.min.set(b[0]!, b[1]!, b[2]!);
    box.max.set(b[3]!, b[4]!, b[5]!);
    g.boundingBox = box;
    const sphere = new Sphere();
    sphere.center.set(b[6]!, b[7]!, b[8]!);
    sphere.radius = b[9]!;
    g.boundingSphere = sphere;
  } else setPositionBounds(g, p.positions);
  return g;
}

/**
 * Build a `BufferGeometry` from one mesh part. Validates array lengths
 * (positions/normals/uvs/colors per vertex, triangle-multiple indices) and
 * computes bounding volumes for frustum culling. Streams prepared in a worker
 * are used as they are.
 */
export function partToBufferGeometry(part: MeshPart): BufferGeometry {
  const { positions, indices } = part;
  if (!(positions instanceof Float32Array) || positions.length % 3 !== 0) throw new InvalidMeshError('positions must be a Float32Array of xyz triples');
  if (!(indices instanceof Uint32Array) || indices.length % 3 !== 0) throw new InvalidMeshError('indices must be a Uint32Array of triangles');
  const prepared = part.prepared ?? preparePart(part);
  if (prepared) return preparedGeometry(prepared);
  // No usable normals: computed here (never the case for validated generator output).
  const vertexCount = positions.length / 3;
  const tmp = new BufferGeometry();
  tmp.setAttribute('position', new BufferAttribute(positions, 3));
  tmp.setIndex(new BufferAttribute(indices, 1));
  tmp.computeVertexNormals();
  const normals = tmp.getAttribute('normal').array as Float32Array;
  const fixed = preparePart({ ...part, normals, prepared: undefined } as MeshPart);
  if (fixed && vertexCount > 0) return preparedGeometry(fixed);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('normal', new BufferAttribute(normals, 3));
  if (indices.length > 0) g.setIndex(new BufferAttribute(narrowIndices(indices, vertexCount), 1));
  g.setAttribute('uv', new BufferAttribute(boxProjectedUvs(positions, normals), 2));
  setPositionBounds(g, positions);
  return g;
}

/**
 * `userData` key of a geometry whose vertices were split for its UVs: `{ positions, indices }` matching its attributes
 * (`indices` null: the geometry's own index, widened to 32 bits by the reader, see {@link splitSourceIndices}).
 */
export const SPLIT_SOURCE_KEY = 'aetherSplitSource';

/** The 32-bit indices matching a split geometry's attributes: the stored ones, else its index widened. */
export function splitSourceIndices(geometry: BufferGeometry, split: { indices: Uint32Array | null }): Uint32Array {
  if (split.indices) return split.indices;
  const a = geometry.index?.array;
  return a instanceof Uint32Array ? a : Uint32Array.from(a ?? []);
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
