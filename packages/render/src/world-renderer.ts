/**
 * WorldRenderer — the public facade of @aether/render. Wires the GPU renderer
 * (WebGPU with WebGL2 fallback), post-processing, the environment rig, the
 * incremental scene synchronizer, cameras, picking, selection, ghost preview,
 * debug overlays and image capture.
 *
 * GPU-specific code is confined to `create`, `render`, `screenshot` and
 * `renderViews`; everything else lives in GPU-free modules with unit tests.
 */
import { Box3, Color, Frustum, Matrix4, OrthographicCamera, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, type Intersection, type Object3D } from 'three';
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
import { Avatar } from './view/avatar';
import { Highlighter } from './view/highlighter';
import { DebugOverlay } from './view/debug-overlay';
import { captureMime, captureSize, MAX_VIEWS, viewPose, type CaptureView } from './view/capture';
import { FrameStats } from './view/frame-stats';
import { contentFraming, framingPose, type Framing } from './view/framing';
import { collectFramingItems } from './view/content-items';
import { createGpuRenderer, type BackendKind } from './gpu/backend';
import { createPostPipeline, type PostPipeline } from './gpu/post';
import { errorMessage, log } from './log';

/** Renderer construction options. */
export interface RendererOptions {
  /** Try WebGPU first (default true). */
  preferWebGPU?: boolean;
  antialias?: boolean;
  shadows?: boolean;
  /** Max device pixel ratio (default 2). */
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
  /** Laptop/battery mode: no bloom post pass and a 1024² sun shadow map. */
  lowPower?: boolean;
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
const _hits: Intersection[] = [];
const _pos = new Vector3();
const _target = new Vector3();
const _frustum = new Frustum();
const _viewProj = new Matrix4();
const _corner = new Vector3();
const _one = new Box3();

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

/** Copy the canvas into a new 2D canvas of `w`×`h` and encode it. Must run in the same task as the render. */
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
  private post: PostPipeline | null = null;
  private ortho: OrthographicCamera | null = null;
  private boundsDirty = true;
  /** Something visible changed since the last drawn frame (on-demand rendering). */
  private needsDraw = true;
  private debugDirty = false;
  private sinceRefit = REFIT_INTERVAL;
  private framed = false;
  /** Sphere of the meaningful content (refreshed with the bounds). */
  private framing: Framing | null = null;
  private disposed = false;
  private lowPower = false;
  /** Draw counters of the last frame actually drawn (stable while on-demand rendering idles). */
  private lastDrawCalls = 0;
  private lastTriangles = 0;

