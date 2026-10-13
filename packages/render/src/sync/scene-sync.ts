/**
 * SceneSync — incremental World IR → three.js scene graph synchronization.
 *
 * GPU-free (pure three.js core), so it is fully unit-testable in Node. It
 * diffs each new world against the previous one (`diffWorlds`) and only
 * creates, removes or updates the entities that changed, keeping Object3D
 * identity for everything else. Geometry and materials are shared through
 * refcounted caches; procedural shapes and models build asynchronously behind
 * a placeholder, and stale async results are discarded via per-node tokens.
 */
import {
  Box3,
  BoxGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  StaticDrawUsage,
  Vector3,
  type Light,
  type Object3D,
  type Ray,
} from 'three';
import {
  decodeMeshCached,
  deepEqual,
  diffWorlds,
  type Entity,
  type EntityId,
  type Json,
  type MaterialSpec,
  type ProceduralShape,
  type ScatterShape,
  type ShapeSpec,
  type WorldDoc,
} from '@aether/core';
import type { GeneratorOutput, GeometrySource, KeyedOutput } from '../types';
import type { GeometryCache } from '../geometry/buffer-geometry';
import type { MaterialCache } from '../materials/material-cache';
import { mergeMaterial, resolveMaterial, type MaterialVariant, type ResolvedMaterial } from '../materials/presets';
import { createMaterial } from '../materials/material-cache';
import { instantiateModel, type ModelCache } from '../geometry/model-loader';
import { buildHeightGrid, transformPositions, type HeightGrid } from '../geometry/height-grid';
import { composeScatterMatrices, MAX_SCATTER_INSTANCES, primitiveLift, scatterPlacements, type SurfaceSampler } from '../geometry/scatter';
import { buildMeshGeometry, previewMeshGeometry, type MeshGeometryBundle } from '../geometry/mesh-asset';
import { meshColliders } from '@aether/procgen';
import { createEntityLight, disposeEntityLight, enforceShadowCap, updateLightParams } from './lights';
import { createEntityNode, ENTITY_ID_KEY, type EntityNode, type MeshBinding } from './entity-node';
import { renderableIds } from './renderable';
import { setEntityPath } from './property-path';
import { errorMessage, log } from '../log';

/** Total instance budget across all scatter entities (memory/GPU guard sized for laptops). */
export const DEFAULT_MAX_INSTANCES = 150_000;
/** Total triangles all scatter layers may draw per frame (instances × triangles per instance). */
export const DEFAULT_MAX_SCATTER_TRIANGLES = 12_000_000;
/** Scatter layers with more instances than this do not cast shadows (they still receive them). */
export const SCATTER_SHADOW_MAX_INSTANCES = 2_000;
/** Material fields that runtime overrides update in place (uniform-only changes). */
const LIVE_MATERIAL_FIELDS: ReadonlyMap<string, 'color' | 'unit' | 'intensity'> = new Map([
  ['color', 'color'],
  ['emissive', 'color'],
  ['emissiveIntensity', 'intensity'],
  ['opacity', 'unit'],
  ['roughness', 'unit'],
  ['metalness', 'unit'],
]);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Cheap validation mirroring the MaterialSpec schema for the live fields (no zod per tick). */
function validLiveValue(kind: 'color' | 'unit' | 'intensity', value: Json): boolean {
  if (kind === 'color') return typeof value === 'string' && HEX_COLOR.test(value);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false;
  return kind === 'unit' ? value <= 1 : value <= 50;
}
const DEG = Math.PI / 180;
/** Transparent materials below this opacity do not cast shadows. */
const SHADOW_OPACITY_MIN = 0.6;
const RESOLVED: Promise<void> = Promise.resolve();

/** Options of {@link SceneSync}. */
export interface SceneSyncOptions {
  source: GeometrySource;
  materials: MaterialCache;
  geometries: GeometryCache;
  /** Model loading; without it model shapes show the fallback. */
  models?: ModelCache;
  /** 'ghost' renders translucent previews: no lights, no shadows. */
  variant?: MaterialVariant;
  /** Total instance budget (default {@link DEFAULT_MAX_INSTANCES}). */
  maxInstances?: number;
  /** Total scatter triangle budget (default {@link DEFAULT_MAX_SCATTER_TRIANGLES}). */
  maxScatterTriangles?: number;
  /** Called after any entity's content (geometry/bounds) changed. */
  onContentChanged?: (id: EntityId) => void;
}

// Scratch objects (no per-frame allocations in applyTransforms).
const _inv = new Matrix4();
const _pPos = new Vector3();
const _pQuat = new Quaternion();
const _pScale = new Vector3();
const _q = new Quaternion();
const _v = new Vector3();
const _box = new Box3();
const _box2 = new Box3();

function usesGenerator(shape: ShapeSpec, ids: ReadonlySet<string>): boolean {
  if (shape.kind === 'procedural') return ids.has(shape.generator);
  if (shape.kind === 'scatter' && shape.of.kind === 'procedural') return ids.has(shape.of.generator);
  return false;
}

/** GPU resources detached from a node, released once replacement content is mounted. */
interface Retired {
  materialKeys: string[];
  geometryKeys: string[];
  owned: MeshStandardMaterial[];
  modelUrl: string | null;
  bundle: MeshGeometryBundle | null;
}

/** Key under `Mesh.userData` holding the global triangle index of each local triangle (mesh shapes). */
export const MESH_TRIANGLES_KEY = 'aetherTriangles';

let meshKeySeq = 0;
const meshKeys = new WeakMap<object, string>();
/** Stable per-object key of an (immutable) mesh asset. */
function meshAssetKey(asset: object): string {
  let k = meshKeys.get(asset);
  if (!k) {
    k = `mesh#${++meshKeySeq}`;
    meshKeys.set(asset, k);
  }
  return k;
}

