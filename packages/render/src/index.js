/**
 * @aether/render — three.js r186 renderer for Aether World IR documents.
 * Prefers `WebGPURenderer` (WebGPU backend) with automatic WebGL2 fallback.
 *
 * The facade is {@link WorldRenderer}; the GPU-free building blocks
 * (scene sync, material/geometry caches, scatter layout, sky model, …) are
 * exported too for tests, tooling and alternative front-ends.
 */
export { WorldRenderer, rectsOverlap } from './world-renderer';
export { SelectionGizmo, readLocal, topLevelTargets } from './view/selection-gizmo';
export { EditOverlay, MAX_VERTEX_MARKERS } from './view/edit-overlay';
export { buildMeshGeometry, previewMeshGeometry } from './geometry/mesh-asset';
export { MESH_TRIANGLES_KEY } from './sync/scene-sync';
export { loadBlockSheets, parseSheetIndex, sheetToLayers } from './voxel/block-sheets';
export { SunShadowField } from './voxel/shadow-field';
export { SHADOW_MARCH, SHADOW_FIELD_SIZE } from './voxel/terrain-material';
export { SceneSync, DEFAULT_MAX_INSTANCES } from './sync/scene-sync';
export { ENTITY_ID_KEY } from './sync/entity-node';
export { renderableIds } from './sync/renderable';
export { ghostWorld, MAX_GHOST_ENTITIES } from './sync/ghost';
export { GhostRun, ghostPoseAt, validGhostTrace } from './view/ghost-run';
export { ProofReplay, replayWorld, trailBuffers, validTrace, PROOF_FADE_SECONDS, PROOF_HOLD_SECONDS, PROOF_MAX_SECONDS, PROOF_STATIC_SECONDS } from './view/proof-replay';
export { BlueprintMarks, bracketSegments, BLUEPRINT_FADE_SECONDS, BLUEPRINT_HOLD_SECONDS, BLUEPRINT_LEAD_SECONDS, MAX_BLUEPRINT_BOXES } from './view/blueprint';
export { setEntityPath, parsePropertyPath, MAX_PATH_DEPTH, MAX_PATH_LENGTH } from './sync/property-path';
export { createEntityLight, updateLightParams, enforceShadowCap, LOCAL_LIGHT_SCALE, MAX_SHADOW_LIGHTS } from './sync/lights';
export { MATERIAL_PRESETS, resolveMaterial, materialKey, mergeMaterial } from './materials/presets';
export { MaterialCache, createMaterial } from './materials/material-cache';
export { SurfaceTextures, lavaPixels, waterPixels, groundPixels, GROUND_DETAIL_RANGE, SURFACE_TILE_METRES } from './materials/surface-textures';
export { partToBufferGeometry, partKey, GeometryCache, InvalidMeshError, boxProjectedUvs } from './geometry/buffer-geometry';
export { createProcgenGeometrySource, primitiveKey } from './geometry/procgen-source';
export { scatterPlacements, composeScatterMatrices, primitiveLift, MAX_SCATTER_INSTANCES } from './geometry/scatter';
export { HeightGrid, buildHeightGrid, transformPositions, DEFAULT_GRID_RESOLUTION } from './geometry/height-grid';
export { ModelCache, createGltfModelLoader, isSafeModelUrl, instantiateModel, instantiateAsset, cloneModel, hasSkin, MAX_MODEL_URL_LENGTH } from './geometry/model-loader';
export { TextureCache, createTextureSource, createPoster, shareMaterials } from './geometry/poster';
export { AssetAnimator, gaitFor, GAIT, FADE_SECONDS } from './sync/asset-animator';
export { HdriController, createHdriSource } from './environment/hdri';
export { computeSkyState, sunPosition, sunBearing, bearingDirection, normalizeHour, mixHex, PRESET_HOURS, PRESET_WINDOWS, PRESET_EXPOSURE, VIEW_AZIMUTH } from './environment/sky-state';
export { resolveFog, fogAmount, hazeDensity, maxContentFogDensity, worldFogDensity } from './environment/fog';
export { fitShadowCamera } from './environment/shadow-fit';
export { EnvironmentRig, groundTint, MAX_FOG_DENSITY } from './environment/environment-rig';
export { SkyDome, SKY_RADIUS } from './environment/sky-dome';
export { WeatherSystem, WEATHER_CONFIGS } from './environment/weather';
export { CameraRig, easeInOutCubic, damp } from './view/camera-rig';
export { TransformGizmo, readTransform } from './view/transform-gizmo';
export { contentFraming, framingPose, DEFAULT_FRAMING_AZIMUTH, DEFAULT_SKY_TILT } from './view/framing';
export { collectFramingItems, FRAMING_EXCLUDED_TAGS, FOCUS_TAG, SCENERY_GENERATORS } from './view/content-items';
export { GrowIn, growDelay, growScale, GROW_DURATION, GROW_MAX_DELAY } from './view/grow-in';
export { viewPose, captureSize, captureMime, MAX_CAPTURE_SIZE, MAX_VIEWS } from './view/capture';
export { Highlighter, MAX_HIGHLIGHTS } from './view/highlighter';
export { DebugOverlay, MAX_DEBUG_ITEMS } from './view/debug-overlay';
export { Avatar, AVATAR_ID, turnToward } from './view/avatar';
export * from './characters';
export { FrameStats } from './view/frame-stats';
export { RefCache } from './refcache';
export { setRenderLogLevel } from './log';
export { adapterKnownGood, describeAdapter, parseBackendPreference, pickBackend } from './gpu/backend';
export { classifyGpu, effectivePixelRatio, estimateFramebufferMB, estimateShadowMB, renderBudget, MIN_PIXEL_RATIO } from './gpu/budget';
export { AdaptiveResolution, ADAPTIVE_DEFAULTS } from './view/adaptive-resolution';
export { accelerateRaycast, bvhEligible, BVH_MIN_TRIANGLES, triangleBvh } from './geometry/raycast-bvh';
export { StaticBatches, BATCHED_LAYER, MIN_BATCH, batchable } from './sync/static-batches';
// Scale geometry: QEM simplification, cluster LOD DAG (virtual geometry), scatter fields.
export { simplifyMesh, weldPositions } from './virtual/simplify';
export { buildClusters, splitClusters, clusterBounds, CLUSTER_TRIANGLES } from './virtual/clusters';
export { buildClusterDag, selectCut, assembleCut, cutIndexCount, createCutScratch, backfacing, LOD_STRIDE } from './virtual/cluster-dag';
export { DagClient, dagBytes } from './virtual/dag-client';
export { parseDagRequest, validateDag, MAX_DAG_INDICES, MAX_DAG_VERTICES } from './virtual/dag-protocol';
export { VirtualGroup, VIRTUAL_MIN_TRIANGLES, VIRTUAL_ERROR_PX } from './virtual/virtual-mesh';
export { buildLodChain, cardKeepRatio, isCardPart, isFaceted, LOD_RATIOS, thinCards } from './virtual/lod-chain';
export { buildChunks, packMatrices, FieldCuller, FIELD_STRIDE, CHUNK_INSTANCES, DEFAULT_LOD_PIXELS } from './virtual/field-culler';
export { ScatterField, FIELD_MIN_INSTANCES } from './virtual/scatter-field';
export { composeScatterPacked } from './geometry/scatter';
export { DEFAULT_FIELD_BUDGET } from './sync/field-mount';
export { DEFAULT_VIRTUAL_TRIANGLES, VIEW_INTERVAL_MS } from './sync/scene-sync';
export { gradeFor, NEUTRAL_GRADE } from './gpu/grade';
export { CameraTour, tourKeys, TOUR_SECONDS } from './view/tour';
// Publishing: posed capture sessions, tiled stills, glTF export, camera-path overlay.
export { openCaptureSession, captureStill } from './view/capture-session';
export { tileLayout, normalizePixels, blitTile, applyVignette, stillSize, MAX_STILL_SIZE, MAX_TILE_SIZE, TILE_MARGIN } from './view/still';
export { buildExportScene, exportGltf, exportGlb, verifyGltf, countTriangles, rgbaPixels, textureExportMode, MAX_EXPORT_TRIANGLES, MAX_EXPORT_TEXTURE } from './view/gltf-export';
export { PathOverlay, MAX_PATH_POINTS, MAX_PATH_KEYS } from './view/path-overlay';
export { vignetteFactor, VIGNETTE_STRENGTH } from './gpu/post';
export { applyWind, FOLIAGE_GENERATORS, WIND_LINEAR, WIND_QUADRATIC } from './materials/wind';
export { ArchView, archDecision, explodeLift, DEFAULT_ARCH_VIEW, CUTAWAY_WALL_HEIGHT, DOWN_WALL_HEIGHT, EXPLODE_GAP, EXPLODE_ROOF_GAP, EXPLODE_SECONDS } from './view/arch-view';
export { FinishTextures, finishHasMaps } from './materials/finish-textures';
export { autoTier, degrade, effectsKey, effectsOf, evScale, GRADE_PRESETS, isGradePresetId, isRenderTier, needsPrePass, presetFor, RENDER_TIERS, resolveEffects, stillEffects, whiteBalance } from './gpu/finishing';
export { gradeWithPreset } from './gpu/grade';
export { qualityPlan, postQualityOf, stillPlan, STILL_DRAW_CAP } from './gpu/render-quality';
export { WATER_CLASSES, waveSet, inferWaterKind, waterTierFor, underwaterDensity, RIPPLE } from './materials/water-params';
export { RippleField, rippleHeightAt, advanceWater, setWind, currentWind, resetWater } from './materials/water-state';
export { PlanarReflection, WATER_SHADER_KEY } from './materials/water';
export { PlanarMirror } from './materials/planar-mirror';
export { WaterSystem, WADE_MIN_SPEED } from './sync/water-system';
export { findWaterSurfaces, surfaceAt, waterKindOf, withWaterKind } from './sync/water-surfaces';
export { windGain } from './materials/wind';
