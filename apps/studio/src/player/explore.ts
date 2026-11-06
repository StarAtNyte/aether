/**
 * Explore mode of the standalone player: the camera and the tour of a world outside play, by its kind
 * (`experience.ts`).
 *
 * - Walk (architecture): the camera at eye level (1.6 m over the floor), no avatar and no physics session. A click or tap
 *   on the floor glides there (Matterport-style), WASD or the arrows walk slowly with collision, a drag looks round. Moves
 *   across walls or far away fade instead of flying through the house. The dollhouse cuts the walls away and frames the
 *   building from above; the plan looks straight down; a click on a room flies into it.
 * - Orbit and drone (showcases, cities, games): the editor's orbit camera; stops fly there; a city runs the drone tour.
 *
 * Tour stops are the world's own (`views`), the cook's, or computed from the scene (`renderer.viewStops`); autoplay glides
 * from one to the next and holds each a few seconds. Any input of the visitor stops it.
 *
 * Lazy-loaded with the explore bar: a game played from its title card never downloads it.
 */
import type { Vec3, ViewStop } from '@aether/core';
import type { ViewStopPose } from '@aether/render';
import { easeInOutCubic } from '@aether/render';
import type { Simulation } from '../engine/Simulation';
import { skyForHour } from '../state/archUi';
import type { Experience } from './experience';
import { glideDestination, glideSeconds, needsFade, STEP_DOWN, turn, WALK_EYE, walkStep, yawPitch, type WalkProbe } from './walk';

/** Seconds the hero view holds before the tour (or the drone) starts. */
export const HERO_HOLD_S = 4;
/** Seconds autoplay holds each stop. */
export const STOP_HOLD_S = 5.5;
/** Highest eye (m over the ground) a city's street-level view may have. */
export const STREET_EYE = 6;
/** Length (s) of the showcase fly-in. */
export const FLY_IN_S = 7;
/** Lens of the eye-level walk (degrees), as the play camera's first person. */
const WALK_LENS = 70;
/** Half of a fade (ms). */
const FADE_MS = 280;
/** Drag look speed (radians per pixel). */
const LOOK_RATE = 0.0042;

/** Camera of explore mode now. */
export type ExploreView = 'walk' | 'orbit' | 'drone' | 'dollhouse' | 'plan';

/** What the explore bar shows. */
export interface ExploreState {
  stops: ViewStopPose[];
  /** The stop arrived at or flying to (-1: none). */
  index: number;
  autoplay: boolean;
  view: ExploreView;
  /** Sun hour of the time-of-day bar (null: as built). */
  hour: number | null;
  photo: boolean;
  /** A fade covers the view (a move across walls). */
  fading: boolean;
}

type Renderer = Simulation['renderer'];

/** The walk probe over the renderer's scene: its rays, and its ground plane where nothing else is below. */
export function rendererWalkProbe(r: Renderer): WalkProbe {
  return {
    free(from, dir, max) {
      const hit = r.raycastWorld([from[0], from[1], from[2]], [dir[0], dir[1], dir[2]], max);
      return hit ? Math.hypot(hit.point[0] - from[0], hit.point[1] - from[1], hit.point[2] - from[2]) : max;
    },
    floor(x, z, fromY) {
      const reach = STEP_DOWN + 3;
      const hit = r.raycastWorld([x, fromY, z], [0, -1, 0], reach);
      if (hit) return hit.normal[1] >= 0.55 ? hit.point[1] : null;
      // The environment's ground plane (y = 0) is outside the scene's entities.
      return Number.isFinite(r.cameraFloorY) && fromY >= 0 && fromY - reach <= 0 ? 0 : null;
    },
  };
}

/**
 * The room whose floor a ray crosses first (the floor's plane at the top of its box, inside the box in plan), or null.
 * The dollhouse and the plan pick rooms with it.
 */
export function roomUnderRay<T extends { min: Vec3; max: Vec3 }>(ray: { origin: Vec3; direction: Vec3 }, rooms: readonly T[]): T | null {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.direction;
  if (!(dy < -1e-6)) return null;
  let best: T | null = null;
  let bestT = Number.POSITIVE_INFINITY;
  for (const b of rooms) {
    const t = (b.max[1] - oy) / dy;
    if (!(t > 0) || t >= bestT) continue;
    const x = ox + dx * t;
    const z = oz + dz * t;
    if (x < b.min[0] || x > b.max[0] || z < b.min[2] || z > b.max[2]) continue;
    best = b;
    bestT = t;
  }
  return best;
}

