/** Transform-updatable opaque material batches. Originals retain picking, editing, physics and animation ownership. */
import { BatchedMesh, LessEqualDepth, Material, Matrix4, Mesh, NoBlending, NormalBlending, StaticDrawUsage, type BufferAttribute, type BufferGeometry, type Object3D } from 'three';
import { invalidateDrawBatch, registerDrawBatch, seedMeshVelocity, unregisterDrawBatch } from '../gpu/batch-draws';
import { BATCHED_LAYER } from './static-batches';

type BatchMaterial = Material & { positionNode?: unknown; displacementMap?: unknown; wireframe?: boolean; transmission?: number; isNodeMaterial?: boolean };

/** Native batching normal transforms require orthogonal, positive-scale instance bases. */
export function batchTransformSupported(matrix: Matrix4): boolean {
  const e = matrix.elements;
  for (let i = 0; i < 16; i++) if (!Number.isFinite(e[i])) return false;
  if (e[3] !== 0 || e[7] !== 0 || e[11] !== 0 || e[15] !== 1) return false;
  const x = e[0]!, y = e[1]!, z = e[2]!, a = e[4]!, b = e[5]!, c = e[6]!, p = e[8]!, q = e[9]!, r = e[10]!;
  const xx = x*x+y*y+z*z, yy = a*a+b*b+c*c, zz = p*p+q*q+r*r;
  if (!(xx > 0 && yy > 0 && zz > 0) || !Number.isFinite(xx*yy*zz)) return false;
  if (x*(b*r-c*q)-a*(y*r-z*q)+p*(y*c-z*b) <= 0) return false;
  const xy = x*a+y*b+z*c, xz = x*p+y*q+z*r, yz = a*p+b*q+c*r;
  return xy*xy <= 1e-20*xx*yy && xz*xz <= 1e-20*xx*zz && yz*yz <= 1e-20*yy*zz;
}
interface GeometryState {
  geometry: BufferGeometry;
  index: BufferAttribute | null;
  indexVersion: number;
  sphere: BufferGeometry['boundingSphere'];
  attributes: Array<{ name: string; attribute: BufferAttribute; version: number; array: BufferAttribute['array']; count: number; itemSize: number; normalized: boolean }>;
  valid: boolean;
  users: number;
}

function snapshotGeometry(geometry: BufferGeometry): GeometryState {
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  return { geometry, index: geometry.index, indexVersion: geometry.index?.version ?? 0, sphere: geometry.boundingSphere?.clone() ?? null,
    attributes: Object.keys(geometry.attributes).map(name => { const attribute = geometry.attributes[name] as BufferAttribute; return { name, attribute, version: attribute.version, array: attribute.array, count: attribute.count, itemSize: attribute.itemSize, normalized: attribute.normalized }; }), valid: true, users: 0 };
}

function geometryIntact(state: GeometryState): boolean {
  const g = state.geometry;
  if (!state.valid || g.index !== state.index || (g.index?.version ?? 0) !== state.indexVersion || g.drawRange.start !== 0 || Number.isFinite(g.drawRange.count)) return false;
  if (!!g.boundingSphere !== !!state.sphere || (g.boundingSphere && state.sphere && !g.boundingSphere.equals(state.sphere))) return false;
  let count = 0; for (const key in g.attributes) count++;
  if (count !== state.attributes.length) return false;
  for (const a of state.attributes) if (g.attributes[a.name] !== a.attribute || a.attribute.version !== a.version || a.attribute.array !== a.array || a.attribute.count !== a.count || a.attribute.itemSize !== a.itemSize || a.attribute.normalized !== a.normalized) return false;
  for (const key in g.morphAttributes) return false;
  return true;
}

