/**
 * Per-cell shadow batches (stage 4a of docs/ARCHITECTURE-STREAMING.md): the sun's depth pass draws every static opaque
 * caster of a grid cell as one positions-only mesh instead of one draw per mesh.
 *
 * The depth pass draws every caster with one override material (opaque casters share one program, see
 * `gpu/opaque-shadow-nodes.ts`), so what separates two casters there is only their geometry and the side they cast with.
 * A town of 870 caster draws becomes a few dozen: one per (level-1 cell, shadow side).
 *
 * - Members are the meshes the depth pass would draw: an entity's own meshes, building merges (`aether:merged`) and
 *   virtual-geometry stand-ins. A virtual member casts with a fixed cut of its cluster DAG whose world-space error is
 *   {@link SHADOW_ERROR_METRES} (about a quarter of a texel of the cached sun map), instead of the view's cut.
 * - The batch mesh lives on {@link SHADOW_BATCH_LAYER}: the view never sees it, a shadow camera with that layer enabled
 *   draws it, and the shadow pass skips the batch's members for such a camera (see {@link installShadowSkip}). A camera
 *   without the layer (cascades, point-light shadows) draws the members as before.
 * - A member that changes (moved, hidden, rebuilt, re-materialised, removed, selected) is evicted at once: its triangles in
 *   the batch become degenerate (a ranged index upload) and it casts by itself again. Its cell is rebuilt once the cell
 *   has been quiet for {@link REBUILD_QUIET_MS}, in time slices.
 * - Each batch keeps the triangle range of every member and its entity id ({@link entityAt}), so a hit on the batch
 *   resolves to the entity that cast it. Members stay in the scene graph, so picking and selection never see the batch.
 * - A new batch takes over its members only after it has drawn once in a shadow pass (its pipeline is ready), so a
 *   shadow never blinks while a program links.
 */
import { BufferAttribute, BufferGeometry, FrontSide, Matrix4, Mesh, MeshBasicMaterial, Sphere, Vector3, type Camera, type InterleavedBufferAttribute, type Material, type Object3D, type Side } from 'three';
import { createCutScratch, selectCut, type ClusterDag, type CutView } from '../virtual/cluster-dag';
import { ancestorCell, assignCell, partitionFor, PERSISTENT_CELL, type CellPartition } from '../streaming/cell-grid';
import { BATCHED_LAYER } from './static-batches';

/** The cast flag, material and layer test that apply to a candidate: a virtual stand-in answers with its source. */
function casterOf(mesh: Mesh, virtual: { source: Mesh } | null | undefined): { casts: boolean; material: Material } {
  const from = virtual ? virtual.source : mesh;
  return { casts: from.castShadow, material: from.material as Material };
}

/** Layer of the batch meshes: drawn only by shadow cameras that enable it. */
export const SHADOW_BATCH_LAYER = 9;
/** World-space error of the cut a virtual member casts with (metres). */
export const SHADOW_ERROR_METRES = 0.1;
/** A cell whose members changed is rebuilt after this long without another change (ms). */
export const REBUILD_QUIET_MS = 400;
/** Largest batch (vertices); a bigger group is split. */
export const MAX_BATCH_VERTICES = 1 << 21;
/** Grid level the batches group at (1: 2x2 base cells). */
export const SHADOW_BATCH_LEVEL = 1;
/** Frames over which {@link CellShadowBatches.update} checks every member once while nothing changed. */
const CHECK_FRAMES = 4;
/** Fewest members worth a batch. */
const MIN_MEMBERS = 2;
/** A mesh evicted this many times for moving is left out until its content changes. */
const MAX_MOVES = 2;

/** A mesh the shadow pass draws today, offered for batching. */
export interface ShadowCandidate {
  mesh: Mesh;
  /** Owning entity (null: none known). */
  id: string | null;
  /** Virtual geometry: the cluster DAG and its full-detail source (positions). */
  virtual?: { dag: ClusterDag; source: Mesh };
}