/** Stops of a world: its own `views`, else the cook's, else computed by the renderer. */
export function pickStops(own: readonly ViewStop[] | undefined, cooked: readonly ViewStopPose[] | undefined, compute: () => ViewStopPose[]): ViewStopPose[] {
  const norm = (s: ViewStop | ViewStopPose): ViewStopPose => ({ position: [...s.position] as Vec3, target: [...s.target] as Vec3, ...(s.fov !== undefined ? { fov: s.fov } : {}), ...(s.name !== undefined ? { name: s.name } : {}) });
  if (own && own.length > 0) return own.map(norm);
  if (cooked && cooked.length > 0) return cooked.map(norm);
  return compute();
}

/** A pose in the walk's terms. */
interface WalkPose {
  eye: Vec3;
  yaw: number;
  pitch: number;
}

/** Drives the camera of explore mode (see the module comment). */
export class ExploreController {
  private state: ExploreState;
  private readonly probe: WalkProbe;
  private pose: WalkPose | null = null;
  private glide: { from: WalkPose; to: WalkPose; t: number; seconds: number; then?: () => void } | null = null;
  private readonly keys = new Set<string>();
  private raf: number | null = null;
  private last = 0;
  /** Seconds left before autoplay (or the drone) moves on; null: nothing scheduled. */
  private hold: number | null = null;
  private holdAction: 'next' | 'drone' | null = null;
  private drag: { id: number; x: number; y: number; moved: boolean } | null = null;
  private savedLens: number | null = null;
  private saved: WalkPose | null = null;
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private disposed = false;
  private rooms: Array<{ index: number; min: Vec3; max: Vec3 }> = [];

  constructor(
    private readonly sim: Simulation,
    readonly exp: Experience,
    stops: ViewStopPose[],
    private readonly onState: (s: ExploreState) => void,
    private readonly opts: { reduceMotion?: boolean } = {},
  ) {
    this.probe = rendererWalkProbe(sim.renderer);
    this.state = { stops, index: -1, autoplay: false, view: exp.explore === 'walk' ? 'walk' : exp.explore === 'drone' ? 'drone' : 'orbit', hour: null, photo: false, fading: false };
    this.indexRooms();
    const canvas = sim.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('wheel', this.onUserInput, { passive: true });
    sim.setClickHandler((p) => this.onClick(p.ndcX, p.ndcY));
    this.emit();
  }

  private indexRooms(): void {
    this.rooms = [];
    for (const [i, s] of this.state.stops.entries()) {
      if (!s.room) continue;
      const b = this.sim.entityBounds(s.room);
      if (b) this.rooms.push({ index: i, min: b.min, max: b.max });
    }
  }

  /**
   * Replace the stops (the full set computed after the entry started on the hero view alone). The stop shown keeps its
   * place when it is the hero view.
   */
  setStops(stops: ViewStopPose[]): void {
    if (this.disposed || stops.length === 0) return;
    const keep = this.state.index === 0 ? 0 : -1;
    this.set({ stops, index: keep });
    this.indexRooms();
    // A city still on its opening view (the drone not started): move to street level now that there are stops to choose.
    if (this.exp.entry === 'street-drone' && this.holdAction === 'drone' && keep === 0) {
      const i = this.streetStop();
      const s = stops[i];
      if (i !== 0 && s) {
        this.sim.renderer.flyToPose(s.position, s.target, 0, s.fov);
        this.set({ index: i });
      }
    }
  }

  /** The explore bar's state now. */
  get snapshot(): ExploreState {
    return this.state;
  }

