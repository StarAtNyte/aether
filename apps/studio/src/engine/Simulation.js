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
import { eulerDegToQuat, worldTransform } from '@aether/core';
import { Vector3 } from 'three';
import { initScripting, LogicRuntime, createScriptRunner } from '@aether/logic';
import { assetColliderDescs } from '@aether/physics/asset-colliders';
import { entityColliderBounds, entityWorldBounds } from '@aether/physics/bounds';
import { WorldRenderer } from '@aether/render';
import { FIXED_DT, MAX_FRAME_DT, MAX_SUBSTEPS, PLAYER_CAPSULE, PLAYER_PSEUDO_ID, STATS_INTERVAL_MS } from '../config';
import { createLogger, errorMessage } from '../lib/log';
import { FixedStepper } from './FixedStepper';
import { buildNpcFrame, frameSignature } from './npcFrame';
import { IdleClock } from './IdleClock';
import { InputController } from './input';
import { GamepadPoller, STICK_TURN_SPEED } from './gamepad';
import { SoundBoard } from './sound';
import { PosePool } from './posePool';
import { TransformTable } from './TransformTable';
import { findAvatar, framingSphere, movingIds } from './worldQueries';
import { nextFrame } from '../lib/frame';
import { PlayInteraction, seatPose } from './interaction';
/** Longest wait for content to finish materialising before a thumbnail (ms). */
const THUMBNAIL_SETTLE_MS = 6000;
/**
 * Quiet time (no input, nothing animating) a thumbnail waits for: reading
 * pixels back stalls slow GPUs for a few hundred milliseconds (WebGL2 on a
 * software rasterizer), which must not land in the middle of an interaction.
 */