type CasterMaterial = Material & {
  positionNode?: unknown; displacementMap?: unknown; alphaMap?: unknown; alphaHash?: boolean; alphaToCoverage?: boolean;
  transmission?: number; castShadowNode?: unknown; maskNode?: unknown; maskShadowNode?: unknown; wireframe?: boolean; shadowSide?: Side | null;
};

/**
 * A material whose depth-pass output is plain depth: no vertex displacement, no alpha that can discard, no coloured
 * transmission. Transparency alone does not matter (the depth pass writes depth either way).
 */
export function plainCasterMaterial(m: Material | Material[] | null | undefined): m is Material {
  if (!m || Array.isArray(m)) return false;
  const c = m as CasterMaterial;
  if (c.positionNode || c.displacementMap || c.alphaMap || c.alphaHash || c.alphaToCoverage || (c.transmission ?? 0) > 0) return false;
  if (c.castShadowNode || c.maskNode || c.maskShadowNode || c.wireframe || (c.alphaTest ?? 0) > 0) return false;
  return m.onBeforeCompile === MeshBasicMaterial.prototype.onBeforeCompile;
}

/** Whether a mesh's geometry and hooks let it join a batch (a plain indexed or non-indexed triangle mesh). */
export function plainCasterMesh(mesh: Mesh): boolean {
  const o = mesh as Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean; isBatchedMesh?: boolean };
  if (mesh.isMesh !== true || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh || mesh.type !== 'Mesh') return false;
  if (mesh.onBeforeShadow !== Mesh.prototype.onBeforeShadow || mesh.onAfterShadow !== Mesh.prototype.onAfterShadow) return false;
  if (mesh.customDepthMaterial || mesh.customDistanceMaterial) return false;
  const g = mesh.geometry;
  if (!g || !g.getAttribute('position') || Object.keys(g.morphAttributes).length > 0) return false;
  if ((g as BufferGeometry & { isInstancedBufferGeometry?: boolean }).isInstancedBufferGeometry) return false;
  return plainCasterMaterial(mesh.material as Material);
}

/** The side the depth pass draws a material with (three: `shadowSide`, else the opposite of a single side). */
export function shadowSideOf(m: Material): Side {
  const s = (m as CasterMaterial).shadowSide;
  if (s !== null && s !== undefined) return s;
  return m.side === FrontSide ? 1 : m.side === 1 ? FrontSide : 2;
}

interface Member {
  mesh: Mesh;
  id: string | null;
  geometry: BufferGeometry;
  material: Material;
  /** World matrix when batched. */
  world: Matrix4;
  virtual: { dag: ClusterDag; source: Mesh } | null;
  batch: Batch | null;
  /** First triangle and triangle count in the batch. */
  tri0: number;
  tris: number;
  evicted: boolean;
}

interface Batch {
  key: string;
  mesh: Mesh;
  members: Member[];
  /** Drew once in a shadow pass: its members are skipped from then on. */
  ready: boolean;
}

/** Output of {@link buildShadowGeometry}. */
export interface ShadowGeometry {
  positions: Float32Array;
  index: Uint16Array | Uint32Array;
  /** Triangle start of member `i` (length members + 1). */
  starts: Uint32Array;
}

const _m = new Matrix4();
const _sphere = new Sphere();
const _v = new Vector3();
const cutView: CutView = { cx: 0, cy: 1e7, cz: 0, pixelScale: 1, threshold: 1, planes: null, backface: false };

function readPosition(a: BufferAttribute | InterleavedBufferAttribute, i: number, out: Vector3): Vector3 {
  return out.set(a.getX(i), a.getY(i), a.getZ(i));
}

/** Cluster ids and their index list of a virtual member's fixed-error cut (object-space indices). */
function virtualIndices(dag: ClusterDag, scale: number, errorMetres: number): Uint32Array {
  // A camera 10^7 units away with the matching pixel scale: projected error ≈ object error / (error metres / scale).
  cutView.pixelScale = 1e7 / Math.max(1e-6, errorMetres / Math.max(1e-6, scale));
  const selected = new Uint32Array(Math.max(1, dag.count));
  const n = selectCut(dag, cutView, selected, createCutScratch(dag));
  let total = 0;
  for (let i = 0; i < n; i++) total += (dag.offsets[selected[i]! + 1] as number) - (dag.offsets[selected[i]!] as number);
  const out = new Uint32Array(total);
  let w = 0;
  for (let i = 0; i < n; i++) {
    const c = selected[i] as number;
    for (let k = dag.offsets[c] as number, end = dag.offsets[c + 1] as number; k < end; k++) out[w++] = dag.indices[k] as number;
  }
  return out;
}

