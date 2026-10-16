/**
 * WorldRenderer — the public facade of @aether/render. Wires the GPU renderer
 * (WebGPU with WebGL2 fallback), post-processing, the environment rig, the
 * incremental scene synchronizer, cameras, picking, selection, ghost preview,
 * debug overlays and image capture.
 *
 * GPU-specific code is confined to `create`, `render`, `screenshot` and
 * `renderViews`; everything else lives in GPU-free modules with unit tests.
 */
import { ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping, Box3, Color, FogExp2, Frustum, Group, Matrix4, PerspectiveCamera, Plane, Quaternion, Raycaster, RenderTarget, Scene, Vector2, Vector3, Vector4, type Intersection, type Light, type Mesh, type Object3D, type Texture } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { Entity, deepEqual, type EntityId, type Json, type ProceduralShape, type Vec3, type WorldDoc } from '@aether/core';
import type { CameraMode, GeneratorOutput, GeometrySource, RenderDiagnostic, SandboxRunner } from './types';
import { MaterialCache } from './materials/material-cache';
import { GeometryCache } from './geometry/buffer-geometry';
import { createProcgenGeometrySource } from './geometry/procgen-source';
import { createGltfModelLoader, ModelCache, type ModelLoader } from './geometry/model-loader';
import { createTextureSource, TextureCache, type TextureSource } from './geometry/poster';
import type { HdriSource } from './environment/hdri';
import { photoFinishResolver } from './materials/photo-finishes';
import { getCatalog } from '@aether/assets';
import { SceneSync } from './sync/scene-sync';
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
import { MESH_TRIANGLES_KEY } from './sync/scene-sync';
import type { MeshGeometryBundle } from './geometry/mesh-asset';
import { Avatar, type AvatarState } from './view/avatar';
import { CharacterSystem } from './characters/system';
import type { CharacterRig, Foot } from './characters/rig';
import { Highlighter } from './view/highlighter';
import { DebugOverlay } from './view/debug-overlay';
import { captureMime, captureSize, MAX_VIEWS, telephotoPose, viewPose, viewRegion, type CaptureView } from './view/capture';
import { FrameStats } from './view/frame-stats';
import { gradeFor, gradeWithPreset } from './gpu/grade';
import { autoTier, degrade, effectsKey, effectsOf, evScale, GRADE_PRESETS, isGradePresetId, presetFor, resolveEffects, type EffectOverrides, type GradePreset, type GradePresetId, type PostEffects, type RenderTier } from './gpu/finishing';
import { CameraTour, TOUR_SECONDS, tourKeys } from './view/tour';
import { AdaptiveResolution } from './view/adaptive-resolution';
import { BATCHED_LAYER } from './sync/static-batches';
import { adaptStep, adaptedLook, interiorFactor, type CeilingBox } from './view/eye-adapt';
import { contentFraming, framingPose, frontAzimuthDeg, pickClearAzimuth, type Framing } from './view/framing';
import { ArchView, type ArchViewState } from './view/arch-view';
import { daylightLampFactor } from './sync/lights';
import { collectFramingItems } from './view/content-items';
import { GROW_OVERSHOOT_MAX_RADIUS, GrowIn, growDelay } from './view/grow-in';
import { createGpuRenderer, type BackendKind, type BackendPreference, type GpuInfo } from './gpu/backend';
import { classifyGpu, effectivePixelRatio, estimateFramebufferMB, estimateShadowMB, renderBudget, type GpuTier, type RenderBudget } from './gpu/budget';
import { createPostPipeline, VIGNETTE_STRENGTH, type PostPipeline, type PostQuality } from './gpu/post';
import { captureStill, openCaptureSession, type CameraPose, type CaptureHost, type CaptureSession, type StillImage, type StillOptions } from './view/capture-session';
import { normalizePixels } from './view/still';
import type { PathTraceOptions } from './view/pathtrace';
import { buildExportScene, exportGltf as exportSceneGltf, type GltfExportOptions, type GltfExportResult } from './view/gltf-export';
import { PathOverlay } from './view/path-overlay';
import { postQualityOf, qualityPlan, Refinement, studioAvailable, stillPlan, type QualityPlan, type RenderQuality, type StillPlan } from './gpu/render-quality';
import { ComputeClient, GeneratorCache, proceduralOutputKey } from '@aether/procgen';
import { disposeProfileTextures, registerLightSupport, type IesSpotLightCtor } from './sync/lights';
import { errorMessage, log } from './log';
import type { VoxelLayer } from './voxel/voxel-layer';
import type { Environment } from '@aether/core';

