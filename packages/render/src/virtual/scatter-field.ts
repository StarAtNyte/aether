/**
 * ScatterField — a huge instanced layer (forests, grass, boulders) drawn
 * through {@link FieldCuller}: chunk culling, automatic QEM LOD levels and a
 * per-frame triangle budget. One `InstancedMesh` per (level, part) whose
 * instance buffer holds only the instances that level draws this frame.
 *
 * Works identically on the WebGPU and WebGL2 backends: the GPU only ever
 * sees ordinary instanced draws.
 */
import { Box3, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Sphere, Vector3, type BufferGeometry, type Material } from 'three';
import { FieldCuller, type FieldChunks } from './field-culler';
import type { LocalView } from './view';

/** Instances at or above which a scatter layer becomes a field. */
export const FIELD_MIN_INSTANCES = 2_000;

/** One LOD level: a geometry per part and its triangles per instance. */
export interface FieldLevel {
  geometries: BufferGeometry[];
  triangles: number;
}

function noRaycast(): void {
  // Fields are picked through their bounds (SceneSync.pickScatter), never per instance.
}

/** See the module docs. */
export class ScatterField {
  readonly group = new Group();
  /** Meshes in level-major order: `meshes[level * parts + part]`. */
  readonly meshes: InstancedMesh[] = [];
  readonly culler: FieldCuller;
  private readonly attributes: InstancedBufferAttribute[] = [];
  private readonly parts: number;

  /**
   * @param chunks packed, chunk-sorted instances (field-local space)
   * @param levels LOD levels, finest first; every level has one geometry per part
   * @param materials one material per part
   * @param radius instance bounding radius at scale 1
   * @param budgetTriangles triangle budget per frame for this field
   */
  constructor(chunks: FieldChunks, levels: readonly FieldLevel[], materials: readonly Material[], radius: number, budgetTriangles: number) {
    this.group.name = 'field';
    this.group.matrixAutoUpdate = false;
    this.parts = materials.length;
    this.culler = new FieldCuller(chunks, { lodTriangles: levels.map((l) => Math.max(1, l.triangles)), radius, budgetTriangles });
    // Whole-field bounds (picking, framing); instances are culled per chunk on the CPU.
    const box = new Box3();
    for (let c = 0; c < chunks.chunkCount; c++) {
      const b = c * 6;
      box.expandByPoint(_p.set(chunks.boxes[b] as number, chunks.boxes[b + 1] as number, chunks.boxes[b + 2] as number));
      box.expandByPoint(_p.set(chunks.boxes[b + 3] as number, chunks.boxes[b + 4] as number, chunks.boxes[b + 5] as number));
    }
    const sphere = box.isEmpty() ? new Sphere() : box.getBoundingSphere(new Sphere());
    for (let l = 0; l < levels.length; l++) {
      const level = levels[l] as FieldLevel;
      const attr = new InstancedBufferAttribute(this.culler.buffers[l] as Float32Array, 16);
      attr.setUsage(DynamicDrawUsage);
      this.attributes.push(attr);
      for (let p = 0; p < this.parts; p++) {
        const geometry = level.geometries[p] as BufferGeometry;
        const mesh = new InstancedMesh(geometry, materials[p] as Material, 0);
        mesh.instanceMatrix = attr;
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.boundingBox = box.clone();
        mesh.boundingSphere = sphere.clone();
        mesh.raycast = noRaycast;
        mesh.matrixAutoUpdate = false;
        mesh.name = `field:l${l}:p${p}`;
        this.meshes.push(mesh);
        this.group.add(mesh);
      }
    }
  }

  /** Number of LOD levels. */
  get levels(): number {
    return this.attributes.length;
  }

  /**
   * Re-plan for a camera given in field-local space. Uploads only the level
   * buffers whose membership changed. Returns true when anything changed.
   */
  update(view: LocalView): boolean {
    const dirty = this.culler.update(view);
    if (dirty === 0) return false;
    for (let l = 0; l < this.attributes.length; l++) {
      const count = this.culler.counts[l] as number;
      for (let p = 0; p < this.parts; p++) (this.meshes[l * this.parts + p] as InstancedMesh).count = count;
      if (!(dirty & (1 << l))) continue;
      const attr = this.attributes[l] as InstancedBufferAttribute;
      attr.clearUpdateRanges();
      if (count > 0) attr.addUpdateRange(0, count * 16);
      attr.needsUpdate = true;
    }
    return true;
  }

  /** Release the instanced meshes (geometries and materials belong to the caches). */
  dispose(): void {
    for (const m of this.meshes) m.dispose();
    this.group.clear();
  }
}

const _p = new Vector3();
