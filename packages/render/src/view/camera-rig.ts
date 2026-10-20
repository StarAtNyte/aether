/**
 * Camera behaviors: orbit (OrbitControls with damping), follow (smooth
 * third-person chase that moves in front of obstacles), first-person, and an
 * eased fly-to used by `focus`.
 * Everything per-frame uses module scratch objects (no allocations).
 */
import { Euler, PerspectiveCamera, Vector3 } from 'three';
import type { CameraMode } from '../types';
import type { CameraTour } from './tour';

/** The subset of OrbitControls the rig needs (lets tests use a fake). */
export interface OrbitControlsLike {
  enabled: boolean;
  enableDamping: boolean;
  dampingFactor: number;
  readonly target: Vector3;
  /** Mouse button → action map (three's OrbitControls); a missing action disables that button. */
  mouseButtons?: { LEFT?: number | null; MIDDLE?: number | null; RIGHT?: number | null };
  /** Touch gesture → action map (three's OrbitControls). */
  touches?: { ONE?: number | null; TWO?: number | null };
  update(deltaTime?: number | null): boolean;
  dispose(): void;
}

/**
 * Writes the followed target's world position into `out` and returns its yaw
 * in radians (0 faces −Z), or NaN when the target is unavailable.
 */
export type FollowSource = (out: Vector3) => number;

/** Cubic ease-in-out on [0, 1]. */
export function easeInOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Frame-rate independent smoothing factor for an exponential approach at `rate` per second. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * Math.max(0, dt));
}

/**
 * Distance (m) from `from` toward `to` that is free of solid geometry, or
 * `Infinity` when nothing blocks the segment. Used to keep the chase camera
 * in front of obstacles.
 */
export type OcclusionQuery = (from: Vector3, to: Vector3) => number;

/**
 * {@link OcclusionQuery} that writes the free distance to `out[0]` instead of returning it: a double returned from
 * a call that is not inlined is boxed, and the chase camera asks ten of these per frame. The renderer uses this form.
 */
export type OcclusionSink = (from: Vector3, to: Vector3, out: Float64Array) => void;

/** Lowest view elevation {@link CameraRig.focusOn} keeps (20°). */
export const MIN_FOCUS_ELEVATION = 20;
const MIN_FOCUS_SIN = Math.sin((MIN_FOCUS_ELEVATION * Math.PI) / 180);
const MIN_FOCUS_COS = Math.cos((MIN_FOCUS_ELEVATION * Math.PI) / 180);

const FOLLOW_DISTANCE = 5.5;
/** Closest the chase camera gets to its target when pulled in by an obstacle (m). */
export const MIN_FOLLOW_DISTANCE = 1.2;
/** Gap kept between the pulled-in chase camera and the obstacle surface (m). */
const OCCLUSION_PADDING = 0.35;
const FOLLOW_HEIGHT = 2.4;
const LOOK_HEIGHT = 1.3;
const EYE_HEIGHT = 1.6;

/** Half-width of the chase camera's "lens" (m): the boom is probed with a ring of rays this far off its axis, so a wall beside the boom pulls the camera in before the near plane can cut into it. */
export const BOOM_RADIUS = 0.3;
/** Share of a first-person vertical jump (a stair step, a kerb) smoothed over a few frames; bigger drops and jumps pass through at once. */
export const STEP_SMOOTH_MAX = 0.65;
const _target = new Vector3();
const _side = new Vector3();
const _up = new Vector3();
const _from = new Vector3();
const _to = new Vector3();
const _boom = new Vector3();
const _lookAt = new Vector3();
const _dir = new Vector3();
const _desired = new Vector3();
const _euler = new Euler(0, 0, 0, 'YXZ');
/** [0]: one occlusion ray's answer; [1]: the boom's free length. */
const _free = new Float64Array(2);

/** One occlusion ray into `_free[0]`, through the sink when there is one. */
function probe(query: OcclusionQuery | null, sink: OcclusionSink | null, from: Vector3, to: Vector3): void {
  if (sink) sink(from, to, _free);
  else _free[0] = query ? query(from, to) : Number.POSITIVE_INFINITY;
}

/**
 * Free length (m) of the boom from `from` toward `to`: the shortest of the centre ray and four rays offset by
 * {@link BOOM_RADIUS} around the boom axis (a thick probe), so a camera beside a wall is pulled in and a corner
 * never slices through the near plane. `Infinity` when nothing blocks. Allocation-free.
 */
