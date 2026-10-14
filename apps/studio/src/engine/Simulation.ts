/**
 * Simulation — wires History (core), WorldRenderer (render), PhysicsWorld
 * (physics) and LogicRuntime (logic) together and owns the frame loop.
 *
 * Edit mode: the renderer mirrors `history.current`; physics is not running;
 * orbit camera; click to select.
 *
 * Play mode: the current world is snapshotted (documents are immutable, so
 * the reference IS the snapshot), physics + logic are built from it and run
 * on a fixed timestep (physics.step → logic.tick → renderer.applyTransforms
 * → renderer.render). Runtime changes (spawns, destroys, property overrides,
 * poses) never touch the document; Stop discards them and restores the
 * pre-play world exactly.
 *
 * The loop runs outside React: no state updates per frame. Stats and the
 * HUD are pushed to listeners at 4 Hz. In edit mode frames are rendered on
 * demand (only when something visible changed), and after 30 s without
 * input even animated weather stops redrawing, so an idle editor does not
 * keep the GPU busy. While the page is hidden the loop is stopped entirely.
 * `@aether/physics` (a multi-MB WASM chunk) is loaded lazily on the first
 * Play or verification.
 */
import { eulerDegToQuat, worldTransform, type Entity, type EntityId, type History, type Json, type Vec3, type WorldDoc } from '@aether/core';
import { initScripting, LogicRuntime, type LogicHost, type QuatTuple, type ScriptRunner, createScriptRunner } from '@aether/logic';
import type { CharacterController, ColliderProvider, PhysicsWorld } from '@aether/physics';
import { assetColliderDescs } from '@aether/physics/asset-colliders';
import type { SandboxRunner } from '@aether/procgen';
import { WorldRenderer, type BackendPreference, type ContextLossInfo, type GizmoCommit, type GizmoMode, type GizmoOptions, type RenderDiagnostic, type RenderMemoryStats } from '@aether/render';
import { FIXED_DT, MAX_FRAME_DT, MAX_SUBSTEPS, PLAYER_CAPSULE, PLAYER_PSEUDO_ID, STATS_INTERVAL_MS } from '../config';
import { createLogger, errorMessage } from '../lib/log';
import { FixedStepper } from './FixedStepper';
import { IdleClock } from './IdleClock';
import { InputController } from './input';
import { SoundBoard } from './sound';
import { PosePool } from './posePool';
import { TransformTable } from './TransformTable';
import { findAvatar, framingSphere, movingIds } from './worldQueries';
import type { VoxelSession, VoxelPlay } from '../voxel/session';
import type { VoxelHudState } from '../voxel/hudState';

/** Longest wait for content to finish materialising before a thumbnail (ms). */
const THUMBNAIL_SETTLE_MS = 6000;
/**
 * Quiet time (no input, nothing animating) a thumbnail waits for: reading
 * pixels back stalls slow GPUs for a few hundred milliseconds (WebGL2 on a
 * software rasterizer), which must not land in the middle of an interaction.
 */
export const THUMBNAIL_QUIET_MS = 2000;
/** True when nothing animated since `stillSince` and no input came since `lastInputAt` for {@link THUMBNAIL_QUIET_MS}. */
export function quietReached(now: number, stillSince: number, lastInputAt: number, quietMs = THUMBNAIL_QUIET_MS): boolean {
  return now - Math.max(stillSince, lastInputAt) >= quietMs;
}

/** Longest a thumbnail waits for that quiet moment before capturing anyway. */
const THUMBNAIL_QUIET_MAX_MS = 15_000;
/** Longest wait for block terrain to finish streaming before a thumbnail (ms). */
const VOXEL_THUMBNAIL_WAIT_MS = 30_000;

const log = createLogger('sim');

/**
 * Editor tools: selection (click or box), a transform gizmo on the
 * selection, or a brush (sculpt, vertex paint, scatter paint).
 */
export type EditorTool = 'select' | 'box' | 'move' | 'rotate' | 'scale' | 'sculpt' | 'paint' | 'scatter';
/** Gizmo mode of a transform tool (null for the other tools). */
export function gizmoModeOf(tool: EditorTool): GizmoMode | null {
  return tool === 'move' ? 'translate' : tool === 'rotate' ? 'rotate' : tool === 'scale' ? 'scale' : null;
}

/** A pointer event handed to a viewport tool (NDC: −1..1, y up). */
export interface ToolPointer {
  ndcX: number;
  ndcY: number;
  /** Position relative to the canvas in CSS pixels. */
  x: number;
  y: number;
  /** Pen pressure 0..1 (0.5 for a mouse button press, as browsers report). */
  pressure: number;
  pointerType: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** A tool that takes over left-button drags in the viewport (marquee, brushes). */
export interface ViewportTool {
  /** Start a drag; return false to fall back to normal clicking/orbiting. */
  down(p: ToolPointer): boolean;
  move(p: ToolPointer): void;
  up(p: ToolPointer): void;
  /** Pointer hover without a drag (null: the pointer left the viewport). */
  hover?(p: ToolPointer | null): void;
  /** Drag cancelled (Escape, lost capture). */
  cancel?(): void;
}

/** Below this height the built-in player respawns. */
const PLAYER_KILL_Y = -40;
/** Pointer travel (px) that turns a click into an orbit drag. */
const CLICK_SLOP_PX = 5;
/** Fallback camera offset direction of {@link Simulation.frameWorld} (distance is set by the renderer). */
const FRAME_OFFSET: Vec3 = [8, 7, 15];
/** Fallback framing flight time (seconds). */
const FRAME_DURATION = 1.1;
/** Radius around the player spawn framed for character games. */
const PLAYER_FRAME_RADIUS = 14;
/** Camera offset direction over block terrain (elevated three-quarter view). */
const VOXEL_FRAME_OFFSET: Vec3 = [1, 0.62, 1.25];
/** Framing radius over the spawn of block terrain without edits (blocks). */
const VOXEL_SPAWN_RADIUS = 34;
/** Framing radius bounds around block edits (blocks): small builds keep some landscape, huge ones stay readable. */
const VOXEL_EDIT_MIN_RADIUS = 16;
const VOXEL_EDIT_MAX_RADIUS = 72;
/** Approximate camera distance per framing radius (the renderer fits the sphere to a ~50° view). */
const VOXEL_DISTANCE_PER_RADIUS = 2.6;
/** Max transient (runtime-spawned) entities alive at once. */
const MAX_TRANSIENTS = 2000;
/** Consecutive failed frames after which the render loop is stopped (persistent GPU/device failure). */
const MAX_FRAME_FAILURES = 30;
const MB = 1024 * 1024;

/** Live counters pushed to the UI at 4 Hz. */
export interface SimulationStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  entities: number;
  bodies: number;
  stepMs: number;
  /** Estimated GPU drawing-buffer + shadow memory (MB). */
  gpuMB: number;
  /** JS heap in use (MB; 0 where the browser does not report it). */
  heapMB: number;
  /** Triangles the scene holds at full detail. */
  sceneTriangles: number;
  /** Scatter-field instances held / drawn by the last frame. */
  fieldInstances: number;
  fieldDrawn: number;
  /** Virtual-geometry instances / triangles their cuts draw. */
  virtualInstances: number;
  virtualDrawn: number;
}