/** Largest scale of a matrix's basis. */
function maxScale(m: Matrix4): number {
  const e = m.elements;
  return Math.sqrt(Math.max(e[0]! * e[0]! + e[1]! * e[1]! + e[2]! * e[2]!, e[4]! * e[4]! + e[5]! * e[5]! + e[6]! * e[6]!, e[8]! * e[8]! + e[9]! * e[9]! + e[10]! * e[10]!));
}

/**
 * Merge members' positions, transformed by `toBatch` × their world matrix, into one indexed geometry. A virtual member
 * contributes the vertices its fixed-error cut uses. Pure: inputs are not changed.
 */
export function buildShadowGeometry(
  members: ReadonlyArray<{ mesh: Mesh; world: Matrix4; virtual?: { dag: ClusterDag; source: Mesh } | null }>,
  toBatch: Matrix4,
  errorMetres = SHADOW_ERROR_METRES,
): ShadowGeometry {
  const parts: Array<{ positions: BufferAttribute | InterleavedBufferAttribute; indices: ArrayLike<number> | null; first: number; count: number; matrix: Matrix4 }> = [];
  let vertices = 0;
  let indexCount = 0;
  for (const m of members) {
    const matrix = new Matrix4().multiplyMatrices(toBatch, m.world);
    if (m.virtual) {
      const pos = m.virtual.source.geometry.getAttribute('position') as BufferAttribute;
      const idx = virtualIndices(m.virtual.dag, maxScale(m.world), errorMetres);
      parts.push({ positions: pos, indices: idx, first: 0, count: idx.length, matrix });
      indexCount += idx.length;
      vertices += Math.min(pos.count, idx.length);
      continue;
    }
    const g = m.mesh.geometry;
    const pos = g.getAttribute('position') as BufferAttribute | InterleavedBufferAttribute;
    const idx = g.index;
    const total = idx ? idx.count : pos.count;
    const first = Math.max(0, Math.min(total, g.drawRange.start));
    const count = Math.max(0, Math.min(total - first, Number.isFinite(g.drawRange.count) ? g.drawRange.count : total));
    const n = count - (count % 3);
    parts.push({ positions: pos, indices: idx ? (idx.array as ArrayLike<number>) : null, first, count: n, matrix });
    indexCount += n;
    vertices += idx ? pos.count : n;
  }
  const positions = new Float32Array(vertices * 3);
  const index = vertices > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  const starts = new Uint32Array(members.length + 1);
  let v = 0;
  let w = 0;
  for (let p = 0; p < parts.length; p++) {
    starts[p] = w / 3;
    const { positions: pos, indices, first, count, matrix } = parts[p]!;
    if (!indices) {
      // Non-indexed: copy the drawn vertices in order.
      for (let i = 0; i < count; i++) {
        readPosition(pos, first + i, _v).applyMatrix4(matrix);
        positions[(v + i) * 3] = _v.x; positions[(v + i) * 3 + 1] = _v.y; positions[(v + i) * 3 + 2] = _v.z;
        index[w++] = v + i;
      }
      v += count;
      continue;
    }
    const virtual = (members[p] as { virtual?: unknown }).virtual;
    if (!virtual) {
      // Indexed: every vertex (the drawn range normally uses all of them), indices offset.
      for (let i = 0; i < pos.count; i++) {
        readPosition(pos, i, _v).applyMatrix4(matrix);
        positions[(v + i) * 3] = _v.x; positions[(v + i) * 3 + 1] = _v.y; positions[(v + i) * 3 + 2] = _v.z;
      }
      for (let i = 0; i < count; i++) index[w++] = v + (indices[first + i] as number);
      v += pos.count;
      continue;
    }
    // A cut: only the vertices it uses, remapped.
    const remap = new Int32Array(pos.count).fill(-1);
    for (let i = 0; i < count; i++) {
      const src = indices[i] as number;
      let dst = remap[src] as number;
      if (dst < 0) {
        dst = v++;
        remap[src] = dst;
        readPosition(pos, src, _v).applyMatrix4(matrix);
        positions[dst * 3] = _v.x; positions[dst * 3 + 1] = _v.y; positions[dst * 3 + 2] = _v.z;
      }
      index[w++] = dst;
    }
  }
  starts[parts.length] = w / 3;
  return { positions: v * 3 === positions.length ? positions : positions.slice(0, v * 3), index, starts };
}

