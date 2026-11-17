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
import { FADE_DISTANCE, forwardOf, glideDestination, glideSeconds, needsFade, STEP_DOWN, turn, WALK_EYE, walkStep, yawPitch, type WalkProbe } from './walk';

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
/** Lens (degrees) of an orbit view sent in front of a product ({@link ExploreController.lookAt}): the whole piece in frame. */
const PRODUCT_LENS = 62;
/** Half of a fade (ms). */
const FADE_MS = 280;
/** Drag look speed (radians per pixel). */
const LOOK_RATE = 0.0042;
/** Below this height above the ground (m) an orbit or drone view is at street level: a drag turns the view in place. */
const STREET_LEVEL = 4;

/**
 * Window event a click on the world sends in explore mode (walk, orbit, drone) with the entity hit (`detail: { id }`),
 * before the walk view glides there. A listener that calls `preventDefault()` consumes the click.
 */
export const PICK_EVENT = 'aether:pick-entity';

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

/** Where a following view wants to be now ({@link ExploreController.follow}); filled in place each frame. */
export interface FollowAim {
  eye: Vec3;
  look: Vec3;
  /** The pose to end on: reaching it ends the follow. */
  final: boolean;
  /**
   * What the view keeps a clear line to (the guide's head; null: nothing, the eye stays where it is). The eye is pulled
   * toward it until nothing stands between them, at eye height over a walkable floor ({@link safeFollowEye}).
   */
  subject: Vec3 | null;
  /**
   * Feet of someone the eye keeps clear of (the guide: null, nobody), at least {@link FOLLOW_CLEAR_M} away in plan. An eye
   * gliding through her, or her walking through a view that waits, put the camera inside her head: her hair and jacket
   * filled the view, black.
   */
  avoid: Vec3 | null;
}

/** What {@link safeFollowEye} asks of the scene: free distance along a ray (the subject skipped) and the floor under a point. */
export interface FollowProbe {
  free(from: Readonly<Vec3>, dir: Readonly<Vec3>, max: number): number;
  floor(x: number, z: number, fromY: number): number | null;
}

/** A following eye stays this far (m) short of a wall between it and its subject. */
export const FOLLOW_WALL_M = 0.35;
/** Nearest (m) a following eye comes to its subject's head: closer, it has no room there. */
export const FOLLOW_MIN_M = 0.9;
/** Nearest (m, in plan) a following eye comes to the person it keeps clear of ({@link FollowAim.avoid}). */
export const FOLLOW_CLEAR_M = 1;
/** Most a following eye's floor may differ (m) from the floor it is meant to stand on (a step, a rug; not a table top). */
const FOLLOW_FLOOR_M = 0.35;

const finite3 = (v: Readonly<Vec3>): boolean => Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);

/**
 * Where a following eye may stand, wanting `want`: pulled toward `subject` until the line between them is clear (a ray
 * from the subject meets the front face of a wall between them, or of the wall or shell the eye would be inside or
 * behind: rays from inside a wall leave it unseen), then put at eye height over the walkable floor there. Writes `out`
 * and returns the distance from the subject it allows (Infinity: the line is clear). Returns -1 when there is no such
 * spot (the subject is right against the wall, there is no floor, or the floor is not the one meant: a table, a hole):
 * the caller holds the view or glides instead. No allocation.
 */
export function safeFollowEye(want: Readonly<Vec3>, subject: Readonly<Vec3>, probe: FollowProbe, out: Vec3): number {
  if (!finite3(want) || !finite3(subject)) return -1;
  const dx = want[0] - subject[0];
  const dy = want[1] - subject[1];
  const dz = want[2] - subject[2];
  const d = Math.hypot(dx, dy, dz);
  let reach = Number.POSITIVE_INFINITY;
  out[0] = want[0];
  out[1] = want[1];
  out[2] = want[2];
  if (d > 1e-3) {
    _fd[0] = dx / d;
    _fd[1] = dy / d;
    _fd[2] = dz / d;
    const free = probe.free(subject, _fd, d);
    if (free < d - 0.05) {
      reach = free - FOLLOW_WALL_M;
      if (reach < FOLLOW_MIN_M) return -1;
      out[0] = subject[0] + _fd[0] * reach;
      out[1] = subject[1] + _fd[1] * reach;
      out[2] = subject[2] + _fd[2] * reach;
    }
  }
  // The floor meant: the one under the eye it wanted.
  const meant = want[1] - WALK_EYE;
  const f = probe.floor(out[0], out[2], Math.max(out[1], want[1]) + 0.3);
  if (f === null || !Number.isFinite(f) || Math.abs(f - meant) > FOLLOW_FLOOR_M) return -1;
  out[1] = f + WALK_EYE;
  return reach;
}
const _fd: Vec3 = [0, 0, 0];

