/**
 * Per-cell batches of virtual geometry (stage 4a of docs/ARCHITECTURE-STREAMING.md): the virtual stand-ins of one grid
 * cell that share a material draw as one mesh. Each member keeps its own cluster DAG and selects its own cut every
 * frame the camera changed, exactly as in {@link VirtualGroup}; the cuts are packed back to back, offset to the member's
 * vertices, into one index buffer over the members' vertices merged into batch space. A row of forty townhouses of one
 * plaster is one draw instead of forty.
 *
 * - Members stay in the scene graph, moved to the raycast-only layer while batched (their sources answer picking as
 *   before); the batch keeps each member's index range and entity id ({@link VirtualCellBatch.entityAt}).
 * - A member that changes (material, geometry, transform, hidden, removed) or is selected is evicted: it draws its own
 *   cut again at once and the batch packs nothing for it; the cell is merged again later.
 * - A member whose sun shadow comes from a cell shadow batch (`covered`) is frustum- and back-face-culled in the view
 *   cut, like a non-caster; the batch casts only while some caster member is not covered.
 */
import { BufferAttribute, BufferGeometry, FrontSide, Material, Matrix3, Matrix4, Mesh, Vector3, type Object3D, type PerspectiveCamera, type TypedArray } from 'three';
import { createCutScratch, cutIndexCount, selectCut, type ClusterDag, type CutScratch, type CutView } from './cluster-dag';
import { createLocalView, localView, sphereFarOutside } from './view';
import { VIRTUAL_ERROR_PX } from './virtual-mesh';
import { releaseAfterUpload } from '../gpu/cpu-release';
import { quantizeOnGpu } from '../gpu/quantized-geometry';

/** Attributes a batch carries (those VirtualGroup draws). */
const ATTRIBUTES = ['position', 'normal', 'color', 'uv', 'splat'] as const;
const MAX_THRESHOLD_SCALE = 64;
/** A caster keeps its cut while the camera moved less than this share of its distance (as VirtualGroup). */
const CASTER_REUSE = 0.015;
/** Index capacity per member (triangles), at most. */
export const MEMBER_CAPACITY_TRIANGLES = 196_608;

/** A virtual stand-in offered for batching. */
export interface VirtualBatchMember {
  /** The drawn stand-in (an instance of a VirtualGroup). */
  mesh: Mesh;
  /** Its full-detail source mesh (vertex arrays, material and shadow flags). */
  source: Mesh;
  dag: ClusterDag;
  id: string | null;
}

/** Key of the attributes a member's geometry carries (members of one batch must agree). */
export function attributeSignature(g: BufferGeometry): string {
  const out: string[] = [];
  for (const name of ATTRIBUTES) {
    const a = g.getAttribute(name);
    if (!(a instanceof BufferAttribute)) continue;
    out.push(name === 'position' || name === 'normal' ? name : `${name}:${a.itemSize}:${a.normalized ? 1 : 0}:${a.array.constructor.name}`);
  }
  return out.join(',');
}

/** Write the vertices of `g`, transformed by `matrix`, into `arrays` from vertex `base`; returns its vertex count. */
function writeVertices(arrays: ReadonlyMap<string, TypedArray>, g: BufferGeometry, matrix: Matrix4, base: number): number {
  _n.getNormalMatrix(matrix);
  const pos = g.getAttribute('position') as BufferAttribute;
  const n = pos.count;
  const P = arrays.get('position')!;
  for (let i = 0; i < n; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    P[(base + i) * 3] = _v.x; P[(base + i) * 3 + 1] = _v.y; P[(base + i) * 3 + 2] = _v.z;
  }
  const nor = g.getAttribute('normal') as BufferAttribute | undefined;
  const N = arrays.get('normal');
  if (nor && N) {
    for (let i = 0; i < n; i++) {
      _v.fromBufferAttribute(nor, i).applyMatrix3(_n).normalize();
      N[(base + i) * 3] = _v.x; N[(base + i) * 3 + 1] = _v.y; N[(base + i) * 3 + 2] = _v.z;
    }
  }
  for (const name of ['color', 'uv', 'splat'] as const) {
    const a = g.getAttribute(name) as BufferAttribute | undefined;
    const out = arrays.get(name);
    if (a && out) out.set(a.array.subarray(0, n * a.itemSize) as never, base * a.itemSize);
  }
  return n;
}

