/**
 * ScatterField — a huge instanced layer (forests, grass, boulders) drawn
 * through {@link FieldCuller}: chunk culling, automatic QEM LOD levels and a
 * per-frame triangle budget. One `InstancedMesh` per (level, part) whose
 * instance buffer holds only the instances that level draws this frame.
 *
 * The sun's shadow map draws each level one step coarser: a stand-in per (level, part) with the next level's geometry
 * and the same instance buffer, on {@link FIELD_SHADOW_LAYER}. A shadow is a silhouette a few texels across; the finest
 * level's detail was most of the shadow pass of a forest (Kestrel Outpost: 180,000 of 490,000 triangles).
 *
 * Works identically on the WebGPU and WebGL2 backends: the GPU only ever
 * sees ordinary instanced draws.
 */
import { Box3, Group, InstancedBufferAttribute, InstancedMesh, Sphere, Vector3, type BufferGeometry, type Material } from 'three';
import { DEFAULT_LOD_PIXELS, FieldCuller, type FieldChunks } from './field-culler';
import type { LocalView } from './view';

/** Instances at or above which a scatter layer becomes a field. */
export const FIELD_MIN_INSTANCES = 2_000;
/**
 * A layer below {@link FIELD_MIN_INSTANCES} is a field as well when it is heavy: at least this many instances ...
 */
export const FIELD_HEAVY_MIN_INSTANCES = 24;
/** ... and at least this many triangles drawn when every instance is at its finest level (a forest of 300 trees). */
export const FIELD_HEAVY_MIN_TRIANGLES = 60_000;

/** Whether a scatter layer of `instances` copies of a mesh of `trianglesPerInstance` is drawn as a culled, LOD'd field. */
export function isFieldLayer(instances: number, trianglesPerInstance: number): boolean {
  if (instances >= FIELD_MIN_INSTANCES) return true;
  return instances >= FIELD_HEAVY_MIN_INSTANCES && instances * trianglesPerInstance >= FIELD_HEAVY_MIN_TRIANGLES;
}

/** Instances per culling chunk: the default for big layers, finer for small ones so a few hundred trees still cull and LOD by region. */
export function fieldChunkSize(instances: number, standard: number): number {
  if (instances >= FIELD_MIN_INSTANCES) return standard;
  return Math.max(8, Math.min(standard, Math.round(instances / 14)));
}

/**
 * Layer of the shadow stand-ins of a field (see {@link ScatterField}): drawn only by a shadow camera that enables it, which
 * then skips the meshes they stand in for ({@link fieldShadowSkipped}).
 */
export const FIELD_SHADOW_LAYER = 11;

/** Field meshes whose shadow a stand-in draws for a camera with {@link FIELD_SHADOW_LAYER}. */
const standIns = new WeakSet<object>();

/** Whether a shadow camera with {@link FIELD_SHADOW_LAYER} skips `object` (a stand-in casts for it). */
export function fieldShadowSkipped(object: object): boolean {
  return standIns.has(object);
}

/** Triangles per instance the default switch points ({@link DEFAULT_LOD_PIXELS}) suit. */
export const LOD_REFERENCE_TRIANGLES = 1_000;

/**
 * Switch points (projected instance radius in px) between consecutive levels of a field whose levels draw
 * `levelTriangles` per instance (finest first). A level gives way to the next when it would draw more triangles per
 * pixel of the instance than the default switch point allows a {@link LOD_REFERENCE_TRIANGLES}-triangle mesh: the
 * switch radius grows with the square root of the level's triangles. A pine of 3,300 triangles left its finest level at
 * the radius a 1,000-triangle bush does, so a forest a stone's throw away drew 50 of them at full detail (Kestrel
 * Outpost's opening view: 170,000 triangles, a third of the frame). Lighter meshes keep the defaults.
 */