/** Callbacks from the simulation to the UI layer. */
export interface SimulationListener {
  onStats?(stats: SimulationStats): void;
  /** Play-mode HUD refresh (4 Hz): values of `world.hud` keys + game time. */
  onHud?(hud: Record<string, Json | undefined>, time: number): void;
  onMessage?(text: string, duration: number): void;
  onGameOver?(result: 'win' | 'lose', text: string): void;
  onPick?(id: EntityId | null, additive: boolean): void;
  /** A gizmo drag ended: the new local transforms of every moved entity (one undoable edit). */
  onTransform?(commit: GizmoCommit): void;
  /** The renderer finished syncing to a new world (overlays that reference rendered geometry refresh). */
  onSynced?(): void;
  onModeChange?(mode: 'edit' | 'play'): void;
  onError?(message: string): void;
  /** The render loop stopped after repeated failures; the page must be reloaded. */
  onFatal?(message: string): void;
  /** The GPU device / WebGL context was lost; the simulation must be replaced. */
  onContextLost?(info: ContextLossInfo): void;
  /** Voxel game HUD snapshot (null when no voxel game runs). */
  onVoxelHud?(state: VoxelHudState | null): void;
}

/** Construction options. */
export interface SimulationOptions {
  /** Backend policy (default 'auto'). */
  backend?: BackendPreference;
  shadows?: boolean;
  pointerLock?: boolean;
  sandbox?: SandboxRunner;
  onProgress?: (msg: string) => void;
  /** Low-memory mode (see `renderBudget` in `@aether/render`). */
  lowMemory?: boolean;
  /** Skip collecting renderer stats in edit mode (perf HUD hidden). */
  statsWhileEditing?: boolean;
  /**
   * Scatter fields and virtual geometry (default true). False draws every
   * layer and sculpture at full detail (`?engine=classic`, comparisons).
   */
  scaleGeometry?: boolean;
  /** Namespace of voxel game saves (the project id; default 'scratch'). */
  saveBase?: string;
}

/** Session state the logic host needs (everything except the runtime itself). */
interface SessionCore {
  world: WorldDoc;
  pw: PhysicsWorld;
  scripts: ScriptRunner | undefined;
  character: CharacterController | null;
  avatarId: EntityId | null;
  transients: Set<EntityId>;
  destroyed: Set<EntityId>;
  ended: boolean;
  /** The voxel game (voxel worlds): it owns the player instead of the capsule controller. */
  voxel: VoxelPlay | null;
}

/** Everything that exists only while playing. */
interface PlaySession extends SessionCore {
  logic: LogicRuntime;
}

const scratchPos: Vec3 = [0, 0, 0];
const scratchQuat: [number, number, number, number] = [0, 0, 0, 1];
const scratchDir = { x: 0, y: 0, z: 0 };

function isTypingElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el instanceof HTMLElement && el.isContentEditable);
}

/** Owns renderer + (in play mode) physics/logic and the frame loop. */
export class Simulation {
  readonly renderer: WorldRenderer;
  private readonly history: History;
  private readonly listener: SimulationListener;
  private readonly stepper = new FixedStepper(FIXED_DT, MAX_SUBSTEPS, MAX_FRAME_DT);
  private readonly table = new TransformTable();
  private readonly input = new InputController();
  private readonly sound = new SoundBoard();
  /** Block terrain + voxel game, loaded on the first world with `voxel` (null until then). */
  voxel: VoxelSession | null = null;
  private voxelLoading: Promise<VoxelSession> | null = null;
  private readonly saveBase: string;
  private readonly unsubscribe: () => void;
  private readonly resizeObserver: ResizeObserver | null;
  private session: PlaySession | null = null;
  private transition: Promise<void> = Promise.resolve();
  private syncChain: Promise<void> = Promise.resolve();
  private syncedWorldDoc: WorldDoc | null = null;
  private pendingWorld: WorldDoc | null = null;
  private selection: EntityId[] = [];
  private diagnostics: RenderDiagnostic[] = [];
  private showColliders = false;
  private pointerLock: boolean;
  private raf = 0;
  private lastFrame = -1;
  private lastStats = 0;
  private disposed = false;
  private viewListener: ((camera: WorldRenderer['camera']) => void) | null = null;
  private downX = 0;
  private downY = 0;
  private downValid = false;
  /** The pointer went down on a gizmo handle: the release is not a selection click. */
  private downOnGizmo = false;
  private gizmoIds: readonly EntityId[] = [];
  private gizmoTool: EditorTool = 'select';
  private gizmoOptions: GizmoOptions = {};
  /** Overrides the entity gizmo (component editing) while true. */
  private gizmoSuspended = false;
  private viewportTool: ViewportTool | null = null;
  private toolDragging = false;
  private toolPointerId = -1;
  /** Consumes clicks before entity picking (e.g. component selection); returns true when handled. */
  private clickHandler: ((p: ToolPointer, additive: boolean) => boolean) | null = null;
  private pickSkip: ((id: EntityId) => boolean) | undefined = undefined;
  private marquee: HTMLDivElement | null = null;
  private frameFailures = 0;
  private lastFrameError = '';
  private stopRequested = false;
  private statsWhileEditing: boolean;
  private readonly idle = new IdleClock();
  /** Reused per frame (the frame loop must not allocate). */
  private readonly renderOpts = { onDemand: true, animate: true };
  private hidden = false;

