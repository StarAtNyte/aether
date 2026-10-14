/**
 * @aether/render — three.js r186 renderer for Aether World IR documents.
 * Prefers `WebGPURenderer` (WebGPU backend) with automatic WebGL2 fallback.
 *
 * The facade is {@link WorldRenderer}; the GPU-free building blocks
 * (scene sync, material/geometry caches, scatter layout, sky model, …) are
 * exported too for tests, tooling and alternative front-ends.
 */
export { WorldRenderer, rectsOverlap, type ContextLossInfo, type EntityHit, type RendererOptions, type RenderMemoryStats, type RenderStats } from './world-renderer';
export { SelectionGizmo, readLocal, topLevelTargets, type GizmoCommit, type GizmoOptions, type GizmoPivot, type GizmoSpace, type GizmoTarget, type GizmoTargetChange, type SelectionControlsLike, type SnapHit } from './view/selection-gizmo';
export { EditOverlay, MAX_VERTEX_MARKERS, type ComponentMode, type ComponentView } from './view/edit-overlay';
export { buildMeshGeometry, previewMeshGeometry, type MeshGeometryBundle, type MeshSlotGeometry } from './geometry/mesh-asset';
export { MESH_TRIANGLES_KEY } from './sync/scene-sync';
// Block terrain (loaded lazily through `WorldRenderer.voxel()`; types only here).
export type { VoxelLayer, VoxelChunkMesh, VoxelMeshPass } from './voxel/voxel-layer';
export type { MobModelKind } from './voxel/mob-models';
export type { Bounds, CameraMode, GeometrySource, KeyedOutput, RenderDiagnostic, ColliderDesc, GeneratorOutput, MeshPart, SandboxRunner } from './types';

export { SceneSync, DEFAULT_MAX_INSTANCES, type SceneSyncOptions } from './sync/scene-sync';
export type { EntityNode, MeshBinding } from './sync/entity-node';
export { ENTITY_ID_KEY } from './sync/entity-node';
export { renderableIds } from './sync/renderable';
export { ghostWorld, MAX_GHOST_ENTITIES } from './sync/ghost';
export { setEntityPath, parsePropertyPath, MAX_PATH_DEPTH, MAX_PATH_LENGTH } from './sync/property-path';
export { createEntityLight, updateLightParams, enforceShadowCap, LOCAL_LIGHT_SCALE, MAX_SHADOW_LIGHTS, type EntityLight } from './sync/lights';

export { MATERIAL_PRESETS, resolveMaterial, materialKey, mergeMaterial, type ResolvedMaterial, type PresetDef, type MaterialVariant, type ResolveOptions } from './materials/presets';
export { MaterialCache, createMaterial, type MaterialHandle } from './materials/material-cache';
export { SurfaceTextures, lavaPixels, waterPixels, groundPixels, GROUND_DETAIL_RANGE, SURFACE_TILE_METRES, type SurfaceKind, type SurfaceMaps } from './materials/surface-textures';

export { partToBufferGeometry, partKey, GeometryCache, InvalidMeshError, boxProjectedUvs } from './geometry/buffer-geometry';
export { createProcgenGeometrySource, primitiveKey, type ProcgenSourceOptions } from './geometry/procgen-source';
export { scatterPlacements, composeScatterMatrices, primitiveLift, MAX_SCATTER_INSTANCES, type ScatterParams, type ScatterPlacements, type SurfaceSampler } from './geometry/scatter';
export { HeightGrid, buildHeightGrid, transformPositions, DEFAULT_GRID_RESOLUTION, type TriangleSource } from './geometry/height-grid';
export { ModelCache, createGltfModelLoader, isSafeModelUrl, instantiateModel, MAX_MODEL_URL_LENGTH, type ModelLoader } from './geometry/model-loader';

export { computeSkyState, sunPosition, sunBearing, bearingDirection, normalizeHour, mixHex, PRESET_HOURS, PRESET_WINDOWS, PRESET_EXPOSURE, VIEW_AZIMUTH, type SkyState, type SkyPreset } from './environment/sky-state';
export { resolveFog, fogAmount, hazeDensity, maxContentFogDensity, worldFogDensity, type FogParams } from './environment/fog';
export { fitShadowCamera, type ShadowFit, type ShadowFitOptions } from './environment/shadow-fit';
export { EnvironmentRig, groundTint, MAX_FOG_DENSITY } from './environment/environment-rig';
export { SkyDome, SKY_RADIUS } from './environment/sky-dome';
export { WeatherSystem, WEATHER_CONFIGS, type WeatherConfig, type WeatherKind } from './environment/weather';

