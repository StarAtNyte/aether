/**
 * Static merging of building parts: the unique, static meshes of a
 * parametric building (walls, floors, ceilings, windows, furniture … —
 * entities with `arch` metadata) that share a material are merged into one
 * mesh per material under their storey, so a furnished apartment draws a few
 * dozen meshes instead of several hundred (and the shadow pass likewise).
 * Unique static procedural props of the world (a backdrop of towers, planters,
 * boulders) merge the same way per cell of {@link PROP_CELL} metres, and so do
 * small scatter layers (a house, a stretch of fence or a pair of statues placed
 * as a scatter of a few copies): their instanced meshes would otherwise draw
 * once per part, each with its own first-use preparation.
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
import { mergeGeometries, PIECE_TONE_KEY } from './merge-geometries';
export { mergeGeometries } from './merge-geometries';
import { BufferGeometry, Matrix4, Mesh, type InstancedMesh, type Material, type Object3D } from 'three';
import type { EntityNode } from './entity-node';
import { concatMemberUv, expandWithLightmap, refreshProgram, type LightmapSource } from './lightmap-uv';
import { BATCHED_LAYER } from './static-batches';
import { MergeBuildClient, type MergeJob } from './merge-client';
import { mergeGeometryStamp, mergeRequest, type MergeRequest } from './merge-wire';
import { errorMessage, log } from '../log';
import { releaseAfterUpload } from '../gpu/cpu-release';
import { interiorContent } from '../gpu/performance';

/** Marks the merge key of room contents (see `rebuild`). */
const INTERIOR_KEY = '|in';

/** Edge (m) of the cells that world props (entities without `arch`) are merged in: a merged mesh is culled as a whole, so it stays local. */
export const PROP_CELL = 160;
/**
 * The same for copies of small scatter layers and library models: a house or a street lamp is worth culling on its own
 * more than a backdrop prop is, and a 160 m cell of scattered houses drew every house in it whichever way the eye looked
 * (three times the triangles of the instanced copies on a hillside village).
 */
export const COPY_CELL = 32;

/** Smallest group worth merging (fewer meshes draw as they are). */
export const MIN_MERGE = 3;
/** Largest merged mesh (vertices); bigger groups split into several meshes. */
export const MAX_MERGE_VERTICES = 400_000;
/** Most parts a merged entity may have (bigger compound shapes stay as they are). */
const MAX_PARTS = 32;
/** Most copies a scatter layer may have to merge (bigger layers stay instanced: one draw per part for all copies). */
export const MAX_MERGE_INSTANCES = 8;
/**
 * A bigger scatter layer still merges when all its copies together are this few vertices (flower cards along a balcony,
 * pebbles): instanced, each such layer is a draw for a few hundred vertices. `__AETHER_MERGE_SMALL_COPIES = false` turns it off.
 */
export const SMALL_COPIES_VERTICES = 8192;

/** Whether the copies of an instanced mesh are few, or small enough together, to merge (see {@link SMALL_COPIES_VERTICES}). */
function copiesMerge(count: number, vertices: number, material: Material | Material[]): boolean {
  if (count <= MAX_MERGE_INSTANCES) return true;
  if ((globalThis as { __AETHER_MERGE_SMALL_COPIES?: boolean }).__AETHER_MERGE_SMALL_COPIES === false) return false;
  // A vertex-displaced material (wind) reads the copy's own coordinates, which a merge replaces.
  if (Array.isArray(material) || (material as { positionNode?: unknown }).positionNode) return false;
  return count * vertices <= SMALL_COPIES_VERTICES;
}

/** Whether every part of a scatter node merges by {@link copiesMerge}. */
function smallCopies(node: Readonly<EntityNode>): boolean {
  if (node.instances <= MAX_MERGE_INSTANCES) return true;
  let vertices = 0;
  for (const b of node.bindings) vertices += b.mesh.geometry.getAttribute('position')?.count ?? Infinity;
  return node.bindings.every((b) => copiesMerge(node.instances, vertices, b.mesh.material as Material));
}

/**
 * Behaviours that leave an entity where it is until someone uses it (a drawer, a cabinet or room door, a switch). With
 * `interactive` merging on, such parts merge while idle: the frame they first move they are evicted and draw themselves.
 */
const IDLE_BEHAVIORS: ReadonlySet<string> = new Set(['operable', 'door', 'toggle']);

/**
 * A node whose meshes may be merged: a static, untouched part of a building. With `interactive`, also the parts that only
 * move when used (see {@link IDLE_BEHAVIORS}), whatever their physics body.
 */
