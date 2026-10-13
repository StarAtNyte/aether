/**
 * GPU geometry of an editable mesh asset (`mesh` shapes). One set of vertex
 * attributes (position, normal, colour, uv) is SHARED by one index-only
 * geometry per material slot, so a live edit updates each attribute once and
 * every slot sees it. A hidden full-index geometry recomputes normals.
 *
 * The arrays are private copies of the decoded document data, so in-place
 * previews (sculpting, gizmo drags of components) never touch the cached,
 * immutable document data.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import type { MeshData } from '@aether/core';
import { boxProjectedUvs } from './buffer-geometry';

/** One material slot of a mesh: its geometry and the global triangle index of each of its triangles. */
export interface MeshSlotGeometry {
  slot: number;
  geometry: BufferGeometry;
  /** Global triangle index per local triangle (raycast face index → document triangle). */
  triangles: Uint32Array;
}

/** Geometry bundle of one mounted mesh asset. */
export interface MeshGeometryBundle {
  /** Full-index geometry sharing the attributes (normals, raycasts over the whole mesh). */
  readonly full: BufferGeometry;
  readonly slots: MeshSlotGeometry[];
  readonly position: BufferAttribute;
  readonly normal: BufferAttribute;
  /** Always present (white when the document has no colours) so painting can start without a rebuild. */
  readonly color: BufferAttribute;
  /** The document data had vertex colours. */
  readonly hasColors: boolean;
  readonly vertexCount: number;
  readonly triangleCount: number;
  dispose(): void;
}

function indexAttribute(values: ArrayLike<number>, vertexCount: number): BufferAttribute {
  return new BufferAttribute(vertexCount <= 65_536 ? Uint16Array.from(values) : Uint32Array.from(values), 1);
}

/** Build the bundle for `data` with `slotCount` material slots (≥ 1). */
export function buildMeshGeometry(data: MeshData, slotCount: number): MeshGeometryBundle {
  const vertexCount = data.positions.length / 3;
  const triangleCount = data.indices.length / 3;
  const slots = Math.max(1, Math.min(16, slotCount));
  const position = new BufferAttribute(data.positions.slice(), 3);
  const full = new BufferGeometry();
  full.setAttribute('position', position);
  full.setIndex(indexAttribute(data.indices, vertexCount));
  full.computeVertexNormals();
  const normal = full.getAttribute('normal') as BufferAttribute;
  const hasColors = !!data.colors && data.colors.length === vertexCount * 3;
  const color = new BufferAttribute(hasColors ? (data.colors as Float32Array).slice() : new Float32Array(vertexCount * 3).fill(1), 3);
  full.setAttribute('color', color);
  const uvArray = data.uvs && data.uvs.length === vertexCount * 2 ? data.uvs.slice() : boxProjectedUvs(position.array as Float32Array, normal.array as Float32Array);
  const uv = new BufferAttribute(uvArray, 2);
  full.setAttribute('uv', uv);
  full.computeBoundingBox();
  full.computeBoundingSphere();

  // Partition triangles by material slot.
  const perSlot: number[][] = Array.from({ length: slots }, () => []);
  for (let t = 0; t < triangleCount; t++) {
    const s = data.faceMaterials ? Math.min(slots - 1, data.faceMaterials[t] as number) : 0;
    (perSlot[s] as number[]).push(t);
  }
  const out: MeshSlotGeometry[] = [];
  for (let s = 0; s < slots; s++) {
    const tris = perSlot[s] as number[];
    if (tris.length === 0) continue;
    let geometry: BufferGeometry;
    if (slots === 1 || tris.length === triangleCount) {
      geometry = new BufferGeometry();
      geometry.setIndex(full.getIndex());
    } else {
      const idx = new Array<number>(tris.length * 3);
      for (let i = 0; i < tris.length; i++) {
        const t = tris[i] as number;
        idx[i * 3] = data.indices[t * 3] as number;
        idx[i * 3 + 1] = data.indices[t * 3 + 1] as number;
        idx[i * 3 + 2] = data.indices[t * 3 + 2] as number;
      }
      geometry = new BufferGeometry();
      geometry.setIndex(indexAttribute(idx, vertexCount));
    }
    geometry.setAttribute('position', position);
    geometry.setAttribute('normal', normal);
    geometry.setAttribute('uv', uv);
    geometry.setAttribute('color', color);
    geometry.boundingBox = full.boundingBox?.clone() ?? null;
    geometry.boundingSphere = full.boundingSphere?.clone() ?? null;
    out.push({ slot: s, geometry, triangles: Uint32Array.from(tris) });
  }
  let disposed = false;
  return {
    full,
    slots: out,
    position,
    normal,
    color,
    hasColors,
    vertexCount,
    triangleCount,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const s of out) s.geometry.dispose();
      full.dispose();
    },
  };
}

/**
 * Write preview data into a mounted bundle (positions and/or colours of the
 * same vertex count), recompute normals and bounds, and flag the GPU upload.
 * Returns false when the sizes do not match (the caller should rebuild).
 */
export function previewMeshGeometry(bundle: MeshGeometryBundle, positions: Float32Array | null, colors: Float32Array | null): boolean {
  if (positions) {
    if (positions.length !== bundle.position.array.length) return false;
    (bundle.position.array as Float32Array).set(positions);
    bundle.position.needsUpdate = true;
    bundle.full.computeVertexNormals();
    bundle.normal.needsUpdate = true;
    bundle.full.computeBoundingBox();
    bundle.full.computeBoundingSphere();
    // Copy into the slots' existing bounds (no allocation per preview frame).
    for (const s of bundle.slots) {
      if (bundle.full.boundingBox && s.geometry.boundingBox) s.geometry.boundingBox.copy(bundle.full.boundingBox);
      if (bundle.full.boundingSphere && s.geometry.boundingSphere) s.geometry.boundingSphere.copy(bundle.full.boundingSphere);
    }
  }
  if (colors) {
    if (colors.length !== bundle.color.array.length) return false;
    (bundle.color.array as Float32Array).set(colors);
    bundle.color.needsUpdate = true;
  }
  return true;
}