export { CameraRig, easeInOutCubic, damp, type FollowSource, type OrbitControlsLike } from './view/camera-rig';
export { TransformGizmo, readTransform, type GizmoChange, type GizmoMode, type TransformControlsLike } from './view/transform-gizmo';
export { contentFraming, framingPose, DEFAULT_FRAMING_AZIMUTH, DEFAULT_SKY_TILT, type Framing, type FramingItem, type FramingPose, type FramingPoseOptions } from './view/framing';
export { collectFramingItems, FRAMING_EXCLUDED_TAGS, FOCUS_TAG, SCENERY_GENERATORS } from './view/content-items';
export { GrowIn, growDelay, growScale, GROW_DURATION, GROW_MAX_DELAY } from './view/grow-in';
export { viewPose, captureSize, captureMime, MAX_CAPTURE_SIZE, MAX_VIEWS, type CaptureView, type ViewPose } from './view/capture';
export { Highlighter, MAX_HIGHLIGHTS } from './view/highlighter';
export { DebugOverlay, MAX_DEBUG_ITEMS, type DebugOptions } from './view/debug-overlay';
export { Avatar } from './view/avatar';
export { FrameStats } from './view/frame-stats';

export { RefCache } from './refcache';
export { setRenderLogLevel, type LogLevel } from './log';
export { adapterKnownGood, describeAdapter, parseBackendPreference, pickBackend, type AdapterInfoLike, type BackendDecision, type BackendEnvironment, type BackendKind, type BackendPreference, type GpuInfo } from './gpu/backend';
export { classifyGpu, effectivePixelRatio, estimateFramebufferMB, estimateShadowMB, renderBudget, MIN_PIXEL_RATIO, type GpuTier, type RenderBudget } from './gpu/budget';
export { AdaptiveResolution, ADAPTIVE_DEFAULTS, type AdaptiveOptions } from './view/adaptive-resolution';
export { accelerateRaycast, bvhEligible, BVH_MIN_TRIANGLES, triangleBvh, type TriangleBvh } from './geometry/raycast-bvh';
export { StaticBatches, BATCHED_LAYER, MIN_BATCH, batchable } from './sync/static-batches';

// Scale geometry: QEM simplification, cluster LOD DAG (virtual geometry), scatter fields.
export { simplifyMesh, weldPositions, type SimplifyOptions, type SimplifyResult } from './virtual/simplify';
export { buildClusters, splitClusters, clusterBounds, CLUSTER_TRIANGLES, type ClusterSet, type ClusterBounds } from './virtual/clusters';
export { buildClusterDag, selectCut, assembleCut, cutIndexCount, createCutScratch, backfacing, LOD_STRIDE, type ClusterDag, type CutView, type CutScratch } from './virtual/cluster-dag';
export { DagClient, dagBytes, type DagClientOptions, type DagWorkerLike } from './virtual/dag-client';
export { parseDagRequest, validateDag, MAX_DAG_INDICES, MAX_DAG_VERTICES } from './virtual/dag-protocol';
export { VirtualGroup, VIRTUAL_MIN_TRIANGLES, VIRTUAL_ERROR_PX } from './virtual/virtual-mesh';
export { buildLodChain, isFaceted, LOD_RATIOS, type LodLevel, type LodPart } from './virtual/lod-chain';
export { buildChunks, packMatrices, FieldCuller, FIELD_STRIDE, CHUNK_INSTANCES, DEFAULT_LOD_PIXELS, type FieldChunks, type FieldView, type FieldCullerOptions } from './virtual/field-culler';
export { ScatterField, FIELD_MIN_INSTANCES } from './virtual/scatter-field';
export { composeScatterPacked } from './geometry/scatter';
export { DEFAULT_FIELD_BUDGET, type FieldBudget } from './sync/field-mount';
export { DEFAULT_VIRTUAL_TRIANGLES, VIEW_INTERVAL_MS } from './sync/scene-sync';
export { gradeFor, NEUTRAL_GRADE, type Grade } from './gpu/grade';
export { CameraTour, tourKeys, TOUR_SECONDS, type TourKey } from './view/tour';
export { applyWind, FOLIAGE_GENERATORS, WIND_LINEAR, WIND_QUADRATIC } from './materials/wind';
export { ArchView, archDecision, explodeLift, DEFAULT_ARCH_VIEW, CUTAWAY_WALL_HEIGHT, DOWN_WALL_HEIGHT, EXPLODE_GAP, EXPLODE_ROOF_GAP, EXPLODE_SECONDS, type ArchViewState, type ArchDecision, type ArchEntityContext, type WallMode, type LevelMode } from './view/arch-view';
export { FinishTextures, finishHasMaps, type FinishMaps, type FinishSynth } from './materials/finish-textures';