export function mergeable(node: Readonly<EntityNode>, interactive = false): boolean {
  if (node.transient || node.placeholder || node.pending || node.failed || node.overridden) return false;
  // The other parts of an entity with virtual parts (a hillside town's balconies, windows, wall copings) merge too, per
  // `virtualPartCell` (see `rebuild`). Merged, they are no longer culled one by one or left out as specks; measured on
  // Lisbon Hills on an integrated GPU the frame pacing did not get worse (docs/PERFORMANCE.md, "Fewer materials").
  // `__AETHER_MERGE_VIRTUAL_PARTS = false` keeps them as they are. The virtual sources stay out (see `virtualSource`).
  if (node.field) return false;
  if (hasVirtualParts(node) && !mergeVirtualParts()) return false;
  const e = node.entity;
  if (e.template || e.visible === false) return false;
  // A small scatter layer merges copy by copy; a big one is cheaper as it is (one instanced draw per part).
  if (e.shape.kind === 'scatter' ? node.instances < 1 || !smallCopies(node) || !node.instanceMatrix : e.shape.kind !== 'procedural' || node.instances > 0) return false;
  const idle = interactive && e.behaviors.length > 0 && e.behaviors.every((b) => IDLE_BEHAVIORS.has(b.type));
  if (e.behaviors.length > 0 && !idle) return false;
  if (e.physics && e.physics.body !== 'static' && !idle) return false;
  if (node.bindings.length === 0 || node.bindings.length > MAX_PARTS || node.geometryKeys.length !== node.bindings.length) return false;
  return true;
}

function mergeVirtualParts(): boolean {
  return (globalThis as { __AETHER_MERGE_VIRTUAL_PARTS?: boolean }).__AETHER_MERGE_VIRTUAL_PARTS !== false;
}

/**
 * Largest part (vertices) of an entity with virtual parts that merges: a merge copies its members' geometry, and a part this
 * big is not bound by its draw call. Lisbon Hills, opening view: 412 view draws with this cap, 433 with 10,000, for 120 MB
 * of merged geometry against 103 MB (74 MB without these merges; 143 MB uncapped).
 */
export const VIRTUAL_PART_MAX_VERTICES = 30_000;

/** Edge (m) of the cells the other parts of entities with virtual parts merge in (`__AETHER_VIRTUAL_PART_CELL`, default {@link PROP_CELL}). */
function virtualPartCell(gridCell: number): number {
  const v = (globalThis as { __AETHER_VIRTUAL_PART_CELL?: number | 'grid' }).__AETHER_VIRTUAL_PART_CELL;
  if (v === 'grid') return gridCell;
  return typeof v === 'number' && v > 0 ? v : PROP_CELL;
}

/** Whether `node` has virtual parts (its other parts merge per grid cell, see {@link StaticMerges.rebuild}). */
function hasVirtualParts(node: Readonly<EntityNode>): boolean {
  return node.virtual.length > 0 || node.bindings.some((b) => b.mesh.userData['aetherVirtualSource'] === true);
}

/** Whether `mesh` is the full-detail source of one of the node's virtual stand-ins (raycast only; never merged). */
function virtualSource(node: Readonly<EntityNode>, mesh: Mesh): boolean {
  // Marked when its hierarchy is requested, before the stand-in exists.
  if (mesh.userData['aetherVirtualSource'] === true) return true;
  for (const v of node.virtual) if (v.source === mesh) return true;
  return false;
}

/** A mesh of a mergeable node that can join a merge (opaque, shared single material, indexed). */
function mergeablePart(b: Readonly<EntityNode['bindings'][number]>): boolean {
  if (b.ownedMaterial || b.seeThrough || b.variant) return false;
  const m = b.mesh.material as Material | Material[];
  if (Array.isArray(m) || m.transparent) return false;
  const g = b.mesh.geometry;
  if (instanced(b.mesh)) {
    const im = b.mesh as InstancedMesh;
    if (im.instanceColor !== null || im.morphTexture !== null || im.count < 1 || !copiesMerge(im.count, g.getAttribute('position')?.count ?? Infinity, m) || im.instanceMatrix.count < im.count) return false;
  }
  return g.index !== null && g.getAttribute('position') !== undefined && g.getAttribute('normal') !== undefined;
}

/** Vertex attributes a merge carries (see `mergeGeometries`): a model mesh with others (tangents, a second uv set, skin weights) stays as it is. */
const MERGED_ATTRIBUTES: ReadonlySet<string> = new Set(['position', 'normal', 'uv', 'color']);