  private constructor(
    private readonly renderer: WebGPURenderer,
    canvas: HTMLCanvasElement,
    backend: BackendKind,
    controls: OrbitControlsLike | null,
    camera: PerspectiveCamera,
    opts: RendererOptions,
  ) {
    this.backend = backend;
    this.domElement = canvas;
    this.perspective = camera;
    this.rig = new CameraRig(camera, controls);
    const source = opts.geometrySource ?? createProcgenGeometrySource(opts.sandbox ? { sandbox: opts.sandbox } : {});
    this.models = new ModelCache(opts.modelLoader ?? createGltfModelLoader());
    const common = { source, materials: this.materials, geometries: this.geometries, models: this.models };
    this.sync = new SceneSync({
      ...common,
      ...(opts.maxInstances !== undefined ? { maxInstances: opts.maxInstances } : {}),
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
    this.env = new EnvironmentRig(this.materials, opts.shadows !== false);
    this.env.sun.shadow.radius = 3;
    this.setLowPower(opts.lowPower === true);
    this.scene.add(this.env.group, this.sync.root, this.ghost.root, this.highlighter.group, this.debug.group, this.avatar.group);
  }

  /** Create a renderer on `canvas` (WebGPU when possible, else WebGL2). */
  static async create(canvas: HTMLCanvasElement, opts: RendererOptions = {}): Promise<WorldRenderer> {
    const { renderer, backend } = await createGpuRenderer(canvas, {
      preferWebGPU: opts.preferWebGPU !== false,
      antialias: opts.antialias !== false,
      shadows: opts.shadows !== false,
      pixelRatioCap: Number.isFinite(opts.pixelRatioCap) && (opts.pixelRatioCap as number) > 0 ? (opts.pixelRatioCap as number) : 2,
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
    const wr = new WorldRenderer(renderer, canvas, backend, controls, camera, opts);
    // User camera input marks the next on-demand frame dirty.
    onControlsChange?.(() => wr.requestRender());
    renderer.setSize(width, height, false);
    wr.post = await createPostPipeline(renderer, wr.scene, camera, 0.4);
    opts.onProgress?.(`Renderer ready (${backend})`);
    return wr;
  }

  /** Sphere of the meaningful content used for fog and shadow fitting (null before content). */
  get contentSphere(): Readonly<Framing> | null {
    return this.framing;
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
    this.boundsDirty = true;
    this.debugDirty = true;
    this.needsDraw = true;
    await done;
    if (this.disposed) return;
    if (!this.framed) this.framed = this.frameContent({ duration: 0 });
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

  /** Toggle low-power rendering (no bloom pass, smaller shadow map). */
  setLowPower(on: boolean): void {
    this.lowPower = on;
    this.env.shadowMapCap = on ? 1024 : 4096;
    this.boundsDirty = true;
    this.needsDraw = true;
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
   * Frame the meaningful content of the world (see `collectFramingItems`)
   * from an elevated three-quarter view that fits the viewport, never below
   * the ground. Returns false when there is nothing to frame.
   */
  frameContent(opts: FrameContentOptions = {}): boolean {
    if (this.disposed) return false;
    const items = collectFramingItems(this.sync, new Set(opts.focus ?? []));
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
    for (const id of ids.slice(0, 256)) {
      this.sync.entityBounds(id, _one);
      if (!_one.isEmpty()) _bounds.union(_one);
    }
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
    this.sync.entityBounds(id, _bounds);
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
    this.debug.show(opts ?? {}, this.sync);
    this.debugDirty = false;
    this.needsDraw = true;
  }

  /**
   * Render one frame. Call every animation frame with the elapsed seconds.
   *
   * With `onDemand` (edit mode), the GPU frame is skipped when nothing visible
   * changed: no camera motion or flight, no content/override/selection change,
   * no animated weather. Returns true when a frame was drawn.
   */
  render(dt: number, opts: { onDemand?: boolean } = {}): boolean {
    if (this.disposed) return false;
    const t0 = now();
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    const cameraMoved = this.rig.update(step);
    this.env.update(step, this.perspective);
    this.sinceRefit += step;
    if (this.sinceRefit >= REFIT_INTERVAL && (this.boundsDirty || this.debugDirty)) this.refresh();
    if (opts.onDemand === true && !cameraMoved && !this.needsDraw && !this.env.animating) return false;
    this.needsDraw = false;
    this.highlighter.update();
    this.draw();
    const info = this.renderer.info.render;
    this.lastDrawCalls = info.drawCalls ?? info.frameCalls ?? 0;
    this.lastTriangles = info.triangles ?? 0;
    this.frameStats.record(dt, now() - t0);
    return true;
  }

  private refresh(): void {
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

  private draw(): void {
    try {
      if (this.post && !this.lowPower && this.env.bloom > 0.001) this.post.render();
      else this.renderer.render(this.scene, this.perspective);
    } catch (e) {
      // A post pipeline failure must not kill the viewport: drop post and keep rendering directly.
      if (this.post) {
        log.warn(`post-processing failed, disabling: ${errorMessage(e)}`);
        this.post.dispose();
        this.post = null;
      } else {
        throw e;
      }
    }
  }

  /** Capture the current view as a data URL (JPEG quality 0.8 by default). */
  async screenshot(opts: { width?: number; height?: number; mime?: string } = {}): Promise<string> {
    if (this.disposed) throw new Error('renderer disposed');
    const canvas = this.domElement;
    const w = captureSize(opts.width, canvas.width);
    const h = captureSize(opts.height, Math.round((w * canvas.height) / Math.max(1, canvas.width)));
    const mime = captureMime(opts.mime);
    return this.withTemporarySize(w, h, () => {
      this.perspective.aspect = w / h;
      this.perspective.updateProjectionMatrix();
      this.draw();
      return grab(canvas, w, h, mime);
    });
  }

  /** Orthographic top/front/side/iso captures framing the scene (for VLM critique). */
  async renderViews(views: Array<'top' | 'front' | 'side' | 'iso'>, size = 512): Promise<string[]> {
    if (this.disposed) throw new Error('renderer disposed');
    const list = (Array.isArray(views) ? views : []).filter((v): v is CaptureView => VIEW_NAMES.has(v)).slice(0, MAX_VIEWS);
    if (list.length === 0) return [];
    const px = captureSize(size, 512);
    this.sync.computeBounds(_bounds);
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
      return this.withTemporarySize(px, px, () =>
        list.map((view) => {
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
          return grab(this.domElement, px, px, 'image/jpeg');
        }),
      );
    } finally {
      hidden.forEach((o, i) => {
        o.visible = wasVisible[i] ?? true;
      });
      this.scene.fog = fog;
      this.scene.background = background;
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

  /** Resize the drawing buffer (CSS pixels) and camera aspect. */
  resize(width: number, height: number): void {
    if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return;
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

  /** Dispose every GPU resource, control and listener. The renderer is unusable afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.post?.dispose();
    this.post = null;
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