export const THUMBNAIL_QUIET_MS = 2000;
/** True when nothing animated since `stillSince` and no input came since `lastInputAt` for {@link THUMBNAIL_QUIET_MS}. */
export function quietReached(now, stillSince, lastInputAt, quietMs = THUMBNAIL_QUIET_MS) {
    return now - Math.max(stillSince, lastInputAt) >= quietMs;
}
/** Longest a thumbnail waits for that quiet moment before capturing anyway. */
const THUMBNAIL_QUIET_MAX_MS = 15_000;
/** Longest wait for block terrain to finish streaming before a thumbnail (ms). */
const VOXEL_THUMBNAIL_WAIT_MS = 30_000;
const log = createLogger('sim');
/** Gizmo mode of a transform tool (null for the other tools). */
export function gizmoModeOf(tool) {
    return tool === 'move' ? 'translate' : tool === 'rotate' ? 'rotate' : tool === 'scale' ? 'scale' : null;
}
/** Below this height the built-in player respawns. */
const PLAYER_KILL_Y = -40;
/** Pointer travel (px) that turns a click into an orbit drag. */
const CLICK_SLOP_PX = 5;
/** Fallback camera offset direction of {@link Simulation.frameWorld} (distance is set by the renderer). */
const FRAME_OFFSET = [8, 7, 15];
/** Fallback framing flight time (seconds). */
const FRAME_DURATION = 1.1;
/** Radius around the player spawn framed for character games. */
const PLAYER_FRAME_RADIUS = 14;
/** Camera offset direction over block terrain (elevated three-quarter view). */
const VOXEL_FRAME_OFFSET = [1, 0.62, 1.25];
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
/** Interval between NPC overlay samples while bubbles follow their speakers (ms). */
const NPC_FRAME_MS = 80;
const scratchPos = [0, 0, 0];
const scratchQuat = [0, 0, 0, 1];
const scratchDir = { x: 0, y: 0, z: 0 };
function isTypingElement(el) {
    if (!el)
        return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el instanceof HTMLElement && el.isContentEditable);
}
/** Owns renderer + (in play mode) physics/logic and the frame loop. */
export class Simulation {
    renderer;
    history;
    listener;
    stepper = new FixedStepper(FIXED_DT, MAX_SUBSTEPS, MAX_FRAME_DT);
    table = new TransformTable();
    input = new InputController();
    sound = new SoundBoard();
    /** The player is holding Shift (sneaking): quieter steps, crouched body. */
    sneaking = false;
    /** Aim-and-use controller of the running session (drawers, doors, taps, props to carry). */
    interaction = null;
    /** The player sits on a piece of furniture (capsule disabled, eye lowered, movement locked until they stand). */
    sitting = null;
    interactionKeys = (e) => this.onInteractionKey(e);
    interactionClick = (e) => {
        if (e.button === 0 && this.interaction?.throwCarried())
            e.stopImmediatePropagation();
    };
    speakingScratch = new Set();
    lookScratch = new Vector3();
    npcSig = '';
    npcQuick = '';
    npcAt = 0;
    npcTalking = false;
    pad = new GamepadPoller();
    /** The controller moved the player last frame (its stick is released once it goes idle). */
    padMoving = false;
    /** Physics, logic and the voxel game are frozen (pause menu of published games). */
    paused = false;
    /** Mouse look multiplier applied to both play inputs. */
    lookSensitivity = 1;
    /** Block terrain + voxel game, loaded on the first world with `voxel` (null until then). */
    voxel = null;
    voxelLoading = null;
    saveBase;
    unsubscribe;
    resizeObserver;
    session = null;
    transition = Promise.resolve();
    syncChain = Promise.resolve();
    syncedWorldDoc = null;
    pendingWorld = null;
    selection = [];
    diagnostics = [];
    showColliders = false;
    pointerLock;
    raf = 0;
    lastFrame = -1;
    lastStats = 0;
    disposed = false;
    viewListener = null;
    downX = 0;
    downY = 0;
    downValid = false;
    /** The pointer went down on a gizmo handle: the release is not a selection click. */
    downOnGizmo = false;
    gizmoIds = [];
    gizmoTool = 'select';
    gizmoOptions = {};
    /** Overrides the entity gizmo (component editing) while true. */
    gizmoSuspended = false;
    viewportTool = null;
    toolDragging = false;
    toolPointerId = -1;
    /** Consumes clicks before entity picking (e.g. component selection); returns true when handled. */
    clickHandler = null;
    pickSkip = undefined;
    marquee = null;
    frameFailures = 0;
    lastFrameError = '';
    stopRequested = false;
    statsWhileEditing;
    idle = new IdleClock();
    /** Reused per frame (the frame loop must not allocate). */
    renderOpts = { onDemand: true, animate: true };
    hidden = false;
    /** True while the play session is held (title card showing): the scene renders, the game does not advance. */
    held = false;
    constructor(renderer, history, listener, opts) {
        this.renderer = renderer;
        this.history = history;
        this.listener = listener;
        this.pointerLock = opts.pointerLock === true;
        this.statsWhileEditing = opts.statsWhileEditing !== false;
        this.saveBase = opts.saveBase ?? 'scratch';
        renderer.onFootstep((id, _foot, speed, position) => this.footstep(id, speed, position));
        this.unsubscribe = history.subscribe((world) => {
            if (!this.session)
                this.requestSync(world);
        });
        const canvas = renderer.domElement;
        canvas.addEventListener('pointerdown', this.onPointerDown);
        canvas.addEventListener('pointerup', this.onPointerUp);
        canvas.addEventListener('pointermove', this.onPointerMove);
        canvas.addEventListener('pointerleave', this.onPointerLeave);
        canvas.addEventListener('pointercancel', this.onPointerCancel);
        const parent = canvas.parentElement;
        this.resizeObserver = typeof ResizeObserver !== 'undefined' && parent ? new ResizeObserver(() => this.resize()) : null;
        if (parent)
            this.resizeObserver?.observe(parent);
        this.resize();
        this.requestSync(history.current);
        this.touch();
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this.onVisibility);
            this.hidden = document.visibilityState === 'hidden';
        }
        for (const type of ACTIVITY_EVENTS)
            window.addEventListener(type, this.onActivity, { passive: true, capture: true });
        if (!this.hidden)
            this.raf = requestAnimationFrame(this.onAnimationFrame);
    }
    /** Create the renderer on `canvas` and start the loop (edit mode). */
    static async create(canvas, history, listener, opts = {}) {
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
    get mode() {
        return this.session ? 'play' : 'edit';
    }
    /**
     * Hold (or release) the play session: while held, physics and logic do not
     * advance (the title card is showing) but the scene keeps rendering.
     * Set it before `play()` so not even the first tick runs.
     */
    setHeld(on) {
        if (on === this.held)
            return;
        this.held = on;
        // Releasing must not replay the held time as a burst of catch-up steps.
        this.stepper.reset();
        this.touch();
    }
    /** Whether the play session is held (see {@link setHeld}). */
    get isHeld() {
        return this.held;
    }
    /** Rendering backend in use. */
    get backend() {
        return this.renderer.backend;
    }
    /** Live logic runtime (play mode only) — exposed for debugging/e2e. */
    get logic() {
        return this.session?.logic ?? null;
    }
    /** Live physics world (play mode only). */
    get physics() {
        return this.session?.pw ?? null;
    }
    /** Built-in player capsule position (play mode without an avatar entity), else null. */
    get playerPosition() {
        return this.session?.character?.position ?? null;
    }
    /** Colliders for physics: procedural outputs the renderer already generated (physics falls back to its defaults). */
    colliders = (entity) => this.renderer.getGeneratorOutput(entity.id)?.colliders ?? (entity.shape.kind === 'asset' ? (assetColliderDescs(entity.shape) ?? undefined) : undefined);
    // ---------------------------------------------------------------------------
    // Edit-mode world sync
    // ---------------------------------------------------------------------------
    /** Resolves once the renderer reflects the latest requested world. */
    whenSynced() {
        return this.syncChain;
    }
    /** The world the renderer last finished syncing (procedural outputs match it). */
    get syncedWorld() {
        return this.syncedWorldDoc;
    }
    requestSync(world) {
        if (this.disposed)
            return;
        this.touch();
        const idle = this.pendingWorld === null;
        this.pendingWorld = world;
        if (!idle)
            return; // the running chain picks up the newest world
        this.syncChain = this.syncChain.then(async () => {
            // Coalesce: always render the newest world requested while waiting.
            while (this.pendingWorld && !this.disposed) {
                const next = this.pendingWorld;
                try {
                    await this.renderer.setWorld(next);
                    if (next.voxel || this.voxel)
                        await (await this.voxelSession()).sync(next);
                    this.syncedWorldDoc = next;
                }
                catch (err) {
                    log.error('renderer sync failed', err);
                    this.listener.onError?.(`Rendering failed: ${errorMessage(err)}`);
                }
                if (this.pendingWorld === next)
                    this.pendingWorld = null;
            }
            this.refreshDebug();
            this.renderer.highlight(this.selection.filter((id) => this.syncedWorldDoc && Object.prototype.hasOwnProperty.call(this.syncedWorldDoc.entities, id)));
            // The entity's rendered object may have been rebuilt: re-attach the gizmo.
            this.applyGizmo();
            this.listener.onSynced?.();
        });
    }
    /** The voxel session (its module is loaded on first use: worlds without terrain never pay for it). */
    voxelSession() {
        if (this.voxel)
            return Promise.resolve(this.voxel);
        this.voxelLoading ??= import('../voxel/session').then(({ VoxelSession: Session }) => {
            const session = new Session(this.renderer, {
                onHud: (state) => this.listener.onVoxelHud?.(state),
                sound: (name) => this.sound.play(name),
                error: (message) => this.listener.onError?.(message),
                saveBase: this.saveBase,
            });
            if (this.disposed)
                session.dispose();
            else
                this.voxel = session;
            return session;
        });
        return this.voxelLoading;
    }
    /** Editor tool, the selection it acts on and the gizmo options (the gizmo shows for transform tools). */
    setGizmo(ids, tool, opts = this.gizmoOptions) {
        this.gizmoIds = ids.slice(0, 2000);
        this.gizmoTool = tool;
        this.gizmoOptions = opts;
        this.applyGizmo();
    }
    /** Change gizmo options (snapping, space, pivot) live, also during a drag. */
    setGizmoOptions(opts) {
        this.gizmoOptions = opts;
        this.renderer.setGizmoOptions(opts);
    }
    /** Hand the gizmo to component editing (true) or back to entities (false). */
    suspendEntityGizmo(on) {
        if (this.gizmoSuspended === on)
            return;
        this.gizmoSuspended = on;
        if (!on)
            this.applyGizmo();
    }
    applyGizmo() {
        if (this.disposed || this.gizmoSuspended)
            return;
        const doc = this.syncedWorldDoc;
        const ids = doc ? this.gizmoIds.filter((id) => Object.prototype.hasOwnProperty.call(doc.entities, id) && doc.entities[id]?.locked !== true) : [];
        const mode = this.session ? null : gizmoModeOf(this.gizmoTool);
        void this.renderer
            .setGizmo(mode ? ids : null, mode, mode ? (commit) => this.listener.onTransform?.(commit) : undefined, this.gizmoOptions)
            .catch((err) => log.warn('gizmo unavailable', err));
    }
    /**
     * Install a viewport tool that takes over left-button drags (null: plain
     * selection and orbiting). Camera navigation keeps right-drag and the wheel.
     */
    setViewportTool(tool) {
        if (this.toolDragging)
            this.viewportTool?.cancel?.();
        this.toolDragging = false;
        this.viewportTool?.hover?.(null);
        this.viewportTool = tool;
        this.renderer.setLeftDragNavigation(tool === null);
    }
    /** Consume clicks before entity picking (null: default picking). */
    setClickHandler(fn) {
        this.clickHandler = fn;
    }
    /** Entities that clicks and marquees pass through (e.g. locked ones). */
    setPickFilter(skip) {
        this.pickSkip = skip;
    }
    /** Draw (or with null hide) the marquee rectangle, in canvas CSS pixels. */
    showMarquee(rect) {
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
    setSelection(ids) {
        this.selection = ids.slice(0, 256);
        this.renderer.highlight(this.selection);
    }
    /** Outline the candidates of a question without touching the selection (empty restores it). */
    setCandidates(ids) {
        this.renderer.highlight(ids.length > 0 ? ids.slice(0, 32) : this.selection);
    }
    /** Where the camera looks, in the convention of the small-edit parser: 0 = toward −Z, 90 = toward +X. */
    cameraHeading() {
        const h = -cameraYawDeg(this.renderer);
        return Number.isFinite(h) ? h : 0;
    }
    /** Fly the camera to an entity. */
    focus(id) {
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
    async frameWorld(opts = {}) {
        await this.whenSynced();
        if (this.disposed || this.session)
            return;
        const world = this.history.current;
        const p = world.player;
        if (world.voxel && this.voxel?.active) {
            // Block terrain: an elevated view over what was built (structures, pixel art …), else
            // over the spawn area. Chunks stream in around the orbit target.
            if (!this.frameVoxelEdits(0, opts.flyIn === true)) {
                const g = this.voxel.groundAt(p.spawn[0], p.spawn[2]);
                const center = [p.spawn[0], g + 6, p.spawn[2]];
                const offset = this.voxel.viewOffset(center, VOXEL_SPAWN_RADIUS, VOXEL_SPAWN_RADIUS * VOXEL_DISTANCE_PER_RADIUS, VOXEL_FRAME_OFFSET);
                this.renderer.frameSphere(center, VOXEL_SPAWN_RADIUS, offset, opts.flyIn ? FRAME_DURATION * 1.6 : FRAME_DURATION);
            }
            return;
        }
        // Buildings frame themselves (the walkthrough spawn sits outside the entrance and would pull the view off).
        const spawnFocus = p.mode !== 'orbit' && !findAvatar(world) && !hasBuilding(world);
        if (this.renderer.frameContent({ focusPoints: spawnFocus ? [p.spawn] : [], ...(opts.flyIn ? { flyIn: true } : {}) }))
            return;
        // Nothing rendered yet (e.g. every entity failed to build): fall back to document positions.
        if (spawnFocus) {
            this.renderer.frameSphere(p.spawn, PLAYER_FRAME_RADIUS, FRAME_OFFSET, FRAME_DURATION);
            return;
        }
        const sphere = framingSphere(world);
        if (sphere)
            this.renderer.frameSphere(sphere.center, sphere.radius, FRAME_OFFSET, FRAME_DURATION);
    }
    /**
     * Show the block edits a turn added (from edit index `from` on): the
     * camera frames them from an elevated view. Waits for the renderer.
     */
    async revealVoxelEdits(from) {
        await this.whenSynced();
        if (this.disposed || this.session || !this.history.current.voxel)
            return;
        this.frameVoxelEdits(from, false);
    }
    /** Frame block edits from index `from` on; false when there are none (or no block terrain). */
    frameVoxelEdits(from, flyIn) {
        const focus = this.voxel?.active ? this.voxel.editFocus(from) : null;
        if (!focus)
            return false;
        const voxel = this.voxel;
        const radius = Math.max(VOXEL_EDIT_MIN_RADIUS, Math.min(VOXEL_EDIT_MAX_RADIUS, focus.radius * 1.15));
        const offset = voxel.viewOffset(focus.center, radius, radius * VOXEL_DISTANCE_PER_RADIUS, VOXEL_FRAME_OFFSET);
        this.renderer.frameSphere(focus.center, radius, offset, flyIn ? FRAME_DURATION * 1.6 : FRAME_DURATION);
        return true;
    }
    /**
     * Keep entities changed by an edit in view: the camera only moves when one
     * of them is off screen or too small to read. Waits for the renderer.
     */
    async revealEntities(ids) {
        await this.whenSynced();
        if (this.disposed || this.session)
            return;
        const world = this.history.current;
        const present = ids.filter((id) => Object.prototype.hasOwnProperty.call(world.entities, id) && !world.entities[id]?.template);
        this.renderer.reveal(present);
    }
    /** Toggle collider wireframes. */
    setShowColliders(on) {
        this.showColliders = on;
        this.refreshDebug();
    }
    /** Show verification diagnostics as markers in the viewport. */
    setDiagnostics(diags) {
        this.diagnostics = diags.slice(0, 64);
        this.refreshDebug();
    }
    /** Toggle the renderer's low-memory budget (pixel ratio, shadows, post pass, caches). */
    setLowMemory(on) {
        this.renderer.setLowMemory(on);
    }
    /** GPU memory picture of the renderer. */
    memoryStats() {
        return this.renderer.memoryStats();
    }
    /** Mark user/agent activity (keeps animated environments running in edit mode). */
    touch() {
        this.idle.touch(now());
    }
    /** Collect renderer stats in edit mode only while someone displays them. */
    setStatsWhileEditing(on) {
        this.statsWhileEditing = on;
    }
    /** Enable/disable pointer lock in play mode (applies on next play). */
    setPointerLock(on) {
        this.pointerLock = on;
    }
    /** Switch the play camera between follow/first-person/orbit. */
    setCameraView(view) {
        const s = this.session;
        if (s?.voxel)
            return;
        if (!s || view === 'orbit') {
            this.renderer.setCameraMode('orbit');
            return;
        }
        if (s.avatarId)
            this.renderer.setCameraMode(view, s.avatarId);
        else if (s.character)
            this.renderer.setCameraMode(view);
    }
    /** Data URL screenshot of the viewport. */
    async screenshot() {
        try {
            await this.whenSynced();
            // Draw as frame work, not inside whichever task resolved the caller (see lib/frame).
            await nextFrame();
            if (this.disposed)
                return null;
            return await this.renderer.screenshot({ width: 768, height: 432, mime: 'image/jpeg' });
        }
        catch (err) {
            log.warn('screenshot failed', err);
            return null;
        }
    }
    /**
     * Small still of the finished world for project cards (edit mode only).
     * Prefers WebP; browsers that cannot encode it (Safari) fall back to JPEG.
     */
    async thumbnail(width = 480, height = 270) {
        // A video or still export owns the renderer: the autosave thumbnail waits for the next save.
        if (this.session || this.disposed || this.renderer.capturing)
            return null;
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
                if (this.renderer.animating)
                    stillSince = performance.now();
                if (quietReached(performance.now(), stillSince, this.lastInputAt))
                    break;
                await new Promise((r) => setTimeout(r, 100));
            }
            // Block terrain: wait (bounded) for the chunks around the view, so the still shows the world.
            const voxelDeadline = performance.now() + VOXEL_THUMBNAIL_WAIT_MS;
            while (this.voxel?.active && !this.voxel.settled && performance.now() < voxelDeadline && !this.disposed && !this.session) {
                await new Promise((r) => setTimeout(r, 200));
            }
            if (this.session || this.disposed)
                return null;
            const webp = await this.renderer.screenshot({ width, height, mime: 'image/webp' });
            if (webp.startsWith('data:image/webp'))
                return webp;
            return await this.renderer.screenshot({ width, height, mime: 'image/jpeg' });
        }
        catch (err) {
            log.warn('thumbnail failed', err);
            return null;
        }
    }
    /**
     * Orthographic top/front/side/iso renders of the settled world for the
     * quality critique (edit mode only; waits for grow-in like thumbnails).
     */
    async renderViews(size = 256) {
        if (this.session || this.disposed)
            return [];
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
            if (this.session || this.disposed)
                return [];
            return await this.renderer.renderViews(['top', 'front', 'side', 'iso'], size);
        }
        catch (err) {
            log.warn('renderViews failed', err);
            return [];
        }
    }
    /**
     * Renders explicit camera poses for the review loop (edit mode only), one image per pose in order (null where a
     * pose could not be captured). Poses flagged `hideTops` (plan views from above) are taken with the building
     * view lowered to a plan, so ceilings and the roof do not hide the rooms; the view is restored afterwards.
     */
    async capturePoses(poses, size) {
        if (this.session || this.disposed)
            return poses.map(() => null);
        const out = poses.map(() => null);
        try {
            await this.whenSynced();
            const deadline = performance.now() + THUMBNAIL_SETTLE_MS;
            while (this.renderer.animating && performance.now() < deadline && !this.disposed) {
                this.touch();
                await new Promise((r) => setTimeout(r, 100));
            }
            await nextFrame();
            if (this.session || this.disposed)
                return out;
            const run = async (indices) => {
                if (indices.length === 0)
                    return;
                const images = await this.renderer.capturePoses(indices.map((i) => poses[i]), { ...size, mime: 'image/jpeg' });
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
                    while (this.renderer.animating && performance.now() < settle && !this.disposed)
                        await new Promise((r) => setTimeout(r, 60));
                    await nextFrame();
                    await run(plans);
                }
                finally {
                    this.renderer.setArchView({ walls: previous.walls });
                }
            }
        }
        catch (err) {
            log.warn('capturePoses failed', err);
        }
        return out;
    }
    /** World-space bounds of an entity at full scale (null when not rendered). */
    entityBounds(id) {
        return this.renderer.entityBounds(id);
    }
    /** Camera presets for the editor (orbit mode only). */
    /** Fly-through tour of the world (edit mode); returns false when there is nothing to tour. */
    tour() {
        if (this.session)
            return false;
        this.touch();
        return this.renderer.startTour();
    }
    viewPreset(preset) {
        if (this.session)
            return;
        this.touch();
        const dir = preset === 'top' ? [0, 1, 0.0001] : preset === 'front' ? [0, 0.18, 1] : preset === 'side' ? [1, 0.18, 0] : [0.62, 0.55, 0.85];
        this.renderer.viewFrom(dir);
    }
    /** Where a new object is placed: the orbit target, snapped to the ground plane (y ≥ 0). */
    placementPoint() {
        const t = this.renderer.orbitTarget();
        return [Math.round(t[0] * 2) / 2, Math.max(0, Math.round(t[1] * 2) / 2), Math.round(t[2] * 2) / 2];
    }
    /**
     * Camera-dependent overlays (axis gizmo, labels): called after every frame
     * that redrew the view, and once immediately. One listener at a time.
     */
    setViewListener(fn) {
        this.viewListener = fn;
        if (fn)
            fn(this.renderer.camera);
    }
    /**
     * Put the walking player at `feet` looking along `yawDeg` / `pitchDeg` (play
     * mode, worlds with a walking player). Used by guided tours and tests; returns
     * false when there is nothing to move.
     */
    placePlayer(feet, yawDeg, pitchDeg = 0) {
        const c = this.session?.character;
        if (!c || !Number.isFinite(yawDeg + pitchDeg + feet[0] + feet[1] + feet[2]))
            return false;
        c.teleport(feet);
        this.input.setYaw(yawDeg);
        this.input.setPitch(pitchDeg);
        return true;
    }
    /** On-screen touch stick (play mode). */
    setVirtualStick(forward, right) {
        this.session?.voxel?.input.setVirtualStick(forward, right);
        this.input.setVirtualStick(forward, right);
    }
    /** On-screen jump / action buttons (play mode). */
    tapVirtual(code) {
        if (code === 'KeyE' && this.interaction?.use())
            return;
        this.session?.voxel?.input.tap(code);
        this.input.tapVirtual(code);
    }
    /** Touch look: turn by degrees (play mode). */
    turnBy(deg) {
        this.session?.voxel?.input.turnBy(deg);
        this.input.turnBy(deg);
    }
    refreshDebug() {
        this.renderer.showDebug({ colliders: this.showColliders, diagnostics: this.diagnostics });
    }
    // ---------------------------------------------------------------------------
    // Play / stop
    // ---------------------------------------------------------------------------
    /**
     * Replay a verification run's motion over the edited world (ghosts and
     * trails). Edit mode only; resolves true once it plays.
     */
    async playProof(trace) {
        if (this.disposed || this.session)
            return false;
        await this.whenSynced();
        if (this.disposed || this.session)
            return false;
        this.touch();
        return this.renderer.playProof(trace, { reducedMotion: prefersReducedMotion() });
    }
    /** Stop a running proof replay. */
    stopProof() {
        this.renderer.stopProof();
    }
    /** Enter play mode from the current world. No-op while already playing. */
    play() {
        // Edit-mode decorations (proof replay, plan marks) never carry into play.
        this.renderer.stopProof();
        this.renderer.stopGhost();
        this.renderer.clearBlueprint();
        this.transition = this.transition.then(() => this.startSession()).catch((err) => {
            log.error('play failed', err);
            this.listener.onError?.(`Could not start the simulation: ${errorMessage(err)}`);
        });
        return this.transition;
    }
    /** Leave play mode and restore the pre-play world exactly. */
    stop() {
        this.transition = this.transition.then(() => this.endSession()).catch((err) => {
            log.error('stop failed', err);
        });
        return this.transition;
    }
    /** Restart the running session from the original world. */
    restart() {
        this.transition = this.transition
            .then(async () => {
            if (!this.session)
                return;
            await this.endSession();
            await this.startSession();
        })
            .catch((err) => {
            log.error('restart failed', err);
            this.listener.onError?.(`Could not restart: ${errorMessage(err)}`);
        });
        return this.transition;
    }
    /** Fire a logic `click` on an entity (play mode, orbit view). */
    click(id) {
        this.session?.logic.click(id);
    }
    /**
     * Build physics + logic for the current world and enter play mode. Atomic:
     * if any step fails, everything built so far is released and the studio
     * stays (or returns) in a consistent edit mode before the error propagates.
     */
    async startSession() {
        if (this.session || this.disposed)
            return;
        const world = this.history.current;
        this.requestSync(world);
        await this.whenSynced();
        if (this.disposed)
            return;
        // Lazy: the Rapier chunk is only downloaded/compiled when the user first plays.
        const { PhysicsWorld, CharacterController, CHARACTER_FEEL } = await import('@aether/physics');
        if (this.disposed)
            return;
        let pw = null;
        let scripts;
        let character = null;
        let logic = null;
        let core = null;
        try {
            pw = await PhysicsWorld.create(world, { colliders: this.colliders, fixedDt: FIXED_DT });
            try {
                if (usesScripts(world)) {
                    await initScripting();
                    scripts = createScriptRunner({ seed: world.seed });
                }
            }
            catch (err) {
                this.listener.onError?.(`Scripts disabled: ${errorMessage(err)}`);
                scripts = undefined;
            }
            if (this.disposed)
                throw new Error('simulation disposed');
            const avatarId = findAvatar(world);
            const voxelGame = world.voxel !== undefined && this.voxel !== null && this.voxel.active;
            if (!voxelGame && !avatarId && world.player.mode !== 'orbit' && world.player.mode !== 'vehicle') {
                character = new CharacterController(pw, { radius: PLAYER_CAPSULE.radius, height: PLAYER_CAPSULE.height, spawn: world.player.spawn, id: PLAYER_PSEUDO_ID, feel: CHARACTER_FEEL });
            }
            const voxel = voxelGame && this.voxel ? await this.voxel.startPlay(world, this.renderer.domElement) : null;
            if (voxelGame) {
                const terrain = this.voxel?.solidSource();
                if (terrain)
                    pw.setVoxelTerrain(terrain);
            }
            core = { world, pw, scripts, character, avatarId, transients: new Set(), destroyed: new Set(), ended: false, voxel };
            logic = new LogicRuntime(world, this.createHost(core), scripts ? { scripts, seed: world.seed } : { seed: world.seed });
        }
        catch (err) {
            if (core)
                core.ended = true;
            if (core?.voxel)
                await this.voxel?.stopPlay().catch(() => undefined);
            safely('logic dispose', () => logic?.dispose());
            safely('scripts dispose', () => scripts?.dispose());
            safely('character dispose', () => character?.dispose());
            safely('physics dispose', () => pw?.dispose());
            if (this.disposed)
                return;
            throw err;
        }
        if (!core || !logic)
            return;
        const session = Object.assign(core, { logic });
        this.table.clear();
        for (const id of movingIds(world)) {
            const t = safeWorldTransform(world, id);
            if (t)
                this.table.ensure(id, t.position, t.quaternion);
        }
        this.session = session;
        this.startInteraction(session);
        if (session.voxel)
            session.voxel.input.sensitivity = this.lookSensitivity;
        this.applyGizmo();
        if (this.toolDragging)
            this.viewportTool?.cancel?.();
        this.toolDragging = false;
        this.viewportTool?.hover?.(null);
        this.renderer.setLeftDragNavigation(true);
        this.stopRequested = false;
        try {
            this.renderer.highlight([]);
            // Walkthroughs start facing the entrance; other games face where the editor camera looked.
            this.input.setYaw(world.player.yaw ?? entranceYawDeg(world) ?? cameraYawDeg(this.renderer));
            this.input.setPitch(0);
            // The voxel game has its own input (mouse look, hotbar, break/place).
            if (!session.voxel)
                this.input.attach(this.renderer.domElement, { pointerLock: this.pointerLock });
            if (session.voxel)
                this.renderer.setCameraMode('manual');
            else if (session.avatarId)
                this.renderer.setCameraMode('follow', session.avatarId);
            else if (character) {
                this.renderer.setPlayerAvatar(character.position, this.input.yawDeg);
                this.renderer.setCameraMode(world.player.mode === 'firstPerson' ? 'firstPerson' : 'follow');
            }
            else
                this.renderer.setCameraMode('orbit');
            this.stepper.reset();
            session.logic.start();
        }
        catch (err) {
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
    async endSession() {
        const s = this.session;
        if (!s)
            return;
        this.session = null;
        s.ended = true;
        this.stopInteraction();
        this.sitting = null;
        this.renderer.setEyeHeight(1.6);
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
            if (s.voxel)
                await this.voxel?.stopPlay().catch((err) => log.warn('voxel stop failed', err));
            safely('logic dispose', () => s.logic.dispose());
            safely('scripts dispose', () => s.scripts?.dispose());
            safely('character dispose', () => s.character?.dispose());
            safely('transient removal', () => {
                for (const id of s.transients)
                    this.renderer.removeTransient(id);
            });
            safely('physics dispose', () => s.pw.dispose());
            // Drops overrides and restores the document pose of overridden (e.g. destroyed) entities.
            safely('override reset', () => this.renderer.clearRuntimeOverrides());
            safely('pose reset', () => {
                // Put every moved object back at its document pose.
                for (const id of this.table.order) {
                    const t = safeWorldTransform(s.world, id);
                    if (t)
                        this.table.write(id, t.position, t.quaternion);
                }
                this.renderer.applyTransforms(this.table.packed, this.table.order);
            });
        }
        finally {
            this.table.clear();
            safely('camera reset', () => this.renderer.setCameraMode('orbit'));
            safely('highlight', () => this.renderer.highlight(this.selection));
            safely('tool navigation', () => this.renderer.setLeftDragNavigation(this.viewportTool === null));
            this.listener.onModeChange?.('edit');
            // Catch up with edits that happened while playing.
            if (this.history.current !== s.world)
                this.requestSync(this.history.current);
        }
        await this.whenSynced();
    }
    /** Sit on a seat entity of the world (sofa, chair…); false when there is no walking player or the piece is no seat. */
    sitOn(id) {
        const s = this.session;
        const character = s?.character;
        const e = s?.world.entities[id];
        if (!s || !character || !e || this.sitting)
            return false;
        const kind = e.arch?.kind ?? '';
        const t = safeWorldTransform(s.world, id);
        if (!t)
            return false;
        const q = t.quaternion;
        const yaw = (Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[2] * q[2])) * 180) / Math.PI;
        const b = entityWorldBounds(s.world, id);
        const width = b ? Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) : 1;
        const pose = seatPose(kind, [t.position[0], t.position[1], t.position[2]], yaw, character.position, width);
        if (!pose)
            return false;
        character.setEnabled(false);
        character.teleport(pose.feet);
        this.input.setYaw(pose.yawDeg);
        this.input.setPitch(-8);
        this.renderer.setEyeHeight(pose.eye);
        this.sitting = { id, pose };
        return true;
    }
    /** Stand up in front of the seat. */
    standUp() {
        const s = this.session;
        const sit = this.sitting;
        if (!sit)
            return;
        this.sitting = null;
        this.renderer.setEyeHeight(1.6);
        const c = s?.character;
        if (c) {
            c.teleport(sit.pose.stand);
            c.setEnabled(true);
        }
    }
    /** True while the player sits. */
    get isSitting() {
        return this.sitting !== null;
    }
    /** Start the aim-and-use controller for a session that has a walking player. */
    startInteraction(s) {
        this.stopInteraction();
        if (s.voxel)
            return;
        const sim = this;
        const pos = [0, 0, 0];
        const quat = [0, 0, 0, 1];
        this.interaction = new PlayInteraction({
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
        }, {
            aim() {
                const feet = s.character?.position ?? sim.playerPosition;
                const m = sim.renderer.camera.matrixWorld.elements;
                const dir = [-m[8], -m[9], -m[10]];
                const c = sim.renderer.camera.position;
                const eye = feet ? [feet[0], feet[1] + (sim.sitting ? sim.sitting.pose.eye : 1.55), feet[2]] : [c.x, c.y, c.z];
                return { eye, dir };
            },
            playerVelocity: () => [0, 0, 0],
            floorY: () => s.character?.position[1] ?? 0,
        }, {
            prompt: (p) => this.listener.onInteract?.(p),
            sound: (name) => this.sound.play(name),
            toast: (text) => this.listener.onMessage?.(text, 1.4),
        });
        window.addEventListener('keydown', this.interactionKeys, true);
        this.renderer.domElement.addEventListener('pointerdown', this.interactionClick, true);
    }
    stopInteraction() {
        window.removeEventListener('keydown', this.interactionKeys, true);
        this.renderer.domElement.removeEventListener('pointerdown', this.interactionClick, true);
        this.interaction?.dispose();
        this.interaction = null;
    }
    onInteractionKey(e) {
        if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.key.toLowerCase() !== 'e' || this.paused || this.held || !this.session)
            return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))
            return;
        // Acted: keep the key from also opening the door next to you.
        if (this.interaction?.use()) {
            e.stopImmediatePropagation();
            e.preventDefault();
        }
    }
    /** LogicHost bound to one play session (stale calls after Stop are ignored). */
    createHost(s) {
        const sim = this;
        const isDoc = (id) => Object.prototype.hasOwnProperty.call(s.world.entities, id);
        // One reusable pose record per entity: getTransform runs many times per tick.
        const poses = new PosePool();
        return {
            getTransform(id) {
                if (s.ended || s.destroyed.has(id))
                    return undefined;
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
                if (s.pw.readPose(id, slot.position, slot.quaternion))
                    return slot;
                if (sim.table.read(id, slot.position, slot.quaternion))
                    return slot;
                if (!isDoc(id))
                    return undefined;
                const t = safeWorldTransform(s.world, id);
                return t ? poses.fill(id, t.position, t.quaternion) : undefined;
            },
            setKinematic(id, position, quaternion) {
                if (s.ended || s.destroyed.has(id))
                    return;
                const body = bodyTypeOf(s.world, id);
                if (s.pw.has(id)) {
                    if (body === 'static')
                        s.pw.teleport(id, position, quaternion);
                    else
                        s.pw.setKinematicTarget(id, position, quaternion);
                }
                if (!s.pw.has(id) || body === 'static' || body === 'dynamic')
                    sim.table.write(id, position, quaternion);
                else
                    sim.table.ensure(id, position, quaternion);
            },
            applyImpulse: (id, v) => s.pw.applyImpulse(id, v),
            setVelocity: (id, v) => s.pw.setVelocity(id, v),
            getVelocity: (id) => (id === PLAYER_PSEUDO_ID && s.character ? [0, s.character.verticalSpeed, 0] : s.pw.getVelocity(id)),
            setAngularVelocity: (id, v) => s.pw.setAngularVelocity(id, v),
            driveJoint: (id, target) => {
                s.pw.driveJoint(id, target);
            },
            teleport(id, p) {
                if (s.ended)
                    return;
                if (id === PLAYER_PSEUDO_ID && s.character)
                    s.character.teleport(p);
                else if (s.pw.has(id))
                    s.pw.teleport(id, p);
                else if (sim.table.read(id, scratchPos, scratchQuat))
                    sim.table.write(id, p, scratchQuat);
                else {
                    const t = isDoc(id) ? safeWorldTransform(s.world, id) : undefined;
                    if (t)
                        sim.table.write(id, p, t.quaternion);
                }
            },
            explode: (c, f, r) => s.pw.explode(c, f, r),
            setGravity: (v) => s.pw.setGravity(v),
            spawn(entity) {
                if (s.ended)
                    return;
                if (s.transients.size >= MAX_TRANSIENTS || isDoc(entity.id) || s.transients.has(entity.id))
                    return;
                s.transients.add(entity.id);
                s.destroyed.delete(entity.id);
                // Spawns are structured clones of templates from the validated session world.
                sim.renderer.addTransient(entity, { trusted: true });
                if (entity.physics)
                    s.pw.addEntity(entity, { trusted: true });
                if (!entity.physics || entity.physics.body !== 'static')
                    sim.table.ensure(entity.id, entity.transform.position, eulerDegToQuat(entity.transform.rotation));
            },
            destroy(id) {
                if (s.ended || s.destroyed.has(id))
                    return;
                s.destroyed.add(id);
                poses.release(id);
                s.pw.removeEntity(id);
                sim.table.remove(id);
                if (s.transients.delete(id))
                    sim.renderer.removeTransient(id);
                else if (isDoc(id))
                    sim.renderer.setEntityProperty(id, 'visible', false);
            },
            setProperty(id, path, value) {
                if (!s.ended)
                    sim.renderer.setEntityProperty(id, path, value);
            },
            message(text, duration) {
                if (!s.ended)
                    sim.listener.onMessage?.(String(text).slice(0, 240), duration);
            },
            sound(name) {
                if (!s.ended)
                    sim.sound.play(name);
            },
            gameOver(result, text) {
                if (!s.ended)
                    sim.listener.onGameOver?.(result, String(text).slice(0, 200));
            },
            reset() {
                if (!s.ended)
                    queueMicrotask(() => void sim.restart());
            },
            playerId() {
                if (s.avatarId)
                    return s.avatarId;
                return s.character || s.voxel ? PLAYER_PSEUDO_ID : undefined;
            },
            // NPC navigation: footprints of generated shapes, and the ground under hills.
            getBounds: (id) => (!s.ended && isDoc(id) ? (entityWorldBounds(s.world, id) ?? undefined) : undefined),
            getColliderBounds: (id) => (!s.ended && isDoc(id) ? entityColliderBounds(s.world, id) : []),
            groundHeight(x, z, fromY, exclude) {
                if (s.ended)
                    return undefined;
                const hit = s.pw.raycast([x, fromY, z], [0, -1, 0], fromY + 8, exclude);
                return hit ? hit.point[1] : undefined;
            },
        };
    }
    // ---------------------------------------------------------------------------
    // Frame loop
    // ---------------------------------------------------------------------------
    onAnimationFrame = (t) => {
        if (this.disposed)
            return;
        this.raf = requestAnimationFrame(this.onAnimationFrame);
        // Raw frame delta: the stepper and the renderer clamp long stalls themselves,
        // and clamping here would pin the fps counter at 1 / MAX_FRAME_DT on slow GPUs.
        const dt = this.lastFrame < 0 ? 0 : Math.max(0, (t - this.lastFrame) / 1000);
        this.lastFrame = t;
        const s = this.session;
        try {
            if (s && !this.paused) {
                this.pollGamepad(dt);
                this.stepSession(s, dt);
            }
            // While paused the block world still streams and finishes loading (a start card would otherwise sit over a loader stuck at 100 %).
            if (this.voxel?.active && (!this.paused || this.voxel.loadingPlay))
                this.voxel.frame(dt);
            // Edit mode renders on demand (frozen weather once idle); play mode renders every frame.
            this.renderOpts.onDemand = s === null;
            this.renderOpts.animate = s !== null || !this.idle.idle(t);
            const drew = this.renderer.render(dt, this.renderOpts);
            if (drew && this.viewListener)
                this.viewListener(this.renderer.camera);
            this.frameFailures = 0;
        }
        catch (err) {
            this.onFrameError(err, s);
        }
        if (t - this.lastStats >= STATS_INTERVAL_MS) {
            this.lastStats = t;
            try {
                this.emitStats();
            }
            catch (err) {
                log.warn('stats failed', err);
            }
        }
    };
    /** Report a failed frame once per distinct error; stop the loop when failures persist. */
    onFrameError(err, s) {
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
    pollGamepad(dt) {
        const g = this.pad.poll();
        if (!g.active) {
            if (this.padMoving) {
                this.padMoving = false;
                this.setVirtualStick(0, 0);
            }
            return;
        }
        const moving = g.forward !== 0 || g.right !== 0;
        if (moving || this.padMoving)
            this.setVirtualStick(g.forward, g.right);
        this.padMoving = moving;
        if (g.lookX !== 0)
            this.turnBy(-g.lookX * STICK_TURN_SPEED * Math.min(0.1, dt));
        if (g.jump)
            this.tapVirtual('Space');
        if (g.action)
            this.tapVirtual('KeyE');
        if (g.pause)
            this.listener.onPauseRequest?.();
    }
    /**
     * Freeze or resume the running game (physics, logic, voxel game) while the
     * world keeps rendering — the pause menu of published games. Held keys
     * and pointer lock are released when pausing.
     */
    setPaused(on) {
        if (this.paused === on)
            return;
        this.paused = on;
        if (on) {
            this.input.releaseAll();
            if (typeof document !== 'undefined' && document.pointerLockElement)
                document.exitPointerLock();
        }
        else {
            this.stepper.reset();
            this.lastFrame = -1;
        }
        this.renderer.requestRender();
    }
    /** True while paused (see {@link setPaused}). */
    get isPaused() {
        return this.paused;
    }
    /** Master volume of game sounds (0–1). */
    setVolume(v) {
        this.sound.setVolume(v);
    }
    /** Mouse look multiplier (0.25–3) for the character and block-world games. */
    setLookSensitivity(m) {
        this.lookSensitivity = Number.isFinite(m) ? Math.max(0.25, Math.min(3, m)) : 1;
        this.input.sensitivity = this.lookSensitivity;
        if (this.session?.voxel)
            this.session.voxel.input.sensitivity = this.lookSensitivity;
    }
    stepSession(s, dt) {
        if (this.held) {
            this.stepper.reset();
            return;
        }
        const steps = this.stepper.advance(dt);
        const { pw, logic, character } = s;
        const speed = s.world.player.moveSpeed;
        const jump = s.world.player.jumpSpeed;
        for (let i = 0; i < steps && !s.ended; i++) {
            const input = this.input.sample(FIXED_DT);
            if (s.voxel)
                s.voxel.step(FIXED_DT);
            if (character && this.sitting) {
                // Seated: held in place; any walking or jumping input stands the player up.
                character.teleport(this.sitting.pose.feet);
                if (Math.abs(input.forward) > 0.4 || Math.abs(input.right) > 0.4 || input.jump)
                    this.standUp();
            }
            else if (character) {
                // Holding Shift sneaks: half pace, quiet enough for guards not to hear.
                const sneak = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
                this.sneaking = sneak;
                character.move({ forward: input.forward, right: input.right, jump: input.jump, yawDeg: input.pointerYawDeg }, FIXED_DT, sneak ? speed * 0.5 : speed, jump);
                if (character.position[1] < PLAYER_KILL_Y)
                    character.teleport(s.world.player.spawn);
            }
            const events = pw.stepFixed();
            logic.tick(FIXED_DT, input, events);
        }
        if (s.ended)
            return;
        this.pumpNpc(s);
        this.feedCharacters(s);
        this.renderer.setLookPitch((this.input.pitchDeg * Math.PI) / 180);
        this.interaction?.frame();
        pw.writeTransforms(this.table.packed, this.table.order);
        this.renderer.applyTransforms(this.table.packed, this.table.order);
        if (character) {
            this.renderer.setPlayerAvatar(character.position, this.input.yawDeg, {
                grounded: character.grounded,
                vy: character.verticalSpeed,
                crouching: this.sneaking,
                sprinting: false,
            });
        }
    }
    /** Footstep of a person: the sound of the surface underfoot, quieter with distance and softer when sneaking. */
    footstep(id, speed, position) {
        if (!this.session || this.held || this.paused)
            return;
        const cam = this.renderer.camera.position;
        const dx = position[0] - cam.x;
        const dy = position[1] - cam.y;
        const dz = position[2] - cam.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const own = id === 'aether:player';
        // The player's own steps stay audible in third person; others fade out by ~24 m.
        const level = own ? (this.sneaking ? 0.35 : 1) * Math.min(1.2, 0.5 + speed * 0.1) : Math.max(0, 1 - d / 24) * Math.min(1.1, 0.45 + speed * 0.1);
        if (level <= 0.02)
            return;
        this.sound.play(`step-${this.renderer.surfaceAt(position[0], position[1], position[2])}`, level);
    }
    /**
     * Hand each person on screen what the NPC runtime knows (animation hint,
     * conversation, who to look at). Visual only: nothing here is read back by
     * the simulation, so the playtest bot and replay proofs are unaffected.
     */
    feedCharacters(s) {
        if (this.renderer.characterCount === 0)
            return;
        const npcs = s.logic.npcs;
        const speaking = this.speakingScratch;
        speaking.clear();
        for (let i = 0; i < npcs.bubbleCount; i++) {
            const b = npcs.bubbleAt(i);
            if (b)
                speaking.add(b.npc);
        }
        const pos = s.character?.position;
        const target = this.lookScratch;
        if (pos)
            target.set(pos[0], pos[1] + 1.55, pos[2]);
        for (const brain of npcs.brains) {
            const rig = this.renderer.characterRig(brain.id);
            if (!rig)
                continue;
            const hint = brain.animation;
            rig.input.hint = hint === 'idle' || hint === 'walk' || hint === 'run' || hint === 'attack' || hint === 'talk' || hint === 'hurt' || hint === 'dead' ? hint : 'idle';
            rig.input.talking = brain.conversing || speaking.has(brain.id);
            rig.lookTarget = pos && (brain.attentive || speaking.has(brain.id)) ? target : null;
        }
    }
    /** Sample the NPC system for the UI: on change, and at ~12 Hz while bubbles are on screen. */
    pumpNpc(s) {
        const listener = this.listener.onNpc;
        if (!listener)
            return;
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
        if (!changed && now - this.npcAt < NPC_FRAME_MS)
            return;
        // Mouse-look captures the pointer; a conversation needs it back for the choice buttons.
        const talking = d !== null;
        if (talking && !this.npcTalking && typeof document !== 'undefined' && document.pointerLockElement)
            document.exitPointerLock();
        this.npcTalking = talking;
        this.npcQuick = quick;
        this.npcAt = now;
        const cam = this.renderer.camera;
        const frame = buildNpcFrame(npcs, { view: cam.matrixWorldInverse.elements, projection: cam.projectionMatrix.elements });
        const sig = frameSignature(frame);
        if (sig === this.npcSig)
            return;
        this.npcSig = sig;
        listener(frame);
    }
    /** Take choice `i` (0-based) of the running conversation (touch and pointer input). */
    npcChoose(i) {
        this.session?.logic.npcs.choose(i);
        this.npcQuick = '';
    }
    /** Continue the running conversation, or start one with the nearest character in reach. */
    npcAdvance() {
        const npcs = this.session?.logic.npcs;
        if (!npcs)
            return;
        if (npcs.dialogue)
            npcs.advance();
        else if (npcs.prompt)
            npcs.startDialogue(npcs.prompt.npc);
        this.npcQuick = '';
    }
    /** What a language model needs to play the character of the running conversation (null without one). */
    npcChatContext() {
        return this.session?.logic.npcs.chatContext() ?? null;
    }
    /** Show a free reply, only while the conversation is still with `npcId`. */
    npcFreeReply(npcId, text) {
        const npcs = this.session?.logic.npcs;
        if (!npcs || npcs.dialogue?.npc !== npcId)
            return false;
        this.npcQuick = '';
        return npcs.freeReply(text);
    }
    /** Close the running conversation. */
    npcClose() {
        this.session?.logic.npcs.endDialogue();
        this.npcQuick = '';
    }
    emitStats() {
        const s = this.session;
        // Worlds drawn through fields / virtual geometry always report (the viewport shows their triangle counts).
        if (!s && !this.statsWhileEditing && !this.renderer.scaleGeometryActive)
            return;
        const r = this.renderer.stats();
        const p = s ? s.pw.stats() : null;
        const heap = performance.memory?.usedJSHeapSize;
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
            const hud = {};
            for (const b of s.world.hud)
                hud[b.key] = s.logic.readState(b.key);
            this.listener.onHud(hud, s.logic.time);
        }
    }
    // ---------------------------------------------------------------------------
    // Pointer, resize, teardown
    // ---------------------------------------------------------------------------
    toolPointer(e) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0)
            return null;
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
    onPointerDown = (e) => {
        this.downValid = e.button === 0;
        this.downOnGizmo = this.renderer.gizmoBusy;
        this.downX = e.clientX;
        this.downY = e.clientY;
        if (isTypingElement(document.activeElement))
            document.activeElement.blur();
        if (this.session || e.button !== 0 || this.downOnGizmo || !this.viewportTool)
            return;
        const p = this.toolPointer(e);
        if (!p || !this.viewportTool.down(p))
            return;
        this.toolDragging = true;
        this.toolPointerId = e.pointerId;
        this.downValid = false;
        try {
            this.renderer.domElement.setPointerCapture(e.pointerId);
        }
        catch {
            /* capture is optional */
        }
        this.touch();
    };
    onPointerMove = (e) => {
        if (this.session || !this.viewportTool)
            return;
        const p = this.toolPointer(e);
        if (!p)
            return;
        if (this.toolDragging && e.pointerId === this.toolPointerId)
            this.viewportTool.move(p);
        else if (!this.toolDragging && e.buttons === 0)
            this.viewportTool.hover?.(p);
    };
    onPointerLeave = () => {
        if (!this.toolDragging)
            this.viewportTool?.hover?.(null);
    };
    onPointerCancel = (e) => {
        if (!this.toolDragging || e.pointerId !== this.toolPointerId)
            return;
        this.toolDragging = false;
        this.viewportTool?.cancel?.();
    };
    onPointerUp = (e) => {
        if (this.toolDragging && e.pointerId === this.toolPointerId) {
            this.toolDragging = false;
            const p = this.toolPointer(e);
            if (p)
                this.viewportTool?.up(p);
            else
                this.viewportTool?.cancel?.();
            return;
        }
        if (!this.downValid || e.button !== 0)
            return;
        this.downValid = false;
        if (this.downOnGizmo)
            return;
        if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > CLICK_SLOP_PX)
            return;
        const p = this.toolPointer(e);
        if (!p)
            return;
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        if (!this.session && this.clickHandler?.(p, additive))
            return;
        const id = this.renderer.pick(p.ndcX, p.ndcY, this.session ? undefined : this.pickSkip);
        if (this.session) {
            if (id)
                this.session.logic.click(id);
            return;
        }
        this.listener.onPick?.(id, additive);
    };
    /** Stop the loop while the page is hidden; resume (without a giant time step) when it shows again. */
    onVisibility = () => {
        if (this.disposed)
            return;
        const hidden = document.visibilityState === 'hidden';
        if (hidden === this.hidden)
            return;
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
        if (this.raf === 0 && this.frameFailures < MAX_FRAME_FAILURES)
            this.raf = requestAnimationFrame(this.onAnimationFrame);
    };
    onActivity = () => {
        this.lastInputAt = performance.now();
        this.touch();
    };
    /** Time of the last pointer / key / wheel input (thumbnail captures wait for a quiet moment). */
    lastInputAt = 0;
    resize() {
        const parent = this.renderer.domElement.parentElement;
        if (!parent)
            return;
        const w = Math.max(1, Math.floor(parent.clientWidth));
        const h = Math.max(1, Math.floor(parent.clientHeight));
        this.renderer.resize(w, h);
    }
    /** Stop everything and release GPU/physics resources. */
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        if (typeof document !== 'undefined')
            document.removeEventListener('visibilitychange', this.onVisibility);
        for (const type of ACTIVITY_EVENTS)
            window.removeEventListener(type, this.onActivity, { capture: true });
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
        this.renderer.dispose();
    }
}
// -----------------------------------------------------------------------------
// Helpers (pure)
// -----------------------------------------------------------------------------
/** Input that counts as activity for the idle clock. */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'];
function now() {
    return typeof performance !== 'undefined' ? performance.now() : 0;
}
/** Run a teardown step, logging (not propagating) its failure. */
function safely(step, fn) {
    try {
        fn();
    }
    catch (err) {
        log.warn(`${step} failed`, err);
    }
}
function usesScripts(world) {
    if (Object.keys(world.scripts).length === 0)
        return false;
    for (const id in world.entities) {
        if (world.entities[id]?.behaviors.some((b) => b.type === 'script'))
            return true;
    }
    return false;
}
function bodyTypeOf(world, id) {
    const e = Object.prototype.hasOwnProperty.call(world.entities, id) ? world.entities[id] : undefined;
    return e?.physics ? e.physics.body : null;
}
function safeWorldTransform(world, id) {
    try {
        const t = worldTransform(world, id);
        return { position: t.position, quaternion: t.quaternion };
    }
    catch {
        return undefined;
    }
}
/** Camera yaw in degrees (0 faces −Z), used to start play facing where the editor camera looked. */
function cameraYawDeg(renderer) {
    const e = renderer.camera.matrixWorld.elements;
    // Camera looks down its local −Z: forward = −(m8, m9, m10).
    scratchDir.x = -e[8];
    scratchDir.z = -e[10];
    if (Math.abs(scratchDir.x) + Math.abs(scratchDir.z) < 1e-6)
        return 0;
    return (Math.atan2(-scratchDir.x, -scratchDir.z) * 180) / Math.PI;
}
/**
 * Yaw in degrees (0 faces −Z) from the player spawn toward the building's
 * entrance (an entity tagged "entrance"), or null when there is none.
 */
export function entranceYawDeg(world) {
    for (const id in world.entities) {
        const e = world.entities[id];
        if (!e || !e.tags.includes('entrance'))
            continue;
        const t = worldTransform(world, id);
        if (!t)
            continue;
        const dx = t.position[0] - world.player.spawn[0];
        const dz = t.position[2] - world.player.spawn[2];
        if (Math.hypot(dx, dz) < 0.2)
            return null;
        return (Math.atan2(-dx, -dz) * 180) / Math.PI;
    }
    return null;
}
/** True when the user asked the OS/browser for reduced motion (no grow-in animation then). */
export function prefersReducedMotion() {
    try {
        return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    catch {
        return false;
    }
}
/** The world contains a parametric building (`arch.role` "building"). */
function hasBuilding(world) {
    for (const id in world.entities)
        if (world.entities[id]?.arch?.role === 'building')
            return true;
    return false;
}