const materialGraphs = new WeakMap<Material, { version: number; supported: boolean }>();
function materialSupported(m: BatchMaterial): boolean {
  let graph = materialGraphs.get(m);
  if (!graph || graph.version !== m.version) {
    const fields = m as unknown as Record<string, unknown>;
    graph = { version: m.version, supported: !Object.keys(m).some(key => key.endsWith('Node') && fields[key] != null) };
    materialGraphs.set(m, graph);
  }
  return graph.supported && !m.transparent && m.opacity === 1 && !m.positionNode && !m.displacementMap && !m.wireframe && !m.isNodeMaterial && !(m.transmission ?? 0)
    && m.depthWrite && m.depthTest && m.depthFunc === LessEqualDepth && (m.blending === NormalBlending || m.blending === NoBlending)
    && m.onBeforeCompile === Material.prototype.onBeforeCompile && m.onBeforeRender === Material.prototype.onBeforeRender;
}

interface Member { source: Mesh; geometry: BufferGeometry; geometryState: GeometryState; world: Matrix4; visible: boolean; index: number; frustumCulled: boolean; owned: boolean; evicted: boolean; unlocked: boolean }
interface Batch { ready: boolean; key: string; mesh: BatchedMesh; members: Member[]; material: Material; geometries: GeometryState[]; bytes: number }

/** Geometry copies must remain valid and per-object shader inputs must be native. */
export function drawBatchKey(mesh: Mesh, root?: Object3D): string | null {
  const m = mesh.material as BatchMaterial, g = mesh.geometry;
  if (('isInstancedMesh' in mesh && mesh.isInstancedMesh) || ('isBatchedMesh' in mesh && mesh.isBatchedMesh) || ('isSkinnedMesh' in mesh && mesh.isSkinnedMesh) || ('isInstancedBufferGeometry' in g && g.isInstancedBufferGeometry)) return null;
  if (mesh.type !== 'Mesh' || Array.isArray(m) || !materialSupported(m)) return null;
  if (mesh.onBeforeRender !== Mesh.prototype.onBeforeRender || mesh.onAfterRender !== Mesh.prototype.onAfterRender || mesh.onBeforeShadow !== Mesh.prototype.onBeforeShadow || mesh.onAfterShadow !== Mesh.prototype.onAfterShadow) return null;
  if (mesh.customDepthMaterial || mesh.customDistanceMaterial) return null;
  if (!mesh.visible) return null;
  for (let parent = mesh.parent; parent; parent = parent.parent) {
    if (!parent.visible || parent.renderOrder !== 0) return null;
    if (parent === root) break;
    if ('isClippingGroup' in parent && parent.isClippingGroup) return null;
  }
  if (mesh.layers.mask !== 1 || !batchTransformSupported(mesh.matrixWorld) || g.drawRange.start !== 0 || Number.isFinite(g.drawRange.count)) return null;
  if (Object.keys(g.morphAttributes).length || g.attributes.position?.itemSize !== 3 || g.attributes.normal?.itemSize !== 3) return null;
  const attrs = Object.keys(g.attributes).sort();
  if (attrs.some(k => !['position','normal','uv','color','tangent'].includes(k))) return null;
  const signature: string[] = [];
  for (const name of attrs) {
    const a = g.attributes[name]!;
    if (!('usage' in a) || a.usage !== StaticDrawUsage || ('isInstancedBufferAttribute' in a && a.isInstancedBufferAttribute) || 'isInterleavedBufferAttribute' in a) return null;
    signature.push(`${name}:${a.itemSize}:${a.normalized}:${a.gpuType}:${a.array.constructor.name}`);
  }
  return `${m.uuid}|${+mesh.castShadow}${+mesh.receiveShadow}|${mesh.renderOrder}|${mesh.frustumCulled}|${!!g.index}|${signature.join(',')}`;
}

export const MIN_DRAW_BATCH = 4;
export const MAX_DRAW_BATCH_VERTICES = 400_000;
export const MAX_DRAW_BATCH_MEMBERS = 4096;
const CELL = 160;
const DEFAULT_BYTES = 32 * 1024 * 1024;
const noop = (): void => {};

interface Plan { key: string; members: Mesh[]; geometries: BufferGeometry[]; vertices: number; indices: number; bytes: number }

