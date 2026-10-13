/**
 * Virtual geometry on the GPU side: every instance of a high-poly mesh draws
 * a view-dependent cut of its cluster LOD DAG.
 *
 * One {@link VirtualGroup} per unique mesh owns one set of vertex buffers
 * (the source vertices: half-edge collapse never creates new ones) and one
 * dynamic index buffer. Each frame the camera changed, every instance
 * selects its cut (screen-space error ≤ threshold, frustum and back-face
 * culled when it casts no shadows), and the cuts are packed back to back
 * into the shared index buffer; each instance draws its own range. When the
 * cuts no longer fit the budget, the error threshold rises (a coarser but
 * still crack-free cut) and relaxes again when there is room.
 *
 * Plain indexed draws only, so the WebGPU and WebGL2 backends behave alike.
 */
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, FrontSide, Mesh, type Material, type PerspectiveCamera } from 'three';
import { assembleCut, createCutScratch, cutIndexCount, selectCut, type ClusterDag, type CutScratch, type CutView } from './cluster-dag';
import { createLocalView, localView } from './view';

/** Mesh parts with at least this many triangles are drawn as virtual geometry. */
export const VIRTUAL_MIN_TRIANGLES = 20_000;
/** Default screen-space error threshold (pixels). */
export const VIRTUAL_ERROR_PX = 1;
/** Threshold scale bounds of the budget governor. */
const MAX_THRESHOLD_SCALE = 64;

function noRaycast(): void {
  // The source mesh (raycast-only layer) answers picking and snapping.
}

interface Instance {
  /** The drawn mesh (shares vertex buffers and the index buffer of the group). */
  mesh: Mesh;
  /** Source mesh whose material, shadow flags and visibility are mirrored. */
  source: Mesh;
  selected: Uint32Array;
  count: number;
  indexCount: number;
  hash: number;
}

/** See the module docs. */
export class VirtualGroup {
  private readonly instances: Instance[] = [];
  private readonly scratch: CutScratch;
  private readonly index: BufferAttribute;
  private readonly attributes: Array<[string, BufferAttribute]> = [];
  private readonly view = createLocalView();
  private readonly cut: CutView = { cx: 0, cy: 0, cz: 0, pixelScale: 1, threshold: VIRTUAL_ERROR_PX, planes: null, backface: false };
  /** Budget governor: multiplies the base error threshold. */
  thresholdScale = 1;
  /** Triangles drawn by the last update over all instances. */
  drawnTriangles = 0;

  /**
   * @param dag the mesh's cluster hierarchy
   * @param source geometry of the source part (its vertex arrays are shared, never copied)
   * @param capacityTriangles size of the shared index buffer
   */
  constructor(readonly dag: ClusterDag, source: BufferGeometry, capacityTriangles: number) {
    this.scratch = createCutScratch(dag);
    for (const name of ['position', 'normal', 'color', 'uv'] as const) {
      const a = source.getAttribute(name);
      if (a instanceof BufferAttribute) this.attributes.push([name, new BufferAttribute(a.array, a.itemSize, a.normalized)]);
    }
    const cap = Math.max(3, Math.floor(Math.max(1, capacityTriangles)) * 3);
    this.index = new BufferAttribute(new Uint32Array(cap), 1);
    this.index.setUsage(DynamicDrawUsage);
    this.sourceBox = source.boundingBox;
    this.sourceSphere = source.boundingSphere;
  }

  private readonly sourceBox: BufferGeometry['boundingBox'];
  private readonly sourceSphere: BufferGeometry['boundingSphere'];

  /** Number of instances. */
  get size(): number {
    return this.instances.length;
  }

  /** Index capacity in triangles. */
  get capacityTriangles(): number {
    return this.index.count / 3;
  }

  /** Create the drawn mesh of an instance whose source mesh is `source` (add it next to the source). */
  add(source: Mesh): Mesh {
    const g = new BufferGeometry();
    for (const [name, attr] of this.attributes) g.setAttribute(name, attr);
    g.setIndex(this.index);
    g.setDrawRange(0, 0);
    if (this.sourceBox) g.boundingBox = this.sourceBox.clone();
    if (this.sourceSphere) g.boundingSphere = this.sourceSphere.clone();
    const mesh = new Mesh(g, source.material as Material);
    mesh.name = `${source.name}:virtual`;
    // Hidden until its first cut is planned (an empty draw range is never submitted).
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(source.matrix);
    mesh.raycast = noRaycast;
    // The cut is planned on the CPU per cluster: three's per-object culling would only add work.
    mesh.frustumCulled = false;
    this.instances.push({ mesh, source, selected: new Uint32Array(Math.max(1, this.dag.count)), count: 0, indexCount: 0, hash: -1 });
    return mesh;
  }

