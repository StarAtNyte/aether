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
import { accelerateRaycast } from '../geometry/raycast-bvh';
import { StaticBatches } from './static-batches';
import { AssetInstances, assetInstancesEnabled } from './asset-instances';
import type { LightmapSource } from './lightmap-uv';
import { COPY_CELL, StaticMerges } from './static-merges';
import {
  Box3,
  BoxGeometry,
  Group,
  Frustum,
  InstancedBufferAttribute,
  InstancedMesh,
  LOD,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Sphere,
  StaticDrawUsage,
  Vector3,
  type BufferGeometry,
  type Light,
  type Material,
  type Object3D,
  type PerspectiveCamera,
  type Ray,
} from 'three';
import {
  decodeMeshCached,
  deepEqual,
  diffWorlds,
  type Entity,
  type EntityId,
  type Json,
  type LightSpec,
  type MaterialSpec,
  type AssetShape,
  type ProceduralShape,
  type ScatterShape,
  type ShapeSpec,
  type TextureRef,
  type WorldDoc,
} from '@aether/core';
import type { GeneratorOutput, GeometrySource, KeyedOutput, MeshPart } from '../types';
import { SPLIT_SOURCE_KEY, type GeometryCache } from '../geometry/buffer-geometry';
import type { MaterialCache } from '../materials/material-cache';
import { FINISHES } from '@aether/arch';
import { finishAlbedoScale } from '@aether/procgen';
import { mergeMaterial, resolveMaterial, type MaterialVariant, type ResolvedMaterial } from '../materials/presets';
import { softenKeyed } from '../geometry/soften';
import { FINISH_NODES_KEY } from '../materials/anti-tile';
import { FOLIAGE_GENERATORS } from '../materials/wind';
import { WATER_SHADER_KEY } from '../materials/water';
import { createMaterial, WATER_KEY } from '../materials/material-cache';
import { disposeModelInstance, instantiateAsset, instantiateModel, type ModelCache } from '../geometry/model-loader';
import { createPoster, shareMaterials, type TextureCache } from '../geometry/poster';
import type { AssetAnimator } from './asset-animator';
import { isVehicleModel, VehicleRig } from './vehicle-rig';
import type { CharacterSystem } from '../characters/system';
import { resolveLook } from '@aether/assets';
import { assetInfo, effectiveAssetId, fitScale, loadCatalog, lodDistances, type AssetInfo } from '@aether/assets';
import { buildHeightGrid, transformPositions, type HeightGrid } from '../geometry/height-grid';
import { composeScatterMatrices, composeScatterPacked, MAX_SCATTER_INSTANCES, primitiveLift, scatterPlacements, type SurfaceSampler } from '../geometry/scatter';
import { ScatterField, FIELD_MIN_INSTANCES, fieldChunkSize, isFieldLayer } from '../virtual/scatter-field';
import { buildChunks, CHUNK_INSTANCES } from '../virtual/field-culler';
import { createLocalView, localView } from '../virtual/view';
import { DagClient, type DagClientOptions } from '../virtual/dag-client';
import { isKitOfPieces, mirror, VirtualGroup, VIRTUAL_MIN_TRIANGLES } from '../virtual/virtual-mesh';
import { BATCHED_LAYER } from './static-batches';
import { CellShadowBatches, plainCasterMaterial, plainCasterMesh, type ShadowCandidate } from './cell-shadow-batches';
import { VirtualCellBatches, type VirtualBatchMember } from '../virtual/virtual-cell-batch';
import { assignCell, partitionFor } from '../streaming/cell-grid';
import { DEFAULT_FIELD_BUDGET, LodChainCache, lodOutputKey, lodPart, outputRadius, shareDemand, type FieldBudget } from './field-mount';
import { buildMeshGeometry, previewMeshGeometry, type MeshGeometryBundle } from '../geometry/mesh-asset';
import { meshColliders, yieldToEventLoop } from '@aether/procgen';
import { areaLightsReady, chooseForwardLights, createEntityLight, disposeEntityLight, enforceShadowCap, LAMP_CUTOFF, loadAreaLights, updateLightParams, type BudgetLight } from './lights';
import { createEntityNode, ENTITY_ID_KEY, type EntityNode, type MeshBinding } from './entity-node';
import { renderableIds } from './renderable';
import { TERRAIN_RENDER_ORDER } from '../gpu/render-order';
import { withWaterKind } from './water-surfaces';
import { OccluderGrid, partBounds, posesFromMatrices } from '../view/occluders';
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
  /** Image textures for imported posters (asset shapes of user images). */
  textures?: TextureCache;
  /** Asked when a library model mounts: true loads its light copy (256 px textures) instead of the full file, for the low tiers. */
  liteModels?: () => boolean;
  /** 'ghost' renders translucent previews: no lights, no shadows. */
  variant?: MaterialVariant;
  /** Total instance budget (default {@link DEFAULT_MAX_INSTANCES}). */
  maxInstances?: number;
  /** Total scatter triangle budget (default {@link DEFAULT_MAX_SCATTER_TRIANGLES}). */
  maxScatterTriangles?: number;
  /** Called after any entity's content (geometry/bounds) changed. */
  onContentChanged?: (id: EntityId) => void;
  /** A background merge completed or needs another preparation pass. */
  onBatchesChanged?: () => void;
  /** Draw identical static props as instanced batches (default true; never for the ghost variant). */
  staticBatching?: boolean;
  /** Off-thread merges; the host must hold drawing while batchPreparationPending is nonzero (WorldRenderer does). */
  backgroundMerges?: boolean;
  /**
   * Per-cell shadow batches (see `cell-shadow-batches.ts`; default on with static batching). `layers`: the layer masks a
   * batched caster may have (a mesh culled from the view by distance keeps casting from its batch); `budgetMs`: main-thread
   * time a frame may spend building batches.
   */
  cellShadows?: false | { layers?: readonly number[]; budgetMs?: () => number };
  /** The scene's people: entities with `character` show a cast member instead of their shape. */
  characters?: CharacterSystem;
  /**
   * Huge scatter layers (≥ {@link FIELD_MIN_INSTANCES}) become culled, LOD'd
   * instance fields with these budgets (default {@link DEFAULT_FIELD_BUDGET});
   * `false` keeps every layer a plain instanced mesh.
   */
  fields?: FieldBudget | false;
  /**
   * Parts with ≥ {@link VIRTUAL_MIN_TRIANGLES} triangles are drawn as
   * virtual geometry (cluster LOD DAG, built in a worker) within this
   * per-mesh triangle budget; `false` draws them as plain meshes.
   */
  virtual?: { triangles: number; dag?: DagClientOptions } | false;
}

/** Minimum interval between view re-plans while the camera keeps moving (ms). */
export const VIEW_INTERVAL_MS = 120;
/** The same while the frame is drawn at a reduced scale and every millisecond counts: LOD and culling lag a little more behind a moving camera. */
export const VIEW_INTERVAL_SCALED_MS = 280;

/** Default virtual-geometry budget: triangles one unique mesh may draw over all its instances. */
export const DEFAULT_VIRTUAL_TRIANGLES = 1_500_000;

// Scratch objects (no per-frame allocations in applyTransforms).
const _inv = new Matrix4();
const _pPos = new Vector3();
const _pScale = new Vector3();
const _q = new Quaternion();
const _v = new Vector3();
const _box = new Box3();
const _box2 = new Box3();
const _occOut = new Float64Array(1);

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
  releases: Array<() => void>;
}

/** Key under `Mesh.userData` holding the global triangle index of each local triangle (mesh shapes). */
export const MESH_TRIANGLES_KEY = 'aetherTriangles';

/** Mounting generated content runs in slices of about this long before yielding to the page (ms). */
const MOUNT_SLICE_MS = 12;

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
  // Textured finishes store albedo / roughness relative to the finish (see `applyFinish`).
  if (r.finish && (m.map || m.userData[FINISH_NODES_KEY])) {
    const def = FINISHES[r.finish];
    m.color.multiplyScalar(finishAlbedoScale(def));
    m.roughness = Math.min(3, r.roughness / Math.max(0.01, def.roughness));
  }
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