  private constructor(renderer: WorldRenderer, history: History, listener: SimulationListener, opts: SimulationOptions) {
    this.renderer = renderer;
    this.history = history;
    this.listener = listener;
    this.pointerLock = opts.pointerLock === true;
    this.statsWhileEditing = opts.statsWhileEditing !== false;
    this.saveBase = opts.saveBase ?? 'scratch';
    this.unsubscribe = history.subscribe((world) => {
      if (!this.session) this.requestSync(world);
    });
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    const parent = canvas.parentElement;
    this.resizeObserver = typeof ResizeObserver !== 'undefined' && parent ? new ResizeObserver(() => this.resize()) : null;
    if (parent) this.resizeObserver?.observe(parent);
    this.resize();
    this.requestSync(history.current);
    this.touch();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
      this.hidden = document.visibilityState === 'hidden';
    }
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, this.onActivity, { passive: true, capture: true });
    if (!this.hidden) this.raf = requestAnimationFrame(this.onAnimationFrame);
  }

  /** Create the renderer on `canvas` and start the loop (edit mode). */
  static async create(canvas: HTMLCanvasElement, history: History, listener: SimulationListener, opts: SimulationOptions = {}): Promise<Simulation> {
    const renderer = await WorldRenderer.create(canvas, {
      backend: opts.backend ?? 'auto',
      shadows: opts.shadows !== false,
      antialias: true,
      lowMemory: opts.lowMemory === true,
      growIn: !prefersReducedMotion(),
      ...(opts.scaleGeometry === false ? { fields: false, virtualGeometry: false } : {}),
      onContextLost: (info) => listener.onContextLost?.(info),
      ...(opts.sandbox ? { sandbox: opts.sandbox } : {}),
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    });
    return new Simulation(renderer, history, listener, opts);
  }

  /** 'play' while a session runs. */
  get mode(): 'edit' | 'play' {
    return this.session ? 'play' : 'edit';
  }

  /** Rendering backend in use. */
  get backend(): 'webgpu' | 'webgl2' {
    return this.renderer.backend;
  }

  /** Live logic runtime (play mode only) — exposed for debugging/e2e. */
  get logic(): LogicRuntime | null {
    return this.session?.logic ?? null;
  }

  /** Live physics world (play mode only). */
  get physics(): PhysicsWorld | null {
    return this.session?.pw ?? null;
  }

  /** Built-in player capsule position (play mode without an avatar entity), else null. */
  get playerPosition(): Readonly<Vec3> | null {
    return this.session?.character?.position ?? null;
  }

  /** Colliders for physics: procedural outputs the renderer already generated (physics falls back to its defaults). */
  readonly colliders: ColliderProvider = (entity: Entity) =>
    this.renderer.getGeneratorOutput(entity.id)?.colliders ?? (entity.shape.kind === 'asset' ? (assetColliderDescs(entity.shape) ?? undefined) : undefined);

  // ---------------------------------------------------------------------------
  // Edit-mode world sync
  // ---------------------------------------------------------------------------

  /** Resolves once the renderer reflects the latest requested world. */
  whenSynced(): Promise<void> {
    return this.syncChain;
  }

  /** The world the renderer last finished syncing (procedural outputs match it). */
  get syncedWorld(): WorldDoc | null {
    return this.syncedWorldDoc;
  }

  private requestSync(world: WorldDoc): void {
    if (this.disposed) return;
    this.touch();
    const idle = this.pendingWorld === null;
    this.pendingWorld = world;
    if (!idle) return; // the running chain picks up the newest world
    this.syncChain = this.syncChain.then(async () => {
      // Coalesce: always render the newest world requested while waiting.
      while (this.pendingWorld && !this.disposed) {
        const next = this.pendingWorld;
        try {
          await this.renderer.setWorld(next);
          if (next.voxel || this.voxel) await (await this.voxelSession()).sync(next);
          this.syncedWorldDoc = next;
        } catch (err) {
          log.error('renderer sync failed', err);
          this.listener.onError?.(`Rendering failed: ${errorMessage(err)}`);
        }
        if (this.pendingWorld === next) this.pendingWorld = null;
      }
      this.refreshDebug();
      this.renderer.highlight(this.selection.filter((id) => this.syncedWorldDoc && Object.prototype.hasOwnProperty.call(this.syncedWorldDoc.entities, id)));
      // The entity's rendered object may have been rebuilt: re-attach the gizmo.
      this.applyGizmo();
      this.listener.onSynced?.();
    });
  }

  /** The voxel session (its module is loaded on first use: worlds without terrain never pay for it). */
  private voxelSession(): Promise<VoxelSession> {
    if (this.voxel) return Promise.resolve(this.voxel);
    this.voxelLoading ??= import('../voxel/session').then(({ VoxelSession: Session }) => {
      const session = new Session(this.renderer, {
        onHud: (state) => this.listener.onVoxelHud?.(state),
        sound: (name) => this.sound.play(name),
        error: (message) => this.listener.onError?.(message),
        saveBase: this.saveBase,
      });
      if (this.disposed) session.dispose();
      else this.voxel = session;
      return session;
    });
    return this.voxelLoading;
  }

  /** Editor tool, the selection it acts on and the gizmo options (the gizmo shows for transform tools). */
  setGizmo(ids: readonly EntityId[], tool: EditorTool, opts: GizmoOptions = this.gizmoOptions): void {
    this.gizmoIds = ids.slice(0, 2000);
    this.gizmoTool = tool;
    this.gizmoOptions = opts;
    this.applyGizmo();
  }

  /** Change gizmo options (snapping, space, pivot) live, also during a drag. */
  setGizmoOptions(opts: GizmoOptions): void {
    this.gizmoOptions = opts;
    this.renderer.setGizmoOptions(opts);
  }

  /** Hand the gizmo to component editing (true) or back to entities (false). */
  suspendEntityGizmo(on: boolean): void {
    if (this.gizmoSuspended === on) return;
    this.gizmoSuspended = on;
    if (!on) this.applyGizmo();
  }

  private applyGizmo(): void {
    if (this.disposed || this.gizmoSuspended) return;
    const doc = this.syncedWorldDoc;
    const ids = doc ? this.gizmoIds.filter((id) => Object.prototype.hasOwnProperty.call(doc.entities, id) && doc.entities[id]?.locked !== true) : [];
    const mode = this.session ? null : gizmoModeOf(this.gizmoTool);
    void this.renderer
      .setGizmo(mode ? ids : null, mode, mode ? (commit) => this.listener.onTransform?.(commit) : undefined, this.gizmoOptions)
      .catch((err: unknown) => log.warn('gizmo unavailable', err));
  }

  /**
   * Install a viewport tool that takes over left-button drags (null: plain
   * selection and orbiting). Camera navigation keeps right-drag and the wheel.
   */
  setViewportTool(tool: ViewportTool | null): void {
    if (this.toolDragging) this.viewportTool?.cancel?.();
    this.toolDragging = false;
    this.viewportTool?.hover?.(null);
    this.viewportTool = tool;
    this.renderer.setLeftDragNavigation(tool === null);
  }

  /** Consume clicks before entity picking (null: default picking). */
  setClickHandler(fn: ((p: ToolPointer, additive: boolean) => boolean) | null): void {
    this.clickHandler = fn;
  }

  /** Entities that clicks and marquees pass through (e.g. locked ones). */
  setPickFilter(skip: ((id: EntityId) => boolean) | undefined): void {
    this.pickSkip = skip;
  }

  /** Draw (or with null hide) the marquee rectangle, in canvas CSS pixels. */
  showMarquee(rect: { x0: number; y0: number; x1: number; y1: number } | null): void {
    const host = this.renderer.domElement.parentElement;
    if (!rect || !host) {
      this.marquee?.remove();
      this.marquee = null;
      return;
    }
    if (!this.marquee) {
      const el = document.createElement('div');
      el.className = 'vp-marquee';
      el.setAttribute('aria-hidden', 'true');
      host.appendChild(el);
      this.marquee = el;
    }
    const s = this.marquee.style;
    s.left = `${Math.min(rect.x0, rect.x1)}px`;
    s.top = `${Math.min(rect.y0, rect.y1)}px`;
    s.width = `${Math.abs(rect.x1 - rect.x0)}px`;
    s.height = `${Math.abs(rect.y1 - rect.y0)}px`;
  }

  // ---------------------------------------------------------------------------
  // Selection, camera, debug
  // ---------------------------------------------------------------------------

  /** Outline the given entities. */
  setSelection(ids: readonly EntityId[]): void {
    this.selection = ids.slice(0, 256);
    this.renderer.highlight(this.selection);
  }

  /** Fly the camera to an entity. */
  focus(id: EntityId): void {
    this.renderer.focus(id);
  }

  /**
   * Frame a freshly built or opened world: the renderer frames the bounding
   * boxes of its meaningful content (ground, sky and backdrop ignored,
   * `focus`-tagged entities weighted) from an elevated three-quarter view;
   * character games without an avatar entity also keep the player spawn in
   * view. `flyIn` starts from a wider establishing shot (first load). Waits
   * for the renderer to catch up.
   */
  async frameWorld(opts: { flyIn?: boolean } = {}): Promise<void> {
    await this.whenSynced();
    if (this.disposed || this.session) return;
    const world = this.history.current;
    const p = world.player;
    if (world.voxel && this.voxel?.active) {
      // Block terrain: an elevated view over what was built (structures, pixel art …), else
      // over the spawn area. Chunks stream in around the orbit target.
      if (!this.frameVoxelEdits(0, opts.flyIn === true)) {
        const g = this.voxel.groundAt(p.spawn[0], p.spawn[2]);
        const center: Vec3 = [p.spawn[0], g + 6, p.spawn[2]];
        const offset = this.voxel.viewOffset(center, VOXEL_SPAWN_RADIUS, VOXEL_SPAWN_RADIUS * VOXEL_DISTANCE_PER_RADIUS, VOXEL_FRAME_OFFSET);
        this.renderer.frameSphere(center, VOXEL_SPAWN_RADIUS, offset, opts.flyIn ? FRAME_DURATION * 1.6 : FRAME_DURATION);
      }
      return;
    }
    // Buildings frame themselves (the walkthrough spawn sits outside the entrance and would pull the view off).
    const spawnFocus = p.mode !== 'orbit' && !findAvatar(world) && !hasBuilding(world);
    if (this.renderer.frameContent({ focusPoints: spawnFocus ? [p.spawn] : [], ...(opts.flyIn ? { flyIn: true } : {}) })) return;
    // Nothing rendered yet (e.g. every entity failed to build): fall back to document positions.
    if (spawnFocus) {
      this.renderer.frameSphere(p.spawn, PLAYER_FRAME_RADIUS, FRAME_OFFSET, FRAME_DURATION);
      return;
    }
    const sphere = framingSphere(world);
    if (sphere) this.renderer.frameSphere(sphere.center, sphere.radius, FRAME_OFFSET, FRAME_DURATION);
  }

  /**
   * Show the block edits a turn added (from edit index `from` on): the
   * camera frames them from an elevated view. Waits for the renderer.
   */
  async revealVoxelEdits(from: number): Promise<void> {
    await this.whenSynced();
    if (this.disposed || this.session || !this.history.current.voxel) return;
    this.frameVoxelEdits(from, false);
  }

  /** Frame block edits from index `from` on; false when there are none (or no block terrain). */
  private frameVoxelEdits(from: number, flyIn: boolean): boolean {
    const focus = this.voxel?.active ? this.voxel.editFocus(from) : null;
    if (!focus) return false;
    const voxel = this.voxel as VoxelSession;
    const radius = Math.max(VOXEL_EDIT_MIN_RADIUS, Math.min(VOXEL_EDIT_MAX_RADIUS, focus.radius * 1.15));
    const offset = voxel.viewOffset(focus.center, radius, radius * VOXEL_DISTANCE_PER_RADIUS, VOXEL_FRAME_OFFSET);
    this.renderer.frameSphere(focus.center, radius, offset, flyIn ? FRAME_DURATION * 1.6 : FRAME_DURATION);
    return true;
  }

  /**
   * Keep entities changed by an edit in view: the camera only moves when one
   * of them is off screen or too small to read. Waits for the renderer.
   */
  async revealEntities(ids: readonly EntityId[]): Promise<void> {
    await this.whenSynced();
    if (this.disposed || this.session) return;
    const world = this.history.current;
    const present = ids.filter((id) => Object.prototype.hasOwnProperty.call(world.entities, id) && !world.entities[id]?.template);
    this.renderer.reveal(present);
  }

  /** Toggle collider wireframes. */
  setShowColliders(on: boolean): void {
    this.showColliders = on;
    this.refreshDebug();
  }

  /** Show verification diagnostics as markers in the viewport. */
  setDiagnostics(diags: readonly RenderDiagnostic[]): void {
    this.diagnostics = diags.slice(0, 64);
    this.refreshDebug();
  }

  /** Toggle the renderer's low-memory budget (pixel ratio, shadows, post pass, caches). */
  setLowMemory(on: boolean): void {
    this.renderer.setLowMemory(on);
  }

  /** GPU memory picture of the renderer. */
  memoryStats(): RenderMemoryStats {
    return this.renderer.memoryStats();
  }

  /** Mark user/agent activity (keeps animated environments running in edit mode). */
  touch(): void {
    this.idle.touch(now());
  }

  /** Collect renderer stats in edit mode only while someone displays them. */
  setStatsWhileEditing(on: boolean): void {
    this.statsWhileEditing = on;
  }

  /** Enable/disable pointer lock in play mode (applies on next play). */
  setPointerLock(on: boolean): void {
    this.pointerLock = on;
  }

  /** Switch the play camera between follow/first-person/orbit. */
  setCameraView(view: 'orbit' | 'follow' | 'firstPerson'): void {
    const s = this.session;
    if (s?.voxel) return;
    if (!s || view === 'orbit') {
      this.renderer.setCameraMode('orbit');
      return;
    }
    if (s.avatarId) this.renderer.setCameraMode(view, s.avatarId);
    else if (s.character) this.renderer.setCameraMode(view);
  }

  /** Data URL screenshot of the viewport. */
  async screenshot(): Promise<string | null> {
    try {
      await this.whenSynced();
      return await this.renderer.screenshot({ width: 768, height: 432, mime: 'image/jpeg' });
    } catch (err) {
      log.warn('screenshot failed', err);
      return null;
    }
  }

  /**
   * Small still of the finished world for project cards (edit mode only).
   * Prefers WebP; browsers that cannot encode it (Safari) fall back to JPEG.
   */
  async thumbnail(width = 480, height = 270): Promise<string | null> {
    if (this.session || this.disposed) return null;
    try {
      await this.whenSynced();
      // Let the grow-in animation and any camera flight finish (bounded wait).
      const deadline = performance.now() + THUMBNAIL_SETTLE_MS;
      while (this.renderer.animating && performance.now() < deadline && !this.disposed) {
        this.touch();
        await new Promise((r) => setTimeout(r, 100));
      }
      // Wait (bounded) for a quiet moment: no input and nothing animating for THUMBNAIL_QUIET_MS.
      const quietDeadline = performance.now() + THUMBNAIL_QUIET_MAX_MS;
      let stillSince = performance.now();
      while (performance.now() < quietDeadline && !this.disposed && !this.session) {
        if (this.renderer.animating) stillSince = performance.now();
        if (quietReached(performance.now(), stillSince, this.lastInputAt)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      // Block terrain: wait (bounded) for the chunks around the view, so the still shows the world.
      const voxelDeadline = performance.now() + VOXEL_THUMBNAIL_WAIT_MS;
      while (this.voxel?.active && !this.voxel.settled && performance.now() < voxelDeadline && !this.disposed && !this.session) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (this.session || this.disposed) return null;
      const webp = await this.renderer.screenshot({ width, height, mime: 'image/webp' });
      if (webp.startsWith('data:image/webp')) return webp;
      return await this.renderer.screenshot({ width, height, mime: 'image/jpeg' });
    } catch (err) {
      log.warn('thumbnail failed', err);
      return null;
    }
  }

  /**
   * Orthographic top/front/side/iso renders of the settled world for the
   * quality critique (edit mode only; waits for grow-in like thumbnails).
   */
  async renderViews(size = 256): Promise<string[]> {
    if (this.session || this.disposed) return [];
    try {
      await this.whenSynced();
      const deadline = performance.now() + THUMBNAIL_SETTLE_MS;
      while (this.renderer.animating && performance.now() < deadline && !this.disposed) {
        this.touch();
        await new Promise((r) => setTimeout(r, 100));
      }
      if (this.session || this.disposed) return [];
      return await this.renderer.renderViews(['top', 'front', 'side', 'iso'], size);
    } catch (err) {
      log.warn('renderViews failed', err);
      return [];
    }
  }

  /** World-space bounds of an entity at full scale (null when not rendered). */
  entityBounds(id: EntityId): { min: Vec3; max: Vec3 } | null {
    return this.renderer.entityBounds(id);
  }

  /** Camera presets for the editor (orbit mode only). */
  /** Fly-through tour of the world (edit mode); returns false when there is nothing to tour. */
  tour(): boolean {
    if (this.session) return false;
    this.touch();
    return this.renderer.startTour();
  }

  viewPreset(preset: 'top' | 'front' | 'side' | 'iso'): void {
    if (this.session) return;
    this.touch();
    const dir: Vec3 = preset === 'top' ? [0, 1, 0.0001] : preset === 'front' ? [0, 0.18, 1] : preset === 'side' ? [1, 0.18, 0] : [0.62, 0.55, 0.85];
    this.renderer.viewFrom(dir);
  }

  /** Where a new object is placed: the orbit target, snapped to the ground plane (y ≥ 0). */
  placementPoint(): Vec3 {
    const t = this.renderer.orbitTarget();
    return [Math.round(t[0] * 2) / 2, Math.max(0, Math.round(t[1] * 2) / 2), Math.round(t[2] * 2) / 2];
  }

  /**
   * Camera-dependent overlays (axis gizmo, labels): called after every frame
   * that redrew the view, and once immediately. One listener at a time.
   */
  setViewListener(fn: ((camera: WorldRenderer['camera']) => void) | null): void {
    this.viewListener = fn;
    if (fn) fn(this.renderer.camera);
  }

  /** On-screen touch stick (play mode). */
  setVirtualStick(forward: number, right: number): void {
    this.session?.voxel?.input.setVirtualStick(forward, right);
    this.input.setVirtualStick(forward, right);
  }

  /** On-screen jump / action buttons (play mode). */
  tapVirtual(code: 'Space' | 'KeyE'): void {
    this.session?.voxel?.input.tap(code);
    this.input.tapVirtual(code);
  }

  /** Touch look: turn by degrees (play mode). */
  turnBy(deg: number): void {
    this.session?.voxel?.input.turnBy(deg);
    this.input.turnBy(deg);
  }

  private refreshDebug(): void {
    this.renderer.showDebug({ colliders: this.showColliders, diagnostics: this.diagnostics });
  }

  // ---------------------------------------------------------------------------
  // Play / stop
  // ---------------------------------------------------------------------------

  /** Enter play mode from the current world. No-op while already playing. */
  play(): Promise<void> {
    this.transition = this.transition.then(() => this.startSession()).catch((err: unknown) => {
      log.error('play failed', err);
      this.listener.onError?.(`Could not start the simulation: ${errorMessage(err)}`);
    });
    return this.transition;
  }

  /** Leave play mode and restore the pre-play world exactly. */
  stop(): Promise<void> {
    this.transition = this.transition.then(() => this.endSession()).catch((err: unknown) => {
      log.error('stop failed', err);
    });
    return this.transition;
  }

  /** Restart the running session from the original world. */
  restart(): Promise<void> {
    this.transition = this.transition
      .then(async () => {
        if (!this.session) return;
        await this.endSession();
        await this.startSession();
      })
      .catch((err: unknown) => {
        log.error('restart failed', err);
        this.listener.onError?.(`Could not restart: ${errorMessage(err)}`);
      });
    return this.transition;
  }

  /** Fire a logic `click` on an entity (play mode, orbit view). */
  click(id: EntityId): void {
    this.session?.logic.click(id);
  }

  /**
   * Build physics + logic for the current world and enter play mode. Atomic:
   * if any step fails, everything built so far is released and the studio
   * stays (or returns) in a consistent edit mode before the error propagates.
   */
  private async startSession(): Promise<void> {
    if (this.session || this.disposed) return;
    const world = this.history.current;
    this.requestSync(world);
    await this.whenSynced();
    if (this.disposed) return;
    // Lazy: the Rapier chunk is only downloaded/compiled when the user first plays.
    const { PhysicsWorld, CharacterController } = await import('@aether/physics');
    if (this.disposed) return;
    let pw: PhysicsWorld | null = null;
    let scripts: ScriptRunner | undefined;
    let character: CharacterController | null = null;
    let logic: LogicRuntime | null = null;
    let core: SessionCore | null = null;
    try {
      pw = await PhysicsWorld.create(world, { colliders: this.colliders, fixedDt: FIXED_DT });
      try {
        if (usesScripts(world)) {
          await initScripting();
          scripts = createScriptRunner({ seed: world.seed });
        }
      } catch (err) {
        this.listener.onError?.(`Scripts disabled: ${errorMessage(err)}`);
        scripts = undefined;
      }
      if (this.disposed) throw new Error('simulation disposed');
      const avatarId = findAvatar(world);
      const voxelGame = world.voxel !== undefined && this.voxel !== null && this.voxel.active;
      if (!voxelGame && !avatarId && world.player.mode !== 'orbit' && world.player.mode !== 'vehicle') {
        character = new CharacterController(pw, { radius: PLAYER_CAPSULE.radius, height: PLAYER_CAPSULE.height, spawn: world.player.spawn, id: PLAYER_PSEUDO_ID });
      }
      const voxel = voxelGame && this.voxel ? await this.voxel.startPlay(world, this.renderer.domElement) : null;
      if (voxelGame) {
        const terrain = this.voxel?.solidSource();
        if (terrain) pw.setVoxelTerrain(terrain);
      }
      core = { world, pw, scripts, character, avatarId, transients: new Set(), destroyed: new Set(), ended: false, voxel };
      logic = new LogicRuntime(world, this.createHost(core), scripts ? { scripts, seed: world.seed } : { seed: world.seed });
    } catch (err) {
      if (core) core.ended = true;
      if (core?.voxel) await this.voxel?.stopPlay().catch(() => undefined);
      safely('logic dispose', () => logic?.dispose());
      safely('scripts dispose', () => scripts?.dispose());
      safely('character dispose', () => character?.dispose());
      safely('physics dispose', () => pw?.dispose());
      if (this.disposed) return;
      throw err;
    }
    if (!core || !logic) return;
    const session: PlaySession = Object.assign(core, { logic });
    this.table.clear();
    for (const id of movingIds(world)) {
      const t = safeWorldTransform(world, id);
      if (t) this.table.ensure(id, t.position, t.quaternion);
    }
    this.session = session;
    this.applyGizmo();
    if (this.toolDragging) this.viewportTool?.cancel?.();
    this.toolDragging = false;
    this.viewportTool?.hover?.(null);
    this.renderer.setLeftDragNavigation(true);
    this.stopRequested = false;
    try {
      this.renderer.highlight([]);
      // Walkthroughs start facing the entrance; other games face where the editor camera looked.
      this.input.setYaw(entranceYawDeg(world) ?? cameraYawDeg(this.renderer));
      // The voxel game has its own input (mouse look, hotbar, break/place).
      if (!session.voxel) this.input.attach(this.renderer.domElement, { pointerLock: this.pointerLock });
      if (session.voxel) this.renderer.setCameraMode('manual');
      else if (session.avatarId) this.renderer.setCameraMode('follow', session.avatarId);
      else if (character) {
        this.renderer.setPlayerAvatar(character.position, this.input.yawDeg);
        this.renderer.setCameraMode(world.player.mode === 'firstPerson' ? 'firstPerson' : 'follow');
      } else this.renderer.setCameraMode('orbit');
      this.stepper.reset();
      session.logic.start();
    } catch (err) {
      // Roll back to edit mode so `mode`, the renderer sync and the UI agree.
      await this.endSession();
      throw err;
    }
    this.listener.onModeChange?.('play');
  }

  /**
   * Tear down the play session. Every step is guarded individually and the
   * return to edit mode (camera, UI mode, renderer catch-up) always happens,
   * so a failing teardown step can never leave the studio stuck in play mode.
   */
  private async endSession(): Promise<void> {
    const s = this.session;
    if (!s) return;
    this.session = null;
    s.ended = true;
    this.applyGizmo();
    try {
      safely('input detach', () => this.input.detach());
      if (s.voxel) await this.voxel?.stopPlay().catch((err: unknown) => log.warn('voxel stop failed', err));
      safely('logic dispose', () => s.logic.dispose());
      safely('scripts dispose', () => s.scripts?.dispose());
      safely('character dispose', () => s.character?.dispose());
      safely('transient removal', () => {
        for (const id of s.transients) this.renderer.removeTransient(id);
      });
      safely('physics dispose', () => s.pw.dispose());
      // Drops overrides and restores the document pose of overridden (e.g. destroyed) entities.
      safely('override reset', () => this.renderer.clearRuntimeOverrides());
      safely('pose reset', () => {
        // Put every moved object back at its document pose.
        for (const id of this.table.order) {
          const t = safeWorldTransform(s.world, id);
          if (t) this.table.write(id, t.position, t.quaternion);
        }
        this.renderer.applyTransforms(this.table.packed, this.table.order);
      });
    } finally {
      this.table.clear();
      safely('camera reset', () => this.renderer.setCameraMode('orbit'));
      safely('highlight', () => this.renderer.highlight(this.selection));
      safely('tool navigation', () => this.renderer.setLeftDragNavigation(this.viewportTool === null));
      this.listener.onModeChange?.('edit');
      // Catch up with edits that happened while playing.
      if (this.history.current !== s.world) this.requestSync(this.history.current);
    }
    await this.whenSynced();
  }

  /** LogicHost bound to one play session (stale calls after Stop are ignored). */
  private createHost(s: SessionCore): LogicHost {
    const sim = this;
    const isDoc = (id: EntityId): boolean => Object.prototype.hasOwnProperty.call(s.world.entities, id);
    // One reusable pose record per entity: getTransform runs many times per tick.
    const poses = new PosePool();
    return {
      getTransform(id) {
        if (s.ended || s.destroyed.has(id)) return undefined;
        const slot = poses.slot(id);
        if (id === PLAYER_PSEUDO_ID && s.voxel) {
          const b = s.voxel.game.player.body;
          const h = s.voxel.game.player.yaw / 2;
          slot.position[0] = b.x;
          slot.position[1] = b.y;
          slot.position[2] = b.z;
          slot.quaternion[0] = 0;
          slot.quaternion[1] = Math.sin(h);
          slot.quaternion[2] = 0;
          slot.quaternion[3] = Math.cos(h);
          return slot;
        }
        if (id === PLAYER_PSEUDO_ID && s.character) {
          const p = s.character.position;
          const h = (sim.input.yawDeg * Math.PI) / 360;
          slot.position[0] = p[0];
          slot.position[1] = p[1];
          slot.position[2] = p[2];
          slot.quaternion[0] = 0;
          slot.quaternion[1] = Math.sin(h);
          slot.quaternion[2] = 0;
          slot.quaternion[3] = Math.cos(h);
          return slot;
        }
        if (s.pw.readPose(id, slot.position, slot.quaternion)) return slot;
        if (sim.table.read(id, slot.position, slot.quaternion)) return slot;
        if (!isDoc(id)) return undefined;
        const t = safeWorldTransform(s.world, id);
        return t ? poses.fill(id, t.position, t.quaternion) : undefined;
      },
      setKinematic(id, position, quaternion) {
        if (s.ended || s.destroyed.has(id)) return;
        const body = bodyTypeOf(s.world, id);
        if (s.pw.has(id)) {
          if (body === 'static') s.pw.teleport(id, position, quaternion);
          else s.pw.setKinematicTarget(id, position, quaternion);
        }
        if (!s.pw.has(id) || body === 'static' || body === 'dynamic') sim.table.write(id, position, quaternion);
        else sim.table.ensure(id, position, quaternion);
      },
      applyImpulse: (id, v) => s.pw.applyImpulse(id, v),
      setVelocity: (id, v) => s.pw.setVelocity(id, v),
      getVelocity: (id) => (id === PLAYER_PSEUDO_ID && s.character ? [0, s.character.verticalSpeed, 0] : s.pw.getVelocity(id)),
      setAngularVelocity: (id, v) => s.pw.setAngularVelocity(id, v),
      teleport(id, p) {
        if (s.ended) return;
        if (id === PLAYER_PSEUDO_ID && s.character) s.character.teleport(p);
        else if (s.pw.has(id)) s.pw.teleport(id, p);
        else if (sim.table.read(id, scratchPos, scratchQuat)) sim.table.write(id, p, scratchQuat);
        else {
          const t = isDoc(id) ? safeWorldTransform(s.world, id) : undefined;
          if (t) sim.table.write(id, p, t.quaternion);
        }
      },
      explode: (c, f, r) => s.pw.explode(c, f, r),
      setGravity: (v) => s.pw.setGravity(v),
      spawn(entity) {
        if (s.ended) return;
        if (s.transients.size >= MAX_TRANSIENTS || isDoc(entity.id) || s.transients.has(entity.id)) return;
        s.transients.add(entity.id);
        s.destroyed.delete(entity.id);
        // Spawns are structured clones of templates from the validated session world.
        sim.renderer.addTransient(entity, { trusted: true });
        if (entity.physics) s.pw.addEntity(entity, { trusted: true });
        if (!entity.physics || entity.physics.body !== 'static') sim.table.ensure(entity.id, entity.transform.position, eulerDegToQuat(entity.transform.rotation));
      },
      destroy(id) {
        if (s.ended || s.destroyed.has(id)) return;
        s.destroyed.add(id);
        poses.release(id);
        s.pw.removeEntity(id);
        sim.table.remove(id);
        if (s.transients.delete(id)) sim.renderer.removeTransient(id);
        else if (isDoc(id)) sim.renderer.setEntityProperty(id, 'visible', false);
      },
      setProperty(id, path, value) {
        if (!s.ended) sim.renderer.setEntityProperty(id, path, value);
      },
      message(text, duration) {
        if (!s.ended) sim.listener.onMessage?.(String(text).slice(0, 240), duration);
      },
      sound(name) {
        if (!s.ended) sim.sound.play(name);
      },
      gameOver(result, text) {
        if (!s.ended) sim.listener.onGameOver?.(result, String(text).slice(0, 200));
      },
      reset() {
        if (!s.ended) queueMicrotask(() => void sim.restart());
      },
      playerId() {
        if (s.avatarId) return s.avatarId;
        return s.character || s.voxel ? PLAYER_PSEUDO_ID : undefined;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  private readonly onAnimationFrame = (t: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.onAnimationFrame);
    // Raw frame delta: the stepper and the renderer clamp long stalls themselves,
    // and clamping here would pin the fps counter at 1 / MAX_FRAME_DT on slow GPUs.
    const dt = this.lastFrame < 0 ? 0 : Math.max(0, (t - this.lastFrame) / 1000);
    this.lastFrame = t;
    const s = this.session;
    try {
      if (s) this.stepSession(s, dt);
      if (this.voxel?.active) this.voxel.frame(dt);
      // Edit mode renders on demand (frozen weather once idle); play mode renders every frame.
      this.renderOpts.onDemand = s === null;
      this.renderOpts.animate = s !== null || !this.idle.idle(t);
      const drew = this.renderer.render(dt, this.renderOpts);
      if (drew && this.viewListener) this.viewListener(this.renderer.camera);
      this.frameFailures = 0;
    } catch (err) {
      this.onFrameError(err, s);
    }
    if (t - this.lastStats >= STATS_INTERVAL_MS) {
      this.lastStats = t;
      try {
        this.emitStats();
      } catch (err) {
        log.warn('stats failed', err);
      }
    }
  };

  /** Report a failed frame once per distinct error; stop the loop when failures persist. */
  private onFrameError(err: unknown, s: PlaySession | null): void {
    this.frameFailures++;
    const message = errorMessage(err);
    if (message !== this.lastFrameError) {
      this.lastFrameError = message;
      log.error('frame failed', err);
      this.listener.onError?.(s ? `Simulation error: ${message} — stopped.` : `Rendering error: ${message}`);
    }
    if (s && !this.stopRequested) {
      this.stopRequested = true;
      void this.stop();
    }
    if (this.frameFailures >= MAX_FRAME_FAILURES) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.listener.onFatal?.(`The renderer stopped after repeated errors (${message}). Reload the page to continue.`);
    }
  }

  private stepSession(s: PlaySession, dt: number): void {
    const steps = this.stepper.advance(dt);
    const { pw, logic, character } = s;
    const speed = s.world.player.moveSpeed;
    const jump = s.world.player.jumpSpeed;
    for (let i = 0; i < steps && !s.ended; i++) {
      const input = this.input.sample(FIXED_DT);
      if (s.voxel) s.voxel.step(FIXED_DT);
      if (character) {
        character.move({ forward: input.forward, right: input.right, jump: input.jump, yawDeg: input.pointerYawDeg }, FIXED_DT, speed, jump);
        if (character.position[1] < PLAYER_KILL_Y) character.teleport(s.world.player.spawn);
      }
      const events = pw.stepFixed();
      logic.tick(FIXED_DT, input, events);
    }
    if (s.ended) return;
    pw.writeTransforms(this.table.packed, this.table.order);
    this.renderer.applyTransforms(this.table.packed, this.table.order);
    if (character) this.renderer.setPlayerAvatar(character.position, this.input.yawDeg);
  }

  private emitStats(): void {
    const s = this.session;
    // Worlds drawn through fields / virtual geometry always report (the viewport shows their triangle counts).
    if (!s && !this.statsWhileEditing && !this.renderer.scaleGeometryActive) return;
    const r = this.renderer.stats();
    const p = s ? s.pw.stats() : null;
    const heap = (performance as unknown as { memory?: { usedJSHeapSize?: unknown } }).memory?.usedJSHeapSize;
    this.listener.onStats?.({
      gpuMB: this.renderer.memoryStats().estimatedGpuMB,
      heapMB: typeof heap === 'number' && Number.isFinite(heap) ? Math.round(heap / MB) : 0,
      fps: r.fps,
      frameMs: r.frameMs,
      drawCalls: r.drawCalls,
      triangles: r.triangles,
      entities: r.entities,
      bodies: p ? p.bodies : 0,
      stepMs: p ? p.stepMs : 0,
      sceneTriangles: r.sceneTriangles ?? 0,
      fieldInstances: r.fieldInstances ?? 0,
      fieldDrawn: r.fieldDrawn ?? 0,
      virtualInstances: r.virtualInstances ?? 0,
      virtualDrawn: r.virtualDrawnTriangles ?? 0,
    });
    if (s && this.listener.onHud) {
      const hud: Record<string, Json | undefined> = {};
      for (const b of s.world.hud) hud[b.key] = s.logic.readState(b.key);
      this.listener.onHud(hud, s.logic.time);
    }
  }

  // ---------------------------------------------------------------------------
  // Pointer, resize, teardown
  // ---------------------------------------------------------------------------

  private toolPointer(e: PointerEvent): ToolPointer | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return {
      ndcX: (x / rect.width) * 2 - 1,
      ndcY: -(y / rect.height) * 2 + 1,
      x,
      y,
      pressure: e.pointerType === 'pen' ? Math.min(1, Math.max(0.05, e.pressure || 0.5)) : 1,
      pointerType: e.pointerType,
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
      alt: e.altKey,
    };
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.downValid = e.button === 0;
    this.downOnGizmo = this.renderer.gizmoBusy;
    this.downX = e.clientX;
    this.downY = e.clientY;
    if (isTypingElement(document.activeElement)) (document.activeElement as HTMLElement).blur();
    if (this.session || e.button !== 0 || this.downOnGizmo || !this.viewportTool) return;
    const p = this.toolPointer(e);
    if (!p || !this.viewportTool.down(p)) return;
    this.toolDragging = true;
    this.toolPointerId = e.pointerId;
    this.downValid = false;
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      /* capture is optional */
    }
    this.touch();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.session || !this.viewportTool) return;
    const p = this.toolPointer(e);
    if (!p) return;
    if (this.toolDragging && e.pointerId === this.toolPointerId) this.viewportTool.move(p);
    else if (!this.toolDragging && e.buttons === 0) this.viewportTool.hover?.(p);
  };

  private readonly onPointerLeave = (): void => {
    if (!this.toolDragging) this.viewportTool?.hover?.(null);
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (!this.toolDragging || e.pointerId !== this.toolPointerId) return;
    this.toolDragging = false;
    this.viewportTool?.cancel?.();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.toolDragging && e.pointerId === this.toolPointerId) {
      this.toolDragging = false;
      const p = this.toolPointer(e);
      if (p) this.viewportTool?.up(p);
      else this.viewportTool?.cancel?.();
      return;
    }
    if (!this.downValid || e.button !== 0) return;
    this.downValid = false;
    if (this.downOnGizmo) return;
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > CLICK_SLOP_PX) return;
    const p = this.toolPointer(e);
    if (!p) return;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!this.session && this.clickHandler?.(p, additive)) return;
    const id = this.renderer.pick(p.ndcX, p.ndcY, this.session ? undefined : this.pickSkip);
    if (this.session) {
      if (id) this.session.logic.click(id);
      return;
    }
    this.listener.onPick?.(id, additive);
  };

  /** Stop the loop while the page is hidden; resume (without a giant time step) when it shows again. */
  private readonly onVisibility = (): void => {
    if (this.disposed) return;
    const hidden = document.visibilityState === 'hidden';
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.sound.suspend();
      return;
    }
    this.lastFrame = -1;
    this.stepper.reset();
    this.touch();
    this.renderer.requestRender();
    if (this.raf === 0 && this.frameFailures < MAX_FRAME_FAILURES) this.raf = requestAnimationFrame(this.onAnimationFrame);
  };

  private readonly onActivity = (): void => {
    this.lastInputAt = performance.now();
    this.touch();
  };

  /** Time of the last pointer / key / wheel input (thumbnail captures wait for a quiet moment). */
  private lastInputAt = 0;

  private resize(): void {
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;
    const w = Math.max(1, Math.floor(parent.clientWidth));
    const h = Math.max(1, Math.floor(parent.clientHeight));
    this.renderer.resize(w, h);
  }

  /** Stop everything and release GPU/physics resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, this.onActivity, { capture: true });
    this.unsubscribe();
    this.resizeObserver?.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.marquee?.remove();
    this.marquee = null;
    const s = this.session;
    this.session = null;
    this.voxel?.dispose();
    this.voxel = null;
    if (s) {
      s.ended = true;
      this.input.detach();
      s.logic.dispose();
      s.scripts?.dispose();
      s.character?.dispose();
      s.pw.dispose();
    }
    this.sound.dispose();
    this.renderer.dispose();
  }
}

// -----------------------------------------------------------------------------
// Helpers (pure)
// -----------------------------------------------------------------------------

/** Input that counts as activity for the idle clock. */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'] as const;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