interface Slot {
  m: VirtualBatchMember;
  geometry: BufferGeometry;
  material: Material;
  world: Matrix4;
  /** First vertex of the member in the batch. */
  base: number;
  scratch: CutScratch;
  selected: Uint32Array;
  count: number;
  indexCount: number;
  hash: number;
  last: Float64Array;
  /** Index range written by the last pack. */
  start: number;
  length: number;
  evicted: boolean;
}

const _m = new Matrix4();
const _n = new Matrix3();
const _v = new Vector3();

/** One cell's virtual stand-ins of one material, drawn as one mesh. */
export class VirtualCellBatch {
  readonly mesh: Mesh;
  private readonly slots: Slot[] = [];
  private readonly index: BufferAttribute;
  private readonly view = createLocalView();
  private readonly cut: CutView = { cx: 0, cy: 0, cz: 0, pixelScale: 1, threshold: VIRTUAL_ERROR_PX, planes: null, backface: false };
  thresholdScale = 1;
  drawnTriangles = 0;

  /**
   * @param members stand-ins of one material and attribute signature
   * @param toBatch matrix from world to the batch's parent space (inverse of the parent's world matrix)
   */
  constructor(readonly key: string, members: readonly VirtualBatchMember[], toBatch: Matrix4) {
    let vertices = 0;
    let capacity = 0;
    for (const m of members) {
      vertices += m.source.geometry.getAttribute('position').count;
      capacity += Math.min(MEMBER_CAPACITY_TRIANGLES, Math.max(m.dag.baseTriangles, 1));
    }
    const first = members[0]!.source.geometry;
    const geometry = new BufferGeometry();
    const arrays = new Map<string, TypedArray>();
    for (const name of ATTRIBUTES) {
      const a = first.getAttribute(name);
      if (!(a instanceof BufferAttribute)) continue;
      const Ctor = (name === 'position' || name === 'normal' ? Float32Array : a.array.constructor) as new (n: number) => TypedArray;
      const array = new Ctor(vertices * a.itemSize);
      arrays.set(name, array);
      geometry.setAttribute(name, new BufferAttribute(array, a.itemSize, name === 'position' || name === 'normal' ? false : a.normalized));
    }
    let base = 0;
    for (const m of members) {
      const g = m.source.geometry;
      const world = m.mesh.matrixWorld.clone();
      const n = writeVertices(arrays, g, _m.multiplyMatrices(toBatch, world), base);
      this.slots.push({ m, geometry: g, material: m.source.material as Material, world, base, scratch: createCutScratch(m.dag), selected: new Uint32Array(Math.max(1, m.dag.count)),
        count: 0, indexCount: 0, hash: -1, last: new Float64Array(4).fill(Number.NaN), start: 0, length: 0, evicted: false });
      base += n;
    }
    // Static usage: changes go up as ranged updates (see VirtualGroup).
    this.index = new BufferAttribute(vertices <= 65536 ? new Uint16Array(Math.max(3, capacity * 3)) : new Uint32Array(Math.max(3, capacity * 3)), 1);
    geometry.setIndex(this.index);
    geometry.setDrawRange(0, 0);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    // The vertices never change once uploaded (a cut rewrites the index only): their CPU copy goes (gpu/cpu-release.ts).
    // An export asks for them again: rebuilt from the members' sources, with the cut drawn now.
    const from = toBatch.clone();
    releaseAfterUpload(geometry, { restore: () => this.restore(from) }, ATTRIBUTES);
    const src = members[0]!.source;
    const mesh = new Mesh(geometry, src.material as Material);
    quantizeOnGpu(geometry, mesh);
    mesh.name = `aether:cell-virtual#${key}`;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = src.receiveShadow;
    mesh.castShadow = src.castShadow;
    mesh.renderOrder = src.renderOrder;
    mesh.visible = false;
    mesh.raycast = noRaycast;
    mesh.userData['aetherBatch'] = this;
    this.mesh = mesh;
  }

