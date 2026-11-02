/**
 * WorldRenderer — the public facade of @aether/render. Wires the GPU renderer
 * (WebGPU with WebGL2 fallback), post-processing, the environment rig, the
 * incremental scene synchronizer, cameras, picking, selection, ghost preview,
 * debug overlays and image capture.
 *
 * GPU-specific code is confined to `create`, `render`, `screenshot` and
 * `renderViews`; everything else lives in GPU-free modules with unit tests.
 */
import { prepareCompileTextures } from './gpu/compile-textures';
import { AssetSkinCache } from './gpu/asset-skin-cache';
import { warmRaycastTrees } from './geometry/raycast-bvh';
import { FrameInvalidation } from './view/frame-invalidation';
import { deferRenderPreparation, type RenderPreparation } from './gpu/render-preparation';
import { parallelPrograms, type ParallelPrograms } from './gpu/parallel-programs';
import { gpuFrameCost } from './gpu/frame-cost';
import { preparePresentation } from './gpu/presentation';
import { warmProceduralFields } from './gpu/procedural-fields-client';
import { ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping, Box3, BufferAttribute, BufferGeometry, Color, FogExp2, Mesh as ThreeMesh, MeshBasicMaterial, Frustum, Group, Matrix4, PerspectiveCamera, Plane, Quaternion, Raycaster, RenderTarget, Scene, Vector2, Vector3, Vector4, type Intersection, type Light, type Material, type Mesh, type Object3D, type Texture } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { buildStructure } from '@aether/arch';
import { Entity, deepEqual, type EntityId, type Json, type ProceduralShape, type Vec3, type WorldDoc } from '@aether/core';
import type { CameraMode, GeneratorOutput, GeometrySource, RenderDiagnostic, SandboxRunner } from './types';
import { leanShading } from './materials/anti-tile';
import { MaterialCache } from './materials/material-cache';
import { WaterSystem } from './sync/water-system';
import { waterTierFor } from './materials/water-params';
import { advanceWater, RippleField, reflectionOn, reflectionY, resetWater, setSkyColours, setWind } from './materials/water-state';
import { GeometryCache } from './geometry/buffer-geometry';
import { createProcgenGeometrySource } from './geometry/procgen-source';
import { createGltfModelLoader, ModelCache, type ModelLoader } from './geometry/model-loader';
import { DEFAULT_TRANSCODER_PATH, supportLabel, TextureCompression } from './gpu/texture-compression';
import { textureBreakdown, trackCompressedTextureBytes, type TextureBreakdown } from './gpu/texture-memory';

function breakdownMB(b: TextureBreakdown | null): RenderMemoryStats['textureBreakdownMB'] {
  if (!b) return null;
  const mb = (x: { count: number; bytes: number }): { count: number; mb: number } => ({ count: x.count, mb: Math.round(x.bytes / 104857.6) / 10 });
  return { target: mb(b.target), compressed: mb(b.compressed), image: mb(b.image), data: mb(b.data) };
}
import { createTextureSource, TextureCache, type TextureSource } from './geometry/poster';
import type { HdriSource } from './environment/hdri';
import { photoFinishResolver } from './materials/photo-finishes';
import { getCatalog } from '@aether/assets';
import { SceneSync } from './sync/scene-sync';
import type { EntityNode } from './sync/entity-node';
import { ghostWorld } from './sync/ghost';
import { EnvironmentRig } from './environment/environment-rig';
import { SKY_RADIUS } from './environment/sky-dome';
import { CameraRig, type FollowSource, type OrbitControlsLike } from './view/camera-rig';
import type { GizmoMode } from './view/transform-gizmo';
import { createSelectionControls, SelectionGizmo, type GizmoCommit, type GizmoOptions, type GizmoTarget, type SnapHit } from './view/selection-gizmo';
import { EditOverlay, type ComponentMode } from './view/edit-overlay';
import { ProofReplay, type ProofReplayOptions, type ProofTrace } from './view/proof-replay';
import { GhostRun, type GhostTrace } from './view/ghost-run';
import { BlueprintMarks, BLUEPRINT_LEAD_SECONDS, MAX_BLUEPRINT_BOXES, markBoxOf, type MarkBox } from './view/blueprint';
import { MESH_TRIANGLES_KEY, VIEW_INTERVAL_MS, VIEW_INTERVAL_SCALED_MS } from './sync/scene-sync';
import type { MeshGeometryBundle } from './geometry/mesh-asset';
import { Avatar, type AvatarState } from './view/avatar';
import { CharacterSystem } from './characters/system';
import type { CharacterRig, Foot } from './characters/rig';
import { Highlighter } from './view/highlighter';
import { DebugOverlay } from './view/debug-overlay';
import { captureMime, captureNeedsResize, pixelsAreBlank, captureSize, MAX_VIEWS, telephotoPose, viewPose, viewRegion, type CaptureView } from './view/capture';
import { FrameStats } from './view/frame-stats';
import { gradeFor, gradeWithPreset } from './gpu/grade';
import { autoTier, degrade, effectsKey, effectsOf, evScale, GRADE_PRESETS, isGradePresetId, presetFor, resolveEffects, type EffectOverrides, type GradePreset, type GradePresetId, type PostEffects, type RenderTier } from './gpu/finishing';
import { CameraTour, DRONE_TOUR_RADIUS, TOUR_SECONDS, droneTourKeys, tourKeys, tourSections } from './view/tour';
import { AdaptiveResolution, MOTION_PROFILES, type MotionProfile } from './view/adaptive-resolution';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { textureWork } from './gpu/task-queue';
import { BATCHED_LAYER } from './sync/static-batches';
import { nextTrim, type TrimIntent } from './view/exposure-trim';
import { adaptStep, adaptedLook, interiorBalance, interiorFactor, toneExposure, volumeExposure, type CeilingBox } from './view/eye-adapt';
import { looksInside } from './view/arch-view';
import { ROOM_MAX_EV, ROOM_MIN_EV, RoomSelector, roomLight, roomSamplePoints, type PointLight, type RoomBox, type RoomLight } from './view/room-exposure';
import { LightVolumeController, materialAlbedo, type VolumeLighting, type VolumePart } from './view/light-volume-controller';
import { LightmapController, type LightmapScene, type LightmapStatus } from './view/lightmap-controller';
import type { LightmapQuality } from './environment/lightmap';
import type { VolumeLamp } from './environment/light-volume';
import { LightVolume } from './environment/light-volume-light';
import { LightVolumeNode } from './gpu/light-volume-node';
import { RoomLampNode, RoomSpotNode } from './gpu/room-lamp-node';
import { isConfinedLight, roomApertures, RoomLamp, RoomSpot, type LampPortal } from './sync/room-lamp';
import { ContactShadows, planContactShadows } from './view/contact-shadows';
import { contentFraming, DEFAULT_FRAMING_AZIMUTH, framingPose, frontAzimuthDeg, pickClearView, viewCandidates, type Framing, type FramingPoseOptions } from './view/framing';
import { isOpaqueVisible, sceneSightTest } from './view/sightline';
import { ArchView, type ArchViewState } from './view/arch-view';
import { daylightLampFactor, FORWARD_LIGHTS } from './sync/lights';
import { collectFramingItems, FOCUS_TAG } from './view/content-items';
import { GROW_OVERSHOOT_MAX_RADIUS, GrowIn, growDelay } from './view/grow-in';
import { installRenderPatches } from './three-patches';
import { installLodBias, lodBiasFor, setTextureLodBias } from './gpu/lod-bias';
import { createGpuRenderer, type BackendKind, type BackendPreference, type BackendReason, type GpuInfo } from './gpu/backend';
import { opaqueSort, type SortItem } from './gpu/render-order';
import { BlackScreenWatchdog, GpuLogCapture, measureFrame, WATCHDOG_STEPS, type FrameSample, type WatchdogAction, type WatchdogOptions } from './gpu/watchdog';
import { AdaptiveTier } from './gpu/adaptive-tier';
import { capTier, cutsAt, hardwareTierCap, PerformanceGovernor, PERFORMANCE_STEPS, readHardware, WEAK_PIXEL_RATIO, weakHardware, type HardwareHints, type PerformanceCuts } from './gpu/performance';
import { classifyGpu, effectivePixelRatio, estimateFramebufferMB, estimateShadowMB, renderBudget, type GpuTier, type RenderBudget } from './gpu/budget';
import { createPostPipeline, VIGNETTE_STRENGTH, type PostPipeline, type PostQuality } from './gpu/post';
import { planSunShadows } from './environment/sun-shadow-plan';
import { GECKO_START_LEVEL, geckoSafePath } from './gpu/gecko-safe';
import { primeTarget } from './gpu/prime-target';
import { shadowNoiseValue } from './gpu/sun-shadow-nodes';
import { setFoliageTint } from './materials/foliage-shading';
import { captureStill, openCaptureSession, type CameraPose, type CaptureHost, type CaptureSession, type StillImage, type StillOptions } from './view/capture-session';
import { normalizePixels } from './view/still';
import type { PathTraceOptions } from './view/pathtrace';
import { buildExportScene, exportGltf as exportSceneGltf, type GltfExportOptions, type GltfExportResult } from './view/gltf-export';
import { PathOverlay } from './view/path-overlay';
import { postQualityOf, qualityPlan, Refinement, studioAvailable, stillPlan, type QualityPlan, type RenderQuality, type StillPlan } from './gpu/render-quality';
import { ComputeClient, GeneratorCache, proceduralOutputKey } from '@aether/procgen';
import { disposeProfileTextures, registerLightSupport, type IesSpotLightCtor } from './sync/lights';
import { errorMessage, log } from './log';
import { GameFeel } from './feel/game-feel';
import type { VoxelLayer } from './voxel/voxel-layer';
import type { Environment } from '@aether/core';

/** Renderer construction options. */
/** What the black-screen watchdog (or a shader failure) tells the host. */
export interface WatchdogEvent {
  kind: 'step' | 'exhausted' | 'shader-error';
  step: string | null;
  reason: string | null;
  /** One honest sentence for the user. */
  message: string;
  /** The renderer is on WebGPU: the host may restart it on WebGL2 as the next thing to try. */
  webgpu: boolean;
  /** {@link WorldRenderer.diagnostics} at that moment. */
  diagnostics: string;
}

export interface RendererOptions {
  /** Backend policy (default 'auto', see `gpu/backend.ts`). */
  backend?: BackendPreference;
  /** Why WebGL2 is forced (recorded in the backend report, e.g. 'device-lost' after a WebGPU device loss). */
  backendReason?: BackendReason;
  /** @deprecated use `backend`; `false` means 'webgl2'. */
  preferWebGPU?: boolean;
  antialias?: boolean;
  shadows?: boolean;
  /** Start in safe mode: lowest tier, no post effects, baked room light or cascaded shadows, half the resolution cap lifted (see {@link WorldRenderer.setSafeMode}). */
  safeMode?: boolean;
  /** Tunables of the black-screen watchdog (`false`: off). */
  watchdog?: Partial<WatchdogOptions> | false;
  /** Extra cap on the device pixel ratio (the GPU budget applies its own, lower caps). */
  pixelRatioCap?: number;
  /** Sandbox for custom (LLM-written) generators. */
  sandbox?: SandboxRunner;
  onProgress?: (msg: string) => void;
  /** Override geometry generation (tests, server-precomputed outputs). */
  geometrySource?: GeometrySource;
  /** Override model loading. */
  modelLoader?: ModelLoader;
  /** Override image texture loading (imported posters). */
  textureSource?: TextureSource;
  /** Override HDR environment loading (`environment.hdri`). */
  hdriSource?: HdriSource;
  /**
   * Where the photographed leaf sprites are served (`leaf-sprites.json` / `.webp`), default `/foliage/`; null keeps
   * the procedural leaf cards.
   */
  foliageUrl?: string | null;
  /**
   * Where the Basis Universal transcoder (`basis_transcoder.js` / `.wasm`) is served, relative to the page
   * (default `basis/`). Library models with KTX2 twins then keep their textures block-compressed on the GPU;
   * null, or a GPU or browser that cannot transcode, loads the original images.
   */
  transcoderPath?: string | null;
  /** Total scatter instance budget. */
  maxInstances?: number;
  /**
   * Low-memory mode: pixel ratio 1 and ≤ ~1 MP drawing buffer, no MSAA, no
   * bloom post pass, 1024² sun shadows, smaller instance and generator
   * caches. See {@link renderBudget}.
   */
  lowMemory?: boolean;
  /** @deprecated alias of `lowMemory`. */
  lowPower?: boolean;
  /**
   * Called once when the GPU device / WebGL context is lost (driver reset,
   * GPU process crash, memory pressure). The renderer stops drawing; the
   * host should dispose it and create a new one on a fresh canvas.
   */
  onContextLost?: (info: ContextLossInfo) => void;
  /**
   * Animate new entities growing in (a ripple from the scene center) when a
   * world is built or edited. Default true; pass false for reduced motion.
   */
  growIn?: boolean;
  /**
   * Draw corner-bracket plan marks around newly built objects before they
   * grow in (only with `growIn`). Default true.
   */
  blueprint?: boolean;
  /**
   * Lower the drawing-buffer resolution while continuous rendering stays
   * under 40 fps, and restore it when there is headroom (default true).
   * Never raises the resolution above the GPU budget.
   */
  adaptiveResolution?: boolean;
  /**
   * Draw identical static props (same primitive, material and shadow flags,
   * at least six) as one instanced draw each (default true).
   */
  staticBatching?: boolean;
  /**
   * Draw huge scatter layers as culled, LOD'd instance fields within the GPU
   * class's field budget (default true; false = plain instanced meshes).
   */
  fields?: boolean;
  /**
   * Draw high-poly parts as virtual geometry (cluster LOD DAG built in a
   * worker; default true; false = plain meshes).
   */
  virtualGeometry?: boolean;
  /** Run built-in generators in a worker (default true where module workers exist). */
  workerGeneration?: boolean;
  /**
   * Where bundled baked-lightmap files (`<key>.lmap`) are served, with a trailing slash (default none: the browser cache and
   * the bake only). A bundled world ships the lightmap its own build produced.
   */
  lightmapBase?: string | null;
  /** The baked lightmap started, progressed, applied, failed or was cancelled (a status line, a cancel button). */
  onLightmapStatus?: (status: LightmapStatus) => void;
}

/** Details of a lost GPU device / WebGL context. */
export interface ContextLossInfo {
  backend: BackendKind;
  message: string;
}

/** GPU memory picture of the renderer (diagnostics, memory budgets, e2e). */
export interface RenderMemoryStats {
  gpuTier: GpuTier;
  gpu: string;
  lowMemory: boolean;
  pixelRatio: number;
  drawingBuffer: [number, number];
  shadowMapSize: number;
  post: boolean;
  /** GPU geometries / textures three.js has uploaded (counted on first draw). */
  geometries: number;
  textures: number;
  /** Live geometries and materials held by the renderer's reference-counted caches. */
  cachedGeometries: number;
  materials: number;
  /** CPU copies of procedural meshes held by the generator cache (MB). */
  generatorCacheMB: number;
  /** Estimated drawing-buffer + shadow memory on the GPU (MB). */
  estimatedGpuMB: number;
  /** Bytes of the textures three.js has uploaded (compressed ones at their real block size), MB. */
  texturesMB: number;
  /** Live texture bytes by kind (render targets, block-compressed, decoded images, raw data), MB, or null when untracked. */
  textureBreakdownMB: Record<'target' | 'compressed' | 'image' | 'data', { count: number; mb: number }> | null;
  /** KTX2 compressed textures: on, off (with the reason) or not tried yet, and the GPU formats used. */
  compression: { state: 'idle' | 'pending' | 'on' | 'off'; reason: string | null; formats: string | null; setupMs: number | null };
}

/** Ground classes that have their own footstep sound. */
export type SurfaceClass = 'grass' | 'stone' | 'wood' | 'metal' | 'dirt' | 'sand' | 'snow' | 'water' | 'fabric';

/** Footstep class of a material preset. */
export function surfaceOfPreset(preset: string): SurfaceClass {
  switch (preset) {
    case 'grass':
    case 'leaf':
      return 'grass';
    case 'wood':
    case 'bark':
      return 'wood';
    case 'metal':
    case 'gold':
      return 'metal';
    case 'dirt':
      return 'dirt';
    case 'sand':
      return 'sand';
    case 'snow':
    case 'ice':
      return 'snow';
    case 'water':
      return 'water';
    case 'fabric':
    case 'rubber':
      return 'fabric';
    default:
      return 'stone';
  }
}

/** Footstep class of an architectural finish. */
export function surfaceOfFinish(finish: string): SurfaceClass {
  if (/oak|walnut|ash|herringbone|wood|parquet|plank/.test(finish)) return 'wood';
  if (/carpet|fabric|velvet|leather/.test(finish)) return 'fabric';
  if (/metal|steel|brass|copper|chrome/.test(finish)) return 'metal';
  return 'stone';
}

/** A raycaster that also tests batched static props (their meshes live on {@link BATCHED_LAYER}). */
/** The statistics of a picture read back as RGBA (a 24 x 24 grid of points), as the live read-back reports them. */
function measurePixels(rgba: Uint8Array, w: number, h: number): FrameSample {
  const n = 24;
  const grid = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const si = (Math.min(h - 1, Math.floor(((y + 0.5) * h) / n)) * w + Math.min(w - 1, Math.floor(((x + 0.5) * w) / n))) * 4;
      grid.set(rgba.subarray(si, si + 4), (y * n + x) * 4);
    }
  }
  return measureFrame(grid);
}

function createRaycaster(): Raycaster {
  const r = new Raycaster();
  r.layers.enable(BATCHED_LAYER);
  return r;
}

/** Renderer statistics. */
export interface RenderStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  entities: number;
  instances: number;
  /** Adaptive resolution scale (1 = the GPU budget's full pixel ratio). */
  resolutionScale?: number;
  /** Steps of the performance ladder taken (0: nothing given up; see gpu/performance.ts). */
  performanceLevel?: number;
  /** Draw calls per pass saved by instancing identical static props. */
  batchedDrawsSaved?: number;
  /** Triangles the scene represents at full detail (every instance, every mesh). */
  sceneTriangles?: number;
  /** Instances held by culled scatter fields, and how many of them the last frame drew. */
  fieldInstances?: number;
  fieldDrawn?: number;
  /** Virtual geometry: instances, the triangles they represent and the triangles their cuts draw. */
  virtualInstances?: number;
  virtualSourceTriangles?: number;
  virtualDrawnTriangles?: number;
}

/** A raycast hit on a document entity (see {@link WorldRenderer.raycastEntity}). */
export interface EntityHit {
  id: EntityId;
  /** World-space hit point and (unit) surface normal. */
  point: Vec3;
  normal: Vec3;
  /** The same in the entity's local space (mesh / brush coordinates). */
  localPoint: Vec3;
  localNormal: Vec3;
  /** Document triangle index for `mesh` shapes (null otherwise). */
  triangle: number | null;
  distance: number;
}

/** Options of {@link WorldRenderer.frameContent}. */
export interface FrameContentOptions {
  /** Entities that must be in view and pull the center (in addition to `focus`-tagged ones). */
  focus?: readonly EntityId[];
  /** Extra focus points (e.g. the player spawn of a character game). */
  focusPoints?: readonly Vec3[];
  /** Flight time in seconds (0 jumps). Default 1.1. */
  duration?: number;
  /** Start from a wider, higher establishing shot and fly in (first load). */
  flyIn?: boolean;
}

/** Framing of worlds with buildings: a higher, tighter three-quarter view (archviz axonometric feel). */
const ARCH_FRAMING = Object.freeze({ elevationDeg: 21, margin: 0.8, tiltDeg: 4 });

/** Lowest orbit camera height above a ground plane (metres). */
const MIN_ORBIT_HEIGHT = 0.4;
/** Default camera flight time of automatic framing (seconds). */
export const FRAME_DURATION = 1.1;
/** Establishing-shot flight time used by `flyIn` (seconds). */
const FLY_IN_DURATION = 1.6;
/** Screen share (of the half view height) below which revealed content is considered too small to read. */
const MIN_VISIBLE_SHARE = 0.06;
/** A proof replay brings its moving bodies to at least this share of the view. */
const PROOF_MIN_SHARE = 0.22;

/** Shadow refit / debug rebuild throttle (seconds) while content streams in. */
const REFIT_INTERVAL = 0.35;
/** Draws a pipeline with sun shafts waits for the sun's shadow map before giving the shafts up for this world. */
/** Milliseconds the view stays still before the split studio chain switches to its full version. */
const REST_DELAY_MS = 220;
/** Work that can temporarily hold the viewport while its current image stays available. */
export type RenderProcessingStage = 'scene' | 'materials' | 'render' | 'lighting' | 'capture';

/** Size of the planar water mirror relative to the frame at full scale (see PlanarMirror). */
const MIRROR_SCALE = 0.5;
/** Frame time (s) beyond which an animating scene at rest cannot afford the full chain, and for how many frames in a row. */
const REST_SLOW_DT = 0.034;
const REST_SLOW_FRAMES = 10;
const SHAFT_WAIT_FRAMES = 4;
const JPEG_QUALITY = 0.8;
/** Capture render targets kept (critique views and thumbnails use two sizes). */
const MAX_CAPTURE_TARGETS = 2;
const VIEW_NAMES: ReadonlySet<string> = new Set(['top', 'front', 'side', 'iso']);

// Scratch (per-frame paths must not allocate).
const _ndc = new Vector2();
const _bounds = new Box3();
/** Vertical field of view (degrees) of the first-person walk camera. */
export const WALK_FOV = 70;
const _center = new Vector3();
const _size = new Vector2();
const _buffer = new Vector2();
const _savedViewport = new Vector4();
const _savedScissor = new Vector4();
/** Metres in front of a hero camera, across its whole frame, that must be clear of solid surfaces. */
const LENS_CLEAR = 4;
const _savedCamPos = new Vector3();
const _savedCamQuat = new Quaternion();
const _avatarHead = new Vector3();
const _footOrigin = new Vector3();
const _down = new Vector3(0, -1, 0);
const _savedCamUp = new Vector3();
const _hits: Intersection[] = [];
const _pos = new Vector3();
const _dir = new Vector3();
const _quat = new Quaternion();
const _scl = new Vector3();
/** Metres a room lamp's clip box reaches past the room's footprint (its wall centrelines). */
const ROOM_LAMP_MARGIN = 0;
/** Metres a room lamp's clip box reaches above the room's ceiling (lit through the fade, the storey above is not). */
const ROOM_LAMP_CEILING = 0.08;
/** Share of a spot light's intensity the light volume and the eye count (it lights a cone, not every direction). */
const SPOT_SHARE = 0.5;
/**
 * White-balance shift toward warm of a fully adapted interior view (grade temperature units), on top of the balance
 * that takes most of the room light's own cast out (`interiorBalance`).
 */
const INTERIOR_WARMTH = 0.45;
/** Share of the room light's own cast the interior white balance takes out (the world's `look.interiorBalance` replaces it). */
const INTERIOR_BALANCE = 1;

/**
 * What `next` changes of the building's light relative to `prev`: `geometry` when a building part changed (the baked light
 * bakes again), `light` when only a light did, null when neither.
 */
function archChangeKind(prev: WorldDoc, next: WorldDoc): 'geometry' | 'light' | null {
  if (prev.entities === next.entities) return null;
  let kind: 'geometry' | 'light' | null = null;
  for (const id in next.entities) {
    const e = next.entities[id];
    const before = prev.entities[id];
    if (e === before) continue;
    if (e?.arch || before?.arch) return 'geometry';
    if (e?.light || before?.light) kind = 'light';
  }
  for (const id in prev.entities) {
    const before = prev.entities[id];
    if (id in next.entities) continue;
    if (before?.arch) return 'geometry';
    if (before?.light) kind = 'light';
  }
  return kind;
}

/** Mean linear radiance of the upper and lower halves of an sRGB equirectangular sky map (grey without one). */
function skyHalves(map: { image: { data: unknown; width: number; height: number } } | null): { up: [number, number, number]; down: [number, number, number] } {
  const data = map?.image.data;
  const w = map?.image.width ?? 0;
  const h = map?.image.height ?? 0;
  if (!(data instanceof Uint8Array) || w < 2 || h < 2 || data.length < w * h * 4) return { up: [0.35, 0.42, 0.52], down: [0.2, 0.2, 0.18] };
  const up: [number, number, number] = [0, 0, 0];
  const down: [number, number, number] = [0, 0, 0];
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  for (let y = 0; y < h; y++) {
    // Equirectangular rows: weight by the row's solid angle (cos of the latitude).
    const lat = ((y + 0.5) / h - 0.5) * Math.PI;
    const wgt = Math.cos(lat);
    // Row 0 looks straight down (three's equirect mapping with flipY off).
    const into = y < h / 2 ? down : up;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      into[0] += lin(data[i] as number) * wgt;
      into[1] += lin(data[i + 1] as number) * wgt;
      into[2] += lin(data[i + 2] as number) * wgt;
    }
  }
  const norm = (w * h) / Math.PI;
  for (let c = 0; c < 3; c++) {
    up[c] = (up[c] as number) / norm;
    down[c] = (down[c] as number) / norm;
  }
  return { up, down };
}
/** True when an RGBA8 image is one colour (within noise): sampled sparsely, so it costs nothing. */
export function isFlat(data: Uint8Array): boolean {
  const step = Math.max(4, (Math.floor(data.length / 4 / 4096) | 0) * 4);
  for (let c = 0; c < 3; c++) {
    let lo = 255;
    let hi = 0;
    for (let i = c; i < data.length; i += step) {
      const v = data[i] as number;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo >= 6) return false;
  }
  return true;
}

const _target = new Vector3();
const _focusTarget = new Vector3();
const _focusDir = new Vector3();
const _frustum = new Frustum();
const _viewProj = new Matrix4();
const _corner = new Vector3();
const _one = new Box3();
const _occDir = new Vector3();
const _occHits: Intersection[] = [];
/** Scatter occluder answer of {@link WorldRenderer.freeDistance}. */
const _occT = new Float64Array(1);
const _snapHits: Intersection[] = [];
const _snapPoint = new Vector3();
const _snapVertex = new Vector3();
const _snapTmp = new Vector3();
const _inv4 = new Matrix4();
const _rectCorner = new Vector3();
/** Hits closer than this to the chase target (its own body) are ignored (m). */
const OCCLUSION_NEAR = 0.25;

function isDescendant(object: Object3D, ancestor: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (o === ancestor) return true;
  return false;
}

/** Axis-aligned rectangle overlap (inclusive). */
export function rectsOverlap(ax0: number, ay0: number, ax1: number, ay1: number, bx0: number, by0: number, bx1: number, by1: number): boolean {
  return ax0 <= bx1 && ax1 >= bx0 && ay0 <= by1 && ay1 >= by0;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

/** Copy the canvas into a new 2D canvas of `w`×`h` and encode it. Must run in the same task as the render. */
/**
 * Copy the `size`×`size` square at (`sx`, `sy`) (drawing-buffer pixels, top-left origin) of
 * `source` into `out` (resized only when needed) and encode it.
 */
function grabRegion(source: HTMLCanvasElement, out: HTMLCanvasElement, sx: number, sy: number, size: number, px: number, mime: string): string {
  if (out.width !== px) out.width = px;
  if (out.height !== px) out.height = px;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.clearRect(0, 0, px, px);
  ctx.drawImage(source, sx, sy, size, size, 0, 0, px, px);
  return out.toDataURL(mime, JPEG_QUALITY);
}

/**
 * Encode RGBA8 pixels (rows bottom-up when `flipY`, as WebGL reads them) as
 * a data URL through a reused, CPU-backed 2D canvas (`willReadFrequently`:
 * a GPU-accelerated 2D canvas would wait for the GPU again when encoding).
 * The encoder runs asynchronously (`toBlob`), so even a large thumbnail
 * never blocks the page.
 */
async function encodePixels(pixels: Uint8Array, w: number, h: number, mime: string, flipY: boolean, out: HTMLCanvasElement): Promise<string> {
  if (out.width !== w) out.width = w;
  if (out.height !== h) out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  const image = ctx.createImageData(w, h);
  // Tight top-down rows (WebGPU pads rows to 256 bytes, WebGL2 reads bottom-up), opaque
  // (JPEG has no alpha; PNG/WebP thumbnails should not be see-through).
  normalizePixels(pixels, w, h, flipY, new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength));
  ctx.putImageData(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, mime, JPEG_QUALITY));
  if (!blob) return out.toDataURL(mime, JPEG_QUALITY);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('capture encoding failed')));
    reader.onerror = () => reject(reader.error ?? new Error('capture encoding failed'));
    reader.readAsDataURL(blob);
  });
}

/** Attempts of a capture that comes back blank. */
/** Longest the first framing waits for picking trees to be built off-thread (ms); the rest finish in the background. */
const FIRST_FRAME_BVH_MS = 1200;

/** Pause after the first frame before the KTX2 transcoder is fetched ahead of need (ms). */
const KTX2_SETUP_DELAY_MS = 4000;

/** Longest the load screen waits for the first frame's shader programs to link (ms). */
const SHADER_WARMUP_MS = 15_000;
/** Frames after which the cached sun shadow map is drawn again whatever happened (a safety net). */
const SUN_MAP_REFRESH = 24;
/** The safety net while the view moves under the split studio chain. */
const SUN_MAP_REFRESH_MOVING = 60;
/** Frames between redraws of the cached sun shadow map while casters animate (30 fps at 60). */
const SUN_MAP_SOFT_REFRESH = 2;
/** The same while the view moves under the split studio chain (2 fps at 60): animated shadows lag a little, the frame rate holds (a redraw is a frame of 5 ms more, which a 13 ms frame cannot afford often). */
const SUN_MAP_SOFT_REFRESH_MOVING = 30;
/** Assets smaller than this in every direction cast no sun shadow on the low tier (metres). */
const SMALL_CASTER_METRES = 0.9;
/** Skinned assets farther than this from the eye are not drawn on the low tier (metres). */
const FAR_ANIMAL_METRES = 55;
/** Longest the load screen waits for the world's environment map (ms). */
const HDRI_WAIT_MS = 8_000;
/** How long late warming collects arrivals before it links them (ms). */
const LATE_ROUND_MS = 1_200;
/** Rounds of late warming. */
const LATE_ROUNDS = 5;
/** Longest one late round holds the draws (ms): the first frame is already on screen. */
const LATE_COMPILE_MS = 2_500;
/** Longest the load screen waits for the post chain to be built (ms). */
const POST_WAIT_MS = 4_000;
/** Longest the load screen waits for the leaf cards to be filled in (ms): they are made a task at a time while the programs link. */
const FOLIAGE_WAIT_MS = 3_000;
/** A replacement adding at least this many entities holds the first frame like a first world does. */
const BULK_HOLD_ENTITIES = 8;
/** Frames are held for the warm-up at most this long (ms), whatever the driver does. */
/** Wait for pending programs / preparation this long before showing a first (progressive) image, and between later bounds. */
const PROGRESSIVE_FIRST_MS = 2500;
const PROGRESSIVE_MS = 6000;
/** Spacing of progressive frames while programs still link. */
const PROGRESSIVE_EVERY_MS = 400;
const WARMING_MAX_MS = 20_000;
const MAX_BLANK_RETRIES = 3;

/** Whether a drawn canvas is blank (see {@link pixelsAreBlank}): sampled through a 32 x 32 copy. */
function canvasIsBlank(source: HTMLCanvasElement): boolean {
  const probe = document.createElement('canvas');
  probe.width = 32;
  probe.height = 32;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(source, 0, 0, 32, 32);
  return pixelsAreBlank(new Uint8Array(ctx.getImageData(0, 0, 32, 32).data.buffer));
}

function grab(source: HTMLCanvasElement, w: number, h: number, mime: string): string {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(source, 0, 0, w, h);
  return out.toDataURL(mime, JPEG_QUALITY);
}