/**
 * The meshes of a static library model that may merge (a street lamp, a bench, a chair placed thirty times), or null when
 * the model is not static: animated, skinned, switching level of detail, driven (a vehicle, a character) or with behaviours.
 */
function assetParts(node: Readonly<EntityNode>): Array<{ mesh: Mesh; materialKey: string }> | null {
  if (node.transient || node.placeholder || node.pending || node.failed || node.overridden || node.characterBody !== null) return null;
  const e = node.entity;
  if (e.shape.kind !== 'asset' || e.template || e.visible === false || e.behaviors.length > 0) return null;
  if (e.physics && e.physics.body !== 'static') return null;
  const out: Array<{ mesh: Mesh; materialKey: string }> = [];
  let still = true;
  node.content.traverse((o) => {
    if (!still) return;
    const lod = o as { isLOD?: boolean; isSkinnedMesh?: boolean; isBone?: boolean; animations?: unknown[] };
    if (lod.isLOD === true || lod.isSkinnedMesh === true || lod.isBone === true || (lod.animations?.length ?? 0) > 0) {
      still = false;
      return;
    }
    const mesh = o as Mesh;
    if (mesh.isMesh !== true || instanced(mesh) || mesh.type !== 'Mesh') return;
    const m = mesh.material as Material | Material[];
    const g = mesh.geometry;
    if (Array.isArray(m) || m.transparent || g.index === null || g.groups.length > 1 || Object.keys(g.morphAttributes).length > 0) return;
    if (g.getAttribute('position') === undefined || g.getAttribute('normal') === undefined) return;
    for (const name of Object.keys(g.attributes)) if (!MERGED_ATTRIBUTES.has(name)) return;
    if (mesh.renderOrder !== 0 || mesh.onBeforeRender !== Mesh.prototype.onBeforeRender || mesh.customDepthMaterial || mesh.customDistanceMaterial) return;
    out.push({ mesh, materialKey: m.uuid });
  });
  return still && out.length > 0 ? out : null;
}

function instanced(mesh: Mesh): boolean {
  return (mesh as Partial<InstancedMesh>).isInstancedMesh === true;
}

const _instance = new Matrix4();

/** `out` = the world matrix of a member (its mesh, times its instance matrix when it is a copy of a scatter). */
function memberWorld(out: Matrix4, mesh: Mesh, instance: number): Matrix4 {
  if (instance < 0) return out.copy(mesh.matrixWorld);
  (mesh as InstancedMesh).getMatrixAt(instance, _instance);
  return out.multiplyMatrices(mesh.matrixWorld, _instance);
}

interface Member {
  mesh: Mesh;
  /** Copy of an instanced mesh (-1: a plain mesh). */
  instance: number;
  /** Version of the instance matrices when merged (instanced members). */
  instanceVersion: number;
  geometry: BufferGeometry;
  material: Material;
  /** Member matrix relative to the merge parent when merged (16 floats). */
  rel: Float64Array;
  /** Last checked world transform; unchanged members need no matrix multiplication. */
  world: Matrix4;
  /** World origin of the member's object, for materials with a per-piece tone (see `PIECE_ORIGIN`), else null. */
  origin: number[] | null;
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
const _world = new Matrix4();

/** Merged building geometry under one scene root. */
export class StaticMerges {
  private merges: Merge[] = [];
  /** Baked lightmap coordinates of the members, when a lightmap is applied: merged geometry then carries them. */
  private lightmap: LightmapSource | null = null;
  /** Meshes evicted since the last rebuild (they draw themselves until content changes). */
  private readonly evicted = new WeakSet<Mesh>();
  /**
   * Members that keep their object's per-piece tone when merged (`PIECE_ORIGIN`): the parts of entities with virtual parts
   * and the copies of small scatter layers over {@link MAX_MERGE_INSTANCES}, which drew unmerged before they merged. Props
   * and few-copy layers keep the merged mesh's tone, as they always had.
   */
  private readonly ownTone = new WeakSet<Mesh>();
  private saved = 0;
  private readyCount = 0;
  /**
   * Merge parts that move only when used (drawers, doors) while they are idle (see `mergeable`). The cheaper tiers turn it
   * on: a street of furnished houses has hundreds of them, each a draw in the view and in the sun's shadow map; the first
   * use of one costs a regroup of its merge. Takes effect at the next {@link rebuild}.
   */
  interactive = false;
  /**
   * Edge (m) of the cells copies and library models merge in: the world's grid cell (see streaming/cell-grid.ts) once the
   * owner knows it, {@link COPY_CELL} before. Takes effect at the next {@link rebuild}.
   */
  copyCell = COPY_CELL;
  /** Member meshes of the current merges (see {@link has}); null after a change, rebuilt on demand. */
  private memberSet: Set<Mesh> | null = null;
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

