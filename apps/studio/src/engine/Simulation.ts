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
import type { SandboxRunner } from '@aether/procgen';
import { WorldRenderer, type BackendPreference, type ContextLossInfo, type RenderDiagnostic, type RenderMemoryStats } from '@aether/render';
import { FIXED_DT, MAX_FRAME_DT, MAX_SUBSTEPS, PLAYER_CAPSULE, PLAYER_PSEUDO_ID, STATS_INTERVAL_MS } from '../config';
import { createLogger, errorMessage } from '../lib/log';
import { FixedStepper } from './FixedStepper';
import { IdleClock } from './IdleClock';
import { InputController } from './input';
import { SoundBoard } from './sound';
import { TransformTable } from './TransformTable';
import { findAvatar, framingSphere, movingIds } from './worldQueries';

const log = createLogger('sim');

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
}

/** Callbacks from the simulation to the UI layer. */
export interface SimulationListener {
  onStats?(stats: SimulationStats): void;
  /** Play-mode HUD refresh (4 Hz): values of `world.hud` keys + game time. */
  onHud?(hud: Record<string, Json | undefined>, time: number): void;
  onMessage?(text: string, duration: number): void;
  onGameOver?(result: 'win' | 'lose', text: string): void;
  onPick?(id: EntityId | null, additive: boolean): void;
  onModeChange?(mode: 'edit' | 'play'): void;
  onError?(message: string): void;
  /** The render loop stopped after repeated failures; the page must be reloaded. */
  onFatal?(message: string): void;
  /** The GPU device / WebGL context was lost; the simulation must be replaced. */
  onContextLost?(info: ContextLossInfo): void;
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
    this.unsubscribe = history.subscribe((world) => {
      if (!this.session) this.requestSync(world);
    });
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
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
  readonly colliders: ColliderProvider = (entity: Entity) => this.renderer.getGeneratorOutput(entity.id)?.colliders;

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
          this.syncedWorldDoc = next;
        } catch (err) {
          log.error('renderer sync failed', err);
          this.listener.onError?.(`Rendering failed: ${errorMessage(err)}`);
        }
        if (this.pendingWorld === next) this.pendingWorld = null;
      }
      this.refreshDebug();
      this.renderer.highlight(this.selection.filter((id) => this.syncedWorldDoc && Object.prototype.hasOwnProperty.call(this.syncedWorldDoc.entities, id)));
    });
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
    const spawnFocus = p.mode !== 'orbit' && !findAvatar(world);
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
      const webp = await this.renderer.screenshot({ width, height, mime: 'image/webp' });
      if (webp.startsWith('data:image/webp')) return webp;
      return await this.renderer.screenshot({ width, height, mime: 'image/jpeg' });
    } catch (err) {
      log.warn('thumbnail failed', err);
      return null;
    }
  }

  /** Camera presets for the editor (orbit mode only). */
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
    this.input.setVirtualStick(forward, right);
  }

  /** On-screen jump / action buttons (play mode). */
  tapVirtual(code: 'Space' | 'KeyE'): void {
    this.input.tapVirtual(code);
  }

  /** Touch look: turn by degrees (play mode). */
  turnBy(deg: number): void {
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
      if (!avatarId && world.player.mode !== 'orbit' && world.player.mode !== 'vehicle') {
        character = new CharacterController(pw, { radius: PLAYER_CAPSULE.radius, height: PLAYER_CAPSULE.height, spawn: world.player.spawn, id: PLAYER_PSEUDO_ID });
      }
      core = { world, pw, scripts, character, avatarId, transients: new Set(), destroyed: new Set(), ended: false };
      logic = new LogicRuntime(world, this.createHost(core), scripts ? { scripts, seed: world.seed } : { seed: world.seed });
    } catch (err) {
      if (core) core.ended = true;
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
    this.stopRequested = false;
    try {
      this.renderer.highlight([]);
      this.input.setYaw(cameraYawDeg(this.renderer));
      this.input.attach(this.renderer.domElement, { pointerLock: this.pointerLock });
      if (session.avatarId) this.renderer.setCameraMode('follow', session.avatarId);
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
    try {
      safely('input detach', () => this.input.detach());
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
    return {
      getTransform(id) {
        if (s.ended || s.destroyed.has(id)) return undefined;
        if (id === PLAYER_PSEUDO_ID && s.character) return { position: s.character.position, quaternion: yawQuat(sim.input.yawDeg) };
        const st = s.pw.getState(id);
        if (st) return { position: st.position, quaternion: st.quaternion };
        if (sim.table.read(id, scratchPos, scratchQuat)) return { position: [scratchPos[0], scratchPos[1], scratchPos[2]], quaternion: [scratchQuat[0], scratchQuat[1], scratchQuat[2], scratchQuat[3]] };
        return isDoc(id) ? safeWorldTransform(s.world, id) : undefined;
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
        return s.character ? PLAYER_PSEUDO_ID : undefined;
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
    if (!s && !this.statsWhileEditing) return;
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

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.downValid = e.button === 0;
    this.downX = e.clientX;
    this.downY = e.clientY;
    if (isTypingElement(document.activeElement)) (document.activeElement as HTMLElement).blur();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (!this.downValid || e.button !== 0) return;
    this.downValid = false;
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > CLICK_SLOP_PX) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const id = this.renderer.pick(x, y);
    if (this.session) {
      if (id) this.session.logic.click(id);
      return;
    }
    this.listener.onPick?.(id, e.shiftKey || e.metaKey || e.ctrlKey);
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
    this.touch();
  };

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
    const s = this.session;
    this.session = null;
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

function yawQuat(yawDeg: number): QuatTuple {
  const h = (yawDeg * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
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

/** True when the user asked the OS/browser for reduced motion (no grow-in animation then). */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