function plan(key: string, members: Mesh[], geometries: Set<BufferGeometry>, vertices: number, indices: number): Plan {
  let bytes = indices * (vertices > 65535 ? 4 : 2);
  for (const geometry of geometries) for (const name in geometry.attributes) bytes += geometry.attributes[name]!.array.byteLength;
  const side = Math.max(4, Math.ceil(Math.sqrt(members.length * 4) / 4) * 4);
  // Current and previous matrices, indirect texture and two draw lists. Geometry GPU/CPU copies are counted below.
  bytes = bytes * 2 + side * side * 16 * 4 + Math.ceil(Math.sqrt(members.length)) ** 2 * 8 + members.length * 8;
  return { key, members, geometries: [...geometries], vertices, indices, bytes };
}

function partitions(key: string, meshes: Mesh[]): Plan[] {
  const out: Plan[] = [];
  let members: Mesh[] = [], geometries = new Set<BufferGeometry>(), vertices = 0, indices = 0;
  const flush = (): void => {
    if (members.length >= MIN_DRAW_BATCH) out.push(plan(key, members, geometries, vertices, indices));
    members = []; geometries = new Set(); vertices = 0; indices = 0;
  };
  for (const mesh of meshes) {
    const g = mesh.geometry, n = g.attributes.position!.count;
    if (n > MAX_DRAW_BATCH_VERTICES) continue;
    const added = !geometries.has(g);
    if (members.length === MAX_DRAW_BATCH_MEMBERS || (added && vertices + n > MAX_DRAW_BATCH_VERTICES)) flush();
    if (!geometries.has(g)) { geometries.add(g); vertices += n; indices += g.index?.count ?? 0; }
    members.push(mesh);
  }
  flush();
  return out;
}

/** Render-only multi-draw ownership. New groups warm while originals draw; stable groups survive content edits. */
export class DrawBatches {
  readonly batches: Batch[] = [];
  private readonly geometries = new Map<BufferGeometry, GeometryState>();
  private readonly inverse = new Matrix4();
  private readonly relative = new Matrix4();
  private readonly rootWorld = new Matrix4();
  private regroupOpen = false;
  private used = 0;
  private saved = 0;

  constructor(readonly root: Object3D, readonly maxBytes = DEFAULT_BYTES) {
    this.rootWorld.elements.fill(NaN);
  }
  get count(): number { return this.batches.length; }
  get bytes(): number { return this.used; }
  get drawCallsSaved(): number { return this.saved; }

  /** Temporarily return our sources to the candidate layer before the other batching systems elect their members. */
  prepareRegroup(): void {
    if (this.regroupOpen) return;
    this.regroupOpen = true;
    for (const batch of this.batches) for (const member of batch.members) {
      if (member.owned && member.source.layers.mask === (1 << BATCHED_LAYER)) {
        seedMeshVelocity(member.source, member.world);
        member.source.layers.set(0); member.unlocked = true; member.owned = false;
      }
    }
  }