  /** A new geometry with this batch's vertices and its current index (its own vertex arrays were released). */
  private restore(toBatch: Matrix4): BufferGeometry {
    const now = this.mesh.geometry;
    const geometry = new BufferGeometry();
    const arrays = new Map<string, TypedArray>();
    for (const name of ATTRIBUTES) {
      const a = now.getAttribute(name);
      if (!(a instanceof BufferAttribute)) continue;
      const array = new (a.array.constructor as new (n: number) => TypedArray)(a.count * a.itemSize);
      arrays.set(name, array);
      geometry.setAttribute(name, new BufferAttribute(array, a.itemSize, a.normalized));
    }
    for (const slot of this.slots) writeVertices(arrays, slot.geometry, _m.multiplyMatrices(toBatch, slot.world), slot.base);
    geometry.setIndex(new BufferAttribute((this.index.array as Uint32Array | Uint16Array).slice(), 1));
    geometry.setDrawRange(now.drawRange.start, now.drawRange.count);
    geometry.boundingBox = now.boundingBox?.clone() ?? null;
    geometry.boundingSphere = now.boundingSphere?.clone() ?? null;
    return geometry;
  }

  get size(): number {
    return this.slots.length;
  }

  /** Members still drawn by the batch. */
  *members(): IterableIterator<VirtualBatchMember> {
    for (const s of this.slots) if (!s.evicted) yield s.m;
  }

  /** All members, evicted ones included. */
  *allMembers(): IterableIterator<VirtualBatchMember> {
    for (const s of this.slots) yield s.m;
  }

  /**
   * Members that changed since they were merged (call before {@link update}); they are evicted (the caller hands them
   * back to their group). `pinned`: entities kept out (selected).
   */
  verify(pinned: ReadonlySet<string>, out: VirtualBatchMember[]): void {
    for (const s of this.slots) {
      if (s.evicted) continue;
      const { mesh, source } = s.m;
      let ok = source.geometry === s.geometry && source.material === s.material && (s.m.id === null || !pinned.has(s.m.id)) && source.parent !== null && mesh.parent === source.parent;
      if (ok) {
        mesh.updateWorldMatrix(true, false);
        ok = mesh.matrixWorld.equals(s.world) && visibleUpward(mesh.parent);
      }
      if (ok) continue;
      s.evicted = true;
      s.count = 0;
      s.indexCount = 0;
      s.hash = -1;
      out.push(s.m);
    }
  }

