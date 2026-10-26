/**
 * Static merging of building parts: the unique, static meshes of a
 * parametric building (walls, floors, ceilings, windows, furniture … —
 * entities with `arch` metadata) that share a material are merged into one
 * mesh per material under their storey, so a furnished apartment draws a few
 * dozen meshes instead of several hundred (and the shadow pass likewise).
 * Unique static procedural props of the world (a backdrop of towers, planters,
 * boulders) merge the same way per cell of {@link PROP_CELL} metres.
 *
 * Like {@link StaticBatches} it is a render-only layer over the scene graph:
 * every entity keeps its own meshes, moved to {@link BATCHED_LAYER} (raycast,
 * never drawn), so picking, selection boxes, bounds, physics and overrides
 * work unchanged. The merged copy lives in the storey's object (parent of the
 * members' entities), so exploded and single-storey views move and hide it.
 *
 * Members that change — moved, re-materialised (x-ray), rebuilt (a sectioned
 * wall, a lamp switched off), hidden by a view, removed — are evicted: they
 * draw themselves again and their group is re-merged without them on the next
 * {@link update}. Intact, visible members rejoin on the next {@link rebuild}
 * (content change).
 * Merged geometry is owned here and disposed on regroup / clear; member
 * geometry and materials belong to the shared caches.
 */
import { mergeGeometries } from './merge-geometries';
export { mergeGeometries } from './merge-geometries';
import { BufferGeometry, Matrix4, Mesh, type Material, type Object3D } from 'three';
import type { EntityNode } from './entity-node';
import { concatMemberUv, expandWithLightmap, refreshProgram, type LightmapSource } from './lightmap-uv';
import { BATCHED_LAYER } from './static-batches';
import { MergeBuildClient, type MergeJob } from './merge-client';
import { mergeGeometryStamp, mergeRequest, type MergeRequest } from './merge-wire';
import { errorMessage, log } from '../log';

/** Edge (m) of the cells that world props (entities without `arch`) are merged in: a merged mesh is culled as a whole, so it stays local. */
export const PROP_CELL = 160;

/** Smallest group worth merging (fewer meshes draw as they are). */
export const MIN_MERGE = 3;
/** Largest merged mesh (vertices); bigger groups split into several meshes. */
export const MAX_MERGE_VERTICES = 400_000;
/** Most parts a merged entity may have (bigger compound shapes stay as they are). */
const MAX_PARTS = 32;

/** A node whose meshes may be merged: a static, untouched part of a building. */
export function mergeable(node: Readonly<EntityNode>): boolean {
  if (node.transient || node.placeholder || node.pending || node.failed || node.overridden || node.instances > 0) return false;
  if (node.virtual.length > 0 || node.field) return false;
  const e = node.entity;
  if (e.template || e.visible === false || e.shape.kind !== 'procedural') return false;
  if (e.behaviors.length > 0) return false;
  if (e.physics && e.physics.body !== 'static') return false;
  if (node.bindings.length === 0 || node.bindings.length > MAX_PARTS || node.geometryKeys.length !== node.bindings.length) return false;
  return true;
}

/** A mesh of a mergeable node that can join a merge (opaque, shared single material, indexed). */
function mergeablePart(b: Readonly<EntityNode['bindings'][number]>): boolean {
  if (b.ownedMaterial || b.seeThrough || b.variant) return false;
  const m = b.mesh.material as Material | Material[];
  if (Array.isArray(m) || m.transparent) return false;
  const g = b.mesh.geometry;
  return g.index !== null && g.getAttribute('position') !== undefined && g.getAttribute('normal') !== undefined;
}

interface Member {
  mesh: Mesh;
  geometry: BufferGeometry;
  material: Material;
  /** Member matrix relative to the merge parent when merged (16 floats). */
  rel: Float64Array;
  /** Last checked world transform; unchanged members need no matrix multiplication. */
  world: Matrix4;
}

interface Merge {
  key: string;
  parent: Object3D;
  parentWorld: Matrix4;
  material: Material;
  mesh: Mesh;
  members: Member[];
  /** A member changed: re-merge without the evicted ones. */
  stale: boolean;
  built: boolean;
  job: MergeJob | null;
  completion: Promise<void>;
}

const _inv = new Matrix4();
const _rel = new Matrix4();

/** Merged building geometry under one scene root. */
export class StaticMerges {
  private merges: Merge[] = [];
  /** Baked lightmap coordinates of the members, when a lightmap is applied: merged geometry then carries them. */
  private lightmap: LightmapSource | null = null;
  /** Meshes evicted since the last rebuild (they draw themselves until content changes). */
  private readonly evicted = new WeakSet<Mesh>();
  private saved = 0;
  private readyCount = 0;
  private inline = 0;
  private readonly builder: MergeBuildClient | null;