export function fieldLodPixels(levelTriangles: readonly number[]): number[] {
  const out: number[] = [];
  for (let l = 0; l + 1 < levelTriangles.length; l++) {
    const base = DEFAULT_LOD_PIXELS[l] ?? (DEFAULT_LOD_PIXELS[DEFAULT_LOD_PIXELS.length - 1] as number);
    const k = Math.sqrt(Math.max(1, levelTriangles[l] as number) / LOD_REFERENCE_TRIANGLES);
    out.push(base * Math.max(1, k));
  }
  return out;
}

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
  /** Shadow stand-ins of `meshes[level * parts + part]` for every level but the coarsest (same order). */
  readonly shadowMeshes: InstancedMesh[] = [];
  private readonly attributes: InstancedBufferAttribute[] = [];
  private readonly ranges: Array<{ start: number; count: number }> = [];
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
    const lodTriangles = levels.map((l) => Math.max(1, l.triangles));
    this.culler = new FieldCuller(chunks, { lodTriangles, radius, budgetTriangles, thresholds: fieldLodPixels(lodTriangles) });
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
      // Static usage on purpose: three re-uploads DynamicDrawUsage buffers on every draw;
      // re-plans upload through version bumps with update ranges instead.
      const attr = new InstancedBufferAttribute(this.culler.buffers[l] as Float32Array, 16);
      this.attributes.push(attr);
      this.ranges.push({ start: 0, count: 0 });
      for (let p = 0; p < this.parts; p++) {
        const geometry = level.geometries[p] as BufferGeometry;
        const mesh = new InstancedMesh(geometry, materials[p] as Material, 0);
        mesh.instanceMatrix = attr;
        mesh.count = 0;
        mesh.visible = false;
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
    for (let l = 0; l + 1 < levels.length; l++) {
      const coarser = levels[l + 1] as FieldLevel;
      for (let p = 0; p < this.parts; p++) {
        const source = this.meshes[l * this.parts + p] as InstancedMesh;
        const mesh = new InstancedMesh(coarser.geometries[p] as BufferGeometry, source.material, 0);
        mesh.instanceMatrix = source.instanceMatrix;
        // Casts as its source does, with its source's material (bindings re-materialise the source only).
        Object.defineProperty(mesh, 'material', { get: () => source.material, set: () => undefined, configurable: true });
        Object.defineProperty(mesh, 'castShadow', { get: () => source.castShadow, set: () => undefined, configurable: true });
        mesh.receiveShadow = false;
        mesh.layers.set(FIELD_SHADOW_LAYER);
        mesh.count = 0;
        mesh.visible = false;
        mesh.frustumCulled = false;
        mesh.boundingBox = box.clone();
        mesh.boundingSphere = sphere.clone();
        mesh.raycast = noRaycast;
        mesh.matrixAutoUpdate = false;
        mesh.userData['shadowOnly'] = true;
        mesh.name = `field:l${l}:p${p}:shadow`;
        standIns.add(source);
        this.shadowMeshes.push(mesh);
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
      for (let p = 0; p < this.parts; p++) {
        const mesh = this.meshes[l * this.parts + p] as InstancedMesh;
        mesh.count = count;
        // An empty level is not submitted at all.
        mesh.visible = count > 0;
        const stand = this.shadowMeshes[l * this.parts + p];
        if (stand) {
          stand.count = count;
          stand.visible = count > 0;
        }
      }
      if (!(dirty & (1 << l))) continue;
      const from = Math.min(count, this.culler.dirtyFrom[l] as number);
      if (from >= count) continue;
      const attr = this.attributes[l] as InstancedBufferAttribute;
      // Ranges accumulate until uploaded (the renderer clears them), so two re-plans before one draw stay correct.
      // One pooled range per buffer (merged while it waits for its upload): no allocation per re-plan.
      const ranges = attr.updateRanges;
      const range = this.ranges[l] as { start: number; count: number };
      if (ranges.length === 0) {
        range.start = from * 16;
        range.count = (count - from) * 16;
        ranges.push(range);
      } else {
        const start = Math.min(range.start, from * 16);
        const end = Math.max(range.start + range.count, count * 16);
        range.start = start;
        range.count = end - start;
      }
      attr.needsUpdate = true;
    }
    return true;
  }

  /** Release the instanced meshes (geometries and materials belong to the caches). */
  dispose(): void {
    for (const m of this.meshes) {
      standIns.delete(m);
      m.dispose();
    }
    for (const m of this.shadowMeshes) m.dispose();
    this.group.clear();
  }
}

const _p = new Vector3();