/** Renders World IR documents. See the module docs. */
export class WorldRenderer {
  readonly backend: BackendKind;
  readonly domElement: HTMLCanvasElement;
  private readonly scene = new Scene();
  private readonly perspective: PerspectiveCamera;
  private readonly rig: CameraRig;
  private readonly materials = new MaterialCache();
  private readonly water = new WaterSystem();
  private readonly geometries = new GeometryCache();
  private readonly models: ModelCache;
  /** KTX2 transcoding for library models with compressed twins (self-tested on first use). */
  private readonly compression: TextureCompression;
  private readonly textures: TextureCache;
  private readonly sync: SceneSync;
  private readonly ghost: SceneSync;
  private readonly env: EnvironmentRig;
  private readonly highlighter = new Highlighter();
  private readonly debug = new DebugOverlay();
  private readonly avatar = new Avatar();
  /** Game feel: particle effects, camera shake, hit-stop, FOV kicks, pulses (presentation only; see `feel/`). */
  readonly fx: GameFeel;
  /** The scene's people (NPCs and the player's body). */
  private readonly characters: CharacterSystem;
  private footstepHandler: ((id: string, foot: Foot, speed: number, position: Vec3) => void) | null = null;
  private readonly frameStats = new FrameStats();
  private readonly raycaster = createRaycaster();
  private readonly occlusionRay = createRaycaster();
  private readonly footRay = createRaycaster();
  /** Entity the chase camera follows (its own meshes never block the view). */
  private followId: EntityId | null = null;
  private readonly grow = new GrowIn();
  private growEnabled = true;
  private post: PostPipeline | null = null;
  /** Render quality (realtime, or the studio still look) and its plan. */
  private qualityPlan: QualityPlan;
  /** Progressive refinement of studio stills while the view rests. */
  private readonly refinement = new Refinement();
  /** The studio pipeline failed on this device: studio quality is unavailable. */
  private studioFailed = false;
  /** Interactive render tier: a fixed choice, or 'auto' (follows the GPU budget). */
  private tierChoice: RenderTier | 'auto' = 'auto';
  /** Load-screen text: what the load is waiting for now (stage names, never a made-up percentage). */
  private readonly onProgress: ((msg: string) => void) | null;
  /** Programs discovered by actual post/shadow passes link without blocking a draw. */
  private readonly programs: ParallelPrograms;
  private readonly gpuCost: ReturnType<typeof gpuFrameCost>;
  private readonly presentation: ReturnType<typeof preparePresentation>;
  private readonly preparation: RenderPreparation;
  private readonly compileTextures: { dispose(): void };
  /** The shader warm-up is running: frames are not drawn (never for longer than {@link WARMING_MAX_MS}). */
  private warming_ = false;
  private warmingSince = 0;
  private get warming(): boolean {
    return this.warming_;
  }
  private set warming(on: boolean) {
    if (on && !this.warming_) this.warmingSince = now();
    this.warming_ = on;
  }
  /** Pre-draw readiness time (ms); deferred shader work is measured in first-frame timings. */
  shaderWarmupMs = 0;
  /** What the browser says about the machine (cores, memory): weak hardware gets a cheaper automatic tier and pixel ratio. */
  private readonly hardware: HardwareHints = readHardware();
  /** Steps down the performance ladder while frames stay slow (automatic tier only). */
  private readonly governor = new PerformanceGovernor({ afterScale: 0.76 });
  private readonly adaptiveTier = new AdaptiveTier();
  /** Firefox on WebGL2 with a real GPU: nearest shadow comparison, cleared targets and a light start that climbs (gpu/gecko-safe.ts). */
  private readonly geckoSafe: boolean;
  private cuts: PerformanceCuts = cutsAt(0);
  /** Told when the governor gave something up: the step and what it was. */
  onPerformanceStep: ((level: number, step: string, up?: boolean) => void) | null = null;
  /** Told when the black-screen watchdog stepped down or a shader failed to build (see {@link WatchdogEvent}). */
  onWatchdog: ((e: WatchdogEvent) => void) | null = null;
  private readonly watchdog: BlackScreenWatchdog;
  private readonly watchdogOn: boolean;
  private readonly gpuLog = new GpuLogCapture();
  private uninstallGpuLog: (() => void) | null = null;
  private probe: CanvasRenderingContext2D | null = null;
  private readonly watchLog: Array<{ at: number; text: string }> = [];
  private safe = false;
  private simple = false;
  private minimal = false;
  private watchPostOff = false;
  private watchNudge = 0;
  /** User toggles of single effects (undefined keeps the tier's choice). */
  private effectOverrides: EffectOverrides = {};
  /** Effects that failed to build or draw on this device (never retried). */
  private readonly failedEffects = new Set<keyof PostEffects>();
  /** Colour-grade preset chosen by the host (null: follows the sky). */
  private gradeId: GradePresetId | null = null;
  /** The colour grade of the document's environment (null: the sky's preset). */
  private docGrade: Environment['grade'] | null = null;
  /** The look the document carries (tuned by the reviewer per world); every field, when omitted, keeps the constant of this module. */
  private docLook: Environment['look'] | null = null;
  /** `environment.exposure` as the document sets it (the sky preset's own exposure is not the author's bias). */
  private docExposure = 1;
  /** The grade preset currently applied. */
  private look: GradePreset = GRADE_PRESETS['archviz-daylight'];
  /** Called when the effective render quality changes (e.g. studio fell back to realtime). */
  onQualityChange: ((quality: RenderQuality) => void) | null = null;
  /** Architectural view modes (cutaway, exploded levels, x-ray, section) of buildings. */
  private readonly archView: ArchView;
  /** Clipping group around the scene content for the section cut (created on first use). */
  private clipGroup: (Group & { enabled: boolean; clippingPlanes: Plane[] }) | null = null;
  private clipLoading = false;
  /** Section plane: keeps y ≤ constant. */
  private readonly sectionPlane = new Plane(new Vector3(0, -1, 0), 0);
  private wasGrowing = false;
  /** Baked sky visibility and bounce light of the world's buildings (see `view/light-volume-controller.ts`). */
  private readonly lightVolume = new LightVolumeController(() => this.gatherLightVolume(), {
    settled: () => this.syncing === 0 && !this.grow.active && !this.disposed,
    onUpload: () => this.onLightVolume(),
  });
  /**
   * Baked per-surface light of the buildings (see `view/lightmap-controller.ts`): applied on top of the volume's light node, which
   * it replaces for the surfaces it covers. Built after the volume, whose bake it needs.
   */
  private readonly lightmap: LightmapController;
  /** What the world asked for (`environment.lightBake`): undefined is the automatic policy. */
  private lightBake: { quality: 'off' | LightmapQuality; samples?: number } | undefined;
  /** The environment as the baked light sees it (everything but the exterior), to tell a change of light from a change of scenery. */
  private lightEnvKey = '';
  /** Soft footprints under the furniture of buildings (see `view/contact-shadows.ts`). */
  private readonly contact = new ContactShadows();
  /** Scene syncs still generating geometry (the light volume waits for them). */
  private syncing = 0;
  /** Reused 2D canvas for critique-view crops (released on dispose). */
  private viewCanvas: HTMLCanvasElement | null = null;
  /** CPU-backed canvas that encodes asynchronous captures. */
  private encodeCanvas: HTMLCanvasElement | null = null;
  /**
   * Reused targets of asynchronous captures by size (see {@link renderToPixels}),
   * at most two (critique views + thumbnails), so captures never reallocate GPU memory per turn.
   */
  private readonly captureTargets = new Map<string, RenderTarget>();
  /** Asynchronous readback failed once on this device: captures use the synchronous canvas path. */
  private asyncCaptureFailed = false;
  private boundsDirty = true;
  /** Something visible changed since the last drawn frame (on-demand rendering). */
  private readonly frameInvalidation = new FrameInvalidation();
  private get needsDraw(): boolean {
    return this.frameInvalidation.dirty;
  }
  /** Any content or view-state change that asks for a frame also asks for a fresh sun shadow map (see {@link cacheSunMap}). */
  private set needsDraw(on: boolean) {
    if (on) { this.frameInvalidation.change(); this.sunMapDirty = true; }
    else this.frameInvalidation.clear();
  }
  /** The sun's shadow map no longer matches the scene: content changed. */
  private sunMapDirty = true;
  /** Casters that animate or re-plan with the view (people, wind, scatter fields): the map follows them at a lower rate. */
  private sunMapSoft = false;
  /** Frames since the sun's shadow map was drawn. */
  private sunMapAge = 0;
  /** The sun light, map size and fitted frustum the map was drawn for. */
  private sunMapKey: object | null = null;
  private readonly sunMapSig = new Float64Array(14);
  private debugDirty = false;
  private sinceRefit = REFIT_INTERVAL;
  private framed = false;
  /** Sphere of the meaningful content (refreshed with the bounds). */
  private framing: Framing | null = null;
  private disposed = false;
  private lost = false;
  private lowMemory = false;
  private budget: RenderBudget;
  /** GPU description and class (drives {@link budget}). */
  readonly gpu: Readonly<GpuInfo & { tier: GpuTier }>;
  /** Generator output cache owned by this renderer (null with a custom geometry source). */
  private readonly generatorCache: GeneratorCache | null;
  /** Worker for built-in generators (null in Node or when disabled). */
  private readonly compute: ComputeClient | null;
  /** Extra pixel-ratio cap from the options (or {@link setPixelRatioCap}). */
  private ratioCap: number;
  private cssWidth = 1;
  private cssHeight = 1;
  /** Bumped whenever the post pipeline is dropped, so a late async creation is discarded. */
  private postGen = 0;
  /** The user/host wants adaptive resolution (the studio quality suspends it). */
  private adaptiveWanted = true;
  private postPending = false;
  /** The pipeline of the other phase (motion / rest of the split studio chain), kept built so the switch costs nothing. */
  private postStash: PostPipeline | null = null;
  /** The sun shadow map edge each pipeline with shafts was built against. */
  private readonly postBuiltSize = new WeakMap<PostPipeline, number>();
  /** The view has rested long enough for the full chain (always true for plans that do not split). */
  private atRest = true;
  /** The current motion phase has displayed an actual completed frame. */
  private motionFrameReady = false;
  /** Measurement hook (tests): true draws every frame with the lean surface shading, null follows the view's motion. */
  forceLean: boolean | null = null;
  private lastChangeAt = 0;
  /** Adaptive scale in force before the view rested (restored when it moves again). */
  private motionScale = 1;
  private readonly onContextLost: ((info: ContextLossInfo) => void) | undefined;
  /** Draw counters of the last frame actually drawn (stable while on-demand rendering idles). */
  private lastDrawCalls = 0;
  private framesDrawn = 0;
  /** Frame-time driven resolution scale (see {@link AdaptiveResolution}). */
  private readonly adaptive = new AdaptiveResolution(MOTION_PROFILES.sharp.opts);
  private motionProfile: MotionProfile = 'sharp';
  /** The previous animation frame drew (continuous rendering streak). */
  private drewLastFrame = false;
  private lastTriangles = 0;
  private readonly orbit: OrbitControlsLike | null;
  /** Editor transform gizmo (created on first use). */
  private gizmo: SelectionGizmo | null = null;
  /** Invisible handle the component gizmo drags (mesh editing). */
  private componentHandle: Group | null = null;
  /** Editor overlays: mesh components, brush ring, joints. */
  private readonly editOverlay = new EditOverlay();
  /** Ghost re-enactment of the last verification run (lazily creates its own ghost sync). */
  private readonly proof: ProofReplay;
  private readonly ghostRun = new GhostRun();
  private proofSync: SceneSync | null = null;
  /** Corner-bracket plan marks drawn around newly built objects before they grow in. */
  private readonly blueprint = new BlueprintMarks();
  private blueprintEnabled = true;
  /** Block terrain layer (loaded lazily for voxel worlds). */
  private voxelLayer: VoxelLayer | null = null;
  private voxelLoading: Promise<VoxelLayer> | null = null;
  private voxelVersion = -1;
  /** Last pointer position over the canvas in NDC (gizmo snapping). */
  private readonly pointerNdc = new Vector2();
  /** Cinematic camera path drawn over the viewport (publishing). */
  private readonly pathOverlay = new PathOverlay();
  /** An exclusive capture (video / still export) owns the drawing buffer: the viewport does not draw. */
  private captureActive = false;
  /** Viewport size requested while a capture ran (applied when it ends). */
  private pendingResize: [number, number] | null = null;
  /** The running capture session (ended on dispose). */
  private capture: CaptureSession | null = null;
  /** Direct camera input ends a fly-through. */
  private readonly onUserCamera = (): void => {
    if (this.rig.touring) this.rig.stopTour();
  };
  private readonly onPointerMove = (e: PointerEvent): void => {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  };

  private constructor(
    private readonly renderer: WebGPURenderer,
    canvas: HTMLCanvasElement,
    backend: BackendKind,
    controls: OrbitControlsLike | null,
    camera: PerspectiveCamera,
    opts: RendererOptions,
    gpu: GpuInfo,
  ) {
    this.compileTextures = prepareCompileTextures(renderer);
    this.programs = parallelPrograms(renderer.backend as unknown as Parameters<typeof parallelPrograms>[0], () => this.requestPreparedFrame(), e => log.warn(`parallel shader linking failed: ${errorMessage(e)}`));
    this.gpuCost = gpuFrameCost(renderer.backend as unknown as Parameters<typeof gpuFrameCost>[0]);
    this.preparation = deferRenderPreparation(renderer, {
      ready: () => this.requestPreparedFrame(),
      error: e => log.warn(`render preparation failed: ${errorMessage(e)}`),
      blocked: () => this.programs.pending > 0,
      atomic: draw => this.programs.synchronous(draw),
    });
    this.presentation = preparePresentation(renderer, () => !this.progressive && (this.preparation.pending > 0 || this.programs.pending > 0));
    this.backend = backend;
    this.domElement = canvas;
    this.perspective = camera;
    this.gpu = Object.freeze({ description: gpu.description, tier: classifyGpu(gpu.description), report: gpu.report });
    this.geckoSafe = geckoSafePath(backend, gpu.description);
    this.lowMemory = opts.lowMemory === true || opts.lowPower === true;
    this.lightmap = new LightmapController(this.lightVolume.light, {
      gather: () => this.gatherLightmap(),
      volume: () => (this.lightVolume.baking ? null : this.lightVolume.bakedVolume),
      settled: () => this.syncing === 0 && !this.grow.active && !this.disposed,
      onChange: () => this.onLightmap(),
      attach: (source) => this.sync.setLightmapSource(source),
      onStatus: (st) => opts.onLightmapStatus?.(st),
      autoBake: () => this.lightmapAutoBake(),
      autoQuality: () => this.lightmapAutoQuality(),
      staticBase: opts.lightmapBase ?? null,
    });
    this.watchdogOn = opts.watchdog !== false;
    // `globalThis.__aetherWatchdog` (tests): shorter waits than a person would sit through.
    this.watchdog = new BlackScreenWatchdog(opts.watchdog === false ? {} : (opts.watchdog ?? (globalThis as { __aetherWatchdog?: Partial<WatchdogOptions> }).__aetherWatchdog));
    this.gpuLog.onShaderFailure = (text) => this.shaderFailed(text);
    if (this.watchdogOn && typeof console !== 'undefined') this.uninstallGpuLog = this.gpuLog.install();
    this.budget = this.budgetFor(this.lowMemory);
    this.adaptive.enabled = opts.adaptiveResolution !== false;
    this.adaptiveWanted = this.adaptive.enabled;
    // The second texture lookup that hides texture repeats costs fill rate: not on software rasterisers or in low-memory mode.
    // Nor where the automatic tier is `low` (weak hardware): each of these lookups is hundreds of lines of the lit shader,
    // and a lit program is what a weak machine spends its load time linking.
    // `globalThis.__AETHER_RICH` (tests): true builds the rich finish shaders on a software rasteriser, to check them on a backend.
    const richMaterials = (globalThis as { __AETHER_RICH?: boolean }).__AETHER_RICH === true || (this.gpu.tier !== 'software' && !this.lowMemory && this.autoTierNow() !== 'low');
    this.materials.antiTile = richMaterials;
    this.materials.groundDetail = richMaterials;
    // The layered terrain blends four photographed surfaces per pixel: also not on software rasterisers.
    this.materials.layeredTerrain = richMaterials;
    // Surface layers and shader expressions: the cheap subset where the rich finishes are off, otherwise the automatic tier.
    this.materials.shadeTier = richMaterials ? this.autoTierNow() : 'low';
    // Leaf cards: 2 × 2 variants of 256 px per atlas (128 px in low-memory mode), composed from photographed leaves.
    if (this.lowMemory) this.materials.foliage.configure(256);
    this.materials.foliage.usePhotos(opts.foliageUrl === undefined ? '/foliage/' : opts.foliageUrl);
    this.materials.foliage.onChange = () => {
      this.needsDraw = true;
    };
    // Water: waves and sky on software rasterisers, depth absorption, refraction and foam on GPUs (the planar mirror, tier high, is opt-in).
    const forcedWater = (globalThis as { __WATER_TIER?: string }).__WATER_TIER;
    const autoWater = waterTierFor(this.gpu.tier, this.lowMemory, false);
    // WebGPU cannot copy a multisampled depth buffer (the WebGL2 way of reading the scene behind the water), so there the
    // standard and high tiers read the scene the renderer draws without the water (see scene-backdrop.ts).
    this.materials.backdropWater = backend === 'webgpu';
    this.materials.waterTier = forcedWater === 'off' ? null : forcedWater === 'simple' || forcedWater === 'standard' || forcedWater === 'high' ? forcedWater : autoWater;
    this.onProgress = opts.onProgress ?? null;
    this.ratioCap = Number.isFinite(opts.pixelRatioCap) && (opts.pixelRatioCap as number) > 0 ? (opts.pixelRatioCap as number) : Number.POSITIVE_INFINITY;
    this.onContextLost = opts.onContextLost;
    this.rig = new CameraRig(camera, controls);
    this.orbit = controls;
    this.rig.occlusionSink = (from, to, out) => this.freeDistance(from, to, out);
    this.generatorCache = opts.geometrySource ? null : new GeneratorCache(256, this.budget.generatorCacheBytes);
    // Built-in generators run in the compute worker (heavy sculptures never block the page).
    this.compute = !opts.geometrySource && typeof Worker !== 'undefined' && opts.workerGeneration !== false ? new ComputeClient({ idleTimeoutMs: 30_000 }) : null;
    const compute = this.compute;
    const source =
      opts.geometrySource ??
      createProcgenGeometrySource({
        ...(opts.sandbox ? { sandbox: opts.sandbox } : {}),
        ...(this.generatorCache ? { cache: this.generatorCache } : {}),
        ...(compute ? { builtin: (g: string, p: Record<string, Json>, seed: number) => compute.generate(g, p, seed) } : {}),
      });
    // Finish textures (architecture) synthesise in the compute worker and redraw when they land.
    this.materials.finishes.configure({
      ...(compute ? { synth: (f, size) => compute.finish(f, size) } : {}),
      onUpdate: () => {
        this.needsDraw = true;
      },
      size: this.budget.finishTextureSize,
    });
    this.compression = new TextureCompression(renderer, opts.transcoderPath === undefined ? DEFAULT_TRANSCODER_PATH : opts.transcoderPath);
    trackCompressedTextureBytes(renderer);
    this.models = new ModelCache(opts.modelLoader ?? createGltfModelLoader({ compression: this.compression }));
    this.textures = new TextureCache(opts.textureSource ?? createTextureSource());
    const common = { source, materials: this.materials, geometries: this.geometries, models: this.models, textures: this.textures };
    this.characters = new CharacterSystem({
      models: this.models,
      shadows: opts.shadows !== false,
      onFootstep: (id, foot, speed, p) => this.footstepHandler?.(id, foot, speed, [p.x, p.y, p.z]),
      // A torch in a hand burns: the fire follows the flame through every animation.
      onProp: (id, prop) => this.fx?.propEmitter(id, prop?.flame ?? null),
    });
    this.avatar.setSystem(this.characters);
    this.ghostRun.setSystem(this.characters);
    this.sync = new SceneSync({
      ...common,
      liteModels: () => this.lowMemory || this.gpu.tier === 'software' || this.autoTierNow() === 'low',
      characters: this.characters,
      maxInstances: opts.maxInstances ?? this.budget.maxInstances,
      staticBatching: opts.staticBatching !== false,
      backgroundMerges: true,
      fields: opts.fields === false ? false : { maxInstances: this.budget.fieldInstances, triangles: this.budget.fieldTriangles },
      // Low-memory mode keeps no hierarchy cache beyond the meshes on screen.
      virtual: opts.virtualGeometry === false ? false : { triangles: this.budget.virtualTriangles, dag: { cacheBytes: this.lowMemory ? 0 : 96 * 1024 * 1024 } },
      onBatchesChanged: () => this.requestPreparedFrame(),
      onContentChanged: () => {
        this.boundsDirty = true;
        this.debugDirty = true;
        this.needsDraw = true;
        this.archView?.invalidate();
      },
    });
    this.ghost = new SceneSync({
      ...common,
      variant: 'ghost',
      maxInstances: 50_000,
      fields: false,
      virtual: false,
      onContentChanged: () => {
        this.needsDraw = true;
      },
    });
    this.archView = new ArchView(this.sync);
    this.growEnabled = opts.growIn !== false;
    this.blueprintEnabled = this.growEnabled && opts.blueprint !== false;
    this.proof = new ProofReplay(() => {
      if (!this.proofSync) {
        this.proofSync = new SceneSync({ ...common, variant: 'proof', maxInstances: 5_000, fields: false, virtual: false, onContentChanged: () => (this.needsDraw = true) });
        this.scene.add(this.proofSync.root);
        this.proof.ghostsIfCreated = this.proofSync;
      }
      return this.proofSync;
    }, (id) => this.sync.object(id));
    this.sync.setLightBudget(FORWARD_LIGHTS[this.gpu.tier]);
    this.env = new EnvironmentRig(this.materials, opts.shadows !== false, opts.hdriSource);
    this.env.onAsyncChange = () => {
      this.needsDraw = true;
    };
    this.qualityPlan = qualityPlan('realtime', this.budget, this.gpu.tier === 'software', this.autoTierNow());
    this.env.sun.shadow.radius = this.qualityPlan.shadowRadius;
    this.env.setAutoHdri(this.qualityPlan.tier === 'high' || this.qualityPlan.tier === 'ultra');
    this.env.shadowMapCap = this.budget.shadowMapCap;
    this.fx = new GameFeel(this.scene, this.qualityPlan.tier, this.lowMemory, { object: (id) => this.sync.object(id) });
    this.scene.add(this.env.group, this.sync.root, this.ghost.root, this.highlighter.group, this.debug.group, this.avatar.group, this.editOverlay.group, this.proof.group, this.ghostRun.group, this.blueprint.group, this.pathOverlay.group, this.lightVolume.light, this.contact.mesh);
    canvas.addEventListener('pointermove', this.onPointerMove, { passive: true });
    canvas.addEventListener('pointerdown', this.onUserCamera, { passive: true });
    canvas.addEventListener('wheel', this.onUserCamera, { passive: true });
  }

  /** Create a renderer on `canvas` (WebGPU when possible, else WebGL2). */
  static async create(canvas: HTMLCanvasElement, opts: RendererOptions = {}): Promise<WorldRenderer> {
    const fields = warmProceduralFields();
    const lowMemory = opts.lowMemory === true || opts.lowPower === true;
    const { renderer, backend, gpu } = await createGpuRenderer(canvas, {
      preference: opts.backend ?? (opts.preferWebGPU === false ? 'webgl2' : 'auto'),
      ...(opts.backendReason ? { forcedReason: opts.backendReason } : {}),
      // MSAA is fixed at context creation: low-memory mode starts without it.
      antialias: opts.antialias !== false && !lowMemory,
      shadows: opts.shadows !== false,
      pixelRatioCap: 1,
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    });
    installRenderPatches(renderer);
    void installLodBias();
    const width = Math.max(1, canvas.clientWidth || canvas.width || 1);
    const height = Math.max(1, canvas.clientHeight || canvas.height || 1);
    const camera = new PerspectiveCamera(55, width / height, 0.1, SKY_RADIUS * 2.5);
    camera.position.set(12, 9, 16);
    camera.lookAt(0, 1, 0);
    let controls: OrbitControlsLike | null = null;
    let onControlsChange: ((listener: () => void) => void) | null = null;
    try {
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      const c = new OrbitControls(camera, canvas);
      c.target.set(0, 1, 0);
      c.maxPolarAngle = Math.PI * 0.495;
      c.minDistance = 0.5;
      c.maxDistance = SKY_RADIUS * 0.8;
      controls = c;
      onControlsChange = (listener) => c.addEventListener('change', listener);
    } catch (e) {
      log.warn(`orbit controls unavailable: ${errorMessage(e)}`);
    }
    // What only the GPU renderer provides for lights: IES-profile spots now, rectangular-light tables on first use.
    try {
      const three = await import('three/webgpu');
      registerLightSupport({
        ies: three.IESSpotLight as unknown as IesSpotLightCtor,
        loadArea: async () => {
          const lib = await import('three/addons/lights/RectAreaLightTexturesLib.js');
          three.RectAreaLightNode.setLTC(lib.RectAreaLightTexturesLib.init());
        },
      });
    } catch (e) {
      log.warn(`IES and area lights unavailable: ${errorMessage(e)}`);
    }
    // The baked light volume of buildings is a light type of its own: tell the node renderer how to shade it.
    try {
      renderer.library.addLight(LightVolumeNode, LightVolume);
      renderer.library.addLight(RoomLampNode, RoomLamp);
      renderer.library.addLight(RoomSpotNode, RoomSpot);
    } catch (e) {
      log.warn(`light volume unavailable: ${errorMessage(e)}`);
    }
    (renderer as unknown as { setOpaqueSort(f: (a: SortItem, b: SortItem) => number): void }).setOpaqueSort(opaqueSort);
    await fields;
    const wr = new WorldRenderer(renderer, canvas, backend, controls, camera, opts, gpu);
    // A lost device/context stops drawing and tells the host (three's default only logs an error).
    renderer.onDeviceLost = (info: { message?: unknown }) => wr.handleContextLost(typeof info?.message === 'string' ? info.message : 'unknown reason');
    // User camera input marks the next on-demand frame dirty.
    onControlsChange?.(() => wr.requestRender());
    wr.resize(width, height);
    if (opts.safeMode === true) wr.setSafeMode(true);
    else wr.startCautiously();
    if (wr.budget.post) {
      const want = wr.wantedEffects();
      if (want) {
        // Shafts march a shadow map that exists only after the first draw: the pipeline is then built by the first frames.
        if (!want.shafts || wr.env.shaftLight) {
          wr.post = await createPostPipeline(renderer, wr.scene, camera, 0.4, postQualityOf(want) ?? 'standard', { effects: want, sun: wr.env.shaftLight ?? wr.env.sun, contactLight: wr.env.sun });
          wr.applyLook();
        }
      }
    }
    opts.onProgress?.(`Renderer ready (${backend}, ${wr.gpu.tier} GPU)`);
    return wr;
  }

  /** Frames actually drawn since creation (on-demand rendering skips the rest). */
  get frameCount(): number {
    return this.framesDrawn;
  }

  /** True once the GPU device / WebGL context was lost (the renderer no longer draws). */
  get contextLost(): boolean {
    return this.lost;
  }

  private handleContextLost(message: string): void {
    if (this.lost || this.disposed) return;
    this.lost = true;
    log.warn(`${this.backend} context lost: ${message.slice(0, 200)}`);
    try {
      this.onContextLost?.({ backend: this.backend, message: message.slice(0, 200) });
    } catch (e) {
      log.warn(`context-lost handler failed: ${errorMessage(e)}`);
    }
  }

  /** Sphere of the meaningful content used for fog and shadow fitting (null before content). */
  get contentSphere(): Readonly<Framing> | null {
    return this.framing;
  }

  /** Fog currently applied to the scene (color and density after the content-size policy), null when none. */
  get fogState(): Readonly<{ color: string; density: number }> | null {
    return this.env.fogState;
  }

  /** True while content is still materialising (grow-in) or the camera is flying: captures should wait. */
  get animating(): boolean {
    return this.grow.active || this.cameraFlying || this.archView.animating;
  }

  /** Change the architectural view (walls, levels, x-ray, section); see {@link ArchViewState}. */
  setArchView(patch: Partial<ArchViewState>): void {
    this.archView.set(patch);
    if (this.archView.value.section !== null) void this.ensureClipGroup();
    this.needsDraw = true;
  }

  /** The current architectural view. */
  get archViewState(): ArchViewState {
    return this.archView.value;
  }

  /** The world shows at least one parametric building. */
  get hasBuildings(): boolean {
    return this.archView.active;
  }

  /** The buildings' light volume is waiting to bake or baking (captures that want the finished light wait for it). */
  get lightVolumeBaking(): boolean {
    return this.lightVolume.baking || this.lightmap.baking;
  }

  /** Pending asynchronous work, independent of optional performance-stat collection. */
  get processingStage(): RenderProcessingStage | null {
    if (this.disposed || this.lost) return null;
    if (this.captureActive || this.tracing) return 'capture';
    if (this.syncing > 0 || !this.sync.idle) return 'scene';
    if (this.foliagePending || (this.compute?.pendingCount ?? 0) > 0 || textureWork.pending > 0) return 'materials';
    if (this.warming || this.postPending || this.preparation.pending > 0 || this.programs.pending > 0) return 'render';
    // Background light bakes have their own progress/cancel control. The viewport
    // remains usable and must not look blocked for the duration of a path trace.
    return null;
  }

  /** Photographed leaf cards are still being composed (captures that want the final foliage wait for them). */
  get foliagePending(): boolean {
    return this.materials.foliage.pending;
  }

  /** A baked light volume lights the buildings. */
  get lightVolumeReady(): boolean {
    return this.lightVolume.ready;
  }

  /** Diagnostics: what the light volume gives an eye at a point, the exposure it asks for and the outdoor reference. */
  lightVolumeAt(x: number, y: number, z: number): { vis: number; bounce: number; lamps: number; ev: number; outdoor: { ambient: number; sun: number }; eyeEv: number; shadowHalf: number; inside: boolean } | null {
    const s = this.lightVolume.eyeSample(x, y, z);
    return s ? { ...s, ev: volumeExposure(s, this.volumeOutdoor), outdoor: { ...this.volumeOutdoor }, eyeEv: this.eyeEv, shadowHalf: this.env.sun.shadow.camera.right, inside: this.shadowInside } : null;
  }

  /** Size and cost of the last light-volume bake (null before one finished). */
  get lightVolumeStats(): Readonly<NonNullable<LightVolumeController['lastBake']>> | null {
    return this.lightVolume.lastBake;
  }

  /** Finish a pending light-volume bake right away (stills); true when a volume is on screen. */
  finishLightVolume(): boolean {
    return this.lightVolume.finishNow();
  }

  /** A new light volume is on the GPU: the analytic fills step aside, the eye re-adapts, the view redraws. */
  private onLightVolume(): void {
    if (this.disposed) return;
    this.env.setVolumeLit(true);
    this.lightmap.volumeChanged();
    this.roomLights = null;
    this.roomScanAt = -1e9;
    this.roomRetries = 0;
    this.eyeClock = 1;
    this.applyLook();
    // The interior shadow fit may now apply.
    this.boundsDirty = true;
    this.needsDraw = true;
  }

  /** Interior light follows the world: the analytic fills, and the baked volume for buildings. */
  private syncInteriorLight(): void {
    const on = this.archView.active && !this.lowMemory && this.cuts.lightVolume;
    this.env.setInteriorBounce(this.archView.active);
    this.lightVolume.setEnabled(on);
    // The baked lightmap outlives the volume cut by the performance ladder (it is the cheaper of the two): only a building
    // without a view, or the low-memory mode, takes it away.
    this.lightmap.setEnabled(this.archView.active && !this.lowMemory);
    this.syncLightNode();
    this.env.setVolumeLit((on && this.lightVolume.ready) || this.lightmap.hasMeshes);
    if (!this.archView.active) this.contact.set([]);
  }

  /** The light node serves the volume or the lightmap: it stays in the scene while either is on. */
  private syncLightNode(): void {
    this.lightVolume.light.visible = this.lightVolume.active || this.lightmap.hasMeshes;
  }

  /** A lightmap was applied or taken away: the analytic fills step aside or return, the view redraws. */
  private onLightmap(): void {
    if (this.disposed) return;
    this.syncLightNode();
    this.env.setVolumeLit((this.archView.active && !this.lowMemory && this.cuts.lightVolume && this.lightVolume.ready) || this.lightmap.hasMeshes);
    this.eyeClock = 1;
    this.applyLook();
    this.boundsDirty = true;
    this.needsDraw = true;
  }

  /** What `environment.lightBake` asks for, applied when it changes. */
  private applyLightBake(want: Environment['lightBake']): void {
    const key = want ? JSON.stringify(want) : '';
    if (key === (this.lightBake ? JSON.stringify(this.lightBake) : '')) return;
    this.lightBake = want;
    if (!want) this.lightmap.reset();
    else if (want.quality === 'off') this.lightmap.clear();
    else this.lightmap.request(want.quality, want.samples);
  }

  /** Whether a bake nobody asked for may start: a tier that draws the baked light, a machine with cores to spare. */
  private lightmapAutoBake(): boolean {
    if (this.lowMemory || this.lightBake?.quality === 'off') return false;
    if (this.gpu.tier === 'software' || weakHardware(this.hardware)) return false;
    return this.qualityPlan.tier !== 'low';
  }

  private lightmapAutoQuality(): LightmapQuality {
    return 'medium';
  }

  /** What a lightmap bake reads: the building's own meshes (merge members too), the volume's trace parts and the light. */
  private gatherLightmap(): LightmapScene | null {
    const g = this.gatherLightVolume();
    if (!g) return null;
    const meshes: Mesh[] = [];
    const seen = new Set<Mesh>();
    const ROLE_RANK: Record<string, number> = { room: 0, wall: 1, ceiling: 2, roof: 3, stair: 4, column: 5 };
    const order = g.parts.filter((p) => !p.movable && p.role !== 'door' && p.role !== 'window' && p.role !== 'opening').sort((a, b) => (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9));
    const walls: Array<{ meshes: Mesh[]; cut: boolean }> = [];
    for (const p of order) {
      // A wall the view has sectioned (`drawn` set: the part holds the wall as built) draws other geometry than the wall as built.
      const wall = p.role === 'wall' ? { meshes: [] as Mesh[], cut: p.drawn !== undefined } : null;
      for (const vm of p.drawn ?? p.meshes) {
        if (vm.seeThrough || seen.has(vm.mesh)) continue;
        seen.add(vm.mesh);
        (wall ? wall.meshes : meshes).push(vm.mesh);
      }
      if (wall) walls.push(wall);
    }
    return { meshes, walls, parts: g.parts, lighting: g.lighting, groundY: g.groundY };
  }

  /** Bake the buildings' light now at this quality (the assistant's `bake_light`, the editor's button). */
  bakeLight(quality: LightmapQuality, samples?: number): void {
    this.lightmap.request(quality, samples);
  }

  /** Stop a running or waiting lightmap bake. */
  cancelLightmapBake(): void {
    this.lightmap.cancel();
  }

  /** The lightmap's state: what runs, how far, what was baked. */
  get lightmapStatus(): LightmapStatus {
    return this.lightmap.status;
  }

  /** Size, cost and source of the lightmap on screen (null without one). */
  get lightmapStats(): Readonly<NonNullable<LightmapController['lastBake']>> | null {
    return this.lightmap.ready ? this.lightmap.lastBake : null;
  }

  /** Bakes the worker was given since the renderer started (0 when every lightmap came from a bundled file or the cache). */
  get lightmapBakesStarted(): number {
    return this.lightmap.bakesStarted;
  }

  /** What the key of the last lightmap lookup was made of (diagnostics: why a bundled file did not match). */
  get lightmapKeyInputs(): { content: string; scalars: string; parts: string[] | null } | null {
    return this.lightmap.keyInputs ? { ...this.lightmap.keyInputs, parts: this.lightmap.keyParts } : null;
  }

