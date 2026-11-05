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
import { eulerDegToQuat, worldTransform, type Entity, type EntityId, type FeelEvent, type History, type Json, type ResolvedCue, type Vec3, type WorldDoc } from '@aether/core';
import { Vector3 } from 'three';
import { initScripting, LogicRuntime, terrainSampler, type FeedbackEvent, type LogicHost, type NpcSystem, type QuatTuple, type ScriptRunner, type WeaponStatus, createScriptRunner } from '@aether/logic';
import type { CharacterController, ColliderProvider, PhysicsWorld } from '@aether/physics';
import { assetColliderDescs } from '@aether/physics/asset-colliders';
import { entityColliderBounds, entityWorldBounds } from '@aether/physics/bounds';
import type { SandboxRunner } from '@aether/procgen';
import { WorldRenderer, type LightmapStatus, type BackendPreference, type BackendReason, type ContextLossInfo, type WatchdogEvent, type GizmoCommit, type GizmoMode, type GizmoOptions, type ProofTrace, type RenderDiagnostic, type RenderProcessingStage, type RenderMemoryStats } from '@aether/render';
import { FIXED_DT, MAX_FRAME_DT, MAX_SUBSTEPS, PLAYER_CAPSULE, PLAYER_PSEUDO_ID, STATS_INTERVAL_MS } from '../config';
import { CROUCH_CAMERA_DROP, paceSpeed, playerPace } from './playerPace';
import { createLogger, errorMessage } from '../lib/log';
import { yieldToPaint } from '../lib/yieldToPaint';
import { FixedStepper } from './FixedStepper';
import { buildNpcFrame, frameSignature, type NpcFrame } from './npcFrame';
import { IdleClock } from './IdleClock';
import { InputController, wrapDeg } from './input';
import { GamepadPoller, STICK_TURN_SPEED } from './gamepad';
import { SoundBoard } from './sound';
import { PosePool } from './posePool';
import { TransformTable } from './TransformTable';
import { findAvatar, framingSphere, movingIds } from './worldQueries';
import type { VoxelSession, VoxelPlay } from '../voxel/session';
import type { VoxelHudState } from '../voxel/hudState';
import { nextFrame } from '../lib/frame';
import { PlayInteraction, seatPose, SEATED_EYE, type InteractPrompt, type SeatPose } from './interaction';
import { SeatSequence, type SeatFrame } from './seat-sequence';
import { exitCandidates, nearestFree, pickExit, seatTopFromHits, StuckWatch } from './seat-geometry';
import { FeelOverlay } from './feelOverlay';
import { footstepEffect, landingIntensity } from './feel';

/** Longest wait for content to finish materialising before a thumbnail (ms). */
const THUMBNAIL_SETTLE_MS = 6000;
/** How long the world must stay free of pending work before it counts as fully loaded (ms). */
/** Frames at the running rate (each under {@link SETTLE_FRAME_MS}) drawn behind the load screen before it lifts, and the longest wait for them. */
const SETTLE_FRAMES = 4;
const SETTLE_FRAME_MS = 70;
const SETTLE_FRAMES_MAX_MS = 4000;
const READY_STABLE_MS = 600;
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
  onProcessing?(stage: RenderProcessingStage | null): void;
  /**
   * A tier change is being applied (`tier`: the tier, the view keeps its last complete picture meanwhile) or is over (null),
   * or the tier in effect or the reason of the automatic tier changed (`changed`): Settings shows them.
   */
  onQualityTransition?(tier: string | null): void;
  onGraphicsChanged?(): void;
  /** Play-mode HUD refresh (4 Hz): values of `world.hud` keys + game time. */
  onHud?(hud: Record<string, Json | undefined>, time: number): void;
  onMessage?(text: string, duration: number): void;
  /**
   * Characters: the running conversation, the talk hint and speech bubbles.
   * Called when something changes (and about 12 times a second while bubbles
   * follow their speakers); `null` when there is nothing to show.
   */
  onNpc?(frame: NpcFrame | null): void;
  onGameOver?(result: 'win' | 'lose', text: string): void;
  onPick?(id: EntityId | null, additive: boolean): void;
  /** A gizmo drag ended: the new local transforms of every moved entity (one undoable edit). */
  onTransform?(commit: GizmoCommit): void;
  /** The renderer finished syncing to a new world (overlays that reference rendered geometry refresh). */
  onSynced?(): void;
  onModeChange?(mode: 'edit' | 'play'): void;
  onError?(message: string): void;
  /** Frames stayed slow and the renderer gave something up (`step` names it, see the render package's performance ladder). */
  onPerformance?(level: number, step: string, up?: boolean): void;
  /** The render loop stopped after repeated failures; the page must be reloaded. */
  onFatal?(message: string): void;
  /** The GPU device / WebGL context was lost; the simulation must be replaced. */
  onContextLost?(info: ContextLossInfo): void;
  /** The viewport stayed blank and the renderer stepped down, or a shader failed to build. */
  onWatchdog?(e: WatchdogEvent): void;
  /** Voxel game HUD snapshot (null when no voxel game runs). */
  onVoxelHud?(state: VoxelHudState | null): void;
  /** The player pressed Start / Options on a controller (published games open their pause menu). */
  onPauseRequest?(): void;
  /** What the crosshair is on and can use ("E · Open drawer"); null when nothing. */
  onInteract?(prompt: InteractPrompt | null): void;
  /** The baked interior light started, progressed, applied, failed or was cancelled. */
  onLightmap?(status: LightmapStatus): void;
  /** The player's gun changed (ammunition, reload, a hit or a kill landed); null when play stops or there is none. */
  onCombat?(hud: CombatHud | null): void;
}

/** Weapon HUD snapshot (see {@link SimulationListener.onCombat}). */
export interface CombatHud {
  name: string;
  ammo: number;
  reserve: number;
  magazine: number;
  reloading: boolean;
  /** Reload progress 0..1 (tenths). */
  reload: number;
  /** Hits and kills landed so far (a change shows a hit marker). */
  hits: number;
  kills: number;
  /** The last hit was a head shot. */
  head: boolean;
}

/** Construction options. */
export interface SimulationOptions {
  /** Where bundled baked-lightmap files are served (see the render package's `lightmapBase`). */
  lightmapBase?: string | null;
  /** Backend policy (default 'auto'). */
  backend?: BackendPreference;
  /** Why WebGL2 is forced (recorded in the backend report). */
  backendReason?: BackendReason;
  shadows?: boolean;
  pointerLock?: boolean;
  sandbox?: SandboxRunner;
  onProgress?: (msg: string) => void;
  /** Low-memory mode (see `renderBudget` in `@aether/render`). */
  lowMemory?: boolean;
  /** Start in safe mode (lowest tier, no effects). */
  safeMode?: boolean;
  /** Skip collecting renderer stats in edit mode (perf HUD hidden). */
  statsWhileEditing?: boolean;
  /**
   * Scatter fields and virtual geometry (default true). False draws every
   * layer and sculpture at full detail (`?engine=classic`, comparisons).
   */
  scaleGeometry?: boolean;
  /** Keep library textures block-compressed on the GPU (KTX2 twins; default true). False loads the original images. */
  compressedTextures?: boolean;
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

/** Interval between NPC overlay samples while bubbles follow their speakers (ms). */
const NPC_FRAME_MS = 80;

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
  /** The player is crouched (C toggles it): slow, quiet steps, crouched body, lower camera. */
  private sneaking = false;
  /** The player is sprinting (Shift held while moving). */
  private sprinting = false;
  /** The trigger was held at the last fixed step. */
  private firing = false;
  /** C was down at the last fixed step (the crouch toggle acts on the press). */
  private crouchKeyDown = false;
  /** Eased crouch amount (0 standing .. 1 crouched) for the camera drop. */
  private crouchBlend = 0;
  /** Feet before and after the last fixed step: the drawn body is interpolated between them (no stutter when frames and steps do not line up). */
  private readonly stepFrom: [number, number, number] = [0, 0, 0];
  private readonly stepTo: [number, number, number] = [0, 0, 0];
  private stepValid = false;
  /** Aim-and-use controller of the running session (drawers, doors, taps, props to carry). */
  private interaction: PlayInteraction | null = null;
  /** The player sits on a piece of furniture (capsule disabled, eye lowered, movement locked until they stand). */
  private readonly stuck = new StuckWatch();
  private sitting: { id: EntityId; pose: SeatPose; seq: SeatSequence; frame: SeatFrame } | null = null;
  private readonly interactionKeys = (e: KeyboardEvent): void => this.onInteractionKey(e);
  private readonly interactionClick = (e: PointerEvent): void => {
    if (e.button === 0 && this.interaction?.throwCarried()) e.stopImmediatePropagation();
  };
  private readonly speakingScratch = new Set<string>();
  private readonly lookScratch = new Vector3();
  private npcSig = '';
  private npcQuick = '';
  private npcAt = 0;
  private npcTalking = false;
  private readonly pad = new GamepadPoller();
  /** The controller moved the player last frame (its stick is released once it goes idle). */
  private padMoving = false;
  /** Physics, logic and the voxel game are frozen (pause menu of published games). */
  private paused = false;
  /** Mouse look multiplier applied to both play inputs. */
  private lookSensitivity = 1;
  /** Block terrain + voxel game, loaded on the first world with `voxel` (null until then). */
  voxel: VoxelSession | null = null;
  private voxelLoading: Promise<VoxelSession> | null = null;
  private readonly saveBase: string;
  private readonly unsubscribe: () => void;
  private readonly resizeObserver: ResizeObserver | null;
  private session: PlaySession | null = null;
  /** The editor camera when Play began: Stop puts it back (a walk must not leave the editor eye in front of a wall). */
  private editPose: ReturnType<WorldRenderer['cameraPose']> | null = null;
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
  /** True while the play session is held (title card showing): the scene renders, the game does not advance. */
  private held = false;
  /** Screen layer of the game feel (flash, vignette, floating text); null without a DOM parent. */
  private overlay: FeelOverlay | null = null;
  /** Accessibility: no camera shake, FOV kicks or flashes. */
  private reducedMotion = false;
  /** Landing / jump detection of the walking player. */
  private wasGrounded = true;
  private fallSpeed = 0;
  /** Fixed steps of this session (seeds the effects the studio itself triggers: landings, jumps, steps). */
  private feelStep = 0;
  /** Feel cues played this session (diagnostics, e2e). */
  private feelPlayed = 0;

