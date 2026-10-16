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
import { StaticMerges } from './static-merges';
import { Box3, BoxGeometry, Group, InstancedBufferAttribute, InstancedMesh, LOD, Matrix4, Mesh, MeshStandardMaterial, Quaternion, StaticDrawUsage, Vector3, } from 'three';
import { decodeMeshCached, deepEqual, diffWorlds, } from '@aether/core';
import { FINISHES } from '@aether/arch';
import { finishAlbedoScale } from '@aether/procgen';
import { mergeMaterial, resolveMaterial } from '../materials/presets';
import { softenKeyed } from '../geometry/soften';
import { FINISH_NODES_KEY } from '../materials/anti-tile';
import { FOLIAGE_GENERATORS } from '../materials/wind';
import { createMaterial } from '../materials/material-cache';
import { instantiateAsset, instantiateModel } from '../geometry/model-loader';
import { createPoster, shareMaterials } from '../geometry/poster';
import { isVehicleModel, VehicleRig } from './vehicle-rig';
import { resolveLook } from '@aether/assets';
import { assetInfo, effectiveAssetId, fitScale, loadCatalog, lodDistances } from '@aether/assets';
import { buildHeightGrid, transformPositions } from '../geometry/height-grid';
import { composeScatterMatrices, composeScatterPacked, MAX_SCATTER_INSTANCES, primitiveLift, scatterPlacements } from '../geometry/scatter';
import { ScatterField, FIELD_MIN_INSTANCES } from '../virtual/scatter-field';
import { buildChunks } from '../virtual/field-culler';
import { createLocalView, localView } from '../virtual/view';
import { DagClient } from '../virtual/dag-client';
import { mirror, VirtualGroup, VIRTUAL_MIN_TRIANGLES } from '../virtual/virtual-mesh';
import { BATCHED_LAYER } from './static-batches';
import { DEFAULT_FIELD_BUDGET, LodChainCache, lodOutputKey, lodPart, outputRadius, shareBudget } from './field-mount';
import { buildMeshGeometry, previewMeshGeometry } from '../geometry/mesh-asset';
import { meshColliders } from '@aether/procgen';
import { areaLightsReady, createEntityLight, disposeEntityLight, enforceShadowCap, LAMP_CUTOFF, loadAreaLights, updateLightParams } from './lights';
import { createEntityNode, ENTITY_ID_KEY } from './entity-node';
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
const LIVE_MATERIAL_FIELDS = new Map([
    ['color', 'color'],
    ['emissive', 'color'],
    ['emissiveIntensity', 'intensity'],
    ['opacity', 'unit'],
    ['roughness', 'unit'],
    ['metalness', 'unit'],
]);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
/** Cheap validation mirroring the MaterialSpec schema for the live fields (no zod per tick). */
function validLiveValue(kind, value) {
    if (kind === 'color')
        return typeof value === 'string' && HEX_COLOR.test(value);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
        return false;
    return kind === 'unit' ? value <= 1 : value <= 50;
}
const DEG = Math.PI / 180;
/** Transparent materials below this opacity do not cast shadows. */
const SHADOW_OPACITY_MIN = 0.6;
const RESOLVED = Promise.resolve();
/** Minimum interval between view re-plans while the camera keeps moving (ms). */
export const VIEW_INTERVAL_MS = 120;
/** Default virtual-geometry budget: triangles one unique mesh may draw over all its instances. */
export const DEFAULT_VIRTUAL_TRIANGLES = 1_500_000;
// Scratch objects (no per-frame allocations in applyTransforms).
const _inv = new Matrix4();
const _pPos = new Vector3();
const _pQuat = new Quaternion();
const _pScale = new Vector3();
const _q = new Quaternion();
const _v = new Vector3();
const _box = new Box3();
const _box2 = new Box3();
function usesGenerator(shape, ids) {
    if (shape.kind === 'procedural')
        return ids.has(shape.generator);
    if (shape.kind === 'scatter' && shape.of.kind === 'procedural')
        return ids.has(shape.of.generator);
    return false;
}
/** Key under `Mesh.userData` holding the global triangle index of each local triangle (mesh shapes). */
export const MESH_TRIANGLES_KEY = 'aetherTriangles';
let meshKeySeq = 0;
const meshKeys = new WeakMap();
/** Stable per-object key of an (immutable) mesh asset. */
function meshAssetKey(asset) {
    let k = meshKeys.get(asset);
    if (!k) {
        k = `mesh#${++meshKeySeq}`;
        meshKeys.set(asset, k);
    }
    return k;
}
/** Copy resolved uniform values onto a live (owned) material without changing its program. */
function applyLiveUniforms(m, r) {
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
function noRaycast() {
    // intentionally empty: scatter entities are picked through their bounds (see SceneSync.pickScatter)
}
function finite3(v, fallback) {
    const f = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
    return [f(v[0]), f(v[1]), f(v[2])];
}
/** Incremental scene synchronizer. See the module docs. */
/** Largest share of the field instance budget one scatter field may take. */
export const MAX_FIELD_SHARE = 0.45;
export class SceneSync {
    opts;
    /** Parent of every entity object. Keep it untransformed (identity). */
    root = new Group();
    nodes = new Map();
    inflight = new Set();
    warnings = new Map();
    surfaceGrids = new Map();
    /** Surface entity id → ids of scatters placed on it (O(1) dependent lookup). */
    dependents = new Map();
    variant;
    maxInstances;
    maxScatterTriangles;
    totalScatterTriangles = 0;
    placeholderGeometry;
    placeholderMaterial;
    current = null;
    /** Intensity factor of architectural lamps (daylight dimming, see `daylightLampFactor`). */
    archLampScale = 1;
    totalInstances = 0;
    lightsDirty = false;
    /** True while setWorld rebuilds: dependent scatter relayout is deferred to one pass. */
    batching = false;
    disposed = false;
    /** Instanced batches of identical static props (null when disabled). */
    batches;
    /** Content changed since the batches were grouped. */
    batchesStale = true;
    /** Merged building geometry (null when batching is disabled). */
    merges;
    /** Merging paused (e.g. while content grows in and every matrix changes). */
    mergesSuspended = false;
    /** Field budgets (null: fields disabled). */
    fieldBudget;
    /** Nodes currently showing a scatter field. */
    fieldNodes = new Set();
    fieldInstances = 0;
    lodChains = new LodChainCache();
    /** A field was mounted or rebalanced since the last {@link updateView}. */
    viewDirty = false;
    /** Time of the last unthrottled view update (ms; 0 = never). */
    lastViewUpdate = 0;
    view = createLocalView();
    /** Virtual geometry (null: disabled). */
    dags;
    virtualTriangles;
    virtualGroups = new Map();
    /** Locomotion / clip playback of animated assets (loaded with the first animated model). */
    animatorRef = null;
    animatorLoad = null;
    /** Wheels, steering and body sway of modelled vehicles. */
    vehicles = new VehicleRig();
    /** Per-entity clones of the "paint" materials of tinted vehicles (disposed with the content). */
    paintClones = new Map();
    loadAnimator() {
        this.animatorLoad ??= import('./asset-animator').then((m) => (this.animatorRef = new m.AssetAnimator()));
        return this.animatorLoad;
    }
    /** Current gait of an animated asset entity, or null. */
    gaitOf(id) {
        return this.animatorRef?.gaitOf(id) ?? null;
    }
    /** Number of animated asset entities. */
    get animatedCount() {
        return this.animatorRef?.size ?? 0;
    }
    constructor(opts) {
        this.opts = opts;
        this.variant = opts.variant ?? 'standard';
        this.maxInstances = Math.max(0, opts.maxInstances ?? DEFAULT_MAX_INSTANCES);
        this.maxScatterTriangles = Math.max(0, opts.maxScatterTriangles ?? DEFAULT_MAX_SCATTER_TRIANGLES);
        this.root.name = this.variant === 'ghost' ? 'aether:ghost' : this.variant === 'proof' ? 'aether:proof-ghosts' : 'aether:entities';
        this.placeholderGeometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
        this.placeholderMaterial = new MeshStandardMaterial({ color: '#9aa4b2', roughness: 0.9, transparent: true, opacity: 0.35, depthWrite: false });
        this.batches = this.variant === 'standard' && opts.staticBatching !== false ? new StaticBatches(this.root) : null;
        this.merges = this.variant === 'standard' && opts.staticBatching !== false ? new StaticMerges() : null;
        this.fieldBudget = this.variant === 'standard' && opts.fields !== false ? (opts.fields ?? DEFAULT_FIELD_BUDGET) : null;
        const virtual = this.variant === 'standard' && opts.virtual !== false ? (opts.virtual ?? { triangles: DEFAULT_VIRTUAL_TRIANGLES }) : null;
        this.dags = virtual ? new DagClient(virtual.dag) : null;
        this.virtualTriangles = virtual ? Math.max(3, virtual.triangles) : 0;
    }
    /** Whether a scatter field needs a view update even if the camera did not move. */
    get viewNeedsUpdate() {
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
    updateView(camera, heightPx, nowMs = 0) {
        // While the camera moves, re-plan at most every VIEW_INTERVAL_MS (uploads dominate on
        // slow GPUs); the skipped frame leaves the view dirty so the last pose is always planned.
        if (nowMs > 0 && nowMs - this.lastViewUpdate < VIEW_INTERVAL_MS && this.lastViewUpdate > 0) {
            this.viewDirty = true;
            return false;
        }
        this.lastViewUpdate = nowMs;
        this.viewDirty = false;
        let changed = false;
        for (const { group } of this.virtualGroups.values())
            if (group.update(camera, heightPx))
                changed = true;
        if (this.fieldNodes.size === 0)
            return changed;
        for (const node of this.fieldNodes) {
            const field = node.field;
            if (!field || !node.object.visible)
                continue;
            field.group.updateWorldMatrix(true, false);
            if (field.update(localView(camera, field.group, heightPx, this.view)))
                changed = true;
        }
        return changed;
    }
    /** Field statistics: instances held, drawn this frame, triangles drawn. */
    fieldStats() {
        let drawnInstances = 0;
        let drawnTriangles = 0;
        for (const node of this.fieldNodes) {
            if (!node.field || !node.object.visible)
                continue;
            drawnInstances += node.field.culler.drawnInstances;
            drawnTriangles += node.field.culler.drawnTriangles;
        }
        return { fields: this.fieldNodes.size, instances: this.fieldInstances, drawnInstances, drawnTriangles };
    }
    /** True while any scatter field or virtual-geometry mesh is mounted. */
    get scaleGeometryActive() {
        return this.fieldNodes.size > 0 || this.virtualGroups.size > 0;
    }
    /** Virtual-geometry statistics: unique meshes, instances, source and drawn triangles. */
    virtualStats() {
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
    sceneTriangles() {
        let total = 0;
        for (const node of this.nodes.values()) {
            if (!node.object.visible)
                continue;
            if (node.meshBundle) {
                total += node.meshBundle.triangleCount;
                continue;
            }
            if (!node.keyed)
                continue;
            let tris = 0;
            for (const part of node.keyed.output.parts)
                tris += Math.floor(part.indices.length / 3);
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
    updateBatches() {
        const b = this.batches;
        if (!b)
            return false;
        let regrouped = false;
        const stale = this.batchesStale;
        if (this.batchesStale || b.needsRebuild) {
            this.batchesStale = false;
            regrouped = b.rebuild(this.nodes.values());
        }
        const moved = b.count > 0 ? b.update() : false;
        let merged = false;
        const m = this.merges;
        if (m && !this.mergesSuspended) {
            if (stale || this.mergesPending) {
                this.mergesPending = false;
                merged = m.rebuild(this.nodes.values());
            }
            if (m.count > 0 && m.update())
                merged = true;
        }
        return regrouped || moved || merged;
    }
    /** A regroup of the merges is due when merging resumes. */
    mergesPending = true;
    /**
     * Pause or resume building merges. While paused (content growing in, every
     * matrix animating) members draw themselves; resuming regroups.
     */
    setMergesSuspended(on) {
        if (on === this.mergesSuspended)
            return;
        this.mergesSuspended = on;
        if (on)
            this.merges?.clear();
        this.mergesPending = true;
    }
    /** Whether {@link updateBatches} has work (batches exist or a regroup is pending). */
    get batchesActive() {
        const merging = this.merges !== null && !this.mergesSuspended && (this.mergesPending || this.merges.count > 0);
        return (this.batches !== null && (this.batchesStale || this.batches.count > 0 || this.batches.needsRebuild)) || merging;
    }
    /** Static-prop batches / building merges and the draw calls they save per pass. */
    batchStats() {
        return { batches: this.batches?.count ?? 0, drawCallsSaved: (this.batches?.drawCallsSaved ?? 0) + (this.merges?.drawCallsSaved ?? 0), merges: this.merges?.count ?? 0 };
    }
    /** The last world passed to {@link setWorld}. */
    get world() {
        return this.current;
    }
    /** Number of entity nodes (document + transient). */
    get entityCount() {
        return this.nodes.size;
    }
    /** Total scatter instances currently mounted (plain instanced layers and fields). */
    get instanceCount() {
        return this.totalInstances + this.fieldInstances;
    }
    /** Object3D of an entity. */
    object(id) {
        return this.nodes.get(id)?.object;
    }
    /** Bookkeeping node of an entity (read-only use: debug overlays, tests). */
    node(id) {
        return this.nodes.get(id);
    }
    /** Iterate all nodes. */
    forEachNode(fn) {
        for (const n of this.nodes.values())
            fn(n);
    }
    /** Generator output currently mounted for an entity (primitive, procedural or fallback). */
    getOutput(id) {
        const n = this.nodes.get(id);
        if (!n || !n.keyed || n.entity.shape.kind === 'scatter')
            return undefined;
        return n.keyed.output;
    }
    /** Last build warning per entity (generation failures, rejected URLs, budget). */
    getWarnings() {
        return this.warnings;
    }
    /** Entity id owning a scene object (walks up to the entity object). */
    idOf(object) {
        let o = object;
        while (o && o !== this.root) {
            const id = o.userData[ENTITY_ID_KEY];
            if (typeof id === 'string' && this.nodes.get(id)?.object === o)
                return id;
            o = o.parent;
        }
        return null;
    }
    /** Resolves when every in-flight build (including model loads) settled. */
    async whenIdle() {
        while (this.inflight.size > 0)
            await Promise.allSettled([...this.inflight]);
    }
    /**
     * Synchronize to `world`. Structural changes happen synchronously; the
     * returned promise settles when procedural generation started by this call
     * finished (model downloads continue in the background, see {@link whenIdle}).
     */
    setWorld(world) {
        if (this.disposed)
            return RESOLVED;
        const prev = this.current;
        if (prev === world)
            return RESOLVED;
        const diff = prev ? diffWorlds(prev, world) : null;
        this.current = world;
        if (diff && diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0 && diff.generatorsChanged.length === 0 && diff.meshesChanged.length === 0)
            return RESOLVED;
        const renderable = renderableIds(world);
        const started = [];
        const rebuild = new Set();
        const attach = new Set();
        const moved = new Set();
        for (const [id, node] of this.nodes) {
            const inDoc = renderable.has(id);
            if (node.transient ? Object.hasOwn(world.entities, id) : !inDoc)
                this.removeNode(node);
        }
        for (const id of renderable) {
            if (this.nodes.has(id))
                continue;
            const entity = world.entities[id];
            if (!entity)
                continue;
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
                if (!node || rebuild.has(id) || !before || !after)
                    continue;
                node.overridden = false;
                const flags = this.updateNode(node, node.entity, after);
                if (flags.rebuild)
                    rebuild.add(id);
                if (flags.reparent)
                    attach.add(id);
                if (flags.moved || flags.rebuild)
                    moved.add(id);
            }
            if (diff.generatorsChanged.length > 0) {
                const changedGens = new Set(diff.generatorsChanged);
                for (const node of this.nodes.values()) {
                    if (!usesGenerator(node.entity.shape, changedGens))
                        continue;
                    rebuild.add(node.id);
                    moved.add(node.id);
                }
            }
            if (diff.meshesChanged.length > 0) {
                const changedMeshes = new Set(diff.meshesChanged);
                for (const node of this.nodes.values()) {
                    const s = node.entity.shape;
                    if (s.kind !== 'mesh' || !changedMeshes.has(s.mesh) || node.transient)
                        continue;
                    rebuild.add(node.id);
                    moved.add(node.id);
                }
            }
        }
        if (rebuild.size > 0) {
            // Existing orphans whose parent (re)appeared in this sync.
            for (const node of this.nodes.values()) {
                const parentId = node.entity.parent;
                if (parentId !== null && node.object.parent === this.root && this.nodes.has(parentId))
                    attach.add(node.id);
            }
        }
        for (const id of attach) {
            const node = this.nodes.get(id);
            if (node)
                this.attach(node);
        }
        this.batching = true;
        try {
            for (const id of rebuild) {
                const node = this.nodes.get(id);
                if (node)
                    started.push(this.rebuild(node));
            }
        }
        finally {
            this.batching = false;
        }
        this.relayoutDependents(moved, started);
        if (this.lightsDirty)
            this.applyShadowCap();
        this.batchesStale = true;
        return Promise.all(started).then(() => {
            this.batchesStale = true;
        });
    }
    /** Add a runtime-spawned entity that is not part of the document. Returns false on id conflicts. */
    addTransient(entity) {
        if (this.disposed || this.nodes.has(entity.id) || entity.template)
            return false;
        const node = this.createNode(entity, true);
        this.attach(node);
        const p = this.rebuild(node);
        if (this.lightsDirty)
            this.applyShadowCap();
        return p;
    }
    /** Remove a runtime-spawned entity. Document entities are never removed here. */
    removeTransient(id) {
        const node = this.nodes.get(id);
        if (!node || !node.transient)
            return false;
        this.removeNode(node);
        if (this.lightsDirty)
            this.applyShadowCap();
        return true;
    }
    /**
     * Runtime property override (logic `setProperty`). Cheap fast paths for
     * `visible` and `light.intensity`; anything else is applied to a validated
     * copy of the entity. Returns false when the entity is unknown or the value
     * is invalid.
     */
    setProperty(id, path, value) {
        const node = this.nodes.get(id);
        if (!node)
            return false;
        this.batchesStale = true;
        if (path === 'visible' && typeof value === 'boolean') {
            node.entity = { ...node.entity, visible: value };
            node.object.visible = value;
            node.overridden = true;
            return true;
        }
        if (path === 'light.intensity' && typeof value === 'number' && Number.isFinite(value) && value >= 0 && node.entity.light && node.light) {
            const light = { ...node.entity.light, intensity: value };
            node.entity = { ...node.entity, light };
            if (node.entity.arch?.role === 'light')
                this.applyLampScale(node.light.light, light);
            else
                updateLightParams(node.light.light, light);
            node.overridden = true;
            return true;
        }
        if (path.startsWith('material.') && this.variant === 'standard') {
            const field = path.slice('material.'.length);
            const kind = LIVE_MATERIAL_FIELDS.get(field);
            if (kind) {
                if (validLiveValue(kind, value))
                    return this.setLiveMaterial(node, field, value);
                log.debug(`setProperty ${id}.${path} rejected: invalid value`);
                return false;
            }
        }
        const res = setEntityPath(node.entity, path, value);
        if (!res.ok) {
            log.debug(`setProperty ${id}.${path} rejected: ${res.error}`);
            return false;
        }
        const next = { ...res.entity, id: node.id, parent: node.entity.parent, template: false };
        const flags = this.updateNode(node, node.entity, next);
        node.overridden = true;
        if (flags.rebuild)
            void this.rebuild(node);
        if (flags.moved)
            this.relayoutDependents(new Set([id]), []);
        if (this.lightsDirty)
            this.applyShadowCap();
        return true;
    }
    /**
     * Scale architectural lamps (`arch.role` "light"): the renderer dims them
     * in daylight. Updates live lights in place (no allocation, no rebuild).
     */
    setArchLampScale(scale) {
        const s = Number.isFinite(scale) ? Math.max(0, Math.min(1, scale)) : 1;
        if (s === this.archLampScale)
            return;
        this.archLampScale = s;
        for (const node of this.nodes.values()) {
            if (node.light && node.entity.light && node.entity.arch?.role === 'light')
                this.applyLampScale(node.light.light, node.entity.light);
        }
    }
    /**
     * Intensity of an architectural lamp under the daylight scale. Below
     * {@link LAMP_CUTOFF} the light is switched off entirely (invisible lights
     * cost nothing per pixel; a dozen point lights in a sunlit room otherwise
     * do, for no visible effect).
     */
    applyLampScale(light, spec) {
        updateLightParams(light, spec, this.archLampScale);
        light.visible = this.archLampScale >= LAMP_CUTOFF && spec.intensity > 0;
    }
    lightScale(node) {
        return node.entity.arch?.role === 'light' ? this.archLampScale : 1;
    }
    /**
     * Restore one overridden node to its document entity (view modes undo
     * their own overrides without touching others). Returns true when the
     * node was overridden.
     */
    restoreNode(id) {
        const node = this.nodes.get(id);
        const docEntity = this.current?.entities[id];
        if (!node || !node.overridden || node.transient || !docEntity)
            return false;
        this.batchesStale = true;
        node.overridden = false;
        const flags = this.updateNode(node, node.entity, docEntity);
        if (flags.rebuild)
            void this.rebuild(node);
        else if (node.bindings.some((b) => b.ownedMaterial))
            this.rematerial(node);
        this.applyTransform(node);
        if (this.lightsDirty)
            this.applyShadowCap();
        return true;
    }
    /** Drop every runtime override, restoring document values (e.g. on play reset). */
    clearOverrides() {
        const world = this.current;
        if (!world)
            return;
        this.batchesStale = true;
        for (const node of this.nodes.values()) {
            if (!node.overridden || node.transient)
                continue;
            const docEntity = world.entities[node.id];
            if (!docEntity)
                continue;
            node.overridden = false;
            const flags = this.updateNode(node, node.entity, docEntity);
            if (flags.rebuild)
                void this.rebuild(node);
            else if (node.bindings.some((b) => b.ownedMaterial))
                this.rematerial(node);
            // Physics/logic may have moved the object; always restore the document pose.
            this.applyTransform(node);
        }
        if (this.lightsDirty)
            this.applyShadowCap();
    }
    /**
     * Scatter entity whose world bounds the ray hits first (scatter instances
     * are excluded from mesh raycasts). Returns the hit distance and id, or null.
     */
    pickScatter(ray) {
        let best = null;
        for (const node of this.nodes.values()) {
            if (node.instances === 0 || !node.object.visible)
                continue;
            _box.makeEmpty();
            for (const b of node.bindings) {
                const mesh = b.mesh;
                if ((!mesh.visible && !node.field) || !(mesh instanceof InstancedMesh) || !mesh.boundingBox)
                    continue;
                mesh.updateWorldMatrix(true, false);
                _box2.copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld);
                _box.union(_box2);
            }
            if (_box.isEmpty() || !ray.intersectBox(_box, _v))
                continue;
            const distance = _v.distanceTo(ray.origin);
            if (!best || distance < best.distance)
                best = { id: node.id, distance };
        }
        return best;
    }
    /**
     * Apply packed world-space poses `[px,py,pz,qx,qy,qz,qw]*` (from
     * `PhysicsWorld.writeTransforms`). Zero allocations. Parented bodies are
     * converted into their parent's space.
     */
    applyTransforms(packed, order) {
        const n = Math.min(order.length, Math.floor(packed.length / 7));
        for (let i = 0; i < n; i++) {
            const node = this.nodes.get(order[i]);
            if (!node)
                continue;
            const o = i * 7;
            const px = packed[o];
            const py = packed[o + 1];
            const pz = packed[o + 2];
            const qx = packed[o + 3];
            const qy = packed[o + 4];
            const qz = packed[o + 5];
            const qw = packed[o + 6];
            if (!(Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz) && Number.isFinite(qx) && Number.isFinite(qy) && Number.isFinite(qz) && Number.isFinite(qw)))
                continue;
            const obj = node.object;
            const parent = obj.parent;
            if (!parent || parent === this.root) {
                obj.position.set(px, py, pz);
                obj.quaternion.set(qx, qy, qz, qw);
            }
            else {
                parent.updateWorldMatrix(true, false);
                const pm = parent.matrixWorld;
                if (pm.determinant() === 0)
                    continue;
                pm.decompose(_pPos, _pQuat, _pScale);
                _inv.copy(pm).invert();
                obj.position.set(px, py, pz).applyMatrix4(_inv);
                _q.set(qx, qy, qz, qw);
                obj.quaternion.copy(_pQuat.invert()).multiply(_q);
            }
            obj.updateMatrix();
            // A moving high-poly mesh re-plans its cut on the next frame.
            if (node.virtual.length > 0)
                this.viewDirty = true;
        }
    }
    /**
     * World-space bounds of all visible entity content (helpers excluded).
     * Updates world matrices first. Not for per-frame use.
     */
    computeBounds(target, filter) {
        target.makeEmpty();
        this.root.updateMatrixWorld(true);
        for (const node of this.nodes.values()) {
            if (!node.object.visible || (filter && !filter(node)))
                continue;
            _box.setFromObject(node.content);
            if (!_box.isEmpty())
                target.union(_box);
        }
        return target;
    }
    /** World bounds of one entity including its children (empty when unknown). */
    entityBounds(id, target) {
        target.makeEmpty();
        const node = this.nodes.get(id);
        if (!node)
            return target;
        node.object.updateWorldMatrix(true, true);
        target.setFromObject(node.object);
        return target;
    }
    /** Remove everything (keeps caches alive for reuse). */
    clear() {
        this.batches?.clear();
        this.merges?.clear();
        this.batchesStale = true;
        this.mergesPending = true;
        for (const node of [...this.nodes.values()])
            this.removeNode(node);
        this.current = null;
        this.warnings.clear();
    }
    /** Dispose all nodes and owned resources. Shared caches are disposed by their owner. */
    dispose() {
        if (this.disposed)
            return;
        this.clear();
        this.disposed = true;
        this.dags?.dispose();
        this.placeholderGeometry.dispose();
        this.placeholderMaterial.dispose();
        this.root.removeFromParent();
    }
    // -------------------------------------------------------------------------
    // Node lifecycle
    // -------------------------------------------------------------------------
    createNode(entity, transient) {
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
    syncCharacter(node) {
        const chars = this.opts.characters;
        if (!chars || this.variant !== 'standard')
            return;
        const spec = node.entity.character;
        if (!spec) {
            if (node.characterBody !== null) {
                chars.remove(node.id);
                node.characterBody = null;
                node.content.visible = true;
            }
            return;
        }
        const taken = new Set();
        for (const other of this.nodes.values())
            if (other !== node && other.characterBody)
                taken.add(other.characterBody);
        const look = resolveLook(spec, node.id, { taken });
        node.characterBody = look.body.id;
        node.content.visible = false;
        const shape = node.entity.shape;
        // Collider shapes are centred on the body; models and assets stand on their origin.
        const footOffset = shape.kind === 'primitive' ? -(shape.size[1] * 0.5) : 0;
        const token = ++node.charToken;
        void this.track(chars.add(node.id, look, node.object, { footOffset, track: node.object, castShadow: node.entity.castShadow }).then((rig) => {
            if (!rig && node.charToken === token && this.nodes.get(node.id) === node)
                node.content.visible = true;
            if (rig)
                this.opts.onContentChanged?.(node.id);
        }));
    }
    /** True when the entity shows a person (its own shape is only the collider). */
    hasCharacter(id) {
        return (this.nodes.get(id)?.characterBody ?? null) !== null;
    }
    /** The animated person of an entity, or null (tests, the studio's NPC feed). */
    characterRig(id) {
        return this.opts.characters?.rig(id) ?? null;
    }
    /** Keep the surface → scatter index in sync with a shape change. */
    indexScatter(id, before, after) {
        const oldSurface = before?.kind === 'scatter' ? before.onSurface : undefined;
        const newSurface = after?.kind === 'scatter' ? after.onSurface : undefined;
        if (oldSurface === newSurface)
            return;
        if (oldSurface) {
            const set = this.dependents.get(oldSurface);
            set?.delete(id);
            if (set && set.size === 0)
                this.dependents.delete(oldSurface);
        }
        if (newSurface) {
            let set = this.dependents.get(newSurface);
            if (!set)
                this.dependents.set(newSurface, (set = new Set()));
            set.add(id);
        }
    }
    removeNode(node) {
        node.token++;
        if (node.characterBody !== null)
            this.opts.characters?.remove(node.id);
        this.batchesStale = true;
        this.teardownContent(node);
        if (node.light) {
            disposeEntityLight(node.light);
            node.light = null;
            this.lightsDirty = true;
        }
        // Orphaned child entities go back to the root; the attach pass re-parents survivors.
        for (const child of [...node.object.children])
            if (typeof child.userData[ENTITY_ID_KEY] === 'string')
                this.root.add(child);
        node.object.removeFromParent();
        this.indexScatter(node.id, node.entity.shape, undefined);
        this.nodes.delete(node.id);
        this.warnings.delete(node.id);
        this.surfaceGrids.delete(node.id);
    }
    attach(node) {
        const parentId = node.entity.parent;
        const parentNode = parentId ? this.nodes.get(parentId) : undefined;
        let target = parentNode && parentNode !== node ? parentNode.object : this.root;
        // Never create a cycle in the scene graph (defensive: core already rejects cyclic parents).
        for (let o = target; o; o = o.parent) {
            if (o === node.object) {
                target = this.root;
                break;
            }
        }
        if (node.object.parent !== target)
            target.add(node.object);
    }
    applyTransform(node) {
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
    updateNode(node, before, after) {
        node.entity = after;
        if (before.shape !== after.shape)
            this.indexScatter(node.id, before.shape, after.shape);
        const transformChanged = !deepEqual(before.transform, after.transform);
        if (transformChanged)
            this.applyTransform(node);
        node.object.visible = after.visible;
        const reparent = before.parent !== after.parent;
        // Mesh colliders depend on the body type (trimesh vs hull).
        const rebuild = !deepEqual(before.shape, after.shape) || (after.shape.kind === 'mesh' && before.physics?.body !== after.physics?.body);
        if (!rebuild && !deepEqual(before.material, after.material)) {
            if (after.shape.kind === 'asset' && before.material?.color !== after.material?.color)
                this.paintAsset(node);
            this.rematerial(node);
        }
        if (!rebuild && (before.castShadow !== after.castShadow || before.receiveShadow !== after.receiveShadow))
            this.applyShadowFlags(node);
        if (!deepEqual(before.light, after.light))
            this.syncLight(node, before);
        if (!deepEqual(before.character, after.character) || !deepEqual(before.shape, after.shape))
            this.syncCharacter(node);
        return { rebuild, reparent, moved: transformChanged || reparent };
    }
    // -------------------------------------------------------------------------
    // Content
    // -------------------------------------------------------------------------
    track(p) {
        this.inflight.add(p);
        void p.finally(() => this.inflight.delete(p));
        return p;
    }
    isCurrent(node, token) {
        return !this.disposed && node.token === token && this.nodes.get(node.id) === node;
    }
    warn(id, message) {
        this.warnings.set(id, message);
        log.warn(`${id}: ${message}`);
    }
    /** (Re)build an entity's content from its shape. The returned promise never rejects. */
    rebuild(node) {
        // Detach the old content but keep its GPU resources retained until the new
        // content has acquired its own: shared materials/geometries with the same
        // key are then reused instead of being disposed and re-created.
        const retired = this.detachContent(node);
        this.warnings.delete(node.id);
        const token = ++node.token;
        const world = this.current ?? { generators: {} };
        const shape = node.entity.shape;
        let work = null;
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
                        if (!this.isCurrent(node, token))
                            return;
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
        }
        catch (e) {
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
            .catch((e) => {
            if (this.isCurrent(node, token))
                this.mountFailure(node, errorMessage(e));
        })
            .finally(() => {
            this.releaseRetired(retired);
            if (!this.isCurrent(node, token))
                return;
            node.pending = false;
            this.contentChanged(node);
        });
        node.ready = done;
        // Model downloads are not awaited by setWorld (network); generation is.
        const tracked = this.track(done);
        return shape.kind === 'model' || shape.kind === 'asset' ? RESOLVED : tracked;
    }
    resolveProcedural(node, shape, world) {
        return this.opts.source.procedural(shape, world).then((keyed) => ({ keyed, failed: false }), (e) => {
            const msg = errorMessage(e);
            this.warn(node.id, `generator "${shape.generator.slice(0, 64)}" failed: ${msg}`);
            return { keyed: this.opts.source.fallback(msg), failed: true };
        });
    }
    mountFailure(node, reason) {
        this.teardownContent(node);
        this.warn(node.id, reason);
        node.failed = true;
        try {
            this.mountOutput(node, this.opts.source.fallback(reason), false);
        }
        catch (e) {
            log.error(`fallback geometry failed for ${node.id}`, e);
        }
    }
    buildModel(node, url, fitSize, token) {
        const models = this.opts.models;
        if (!models)
            return Promise.reject(new Error('model loading is not available'));
        this.mountPlaceholder(node);
        node.modelUrl = url;
        return models.acquire(url).then((source) => {
            if (!this.isCurrent(node, token))
                return;
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
    /** Advance asset animations (characters, animals). Returns true when a redraw is needed. */
    updateAnimations(dt) {
        const animated = this.animatorRef?.update(dt) ?? false;
        const driven = this.vehicles.update(dt);
        return animated || driven;
    }
    /**
     * Tint the "paint" material of a modelled vehicle (library models name their body paint "paint") with the
     * entity's `material.color`. Each tinted entity gets its own clone, so a red kart and a blue one can share a file.
     */
    paintAsset(node) {
        const color = node.entity.material?.color;
        if (!color || this.variant !== 'standard')
            return;
        let clones = this.paintClones.get(node.id);
        node.content.traverse((o) => {
            if (!(o instanceof Mesh))
                return;
            const m = o.material;
            if (Array.isArray(m) || !(m instanceof MeshStandardMaterial) || (m.name !== 'paint' && m.userData['aetherPaint'] !== true))
                return;
            let own = m;
            if (m.userData['aetherPaint'] !== true) {
                own = m.clone();
                own.userData['aetherPaint'] = true;
                o.material = own;
                clones ??= [];
                clones.push(own);
                this.paintClones.set(node.id, clones);
            }
            own.color.set(color);
        });
    }
    /**
     * Mount a library or imported asset. Fallback chain when the asset is
     * unknown or fails to load: a generator asset's procedural shape, then the
     * shape's own `fallback`, then a translucent box of the asset's size.
     */
    buildAsset(node, shape, world, token) {
        this.mountPlaceholder(node);
        return loadCatalog().then(async () => {
            if (!this.isCurrent(node, token))
                return;
            const info = assetInfo(effectiveAssetId(shape));
            const scale = info ? fitScale(info.size, shape.fitSize) : 1;
            if (info)
                this.sizePlaceholder(node, info.size[0] * scale, info.size[1] * scale, info.size[2] * scale);
            try {
                if (!info || info.kind === 'hdri' || info.kind === 'material')
                    throw new Error(info ? `"${shape.id}" is a ${info.kind === 'hdri' ? 'sky' : 'surface material'}, not an object` : `asset "${shape.id.slice(0, 64)}" is not available`);
                if (info.kind === 'generator') {
                    const g = info.entry?.generator;
                    if (!g)
                        throw new Error(`asset "${shape.id}" has no generator`);
                    const { keyed, failed } = await this.resolveProcedural(node, { kind: 'procedural', generator: g.id, params: { ...g.params } }, world);
                    if (!this.isCurrent(node, token))
                        return;
                    this.teardownContent(node);
                    this.mountOutput(node, keyed, false);
                    node.failed = failed;
                    return;
                }
                if (info.kind === 'image')
                    await this.mountPosterAsset(node, info, scale, token);
                else
                    await this.mountModelAsset(node, shape, info, scale, token);
            }
            catch (e) {
                if (!this.isCurrent(node, token))
                    return;
                await this.mountAssetFallback(node, shape, world, token, errorMessage(e));
            }
        });
    }
    sizePlaceholder(node, w, h, d) {
        for (const child of node.content.children) {
            if (child.name !== 'placeholder')
                continue;
            child.scale.set(Math.max(0.05, w), Math.max(0.05, h), Math.max(0.05, d));
            child.updateMatrix();
        }
    }
    async mountModelAsset(node, shape, info, scale, token) {
        const models = this.opts.models;
        if (!models || !info.url)
            throw new Error('model loading is not available');
        const url = info.url;
        const lodUrls = this.variant === 'standard' ? info.lodUrls : [];
        const urls = [url, ...lodUrls];
        // One reference per URL, held until the content is torn down (or released at once on failure / staleness).
        const loads = urls.map((u) => models.acquire(u));
        const release = () => {
            for (const u of urls)
                models.release(u);
        };
        let sources;
        try {
            sources = await Promise.all(loads);
        }
        catch (e) {
            release();
            throw e;
        }
        if (!this.isCurrent(node, token)) {
            release();
            return;
        }
        this.clearPlaceholder(node);
        node.releases.push(release);
        const main = instantiateAsset(sources[0], scale);
        let content = main;
        if (sources.length > 1 && info.entry) {
            const lod = new LOD();
            lod.name = 'asset-lod';
            lod.addLevel(main, 0);
            const dist = lodDistances(info.entry, 50, scale);
            for (let i = 1; i < sources.length; i++) {
                const level = instantiateAsset(sources[i], scale);
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
        if (standard) {
            this.paintAsset(node);
            if (isVehicleModel(main)) {
                this.vehicles.add(node.id, main, node.object);
                node.releases.push(() => {
                    this.vehicles.remove(node.id);
                    for (const m of this.paintClones.get(node.id) ?? [])
                        m.dispose();
                    this.paintClones.delete(node.id);
                });
            }
        }
        const clipRoot = main.children[0];
        if (standard && info.anims && clipRoot && clipRoot.animations.length > 0) {
            const animator = await this.loadAnimator();
            if (!this.isCurrent(node, token))
                return;
            animator.add(node.id, clipRoot, node.object, info.anims, shape.animation);
            node.releases.push(() => animator.remove(node.id));
        }
    }
    async mountPosterAsset(node, info, scale, token) {
        const textures = this.opts.textures;
        if (!textures || !info.url)
            throw new Error('image loading is not available');
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
    async mountAssetFallback(node, shape, world, token, reason) {
        const fb = shape.fallback;
        if (fb?.kind === 'procedural') {
            const { keyed } = await this.resolveProcedural(node, fb, world);
            if (!this.isCurrent(node, token))
                return;
            this.teardownContent(node);
            this.mountOutput(node, keyed, false);
        }
        else if (fb?.kind === 'primitive') {
            this.teardownContent(node);
            this.mountOutput(node, this.opts.source.primitive(fb), fb.primitive === 'plane');
        }
        else {
            // Keep the (sized) translucent placeholder as the stand-in.
            if (!node.placeholder)
                this.mountPlaceholder(node);
        }
        this.warn(node.id, `${reason}; showing a stand-in`);
        node.failed = true;
    }
    buildScatter(node, shape, world, token) {
        const of = shape.of;
        const keyedP = of.kind === 'primitive' ? Promise.resolve({ keyed: this.opts.source.primitive(of), failed: false }) : this.resolveProcedural(node, of, world);
        // Read the surface's `ready` one microtask later so a terrain rebuilt in the same sync is awaited.
        const surfaceP = Promise.resolve().then(() => {
            const s = shape.onSurface ? this.nodes.get(shape.onSurface) : undefined;
            return s && s !== node ? s.ready : undefined;
        });
        return Promise.all([keyedP, surfaceP]).then(([{ keyed, failed }]) => {
            if (!this.isCurrent(node, token))
                return;
            this.mountScatter(node, shape, keyed);
            node.failed = failed;
        });
    }
    /** True when several field-sized scatter layers together ask for more than `budget` instances. */
    fieldDemand(budget) {
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
    mountScatter(node, shape, keyed) {
        const requested = Math.min(shape.points ? shape.points.length : shape.count, MAX_SCATTER_INSTANCES);
        if (this.fieldBudget && requested >= FIELD_MIN_INSTANCES && keyed.output.parts.length > 0) {
            this.mountField(node, shape, keyed, requested, this.fieldBudget);
            return;
        }
        const available = this.maxInstances - this.totalInstances;
        const wanted = Math.min(shape.points ? shape.points.length : shape.count, MAX_SCATTER_INSTANCES);
        let trisPerInstance = 0;
        for (const part of keyed.output.parts)
            trisPerInstance += Math.floor(part.indices.length / 3);
        const triAvailable = this.maxScatterTriangles - this.totalScatterTriangles;
        const byTriangles = trisPerInstance > 0 ? Math.floor(Math.max(0, triAvailable) / trisPerInstance) : wanted;
        const budget = Math.max(0, Math.min(wanted, available, byTriangles));
        if (budget < wanted) {
            this.warn(node.id, `scatter limited to ${budget} of ${wanted} instances (renderer budget ${this.maxInstances} instances / ${this.maxScatterTriangles} triangles)`);
        }
        if (budget === 0)
            return;
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
     * Mount a huge scatter layer as a {@link ScatterField}: packed placements
     * sorted into chunks, automatic LOD levels from the QEM simplifier, and a
     * share of the renderer's field triangle budget.
     */
    mountField(node, shape, plain, requested, budget) {
        const keyed = softenKeyed(plain, node.entity.material);
        const available = Math.max(0, budget.maxInstances - this.fieldInstances);
        // When the world asks for more than the budget, no single field may starve the rest: two huge forests used to take
        // everything and leave the ground cover at 0.
        const shareCap = this.fieldDemand(budget.maxInstances) ? Math.floor(budget.maxInstances * MAX_FIELD_SHARE) : Infinity;
        const count = Math.min(requested, available, shareCap);
        if (count < requested)
            this.warn(node.id, `scatter field limited to ${count} of ${requested} instances (renderer field budget ${budget.maxInstances})`);
        if (count === 0)
            return;
        const placements = scatterPlacements(shape, count);
        const lift = shape.of.kind === 'primitive' ? primitiveLift(shape.of.primitive, shape.of.size) : 0;
        const sampler = shape.onSurface ? this.surfaceSampler(node, shape.onSurface) : undefined;
        const radius = Math.max(1e-3, outputRadius(keyed.output));
        const chunks = buildChunks(composeScatterPacked(placements, lift, sampler), placements.count, radius);
        const chain = this.lodChains.get(keyed.key, keyed.output);
        const parts = keyed.output.parts;
        node.keyed = keyed;
        node.partCount = parts.length;
        const levels = [];
        const materials = [];
        const handles = [];
        try {
            for (let l = 0; l < chain.length; l++) {
                const geometries = [];
                for (let i = 0; i < parts.length; i++) {
                    const src = parts[i];
                    const g = this.opts.geometries.acquire(lodOutputKey(keyed.key, l), i, lodPart(chain, l, i, src));
                    node.geometryKeys.push(g.key);
                    geometries.push(g.geometry);
                }
                levels.push({ geometries, triangles: chain[l].triangles });
            }
        }
        catch (e) {
            this.warn(node.id, `invalid scatter mesh: ${errorMessage(e)}`);
            return;
        }
        // Field capacity follows the field's size (a 400k+ layer may use the whole budget).
        const cap = Math.max(budget.triangles * 0.15, Math.min(budget.triangles, (budget.triangles * placements.count) / 400_000));
        // Vegetation fields sway in the wind (vertex shader only).
        const variant = shape.of.kind === 'procedural' && FOLIAGE_GENERATORS.has(shape.of.generator) ? 'foliage' : this.variant;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const hasColors = part.colors instanceof Float32Array && part.colors.length > 0;
            const handle = this.opts.materials.acquire(mergeMaterial(part.material, node.entity.material, parts.length), { hasVertexColors: hasColors, doubleSided: false }, variant);
            materials.push(handle.material);
            handles.push({ key: handle.key, hasColors, seeThrough: handle.resolved.transparent && handle.resolved.opacity < SHADOW_OPACITY_MIN, part });
        }
        const field = new ScatterField(chunks, levels, materials, radius, cap);
        // One binding per (level, part) mesh; each holds its own material reference.
        for (let m = 0; m < field.meshes.length; m++) {
            const h = handles[m % parts.length];
            const key = m < parts.length ? h.key : this.opts.materials.acquire(mergeMaterial(h.part.material, node.entity.material, parts.length), { hasVertexColors: h.hasColors, doubleSided: false }, variant).key;
            node.bindings.push({ mesh: field.meshes[m], partMaterial: h.part.material, hasColors: h.hasColors, doubleSided: false, materialKey: key, seeThrough: h.seeThrough, ownedMaterial: null, ...(variant !== this.variant ? { variant } : {}) });
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
    rebalanceFields() {
        this.viewDirty = true;
        const budget = this.fieldBudget;
        if (!budget || this.fieldNodes.size === 0)
            return;
        const nodes = [...this.fieldNodes];
        const shares = shareBudget(budget.triangles, nodes.map((n) => n.instances));
        nodes.forEach((n, i) => n.field?.culler.setBudget(shares[i]));
    }
    /**
     * Mount an editable mesh asset: one Mesh per material slot sharing one set
     * of vertex attributes. `keyed` carries the data for colliders, scatter
     * surfaces and bounds (no geometry-cache entry: the node owns the bundle).
     */
    mountMesh(node, meshId) {
        const world = this.current;
        const asset = world && Object.hasOwn(world.meshes ?? {}, meshId) ? world.meshes[meshId] : undefined;
        if (!asset)
            throw new Error(`mesh "${meshId.slice(0, 64)}" is missing`);
        const data = decodeMeshCached(asset);
        const slotMaterials = asset.materials.length > 0 ? asset.materials : [{}];
        const bundle = buildMeshGeometry(data, slotMaterials.length);
        node.meshBundle = bundle;
        const body = node.entity.physics?.body ?? 'static';
        const colliders = body === 'dynamic' ? meshColliders(data, 'dynamic') : [{ kind: 'trimesh', positions: data.positions, indices: data.indices }];
        const bb = bundle.full.boundingBox;
        node.keyed = {
            key: meshAssetKey(asset),
            output: {
                parts: [{ positions: data.positions, normals: bundle.normal.array, indices: data.indices, material: slotMaterials[0] ?? {} }],
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
    refresh(id) {
        const node = this.nodes.get(id);
        if (!node)
            return false;
        void this.rebuild(node);
        return true;
    }
    /**
     * Rebuild every entity showing one of `assetIds` (or any asset when
     * omitted): user imports registered after the world loaded, or a library
     * that finished loading. Returns how many were rebuilt (the environment
     * HDRI is the renderer's job).
     */
    refreshAssets(assetIds) {
        let n = 0;
        for (const node of this.nodes.values()) {
            const s = node.entity.shape;
            if (s.kind !== 'asset' || node.entity.template)
                continue;
            if (assetIds && !assetIds.has(s.id) && !(s.variant && assetIds.has(s.variant)))
                continue;
            void this.rebuild(node);
            n++;
        }
        return n;
    }
    /** Geometry bundle of a mounted mesh entity (editor overlays, picking), or null. */
    meshBundle(id) {
        return this.nodes.get(id)?.meshBundle ?? null;
    }
    /**
     * Live preview of an editable mesh without a document change: overwrite
     * positions and/or vertex colours (same vertex count) of the mounted
     * geometry. Painting a mesh without colours switches its materials to
     * vertex colours once. Returns false when the preview cannot be applied
     * (unknown entity, not a mesh, size mismatch).
     */
    previewMesh(id, positions, colors) {
        const node = this.nodes.get(id);
        const bundle = node?.meshBundle;
        if (!node || !bundle)
            return false;
        if (!previewMeshGeometry(bundle, positions, colors))
            return false;
        if (colors && node.bindings.some((b) => !b.hasColors)) {
            for (const b of node.bindings)
                b.hasColors = true;
            this.rematerial(node);
        }
        return true;
    }
    /** Mount one mesh (or instanced mesh) per generator part. */
    mountOutput(node, plain, doubleSided, instances) {
        const keyed = softenKeyed(plain, node.entity.material);
        const parts = keyed.output.parts;
        node.keyed = keyed;
        node.partCount = parts.length;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!part)
                continue;
            let geometryKey;
            let mesh;
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
                }
                else {
                    mesh = new Mesh(g.geometry, handle.material);
                    // Large parts (terrain) raycast through a BVH: picking, snapping and camera occlusion stay O(log n).
                    accelerateRaycast(mesh);
                    if (this.dags && part.indices.length / 3 >= VIRTUAL_MIN_TRIANGLES)
                        this.virtualize(node, mesh, g.key, part.positions, part.indices);
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
            }
            catch (e) {
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
    virtualize(node, source, key, positions, indices) {
        const dags = this.dags;
        if (!dags)
            return;
        const token = node.token;
        const geometry = source.geometry;
        // Never draw the full-detail mesh: it stays raycast-only and the cluster cut streams in
        // once the hierarchy is built (a cached hierarchy appears on the next frame).
        source.layers.set(BATCHED_LAYER);
        dags.build(key, positions, indices).then((dag) => {
            if (this.disposed || node.token !== token || source.parent !== node.content || !node.bindings.some((b) => b.mesh === source))
                return;
            let entry = this.virtualGroups.get(key);
            if (!entry) {
                entry = { group: new VirtualGroup(dag, geometry, Math.min(this.virtualTriangles, Math.max(dag.baseTriangles, 65_536) * 3)), refs: 0 };
                this.virtualGroups.set(key, entry);
            }
            entry.refs++;
            const mesh = entry.group.add(source);
            mirror(mesh, source);
            source.layers.set(BATCHED_LAYER);
            node.content.add(mesh);
            node.virtual.push({ key, mesh, source });
            this.viewDirty = true;
            this.opts.onContentChanged?.(node.id);
        }, (e) => {
            // No hierarchy (too large, worker failure): draw the plain mesh after all.
            if (node.token === token)
                source.layers.set(0);
            log.debug(`virtual geometry unavailable for ${node.id}: ${errorMessage(e)}`);
            this.opts.onContentChanged?.(node.id);
        });
    }
    /** Drop an entity's virtual stand-ins (the group is disposed with its last instance). */
    releaseVirtual(node) {
        for (const v of node.virtual) {
            v.source.layers.set(0);
            const entry = this.virtualGroups.get(v.key);
            if (!entry)
                continue;
            entry.group.remove(v.mesh);
            if (--entry.refs <= 0) {
                entry.group.dispose();
                this.virtualGroups.delete(v.key);
            }
        }
        node.virtual = [];
    }
    mountPlaceholder(node) {
        const mesh = new Mesh(this.placeholderGeometry, this.placeholderMaterial);
        mesh.name = 'placeholder';
        mesh.matrixAutoUpdate = false;
        node.content.add(mesh);
        node.placeholder = true;
    }
    clearPlaceholder(node) {
        if (!node.placeholder)
            return;
        for (const child of [...node.content.children])
            if (child.name === 'placeholder')
                node.content.remove(child);
        node.placeholder = false;
    }
    /** Release everything mounted in `content` (geometry/material refs, model ref, instances). */
    teardownContent(node) {
        this.releaseRetired(this.detachContent(node));
    }
    /**
     * Remove everything mounted in `content` and reset the bookkeeping, returning
     * the still-retained resources. Pair with {@link releaseRetired}.
     */
    detachContent(node) {
        this.releaseVirtual(node);
        const retired = { materialKeys: [], geometryKeys: node.geometryKeys, owned: [], modelUrl: node.modelUrl, bundle: node.meshBundle, releases: node.releases };
        node.meshBundle = null;
        node.releases = [];
        for (const b of node.bindings) {
            retired.materialKeys.push(b.materialKey);
            if (b.ownedMaterial)
                retired.owned.push(b.ownedMaterial);
            if (b.mesh instanceof InstancedMesh)
                b.mesh.dispose();
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
        this.surfaceGrids.delete(node.id);
        return retired;
    }
    releaseRetired(r) {
        for (const m of r.owned)
            m.dispose();
        for (const k of r.materialKeys)
            this.opts.materials.release(k);
        for (const k of r.geometryKeys)
            this.opts.geometries.release(k);
        if (r.modelUrl !== null)
            this.opts.models?.release(r.modelUrl);
        r.bundle?.dispose();
        r.bundle = null;
        for (const release of r.releases)
            release();
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
    setLiveMaterial(node, field, value) {
        // `field`/`value` were validated against the MaterialSpec rules by the caller.
        const material = { ...node.entity.material, [field]: value };
        node.entity = { ...node.entity, material };
        node.overridden = true;
        for (const b of node.bindings) {
            const resolved = resolveMaterial(mergeMaterial(b.partMaterial, material, node.partCount), {
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
    rematerial(node) {
        this.batchesStale = true;
        for (const b of node.bindings) {
            if (b.ownedMaterial) {
                b.ownedMaterial.dispose();
                b.ownedMaterial = null;
            }
            const handle = this.opts.materials.acquire(mergeMaterial(b.partMaterial, node.entity.material, node.partCount), { hasVertexColors: b.hasColors, doubleSided: b.doubleSided }, b.variant ?? this.variant);
            this.opts.materials.release(b.materialKey);
            b.materialKey = handle.key;
            b.mesh.material = handle.material;
            b.seeThrough = handle.resolved.transparent && handle.resolved.opacity < SHADOW_OPACITY_MIN;
        }
        this.applyShadowFlags(node);
    }
    applyShadowFlags(node) {
        this.batchesStale = true;
        const standard = this.variant === 'standard';
        // Dense scatter layers (grass, pebbles) would double their draw cost in the shadow pass.
        const shadowCaster = node.instances <= SCATTER_SHADOW_MAX_INSTANCES;
        for (const b of node.bindings) {
            b.mesh.castShadow = standard && shadowCaster && node.entity.castShadow && !b.seeThrough;
            b.mesh.receiveShadow = standard && node.entity.receiveShadow;
        }
        // Virtual stand-ins follow their source meshes (material swaps go through here too).
        for (const v of node.virtual)
            mirror(v.mesh, v.source);
        if (node.virtual.length > 0)
            this.viewDirty = true;
    }
    syncLight(node, before) {
        const spec = node.entity.light;
        const old = before?.light;
        if (this.variant !== 'standard')
            return;
        const sameSize = old?.size?.[0] === spec?.size?.[0] && old?.size?.[1] === spec?.size?.[1];
        if (node.light && spec && old && old.type === spec.type && old.range === spec.range && old.angle === spec.angle && old.castShadow === spec.castShadow && old.profile === spec.profile && sameSize) {
            if (node.entity.arch?.role === 'light')
                this.applyLampScale(node.light.light, spec);
            else
                updateLightParams(node.light.light, spec);
            return;
        }
        if (node.light) {
            disposeEntityLight(node.light);
            node.light = null;
        }
        if (spec?.type === 'area' && !areaLightsReady()) {
            // The rectangular-light tables load on first use; the light appears as soon as they are in.
            void loadAreaLights().then(() => {
                if (this.nodes.get(node.id) === node && node.entity.light?.type === 'area' && !node.light) {
                    this.syncLight(node, undefined);
                    this.contentChanged(node);
                }
            }, (e) => this.warn(node.id, `area light unavailable: ${errorMessage(e)}`));
            return;
        }
        if (spec) {
            node.light = createEntityLight(spec, this.lightScale(node));
            if (node.entity.arch?.role === 'light')
                this.applyLampScale(node.light.light, spec);
            node.object.add(node.light.light);
            if (node.light.target)
                node.object.add(node.light.target);
        }
        this.lightsDirty = true;
    }
    applyShadowCap() {
        this.lightsDirty = false;
        const candidates = [];
        for (const n of this.nodes.values())
            if (n.light)
                candidates.push({ id: n.id, light: n.light.light, wants: n.entity.light?.castShadow === true });
        enforceShadowCap(candidates);
    }
    // -------------------------------------------------------------------------
    // Scatter surfaces
    // -------------------------------------------------------------------------
    contentChanged(node) {
        this.batchesStale = true;
        this.opts.onContentChanged?.(node.id);
        if (!this.batching && node.entity.shape.kind !== 'scatter' && this.dependents.has(node.id))
            this.relayoutDependents(new Set([node.id]), []);
    }
    /**
     * Rebuild surface-bound scatters (unless already building) whose surface is
     * in `changed`, or that moved themselves.
     */
    relayoutDependents(changed, started) {
        if (changed.size === 0)
            return;
        const queued = new Set();
        const consider = (id) => {
            if (queued.has(id))
                return;
            const n = this.nodes.get(id);
            if (!n)
                return;
            const s = n.entity.shape;
            if (s.kind !== 'scatter' || !s.onSurface || n.pending)
                return;
            queued.add(id);
            started.push(this.rebuild(n));
        };
        for (const id of changed) {
            consider(id);
            const deps = this.dependents.get(id);
            if (deps)
                for (const dep of [...deps])
                    consider(dep);
        }
    }
    /**
     * Height sampler mapping scatter-local (x, z) to scatter-local y on the
     * surface entity, mirroring physics: a vertical ray at the instance's
     * world (x, z), result converted back with the scatter's position/scale.
     */
    surfaceSampler(node, surfaceId) {
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
        if (!grid)
            return undefined;
        const pos = new Vector3();
        const quat = new Quaternion();
        const scale = new Vector3();
        node.object.matrixWorld.decompose(pos, quat, scale);
        const sy = scale.y === 0 ? 1 : scale.y;
        return (lx, lz) => {
            _v.set(lx * scale.x, 0, lz * scale.z).applyQuaternion(quat);
            const h = grid.sample(_v.x + pos.x, _v.z + pos.z);
            return h === h ? (h - pos.y) / sy : Number.NaN;
        };
    }
}
