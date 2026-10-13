/**
 * Growable mesh builder used by the editing operations: copies vertices with
 * all their attributes, appends interpolated vertices and triangles, and
 * produces compact {@link MeshData}. Enforces the document's mesh limits.
 */
import { LIMITS, type MeshData } from '@aether/core';

/** Thrown when an operation would exceed the mesh limits. */
export class MeshLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeshLimitError';
  }
}

/** Growable typed-array mesh. */
export class MeshBuilder {
  positions: Float32Array;
  colors: Float32Array | null;
  uvs: Float32Array | null;
  indices: Uint32Array;
  faceMaterials: Uint8Array | null;
  vertexCount = 0;
  triangleCount = 0;

  constructor(source: MeshData, extraVertices = 0, extraTriangles = 0) {
    const nv = source.positions.length / 3 + extraVertices;
    const nt = source.indices.length / 3 + extraTriangles;
    this.positions = new Float32Array(Math.max(3, nv) * 3);
    this.colors = source.colors ? new Float32Array(Math.max(3, nv) * 3) : null;
    this.uvs = source.uvs ? new Float32Array(Math.max(3, nv) * 2) : null;
    this.indices = new Uint32Array(Math.max(1, nt) * 3);
    this.faceMaterials = source.faceMaterials ? new Uint8Array(Math.max(1, nt)) : null;
  }

  private growVertices(min: number): void {
    if (min > LIMITS.MAX_MESH_VERTICES) throw new MeshLimitError(`the result would have ${min} vertices (max ${LIMITS.MAX_MESH_VERTICES}); select fewer faces or simplify first`);
    if (min * 3 <= this.positions.length) return;
    const cap = Math.min(LIMITS.MAX_MESH_VERTICES, Math.max(min, Math.ceil((this.positions.length / 3) * 1.5)));
    const p = new Float32Array(cap * 3);
    p.set(this.positions);
    this.positions = p;
    if (this.colors) {
      const c = new Float32Array(cap * 3);
      c.set(this.colors);
      this.colors = c;
    }
    if (this.uvs) {
      const u = new Float32Array(cap * 2);
      u.set(this.uvs);
      this.uvs = u;
    }
  }

  private growTriangles(min: number): void {
    if (min > LIMITS.MAX_MESH_TRIANGLES) throw new MeshLimitError(`the result would have ${min} triangles (max ${LIMITS.MAX_MESH_TRIANGLES}); select fewer faces or simplify first`);
    if (min * 3 <= this.indices.length) return;
    const cap = Math.min(LIMITS.MAX_MESH_TRIANGLES, Math.max(min, Math.ceil((this.indices.length / 3) * 1.5)));
    const i = new Uint32Array(cap * 3);
    i.set(this.indices);
    this.indices = i;
    if (this.faceMaterials) {
      const f = new Uint8Array(cap);
      f.set(this.faceMaterials);
      this.faceMaterials = f;
    }
  }

  /** Append a copy of vertex `v` of `src`; returns the new index. */
  copyVertex(src: MeshData, v: number): number {
    const n = this.vertexCount;
    this.growVertices(n + 1);
    this.positions[n * 3] = src.positions[v * 3] as number;
    this.positions[n * 3 + 1] = src.positions[v * 3 + 1] as number;
    this.positions[n * 3 + 2] = src.positions[v * 3 + 2] as number;
    if (this.colors && src.colors) {
      this.colors[n * 3] = src.colors[v * 3] as number;
      this.colors[n * 3 + 1] = src.colors[v * 3 + 1] as number;
      this.colors[n * 3 + 2] = src.colors[v * 3 + 2] as number;
    }
    if (this.uvs && src.uvs) {
      this.uvs[n * 2] = src.uvs[v * 2] as number;
      this.uvs[n * 2 + 1] = src.uvs[v * 2 + 1] as number;
    }
    this.vertexCount = n + 1;
    return n;
  }

  /** Append the vertex `a + (b − a) · t` of `src` (all attributes interpolated); returns the new index. */
  lerpVertex(src: MeshData, a: number, b: number, t: number): number {
    const n = this.vertexCount;
    this.growVertices(n + 1);
    const p = src.positions;
    for (let k = 0; k < 3; k++) this.positions[n * 3 + k] = (p[a * 3 + k] as number) + ((p[b * 3 + k] as number) - (p[a * 3 + k] as number)) * t;
    if (this.colors && src.colors) {
      const c = src.colors;
      for (let k = 0; k < 3; k++) this.colors[n * 3 + k] = (c[a * 3 + k] as number) + ((c[b * 3 + k] as number) - (c[a * 3 + k] as number)) * t;
    }
    if (this.uvs && src.uvs) {
      const u = src.uvs;
      for (let k = 0; k < 2; k++) this.uvs[n * 2 + k] = (u[a * 2 + k] as number) + ((u[b * 2 + k] as number) - (u[a * 2 + k] as number)) * t;
    }
    this.vertexCount = n + 1;
    return n;
  }

  /** Overwrite the position of vertex `v`. */
  setPosition(v: number, x: number, y: number, z: number): void {
    this.positions[v * 3] = x;
    this.positions[v * 3 + 1] = y;
    this.positions[v * 3 + 2] = z;
  }

  /** Append a triangle with a material slot. */
  triangle(a: number, b: number, c: number, slot = 0): void {
    const t = this.triangleCount;
    this.growTriangles(t + 1);
    this.indices[t * 3] = a;
    this.indices[t * 3 + 1] = b;
    this.indices[t * 3 + 2] = c;
    if (this.faceMaterials) this.faceMaterials[t] = slot;
    this.triangleCount = t + 1;
  }

  /** Compact result. */
  build(): MeshData {
    const nv = this.vertexCount;
    const nt = this.triangleCount;
    return {
      positions: this.positions.slice(0, nv * 3),
      indices: this.indices.slice(0, nt * 3),
      colors: this.colors ? this.colors.slice(0, nv * 3) : null,
      uvs: this.uvs ? this.uvs.slice(0, nv * 2) : null,
      faceMaterials: this.faceMaterials ? this.faceMaterials.slice(0, nt) : null,
    };
  }
}

/** A builder pre-filled with every vertex of `src` (indices preserved), no triangles. */
export function builderWithVertices(src: MeshData, extraVertices: number, triangles: number): MeshBuilder {
  const b = new MeshBuilder(src, extraVertices, Math.max(0, triangles - src.indices.length / 3));
  const n = src.positions.length / 3;
  b.positions.set(src.positions);
  if (b.colors && src.colors) b.colors.set(src.colors);
  if (b.uvs && src.uvs) b.uvs.set(src.uvs);
  b.vertexCount = n;
  return b;
}

/** Material slot of triangle `t` (0 without face materials). */
export function slotOf(src: MeshData, t: number): number {
  return src.faceMaterials ? (src.faceMaterials[t] as number) : 0;
}