  private constructor(renderer: WorldRenderer, history: History, listener: SimulationListener, opts: SimulationOptions) {
    this.renderer = renderer;
    this.history = history;
    this.listener = listener;
    this.pointerLock = opts.pointerLock === true;
    this.statsWhileEditing = opts.statsWhileEditing !== false;
    this.saveBase = opts.saveBase ?? 'scratch';
    renderer.onFootstep((id, _foot, speed, position) => this.footstep(id, speed, position));
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
    if (parent && typeof document !== 'undefined') this.overlay = new FeelOverlay(parent);
    this.setReducedMotion(prefersReducedMotion());
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
      ...(opts.backendReason ? { backendReason: opts.backendReason } : {}),
      shadows: opts.shadows !== false,
      antialias: true,
      lowMemory: opts.lowMemory === true,
      ...(opts.safeMode ? { safeMode: true } : {}),
      growIn: !prefersReducedMotion(),
      ...(opts.scaleGeometry === false ? { fields: false, virtualGeometry: false } : {}),
      ...(opts.compressedTextures === false ? { transcoderPath: null } : {}),
      ...(opts.lightmapBase !== undefined ? { lightmapBase: opts.lightmapBase } : {}),
      onLightmapStatus: (status) => listener.onLightmap?.(status),
      onContextLost: (info) => listener.onContextLost?.(info),
      ...(opts.sandbox ? { sandbox: opts.sandbox } : {}),
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    });
    renderer.onPerformanceStep = (level, step, up) => listener.onPerformance?.(level, step, up);
    renderer.onWatchdog = (e) => listener.onWatchdog?.(e);
    return new Simulation(renderer, history, listener, opts);
  }

  /** 'play' while a session runs. */
  get mode(): 'edit' | 'play' {
    return this.session ? 'play' : 'edit';
  }

  /**
   * Hold (or release) the play session: while held, physics and logic do not
   * advance (the title card is showing) but the scene keeps rendering.
   * Set it before `play()` so not even the first tick runs.
   */
  setHeld(on: boolean): void {
    if (on === this.held) return;
    this.held = on;
    // Releasing must not replay the held time as a burst of catch-up steps.
    this.stepper.reset();
    // A held session has not begun: its start rules (a welcome message, a first timer) run when the player starts.
    if (!on) this.session?.logic.start();
    this.touch();
  }

  /** Whether the play session is held (see {@link setHeld}). */
  get isHeld(): boolean {
    return this.held;
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

  /**
   * Resolves once the world is fully prepared for exploring: synced, every model and texture in, every program linked,
   * every static batch merged, and the fly-in over. Readiness must hold for {@link READY_STABLE_MS} (late models start
   * new work a moment after the last finished). Gives up after `maxMs` so a stuck asset never locks the user out.
   * `onStage` reports what is still pending.
   */
  async whenFullyLoaded(maxMs = 150_000, onStage?: (stage: RenderProcessingStage | 'motion') => void): Promise<void> {
    await this.whenSynced();
    this.renderer.setLoading(true);
    try {
      await this.loadFully(maxMs, onStage);
    } finally {
      this.renderer.setLoading(false);
    }
    // The first frames after loading are the slow ones (the GPU catches up with what was just prepared, 0.3-0.5 s on an
    // integrated GPU): they are drawn behind the load screen too, so the world appears at its running frame rate.
    const until = performance.now() + SETTLE_FRAMES_MAX_MS;
    let last = performance.now();
    let smooth = 0;
    while (!this.disposed && performance.now() < until && smooth < SETTLE_FRAMES) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const t = performance.now();
      smooth = t - last < SETTLE_FRAME_MS ? smooth + 1 : 0;
      last = t;
    }
  }

  private async loadFully(maxMs: number, onStage?: (stage: RenderProcessingStage | 'motion') => void): Promise<void> {
    const end = performance.now() + maxMs;
    // What lies around the spawn point is prepared now, not on the first turn of the camera.
    // The buildings' light bake first: when it lands, every lit material changes to its volume-lit form and is prepared
    // again (2,800 objects and 20 programs on a hillside town, a minute of a load spent twice). Sweeping after it
    // prepares each object once.
    const bakeEnd = performance.now() + maxMs / 3;
    if (this.renderer.lightVolumeBaking) {
      onStage?.('lighting');
      performance.mark('aether:bake-wait');
      while (!this.disposed && this.renderer.lightVolumeBaking && performance.now() < bakeEnd) await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    onStage?.('render');
    performance.mark('aether:sweep-start');
    // Four headings: a 16:9 view is about 90° wide, so four cover the circle (six overlapped and prepared twice).
    await this.renderer.prepareSurroundings(4, Math.max(1000, maxMs / 3));
    performance.mark('aether:sweep-end');
    let readySince = 0;
    let last: string | null = null;
    while (!this.disposed && performance.now() < end) {
      const r = this.renderer;
      // The building light bake runs on the GPU right after loading: on an integrated GPU it froze the first steps for
      // up to ten seconds, so it finishes behind the load screen too.
      const stage: RenderProcessingStage | 'motion' | null = this.pendingWorld ? 'scene' : (r.processingStage ?? (r.lightVolumeBaking ? 'lighting' : r.animating ? 'motion' : null));
      if (stage === null) {
        if (readySince === 0) readySince = performance.now();
        else if (performance.now() - readySince >= READY_STABLE_MS) {
          performance.mark('aether:fully-loaded');
          return;
        }
      } else {
        readySince = 0;
        if (stage !== last) {
          performance.mark(`aether:wait-${stage}`);
          onStage?.(stage);
        }
      }
      last = stage;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    if (!this.disposed) performance.mark('aether:load-timeout');
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
    this.emitProcessing();
    if (!idle) return; // the running chain picks up the newest world
    this.syncChain = this.syncChain.then(async () => {
      // Coalesce: always render the newest world requested while waiting.
      while (this.pendingWorld && !this.disposed) {
        await yieldToPaint();
        if (!this.pendingWorld || this.disposed) break;
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
      if (this.disposed) return;
      this.refreshDebug();
      this.renderer.highlight(this.selection.filter((id) => this.syncedWorldDoc && Object.prototype.hasOwnProperty.call(this.syncedWorldDoc.entities, id)));
      // The entity's rendered object may have been rebuilt: re-attach the gizmo.
      this.applyGizmo();
      this.listener.onSynced?.();
      this.emitProcessing();
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

  /** Outline the candidates of a question without touching the selection (empty restores it). */
  setCandidates(ids: readonly EntityId[]): void {
    this.renderer.highlight(ids.length > 0 ? ids.slice(0, 32) : this.selection);
  }

  /** Where the camera looks, in the convention of the small-edit parser: 0 = toward −Z, 90 = toward +X. */
  cameraHeading(): number {
    const h = -cameraYawDeg(this.renderer);
    return Number.isFinite(h) ? h : 0;
  }

  /**
   * Where the player faces, in the convention of {@link cameraHeading}: the control yaw itself, current as soon as
   * {@link turnBy} returns. The camera heading only changes when a frame renders and the follow camera eases after the
   * player, so it is the wrong feedback for a controller that turns in small steps (a voxel session reports the camera).
   */
  playerHeading(): number {
    if (this.session?.voxel) return this.cameraHeading();
    const h = -wrapDeg(this.input.yawDeg);
    return Number.isFinite(h) ? h : 0;
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
   * for the renderer to catch up. This is the overview; worlds open on
   * {@link openWorld}.
   */
  async frameWorld(opts: { flyIn?: boolean } = {}): Promise<void> {
    await this.whenSynced();
    if (this.disposed || this.session) return;
    this.overviewReturn = null;
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
    await this.renderer.prepareFraming();
    if (this.disposed || this.session || this.history.current !== world) return;
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
   * Open a world on its opening view: the world's own `opening`, else a computed eye-level view inside it (open
   * ground near the middle, facing the landmark; see the renderer's `openingPose`), not the far overview. Block
   * worlds and worlds with nothing to stand on are framed as by {@link frameWorld}. `duration` 0 jumps.
   */
  async openWorld(opts: { duration?: number } = {}): Promise<void> {
    await this.whenSynced();
    if (this.disposed || this.session) return;
    const world = this.history.current;
    if (world.voxel && this.voxel?.active && !world.opening) return this.frameWorld();
    await this.renderer.prepareFraming();
    if (this.disposed || this.session || this.history.current !== world) return;
    this.overviewReturn = null;
    if (!this.renderer.frameOpening(opts.duration !== undefined ? { duration: opts.duration } : {})) await this.frameWorld();
  }

  /** The view to fly back to from the overview (null when the overview is not shown). */
  private overviewReturn: { pos: Vec3; target: Vec3 } | null = null;

  /** The overview is shown (see {@link toggleOverview}). */
  get inOverview(): boolean {
    return this.overviewReturn !== null;
  }

  /**
   * Fly to the zoomed-out overview of the whole world and, called again, back to the view it left. Returns whether
   * the overview is now shown.
   */
  async toggleOverview(): Promise<boolean> {
    if (this.disposed || this.session) return false;
    const back = this.overviewReturn;
    if (back) {
      this.overviewReturn = null;
      this.renderer.flyToPose(back.pos, back.target, FRAME_DURATION);
      return false;
    }
    const now = this.renderer.cameraPose();
    await this.frameWorld();
    if (this.disposed || this.session) return false;
    this.overviewReturn = { pos: now.pos, target: now.target };
    return true;
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
    const mode = view === 'follow' && s.world.player.weapon ? 'shoulder' : view;
    if (s.avatarId) this.renderer.setCameraMode(mode, s.avatarId);
    else if (s.character) this.renderer.setCameraMode(mode);
  }

  /** Hold or release the weapon's trigger (on-screen fire button, test drivers). */
  setVirtualFire(on: boolean): void {
    this.input.setVirtualFire(on);
  }

  /** Live state of the player's gun in the running session (null without one). */
  get weapon(): WeaponStatus | null {
    return this.session?.logic.weapon ?? null;
  }

  /** Data URL screenshot of the viewport. */
  async screenshot(): Promise<string | null> {
    try {
      await this.whenSynced();
      // Draw as frame work, not inside whichever task resolved the caller (see lib/frame).
      await nextFrame();
      if (this.disposed) return null;
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
    // A video or still export owns the renderer: the autosave thumbnail waits for the next save.
    if (this.session || this.disposed || this.renderer.capturing) return null;
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
      // Draw as frame work, not inside whichever task resolved the caller: the agent's
      // critique follows a verification result, and the capture's pipeline compilation
      // would otherwise stretch that worker message task (see lib/frame).
      await nextFrame();
      if (this.session || this.disposed) return [];
      return await this.renderer.renderViews(['top', 'front', 'side', 'iso'], size);
    } catch (err) {
      log.warn('renderViews failed', err);
      return [];
    }
  }

  /**
   * Renders explicit camera poses for the review loop (edit mode only), one image per pose in order (null where a
   * pose could not be captured). Poses flagged `hideTops` (plan views from above) are taken with the building
   * view lowered to a plan, so ceilings and the roof do not hide the rooms; the view is restored afterwards.
   */
  async capturePoses(poses: ReadonlyArray<{ position: Vec3; target: Vec3; up: Vec3; fov: number; hideTops: boolean }>, size: { width: number; height: number }): Promise<Array<string | null>> {
    if (this.session || this.disposed) return poses.map(() => null);
    const out: Array<string | null> = poses.map(() => null);
    try {
      await this.whenSynced();
      const deadline = performance.now() + THUMBNAIL_SETTLE_MS;
      while (this.renderer.animating && performance.now() < deadline && !this.disposed) {
        this.touch();
        await new Promise((r) => setTimeout(r, 100));
      }
      await nextFrame();
      if (this.session || this.disposed) return out;
      const run = async (indices: number[]): Promise<void> => {
        if (indices.length === 0) return;
        const images = await this.renderer.capturePoses(indices.map((i) => poses[i] as (typeof poses)[number]), { ...size, mime: 'image/jpeg' });
        indices.forEach((poseIndex, k) => {
          out[poseIndex] = images[k] ?? null;
        });
      };
      const normal = poses.map((p, i) => (p.hideTops ? -1 : i)).filter((i) => i >= 0);
      const plans = poses.map((p, i) => (p.hideTops ? i : -1)).filter((i) => i >= 0);
      await run(normal);
      if (plans.length > 0) {
        const previous = this.renderer.archViewState;
        this.renderer.setArchView({ walls: 'down' });
        try {
          const settle = performance.now() + THUMBNAIL_SETTLE_MS;
          await nextFrame();
          while (this.renderer.animating && performance.now() < settle && !this.disposed) await new Promise((r) => setTimeout(r, 60));
          await nextFrame();
          await run(plans);
        } finally {
          this.renderer.setArchView({ walls: previous.walls });
        }
      }
    } catch (err) {
      log.warn('capturePoses failed', err);
    }
    return out;
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

  /**
   * Put the walking player at `feet` looking along `yawDeg` / `pitchDeg` (play
   * mode, worlds with a walking player). Used by guided tours and tests; returns
   * false when there is nothing to move.
   */
  placePlayer(feet: Vec3, yawDeg: number, pitchDeg = 0): boolean {
    const c = this.session?.character;
    if (!c || !Number.isFinite(yawDeg + pitchDeg + feet[0] + feet[1] + feet[2])) return false;
    c.teleport(feet);
    this.input.setYaw(yawDeg);
    this.input.setPitch(pitchDeg);
    return true;
  }

  /** On-screen touch stick (play mode). */
  setVirtualStick(forward: number, right: number): void {
    this.session?.voxel?.input.setVirtualStick(forward, right);
    this.input.setVirtualStick(forward, right);
  }

  /** On-screen jump / action buttons (play mode). */
  tapVirtual(code: 'Space' | 'KeyE' | 'KeyR'): void {
    if (code === 'KeyE' && this.interaction?.use()) return;
    if (code !== 'KeyR') this.session?.voxel?.input.tap(code);
    this.input.tapVirtual(code);
  }

  /** Touch look: turn by degrees (play mode). */
  turnBy(deg: number): void {
    this.session?.voxel?.input.turnBy(deg);
    this.input.turnBy(deg);
  }

  /** Look along a heading and pitch in degrees (0 faces −Z; negative pitch looks down): aim assists and test drivers. */
  setLook(yawDeg: number, pitchDeg: number): void {
    if (!Number.isFinite(yawDeg) || !Number.isFinite(pitchDeg)) return;
    this.input.setYaw(yawDeg);
    this.input.setPitch(pitchDeg);
  }

  /** Where the play camera is and looks (eye and unit direction), for aim assists and test drivers. */
  get viewRay(): { origin: [number, number, number]; dir: [number, number, number] } {
    const e = this.renderer.camera.matrixWorld.elements;
    const d: [number, number, number] = [-(e[8] as number), -(e[9] as number), -(e[10] as number)];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return { origin: [e[12] as number, e[13] as number, e[14] as number], dir: [d[0] / l, d[1] / l, d[2] / l] };
  }

  private refreshDebug(): void {
    this.renderer.showDebug({ colliders: this.showColliders, diagnostics: this.diagnostics });
  }

  // ---------------------------------------------------------------------------
  // Play / stop
  // ---------------------------------------------------------------------------

  /**
   * Replay a verification run's motion over the edited world (ghosts and
   * trails). Edit mode only; resolves true once it plays.
   */
  async playProof(trace: ProofTrace): Promise<boolean> {
    if (this.disposed || this.session) return false;
    await this.whenSynced();
    if (this.disposed || this.session) return false;
    this.touch();
    return this.renderer.playProof(trace, { reducedMotion: prefersReducedMotion() });
  }

  /** Stop a running proof replay. */
  stopProof(): void {
    this.renderer.stopProof();
  }

  /** Enter play mode from the current world. No-op while already playing. */
  play(): Promise<void> {
    // Edit-mode decorations (proof replay, plan marks) never carry into play.
    this.renderer.stopProof();
    this.renderer.stopGhost();
    this.renderer.clearBlueprint();
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
  restart(opts: { held?: boolean } = {}): Promise<void> {
    this.transition = this.transition
      .then(async () => {
        if (!this.session) return;
        await this.endSession();
        // Leaving play releases any hold; a restart onto a title card holds the new session again before it is built.
        if (opts.held !== undefined) this.setHeld(opts.held);
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
    this.editPose = this.renderer.cameraPose();
    const world = this.history.current;
    this.requestSync(world);
    await this.whenSynced();
    if (this.disposed) return;
    // Lazy: the Rapier chunk is only downloaded/compiled when the user first plays.
    const { PhysicsWorld, CharacterController, CHARACTER_FEEL } = await import('@aether/physics');
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
        character = new CharacterController(pw, { radius: PLAYER_CAPSULE.radius, height: PLAYER_CAPSULE.height, spawn: world.player.spawn, id: PLAYER_PSEUDO_ID, feel: CHARACTER_FEEL, settleSpawn: true });
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
    this.wasGrounded = true;
    this.fallSpeed = 0;
    this.feelStep = 0;
    this.feelPlayed = 0;
    this.renderer.fx.reset();
    this.renderer.fx.playing = true;
    this.startInteraction(session);
    if (session.voxel) session.voxel.input.sensitivity = this.lookSensitivity;
    this.applyGizmo();
    if (this.toolDragging) this.viewportTool?.cancel?.();
    this.toolDragging = false;
    this.viewportTool?.hover?.(null);
    this.renderer.setLeftDragNavigation(true);
    this.stopRequested = false;
    try {
      this.renderer.highlight([]);
      // Walkthroughs start facing the entrance; other games face where the editor camera looked.
      // An authored start that looks into a wall (a blank facade a few metres away) turns to the entrance instead.
      this.input.setYaw(startYawDeg(world, (o, d, max) => session.pw.raycast(o, d, max) !== null) ?? cameraYawDeg(this.renderer));
      this.input.setPitch(0);
      // The voxel game has its own input (mouse look, hotbar, break/place).
      // A gun captures the mouse (aim with it, click to fire) and looks over the shoulder in third person.
      const armed = world.player.weapon !== undefined && !session.voxel;
      if (!session.voxel) this.input.attach(this.renderer.domElement, { pointerLock: this.pointerLock || armed, fire: armed });
      const chase = armed ? 'shoulder' : 'follow';
      if (session.voxel) this.renderer.setCameraMode('manual');
      else if (session.avatarId) this.renderer.setCameraMode(chase, session.avatarId);
      else if (character) {
        this.renderer.setPlayerAvatar(character.position, this.input.yawDeg);
        this.renderer.setCameraMode(world.player.mode === 'firstPerson' ? 'firstPerson' : chase);
      } else this.renderer.setCameraMode('orbit');
      this.stepper.reset();
      if (!this.held) session.logic.start();
    } catch (err) {
      // Roll back to edit mode so `mode`, the renderer sync and the UI agree.
      await this.endSession();
      throw err;
    }
    this.combatKey = '';
    this.combatKills = 0;
    this.combatLastKill = -1;
    this.listener.onCombat?.(null);
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
    this.stopInteraction();
    this.sitting = null;
    this.renderer.fx.playing = false;
    this.renderer.fx.reset();
    this.overlay?.clear();
    this.renderer.setEyeHeight(1.6);
    this.renderer.setCrouchDrop(0);
    this.sneaking = false;
    this.sprinting = false;
    this.crouchKeyDown = false;
    this.crouchBlend = 0;
    this.stepValid = false;
    if (this.npcSig !== '') {
      this.npcSig = '';
      this.npcQuick = '';
      this.listener.onNpc?.(null);
    }
    this.paused = false;
    this.padMoving = false;
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
      safely('camera restore', () => {
        const p = this.editPose;
        this.editPose = null;
        if (p && !s.voxel) this.renderer.lookAt(p.pos, p.target, p.fov);
      });
      safely('highlight', () => this.renderer.highlight(this.selection));
      safely('tool navigation', () => this.renderer.setLeftDragNavigation(this.viewportTool === null));
      this.listener.onCombat?.(null);
      this.listener.onModeChange?.('edit');
      // Catch up with edits that happened while playing.
      if (this.history.current !== s.world) this.requestSync(this.history.current);
    }
    await this.whenSynced();
  }

  /** Sit on a seat entity of the world (sofa, chair…); false when there is no walking player or the piece is no seat. */
  sitOn(id: EntityId): boolean {
    const s = this.session;
    const character = s?.character;
    const e = s?.world.entities[id];
    if (!s || !character || !e || this.sitting) return false;
    const kind = e.arch?.kind ?? '';
    const t = safeWorldTransform(s.world, id);
    if (!t) return false;
    const q = t.quaternion;
    const yaw = (Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[2] * q[2])) * 180) / Math.PI;
    const b = entityWorldBounds(s.world, id);
    // Footprint in the piece's own frame: a piece turned a quarter swaps its world extents.
    const quarter = Math.abs(Math.sin((yaw * Math.PI) / 180)) > 0.7;
    const wx = b ? b.max[0] - b.min[0] : 1;
    const wz = b ? b.max[2] - b.min[2] : 0.8;
    const dims = { width: quarter ? wz : wx, depth: quarter ? wx : wz, height: b ? b.max[1] - b.min[1] : 0 };
    // The floor under the piece is the bottom of its bounds (an origin at the middle would seat the player in the base).
    const floorY = b && b.min[1] < t.position[1] + 0.05 ? Math.min(t.position[1], b.min[1]) : t.position[1];
    const pose = seatPose(kind, [t.position[0], floorY, t.position[2]], yaw, character.position, dims);
    if (!pose) return false;
    // The real cushion top: drop a probe on the pelvis column from above the piece and take where it meets the seat.
    const probeTop = (b ? b.max[1] : floorY + 1.2) + 0.1;
    const hits = s.pw.raycastAll([pose.floor[0], probeTop, pose.floor[2]], [0, -1, 0], probeTop - floorY + 0.2, 10).filter((h) => h.id === id);
    const top = seatTopFromHits(hits.map((h) => h.point[1]), floorY, pose.top);
    pose.top = top;
    pose.feet = [pose.feet[0], floorY + top, pose.feet[2]];
    // The capsule is out of the world for the whole sitting: it cannot climb the furniture. The body is placed by the sequence.
    const from = character.position;
    character.setEnabled(false);
    character.teleport(pose.floor);
    this.input.setPitch(-8);
    const seq = new SeatSequence(pose, from);
    this.sitting = { id, pose, seq, frame: seq.update(0) };
    return true;
  }

  /** Stand up in front of the seat (the body rises and steps out; the capsule returns when it has). */
  standUp(): void {
    const sit = this.sitting;
    if (!sit) return;
    if (sit.seq.canStand) sit.seq.setExit(this.freeExit(sit.pose));
    sit.seq.standUp();
  }

  /** A standing point beside the seat where the capsule fits: the front first, then the sides, then behind. */
  private freeExit(pose: SeatPose): Vec3 {
    const pw = this.session?.pw;
    if (!pw) return pose.stand;
    const free = (p: Vec3): boolean => pw.capsuleFree(p, PLAYER_CAPSULE.radius, PLAYER_CAPSULE.height, 0.1);
    const fx = pose.stand[0] - pose.floor[0];
    const fz = pose.stand[2] - pose.floor[2];
    const floorY = pose.floor[1];
    const first: Vec3 = [pose.stand[0], floorY + 0.02, pose.stand[2]];
    if (free(first)) return first;
    return pickExit(exitCandidates(pose.floor, fx, fz, floorY), free) ?? nearestFree(first, free, 2.5, 1) ?? pose.stand;
  }

  /** Advance the sit-down or stand-up: body placement for the avatar, camera height and the end of the sitting. */
  private stepSeat(s: PlaySession, dt: number): void {
    const sit = this.sitting;
    const c = s.character;
    if (!sit) return;
    const f = sit.seq.update(dt);
    sit.frame = f;
    if (f.phase === 'turn' || f.phase === 'approach') {
      // The view comes round with the body.
      const d = ((((sit.pose.yawDeg - this.input.yawDeg) % 360) + 540) % 360) - 180;
      this.input.setYaw(this.input.yawDeg + d * Math.min(1, dt * 4));
    }
    this.renderer.setEyeHeight(1.6 + (sit.pose.top + SEATED_EYE - 1.6) * f.blend);
    if (sit.seq.finished) {
      this.sitting = null;
      this.renderer.setEyeHeight(1.6);
      if (c) {
        // Collision comes back only where the capsule is clear; otherwise lift or nudge out first.
        const at = sit.seq.exitPoint;
        const free = (p: Vec3): boolean => s.pw.capsuleFree(p, PLAYER_CAPSULE.radius, PLAYER_CAPSULE.height, 0.1);
        c.teleport(free(at) ? at : (nearestFree(at, free, 2.5, 1) ?? at));
        c.setEnabled(true);
      }
    }
  }

  /** True while the player sits. */
  get isSitting(): boolean {
    return this.sitting !== null;
  }

  /** Start the aim-and-use controller for a session that has a walking player. */
  private startInteraction(s: PlaySession): void {
    this.stopInteraction();
    if (s.voxel) return;
    const sim = this;
    const pos: Vec3 = [0, 0, 0];
    const quat: [number, number, number, number] = [0, 0, 0, 1];
    this.interaction = new PlayInteraction(
      {
        world: s.world,
        // The player's own capsule is a body of the physics world too: the ray must look through it.
        raycastAll: (o, d, max, ex) => s.pw.raycastAll(o, d, max, 10, ex).filter((h) => h.id !== PLAYER_PSEUDO_ID),
        position: (id) => (s.pw.readPose(id, pos, quat) ? [pos[0], pos[1], pos[2]] : null),
        setVelocity: (id, v) => s.pw.setVelocity(id, v),
        setAngularVelocity: (id, v) => s.pw.setAngularVelocity(id, v),
        isDynamic: (id) => bodyTypeOf(s.world, id) === 'dynamic',
        entityState: (id) => s.logic.entityState(id),
        use: (id) => s.logic.use(id),
        sit: (id) => this.sitOn(id),
        isSitting: () => this.sitting !== null,
        stand: () => this.standUp(),
      },
      {
        aim() {
          const feet = s.character?.position ?? sim.playerPosition;
          const m = sim.renderer.camera.matrixWorld.elements;
          const dir: Vec3 = [-(m[8] as number), -(m[9] as number), -(m[10] as number)];
          const c = sim.renderer.camera.position;
          const eye: Vec3 = feet ? [feet[0], feet[1] + (sim.sitting ? sim.sitting.pose.top * sim.sitting.frame.blend + sim.sitting.pose.eye : 1.55), feet[2]] : [c.x, c.y, c.z];
          return { eye, dir };
        },
        playerVelocity: () => [0, 0, 0],
        floorY: () => s.character?.position[1] ?? 0,
      },
      {
        prompt: (p) => this.listener.onInteract?.(p),
        sound: (name) => this.sound.play(name),
        toast: (text) => this.listener.onMessage?.(text, 1.4),
      },
    );
    window.addEventListener('keydown', this.interactionKeys, true);
    this.renderer.domElement.addEventListener('pointerdown', this.interactionClick, true);
  }

  private stopInteraction(): void {
    window.removeEventListener('keydown', this.interactionKeys, true);
    this.renderer.domElement.removeEventListener('pointerdown', this.interactionClick, true);
    this.interaction?.dispose();
    this.interaction = null;
  }

  private onInteractionKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.key.toLowerCase() !== 'e' || this.paused || this.held || !this.session) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    // Acted: keep the key from also opening the door next to you.
    if (this.interaction?.use()) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }

  /** LogicHost bound to one play session (stale calls after Stop are ignored). */
  private createHost(s: SessionCore): LogicHost {
    const sim = this;
    const isDoc = (id: EntityId): boolean => Object.prototype.hasOwnProperty.call(s.world.entities, id);
    let terrain: ((x: number, z: number) => number | undefined) | undefined | null = null;
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
      driveJoint: (id, target) => {
        s.pw.driveJoint(id, target);
      },
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
      // Presentation only: shake, flash, bursts, floating text. Nothing is read back by the game.
      feedback(ev) {
        if (!s.ended) sim.playFeedback(ev, s);
      },
      reset() {
        if (!s.ended) queueMicrotask(() => void sim.restart());
      },
      playerId() {
        if (s.avatarId) return s.avatarId;
        return s.character || s.voxel ? PLAYER_PSEUDO_ID : undefined;
      },
      // The player's weapon: what a shot passes through, nearest first.
      raycast(o, d, max, limit) {
        if (s.ended) return [];
        return s.pw.raycastAll(o, d, max, limit).map((h) => (h.id === null ? { distance: h.distance, point: h.point, normal: h.normal } : { id: h.id, distance: h.distance, point: h.point, normal: h.normal }));
      },
      // NPC navigation: footprints of generated shapes, and the ground under hills.
      getBounds: (id) => (!s.ended && isDoc(id) ? (entityWorldBounds(s.world, id) ?? undefined) : undefined),
      getColliderBounds: (id) => (!s.ended && isDoc(id) ? entityColliderBounds(s.world, id) : []),
      groundHeight(x, z, fromY, exclude) {
        if (s.ended) return undefined;
        const hit = s.pw.raycast([x, fromY, z], [0, -1, 0], fromY + 8, exclude);
        return hit ? hit.point[1] : undefined;
      },
      // NPC grids drape over hills (built once per level, so the sampler is made on first use).
      terrainHeight(x, z) {
        if (s.ended) return undefined;
        if (terrain === null) terrain = terrainSampler(s.world, (px, py, pz, d) => s.pw.raycastAll([px, py, pz], [0, -1, 0], d, 6), { getBounds: (id) => (isDoc(id) ? (entityWorldBounds(s.world, id) ?? undefined) : undefined) });
        return terrain?.(x, z);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  private lastTransition: string | null = null;
  private lastGraphics = '';
  /** Tell the UI about a tier change under way and about changes of the tier in effect or its reason. */
  private emitQuality(): void {
    const r = this.renderer;
    const t = this.disposed ? null : (r.qualityTransition?.tier ?? null);
    if (t !== this.lastTransition) {
      this.lastTransition = t;
      try { this.listener.onQualityTransition?.(t); }
      catch (error) { log.warn('quality feedback failed', error); }
    }
    const g = this.disposed ? '' : `${r.renderTier}|${r.autoRenderTier}|${r.autoTierReason ?? ''}|${r.performanceLevel}`;
    if (g !== this.lastGraphics) {
      this.lastGraphics = g;
      try { this.listener.onGraphicsChanged?.(); }
      catch (error) { log.warn('graphics feedback failed', error); }
    }
  }

  private lastProcessing: RenderProcessingStage | null = null;
  private emitProcessing(): void {
    const stage = this.disposed ? null : this.pendingWorld ? 'scene' : this.renderer.processingStage;
    if (stage === this.lastProcessing) return;
    this.lastProcessing = stage;
    try { this.listener.onProcessing?.(stage); }
    catch (error) { log.warn('processing feedback failed', error); }
  }

  private readonly onAnimationFrame = (t: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.onAnimationFrame);
    // Raw frame delta: the stepper and the renderer clamp long stalls themselves,
    // and clamping here would pin the fps counter at 1 / MAX_FRAME_DT on slow GPUs.
    const dt = this.lastFrame < 0 ? 0 : Math.max(0, (t - this.lastFrame) / 1000);
    this.lastFrame = t;
    const s = this.session;
    this.emitProcessing();
    this.emitQuality();
    // While a game (a world with a title card) is being played the quality tier keeps still (a tier step rebuilds every lit material, and the view
    // holds its last complete picture for the seconds that takes: a freeze in play); it moves at the title card, while paused and between sessions.
    this.renderer.holdQuality(!!s && !!s.world.intro && !s.ended && !this.paused && !this.held);
    try {
      if (s && !this.paused) {
        this.pollGamepad(dt);
        this.stepSession(s, dt);
      }
      // While paused the block world still streams and finishes loading (a start card would otherwise sit over a loader stuck at 100 %).
      if (this.voxel?.active && (!this.paused || this.voxel.loadingPlay)) this.voxel.frame(dt);
      // Edit mode renders on demand (frozen weather once idle); play mode renders every frame.
      this.renderOpts.onDemand = s === null;
      this.renderOpts.animate = s !== null || !this.idle.idle(t);
      const drew = this.renderer.render(dt, this.renderOpts);
      if (drew && this.viewListener) this.viewListener(this.renderer.camera);
      if (this.overlay && (s || this.renderer.fx.director.active || this.overlay.liveTexts > 0)) {
        const c = this.renderer.domElement;
        this.overlay.frame(dt, this.renderer.fx.director.pulse, this.renderer.camera, c.clientWidth, c.clientHeight);
      }
      this.frameFailures = 0;
    } catch (err) {
      this.onFrameError(err, s);
    }
    this.emitProcessing();
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

  /** Controller input → the same virtual stick / taps the touch controls use. */
  private pollGamepad(dt: number): void {
    const g = this.pad.poll();
    if (!g.active) {
      if (this.padMoving) {
        this.padMoving = false;
        this.setVirtualStick(0, 0);
      }
      return;
    }
    const moving = g.forward !== 0 || g.right !== 0;
    if (moving || this.padMoving) this.setVirtualStick(g.forward, g.right);
    this.padMoving = moving;
    if (g.lookX !== 0) this.turnBy(-g.lookX * STICK_TURN_SPEED * Math.min(0.1, dt));
    if (g.jump) this.tapVirtual('Space');
    if (g.action) this.tapVirtual('KeyE');
    if (g.pause) this.listener.onPauseRequest?.();
  }

  /**
   * Freeze or resume the running game (physics, logic, voxel game) while the
   * world keeps rendering — the pause menu of published games. Held keys
   * and pointer lock are released when pausing.
   */
  setPaused(on: boolean): void {
    if (this.paused === on) return;
    this.paused = on;
    if (on) {
      this.input.releaseAll();
      if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock();
    } else {
      this.stepper.reset();
      this.lastFrame = -1;
    }
    this.renderer.requestRender();
  }

  /** True while paused (see {@link setPaused}). */
  get isPaused(): boolean {
    return this.paused;
  }

  /** Master volume of game sounds (0–1). */
  setVolume(v: number): void {
    this.sound.setVolume(v);
  }

  /** Mouse look multiplier (0.25–3) for the character and block-world games. */
  setLookSensitivity(m: number): void {
    this.lookSensitivity = Number.isFinite(m) ? Math.max(0.25, Math.min(3, m)) : 1;
    this.input.sensitivity = this.lookSensitivity;
    if (this.session?.voxel) this.session.voxel.input.sensitivity = this.lookSensitivity;
  }

  private stepSession(s: PlaySession, dt: number): void {
    // Hit-stop holds the game for a few frames: steps are postponed, not changed (the fixed-step results are the same).
    if (this.held || this.renderer.fx.director.frozen) {
      this.stepper.reset();
      return;
    }
    const steps = this.stepper.advance(dt);
    const { pw, logic, character } = s;
    if (s.world.player.weapon) this.aimFromCamera();
    const speed = s.world.player.moveSpeed;
    const jump = s.world.player.jumpSpeed;
    const armed = s.world.player.weapon !== undefined;
    for (let i = 0; i < steps && !s.ended; i++) {
      const input = this.input.sample(FIXED_DT);
      if (s.voxel) s.voxel.step(FIXED_DT);
      if (character && this.sitting) {
        // Seated: held in place; any walking or jumping input stands the player up.
        character.teleport(this.sitting.pose.floor);
        if (Math.abs(input.forward) > 0.4 || Math.abs(input.right) > 0.4 || input.jump) this.standUp();
      } else if (character) {
        const pace = playerPace(input, armed, this.sneaking, this.crouchKeyDown, character.grounded, this.sprinting);
        this.sneaking = pace.crouched;
        this.firing = input.fire === true;
        this.sprinting = pace.sprinting;
        this.crouchKeyDown = pace.crouchKey;
        const from = character.position;
        character.move({ forward: input.forward, right: input.right, jump: input.jump, yawDeg: input.pointerYawDeg }, FIXED_DT, paceSpeed(speed, pace), jump);
        const to = character.position;
        this.stepFrom[0] = from[0];
        this.stepFrom[1] = from[1];
        this.stepFrom[2] = from[2];
        this.stepTo[0] = to[0];
        this.stepTo[1] = to[1];
        this.stepTo[2] = to[2];
        this.stepValid = true;
        // Pushing for a second without getting anywhere (wedged in furniture, on a table edge): nudge to the nearest free ground.
        const at = character.position;
        if (this.stuck.update(at[0], at[2], Math.abs(input.forward) > 0.4 || Math.abs(input.right) > 0.4, FIXED_DT)) {
          const free = (p: Vec3): boolean => pw.capsuleFree(p, PLAYER_CAPSULE.radius, PLAYER_CAPSULE.height, 0.1);
          // Only when the capsule overlaps something: a player merely pushing on a wall is not stuck.
          if (!free(at)) {
            const out = nearestFree(at, free, 2, 1);
            if (out) character.teleport(out);
          }
        }
        if (character.position[1] < PLAYER_KILL_Y) character.teleport(s.world.player.spawn);
        this.watchLanding(character, input.jump);
      }
      this.feelStep++;
      const events = pw.stepFixed();
      logic.tick(FIXED_DT, input, events);
    }
    if (s.ended) return;
    this.emitCombat(s);
    this.stepSeat(s, dt);
    this.pumpNpc(s);
    this.feedCharacters(s);
    this.renderer.setLookPitch((this.input.pitchDeg * Math.PI) / 180);
    this.interaction?.frame();
    pw.writeTransforms(this.table.packed, this.table.order);
    this.renderer.applyTransforms(this.table.packed, this.table.order);
    if (character && this.sitting) {
      const f = this.sitting.frame;
      this.renderer.setPlayerAvatar(f.position, this.input.yawDeg, { grounded: true, vy: 0, crouching: false, sprinting: false, sitting: f.sitting, seatTop: this.sitting.pose.top, faceYawDeg: f.yawDeg });
    } else if (character) {
      this.renderer.setPlayerAvatar(this.drawnFeet(character), this.input.yawDeg, {
        grounded: character.grounded,
        vy: character.verticalSpeed,
        crouching: this.sneaking,
        sprinting: this.sprinting,
        aimPitchDeg: this.input.pitchDeg,
        firing: this.firing,
        // Armed, the body faces where the gun points and strafes; otherwise it turns toward its motion.
        ...(armed ? { faceYawDeg: this.input.yawDeg } : {}),
      });
    }
    // The camera sinks with the body while crouched (eased like the pose, about a quarter second).
    this.crouchBlend += ((this.sneaking && !this.sitting ? 1 : 0) - this.crouchBlend) * Math.min(1, dt * 9);
    if (this.crouchBlend < 0.002) this.crouchBlend = 0;
    this.renderer.setCrouchDrop(this.crouchBlend * CROUCH_CAMERA_DROP);
  }

  /**
   * Where the body is drawn: between the feet before and after the last fixed step, at the share of a step the frame is
   * past it. Physics runs at 60 Hz and frames rarely line up with it; drawing the raw step position moves the body (and
   * the camera that follows it) 0, 1 or 2 steps a frame, which reads as stutter. A jump of more than 1.5 m in one step is
   * a teleport (respawn, unstick) and is drawn at once.
   */
  private drawnFeet(character: CharacterController): Vec3 {
    const to = character.position;
    if (!this.stepValid) return to;
    const a = this.stepper.alpha;
    const f = this.stepFrom;
    const t = this.stepTo;
    if (Math.abs(to[0] - t[0]) + Math.abs(to[1] - t[1]) + Math.abs(to[2] - t[2]) > 1e-6) return to;
    if (Math.hypot(t[0] - f[0], t[1] - f[1], t[2] - f[2]) > 1.5) return to;
    return [f[0] + (t[0] - f[0]) * a, f[1] + (t[1] - f[1]) * a, f[2] + (t[2] - f[2]) * a];
  }

  private combatKey = '';
  private combatKills = 0;
  private combatLastKill = -1;

  /** Send the weapon HUD when it changed (a few times a second while firing, never every frame for nothing). */
  private emitCombat(s: PlaySession): void {
    const w = s.logic.weapon;
    if (!w || !this.listener.onCombat) return;
    if (w.lastKill !== this.combatLastKill && w.lastKill >= 0) {
      this.combatLastKill = w.lastKill;
      this.combatKills++;
    }
    const reload = w.reloading ? Math.round(w.reloadProgress * 10) / 10 : 0;
    const key = `${w.ammo}|${w.reserve}|${w.reloading ? 1 : 0}|${reload}|${w.hits}|${this.combatKills}`;
    if (key === this.combatKey) return;
    this.combatKey = key;
    this.listener.onCombat({ name: w.name, ammo: w.ammo, reserve: w.reserve, magazine: w.magazine, reloading: w.reloading, reload, hits: w.hits, kills: this.combatKills, head: w.lastHitHead });
  }

  /** The crosshair ray of the last drawn frame (the camera's eye and view direction) for the weapon. */
  private aimFromCamera(): void {
    const e = this.renderer.camera.matrixWorld.elements;
    const dx = -(e[8] as number);
    const dy = -(e[9] as number);
    const dz = -(e[10] as number);
    const l = Math.hypot(dx, dy, dz);
    if (!(l > 1e-6)) {
      this.input.setAim(null);
      return;
    }
    this.aimOrigin[0] = e[12] as number;
    this.aimOrigin[1] = e[13] as number;
    this.aimOrigin[2] = e[14] as number;
    this.aimDir[0] = dx / l;
    this.aimDir[1] = dy / l;
    this.aimDir[2] = dz / l;
    this.input.setAim(this.aimOrigin, this.aimDir);
  }

  private readonly aimOrigin: [number, number, number] = [0, 0, 0];
  private readonly aimDir: [number, number, number] = [0, 0, -1];

  /** Footstep of a person: the sound of the surface underfoot, quieter with distance and softer when sneaking. */
  private footstep(id: string, speed: number, position: readonly [number, number, number]): void {
    if (!this.session || this.held || this.paused) return;
    const cam = this.renderer.camera.position;
    const dx = position[0] - cam.x;
    const dy = position[1] - cam.y;
    const dz = position[2] - cam.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const own = id === 'aether:player';
    // The player's own steps stay audible in third person; others fade out by ~24 m.
    const level = own ? (this.sneaking ? 0.35 : 1) * Math.min(1.2, 0.5 + speed * 0.1) : Math.max(0, 1 - d / 24) * Math.min(1.1, 0.45 + speed * 0.1);
    if (level <= 0.02) return;
    const surface = this.renderer.surfaceAt(position[0], position[1], position[2]);
    this.sound.play(`step-${surface}`, level);
    // A puff of dust (or a splash) under the foot, for steps near the camera.
    const fx = this.renderer.fx;
    if (!fx.footsteps || d > 28 || (this.sneaking && own)) return;
    const puff = footstepEffect(surface, speed);
    if (puff) fx.trigger(null, position, { seed: (this.feelStep * 31 + Math.round(position[0] * 7) * 131 + Math.round(position[2] * 7)) | 0, vfx: puff.vfx, scale: puff.scale, ...(puff.color ? { color: puff.color } : {}), floorY: position[1] });
  }

  /** Landings and jumps of the walking player become feel events (studio-side: the logic does not see the body's air time). */
  private watchLanding(character: CharacterController, jumpPressed: boolean): void {
    const g = character.grounded;
    const vy = character.verticalSpeed;
    if (!g) this.fallSpeed = Math.min(this.fallSpeed, vy);
    const p = character.position;
    if (g && !this.wasGrounded) {
      const k = landingIntensity(this.fallSpeed);
      if (k > 0) this.playStudioCue('land', [p[0], p[1], p[2]], k);
      this.fallSpeed = 0;
    } else if (!g && this.wasGrounded && jumpPressed && vy > 1.5) {
      this.playStudioCue('jump', [p[0], p[1], p[2]], 1, true);
    }
    this.wasGrounded = g;
  }

  private playStudioCue(kind: 'land' | 'jump', at: [number, number, number], intensity: number, stretch = false): void {
    const played = this.renderer.fx.trigger(kind, at, { seed: this.feelStep * 977 + (kind === 'land' ? 1 : 2), intensity, floorY: at[1], stretch });
    if (played) this.answerCue(played.cue, at, undefined, kind);
  }

  /** A feel event from the logic runtime: the renderer plays the picture, the studio the text, the rumble and the duck. */
  private playFeedback(ev: FeedbackEvent, s: SessionCore): void {
    const fx = this.renderer.fx;
    const feet = s.character?.position;
    const at: [number, number, number] | null = ev.at ? [ev.at[0], ev.at[1], ev.at[2]] : feet ? [feet[0], feet[1] + 1, feet[2]] : null;
    // Sparks and dust rest on the floor the player stands on (or a metre under the event).
    const floorY = feet && at && Math.abs(feet[1] - at[1]) < 3 ? feet[1] : at ? at[1] - 1 : 0;
    const played = fx.trigger(ev.kind, at, {
      seed: Math.imul(ev.tick, 0x9e3779b1) ^ (ev.kind ? ev.kind.length : 0),
      ...(ev.vfx !== undefined ? { vfx: ev.vfx } : {}),
      ...(ev.color !== undefined ? { color: ev.color } : {}),
      ...(ev.scale !== undefined ? { scale: ev.scale } : {}),
      ...(ev.intensity !== undefined ? { intensity: ev.intensity } : {}),
      ...(ev.amount !== undefined ? { amount: ev.amount } : {}),
      floorY,
    });
    if (played) this.answerCue(played.cue, at, ev.amount, ev.kind);
  }

  /** The parts of a cue outside the renderer: floating text, rumble, ducking. */
  private answerCue(cue: ResolvedCue, at: readonly [number, number, number] | null, amount: number | undefined, kind: FeelEvent | null): void {
    this.feelPlayed++;
    if (cue.text && at && amount !== undefined && amount !== 0 && Number.isFinite(amount)) {
      const n = Math.round(amount * 100) / 100;
      this.overlay?.text(n > 0 ? `+${n}` : `${n}`, at, kind === 'damage' || n < 0 ? '#ff5d4d' : '#ffd84a');
    }
    if (cue.rumble > 0) this.pad.rumble(cue.rumble, 70 + cue.rumble * 230);
    if (cue.duck > 0) this.sound.duck(cue.duck, 0.35 + cue.duck * 0.6);
  }

  /**
   * Play a feel event as if the game had raised it (feel previews, captures, e2e): at `at`, else at the player in play
   * mode, else at the orbit target. Presentation only, like every feel event.
   */
  previewFeel(kind: FeelEvent, at?: readonly [number, number, number], amount?: number): boolean {
    const s = this.session;
    const feet = s?.character?.position;
    const target = at ?? (feet ? [feet[0], feet[1] + 1, feet[2]] : this.renderer.orbitTarget());
    const p: [number, number, number] = [target[0] as number, target[1] as number, target[2] as number];
    const played = this.renderer.fx.trigger(kind, p, { seed: this.feelStep * 131 + 7, ...(amount !== undefined ? { amount } : {}), floorY: feet ? feet[1] : p[1] - 1, stretch: kind === 'jump', preview: true });
    if (!played) return false;
    this.answerCue(played.cue, p, amount, kind);
    this.renderer.requestRender();
    return true;
  }

  /** Accessibility: turn camera shake, FOV kicks and screen flashes off (defaults to the system's reduce-motion setting). */
  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.renderer.fx.director.setReducedMotion(on);
    this.overlay?.setReducedMotion(on);
  }

  /** Whether reduce motion is on. */
  get reduceMotion(): boolean {
    return this.reducedMotion;
  }

  /** Game-feel diagnostics (e2e, perf HUD). */
  get feelStats(): { cues: number; bursts: number; particles: number; emitters: number; capacity: number; trauma: number; frozen: boolean } {
    const fx = this.renderer.fx;
    return { cues: this.feelPlayed, bursts: fx.vfx.bursts, particles: fx.vfx.liveEstimate, emitters: fx.vfx.emitterCount, capacity: fx.vfx.capacity, trauma: fx.director.traumaLevel, frozen: fx.director.frozen };
  }

  /** Listen to sound ducking (published games duck their music); returns the unsubscribe. */
  onDuck(fn: (depth: number, seconds: number) => void): () => void {
    return this.sound.onDuck(fn);
  }

  /**
   * Hand each person on screen what the NPC runtime knows (animation hint,
   * conversation, who to look at). Visual only: nothing here is read back by
   * the simulation, so the playtest bot and replay proofs are unaffected.
   */
  private feedCharacters(s: PlaySession): void {
    if (this.renderer.characterCount === 0) return;
    const npcs = s.logic.npcs;
    const speaking = this.speakingScratch;
    speaking.clear();
    for (let i = 0; i < npcs.bubbleCount; i++) {
      const b = npcs.bubbleAt(i);
      if (b) speaking.add(b.npc);
    }
    const pos = s.character?.position;
    const target = this.lookScratch;
    if (pos) target.set(pos[0], pos[1] + 1.55, pos[2]);
    for (const brain of npcs.brains) {
      const rig = this.renderer.characterRig(brain.id);
      if (!rig) continue;
      const hint = brain.animation;
      this.feedSeat(s, brain.id, brain.seatId, rig);
      rig.input.hint = hint === 'idle' || hint === 'walk' || hint === 'run' || hint === 'attack' || hint === 'talk' || hint === 'hurt' || hint === 'dead' ? hint : 'idle';
      rig.input.talking = brain.conversing || speaking.has(brain.id);
      rig.lookTarget = pos && (brain.attentive || speaking.has(brain.id)) ? target : null;
    }
  }

  /** Seat pose of NPCs that sit (by NPC id), kept while they sit. */
  private readonly npcSeats = new Map<EntityId, { seat: string; anchor: Vector3 }>();

  /** A person of the NPC system on a seat: the sit clips, the pelvis on the seat surface of the piece, their feet on the floor. */
  private feedSeat(s: PlaySession, id: EntityId, seatId: string | null, rig: { input: { sitting: boolean }; seatAnchor: Vector3 | null }): void {
    if (seatId === null) {
      // The anchor stays while the stand-up clip plays (the rig fades the seat out); the next sitting replaces it.
      rig.input.sitting = false;
      return;
    }
    let held = this.npcSeats.get(id);
    if (!held || held.seat !== seatId) {
      const e = s.world.entities[seatId];
      const t = e ? safeWorldTransform(s.world, seatId) : null;
      const at = s.pw.readPose(id, this.seatPos, this.seatQuat) ? this.seatPos : (s.world.entities[id]?.transform.position ?? null);
      if (!e || !t) return;
      const q = t.quaternion;
      const yaw = (Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[2] * q[2])) * 180) / Math.PI;
      const b = entityWorldBounds(s.world, seatId);
      const quarter = Math.abs(Math.sin((yaw * Math.PI) / 180)) > 0.7;
      const wx = b ? b.max[0] - b.min[0] : 1;
      const wz = b ? b.max[2] - b.min[2] : 0.8;
      const who: Vec3 = at ? [at[0], at[1], at[2]] : [t.position[0], t.position[1], t.position[2] + 1];
      const pose = seatPose(e.arch?.kind ?? 'chair', [t.position[0], t.position[1], t.position[2]], yaw, who, { width: quarter ? wz : wx, depth: quarter ? wx : wz, height: b ? b.max[1] - b.min[1] : 0 });
      if (!pose) return;
      held = { seat: seatId, anchor: new Vector3(pose.feet[0], pose.feet[1], pose.feet[2]) };
      this.npcSeats.set(id, held);
    }
    rig.seatAnchor = held.anchor;
    rig.input.sitting = true;
  }
  private readonly seatPos: Vec3 = [0, 0, 0];
  private readonly seatQuat: QuatTuple = [0, 0, 0, 1];

  /** Sample the NPC system for the UI: on change, and at ~12 Hz while bubbles are on screen. */
  private pumpNpc(s: PlaySession): void {
    const listener = this.listener.onNpc;
    if (!listener) return;
    const npcs = s.logic.npcs;
    if (npcs.count === 0) {
      if (this.npcSig !== '') {
        this.npcSig = '';
        listener(null);
      }
      return;
    }
    const now = performance.now();
    const d = npcs.dialogue;
    const quick = (d ? `${d.npc}:${d.version}` : '') + (npcs.prompt?.npc ?? '');
    const changed = quick !== this.npcQuick;
    if (!changed && now - this.npcAt < NPC_FRAME_MS) return;
    // Mouse-look captures the pointer; a conversation needs it back for the choice buttons.
    const talking = d !== null;
    if (talking && !this.npcTalking && typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock();
    this.npcTalking = talking;
    this.npcQuick = quick;
    this.npcAt = now;
    const cam = this.renderer.camera;
    const frame = buildNpcFrame(npcs, { view: cam.matrixWorldInverse.elements, projection: cam.projectionMatrix.elements });
    const sig = frameSignature(frame);
    if (sig === this.npcSig) return;
    this.npcSig = sig;
    listener(frame);
  }

  /** Take choice `i` (0-based) of the running conversation (touch and pointer input). */
  npcChoose(i: number): void {
    this.session?.logic.npcs.choose(i);
    this.npcQuick = '';
  }

  /** Continue the running conversation, or start one with the nearest character in reach. */
  npcAdvance(): void {
    const npcs = this.session?.logic.npcs;
    if (!npcs) return;
    if (npcs.dialogue) npcs.advance();
    else if (npcs.prompt) npcs.startDialogue(npcs.prompt.npc);
    this.npcQuick = '';
  }

  /** What a language model needs to play the character of the running conversation (null without one). */
  npcChatContext(): ReturnType<NpcSystem['chatContext']> {
    return this.session?.logic.npcs.chatContext() ?? null;
  }

  /** Show a free reply, only while the conversation is still with `npcId`. */
  npcFreeReply(npcId: string, text: string): boolean {
    const npcs = this.session?.logic.npcs;
    if (!npcs || npcs.dialogue?.npc !== npcId) return false;
    this.npcQuick = '';
    return npcs.freeReply(text);
  }

  /** Close the running conversation. */
  npcClose(): void {
    this.session?.logic.npcs.endDialogue();
    this.npcQuick = '';
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
    this.emitProcessing();
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
    this.stopInteraction();
    this.sitting = null;
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
    this.pad.dispose();
    this.overlay?.dispose();
    this.overlay = null;
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
/**
 * The yaw a play session starts with: the authored `player.yaw`, unless it faces a solid less than 4 m from the
 * eyes and the world has an entrance to face instead; else the entrance. Null when neither is known.
 */
export function startYawDeg(world: WorldDoc, blocked: (origin: Vec3, dir: Vec3, max: number) => boolean): number | null {
  const authored = world.player.yaw;
  const entrance = entranceYawDeg(world);
  if (authored === undefined) return entrance;
  if (entrance === null) return authored;
  const s = world.player.spawn;
  const a = (authored * Math.PI) / 180;
  // A facade filling the view within a few metres while the entrance is elsewhere (more than 30 degrees off).
  const off = Math.abs(((authored - entrance + 540) % 360) - 180);
  const facesWall = off > 30 && blocked([s[0], s[1] + 1.6, s[2]], [-Math.sin(a), 0, -Math.cos(a)], 4);
  return facesWall ? entrance : authored;
}

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