  constructor(private readonly options: { background?: boolean; client?: MergeBuildClient; changed?(): void } = {}) {
    this.builder = options.client ?? (options.background ? new MergeBuildClient() : null);
  }

  get pending(): number {
    let count = 0;
    for (let i = 0; i < this.merges.length; i++) {
      const merge = this.merges[i]!; if (merge.job || merge.stale || !merge.built) count++;
    }
    return count;
  }

  async idle(): Promise<void> {
    while (this.pending) {
      this.update();
      await Promise.all(this.merges.filter(m => m.job).map(m => m.completion));
    }
  }

  /** Captures retain the atomic merge path, including temporary grow/exploded poses. */
  synchronous<T>(draw: () => T): T {
    this.inline++;
    try {
      const result = draw();
      for (const merge of this.merges) if (merge.job) {
        merge.job.cancel(); merge.job = null;
        this.publish(merge, this.build(merge.members.map(m => m.mesh), merge.members));
      }
      return result;
    } finally { this.inline--; }
  }

  /** Draw calls saved per pass by the current merges. */
  get drawCallsSaved(): number {
    return this.saved;
  }

  /** Number of merged meshes. */
  get count(): number {
    return this.readyCount;
  }

  /**
   * Regroup the mergeable meshes of `nodes` (call after content changed).
   * Merges whose member list is unchanged are kept (no new geometry).
   * @returns true when merges were created or removed
   */
  rebuild(nodes: Iterable<Readonly<EntityNode>>): boolean {
    const groups = new Map<string, { parent: Object3D; material: Material; meshes: Mesh[] }>();
    for (const node of nodes) {
      if (!mergeable(node) || !node.content.visible || !node.object.visible) continue;
      const parent = node.object.parent;
      if (!parent) continue;
      for (const b of node.bindings) {
        if (!mergeablePart(b)) continue;
        const mesh = b.mesh;
        if (!mesh.visible) continue;
        // Content changed since the eviction: an intact member may rejoin.
        this.evicted.delete(mesh);
        const g = mesh.geometry;
        const attrs = `${g.getAttribute('uv') ? 'u' : ''}${g.getAttribute('color') ? 'c' : ''}`;
        // Parts of a building merge under their storey; world props merge per cell of the world, so a district of
        // towers or a row of trees is a few draws and still culls by region.
        const cell = node.entity.arch ? '' : `|${Math.floor(mesh.matrixWorld.elements[12] / PROP_CELL)},${Math.floor(mesh.matrixWorld.elements[14] / PROP_CELL)}`;
        const key = `${parent.uuid}${cell}|${b.materialKey}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}|${attrs}`;
        let list = groups.get(key);
        if (!list) {
          list = { parent, material: mesh.material as Material, meshes: [] };
          groups.set(key, list);
        }
        list.meshes.push(mesh);
      }
    }
    const keep = new Set<Merge>();
    const create: Array<{ key: string; parent: Object3D; material: Material; meshes: Mesh[] }> = [];
    // Match actual bounded partitions, not an entire group against each of its split buffers.
    const byFirstMember = new Map<Mesh, Merge>();
    for (const m of this.merges) byFirstMember.set(m.members[0]!.mesh, m);
    for (const [key, g] of groups) {
      for (const meshes of mergePartitions(g.meshes)) {
        const same = byFirstMember.get(meshes[0]!);
        if (same && same.key === key && !same.stale && sameMeshes(same, meshes)) keep.add(same);
        else create.push({ key, parent: g.parent, material: g.material, meshes });
      }
    }
    const removed = this.merges.filter((m) => !keep.has(m));
    const still = new Set<Mesh>();
    for (const c of create) for (const m of c.meshes) still.add(m);
    for (const m of keep) for (const x of m.members) still.add(x.mesh);
    for (const m of removed) this.release(m, still);
    this.merges = [...keep];
    for (const c of create) this.create(c.key, c.parent, c.material, c.meshes);
    this.recount();
    return removed.length > 0 || create.length > 0;
  }