/** Copy resolved uniform values onto a live (owned) material without changing its program. */
function applyLiveUniforms(m: MeshStandardMaterial, r: ResolvedMaterial): void {
  m.color.set(r.color);
  m.emissive.set(r.emissive);
  m.emissiveIntensity = r.emissiveIntensity;
  m.roughness = r.roughness;
  m.metalness = r.metalness;
  if (r.transparent && !m.transparent) {
    // One-time switch to blending; never switched back while the override lives.
    m.transparent = true;
    m.depthWrite = false;
    m.needsUpdate = true;
  }
  m.opacity = m.transparent ? r.opacity : 1;
}

/** Raycast stub for scatter instances: picking every instance is O(instances × triangles). */
function noRaycast(): void {
  // intentionally empty: scatter entities are picked through their bounds (see SceneSync.pickScatter)
}

function finite3(v: readonly number[], fallback: number): [number, number, number] {
  const f = (x: number | undefined): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
  return [f(v[0]), f(v[1]), f(v[2])];
}

/** Incremental scene synchronizer. See the module docs. */
export class SceneSync {
  /** Parent of every entity object. Keep it untransformed (identity). */
  readonly root = new Group();
  private readonly nodes = new Map<EntityId, EntityNode>();
  private readonly inflight = new Set<Promise<void>>();
  private readonly warnings = new Map<EntityId, string>();
  private readonly surfaceGrids = new Map<EntityId, { stamp: string; grid: HeightGrid | null }>();
  /** Surface entity id → ids of scatters placed on it (O(1) dependent lookup). */
  private readonly dependents = new Map<EntityId, Set<EntityId>>();
  private readonly variant: MaterialVariant;
  private readonly maxInstances: number;
  private readonly maxScatterTriangles: number;
  private totalScatterTriangles = 0;
  private readonly placeholderGeometry: BoxGeometry;
  private readonly placeholderMaterial: MeshStandardMaterial;
  private current: WorldDoc | null = null;
  private totalInstances = 0;
  private lightsDirty = false;
  /** True while setWorld rebuilds: dependent scatter relayout is deferred to one pass. */
  private batching = false;
  private disposed = false;

  constructor(private readonly opts: SceneSyncOptions) {
    this.variant = opts.variant ?? 'standard';
    this.maxInstances = Math.max(0, opts.maxInstances ?? DEFAULT_MAX_INSTANCES);
    this.maxScatterTriangles = Math.max(0, opts.maxScatterTriangles ?? DEFAULT_MAX_SCATTER_TRIANGLES);
    this.root.name = this.variant === 'ghost' ? 'aether:ghost' : 'aether:entities';
    this.placeholderGeometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.placeholderMaterial = new MeshStandardMaterial({ color: '#9aa4b2', roughness: 0.9, transparent: true, opacity: 0.35, depthWrite: false });
  }

  /** The last world passed to {@link setWorld}. */
  get world(): WorldDoc | null {
    return this.current;
  }

  /** Number of entity nodes (document + transient). */
  get entityCount(): number {
    return this.nodes.size;
  }

  /** Total scatter instances currently drawn. */
  get instanceCount(): number {
    return this.totalInstances;
  }

  /** Object3D of an entity. */
  object(id: EntityId): Object3D | undefined {
    return this.nodes.get(id)?.object;
  }

  /** Bookkeeping node of an entity (read-only use: debug overlays, tests). */
  node(id: EntityId): Readonly<EntityNode> | undefined {
    return this.nodes.get(id);
  }

  /** Iterate all nodes. */
  forEachNode(fn: (node: Readonly<EntityNode>) => void): void {
    for (const n of this.nodes.values()) fn(n);
  }

  /** Generator output currently mounted for an entity (primitive, procedural or fallback). */
  getOutput(id: EntityId): GeneratorOutput | undefined {
    const n = this.nodes.get(id);
    if (!n || !n.keyed || n.entity.shape.kind === 'scatter') return undefined;
    return n.keyed.output;
  }

  /** Last build warning per entity (generation failures, rejected URLs, budget). */
  getWarnings(): ReadonlyMap<EntityId, string> {
    return this.warnings;
  }

  /** Entity id owning a scene object (walks up to the entity object). */
  idOf(object: Object3D | null): EntityId | null {
    let o: Object3D | null = object;
    while (o && o !== this.root) {
      const id: unknown = o.userData[ENTITY_ID_KEY];
      if (typeof id === 'string' && this.nodes.get(id)?.object === o) return id;
      o = o.parent;
    }
    return null;
  }