  /** Merged meshes of room contents (furniture, fittings), for distance culling. */
  *interiorMeshes(): Iterable<Mesh> {
    for (const m of this.merges) if (m.mesh.userData['aetherInterior'] === true) yield m.mesh;
  }

  /** Merged meshes that have their geometry. */
  *meshes(): Iterable<Mesh> {
    for (const m of this.merges) if (m.built) yield m.mesh;
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
      const own = mergeable(node, this.interactive);
      const parts = own ? node.bindings.filter((b) => mergeablePart(b) && !virtualSource(node, b.mesh)).map((b) => ({ mesh: b.mesh, materialKey: b.materialKey })) : assetParts(node);
      // The parts of an entity with virtual parts (a row of houses' windows and balconies, a wall's copings) merge per
      // `virtualPartCell()` metres: the merged mesh is culled as a whole and is not left out as a speck.
      const edge = own && node.entity.shape.kind === 'procedural' ? (hasVirtualParts(node) ? virtualPartCell(this.copyCell) : PROP_CELL) : this.copyCell;
      if (!parts || !node.content.visible || !node.object.visible) continue;
      const parent = node.object.parent;
      if (!parent) continue;
      const virtualParts = own && hasVirtualParts(node);
      const ownTone = virtualParts || (own && node.entity.shape.kind === 'scatter' && node.instances > MAX_MERGE_INSTANCES);
      for (const b of parts) {
        const mesh = b.mesh;
        if (!mesh.visible) continue;
        if (virtualParts && (mesh.geometry.getAttribute('position')?.count ?? Infinity) * Math.max(1, instanced(mesh) ? (mesh as InstancedMesh).count : 1) > VIRTUAL_PART_MAX_VERTICES) continue;
        if (ownTone) this.ownTone.add(mesh);
        else this.ownTone.delete(mesh);
        // Content changed since the eviction: an intact member may rejoin.
        this.evicted.delete(mesh);
        const g = mesh.geometry;
        const attrs = `${g.getAttribute('uv') ? 'u' : ''}${g.getAttribute('color') ? 'c' : ''}`;
        // Parts of a building merge under their storey; world props merge per cell of the world, so a district of
        // towers or a row of trees is a few draws and still culls by region.
        const at = instanced(mesh) ? memberWorld(_rel, mesh, 0) : mesh.matrixWorld;
        const cell = node.entity.arch ? '' : `|${edge}:${Math.floor(at.elements[12] / edge)},${Math.floor(at.elements[14] / edge)}`;
        // Room contents merge apart from the building around them, so a whole house's furniture can be left undrawn far away.
        const inside = node.entity.arch && interiorContent(node.entity.arch) ? INTERIOR_KEY : '';
        const key = `${parent.uuid}${cell}${inside}|${b.materialKey}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}|${attrs}`;
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
        _rel.multiplyMatrices(_inv, memberWorld(_world, m.mesh, m.instance));
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
        const left = [...new Set(merge.members.filter((m) => !this.evicted.has(m.mesh) && memberIntact(m, merge.parent)).map((m) => m.mesh))];
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
    // Copies of a scatter carry no baked coordinates of their own.
    const uv = this.lightmap && members.every((m) => m.instance < 0) ? concatMemberUv(meshes, this.lightmap) : null;
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
    const members: Member[] = [];
    for (const mesh of meshes) {
      const copies = instanced(mesh) ? (mesh as InstancedMesh).count : 0;
      for (let instance = copies > 0 ? 0 : -1; instance < copies; instance++) {
        _rel.multiplyMatrices(_inv, memberWorld(_world, mesh, instance));
        members.push({ mesh, instance, instanceVersion: instance < 0 ? 0 : (mesh as InstancedMesh).instanceMatrix.version, geometry: mesh.geometry, material: mesh.material as Material, rel: Float64Array.from(_rel.elements), world: mesh.matrixWorld.clone(),
          origin: this.ownTone.has(mesh) && (mesh.material as Material).userData[PIECE_TONE_KEY] === true ? [mesh.matrixWorld.elements[12]!, mesh.matrixWorld.elements[13]!, mesh.matrixWorld.elements[14]!] : null });
      }
    }
    const request = this.backgroundRequest(members);
    const geometry = request ? new BufferGeometry() : this.build(members.map((m) => m.mesh), members);
    const mesh = new Mesh(geometry, material);
    mesh.name = 'aether:merged';
    if (key.includes(INTERIOR_KEY)) mesh.userData['aetherInterior'] = true;
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
    if (!request) this.releaseCopy(merge, geometry);
    if (request) this.start(merge, request);
  }

  private backgroundRequest(members: readonly Member[]): MergeRequest | null {
    if (this.inline || !this.builder?.available) return null;
    let lightmap: Float32Array[] | null = null;
    if (this.lightmap && members.every((m) => m.instance < 0)) {
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
      _rel.multiplyMatrices(_inv, memberWorld(_world, member.mesh, member.instance));
      for (let i = 0; i < 16; i++) if (Math.abs(_rel.elements[i]! - member.rel[i]!) > 1e-5) return false;
    }
    return true;
  }

  private publish(merge: Merge, geometry: BufferGeometry): void {
    const refresh = merge.built;
    merge.mesh.geometry.dispose(); merge.mesh.geometry = geometry; merge.built = true;
    this.releaseCopy(merge, geometry);
    if (refresh) refreshProgram(merge.mesh);
    else { this.readyCount++; this.saved += drawsMerged(merge) - 1; }
    this.options.changed?.();
  }

  /**
   * Let the merged copy's CPU arrays go once uploaded (gpu/cpu-release.ts): only the GPU reads it (the members answer
   * picking, physics and lightmaps). Exports rebuild it from the members, shadow batches read the members' positions.
   */
  private releaseCopy(merge: Merge, geometry: BufferGeometry): void {
    releaseAfterUpload(geometry, {
      restore: () => (this.merges.includes(merge) && merge.mesh.geometry === geometry ? this.build(merge.members.map((m) => m.mesh), merge.members) : null),
      pieces: () => merge.members.map((m) => ({ geometry: m.geometry, matrix: new Matrix4().fromArray(m.rel) })),
    });
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

  /** Whether `mesh` is a member of a merge (drawn by it, or waiting for its geometry). */
  has(mesh: Mesh): boolean {
    if (!this.memberSet) {
      this.memberSet = new Set();
      for (const m of this.merges) for (const x of m.members) this.memberSet.add(x.mesh);
    }
    return this.memberSet.has(mesh);
  }

  private recount(): void {
    this.memberSet = null;
    this.saved = 0; this.readyCount = 0;
    for (const merge of this.merges) if (merge.built) { this.saved += drawsMerged(merge) - 1; this.readyCount++; }
  }

  /** Remove every merge and give members back to the default layer (also forgets evictions). */
  clear(): void {
    for (const m of this.merges) this.release(m, new Set());
    this.merges = [];
    this.memberSet = null;
    this.saved = 0;
    this.readyCount = 0;
    this.builder?.reset();
  }

  dispose(): void { this.clear(); this.builder?.dispose(); }
}

/** The member is still attached under its merge parent, visible, with the merged geometry and material. */
function memberIntact(m: Member, parent: Object3D): boolean {
  if (m.mesh.geometry !== m.geometry || m.mesh.material !== m.material) return false;
  if (m.instance >= 0) {
    const im = m.mesh as InstancedMesh;
    if (im.count <= m.instance || im.instanceMatrix.version !== m.instanceVersion) return false;
  }
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
      const n = meshes[end]!.geometry.getAttribute('position').count * (instanced(meshes[end]!) ? (meshes[end] as InstancedMesh).count : 1);
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
  let j = 0;
  for (let i = 0; i < m.members.length; i++) {
    const a = m.members[i] as Member;
    // Copies of one instanced mesh are consecutive members.
    if (i > 0 && a.mesh === (m.members[i - 1] as Member).mesh) {
      if (!memberIntact(a, m.parent)) return false;
      continue;
    }
    if (a.mesh !== meshes[j] || a.mesh.geometry !== a.geometry || a.mesh.material !== a.material) return false;
    if (a.instance >= 0 && (a.mesh as InstancedMesh).count !== countCopies(m.members, i)) return false;
    j++;
  }
  return j === meshes.length;
}

/** Copies of the instanced mesh of member `i` (consecutive from there). */
function countCopies(members: readonly Member[], i: number): number {
  let n = 0;
  while (i + n < members.length && (members[i + n] as Member).mesh === (members[i] as Member).mesh) n++;
  return n;
}

/** Draws a merge replaces (one per mesh, however many copies it has). */
function drawsMerged(merge: Merge): number {
  let n = 0;
  for (let i = 0; i < merge.members.length; i++) if (i === 0 || (merge.members[i] as Member).mesh !== (merge.members[i - 1] as Member).mesh) n++;
  return n;
}