const _sd: [number, number] = [0, 0];

/**
 * One axis of a critically damped spring (Unity's SmoothDamp): `x` moving with velocity `v` toward `to`, arriving in about
 * `smooth` seconds without overshoot. Returns the new position and velocity in `out` (by default one shared pair: read
 * it before the next call; nothing is allocated per frame).
 */
export function smoothDamp(x: number, v: number, to: number, smooth: number, dt: number, out: [number, number] = _sd): [number, number] {
  const w = 2 / Math.max(1e-3, smooth);
  const k = w * dt;
  const e = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
  const c = x - to;
  const t = (v + w * c) * dt;
  out[0] = to + (c + t) * e;
  out[1] = (v - w * t) * e;
  return out;
}

/** Seconds the follow's eye and look lag behind their aim (the end pose: a slower ease round). */
const FOLLOW_EYE_S = 0.55;
const FOLLOW_LOOK_S = 0.5;
const FOLLOW_FINAL_S = 0.85;
/** Seconds between the follow's checks of its eye against the scene ({@link safeFollowEye}). */
const FOLLOW_SAFE_S = 0.15;
/**
 * A follow crosses a wall by a fade at most once in this many seconds: needing another so soon, it gives up and glides to
 * where it is going instead (a fade every quarter second, as an aim kept behind a wall asked for, is a black view).
 */
