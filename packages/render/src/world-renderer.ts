/**
 * WorldRenderer — the public facade of @aether/render. Wires the GPU renderer
 * (WebGPU with WebGL2 fallback), post-processing, the environment rig, the
 * incremental scene synchronizer, cameras, picking, selection, ghost preview,
 * debug overlays and image capture.
 *
 * GPU-specific code is confined to `create`, `render`, `screenshot` and
 * `renderViews`; everything else lives in GPU-free modules with unit tests.
 */
import { Box3, Color, Frustum, Matrix4, OrthographicCamera, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, Vector4, type Intersection, type Mesh, type Object3D } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { Entity, deepEqual, type EntityId, type Json, type Vec3, type WorldDoc } from '@aether/core';
import type { CameraMode, GeneratorOutput, GeometrySource, RenderDiagnostic, SandboxRunner } from './types';
import { MaterialCache } from './materials/material-cache';
import { GeometryCache } from './geometry/buffer-geometry';
import { createProcgenGeometrySource } from './geometry/procgen-source';
import { createGltfModelLoader, ModelCache, type ModelLoader } from './geometry/model-loader';
import { SceneSync } from './sync/scene-sync';
import { ghostWorld } from './sync/ghost';
import { EnvironmentRig } from './environment/environment-rig';
import { SKY_RADIUS } from './environment/sky-dome';
import { CameraRig, type FollowSource, type OrbitControlsLike } from './view/camera-rig';
import { createTransformControls, TransformGizmo, type GizmoChange, type GizmoMode } from './view/transform-gizmo';
import { Avatar } from './view/avatar';
import { Highlighter } from './view/highlighter';
import { DebugOverlay } from './view/debug-overlay';
import { captureMime, captureSize, MAX_VIEWS, viewPose, viewRegion, type CaptureView } from './view/capture';
import { FrameStats } from './view/frame-stats';
import { contentFraming, framingPose, type Framing } from './view/framing';
import { collectFramingItems } from './view/content-items';
import { GROW_OVERSHOOT_MAX_RADIUS, GrowIn, growDelay } from './view/grow-in';
import { createGpuRenderer, type BackendKind, type BackendPreference, type GpuInfo } from './gpu/backend';
import { classifyGpu, effectivePixelRatio, estimateFramebufferMB, estimateShadowMB, renderBudget, type GpuTier, type RenderBudget } from './gpu/budget';
import { createPostPipeline, type PostPipeline } from './gpu/post';
import { GeneratorCache } from '@aether/procgen';
import { errorMessage, log } from './log';

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

/** Lowest orbit camera height above a ground plane (metres). */
const MIN_ORBIT_HEIGHT = 0.4;
/** Default camera flight time of automatic framing (seconds). */
export const FRAME_DURATION = 1.1;
/** Establishing-shot flight time used by `flyIn` (seconds). */
const FLY_IN_DURATION = 1.6;
/** Screen share (of the half view height) below which revealed content is considered too small to read. */
const MIN_VISIBLE_SHARE = 0.06;

/** Shadow refit / debug rebuild throttle (seconds) while content streams in. */
const REFIT_INTERVAL = 0.35;
const JPEG_QUALITY = 0.8;
const VIEW_NAMES: ReadonlySet<string> = new Set(['top', 'front', 'side', 'iso']);

// Scratch (per-frame paths must not allocate).
const _ndc = new Vector2();
const _bounds = new Box3();
const _center = new Vector3();
const _size = new Vector2();
const _buffer = new Vector2();
const _savedViewport = new Vector4();
const _savedScissor = new Vector4();
const _hits: Intersection[] = [];
const _pos = new Vector3();
const _target = new Vector3();
const _frustum = new Frustum();
const _viewProj = new Matrix4();
const _corner = new Vector3();
const _one = new Box3();
const _occDir = new Vector3();
const _occHits: Intersection[] = [];
/** Hits closer than this to the chase target (its own body) are ignored (m). */
const OCCLUSION_NEAR = 0.6;

