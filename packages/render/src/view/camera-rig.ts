/**
 * Camera behaviors: orbit (OrbitControls with damping), follow (smooth
 * third-person chase), first-person, and an eased fly-to used by `focus`.
 * Everything per-frame uses module scratch objects (no allocations).
 */
import { Euler, PerspectiveCamera, Vector3 } from 'three';
import type { CameraMode } from '../types';

/** The subset of OrbitControls the rig needs (lets tests use a fake). */
export interface OrbitControlsLike {
  enabled: boolean;
  enableDamping: boolean;
  dampingFactor: number;
  readonly target: Vector3;
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

/** Lowest view elevation {@link CameraRig.focusOn} keeps (20°). */
export const MIN_FOCUS_ELEVATION = 20;
const MIN_FOCUS_SIN = Math.sin((MIN_FOCUS_ELEVATION * Math.PI) / 180);
const MIN_FOCUS_COS = Math.cos((MIN_FOCUS_ELEVATION * Math.PI) / 180);

const FOLLOW_DISTANCE = 5.5;
const FOLLOW_HEIGHT = 2.4;
const LOOK_HEIGHT = 1.3;
const EYE_HEIGHT = 1.6;

const _target = new Vector3();
const _desired = new Vector3();
const _euler = new Euler(0, 0, 0, 'YXZ');

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
  /**
   * Lowest camera height in orbit mode (ground + clearance), or -Infinity
   * when the world has no ground. Keeps orbiting and fly-tos above ground.
   */
  floorY = Number.NEGATIVE_INFINITY;

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

  /** True while a fly-to animation runs. */
  get focusing(): boolean {
    return this.focusT < 1;
  }

  /** Switch mode. `source` provides the follow/first-person target. */
  setMode(mode: CameraMode, source: FollowSource | null): void {
    this.mode = mode;
    this.follow = mode === 'orbit' ? null : source;
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

  /** Fly (or jump when `duration` ≤ 0) to a camera position looking at `target`. Switches to orbit mode. */
  flyTo(position: Vector3, target: Vector3, duration = 0.9): void {
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
    if (this.focusT < 1) {
      this.focusT = Math.min(1, this.focusT + dt / this.focusDuration);
      const e = easeInOutCubic(this.focusT);
      this.camera.position.lerpVectors(this.fromPos, this.toPos, e);
      this.look.lerpVectors(this.fromTarget, this.toTarget, e);
      if (this.controls) this.controls.target.copy(this.look);
      this.camera.lookAt(this.look);
      return true;
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
      this.camera.position.set(_target.x, _target.y + EYE_HEIGHT, _target.z);
      this.pitch = Math.max(-1.48, Math.min(1.48, this.pitch));
      _euler.set(this.pitch, yaw, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(_euler);
      this.look.set(_target.x - Math.sin(yaw) * 4, _target.y + EYE_HEIGHT, _target.z - Math.cos(yaw) * 4);
      return true;
    }
    // Follow: chase from behind the target's heading.
    _desired.set(_target.x + Math.sin(yaw) * FOLLOW_DISTANCE, _target.y + FOLLOW_HEIGHT, _target.z + Math.cos(yaw) * FOLLOW_DISTANCE);
    this.camera.position.lerp(_desired, damp(6, dt));
    _desired.set(_target.x, _target.y + LOOK_HEIGHT, _target.z);
    this.look.lerp(_desired, damp(10, dt));
    this.camera.lookAt(this.look);
    return true;
  }

  /** Dispose controls. */
  dispose(): void {
    this.controls?.dispose();
  }
}