function visibleChain(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

function finite3(v: readonly number[], fallback: number): [number, number, number] {
  const f = (x: number | undefined): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
  return [f(v[0]), f(v[1]), f(v[2])];
}

/** Incremental scene synchronizer. See the module docs. */
/** Largest share of the field instance budget one scatter field may take. */
export const MAX_FIELD_SHARE = 0.45;

export class SceneSync {
  /** Parent of every entity object. Keep it untransformed (identity). */
  readonly root = new Group();
  private readonly nodes = new Map<EntityId, EntityNode>();
  private readonly inflight = new Set<Promise<void>>();
  private readonly warnings = new Map<EntityId, string>();
  private readonly surfaceGrids = new Map<EntityId, { stamp: string; grid: HeightGrid | null }>();
  /** Coarse view occluders of tall scatter layers (forests), which are never raycast per instance (see `occluders.ts`). */
  private readonly occluders = new Map<EntityNode, OccluderGrid>();
  /** `occluders` as parallel arrays: iterating a Map allocates an entry per step, and this runs per boom ray. */
  private occluderNodes: EntityNode[] = [];
  private occluderGrids: OccluderGrid[] = [];
  /** Surface entity id → ids of scatters placed on it (O(1) dependent lookup). */
  private readonly dependents = new Map<EntityId, Set<EntityId>>();
  private readonly variant: MaterialVariant;
  private readonly maxInstances: number;
  private readonly maxScatterTriangles: number;
  private totalScatterTriangles = 0;
  private readonly placeholderGeometry: BoxGeometry;
  private readonly placeholderMaterial: MeshStandardMaterial;
  private current: WorldDoc | null = null;
  /** Intensity factor of architectural lamps (daylight dimming, see `daylightLampFactor`). */
  private archLampScale = 1;
  private totalInstances = 0;
  private lightsDirty = false;
  /** Every entity light now in the scene graph (lit or not), for the renderer's lamp slots (see `LampSlots`). */
  readonly lights: Light[] = [];
  /** Shadowless point lights on the world's templates: lamps a game may spawn copies of (spare lamp slots). */
  templateLamps = 0;
  /** Most local lights drawn live (the rest stay in the baked volume); see {@link FORWARD_LIGHTS}. */
  private lightBudget = Number.POSITIVE_INFINITY;
  /** True while setWorld rebuilds: dependent scatter relayout is deferred to one pass. */
  private batching = false;
  private disposed = false;
  /** Where generation is ordered from, nearest first (the opening view or the camera); null: document order. */
  private generationFocus: readonly [number, number, number] | null = null;
  /** Instanced batches of identical static props (null when disabled). */
  private readonly batches: StaticBatches | null;
  /** Instanced copies of static library models (null when off, see asset-instances.ts). */
  private readonly assetInstances: AssetInstances | null;
  /** Content changed since the batches were grouped. */
  private batchesStale = true;
  /** Merged building geometry (null when batching is disabled). */
  private readonly merges: StaticMerges | null;
  /** Static shadow casters merged per grid cell (null when disabled). */
  private readonly cellShadows: CellShadowBatches | null;
  /** Virtual stand-ins of one cell and material drawn as one mesh (null when disabled). */
  private readonly virtualBatches: VirtualCellBatches | null;
  /** Virtual-group key of each stand-in mesh. */
  private readonly virtualKeys = new WeakMap<Mesh, string>();
  /** Content changed since the shadow batches were grouped, and when it last did (ms). */
  private cellShadowsStale = true;
  private cellShadowsAt = 0;
  /** Merging paused (e.g. while content grows in and every matrix changes). */
  private mergesSuspended = false;
  /** Field budgets (null: fields disabled). */
  private readonly fieldBudget: FieldBudget | null;
  /** Nodes currently showing a scatter field. */
  private readonly fieldNodes = new Set<EntityNode>();
  private fieldInstances = 0;
  private readonly lodChains = new LodChainCache();
  /** A field was mounted or rebalanced since the last {@link updateView}. */
  private viewDirty = false;
  /** Time of the last unthrottled view update (ms; 0 = never). */
  private lastViewUpdate = 0;
  private readonly view = createLocalView();
  /** Virtual geometry (null: disabled). */
  private readonly dags: DagClient | null;
  private readonly virtualTriangles: number;
  private readonly virtualGroups = new Map<string, { group: VirtualGroup; refs: number }>();
  /** Locomotion / clip playback of animated assets (loaded with the first animated model). */
  private animatorRef: AssetAnimator | null = null;
  private animatorLoad: Promise<AssetAnimator> | null = null;
  /** Wheels, steering and body sway of modelled vehicles. */
  private readonly vehicles = new VehicleRig();
  /** Per-entity clones of the "paint" materials of tinted vehicles (disposed with the content). */
  private readonly paintClones = new Map<string, Material[]>();

  private loadAnimator(): Promise<AssetAnimator> {
    this.animatorLoad ??= import('./asset-animator').then((m) => (this.animatorRef = new m.AssetAnimator()));
    return this.animatorLoad;
  }

  /** Current gait of an animated asset entity, or null. */
  gaitOf(id: EntityId): 'idle' | 'walk' | 'run' | null {
    return this.animatorRef?.gaitOf(id) ?? null;
  }

  /** Number of animated asset entities. */
  get animatedCount(): number {
    return this.animatorRef?.size ?? 0;
  }

  constructor(private readonly opts: SceneSyncOptions) {
    this.variant = opts.variant ?? 'standard';
    this.maxInstances = Math.max(0, opts.maxInstances ?? DEFAULT_MAX_INSTANCES);
    this.maxScatterTriangles = Math.max(0, opts.maxScatterTriangles ?? DEFAULT_MAX_SCATTER_TRIANGLES);
    this.root.name = this.variant === 'ghost' ? 'aether:ghost' : this.variant === 'proof' ? 'aether:proof-ghosts' : 'aether:entities';
    this.placeholderGeometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.placeholderMaterial = new MeshStandardMaterial({ color: '#9aa4b2', roughness: 0.9, transparent: true, opacity: 0.35, depthWrite: false });
    this.batches = this.variant === 'standard' && opts.staticBatching !== false ? new StaticBatches(this.root) : null;
    this.merges = this.variant === 'standard' && opts.staticBatching !== false ? new StaticMerges({ background: opts.backgroundMerges === true, changed: opts.onBatchesChanged }) : null;
    const merges = this.merges;
    this.assetInstances = this.variant === 'standard' && opts.staticBatching !== false && assetInstancesEnabled() ? new AssetInstances(this.root, (mesh) => merges?.has(mesh) === true) : null;
    const cells = opts.cellShadows ?? {};
    this.cellShadows = this.variant === 'standard' && opts.staticBatching !== false && cells !== false && (globalThis as { __AETHER_CELL_SHADOWS?: boolean }).__AETHER_CELL_SHADOWS !== false
      ? new CellShadowBatches(this.root, { intactLayers: cells.layers, changed: opts.onBatchesChanged }) : null;
    this.virtualBatches = this.cellShadows && opts.virtual !== false && (globalThis as { __AETHER_CELL_VIRTUAL?: boolean }).__AETHER_CELL_VIRTUAL !== false
      ? new VirtualCellBatches(this.root, {
        setBatched: (mesh, on) => {
          const key = this.virtualKeys.get(mesh);
          if (key !== undefined) this.virtualGroups.get(key)?.group.setBatched(mesh, on);
        },
        hiddenLayer: BATCHED_LAYER,
        // A member left or joined a batch: plan the cuts again on the next frame, unthrottled.
        changed: () => { this.lastViewUpdate = 0; this.viewDirty = true; opts.onBatchesChanged?.(); },
      }) : null;
    this.fieldBudget = this.variant === 'standard' && opts.fields !== false ? (opts.fields ?? DEFAULT_FIELD_BUDGET) : null;
    const virtual = this.variant === 'standard' && opts.virtual !== false ? (opts.virtual ?? { triangles: DEFAULT_VIRTUAL_TRIANGLES }) : null;
    this.dags = virtual ? new DagClient(virtual.dag) : null;
    this.virtualTriangles = virtual ? Math.max(3, virtual.triangles) : 0;
  }

  /** Whether a scatter field needs a view update even if the camera did not move. */
  get viewNeedsUpdate(): boolean {
    return this.viewDirty;
  }

  /**
   * Re-plan every scatter field and virtual-geometry cut for `camera` (call
   * before drawing whenever the camera moved or {@link viewNeedsUpdate});
   * `heightPx` is the drawing-buffer height. With `nowMs` (frame time) the
   * re-plan is throttled to one per {@link VIEW_INTERVAL_MS}; 0 forces it
   * (captures). Returns true when instance or index buffers changed.
   * Allocation-free.
   */
  updateView(camera: PerspectiveCamera, heightPx: number, nowMs = 0, intervalMs = VIEW_INTERVAL_MS): boolean {
    // While the camera moves, re-plan at most every VIEW_INTERVAL_MS (uploads dominate on
    // slow GPUs); the skipped frame leaves the view dirty so the last pose is always planned.
    if (nowMs > 0 && nowMs - this.lastViewUpdate < intervalMs && this.lastViewUpdate > 0) {
      this.viewDirty = true;
      return false;
    }
    this.lastViewUpdate = nowMs;
    this.viewDirty = false;
    let changed = false;
    for (const { group } of this.virtualGroups.values()) if (group.update(camera, heightPx)) changed = true;
    const vb = this.virtualBatches;
    if (vb && vb.count > 0 && vb.update(camera, heightPx, this.shadowCovered)) changed = true;
    if (this.fieldNodes.size === 0) return changed;
    for (const node of this.fieldNodes) {
      const field = node.field;
      if (!field || !node.object.visible) continue;
      field.group.updateWorldMatrix(true, false);
      if (field.update(localView(camera, field.group, heightPx, this.view))) changed = true;
    }
    return changed;
  }

  /** Field statistics: instances held, drawn this frame, triangles drawn. */
  fieldStats(): { fields: number; instances: number; drawnInstances: number; drawnTriangles: number } {
    let drawnInstances = 0;
    let drawnTriangles = 0;
    for (const node of this.fieldNodes) {
      if (!node.field || !node.object.visible) continue;
      drawnInstances += node.field.culler.drawnInstances;
      drawnTriangles += node.field.culler.drawnTriangles;
    }
    return { fields: this.fieldNodes.size, instances: this.fieldInstances, drawnInstances, drawnTriangles };
  }

  /** True while any scatter field or virtual-geometry mesh is mounted. */
  get scaleGeometryActive(): boolean {
    return this.fieldNodes.size > 0 || this.virtualGroups.size > 0;
  }

  /** Virtual-geometry statistics: unique meshes, instances, source and drawn triangles. */
  virtualStats(): { meshes: number; instances: number; sourceTriangles: number; drawnTriangles: number } {
    let instances = 0;
    let sourceTriangles = 0;
    let drawnTriangles = 0;
    for (const { group } of this.virtualGroups.values()) {
      instances += group.size;
      sourceTriangles += group.dag.baseTriangles * group.size;
      drawnTriangles += group.drawnTriangles;
    }
    return { meshes: this.virtualGroups.size, instances, sourceTriangles, drawnTriangles };
  }

  /**
   * Triangles the scene represents at full detail: every mesh part, every
   * scatter instance (instances × triangles per instance) and editable
   * meshes. Compare with the renderer's drawn triangles. Not per frame.
   */
  sceneTriangles(): number {
    let total = 0;
    for (const node of this.nodes.values()) {
      if (!node.object.visible) continue;
      if (node.meshBundle) {
        total += node.meshBundle.triangleCount;
        continue;
      }
      if (!node.keyed) continue;
      let tris = 0;
      for (const part of node.keyed.output.parts) tris += Math.floor(part.indices.length / 3);
      total += node.entity.shape.kind === 'scatter' ? tris * node.instances : tris;
    }
    return total;
  }

  /**
   * Prepare the static-prop batches for a frame: regroup when content
   * changed, then copy member transforms. Call with current world matrices
   * (`scene.updateMatrixWorld()`), right before drawing. Allocation-free
   * unless a regroup happens.
   * @returns true when an instance changed
   */
  updateBatches(): boolean {
    const b = this.batches;
    if (!b) return false;
    let regrouped = false;
    const stale = this.batchesStale;
    if (this.batchesStale || b.needsRebuild) {
      this.batchesStale = false;
      regrouped = b.rebuild(this.nodes.values());
    }
    const moved = b.count > 0 ? b.update() : false;
    let merged = false;
    const m = this.merges;
    let mergesRegrouped = false;
    if (m && !this.mergesSuspended) {
      if (stale || this.mergesPending) {
        this.mergesPending = false;
        merged = m.rebuild(this.nodes.values());
        mergesRegrouped = true;
      }
      if ((m.count > 0 || m.pending > 0) && m.update()) merged = true;
    }
    // After the merges: library-model meshes they merge stay theirs (see asset-instances.ts).
    const ai = this.assetInstances;
    if (ai && (stale || mergesRegrouped || ai.needsRebuild) && ai.rebuild(this.nodes.values())) regrouped = true;
    return this.updateCellShadows(stale || regrouped || merged) || regrouped || moved || merged;
  }

  /** A stand-in whose sun shadow comes from a ready shadow batch (its view cut may then cull). */
  private readonly shadowCovered = (mesh: Mesh): boolean => this.cellShadows?.skips(mesh) === true;

  /** Quiet time after a content change before the shadow casters are grouped again (ms). */
  private static readonly CELL_REGROUP_MS = 300;

  /** Evict changed shadow-batch members, regroup after content changes, build due cells. True when a frame is needed. */
  private updateCellShadows(contentChanged: boolean): boolean {
    const cs = this.cellShadows;
    if (!cs) return false;
    const t = performance.now();
    const vb = this.virtualBatches;
    if (contentChanged || cs.rescanNeeded || vb?.rescanNeeded) {
      cs.rescanNeeded = false;
      if (vb) vb.rescanNeeded = false;
      this.cellShadowsStale = true;
      this.cellShadowsAt = t;
    }
    let changed = cs.update(contentChanged || this.cellShadowsFull > 0);
    if (vb?.verify()) changed = true;
    // Not while merges are suspended (content growing in) or members still prepare in the background.
    if (this.cellShadowsStale && !this.mergesSuspended && (this.merges?.pending ?? 0) === 0 && t - this.cellShadowsAt >= SceneSync.CELL_REGROUP_MS) {
      this.cellShadowsStale = false;
      cs.rebuild(this.shadowCandidates());
      const grid = cs.grid;
      if (vb && grid) {
        vb.rebuild(this.virtualCandidates(), (source) => {
          const g = source.geometry;
          if (!g.boundingSphere) g.computeBoundingSphere();
          if (!g.boundingSphere) return null;
          const s = _cellSphere.copy(g.boundingSphere).applyMatrix4(source.matrixWorld);
          return assignCell(grid, s.center.x, s.center.z, s.radius * 2);
        });
      }
    }
    const budget = Math.max(1, Math.min(8, this.opts.cellShadows ? this.opts.cellShadows.budgetMs?.() ?? 4 : 4));
    if (cs.pending > 0 && cs.pump(budget)) changed = true;
    if (vb && vb.pending > 0 && vb.pump(budget)) changed = true;
    return changed;
  }

  /**
   * Fix the world's grid from its top-level entities' positions the first time a world is set (stage 4b streams the same
   * cells): copies merge per grid cell, and the shadow and virtual batches group by it.
   */
  private ensurePartition(world: WorldDoc): void {
    if (!this.cellShadows || this.cellShadows.grid) return;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const id in world.entities) {
      const e = world.entities[id];
      if (!e || e.template || e.parent) continue;
      const p = e.transform.position;
      const x = Number(p[0]), z = Number(p[2]);
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    if (!(maxX >= minX)) return;
    const grid = partitionFor([minX, minZ], [maxX, maxZ]);
    this.cellShadows.setPartition(grid);
    if (this.merges && this.merges.copyCell !== Math.max(COPY_CELL, grid.cellSize)) {
      this.merges.copyCell = Math.max(COPY_CELL, grid.cellSize);
      this.batchesStale = true;
    }
  }

  /** Virtual stand-ins of static entities, offered to the view batches. */
  private *virtualCandidates(): Iterable<VirtualBatchMember> {
    for (const node of this.nodes.values()) {
      if (node.virtual.length === 0 || !staticCaster(node)) continue;
      for (const v of node.virtual) {
        const dag = this.virtualGroups.get(v.key)?.group.dag;
        if (dag) yield { mesh: v.mesh, source: v.source, dag, id: node.id };
      }
    }
  }

  /** The meshes the sun's depth pass draws for static entities, with their owners (see CellShadowBatches). */
  private *shadowCandidates(): Iterable<ShadowCandidate> {
    for (const node of this.nodes.values()) {
      if (!staticCaster(node)) continue;
      // Virtual stand-ins cast with their source's flags (a stand-in drawn by a view batch is not mirrored any more).
      for (const v of node.virtual) {
        const dag = this.virtualGroups.get(v.key)?.group.dag;
        if (dag && v.source.castShadow && plainCasterMesh(v.mesh) && plainCasterMaterial(v.source.material as Material)) yield { mesh: v.mesh, id: node.id, virtual: { dag, source: v.source } };
      }
      const stack: Object3D[] = [...node.content.children];
      while (stack.length > 0) {
        const o = stack.pop() as Object3D;
        for (const c of o.children) stack.push(c);
        const mesh = o as Mesh;
        if (mesh.isMesh !== true || !mesh.castShadow || mesh.name.endsWith(':virtual') || !plainCasterMesh(mesh)) continue;
        // Instanced copies cast as their instanced mesh.
        if (this.assetInstances?.owns(mesh)) continue;
        yield { mesh, id: node.id };
      }
    }
    if (this.merges) for (const mesh of this.merges.meshes()) if (mesh.castShadow && plainCasterMesh(mesh)) yield { mesh, id: this.idOf(mesh.parent) };
  }

  /** Static shadow batches (null when disabled), for the renderer's shadow-pass skip test. */
  get cellShadowBatches(): CellShadowBatches | null {
    return this.cellShadows;
  }

  /** Keep the selected entities' casters out of the shadow batches while selected (they cast as live meshes). */
  pinCellShadows(ids: Iterable<EntityId>): void {
    const list = [...ids];
    this.cellShadows?.pin(list);
    this.virtualBatches?.pin(list);
  }

  /** Virtual view batches (diagnostics, tests). */
  get virtualCellBatches(): VirtualCellBatches | null {
    return this.virtualBatches;
  }

  /** A regroup of the merges is due when merging resumes. */
  private mergesPending = true;

  get batchPreparationPending(): number { return this.merges?.pending ?? 0; }

  /** Merge drawers, doors and switches while idle (see `StaticMerges.interactive`); regroups when it changes. */
  setInteractiveMerges(on: boolean): void {
    if (!this.merges || this.merges.interactive === on) return;
    this.merges.interactive = on;
    this.batchesStale = true;
  }
  async waitForBatches(): Promise<void> { await this.merges?.idle(); }
  synchronousBatches<T>(draw: () => T): T {
    // A capture checks every shadow-batch member (no rotating share).
    this.cellShadowsFull++;
    try { return this.merges ? this.merges.synchronous(draw) : draw(); } finally { this.cellShadowsFull--; }
  }
  private cellShadowsFull = 0;

  /**
   * Pause or resume building merges. While paused (content growing in, every
   * matrix animating) members draw themselves; resuming regroups.
   */
  setMergesSuspended(on: boolean): void {
    if (on === this.mergesSuspended) return;
    this.mergesSuspended = on;
    if (on) this.merges?.clear();
    this.mergesPending = true;
  }

  /** Whether {@link updateBatches} has work (batches exist or a regroup is pending). */
  get batchesActive(): boolean {
    const merging = this.merges !== null && !this.mergesSuspended && (this.mergesPending || this.merges.count > 0 || this.merges.pending > 0);
    const cells = this.cellShadows !== null && (this.cellShadowsStale || this.cellShadows.count > 0 || this.cellShadows.pending > 0 || (this.virtualBatches?.count ?? 0) > 0);
    const instances = this.assetInstances !== null && (this.assetInstances.count > 0 || this.assetInstances.needsRebuild);
    return (this.batches !== null && (this.batchesStale || this.batches.count > 0 || this.batches.needsRebuild)) || merging || cells || instances;
  }

  /** Merged building geometry carries the baked lightmap coordinates `source` gives (null: none). */
  setLightmapSource(source: LightmapSource | null): void {
    this.merges?.setLightmap(source);
  }

  /** Static-prop batches / building merges and the draw calls they save per pass. */
  batchStats(): { batches: number; drawCallsSaved: number; merges: number; assetInstances: number } {
    return { batches: this.batches?.count ?? 0, drawCallsSaved: (this.batches?.drawCallsSaved ?? 0) + (this.merges?.drawCallsSaved ?? 0) + (this.assetInstances?.drawCallsSaved ?? 0), merges: this.merges?.count ?? 0, assetInstances: this.assetInstances?.count ?? 0 };
  }

  /** Per-cell shadow and virtual batches and the draws they save per pass (see cell-shadow-batches, virtual-cell-batch). */
  cellBatchStats(): { shadowBatches: number; shadowDrawsSaved: number; virtualBatches: number; virtualDrawsSaved: number; cellSize: number | null } {
    return { shadowBatches: this.cellShadows?.count ?? 0, shadowDrawsSaved: this.cellShadows?.saved ?? 0,
      virtualBatches: this.virtualBatches?.count ?? 0, virtualDrawsSaved: this.virtualBatches?.saved ?? 0, cellSize: this.cellShadows?.grid?.cellSize ?? null };
  }

  /** The last world passed to {@link setWorld}. */
  get world(): WorldDoc | null {
    return this.current;
  }

  /** Number of entity nodes (document + transient). */
  get entityCount(): number {
    return this.nodes.size;
  }

  /** Total scatter instances currently mounted (plain instanced layers and fields). */
  get instanceCount(): number {
    return this.totalInstances + this.fieldInstances;
  }

  /** Object3D of an entity. */
  object(id: EntityId): Object3D | undefined {
    return this.nodes.get(id)?.object;
  }

  /** Bookkeeping node of an entity (read-only use: debug overlays, tests). */
  /** Merged meshes of room contents (see StaticMerges.interiorMeshes). */
  mergedInteriors(): Iterable<Mesh> {
    return this.merges ? this.merges.interiorMeshes() : [];
  }

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

  /** No build or model load is in flight. */
  get idle(): boolean {
    return this.inflight.size === 0 && this.batchPreparationPending === 0;
  }

  /** Resolves when every in-flight build (including model loads) settled. */
  async whenIdle(): Promise<void> {
    while (!this.idle) await Promise.allSettled([...this.inflight, this.waitForBatches()]);
  }

  /**
   * Synchronize to `world`. Structural changes happen synchronously; the
   * returned promise settles when procedural generation started by this call
   * finished (model downloads continue in the background, see {@link whenIdle}).
   */
  /** Texture skins of a piece: the world's own (a finish drawn with a texture set everywhere), with the piece's skins winning. */
  private skinsFor(entity: Entity): Readonly<Record<string, TextureRef>> | undefined {
    const all = this.current?.skins;
    const own = entity.arch?.skins;
    if (!all) return own;
    const world = this.worldSkins(all, entity.shape.kind === 'procedural' ? entity.shape.generator : '');
    return own ? { ...world, ...own } : world;
  }

  /** The world skins that apply to pieces of one generator (`finish@generator` keys only there), cached per world and generator. */
  private worldSkins(all: Readonly<Record<string, TextureRef>>, generator: string): Readonly<Record<string, TextureRef>> {
    if (this.skinCacheOf !== all) {
      this.skinCacheOf = all;
      this.skinCache.clear();
    }
    let got = this.skinCache.get(generator);
    if (!got) {
      const out: Record<string, TextureRef> = {};
      for (const [k, v] of Object.entries(all)) {
        const at = k.indexOf('@');
        if (at < 0) out[k] = v;
        else if (k.slice(at + 1) === generator) out[k.slice(0, at)] = v;
      }
      // A scoped key wins over the same unscoped one.
      for (const [k, v] of Object.entries(all)) if (k.endsWith(`@${generator}`) && generator !== '') out[k.slice(0, k.indexOf('@'))] = v;
      got = out;
      this.skinCache.set(generator, got);
    }
    return got;
  }

  private skinCacheOf: Readonly<Record<string, TextureRef>> | null = null;
  private readonly skinCache = new Map<string, Readonly<Record<string, TextureRef>>>();

  setWorld(world: WorldDoc): Promise<void> {
    if (this.disposed) return RESOLVED;
    const prev = this.current;
    if (prev === world) return RESOLVED;
    const diff = prev ? diffWorlds(prev, world) : null;
    this.current = world;
    let lamps = 0;
    for (const id in world.entities) {
      const e = world.entities[id];
      if (e?.template && e.light?.type === 'point' && e.light.castShadow !== true) lamps++;
    }
    this.templateLamps = lamps;
    if (diff && diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0 && diff.generatorsChanged.length === 0 && diff.meshesChanged.length === 0) return RESOLVED;

    this.ensurePartition(world);
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
    this.batchesStale = true;
    return Promise.all(started).then(() => {
      this.batchesStale = true;
    });
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
    this.batchesStale = true;
    if (path === 'visible' && typeof value === 'boolean') {
      node.entity = { ...node.entity, visible: value };
      node.object.visible = value;
      node.overridden = true;
      return true;
    }
    if (path === 'light.intensity' && typeof value === 'number' && Number.isFinite(value) && value >= 0 && node.entity.light && node.light) {
      const before = node.entity.light.intensity;
      const light = { ...node.entity.light, intensity: value };
      node.entity = { ...node.entity, light };
      if (node.entity.arch?.role === 'light') this.applyLampScale(node.light.light, light);
      else updateLightParams(node.light.light, light);
      node.overridden = true;
      // Switched on or off: the light joins or leaves the budget of live lights.
      if (before > 0 !== value > 0) this.applyShadowCap();
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

  /**
   * Scale architectural lamps (`arch.role` "light"): the renderer dims them
   * in daylight. Updates live lights in place (no allocation, no rebuild).
   */
  setArchLampScale(scale: number): void {
    const s = Number.isFinite(scale) ? Math.max(0, Math.min(1, scale)) : 1;
    if (s === this.archLampScale) return;
    this.archLampScale = s;
    for (const node of this.nodes.values()) {
      if (node.light && node.entity.light && node.entity.arch?.role === 'light') this.applyLampScale(node.light.light, node.entity.light);
    }
    if (Number.isFinite(this.lightBudget)) this.applyLightBudget();
  }

  /** The daylight scale of architectural lamps now ({@link setArchLampScale}). */
  get lampScale(): number {
    return this.archLampScale;
  }

  /**
   * Intensity of an architectural lamp under the daylight scale. Below
   * {@link LAMP_CUTOFF} the light is switched off entirely (invisible lights
   * cost nothing per pixel; a dozen point lights in a sunlit room otherwise
   * do, for no visible effect).
   */
  private applyLampScale(light: Light, spec: LightSpec): void {
    updateLightParams(light, spec, this.archLampScale);
    light.visible = this.archLampScale >= LAMP_CUTOFF && spec.intensity > 0 && light.userData['cut'] !== true;
  }

  private lightScale(node: Readonly<EntityNode>): number {
    return node.entity.arch?.role === 'light' ? this.archLampScale : 1;
  }

  /**
   * Restore one overridden node to its document entity (view modes undo
   * their own overrides without touching others). Returns true when the
   * node was overridden.
   */
  restoreNode(id: EntityId): boolean {
    const node = this.nodes.get(id);
    const docEntity = this.current?.entities[id];
    if (!node || !node.overridden || node.transient || !docEntity) return false;
    this.batchesStale = true;
    node.overridden = false;
    const flags = this.updateNode(node, node.entity, docEntity);
    if (flags.rebuild) void this.rebuild(node);
    else if (node.bindings.some((b) => b.ownedMaterial)) this.rematerial(node);
    this.applyTransform(node);
    if (this.lightsDirty) this.applyShadowCap();
    return true;
  }

  /** Drop every runtime override, restoring document values (e.g. on play reset). */
  clearOverrides(): void {
    const world = this.current;
    if (!world) return;
    this.batchesStale = true;
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
  /**
   * Fraction t ∈ [0, 1] of the world segment `from`→`to` where it first enters a tall scatter instance (a scattered
   * tree's trunk or crown), or Infinity, written to `out[0]`. Hidden layers are skipped. Allocation-free (no double
   * is returned or passed across a call): the chase camera calls it for every boom ray, every frame.
   */
  scatterOcclusionInto(from: Vector3, to: Vector3, out: Float64Array): void {
    out[0] = Number.POSITIVE_INFINITY;
    const nodes = this.occluderNodes;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i] as EntityNode;
      const grid = this.occluderGrids[i] as OccluderGrid;
      if (!visibleChain(node.object)) continue;
      node.content.updateWorldMatrix(true, false);
      grid.segmentEntryWorld(node.content.matrixWorld.elements, from, to);
      if (grid.entry[0]! < out[0]!) out[0] = grid.entry[0]!;
    }
  }

  /** {@link scatterOcclusionInto} returning the fraction (tests, one-off queries). */
  scatterOcclusion(from: Vector3, to: Vector3): number {
    this.scatterOcclusionInto(from, to, _occOut);
    return _occOut[0]!;
  }

  private setOccluders(node: EntityNode, poses: Float32Array, count: number, keyed: KeyedOutput): void {
    const grid = OccluderGrid.fromScatter(poses, count, partBounds(keyed.output.parts));
    if (grid) this.occluders.set(node, grid);
    else this.occluders.delete(node);
    this.indexOccluders();
  }

  private indexOccluders(): void {
    this.occluderNodes = [...this.occluders.keys()];
    this.occluderGrids = [...this.occluders.values()];
  }

  pickScatter(ray: Ray): { id: EntityId; distance: number } | null {
    let best: { id: EntityId; distance: number } | null = null;
    for (const node of this.nodes.values()) {
      if (node.instances === 0 || !node.object.visible) continue;
      _box.makeEmpty();
      for (const b of node.bindings) {
        const mesh = b.mesh;
        if ((!mesh.visible && !node.field) || !(mesh instanceof InstancedMesh) || !mesh.boundingBox) continue;
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

  private readonly physicsParents = new WeakMap<Object3D, {
    world: Matrix4; inverse: Matrix4; rotation: Quaternion; invertible: boolean;
  }>();

  /**
   * Apply packed world-space poses `[px,py,pz,qx,qy,qz,qw]*` (from
   * `PhysicsWorld.writeTransforms`). Parented bodies are converted into their
   * parent's space; conversions are allocated on first use and reused thereafter.
   */
  applyTransforms(packed: Float32Array, order: readonly EntityId[]): void {
    const n = Math.min(order.length, Math.floor(packed.length / 7));
    let previousParent: Object3D | null = null;
    let conversion: { world: Matrix4; inverse: Matrix4; rotation: Quaternion; invertible: boolean } | undefined;
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
        updateWorldChain(parent);
        const pm = parent.matrixWorld;
        if (parent !== previousParent) {
          previousParent = parent;
          conversion = this.physicsParents.get(parent);
        }
        const fresh = conversion === undefined;
        if (!conversion) {
          conversion = { world: new Matrix4(), inverse: new Matrix4(), rotation: new Quaternion(), invertible: false };
          this.physicsParents.set(parent, conversion);
        }
        // Reuse the conversion across siblings and frames, checking the current world matrix.
        // A parent or ancestor may itself have moved earlier in this packed update.
        if (fresh || !pm.equals(conversion.world)) {
          conversion.world.copy(pm);
          conversion.invertible = pm.determinant() !== 0;
          if (conversion.invertible) {
            pm.decompose(_pPos, conversion.rotation, _pScale);
            conversion.rotation.invert();
            conversion.inverse.copy(pm).invert();
          }
        }
        if (!conversion.invertible) continue;
        obj.position.set(px, py, pz).applyMatrix4(conversion.inverse);
        _q.set(qx, qy, qz, qw);
        obj.quaternion.copy(conversion.rotation).multiply(_q);
      }
      obj.updateMatrix();
      // A moving high-poly mesh re-plans its cut on the next frame.
      if (node.virtual.length > 0) this.viewDirty = true;
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
    this.batches?.clear();
    this.merges?.clear();
    this.assetInstances?.clear();
    // A new world gets a grid of its own.
    this.virtualBatches?.clear();
    this.cellShadows?.resetPartition();
    this.cellShadowsStale = true;
    this.batchesStale = true;
    this.mergesPending = true;
    for (const node of [...this.nodes.values()]) this.removeNode(node);
    this.current = null;
    this.warnings.clear();
  }

  /** Dispose all nodes and owned resources. Shared caches are disposed by their owner. */
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.merges?.dispose();
    this.cellShadows?.dispose();
    this.virtualBatches?.dispose();
    this.disposed = true;
    this.dags?.dispose();
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
    this.syncCharacter(node);
    return node;
  }

  /**
   * Show the entity's person (when it has a `character`): the cast member is
   * mounted at the feet of the entity's collider shape, which stays in place
   * (physics, picking and bounds) but is not drawn. If the person cannot be
   * loaded the shape is drawn as before.
   */
  private syncCharacter(node: EntityNode): void {
    const chars = this.opts.characters;
    if (!chars || this.variant !== 'standard') return;
    const spec = node.entity.character;
    if (!spec) {
      if (node.characterBody !== null) {
        chars.remove(node.id);
        node.characterBody = null;
        node.content.visible = true;
      }
      return;
    }
    const taken = new Set<string>();
    for (const other of this.nodes.values()) if (other !== node && other.characterBody) taken.add(other.characterBody);
    const look = resolveLook(spec, node.id, { taken });
    node.characterBody = look.body.id;
    node.content.visible = false;
    const shape = node.entity.shape;
    // Collider shapes are centred on the body; models and assets stand on their origin.
    const footOffset = shape.kind === 'primitive' ? -(shape.size[1] * 0.5) : 0;
    const token = ++node.charToken;
    const seated = spec.pose === 'sit';
    void this.track(
      chars.add(node.id, look, node.object, { footOffset, track: node.object, castShadow: node.entity.castShadow }).then((rig) => {
        if (!rig && node.charToken === token && this.nodes.get(node.id) === node) node.content.visible = true;
        // A seated person (a paddler, a guest): the sit clip replaces locomotion whatever the carrier does.
        if (rig) rig.input.sitting = seated;
        if (rig) { this.shadowCastersChanged(); this.opts.onContentChanged?.(node.id); }
      }),
    );
  }

  /** True when the entity shows a person (its own shape is only the collider). */
  hasCharacter(id: EntityId): boolean {
    return (this.nodes.get(id)?.characterBody ?? null) !== null;
  }

  /** The animated person of an entity, or null (tests, the studio's NPC feed). */
  characterRig(id: EntityId): import('../characters/rig').CharacterRig | null {
    return this.opts.characters?.rig(id) ?? null;
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
    this.unindexWater(node);
    node.token++;
    if (node.characterBody !== null) this.opts.characters?.remove(node.id);
    this.batchesStale = true;
    this.teardownContent(node);
    if (node.light) {
      this.dropLight(node.light.light);
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
    if (!rebuild && !deepEqual(before.material, after.material)) {
      if (after.shape.kind === 'asset' && before.material?.color !== after.material?.color) this.paintAsset(node);
      this.rematerial(node);
    }
    if (!rebuild && (before.castShadow !== after.castShadow || before.receiveShadow !== after.receiveShadow)) this.applyShadowFlags(node);
    if (!deepEqual(before.light, after.light)) this.syncLight(node, before);
    if (!deepEqual(before.character, after.character) || !deepEqual(before.shape, after.shape)) this.syncCharacter(node);
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
        case 'asset':
          work = this.buildAsset(node, shape, world, token);
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
    return shape.kind === 'model' || shape.kind === 'asset' ? RESOLVED : tracked;
  }

  /**
   * Order generation from `point` (world space), nearest entities first: what is seen first is built first. Null
   * keeps document order. Takes effect for the next {@link setWorld}.
   */
  setGenerationFocus(point: readonly [number, number, number] | null): void {
    this.generationFocus = point && point.every(Number.isFinite) ? [point[0], point[1], point[2]] : null;
  }

  /** Queue order of a node's generation: its distance from the focus (0 without one). */
  private generationPriority(node: EntityNode): number {
    const f = this.generationFocus;
    if (!f) return 0;
    node.object.updateWorldMatrix(true, false);
    const e = node.object.matrixWorld.elements;
    const d = Math.hypot((e[12] as number) - f[0], (e[13] as number) - f[1], (e[14] as number) - f[2]);
    return Number.isFinite(d) ? d : 0;
  }

  /** Start of the current run of mounts on this task (see {@link mountTurn}). */
  private mountSliceStart = 0;

  /**
   * Wait for a turn to mount generated content. One generator reply can complete many entities at once (every entity
   * sharing that output), and their mounts would otherwise run back to back in one long task: past
   * {@link MOUNT_SLICE_MS} of mounting, the rest wait for the next tasks, one mount each.
   */
  private mountTurn(): Promise<void> {
    const t = performance.now();
    if (t - this.mountSliceStart < MOUNT_SLICE_MS) return RESOLVED;
    return yieldToEventLoop().then(() => {
      this.mountSliceStart = performance.now();
    });
  }

  private resolveProcedural(node: EntityNode, shape: ProceduralShape, world: Pick<WorldDoc, 'generators'>): Promise<{ keyed: KeyedOutput; failed: boolean }> {
    return this.opts.source.procedural(shape, world, { priority: this.generationPriority(node) }).then(
      (keyed) => this.mountTurn().then(() => ({ keyed, failed: false })),
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
      node.releases.push(() => disposeModelInstance(model));
      model.traverse((o) => {
        if (o instanceof Mesh) {
          o.castShadow = this.variant === 'standard' && node.entity.castShadow;
          o.receiveShadow = this.variant === 'standard' && node.entity.receiveShadow;
        }
      });
      node.content.add(model);
    });
  }

  /** Only candidate water nodes are checked before the expensive reflection/refraction scene passes. */
  private readonly waterNodes: EntityNode[] = [];
  private readonly waterNodeIndex = new Map<EntityNode, number>();

  private unindexWater(node: EntityNode): void {
    const index = this.waterNodeIndex.get(node);
    if (index === undefined) return;
    const last = this.waterNodes.pop()!;
    this.waterNodeIndex.delete(node);
    if (index < this.waterNodes.length) {
      this.waterNodes[index] = last;
      this.waterNodeIndex.set(last, index);
    }
  }
  private readonly waterFrustum = new Frustum();
  private readonly waterProjection = new Matrix4();

  /** Conservative draw visibility: uses the same mesh spheres, layers and hierarchy as the renderer. */
  hasVisibleWater(camera: PerspectiveCamera): boolean {
    if (this.waterNodes.length === 0) return false;
    updateWorldChain(camera);
    this.waterFrustum.setFromProjectionMatrix(this.waterProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    for (let i = 0; i < this.waterNodes.length; i++) {
      const node = this.waterNodes[i]!;
      if (!visibleUnder(node.content, this.root)) continue;
      // These draw through stand-ins with their own bounds; keep their auxiliary passes until those are tested too.
      if (node.field || node.virtual.length > 0 || node.instances > 0) return true;
      for (let j = 0; j < node.bindings.length; j++) {
        const mesh = node.bindings[j]!.mesh;
        const material = mesh.material;
        if (Array.isArray(material)) return true;
        if (!waterMaterial(material) || !material.visible || !visibleUnder(mesh, this.root)) continue;
        // A merged/instanced replacement owns the draw bounds, so its picking-only source cannot reject the pass.
        if (mesh.layers.isEnabled(BATCHED_LAYER)) return true;
        if (!camera.layers.test(mesh.layers)) continue;
        if (!mesh.frustumCulled) return true;
        updateWorldChain(mesh);
        if (this.waterFrustum.intersectsObject(mesh)) return true;
      }
    }
    return false;
  }

  /** Advance asset animations (characters, animals). Returns true when a redraw is needed. */
  updateAnimations(dt: number, eye?: { x: number; y: number; z: number }): boolean {
    const animated = this.animatorRef?.update(dt, eye) ?? false;
    const driven = this.vehicles.update(dt);
    return animated || driven;
  }

  /**
   * Tint the "paint" material of a modelled vehicle (library models name their body paint "paint") with the
   * entity's `material.color`. Each tinted entity gets its own clone, so a red kart and a blue one can share a file.
   */
  private paintAsset(node: EntityNode): void {
    const color = node.entity.material?.color;
    if (!color || this.variant !== 'standard') return;
    let clones = this.paintClones.get(node.id);
    node.content.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const m = o.material;
      if (Array.isArray(m) || !(m instanceof MeshStandardMaterial) || (m.name !== 'paint' && m.userData['aetherPaint'] !== true)) return;
      let own: MeshStandardMaterial = m;
      if (m.userData['aetherPaint'] !== true) {
        own = m.clone() as MeshStandardMaterial;
        own.userData['aetherPaint'] = true;
        o.material = own;
        clones ??= [];
        clones.push(own);
        this.paintClones.set(node.id, clones);
      }
      (own as MeshStandardMaterial).color.set(color);
    });
  }

  /**
   * Mount a library or imported asset. Fallback chain when the asset is
   * unknown or fails to load: a generator asset's procedural shape, then the
   * shape's own `fallback`, then a translucent box of the asset's size.
   */
  private buildAsset(node: EntityNode, shape: AssetShape, world: Pick<WorldDoc, 'generators'>, token: number): Promise<void> {
    this.mountPlaceholder(node);
    return loadCatalog().then(async () => {
      if (!this.isCurrent(node, token)) return;
      const info = assetInfo(effectiveAssetId(shape));
      const scale = info ? fitScale(info.size, shape.fitSize) : 1;
      if (info) this.sizePlaceholder(node, info.size[0] * scale, info.size[1] * scale, info.size[2] * scale);
      try {
        if (!info || info.kind === 'hdri' || info.kind === 'material') throw new Error(info ? `"${shape.id}" is a ${info.kind === 'hdri' ? 'sky' : 'surface material'}, not an object` : `asset "${shape.id.slice(0, 64)}" is not available`);
        if (info.kind === 'generator') {
          const g = info.entry?.generator;
          if (!g) throw new Error(`asset "${shape.id}" has no generator`);
          const { keyed, failed } = await this.resolveProcedural(node, { kind: 'procedural', generator: g.id, params: { ...g.params } }, world);
          if (!this.isCurrent(node, token)) return;
          this.teardownContent(node);
          this.mountOutput(node, keyed, false);
          node.failed = failed;
          return;
        }
        if (info.kind === 'image') await this.mountPosterAsset(node, info, scale, token);
        else await this.mountModelAsset(node, shape, info, scale, token);
      } catch (e) {
        if (!this.isCurrent(node, token)) return;
        await this.mountAssetFallback(node, shape, world, token, errorMessage(e));
      }
    });
  }

  private sizePlaceholder(node: EntityNode, w: number, h: number, d: number): void {
    for (const child of node.content.children) {
      if (child.name !== 'placeholder') continue;
      child.scale.set(Math.max(0.05, w), Math.max(0.05, h), Math.max(0.05, d));
      child.updateMatrix();
    }
  }

  private async mountModelAsset(node: EntityNode, shape: AssetShape, info: AssetInfo, scale: number, token: number): Promise<void> {
    const models = this.opts.models;
    if (!models || !info.url) throw new Error('model loading is not available');
    // The low tiers load the light copy (small textures, one level) of models that have one.
    const lite = info.liteUrl && this.variant === 'standard' && this.opts.liteModels?.() === true;
    const url = lite ? info.liteUrl! : info.url;
    const lodUrls = this.variant === 'standard' && !lite ? info.lodUrls : [];
    const urls = [url, ...lodUrls];
    // One reference per URL, held until the content is torn down (or released at once on failure / staleness).
    const loads = urls.map((u) => models.acquire(u));
    const release = (): void => {
      for (const u of urls) models.release(u);
    };
    let sources: Object3D[];
    try {
      sources = await Promise.all(loads);
    } catch (e) {
      release();
      throw e;
    }
    if (!this.isCurrent(node, token)) {
      release();
      return;
    }
    this.clearPlaceholder(node);
    node.releases.push(release);
    const main = instantiateAsset(sources[0] as Object3D, scale);
    let content: Object3D = main;
    if (sources.length > 1 && info.entry) {
      const lod = new LOD();
      lod.name = 'asset-lod';
      lod.addLevel(main, 0);
      const dist = lodDistances(info.entry, 50, scale);
      for (let i = 1; i < sources.length; i++) {
        const level = instantiateAsset(sources[i] as Object3D, scale);
        shareMaterials(main, level);
        lod.addLevel(level, dist[i - 1] ?? 1e9);
      }
      content = lod;
    }
    const standard = this.variant === 'standard';
    content.traverse((o) => {
      if (o instanceof Mesh) {
        o.castShadow = standard && node.entity.castShadow;
        o.receiveShadow = standard && node.entity.receiveShadow;
      }
    });
    node.content.add(content);
    node.releases.push(() => disposeModelInstance(content));
    if (standard) {
      this.paintAsset(node);
      if (isVehicleModel(main)) {
        this.vehicles.add(node.id, main, node.object);
        node.releases.push(() => {
          this.vehicles.remove(node.id);
          for (const m of this.paintClones.get(node.id) ?? []) m.dispose();
          this.paintClones.delete(node.id);
        });
      }
    }
    const clipRoot = main.children[0];
    if (standard && info.anims && clipRoot && clipRoot.animations.length > 0) {
      const animator = await this.loadAnimator();
      if (!this.isCurrent(node, token)) return;
      animator.add(node.id, clipRoot, node.object, info.anims, shape.animation);
      node.releases.push(() => animator.remove(node.id));
    }
  }

  private async mountPosterAsset(node: EntityNode, info: AssetInfo, scale: number, token: number): Promise<void> {
    const textures = this.opts.textures;
    if (!textures || !info.url) throw new Error('image loading is not available');
    const url = info.url;
    const tex = await textures.acquire(url);
    if (!this.isCurrent(node, token)) {
      textures.release(url);
      return;
    }
    this.clearPlaceholder(node);
    const poster = createPoster(tex, info.size[0] * scale, info.size[1] * scale, info.size[2] * scale);
    poster.group.traverse((o) => {
      if (o instanceof Mesh) {
        o.castShadow = this.variant === 'standard' && node.entity.castShadow;
        o.receiveShadow = this.variant === 'standard' && node.entity.receiveShadow;
      }
    });
    node.content.add(poster.group);
    node.releases.push(() => {
      poster.dispose();
      textures.release(url);
    });
  }

  private async mountAssetFallback(node: EntityNode, shape: AssetShape, world: Pick<WorldDoc, 'generators'>, token: number, reason: string): Promise<void> {
    const fb = shape.fallback;
    if (fb?.kind === 'procedural') {
      const { keyed } = await this.resolveProcedural(node, fb, world);
      if (!this.isCurrent(node, token)) return;
      this.teardownContent(node);
      this.mountOutput(node, keyed, false);
    } else if (fb?.kind === 'primitive') {
      this.teardownContent(node);
      this.mountOutput(node, this.opts.source.primitive(fb), fb.primitive === 'plane');
    } else {
      // Keep the (sized) translucent placeholder as the stand-in.
      if (!node.placeholder) this.mountPlaceholder(node);
    }
    this.warn(node.id, `${reason}; showing a stand-in`);
    node.failed = true;
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

  /** True when several field-sized scatter layers together ask for more than `budget` instances. */
  private fieldDemand(budget: number): boolean {
    let sum = 0;
    let layers = 0;
    for (const e of Object.values(this.current?.entities ?? {})) {
      const sh = e.shape;
      if (sh && sh.kind === 'scatter') {
        const n = Math.min(sh.points ? sh.points.length : sh.count, MAX_SCATTER_INSTANCES);
        if (n >= FIELD_MIN_INSTANCES) {
          sum += n;
          layers++;
        }
      }
    }
    return layers > 1 && sum > budget;
  }

  private mountScatter(node: EntityNode, shape: ScatterShape, keyed: KeyedOutput): void {
    const requested = Math.min(shape.points ? shape.points.length : shape.count, MAX_SCATTER_INSTANCES);
    let sourceTriangles = 0;
    for (const part of keyed.output.parts) sourceTriangles += Math.floor(part.indices.length / 3);
    if (this.fieldBudget && keyed.output.parts.length > 0 && isFieldLayer(requested, sourceTriangles)) {
      this.mountField(node, shape, keyed, requested, this.fieldBudget);
      return;
    }
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
    this.setOccluders(node, posesFromMatrices(matrices, placements.count), placements.count, keyed);
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
   * Mount a huge scatter layer as a {@link ScatterField}: packed placements
   * sorted into chunks, automatic LOD levels from the QEM simplifier, and a
   * share of the renderer's field triangle budget.
   */
  private mountField(node: EntityNode, shape: ScatterShape, plain: KeyedOutput, requested: number, budget: FieldBudget): void {
    const keyed = softenKeyed(plain, node.entity.material);
    const available = Math.max(0, budget.maxInstances - this.fieldInstances);
    // When the world asks for more than the budget, no single field may starve the rest: two huge forests used to take
    // everything and leave the ground cover at 0.
    const shareCap = this.fieldDemand(budget.maxInstances) ? Math.floor(budget.maxInstances * MAX_FIELD_SHARE) : Infinity;
    const count = Math.min(requested, available, shareCap);
    if (count < requested) this.warn(node.id, `scatter field limited to ${count} of ${requested} instances (renderer field budget ${budget.maxInstances})`);
    if (count === 0) return;
    const placements = scatterPlacements(shape, count);
    const lift = shape.of.kind === 'primitive' ? primitiveLift(shape.of.primitive, shape.of.size) : 0;
    const sampler = shape.onSurface ? this.surfaceSampler(node, shape.onSurface) : undefined;
    const radius = Math.max(1e-3, outputRadius(keyed.output));
    const packed = composeScatterPacked(placements, lift, sampler);
    this.setOccluders(node, packed, placements.count, plain);
    const chunks = buildChunks(packed, placements.count, radius, fieldChunkSize(placements.count, CHUNK_INSTANCES));
    const chain = this.lodChains.get(keyed.key, keyed.output);
    const parts = keyed.output.parts;
    node.keyed = keyed;
    node.partCount = parts.length;
    const levels: { geometries: BufferGeometry[]; triangles: number }[] = [];
    const materials: Material[] = [];
    const handles: { key: string; hasColors: boolean; seeThrough: boolean; part: MeshPart }[] = [];
    try {
      for (let l = 0; l < chain.length; l++) {
        const geometries: BufferGeometry[] = [];
        for (let i = 0; i < parts.length; i++) {
          const src = parts[i] as MeshPart;
          const g = this.opts.geometries.acquire(lodOutputKey(keyed.key, l), i, lodPart(chain, l, i, src));
          node.geometryKeys.push(g.key);
          geometries.push(g.geometry);
        }
        levels.push({ geometries, triangles: (chain[l] as { triangles: number }).triangles });
      }
    } catch (e) {
      this.warn(node.id, `invalid scatter mesh: ${errorMessage(e)}`);
      return;
    }
    // Field capacity follows the field's size (a 400k+ layer may use the whole budget).
    const finest = Math.max(1, (levels[0] as { triangles: number }).triangles);
    const cap = Math.max(budget.triangles * 0.15, Math.min(budget.triangles, (budget.triangles * placements.count) / 400_000), Math.min(budget.triangles, placements.count * finest));
    // Vegetation fields sway in the wind (vertex shader only).
    const variant: MaterialVariant = shape.of.kind === 'procedural' && FOLIAGE_GENERATORS.has(shape.of.generator) ? 'foliage' : this.variant;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as MeshPart;
      const hasColors = part.colors instanceof Float32Array && part.colors.length > 0;
      const handle = this.opts.materials.acquire(mergeMaterial(part.material, node.entity.material, parts.length, this.skinsFor(node.entity)), { hasVertexColors: hasColors, doubleSided: false }, variant);
      materials.push(handle.material);
      handles.push({ key: handle.key, hasColors, seeThrough: handle.resolved.transparent && handle.resolved.opacity < SHADOW_OPACITY_MIN, part });
    }
    const field = new ScatterField(chunks, levels, materials, radius, cap);
    // One binding per (level, part) mesh; each holds its own material reference.
    for (let m = 0; m < field.meshes.length; m++) {
      const h = handles[m % parts.length] as (typeof handles)[number];
      const key = m < parts.length ? h.key : this.opts.materials.acquire(mergeMaterial(h.part.material, node.entity.material, parts.length, this.skinsFor(node.entity)), { hasVertexColors: h.hasColors, doubleSided: false }, variant).key;
      node.bindings.push({ mesh: field.meshes[m] as InstancedMesh, partMaterial: h.part.material, hasColors: h.hasColors, doubleSided: false, materialKey: key, seeThrough: h.seeThrough, ownedMaterial: null, ...(variant !== this.variant ? { variant } : {}) });
    }
    node.field = field;
    node.instances = placements.count;
    node.scatterTriangles = 0;
    this.fieldInstances += placements.count;
    this.fieldNodes.add(node);
    node.content.add(field.group);
    this.rebalanceFields();
    this.applyShadowFlags(node);
  }

  /** Re-split the field triangle budget after fields came or went. */
  private rebalanceFields(): void {
    this.viewDirty = true;
    const budget = this.fieldBudget;
    if (!budget || this.fieldNodes.size === 0) return;
    const nodes = [...this.fieldNodes];
    const shares = shareDemand(budget.triangles, nodes.map((n) => n.instances * (n.field?.culler.finestTriangles ?? 1)));
    nodes.forEach((n, i) => n.field?.culler.setBudget(shares[i] as number));
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
      const handle = this.opts.materials.acquire(mergeMaterial(partMaterial, node.entity.material, node.partCount, this.skinsFor(node.entity)), { hasVertexColors: bundle.hasColors, doubleSided: false }, this.variant);
      const mesh = new Mesh(slot.geometry, handle.material);
      mesh.matrixAutoUpdate = false;
      mesh.name = `${node.id}:slot${slot.slot}`;
      mesh.userData[MESH_TRIANGLES_KEY] = slot.triangles;
      accelerateRaycast(mesh);
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

  /** Rebuild an entity's content from its current (document) value; false when unknown. */
  refresh(id: EntityId): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;
    void this.rebuild(node);
    return true;
  }

  /**
   * Rebuild every entity showing one of `assetIds` (or any asset when
   * omitted): user imports registered after the world loaded, or a library
   * that finished loading. Returns how many were rebuilt (the environment
   * HDRI is the renderer's job).
   */
  refreshAssets(assetIds?: ReadonlySet<string>): number {
    let n = 0;
    for (const node of this.nodes.values()) {
      const s = node.entity.shape;
      if (s.kind !== 'asset' || node.entity.template) continue;
      if (assetIds && !assetIds.has(s.id) && !(s.variant && assetIds.has(s.variant))) continue;
      void this.rebuild(node);
      n++;
    }
    return n;
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
  private mountOutput(node: EntityNode, plain: KeyedOutput, doubleSided: boolean, instances?: InstancedBufferAttribute): void {
    const keyed = softenKeyed(plain, node.entity.material);
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
        const handle = this.opts.materials.acquire(mergeMaterial(part.material, withWaterKind(node.entity.material, node.entity), parts.length, this.skinsFor(node.entity)), { hasVertexColors: hasColors, doubleSided, solid: node.entity.arch?.role === 'wall' }, this.variant);
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
          if (handle.resolved.splat) mesh.renderOrder = TERRAIN_RENDER_ORDER;
          // Large parts (terrain) raycast through a BVH: picking, snapping and camera occlusion stay O(log n).
          accelerateRaycast(mesh);
          // A kit of small pieces (trims, rails, flowers) would lose whole pieces to cluster LOD: it stays an ordinary mesh.
          if (this.dags && part.indices.length / 3 >= VIRTUAL_MIN_TRIANGLES && !(part.prepared?.kit ?? isKitOfPieces(part.positions, part.indices))) this.virtualize(node, mesh, g.key, ...splitSource(g.geometry, part));
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

  /**
   * Draw a high-poly part as virtual geometry once its cluster DAG is built
   * (in the worker). The full-detail mesh lives on the raycast-only layer
   * from the start, so picking, snapping and the chase camera keep using its
   * BVH while it never costs a draw; it is drawn plainly only when no
   * hierarchy can be built.
   */
  private virtualize(node: EntityNode, source: Mesh, key: string, positions: Float32Array, indices: Uint32Array): void {
    const dags = this.dags;
    if (!dags) return;
    const token = node.token;
    const geometry = source.geometry;
    // Never draw the full-detail mesh: it stays raycast-only and the cluster cut streams in
    // once the hierarchy is built (a cached hierarchy appears on the next frame).
    source.layers.set(BATCHED_LAYER);
    // Never merged with the entity's other parts (StaticMerges), whether or not a hierarchy comes.
    source.userData['aetherVirtualSource'] = true;
    // Tracked: the load waits for the hierarchy, because the stand-in is drawn with a program of its own (see whenIdle).
    void this.track(
      dags.build(key, positions, indices).then(
      (dag) => {
        if (this.disposed || node.token !== token || source.parent !== node.content || !node.bindings.some((b) => b.mesh === source)) return;
        let entry = this.virtualGroups.get(key);
        if (!entry) {
          entry = { group: new VirtualGroup(dag, geometry, Math.min(this.virtualTriangles, Math.max(dag.baseTriangles, 65_536) * 3)), refs: 0 };
          this.virtualGroups.set(key, entry);
        }
        entry.refs++;
        const mesh = entry.group.add(source);
        this.virtualKeys.set(mesh, key);
        mirror(mesh, source);
        source.layers.set(BATCHED_LAYER);
        node.content.add(mesh);
        node.virtual.push({ key, mesh, source });
        this.viewDirty = true;
        this.shadowCastersChanged(); this.opts.onContentChanged?.(node.id);
      },
      (e: unknown) => {
        // No hierarchy (too large, worker failure): draw the plain mesh after all.
        if (node.token === token) source.layers.set(0);
        log.debug(`virtual geometry unavailable for ${node.id}: ${errorMessage(e)}`);
        this.shadowCastersChanged(); this.opts.onContentChanged?.(node.id);
      },
      ),
    );
  }

  /** Drop an entity's virtual stand-ins (the group is disposed with its last instance). */
  private releaseVirtual(node: EntityNode): void {
    for (const v of node.virtual) {
      v.source.layers.set(0);
      const entry = this.virtualGroups.get(v.key);
      if (!entry) continue;
      entry.group.remove(v.mesh);
      if (--entry.refs <= 0) {
        entry.group.dispose();
        this.virtualGroups.delete(v.key);
      }
    }
    node.virtual = [];
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
    this.releaseVirtual(node);
    const retired: Retired = { materialKeys: [], geometryKeys: node.geometryKeys, owned: [], modelUrl: node.modelUrl, bundle: node.meshBundle, releases: node.releases };
    node.meshBundle = null;
    node.releases = [];
    for (const b of node.bindings) {
      retired.materialKeys.push(b.materialKey);
      if (b.ownedMaterial) retired.owned.push(b.ownedMaterial);
      if (b.mesh instanceof InstancedMesh) b.mesh.dispose();
    }
    // Field instances are budgeted separately from plain instanced layers.
    const fieldInstances = node.field ? node.instances : 0;
    if (node.field) {
      node.field.dispose();
      node.field = null;
      this.fieldInstances -= fieldInstances;
      this.fieldNodes.delete(node);
      this.rebalanceFields();
    }
    node.content.clear();
    node.bindings = [];
    node.geometryKeys = [];
    node.modelUrl = null;
    node.keyed = null;
    node.partCount = 0;
    node.placeholder = false;
    node.failed = false;
    this.totalInstances -= node.instances - fieldInstances;
    node.instances = 0;
    this.totalScatterTriangles -= node.scatterTriangles;
    node.scatterTriangles = 0;
    node.instanceMatrix = null;
    if (this.occluders.delete(node)) this.indexOccluders();
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
    for (const release of r.releases) release();
    r.releases = [];
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
      const resolved = resolveMaterial(mergeMaterial(b.partMaterial, material, node.partCount, this.skinsFor(node.entity)), {
        hasVertexColors: b.hasColors,
        doubleSided: b.doubleSided,
      });
      let owned = b.ownedMaterial;
      if (!owned) {
        owned = createMaterial(resolved, b.variant ?? this.variant, this.opts.materials.surfaces, this.opts.materials.finishes, this.opts.materials.antiTile, this.opts.materials.foliage, this.opts.materials.layeredTerrain);
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
    this.batchesStale = true;
    for (const b of node.bindings) {
      if (b.ownedMaterial) {
        b.ownedMaterial.dispose();
        b.ownedMaterial = null;
      }
      const handle = this.opts.materials.acquire(
        mergeMaterial(b.partMaterial, node.entity.material, node.partCount, this.skinsFor(node.entity)),
        { hasVertexColors: b.hasColors, doubleSided: b.doubleSided },
        b.variant ?? this.variant,
      );
      this.opts.materials.release(b.materialKey);
      b.materialKey = handle.key;
      b.mesh.material = handle.material;
      b.seeThrough = handle.resolved.transparent && handle.resolved.opacity < SHADOW_OPACITY_MIN;
    }
    this.applyShadowFlags(node);
  }

  private applyShadowFlags(node: EntityNode): void {
    this.batchesStale = true;
    const hasWater = node.entity.material?.preset === 'water' || node.bindings.some((b) => {
      const m = b.mesh.material;
      return Array.isArray(m) ? m.some((part) => waterMaterial(part)) : waterMaterial(m);
    });
    if (hasWater && !this.waterNodeIndex.has(node)) {
      this.waterNodeIndex.set(node, this.waterNodes.length);
      this.waterNodes.push(node);
    } else if (!hasWater) this.unindexWater(node);
    const standard = this.variant === 'standard';
    // Dense scatter layers (grass, pebbles) would double their draw cost in the shadow pass.
    const shadowCaster = node.instances <= SCATTER_SHADOW_MAX_INSTANCES;
    for (const b of node.bindings) {
      b.mesh.castShadow = standard && shadowCaster && node.entity.castShadow && !b.seeThrough;
      b.mesh.receiveShadow = standard && node.entity.receiveShadow;
    }
    // Virtual stand-ins follow their source meshes (material swaps go through here too).
    for (const v of node.virtual) mirror(v.mesh, v.source);
    if (node.virtual.length > 0) this.viewDirty = true;
  }

  private syncLight(node: EntityNode, before: Entity | undefined): void {
    const spec = node.entity.light;
    const old = before?.light;
    if (this.variant !== 'standard') return;
    const sameSize = old?.size?.[0] === spec?.size?.[0] && old?.size?.[1] === spec?.size?.[1];
    if (node.light && spec && old && old.type === spec.type && old.range === spec.range && old.angle === spec.angle && old.castShadow === spec.castShadow && old.profile === spec.profile && sameSize) {
      if (node.entity.arch?.role === 'light') this.applyLampScale(node.light.light, spec);
      else updateLightParams(node.light.light, spec);
      if (old.intensity > 0 !== spec.intensity > 0) this.lightsDirty = true;
      return;
    }
    if (node.light) {
      this.dropLight(node.light.light);
      disposeEntityLight(node.light);
      node.light = null;
    }
    if (spec?.type === 'area' && !areaLightsReady()) {
      // The rectangular-light tables load on first use; the light appears as soon as they are in.
      void loadAreaLights().then(
        () => {
          if (this.nodes.get(node.id) === node && node.entity.light?.type === 'area' && !node.light) {
            this.syncLight(node, undefined);
            this.contentChanged(node);
          }
        },
        (e: unknown) => this.warn(node.id, `area light unavailable: ${errorMessage(e)}`),
      );
      return;
    }
    if (spec) {
      node.light = createEntityLight(spec, this.lightScale(node));
      if (node.entity.arch?.role === 'light') this.applyLampScale(node.light.light, spec);
      node.object.add(node.light.light);
      if (node.light.target) node.object.add(node.light.target);
      this.lights.push(node.light.light);
    }
    this.lightsDirty = true;
  }

  private dropLight(light: Light): void {
    const i = this.lights.indexOf(light);
    if (i >= 0) this.lights.splice(i, 1);
  }

  private applyShadowCap(): void {
    this.lightsDirty = false;
    const candidates: Array<{ id: string; light: Light; wants: boolean }> = [];
    for (const n of this.nodes.values()) if (n.light) candidates.push({ id: n.id, light: n.light.light, wants: n.entity.light?.castShadow === true });
    enforceShadowCap(candidates);
    this.applyLightBudget();
  }

  /** Limit the live local lights to {@link lightBudget}; the lights cut stay marked (`userData.cut`) for the bake. */
  setLightBudget(budget: number): void {
    const b = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : Number.POSITIVE_INFINITY;
    if (b === this.lightBudget) return;
    this.lightBudget = b;
    this.applyLightBudget();
  }

  private applyLightBudget(): void {
    const lit: Array<{ node: EntityNode; light: Light; spec: LightSpec }> = [];
    for (const n of this.nodes.values()) {
      const light = n.light?.light, spec = n.entity.light;
      if (!light || !spec || spec.type === 'directional' || n.entity.template || n.entity.visible === false) continue;
      const lamp = n.entity.arch?.role === 'light';
      if (spec.intensity > 0 && (!lamp || this.archLampScale >= LAMP_CUTOFF)) lit.push({ node: n, light, spec });
      else {
        light.userData['cut'] = false;
        // A light switched off (a lamp waiting for the power to come back) is not drawn: a visible light at zero
        // intensity still costs every lit pixel its share of the light loop (fourteen of them doubled a colony's frame).
        // Lamps under the daylight cutoff are hidden by `applyLampScale`.
        if (!lamp) light.visible = false;
      }
    }
    const pool: BudgetLight[] = lit.map(({ node, light }) => {
      node.object.updateWorldMatrix(true, false);
      const e = node.object.matrixWorld.elements;
      const pos: [number, number, number] = [e[12] as number, e[13] as number, e[14] as number];
      return { id: node.id, group: node.entity.arch?.room ?? `cell:${Math.floor(pos[0] / 8)},${Math.floor(pos[2] / 8)}`, position: pos, intensity: light.intensity };
    });
    const kept = chooseForwardLights(pool, this.lightBudget);
    for (const { node, light } of lit) {
      const cut = !kept.has(node.id);
      light.userData['cut'] = cut;
      light.visible = !cut;
    }
  }

  // -------------------------------------------------------------------------
  // Scatter surfaces
  // -------------------------------------------------------------------------

  /** Virtual stand-ins and other late meshes changed what casts: group the shadow casters again after a quiet spell. */
  private shadowCastersChanged(): void {
    this.cellShadowsStale = true;
    this.cellShadowsAt = performance.now();
  }

  private contentChanged(node: EntityNode): void {
    this.batchesStale = true;
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

/** Visibility does not inherit layer masks, but it does inherit every ancestor's visible flag. */
function visibleUnder(object: Object3D, root: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (!o.visible) return false;
    if (o === root) return true;
  }
  return false;
}

function waterMaterial(material: Material): boolean {
  return material.userData[WATER_KEY] === true || material.userData[WATER_SHADER_KEY] !== undefined;
}

/** r186's updateWorldMatrix does not propagate an updated ancestor to clean descendants. */
function updateWorldChain(object: Object3D): void {
  if (object.parent) updateWorldChain(object.parent);
  object.updateWorldMatrix(false, false, true);
}

/** The positions and indices that match `geometry`'s attributes: its split streams when its UVs split corners, else the part's. */
function splitSource(geometry: BufferGeometry, part: MeshPart): [Float32Array, Uint32Array] {
  const split = geometry.userData[SPLIT_SOURCE_KEY] as { positions: Float32Array; indices: Uint32Array } | undefined;
  return split ? [split.positions, split.indices] : [part.positions, part.indices];
}

/** A node whose meshes stand still: no behaviours, no moving body, no runtime overrides, fully built. */
function staticCaster(node: Readonly<EntityNode>): boolean {
  if (node.transient || node.placeholder || node.pending || node.failed || node.overridden || node.characterBody !== null || node.field) return false;
  const e = node.entity;
  if (e.template || e.visible === false || e.behaviors.length > 0) return false;
  return !e.physics || e.physics.body === 'static';
}

const _cellSphere = new Sphere();