/** Run a teardown step, logging (not propagating) its failure. */
function safely(step: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    log.warn(`${step} failed`, err);
  }
}

function usesScripts(world: WorldDoc): boolean {
  if (Object.keys(world.scripts).length === 0) return false;
  for (const id in world.entities) {
    if (world.entities[id]?.behaviors.some((b) => b.type === 'script')) return true;
  }
  return false;
}

function bodyTypeOf(world: WorldDoc, id: EntityId): 'static' | 'dynamic' | 'kinematic' | null {
  const e = Object.prototype.hasOwnProperty.call(world.entities, id) ? world.entities[id] : undefined;
  return e?.physics ? e.physics.body : null;
}

function safeWorldTransform(world: WorldDoc, id: EntityId): { position: Vec3; quaternion: QuatTuple } | undefined {
  try {
    const t = worldTransform(world, id);
    return { position: t.position, quaternion: t.quaternion };
  } catch {
    return undefined;
  }
}

/** Camera yaw in degrees (0 faces −Z), used to start play facing where the editor camera looked. */
function cameraYawDeg(renderer: WorldRenderer): number {
  const e = renderer.camera.matrixWorld.elements;
  // Camera looks down its local −Z: forward = −(m8, m9, m10).
  scratchDir.x = -(e[8] as number);
  scratchDir.z = -(e[10] as number);
  if (Math.abs(scratchDir.x) + Math.abs(scratchDir.z) < 1e-6) return 0;
  return (Math.atan2(-scratchDir.x, -scratchDir.z) * 180) / Math.PI;
}

/**
 * Yaw in degrees (0 faces −Z) from the player spawn toward the building's
 * entrance (an entity tagged "entrance"), or null when there is none.
 */
export function entranceYawDeg(world: WorldDoc): number | null {
  for (const id in world.entities) {
    const e = world.entities[id];
    if (!e || !e.tags.includes('entrance')) continue;
    const t = worldTransform(world, id);
    if (!t) continue;
    const dx = t.position[0] - world.player.spawn[0];
    const dz = t.position[2] - world.player.spawn[2];
    if (Math.hypot(dx, dz) < 0.2) return null;
    return (Math.atan2(-dx, -dz) * 180) / Math.PI;
  }
  return null;
}

/** True when the user asked the OS/browser for reduced motion (no grow-in animation then). */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** The world contains a parametric building (`arch.role` "building"). */
function hasBuilding(world: WorldDoc): boolean {
  for (const id in world.entities) if (world.entities[id]?.arch?.role === 'building') return true;
  return false;
}