  /** Sources claimed by static instancing/merging keep their layer and never enter these groups. */
  rebuild(sources: Iterable<Mesh>): boolean {
    this.prepareRegroup();
    this.inverse.copy(this.root.matrixWorld).invert();
    const groups = new Map<string, Mesh[]>(), seen = new Set<Mesh>();
    for (const source of sources) {
      if (seen.has(source)) continue;
      seen.add(source);
      const key = drawBatchKey(source, this.root);
      if (key === null) continue;
      let attached = false;
      for (let parent = source.parent; parent; parent = parent.parent) if (parent === this.root) { attached = true; break; }
      if (!attached) continue;
      this.relative.multiplyMatrices(this.inverse, source.matrixWorld);
      if (!batchTransformSupported(this.relative)) continue;
      const e = source.matrixWorld.elements;
      const cell = `${Math.floor((e[12]! + CELL/2) / CELL)},${Math.floor((e[14]! + CELL/2) / CELL)}`;
      const groupKey = `${key}|${cell}`;
      let group = groups.get(groupKey);
      if (!group) { group = []; groups.set(groupKey, group); }
      group.push(source);
    }
    const desired: Plan[] = [];
    for (const [key, meshes] of groups) desired.push(...partitions(key, meshes));
    const byFirst = new Map<Mesh, Batch>();
    for (const batch of this.batches) byFirst.set(batch.members[0]!.source, batch);
    const keep = new Set<Batch>(), create: Plan[] = [];
    let budget = 0;
    for (const p of desired) {
      const previous = byFirst.get(p.members[0]!);
      if (budget + p.bytes > this.maxBytes) continue;
      budget += p.bytes;
      if (previous && previous.key === p.key && previous.members.length === p.members.length && previous.members.every((m, i) => !m.evicted && m.source === p.members[i] && m.source.geometry === m.geometry && geometryIntact(m.geometryState))) keep.add(previous);
      else create.push(p);
    }
    let changed = false;
    for (let i = this.batches.length - 1; i >= 0; i--) if (!keep.has(this.batches[i]!)) {
      this.release(this.batches[i]!); this.batches.splice(i, 1); changed = true;
    }
    for (const batch of keep) for (const member of batch.members) {
      // No draw occurs between prepareRegroup and this election.
      if (batch.ready) { member.source.layers.set(BATCHED_LAYER); member.owned = true; }
      member.unlocked = false;
    }
    for (const p of create) { this.create(p); changed = true; }
    this.regroupOpen = false;
    return this.update() || changed;
  }

  private create(p: Plan): void {
    const first = p.members[0]!, material = first.material as Material;
    const mesh = new BatchedMesh(p.members.length, p.vertices, p.indices, material);
    mesh.name = 'aether:draw-batch'; mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder; mesh.frustumCulled = first.frustumCulled; mesh.perObjectFrustumCulled = first.frustumCulled;
    mesh.sortObjects = false; mesh.matrixAutoUpdate = false; mesh.onBeforeRender = noop; mesh.onBeforeShadow = noop; mesh.raycast = noop;
    const ids = new Map<BufferGeometry, number>(), states: GeometryState[] = [];
    for (const geometry of p.geometries) {
      let state = this.geometries.get(geometry);
      if (!state || !geometryIntact(state)) { state = snapshotGeometry(geometry); this.geometries.set(geometry, state); }
      state.users++; states.push(state); ids.set(geometry, mesh.addGeometry(geometry));
    }
    const batch: Batch = { key: p.key, mesh, members: [], material, geometries: states, bytes: p.bytes, ready: false };
    registerDrawBatch(mesh, () => { batch.ready = true; });
    this.inverse.copy(this.root.matrixWorld).invert();
    for (const source of p.members) {
      const index = mesh.addInstance(ids.get(source.geometry)!);
      this.relative.multiplyMatrices(this.inverse, source.matrixWorld);
      mesh.setMatrixAt(index, this.relative); mesh.setVisibleAt(index, false);
      batch.members.push({ source, geometry: source.geometry, geometryState: this.geometries.get(source.geometry)!, world: source.matrixWorld.clone(), visible: false, owned: false, evicted: false, unlocked: false, index, frustumCulled: source.frustumCulled });
    }
    // Empty groups still run node updates while warming, but their originals remain the only visible geometry.
    this.root.add(mesh); mesh.updateMatrixWorld(true);
    if (mesh.frustumCulled) mesh.computeBoundingSphere();
    this.batches.push(batch); this.used += p.bytes;
  }