  /** The `.lmap` file of the lightmap on screen (save it with the project or ship it with a bundled world). */
  get lightmapAsset(): Uint8Array | null {
    return this.lightmap.asset;
  }

  /**
   * Confine every room lamp and spot to its room: the room's floor footprint (a little wider, for its own walls) from
   * the floor to just above the lamp. Lamps have no shadow maps, so this is what keeps a bedroom pendant out of the
   * corridor and a downlight's cone out of the room below.
   */
  private clipLampsToRooms(): void {
    const room = new Box3();
    // The ceiling over each room: a lamp lights up to it (a pendant's own height plus a margin fell short of a tall
    // ceiling, which then stayed dark brown with the lamp right under it).
    const ceilingTop = new Map<string, number>();
    const cb = new Box3();
    this.sync.forEachNode((node) => {
      const a = node.entity.arch;
      if (a?.role !== 'ceiling' || !a.room) return;
      cb.makeEmpty();
      for (const b of node.bindings) cb.expandByObject(b.mesh);
      if (!cb.isEmpty()) ceilingTop.set(a.room, Math.max(ceilingTop.get(a.room) ?? -Infinity, cb.max.y));
    });
    // Open apertures of the building (archways without a leaf): lamps pass light through those of their room.
    const apertures: LampPortal[] = [];
    this.grow.withFullScale(() => {
      this.scene.updateMatrixWorld();
      this.sync.forEachNode((node) => {
        const a = node.entity.arch;
        if (a?.role !== 'opening' || a.kind !== 'opening' || node.entity.template) return;
        const params = node.entity.shape.kind === 'procedural' ? node.entity.shape.params : undefined;
        const width = Number(params?.['width']);
        const height = Number(params?.['height']);
        if (!(width > 0.2) || !(height > 0.5)) return;
        node.object.matrixWorld.decompose(_pos, _quat, _scl);
        _dir.set(1, 0, 0).applyQuaternion(_quat);
        const len = Math.hypot(_dir.x, _dir.z);
        if (len < 1e-3) return;
        apertures.push({ cx: _pos.x, cy: _pos.y + height / 2, cz: _pos.z, tx: _dir.x / len, tz: _dir.z / len, halfWidth: width / 2, halfHeight: height / 2 });
      });
    });
    this.sync.forEachNode((node) => {
      const l = node.light?.light;
      if (!isConfinedLight(l)) return;
      const id = node.entity.arch?.room;
      const r = id ? this.sync.node(id) : undefined;
      room.makeEmpty();
      if (r) for (const b of r.bindings) room.expandByObject(b.mesh);
      if (room.isEmpty()) {
        l.setClip(null);
        l.setPortals([]);
        return;
      }
      l.getWorldPosition(_pos);
      // The room's footprint runs along the wall centrelines: the clip's short fade there ends inside each wall, so a
      // lamp lights its own wall faces and none of the next room's (a wider box lit a stripe of the neighbour's walls
      // along every corner). From just under its floor (the slab's top) to just above its ceiling: the ceiling below
      // and the floor above (0.22 m beyond) stay dark, where the old box lit a bright line along the ceiling below.
      const floorY = room.max.y;
      room.min.x -= ROOM_LAMP_MARGIN;
      room.min.z -= ROOM_LAMP_MARGIN;
      room.max.x += ROOM_LAMP_MARGIN;
      room.max.z += ROOM_LAMP_MARGIN;
      room.min.y = floorY - 0.05;
      const ceil = id ? ceilingTop.get(id) : undefined;
      room.max.y = Math.max(floorY + 0.5, ceil !== undefined ? ceil + ROOM_LAMP_CEILING : _pos.y + 0.6);
      l.setClip(room);
      // The apertures in this room's walls (their centres on the footprint's edge, between its floor and ceiling), nearest first.
      const mine = roomApertures(apertures, room, _pos);
      l.setPortals(mine);
    });
  }

  /** Footprints under the building's furniture and fixtures, on its floors (room slab tops). */
  private placeContactShadows(parts: readonly VolumePart[]): void {
    const floors: number[] = [];
    const boxes: Box3[] = [];
    for (const p of parts) {
      if (p.role === 'room') {
        const b = new Box3();
        for (const m of p.meshes) b.expandByObject(m.mesh);
        if (!b.isEmpty()) floors.push(b.max.y);
      } else if (p.role === 'furniture' || p.role === 'fixture') {
        boxes.push(new Box3().setFromObject(p.object));
      }
    }
    // Screen-space AO already darkens contacts on the high tiers: the footprints stay lighter there.
    this.contact.set(planContactShadows(boxes, floors), this.activeEffects.ao ? 0.6 : 1);
  }