  /**
   * Select every member's cut for `camera` and pack them. `covered(mesh)`: the member's sun shadow comes from a shadow
   * batch, so its view cut may cull. True when the index buffer or the draw range changed. Allocation-free.
   */
  update(camera: PerspectiveCamera, heightPx: number, covered: (mesh: Mesh) => boolean): boolean {
    const slots = this.slots;
    let casts = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      let total = 0;
      casts = false;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i] as Slot;
        if (s.evicted) continue;
        const { mesh, source } = s.m;
        const caster = source.castShadow && !covered(mesh);
        if (caster) casts = true;
        const v = localView(camera, mesh, heightPx, this.view);
        const cut = this.cut;
        cut.cx = v.cx; cut.cy = v.cy; cut.cz = v.cz;
        cut.pixelScale = v.pixelScale;
        cut.threshold = VIRTUAL_ERROR_PX * this.thresholdScale;
        if (caster && s.count > 0) {
          const last = s.last;
          const lx = last[0] as number;
          if (last[3] === cut.threshold && lx === lx) {
            const dx = v.cx - lx, dy = v.cy - (last[1] as number), dz = v.cz - (last[2] as number);
            if (dx * dx + dy * dy + dz * dz < (v.cx * v.cx + v.cy * v.cy + v.cz * v.cz) * CASTER_REUSE * CASTER_REUSE || sphereFarOutside(mesh.geometry.boundingSphere, v.planes)) {
              total += s.indexCount;
              continue;
            }
          }
        }
        s.last[0] = v.cx; s.last[1] = v.cy; s.last[2] = v.cz; s.last[3] = cut.threshold;
        cut.planes = caster ? null : v.planes;
        cut.backface = !caster && (source.material as Material).side === FrontSide;
        s.count = selectCut(s.m.dag, cut, s.selected, s.scratch);
        s.indexCount = cutIndexCount(s.m.dag, s.selected, s.count);
        total += s.indexCount;
      }
      if (total <= this.index.count || this.thresholdScale >= MAX_THRESHOLD_SCALE) break;
      this.thresholdScale = Math.min(MAX_THRESHOLD_SCALE, this.thresholdScale * 1.6);
    }
    this.mesh.castShadow = casts;
    let first = -1;
    let total = 0;
    for (let k = 0; k < slots.length; k++) {
      const s = slots[k] as Slot;
      let h = s.count | 0;
      for (let i = 0; i < s.count; i++) h = (Math.imul(h, 31) + (s.selected[i] as number)) | 0;
      if (h !== s.hash && first < 0) first = k;
      s.hash = h;
      total += s.indexCount;
    }
    if (this.thresholdScale > 1 && total < this.index.count * 0.35) {
      this.thresholdScale = Math.max(1, this.thresholdScale / 1.25);
      first = 0;
      for (const s of slots) s.hash = -1;
    }
    if (first < 0) return false;
    const target = this.index.array as Uint32Array | Uint16Array;
    const start = first > 0 ? (slots[first - 1] as Slot).start + (slots[first - 1] as Slot).length : 0;
    let w = start;
    for (let k = first; k < slots.length; k++) {
      const s = slots[k] as Slot;
      s.start = w;
      const dag = s.m.dag;
      const base = s.base;
      for (let i = 0; i < s.count; i++) {
        const c = s.selected[i] as number;
        const a = dag.offsets[c] as number, b = dag.offsets[c + 1] as number;
        if (w + (b - a) > target.length) break;
        for (let j = a; j < b; j++) target[w++] = (dag.indices[j] as number) + base;
      }
      s.length = w - s.start;
    }
    this.mesh.geometry.setDrawRange(0, w);
    this.mesh.visible = w > 0;
    this.drawnTriangles = w / 3;
    if (w > start) {
      this.index.addUpdateRange(start, w - start);
      this.index.needsUpdate = true;
    }
    return true;
  }

  /** Entity whose cut holds triangle `triangle` of the last pack (null: none). */
  entityAt(triangle: number): string | null {
    const i = triangle * 3;
    for (const s of this.slots) if (!s.evicted && i >= s.start && i < s.start + s.length) return s.m.id;
    return null;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}

function noRaycast(): void {
  // Members' sources answer picking; entityAt maps a triangle of the batch to its entity.
}