  private set(patch: Partial<ExploreState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    if (!this.disposed) this.onState(this.state);
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers = this.timers.filter((x) => x !== t);
      if (!this.disposed) fn();
    }, ms);
    this.timers.push(t);
  }

  // --- entry --------------------------------------------------------------------------------------------------------

  /**
   * Enter explore mode. `entry`: the kind's opening (hero view and tour, fly-in, street view and drone); otherwise the camera
   * stays where it is (Tab from play or the title), standing at `from` for a walk.
   */
  start(entry: boolean, from: { feet: Vec3; yaw: number } | null = null): void {
    const r = this.sim.renderer;
    const hero = this.state.stops[0] ?? null;
    if (this.exp.explore === 'walk') {
      if (from) this.placeWalk({ eye: [from.feet[0], from.feet[1] + WALK_EYE, from.feet[2]], yaw: from.yaw, pitch: -0.08 });
      else if (entry && hero) this.placeStop(0);
      else this.placeFromCamera();
      // The tour starts from the hero view (its stops may still be coming: see setStops).
      if (entry) this.schedule(HERO_HOLD_S, 'next', true);
    } else if (entry && hero) {
      if (this.exp.entry === 'fly-in' && !this.opts.reduceMotion) {
        // From high and far behind the hero view, a slow descent into it.
        const dx = hero.position[0] - hero.target[0];
        const dy = hero.position[1] - hero.target[1];
        const dz = hero.position[2] - hero.target[2];
        const len = Math.hypot(dx, dy, dz) || 1;
        const back = Math.max(30, len * 2.2);
        const start: Vec3 = [hero.position[0] + (dx / len) * back, hero.position[1] + back * 0.55 + 12, hero.position[2] + (dz / len) * back];
        r.flyToPose(start, hero.target, 0, hero.fov);
        this.later(60, () => r.flyToPose(hero.position, hero.target, FLY_IN_S, hero.fov));
        this.set({ index: 0, view: 'orbit' });
      } else {
        // A city opens at street level: an aerial hero view gives way to the stop nearest the ground.
        const i = this.exp.entry === 'street-drone' ? this.streetStop() : 0;
        const s = this.state.stops[i] as ViewStopPose;
        r.flyToPose(s.position, s.target, 0, s.fov);
        this.set({ index: i });
        if (this.exp.entry === 'street-drone') this.schedule(HERO_HOLD_S, 'drone', false);
      }
    } else {
      r.setCameraMode('orbit');
      this.set({ view: this.exp.explore === 'drone' ? 'drone' : 'orbit' });
    }
    this.loop();
  }

  /** The first stop whose eye is at street level (at most {@link STREET_EYE} m over what is below it), else the lowest one. */
  private streetStop(): number {
    let best = 0;
    let bestH = Number.POSITIVE_INFINITY;
    for (const [i, s] of this.state.stops.entries()) {
      const hit = this.sim.renderer.raycastWorld([s.position[0], s.position[1], s.position[2]], [0, -1, 0], 80);
      const h = hit ? s.position[1] - hit.point[1] : Number.POSITIVE_INFINITY;
      if (h <= STREET_EYE) return i;
      if (h < bestH) {
        bestH = h;
        best = i;
      }
    }
    return best;
  }

  // --- the walk -----------------------------------------------------------------------------------------------------

  private useLens(on: boolean): void {
    const cam = this.sim.renderer.camera;
    if (on && this.savedLens === null) {
      this.savedLens = cam.fov;
      cam.fov = WALK_LENS;
      cam.updateProjectionMatrix();
    } else if (!on && this.savedLens !== null) {
      cam.fov = this.savedLens;
      this.savedLens = null;
      cam.updateProjectionMatrix();
    }
  }

  private placeWalk(p: WalkPose): void {
    this.pose = { eye: [...p.eye] as Vec3, yaw: p.yaw, pitch: Math.max(-1.2, Math.min(1, p.pitch)) };
    this.useLens(true);
    this.sim.renderer.setCameraPose(p.eye[0], p.eye[1], p.eye[2], p.yaw, this.pose.pitch);
    this.sim.touch();
  }

  /** Stand where the camera is: on the floor below it at eye height when there is one within reach. */
  private placeFromCamera(): void {
    const c = this.sim.renderer.camera;
    const e = c.matrixWorld.elements;
    const look: Vec3 = [c.position.x - (e[8] as number), c.position.y - (e[9] as number), c.position.z - (e[10] as number)];
    const { yaw, pitch } = yawPitch([c.position.x, c.position.y, c.position.z], look);
    const f = this.probe.floor(c.position.x, c.position.z, c.position.y + 0.2);
    const y = f !== null && c.position.y - f < 6 ? f + WALK_EYE : c.position.y;
    this.placeWalk({ eye: [c.position.x, y, c.position.z], yaw, pitch: Math.max(-0.35, Math.min(0.2, pitch)) });
  }

  private stopPose(i: number): WalkPose | null {
    const s = this.state.stops[i];
    if (!s) return null;
    const { yaw, pitch } = yawPitch(s.position, s.target);
    return { eye: [...s.position] as Vec3, yaw, pitch };
  }

  private placeStop(i: number): void {
    const p = this.stopPose(i);
    if (!p) return;
    this.placeWalk(p);
    this.set({ index: i });
  }

  /** Move the walk to `to`: a glide, or a fade across walls and long distances. */
  private moveWalk(to: WalkPose, minSeconds = 0, then?: () => void): void {
    const from = this.pose;
    if (!from || this.opts.reduceMotion || needsFade(from.eye, to.eye, this.probe)) {
      this.fadeTo(() => {
        this.glide = null;
        this.placeWalk(to);
        then?.();
      });
      return;
    }
    const d = Math.hypot(to.eye[0] - from.eye[0], to.eye[1] - from.eye[1], to.eye[2] - from.eye[2]);
    const angle = Math.abs(turn(from.yaw, to.yaw));
    this.glide = { from: { ...from, eye: [...from.eye] as Vec3 }, to, t: 0, seconds: Math.max(minSeconds, glideSeconds(d), angle * 0.6), ...(then ? { then } : {}) };
  }

  private fadeTo(swap: () => void): void {
    this.set({ fading: true });
    this.later(FADE_MS, () => {
      swap();
      this.later(60, () => this.set({ fading: false }));
    });
  }

  private onClick(ndcX: number, ndcY: number): boolean {
    this.onUserInput();
    const r = this.sim.renderer;
    if (this.state.view === 'dollhouse' || this.state.view === 'plan') {
      // The room whose floor the pointer is over (the cut-away roof and ceilings still take rays: test the floors' planes).
      const room = roomUnderRay(r.cursorRay(ndcX, ndcY), this.rooms);
      if (room) this.goTo(room.index);
      return true;
    }
    if (this.state.view !== 'walk' || !this.pose) return false;
    const ray = r.cursorRay(ndcX, ndcY);
    const hit = r.raycastWorld(ray.origin, ray.direction, 80);
    if (!hit) return true;
    const dest = glideDestination(this.pose.eye, hit, this.probe);
    if (!dest) return true;
    this.moveWalk({ eye: dest, yaw: this.pose.yaw, pitch: this.pose.pitch });
    return true;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.onUserInput();
    if (this.state.view !== 'walk' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id || !this.pose || this.state.view !== 'walk') return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    this.glide = null;
    // Grab the view: dragging right turns left (the scene follows the pointer).
    const pose = this.pose;
    pose.yaw += dx * LOOK_RATE;
    pose.pitch = Math.max(-1.2, Math.min(1, pose.pitch + dy * LOOK_RATE));
    this.sim.renderer.setCameraPose(pose.eye[0], pose.eye[1], pose.eye[2], pose.yaw, pose.pitch);
    this.sim.touch();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.drag && e.pointerId === this.drag.id) this.drag = null;
  };

  private static readonly MOVE_KEYS: ReadonlySet<string> = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || !ExploreController.MOVE_KEYS.has(e.code)) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (this.state.view !== 'walk') return;
    this.keys.add(e.code);
    this.onUserInput();
    e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.drag = null;
  };

  /** The visitor took over: autoplay and a scheduled drone stop. */
  private readonly onUserInput = (): void => {
    if (this.hold !== null || this.state.autoplay) {
      this.hold = null;
      this.holdAction = null;
      if (this.state.autoplay) this.set({ autoplay: false });
    }
  };

  // --- tour ---------------------------------------------------------------------------------------------------------

  /** Seconds until `action`; `autoplay`: the tour runs on from there. */
  private schedule(seconds: number, action: 'next' | 'drone', autoplay: boolean): void {
    this.hold = seconds;
    this.holdAction = action;
    if (autoplay !== this.state.autoplay) this.set({ autoplay });
  }

  /** Go to stop `i` (wraps). */
  goTo(i: number, fromAutoplay = false): void {
    const n = this.state.stops.length;
    if (n === 0) return;
    const index = ((i % n) + n) % n;
    const s = this.state.stops[index] as ViewStopPose;
    const r = this.sim.renderer;
    if (!fromAutoplay) {
      this.hold = null;
      this.holdAction = null;
    }
    r.stopTour();
    const arrive = (): void => {
      if (this.state.autoplay) this.schedule(STOP_HOLD_S, 'next', true);
    };
    if (this.exp.explore === 'walk') {
      const to = this.stopPose(index) as WalkPose;
      if (this.state.view === 'dollhouse' || this.state.view === 'plan') {
        // Out of the cut-away building into the room: a fade (the walls come back up).
        this.fadeTo(() => {
          r.setArchView({ walls: 'up' });
          this.set({ view: 'walk' });
          this.placeWalk(to);
          arrive();
        });
      } else this.moveWalk(to, 1.2, arrive);
      this.set({ index });
      return;
    }
    const pos = r.camera.position;
    const dist = Math.hypot(s.position[0] - pos.x, s.position[1] - pos.y, s.position[2] - pos.z);
    const seconds = this.opts.reduceMotion ? 0 : Math.max(1.8, Math.min(5, dist / 14));
    r.flyToPose(s.position, s.target, seconds, s.fov);
    this.set({ index, view: this.exp.explore === 'drone' ? 'drone' : 'orbit' });
    this.later(seconds * 1000 + 50, arrive);
  }

  next(): void {
    this.goTo(this.state.index + 1);
  }

  prev(): void {
    this.goTo(this.state.index - 1);
  }

  /** Autoplay the tour on or off (on: moves on at once). */
  setAutoplay(on: boolean): void {
    if (on === this.state.autoplay) return;
    this.set({ autoplay: on });
    if (on) this.goTo(this.state.index + 1, true);
    else {
      this.hold = null;
      this.holdAction = null;
    }
  }

  /** The city's drone tour round the whole scene (stops at the visitor's first input). */
  droneTour(): void {
    this.onUserInput();
    this.hold = null;
    if (this.sim.renderer.touring) {
      this.sim.renderer.stopTour();
      this.set({ view: 'orbit' });
      return;
    }
    this.useLens(false);
    if (this.sim.renderer.startTour()) this.set({ view: 'drone', index: -1 });
  }

  /** Dollhouse (walls cut away, the building from above) on or off; off returns to where the walk stood. */
  toggleDollhouse(): void {
    if (!this.exp.dollhouse) return;
    this.onUserInput();
    const r = this.sim.renderer;
    if (this.state.view === 'dollhouse' || this.state.view === 'plan') {
      const back = this.saved;
      this.saved = null;
      this.fadeTo(() => {
        r.setArchView({ walls: 'up' });
        this.set({ view: 'walk' });
        if (back) this.placeWalk(back);
        else this.placeFromCamera();
      });
      return;
    }
    this.saved = this.pose ? { ...this.pose, eye: [...this.pose.eye] as Vec3 } : null;
    this.glide = null;
    this.useLens(false);
    r.setArchView({ walls: 'cutaway' });
    r.setCameraMode('orbit');
    this.set({ view: 'dollhouse' });
    void this.sim.frameWorld();
  }

  /** Floor plan (walls down, straight down) on or off, from the dollhouse. */
  setPlan(on: boolean): void {
    if (!this.exp.dollhouse) return;
    if (this.state.view === 'walk') this.toggleDollhouse();
    const r = this.sim.renderer;
    r.setArchView({ walls: on ? 'down' : 'cutaway' });
    if (on) this.sim.viewPreset('top');
    else void this.sim.frameWorld();
    this.set({ view: on ? 'plan' : 'dollhouse' });
  }

  /** Time of day (null: as built); `live` while the slider is dragged. */
  setHour(hour: number | null, live = false): void {
    const r = this.sim.renderer;
    this.set({ hour });
    if (hour === null) {
      r.restoreEnvironment();
      return;
    }
    const env = (this.sim.syncedWorld ?? null)?.environment;
    if (!env) return;
    const sky = skyForHour(hour);
    r.setEnvironmentOverride({ ...env, sky: sky.sky, timeOfDay: sky.timeOfDay, bloom: sky.sky === 'night' ? Math.max(env.bloom, 0.9) : env.bloom }, { live });
  }

  setPhoto(on: boolean): void {
    this.set({ photo: on });
  }

  /** The picture of the view now (photo mode's Save), at the canvas size up to 1920 px wide. */
  async picture(): Promise<string | null> {
    const c = this.sim.renderer.domElement;
    const w = Math.min(1920, Math.max(640, c.width));
    const h = Math.round((w * Math.max(1, c.height)) / Math.max(1, c.width));
    try {
      return await this.sim.renderer.screenshot({ width: w, height: h, mime: 'image/jpeg' });
    } catch {
      return null;
    }
  }

  // --- frame loop ---------------------------------------------------------------------------------------------------

  private loop(): void {
    if (this.raf !== null || this.disposed) return;
    this.last = performance.now();
    const tick = (now: number): void => {
      this.raf = null;
      if (this.disposed) return;
      const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.step(dt);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private step(dt: number): void {
    if (this.state.fading) return;
    if (this.hold !== null) {
      this.hold -= dt;
      if (this.hold <= 0) {
        const action = this.holdAction;
        this.hold = null;
        this.holdAction = null;
        if (action === 'drone') this.droneTour();
        else if (action === 'next' && this.state.stops.length <= 1) {
          // The tour's stops are still being searched: wait for them (any input of the visitor cancels).
          this.hold = 1;
          this.holdAction = 'next';
        } else if (action === 'next') {
          if (!this.state.autoplay) this.set({ autoplay: true });
          this.goTo(this.state.index + 1, true);
        }
      }
    }
    if (this.state.view !== 'walk' || !this.pose) return;
    const r = this.sim.renderer;
    const g = this.glide;
    if (g) {
      g.t = Math.min(1, g.t + dt / g.seconds);
      const k = easeInOutCubic(g.t);
      const eye: Vec3 = [g.from.eye[0] + (g.to.eye[0] - g.from.eye[0]) * k, g.from.eye[1] + (g.to.eye[1] - g.from.eye[1]) * k, g.from.eye[2] + (g.to.eye[2] - g.from.eye[2]) * k];
      const yaw = g.from.yaw + turn(g.from.yaw, g.to.yaw) * k;
      const pitch = g.from.pitch + (g.to.pitch - g.from.pitch) * k;
      this.pose = { eye, yaw, pitch };
      r.setCameraPose(eye[0], eye[1], eye[2], yaw, pitch);
      this.sim.touch();
      if (g.t >= 1) {
        this.glide = null;
        g.then?.();
      }
      return;
    }
    if (this.keys.size === 0) return;
    const k = this.keys;
    const forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const right = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    // The arrows left and right turn (as in a walkthrough viewer); A and D step sideways.
    const spin = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
    const p = this.pose;
    if (spin !== 0) p.yaw += spin * 1.6 * dt;
    if (forward !== 0 || right !== 0) {
      const next = walkStep(p.eye, p.yaw, { forward, right }, dt, this.probe);
      // Steps and stairs: the eye settles to its new height instead of jumping.
      next[1] = p.eye[1] + (next[1] - p.eye[1]) * Math.min(1, dt * 12);
      p.eye = next;
    }
    r.setCameraPose(p.eye[0], p.eye[1], p.eye[2], p.yaw, p.pitch);
    this.sim.touch();
  }

  /** Where the walk stands (feet) and faces, for Play to start there; null outside a walk. */
  get standing(): { feet: Vec3; yawDeg: number } | null {
    if (this.state.view !== 'walk' || !this.pose) return null;
    return { feet: [this.pose.eye[0], this.pose.eye[1] - WALK_EYE, this.pose.eye[2]], yawDeg: (this.pose.yaw * 180) / Math.PI };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    const r = this.sim.renderer;
    const canvas = r.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    canvas.removeEventListener('wheel', this.onUserInput);
    this.sim.setClickHandler(null);
    r.stopTour();
    if (this.state.view === 'dollhouse' || this.state.view === 'plan') r.setArchView({ walls: 'up' });
    this.useLens(false);
  }
}