export function boomFreeDistance(query: OcclusionQuery, from: Vector3, to: Vector3, radius: number = BOOM_RADIUS): number {
  boomFree(query, null, from, to, radius);
  return _free[1]!;
}

/** {@link boomFreeDistance} with the answer in `_free[1]` (no double crosses a call boundary). */
function boomFree(query: OcclusionQuery | null, sink: OcclusionSink | null, from: Vector3, to: Vector3, radius: number): void {
  _boom.subVectors(to, from);
  const len = _boom.length();
  _free[1] = Number.POSITIVE_INFINITY;
  if (!(len > 1e-4)) return;
  _boom.multiplyScalar(1 / len);
  // An orthonormal frame around the boom (world up unless the boom is vertical).
  _up.set(0, 1, 0);
  if (Math.abs(_boom.y) > 0.98) _up.set(1, 0, 0);
  _side.crossVectors(_boom, _up).normalize();
  _up.crossVectors(_side, _boom).normalize();
  probe(query, sink, from, to);
  _free[1] = _free[0]!;
  for (let i = 0; i < 4; i++) {
    const sx = i < 2 ? (i === 0 ? 1 : -1) : 0;
    const uy = i >= 2 ? (i === 2 ? 1 : -1) : 0;
    _from.copy(from).addScaledVector(_side, sx * radius * 0.6).addScaledVector(_up, uy * radius * 0.6);
    _to.copy(to).addScaledVector(_side, sx * radius).addScaledVector(_up, uy * radius);
    probe(query, sink, _from, _to);
    // The offset ray is slightly longer than the boom: measure along the axis.
    if (_free[0]! < _free[1]!) _free[1] = _free[0]! * (len / Math.max(1e-4, _to.distanceTo(_from)));
  }
}

/** Owns the main perspective camera and its behaviors. */
export class CameraRig {
  mode: CameraMode = 'orbit';
  private follow: FollowSource | null = null;
  private readonly look = new Vector3(0, 1, 0);
  private readonly fromPos = new Vector3();
  private readonly fromTarget = new Vector3();
  private readonly toPos = new Vector3();
  private readonly toTarget = new Vector3();
  private focusT = 1;
  private focusDuration = 0.9;
  /** First-person pitch in radians (clamped ±85°). */
  pitch = 0;
  /** Eye height above the player's feet in first person (lowered while sitting). */
  eyeHeight = EYE_HEIGHT;
  /**
   * Lowest camera height in orbit mode (ground + clearance), or -Infinity
   * when the world has no ground. Keeps orbiting and fly-tos above ground.
   */
  floorY = Number.NEGATIVE_INFINITY;
  /** Last first-person eye height (null until the first frame in that mode). */
  private stepY: number | null = null;
  /** Optional obstacle query for the chase camera (see {@link OcclusionQuery}). */
  occlusion: OcclusionQuery | null = null;
  /** Allocation-free form of {@link occlusion}; used instead of it when set. */
  occlusionSink: OcclusionSink | null = null;

  constructor(
    readonly camera: PerspectiveCamera,
    readonly controls: OrbitControlsLike | null,
  ) {
    if (controls) {
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      this.look.copy(controls.target);
    }
  }

  /** Running fly-through (see {@link startTour}). */
  private tour: CameraTour | null = null;

  /** True while a fly-to animation runs. */
  get focusing(): boolean {
    return this.focusT < 1;
  }

  /** True while a fly-through plays. */
  get touring(): boolean {
    return this.tour !== null && this.tour.active;
  }

  /** Play a fly-through (orbit mode); user input or any camera command stops it. */
  startTour(tour: CameraTour): void {
    if (this.mode !== 'orbit') this.setMode('orbit', null);
    this.focusT = 1;
    this.tour = tour;
  }

  /** Stop a running fly-through where it is (orbiting continues around its current target). */
  stopTour(): void {
    if (!this.tour) return;
    this.tour = null;
    if (this.controls) this.controls.target.copy(this.look);
  }

  /** Pending host pose in `manual` mode (set by {@link setPose}). */
  private poseDirty = false;