  /**
   * A wall the architectural view has sectioned (`shape.params.cut`: cutaway, lowered, cut open) as it was built, for the
   * light bake: its full height with its window holes. The meshes are throw-away trace geometry, never drawn. Null for a wall
   * that is whole, or when the generator refuses the params.
   */
  private asBuiltWall(node: Readonly<EntityNode>): VolumePart | null {
    const shape = node.entity.shape;
    if (shape.kind !== 'procedural' || shape.generator !== 'arch-wall' || typeof shape.params['cut'] !== 'number') return null;
    try {
      const params: Record<string, Json> = { ...shape.params };
      delete params['cut'];
      const out = buildStructure('arch-wall', params);
      const meshes: Array<{ mesh: Mesh; seeThrough: boolean; doubleSided: boolean }> = [];
      // Fallback albedo: the mean of the lit parts the view's wall carries (the section cap is a dark poche, not a finish).
      const mean = new Color(0, 0, 0);
      let n = 0;
      const a: [number, number, number] = [0.5, 0.5, 0.5];
      for (const b of node.bindings) {
        materialAlbedo(b.mesh.material, a);
        if (0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2] < 0.04) continue;
        mean.r += a[0];
        mean.g += a[1];
        mean.b += a[2];
        n++;
      }
      if (n > 0) mean.multiplyScalar(1 / n);
      else mean.setRGB(0.5, 0.5, 0.5);
      const two = node.bindings[0]?.doubleSided ?? false;
      node.object.updateWorldMatrix(true, false);
      for (const part of out.parts) {
        if (part.indices.length < 3) continue;
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(part.positions, 3));
        g.setIndex(new BufferAttribute(part.indices, 1));
        const spec = part.material as { color?: string };
        const c = spec.color ? new Color(spec.color) : mean;
        const mesh = new ThreeMesh(g, new MeshBasicMaterial({ color: c }));
        (mesh.material as Material).userData['aetherAlbedo'] = [c.r, c.g, c.b];
        mesh.matrixWorld.copy(node.object.matrixWorld);
        meshes.push({ mesh, seeThrough: false, doubleSided: two });
      }
      return meshes.length > 0 ? { role: 'wall', object: node.object, meshes, drawn: node.bindings.map((b) => ({ mesh: b.mesh, seeThrough: b.seeThrough, doubleSided: b.doubleSided })) } : null;
    } catch (e) {
      log.warn(`wall light trace falls back to the sectioned wall: ${errorMessage(e)}`);
      return null;
    }
  }

  /** What a light-volume bake needs: the building parts, the light of the environment and the ground height. */
  private gatherLightVolume(): { parts: VolumePart[]; lighting: VolumeLighting; groundY: number } | null {
    if (!this.archView.active) return null;
    const parts: VolumePart[] = [];
    const lamps: VolumeLamp[] = [];
    this.clipLampsToRooms();
    let groundY = Number.POSITIVE_INFINITY;
    this.grow.withFullScale(() => {
      this.scene.updateMatrixWorld();
      this.sync.forEachNode((node) => {
        const e = node.entity;
        if (e.template || e.visible === false) return;
        const l = node.light?.light;
        const kind = l as (Light & { isPointLight?: boolean; isSpotLight?: boolean; distance?: number }) | undefined;
        if (l && kind && (l.visible || l.userData['cut'] === true) && l.intensity > 0 && (kind.isPointLight || kind.isSpotLight)) {
          l.getWorldPosition(_pos);
          // A spot (downlight) lights about half of what the same point light would, all of it below.
          const k = (kind.isSpotLight ? SPOT_SHARE * l.intensity : l.intensity) * (this.docLook?.lampStrength ?? 1);
          const range = kind.distance;
          const c = isConfinedLight(l) && !l.clip.isEmpty() ? l.clip : null;
          lamps.push({ position: [_pos.x, _pos.y, _pos.z], color: [l.color.r * k, l.color.g * k, l.color.b * k], range: range && range > 0 ? range : 20, ...(c ? { room: [c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z] as const } : {}) });
        }
        const a = e.arch;
        if (!a) return;
        if (a.role === 'building') {
          node.object.getWorldPosition(_pos);
          groundY = Math.min(groundY, _pos.y);
          return;
        }
        // A wall the view has sectioned (cutaway, lowered, cut open) is traced as built: the light of a room must not
        // depend on where the camera stands or which walls the view has lowered.
        const asBuilt = a.role === 'wall' ? this.asBuiltWall(node) : null;
        if (asBuilt) {
          parts.push(asBuilt);
          return;
        }
        const movable = e.behaviors.length > 0 || (e.physics !== undefined && e.physics.body !== 'static');
        parts.push({ role: a.role, ...(a.kind ? { kind: a.kind } : {}), object: node.object, movable, meshes: node.bindings.map((b) => ({ mesh: b.mesh, seeThrough: b.seeThrough, doubleSided: b.doubleSided })) });
      });
    });
    this.placeContactShadows(parts);
    if (parts.length === 0) return null;
    const sun = this.env.sun;
    _dir.copy(sun.position).sub(sun.target.position);
    const sunOn = sun.visible && sun.intensity > 0 && _dir.lengthSq() > 1e-8 && _dir.normalize().y > 0.02;
    const hemi = this.env.hemi;
    const hs = hemi.color;
    const hg = hemi.groundColor;
    const hi = this.env.bakeHemiIntensity;
    // The image light as a two-tone hemisphere: mean radiance of the sky map's upper and lower halves.
    const sky = skyHalves(this.env.environmentMap);
    const envI = this.env.skyState.envIntensity * Math.PI;
    const a: [number, number, number] = [0, 0, 0];
    const b: [number, number, number] = [0, 0, 0];
    const sc = [hs.r, hs.g, hs.b];
    const gc = [hg.r, hg.g, hg.b];
    for (let c = 0; c < 3; c++) {
      const up = (sc[c] as number) * hi + (sky.up[c] as number) * envI;
      const down = (gc[c] as number) * hi + (sky.down[c] as number) * envI;
      a[c] = (up + down) / 2;
      b[c] = (up - down) / 2;
    }
    const sunIrr: [number, number, number] = [sun.color.r * sun.intensity, sun.color.g * sun.intensity, sun.color.b * sun.intensity];
    this.volumeOutdoor = { ambient: 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2], sun: sunOn ? 0.2126 * sunIrr[0] + 0.7152 * sunIrr[1] + 0.0722 * sunIrr[2] : 0 };
    return {
      parts,
      groundY: Number.isFinite(groundY) ? groundY : 0,
      lighting: {
        sun: sunOn ? { direction: [_dir.x, _dir.y, _dir.z], irradiance: sunIrr } : null,
        ambient: { a, b },
        groundAlbedo: [0.2, 0.23, 0.16],
        lamps,
      },
    };
  }

  /** Wrap the scene content in a clipping group (section cuts). Loaded lazily: it lives in the node renderer module. */
  private async ensureClipGroup(): Promise<void> {
    if (this.clipGroup || this.clipLoading || this.disposed) return;
    this.clipLoading = true;
    try {
      const { ClippingGroup } = await import('three/webgpu');
      if (this.disposed) return;
      const group = new ClippingGroup() as unknown as Group & { enabled: boolean; clippingPlanes: Plane[] };
      group.name = 'section';
      group.clippingPlanes = [this.sectionPlane];
      group.enabled = false;
      this.scene.remove(this.sync.root);
      group.add(this.sync.root);
      this.scene.add(group);
      this.clipGroup = group;
      this.needsDraw = true;
    } catch (e) {
      log.warn(`section cut unavailable: ${errorMessage(e)}`);
    } finally {
      this.clipLoading = false;
    }
  }

  /** True while an automatic camera flight (framing, focus) is in progress. */
  get cameraFlying(): boolean {
    return this.rig.focusing;
  }

  /** True while a fly-through tour plays (see {@link startTour}). */
  get touring(): boolean {
    return this.rig.touring;
  }

  /**
   * Fly-through: a cinematic loop around the meaningful content (low passes
   * past focus objects, high reveals), starting and ending at the current
   * view. A large scene (content radius {@link DRONE_TOUR_RADIUS} m or more,
   * two or more sections) gets a drone tour instead: a reveal, then each
   * section glided into and orbited close up, with high transits between,
   * paced by distance (its length follows the scene unless `seconds` is given). Pointer or wheel input on the canvas, or any camera command, stops
   * it. Returns false when there is nothing to tour.
   */
  startTour(seconds?: number): boolean {
    if (this.boundsDirty) this.refresh();
    const f = this.framing;
    if (!f) return false;
    const items = collectFramingItems(this.sync);
    const cam = this.perspective.position;
    // A large scene gets the drone tour: each section revealed, orbited close up and left by a high transit.
    if (f.radius >= DRONE_TOUR_RADIUS) {
      const sections = tourSections(items, f.radius);
      if (sections.length >= 2) {
        const probe = {
          ground: (x: number, z: number): number => this.raycastWorld([x, f.center[1] + f.radius * 3 + 500, z], [0, -1, 0], f.radius * 6 + 2000)?.point[1] ?? this.rig.floorY,
          clear: (a: Vec3, b: Vec3): boolean => {
            const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
            const hit = this.raycastWorld(a, [b[0] - a[0], b[1] - a[1], b[2] - a[2]], d);
            return !hit || Math.hypot(hit.point[0] - b[0], hit.point[1] - b[1], hit.point[2] - b[2]) < d * 0.25;
          },
        };
        const plan = droneTourKeys({ pos: [cam.x, cam.y, cam.z], target: this.orbitTarget() }, sections, f.center, f.radius, probe);
        this.rig.startTour(new CameraTour(plan.keys, seconds ?? TOUR_SECONDS, seconds === undefined ? plan.times : undefined));
        this.needsDraw = true;
        return true;
      }
    }
    const focus: Vec3[] = [];
    for (const item of items) {
      if (focus.length >= 6) break;
      if (item.focus || (item.weight === undefined && (item.max[1] - item.min[1]) > f.radius * 0.08)) focus.push([(item.min[0] + item.max[0]) / 2, item.min[1] + (item.max[1] - item.min[1]) * 0.45, (item.min[2] + item.max[2]) / 2]);
    }
    const target = this.orbitTarget();
    const keys = tourKeys({ pos: [cam.x, cam.y, cam.z], target }, f.center, f.radius, focus, Math.max(0.5, this.rig.floorY));
    this.rig.startTour(new CameraTour(keys, seconds ?? TOUR_SECONDS));
    this.needsDraw = true;
    return true;
  }

  /** Stop a running tour (the camera stays where it is). */
  stopTour(): void {
    this.rig.stopTour();
  }

  /** The main perspective camera. */
  get camera(): PerspectiveCamera {
    return this.perspective;
  }

  /** Incrementally synchronize to `world`; resolves when procedural generation finished. */
  async setWorld(world: WorldDoc): Promise<void> {
    if (this.disposed) return;
    const prev = this.sync.world;
    this.watchdog.begin(now(), this.framesDrawn);
    if (!prev || (prev.environment !== world.environment && !deepEqual(prev.environment, world.environment))) this.applyEnvironment(world);
    this.avatar.setLook(world.player.character);
    // A first world, or a big replacement: nothing is drawn until its models are in and its programs linked
    // (see warmShaders), so the page never freezes on one program at a time while the world appears.
    const hold = this.gpu.tier !== 'software' && (prev === null || this.addedContent(prev, world).length >= BULK_HOLD_ENTITIES);
    if (hold) this.warming = true;
    const done = this.sync.setWorld(world);
    this.fx.setWorld(world);
    this.trackWaterBodies(world);
    this.archView.invalidate();
    this.invalidateCeilings();
    this.syncInteriorLight();
    const change = prev ? archChangeKind(prev, world) : 'geometry';
    if (change) {
      this.lightVolume.invalidate();
      this.lightmap.invalidate(change);
      this.syncing++;
      void done.finally(() => {
        this.syncing = Math.max(0, this.syncing - 1);
        this.lightVolume.invalidate();
        this.lightmap.invalidate(change);
      });
    }
    // New entities stay hidden while their geometry streams in, then grow in together.
    const added = this.growEnabled ? this.addedContent(prev, world) : [];
    for (const target of added) this.grow.hide(target);
    this.boundsDirty = true;
    this.debugDirty = true;
    this.needsDraw = true;
    // Only the first world reports: the host clears the load text when it has framed that world, and nothing clears it after a later one.
    const say = prev === null ? this.onProgress : null;
    say?.('Building the world…');
    try {
      await done;
      performance.mark('aether:sync-done');
      // Ceilings measured while their geometry was still streaming in are stale.
      this.invalidateCeilings();
      if (this.disposed) return;
      // Emitters follow the scene objects, which exist only now.
      if (this.sync.world === world) this.fx.syncEmitters(world);
      // The first world of a session just materialises; later builds show their plan marks first.
      if (added.length > 0) this.startGrow(added, prev !== null);
      if (!this.framed) {
        say?.('Preparing camera…');
        await warmRaycastTrees(this.sync.root, FIRST_FRAME_BVH_MS);
        if (this.disposed || this.sync.world !== world) return;
        this.framed = this.frameContent({ duration: 0 });
        performance.mark('aether:framed');
      }
      this.syncSmallCasters();
      if (hold) await this.warmShaders(say);
    } finally {
      if (hold) {
        this.warming = false;
        this.needsDraw = true;
      }
    }
  }

  /**
   * Link the shader programs of what the first frame shows before it is drawn. Linking is asynchronous (and runs
   * on the driver's own threads) here, whereas the first draw of every new material variant would otherwise link
   * it synchronously on the main thread, one program at a time, with the page frozen. Bounded: a slow driver
   * does not hold the load screen longer than {@link SHADER_WARMUP_MS}.
   */
  private async warmShaders(say: ((msg: string) => void) | null): Promise<void> {
    if (this.disposed || this.lost) return;
    const started = performance.now();
    // The environment map first: a map that arrives later re-keys (and recompiles) every material.
    say?.('Loading the sky…');
    performance.mark('aether:sky-start');
    await this.env.hdri.settled(HDRI_WAIT_MS);
    if (this.disposed || this.lost) return;
    performance.mark('aether:warm-start');
    say?.('Preparing shaders…');
    await this.prepareAndCompile();
    // The leaf cards fill in a task each while the programs link; bare trees must not be the first thing shown.
    await this.until(() => !this.materials.foliage.pending, FOLIAGE_WAIT_MS);
    this.shaderWarmupMs = performance.now() - started;
    performance.mark('aether:warm-end');
    // Models and people are still arriving: their programs link in rounds, not one by one inside a draw.
    void this.lateWarm();
  }

  /**
   * What the first draws would create (static batches, scatter fields, virtual-geometry stand-ins, the post chain)
   * exists before the programs are linked, so they are linked too.
   */
  private async prepareAndCompile(boundMs = SHADER_WARMUP_MS): Promise<void> {
    this.prepareBatches();
    await this.sync.waitForBatches();
    if (this.disposed || this.lost) return;
    this.sync.updateView(this.perspective, Math.max(1, Math.round(this.cssHeight * this.renderer.getPixelRatio())), 0);
    this.syncPost();
    performance.mark('aether:post-wait-start');
    await this.until(() => !this.postPending, POST_WAIT_MS);
    performance.mark('aether:compile-start');
    if (this.disposed || this.lost) return;
    await this.compileScene(boundMs);
    performance.mark('aether:compile-end');
  }

  /**
   * After the first frame: every {@link LATE_ROUND_MS} (or when the last model is in) hold the draws for one parallel link
   * of whatever arrived since. The page stays responsive; a synchronous link inside a draw freezes it for 0.1 to 0.8 s.
   */
  private async lateWarm(): Promise<void> {
    for (let round = 0; round < LATE_ROUNDS && !this.disposed && !this.lost; round++) {
      await this.bounded(this.sync.whenIdle(), LATE_ROUND_MS);
      if (this.disposed || this.lost || this.warming) return;
      this.warming = true;
      try {
        await this.prepareAndCompile(LATE_COMPILE_MS);
      } finally {
        this.warming = false;
        this.needsDraw = true;
      }
      this.syncSmallCasters();
      if (this.sync.idle) return;
    }
  }

  /** Meshes that stopped casting into the sun's shadow map because they are small (mesh and its own flag before). */
  private readonly smallCasters = new Map<Mesh, boolean>();

  /**
   * On the low tier the sun's shadow pass draws what is big enough to leave a shadow worth seeing: a bird, a fish or a
   * butterfly is a dozen draw calls there for a few pixels of shadow, a flock is hundreds, and scattered fields are
   * thousands of triangles. Buildings, terrain and large props keep theirs. Restores the flags when the tier rises again.
   */
  private syncSmallCasters(): void {
    const on = this.qualityPlan.tier === 'low' && this.qualityPlan.quality === 'realtime';
    if (!on) {
      for (const [m, was] of this.smallCasters) m.castShadow = was;
      this.smallCasters.clear();
      return;
    }
    const world = this.sync.world;
    if (!world) return;
    for (const [id, e] of Object.entries(world.entities)) {
      if (e.template || e.castShadow === false) continue;
      const node = this.sync.node(id);
      if (!node) continue;
      let small = false;
      if (e.shape.kind === 'asset') {
        _bounds.setFromObject(node.content);
        small = !_bounds.isEmpty() && Math.max(_bounds.max.x - _bounds.min.x, _bounds.max.y - _bounds.min.y, _bounds.max.z - _bounds.min.z) < SMALL_CASTER_METRES;
      }
      node.content.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh !== true) return;
        // Scattered fields (trees, shrubs, grass) are thousands of triangles each in the shadow pass.
        const drop = small || (m as { isInstancedMesh?: boolean }).isInstancedMesh === true;
        if (drop && m.castShadow) {
          this.smallCasters.set(m, true);
          m.castShadow = false;
        } else if (!drop && this.smallCasters.has(m)) {
          m.castShadow = this.smallCasters.get(m) as boolean;
          this.smallCasters.delete(m);
        }
      });
    }
  }

  /** Skinned assets (animals) this renderer hid for being far away on the low tier. */
  private readonly hiddenFar = new Set<Object3D>();
  private readonly skinnedAsset = new AssetSkinCache();
  private farCullFrame = 0;

  /**
   * On the low tier a skinned asset (a bird, a fish, a deer) farther than {@link FAR_ANIMAL_METRES} from the eye is not
   * drawn: each of its parts is a draw call and a skinning pass on a CPU that has none to spare, for a speck in the
   * fog. Every few frames; they come back when the eye comes near or the tier rises.
   */
  private cullFarAnimals(): void {
    const on = this.qualityPlan.tier === 'low' && this.qualityPlan.quality === 'realtime';
    if (!on) {
      if (this.hiddenFar.size > 0) {
        for (const o of this.hiddenFar) o.visible = true;
        this.hiddenFar.clear();
      }
      return;
    }
    if (++this.farCullFrame % 12 !== 1) return;
    const world = this.sync.world;
    if (!world) return;
    const eye = this.perspective.position;
    let changed = false;
    for (const [id, e] of Object.entries(world.entities)) {
      if (e.template || e.shape.kind !== 'asset') continue;
      const node = this.sync.node(id);
      if (!node) continue;
      if (!this.skinnedAsset.hasSkin(node)) {
        // A rebuilt asset may no longer contain skin; release only visibility we own.
        if (this.hiddenFar.delete(node.content)) {
          node.content.visible = node.characterBody === null;
          changed = true;
        }
        continue;
      }
      const m = node.object.matrixWorld.elements;
      const dx = (m[12] as number) - eye.x;
      const dz = (m[14] as number) - eye.z;
      const far = dx * dx + dz * dz > FAR_ANIMAL_METRES * FAR_ANIMAL_METRES;
      if (far && node.content.visible) {
        node.content.visible = false;
        this.hiddenFar.add(node.content);
        changed = true;
      } else if (!far && this.hiddenFar.has(node.content)) {
        node.content.visible = true;
        this.hiddenFar.delete(node.content);
        changed = true;
      }
    }
    if (changed) this.needsDraw = true;
  }

  /**
   * Link every program the scene needs, bounded by {@link SHADER_WARMUP_MS}. Never throws.
   *
   * three's `compileAsync` walks every render item and yields to the browser after each one, so a world of a thousand
   * meshes spends seconds on bookkeeping while only a few dozen distinct programs exist. One representative per
   * (material, geometry layout, object kind) is compiled; the others are hidden for the instant the list is gathered
   * (it is gathered synchronously, before the first await). Objects out of view count as well: the camera moves on.
   */
  private async compileScene(boundMs = SHADER_WARMUP_MS): Promise<void> {
    const restoreEffects = this.fx.vfx.prepareForCompile();
    const changed: Array<{ o: Object3D; visible: boolean; culled: boolean }> = [];
    const seen = new Set<string>();
    this.scene.traverseVisible((o) => {
      const m = o as Mesh;
      if (m.isMesh !== true && (o as { isPoints?: boolean }).isPoints !== true && (o as { isLine?: boolean }).isLine !== true) return;
      const mat = m.material as Material | Material[];
      const mats = Array.isArray(mat) ? mat : [mat];
      const geo = m.geometry;
      const attrs = geo ? Object.keys(geo.attributes).join(',') + (geo.index ? '|i' : '') : '';
      const kind = `${(o as { isInstancedMesh?: boolean }).isInstancedMesh ? 'I' : ''}${(o as { isSkinnedMesh?: boolean }).isSkinnedMesh ? `S${(o as { skeleton?: { bones: unknown[] } }).skeleton?.bones.length ?? 0}` : ''}${o.receiveShadow ? 'r' : ''}${o.castShadow ? 'c' : ''}${o.layers.mask}`;
      const key = `${mats.map((x) => x.uuid).join('+')}|${attrs}|${kind}`;
      if (seen.has(key)) {
        changed.push({ o, visible: true, culled: false });
        o.visible = false;
        return;
      }
      seen.add(key);
      if (o.frustumCulled) {
        o.frustumCulled = false;
        changed.push({ o, visible: false, culled: true });
      }
    });
    // The footprints of a building are hidden until there are some, and their program is one of the heaviest small ones.
    const prints = this.contact.mesh;
    const showPrints = !prints.visible && this.archView.active;
    if (showPrints) prints.visible = true;
    const restore = (): void => {
      for (const c of changed) {
        if (c.culled) c.o.frustumCulled = true;
        else c.o.visible = c.visible;
      }
      if (showPrints) prints.visible = false;
      restoreEffects();
    };
    try {
      const done = this.renderer.compileAsync(this.scene, this.perspective, this.scene);
      restore();
      await this.bounded(done, boundMs);
    } catch (e) {
      restore();
      log.warn(`shader warm-up failed: ${errorMessage(e)}`);
    }
  }

  /** Resolves when `done()` holds (polled), or after `ms`. */
  private until(done: () => boolean, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const end = performance.now() + ms;
      const poll = (): void => {
        if (done() || performance.now() >= end || this.disposed) resolve();
        else setTimeout(poll, 25);
      };
      poll();
    });
  }

  /** `p`, or give up waiting for it after `ms`. */
  private async bounded(p: Promise<unknown>, ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([p, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Content groups of renderable entities that `world` adds to `prev` (all of them for a first world). */
  private addedContent(prev: WorldDoc | null, world: WorldDoc): Object3D[] {
    const out: Object3D[] = [];
    for (const [id, entity] of Object.entries(world.entities)) {
      if (entity.template || entity.shape.kind === 'none' || (prev && Object.hasOwn(prev.entities, id))) continue;
      const node = this.sync.node(id);
      if (node && !node.transient) out.push(node.content);
    }
    return out;
  }

  /** Start the grow-in ripple of `targets`, staggered by distance from the content center. */
  private startGrow(targets: readonly Object3D[], marks = true): void {
    const plan = this.grow.withFullScale(() => {
      const framing = contentFraming(collectFramingItems(this.sync));
      const cx = framing?.center[0] ?? 0;
      const cz = framing?.center[2] ?? 0;
      return targets.map((target) => {
        if (!target.parent) return { target, delay: 0, overshoot: false };
        target.getWorldPosition(_pos);
        _one.setFromObject(target);
        const radius = _one.isEmpty() ? 0 : _one.getSize(_corner).length() / 2;
        return { target, delay: growDelay(Math.hypot(_pos.x - cx, _pos.z - cz)), overshoot: radius <= GROW_OVERSHOOT_MAX_RADIUS };
      });
    });
    // The plan first: corner brackets where each object will stand, then it grows into them.
    const lead = this.blueprintEnabled && marks ? this.showBlueprint(targets) : 0;
    for (const p of plan) this.grow.start(p.target, p.delay + lead, p.overshoot);
    this.needsDraw = true;
  }

  /** Bracket the largest of `targets` (full-scale bounds); returns the grow lead time (s). */
  private showBlueprint(targets: readonly Object3D[]): number {
    const boxes = this.grow.withFullScale(() => {
      const out: Array<{ box: MarkBox; size: number }> = [];
      for (const target of targets) {
        if (!target.parent) continue;
        _one.setFromObject(target);
        if (_one.isEmpty()) continue;
        const size = _one.getSize(_corner).lengthSq();
        if (!Number.isFinite(size) || size > 400 * 400) continue; // terrain-sized backdrops are not "objects"
        out.push({ box: markBoxOf(_one), size });
      }
      return out;
    });
    if (boxes.length === 0) return 0;
    boxes.sort((a, b) => b.size - a.size);
    this.blueprint.show(boxes.slice(0, MAX_BLUEPRINT_BOXES).map((b) => b.box));
    return BLUEPRINT_LEAD_SECONDS;
  }

  /**
   * Replay a verification run's motion trace: ghost copies of the bodies
   * that moved re-enact it over the edited world, leaving fading trails.
   * Resolves true once it plays (false when there is nothing to show).
   */
  async playProof(trace: ProofTrace, opts: ProofReplayOptions = {}): Promise<boolean> {
    const world = this.sync.world;
    if (this.disposed || !world) return false;
    // Bring the motion close enough to read; the replay waits for the camera to arrive.
    this.reveal(trace.ids, FRAME_DURATION, PROOF_MIN_SHARE);
    const ok = await this.proof.start(world, trace, opts);
    this.needsDraw = true;
    return ok;
  }

  /**
   * Export the world's meshes (current pose) as binary glTF: the same
   * flattened pipeline as {@link exportGltf}, so grow-in is finished first
   * and batched / merged meshes export as drawn.
   */
  async exportGlb(): Promise<ArrayBuffer> {
    const r = await this.exportGltf({ binary: true });
    if (typeof r.data === 'string') throw new Error('the exporter returned no binary data');
    return r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength) as ArrayBuffer;
  }

  /** Remove the plan marks (corner brackets) of the last build. */
  clearBlueprint(): void {
    if (!this.blueprint.active) return;
    this.blueprint.clear();
    this.needsDraw = true;
  }

  /**
   * Replay a playtest run: a ghost player walks the recorded path over the
   * rendered world. Time is controlled with {@link seekGhost}, {@link pauseGhost},
   * {@link playGhost} and {@link setGhostSpeed}. Returns false for a malformed trace.
   */
  startGhost(trace: GhostTrace, opts: { speed?: number; autoplay?: boolean; onEnd?: () => void } = {}): boolean {
    if (this.disposed) return false;
    const ok = this.ghostRun.start(trace, opts);
    this.needsDraw = true;
    return ok;
  }

  /** Show the ghost at a live position while the bot is still playing (null removes it). */
  ghostLive(pos: Vec3 | null): void {
    if (this.disposed) return;
    if (pos) this.ghostRun.live(pos[0], pos[1], pos[2]);
    else this.ghostRun.stopLive();
    this.needsDraw = true;
  }

  /** Remove the ghost player. */
  stopGhost(): void {
    if (!this.ghostRun.active) return;
    this.ghostRun.stop();
    this.needsDraw = true;
  }

  /** Jump the ghost to a time in seconds. */
  seekGhost(t: number): void {
    this.ghostRun.seek(t);
    this.needsDraw = true;
  }

  /** Resume the ghost (from the start if it had finished). */
  playGhost(): void {
    this.ghostRun.play();
    this.needsDraw = true;
  }

  /** Pause the ghost. */
  pauseGhost(): void {
    this.ghostRun.pause();
  }

  /** Playback speed of the ghost (0.1–16). */
  setGhostSpeed(v: number): void {
    this.ghostRun.setSpeed(v);
  }

  /** State of the ghost for a player UI. */
  get ghostState(): { active: boolean; playing: boolean; time: number; length: number; speed: number } {
    const g = this.ghostRun;
    return { active: g.active, playing: g.playing, time: g.time, length: g.length, speed: g.rate };
  }

  /** The ghost's world position (feet), or null when there is none. */
  ghostPosition(): [number, number, number] | null {
    return this.ghostRun.active ? this.ghostRun.position() : null;
  }

  /** Stop a running proof replay. */
  stopProof(): void {
    if (!this.proof.active) return;
    this.proof.stop();
    this.needsDraw = true;
  }

  /** True while a proof replay runs. */
  get proofActive(): boolean {
    return this.proof.active;
  }

  private applyEnvironment(world: WorldDoc): void {
    const env = world.environment;
    this.shaftsUnavailable = false;
    this.env.apply(env, this.scene);
    this.applyWind(env.wind);
    this.docGrade = env.grade ?? null;
    this.docLook = env.look ?? null;
    this.docExposure = env.exposure ?? 1;
    setFoliageTint(env.look?.foliageTint ?? null);
    // Applies to materials created afterwards (the entities of this world are built after its environment).
    this.materials.shaderBudget = env.look?.shaderBudget === 'hero' ? 'hero' : 'normal';
    // The exterior (`surroundings`) is drawn beyond the plot and is not in the light the building bakes: changing only it keeps the baked light.
    const lightKey = JSON.stringify({ ...env, surroundings: undefined, look: env.look ? { ...env.look, intent: undefined, shaderBudget: undefined } : undefined });
    if (lightKey !== this.lightEnvKey) {
      this.lightEnvKey = lightKey;
      this.lightVolume.invalidate();
      this.lightmap.invalidate('light');
    }
    this.applyLightBake(env.lightBake);
    this.syncInteriorLight();
    this.sync.setArchLampScale(daylightLampFactor(this.env.skyState.elevation));
    this.applyLook();
    this.fx.setLighting(this.env.sun, this.env.hemi);
    this.rig.floorY = env.ground && this.env.skyState.showGround ? MIN_ORBIT_HEIGHT : Number.NEGATIVE_INFINITY;
    this.boundsDirty = true;
    this.needsDraw = true;
  }

  /** Set the wind of the world (grass and tree sway, wave heading and steepness) and re-tune the water shaders. */
  private applyWind(wind: { speed: number; direction: number } | undefined): void {
    const changed = wind ? setWind(wind.speed, wind.direction) : setWind(2.5, 20);
    if (changed) this.materials.retuneWater();
  }

  /** Water per frame: the clock, rings from bodies in the water, the planar reflection's height and the eye under the surface. */
  private stepWater(dt: number, animate: boolean): void {
    const surfaces = this.water.all;
    if (surfaces.length === 0) {
      if (this.env.isUnderwater) this.env.setUnderwater(null);
      reflectionOn.value = 0;
      return;
    }
    if (animate) {
      advanceWater(dt);
      this.water.update(dt);
      this.needsDraw = true;
    }
    const sky = this.env.skyState;
    if (sky !== this.waterSky) {
      this.waterSky = sky;
      setSkyColours(sky.hemiSky, sky.zenith);
    }
    const dominant = this.water.dominant;
    if (dominant) reflectionY.value = dominant.y;
    else reflectionOn.value = 0;
    const under = this.water.underwater(this.perspective);
    this.env.setUnderwater(under);
  }

  /** What the water is doing now (tier, planar mirror size and readiness, live rings, surfaces): diagnostics and benchmarks. */
  waterDebug(): { tier: string; surfaces: number; mirrorUsed: boolean; backdrop: { used: boolean; draws: number; size: [number, number] }; mirrorReady: boolean; mirrorSize: [number, number]; captureMirrorSize: [number, number] | null; rings: number; underwater: boolean } {
    const m = this.materials.mirror.mirror;
    return { tier: this.materials.waterTier ?? 'off', surfaces: this.water.all.length, mirrorUsed: this.materials.mirror.used, backdrop: { used: this.materials.backdrop.used, draws: this.materials.backdrop.draws, size: [this.materials.backdrop.target.width, this.materials.backdrop.target.height] }, mirrorReady: m.ready, mirrorSize: [m.target.width, m.target.height], captureMirrorSize: m.peak, rings: RippleField.live(), underwater: this.env.isUnderwater };
  }

  /** Start a ring on the water at world (x, z), strength 0..1 (a footstep 0.2, a splash 1). The surface answers wherever there is water. */
  emitRipple(x: number, z: number, strength = 0.6): void {
    if (RippleField.emit(x, z, strength) >= 0) this.needsDraw = true;
  }

  /** The scene without the water, drawn before the frame for the water's depth and refraction (WebGPU, standard and high tiers). */
  private renderBackdrop(waterVisible: boolean): void {
    const backdrop = this.materials.backdrop;
    if (!waterVisible || !backdrop.used || this.water.all.length === 0) return;
    backdrop.render(this.renderer, this.scene, this.perspective, this.materials.waterMaterials());
  }

  /** The planar water reflection, drawn before the frame (high tier, camera above the dominant surface). */
  private renderMirror(waterVisible: boolean): void {
    const mirror = this.materials.mirror;
    const dominant = this.water.dominant;
    if (!waterVisible || !mirror.used || !dominant || this.water.all.length === 0) {
      reflectionOn.value = 0;
      return;
    }
    const hide = this.materials.waterMaterials();
    const drawn = mirror.mirror.render(this.renderer, this.scene, this.perspective, dominant.y, hide);
    if (this.captureActive) this.captureMirrorSize = [mirror.mirror.target.width, mirror.mirror.target.height];
    reflectionOn.value = drawn ? 1 : 0;
  }

  /** Watch the moving bodies of `world` so water answers when they enter it. */
  private trackWaterBodies(world: WorldDoc): void {
    this.water.clearMovers();
    this.water.setWorld(world);
    if (this.water.all.length === 0) return;
    for (const [id, e] of Object.entries(world.entities)) {
      if (e.template || !e.visible || e.shape.kind === 'none') continue;
      const moves = e.physics?.body === 'dynamic' || e.physics?.body === 'kinematic' || e.npc !== undefined || e.character !== undefined || e.behaviors.length > 0;
      if (!moves || e.material?.preset === 'water') continue;
      const s = e.shape;
      const below = s.kind === 'primitive' ? ((s.size[1] ?? 0) * Math.abs(e.transform.scale[1] ?? 1)) / 2 : 0;
      this.water.track(id, (out) => {
        const node = this.sync.node(id);
        if (!node) return false;
        node.object.getWorldPosition(out);
        out.y -= below;
        return true;
      });
    }
    this.water.track('avatar', (out) => {
      if (!this.avatar.isPlaced || this.avatar.group.visible === false) return false;
      out.copy(this.avatar.group.position);
      return true;
    });
  }

  private waterSky: unknown = null;
  private captureMirrorSize: [number, number] | null = null;

  /**
   * Switch the low-memory budget at runtime: the pixel ratio, shadow map,
   * post pass and generator cache follow immediately (GPU targets are
   * released); MSAA and the instance budget only change with a new renderer.
   */
  setLowMemory(on: boolean): void {
    this.lowMemory = on;
    this.adaptiveTier.reset();
    this.budget = this.budgetFor(on);
    this.applyQuality(this.qualityPlan.quality);
    this.generatorCache?.setByteLimit(this.budget.generatorCacheBytes);
    this.resize(this.cssWidth, this.cssHeight);
    this.boundsDirty = true;
    this.needsDraw = true;
  }

  /**
   * `sharp` (default): the resolution stays high and stable, frames may run at 30-45 fps on a weak GPU; `smooth`: the
   * resolution falls aggressively to hold 60 fps (soft in motion).
   */
  setMotionProfile(profile: MotionProfile): void {
    if (profile === this.motionProfile || !MOTION_PROFILES[profile]) return;
    this.motionProfile = profile;
    this.motionScale = 1;
    this.adaptive.configure(MOTION_PROFILES[profile].opts);
    this.resize(this.cssWidth, this.cssHeight);
  }

  get motionProfileNow(): MotionProfile {
    return this.motionProfile;
  }

  /** Turn adaptive resolution on or off (off restores the full budget resolution at once). */
  setAdaptiveResolution(on: boolean): void {
    this.adaptiveWanted = on;
    if (on && !this.qualityPlan.adaptiveResolution) return;
    this.adaptive.enabled = on;
    if (!on && this.adaptive.scale !== 1) {
      this.adaptive.reset();
      this.resize(this.cssWidth, this.cssHeight);
    }
  }

  /** @deprecated alias of {@link setLowMemory}. */
  setLowPower(on: boolean): void {
    this.setLowMemory(on);
  }

  /** True while the low-memory budget is active. */
  get lowMemoryMode(): boolean {
    return this.lowMemory;
  }

  /** Ask for a frame on the next on-demand {@link render} (e.g. after an external camera change). */
  requestRender(): void {
    this.needsDraw = true;
  }

  /** GPU resources becoming ready do not mean the user moved the view again. */
  private requestPreparedFrame(): void {
    this.frameInvalidation.prepared();
    this.sunMapDirty = true;
  }

  /**
   * The renderer's KTX2 loader for block-compressed textures (self-tested), or null when this browser or GPU
   * cannot transcode them; callers then load the original images.
   */
  compressedTextureLoader(): Promise<KTX2Loader | null> {
    return this.compression.loader();
  }

  /**
   * Re-mount entities that show the given asset ids (user imports registered
   * after the world loaded); the environment HDRI is re-requested too.
   */
  refreshAssets(assetIds?: ReadonlySet<string>): void {
    if (this.sync.refreshAssets(assetIds) > 0) this.needsDraw = true;
    // Photographed finish maps from the library (once the catalog is in).
    if (!assetIds && getCatalog()) {
      this.materials.finishes.usePhotos(photoFinishResolver());
      // The library is in: set up the KTX2 transcoder ahead of the first model, but only after the first frame and a pause:
      // its 224 kB of WebAssembly would otherwise share a slow link with the textures the first picture is waiting for
      // (a model that asks sooner starts it itself).
      void this.waitForFrames(1, 120_000).then(() => {
        if (typeof setTimeout !== 'function') return;
        setTimeout(() => {
          if (!this.disposed && !this.lost) void this.compression.loader();
        }, KTX2_SETUP_DELAY_MS);
      });
    }
    const env = this.sync.world?.environment;
    if (env?.hdri && (!assetIds || assetIds.has(env.hdri))) this.env.hdri.reload();
  }

  /** Current locomotion gait of an animated asset entity (idle / walk / run), or null. */
  gaitOf(id: EntityId): 'idle' | 'walk' | 'run' | null {
    return this.sync.gaitOf(id);
  }

  /** Number of animated asset entities. */
  get animatedCount(): number {
    return this.sync.animatedCount;
  }

  /** Generator output of an entity (procedural colliders for physics). */
  getGeneratorOutput(id: EntityId): GeneratorOutput | undefined {
    return this.sync.getOutput(id);
  }

  /**
   * Seed the generator cache with an output computed elsewhere (e.g. in a
   * worker), so the next build of this exact shape is a cache hit instead of
   * a main-thread generation. Built-in generators only.
   */
  primeGeneratorOutput(shape: ProceduralShape, output: GeneratorOutput): void {
    if (!this.generatorCache || Object.hasOwn(this.sync.world?.generators ?? {}, shape.generator)) return;
    this.generatorCache.set(proceduralOutputKey(shape, { generators: {} }), output);
  }

  /** Apply packed physics poses (`PhysicsWorld.writeTransforms`). Zero allocations. */
  applyTransforms(packed: Float32Array, order: EntityId[]): void {
    this.sync.applyTransforms(packed, order);
    this.needsDraw = true;
  }

  /** Runtime property override (from logic). Invalid paths/values are ignored. */
  setEntityProperty(id: EntityId, path: string, value: Json): void {
    if (!this.sync.setProperty(id, path, value)) return;
    this.needsDraw = true;
    // Only geometry-affecting paths change bounds (material/light tweaks must not trigger refits).
    if (path === 'visible' || path.startsWith('transform') || path.startsWith('shape')) this.boundsDirty = true;
  }

  /** Drop runtime overrides (call on play reset). */
  clearRuntimeOverrides(): void {
    this.sync.clearOverrides();
    // View-mode overrides (sectioned walls) were dropped too: re-apply them.
    this.archView.invalidate();
    this.boundsDirty = true;
    this.needsDraw = true;
  }

  /**
   * Add a runtime-spawned entity. Validated unless `trusted` (only for entities
   * cloned from an already validated document, e.g. logic template spawns).
   */
  addTransient(entity: Entity, opts: { trusted?: boolean } = {}): void {
    let valid: Entity = entity;
    if (opts.trusted !== true) {
      const parsed = Entity.safeParse(entity);
      if (!parsed.success) {
        log.warn(`addTransient rejected: ${parsed.error.issues[0]?.message ?? 'invalid entity'}`);
        return;
      }
      valid = parsed.data;
    }
    this.needsDraw = true;
    const p = this.sync.addTransient(valid);
    if (p === false) log.warn(`addTransient: id "${valid.id}" already exists`);
    else {
      if (valid.vfx) void p.then(() => this.fx.vfx.setEmitter(valid.id, valid.vfx ?? null, this.sync.object(valid.id) ?? null), () => undefined);
      p.catch((e: unknown) => log.warn(`transient ${valid.id}: ${errorMessage(e)}`));
    }
  }

  /** Remove a runtime-spawned entity. */
  removeTransient(id: EntityId): void {
    this.fx.vfx.setEmitter(id, null, null);
    if (this.sync.removeTransient(id)) this.needsDraw = true;
  }

  /** Switch camera behavior. `target` follows an entity; without it follow/firstPerson track the player avatar. */
  setCameraMode(mode: CameraMode, target?: EntityId): void {
    let source: FollowSource | null = null;
    if (mode !== 'orbit') {
      if (target) {
        const sync = this.sync;
        source = (out) => {
          const o = sync.object(target);
          if (!o) return Number.NaN;
          o.getWorldPosition(out);
          const e = o.matrixWorld.elements;
          return Math.atan2(e[8] as number, e[10] as number);
        };
      } else {
        const avatar = this.avatar;
        source = (out) => {
          if (!avatar.isPlaced) return Number.NaN;
          out.copy(avatar.group.position);
          return avatar.yaw;
        };
      }
    }
    this.followId = mode !== 'orbit' && target ? target : null;
    // Walking eye-level in a room: a wider lens than the orbit camera's, so a room reads at its true size instead of a corridor.
    if (mode === 'firstPerson') {
      if (this.savedLensFov === null) this.savedLensFov = this.perspective.fov;
      this.perspective.fov = WALK_FOV;
      this.perspective.updateProjectionMatrix();
    } else if (this.savedLensFov !== null) {
      this.perspective.fov = this.savedLensFov;
      this.savedLensFov = null;
      this.perspective.updateProjectionMatrix();
    }
    this.avatar.setHidden(mode === 'firstPerson' && !target);
    this.rig.setMode(mode, source);
    this.needsDraw = true;
  }

  private savedLensFov: number | null = null;
  private voxelZenithHex = '';
  private readonly voxelZenith = new Color();

  /** Tell the terrain the colour of the sky overhead (reflections, water); changes only when the sky does. */
  private syncVoxelSky(vox: VoxelLayer): void {
    const hex = this.env.skyState.zenith;
    if (hex === this.voxelZenithHex) return;
    this.voxelZenithHex = hex;
    this.voxelZenith.set(hex);
    vox.setSkyZenith(this.voxelZenith);
  }

  /** Show or hide the player avatar (e.g. the voxel game's first/third-person switch). */
  setAvatarVisible(on: boolean): void {
    this.avatar.setHidden(!on);
    this.needsDraw = true;
  }

  /**
   * Place the player avatar (feet position, yaw in degrees; yaw 0 faces −Z).
   * `state` is what the controller knows (grounded, vertical speed, crouch, sprint) so the body can jump and land.
   */
  setPlayerAvatar(position: Vec3, yawDeg: number, state?: AvatarState): void {
    this.avatar.set(position[0], position[1], position[2], yawDeg, state);
    this.needsDraw = true;
  }

  /** Choose the player's look (`world.player.character`). */
  setPlayerLook(spec: Parameters<Avatar['setLook']>[0]): void {
    this.avatar.setLook(spec);
  }

  /** The animated person of an entity (NPC feed, tests), or null while it loads or when the entity has no character. */
  characterRig(id: EntityId): CharacterRig | null {
    return this.sync.characterRig(id);
  }

  /** The player's animated body, or null (not placed yet, still loading, or no character files). */
  playerRig(): CharacterRig | null {
    return this.avatar.character;
  }

  /**
   * What the ground under a world point is made of, as a footstep class: the
   * material of the entity just below, else the environment's ground. Used by
   * the studio to pick a footstep sound.
   */
  surfaceAt(x: number, y: number, z: number): SurfaceClass {
    const world = this.sync.world;
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      this.footRay.set(_footOrigin.set(x, y + 0.45, z), _down);
      this.footRay.near = 0;
      this.footRay.far = 1.4;
      _hits.length = 0;
      this.footRay.intersectObject(this.sync.root, true, _hits);
      for (const hit of _hits) {
        const id = this.sync.idOf(hit.object);
        if (id && this.sync.hasCharacter(id)) continue;
        const preset = id ? world?.entities[id]?.material?.preset : undefined;
        _hits.length = 0;
        if (preset) return surfaceOfPreset(preset);
        const finish = id ? world?.entities[id]?.material?.finish : undefined;
        if (finish) return surfaceOfFinish(finish);
        break;
      }
      _hits.length = 0;
    }
    return surfaceOfPreset(world?.environment.ground?.material.preset ?? 'grass');
  }

  /** Receive footstep events (body id, foot, speed m/s, world position); the studio plays the surface sound. */
  onFootstep(handler: ((id: string, foot: Foot, speed: number, position: Vec3) => void) | null): void {
    this.footstepHandler = handler;
  }

  /** Number of animated people in the scene (NPCs and the player). */
  get characterCount(): number {
    return this.characters.size;
  }

  /** Advance people and animated assets; true when a redraw is needed. */
  private stepAnimations(dt: number): boolean {
    this.characters.setCamera(this.perspective);
    let animated = this.sync.updateAnimations(dt, this.perspective.position);
    if (this.characters.update(dt)) animated = true;
    if (this.avatar.isPlaced && this.avatar.character) {
      this.avatar.headPosition(_avatarHead);
      this.avatar.setCameraDistance(this.perspective.position.distanceTo(_avatarHead));
    }
    return animated;
  }

  /**
   * The block-terrain layer, created (and its module loaded) on first use
   * and added to the scene. Voxel worlds only: other worlds never load it.
   */
  voxel(): Promise<VoxelLayer> {
    if (this.voxelLayer) return Promise.resolve(this.voxelLayer);
    this.voxelLoading ??= import('./voxel/voxel-layer').then(({ VoxelLayer: Layer }) => {
      if (this.disposed) throw new Error('renderer disposed');
      const layer = new Layer();
      layer.setQuality(this.qualityPlan.tier);
      layer.setCharacters(this.characters);
      // Terrain shaders compile asynchronously (no multi-hundred-ms first frame).
      layer.setCompiler((object) => (this.disposed ? Promise.resolve() : this.renderer.compileAsync(object, this.perspective, this.scene)));
      this.scene.add(layer.group);
      this.voxelLayer = layer;
      this.needsDraw = true;
      return layer;
    });
    const loading = this.voxelLoading;
    loading.catch(() => {
      if (this.voxelLoading === loading) this.voxelLoading = null;
    });
    return loading;
  }

  /** Largest block-terrain view distance this device's budget allows (chunks; lower in low-memory mode). */
  get voxelViewDistanceCap(): number {
    return this.budget.voxelViewDistance;
  }

  /** The voxel layer if it exists (no loading). */
  get voxelIfLoaded(): VoxelLayer | null {
    return this.voxelLayer;
  }

  /** Remove the voxel layer and free its GPU resources (world without terrain). */
  releaseVoxel(): void {
    this.voxelLoading = null;
    this.voxelLayer?.dispose();
    this.voxelLayer = null;
    this.env.setFogDistance(null);
    this.needsDraw = true;
  }

  /** Fog that fades everything out at `metres` (voxel view distance); null restores the environment's fog. */
  setFogDistance(metres: number | null): void {
    this.env.setFogDistance(metres);
    this.needsDraw = true;
  }

  /**
   * Apply an environment that is not the document's (e.g. the voxel game's
   * day/night clock). The document environment comes back on the next
   * {@link setWorld} that changes it, or with {@link restoreEnvironment}.
   */
  setEnvironmentOverride(env: Environment): void {
    if (this.disposed) return;
    this.env.apply(env, this.scene);
    this.lightVolume.invalidate();
    this.lightmap.invalidate('light');
    this.syncInteriorLight();
    this.sync.setArchLampScale(daylightLampFactor(this.env.skyState.elevation));
    this.applyLook();
    this.needsDraw = true;
  }

  /** Re-apply the current document's environment (after {@link setEnvironmentOverride}). */
  restoreEnvironment(): void {
    const w = this.sync.world;
    if (w) this.applyEnvironment(w);
  }

  /** First-person eye height above the feet in metres (1.6 standing, about 0.7 sitting); clamped 0.3..2.2. */
  setEyeHeight(h: number): void {
    if (Number.isFinite(h)) this.rig.eyeHeight = Math.min(2.2, Math.max(0.3, h));
  }

  /** First-person look pitch in radians (negative looks down); the rig clamps it. Ignored in other camera modes. */
  setLookPitch(pitch: number): void {
    if (Number.isFinite(pitch)) this.rig.pitch = pitch;
  }

  /**
   * Pose the camera directly (`manual` camera mode, switched on by this
   * call): eye position, yaw (radians, 0 looks along −Z) and pitch.
   */
  setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void {
    if (this.rig.mode !== 'manual') this.setCameraMode('manual');
    this.rig.setPose(x, y, z, yaw, pitch);
  }

  /**
   * Frame a sphere. With `direction` (camera offset from the center; only
   * its direction matters) the view angle is fixed, otherwise the current
   * viewing direction is kept. `duration` 0 jumps; > 0 flies.
   */
  frameSphere(center: Vec3, radius: number, direction?: Vec3, duration = 0): void {
    if (this.disposed || !center.every(Number.isFinite)) return;
    _center.set(center[0], center[1], center[2]);
    if (direction && direction.every(Number.isFinite) && (direction[0] !== 0 || direction[1] !== 0 || direction[2] !== 0)) {
      this.perspective.position.set(center[0] + direction[0], center[1] + direction[1], center[2] + direction[2]);
    }
    this.rig.focusOn(_center, Math.min(200, Math.max(0.5, radius)), duration);
    this.needsDraw = true;
  }

  /**
   * Look at the framed content (or the current orbit target) from a fixed
   * direction — camera presets such as top, front or a three-quarter view.
   * `direction` points from the target to the camera; only its direction
   * matters. Unlike {@link frameSphere} the elevation is not clamped, so a
   * straight-down top view is possible.
   */
  viewFrom(direction: Vec3, duration = FRAME_DURATION): void {
    if (this.disposed || !direction.every(Number.isFinite)) return;
    const len = Math.hypot(direction[0], direction[1], direction[2]);
    if (len < 1e-6) return;
    const f = this.framing;
    if (f) _target.set(f.center[0], f.center[1], f.center[2]);
    else this.rig.getTarget(_target);
    const radius = f ? f.radius : 10;
    const cam = this.perspective;
    const vHalf = (cam.fov * Math.PI) / 360;
    const half = Math.min(vHalf, Math.atan(Math.tan(vHalf) * (cam.aspect > 0 ? cam.aspect : 1)));
    const dist = Math.min(2000, (radius / Math.sin(half)) * 1.05);
    _pos.set(direction[0] / len, direction[1] / len, direction[2] / len).multiplyScalar(dist).add(_target);
    this.rig.flyTo(_pos, _target, duration);
    this.needsDraw = true;
  }

  /** The point the editor camera orbits around (written into `out`). */
  orbitTarget(out: Vec3 = [0, 0, 0]): Vec3 {
    this.rig.getTarget(_target);
    out[0] = _target.x;
    out[1] = _target.y;
    out[2] = _target.z;
    return out;
  }

  /** Prepare sight-test acceleration before asynchronous hosts frame newly arrived content. */
  async prepareFraming(): Promise<void> {
    // The first world was framed (and its trees warmed) while it synced: a second wait would only repeat that one.
    if (!this.disposed) await warmRaycastTrees(this.sync.root, this.framed ? 0 : FIRST_FRAME_BVH_MS);
  }

  /**
   * Frame the meaningful content of the world (see `collectFramingItems`)
   * from an elevated three-quarter view that fits the viewport, never below
   * the ground. Returns false when there is nothing to frame.
   */
  frameContent(opts: FrameContentOptions = {}): boolean {
    if (this.disposed) return false;
    const items = this.grow.withFullScale(() => collectFramingItems(this.sync, new Set(opts.focus ?? [])));
    for (const p of opts.focusPoints ?? []) {
      if (p.every(Number.isFinite)) items.push({ min: [p[0] - 1.5, p[1], p[2] - 1.5], max: [p[0] + 1.5, p[1] + 2, p[2] + 1.5], focus: true });
    }
    const framing = contentFraming(items);
    if (!framing) return false;
    const groundY = this.env.groundMesh ? 0 : null;
    const cam = this.perspective;
    // Buildings read best from higher up and closer (their bounding sphere is loose around a flat box).
    const arch = this.archView.active ? ARCH_FRAMING : null;
    const front = arch ? this.archFrontAzimuth() : null;
    const base: FramingPoseOptions = { fovDeg: cam.fov, aspect: cam.aspect, groundY, ...(arch ?? {}) };
    // Of a few nearby directions and heights, the one with the clearest line of sight to the content: a tree
    // trunk or crown in the foreground (generated woods) makes a poor first picture. A building is seen from its
    // garden side, swung aside for a three-quarter view.
    const elevation = arch ? { elevationDeg: arch.elevationDeg } : {};
    const candidates = front !== null ? viewCandidates(front - 28, { swings: [0, 28, -28, 55, -55, 80, -80], ...elevation }) : viewCandidates(DEFAULT_FRAMING_AZIMUTH, elevation);
    const view = this.grow.withFullScale(() => {
      this.sync.root.updateMatrixWorld(true);
      return pickClearView(framing, base, candidates, sceneSightTest(this.sync, this.framingSubjects(opts.focus ?? [])));
    });
    const pose = view?.pose ?? framingPose(framing, base);
    const azimuthDeg = view?.candidate.azimuthDeg ?? DEFAULT_FRAMING_AZIMUTH;
    _pos.set(pose.position[0], pose.position[1], pose.position[2]);
    _target.set(pose.target[0], pose.target[1], pose.target[2]);
    const duration = opts.duration ?? FRAME_DURATION;
    if (opts.flyIn) {
      const wide = framingPose(framing, { fovDeg: cam.fov, aspect: cam.aspect, groundY, margin: 1.7, elevationDeg: 46, azimuthDeg });
      _center.set(wide.position[0], wide.position[1], wide.position[2]);
      this.rig.flyTo(_center, _target, 0);
      this.rig.flyTo(_pos, _target, Math.max(duration, FLY_IN_DURATION));
    } else {
      this.rig.flyTo(_pos, _target, duration);
    }
    this.needsDraw = true;
    return true;
  }

  /** Objects a framing shot is of (buildings and focused entities): they never hide themselves from its camera. */
  private framingSubjects(focus: readonly EntityId[]): Set<Object3D> {
    const out = new Set<Object3D>();
    this.sync.forEachNode((node) => {
      if (!node.entity.template && (node.entity.arch?.role === 'building' || node.entity.tags.includes(FOCUS_TAG))) out.add(node.object);
    });
    for (const id of focus.slice(0, 256)) {
      const o = this.sync.object(id);
      if (o) out.add(o);
    }
    return out;
  }

  /**
   * Azimuth that shows the garden side of the first building: toward its terrace (pool, deck), else toward its
   * entrance, three-quarter. Null when it has neither or the world is not built yet.
   */
  private archFrontAzimuth(): number | null {
    const house = new Box3();
    const terrace = new Box3();
    const door = new Box3();
    const piece = new Box3();
    this.grow.withFullScale(() => {
      this.sync.forEachNode((node) => {
        const arch = node.entity.arch;
        if (!arch || node.entity.template) return;
        const target = arch.role === 'wall' ? house : arch.role === 'site' && arch.kind === 'terrace' ? terrace : node.entity.tags.includes('entrance') && arch.role === 'opening' ? door : null;
        if (!target) return;
        piece.setFromObject(node.object);
        if (!piece.isEmpty()) target.union(piece);
      });
    });
    if (house.isEmpty()) return null;
    const c = house.getCenter(new Vector3());
    for (const side of [terrace, door]) {
      if (side.isEmpty()) continue;
      const s = side.getCenter(new Vector3());
      const az = frontAzimuthDeg(s.x - c.x, s.z - c.z);
      if (az !== null) return az;
    }
    return null;
  }

  /**
   * Make sure `ids` are visible: when any of them is outside the view (or too
   * small to read), re-frame the content with them as focus. Returns true when
   * the camera moves.
   */
  reveal(ids: readonly EntityId[], duration = FRAME_DURATION, minShare = MIN_VISIBLE_SHARE): boolean {
    if (this.disposed || ids.length === 0) return false;
    _bounds.makeEmpty();
    this.grow.withFullScale(() => {
      for (const id of ids.slice(0, 256)) {
        this.sync.entityBounds(id, _one);
        if (!_one.isEmpty()) _bounds.union(_one);
      }
    });
    if (_bounds.isEmpty()) return false;
    const cam = this.perspective;
    cam.updateMatrixWorld();
    _viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_viewProj);
    let inside = true;
    for (let i = 0; i < 8 && inside; i++) {
      _corner.set(i & 1 ? _bounds.max.x : _bounds.min.x, i & 2 ? _bounds.max.y : _bounds.min.y, i & 4 ? _bounds.max.z : _bounds.min.z);
      inside = _frustum.containsPoint(_corner);
    }
    if (inside) {
      _bounds.getCenter(_center);
      const radius = _bounds.getSize(_corner).length() / 2;
      const distance = Math.max(0.01, cam.position.distanceTo(_center));
      const share = radius / (distance * Math.tan((cam.fov * Math.PI) / 360));
      if (share >= minShare) return false;
    }
    return this.frameContent({ focus: ids, duration });
  }

  /** Smoothly fly the camera to an entity. */
  focus(id: EntityId): void {
    this.needsDraw = true;
    this.grow.withFullScale(() => this.sync.entityBounds(id, _bounds));
    if (_bounds.isEmpty()) {
      const o = this.sync.object(id);
      if (!o) return;
      o.getWorldPosition(_center);
      this.rig.focusOn(_center, 1);
      return;
    }
    _bounds.getCenter(_center);
    const r = Math.max(_bounds.max.x - _bounds.min.x, _bounds.max.y - _bounds.min.y, _bounds.max.z - _bounds.min.z) / 2;
    this.rig.focusOn(_center, r);
  }

  /**
   * Show the move / rotate / scale gizmo on one or more entities (empty ids
   * or a null mode hide it). `onCommit` receives every moved entity's new
   * local transform after each drag (one undoable edit); `onLive` is told
   * which entities moved during a drag. The gizmo follows the rendered
   * objects; call again after entities are rebuilt.
   */
  async setGizmo(ids: readonly EntityId[] | null, mode: GizmoMode | null, onCommit?: (commit: GizmoCommit) => void, opts: GizmoOptions = {}, onLive?: (ids: readonly EntityId[]) => void): Promise<void> {
    if (this.disposed) return;
    this.componentHandle?.removeFromParent();
    this.componentHandle = null;
    const targets: GizmoTarget[] = [];
    for (const id of ids ?? []) {
      const object = this.sync.object(id);
      if (object && !this.sync.node(id)?.transient) targets.push({ id, object });
    }
    if (targets.length === 0 || !mode || !onCommit) {
      this.gizmo?.detach();
      return;
    }
    this.gizmo ??= new SelectionGizmo(
      () => createSelectionControls(this.perspective, this.domElement),
      (o) => this.scene.add(o),
      this.orbit,
      () => this.requestRender(),
      (exclude) => this.snapUnderPointer(exclude),
    );
    await this.gizmo.attach(targets, mode, opts, onCommit, onLive);
  }

  /** Change gizmo options live (e.g. a held modifier toggles snapping during a drag). */
  setGizmoOptions(opts: GizmoOptions): void {
    this.gizmo?.setOptions(opts);
  }

  /** True while a gizmo handle is hovered or dragged (clicks then must not change the selection). */
  get gizmoBusy(): boolean {
    return this.gizmo?.busy ?? false;
  }

  /** True while a gizmo handle is being dragged. */
  get gizmoDragging(): boolean {
    return this.gizmo?.dragging ?? false;
  }

  /** Surface / vertex under the pointer, ignoring `exclude` (gizmo snapping). Reuses scratch objects. */
  private snapUnderPointer(exclude: readonly Object3D[]): SnapHit | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.perspective);
    _snapHits.length = 0;
    this.raycaster.intersectObject(this.sync.root, true, _snapHits);
    let result: SnapHit | null = null;
    for (const hit of _snapHits) {
      if (!hit.object.visible || exclude.some((o) => isDescendant(hit.object, o))) continue;
      _snapPoint.copy(hit.point);
      let vertex: Vector3 | null = null;
      const pos = (hit.object as Partial<Mesh>).geometry?.getAttribute('position');
      if (hit.face && pos) {
        let best = Number.POSITIVE_INFINITY;
        for (const vi of [hit.face.a, hit.face.b, hit.face.c]) {
          _snapTmp.fromBufferAttribute(pos, vi).applyMatrix4(hit.object.matrixWorld);
          const d = _snapTmp.distanceToSquared(hit.point);
          if (d < best) {
            best = d;
            _snapVertex.copy(_snapTmp);
            vertex = _snapVertex;
          }
        }
      }
      result = { point: _snapPoint, vertex };
      break;
    }
    _snapHits.length = 0;
    return result;
  }

  /**
   * Raycast document entities at normalized device coordinates. `only`
   * restricts the test to one entity (brushes), `exclude` skips entities.
   * Scatter instances are not hit. Returns world and local hit data.
   */
  raycastEntity(ndcX: number, ndcY: number, opts: { only?: EntityId; exclude?: ReadonlySet<EntityId> } = {}): EntityHit | null {
    if (this.disposed || !Number.isFinite(ndcX) || !Number.isFinite(ndcY)) return null;
    this.raycaster.setFromCamera(_ndc.set(ndcX, ndcY), this.perspective);
    _hits.length = 0;
    const root = opts.only ? this.sync.object(opts.only) : this.sync.root;
    if (!root) return null;
    this.raycaster.intersectObject(root, true, _hits);
    let out: EntityHit | null = null;
    for (const hit of _hits) {
      if (!hit.object.visible || (hit.object as Partial<Mesh>).isMesh !== true) continue;
      const id = this.sync.idOf(hit.object);
      if (!id || (opts.only && id !== opts.only) || opts.exclude?.has(id)) continue;
      const entityObject = this.sync.object(id);
      if (!entityObject) continue;
      entityObject.updateWorldMatrix(true, false);
      _inv4.copy(entityObject.matrixWorld).invert();
      const local = _pos.copy(hit.point).applyMatrix4(_inv4);
      const localPoint: Vec3 = [local.x, local.y, local.z];
      let localNormal: Vec3 = [0, 1, 0];
      let normal: Vec3 = [0, 1, 0];
      if (hit.face) {
        // Face normal: object space → entity space (through the mesh's own matrix) and world.
        const n = _target.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        normal = [n.x, n.y, n.z];
        const ln = n.transformDirection(_inv4);
        localNormal = [ln.x, ln.y, ln.z];
      }
      const tris = hit.object.userData[MESH_TRIANGLES_KEY] as Uint32Array | undefined;
      const triangle = tris && typeof hit.faceIndex === 'number' && hit.faceIndex < tris.length ? (tris[hit.faceIndex] as number) : null;
      out = { id, point: [hit.point.x, hit.point.y, hit.point.z], normal, localPoint, localNormal, triangle, distance: hit.distance };
      break;
    }
    _hits.length = 0;
    return out;
  }

  /** World-space ray through normalized device coordinates (origin = camera position). */
  cursorRay(ndcX: number, ndcY: number): { origin: Vec3; direction: Vec3 } {
    this.raycaster.setFromCamera(_ndc.set(Number.isFinite(ndcX) ? ndcX : 0, Number.isFinite(ndcY) ? ndcY : 0), this.perspective);
    const { origin: o, direction: d } = this.raycaster.ray;
    return { origin: [o.x, o.y, o.z], direction: [d.x, d.y, d.z] };
  }

  /**
   * First visible document surface along a world-space ray (scatter
   * instances and `exclude` entities are skipped): the scatter brush uses it
   * to drop instances onto whatever is below. Returns the point, unit normal
   * and entity id, or null.
   */
  raycastWorld(origin: Vec3, direction: Vec3, maxDistance = 1e4, exclude?: ReadonlySet<EntityId>, only?: EntityId): { id: EntityId; point: Vec3; normal: Vec3 } | null {
    if (this.disposed || !origin.every(Number.isFinite) || !direction.every(Number.isFinite)) return null;
    _occDir.set(direction[0], direction[1], direction[2]);
    if (_occDir.lengthSq() < 1e-12) return null;
    _occDir.normalize();
    const ray = this.occlusionRay;
    ray.set(_pos.set(origin[0], origin[1], origin[2]), _occDir);
    ray.near = 0;
    ray.far = Math.max(0, maxDistance);
    _occHits.length = 0;
    const root = only ? this.sync.object(only) : this.sync.root;
    if (!root) return null;
    ray.intersectObject(root, true, _occHits);
    let out: { id: EntityId; point: Vec3; normal: Vec3 } | null = null;
    for (const hit of _occHits) {
      if (!isOpaqueVisible(hit.object) || hit.object.name === 'edit:components') continue;
      const id = this.sync.idOf(hit.object);
      if (!id || exclude?.has(id)) continue;
      const n = hit.face ? _target.copy(hit.face.normal).transformDirection(hit.object.matrixWorld) : _target.set(0, 1, 0);
      out = { id, point: [hit.point.x, hit.point.y, hit.point.z], normal: [n.x, n.y, n.z] };
      break;
    }
    _occHits.length = 0;
    return out;
  }

  /**
   * Entities whose on-screen bounds touch the rectangle (normalized device
   * coordinates, any corner order): marquee selection. Transient spawns,
   * templates and `skip` ids are excluded; at most 2000 ids.
   */
  entitiesInRect(x0: number, y0: number, x1: number, y1: number, skip?: (id: EntityId) => boolean): EntityId[] {
    if (this.disposed) return [];
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const cam = this.perspective;
    cam.updateMatrixWorld();
    const out: EntityId[] = [];
    this.grow.withFullScale(() => {
      this.sync.forEachNode((node) => {
        if (out.length >= 2000 || node.transient || !node.object.visible || node.content.children.length === 0 || (skip && skip(node.id))) return;
        _one.setFromObject(node.content);
        if (_one.isEmpty()) return;
        let sx0 = Infinity;
        let sy0 = Infinity;
        let sx1 = -Infinity;
        let sy1 = -Infinity;
        let behind = 0;
        for (let i = 0; i < 8; i++) {
          _rectCorner.set(i & 1 ? _one.max.x : _one.min.x, i & 2 ? _one.max.y : _one.min.y, i & 4 ? _one.max.z : _one.min.z).project(cam);
          if (_rectCorner.z > 1) behind++;
          sx0 = Math.min(sx0, _rectCorner.x);
          sy0 = Math.min(sy0, _rectCorner.y);
          sx1 = Math.max(sx1, _rectCorner.x);
          sy1 = Math.max(sy1, _rectCorner.y);
        }
        if (behind === 8) return;
        if (rectsOverlap(sx0, sy0, sx1, sy1, minX, minY, maxX, maxY)) out.push(node.id);
      });
    });
    return out;
  }

  /**
   * Rebuild one entity's content from the current document (drops a live
   * preview that was not committed, e.g. a cancelled stroke).
   */
  rebuildEntity(id: EntityId): void {
    if (this.sync.refresh(id)) this.needsDraw = true;
  }

  /** Mounted geometry of a mesh entity (editor), or null. */
  meshBundle(id: EntityId): MeshGeometryBundle | null {
    return this.sync.meshBundle(id);
  }

  /** Live (uncommitted) preview of a mesh entity's positions and/or colours; see `SceneSync.previewMesh`. */
  previewMesh(id: EntityId, positions: Float32Array | null, colors: Float32Array | null): boolean {
    const ok = this.sync.previewMesh(id, positions, colors);
    if (ok) {
      if (positions) this.editOverlay.refreshMarkers();
      this.needsDraw = true;
      this.boundsDirty = true;
    }
    return ok;
  }

  /**
   * Show the components of a mesh entity for editing (null hides them).
   * `edges` are vertex pairs; the selections index the mounted mesh.
   */
  showMeshComponents(view: { id: EntityId; mode: ComponentMode; edges: Uint32Array; selectedVertices: ArrayLike<number>; selectedEdges: ArrayLike<number>; selectedFaces: ArrayLike<number>; markerVertices?: ArrayLike<number> } | null): boolean {
    this.needsDraw = true;
    if (!view) {
      this.editOverlay.setComponents(null);
      return true;
    }
    const target = this.sync.object(view.id);
    const bundle = this.sync.meshBundle(view.id);
    if (!target || !bundle) {
      this.editOverlay.setComponents(null);
      return false;
    }
    this.editOverlay.setComponents({ target, bundle, mode: view.mode, edges: view.edges, selectedVertices: view.selectedVertices, selectedEdges: view.selectedEdges, selectedFaces: view.selectedFaces, ...(view.markerVertices ? { markerVertices: view.markerVertices } : {}) });
    return true;
  }

  /** Brush ring for sculpting / painting (world space); null hides it. */
  showBrush(brush: { point: Vec3; normal: Vec3; radius: number; erase?: boolean } | null): void {
    this.editOverlay.setBrush(brush);
    this.needsDraw = true;
  }

  /** Joint of an entity (anchor, axis, link to target) in world space; null hides it. */
  showJoint(id: EntityId | null): void {
    this.needsDraw = true;
    const node = id ? this.sync.node(id) : undefined;
    const joint = node?.entity.joint;
    if (!node || !joint) {
      this.editOverlay.setJoint(null);
      return;
    }
    node.object.updateWorldMatrix(true, false);
    const anchor = _pos.set(joint.anchor[0], joint.anchor[1], joint.anchor[2]).applyMatrix4(node.object.matrixWorld);
    const a: Vec3 = [anchor.x, anchor.y, anchor.z];
    const ax = _target.set(joint.axis[0], joint.axis[1], joint.axis[2]).transformDirection(node.object.matrixWorld);
    const axis: Vec3 = [ax.x, ax.y, ax.z];
    let target: Vec3 | null = null;
    if (joint.target === 'world') target = [joint.targetAnchor[0], joint.targetAnchor[1], joint.targetAnchor[2]];
    else {
      const t = this.sync.object(joint.target);
      if (t) {
        t.updateWorldMatrix(true, false);
        const p = _center.set(joint.targetAnchor[0], joint.targetAnchor[1], joint.targetAnchor[2]).applyMatrix4(t.matrixWorld);
        target = [p.x, p.y, p.z];
      }
    }
    this.editOverlay.setJoint({ anchor: a, axis, target, type: joint.type });
  }

  /** World-space bounds of an entity at full scale (null when it has no content yet). */
  entityBounds(id: EntityId): { min: Vec3; max: Vec3 } | null {
    if (this.disposed) return null;
    this.grow.withFullScale(() => this.sync.entityBounds(id, _bounds));
    if (_bounds.isEmpty()) return null;
    return { min: _bounds.min.toArray() as Vec3, max: _bounds.max.toArray() as Vec3 };
  }

  /**
   * Free distance from `from` toward `to` before a visible, opaque document
   * mesh, written to `out[0]` (Infinity when clear). Scatter instances are not raycast one by
   * one; tall ones (a scattered forest) block through their coarse
   * occluder boxes (`SceneSync.scatterOcclusion`), so the chase camera
   * pulls in instead of entering a crown. See-through materials never block
   * the view. Reuses one hit list; three allocates hit records only when
   * something is hit.
   */
  private freeDistance(from: Vector3, to: Vector3, out: Float64Array): void {
    out[0] = Number.POSITIVE_INFINITY;
    _occDir.subVectors(to, from);
    const length = _occDir.length();
    if (!(length > 1e-4)) return;
    _occDir.multiplyScalar(1 / length);
    const ray = this.occlusionRay;
    ray.set(from, _occDir);
    ray.near = OCCLUSION_NEAR;
    ray.far = length;
    _occHits.length = 0;
    ray.intersectObject(this.sync.root, true, _occHits);
    let free = Number.POSITIVE_INFINITY;
    const followed = this.followId ? this.sync.object(this.followId) : undefined;
    for (const hit of _occHits) {
      if (!isOpaqueVisible(hit.object) || (followed && isDescendant(hit.object, followed))) continue;
      free = hit.distance;
      break;
    }
    _occHits.length = 0;
    out[0] = free;
    this.sync.scatterOcclusionInto(from, to, _occT);
    const d = _occT[0]! * length;
    if (d >= OCCLUSION_NEAR && d < out[0]!) out[0] = d;
  }

  /**
   * Entity under normalized device coordinates (−1..1), or null. `skip`
   * makes entities transparent to picking (e.g. locked ones): the next hit
   * behind them is returned.
   */
  pick(ndcX: number, ndcY: number, skip?: (id: EntityId) => boolean): EntityId | null {
    if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) return null;
    this.raycaster.setFromCamera(_ndc.set(ndcX, ndcY), this.perspective);
    _hits.length = 0;
    this.raycaster.intersectObject(this.sync.root, true, _hits);
    let id: EntityId | null = null;
    for (const hit of _hits) {
      if (!hit.object.visible || hit.object.name === 'edit:components') continue;
      const hitId = this.sync.idOf(hit.object);
      if (hitId && !(skip && skip(hitId))) {
        id = hitId;
        break;
      }
    }
    _hits.length = 0;
    // Scatter instances are not raycast individually (O(instances × triangles));
    // when no solid mesh was hit, a scatter layer is picked by its bounds.
    if (id) return id;
    const scatter = this.sync.pickScatter(this.raycaster.ray)?.id ?? null;
    return scatter && !(skip && skip(scatter)) ? scatter : null;
  }

  /**
   * Whether a left-button drag (one-finger drag on touch) navigates the
   * camera. Tools that draw with the left button (marquee, brushes) turn it
   * off; right-drag pans and the wheel zooms either way.
   */
  setLeftDragNavigation(on: boolean): void {
    const c = this.orbit;
    if (!c?.mouseButtons) return;
    // three's MOUSE.ROTATE = 0, TOUCH.ROTATE = 0.
    c.mouseButtons.LEFT = on ? 0 : null;
    if (c.touches) c.touches.ONE = on ? 0 : null;
  }

  /**
   * Gizmo on a selection of mesh components: an invisible handle at
   * `localCenter` (entity space) is dragged; `onLive` / `onCommit` receive
   * the handle's transform change as a column-major 4×4 matrix in the
   * entity's local space (apply it to the component vertices).
   */
  async setComponentGizmo(id: EntityId | null, localCenter: Vec3, mode: GizmoMode | null, opts: GizmoOptions, onLive?: (matrix: Float32Array) => void, onCommit?: (matrix: Float32Array) => void): Promise<void> {
    if (this.disposed) return;
    this.componentHandle?.removeFromParent();
    this.componentHandle = null;
    const owner = id ? this.sync.object(id) : undefined;
    if (!owner || !mode || !onCommit) {
      this.gizmo?.detach();
      return;
    }
    const handle = new Group();
    handle.name = 'edit:component-handle';
    handle.position.set(localCenter[0], localCenter[1], localCenter[2]);
    handle.updateMatrix();
    owner.add(handle);
    handle.updateMatrixWorld(true);
    this.componentHandle = handle;
    const start = handle.matrix.clone();
    const startInv = start.clone().invert();
    const out = new Float32Array(16);
    const delta = new Matrix4();
    const read = (): Float32Array => {
      handle.updateMatrix();
      delta.multiplyMatrices(handle.matrix, startInv);
      out.set(delta.elements);
      return out;
    };
    this.gizmo ??= new SelectionGizmo(
      () => createSelectionControls(this.perspective, this.domElement),
      (o) => this.scene.add(o),
      this.orbit,
      () => this.requestRender(),
      (exclude) => this.snapUnderPointer(exclude),
    );
    await this.gizmo.attach(
      [{ id: id as EntityId, object: handle }],
      mode,
      { ...opts, pivot: 'origin', surfaceSnap: false, vertexSnap: false },
      () => {
        const m = read();
        // The next drag starts from the moved handle.
        start.copy(handle.matrix);
        startInv.copy(start).invert();
        onCommit(m);
      },
      () => onLive?.(read()),
    );
  }

  /** Selection outline for `ids` (empty clears). */
  highlight(ids: EntityId[]): void {
    this.highlighter.set(Array.isArray(ids) ? ids : [], (id) => this.sync.object(id));
    this.needsDraw = true;
  }

  /** Translucent preview of a proposed world (only what differs from the current one). Null hides it. */
  showGhost(world: WorldDoc | null): void {
    this.needsDraw = true;
    if (!world) {
      this.ghost.clear();
      return;
    }
    this.ghost.setWorld(ghostWorld(this.sync.world, world)).catch((e: unknown) => log.warn(`ghost preview failed: ${errorMessage(e)}`));
  }

  /** Collider wireframes, bounds and diagnostic markers. */
  showDebug(opts: { colliders?: boolean; bounds?: boolean; diagnostics?: RenderDiagnostic[] }): void {
    this.grow.withFullScale(() => this.debug.show(opts ?? {}, this.sync));
    this.debugDirty = false;
    this.needsDraw = true;
  }

  /**
   * Render one frame. Call every animation frame with the elapsed seconds.
   *
   * With `onDemand` (edit mode), the GPU frame is skipped when nothing visible
   * changed: no camera motion or flight, no content/override/selection change,
   * no animated weather. `animate: false` (an idle editor) freezes the
   * self-animating environment so it no longer forces frames. Returns true
   * when a frame was drawn.
   */
  render(dt: number, opts: { onDemand?: boolean; animate?: boolean } = {}): boolean {
    if (this.disposed || this.lost || this.captureActive || this.tracing) return false;
    const t0 = now();
    if (this.watchdogOn) this.watch(false);
    this.cullFarAnimals();
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    const cameraMoved = this.rig.update(step);
    // The view or the content was asked to change from outside (camera, edits, resizes), as against content that merely animates.
    const motion = cameraMoved || this.frameInvalidation.motion;
    // Hit-stop slows the game's own motion (people, particles) to a crawl; the camera and the world around keep time.
    // An idle editor (`animate: false`) freezes the effects like the weather, so it stops drawing.
    const gameStep = step * this.fx.frame(opts.animate !== false ? step : 0, this.perspective, this.avatar.group);
    this.adaptEye(step);
    // A field or virtual mesh was just mounted / moved: draw (draw() re-plans the view).
    // The re-plan is throttled, so the view stays dirty while the camera moves: that asks for a frame, not for a new sun map
    // (re-plans that change what is drawn mark the map for a soft refresh themselves).
    if (this.sync.viewNeedsUpdate) this.frameInvalidation.prepared();
    const vox = this.voxelLayer;
    if (vox) {
      const tf = this.env.terrainFog;
      vox.setFog(tf.color, tf.near, tf.far, tf.density);
      this.syncVoxelSky(vox);
      vox.flushPrebuild();
    }
    if (vox && vox.version !== this.voxelVersion) {
      this.voxelVersion = vox.version;
      this.needsDraw = true;
    }
    const growing = this.grow.active && this.grow.update(step);
    if (growing) this.needsDraw = true;
    if (this.blueprint.active && this.blueprint.update(step)) this.needsDraw = true;
    if (this.proof.active && !this.cameraFlying && this.proof.update(step)) this.needsDraw = true;
    if (this.ghostRun.active && this.ghostRun.update(step)) this.needsDraw = true;
    // Characters and animals animate while the world runs or the user works (not in an idle editor).
    if (opts.animate !== false && this.stepAnimations(gameStep)) {
      this.frameInvalidation.animate();
      this.sunMapSoft = true;
    }
    if (opts.animate !== false && this.fx.animating) {
      this.frameInvalidation.animate();
      this.sunMapSoft = true;
    }
    this.stepWater(step, opts.animate !== false);
    // Grow-in rescales content groups: re-apply the architectural view once it settles,
    // and merge building geometry only once nothing animates any more.
    if (this.wasGrowing && !this.grow.active) this.archView.invalidate();
    this.sync.setMergesSuspended(this.grow.active);
    this.wasGrowing = this.grow.active;
    if (this.archView.update(this.perspective, step)) {
      this.needsDraw = true;
      this.boundsDirty = true;
    }
    // Footprints lie on the floors as built: the exploded, solo and x-ray views move or hide the floors.
    const av = this.archView.value;
    const showContact = this.contact.mesh.count > 0 && av.levels === 'stacked' && !av.xray;
    if (this.contact.mesh.visible !== showContact) {
      this.contact.mesh.visible = showContact;
      this.needsDraw = true;
    }
    const sectionY = this.archView.sectionY;
    if (this.clipGroup) {
      const on = sectionY !== null;
      if (this.clipGroup.enabled !== on) {
        this.clipGroup.enabled = on;
        this.needsDraw = true;
      }
      if (on && this.sectionPlane.constant !== sectionY) {
        this.sectionPlane.constant = sectionY;
        this.needsDraw = true;
      }
    }
    const animate = opts.animate !== false;
    this.env.update(animate ? step : 0, this.perspective);
    this.sinceRefit += step;
    if (this.sinceRefit >= REFIT_INTERVAL && (this.boundsDirty || this.debugDirty)) this.refresh();
    // Studio stills keep refining (temporal AA / AO converge) for a while after the view rests.
    // Programs still linking or objects still preparing: show what is ready every so often (bounded wait).
    this.progressive = (this.programs.pending > 0 || this.preparation.pending > 0) && this.progressiveDue();
    const changed = cameraMoved || this.needsDraw || this.progressive || (animate && this.env.animating);
    if (changed) this.refinement.restart();
    this.syncRest(motion, !motion && (this.frameInvalidation.motion || this.frameInvalidation.animating || (animate && this.env.animating)));
    const refine = !changed && this.refinement.next();
    // First-use graph/binding setup and program links finish before another viewport draw, up to a bound: a heavy
    // world whose programs take many seconds to link must still show what is ready, then fill in.
    if (this.programs.pending > 0 || this.preparation.pending > 0) {
      if (!this.progressive) {
        this.drewLastFrame = false;
        return false;
      }
    } else this.busySince = 0;
    if (this.warming) {
      if (now() - this.warmingSince < WARMING_MAX_MS) {
        this.drewLastFrame = false;
        return false;
      }
      this.warming = false;
    }
    // A still view inside a building: one more frame now and then so the picture can be read back for the room's exposure trim.
    const trimDue = opts.onDemand === true && !changed && !refine && this.trimIdleDue();
    if (opts.onDemand === true && !changed && !refine && !trimDue) {
      // A reduced motion frame must not become the permanent idle editor image.
      if (this.adaptive.scale < 1) {
        this.adaptive.reset();
        this.resize(this.cssWidth, this.cssHeight);
        this.needsDraw = true;
      }
      this.drewLastFrame = false;
      return false;
    }
    this.prepareBatches();
    if (this.sync.batchPreparationPending > 0) {
      this.drewLastFrame = false;
      return false;
    }
    this.needsDraw = false;
    this.highlighter.update();
    if (this.materials.surfaces.active) this.materials.surfaces.advance(step);
    this.fx.beforeDraw(this.perspective);
    this.presentation.beginFrame();
    this.gpuCost.begin(this.domElement.width, this.domElement.height, this.post, this.adaptive.scale);
    let timedFrameComplete = false;
    try {
      this.draw();
      timedFrameComplete = this.programs.pending === 0 && this.preparation.pending === 0;
    } finally {
      this.gpuCost.end(timedFrameComplete);
      this.fx.afterDraw(this.perspective);
    }
    // A discovery frame may submit new async programs. It is not a completed
    // image and must not feed the quality governor or the blank-frame watchdog.
    if (this.presentation.skipped || (!this.progressive && (this.programs.pending > 0 || this.preparation.pending > 0))) {
      this.requestPreparedFrame();
      this.drewLastFrame = false;
      return false;
    }
    this.framesDrawn++;
    if (this.progressive) {
      this.progressiveFrames++;
      this.requestPreparedFrame();
    }
    if (!this.atRest) this.motionFrameReady = true;
    if (this.watchdogOn) this.watch(true);
    this.trimWatch();
    const info = this.renderer.info.render;
    this.lastDrawCalls = info.drawCalls ?? info.frameCalls ?? 0;
    this.lastTriangles = info.triangles ?? 0;
    this.frameStats.record(dt, now() - t0);
    if (this.restAnimating && this.drewLastFrame) {
      this.restSlow = dt > REST_SLOW_DT ? this.restSlow + 1 : 0;
      if (this.restSlow >= REST_SLOW_FRAMES) {
        this.restDeferred = true;
        this.atRest = false;
        this.restAnimating = false;
        this.needsDraw = true;
      }
    }
    // A split studio chain refines at rest with its full (slow) chain: those frames say nothing about motion.
    if (this.qualityPlan.moveEffects === null || !this.atRest) {
      // CPU contention from a background bake says nothing about GPU pixel cost.
      const measuring = this.drewLastFrame && !this.lightVolumeBaking;
      if (this.adaptive.record(dt, measuring, this.gpuCost.seconds)) this.resize(this.cssWidth, this.cssHeight);
      const scale = this.adaptive.enabled ? this.adaptive.scale : 0;
      if (this.governor.record(dt, measuring, scale)) this.applyPerformance();
      const mayProbe = this.tierChoice === 'auto' && this.qualityPlan.quality === 'realtime'
        && this.governor.level === 0 && this.budget.post && this.gpu.tier !== 'software'
        && !this.lowMemory && !this.safe && !this.watchPostOff && !this.studioFailed
        && (this.hardware.memoryGB === undefined || this.hardware.memoryGB > 2);
      if (this.adaptiveTier.record(dt, measuring, scale, this.autoTierBase(), mayProbe)) {
        this.applyQuality(this.qualityPlan.quality);
        log.info(`performance: measured automatic tier ${this.autoTierNow()}`);
      }
    }
    this.drewLastFrame = true;
    return true;
  }

  /** First time this wait for programs / render preparation began (0: nothing is pending). */
  private busySince = 0;
  private progressiveAt = 0;
  /** True while the frame being drawn is a progressive one (shown although programs or preparation are still pending). */
  private progressive = false;
  /** Progressive frames shown so far, and why (diagnostics). */
  private progressiveFrames = 0;
  private progressiveNote = '';

  /**
   * Whether a frame may be shown although programs still link or objects still prepare. Preparation of a big generated
   * world can take tens of seconds on an integrated GPU (one program per material and light set); the view must never
   * wait for all of it. After {@link PROGRESSIVE_FIRST_MS} without any image (or {@link PROGRESSIVE_MS} with one) a frame
   * is shown every {@link PROGRESSIVE_EVERY_MS}: objects whose programs are ready draw, the others join as they finish.
   */
  private progressiveDue(): boolean {
    const t = now();
    if (this.busySince === 0) this.busySince = t;
    const waited = t - this.busySince;
    if (waited < (this.framesDrawn === 0 ? PROGRESSIVE_FIRST_MS : PROGRESSIVE_MS)) return false;
    if (t - this.progressiveAt < PROGRESSIVE_EVERY_MS) return false;
    this.progressiveAt = t;
    const note = `programs ${this.programs.pending}, preparation ${this.preparation.pending}, waited ${(waited / 1000).toFixed(1)} s`;
    if (this.progressiveFrames === 0) log.info(`progressive presentation: ${note}`);
    this.progressiveNote = note;
    return true;
  }

  private refresh(): void {
    this.grow.withFullScale(() => this.refreshBounds());
  }

  /** Last camera pose + projection seen by {@link viewChanged}. */
  private readonly lastView = new Float64Array(33);

  /** True when the camera's world matrix or projection changed since the last call (allocation-free). */
  private viewChanged(): boolean {
    const cam = this.perspective;
    cam.updateMatrixWorld();
    const w = cam.matrixWorld.elements;
    const p = cam.projectionMatrix.elements;
    const last = this.lastView;
    let changed = last[32] !== this.cssHeight * this.renderer.getPixelRatio();
    for (let i = 0; i < 16; i++) {
      if (last[i] !== w[i]) changed = true;
      if (last[16 + i] !== p[i]) changed = true;
      last[i] = w[i] as number;
      last[16 + i] = p[i] as number;
    }
    last[32] = this.cssHeight * this.renderer.getPixelRatio();
    return changed;
  }

  private refreshBounds(): void {
    this.sinceRefit = 0;
    this.needsDraw = true;
    if (this.boundsDirty) {
      this.boundsDirty = false;
      this.framing = contentFraming(collectFramingItems(this.sync));
      this.syncSunShadows();
      this.env.sunCascades?.invalidateCasters();
      const f = this.framing;
      if (f) {
        this.env.setContentRadius(f.radius);
        // Shadows are spent on the meaningful content, not on backdrop mountains.
        const r = f.radius * 1.2;
        _bounds.min.set(f.center[0] - r, Math.min(0, f.center[1] - r), f.center[2] - r);
        _bounds.max.set(f.center[0] + r, f.center[1] + r, f.center[2] + r);
        // Inside a building the sun only matters through its windows: spend the whole map on the building, so
        // sun patches on the floor have crisp window-shaped edges instead of a metre of blur.
        const shell = this.lightVolume.shellBounds;
        if (this.shadowInside && !shell.isEmpty()) _bounds.copy(shell).expandByScalar(1);
        this.env.fitShadows(_bounds);
      } else {
        this.env.fitShadows(this.sync.computeBounds(_bounds));
      }
    }
    if (this.debugDirty) {
      this.debugDirty = false;
      if (this.debug.active) this.debug.rebuild(this.sync);
    }
  }

  /**
   * Choose the sun's shadow technique for the tier and the world (cascades, map sizes, filter): see
   * `environment/sun-shadow-plan.ts`. A change of technique replaces the sun light, so the post chain that holds it
   * (shafts, contact shadows) is rebuilt.
   */
  private syncSunShadows(): void {
    // `globalThis.__SUN_SHADOWS_ON_SOFTWARE = true` (tests): plan as on a hardware GPU, so the cascade and soft-filter
    // shaders can be checked on SwiftShader's WebGPU and WebGL2.
    if (!this.env.sun.castShadow) return;
    const q = this.qualityPlan;
    const plan = planSunShadows({ tier: q.shadowTier, still: q.shadowStill, shadowMapCap: q.shadowMapCap, contentRadius: this.framing?.radius ?? 0, voxel: this.voxelLayer !== null, cascades: this.cuts.cascades, nearestCompare: this.geckoSafe, software: this.gpu.tier === 'software' && (globalThis as { __SUN_SHADOWS_ON_SOFTWARE?: boolean }).__SUN_SHADOWS_ON_SOFTWARE !== true });
    if (!this.env.setSunShadows(plan, this.perspective)) return;
    this.env.sun.shadow.radius = q.shadowRadius;
    if (this.post || this.postPending) {
      this.dropPost();
      this.postPending = false;
    }
    this.shaftWait = 0;
    this.needsDraw = true;
  }

  /** Point the sun's focus cascades at what the eye looks at, and turn the shadow filters' sampling pattern. */
  private aimSunShadows(capture: boolean): void {
    const cascades = this.env.sunCascades;
    const temporal = this.post?.effects.taa === true;
    if (temporal) {
      const k = (this.shadowFrame = (this.shadowFrame + 1) % 64);
      shadowNoiseValue.set((k * 37) % 64, (k * 23) % 64);
    } else if (shadowNoiseValue.x !== 0 || shadowNoiseValue.y !== 0) shadowNoiseValue.set(0, 0);
    if (!cascades) { this.cacheSunMap(capture); return; }
    cascades.setCacheEnabled(!capture);
    if (capture || this.sunMapDirty || this.sunMapSoft) cascades.requestRefresh();
    this.sunMapDirty = false; this.sunMapSoft = false;
    const h = cascades.hints;
    h.target = this.rig.getSubject(_focusTarget) ?? this.probeFocus(capture);
    const f = this.framing;
    h.groundY = f ? Math.min(f.center[1], 0) : 0;
    h.maxDistance = f ? this.perspective.position.distanceTo(_center.set(f.center[0], f.center[1], f.center[2])) + f.radius * 1.5 : 200;
  }

  /**
   * A single content-fitted sun map does not depend on the camera, so a frame that only moved the view (an orbit, a walk
   * through a house with nothing animating) reuses the last map instead of drawing every caster again. The map is drawn
   * again when content changed (anything that asked for a frame besides the camera), the sun or its frustum moved, every
   * few frames while casters animate or scatter fields re-plan with the view, and now and then regardless (a safety net
   * for a change nobody reported). Cascades use exact caster/placed-map snapshots in SunCascades; captures always draw.
   */
  private cacheSunMap(always: boolean): void {
    const sun = this.env.sun;
    const shadow = sun.shadow;
    if (always || !sun.castShadow || !this.renderer.shadowMap.enabled) {
      shadow.autoUpdate = true;
      this.sunMapDirty = true;
      return;
    }
    const sig = this.sunMapSig;
    const cam = shadow.camera;
    const p = sun.position;
    const t = sun.target.position;
    const next = [p.x, p.y, p.z, t.x, t.y, t.z, cam.left, cam.right, cam.top, cam.bottom, cam.near, cam.far, shadow.mapSize.x, shadow.bias];
    let moved = this.sunMapKey !== sun;
    for (let i = 0; i < next.length; i++) {
      if (sig[i] !== next[i]) moved = true;
      sig[i] = next[i] as number;
    }
    this.sunMapKey = sun;
    shadow.autoUpdate = false;
    const age = this.sunMapAge + 1;
    const moving = this.qualityPlan.moveEffects !== null && !this.atRest;
    const due = this.sunMapDirty || moved || age >= (moving ? SUN_MAP_REFRESH_MOVING : SUN_MAP_REFRESH) || (this.sunMapSoft && age >= (moving ? SUN_MAP_SOFT_REFRESH_MOVING : SUN_MAP_SOFT_REFRESH));
    shadow.needsUpdate = due;
    if (due) {
      this.sunMapDraws++;
      this.sunMapAge = 0;
      this.sunMapDirty = false;
      this.sunMapSoft = false;
    } else this.sunMapAge = age;
  }

  /** Times the cached sun map was drawn again (diagnostics and benchmarks). */
  sunMapDraws = 0;
  private shadowFrame = 0;
  private readonly focusProbe = { point: new Vector3(), valid: false, at: -1e9, pos: new Vector3(Number.NaN, 0, 0), quat: new Quaternion() };

  /**
   * A posed camera has no subject: the surface seen a little below the centre of the view is the focus. Ray cast at most four times a
   * second while the camera moves (and for every capture pose); the last hit is reused in between.
   */
  private probeFocus(capture: boolean): Vector3 | null {
    const p = this.focusProbe;
    const cam = this.perspective;
    const moved = p.pos.distanceToSquared(cam.position) > 0.0025 || Math.abs(p.quat.dot(cam.quaternion)) < 0.99999;
    const t = now();
    if (moved && (capture || t - p.at > 250)) {
      p.at = t;
      p.pos.copy(cam.position);
      p.quat.copy(cam.quaternion);
      // Through the lower part of the frame: a view toward the horizon is about its foreground, not the far hills.
      cam.updateMatrixWorld();
      _focusDir.set(0, -0.4, 0.5).unproject(cam).sub(cam.position).normalize();
      const f = this.framing;
      const reach = f ? cam.position.distanceTo(_center.set(f.center[0], f.center[1], f.center[2])) + f.radius * 1.5 : 400;
      const hit = this.raycastWorld([cam.position.x, cam.position.y, cam.position.z], [_focusDir.x, _focusDir.y, _focusDir.z], reach);
      p.valid = hit !== null;
      if (hit) p.point.set(hit.point[0], hit.point[1], hit.point[2]);
    }
    return p.valid ? p.point : null;
  }

  /** The sun's shadow technique in effect and where its cascades are (diagnostics and tests). */
  get sunShadowInfo(): { cascades: number; filter: string; mapSizes: number[]; focus: [number, number, number] | null; boxes: Array<{ center: [number, number, number]; half: number; size: number; hasMap: boolean }> } {
    const plan = this.env.sunShadowPlan;
    const d = this.env.sunCascades?.describe() ?? null;
    return { cascades: plan.cascades, filter: plan.filter, mapSizes: this.env.shadowMapEdges, focus: d?.focus ?? null, boxes: d?.boxes ?? [] };
  }

  /** Post pass wanted for the current world and budget. */
  private get wantsPost(): boolean {
    return this.wantedEffects() !== null;
  }

  /**
   * The effect set to run now: the quality plan's, with the user's toggles and the effects that failed
   * on this device applied. The low tier keeps the classic bloom-only pass for worlds that ask for
   * bloom. Null: render directly.
   */
  private wantedEffects(): PostEffects | null {
    return this.effectsFor(this.qualityPlan.moveEffects === null || this.atRest || this.captureActive);
  }

  /** The effect set of the rest phase (`rest`) or of the motion phase of a split chain (see {@link wantedEffects}). */
  private effectsFor(rest: boolean): PostEffects | null {
    if (!this.budget.post) return null;
    const plan = this.qualityPlan;
    let effects = resolveEffects(!rest && plan.moveEffects !== null ? plan.moveEffects : plan.effects, this.effectOverrides, this.failedEffects);
    // Not on a weak machine: the bloom chain is the one post pass the low tier could still run, and on a machine
    // that cannot spare the frame time (or whose driver draws it black) the direct draw is the safe one.
    if (!effects.composite && plan.tier === 'low' && this.effectOverrides.composite !== false && this.env.bloom > 0.001 && !weakHardware(this.hardware) && !this.safe) effects = { ...effects, composite: true };
    if (!effects.composite || this.postFailed) return null;
    // Sun shafts march through the sun's shadow map: they need a shadow-casting sun with a map in use.
    if (effects.shafts && (!this.env.sun.castShadow || this.shaftsUnavailable)) effects = { ...effects, shafts: false };
    return effects;
  }

  /** Post variant the current quality and world need (null: render directly). */
  private get wantedPostQuality(): PostQuality | null {
    const effects = this.wantedEffects();
    return effects ? postQualityOf(effects) : null;
  }

  /**
   * Switch the render quality. `studio` (stills: the ultra chain with larger soft shadows and
   * progressive refinement while the view rests) and `final` (plus depth of field and a long
   * refinement) need the post pass; returns the quality actually in effect (realtime when stills are
   * unavailable).
   */
  setRenderQuality(quality: RenderQuality): RenderQuality {
    const want: RenderQuality = quality !== 'realtime' && !this.studioFailed ? quality : 'realtime';
    return this.applyQuality(want);
  }

  // ---------------------------------------------------------------------------
  // Black-screen watchdog, safe mode, diagnostics
  // ---------------------------------------------------------------------------

  /** One tick of the watchdog; `drew` when a frame was just drawn (then a read-back of it may be taken). */
  private watch(drew: boolean): void {
    if (this.watchdog.finished) return;
    const t = now();
    // Content that is still growing in or waiting for its programs is not a failure to draw.
    const preparing = this.sync.batchPreparationPending > 0 || this.programs.pending > 0 || this.preparation.pending > 0;
    const settled = !this.warming && !this.grow.active && !preparing;
    let sample: FrameSample | null = null;
    // An idle editor draws nothing, and a watch that has not yet seen an image needs one: ask for a frame now and then.
    if (!drew && settled && this.framesDrawn > 0 && t - this.watchNudge > 1000) {
      this.watchNudge = t;
      this.needsDraw = true;
    }
    if (drew && settled && !this.sampling && this.watchdog.wantsSample(t, this.framesDrawn)) {
      if (typeof createImageBitmap === 'function') this.sampleViewAsync();
      else sample = this.sampleView();
    }
    const action = this.watchdog.tick(t, this.framesDrawn, sample, preparing);
    if (action) this.onWatchdogAction(action);
  }

  /** The room a trim read-back was asked for. */
  private trimRoom: string | null = null;

  /**
   * At rest inside a building, now and then read the finished picture back (a 16 x 16 snapshot, read in a worker) and
   * let the room's exposure trim follow it (see `view/exposure-trim.ts`). Never while the view moves or programs link.
   */
  private trimWatch(): void {
    if ((globalThis as { __NOTRIM?: boolean }).__NOTRIM) return;
    const debug = (globalThis as { __TRIMLOG?: boolean }).__TRIMLOG === true;
    const why = (reason: string): void => {
      if (debug && now() - this.trimDebugAt > 1500) {
        this.trimDebugAt = now();
        console.warn(`[trim] watch blocked: ${reason}`);
      }
    };
    if (this.sampling || this.disposed || this.lost) return why('sampling or lost');
    if (!this.lightVolume.ready) return why('light volume not ready');
    if (!this.roomPick) return why('no room under the eye');
    // The eye has to have stood still for a moment (at rest in the editor, or a walker who stopped): never while it moves.
    const t = now();
    const e = this.perspective.matrixWorld.elements;
    let still = true;
    for (let i = 0; i < 16; i++) {
      if (Math.abs((e[i] as number) - (this.trimPose[i] as number)) > 0.01) {
        still = false;
        this.trimPose[i] = e[i] as number;
      }
    }
    if (!still) {
      this.trimStillAt = t;
      this.trimQuiet = 0;
    }
    if (t - this.trimStillAt < 400) return why('eye moving');
    if (typeof createImageBitmap !== 'function' || this.captureActive) return why('no bitmap or capture running');
    if (this.warming || this.grow.active || this.preparation.pending > 0 || this.programs.pending > 0) return why(`busy: warming ${String(this.warming)} grow ${String(this.grow.active)} prep ${this.preparation.pending} programs ${this.programs.pending}`);
    if (Math.abs((this.roomTrim.get(this.roomPick.id) ?? 0) - this.trimNow) > 0.02) return why('trim still easing');
    // A picture that stopped changing the trim is looked at only now and then (an animated world draws every frame).
    if (t - this.trimAt < (this.trimQuiet >= 3 ? 5000 : 700)) return;
    this.trimAt = t;
    this.trimRoom = this.roomPick.id;
    this.sampleViewAsync(true);
  }

  private trimDebugAt = 0;

  /**
   * An idle view (nothing else asks for a frame) inside a building whose trim is still being learned: it draws one more frame every
   * 0.7 s, at most three reads in a row that leave the trim as it was (the counter starts again when the eye moves), so a view
   * that comes to rest reaches its exposure without waiting for something to animate.
   */
  private trimIdleDue(): boolean {
    if ((globalThis as { __NOTRIM?: boolean }).__NOTRIM || this.sampling || !this.lightVolume.ready || !this.roomPick) return false;
    if (this.trimQuiet >= 3 || this.captureActive) return false;
    const t = now();
    return t - this.trimStillAt >= 400 && t - this.trimAt >= 700;
  }

  /** The author's lighting intent and the exposure they set by eye (a bias): what the trim steers the picture toward. */
  private trimIntent(): TrimIntent {
    const ev = Math.log2(Math.max(0.05, this.docExposure)) + (this.docGrade?.exposureEv ?? 0);
    return { ...(this.docLook?.intent?.key ? { key: this.docLook.intent.key } : {}), biasEv: ev };
  }

  /**
   * A capture from eye height inside a building shows the trim the room has learned. The live view learns it at rest; a
   * pose that was never stood in has none yet, so it is learned here from small drawings of the pose itself (at most
   * three, each moves at most one step) and kept for the room, which is also what the live eye then finds.
   * `draw` aims the camera and renders one frame into the capture target.
   */
  private async settleTrim(draw: () => void, w: number, h: number): Promise<void> {
    if (!this.lightVolume.ready || (globalThis as { __NOTRIM?: boolean }).__NOTRIM) return;
    const debug = (globalThis as { __TRIMLOG?: boolean }).__TRIMLOG === true;
    for (let i = 0; i < 3; i++) {
      const room = this.roomPick?.id;
      if (room === undefined || this.disposed || this.lost) return;
      let s: FrameSample | null = null;
      if (!this.asyncCaptureFailed) {
        try {
          const pixels = await this.grow.withFullScale(() =>
            this.renderToPixels(w, h, () => {
              draw();
              this.prepareBatches(true);
              this.renderer.render(this.scene, this.perspective);
            }, () => undefined),
          );
          s = measurePixels(pixels, w, h);
        } catch (e) {
          this.asyncCaptureFailed = true;
          log.warn(`asynchronous capture unavailable, using canvas readback: ${errorMessage(e)}`);
          if (debug) console.warn(`[trim] async read-back failed: ${errorMessage(e)}`);
        }
      }
      if (!s) {
        // No asynchronous read-back on this backend (WebGL2): draw small into the canvas and read that back.
        s = this.grow.withFullScale(() =>
          this.withTemporarySize(w, h, () => {
            draw();
            this.prepareBatches(true);
            this.renderer.render(this.scene, this.perspective);
            return this.sampleView();
          }),
        );
        if (!s) return;
      }
      const cur = this.roomTrim.get(room) ?? 0;
      const next = nextTrim(cur, { mean: s.mean, high: s.high ?? 0, low: s.low ?? 0 }, this.trimIntent());
      if (debug) console.warn(`[trim] async ${!this.asyncCaptureFailed} room ${room} pass ${i} mean ${s.mean.toFixed(0)} high ${(s.high ?? 0).toFixed(3)} trim ${cur.toFixed(2)} -> ${next.toFixed(2)}`);
      if (next === cur) return;
      this.roomTrim.set(room, next);
    }
  }

  private onTrimSample(s: FrameSample | null): void {
    const room = this.trimRoom;
    this.trimRoom = null;
    if (!s || s.high === undefined || room === null || this.disposed || this.roomPick?.id !== room) return;
    const cur = this.roomTrim.get(room) ?? 0;
    const next = nextTrim(cur, { mean: s.mean, high: s.high, low: s.low ?? 0 }, this.trimIntent());
    if ((globalThis as { __TRIMLOG?: boolean }).__TRIMLOG) console.warn(`[trim] live room ${room} mean ${s.mean.toFixed(0)} high ${s.high.toFixed(3)} trim ${cur.toFixed(2)} -> ${next.toFixed(2)}`);
    if (next === cur) {
      this.trimQuiet++;
      return;
    }
    this.trimQuiet = 0;
    this.roomTrim.set(room, next);
    this.eyeClock = 1;
    this.needsDraw = true;
  }

  /** An asynchronous view sample is in flight. */
  private sampling = false;

  private sampleWorker: Worker | null = null;
  private sampleId = 0;

  /**
   * The same 16×16 read-back without waiting for the GPU on the main thread: `createImageBitmap` takes its snapshot of the
   * canvas in this task (so it is the frame just drawn) and a worker reads it (the synchronous `getImageData` stalls the
   * page for as long as the GPU needs to finish the frame: seconds while the first programs build).
   */
  private sampleViewAsync(forTrim = false): void {
    const src = this.renderer.domElement as HTMLCanvasElement;
    if (!(src.width > 0 && src.height > 0)) return;
    this.sampling = true;
    this.trimSampling = forTrim;
    try {
      if (!this.sampleWorker) {
        const w = new Worker(new URL('./view/frame-sample.worker.ts', import.meta.url), { type: 'module', name: 'aether-frame-sample' });
        w.onmessage = (e: MessageEvent): void => {
          const d = e.data as { id?: number; sample?: FrameSample | null };
          if (d.id !== this.sampleId) return;
          this.sampling = false;
          const forTrim = this.trimSampling;
          this.trimSampling = false;
          if (forTrim) {
            this.onTrimSample(d.sample ?? null);
            return;
          }
          if (this.disposed || this.watchdog.finished || !d.sample) return;
          const action = this.watchdog.tick(now(), this.framesDrawn, d.sample, this.sync.batchPreparationPending > 0);
          if (action) this.onWatchdogAction(action);
        };
        w.onerror = (): void => {
          this.sampling = false;
          this.sampleWorker?.terminate();
          this.sampleWorker = null;
        };
        this.sampleWorker = w;
      }
      const id = ++this.sampleId;
      const w = this.sampleWorker;
      createImageBitmap(src)
        .then((bmp) => {
          if (this.disposed || !w) bmp.close();
          else w.postMessage({ id, bitmap: bmp }, [bmp]);
        })
        .catch(() => {
          this.sampling = false;
        });
    } catch {
      this.sampling = false;
    }
  }

  /** The drawn frame as a 16×16 read-back (null where the browser cannot give one). Same task as the draw. */
  private sampleView(): FrameSample | null {
    try {
      const src = this.renderer.domElement as HTMLCanvasElement;
      if (typeof document === 'undefined' || !(src.width > 0 && src.height > 0)) return null;
      if (!this.probe) {
        const c = document.createElement('canvas');
        c.width = 16;
        c.height = 16;
        this.probe = c.getContext('2d', { willReadFrequently: true });
        if (!this.probe) return null;
      }
      this.probe.drawImage(src, 0, 0, 16, 16);
      return measureFrame(this.probe.getImageData(0, 0, 16, 16).data);
    } catch {
      return null;
    }
  }

  private onWatchdogAction(a: WatchdogAction): void {
    this.noteWatch(`${a.reason}: ${a.step} (${a.message})`);
    log.warn(`black-screen watchdog (${a.reason}, step ${a.taken}): ${a.message}`);
    if (a.step !== 'exhausted') {
      // Already on the lowest tier: the first step changes nothing, so the next one is applied with it.
      const alreadyLow = a.step === 'low-tier' && this.renderTier === 'low';
      this.applyWatchdogStep(a.step);
      if (alreadyLow) this.applyWatchdogStep('no-effects');
    }
    this.emitWatch({ kind: a.step === 'exhausted' ? 'exhausted' : 'step', step: a.step, reason: a.reason, message: a.message });
  }

  private noteWatch(text: string): void {
    this.watchLog.push({ at: Math.round(now()), text });
    if (this.watchLog.length > 40) this.watchLog.shift();
  }

  private emitWatch(e: Omit<WatchdogEvent, 'diagnostics' | 'webgpu'>): void {
    try {
      this.onWatchdog?.({ ...e, webgpu: this.backend === 'webgpu', diagnostics: this.diagnostics() });
    } catch (err) {
      log.warn(`watchdog listener failed: ${errorMessage(err)}`);
    }
  }

  /** A shader failed to compile or a program failed to link: say so (the view may be black because of it). */
  private shaderFailed(text: string): void {
    if (this.disposed) return;
    this.noteWatch(`shader failure: ${text.slice(0, 200)}`);
    this.emitWatch({ kind: 'shader-error', step: null, reason: null, message: `A shader failed to build on this GPU (${text.slice(0, 160)}). Parts of the scene may be missing or black.` });
  }

  /** Apply one step of the watchdog's ladder (each includes the ones before). */
  private applyWatchdogStep(step: (typeof WATCHDOG_STEPS)[number]): void {
    if (step === 'low-tier') this.lowestTier();
    else if (step === 'no-effects') this.noEffects();
    else if (step === 'simple-materials') this.plainMaterials(true);
    else this.minimalDraw(true);
  }

  private lowestTier(): void {
    this.setRenderTier('low');
  }

  private noEffects(): void {
    this.lowestTier();
    this.governor.level = PERFORMANCE_STEPS.length;
    this.cuts = cutsAt(PERFORMANCE_STEPS.length);
    this.fx.vfx.emissionScale = this.cuts.effects;
    this.watchPostOff = true;
    this.postFailed = true;
    this.syncInteriorLight();
    this.applyQuality(this.qualityPlan.quality);
  }

  private plainMaterials(on: boolean): void {
    this.noEffects();
    this.simple = on;
    this.scene.overrideMaterial = on ? new MeshBasicNodeMaterial({ color: 0xb4b8c0 }) : null;
    this.needsDraw = true;
  }

  private minimalDraw(on: boolean): void {
    this.plainMaterials(true);
    this.minimal = on;
    this.renderer.shadowMap.enabled = !on && this.env.sun.castShadow;
    this.env.sun.castShadow = !on && this.env.sun.castShadow;
    this.setPixelRatioCap(on ? 0.5 : Number.POSITIVE_INFINITY);
  }

  /**
   * Safe mode: the lowest tier, no post effects, no baked room light, simple sun shadows, particles reduced. A manual
   * switch for a machine that struggles; the watchdog goes further when the view is blank. Turning it off returns to the
   * automatic tier and the full set of effects.
   */
  setSafeMode(on: boolean): void {
    if (on === this.safe && !this.simple && !this.minimal) return;
    this.safe = on;
    if (on) {
      this.noEffects();
      this.noteWatch('safe mode on');
    } else {
      this.simple = false;
      this.minimal = false;
      this.scene.overrideMaterial = null;
      this.renderer.shadowMap.enabled = true;
      this.setPixelRatioCap(Number.POSITIVE_INFINITY);
      this.watchPostOff = false;
      this.postFailed = false;
      this.governor.level = 0;
      this.cuts = cutsAt(0);
      this.fx.vfx.emissionScale = 1;
      this.syncInteriorLight();
      this.setRenderTier('auto');
      this.noteWatch('safe mode off');
    }
    this.needsDraw = true;
  }

  /** Safe mode is on (set by the user or at start). */
  get safeMode(): boolean {
    return this.safe;
  }

  /** What the watchdog has done so far (empty: nothing was wrong). */
  get watchdogSteps(): readonly string[] {
    return this.watchLog.map((l) => l.text);
  }

  /** The last read-back of the viewport the watchdog took (null: none yet). */
  get lastViewSample(): Readonly<FrameSample> | null {
    return this.watchdog.last;
  }

  /**
   * A plain-text report of this renderer for a bug report: backend decision and its events, GPU and its limits,
   * hardware, tier and ladder, frames and timings, what the watchdog did, and the GPU-related console lines.
   */
  diagnostics(): string {
    const out: string[] = [];
    const add = (k: string, v: unknown): void => void out.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    out.push('Aether graphics diagnostics');
    add('time', new Date().toISOString());
    if (typeof navigator !== 'undefined') add('userAgent', navigator.userAgent);
    add('hardware', { ...this.hardware, dpr: typeof window === 'undefined' ? 1 : window.devicePixelRatio });
    add('backend', { active: this.backend, report: this.gpu.report });
    add('gpu', { description: this.gpu.description, tier: this.gpu.tier });
    try {
      const gl = (this.renderer as unknown as { backend?: { gl?: WebGL2RenderingContext } }).backend?.gl;
      if (gl && typeof gl.getParameter === 'function') {
        const ext = gl.getSupportedExtensions() ?? [];
        add('webgl', { version: gl.getParameter(gl.VERSION), maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), parallelCompile: ext.includes('KHR_parallel_shader_compile'), floatTargets: ext.includes('EXT_color_buffer_float'), halfFloatTargets: ext.includes('EXT_color_buffer_half_float'), anisotropy: ext.includes('EXT_texture_filter_anisotropic'), contextLost: gl.isContextLost() });
      }
    } catch {
      /* the backend object differs by version */
    }
    add('tier', { in_effect: this.renderTier, auto: this.autoRenderTier, ladder: this.governor.level, safeMode: this.safe, plainMaterials: this.simple, minimal: this.minimal, postOffByWatchdog: this.watchPostOff });
    add('canvas', { width: this.domElement.width, height: this.domElement.height, pixelRatio: this.renderer.getPixelRatio(), adaptiveScale: this.adaptive.scale });
    const st = this.stats();
    add('frames', { drawn: this.framesDrawn, fps: st.fps, frameMs: st.frameMs, drawCalls: st.drawCalls, triangles: st.triangles, textures: st.textures, geometries: st.geometries });
    add('presentation', this.progressiveFrames > 0 ? `progressive: ${this.progressiveFrames} frames shown while shaders were still preparing (last: ${this.progressiveNote})` : `complete frames only (programs ${this.programs.pending}, preparation ${this.preparation.pending})`);
    add('load', { shaderWarmupMs: Math.round(this.shaderWarmupMs), warming: this.warming, lost: this.lost });
    add('viewSample', this.watchdog.last ?? 'none taken');
    add('watchdog', { healthy: this.watchdog.healthy, stepsTaken: this.watchdog.stepsTaken });
    if (this.watchLog.length > 0) {
      out.push('watchdog log:');
      for (const l of this.watchLog) out.push(`  +${(l.at / 1000).toFixed(1)}s ${l.text}`);
    }
    const slow = textureWork.slowest;
    if (slow.length > 0) add('slowest texture jobs', slow);
    if (this.gpuLog.lines.length > 0) {
      out.push('GPU console lines:');
      for (const l of this.gpuLog.lines) out.push(`  [${l.level}] ${l.text}`);
    }
    return out.join('\n');
  }

  /**
   * Choose the interactive render tier (`low`, `medium`, `high`, `ultra`) or `'auto'` to follow the
   * GPU budget. Takes effect immediately; stills ignore it (they always run the ultra chain). Returns
   * the tier now in effect.
   */
  setRenderTier(tier: RenderTier | 'auto'): RenderTier {
    this.tierChoice = tier;
    this.governor.enabled = tier === 'auto';
    if (tier !== 'auto' && this.governor.level > 0) {
      // An explicit choice is honoured in full: whatever the ladder gave up comes back.
      this.governor.level = 0;
      this.cuts = cutsAt(0);
      this.fx.vfx.emissionScale = 1;
      this.syncInteriorLight();
    }
    this.governor.reset();
    this.adaptiveTier.reset();
    this.applyQuality(this.qualityPlan.quality);
    return this.qualityPlan.tier;
  }

  /** The tier in effect (stills report `ultra`). */
  get renderTier(): RenderTier {
    return this.qualityPlan.tier;
  }

  /** The tier the GPU budget picks by itself. */
  get autoRenderTier(): RenderTier {
    return this.autoTierNow();
  }

  /** The GPU budget's tier, lowered for weak hardware and for what the performance ladder has given up. */
  private autoTierNow(): RenderTier {
    return capTier(this.adaptiveTier.resolve(this.autoTierBase()), this.cuts.tierCap);
  }

  private autoTierBase(): RenderTier {
    return capTier(autoTier(this.gpu.tier, this.budget), hardwareTierCap(this.hardware, this.gpu.tier));
  }

  /** The render budget of the GPU class, with a pixel ratio of 1 on weak hardware. */
  private budgetFor(lowMemory: boolean): RenderBudget {
    const b = renderBudget(this.gpu.tier, lowMemory);
    return weakHardware(this.hardware) && b.pixelRatioCap > WEAK_PIXEL_RATIO ? { ...b, pixelRatioCap: WEAK_PIXEL_RATIO } : b;
  }

  /** Steps the performance ladder has taken so far (0: nothing given up). */
  get performanceLevel(): number {
    return this.governor.level;
  }

  /** Whether giving up `step` now would change anything (a step that would not is skipped, not waited for). */
  private stepUseful(step: (typeof PERFORMANCE_STEPS)[number]): boolean {
    switch (step) {
      case 'light-volume':
        return this.lightVolume.active;
      case 'cascades':
        return this.env.sunCascades !== null;
      case 'post-medium':
        return this.qualityPlan.tier === 'high' || this.qualityPlan.tier === 'ultra';
      case 'post-off':
        return this.qualityPlan.tier !== 'low';
      case 'effects':
        return true;
    }
  }

  /**
   * Firefox on WebGL2 starts on the light end of the ladder (no baked room light, one shadow map, the lowest tier: no
   * bloom chain) and the governor climbs while frames stay comfortably fast. Clears the targets the water samples.
   */
  private startCautiously(): void {
    if (!this.geckoSafe) return;
    primeTarget(this.renderer as unknown as Parameters<typeof primeTarget>[0], this.materials.backdrop.target);
    primeTarget(this.renderer as unknown as Parameters<typeof primeTarget>[0], this.materials.mirror.mirror.target);
    this.governor.start(GECKO_START_LEVEL);
    this.cuts = cutsAt(GECKO_START_LEVEL);
    this.fx.vfx.emissionScale = this.cuts.effects;
    this.syncInteriorLight();
    this.applyQuality(this.qualityPlan.quality);
    log.info(`performance: cautious start at level ${GECKO_START_LEVEL} (Firefox on WebGL2), climbs while frames are fast`);
  }

  /** Apply the cuts of the ladder's current level (the governor moved one step: {@link PerformanceGovernor.lastMove}). */
  private applyPerformance(): void {
    const up = this.governor.lastMove < 0;
    if (!up) while (this.governor.level < PERFORMANCE_STEPS.length && !this.stepUseful(PERFORMANCE_STEPS[this.governor.level - 1] as (typeof PERFORMANCE_STEPS)[number])) this.governor.level++;
    const level = this.governor.level;
    this.cuts = cutsAt(level);
    this.fx.vfx.emissionScale = this.cuts.effects;
    this.syncInteriorLight();
    this.applyQuality(this.qualityPlan.quality);
    if (up) log.info(`performance: gave back ${PERFORMANCE_STEPS[level] ?? 'nothing'} (level ${level}, tier ${this.qualityPlan.tier})`);
    else log.info(`performance: gave up ${PERFORMANCE_STEPS[level - 1] ?? 'nothing'} (level ${level})`);
    this.onPerformanceStep?.(level, up ? '' : (PERFORMANCE_STEPS[level - 1] ?? ''), up);
  }

  /**
   * Set the user's effect toggles, replacing the previous set: a key mapped to true forces the effect
   * on, false forces it off, a missing key follows the tier. Takes effect on the next frame (the
   * pipeline is rebuilt when the effect set changes). Effects that failed on this device stay off.
   */
  setEffects(overrides: EffectOverrides): void {
    const next: EffectOverrides = {};
    for (const k of Object.keys(overrides) as (keyof PostEffects)[]) {
      const v = overrides[k];
      if (typeof v === 'boolean' && Object.hasOwn(effectsOf('ultra'), k)) next[k] = v;
    }
    this.effectOverrides = next;
    this.applyQuality(this.qualityPlan.quality);
  }

  /** Names of the effects the current tier, toggles and device failures ask for (what the chain converges to). */
  get intendedEffects(): string[] {
    const e = this.wantedEffects();
    return e ? (Object.keys(e) as (keyof PostEffects)[]).filter((k) => e[k] && k !== 'composite') : [];
  }

  /** The effects currently running (all false when drawing directly). */
  get activeEffects(): Readonly<PostEffects> {
    return this.post?.effects ?? resolveEffects({ composite: false, ao: false, gi: false, taa: false, contact: false, ssr: false, shafts: false, halation: false, aberration: false, grain: false, dof: false });
  }

  /** Effects that failed on this device (and were dropped from the chain). */
  get failedEffectNames(): readonly string[] {
    return [...this.failedEffects];
  }

  /** Pick a colour-grade preset (null: follow the sky). Unknown ids are ignored. */
  setGradePreset(id: GradePresetId | null): void {
    if (id !== null && !isGradePresetId(id)) return;
    this.gradeId = id;
    this.applyLook();
    this.needsDraw = true;
  }

  private lookTweak = { contrast: 1, saturation: 1, exposureEv: 0, temperature: 0 };

  /** Look development: scale the grade's contrast and saturation, add stops of exposure and white-balance warmth (all neutral by default). */
  setLookTweak(t: { contrast?: number; saturation?: number; exposureEv?: number; temperature?: number }): void {
    const fin = (v: number | undefined, d: number): number => (v !== undefined && Number.isFinite(v) ? v : d);
    this.lookTweak = { contrast: fin(t.contrast, 1), saturation: fin(t.saturation, 1), exposureEv: fin(t.exposureEv, 0), temperature: fin(t.temperature, 0) };
    this.applyLook();
    this.needsDraw = true;
  }

  /** The colour-grade preset in effect. */
  get gradePreset(): GradePresetId {
    return this.look.id;
  }

  /**
   * Apply the colour look: the preset's tone curve (AgX and friends — the classic ACES curve while no
   * post pass runs, so the direct low tier looks as it always did), exposure, grade and bloom.
   */
  private applyLook(): void {
    const sky = this.env.skyState;
    const id = this.gradeId ?? presetFor({ elevation: sky.elevation, moon: sky.moon, sunGlowStrength: sky.sunGlowStrength, preset: sky.preset });
    const base = GRADE_PRESETS[id];
    // A grade carried by the document (a photo's white balance and tone) replaces the preset's own fields.
    const g = this.docGrade;
    const preset: GradePreset = g
      ? { ...base, ...(g.temperature !== undefined ? { temperature: g.temperature } : {}), ...(g.tint !== undefined ? { tint: g.tint } : {}), ...(g.saturation !== undefined ? { saturation: g.saturation } : {}), ...(g.contrast !== undefined ? { contrast: g.contrast } : {}), ...(g.exposureEv !== undefined ? { exposureEv: base.exposureEv + g.exposureEv } : {}) }
      : base;
    this.look = preset;
    const tw = this.lookTweak;
    // Look development: multipliers on the preset (neutral by default).
    const shown: GradePreset = tw.contrast === 1 && tw.saturation === 1 && tw.exposureEv === 0 && tw.temperature === 0 ? preset : { ...preset, contrast: preset.contrast * tw.contrast, saturation: preset.saturation * tw.saturation, exposureEv: preset.exposureEv + tw.exposureEv, temperature: preset.temperature + tw.temperature };
    const post = this.post;
    // AgX takes the preset's look through the post chain's own curve when it is installed (see `gpu/agx-look.ts`).
    this.renderer.toneMapping = post ? (preset.tone === 'agx' ? (post.agxToneMapping ?? AgXToneMapping) : preset.tone === 'neutral' ? NeutralToneMapping : ACESFilmicToneMapping) : ACESFilmicToneMapping;
    const eye = adaptedLook(this.eyeFactor);
    // A baked light volume occludes the image light itself and tells the exposure how dark the spot is.
    const volume = this.lightVolume.ready;
    this.env.setEnvScale(volume ? 1 : eye.envScale);
    // Outside the room's light the sky and the scenery take back part of the eye's interior exposure (a window shows a sky, not white).
    this.env.setExteriorScale(volume ? 2 ** (-EnvironmentRig.EXTERIOR_COMPENSATION * Math.max(0, this.eyeEv)) : 1);
    this.env.setInteriorFill(this.eyeFactor);
    this.renderer.toneMappingExposure = volume ? toneExposure(this.env.exposure, this.eyeEv + this.trimNow) : this.env.exposure * eye.exposure;
    if (post) {
      // Inside a lit building the grade warms a little, as an interior photographer balances it (not for a document grade).
      // Most of the room light's own colour cast (a wood floor's bounce, warm lamps) is balanced out first.
      // A world whose look sets its own interior warmth keeps it even with a document grade (the reviewer chose both).
      const look = this.docLook;
      const adapted = Math.max(0, Math.min(1, this.eyeEv / 1.5));
      const warm = volume && (!g || look?.interiorWarmth !== undefined) ? (look?.interiorWarmth ?? INTERIOR_WARMTH) * adapted + this.eyeBalance * (look?.interiorBalance ?? INTERIOR_BALANCE) : 0;
      const grade = gradeWithPreset(gradeFor(sky), warm !== 0 ? { ...shown, temperature: shown.temperature + warm } : shown);
      // The eye's exposure is in the renderer's tone mapping (which the post output applies too): the grade keeps only the preset's.
      post.setGrade(grade);
      post.setBloom(this.env.bloom * preset.bloom);
      if (!this.vignetteOff) post.setVignette(this.vignetteStrength());
    }
  }

  /** Edge darkening of the picture: the world's `look.vignette`, else the renderer's default. */
  private vignetteStrength(): number {
    return this.docLook?.vignette ?? VIGNETTE_STRENGTH;
  }

  /** Smoothed interior factor of the eye (0 outdoors, 1 under a ceiling), see `view/eye-adapt.ts`. */
  private eyeFactor = 0;
  /** Smoothed exposure boost (stops) asked for by the light volume at the eye. */
  private eyeEv = 0;
  /** Smoothed white-balance shift (grade temperature) for the colour of the light at the eye. */
  private eyeBalance = 0;
  /** Exposure trim (stops) learned per room from the picture at rest, the room it is learned for, and the value now shown. */
  private readonly roomTrim = new Map<string, number>();
  private trimNow = 0;
  private trimAt = 0;
  private trimStillAt = 0;
  /** Read-backs in a row that left the trim as it was. */
  private trimQuiet = 0;
  private readonly trimPose: number[] = new Array<number>(16).fill(0);
  /** An exposure read-back is in flight (its answer goes to the trim, not to the watchdog). */
  private trimSampling = false;
  /** The sun's shadow map is fitted to the building the eye stands in. */
  private shadowInside = false;
  /** Eye position at the last adaptation tick. */
  private readonly lastEye = new Vector3();
  /** Luminance of the open-site ambient and sun the last bake used (the volume's exposure reference). */
  private volumeOutdoor = { ambient: 1, sun: 3 };
  private ceilings: CeilingBox[] | null = null;
  private eyeClock = 0;
  /** The rooms of the buildings and the light measured for each, once per volume (null until asked for, dropped with the volume). */
  private roomLights: { boxes: RoomBox[]; lights: Map<string, RoomLight> } | null = null;
  private readonly roomSelect = new RoomSelector();
  /** When the rooms were last looked for and not found (a rescan waits a second). */
  private roomScanAt = -1e9;
  private roomRetries = 0;
  private roomPick: { id: string; weight: number; subject: boolean } | null = null;

  /** Drop the cached ceilings (the building changed). */
  private invalidateCeilings(): void {
    this.ceilings = null;
    this.roomLights = null;
    this.roomTrim.clear();
    this.roomScanAt = -1e9;
    this.roomRetries = 0;
  }

  /**
   * The rooms (floors with the ceiling over them) and the light of each, measured over the room's plan in the light volume.
   * Computed once per volume and per building change, so the exposure of a room is one number however the camera moves.
   */
  private ensureRoomLights(): { boxes: RoomBox[]; lights: Map<string, RoomLight> } {
    if (this.roomLights) return this.roomLights;
    const now = performance.now();
    if (now - this.roomScanAt < 1000) return { boxes: [], lights: new Map() };
    this.roomScanAt = now;
    const boxes: RoomBox[] = [];
    const lights = new Map<string, RoomLight>();
    if (this.archView.active) {
      const ceil: CeilingBox[] = this.ceilings ?? [];
      const box = new Box3();
      this.grow.withFullScale(() => {
        this.sync.forEachNode((node) => {
          const a = node.entity.arch;
          if (a?.role !== 'room' || a.kind === 'terrace' || node.entity.template) return;
          box.setFromObject(node.object);
          if (box.isEmpty() || box.max.x - box.min.x < 0.8 || box.max.z - box.min.z < 0.8) return;
          const floorY = box.max.y;
          const cx = (box.min.x + box.max.x) / 2;
          const cz = (box.min.z + box.max.z) / 2;
          // The lowest ceiling over the room's centre that is above head height; none: a room open to the sky is no room.
          let ceilY = Number.POSITIVE_INFINITY;
          for (const c of ceil) {
            if (cx < c.minX || cx > c.maxX || cz < c.minZ || cz > c.maxZ) continue;
            if (c.y > floorY + 1.8 && c.y < ceilY) ceilY = c.y;
          }
          if (!Number.isFinite(ceilY)) return;
          boxes.push({ id: node.id, minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, floorY, ceilY });
        });
      });
    }
    for (const r of boxes) {
      const pts: PointLight[] = [];
      for (const q of roomSamplePoints(r)) {
        const s = this.lightVolume.eyeSample(q[0], q[1], q[2]);
        if (s) pts.push(s);
      }
      const light = roomLight(pts, this.volumeOutdoor);
      if (light) lights.set(r.id, light);
    }
    // A building that is not indexed yet (no ceilings seen) is asked again at the next tick instead of being remembered empty.
    const found = { boxes, lights };
    if (boxes.length > 0) this.roomLights = found;
    else if (this.archView.active) {
      this.ceilings = null;
      // Nothing draws while the scene is still, so the next look for the rooms is asked for (a few times, then it is left).
      if (this.roomRetries++ < 4) {
        setTimeout(() => {
          if (this.disposed) return;
          this.eyeClock = 1;
          this.needsDraw = true;
        }, 1100);
      }
    }
    return found;
  }

  /** Diagnostics: the exposure the eye has settled on and the rooms it comes from. */
  get eyeExposure(): { ev: number; trim: number; ceilings: number; retries: number; room: string | null; weight: number; subject: boolean; rooms: Array<{ id: string; name: string | null; ev: number; raw: number; used: number; trimmed: number; box: RoomBox }> } {
    const rooms = this.roomLights ? [...this.roomLights.lights].map(([id, l]) => ({ id, name: this.sync.node(id)?.entity.arch?.name ?? null, ev: l.ev, raw: l.raw, used: l.used, trimmed: l.trimmed, box: this.roomLights?.boxes.find((b) => b.id === id) as RoomBox })) : [];
    return { ev: this.eyeEv, trim: this.trimNow, ceilings: this.ceilings?.length ?? -1, retries: this.roomRetries, room: this.roomPick?.id ?? null, weight: this.roomPick?.weight ?? 0, subject: this.roomPick?.subject ?? false, rooms };
  }

  /**
   * A still from an explicit pose is exposed for the room that pose stands in, not for wherever the live camera happens to be (a
   * review or a photo compare drawn from eye height inside a building while the editor camera orbits outside came out black).
   * The live eye is moved to the pose for one adaptation step, which snaps (it counts as a cut), and put back.
   */
  private adaptEyeToPose(pose: { pos: readonly number[]; target: readonly number[] } | undefined): void {
    if (!pose || !pose.pos.every(Number.isFinite) || !pose.target.every(Number.isFinite) || !this.lightVolume.ready) return;
    const cam = this.perspective;
    const savedPos = cam.position.clone();
    const savedQuat = cam.quaternion.clone();
    try {
      cam.position.set(pose.pos[0] as number, pose.pos[1] as number, pose.pos[2] as number);
      cam.lookAt(pose.target[0] as number, pose.target[1] as number, pose.target[2] as number);
      cam.updateMatrixWorld(true);
      this.snapEye();
    } finally {
      cam.position.copy(savedPos);
      cam.quaternion.copy(savedQuat);
      cam.updateMatrixWorld(true);
      this.eyeClock = 1;
    }
  }

  /**
   * The trim for the room a still's pose stands in: up to three small stills of the pose itself, drawn with the real chain,
   * each moving the room's trim one step toward the lighting intent (the exposure the author set only biases it).
   */
  private async settleStillTrim(opts: StillOptions, open: (w: number, h: number, vignette: boolean) => CaptureSession): Promise<void> {
    if (!this.lightVolume.ready || (globalThis as { __NOTRIM?: boolean }).__NOTRIM || !opts.pose) return;
    const debug = (globalThis as { __TRIMLOG?: boolean }).__TRIMLOG === true;
    const w = 192;
    const h = Math.max(64, Math.round((w * opts.height) / Math.max(1, opts.width)));
    for (let i = -1; i < 3; i++) {
      this.adaptEyeToPose(opts.pose);
      const room = this.roomPick?.id;
      if (room === undefined || this.disposed || this.lost) return;
      let tiny: StillImage;
      try {
        tiny = await captureStill(open, { width: w, height: h, pose: opts.pose, frames: 1, vignetteStrength: opts.vignetteStrength ?? 0 });
      } catch {
        return;
      }
      // The first small still of a pose is a warm-up (the first frame of a session is not the converged picture): not read.
      if (i < 0) continue;
      const s = measurePixels(tiny.data, tiny.width, tiny.height);
      const cur = this.roomTrim.get(room) ?? 0;
      const next = nextTrim(cur, { mean: s.mean, high: s.high ?? 0, low: s.low ?? 0 }, this.trimIntent());
      if (debug) console.warn(`[trim] still room ${room} pass ${i} mean ${s.mean.toFixed(0)} high ${(s.high ?? 0).toFixed(3)} trim ${cur.toFixed(2)} -> ${next.toFixed(2)}`);
      if (next === cur) return;
      this.roomTrim.set(room, next);
    }
  }

  /** The eye adapts to the camera where it stands now at once (a cut): a capture is exposed for its own view. */
  private snapEye(): void {
    if (!this.lightVolume.ready) return;
    this.lastEye.set(Number.POSITIVE_INFINITY, 0, 0);
    this.eyeClock = 1;
    this.adaptEye(0);
  }

  private adaptEye(dt: number): void {
    this.eyeClock += dt;
    if (this.eyeClock < 0.08) return;
    const step = this.eyeClock;
    this.eyeClock = 0;
    if (this.ceilings === null) {
      const list: CeilingBox[] = [];
      if (this.archView.active) {
        const box = new Box3();
        this.grow.withFullScale(() => {
          this.sync.forEachNode((node) => {
            if (node.entity.arch?.role !== 'ceiling' || node.entity.template) return;
            box.setFromObject(node.object);
            if (!box.isEmpty()) list.push({ minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, y: box.min.y });
          });
        });
      }
      this.ceilings = list;
    }
    const p = this.perspective.position;
    const target = this.ceilings.length === 0 ? 0 : interiorFactor(p.x, p.y, p.z, this.ceilings);
    const sample = this.lightVolume.ready ? this.lightVolume.eyeSample(p.x, p.y, p.z) : null;
    // The room the eye stands in (or looks at through a cutaway) sets the exposure from its own light, measured once
    // for the whole room (see `view/room-exposure.ts`): not from the point the camera happens to be at.
    const rooms = this.lightVolume.ready ? this.ensureRoomLights() : null;
    let targetEv = 0;
    let targetBalance = 0;
    this.roomPick = null;
    if (rooms && rooms.boxes.length > 0) {
      this.perspective.getWorldDirection(_dir);
      const pick = this.roomSelect.select(rooms.boxes, p.x, p.y, p.z, [_dir.x, _dir.y, _dir.z], looksInside(this.archView.value));
      let ev = 0;
      let bal = 0;
      let main: { id: string; weight: number } | null = null;
      for (const sh of pick.shares) {
        const light = rooms.lights.get(sh.room.id);
        if (!light) continue;
        ev += light.ev * sh.weight;
        bal += light.balance * sh.weight;
        main ??= { id: sh.room.id, weight: sh.weight };
      }
      if (main) {
        this.roomPick = { ...main, subject: pick.subject };
        targetEv = ev;
        targetBalance = bal * Math.max(0, Math.min(1, targetEv / 1.5));
      }
    }
    if (this.roomPick === null && sample) {
      // Outside every room (a hall without a floor of its own, a stair, the garden): the spot's own reading, in the room range.
      targetEv = Math.max(ROOM_MIN_EV, Math.min(ROOM_MAX_EV, volumeExposure(sample, this.volumeOutdoor)));
      // Balance only as far as the eye has adapted to the room (outdoors the sky sets the white).
      targetBalance = interiorBalance(sample) * Math.max(0, Math.min(1, targetEv / 1.5));
    }
    // Under a roof by the ceilings, or by the volume itself (little sky seen from the eye).
    const inside = this.lightVolume.ready && (target > 0.5 || (sample !== null && sample.vis < 0.3));
    if (inside !== this.shadowInside) {
      this.shadowInside = inside;
      this.boundsDirty = true;
      this.sinceRefit = REFIT_INTERVAL;
    }
    // A camera that jumped (a cut, a teleport, a capture pose) sees with adapted eyes at once.
    const jumped = this.lastEye.distanceToSquared(p) > 2.25;
    this.lastEye.copy(p);
    const trimTarget = this.roomPick ? (this.roomTrim.get(this.roomPick.id) ?? 0) : 0;
    const trimDone = Math.abs(trimTarget - this.trimNow) < 0.01;
    if (Math.abs(target - this.eyeFactor) < 0.002 && Math.abs(targetEv - this.eyeEv) < 0.01 && Math.abs(targetBalance - this.eyeBalance) < 0.005 && trimDone) return;
    this.trimNow = jumped ? trimTarget : adaptStep(this.trimNow, trimTarget, step);
    this.eyeFactor = jumped ? target : adaptStep(this.eyeFactor, target, step);
    this.eyeEv = jumped ? targetEv : adaptStep(this.eyeEv, targetEv, step);
    this.eyeBalance = jumped ? targetBalance : adaptStep(this.eyeBalance, targetBalance, step);
    this.applyLook();
    this.needsDraw = true;
  }

  /** The render quality in effect. */
  get renderQuality(): RenderQuality {
    return this.qualityPlan.quality;
  }

  /** Studio quality can be used on this device and budget. */
  get studioQualityAvailable(): boolean {
    return !this.studioFailed && studioAvailable(this.budget);
  }

  /** Progress of the studio still refinement in [0, 1] (1 when idle or in realtime). */
  get refineProgress(): number {
    return this.refinement.progress;
  }

  /** Sun shadow map edge the current (or pending) post pipeline was built against. */
  private postShadowSize = 0;

  private applyQuality(quality: RenderQuality): RenderQuality {
    const before = this.qualityPlan.quality;
    this.shaftsUnavailable = false;
    this.restDeferred = false;
    this.motionFrameReady = false;
    this.qualityPlan = qualityPlan(quality, this.budget, this.gpu.tier === 'software', this.tierChoice === 'auto' ? this.autoTierNow() : this.tierChoice, { split: this.tierChoice === 'auto' && this.gpu.tier !== 'discrete', tierCap: this.tierChoice === 'auto' ? this.cuts.tierCap : null });
    const plan = this.qualityPlan;
    // The high and ultra tiers (and stills) light and reflect with a photographed sky.
    this.env.setAutoHdri(plan.tier === 'high' || plan.tier === 'ultra');
    this.env.sky.setDetail(plan.tier !== 'low');
    this.env.shadowMapCap = plan.shadowMapCap;
    this.env.sun.shadow.radius = plan.shadowRadius;
    this.voxelLayer?.setQuality(plan.tier);
    this.syncSmallCasters();
    // Each part of a character is a draw call in the shadow pass: fewer cast on the cheaper tiers.
    if (plan.tier === 'low') this.characters.setShadowLimits(3, 30);
    else if (plan.tier === 'medium') this.characters.setShadowLimits(10, 60);
    else this.characters.setShadowLimits(Number.POSITIVE_INFINITY);
    this.refinement.setFrames(plan.accumulateFrames);
    this.refinement.restart();
    this.adaptive.enabled = plan.adaptiveResolution && this.adaptiveWanted;
    if (!this.adaptive.enabled && this.adaptive.scale !== 1) this.adaptive.reset();
    this.resize(this.cssWidth, this.cssHeight);
    this.boundsDirty = true;
    this.needsDraw = true;
    if (plan.quality !== before) this.onQualityChange?.(plan.quality);
    return plan.quality;
  }

  /**
   * Keep the post pipeline only while it is used: its full-resolution
   * multisampled target and bloom chain are the largest GPU allocations, so
   * they are released as soon as a world (or low-memory mode) turns bloom
   * off and rebuilt asynchronously when it comes back.
   */
  private syncPost(): void {
    const want = this.wantedEffects();
    const wantKey = want ? effectsKey(want) : null;
    if (this.post && this.post.key !== wantKey) {
      if (this.postStash && this.postStash.key === wantKey) {
        // The other phase of the split chain is built already: swap, no work.
        const other = this.post;
        this.post = this.postStash;
        this.postStash = other;
        this.applyLook();
        if (this.vignetteOff) this.post.setVignette(0);
      } else if (want !== null && this.phaseKeys().includes(this.post.key)) {
        // The pipeline of the other phase draws until this one is built.
      } else {
        this.dropPost();
        this.applyLook();
      }
    }
    if (want === null || this.post?.key === wantKey || this.postPending) return;
    // The phase not in use is built while the first one draws: the first frame never waits for both.
    // The shafts march the sun's (outermost) shadow map, which three creates on the first draw that uses it: draw
    // directly until it exists (a world whose content receives no shadows never gets one: no shafts there).
    if (want.shafts && !this.env.shaftLight) {
      if (++this.shaftWait > SHAFT_WAIT_FRAMES) this.shaftsUnavailable = true;
      this.needsDraw = true;
      return;
    }
    this.shaftWait = 0;
    this.postPending = true;
    this.postShadowSize = this.env.shaftMapSize;
    const gen = ++this.postGen;
    const builtAt = this.postShadowSize;
    createPostPipeline(this.renderer, this.scene, this.perspective, this.env.bloom, postQualityOf(want) ?? 'standard', { effects: want, sun: this.env.shaftLight ?? this.env.sun, contactLight: this.env.sun, aoScale: this.qualityPlan.moveEffects !== null ? 0.5 : undefined })
      .then((p) => {
        this.postPending = false;
        if (!p) {
          this.postCreationFailed(want);
          return;
        }
        this.postBuiltSize.set(p, builtAt);
        const now = this.wantedEffects();
        if (gen !== this.postGen || this.disposed || !now) p.dispose();
        else if (effectsKey(now) === p.key) {
          // The pipeline that was drawing (the other phase of the split chain) is kept for the swap back.
          if (this.post && this.phaseKeys().includes(this.post.key)) {
            this.postStash?.dispose();
            this.postStash = this.post;
          } else this.post?.dispose();
          this.post = p;
          this.applyLook();
          if (this.vignetteOff) p.setVignette(0);
          this.requestPreparedFrame();
        } else if (this.phaseKeys().includes(p.key) && this.post && this.post.key !== p.key) {
          // The phase changed while it was building: keep it for the next swap.
          this.postStash?.dispose();
          this.postStash = p;
        } else p.dispose();
      })
      .catch(() => {
        this.postPending = false;
        this.postCreationFailed(want);
      });
  }

  /**
   * A pipeline could not be built (or crashed): drop the costliest effect that is on and rebuild
   * without it; when only the composite is left it is dropped too (direct rendering), and stills fall
   * back to realtime.
   */
  private postCreationFailed(effects: PostEffects): void {
    const next = degrade(effects);
    if (next) {
      this.failedEffects.add(next.dropped);
      log.warn(`post effect "${next.dropped}" disabled on this device`);
    } else {
      this.postFailed = true;
      if (this.qualityPlan.quality !== 'realtime') {
        this.studioFailed = true;
        this.applyQuality('realtime');
      }
    }
    this.needsDraw = true;
  }

  /** The effect keys of the two phases of the plan (the rest key alone when the chain does not split). */
  private phaseKeys(): string[] {
    const keys: string[] = [];
    for (const rest of [true, false]) {
      const e = this.effectsFor(rest);
      if (e) keys.push(effectsKey(e));
    }
    return keys;
  }

  /** Release the pipelines and invalidate a build in flight. */
  private dropPost(): void {
    this.post?.dispose();
    this.post = null;
    this.postStash?.dispose();
    this.postStash = null;
    this.postGen++;
  }

  /**
   * Motion and rest of the split studio chain. The view moves: the light chain draws and adaptive resolution holds the frame
   * rate. The view has rested for {@link REST_DELAY_MS}: full resolution and the full chain, which then refines frame by frame.
   */
  private syncRest(motion: boolean, animating: boolean): void {
    if (this.qualityPlan.moveEffects === null) {
      this.atRest = true;
      this.restAnimating = motion || animating;
      leanShading.value = this.forceLean === true ? 1 : 0;
      return;
    }
    const t = now();
    // A scene that animates while the view rests (people, water) draws the full chain every frame: when that is too slow it
    // keeps the light chain, and the view counts as moving.
    if (this.restDeferred) motion = true;
    if (motion) {
      this.lastChangeAt = t;
      if (this.atRest) {
        this.atRest = false;
        this.motionFrameReady = false;
        if (this.motionScale < 1 && this.adaptive.enabled) {
          this.adaptive.scale = this.motionScale;
          this.resize(this.cssWidth, this.cssHeight);
        }
      }
    } else if (!this.atRest && this.motionFrameReady && this.preparation.pending === 0 && this.programs.pending === 0 && t - this.lastChangeAt > REST_DELAY_MS) {
      this.atRest = true;
      this.restSlow = 0;
      this.refinement.restart();
      this.motionScale = this.adaptive.scale;
      if (this.adaptive.scale < 1) {
        this.adaptive.reset();
        this.resize(this.cssWidth, this.cssHeight);
      }
    }
    this.restAnimating = this.atRest && animating;
    // Camera input must not replace UV sampling or remove normal maps. Explicit diagnostic overrides still work.
    leanShading.value = this.forceLean === true ? 1 : 0;
  }

  /** The view is at rest and the content animates (frames at rest are not refinement frames). */
  private restAnimating = false;
  private restSlow = 0;
  /** The full chain was too slow for an animating scene at rest: the light chain stays (until the quality changes). */
  private restDeferred = false;

  private postFailed = false;
  /** Draws waited for the sun's shadow map before building a pipeline with shafts. */
  private shaftWait = 0;
  /** The sun has no shadow map to march through (nothing receives its shadows): the shafts stay off until the environment or quality changes. */
  private shaftsUnavailable = false;

  /**
   * Bring the static-prop batches up to date before any draw: regroup after
   * content changes (so a removed prop's geometry is never drawn) and copy
   * member transforms. World matrices are updated first only when batches
   * exist (the renderer would otherwise do it inside render()).
   */
  private prepareBatches(capture = false): void {
    if (!this.sync.batchesActive) return;
    this.scene.updateMatrixWorld();
    if (capture) this.sync.synchronousBatches(() => this.sync.updateBatches());
    else this.sync.updateBatches();
  }

  /**
   * Draw one frame. `capture` marks an off-screen view (critique views,
   * thumbnails): scatter fields and virtual geometry then re-plan for that
   * camera immediately, never throttled.
   */
  private draw(capture = false): void {
    if (capture) return this.presentation.synchronous(() => this.preparation.synchronous(() => this.programs.synchronous(() => this.drawReady(capture))));
    this.drawReady(capture);
  }

  private drawReady(capture = false): void {
    // The post chain's scene passes update once per node frame, and the node frame advances once per animation frame:
    // a capture drawn in the same frame as the viewport (another aspect, another size, a camera moved a moment ago) would
    // reuse the viewport's scene pass and only re-composite it, stretched. Advance the frame so the capture renders fresh.
    if (capture) this.advanceNodeFrame();
    if (capture) this.prepareBatches(true);
    // Scatter fields and virtual geometry re-plan for whatever camera draws this frame
    // (the viewport, or a capture view), only when the view or content changed.
    if (this.viewChanged() || this.sync.viewNeedsUpdate) {
      const target = this.renderer.getOutputRenderTarget();
      const height = target ? target.height : Math.round(this.cssHeight * this.renderer.getPixelRatio());
      if (this.sync.updateView(this.perspective, Math.max(1, height), capture ? 0 : now(), this.viaPassApplied && this.adaptive.scale < 0.8 ? VIEW_INTERVAL_SCALED_MS : VIEW_INTERVAL_MS)) this.sunMapSoft = true;
    }
    // A resized sun shadow map reallocates its textures on the next draw; shafts built against the old
    // ones would sample destroyed textures. Drop the pipeline, draw once directly, and let it rebuild.
    const mapSize = this.env.shaftMapSize;
    const stale = (p: PostPipeline | null): boolean => p !== null && p.effects.shafts && this.postBuiltSize.get(p) !== mapSize;
    if (stale(this.postStash)) {
      this.postStash?.dispose();
      this.postStash = null;
    }
    if ((this.postPending && this.postShadowSize !== mapSize) || stale(this.post)) {
      this.dropPost();
      this.postPending = false;
      this.postShadowSize = this.env.shaftMapSize;
      this.renderer.render(this.scene, this.perspective);
      this.needsDraw = true;
      return;
    }
    this.syncPost();
    this.syncSceneScale();
    this.aimSunShadows(capture);
    // Water joins the depth pre-pass (and so the screen-space reflections) while they run.
    const reflective = this.post?.effects.ssr === true;
    if (reflective !== this.materials.waterIsReflective) this.materials.setReflectiveWater(reflective);
    const waterVisible = this.water.all.length > 0 && (this.materials.backdrop.used || this.materials.mirror.used)
      && this.sync.hasVisibleWater(this.perspective);
    this.renderBackdrop(waterVisible);
    this.renderMirror(waterVisible);
    try {
      if (this.post) {
        // Depth of field focuses on the orbit target (allocation-free: scratch vectors).
        if (this.post.effects.dof) {
          this.rig.getTarget(_target);
          this.post.setFocus(this.perspective.position.distanceTo(_target));
        }
        // The shafts node reads the sun shadow map's textures when its shader is built: the map must exist.
        // Content that never receives shadows (block terrain) has none: drop the shafts for this world.
        if (this.post.effects.shafts && !this.env.shaftLight) {
          this.renderer.render(this.scene, this.perspective);
          if (!this.env.shaftLight) {
            this.shaftsUnavailable = true;
            this.dropPost();
            this.needsDraw = true;
            return;
          }
        }
        this.post.render();
      } else this.renderer.render(this.scene, this.perspective);
    } catch (e) {
      // A post pipeline failure must not kill the viewport: drop post and keep rendering directly.
      if (this.post) {
        log.warn(`post-processing (${effectsKey(this.post.effects)}) failed: ${errorMessage(e)}`);
        const effects = this.post.effects;
        this.dropPost();
        this.postCreationFailed({ ...effects });
      } else {
        throw e;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Publishing: posed captures, stills, glTF, camera paths
  // ---------------------------------------------------------------------------

  /** Change the extra pixel-ratio cap (quality settings of published games; Infinity removes it). */
  setPixelRatioCap(cap: number): void {
    const next = Number.isFinite(cap) && cap > 0 ? Math.max(0.5, cap) : Number.POSITIVE_INFINITY;
    if (next === this.ratioCap) return;
    this.ratioCap = next;
    this.resize(this.cssWidth, this.cssHeight);
  }

  /** True while an exclusive capture (video or still export) runs. */
  get capturing(): boolean {
    return this.captureActive;
  }

  /**
   * Start an exclusive capture at `width`×`height` pixels (see
   * `view/capture-session.ts`): the viewport stops drawing until the
   * session ends. Throws while another capture runs.
   */
  beginCapture(width: number, height: number, opts: { vignette?: boolean } = {}): CaptureSession {
    if (this.disposed || this.lost) throw new Error(this.lost ? 'GPU context lost' : 'renderer disposed');
    if (this.captureActive || this.capture) throw new Error('a capture is already running');
    const session = openCaptureSession(this.captureHost(), width, height, opts);
    this.capture = session;
    return session;
  }

  /**
   * Resolve once the post-processing pipeline the current quality wants
   * exists (it is built asynchronously), so the first captured frames get
   * the same look as the viewport. Gives up after `timeoutMs`.
   */
  async preparePost(timeoutMs = 8000): Promise<void> {
    const deadline = now() + timeoutMs;
    this.syncPost();
    while (!this.disposed && this.postPending && now() < deadline) await new Promise((r) => setTimeout(r, 16));
    await this.waitForPreparation();
  }

  /**
   * Render a path-traced still (global illumination, soft area lights, glass, depth of field): a
   * progressive physically based render on a private WebGL2 context, in its own module that is only
   * downloaded now. The viewport pauses while it runs. Rejects when cancelled (`AbortError`), when a render
   * is already running or when the scene is too large; see `view/pathtrace.ts`.
   */
  async pathTraceStill(opts: PathTraceOptions & { pose: CameraPose }): Promise<StillImage> {
    if (this.disposed || this.lost) throw new Error(this.lost ? 'GPU context lost' : 'renderer disposed');
    if (this.captureActive || this.capture || this.tracing) throw new Error('a render is already running');
    this.tracing = true;
    let exported: ReturnType<typeof buildExportScene> | null = null;
    try {
      const { runPathTrace, MAX_PATH_TRACE_TRIANGLES } = await import('./view/pathtrace');
      this.grow.finishAll();
      if (this.boundsDirty) this.refresh();
      this.scene.updateMatrixWorld(true);
      const cam = this.perspective.clone();
      const pose = opts.pose;
      if (pose.pos.every(Number.isFinite) && pose.target.every(Number.isFinite)) {
        cam.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
        cam.up.set(0, 1, 0);
        cam.lookAt(pose.target[0], pose.target[1], pose.target[2]);
      }
      if (pose.fov !== undefined && Number.isFinite(pose.fov)) cam.fov = Math.min(120, Math.max(5, pose.fov));
      cam.zoom = 1;
      cam.clearViewOffset();
      cam.updateMatrixWorld(true);
      // The tracer's WebGL2 context samples compressed library textures as they are (when it supports their format).
      exported = buildExportScene(this.sync.root, this.perspective, MAX_PATH_TRACE_TRIANGLES, 'keep');
      if (exported.meshes === 0) throw new Error('nothing to render');
      if (exported.skipped > 0) log.warn(`path trace: ${exported.skipped} meshes left out (triangle budget ${MAX_PATH_TRACE_TRIANGLES})`);
      const lights: Light[] = [this.env.sun];
      this.sync.root.traverse((o) => {
        if ((o as Light).isLight) lights.push(o as Light);
      });
      const target = new Vector3(pose.target[0], pose.target[1], pose.target[2]);
      const look = this.look;
      const exposure = this.env.exposure * evScale(look.exposureEv);
      const dofRequested = opts.fStop !== undefined;
      return await runPathTrace(
        {
          content: exported.root,
          lights,
          camera: cam,
          environment: (this.scene.environment as Texture | null) ?? null,
          skyColor: this.env.skyState.horizon,
          environmentIntensity: this.scene.environmentIntensity,
          environmentRotationY: this.scene.environmentRotation.y,
          toneMapping: look.tone,
          exposure,
        },
        { ...opts, ...(dofRequested ? { focusDistance: opts.focusDistance ?? cam.position.distanceTo(target) } : {}) },
      );
    } finally {
      exported?.dispose();
      this.tracing = false;
      this.needsDraw = true;
    }
  }

  /** True while a path-traced still renders (the viewport does not draw). */
  get pathTracing(): boolean {
    return this.tracing;
  }

  private tracing = false;

  /** How a `width`×`height` still of `quality` should be drawn on this GPU (single draw, supersampling, samples). */
  planStill(width: number, height: number, quality: 'studio' | 'final'): StillPlan {
    return stillPlan(width, height, quality, this.gpu.tier);
  }

  /** Render a still image up to 8192 px on the long side (tiled above the tile size). */
  async renderStill(opts: StillOptions): Promise<StillImage> {
    await this.preparePost();
    const open = (w: number, h: number, vignette: boolean): CaptureSession => this.beginCapture(w, h, { vignette });
    opts = { ...opts, vignetteStrength: this.vignetteStrength() };
    await this.settleStillTrim(opts, open);
    this.adaptEyeToPose(opts.pose);
    const image = await captureStill(open, opts);
    // The first capture after a post pipeline is (re)built can come out as one flat colour on some software GPUs
    // (temporal AA history primed at the viewport size); an identical second render is right. Render once more.
    if (this.post && !this.disposed && !this.lost && isFlat(image.data)) {
      log.warn('still came out as one flat colour: rendering it again');
      return captureStill(open, opts);
    }
    return image;
  }

  /** Export the drawn scene content as GLB (or glTF JSON); see `view/gltf-export.ts`. */
  async exportGltf(opts: GltfExportOptions = {}): Promise<GltfExportResult> {
    if (this.disposed) throw new Error('renderer disposed');
    this.grow.finishAll();
    return exportSceneGltf(this.sync.root, this.perspective, opts);
  }

  /** Place the editor camera at `pos` looking at `target` (immediately), optionally with a field of view. */
  lookAt(pos: Vec3, target: Vec3, fov?: number): void {
    if (this.disposed || !pos.every(Number.isFinite) || !target.every(Number.isFinite)) return;
    _pos.set(pos[0], pos[1], pos[2]);
    _target.set(target[0], target[1], target[2]);
    this.rig.flyTo(_pos, _target, 0);
    if (fov !== undefined && Number.isFinite(fov) && Math.abs(fov - this.perspective.fov) > 1e-6) {
      this.perspective.fov = Math.min(120, Math.max(5, fov));
      this.perspective.updateProjectionMatrix();
    }
    this.needsDraw = true;
  }

  /** The editor camera now: eye, orbit target and vertical field of view. */
  cameraPose(): { pos: Vec3; target: Vec3; fov: number } {
    const p = this.perspective.position;
    return { pos: [p.x, p.y, p.z], target: this.orbitTarget(), fov: this.perspective.fov };
  }

  /** Lowest height the camera may take over the ground (presets use it). */
  get cameraFloorY(): number {
    return this.rig.floorY;
  }

  /** Draw a camera path over the viewport (sampled eye points, keys as eye+target), or hide it with null. */
  showCameraPath(points: Float32Array | null, keys: Float32Array | null, markerSize?: number): void {
    this.pathOverlay.set(points, keys, markerSize);
    this.needsDraw = true;
  }

  /** The renderer side of capture sessions. */
  private captureHost(): CaptureHost {
    let hidden: Object3D[] = [];
    let wasVisible: boolean[] = [];
    let savedRatio = 1;
    let adaptive = false;
    return {
      camera: this.perspective,
      flipY: this.backend === 'webgl2',
      alive: () => !this.disposed && !this.lost,
      ready: () => this.waitForPreparation(),
      begin: (w, h, vignette) => {
        this.captureActive = true;
        this.rig.stopTour();
        this.grow.finishAll();
        hidden = [this.highlighter.group, this.editOverlay.group, this.pathOverlay.group, this.debug.group, this.ghost.root, ...this.editComponentGroups(), ...(this.gizmo?.helper ? [this.gizmo.helper] : [])];
        wasVisible = hidden.map((o) => o.visible);
        for (const o of hidden) o.visible = false;
        savedRatio = this.renderer.getPixelRatio();
        adaptive = this.adaptive.enabled;
        this.adaptive.enabled = false;
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(w, h, false);
        this.vignetteOff = !vignette;
        this.post?.setVignette(vignette ? this.vignetteStrength() : 0);
        if (this.boundsDirty) this.refresh();
      },
      advance: (dt) => {
        if (this.boundsDirty) this.refresh();
        const vox = this.voxelLayer;
        if (vox) {
          const tf = this.env.terrainFog;
          vox.setFog(tf.color, tf.near, tf.far, tf.density);
          this.syncVoxelSky(vox);
          vox.flushPrebuild();
        }
        this.stepAnimations(dt);
        this.stepWater(dt, true);
        this.archView.update(this.perspective, dt);
        this.env.update(dt, this.perspective);
        if (this.materials.surfaces.active) this.materials.surfaces.advance(dt);
      },
      drawToTarget: (w, h) => {
        const rt = this.captureTarget(w, h);
        const prevOutput = this.renderer.getOutputRenderTarget();
        const prevTarget = this.renderer.getRenderTarget();
        try {
          this.renderer.setOutputRenderTarget(rt);
          this.renderer.setRenderTarget(null);
          if (this.vignetteOff) this.post?.setVignette(0);
          this.draw(true);
        } finally {
          this.renderer.setOutputRenderTarget(prevOutput);
          this.renderer.setRenderTarget(prevTarget);
        }
      },
      readback: (w, h) => {
        if (this.vignetteOff) this.post?.setVignette(0);
        return this.renderToPixels(w, h, () => this.draw(true), () => undefined);
      },
      finish: () => {
        hidden.forEach((o, i) => (o.visible = wasVisible[i] ?? true));
        this.vignetteOff = false;
        this.post?.setVignette(this.vignetteStrength());
        this.adaptive.enabled = adaptive;
        this.captureActive = false;
        this.capture = null;
        if (!this.disposed) {
          this.renderer.setPixelRatio(savedRatio);
          const [cw, ch] = this.pendingResize ?? [this.cssWidth, this.cssHeight];
          this.pendingResize = null;
          this.resize(cw, ch);
        }
        this.needsDraw = true;
      },
    };
  }

  /** A tiled capture runs: the screen-space vignette is applied on the CPU instead. */
  private vignetteOff = false;

  /** Captures wait for pending context-sensitive setup before changing targets or cameras. */
  private async waitForPreparation(): Promise<void> {
    this.prepareBatches();
    await this.sync.waitForBatches();
    await this.preparation.idle();
    await this.programs.idle();
  }

  /** Advance the node frame (see {@link draw}); a no-op if the renderer does not expose it. */
  private advanceNodeFrame(): void {
    const frame = (this.renderer as unknown as { _nodes?: { nodeFrame?: { update?: () => void } } })._nodes?.nodeFrame;
    if (typeof frame?.update === 'function') frame.update();
  }

  /** Resolve once `count` frames have been drawn (or after `timeoutMs`). */
  private waitForFrames(count: number, timeoutMs: number): Promise<void> {
    if (this.framesDrawn >= count || typeof setTimeout !== 'function') return Promise.resolve();
    this.needsDraw = true;
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = (): void => {
        if (this.disposed || this.lost || this.framesDrawn >= count || Date.now() - started > timeoutMs) resolve();
        else setTimeout(tick, 30);
      };
      tick();
    });
  }

  /**
   * Capture the current view as a data URL (JPEG quality 0.8 by default). A capture that comes back blank (programs still
   * compiling on a busy or cold GPU) is retried after a few more frames, up to three attempts.
   */
  async screenshot(opts: { width?: number; height?: number; mime?: string } = {}): Promise<string> {
    if (this.disposed || this.lost) throw new Error(this.lost ? 'GPU context lost' : 'renderer disposed');
    if (this.captureActive) throw new Error('a capture is running');
    // A capture asked for before the viewport has shown a few frames would draw into targets whose pipelines are still
    // compiling and come back black: let the normal loop run first (bounded; a hidden tab simply captures what it has).
    await this.waitForFrames(3, 2500);
    // The eye adapts to where the camera is now (a pose set just before the capture may not have had a frame yet).
    this.eyeClock = 1;
    this.adaptEye(0);
    await this.compileForCapture();
    const mime = captureMime(opts.mime);
    let last = '';
    for (let attempt = 0; attempt < MAX_BLANK_RETRIES; attempt++) {
      if (this.disposed || this.lost) throw new Error(this.lost ? 'GPU context lost' : 'renderer disposed');
      const shot = await this.captureOnce(opts.width, opts.height, mime);
      last = shot.url;
      if (!shot.blank) return shot.url;
      log.warn(`capture ${attempt + 1} was blank, retrying`);
      await this.waitForFrames(this.framesDrawn + 3, 1500);
    }
    return last;
  }

  /** Wait (bounded) until the scene's programs are compiled, so the first capture does not draw nothing. */
  private async compileForCapture(): Promise<void> {
    try {
      await Promise.race([this.renderer.compileAsync(this.scene, this.perspective, this.scene), new Promise<void>((resolve) => setTimeout(resolve, 4000))]);
    } catch (e) {
      log.warn(`compile before capture failed: ${errorMessage(e)}`);
    }
    await this.waitForPreparation();
  }

  private async captureOnce(width: number | undefined, height: number | undefined, mime: string): Promise<{ url: string; blank: boolean }> {
    await this.waitForPreparation();
    const canvas = this.domElement;
    const w = captureSize(width, canvas.width);
    const h = captureSize(height, Math.round((w * canvas.height) / Math.max(1, canvas.width)));
    // Captures (agent critique, project thumbnails) show the world itself: no selection box, no gizmo.
    const decorations: Object3D[] = [this.highlighter.group, this.editOverlay.group, this.proof.group, this.ghostRun.group, this.blueprint.group, this.pathOverlay.group, ...(this.proofSync ? [this.proofSync.root] : []), ...this.editComponentGroups(), ...(this.gizmo?.helper ? [this.gizmo.helper] : [])];
    const wasVisible = decorations.map((o) => o.visible);
    for (const o of decorations) o.visible = false;
    const aspect = this.perspective.aspect;
    try {
      // The post chain renders its scene passes at the drawing buffer's size: a capture of another aspect (a 16:9 still of a
      // portrait panel) or one larger than the viewport would be stretched or upscaled, so the buffer is resized for the frame.
      const sameAspect = !captureNeedsResize(w, h, canvas.width, canvas.height);
      if (!this.asyncCaptureFailed) {
        try {
          // Asynchronous readback: the GPU renders and copies while the page keeps running. A capture of another aspect or size
          // renders into a target of its own size while the drawing buffer is resized for the frame (the readback is of the
          // target, never of the canvas: a WebGPU canvas read back in the same task comes back empty).
          const shoot = (): Promise<Uint8Array> =>
            this.renderToPixels(w, h, () => {
              this.perspective.aspect = w / h;
              this.perspective.updateProjectionMatrix();
              // Same look as the viewport (bloom, vignette): the post pipeline writes to the output target too.
              this.draw(true);
            }, () => {
              this.perspective.aspect = aspect;
              this.perspective.updateProjectionMatrix();
              decorations.forEach((o, i) => (o.visible = wasVisible[i] ?? true));
            });
          const pixels = await this.grow.withFullScale(() => (sameAspect ? shoot() : this.withTemporarySize(w, h, shoot)));
          const url = await encodePixels(pixels, w, h, mime, this.backend === 'webgl2', (this.encodeCanvas ??= document.createElement('canvas')));
          return { url, blank: pixelsAreBlank(pixels) };
        } catch (e) {
          this.asyncCaptureFailed = true;
          log.warn(`asynchronous capture unavailable, using canvas readback: ${errorMessage(e)}`);
          for (const o of decorations) o.visible = false;
        }
      }
      // Captures always show the finished world, never a mid-grow frame.
      return this.grow.withFullScale(() =>
        this.withTemporarySize(w, h, () => {
          this.perspective.aspect = w / h;
          this.perspective.updateProjectionMatrix();
          this.draw(true);
          return { url: grab(canvas, w, h, mime), blank: canvasIsBlank(canvas) };
        }),
      );
    } finally {
      decorations.forEach((o, i) => (o.visible = wasVisible[i] ?? true));
    }
  }

  /**
   * Render into the reusable capture target, with the same tone mapping and
   * output color space as the screen (the target is set as the renderer's
   * output target), and start an asynchronous readback. `restore` runs
   * synchronously right after the draw is submitted, so the next animation
   * frame renders the normal view; only the readback is awaited (WebGPU
   * buffer mapping, WebGL2 pixel-buffer + fence), so a slow GPU never
   * freezes the page. Returns RGBA8 pixels.
   */
  private renderToPixels(w: number, h: number, draw: () => void, restore: () => void): Promise<Uint8Array> {
    const rt = this.captureTarget(w, h);
    const r = this.renderer;
    const prevOutput = r.getOutputRenderTarget();
    const prevTarget = r.getRenderTarget();
    let pending: Promise<unknown>;
    try {
      r.setOutputRenderTarget(rt);
      r.setRenderTarget(null);
      draw();
      pending = r.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
    } finally {
      r.setOutputRenderTarget(prevOutput);
      r.setRenderTarget(prevTarget);
      restore();
      this.needsDraw = true;
    }
    return pending.then((data) => {
      if (!(data instanceof Uint8Array) || data.length < w * h * 4) throw new Error('unexpected capture pixel format');
      return data;
    });
  }

  /** The reusable capture target of size w×h (LRU of {@link MAX_CAPTURE_TARGETS}). */
  private captureTarget(w: number, h: number): RenderTarget {
    const key = `${w}x${h}`;
    let rt = this.captureTargets.get(key);
    if (rt) {
      // Most recently used last.
      this.captureTargets.delete(key);
    } else {
      rt = new RenderTarget(w, h, { depthBuffer: true, generateMipmaps: false });
      if (this.captureTargets.size >= MAX_CAPTURE_TARGETS) {
        const [oldestKey, oldest] = this.captureTargets.entries().next().value as [string, RenderTarget];
        this.captureTargets.delete(oldestKey);
        oldest.dispose();
      }
    }
    this.captureTargets.set(key, rt);
    return rt;
  }

  /**
   * A camera placed from bounds alone (a hero shot) can sit inside a cliff or under the terrain and draw nothing. Like a
   * spring arm: a solid surface between the target and the camera, in the camera's end of the line, pulls the camera in front of
   * it; a camera with no surface anywhere below it is under the ground and is lifted to eye height above the surface there; a
   * camera whose view is stopped short by a wall moves round the target to the first side that sees it.
   */
  private clearPose<P extends { position: Vec3; target: Vec3 }>(pose: P): P {
    const [tx, ty, tz] = pose.target;
    let [x, y, z] = pose.position;
    const dx = x - tx, dy = y - ty, dz = z - tz;
    const dist = Math.hypot(dx, dy, dz);
    if (!(dist > 1)) return pose;
    const hit = this.raycastWorld([tx, ty + 0.5, tz], [dx, dy, dz], dist);
    if (hit) {
      const along = Math.hypot(hit.point[0] - tx, hit.point[1] - ty, hit.point[2] - tz);
      if (along > dist * 0.5) {
        const back = Math.max(0, along - 1.5) / dist;
        [x, y, z] = [tx + dx * back, ty + dy * back, tz + dz * back];
      }
    }
    const lift = (px: number, py: number, pz: number): number => {
      if (this.raycastWorld([px, py + 0.2, pz], [0, -1, 0], 4000)) return py;
      const top = this.raycastWorld([px, py + 3000, pz], [0, -1, 0], 6000);
      return top ? top.point[1] + 1.7 : py;
    };
    y = lift(x, y, z);
    // How far the camera sees toward the target before something solid stops the view (1: the whole way).
    const open = (px: number, py: number, pz: number): number => {
      const d = Math.hypot(tx - px, ty - py, tz - pz);
      const h = this.raycastWorld([px, py, pz], [tx - px, ty - py, tz - pz], d);
      return h ? Math.hypot(h.point[0] - px, h.point[1] - py, h.point[2] - pz) / d : 1;
    };
    // A wall right in front of the lens (a street shot facing a terrace): walk round the target at the same distance and height
    // and take the first side with a clear view, else the side that sees farthest.
    if (open(x, y, z) < 0.6) {
      const rx = x - tx, rz = z - tz;
      let best: { x: number; y: number; z: number; o: number } = { x, y, z, o: open(x, y, z) };
      for (const deg of [25, -25, 50, -50, 80, -80, 115, -115, 150, -150, 180]) {
        const a = (deg * Math.PI) / 180;
        const cx = tx + rx * Math.cos(a) - rz * Math.sin(a);
        const cz = tz + rx * Math.sin(a) + rz * Math.cos(a);
        const cy = lift(cx, y, cz);
        const o = open(cx, cy, cz);
        if (o > best.o) best = { x: cx, y: cy, z: cz, o };
        if (o >= 0.95) break;
      }
      [x, y, z] = [best.x, best.y, best.z];
    }
    // Something right at the lens but off the centre line (a rail, a plank, a branch filling the lower half of the frame):
    // move the camera toward its target, then up, until nothing solid sits within a few metres across the frame.
    // Unlike the opaque sight test, every drawn surface counts here: alpha-cut leaves and glass at the lens spoil a shot too.
    const opaque = sceneSightTest(this.sync);
    const lensRay = new Raycaster();
    lensRay.layers.enable(BATCHED_LAYER);
    const lensHits: Intersection[] = [];
    const sight = (from: Vec3, to: Vec3): number => {
      let free = opaque(from, to);
      // A camera standing inside a tree's occluder box enters it at distance 0, which the sight test ignores: the same ray
      // traced back toward the lens meets the box on its far side.
      const back = opaque(to, from);
      const span = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      if (back < span && span - back < free) free = Math.max(0, span - back);
      const d = new Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      const len = d.length();
      lensRay.set(new Vector3(from[0], from[1], from[2]), d.normalize());
      lensRay.near = 0.25;
      lensRay.far = len;
      lensHits.length = 0;
      lensRay.intersectObject(this.sync.root, true, lensHits);
      for (const h of lensHits) {
        let shown = true;
        for (let o: Object3D | null = h.object; o; o = o.parent) if (!o.visible) shown = false;
        if (!shown || h.object.name === 'edit:components') continue;
        if (h.distance < free) free = h.distance;
        break;
      }
      lensHits.length = 0;
      return free;
    };
    const fov = ((pose as { fov?: number }).fov ?? 60) * (Math.PI / 180);
    const near = (px: number, py: number, pz: number): number => {
      const fx = tx - px, fy = ty - py, fz = tz - pz;
      const fl = Math.hypot(fx, fy, fz) || 1;
      const f: Vec3 = [fx / fl, fy / fl, fz / fl];
      let r: Vec3 = [-f[2], 0, f[0]];
      const rl = Math.hypot(r[0], r[2]) || 1;
      r = [r[0] / rl, 0, r[2] / rl];
      const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      const tv = Math.tan(fov / 2) * 0.85, th = tv * 1.5;
      let blocked = 0;
      for (const sy of [-1, 0, 1]) for (const sx of [-1, 0, 1]) {
        const d: Vec3 = [f[0] + r[0] * sx * th + u[0] * sy * tv, f[1] + r[1] * sx * th + u[1] * sy * tv, f[2] + r[2] * sx * th + u[2] * sy * tv];
        const dl = Math.hypot(d[0], d[1], d[2]);
        const reach = Math.min(LENS_CLEAR, fl * 0.5);
        if (sight([px, py, pz], [px + (d[0] / dl) * reach, py + (d[1] / dl) * reach, pz + (d[2] / dl) * reach]) < reach) blocked++;
      }
      return blocked;
    };
    if (near(x, y, z) > 0) {
      const fx = tx - x, fy = ty - y, fz = tz - z;
      let best = { x, y, z, n: near(x, y, z) };
      search: for (const up of [0, 2, 5]) {
        for (const t of [0, 0.1, 0.2, 0.3, 0.4]) {
          const cx = x + fx * t, cz = z + fz * t;
          const cy = lift(cx, y + fy * t + up, cz);
          const n = near(cx, cy, cz);
          if (n < best.n) best = { x: cx, y: cy, z: cz, n };
          if (n === 0) break search;
        }
      }
      [x, y, z] = [best.x, best.y, best.z];
    }
    return { ...pose, position: [x, y, z] as Vec3 };
  }

  /**
   * Perspective captures from explicit camera poses (world space), for reviewing interiors: the AI's
   * corner, wall and plan views. Each image is `width`×`height` pixels; the main camera is restored
   * afterwards. Editing decorations are hidden; fog, sky and lights stay as the viewport shows them.
   */
  async capturePoses(
    poses: ReadonlyArray<{ position: Vec3; target: Vec3; up: Vec3; fov: number; clear?: boolean }>,
    opts: { width?: number; height?: number; mime?: string } = {},
  ): Promise<string[]> {
    await this.waitForPreparation();
    if (this.disposed || this.lost) throw new Error(this.lost ? 'GPU context lost' : 'renderer disposed');
    if (this.captureActive) throw new Error('a capture is running');
    const list = (Array.isArray(poses) ? poses : []).slice(0, MAX_VIEWS * 2).map((p) => (p.clear ? this.clearPose(p) : p));
    if (list.length === 0) return [];
    const w = captureSize(opts.width, 768);
    const h = captureSize(opts.height, 512);
    const mime = captureMime(opts.mime);
    const cam = this.perspective;
    _savedCamPos.copy(cam.position);
    _savedCamQuat.copy(cam.quaternion);
    _savedCamUp.copy(cam.up);
    const saved = { fov: cam.fov, aspect: cam.aspect, near: cam.near, far: cam.far, zoom: cam.zoom };
    const decorations: Object3D[] = [this.highlighter.group, this.debug.group, this.ghost.root, this.editOverlay.group, this.proof.group, this.ghostRun.group, this.blueprint.group, this.pathOverlay.group, ...(this.proofSync ? [this.proofSync.root] : []), ...this.editComponentGroups(), ...(this.gizmo?.helper ? [this.gizmo.helper] : [])];
    const wasVisible = decorations.map((o) => o.visible);
    for (const o of decorations) o.visible = false;
    const restoreCamera = (): void => {
      cam.position.copy(_savedCamPos);
      cam.quaternion.copy(_savedCamQuat);
      cam.up.copy(_savedCamUp);
      cam.fov = saved.fov;
      cam.aspect = saved.aspect;
      cam.near = saved.near;
      cam.far = saved.far;
      cam.zoom = saved.zoom;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
    };
    const restore = (): void => {
      decorations.forEach((o, i) => (o.visible = wasVisible[i] ?? true));
      restoreCamera();
      // The live eye was exposed for the last pose: it adapts back to where the viewport stands.
      this.eyeClock = 1;
    };
    const aim = (pose: { position: Vec3; target: Vec3; up: Vec3; fov: number }): void => {
      cam.fov = Math.max(20, Math.min(120, pose.fov));
      cam.aspect = w / h;
      cam.zoom = 1;
      cam.near = 0.05;
      // A camera far from the world (the overview of a large place) needs a far plane that reaches it: a fixed 400 m drew black.
      // It also never cuts the camera-centred sky dome (as the live camera's never does), or the sky behind a big world is black.
      cam.far = Math.min(6000, Math.max(SKY_RADIUS * 2.5, Math.hypot(pose.target[0] - pose.position[0], pose.target[1] - pose.position[1], pose.target[2] - pose.position[2]) * 2.5));
      cam.position.set(pose.position[0], pose.position[1], pose.position[2]);
      cam.up.set(pose.up[0], pose.up[1], pose.up[2]);
      cam.lookAt(pose.target[0], pose.target[1], pose.target[2]);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
    };
    // Pipelines and materials the poses need compile on their first draw and that frame can come out blank (a new generator, a
    // camera that sees a new surface): the poses are drawn once to prime them and the frames of that pass are dropped.
    const pass = async (): Promise<string[]> => {
      const out: string[] = [];
      for (const pose of list) {
        if (!this.asyncCaptureFailed) {
          try {
            await this.settleTrim(() => {
              aim(pose);
              this.snapEye();
            }, 192, Math.max(64, Math.round((192 * h) / w)));
            const pixels = await this.grow.withFullScale(() =>
              this.renderToPixels(w, h, () => {
                aim(pose);
                this.snapEye();
                this.prepareBatches(true);
                this.fx.vfx.face(cam);
                this.renderer.render(this.scene, cam);
              }, restoreCamera),
            );
            out.push(await encodePixels(pixels, w, h, mime, this.backend === 'webgl2', (this.encodeCanvas ??= document.createElement('canvas'))));
            continue;
          } catch (e) {
            this.asyncCaptureFailed = true;
            log.warn(`asynchronous capture unavailable, using canvas readback: ${errorMessage(e)}`);
          }
        }
        out.push(
          this.grow.withFullScale(() =>
            this.withTemporarySize(w, h, () => {
              aim(pose);
              this.snapEye();
              this.prepareBatches(true);
              this.fx.vfx.face(cam);
              this.renderer.render(this.scene, cam);
              const image = grab(this.domElement, w, h, mime);
              restoreCamera();
              return image;
            }),
          ),
        );
      }
      return out;
    };
    try {
      await pass();
      return await pass();
    } finally {
      restore();
      this.needsDraw = true;
    }
  }

  /** Orthographic top/front/side/iso captures framing the scene (for VLM critique). */
  async renderViews(views: Array<'top' | 'front' | 'side' | 'iso'>, size = 512): Promise<string[]> {
    await this.waitForPreparation();
    if (this.disposed || this.lost) throw new Error(this.lost ? 'GPU context lost' : 'renderer disposed');
    if (this.captureActive) throw new Error('a capture is running');
    const list = (Array.isArray(views) ? views : []).filter((v): v is CaptureView => VIEW_NAMES.has(v)).slice(0, MAX_VIEWS);
    if (list.length === 0) return [];
    const px = captureSize(size, 512);
    this.grow.withFullScale(() => this.sync.computeBounds(_bounds));
    const bounds = _bounds.isEmpty() ? null : { min: _bounds.min.toArray() as Vec3, max: _bounds.max.toArray() as Vec3 };
    // The main camera, re-aimed per view and restored below (see telephotoPose for why not a second camera).
    const cam = this.perspective;
    _savedCamPos.copy(cam.position);
    _savedCamQuat.copy(cam.quaternion);
    _savedCamUp.copy(cam.up);
    const saved = { fov: cam.fov, aspect: cam.aspect, near: cam.near, far: cam.far, zoom: cam.zoom };
    // Hide view-dependent decorations; give the background a flat sky color.
    const hidden: Object3D[] = [this.env.sky.group, this.highlighter.group, this.debug.group, this.ghost.root, this.editOverlay.group, this.proof.group, this.ghostRun.group, this.blueprint.group, this.pathOverlay.group, ...(this.proofSync ? [this.proofSync.root] : []), ...this.editComponentGroups(), ...(this.gizmo?.helper ? [this.gizmo.helper] : [])];
    const wasVisible = hidden.map((o) => o.visible);
    // Neutralize fog through its density uniform: removing it (scene.fog = null) changes every
    // material's shader, and each capture then built a fog-less variant of every object's GPU
    // state, which Firefox reclaims only lazily (memory grew by ~90 MB per agent turn).
    const fog = this.scene.fog;
    const fogDensity = fog instanceof FogExp2 ? fog.density : null;
    const background = this.scene.background;
    for (const o of hidden) o.visible = false;
    if (fog instanceof FogExp2) fog.density = 0;
    else this.scene.fog = null;
    // Block terrain fogs itself (by distance to the camera): clear it for the far capture views too.
    const tf = this.env.terrainFog;
    this.voxelLayer?.setFog(tf.color, 1e5, 2e5, 0);
    this.scene.background = new Color(this.env.skyState.horizon);
    let restored = false;
    const restore = (): void => {
      if (restored) return;
      restored = true;
      hidden.forEach((o, i) => {
        o.visible = wasVisible[i] ?? true;
      });
      this.scene.fog = fog;
      if (fog instanceof FogExp2 && fogDensity !== null) fog.density = fogDensity;
      this.voxelLayer?.setFog(tf.color, tf.near, tf.far, tf.density);
      this.scene.background = background;
      cam.position.copy(_savedCamPos);
      cam.quaternion.copy(_savedCamQuat);
      cam.up.copy(_savedCamUp);
      cam.fov = saved.fov;
      cam.aspect = saved.aspect;
      cam.near = saved.near;
      cam.far = saved.far;
      cam.zoom = saved.zoom;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
    };
    try {
      const renderView = (view: CaptureView): void => {
          const pose = telephotoPose(viewPose(bounds, view));
          cam.fov = pose.fov;
          cam.aspect = 1;
          cam.zoom = 1;
          cam.near = pose.near;
          cam.far = pose.far;
          cam.position.set(pose.position[0], pose.position[1], pose.position[2]);
          cam.up.set(pose.up[0], pose.up[1], pose.up[2]);
          cam.lookAt(pose.target[0], pose.target[1], pose.target[2]);
          cam.updateProjectionMatrix();
          cam.updateMatrixWorld();
          this.prepareBatches(true);
          this.fx.vfx.face(cam);
          this.renderer.render(this.scene, cam);
      };
      if (!this.asyncCaptureFailed) {
        try {
          // Asynchronous readback per view (see renderToPixels): submit every view, then await the copies.
          const reads = this.grow.withFullScale(() =>
            list.map((view, i) => this.renderToPixels(px, px, () => renderView(view), () => (i === list.length - 1 ? restore() : undefined))),
          );
          const out = (this.encodeCanvas ??= document.createElement('canvas'));
          const views: string[] = [];
          for (const read of reads) views.push(await encodePixels(await read, px, px, 'image/jpeg', this.backend === 'webgl2', out));
          return views;
        } catch (e) {
          this.asyncCaptureFailed = true;
          log.warn(`asynchronous capture unavailable, using canvas readback: ${errorMessage(e)}`);
          restored = false;
          for (const o of hidden) o.visible = false;
          if (fog instanceof FogExp2) fog.density = 0;
          else this.scene.fog = null;
          this.voxelLayer?.setFog(tf.color, 1e5, 2e5, 0);
          this.scene.background = new Color(this.env.skyState.horizon);
        }
      }
      return this.grow.withFullScale(() => {
        // Render into a corner of the existing drawing buffer (viewport + scissor) instead of
        // resizing it: a resize reallocates the canvas buffers (MSAA, depth, post targets) twice
        // per capture, which Firefox reclaims lazily — memory then grows with every agent turn.
        const region = viewRegion(this.renderer.getDrawingBufferSize(_buffer).x, _buffer.y, px);
        // Restore the camera, fog, sky and decorations before the helpers redraw the normal frame.
        const captureAll = (grabOne: () => string): string[] => {
          try {
            return list.map((view) => {
              renderView(view);
              return grabOne();
            });
          } finally {
            restore();
          }
        };
        if (!region) return this.withTemporarySize(px, px, () => captureAll(() => grab(this.domElement, px, px, 'image/jpeg')));
        const out = (this.viewCanvas ??= document.createElement('canvas'));
        return this.withViewportRegion(region, () => captureAll(() => grabRegion(this.domElement, out, region.x, region.y, region.size, px, 'image/jpeg')));
      });
    } finally {
      restore();
    }
  }

  /**
   * Run `fn` with rendering confined to `region` (drawing-buffer pixels) of
   * the current drawing buffer, then restore the viewport and scissor and
   * redraw the normal frame at once (no flash of the captured views).
   */
  private withViewportRegion<T>(region: { x: number; y: number; size: number }, fn: () => T): T {
    const pr = this.renderer.getPixelRatio() || 1;
    this.renderer.getViewport(_savedViewport);
    this.renderer.getScissor(_savedScissor);
    const scissorTest = this.renderer.getScissorTest();
    // three.js multiplies by the pixel ratio and floors: +0.25 px keeps integers exact.
    const x = (region.x + 0.25) / pr;
    const y = (region.y + 0.25) / pr;
    const s = (region.size + 0.25) / pr;
    this.renderer.setViewport(x, y, s, s);
    this.renderer.setScissor(x, y, s, s);
    this.renderer.setScissorTest(true);
    try {
      return fn();
    } finally {
      this.renderer.setViewport(_savedViewport.x, _savedViewport.y, _savedViewport.z, _savedViewport.w);
      this.renderer.setScissor(_savedScissor.x, _savedScissor.y, _savedScissor.z, _savedScissor.w);
      this.renderer.setScissorTest(scissorTest);
      this.needsDraw = true;
      try {
        this.draw(true);
      } catch (e) {
        log.warn(`redraw after capture failed: ${errorMessage(e)}`);
      }
    }
  }

  /** Run `fn` with the drawing buffer temporarily resized to exactly `w`×`h` pixels. */
  private withTemporarySize<T>(w: number, h: number, fn: () => T): T {
    const pr = this.renderer.getPixelRatio();
    this.renderer.getSize(_size);
    const aspect = this.perspective.aspect;
    const cw = _size.x;
    const ch = _size.y;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    try {
      return fn();
    } finally {
      this.needsDraw = true;
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(cw, ch, false);
      this.perspective.aspect = aspect;
      this.perspective.updateProjectionMatrix();
    }
  }

  /**
   * Resize the drawing buffer (CSS pixels) and camera aspect. The pixel
   * ratio follows the GPU budget: capped per GPU class and so that the
   * drawing buffer never exceeds the budget's pixel count.
   */
  resize(width: number, height: number): void {
    if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return;
    if (this.captureActive) {
      this.pendingResize = [width, height];
      return;
    }
    this.sizeBuffer(width, height);
    this.needsDraw = true;
  }

  /** The drawing buffer and camera for `width`×`height` CSS pixels (no frame is requested). */
  private sizeBuffer(width: number, height: number): void {
    this.cssWidth = width;
    this.cssHeight = height;
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    // While the view moves under the split studio chain the scene pass takes the adaptive scale (see syncSceneScale); the frame keeps its size.
    const viaPass = this.scalesViaPass();
    const ratio = effectivePixelRatio(Math.min(dpr, this.ratioCap) * (viaPass ? 1 : this.adaptive.scale), width, height, this.budget);
    if (ratio !== this.renderer.getPixelRatio()) this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.perspective.aspect = width / height;
    this.perspective.updateProjectionMatrix();
  }

  /** The adaptive scale is applied to the scene pass of the light chain (upsampled and sharpened in its composite), not to the drawing buffer. */
  private scalesViaPass(): boolean {
    return this.qualityPlan.moveEffects !== null && !this.atRest && !this.captureActive && this.post?.sceneScalable === true;
  }

  /** Whether the drawing buffer was last sized for the scene pass taking the adaptive scale. */
  private viaPassApplied = false;

  /** Keep the scene pass at the adaptive scale (and the scaler's floor) of the way the scale is applied. */
  private syncSceneScale(): void {
    const via = this.scalesViaPass();
    const lowered = this.adaptive.setFloor(via ? MOTION_PROFILES[this.motionProfile].passFloor : undefined);
    if (lowered || via !== this.viaPassApplied) {
      this.viaPassApplied = via;
      // Called while drawing: the buffer follows without asking for another frame (that would count as the view moving, and a
      // view that rests would never rest).
      if (!this.captureActive) this.sizeBuffer(this.cssWidth, this.cssHeight);
    }
    const k = via ? this.adaptive.scale : 1;
    setTextureLodBias(lodBiasFor(k));
    // The planar water mirror and the scene backdrop are sized from the drawing buffer: they follow the scene pass.
    this.materials.mirror.mirror.scale = MIRROR_SCALE * k;
    this.materials.backdrop.scale = k;
    const post = this.post;
    if (!post?.sceneScalable) return;
    this.renderer.getDrawingBufferSize(_size);
    post.setSceneScale(k, _size.x, _size.y);
  }

  /** True while the world uses scatter fields or virtual geometry (cheap). */
  get scaleGeometryActive(): boolean {
    return this.sync.scaleGeometryActive;
  }

  /** Frame statistics and resource counts. */
  stats(): RenderStats {
    const info = this.renderer.info;
    const fields = this.sync.fieldStats();
    const virtual = this.sync.virtualStats();
    return {
      fps: Math.round(this.frameStats.fps * 10) / 10,
      frameMs: Math.round(this.frameStats.frameMs * 100) / 100,
      drawCalls: this.lastDrawCalls,
      triangles: this.lastTriangles,
      geometries: info.memory.geometries ?? 0,
      textures: info.memory.textures ?? 0,
      entities: this.sync.entityCount,
      instances: this.sync.instanceCount,
      resolutionScale: this.adaptive.scale,
      performanceLevel: this.governor.level,
      batchedDrawsSaved: this.sync.batchStats().drawCallsSaved,
      sceneTriangles: this.sync.sceneTriangles() + (this.voxelLayer?.stats().triangles ?? 0),
      fieldInstances: fields.instances,
      fieldDrawn: fields.drawnInstances,
      virtualInstances: virtual.instances,
      virtualSourceTriangles: virtual.sourceTriangles,
      virtualDrawnTriangles: virtual.drawnTriangles,
    };
  }

  /** GPU memory picture (cheap; no GPU readback). */
  memoryStats(): RenderMemoryStats {
    const info = this.renderer.info;
    const ratio = this.renderer.getPixelRatio();
    const w = Math.round(this.cssWidth * ratio);
    const h = Math.round(this.cssHeight * ratio);
    const edges = this.env.shadowMapEdges;
    const shadow = edges.length > 0 ? Math.max(...edges) : 0;
    return {
      gpuTier: this.gpu.tier,
      gpu: this.gpu.description,
      lowMemory: this.lowMemory,
      pixelRatio: ratio,
      drawingBuffer: [w, h],
      shadowMapSize: shadow,
      post: this.post !== null,
      geometries: info.memory.geometries ?? 0,
      textures: info.memory.textures ?? 0,
      cachedGeometries: this.geometries.size,
      materials: this.materials.size,
      generatorCacheMB: Math.round(((this.generatorCache?.bytes ?? 0) / (1024 * 1024)) * 10) / 10,
      estimatedGpuMB: Math.round(estimateFramebufferMB(w, h, this.post !== null || !this.lowMemory) + edges.reduce((sum, e) => sum + estimateShadowMB(e), 0)),
      texturesMB: Math.round(((info.memory as { texturesSize?: number }).texturesSize ?? 0) / 104857.6) / 10,
      textureBreakdownMB: breakdownMB(textureBreakdown(this.renderer)),
      compression: { state: this.compression.state, reason: this.compression.reason, formats: this.compression.support ? supportLabel(this.compression.support) : null, setupMs: this.compression.setupMs },
    };
  }

  /** Component overlays live under entity objects: collect them so captures can hide them. */
  private editComponentGroups(): Object3D[] {
    const out: Object3D[] = [];
    this.sync.root.traverse((o) => {
      if (o.name === 'edit:components') out.push(o);
    });
    return out;
  }

  /** Dispose every GPU resource, control and listener. The renderer is unusable afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.compileTextures.dispose();
    this.presentation.dispose();
    this.preparation.dispose();
    this.programs.dispose();
    this.gpuCost.dispose();
    this.fx.dispose();
    this.capture?.end();
    this.capture = null;
    this.disposed = true;
    this.sampleWorker?.terminate();
    this.sampleWorker = null;
    this.uninstallGpuLog?.();
    this.uninstallGpuLog = null;
    this.pathOverlay.dispose();
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('pointerdown', this.onUserCamera);
    this.domElement.removeEventListener('wheel', this.onUserCamera);
    this.gizmo?.dispose();
    this.gizmo = null;
    this.archView.dispose();
    this.lightmap.dispose();
    this.lightVolume.dispose();
    this.contact.dispose();
    this.editOverlay.dispose();
    this.proof.dispose();
    this.ghostRun.dispose();
    this.proofSync?.dispose();
    this.proofSync = null;
    this.blueprint.dispose();
    this.dropPost();
    for (const rt of this.captureTargets.values()) rt.dispose();
    this.captureTargets.clear();
    if (this.encodeCanvas) {
      this.encodeCanvas.width = 0;
      this.encodeCanvas.height = 0;
      this.encodeCanvas = null;
    }
    if (this.viewCanvas) {
      // Release the 2D backing store now rather than at GC time.
      this.viewCanvas.width = 0;
      this.viewCanvas.height = 0;
      this.viewCanvas = null;
    }
    this.generatorCache?.clear();
    this.compute?.dispose();
    this.rig.dispose();
    this.sync.dispose();
    this.ghost.dispose();
    this.voxelLayer?.dispose();
    this.voxelLayer = null;
    disposeProfileTextures();
    this.highlighter.dispose();
    this.debug.dispose();
    this.avatar.dispose();
    this.env.dispose();
    resetWater();
    this.materials.dispose();
    this.geometries.dispose();
    this.characters.dispose();
    this.models.dispose();
    this.compression.dispose();
    this.textures.dispose();
    this.scene.clear();
    // The device's pending lost / error-scope promises keep the renderer alive; the callback must not keep this object alive too.
    this.renderer.onDeviceLost = () => undefined;
    this.renderer.dispose().catch((e: unknown) => log.warn(`renderer dispose failed: ${errorMessage(e)}`));
  }
}