  update(): boolean {
    let changed = false, saved = 0;
    let empty: Batch[] | undefined;
    const rootChanged = !this.rootWorld.equals(this.root.matrixWorld);
    if (rootChanged) { this.inverse.copy(this.root.matrixWorld).invert(); this.rootWorld.copy(this.root.matrixWorld); }
    for (const state of this.geometries.values()) state.valid = geometryIntact(state);
    for (const batch of this.batches) {
      const material = batch.material as BatchMaterial;
      const materialIntact = materialSupported(material);
      let visible = 0, active = 0, boundsChanged = false, batchChanged = false;
      for (const member of batch.members) {
        if (member.evicted) continue;
        const source = member.source;
        let attached = false, shown = true, ordered = false;
        for (let parent: Object3D | null = source; parent; parent = parent.parent) {
          if (parent === this.root) { attached = true; break; }
          if (!parent.visible) shown = false;
          if (parent !== source && parent.renderOrder !== 0) ordered = true;
        }
        let intact = attached && !ordered && materialIntact && member.geometryState.valid && source.geometry === member.geometry && source.material === batch.material && source.castShadow === batch.mesh.castShadow && source.receiveShadow === batch.mesh.receiveShadow && source.renderOrder === batch.mesh.renderOrder && source.frustumCulled === member.frustumCulled
          && source.onBeforeRender === Mesh.prototype.onBeforeRender && source.onAfterRender === Mesh.prototype.onAfterRender && source.onBeforeShadow === Mesh.prototype.onBeforeShadow && source.onAfterShadow === Mesh.prototype.onAfterShadow && !source.customDepthMaterial && !source.customDistanceMaterial
          && source.layers.mask === (member.owned ? 1 << BATCHED_LAYER : 1);
        const moved = rootChanged || !member.world.equals(source.matrixWorld);
        if (intact && moved) { this.relative.multiplyMatrices(this.inverse, source.matrixWorld); intact = batchTransformSupported(this.relative); }
        if (!intact) {
          if (member.owned && source.layers.mask === (1 << BATCHED_LAYER)) { seedMeshVelocity(source, member.world); source.layers.set(0); }
          member.evicted = true; member.owned = false; member.visible = false;
          batch.mesh.deleteInstance(member.index); batchChanged = boundsChanged = true; continue;
        }
        active++;
        if (!batch.ready) {
          // Keep the hidden instance current while native originals warm its programs/history.
          if (moved) { batch.mesh.setMatrixAt(member.index, this.relative); member.world.copy(source.matrixWorld); boundsChanged = batchChanged = true; }
          continue;
        }
        if (!member.owned) { source.layers.set(BATCHED_LAYER); member.owned = true; batchChanged = true; }
        if (shown !== member.visible) { batch.mesh.setVisibleAt(member.index, shown); member.visible = shown; batchChanged = true; }
        if (shown) {
          visible++;
          if (moved) { batch.mesh.setMatrixAt(member.index, this.relative); member.world.copy(source.matrixWorld); batchChanged = boundsChanged = true; }
        }
      }
      const draw = !batch.ready || visible > 0;
      if (batch.mesh.visible !== draw) { batch.mesh.visible = draw; batchChanged = true; }
      if (boundsChanged && batch.mesh.frustumCulled) batch.mesh.computeBoundingSphere();
      if (batchChanged) invalidateDrawBatch(batch.mesh);
      if (active === 0) (empty ??= []).push(batch);
      changed ||= batchChanged;
      if (batch.ready) saved += Math.max(0, active - 1);
    }
    for (const batch of empty ?? []) { this.release(batch); this.batches.splice(this.batches.indexOf(batch), 1); }
    this.saved = saved;
    return changed;
  }

  private release(batch: Batch): void {
    for (const member of batch.members) if (member.owned && !member.unlocked && member.source.layers.mask === (1 << BATCHED_LAYER)) {
      seedMeshVelocity(member.source, member.world); member.source.layers.set(0);
    }
    unregisterDrawBatch(batch.mesh); batch.mesh.removeFromParent(); batch.mesh.dispose(); this.used -= batch.bytes;
    for (const state of batch.geometries) if (--state.users === 0 && this.geometries.get(state.geometry) === state) this.geometries.delete(state.geometry);
  }
  clear(): void {
    for (const batch of this.batches) this.release(batch);
    this.batches.length = 0; this.geometries.clear(); this.used = 0; this.saved = 0; this.regroupOpen = false;
  }
}