  /**
   * Manual mode: place the camera at `x, y, z` with a yaw (radians, 0 looks
   * along −Z) and pitch (radians, clamped ±89°). Allocation-free.
   */
  setPose(x: number, y: number, z: number, yaw: number, pitch: number): void {
    if (!Number.isFinite(x + y + z + yaw + pitch)) return;
    this.camera.position.set(x, y, z);
    _euler.set(Math.max(-1.553, Math.min(1.553, pitch)), yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(_euler);
    this.look.set(x - Math.sin(yaw) * 4, y + Math.tan(pitch) * 4, z - Math.cos(yaw) * 4);
    this.poseDirty = true;
  }

  /** Switch mode. `source` provides the follow/first-person target. */
  setMode(mode: CameraMode, source: FollowSource | null): void {
    this.tour = null;
    this.mode = mode;
    this.stepY = null;
    this.follow = mode === 'orbit' || mode === 'manual' ? null : source;
    if (this.controls) {
      this.controls.enabled = mode === 'orbit';
      if (mode === 'orbit') this.controls.target.copy(this.look);
    }
    this.focusT = 1;
  }

  /**
   * Smoothly fly to frame a sphere (switches to orbit mode). The current
   * horizontal viewing direction is kept, but the view is lifted to at least
   * {@link MIN_FOCUS_ELEVATION} above the horizon so a camera that sat low
   * (or below a raised target) never ends up looking from under the ground.
   */
  focusOn(center: Vector3, radius: number, duration = 0.9): void {
    const r = Math.max(0.25, Number.isFinite(radius) ? radius : 1);
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const half = Math.min(vHalf, Math.atan(Math.tan(vHalf) * (this.camera.aspect > 0 ? this.camera.aspect : 1)));
    const dist = Math.min(2000, (r / Math.sin(half)) * 1.1);
    // Keep the current viewing direction; avoid a degenerate direction when the camera is at the center.
    _desired.copy(this.camera.position).sub(center);
    if (_desired.lengthSq() < 1e-6) _desired.set(0.6, 0.5, 1);
    _desired.normalize();
    if (_desired.y < MIN_FOCUS_SIN) {
      const horizontal = Math.hypot(_desired.x, _desired.z);
      if (horizontal < 1e-6) _desired.set(0, 0, 1);
      else _desired.set(_desired.x / horizontal, 0, _desired.z / horizontal);
      _desired.multiplyScalar(MIN_FOCUS_COS).setY(MIN_FOCUS_SIN);
    }
    _desired.multiplyScalar(dist).add(center);
    this.flyTo(_desired, center, duration);
  }

  /** Current look-at point (orbit target) written into `out`. */
  getTarget(out: Vector3): Vector3 {
    return out.copy(this.controls ? this.controls.target : this.look);
  }

  /** Fly (or jump when `duration` ≤ 0) to a camera position looking at `target`. Switches to orbit mode. */
  flyTo(position: Vector3, target: Vector3, duration = 0.9): void {
    this.tour = null;
    if (this.mode !== 'orbit') this.setMode('orbit', null);
    this.fromPos.copy(this.camera.position);
    this.fromTarget.copy(this.controls ? this.controls.target : this.look);
    this.toPos.copy(position);
    if (this.toPos.y < this.floorY) this.toPos.y = this.floorY;
    this.toTarget.copy(target);
    const d = Number.isFinite(duration) ? duration : 0;
    this.focusDuration = Math.max(0.01, d);
    this.focusT = d <= 0 ? 1 : 0;
    if (d <= 0) this.place(this.toPos, this.toTarget);
  }

  private place(pos: Vector3, target: Vector3): void {
    this.camera.position.copy(pos);
    this.look.copy(target);
    if (this.controls) this.controls.target.copy(target);
    this.camera.lookAt(target);
  }

  /** Advance the camera one frame. Zero allocations. Returns true when the view may have changed. */
  update(dt: number): boolean {
    if (this.tour) {
      this.tour.io[2] = dt;
      this.tour.io[3] = this.floorY;
      if (this.tour.step(this.camera, this.look)) return true;
      this.stopTour();
    }
    if (this.focusT < 1) {
      this.focusT = Math.min(1, this.focusT + dt / this.focusDuration);
      const e = easeInOutCubic(this.focusT);
      this.camera.position.lerpVectors(this.fromPos, this.toPos, e);
      this.look.lerpVectors(this.fromTarget, this.toTarget, e);
      if (this.controls) this.controls.target.copy(this.look);
      this.camera.lookAt(this.look);
      return true;
    }
    if (this.mode === 'manual') {
      const moved = this.poseDirty;
      this.poseDirty = false;
      return moved;
    }
    if (this.mode === 'orbit') {
      if (!this.controls) return false;
      let changed = this.controls.update(dt);
      if (this.camera.position.y < this.floorY) {
        this.camera.position.y = this.floorY;
        this.camera.lookAt(this.controls.target);
        changed = true;
      }
      this.look.copy(this.controls.target);
      return changed;
    }
    const yaw = this.follow ? this.follow(_target) : Number.NaN;
    if (!Number.isFinite(yaw)) return false;
    if (this.mode === 'firstPerson') {
      // Small height changes (stairs, kerbs) ease the eye by about 55 ms instead of snapping it; big drops and teleports pass at once.
      let eyeY = _target.y + this.eyeHeight;
      if (this.stepY !== null) {
        const d = eyeY - this.stepY;
        if (Math.abs(d) > 0.02 && Math.abs(d) < STEP_SMOOTH_MAX) eyeY = this.stepY + d * (1 - Math.exp(-18 * Math.max(0, dt)));
      }
      this.stepY = eyeY;
      this.camera.position.set(_target.x, eyeY, _target.z);
      this.pitch = Math.max(-1.48, Math.min(1.48, this.pitch));
      _euler.set(this.pitch, yaw, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(_euler);
      this.look.set(_target.x - Math.sin(yaw) * 4, _target.y + this.eyeHeight, _target.z - Math.cos(yaw) * 4);
      return true;
    }
    // Follow: chase from behind the target's heading.
    _desired.set(_target.x + Math.sin(yaw) * FOLLOW_DISTANCE, _target.y + FOLLOW_HEIGHT, _target.z + Math.cos(yaw) * FOLLOW_DISTANCE);
    let rate = 6;
    const occludes = this.occlusion !== null || this.occlusionSink !== null;
    if (occludes) {
      // Something solid between the target and the camera (a tree trunk, a wall): move in front of it, fast.
      _lookAt.set(_target.x, _target.y + LOOK_HEIGHT, _target.z);
      _dir.subVectors(_desired, _lookAt);
      const full = _dir.length();
      if (full > 1e-4) boomFree(this.occlusion, this.occlusionSink, _lookAt, _desired, BOOM_RADIUS);
      const free = full > 1e-4 ? _free[1]! : Number.POSITIVE_INFINITY;
      if (free < full) {
        // Field writes, not vector calls with a scalar argument: a call that is not inlined boxes its doubles.
        const k = Math.max(MIN_FOLLOW_DISTANCE, free - OCCLUSION_PADDING) / full;
        _desired.x = _lookAt.x + _dir.x * k;
        _desired.y = _lookAt.y + _dir.y * k;
        _desired.z = _lookAt.z + _dir.z * k;
        rate = 14;
      }
    }
    // Inline exponential damping (same as damp()): no boxed return values per frame.
    this.camera.position.lerp(_desired, 1 - Math.exp(-rate * Math.max(0, dt)));
    if (occludes) {
      // The eased camera trails the pulled-in point when the player turns into a wall: never let it stay farther
      // out than the boom is free, whatever the smoothing says (the pull-in is instant, the ease-out is not).
      _lookAt.set(_target.x, _target.y + LOOK_HEIGHT, _target.z);
      _dir.subVectors(this.camera.position, _lookAt);
      const dist = _dir.length();
      if (dist > MIN_FOLLOW_DISTANCE) {
        boomFree(this.occlusion, this.occlusionSink, _lookAt, this.camera.position, BOOM_RADIUS);
        const free = _free[1]!;
        if (free - OCCLUSION_PADDING < dist) {
          const k = Math.max(MIN_FOLLOW_DISTANCE, free - OCCLUSION_PADDING) / dist;
          const p = this.camera.position;
          p.x = _lookAt.x + _dir.x * k;
          p.y = _lookAt.y + _dir.y * k;
          p.z = _lookAt.z + _dir.z * k;
        }
      }
    }
    _desired.set(_target.x, _target.y + LOOK_HEIGHT, _target.z);
    this.look.lerp(_desired, 1 - Math.exp(-10 * Math.max(0, dt)));
    this.camera.lookAt(this.look);
    return true;
  }

  /**
   * Dispose controls. three's OrbitControls registers its Ctrl-key interceptors on `getRootNode()` and removes them the
   * same way, so once the canvas has left the page it removes them from the detached canvas and the ones on `document`
   * stay forever, keeping the controls (and through their change listeners, the whole renderer) alive across world
   * switches. They are removed from `document` here.
   */
  dispose(): void {
    const c = this.controls;
    if (!c) return;
    c.dispose();
    const k = c as unknown as { _interceptControlDown?: EventListener; _interceptControlUp?: EventListener };
    if (typeof document === 'undefined') return;
    if (typeof k._interceptControlDown === 'function') document.removeEventListener('keydown', k._interceptControlDown, { capture: true });
    if (typeof k._interceptControlUp === 'function') document.removeEventListener('keyup', k._interceptControlUp, { capture: true });
  }
}