  /** Resolves when every in-flight build (including model loads) settled. */
  async whenIdle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  /**
   * Synchronize to `world`. Structural changes happen synchronously; the
   * returned promise settles when procedural generation started by this call
   * finished (model downloads continue in the background, see {@link whenIdle}).
   */
  setWorld(world: WorldDoc): Promise<void> {
    if (this.disposed) return RESOLVED;
    const prev = this.current;
    if (prev === world) return RESOLVED;
    const diff = prev ? diffWorlds(prev, world) : null;
    this.current = world;
    if (diff && diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0 && diff.generatorsChanged.length === 0 && diff.meshesChanged.length === 0) return RESOLVED;

    const renderable = renderableIds(world);
    const started: Promise<void>[] = [];
    const rebuild = new Set<EntityId>();
    const attach = new Set<EntityId>();
    const moved = new Set<EntityId>();

    for (const [id, node] of this.nodes) {
      const inDoc = renderable.has(id);
      if (node.transient ? Object.hasOwn(world.entities, id) : !inDoc) this.removeNode(node);
    }
    for (const id of renderable) {
      if (this.nodes.has(id)) continue;
      const entity = world.entities[id];
      if (!entity) continue;
      this.createNode(entity, false);
      rebuild.add(id);
      attach.add(id);
      moved.add(id);
    }
    if (diff && prev) {
      for (const id of diff.changed) {
        const node = this.nodes.get(id);
        const before = prev.entities[id];
        const after = world.entities[id];
        if (!node || rebuild.has(id) || !before || !after) continue;
        node.overridden = false;
        const flags = this.updateNode(node, node.entity, after);
        if (flags.rebuild) rebuild.add(id);
        if (flags.reparent) attach.add(id);
        if (flags.moved || flags.rebuild) moved.add(id);
      }
      if (diff.generatorsChanged.length > 0) {
        const changedGens = new Set(diff.generatorsChanged);
        for (const node of this.nodes.values()) {
          if (!usesGenerator(node.entity.shape, changedGens)) continue;
          rebuild.add(node.id);
          moved.add(node.id);
        }
      }
      if (diff.meshesChanged.length > 0) {
        const changedMeshes = new Set(diff.meshesChanged);
        for (const node of this.nodes.values()) {
          const s = node.entity.shape;
          if (s.kind !== 'mesh' || !changedMeshes.has(s.mesh) || node.transient) continue;
          rebuild.add(node.id);
          moved.add(node.id);
        }
      }
    }
    if (rebuild.size > 0) {
      // Existing orphans whose parent (re)appeared in this sync.
      for (const node of this.nodes.values()) {
        const parentId = node.entity.parent;
        if (parentId !== null && node.object.parent === this.root && this.nodes.has(parentId)) attach.add(node.id);
      }
    }
    for (const id of attach) {
      const node = this.nodes.get(id);
      if (node) this.attach(node);
    }
    this.batching = true;
    try {
      for (const id of rebuild) {
        const node = this.nodes.get(id);
        if (node) started.push(this.rebuild(node));
      }
    } finally {
      this.batching = false;
    }
    this.relayoutDependents(moved, started);
    if (this.lightsDirty) this.applyShadowCap();
    return Promise.all(started).then(() => undefined);
  }

  /** Add a runtime-spawned entity that is not part of the document. Returns false on id conflicts. */
  addTransient(entity: Entity): Promise<void> | false {
    if (this.disposed || this.nodes.has(entity.id) || entity.template) return false;
    const node = this.createNode(entity, true);
    this.attach(node);
    const p = this.rebuild(node);
    if (this.lightsDirty) this.applyShadowCap();
    return p;
  }

  /** Remove a runtime-spawned entity. Document entities are never removed here. */
  removeTransient(id: EntityId): boolean {
    const node = this.nodes.get(id);
    if (!node || !node.transient) return false;
    this.removeNode(node);
    if (this.lightsDirty) this.applyShadowCap();
    return true;
  }