/** Binary search: the member whose triangle range holds `triangle` (-1: none). */
export function memberAt(starts: ArrayLike<number>, triangle: number): number {
  let lo = 0, hi = starts.length - 2;
  if (hi < 0 || triangle < (starts[0] as number) || triangle >= (starts[starts.length - 1] as number)) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= triangle) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function noRaycast(): void {
  // Members answer picking (they stay in the scene graph); see entityAt for hits on the batch itself.
}

/** Options of {@link CellShadowBatches}. */
export interface CellShadowOptions {
  /** Layer masks a member may have and stay batched (default: layer 0 only). */
  intactLayers?: readonly number[];
  /** A batch was published or a member evicted (a frame should be drawn). */
  changed?(): void;
  /** Clock (ms). */
  now?(): number;
  errorMetres?: number;
}

/** See the module docs. */
export class CellShadowBatches {
  private partition: CellPartition | null = null;
  private batches = new Map<string, Batch[]>();
  private readonly byMesh = new Map<Mesh, Member>();
  /** Members the depth pass skips (members of ready batches that were not evicted). */
  private readonly skip = new Set<Object3D>();
  private readonly materials = new Map<string, MeshBasicMaterial>();
  private readonly moves = new WeakMap<Mesh, { geometry: BufferGeometry; n: number }>();
  private readonly pinned = new Set<string>();
  private readonly intact: readonly number[];
  private readonly now: () => number;
  /** Cells waiting for a rebuild: key → time of their last change. */
  private readonly dirty = new Map<string, number>();
  /** Grouped candidates per cell key from the last {@link rebuild}. */
  private wanted = new Map<string, ShadowCandidate[]>();
  private readonly inverse = new Matrix4();
  /** Members of every batch, for the rotating check of {@link update}. */
  private flat: Member[] = [];
  private cursor = 0;
  /** Draws the batches save per shadow pass. */
  saved = 0;
  /** Pins were released: the owner should offer the candidates again ({@link rebuild}). */
  rescanNeeded = false;

  constructor(readonly root: Object3D, private readonly options: CellShadowOptions = {}) {
    this.intact = options.intactLayers ?? [1];
    this.now = options.now ?? (() => performance.now());
  }

  /** The grid in use (fixed by the first rebuild of a world; see {@link resetPartition}). */
  get grid(): CellPartition | null {
    return this.partition;
  }

  /** Use grid `p` (fixed per world by the owner); a change regroups everything. */
  setPartition(p: CellPartition): void {
    if (this.partition && this.partition.cellSize === p.cellSize && this.partition.origin[0] === p.origin[0] && this.partition.origin[1] === p.origin[1]) return;
    this.clear();
    this.partition = p;
    this.rescanNeeded = true;
  }

  /** Forget the grid (a new world): the next rebuild sizes it again. */
  resetPartition(): void {
    this.clear();
    this.partition = null;
  }

  /** Whether the depth pass skips `object` (a member of a ready batch). */
  skips(object: Object3D): boolean {
    return this.skip.has(object);
  }

  get count(): number {
    let n = 0;
    for (const list of this.batches.values()) n += list.length;
    return n;
  }

  get members(): number {
    return this.byMesh.size;
  }