/** Renderer construction options. */
export interface RendererOptions {
  /** Backend policy (default 'auto', see `gpu/backend.ts`). */
  backend?: BackendPreference;
  /** @deprecated use `backend`; `false` means 'webgl2'. */
  preferWebGPU?: boolean;
  antialias?: boolean;
  shadows?: boolean;
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
const JPEG_QUALITY = 0.8;
/** Capture render targets kept (critique views and thumbnails use two sizes). */
const MAX_CAPTURE_TARGETS = 2;
const VIEW_NAMES: ReadonlySet<string> = new Set(['top', 'front', 'side', 'iso']);

// Scratch (per-frame paths must not allocate).
const _ndc = new Vector2();
const _bounds = new Box3();
const _center = new Vector3();
const _size = new Vector2();
const _buffer = new Vector2();
const _savedViewport = new Vector4();
const _savedScissor = new Vector4();
const _savedCamPos = new Vector3();
const _savedCamQuat = new Quaternion();
const _avatarHead = new Vector3();
const _footOrigin = new Vector3();
const _down = new Vector3(0, -1, 0);
const _savedCamUp = new Vector3();
const _hits: Intersection[] = [];
const _pos = new Vector3();
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
const _frustum = new Frustum();
const _viewProj = new Matrix4();
const _corner = new Vector3();
const _one = new Box3();
const _occDir = new Vector3();
const _occHits: Intersection[] = [];
const _snapHits: Intersection[] = [];
const _snapPoint = new Vector3();
const _snapVertex = new Vector3();
const _snapTmp = new Vector3();
const _inv4 = new Matrix4();
const _rectCorner = new Vector3();
/** Hits closer than this to the chase target (its own body) are ignored (m). */
const OCCLUSION_NEAR = 0.6;

function isDescendant(object: Object3D, ancestor: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (o === ancestor) return true;
  return false;
}

/** Axis-aligned rectangle overlap (inclusive). */
export function rectsOverlap(ax0: number, ay0: number, ax1: number, ay1: number, bx0: number, by0: number, bx1: number, by1: number): boolean {
  return ax0 <= bx1 && ax1 >= bx0 && ay0 <= by1 && ay1 >= by0;
}

/** A mesh that blocks the view: visible all the way up and not see-through. */
function isOpaqueVisible(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  const material = (object as Partial<Mesh>).material;
  if (!material) return false;
  const first = Array.isArray(material) ? material[0] : material;
  return !first || !first.transparent || first.opacity > 0.9;
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
  private readonly geometries = new GeometryCache();
  private readonly models: ModelCache;
  private readonly textures: TextureCache;
  private readonly sync: SceneSync;
  private readonly ghost: SceneSync;
  private readonly env: EnvironmentRig;
  private readonly highlighter = new Highlighter();
  private readonly debug = new DebugOverlay();
  private readonly avatar = new Avatar();
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
  /** User toggles of single effects (undefined keeps the tier's choice). */
  private effectOverrides: EffectOverrides = {};
  /** Effects that failed to build or draw on this device (never retried). */
  private readonly failedEffects = new Set<keyof PostEffects>();
  /** Colour-grade preset chosen by the host (null: follows the sky). */
  private gradeId: GradePresetId | null = null;
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
  private needsDraw = true;
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
  private readonly onContextLost: ((info: ContextLossInfo) => void) | undefined;
  /** Draw counters of the last frame actually drawn (stable while on-demand rendering idles). */
  private lastDrawCalls = 0;
  private framesDrawn = 0;
  /** Frame-time driven resolution scale (see {@link AdaptiveResolution}). */
  private readonly adaptive = new AdaptiveResolution();
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
    this.backend = backend;
    this.domElement = canvas;
    this.perspective = camera;
    this.gpu = Object.freeze({ description: gpu.description, tier: classifyGpu(gpu.description) });
    this.lowMemory = opts.lowMemory === true || opts.lowPower === true;
    this.budget = renderBudget(this.gpu.tier, this.lowMemory);
    this.adaptive.enabled = opts.adaptiveResolution !== false;
    this.adaptiveWanted = this.adaptive.enabled;
    // The second texture lookup that hides texture repeats costs fill rate: not on software rasterisers or in low-memory mode.
    this.materials.antiTile = this.gpu.tier !== 'software' && !this.lowMemory;
    // The layered terrain blends four photographed surfaces per pixel: also not on software rasterisers.
    this.materials.layeredTerrain = this.gpu.tier !== 'software' && !this.lowMemory;
    this.ratioCap = Number.isFinite(opts.pixelRatioCap) && (opts.pixelRatioCap as number) > 0 ? (opts.pixelRatioCap as number) : Number.POSITIVE_INFINITY;
    this.onContextLost = opts.onContextLost;
    this.rig = new CameraRig(camera, controls);
    this.orbit = controls;
    this.rig.occlusion = (from, to) => this.freeDistance(from, to);
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
    this.models = new ModelCache(opts.modelLoader ?? createGltfModelLoader());
    this.textures = new TextureCache(opts.textureSource ?? createTextureSource());
    const common = { source, materials: this.materials, geometries: this.geometries, models: this.models, textures: this.textures };
    this.characters = new CharacterSystem({
      models: this.models,
      shadows: opts.shadows !== false,
      onFootstep: (id, foot, speed, p) => this.footstepHandler?.(id, foot, speed, [p.x, p.y, p.z]),
    });
    this.avatar.setSystem(this.characters);
    this.ghostRun.setSystem(this.characters);
    this.sync = new SceneSync({
      ...common,
      characters: this.characters,
      maxInstances: opts.maxInstances ?? this.budget.maxInstances,
      staticBatching: opts.staticBatching !== false,
      fields: opts.fields === false ? false : { maxInstances: this.budget.fieldInstances, triangles: this.budget.fieldTriangles },
      // Low-memory mode keeps no hierarchy cache beyond the meshes on screen.
      virtual: opts.virtualGeometry === false ? false : { triangles: this.budget.virtualTriangles, dag: { cacheBytes: this.lowMemory ? 0 : 96 * 1024 * 1024 } },
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
    this.env = new EnvironmentRig(this.materials, opts.shadows !== false, opts.hdriSource);
    this.env.onAsyncChange = () => {
      this.needsDraw = true;
    };
    this.qualityPlan = qualityPlan('realtime', this.budget, this.gpu.tier === 'software', autoTier(this.gpu.tier, this.budget));
    this.env.sun.shadow.radius = this.qualityPlan.shadowRadius;
    this.env.setAutoHdri(this.qualityPlan.tier === 'high' || this.qualityPlan.tier === 'ultra');
    this.env.shadowMapCap = this.budget.shadowMapCap;
    this.scene.add(this.env.group, this.sync.root, this.ghost.root, this.highlighter.group, this.debug.group, this.avatar.group, this.editOverlay.group, this.proof.group, this.ghostRun.group, this.blueprint.group, this.pathOverlay.group);
    canvas.addEventListener('pointermove', this.onPointerMove, { passive: true });
    canvas.addEventListener('pointerdown', this.onUserCamera, { passive: true });
    canvas.addEventListener('wheel', this.onUserCamera, { passive: true });
  }

  /** Create a renderer on `canvas` (WebGPU when possible, else WebGL2). */
  static async create(canvas: HTMLCanvasElement, opts: RendererOptions = {}): Promise<WorldRenderer> {
    const lowMemory = opts.lowMemory === true || opts.lowPower === true;
    const { renderer, backend, gpu } = await createGpuRenderer(canvas, {
      preference: opts.backend ?? (opts.preferWebGPU === false ? 'webgl2' : 'auto'),
      // MSAA is fixed at context creation: low-memory mode starts without it.
      antialias: opts.antialias !== false && !lowMemory,
      shadows: opts.shadows !== false,
      pixelRatioCap: 1,
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    });
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
    const wr = new WorldRenderer(renderer, canvas, backend, controls, camera, opts, gpu);
    // A lost device/context stops drawing and tells the host (three's default only logs an error).
    renderer.onDeviceLost = (info: { message?: unknown }) => wr.handleContextLost(typeof info?.message === 'string' ? info.message : 'unknown reason');
    // User camera input marks the next on-demand frame dirty.
    onControlsChange?.(() => wr.requestRender());
    wr.resize(width, height);
    if (wr.budget.post) {
      const want = wr.wantedEffects();
      if (want) {
        wr.post = await createPostPipeline(renderer, wr.scene, camera, 0.4, postQualityOf(want) ?? 'standard', { effects: want, sun: wr.env.sun });
        wr.applyLook();
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
   * view. Pointer or wheel input on the canvas, or any camera command, stops
   * it. Returns false when there is nothing to tour.
   */
  startTour(seconds = TOUR_SECONDS): boolean {
    if (this.boundsDirty) this.refresh();
    const f = this.framing;
    if (!f) return false;
    const focus: Vec3[] = [];
    for (const item of collectFramingItems(this.sync)) {
      if (focus.length >= 6) break;
      if (item.focus || (item.weight === undefined && (item.max[1] - item.min[1]) > f.radius * 0.08)) focus.push([(item.min[0] + item.max[0]) / 2, item.min[1] + (item.max[1] - item.min[1]) * 0.45, (item.min[2] + item.max[2]) / 2]);
    }
    const cam = this.perspective.position;
    const target = this.orbitTarget();
    const keys = tourKeys({ pos: [cam.x, cam.y, cam.z], target }, f.center, f.radius, focus, Math.max(0.5, this.rig.floorY));
    this.rig.startTour(new CameraTour(keys, seconds));
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
    if (!prev || (prev.environment !== world.environment && !deepEqual(prev.environment, world.environment))) this.applyEnvironment(world);
    this.avatar.setLook(world.player.character);
    const done = this.sync.setWorld(world);
    this.archView.invalidate();
    this.invalidateCeilings();
    this.env.setInteriorBounce(this.archView.active);
    // New entities stay hidden while their geometry streams in, then grow in together.
    const added = this.growEnabled ? this.addedContent(prev, world) : [];
    for (const target of added) this.grow.hide(target);
    this.boundsDirty = true;
    this.debugDirty = true;
    this.needsDraw = true;
    await done;
    if (this.disposed) return;
    // The first world of a session just materialises; later builds show their plan marks first.
    if (added.length > 0) this.startGrow(added, prev !== null);
    if (!this.framed) this.framed = this.frameContent({ duration: 0 });
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
    this.env.setInteriorBounce(this.archView.active);
    this.sync.setArchLampScale(daylightLampFactor(this.env.skyState.elevation));
    this.applyLook();
    this.rig.floorY = env.ground && this.env.skyState.showGround ? MIN_ORBIT_HEIGHT : Number.NEGATIVE_INFINITY;
    this.boundsDirty = true;
    this.needsDraw = true;
  }

  /**
   * Switch the low-memory budget at runtime: the pixel ratio, shadow map,
   * post pass and generator cache follow immediately (GPU targets are
   * released); MSAA and the instance budget only change with a new renderer.
   */
  setLowMemory(on: boolean): void {
    this.lowMemory = on;
    this.budget = renderBudget(this.gpu.tier, on);
    this.applyQuality(this.qualityPlan.quality);
    this.generatorCache?.setByteLimit(this.budget.generatorCacheBytes);
    this.resize(this.cssWidth, this.cssHeight);
    this.boundsDirty = true;
    this.needsDraw = true;
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

  /**
   * Re-mount entities that show the given asset ids (user imports registered
   * after the world loaded); the environment HDRI is re-requested too.
   */
  refreshAssets(assetIds?: ReadonlySet<string>): void {
    if (this.sync.refreshAssets(assetIds) > 0) this.needsDraw = true;
    // Photographed finish maps from the library (once the catalog is in).
    if (!assetIds && getCatalog()) this.materials.finishes.usePhotos(photoFinishResolver());
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
    else p.catch((e: unknown) => log.warn(`transient ${valid.id}: ${errorMessage(e)}`));
  }

  /** Remove a runtime-spawned entity. */
  removeTransient(id: EntityId): void {
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
    this.avatar.setHidden(mode === 'firstPerson' && !target);
    this.rig.setMode(mode, source);
    this.needsDraw = true;
  }

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
    let animated = this.sync.updateAnimations(dt);
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
    this.env.setInteriorBounce(this.archView.active);
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
    const base = { fovDeg: cam.fov, aspect: cam.aspect, groundY, ...(arch ?? {}) };
    let azimuthDeg: number | undefined;
    if (front !== null) {
      // The garden side, swung aside for a three-quarter view: of a few nearby directions, the one with the
      // clearest line of sight to the house (no tree in the foreground).
      const swings = [0, 28, -28, 55, -55, 80, -80].map((s) => front + s - 28);
      const obstacles = items.filter((it) => !it.focus && it.max[1] - it.min[1] > 2.2 && Math.max(it.max[0] - it.min[0], it.max[2] - it.min[2]) < 30);
      azimuthDeg = pickClearAzimuth(swings, (az) => framingPose(framing, { ...base, azimuthDeg: az }).position, framing.center, obstacles);
    }
    const pose = framingPose(framing, { ...base, ...(azimuthDeg !== undefined ? { azimuthDeg } : {}) });
    _pos.set(pose.position[0], pose.position[1], pose.position[2]);
    _target.set(pose.target[0], pose.target[1], pose.target[2]);
    const duration = opts.duration ?? FRAME_DURATION;
    if (opts.flyIn) {
      const wide = framingPose(framing, { fovDeg: cam.fov, aspect: cam.aspect, groundY, margin: 1.7, elevationDeg: 46 });
      _center.set(wide.position[0], wide.position[1], wide.position[2]);
      this.rig.flyTo(_center, _target, 0);
      this.rig.flyTo(_pos, _target, Math.max(duration, FLY_IN_DURATION));
    } else {
      this.rig.flyTo(_pos, _target, duration);
    }
    this.needsDraw = true;
    return true;
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
   * mesh (Infinity when clear). Scatter layers are not raycast (they are
   * thin decoration) and see-through materials never block the view. Reuses
   * one hit list; three allocates hit records only when something is hit.
   */
  private freeDistance(from: Vector3, to: Vector3): number {
    _occDir.subVectors(to, from);
    const length = _occDir.length();
    if (!(length > 1e-4)) return Number.POSITIVE_INFINITY;
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
    return free;
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
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    const cameraMoved = this.rig.update(step);
    this.adaptEye(step);
    // A field or virtual mesh was just mounted / moved: draw (draw() re-plans the view).
    if (this.sync.viewNeedsUpdate) this.needsDraw = true;
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
    if (opts.animate !== false && this.stepAnimations(step)) this.needsDraw = true;
    // Grow-in rescales content groups: re-apply the architectural view once it settles,
    // and merge building geometry only once nothing animates any more.
    if (this.wasGrowing && !this.grow.active) this.archView.invalidate();
    this.sync.setMergesSuspended(this.grow.active);
    this.wasGrowing = this.grow.active;
    if (this.archView.update(this.perspective, step)) {
      this.needsDraw = true;
      this.boundsDirty = true;
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
    const changed = cameraMoved || this.needsDraw || (animate && this.env.animating);
    if (changed) this.refinement.restart();
    const refine = !changed && this.refinement.next();
    if (opts.onDemand === true && !changed && !refine) {
      this.drewLastFrame = false;
      return false;
    }
    this.needsDraw = false;
    this.highlighter.update();
    if (this.materials.surfaces.active) this.materials.surfaces.advance(step);
    this.draw();
    this.framesDrawn++;
    const info = this.renderer.info.render;
    this.lastDrawCalls = info.drawCalls ?? info.frameCalls ?? 0;
    this.lastTriangles = info.triangles ?? 0;
    this.frameStats.record(dt, now() - t0);
    if (this.adaptive.record(dt, this.drewLastFrame)) this.resize(this.cssWidth, this.cssHeight);
    this.drewLastFrame = true;
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
      const f = this.framing;
      if (f) {
        this.env.setContentRadius(f.radius);
        // Shadows are spent on the meaningful content, not on backdrop mountains.
        const r = f.radius * 1.2;
        _bounds.min.set(f.center[0] - r, Math.min(0, f.center[1] - r), f.center[2] - r);
        _bounds.max.set(f.center[0] + r, f.center[1] + r, f.center[2] + r);
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
    if (!this.budget.post) return null;
    const plan = this.qualityPlan;
    let effects = resolveEffects(plan.effects, this.effectOverrides, this.failedEffects);
    if (!effects.composite && plan.tier === 'low' && this.effectOverrides.composite !== false && this.env.bloom > 0.001) effects = { ...effects, composite: true };
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

  /**
   * Choose the interactive render tier (`low`, `medium`, `high`, `ultra`) or `'auto'` to follow the
   * GPU budget. Takes effect immediately; stills ignore it (they always run the ultra chain). Returns
   * the tier now in effect.
   */
  setRenderTier(tier: RenderTier | 'auto'): RenderTier {
    this.tierChoice = tier;
    this.applyQuality(this.qualityPlan.quality);
    return this.qualityPlan.tier;
  }

  /** The tier in effect (stills report `ultra`). */
  get renderTier(): RenderTier {
    return this.qualityPlan.tier;
  }

  /** The tier the GPU budget picks by itself. */
  get autoRenderTier(): RenderTier {
    return autoTier(this.gpu.tier, this.budget);
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
    return this.post?.effects ?? resolveEffects({ composite: false, ao: false, gi: false, taa: false, ssr: false, shafts: false, halation: false, aberration: false, grain: false, dof: false });
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
    const preset = GRADE_PRESETS[id];
    this.look = preset;
    const post = this.post;
    this.renderer.toneMapping = post ? (preset.tone === 'agx' ? AgXToneMapping : preset.tone === 'neutral' ? NeutralToneMapping : ACESFilmicToneMapping) : ACESFilmicToneMapping;
    const eye = adaptedLook(this.eyeFactor);
    this.env.setEnvScale(eye.envScale);
    this.env.setInteriorFill(this.eyeFactor);
    this.renderer.toneMappingExposure = this.env.exposure * eye.exposure;
    if (post) {
      const grade = gradeWithPreset(gradeFor(sky), preset);
      post.setGrade({ ...grade, exposure: (grade.exposure ?? 1) * eye.exposure });
      post.setBloom(this.env.bloom * preset.bloom);
    }
  }

  /** Smoothed interior factor of the eye (0 outdoors, 1 under a ceiling), see `view/eye-adapt.ts`. */
  private eyeFactor = 0;
  private ceilings: CeilingBox[] | null = null;
  private eyeClock = 0;

  /** Drop the cached ceilings (the building changed). */
  private invalidateCeilings(): void {
    this.ceilings = null;
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
    if (Math.abs(target - this.eyeFactor) < 0.002) return;
    this.eyeFactor = adaptStep(this.eyeFactor, target, step);
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
    this.qualityPlan = qualityPlan(quality, this.budget, this.gpu.tier === 'software', this.tierChoice === 'auto' ? autoTier(this.gpu.tier, this.budget) : this.tierChoice);
    const plan = this.qualityPlan;
    // The high and ultra tiers (and stills) light and reflect with a photographed sky.
    this.env.setAutoHdri(plan.tier === 'high' || plan.tier === 'ultra');
    this.env.shadowMapCap = plan.shadowMapCap;
    this.env.sun.shadow.radius = plan.shadowRadius;
    this.voxelLayer?.setQuality(plan.tier);
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
      this.post.dispose();
      this.post = null;
      this.postGen++;
      this.applyLook();
    }
    if (want === null || this.post || this.postPending) return;
    this.postPending = true;
    this.postShadowSize = this.env.sun.shadow.mapSize.x;
    const gen = ++this.postGen;
    createPostPipeline(this.renderer, this.scene, this.perspective, this.env.bloom, postQualityOf(want) ?? 'standard', { effects: want, sun: this.env.sun })
      .then((p) => {
        this.postPending = false;
        if (!p) {
          this.postCreationFailed(want);
          return;
        }
        const now = this.wantedEffects();
        if (gen !== this.postGen || this.disposed || !now || effectsKey(now) !== p.key) p.dispose();
        else {
          this.post = p;
          this.applyLook();
          if (this.vignetteOff) p.setVignette(0);
          this.needsDraw = true;
        }
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

  private postFailed = false;
  /** The sun has no shadow map to march through (nothing receives its shadows): the shafts stay off until the environment or quality changes. */
  private shaftsUnavailable = false;

  /**
   * Bring the static-prop batches up to date before any draw: regroup after
   * content changes (so a removed prop's geometry is never drawn) and copy
   * member transforms. World matrices are updated first only when batches
   * exist (the renderer would otherwise do it inside render()).
   */
  private prepareBatches(): void {
    if (!this.sync.batchesActive) return;
    this.scene.updateMatrixWorld();
    this.sync.updateBatches();
  }

  /**
   * Draw one frame. `capture` marks an off-screen view (critique views,
   * thumbnails): scatter fields and virtual geometry then re-plan for that
   * camera immediately, never throttled.
   */
  private draw(capture = false): void {
    this.prepareBatches();
    // Scatter fields and virtual geometry re-plan for whatever camera draws this frame
    // (the viewport, or a capture view), only when the view or content changed.
    if (this.viewChanged() || this.sync.viewNeedsUpdate) {
      const target = this.renderer.getOutputRenderTarget();
      const height = target ? target.height : Math.round(this.cssHeight * this.renderer.getPixelRatio());
      this.sync.updateView(this.perspective, Math.max(1, height), capture ? 0 : now());
    }
    // A resized sun shadow map reallocates its textures on the next draw; shafts built against the old
    // ones would sample destroyed textures. Drop the pipeline, draw once directly, and let it rebuild.
    if ((this.post || this.postPending) && this.postShadowSize !== this.env.sun.shadow.mapSize.x && (this.post?.effects.shafts || this.postPending)) {
      this.post?.dispose();
      this.post = null;
      this.postGen++;
      this.postPending = false;
      this.postShadowSize = this.env.sun.shadow.mapSize.x;
      this.renderer.render(this.scene, this.perspective);
      this.needsDraw = true;
      return;
    }
    this.syncPost();
    // Water joins the depth pre-pass (and so the screen-space reflections) while they run.
    const reflective = this.post?.effects.ssr === true;
    if (reflective !== this.materials.waterIsReflective) this.materials.setReflectiveWater(reflective);
    try {
      if (this.post) {
        // Depth of field focuses on the orbit target (allocation-free: scratch vectors).
        if (this.post.effects.dof) {
          this.rig.getTarget(_target);
          this.post.setFocus(this.perspective.position.distanceTo(_target));
        }
        // The shafts node reads the sun shadow map's textures when its shader is built: the map must exist.
        // Content that never receives shadows (block terrain) has none: drop the shafts for this world.
        if (this.post.effects.shafts && !this.env.sun.shadow.map) {
          this.renderer.render(this.scene, this.perspective);
          if (!this.env.sun.shadow.map) {
            this.shaftsUnavailable = true;
            this.post.dispose();
            this.post = null;
            this.postGen++;
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
        this.post.dispose();
        this.post = null;
        this.postGen++;
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
      exported = buildExportScene(this.sync.root, this.perspective, MAX_PATH_TRACE_TRIANGLES);
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
        this.post?.setVignette(vignette ? VIGNETTE_STRENGTH : 0);
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
        this.post?.setVignette(VIGNETTE_STRENGTH);
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

  /** Capture the current view as a data URL (JPEG quality 0.8 by default). */
  async screenshot(opts: { width?: number; height?: number; mime?: string } = {}): Promise<string> {
    if (this.disposed || this.lost) throw new Error(this.lost ? 'GPU context lost' : 'renderer disposed');
    if (this.captureActive) throw new Error('a capture is running');
    const canvas = this.domElement;
    const w = captureSize(opts.width, canvas.width);
    const h = captureSize(opts.height, Math.round((w * canvas.height) / Math.max(1, canvas.width)));
    const mime = captureMime(opts.mime);
    // Captures (agent critique, project thumbnails) show the world itself: no selection box, no gizmo.
    const decorations: Object3D[] = [this.highlighter.group, this.editOverlay.group, this.proof.group, this.ghostRun.group, this.blueprint.group, this.pathOverlay.group, ...(this.proofSync ? [this.proofSync.root] : []), ...this.editComponentGroups(), ...(this.gizmo?.helper ? [this.gizmo.helper] : [])];
    const wasVisible = decorations.map((o) => o.visible);
    for (const o of decorations) o.visible = false;
    const aspect = this.perspective.aspect;
    try {
      if (!this.asyncCaptureFailed) {
        try {
          // Asynchronous readback: the GPU renders and copies while the page keeps running.
          const pixels = await this.grow.withFullScale(() =>
            this.renderToPixels(w, h, () => {
              this.perspective.aspect = w / h;
              this.perspective.updateProjectionMatrix();
              // Same look as the viewport (bloom, vignette): the post pipeline writes to the output target too.
              this.draw(true);
            }, () => {
              this.perspective.aspect = aspect;
              this.perspective.updateProjectionMatrix();
              decorations.forEach((o, i) => (o.visible = wasVisible[i] ?? true));
            }),
          );
          return await encodePixels(pixels, w, h, mime, this.backend === 'webgl2', (this.encodeCanvas ??= document.createElement('canvas')));
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
          return grab(canvas, w, h, mime);
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
   * Perspective captures from explicit camera poses (world space), for reviewing interiors: the AI's
   * corner, wall and plan views. Each image is `width`×`height` pixels; the main camera is restored
   * afterwards. Editing decorations are hidden; fog, sky and lights stay as the viewport shows them.
   */
  async capturePoses(
    poses: ReadonlyArray<{ position: Vec3; target: Vec3; up: Vec3; fov: number }>,
    opts: { width?: number; height?: number; mime?: string } = {},
  ): Promise<string[]> {
    if (this.disposed || this.lost) throw new Error(this.lost ? 'GPU context lost' : 'renderer disposed');
    if (this.captureActive) throw new Error('a capture is running');
    const list = (Array.isArray(poses) ? poses : []).slice(0, MAX_VIEWS * 2);
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
    };
    const aim = (pose: { position: Vec3; target: Vec3; up: Vec3; fov: number }): void => {
      cam.fov = Math.max(20, Math.min(120, pose.fov));
      cam.aspect = w / h;
      cam.zoom = 1;
      cam.near = 0.05;
      cam.far = 400;
      cam.position.set(pose.position[0], pose.position[1], pose.position[2]);
      cam.up.set(pose.up[0], pose.up[1], pose.up[2]);
      cam.lookAt(pose.target[0], pose.target[1], pose.target[2]);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
    };
    const out: string[] = [];
    try {
      for (const pose of list) {
        if (!this.asyncCaptureFailed) {
          try {
            const pixels = await this.grow.withFullScale(() =>
              this.renderToPixels(w, h, () => {
                aim(pose);
                this.prepareBatches();
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
              this.prepareBatches();
              this.renderer.render(this.scene, cam);
              const image = grab(this.domElement, w, h, mime);
              restoreCamera();
              return image;
            }),
          ),
        );
      }
      return out;
    } finally {
      restore();
      this.needsDraw = true;
    }
  }

  /** Orthographic top/front/side/iso captures framing the scene (for VLM critique). */
  async renderViews(views: Array<'top' | 'front' | 'side' | 'iso'>, size = 512): Promise<string[]> {
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
          this.prepareBatches();
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
    this.cssWidth = width;
    this.cssHeight = height;
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const ratio = effectivePixelRatio(Math.min(dpr, this.ratioCap) * this.adaptive.scale, width, height, this.budget);
    if (ratio !== this.renderer.getPixelRatio()) this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.perspective.aspect = width / height;
    this.perspective.updateProjectionMatrix();
    this.needsDraw = true;
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
    const shadow = this.env.sun.castShadow ? this.env.sun.shadow.mapSize.x : 0;
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
      estimatedGpuMB: Math.round(estimateFramebufferMB(w, h, this.post !== null || !this.lowMemory) + estimateShadowMB(shadow)),
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
    this.capture?.end();
    this.capture = null;
    this.disposed = true;
    this.pathOverlay.dispose();
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('pointerdown', this.onUserCamera);
    this.domElement.removeEventListener('wheel', this.onUserCamera);
    this.gizmo?.dispose();
    this.gizmo = null;
    this.archView.dispose();
    this.editOverlay.dispose();
    this.proof.dispose();
    this.ghostRun.dispose();
    this.proofSync?.dispose();
    this.proofSync = null;
    this.blueprint.dispose();
    this.post?.dispose();
    this.post = null;
    this.postGen++;
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
    this.materials.dispose();
    this.geometries.dispose();
    this.characters.dispose();
    this.models.dispose();
    this.textures.dispose();
    this.scene.clear();
    // The device's pending lost / error-scope promises keep the renderer alive; the callback must not keep this object alive too.
    this.renderer.onDeviceLost = () => undefined;
    this.renderer.dispose().catch((e: unknown) => log.warn(`renderer dispose failed: ${errorMessage(e)}`));
  }
}