  /** Forget an instance (its geometry is released with the group, see {@link dispose}). */
  remove(mesh: Mesh): void {
    const i = this.instances.findIndex((x) => x.mesh === mesh);
    if (i < 0) return;
    this.instances.splice(i, 1);
    mesh.removeFromParent();
    this.retired.push(mesh.geometry);
  }

  private readonly retired: BufferGeometry[] = [];

  /**
   * Select and pack every instance's cut for `camera`. Returns true when
   * the index buffer or a draw range changed. Allocation-free.
   */
  update(camera: PerspectiveCamera, heightPx: number): boolean {
    let changed = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      let total = 0;
      for (let i = 0; i < this.instances.length; i++) {
        const inst = this.instances[i] as Instance;
        const { mesh, source } = inst;
        mirror(mesh, source);
        // Hidden instances keep their last cut (nothing draws them; it is ready when shown again).
        if (!visibleInScene(mesh.parent)) {
          total += inst.indexCount;
          continue;
        }
        mesh.updateWorldMatrix(true, false);
        const v = localView(camera, mesh, heightPx, this.view);
        const cut = this.cut;
        cut.cx = v.cx;
        cut.cy = v.cy;
        cut.cz = v.cz;
        cut.pixelScale = v.pixelScale;
        cut.threshold = VIRTUAL_ERROR_PX * this.thresholdScale;
        // Shadow casters keep off-screen clusters (they may shadow the view); LOD still applies.
        const culls = !source.castShadow;
        cut.planes = culls ? v.planes : null;
        cut.backface = culls && (source.material as Material).side === FrontSide;
        inst.count = selectCut(this.dag, cut, inst.selected, this.scratch);
        inst.indexCount = cutIndexCount(this.dag, inst.selected, inst.count);
        total += inst.indexCount;
      }
      if (total <= this.index.count || this.thresholdScale >= MAX_THRESHOLD_SCALE) break;
      // Over budget: coarsen every cut (still watertight) and select again.
      this.thresholdScale = Math.min(MAX_THRESHOLD_SCALE, this.thresholdScale * 1.6);
    }
    // Detect changes (order-sensitive hash of every cut); remember the first changed instance.
    let total = 0;
    let first = -1;
    for (let k = 0; k < this.instances.length; k++) {
      const inst = this.instances[k] as Instance;
      let h = inst.count | 0;
      for (let i = 0; i < inst.count; i++) h = (Math.imul(h, 31) + (inst.selected[i] as number)) | 0;
      if (h !== inst.hash && first < 0) first = k;
      inst.hash = h;
      total += inst.indexCount;
    }
    if (first >= 0) changed = true;
    // Relax the governor when there is plenty of room.
    if (this.thresholdScale > 1 && total < this.index.count * 0.35) {
      this.thresholdScale = Math.max(1, this.thresholdScale / 1.25);
      changed = true;
      first = 0;
      for (const inst of this.instances) inst.hash = -1;
    }
    if (!changed) return false;
    if (first < 0) first = 0;
    // Cuts are packed back to back: instances before the first change keep their ranges.
    const target = this.index.array as Uint32Array;
    const start = first > 0 ? (this.instances[first - 1] as Instance).mesh.geometry.drawRange.start + (this.instances[first - 1] as Instance).mesh.geometry.drawRange.count : 0;
    let w = start;
    for (let k = first; k < this.instances.length; k++) {
      const inst = this.instances[k] as Instance;
      const n = assembleCut(this.dag, inst.selected, inst.count, target, w);
      inst.mesh.geometry.setDrawRange(w, n);
      inst.mesh.visible = n > 0;
      w += n;
    }
    let drawn = 0;
    for (const inst of this.instances) drawn += inst.mesh.geometry.drawRange.count;
    this.drawnTriangles = drawn / 3;
    // Upload only what was rewritten; a version bump without a range would re-upload the whole buffer.
    if (w > start) {
      // Ranges accumulate until the renderer uploads them (it clears them afterwards).
      this.index.addUpdateRange(start, w - start);
      this.index.needsUpdate = true;
    }
    return true;
  }

  /** Dispose every instance geometry (shared GPU buffers go with them). */
  dispose(): void {
    for (const inst of this.instances) {
      inst.mesh.removeFromParent();
      inst.mesh.geometry.dispose();
    }
    for (const g of this.retired) g.dispose();
    this.retired.length = 0;
    this.instances.length = 0;
  }
}

/** Copy what SceneSync manages on the source binding (material, shadow flags) to the drawn mesh. */
export function mirror(mesh: Mesh, source: Mesh): void {
  if (mesh.material !== source.material) mesh.material = source.material;
  mesh.castShadow = source.castShadow;
  mesh.receiveShadow = source.receiveShadow;
}

/** True when `o` and all its ancestors are visible (null: detached, not visible). */
function visibleInScene(o: Mesh['parent']): boolean {
  if (!o) return false;
  for (let p: Mesh['parent'] = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