function isDescendant(object: Object3D, ancestor: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (o === ancestor) return true;
  return false;
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
  private readonly sync: SceneSync;
  private readonly ghost: SceneSync;
  private readonly env: EnvironmentRig;
  private readonly highlighter = new Highlighter();
  private readonly debug = new DebugOverlay();
  private readonly avatar = new Avatar();
  private readonly frameStats = new FrameStats();
  private readonly raycaster = new Raycaster();
  private readonly occlusionRay = new Raycaster();
  /** Entity the chase camera follows (its own meshes never block the view). */
  private followId: EntityId | null = null;
  private readonly grow = new GrowIn();
  private growEnabled = true;
  private post: PostPipeline | null = null;
  private ortho: OrthographicCamera | null = null;
  /** Reused 2D canvas for critique-view crops (released on dispose). */
  private viewCanvas: HTMLCanvasElement | null = null;
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
  /** Extra pixel-ratio cap from the options. */
  private readonly ratioCap: number;
  private cssWidth = 1;
  private cssHeight = 1;
  /** Bumped whenever the post pipeline is dropped, so a late async creation is discarded. */
  private postGen = 0;
  private postPending = false;
  private readonly onContextLost: ((info: ContextLossInfo) => void) | undefined;
  /** Draw counters of the last frame actually drawn (stable while on-demand rendering idles). */
  private lastDrawCalls = 0;
  private framesDrawn = 0;
  private lastTriangles = 0;
  private readonly orbit: OrbitControlsLike | null;
  /** Editor transform gizmo (created on first use). */
  private gizmo: TransformGizmo | null = null;

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
    this.ratioCap = Number.isFinite(opts.pixelRatioCap) && (opts.pixelRatioCap as number) > 0 ? (opts.pixelRatioCap as number) : Number.POSITIVE_INFINITY;
    this.onContextLost = opts.onContextLost;
    this.rig = new CameraRig(camera, controls);
    this.orbit = controls;
    this.rig.occlusion = (from, to) => this.freeDistance(from, to);
    this.generatorCache = opts.geometrySource ? null : new GeneratorCache(256, this.budget.generatorCacheBytes);
    const source =
      opts.geometrySource ??
      createProcgenGeometrySource({ ...(opts.sandbox ? { sandbox: opts.sandbox } : {}), ...(this.generatorCache ? { cache: this.generatorCache } : {}) });
    this.models = new ModelCache(opts.modelLoader ?? createGltfModelLoader());
    const common = { source, materials: this.materials, geometries: this.geometries, models: this.models };
    this.sync = new SceneSync({
      ...common,
      maxInstances: opts.maxInstances ?? this.budget.maxInstances,
      onContentChanged: () => {
        this.boundsDirty = true;
        this.debugDirty = true;
        this.needsDraw = true;
      },
    });
    this.ghost = new SceneSync({
      ...common,
      variant: 'ghost',
      maxInstances: 50_000,
      onContentChanged: () => {
        this.needsDraw = true;
      },
    });
    this.growEnabled = opts.growIn !== false;
    this.env = new EnvironmentRig(this.materials, opts.shadows !== false);
    this.env.sun.shadow.radius = 3;
    this.env.shadowMapCap = this.budget.shadowMapCap;
    this.scene.add(this.env.group, this.sync.root, this.ghost.root, this.highlighter.group, this.debug.group, this.avatar.group);
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
    const wr = new WorldRenderer(renderer, canvas, backend, controls, camera, opts, gpu);
    // A lost device/context stops drawing and tells the host (three's default only logs an error).
    renderer.onDeviceLost = (info: { message?: unknown }) => wr.handleContextLost(typeof info?.message === 'string' ? info.message : 'unknown reason');
    // User camera input marks the next on-demand frame dirty.
    onControlsChange?.(() => wr.requestRender());
    wr.resize(width, height);
    if (wr.budget.post) wr.post = await createPostPipeline(renderer, wr.scene, camera, 0.4);
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
    return this.grow.active || this.cameraFlying;
  }

  /** True while an automatic camera flight (framing, focus) is in progress. */
  get cameraFlying(): boolean {
    return this.rig.focusing;
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
    const done = this.sync.setWorld(world);
    // New entities stay hidden while their geometry streams in, then grow in together.
    const added = this.growEnabled ? this.addedContent(prev, world) : [];
    for (const target of added) this.grow.hide(target);
    this.boundsDirty = true;
    this.debugDirty = true;
    this.needsDraw = true;
    await done;
    if (this.disposed) return;
    if (added.length > 0) this.startGrow(added);
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
  private startGrow(targets: readonly Object3D[]): void {
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
    for (const p of plan) this.grow.start(p.target, p.delay, p.overshoot);
    this.needsDraw = true;
  }

  private applyEnvironment(world: WorldDoc): void {
    const env = world.environment;
    this.env.apply(env, this.scene);
    this.renderer.toneMappingExposure = this.env.exposure;
    this.post?.setBloom(env.bloom);
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
    this.env.shadowMapCap = this.budget.shadowMapCap;
    this.generatorCache?.setByteLimit(this.budget.generatorCacheBytes);
    this.resize(this.cssWidth, this.cssHeight);
    this.boundsDirty = true;
    this.needsDraw = true;
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

  /** Generator output of an entity (procedural colliders for physics). */
  getGeneratorOutput(id: EntityId): GeneratorOutput | undefined {
    return this.sync.getOutput(id);
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

  /** Place the player avatar (feet position, yaw in degrees; yaw 0 faces −Z). */
  setPlayerAvatar(position: Vec3, yawDeg: number): void {
    this.avatar.set(position[0], position[1], position[2], yawDeg);
    this.needsDraw = true;
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
    const pose = framingPose(framing, { fovDeg: cam.fov, aspect: cam.aspect, groundY });
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
   * Make sure `ids` are visible: when any of them is outside the view (or too
   * small to read), re-frame the content with them as focus. Returns true when
   * the camera moves.
   */
  reveal(ids: readonly EntityId[], duration = FRAME_DURATION): boolean {
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
      if (share >= MIN_VISIBLE_SHARE) return false;
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
   * Show the move / rotate / scale gizmo on an entity (null id or mode hides
   * it). `onCommit` receives the entity's local transform after each drag.
   * The gizmo follows the entity's rendered object; call again after the
   * entity is rebuilt.
   */
  async setGizmo(id: EntityId | null, mode: GizmoMode | null, onCommit?: (change: GizmoChange) => void): Promise<void> {
    if (this.disposed) return;
    const object = id && mode ? this.sync.object(id) : undefined;
    if (!object || !mode || !onCommit) {
      this.gizmo?.detach();
      return;
    }
    this.gizmo ??= new TransformGizmo(
      () => createTransformControls(this.perspective, this.domElement),
      (helper) => this.scene.add(helper),
      this.orbit,
      () => this.requestRender(),
    );
    await this.gizmo.attach(object, mode, onCommit);
  }

  /** True while a gizmo handle is hovered or dragged (clicks then must not change the selection). */
  get gizmoBusy(): boolean {
    return this.gizmo?.busy ?? false;
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

  /** Entity under normalized device coordinates (−1..1), or null. */
  pick(ndcX: number, ndcY: number): EntityId | null {
    if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) return null;
    this.raycaster.setFromCamera(_ndc.set(ndcX, ndcY), this.perspective);
    _hits.length = 0;
    this.raycaster.intersectObject(this.sync.root, true, _hits);
    let id: EntityId | null = null;
    for (const hit of _hits) {
      if (!hit.object.visible) continue;
      id = this.sync.idOf(hit.object);
      if (id) break;
    }
    _hits.length = 0;
    // Scatter instances are not raycast individually (O(instances × triangles));
    // when no solid mesh was hit, a scatter layer is picked by its bounds.
    return id ?? this.sync.pickScatter(this.raycaster.ray)?.id ?? null;
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
    if (this.disposed || this.lost) return false;
    const t0 = now();
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    const cameraMoved = this.rig.update(step);
    const growing = this.grow.active && this.grow.update(step);
    if (growing) this.needsDraw = true;
    const animate = opts.animate !== false;
    this.env.update(animate ? step : 0, this.perspective);
    this.sinceRefit += step;
    if (this.sinceRefit >= REFIT_INTERVAL && (this.boundsDirty || this.debugDirty)) this.refresh();
    if (opts.onDemand === true && !cameraMoved && !this.needsDraw && !(animate && this.env.animating)) return false;
    this.needsDraw = false;
    this.highlighter.update();
    if (this.materials.surfaces.active) this.materials.surfaces.advance(step);
    this.draw();
    this.framesDrawn++;
    const info = this.renderer.info.render;
    this.lastDrawCalls = info.drawCalls ?? info.frameCalls ?? 0;
    this.lastTriangles = info.triangles ?? 0;
    this.frameStats.record(dt, now() - t0);
    return true;
  }

  private refresh(): void {
    this.grow.withFullScale(() => this.refreshBounds());
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
    return this.budget.post && this.env.bloom > 0.001;
  }

  /**
   * Keep the post pipeline only while it is used: its full-resolution
   * multisampled target and bloom chain are the largest GPU allocations, so
   * they are released as soon as a world (or low-memory mode) turns bloom
   * off and rebuilt asynchronously when it comes back.
   */
  private syncPost(): void {
    const want = this.wantsPost;
    if (!want && this.post) {
      this.post.dispose();
      this.post = null;
      this.postGen++;
    } else if (want && !this.post && !this.postPending && !this.postFailed) {
      this.postPending = true;
      const gen = ++this.postGen;
      createPostPipeline(this.renderer, this.scene, this.perspective, this.env.bloom)
        .then((p) => {
          this.postPending = false;
          if (!p) {
            this.postFailed = true;
            return;
          }
          if (gen !== this.postGen || this.disposed || !this.wantsPost) p.dispose();
          else {
            this.post = p;
            this.needsDraw = true;
          }
        })
        .catch(() => {
          this.postPending = false;
          this.postFailed = true;
        });
    }
  }

  /** The post pipeline could not be built on this device (never retried). */
  private postFailed = false;

  private draw(): void {
    this.syncPost();
    try {
      if (this.post) this.post.render();
      else this.renderer.render(this.scene, this.perspective);
    } catch (e) {
      // A post pipeline failure must not kill the viewport: drop post and keep rendering directly.
      if (this.post) {
        log.warn(`post-processing failed, disabling: ${errorMessage(e)}`);
        this.post.dispose();
        this.post = null;
        this.postFailed = true;
      } else {
        throw e;
      }
    }
  }

  /** Capture the current view as a data URL (JPEG quality 0.8 by default). */
  async screenshot(opts: { width?: number; height?: number; mime?: string } = {}): Promise<string> {
    if (this.disposed || this.lost) throw new Error(this.lost ? 'GPU context lost' : 'renderer disposed');
    const canvas = this.domElement;
    const w = captureSize(opts.width, canvas.width);
    const h = captureSize(opts.height, Math.round((w * canvas.height) / Math.max(1, canvas.width)));
    const mime = captureMime(opts.mime);
    // Captures (agent critique, project thumbnails) show the world itself: no selection box, no gizmo.
    const decorations: Object3D[] = [this.highlighter.group, ...(this.gizmo?.helper ? [this.gizmo.helper] : [])];
    const wasVisible = decorations.map((o) => o.visible);
    for (const o of decorations) o.visible = false;
    try {
      // Captures always show the finished world, never a mid-grow frame.
      return this.grow.withFullScale(() =>
        this.withTemporarySize(w, h, () => {
          this.perspective.aspect = w / h;
          this.perspective.updateProjectionMatrix();
          this.draw();
          return grab(canvas, w, h, mime);
        }),
      );
    } finally {
      decorations.forEach((o, i) => (o.visible = wasVisible[i] ?? true));
    }
  }

  /** Orthographic top/front/side/iso captures framing the scene (for VLM critique). */
  async renderViews(views: Array<'top' | 'front' | 'side' | 'iso'>, size = 512): Promise<string[]> {
    if (this.disposed || this.lost) throw new Error(this.lost ? 'GPU context lost' : 'renderer disposed');
    const list = (Array.isArray(views) ? views : []).filter((v): v is CaptureView => VIEW_NAMES.has(v)).slice(0, MAX_VIEWS);
    if (list.length === 0) return [];
    const px = captureSize(size, 512);
    this.grow.withFullScale(() => this.sync.computeBounds(_bounds));
    const bounds = _bounds.isEmpty() ? null : { min: _bounds.min.toArray() as Vec3, max: _bounds.max.toArray() as Vec3 };
    const cam = (this.ortho ??= new OrthographicCamera(-1, 1, 1, -1, 0.05, 1000));
    // Hide view-dependent decorations; give the background a flat sky color.
    const hidden: Object3D[] = [this.env.sky.group, this.highlighter.group, this.debug.group, this.ghost.root];
    const wasVisible = hidden.map((o) => o.visible);
    const fog = this.scene.fog;
    const background = this.scene.background;
    for (const o of hidden) o.visible = false;
    this.scene.fog = null;
    this.scene.background = new Color(this.env.skyState.horizon);
    try {
      const renderView = (view: CaptureView): void => {
          const pose = viewPose(bounds, view);
          cam.left = -pose.halfSize;
          cam.right = pose.halfSize;
          cam.top = pose.halfSize;
          cam.bottom = -pose.halfSize;
          cam.near = pose.near;
          cam.far = pose.far;
          cam.position.set(pose.position[0], pose.position[1], pose.position[2]);
          cam.up.set(pose.up[0], pose.up[1], pose.up[2]);
          cam.lookAt(pose.target[0], pose.target[1], pose.target[2]);
          cam.updateProjectionMatrix();
          cam.updateMatrixWorld();
          this.renderer.render(this.scene, cam);
      };
      return this.grow.withFullScale(() => {
        // Render into a corner of the existing drawing buffer (viewport + scissor) instead of
        // resizing it: a resize reallocates the canvas buffers (MSAA, depth, post targets) twice
        // per capture, which Firefox reclaims lazily — memory then grows with every agent turn.
        const region = viewRegion(this.renderer.getDrawingBufferSize(_buffer).x, _buffer.y, px);
        if (!region) {
          return this.withTemporarySize(px, px, () =>
            list.map((view) => {
              renderView(view);
              return grab(this.domElement, px, px, 'image/jpeg');
            }),
          );
        }
        const out = (this.viewCanvas ??= document.createElement('canvas'));
        return this.withViewportRegion(region, () =>
          list.map((view) => {
            renderView(view);
            return grabRegion(this.domElement, out, region.x, region.y, region.size, px, 'image/jpeg');
          }),
        );
      });
    } finally {
      hidden.forEach((o, i) => {
        o.visible = wasVisible[i] ?? true;
      });
      this.scene.fog = fog;
      this.scene.background = background;
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
        this.draw();
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
    this.cssWidth = width;
    this.cssHeight = height;
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const ratio = effectivePixelRatio(Math.min(dpr, this.ratioCap), width, height, this.budget);
    if (ratio !== this.renderer.getPixelRatio()) this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.perspective.aspect = width / height;
    this.perspective.updateProjectionMatrix();
    this.needsDraw = true;
  }

  /** Frame statistics and resource counts. */
  stats(): RenderStats {
    const info = this.renderer.info;
    return {
      fps: Math.round(this.frameStats.fps * 10) / 10,
      frameMs: Math.round(this.frameStats.frameMs * 100) / 100,
      drawCalls: this.lastDrawCalls,
      triangles: this.lastTriangles,
      geometries: info.memory.geometries ?? 0,
      textures: info.memory.textures ?? 0,
      entities: this.sync.entityCount,
      instances: this.sync.instanceCount,
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

  /** Dispose every GPU resource, control and listener. The renderer is unusable afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gizmo?.dispose();
    this.gizmo = null;
    this.post?.dispose();
    this.post = null;
    this.postGen++;
    if (this.viewCanvas) {
      // Release the 2D backing store now rather than at GC time.
      this.viewCanvas.width = 0;
      this.viewCanvas.height = 0;
      this.viewCanvas = null;
    }
    this.generatorCache?.clear();
    this.rig.dispose();
    this.sync.dispose();
    this.ghost.dispose();
    this.highlighter.dispose();
    this.debug.dispose();
    this.avatar.dispose();
    this.env.dispose();
    this.materials.dispose();
    this.geometries.dispose();
    this.models.dispose();
    this.scene.clear();
    this.renderer.dispose().catch((e: unknown) => log.warn(`renderer dispose failed: ${errorMessage(e)}`));
  }
}