  /** Cells waiting for a rebuild. */
  get pending(): number {
    return this.dirty.size;
  }

  /**
   * Group `candidates` by cell and side; cells whose members are unchanged keep their batch, the others are queued for
   * a rebuild (built by {@link pump}). Call after content changed.
   */
  rebuild(candidates: Iterable<ShadowCandidate>): void {
    const list: Array<{ c: ShadowCandidate; cx: number; cz: number; size: number }> = [];
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const c of candidates) {
      if (c.id !== null && this.pinned.has(c.id)) continue;
      const mv = this.moves.get(c.mesh);
      if (mv && mv.geometry === c.mesh.geometry && mv.n >= MAX_MOVES) continue;
      if (!this.attached(c.mesh)) continue;
      const g = (c.virtual?.source ?? c.mesh).geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (!g.boundingSphere) continue;
      _sphere.copy(g.boundingSphere).applyMatrix4(c.mesh.matrixWorld);
      if (!Number.isFinite(_sphere.radius) || _sphere.radius < 0) continue;
      list.push({ c, cx: _sphere.center.x, cz: _sphere.center.z, size: _sphere.radius * 2 });
      minX = Math.min(minX, _sphere.center.x - _sphere.radius); maxX = Math.max(maxX, _sphere.center.x + _sphere.radius);
      minZ = Math.min(minZ, _sphere.center.z - _sphere.radius); maxZ = Math.max(maxZ, _sphere.center.z + _sphere.radius);
    }
    if (!this.partition && list.length > 0) this.partition = partitionFor([minX, minZ], [maxX, maxZ]);
    const p = this.partition;
    const wanted = new Map<string, ShadowCandidate[]>();
    if (p) {
      for (const { c, cx, cz, size } of list) {
        const cell = assignCell(p, cx, cz, size);
        const material = casterOf(c.mesh, c.virtual).material;
        const key = `${cell === PERSISTENT_CELL ? cell : ancestorCell(cell, SHADOW_BATCH_LEVEL)}|${shadowSideOf(material)}`;
        let group = wanted.get(key);
        if (!group) wanted.set(key, (group = []));
        group.push(c);
      }
    }
    this.wanted = wanted;
    const t = this.now();
    for (const [key, group] of wanted) {
      const have = this.batches.get(key);
      if (have && sameMembers(have, group)) continue;
      // Already queued: keep its time (a rebuild after an edit still waits for quiet).
      if (!this.dirty.has(key)) this.dirty.set(key, have ? t : t - REBUILD_QUIET_MS);
    }
    for (const key of this.batches.keys()) if (!wanted.has(key)) this.dirty.set(key, t - REBUILD_QUIET_MS);
  }

  /**
   * Build queued cells until `budgetMs` is spent (at least one per call when any is due). Returns true when a batch was
   * published or removed.
   */
  pump(budgetMs: number): boolean {
    if (this.dirty.size === 0) return false;
    const t0 = this.now();
    let changed = false;
    for (const [key, at] of this.dirty) {
      if (t0 - at < REBUILD_QUIET_MS) continue;
      this.dirty.delete(key);
      this.buildCell(key);
      changed = true;
      if (this.now() - t0 >= budgetMs) break;
    }
    if (changed) { this.recount(); this.options.changed?.(); }
    return changed;
  }

  /** Build everything queued now (captures, tests). */
  flush(): boolean {
    let changed = false;
    for (const key of [...this.dirty.keys()]) { this.dirty.delete(key); this.buildCell(key); changed = true; }
    if (changed) { this.recount(); this.options.changed?.(); }
    return changed;
  }

  /**
   * Check batched members (call each frame after world matrices are current; `full`: all of them, else a rotating share):
   * a member that moved, changed or was hidden is evicted and casts by itself again. Allocation-free unless something
   * changed. True when a member was evicted.
   */
  update(full = false): boolean {
    const flat = this.flat;
    const n = flat.length;
    if (n === 0) return false;
    // A slice per frame (every member every CHECK_FRAMES frames); everything after a content change or for a capture.
    const count = full ? n : Math.min(n, Math.max(64, Math.ceil(n / CHECK_FRAMES)));
    let changed = false;
    let i = this.cursor % n;
    for (let k = 0; k < count; k++, i = i + 1 === n ? 0 : i + 1) {
      const m = flat[i] as Member;
      if (m.evicted || this.memberIntact(m)) continue;
      if (m.geometry === m.mesh.geometry && !m.world.equals(m.mesh.matrixWorld)) {
        const mv = this.moves.get(m.mesh);
        if (mv && mv.geometry === m.geometry) mv.n++;
        else this.moves.set(m.mesh, { geometry: m.geometry, n: 1 });
      }
      this.evict(m);
      changed = true;
    }
    this.cursor = i;
    if (changed) this.options.changed?.();
    return changed;
  }

  /** Keep entities `ids` out of the batches (selected, being edited); the others rejoin at their cell's next rebuild. */
  pin(ids: Iterable<string>): void {
    const next = new Set(ids);
    for (const id of this.pinned) if (!next.has(id)) this.rescanNeeded = true;
    this.pinned.clear();
    for (const id of next) this.pinned.add(id);
    if (next.size === 0) return;
    let changed = false;
    for (const m of this.byMesh.values()) if (!m.evicted && m.id !== null && next.has(m.id)) { this.evict(m); changed = true; }
    if (changed) this.options.changed?.();
  }

  /** Entity that cast triangle `triangle` of batch mesh `mesh` (null: not a batch, or an evicted range). */
  entityAt(mesh: Object3D, triangle: number): string | null {
    const starts = (mesh.userData as { aetherShadowStarts?: Uint32Array }).aetherShadowStarts;
    const ids = (mesh.userData as { aetherShadowIds?: Array<string | null> }).aetherShadowIds;
    if (!starts || !ids) return null;
    const i = memberAt(starts, triangle);
    if (i < 0) return null;
    const m = this.byMesh.get((mesh.userData as { aetherShadowMeshes: Mesh[] }).aetherShadowMeshes[i]!);
    return m && !m.evicted ? (ids[i] ?? null) : null;
  }

  /** Drop every batch (members cast by themselves again). */
  clear(): void {
    for (const list of this.batches.values()) for (const b of list) this.release(b);
    this.batches.clear();
    this.byMesh.clear();
    this.skip.clear();
    this.dirty.clear();
    this.wanted.clear();
    this.flat = [];
    this.saved = 0;
  }

  dispose(): void {
    this.clear();
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }

  private attached(mesh: Mesh): boolean {
    for (let o: Object3D | null = mesh; o; o = o.parent) {
      if (o === this.root) return true;
      if (!o.visible && !(o === mesh && mesh.name.endsWith(':virtual'))) return false;
    }
    return false;
  }

  /** A layer mask a member may have: drawn, culled by distance, or (a virtual stand-in) drawn by a view batch. */
  private layerOk(mask: number, virtual: boolean): boolean {
    return this.intact.includes(mask) || (virtual && mask === 1 << BATCHED_LAYER);
  }

  private memberIntact(m: Member): boolean {
    const mesh = m.mesh;
    const c = casterOf(mesh, m.virtual);
    if (mesh.geometry !== m.geometry || c.material !== m.material || !c.casts) return false;
    if (!this.layerOk(mesh.layers.mask, m.virtual !== null)) return false;
    if (!m.world.equals(mesh.matrixWorld)) return false;
    if (m.virtual && (m.virtual.source.parent !== mesh.parent)) return false;
    return this.attached(mesh);
  }

  private evict(m: Member): void {
    m.evicted = true;
    this.skip.delete(m.mesh);
    const b = m.batch;
    if (!b) return;
    const index = b.mesh.geometry.index;
    if (index && m.tris > 0) {
      const a = index.array as Uint16Array | Uint32Array;
      a.fill(0, m.tri0 * 3, (m.tri0 + m.tris) * 3);
      index.addUpdateRange(m.tri0 * 3, m.tris * 3);
      index.needsUpdate = true;
    }
    if (!this.dirty.has(b.key)) this.dirty.set(b.key, this.now());
    else this.dirty.set(b.key, this.now());
  }

  private materialFor(source: Material): MeshBasicMaterial {
    const shadowSide = (source as CasterMaterial).shadowSide ?? null;
    const key = `${source.side}|${shadowSide}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new MeshBasicMaterial({ side: source.side, colorWrite: false });
      m.shadowSide = shadowSide;
      m.name = 'aether:shadow-batch';
      this.materials.set(key, m);
    }
    return m;
  }

  private buildCell(key: string): void {
    const old = this.batches.get(key) ?? [];
    for (const b of old) this.release(b);
    this.batches.delete(key);
    const group = (this.wanted.get(key) ?? []).filter((c) => this.candidateCurrent(c));
    if (group.length < MIN_MEMBERS) return;
    this.root.updateWorldMatrix(true, false);
    this.inverse.copy(this.root.matrixWorld).invert();
    const out: Batch[] = [];
    let chunk: ShadowCandidate[] = [];
    let vertices = 0;
    const flush = (): void => {
      if (chunk.length >= MIN_MEMBERS) out.push(this.createBatch(key, chunk));
      chunk = []; vertices = 0;
    };
    for (const c of group) {
      const n = c.virtual ? c.virtual.dag.vertexCount : c.mesh.geometry.getAttribute('position').count;
      if (chunk.length > 0 && vertices + n > MAX_BATCH_VERTICES) flush();
      chunk.push(c); vertices += n;
    }
    flush();
    if (out.length > 0) this.batches.set(key, out);
  }

  private candidateCurrent(c: ShadowCandidate): boolean {
    if (c.id !== null && this.pinned.has(c.id)) return false;
    const mesh = c.mesh;
    const cast = casterOf(mesh, c.virtual);
    if (!cast.casts || !this.layerOk(mesh.layers.mask, c.virtual !== undefined) || !plainCasterMaterial(cast.material)) return false;
    if (c.virtual && c.virtual.source.parent !== mesh.parent) return false;
    const mv = this.moves.get(mesh);
    if (mv && mv.geometry === mesh.geometry && mv.n >= MAX_MOVES) return false;
    return this.attached(mesh);
  }

  private createBatch(key: string, group: readonly ShadowCandidate[]): Batch {
    const members: Member[] = group.map((c) => ({
      mesh: c.mesh, id: c.id, geometry: c.mesh.geometry, material: casterOf(c.mesh, c.virtual).material, world: c.mesh.matrixWorld.clone(),
      virtual: c.virtual ?? null, batch: null, tri0: 0, tris: 0, evicted: false,
    }));
    const built = buildShadowGeometry(members, this.inverse, this.options.errorMetres ?? SHADOW_ERROR_METRES);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(built.positions, 3));
    geometry.setIndex(new BufferAttribute(built.index, 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    const mesh = new Mesh(geometry, this.materialFor(members[0]!.material));
    mesh.name = `aether:cell-shadow#${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.layers.set(SHADOW_BATCH_LAYER);
    mesh.raycast = noRaycast;
    mesh.userData['aetherShadowStarts'] = built.starts;
    mesh.userData['aetherShadowIds'] = members.map((m) => m.id);
    mesh.userData['aetherShadowMeshes'] = members.map((m) => m.mesh);
    const batch: Batch = { key, mesh, members, ready: false };
    // Take over the members once the batch has drawn in a shadow pass (its pipeline was ready).
    let before = -1;
    mesh.onBeforeShadow = (renderer) => { before = drawCalls(renderer); };
    mesh.onAfterShadow = (renderer) => {
      if (batch.ready || before < 0 || drawCalls(renderer) <= before) return;
      this.takeOver(batch);
    };
    for (let i = 0; i < members.length; i++) {
      const m = members[i]!;
      // A mesh can be in one batch only; an older batch's claim was released with it.
      this.byMesh.set(m.mesh, m);
      m.batch = batch;
      m.tri0 = built.starts[i]!;
      m.tris = built.starts[i + 1]! - built.starts[i]!;
    }
    this.root.add(mesh);
    mesh.updateMatrixWorld(true);
    return batch;
  }

  /** Mark a batch ready: its intact members are skipped by the depth pass from now on. */
  takeOver(batch: Batch | Mesh): void {
    const b = batch instanceof Mesh ? this.batchOf(batch) : batch;
    if (!b || b.ready) return;
    b.ready = true;
    for (const m of b.members) if (!m.evicted) this.skip.add(m.mesh);
  }

  private batchOf(mesh: Mesh): Batch | null {
    for (const list of this.batches.values()) for (const b of list) if (b.mesh === mesh) return b;
    return null;
  }

  private release(b: Batch): void {
    for (const m of b.members) {
      this.skip.delete(m.mesh);
      if (this.byMesh.get(m.mesh) === m) this.byMesh.delete(m.mesh);
    }
    b.mesh.removeFromParent();
    b.mesh.geometry.dispose();
  }

  private recount(): void {
    let saved = 0;
    const flat: Member[] = [];
    for (const list of this.batches.values()) for (const b of list) { saved += b.members.length - 1; for (const m of b.members) flat.push(m); }
    this.saved = saved;
    this.flat = flat;
  }

  /** Every batch mesh (diagnostics, tests). */
  *meshes(): IterableIterator<Mesh> {
    for (const list of this.batches.values()) for (const b of list) yield b.mesh;
  }
}