  /**
   * Check members (call each drawn frame, world matrices current): evict the
   * ones that moved, changed or were hidden, and re-merge their groups.
   * Allocation-free unless something changed.
   * @returns true when a merge changed (the frame must be drawn)
   */
  update(): boolean {
    let changed = false;
    for (let i = this.merges.length - 1; i >= 0; i--) {
      const merge = this.merges[i] as Merge;
      const parentChanged = !merge.parentWorld.equals(merge.parent.matrixWorld);
      let inverseReady = false;
      const members = merge.members;
      // Index loop: no iterator object per merge per frame.
      for (let j = 0; j < members.length; j++) {
        const m = members[j] as Member;
        if (this.evicted.has(m.mesh)) continue;
        if (!memberIntact(m, merge.parent)) {
          this.evict(m.mesh);
          merge.stale = true;
          continue;
        }
        if (!parentChanged && m.world.equals(m.mesh.matrixWorld)) continue;
        if (!inverseReady) {
          _inv.copy(merge.parent.matrixWorld).invert();
          inverseReady = true;
        }
        _rel.multiplyMatrices(_inv, m.mesh.matrixWorld);
        const e = _rel.elements;
        for (let k = 0; k < 16; k++) {
          if (Math.abs((e[k] as number) - (m.rel[k] as number)) > 1e-5) {
            this.evict(m.mesh);
            merge.stale = true;
            break;
          }
        }
        m.world.copy(m.mesh.matrixWorld);
      }
      merge.parentWorld.copy(merge.parent.matrixWorld);
      if (merge.stale) {
        changed = true;
        const left = merge.members.filter((m) => !this.evicted.has(m.mesh) && memberIntact(m, merge.parent)).map((m) => m.mesh);
        this.release(merge, new Set(left));
        this.merges.splice(i, 1);
        if (left.length >= MIN_MERGE) this.create(merge.key, merge.parent, merge.material, left);
      }
    }
    if (changed) this.recount();
    return changed;
  }

  private evict(mesh: Mesh): void {
    this.evicted.add(mesh);
    mesh.layers.set(0);
    this.lightmap?.standalone(mesh);
  }

  /**
   * Use `source` for the lightmap coordinates of merged geometry (null: none) and rebuild the geometry of the merges that exist.
   * @returns the number of merges rebuilt
   */
  setLightmap(source: LightmapSource | null): number {
    this.lightmap = source;
    let n = 0;
    for (const m of this.merges) {
      m.job?.cancel(); m.job = null;
      const request = this.backgroundRequest(m.members);
      if (request) { this.start(m, request); n++; continue; }
      const next = this.build(m.members.map((x) => x.mesh), m.members);
      this.publish(m, next);
      n++;
    }
    return n;
  }

  /** The merged geometry of `members`, with lightmap coordinates when every member has some. */
  private build(meshes: readonly Mesh[], members: readonly Member[]): BufferGeometry {
    const merged = mergeGeometries(members);
    const uv = this.lightmap ? concatMemberUv(meshes, this.lightmap) : null;
    if (!uv || uv.length !== (merged.index?.count ?? 0) * 2) return merged;
    const lit = expandWithLightmap(merged, uv);
    merged.dispose();
    return lit;
  }

  /** Create one already bounded partition (rebuild partitions before matching; eviction only removes members). */
  private create(key: string, parent: Object3D, material: Material, meshes: readonly Mesh[]): void {
    if (meshes.length < MIN_MERGE) return;
    parent.updateMatrixWorld(true);
    _inv.copy(parent.matrixWorld).invert();
    const members: Member[] = meshes.map((mesh) => {
      _rel.multiplyMatrices(_inv, mesh.matrixWorld);
      return { mesh, geometry: mesh.geometry, material: mesh.material as Material, rel: Float64Array.from(_rel.elements), world: mesh.matrixWorld.clone() };
    });
    const request = this.backgroundRequest(members);
    const geometry = request ? new BufferGeometry() : this.build(meshes, members);
    const mesh = new Mesh(geometry, material);
    mesh.name = 'aether:merged';
    const first = meshes[0] as Mesh;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.matrixAutoUpdate = false;
    // Picking goes through the members (BATCHED_LAYER); the merged copy is never hit.
    mesh.raycast = () => undefined;
    for (const m of meshes) m.layers.set(BATCHED_LAYER);
    parent.add(mesh);
    mesh.updateMatrixWorld(true);
    const merge: Merge = { key, parent, parentWorld: parent.matrixWorld.clone(), material, mesh, members, stale: false,
      built: request === null, job: null, completion: Promise.resolve() };
    this.merges.push(merge);
    if (request) this.start(merge, request);
  }

  private backgroundRequest(members: readonly Member[]): MergeRequest | null {
    if (this.inline || !this.builder?.available) return null;
    let lightmap: Float32Array[] | null = null;
    if (this.lightmap) {
      lightmap = [];
      for (const member of members) { const uv = this.lightmap.uv(member.mesh); if (!uv) { lightmap = null; break; } lightmap.push(uv); }
    }
    return mergeRequest(members, lightmap);
  }