function visibleUpward(o: Object3D | null): boolean {
  if (!o) return false;
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Owner hooks of {@link VirtualCellBatches}. */
export interface VirtualBatchHost {
  /** Hand `mesh`'s drawing to a batch (`on`) or give it back to its VirtualGroup. */
  setBatched(mesh: Mesh, on: boolean): void;
  /** Layer of batched members (raycast only). */
  hiddenLayer: number;
  /** A batch was built, or a member evicted (a frame and a fresh view plan are needed). */
  changed?(): void;
  now?(): number;
}

/** Fewest stand-ins worth a batch. */
const MIN_VIRTUAL_MEMBERS = 2;
/** A cell whose members changed is merged again after this long without another change (ms). */
export const VIRTUAL_REBUILD_QUIET_MS = 400;

/**
 * A material whose shading does not depend on the object it is drawn for: no node slots (per-object tones and object-space
 * patterns come from node graphs that read the model matrix or the geometry's own coordinates), no vertex displacement.
 */
export function batchableViewMaterial(m: Material | Material[] | null | undefined): m is Material {
  if (!m || Array.isArray(m)) return false;
  const fields = m as unknown as Record<string, unknown>;
  for (const k of Object.keys(fields)) if (k.endsWith('Node') && fields[k] != null) return false;
  if ((m as { displacementMap?: unknown }).displacementMap || (m as { wireframe?: boolean }).wireframe) return false;
  return m.onBeforeCompile === Material.prototype.onBeforeCompile && m.onBeforeRender === Material.prototype.onBeforeRender;
}

/** Every cell's virtual batches; see {@link VirtualCellBatch}. */
export class VirtualCellBatches {
  private readonly batches = new Map<string, VirtualCellBatch>();
  private readonly owner = new Map<Mesh, VirtualCellBatch>();
  private wanted = new Map<string, VirtualBatchMember[]>();
  private readonly dirty = new Map<string, number>();
  private readonly pinned = new Set<string>();
  private readonly evicted: VirtualBatchMember[] = [];
  private readonly inverse = new Matrix4();
  private readonly now: () => number;
  /** Pins were released: offer the candidates again. */
  rescanNeeded = false;

  constructor(readonly root: Object3D, private readonly host: VirtualBatchHost) {
    this.now = host.now ?? (() => performance.now());
  }

  get count(): number {
    return this.batches.size;
  }

  get pending(): number {
    return this.dirty.size;
  }

  /** Draws saved per view pass (members drawn by a batch, minus the batch's own draw). */
  get saved(): number {
    let n = 0;
    for (const b of this.batches.values()) {
      let k = 0;
      for (const _ of b.members()) k++;
      n += Math.max(0, k - 1);
    }
    return n;
  }

  /** Group candidates by `cellOf(source)` and material; changed cells are queued (built by {@link pump}). */
  rebuild(candidates: Iterable<VirtualBatchMember>, cellOf: (mesh: Mesh) => string | null): void {
    const wanted = new Map<string, VirtualBatchMember[]>();
    for (const c of candidates) {
      if (c.id !== null && this.pinned.has(c.id)) continue;
      if (!batchableViewMaterial(c.source.material as Material)) continue;
      const cell = cellOf(c.source);
      if (cell === null) continue;
      const m = c.source.material as Material;
      const key = `${cell}|${m.uuid}|${+c.source.castShadow}${+c.source.receiveShadow}|${c.source.renderOrder}|${attributeSignature(c.source.geometry)}`;
      let list = wanted.get(key);
      if (!list) wanted.set(key, (list = []));
      list.push(c);
    }
    this.wanted = wanted;
    const t = this.now();
    for (const [key, list] of wanted) {
      const have = this.batches.get(key);
      if (have && sameVirtualMembers(have, list)) continue;
      if (!this.dirty.has(key)) this.dirty.set(key, have ? t : t - VIRTUAL_REBUILD_QUIET_MS);
    }
    for (const key of this.batches.keys()) if (!wanted.has(key)) this.dirty.set(key, t - VIRTUAL_REBUILD_QUIET_MS);
  }

  /** Build due cells until `budgetMs` is spent (one at least). True when a batch changed. */
  pump(budgetMs: number): boolean {
    if (this.dirty.size === 0) return false;
    const t0 = this.now();
    let changed = false;
    for (const [key, at] of this.dirty) {
      if (t0 - at < VIRTUAL_REBUILD_QUIET_MS) continue;
      this.dirty.delete(key);
      this.buildCell(key);
      changed = true;
      if (this.now() - t0 >= budgetMs) break;
    }
    if (changed) this.host.changed?.();
    return changed;
  }

  /** Build everything queued now (tests, captures). */
  flush(): boolean {
    const keys = [...this.dirty.keys()];
    this.dirty.clear();
    for (const key of keys) this.buildCell(key);
    if (keys.length > 0) this.host.changed?.();
    return keys.length > 0;
  }

  /** Evict members that changed or were pinned (call each frame before drawing). True when one was. */
  verify(): boolean {
    if (this.batches.size === 0) return false;
    const out = this.evicted;
    out.length = 0;
    for (const b of this.batches.values()) b.verify(this.pinned, out);
    if (out.length === 0) return false;
    const t = this.now();
    for (const m of out) {
      const b = this.owner.get(m.mesh);
      this.release(m);
      if (b) { this.owner.delete(m.mesh); this.dirty.set(b.key, t); }
    }
    out.length = 0;
    this.host.changed?.();
    return true;
  }

  /** Plan and pack every batch's cuts for `camera`. True when an index buffer changed. */
  update(camera: PerspectiveCamera, heightPx: number, covered: (mesh: Mesh) => boolean): boolean {
    let changed = false;
    for (const b of this.batches.values()) if (b.update(camera, heightPx, covered)) changed = true;
    return changed;
  }

  /** Keep entities `ids` out of the batches (selected); {@link verify} evicts them on the next frame. */
  pin(ids: Iterable<string>): void {
    const next = new Set(ids);
    for (const id of this.pinned) if (!next.has(id)) this.rescanNeeded = true;
    this.pinned.clear();
    for (const id of next) this.pinned.add(id);
  }

  /** Entity that triangle `triangle` of batch mesh `mesh` belongs to (null: not a batch, or no member there). */
  entityAt(mesh: Object3D, triangle: number): string | null {
    const b = (mesh.userData as { aetherBatch?: unknown }).aetherBatch;
    return b instanceof VirtualCellBatch ? b.entityAt(triangle) : null;
  }

  /** Batch drawing stand-in `mesh`, or null. */
  batchOf(mesh: Mesh): VirtualCellBatch | null {
    return this.owner.get(mesh) ?? null;
  }

  *meshes(): IterableIterator<Mesh> {
    for (const b of this.batches.values()) yield b.mesh;
  }

  clear(): void {
    for (const b of this.batches.values()) this.drop(b);
    this.batches.clear();
    this.owner.clear();
    this.dirty.clear();
    this.wanted.clear();
  }

  dispose(): void {
    this.clear();
  }

  private release(m: VirtualBatchMember): void {
    if (m.mesh.layers.mask === 1 << this.host.hiddenLayer) m.mesh.layers.set(0);
    this.host.setBatched(m.mesh, false);
  }

  private drop(b: VirtualCellBatch): void {
    for (const m of b.allMembers()) {
      if (this.owner.get(m.mesh) !== b) continue;
      this.owner.delete(m.mesh);
      this.release(m);
    }
    b.dispose();
  }

  private buildCell(key: string): void {
    const old = this.batches.get(key);
    if (old) { this.drop(old); this.batches.delete(key); }
    const list = (this.wanted.get(key) ?? []).filter((c) => this.current(c));
    if (list.length < MIN_VIRTUAL_MEMBERS) return;
    this.root.updateWorldMatrix(true, false);
    this.inverse.copy(this.root.matrixWorld).invert();
    for (const c of list) c.mesh.updateWorldMatrix(true, false);
    const batch = new VirtualCellBatch(key, list, this.inverse);
    this.root.add(batch.mesh);
    batch.mesh.updateMatrixWorld(true);
    for (const c of list) {
      this.owner.set(c.mesh, batch);
      c.mesh.layers.set(this.host.hiddenLayer);
      this.host.setBatched(c.mesh, true);
    }
    this.batches.set(key, batch);
  }

  private current(c: VirtualBatchMember): boolean {
    if (c.id !== null && this.pinned.has(c.id)) return false;
    if (this.owner.has(c.mesh) || c.mesh.layers.mask !== 1 || c.mesh.parent === null || c.source.parent !== c.mesh.parent) return false;
    return batchableViewMaterial(c.source.material as Material) && visibleUpward(c.mesh.parent);
  }
}

/** The batch holds exactly `list`, in order, none evicted. */
function sameVirtualMembers(b: VirtualCellBatch, list: readonly VirtualBatchMember[]): boolean {
  let i = 0;
  for (const m of b.allMembers()) {
    const c = list[i++];
    if (!c || c.mesh !== m.mesh || c.source !== m.source || c.dag !== m.dag) return false;
  }
  if (i !== list.length) return false;
  let live = 0;
  for (const _ of b.members()) live++;
  return live === list.length;
}