  /**
   * Runtime property override (logic `setProperty`). Cheap fast paths for
   * `visible` and `light.intensity`; anything else is applied to a validated
   * copy of the entity. Returns false when the entity is unknown or the value
   * is invalid.
   */
  setProperty(id: EntityId, path: string, value: Json): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;
    if (path === 'visible' && typeof value === 'boolean') {
      node.entity = { ...node.entity, visible: value };
      node.object.visible = value;
      node.overridden = true;
      return true;
    }
    if (path === 'light.intensity' && typeof value === 'number' && Number.isFinite(value) && value >= 0 && node.entity.light && node.light) {
      const light = { ...node.entity.light, intensity: value };
      node.entity = { ...node.entity, light };
      updateLightParams(node.light.light, light);
      node.overridden = true;
      return true;
    }
    if (path.startsWith('material.') && this.variant === 'standard') {
      const field = path.slice('material.'.length);
      const kind = LIVE_MATERIAL_FIELDS.get(field);
      if (kind) {
        if (validLiveValue(kind, value)) return this.setLiveMaterial(node, field, value);
        log.debug(`setProperty ${id}.${path} rejected: invalid value`);
        return false;
      }
    }
    const res = setEntityPath(node.entity, path, value);
    if (!res.ok) {
      log.debug(`setProperty ${id}.${path} rejected: ${res.error}`);
      return false;
    }
    const next: Entity = { ...res.entity, id: node.id, parent: node.entity.parent, template: false };
    const flags = this.updateNode(node, node.entity, next);
    node.overridden = true;
    if (flags.rebuild) void this.rebuild(node);
    if (flags.moved) this.relayoutDependents(new Set([id]), []);
    if (this.lightsDirty) this.applyShadowCap();
    return true;
  }

  /** Drop every runtime override, restoring document values (e.g. on play reset). */
  clearOverrides(): void {
    const world = this.current;
    if (!world) return;
    for (const node of this.nodes.values()) {
      if (!node.overridden || node.transient) continue;
      const docEntity = world.entities[node.id];
      if (!docEntity) continue;
      node.overridden = false;
      const flags = this.updateNode(node, node.entity, docEntity);
      if (flags.rebuild) void this.rebuild(node);
      else if (node.bindings.some((b) => b.ownedMaterial)) this.rematerial(node);
      // Physics/logic may have moved the object; always restore the document pose.
      this.applyTransform(node);
    }
    if (this.lightsDirty) this.applyShadowCap();
  }

  /**
   * Scatter entity whose world bounds the ray hits first (scatter instances
   * are excluded from mesh raycasts). Returns the hit distance and id, or null.
   */
  pickScatter(ray: Ray): { id: EntityId; distance: number } | null {
    let best: { id: EntityId; distance: number } | null = null;
    for (const node of this.nodes.values()) {
      if (node.instances === 0 || !node.object.visible) continue;
      _box.makeEmpty();
      for (const b of node.bindings) {
        const mesh = b.mesh;
        if (!mesh.visible || !(mesh instanceof InstancedMesh) || !mesh.boundingBox) continue;
        mesh.updateWorldMatrix(true, false);
        _box2.copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld);
        _box.union(_box2);
      }
      if (_box.isEmpty() || !ray.intersectBox(_box, _v)) continue;
      const distance = _v.distanceTo(ray.origin);
      if (!best || distance < best.distance) best = { id: node.id, distance };
    }
    return best;
  }

  /**
   * Apply packed world-space poses `[px,py,pz,qx,qy,qz,qw]*` (from
   * `PhysicsWorld.writeTransforms`). Zero allocations. Parented bodies are
   * converted into their parent's space.
   */
  applyTransforms(packed: Float32Array, order: readonly EntityId[]): void {
    const n = Math.min(order.length, Math.floor(packed.length / 7));
    for (let i = 0; i < n; i++) {
      const node = this.nodes.get(order[i] as EntityId);
      if (!node) continue;
      const o = i * 7;
      const px = packed[o] as number;
      const py = packed[o + 1] as number;
      const pz = packed[o + 2] as number;
      const qx = packed[o + 3] as number;
      const qy = packed[o + 4] as number;
      const qz = packed[o + 5] as number;
      const qw = packed[o + 6] as number;
      if (!(Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz) && Number.isFinite(qx) && Number.isFinite(qy) && Number.isFinite(qz) && Number.isFinite(qw))) continue;
      const obj = node.object;
      const parent = obj.parent;
      if (!parent || parent === this.root) {
        obj.position.set(px, py, pz);
        obj.quaternion.set(qx, qy, qz, qw);
      } else {
        parent.updateWorldMatrix(true, false);
        const pm = parent.matrixWorld;
        if (pm.determinant() === 0) continue;
        pm.decompose(_pPos, _pQuat, _pScale);
        _inv.copy(pm).invert();
        obj.position.set(px, py, pz).applyMatrix4(_inv);
        _q.set(qx, qy, qz, qw);
        obj.quaternion.copy(_pQuat.invert()).multiply(_q);
      }
      obj.updateMatrix();
    }
  }

  /**
   * World-space bounds of all visible entity content (helpers excluded).
   * Updates world matrices first. Not for per-frame use.
   */
  computeBounds(target: Box3, filter?: (node: Readonly<EntityNode>) => boolean): Box3 {
    target.makeEmpty();
    this.root.updateMatrixWorld(true);
    for (const node of this.nodes.values()) {
      if (!node.object.visible || (filter && !filter(node))) continue;
      _box.setFromObject(node.content);
      if (!_box.isEmpty()) target.union(_box);
    }
    return target;
  }

  /** World bounds of one entity including its children (empty when unknown). */
  entityBounds(id: EntityId, target: Box3): Box3 {
    target.makeEmpty();
    const node = this.nodes.get(id);
    if (!node) return target;
    node.object.updateWorldMatrix(true, true);
    target.setFromObject(node.object);
    return target;
  }

  /** Remove everything (keeps caches alive for reuse). */
  clear(): void {
    for (const node of [...this.nodes.values()]) this.removeNode(node);
    this.current = null;
    this.warnings.clear();
  }

  /** Dispose all nodes and owned resources. Shared caches are disposed by their owner. */
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.placeholderGeometry.dispose();
    this.placeholderMaterial.dispose();
    this.root.removeFromParent();
  }

  // -------------------------------------------------------------------------
  // Node lifecycle
  // -------------------------------------------------------------------------

  private createNode(entity: Entity, transient: boolean): EntityNode {
    const node = createEntityNode(entity, transient);
    this.nodes.set(entity.id, node);
    this.applyTransform(node);
    node.object.visible = entity.visible;
    this.root.add(node.object);
    this.syncLight(node, undefined);
    this.indexScatter(node.id, undefined, entity.shape);
    return node;
  }

  /** Keep the surface → scatter index in sync with a shape change. */
  private indexScatter(id: EntityId, before: ShapeSpec | undefined, after: ShapeSpec | undefined): void {
    const oldSurface = before?.kind === 'scatter' ? before.onSurface : undefined;
    const newSurface = after?.kind === 'scatter' ? after.onSurface : undefined;
    if (oldSurface === newSurface) return;
    if (oldSurface) {
      const set = this.dependents.get(oldSurface);
      set?.delete(id);
      if (set && set.size === 0) this.dependents.delete(oldSurface);
    }
    if (newSurface) {
      let set = this.dependents.get(newSurface);
      if (!set) this.dependents.set(newSurface, (set = new Set()));
      set.add(id);
    }
  }

  private removeNode(node: EntityNode): void {
    node.token++;
    this.teardownContent(node);
    if (node.light) {
      disposeEntityLight(node.light);
      node.light = null;
      this.lightsDirty = true;
    }
    // Orphaned child entities go back to the root; the attach pass re-parents survivors.
    for (const child of [...node.object.children]) if (typeof child.userData[ENTITY_ID_KEY] === 'string') this.root.add(child);
    node.object.removeFromParent();
    this.indexScatter(node.id, node.entity.shape, undefined);
    this.nodes.delete(node.id);
    this.warnings.delete(node.id);
    this.surfaceGrids.delete(node.id);
  }

  private attach(node: EntityNode): void {
    const parentId = node.entity.parent;
    const parentNode = parentId ? this.nodes.get(parentId) : undefined;
    let target: Object3D = parentNode && parentNode !== node ? parentNode.object : this.root;
    // Never create a cycle in the scene graph (defensive: core already rejects cyclic parents).
    for (let o: Object3D | null = target; o; o = o.parent) {
      if (o === node.object) {
        target = this.root;
        break;
      }
    }
    if (node.object.parent !== target) target.add(node.object);
  }

  private applyTransform(node: EntityNode): void {
    const t = node.entity.transform;
    const obj = node.object;
    const [px, py, pz] = finite3(t.position, 0);
    const [rx, ry, rz] = finite3(t.rotation, 0);
    const [sx, sy, sz] = finite3(t.scale, 1);
    obj.position.set(px, py, pz);
    obj.rotation.set(rx * DEG, ry * DEG, rz * DEG, 'XYZ');
    obj.scale.set(sx, sy, sz);
    obj.updateMatrix();
  }

  /** Apply an entity change. Returns what the caller still has to do. */
  private updateNode(node: EntityNode, before: Entity, after: Entity): { rebuild: boolean; reparent: boolean; moved: boolean } {
    node.entity = after;
    if (before.shape !== after.shape) this.indexScatter(node.id, before.shape, after.shape);
    const transformChanged = !deepEqual(before.transform, after.transform);
    if (transformChanged) this.applyTransform(node);
    node.object.visible = after.visible;
    const reparent = before.parent !== after.parent;
    // Mesh colliders depend on the body type (trimesh vs hull).
    const rebuild = !deepEqual(before.shape, after.shape) || (after.shape.kind === 'mesh' && before.physics?.body !== after.physics?.body);
    if (!rebuild && !deepEqual(before.material, after.material)) this.rematerial(node);
    if (!rebuild && (before.castShadow !== after.castShadow || before.receiveShadow !== after.receiveShadow)) this.applyShadowFlags(node);
    if (!deepEqual(before.light, after.light)) this.syncLight(node, before);
    return { rebuild, reparent, moved: transformChanged || reparent };
  }

  // -------------------------------------------------------------------------
  // Content
  // -------------------------------------------------------------------------

  private track(p: Promise<void>): Promise<void> {
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
    return p;
  }

  private isCurrent(node: EntityNode, token: number): boolean {
    return !this.disposed && node.token === token && this.nodes.get(node.id) === node;
  }

  private warn(id: EntityId, message: string): void {
    this.warnings.set(id, message);
    log.warn(`${id}: ${message}`);
  }

  /** (Re)build an entity's content from its shape. The returned promise never rejects. */
  private rebuild(node: EntityNode): Promise<void> {
    // Detach the old content but keep its GPU resources retained until the new
    // content has acquired its own: shared materials/geometries with the same
    // key are then reused instead of being disposed and re-created.
    const retired = this.detachContent(node);
    this.warnings.delete(node.id);
    const token = ++node.token;
    const world = this.current ?? { generators: {} };
    const shape = node.entity.shape;
    let work: Promise<void> | null = null;
    try {
      switch (shape.kind) {
        case 'none':
          break;
        case 'primitive':
          this.mountOutput(node, this.opts.source.primitive(shape), shape.primitive === 'plane');
          break;
        case 'procedural':
          this.mountPlaceholder(node);
          work = this.resolveProcedural(node, shape, world).then(({ keyed, failed }) => {
            if (!this.isCurrent(node, token)) return;
            this.teardownContent(node);
            this.mountOutput(node, keyed, false);
            node.failed = failed;
          });
          break;
        case 'model':
          work = this.buildModel(node, shape.url, shape.fitSize, token);
          break;
        case 'scatter':
          work = this.buildScatter(node, shape, world, token);
          break;
        case 'mesh':
          this.mountMesh(node, shape.mesh);
          break;
      }
    } catch (e) {
      this.mountFailure(node, errorMessage(e));
    }
    if (!work) {
      this.releaseRetired(retired);
      node.pending = false;
      node.ready = RESOLVED;
      this.contentChanged(node);
      return RESOLVED;
    }
    node.pending = true;
    const done = work
      .catch((e: unknown) => {
        if (this.isCurrent(node, token)) this.mountFailure(node, errorMessage(e));
      })
      .finally(() => {
        this.releaseRetired(retired);
        if (!this.isCurrent(node, token)) return;
        node.pending = false;
        this.contentChanged(node);
      });
    node.ready = done;
    // Model downloads are not awaited by setWorld (network); generation is.
    const tracked = this.track(done);
    return shape.kind === 'model' ? RESOLVED : tracked;
  }

  private resolveProcedural(node: EntityNode, shape: ProceduralShape, world: Pick<WorldDoc, 'generators'>): Promise<{ keyed: KeyedOutput; failed: boolean }> {
    return this.opts.source.procedural(shape, world).then(
      (keyed) => ({ keyed, failed: false }),
      (e: unknown) => {
        const msg = errorMessage(e);
        this.warn(node.id, `generator "${shape.generator.slice(0, 64)}" failed: ${msg}`);
        return { keyed: this.opts.source.fallback(msg), failed: true };
      },
    );
  }

  private mountFailure(node: EntityNode, reason: string): void {
    this.teardownContent(node);
    this.warn(node.id, reason);
    node.failed = true;
    try {
      this.mountOutput(node, this.opts.source.fallback(reason), false);
    } catch (e) {
      log.error(`fallback geometry failed for ${node.id}`, e);
    }
  }

  private buildModel(node: EntityNode, url: string, fitSize: number | undefined, token: number): Promise<void> {
    const models = this.opts.models;
    if (!models) return Promise.reject(new Error('model loading is not available'));
    this.mountPlaceholder(node);
    node.modelUrl = url;
    return models.acquire(url).then((source) => {
      if (!this.isCurrent(node, token)) return;
      this.clearPlaceholder(node);
      const model = instantiateModel(source, fitSize);
      model.traverse((o) => {
        if (o instanceof Mesh) {
          o.castShadow = this.variant === 'standard' && node.entity.castShadow;
          o.receiveShadow = this.variant === 'standard' && node.entity.receiveShadow;
        }
      });
      node.content.add(model);
    });
  }

  private buildScatter(node: EntityNode, shape: ScatterShape, world: Pick<WorldDoc, 'generators'>, token: number): Promise<void> {
    const of = shape.of;
    const keyedP: Promise<{ keyed: KeyedOutput; failed: boolean }> =
      of.kind === 'primitive' ? Promise.resolve({ keyed: this.opts.source.primitive(of), failed: false }) : this.resolveProcedural(node, of, world);
    // Read the surface's `ready` one microtask later so a terrain rebuilt in the same sync is awaited.
    const surfaceP = Promise.resolve().then(() => {
      const s = shape.onSurface ? this.nodes.get(shape.onSurface) : undefined;
      return s && s !== node ? s.ready : undefined;
    });
    return Promise.all([keyedP, surfaceP]).then(([{ keyed, failed }]) => {
      if (!this.isCurrent(node, token)) return;
      this.mountScatter(node, shape, keyed);
      node.failed = failed;
    });
  }

  private mountScatter(node: EntityNode, shape: ScatterShape, keyed: KeyedOutput): void {
    const available = this.maxInstances - this.totalInstances;
    const wanted = Math.min(shape.points ? shape.points.length : shape.count, MAX_SCATTER_INSTANCES);
    let trisPerInstance = 0;
    for (const part of keyed.output.parts) trisPerInstance += Math.floor(part.indices.length / 3);
    const triAvailable = this.maxScatterTriangles - this.totalScatterTriangles;
    const byTriangles = trisPerInstance > 0 ? Math.floor(Math.max(0, triAvailable) / trisPerInstance) : wanted;
    const budget = Math.max(0, Math.min(wanted, available, byTriangles));
    if (budget < wanted) {
      this.warn(node.id, `scatter limited to ${budget} of ${wanted} instances (renderer budget ${this.maxInstances} instances / ${this.maxScatterTriangles} triangles)`);
    }
    if (budget === 0) return;
    const placements = scatterPlacements(shape, budget);
    const lift = shape.of.kind === 'primitive' ? primitiveLift(shape.of.primitive, shape.of.size) : 0;
    const sampler = shape.onSurface ? this.surfaceSampler(node, shape.onSurface) : undefined;
    const matrices = composeScatterMatrices(placements, lift, sampler);
    const attr = new InstancedBufferAttribute(matrices, 16);
    attr.setUsage(StaticDrawUsage);
    node.instanceMatrix = attr;
    node.instances = placements.count;
    this.totalInstances += placements.count;
    node.scatterTriangles = placements.count * trisPerInstance;
    this.totalScatterTriangles += node.scatterTriangles;
    this.mountOutput(node, keyed, false, attr);
  }

  /**
   * Mount an editable mesh asset: one Mesh per material slot sharing one set
   * of vertex attributes. `keyed` carries the data for colliders, scatter
   * surfaces and bounds (no geometry-cache entry: the node owns the bundle).
   */
  private mountMesh(node: EntityNode, meshId: string): void {
    const world = this.current;
    const asset = world && Object.hasOwn(world.meshes ?? {}, meshId) ? world.meshes[meshId] : undefined;
    if (!asset) throw new Error(`mesh "${meshId.slice(0, 64)}" is missing`);
    const data = decodeMeshCached(asset);
    const slotMaterials: MaterialSpec[] = asset.materials.length > 0 ? asset.materials : [{}];
    const bundle = buildMeshGeometry(data, slotMaterials.length);
    node.meshBundle = bundle;
    const body = node.entity.physics?.body ?? 'static';
    const colliders = body === 'dynamic' ? meshColliders(data, 'dynamic') : [{ kind: 'trimesh' as const, positions: data.positions, indices: data.indices }];
    const bb = bundle.full.boundingBox;
    node.keyed = {
      key: meshAssetKey(asset),
      output: {
        parts: [{ positions: data.positions, normals: bundle.normal.array as Float32Array, indices: data.indices, material: slotMaterials[0] ?? {} }],
        colliders,
        bounds: bb ? { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] } : { min: [0, 0, 0], max: [0, 0, 0] },
        stats: { triangles: bundle.triangleCount, ms: 0 },
      },
    };
    node.partCount = bundle.slots.length;
    for (const slot of bundle.slots) {
      const partMaterial = slotMaterials[slot.slot] ?? {};
      const handle = this.opts.materials.acquire(mergeMaterial(partMaterial, node.entity.material, node.partCount), { hasVertexColors: bundle.hasColors, doubleSided: false }, this.variant);
      const mesh = new Mesh(slot.geometry, handle.material);
      mesh.matrixAutoUpdate = false;
      mesh.name = `${node.id}:slot${slot.slot}`;
      mesh.userData[MESH_TRIANGLES_KEY] = slot.triangles;
      node.bindings.push({
        mesh,
        partMaterial,
        hasColors: bundle.hasColors,
        doubleSided: false,
        materialKey: handle.key,
        seeThrough: handle.resolved.transparent && handle.resolved.opacity < SHADOW_OPACITY_MIN,
        ownedMaterial: null,
      });
      node.content.add(mesh);
    }
    this.applyShadowFlags(node);
  }

  /** Geometry bundle of a mounted mesh entity (editor overlays, picking), or null. */
  meshBundle(id: EntityId): MeshGeometryBundle | null {
    return this.nodes.get(id)?.meshBundle ?? null;
  }

  /**
   * Live preview of an editable mesh without a document change: overwrite
   * positions and/or vertex colours (same vertex count) of the mounted
   * geometry. Painting a mesh without colours switches its materials to
   * vertex colours once. Returns false when the preview cannot be applied
   * (unknown entity, not a mesh, size mismatch).
   */
  previewMesh(id: EntityId, positions: Float32Array | null, colors: Float32Array | null): boolean {
    const node = this.nodes.get(id);
    const bundle = node?.meshBundle;
    if (!node || !bundle) return false;
    if (!previewMeshGeometry(bundle, positions, colors)) return false;
    if (colors && node.bindings.some((b) => !b.hasColors)) {
      for (const b of node.bindings) b.hasColors = true;
      this.rematerial(node);
    }
    return true;
  }

  /** Mount one mesh (or instanced mesh) per generator part. */
  private mountOutput(node: EntityNode, keyed: KeyedOutput, doubleSided: boolean, instances?: InstancedBufferAttribute): void {
    const parts = keyed.output.parts;
    node.keyed = keyed;
    node.partCount = parts.length;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      let geometryKey: string;
      let mesh: Mesh;
      try {
        const g = this.opts.geometries.acquire(keyed.key, i, part);
        geometryKey = g.key;
        const hasColors = part.colors instanceof Float32Array && part.colors.length > 0;
        const handle = this.opts.materials.acquire(mergeMaterial(part.material, node.entity.material, parts.length), { hasVertexColors: hasColors, doubleSided }, this.variant);
        if (instances) {
          const im = new InstancedMesh(g.geometry, handle.material, 0);
          im.instanceMatrix = instances;
          im.count = instances.count;
          im.computeBoundingBox();
          im.computeBoundingSphere();
          im.raycast = noRaycast;
          mesh = im;
        } else {
          mesh = new Mesh(g.geometry, handle.material);
        }
        node.bindings.push({
          mesh,
          partMaterial: part.material,
          hasColors,
          doubleSided,
          materialKey: handle.key,
          seeThrough: handle.resolved.transparent && handle.resolved.opacity < SHADOW_OPACITY_MIN,
          ownedMaterial: null,
        });
      } catch (e) {
        this.warn(node.id, `invalid mesh part ${i}: ${errorMessage(e)}`);
        continue;
      }
      node.geometryKeys.push(geometryKey);
      mesh.matrixAutoUpdate = false;
      mesh.name = `${node.id}:part${i}`;
      node.content.add(mesh);
    }
    this.applyShadowFlags(node);
  }

  private mountPlaceholder(node: EntityNode): void {
    const mesh = new Mesh(this.placeholderGeometry, this.placeholderMaterial);
    mesh.name = 'placeholder';
    mesh.matrixAutoUpdate = false;
    node.content.add(mesh);
    node.placeholder = true;
  }

  private clearPlaceholder(node: EntityNode): void {
    if (!node.placeholder) return;
    for (const child of [...node.content.children]) if (child.name === 'placeholder') node.content.remove(child);
    node.placeholder = false;
  }

  /** Release everything mounted in `content` (geometry/material refs, model ref, instances). */
  private teardownContent(node: EntityNode): void {
    this.releaseRetired(this.detachContent(node));
  }

  /**
   * Remove everything mounted in `content` and reset the bookkeeping, returning
   * the still-retained resources. Pair with {@link releaseRetired}.
   */
  private detachContent(node: EntityNode): Retired {
    const retired: Retired = { materialKeys: [], geometryKeys: node.geometryKeys, owned: [], modelUrl: node.modelUrl, bundle: node.meshBundle };
    node.meshBundle = null;
    for (const b of node.bindings) {
      retired.materialKeys.push(b.materialKey);
      if (b.ownedMaterial) retired.owned.push(b.ownedMaterial);
      if (b.mesh instanceof InstancedMesh) b.mesh.dispose();
    }
    node.content.clear();
    node.bindings = [];
    node.geometryKeys = [];
    node.modelUrl = null;
    node.keyed = null;
    node.partCount = 0;
    node.placeholder = false;
    node.failed = false;
    this.totalInstances -= node.instances;
    node.instances = 0;
    this.totalScatterTriangles -= node.scatterTriangles;
    node.scatterTriangles = 0;
    node.instanceMatrix = null;
    this.surfaceGrids.delete(node.id);
    return retired;
  }

  private releaseRetired(r: Retired): void {
    for (const m of r.owned) m.dispose();
    for (const k of r.materialKeys) this.opts.materials.release(k);
    for (const k of r.geometryKeys) this.opts.geometries.release(k);
    if (r.modelUrl !== null) this.opts.models?.release(r.modelUrl);
    r.bundle?.dispose();
    r.bundle = null;
    r.owned = [];
    r.materialKeys = [];
    r.geometryKeys = [];
    r.modelUrl = null;
  }

  /**
   * Runtime material override that only touches uniforms: the first call gives
   * each binding a private material clone, later calls mutate it in place.
   */
  private setLiveMaterial(node: EntityNode, field: string, value: Json): boolean {
    // `field`/`value` were validated against the MaterialSpec rules by the caller.
    const material = { ...node.entity.material, [field]: value } as MaterialSpec;
    node.entity = { ...node.entity, material };
    node.overridden = true;
    for (const b of node.bindings) {
      const resolved = resolveMaterial(mergeMaterial(b.partMaterial, material, node.partCount), {
        hasVertexColors: b.hasColors,
        doubleSided: b.doubleSided,
      });
      let owned = b.ownedMaterial;
      if (!owned) {
        owned = createMaterial(resolved, this.variant, this.opts.materials.surfaces);
        if (field === 'opacity' && !owned.transparent) {
          // Opacity animations blend from the start so the program never flips per tick.
          owned.transparent = true;
          owned.depthWrite = false;
        }
        b.ownedMaterial = owned;
        b.mesh.material = owned;
      }
      applyLiveUniforms(owned, resolved);
      b.seeThrough = resolved.transparent && resolved.opacity < SHADOW_OPACITY_MIN;
    }
    this.applyShadowFlags(node);
    return true;
  }

  /** Re-derive materials after an entity material change (geometry is kept). */
  private rematerial(node: EntityNode): void {
    for (const b of node.bindings) {
      if (b.ownedMaterial) {
        b.ownedMaterial.dispose();
        b.ownedMaterial = null;
      }
      const handle = this.opts.materials.acquire(
        mergeMaterial(b.partMaterial, node.entity.material, node.partCount),
        { hasVertexColors: b.hasColors, doubleSided: b.doubleSided },
        this.variant,
      );
      this.opts.materials.release(b.materialKey);
      b.materialKey = handle.key;
      b.mesh.material = handle.material;
      b.seeThrough = handle.resolved.transparent && handle.resolved.opacity < SHADOW_OPACITY_MIN;
    }
    this.applyShadowFlags(node);
  }

  private applyShadowFlags(node: EntityNode): void {
    const standard = this.variant === 'standard';
    // Dense scatter layers (grass, pebbles) would double their draw cost in the shadow pass.
    const shadowCaster = node.instances <= SCATTER_SHADOW_MAX_INSTANCES;
    for (const b of node.bindings) {
      b.mesh.castShadow = standard && shadowCaster && node.entity.castShadow && !b.seeThrough;
      b.mesh.receiveShadow = standard && node.entity.receiveShadow;
    }
  }

  private syncLight(node: EntityNode, before: Entity | undefined): void {
    const spec = node.entity.light;
    const old = before?.light;
    if (this.variant !== 'standard') return;
    if (node.light && spec && old && old.type === spec.type && old.range === spec.range && old.angle === spec.angle && old.castShadow === spec.castShadow) {
      updateLightParams(node.light.light, spec);
      return;
    }
    if (node.light) {
      disposeEntityLight(node.light);
      node.light = null;
    }
    if (spec) {
      node.light = createEntityLight(spec);
      node.object.add(node.light.light);
      if (node.light.target) node.object.add(node.light.target);
    }
    this.lightsDirty = true;
  }

  private applyShadowCap(): void {
    this.lightsDirty = false;
    const candidates: Array<{ id: string; light: Light; wants: boolean }> = [];
    for (const n of this.nodes.values()) if (n.light) candidates.push({ id: n.id, light: n.light.light, wants: n.entity.light?.castShadow === true });
    enforceShadowCap(candidates);
  }

  // -------------------------------------------------------------------------
  // Scatter surfaces
  // -------------------------------------------------------------------------

  private contentChanged(node: EntityNode): void {
    this.opts.onContentChanged?.(node.id);
    if (!this.batching && node.entity.shape.kind !== 'scatter' && this.dependents.has(node.id)) this.relayoutDependents(new Set([node.id]), []);
  }

  /**
   * Rebuild surface-bound scatters (unless already building) whose surface is
   * in `changed`, or that moved themselves.
   */
  private relayoutDependents(changed: ReadonlySet<EntityId>, started: Promise<void>[]): void {
    if (changed.size === 0) return;
    const queued = new Set<EntityId>();
    const consider = (id: EntityId): void => {
      if (queued.has(id)) return;
      const n = this.nodes.get(id);
      if (!n) return;
      const s = n.entity.shape;
      if (s.kind !== 'scatter' || !s.onSurface || n.pending) return;
      queued.add(id);
      started.push(this.rebuild(n));
    };
    for (const id of changed) {
      consider(id);
      const deps = this.dependents.get(id);
      if (deps) for (const dep of [...deps]) consider(dep);
    }
  }

  /**
   * Height sampler mapping scatter-local (x, z) to scatter-local y on the
   * surface entity, mirroring physics: a vertical ray at the instance's
   * world (x, z), result converted back with the scatter's position/scale.
   */
  private surfaceSampler(node: EntityNode, surfaceId: EntityId): SurfaceSampler | undefined {
    const surface = this.nodes.get(surfaceId);
    if (!surface || surface === node || !surface.keyed || surface.entity.shape.kind === 'scatter') {
      this.warn(node.id, `onSurface "${surfaceId}" has no surface geometry; instances placed at y=0`);
      return undefined;
    }
    surface.object.updateWorldMatrix(true, false);
    node.object.updateWorldMatrix(true, false);
    const sm = surface.object.matrixWorld.elements;
    const stamp = `${surface.keyed.key}|${Array.prototype.join.call(sm, ',')}`;
    let cached = this.surfaceGrids.get(surfaceId);
    if (!cached || cached.stamp !== stamp) {
      const meshes = surface.keyed.output.parts.map((p) => ({ positions: transformPositions(p.positions, sm), indices: p.indices }));
      cached = { stamp, grid: buildHeightGrid(meshes) };
      this.surfaceGrids.set(surfaceId, cached);
    }
    const grid = cached.grid;
    if (!grid) return undefined;
    const pos = new Vector3();
    const quat = new Quaternion();
    const scale = new Vector3();
    node.object.matrixWorld.decompose(pos, quat, scale);
    const sy = scale.y === 0 ? 1 : scale.y;
    return (lx: number, lz: number): number => {
      _v.set(lx * scale.x, 0, lz * scale.z).applyQuaternion(quat);
      const h = grid.sample(_v.x + pos.x, _v.z + pos.z);
      return h === h ? (h - pos.y) / sy : Number.NaN;
    };
  }
}