  private start(merge: Merge, request: MergeRequest): void {
    const attributesCurrent = mergeGeometryStamp(merge.members.map(m => m.geometry)), job = this.builder!.build(request);
    const stamp = (): boolean => attributesCurrent() && this.sourcesCurrent(merge);
    merge.job = job;
    const live = (): boolean => merge.job === job && this.merges.includes(merge);
    merge.completion = (async () => {
      let geometry = await job.promise;
      if (!live()) { geometry?.dispose(); return; }
      if (!stamp()) { geometry?.dispose(); merge.job = null; merge.stale = true; this.options.changed?.(); return; }
      if (!geometry) {
        // Failed workers must not make a whole world merge in one microtask chain.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (!live()) return;
        if (!stamp()) { merge.job = null; merge.stale = true; this.options.changed?.(); return; }
        geometry = this.build(merge.members.map(m => m.mesh), merge.members);
      }
      this.publish(merge, geometry);
      merge.job = null;
    })().catch(error => {
      if (live()) {
        this.release(merge, new Set());
        this.merges.splice(this.merges.indexOf(merge), 1); this.recount(); this.options.changed?.();
      }
      log.warn(`background geometry merge failed: ${errorMessage(error)}`);
    });
  }

  private sourcesCurrent(merge: Merge): boolean {
    let inverseReady = false;
    const parentMoved = !merge.parentWorld.equals(merge.parent.matrixWorld);
    for (const member of merge.members) {
      if (!memberIntact(member, merge.parent)) return false;
      if (!parentMoved && member.world.equals(member.mesh.matrixWorld)) continue;
      if (!inverseReady) { _inv.copy(merge.parent.matrixWorld).invert(); inverseReady = true; }
      _rel.multiplyMatrices(_inv, member.mesh.matrixWorld);
      for (let i = 0; i < 16; i++) if (Math.abs(_rel.elements[i]! - member.rel[i]!) > 1e-5) return false;
    }
    return true;
  }

  private publish(merge: Merge, geometry: BufferGeometry): void {
    const refresh = merge.built;
    merge.mesh.geometry.dispose(); merge.mesh.geometry = geometry; merge.built = true;
    if (refresh) refreshProgram(merge.mesh);
    else { this.readyCount++; this.saved += merge.members.length - 1; }
    this.options.changed?.();
  }

  /** Remove a merge; members not in `still` go back to the default layer. */
  private release(m: Merge, still: ReadonlySet<Mesh>): void {
    m.job?.cancel(); m.job = null;
    for (const x of m.members) {
      if (!still.has(x.mesh) && x.mesh.layers.isEnabled(BATCHED_LAYER)) {
        x.mesh.layers.set(0);
        this.lightmap?.standalone(x.mesh);
      }
    }
    m.mesh.removeFromParent();
    m.mesh.geometry.dispose();
  }

  private recount(): void {
    this.saved = 0; this.readyCount = 0;
    for (const merge of this.merges) if (merge.built) { this.saved += merge.members.length - 1; this.readyCount++; }
  }

  /** Remove every merge and give members back to the default layer (also forgets evictions). */
  clear(): void {
    for (const m of this.merges) this.release(m, new Set());
    this.merges = [];
    this.saved = 0;
    this.readyCount = 0;
    this.builder?.reset();
  }

  dispose(): void { this.clear(); this.builder?.dispose(); }
}

/** The member is still attached under its merge parent, visible, with the merged geometry and material. */
function memberIntact(m: Member, parent: Object3D): boolean {
  if (m.mesh.geometry !== m.geometry || m.mesh.material !== m.material) return false;
  for (let o: Object3D | null = m.mesh; o; o = o.parent) {
    if (o === parent) return true;
    if (!o.visible) return false;
  }
  return false;
}

/** Split before matching and releasing: undersized tails must draw standalone, never stay on the hidden layer. */
function mergePartitions(meshes: readonly Mesh[]): Mesh[][] {
  const out: Mesh[][] = [];
  let start = 0;
  while (start < meshes.length) {
    let vertices = 0;
    let end = start;
    while (end < meshes.length) {
      const n = meshes[end]!.geometry.getAttribute('position').count;
      if (end > start && vertices + n > MAX_MERGE_VERTICES) break;
      vertices += n;
      end++;
    }
    if (end - start >= MIN_MERGE) out.push(meshes.slice(start, end));
    start = end;
  }
  return out;
}

function sameMeshes(m: Merge, meshes: readonly Mesh[]): boolean {
  if (m.members.length !== meshes.length) return false;
  for (let i = 0; i < meshes.length; i++) {
    const a = m.members[i] as Member;
    if (a.mesh !== meshes[i] || a.mesh.geometry !== a.geometry || a.mesh.material !== a.material) return false;
  }
  return true;
}