function drawCalls(renderer: unknown): number {
  return (renderer as { info?: { render?: { drawCalls?: number } } }).info?.render?.drawCalls ?? -1;
}

function sameMembers(have: readonly Batch[], group: readonly ShadowCandidate[]): boolean {
  let n = 0;
  for (const b of have) {
    for (const m of b.members) {
      const c = group[n++];
      if (!c || m.evicted || c.mesh !== m.mesh || m.geometry !== c.mesh.geometry || m.material !== casterOf(c.mesh, c.virtual).material || !m.world.equals(c.mesh.matrixWorld)) return false;
    }
  }
  return n === group.length;
}

/**
 * Make the renderer's shadow passes skip objects for which `skip(object, camera)` holds. three's ShadowNode installs a
 * render-object function for its pass; that function is wrapped (once per function) to test first.
 */
export function installShadowSkip(renderer: unknown, skip: (object: Object3D, camera: Camera) => boolean): void {
  type Fn = ((object: Object3D, scene: unknown, camera: Camera, geometry: unknown, material: unknown, group: unknown, lights: unknown, clipping: unknown, passId: unknown) => void) & { __aetherSkip?: boolean };
  const r = renderer as { setRenderObjectFunction?: (fn: Fn | null) => void; __aetherShadowSkip?: boolean };
  const set = r.setRenderObjectFunction;
  if (typeof set !== 'function' || r.__aetherShadowSkip) return;
  r.__aetherShadowSkip = true;
  const wrapped = new WeakMap<Fn, Fn>();
  r.setRenderObjectFunction = function (this: unknown, fn: Fn | null): void {
    if (fn && !fn.__aetherSkip) {
      let w = wrapped.get(fn);
      if (!w) {
        const inner = fn;
        // Fixed parameters: no rest array per drawn caster.
        w = function (this: unknown, object: Object3D, scene: unknown, camera: Camera, geometry: unknown, material: unknown, group: unknown, lights: unknown, clipping: unknown, passId: unknown): void {
          if (skip(object, camera)) return;
          inner.call(this, object, scene, camera, geometry, material, group, lights, clipping, passId);
        } as Fn;
        w.__aetherSkip = true;
        wrapped.set(fn, w);
      }
      fn = w;
    }
    set.call(this, fn);
  };
}

/** The skip test for cameras that draw the batches: they enable {@link SHADOW_BATCH_LAYER}. */
export function shadowSkipTest(batches: () => CellShadowBatches | null): (object: Object3D, camera: Camera) => boolean {
  const mask = 1 << SHADOW_BATCH_LAYER;
  return (object, camera) => (camera.layers.mask & mask) !== 0 && batches()?.skips(object) === true;
}