export const FOLLOW_REFADE_S = 3;
/** Longest (ms) a fade may cover the view, whatever happens to its swap. */
export const FADE_MAX_MS = 1600;

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
  /** The view following a moving subject (see {@link follow}): its eye and look point, each with a velocity. */
  private fol: {
    aim: (out: FollowAim) => boolean;
    done?: () => void;
    skip?: ReadonlySet<string>;
    /** Where to glide when the follow cannot go on (the end pose). */
    fallback?: { eye: Vec3; look: Vec3 };
    out: FollowAim;
    eye: Vec3;
    ev: Vec3;
    look: Vec3;
    lv: Vec3;
    dir: Vec3;
    check: number;
    final: number;
    arrived: boolean;
    /** Seconds since the follow began, and when it last faded. */
    clock: number;
    fadedAt: number;
    /** The safety check: seconds to the next, the distance from the subject it allows (-1: no spot, hold), the floor. */
    safeIn: number;
    reach: number;
    floorY: number | null;
    safe: Vec3;
  } | null = null;
  private fadeSeq = 0;
  /** The scene as a following eye sees it (rays skip the follow's subject). */
  private readonly followProbe: FollowProbe & { skip: ReadonlySet<string> | undefined } = {
    skip: undefined,
    free: (from, dir, max) => {
      const hit = this.sim.renderer.raycastWorld([from[0], from[1], from[2]], [dir[0], dir[1], dir[2]], max, this.followProbe.skip);
      return hit ? Math.hypot(hit.point[0] - from[0], hit.point[1] - from[1], hit.point[2] - from[2]) : max;
    },
    floor: (x, z, fromY) => this.probe.floor(x, z, fromY),
  };
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
    window.addEventListener('pointerdown', this.onLookDown, { capture: true });
    window.addEventListener('pointermove', this.onLookMove);
    window.addEventListener('pointerup', this.onLookUp);
    window.addEventListener('pointercancel', this.onLookUp);
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
    const was = this.state.stops[0];
    this.set({ stops, index: keep });
    this.indexRooms();
    // A building's hero view is chosen again once the scene has finished building (its windows, its garden's grass): a
    // walk still holding the first picture moves to the new one.
    const now = stops[0];
    if (this.exp.explore === 'walk' && keep === 0 && this.holdAction === 'next' && was && now && Math.hypot(now.position[0] - was.position[0], now.position[1] - was.position[1], now.position[2] - was.position[2]) > 1) {
      const p = this.stopPose(0);
      if (p) this.moveWalk(p);
    }
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
      const w = this.sim.syncedWorld;
      if (entry && this.exp.guided && w?.player) {
        // A guided showroom opens where a visitor walks in, facing the guide; its tour waits for the visitor.
        const sp = w.player.spawn;
        const eye: Vec3 = [sp[0], sp[1] + WALK_EYE, sp[2]];
        // Facing the guide (its head), else the start's own heading.
        const g = w.guide?.position;
        const face = g ? yawPitch(eye, [g[0], g[1] + 1.45, g[2]]) : null;
        this.placeWalk({ eye, yaw: face ? face.yaw : ((w.player.yaw ?? 0) * Math.PI) / 180, pitch: face ? Math.max(-0.15, Math.min(0.05, face.pitch)) : -0.08 });
        this.loop();
        return;
      }
      if (from) this.placeWalk({ eye: [from.feet[0], from.feet[1] + WALK_EYE, from.feet[2]], yaw: from.yaw, pitch: -0.08 });
      else if (entry && hero) this.placeStop(0);
      else this.placeFromCamera();
      // The tour starts from the hero view (its stops may still be coming: see setStops).
      if (entry) this.schedule(HERO_HOLD_S, 'next', true);
    } else if (entry && this.exp.kind === 'arch') {
      // Architecture opens on the whole building from an elevated three-quarter view (its eye-level arrival is the
      // first viewpoint, one Space away), not up against a wall.
      r.setCameraMode('orbit');
      this.set({ index: -1, view: 'orbit' });
      // A small interior (one building, a flat or a room or two) opens cut away, so its rooms are what you see first.
      if (this.exp.dollhouse && smallInterior(this.sim.syncedWorld ?? { entities: {} })) this.toggleDollhouse();
      else void this.sim.frameWorld({ flyIn: !this.opts.reduceMotion, buildingsOnly: true });
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
    const seq = ++this.fadeSeq;
    this.set({ fading: true });
    const clear = (): void => {
      // A newer fade owns the cover now: it clears it itself.
      if (seq === this.fadeSeq && this.state.fading) this.set({ fading: false });
    };
    this.later(FADE_MS, () => {
      try {
        swap();
      } finally {
        // Whatever the swap does, the view comes back.
        this.later(60, clear);
      }
    });
    // And never later than this, whatever happens to the timers above.
    this.later(FADE_MAX_MS, clear);
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
    const ray = r.cursorRay(ndcX, ndcY);
    const hit = r.raycastWorld(ray.origin, ray.direction, 80);
    // An object a module claims (a product card, `products/`) takes the click before the glide: it cancels the event.
    if (hit && !window.dispatchEvent(new CustomEvent(PICK_EVENT, { detail: { id: hit.id }, cancelable: true }))) return true;
    if (this.state.view !== 'walk' || !this.pose) return false;
    if (!hit) return true;
    const dest = glideDestination(this.pose.eye, hit, this.probe);
    if (!dest) return true;
    this.moveWalk({ eye: dest, yaw: this.pose.yaw, pitch: this.pose.pitch });
    return true;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.onUserInput();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.state.view === 'walk') {
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    }
  };

  /**
   * Orbit and drone views standing at street level (a city's hero view, a viewpoint at eye height): a left drag turns the
   * view where it stands instead of swinging the camera round a point far down the street, through the houses beside it.
   * Runs in the capture phase so the orbit controls never start their own rotation for this drag.
   */
  private readonly onLookDown = (e: PointerEvent): void => {
    if (e.target !== this.sim.renderer.domElement || (e.pointerType === 'mouse' && e.button !== 0) || !e.isPrimary) return;
    if (this.state.view !== 'orbit' && this.state.view !== 'drone') return;
    const r = this.sim.renderer;
    if (r.cameraHeightAboveGround() > STREET_LEVEL) {
      r.endLookAround();
      return;
    }
    r.setLeftDragNavigation(false);
    this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };

  private readonly onLookMove = (e: PointerEvent): void => {
    const l = this.look;
    if (!l || e.pointerId !== l.id) return;
    const dx = e.clientX - l.x;
    const dy = e.clientY - l.y;
    l.x = e.clientX;
    l.y = e.clientY;
    // Grab the view, as in the walk: dragging right turns left.
    this.sim.renderer.lookAround(dx * LOOK_RATE, dy * LOOK_RATE);
    this.sim.touch();
  };

  private readonly onLookUp = (e: PointerEvent): void => {
    if (!this.look || e.pointerId !== this.look.id) return;
    this.look = null;
    this.sim.renderer.setLeftDragNavigation(true);
  };

  /** A street-level look-around drag in an orbit or drone view. */
  private look: { id: number; x: number; y: number } | null = null;

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
    this.fol = null;
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
    this.fol = null;
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

  /**
   * Stand with the eye at `from` looking at `target` (the showroom guide shows a product, `guide/`): the walk glides there,
   * the orbit camera flies there. Stops autoplay. `minSeconds`: move at least this long; `then`: on arrival.
   */
  lookAt(target: Vec3, from: Vec3, minSeconds = 0, then?: () => void): boolean {
    if (this.disposed) return false;
    this.onUserInput();
    const r = this.sim.renderer;
    r.stopTour();
    const { yaw, pitch } = yawPitch(from, target);
    const to: WalkPose = { eye: [from[0], from[1], from[2]], yaw, pitch };
    const cut = this.state.view === 'dollhouse' || this.state.view === 'plan';
    this.set({ index: -1 });
    if (this.state.view === 'walk' && this.pose) this.moveWalk(to, minSeconds, then);
    else if (cut && this.exp.explore === 'walk')
      this.fadeTo(() => {
        r.setArchView({ walls: 'up' });
        this.set({ view: 'walk' });
        this.placeWalk(to);
        // After the swap: a failing callback must not leave the fade on.
        if (then) setTimeout(then, 0);
      });
    else {
      // Orbit and drone views (architecture explores in orbit): the camera flies there, or fades there across walls and
      // long distances as the walk does (the orbit rig's flight would pass through roofs).
      const p = r.camera.position;
      const at: Vec3 = [p.x, p.y, p.z];
      const d = Math.hypot(from[0] - at[0], from[1] - at[1], from[2] - at[2]);
      this.set({ view: this.exp.explore === 'drone' ? 'drone' : 'orbit' });
      if (cut || this.opts.reduceMotion || d > FADE_DISTANCE || (d > 0.05 && this.probe.free(at, [(from[0] - at[0]) / d, (from[1] - at[1]) / d, (from[2] - at[2]) / d], d) < d - 0.25))
        this.fadeTo(() => {
          if (cut) r.setArchView({ walls: 'up' });
          r.flyToPose(from, target, 0, PRODUCT_LENS);
          if (then) setTimeout(then, 0);
        });
      else {
        const seconds = Math.max(minSeconds, 1.8, Math.min(5, d / 14));
        r.flyToPose(from, target, seconds, PRODUCT_LENS);
        this.later(seconds * 1000 + 50, () => then?.());
      }
    }
    return true;
  }

  /**
   * Follow a moving subject at eye level (the showroom guide walking its tour): each frame `aim()` says where the eye wants
   * to be and what it looks at (filling `out` in place), and the view eases after it (a critically damped spring on the eye and on the look point,
   * so turns and stops never snap). A wall (or more than {@link FADE_DISTANCE}) between the view and its aim is crossed by
   * a fade. An aim marked `final` is arrived at once nearly reached (`done` runs, the view still easing the last
   * centimetres) and ends the follow when reached; `aim()` returning false ends it without.
   * Nothing is allocated per frame; the wall check's ray runs a few times a second.
   * Any input of the visitor (or another move) ends it too. `skip`: entities the wall check looks through (the subject).
   * The eye never goes where it would lose its subject ({@link FollowAim.subject}: pulled toward it until the line between
   * them is clear, at eye height over the floor; held where it is when there is no such spot). A wall to cross a second
   * time within {@link FOLLOW_REFADE_S} ends the follow with a glide to `fallback` (the end pose) instead of another fade.
   * Walk view only, never with reduced motion: false when it cannot follow (the caller moves the view another way).
   */
  follow(aim: (out: FollowAim) => boolean, done?: () => void, skip?: ReadonlySet<string>, fallback?: { eye: Vec3; look: Vec3 }): boolean {
    if (this.disposed || this.opts.reduceMotion || this.state.view !== 'walk' || !this.pose || this.state.fading) return false;
    this.onUserInput();
    this.sim.renderer.stopTour();
    this.glide = null;
    this.set({ index: -1 });
    const p = this.pose;
    const [fx, fz] = forwardOf(p.yaw);
    const c = Math.cos(p.pitch) * 3;
    this.fol = {
      aim,
      ...(done ? { done } : {}),
      ...(skip ? { skip } : {}),
      ...(fallback ? { fallback } : {}),
      out: { eye: [0, 0, 0], look: [0, 0, 0], final: false, subject: null, avoid: null },
      eye: [...p.eye] as Vec3,
      ev: [0, 0, 0],
      look: [p.eye[0] + fx * c, p.eye[1] + Math.sin(p.pitch) * 3, p.eye[2] + fz * c],
      lv: [0, 0, 0],
      dir: [0, 0, 0],
      check: 0,
      final: 0,
      arrived: false,
      clock: 0,
      fadedAt: Number.NEGATIVE_INFINITY,
      safeIn: 0,
      reach: Number.POSITIVE_INFINITY,
      floorY: null,
      safe: [0, 0, 0],
    };
    return true;
  }

  /** A follow is running. */
  get following(): boolean {
    return this.fol !== null;
  }

  /** Stop following (the view stays where it is). */
  unfollow(): void {
    this.fol = null;
  }

  /** One frame of {@link follow} (no allocation). */
  private stepFollow(dt: number): void {
    const f = this.fol;
    if (!f) return;
    const a = f.out;
    a.subject = null;
    a.avoid = null;
    if (!f.aim(a)) {
      this.fol = null;
      return;
    }
    f.clock += dt;
    // A broken aim (a NaN from the scene) is not followed: the view holds this frame.
    if (!finite3(a.eye) || !finite3(a.look)) return;
    this.keepSafe(f, a, dt);
    const r = this.sim.renderer;
    // A wall between the view and where it wants to be, checked a few times a second: fade across instead of through.
    f.check -= dt;
    const gap = Math.hypot(a.eye[0] - f.eye[0], a.eye[1] - f.eye[1], a.eye[2] - f.eye[2]);
    if (f.check <= 0 && gap > 0.6) {
      f.check = 0.25;
      let blocked = gap > FADE_DISTANCE;
      if (!blocked) {
        for (let i = 0; i < 3; i++) f.dir[i] = ((a.eye[i] as number) - (f.eye[i] as number)) / gap;
        const hit = r.raycastWorld(f.eye, f.dir, gap, f.skip);
        blocked = !!hit && Math.hypot(hit.point[0] - f.eye[0], hit.point[1] - f.eye[1], hit.point[2] - f.eye[2]) < gap - 0.25;
      }
      if (blocked) {
        // A second wall so soon: no fade after fade (a black view). The follow ends in a glide.
        if (f.clock - f.fadedAt < FOLLOW_REFADE_S) {
          this.abandonFollow(f);
          return;
        }
        f.fadedAt = f.clock;
        this.fadeTo(() => {
          if (this.fol !== f) return;
          a.subject = null;
          a.avoid = null;
          if (!f.aim(a) || !finite3(a.eye) || !finite3(a.look)) return;
          f.safeIn = 0;
          this.keepSafe(f, a, 0);
          for (let i = 0; i < 3; i++) {
            f.eye[i] = a.eye[i] as number;
            f.look[i] = a.look[i] as number;
            f.ev[i] = 0;
            f.lv[i] = 0;
          }
          this.applyFollow(f);
        });
        return;
      }
    }
    const se = a.final ? FOLLOW_FINAL_S : FOLLOW_EYE_S;
    const sl = a.final ? FOLLOW_FINAL_S : FOLLOW_LOOK_S;
    for (let i = 0; i < 3; i++) {
      const e = smoothDamp(f.eye[i] as number, f.ev[i] as number, a.eye[i] as number, se, dt);
      f.eye[i] = e[0];
      f.ev[i] = e[1];
      const l = smoothDamp(f.look[i] as number, f.lv[i] as number, a.look[i] as number, sl, dt);
      f.look[i] = l[0];
      f.lv[i] = l[1];
    }
    if (!finite3(f.eye) || !finite3(f.look)) {
      // The spring broke (a NaN came in): start it again where the view stands.
      const p = this.pose;
      if (!p || !finite3(p.eye)) {
        this.fol = null;
        return;
      }
      for (let i = 0; i < 3; i++) {
        f.eye[i] = p.eye[i] as number;
        f.look[i] = a.look[i] as number;
        f.ev[i] = 0;
        f.lv[i] = 0;
      }
    }
    if (a.avoid && finite3(a.avoid)) this.keepClear(f, a.avoid);
    this.applyFollow(f);
    if (!a.final) {
      f.final = 0;
      return;
    }
    f.final += dt;
    const de = Math.hypot(a.eye[0] - f.eye[0], a.eye[1] - f.eye[1], a.eye[2] - f.eye[2]);
    const dl = Math.hypot(a.look[0] - f.look[0], a.look[1] - f.look[1], a.look[2] - f.look[2]);
    // Nearly framed: the stop begins (its line, its card) while the view settles.
    if (!f.arrived && ((de < 0.25 && dl < 0.35) || f.final > 3.5)) {
      f.arrived = true;
      f.done?.();
      if (this.fol !== f) return;
    }
    if ((de < 0.02 && dl < 0.03) || f.final > 8) {
      for (let i = 0; i < 3; i++) {
        f.eye[i] = a.eye[i] as number;
        f.look[i] = a.look[i] as number;
      }
      this.applyFollow(f);
      this.fol = null;
    }
  }

  /**
   * Keep the aim's eye where the view can stand ({@link safeFollowEye}): checked against the scene every
   * {@link FOLLOW_SAFE_S} seconds, the reach and floor it found applied to the aim every frame in between (no allocation).
   * Where there is no safe spot the eye holds where it is.
   */
  private keepSafe(f: NonNullable<ExploreController['fol']>, a: FollowAim, dt: number): void {
    const s = a.subject;
    if (!s || !finite3(s)) {
      f.reach = Number.POSITIVE_INFINITY;
      f.floorY = null;
      return;
    }
    f.safeIn -= dt;
    if (f.safeIn <= 0) {
      f.safeIn = FOLLOW_SAFE_S;
      this.followProbe.skip = f.skip;
      f.reach = safeFollowEye(a.eye, s, this.followProbe, f.safe);
      f.floorY = f.reach < 0 ? null : f.safe[1] - WALK_EYE;
    }
    if (f.reach < 0) {
      // No spot in reach: hold the view where it is (still turning to look).
      a.eye[0] = f.eye[0];
      a.eye[1] = f.eye[1];
      a.eye[2] = f.eye[2];
      return;
    }
    const dx = a.eye[0] - s[0];
    const dy = a.eye[1] - s[1];
    const dz = a.eye[2] - s[2];
    const d = Math.hypot(dx, dy, dz);
    if (d > f.reach && d > 1e-3) {
      const k = f.reach / d;
      a.eye[0] = s[0] + dx * k;
      a.eye[1] = s[1] + dy * k;
      a.eye[2] = s[2] + dz * k;
    }
    if (f.floorY !== null) a.eye[1] = f.floorY + WALK_EYE;
  }

  /**
   * Keep the eased eye {@link FOLLOW_CLEAR_M} clear of `feet` in plan: an eye closer than that steps out of the way (as far
   * as the room allows: a ray from her at eye height), its inward speed dropped, so it slides round her instead of
   * through her. No allocation.
   */
  private keepClear(f: NonNullable<ExploreController['fol']>, feet: Readonly<Vec3>): void {
    let ux = f.eye[0] - feet[0];
    let uz = f.eye[2] - feet[2];
    const d = Math.hypot(ux, uz);
    if (d >= FOLLOW_CLEAR_M) return;
    if (d > 1e-3) {
      ux /= d;
      uz /= d;
    } else {
      // Right on her: back away from what the view looks at.
      const lx = f.eye[0] - f.look[0];
      const lz = f.eye[2] - f.look[2];
      const l = Math.hypot(lx, lz) || 1;
      ux = lx / l;
      uz = lz / l;
    }
    const from = this._clearFrom;
    from[0] = feet[0];
    from[1] = f.eye[1];
    from[2] = feet[2];
    const dir = this._clearDir;
    dir[0] = ux;
    dir[1] = 0;
    dir[2] = uz;
    this.followProbe.skip = f.skip;
    const room = this.followProbe.free(from, dir, FOLLOW_CLEAR_M + FOLLOW_WALL_M) - FOLLOW_WALL_M;
    const to = Math.min(FOLLOW_CLEAR_M, room);
    if (!(to > d)) return;
    f.eye[0] = feet[0] + ux * to;
    f.eye[2] = feet[2] + uz * to;
    // No speed toward her.
    const inward = f.ev[0] * ux + f.ev[2] * uz;
    if (inward < 0) {
      f.ev[0] -= inward * ux;
      f.ev[2] -= inward * uz;
    }
  }
  private readonly _clearFrom: Vec3 = [0, 0, 0];
  private readonly _clearDir: Vec3 = [0, 0, 0];

  /** The follow cannot go on (walls one after another): end it with a glide (or one fade) to its end pose, and arrive. */
  private abandonFollow(f: NonNullable<ExploreController['fol']>): void {
    this.fol = null;
    const arrive = (): void => {
      if (f.arrived) return;
      f.arrived = true;
      f.done?.();
    };
    const to = f.fallback;
    if (!to || !finite3(to.eye) || !finite3(to.look)) {
      arrive();
      return;
    }
    const { yaw, pitch } = yawPitch(to.eye, to.look);
    this.moveWalk({ eye: [to.eye[0], to.eye[1], to.eye[2]], yaw, pitch }, 1.2, arrive);
  }

  /** Put the walk's pose (updated in place) and the camera where the follow is. */
  private applyFollow(f: { eye: Vec3; look: Vec3 }): void {
    const p = this.pose;
    if (!p) return;
    // A look point (eased on its own) passing close by the eye would swing the view: hold the direction until it is clear.
    const dx = f.look[0] - f.eye[0];
    const dz = f.look[2] - f.eye[2];
    const flat = Math.hypot(dx, dz);
    if (flat >= 0.6) {
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.max(-1.2, Math.min(1, Math.atan2(f.look[1] - f.eye[1], flat)));
    }
    p.eye[0] = f.eye[0];
    p.eye[1] = f.eye[1];
    p.eye[2] = f.eye[2];
    this.sim.renderer.setCameraPose(p.eye[0], p.eye[1], p.eye[2], p.yaw, p.pitch);
    this.sim.touch();
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
        if (this.exp.explore !== 'walk') {
          // An orbit or drone world: back to its own camera around the whole building.
          this.set({ view: this.exp.explore });
          void this.sim.frameWorld();
          return;
        }
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
    void this.sim.frameWorld({ buildingsOnly: true });
  }

  /** Floor plan (walls down, straight down) on or off, from the dollhouse. */
  setPlan(on: boolean): void {
    if (!this.exp.dollhouse) return;
    if (this.state.view === 'walk') this.toggleDollhouse();
    const r = this.sim.renderer;
    r.setArchView({ walls: on ? 'down' : 'cutaway' });
    if (on) this.sim.viewPreset('top');
    else void this.sim.frameWorld({ buildingsOnly: true });
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

  /** The quality ladder is held while the view moves on its own (see {@link holdWhileMoving}). */
  private holding = false;

  /**
   * A glide or a follow holds the quality ladder still (Simulation.setQualityHold): a ladder step rebuilds every lit
   * material, and a view moving meanwhile showed partial pictures (the sky alone, a white wash in the lobby) for seconds.
   * The ladder steps once the view rests at a stop.
   */
  private holdWhileMoving(on: boolean): void {
    if (on === this.holding) return;
    this.holding = on;
    (this.sim as { setQualityHold?: (reason: string, on: boolean) => void }).setQualityHold?.('explore-move', on);
  }

  private step(dt: number): void {
    this.holdWhileMoving(!this.disposed && (this.glide !== null || this.fol !== null || this.state.fading));
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
    if (this.fol) {
      this.stepFollow(dt);
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
    this.holdWhileMoving(false);
    this.disposed = true;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    const r = this.sim.renderer;
    const canvas = r.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerdown', this.onLookDown, { capture: true });
    window.removeEventListener('pointermove', this.onLookMove);
    window.removeEventListener('pointerup', this.onLookUp);
    window.removeEventListener('pointercancel', this.onLookUp);
    if (this.look) r.setLeftDragNavigation(true);
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

/** Total room area (m²) under which a single-building world opens as a dollhouse. */
const SMALL_INTERIOR_M2 = 110;

/** One building whose rooms add up to less than {@link SMALL_INTERIOR_M2}: an apartment, a room or two. */
export function smallInterior(world: { entities: Record<string, { arch?: unknown }> }): boolean {
  let buildings = 0;
  let area = 0;
  for (const e of Object.values(world.entities)) {
    const plan = (e.arch as { plan?: { levels?: { rooms?: { rect?: readonly number[] }[] }[] } } | undefined)?.plan;
    if (!plan) continue;
    buildings++;
    for (const level of plan.levels ?? []) for (const room of level.rooms ?? []) {
      const r = room.rect;
      if (r && r.length === 4) area += Math.abs((r[2]! - r[0]!) * (r[3]! - r[1]!));
    }
  }
  return buildings === 1 && area > 0 && area < SMALL_INTERIOR_M2;
}
