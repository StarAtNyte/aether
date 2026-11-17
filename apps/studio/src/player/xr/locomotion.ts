/**
 * The pure parts of immersive VR in the player (`session.ts` drives them from the XR frame loop): where the play space
 * stands in the world, snap turn, the teleport arc and whether its landing spot is somewhere to stand, the comfort fade,
 * and the walk pose handed back on exit. Allocation-free where it runs every frame (callers pass the outputs).
 *
 * The play space ("rig"): a `local-floor` reference space puts its origin on the visitor's real floor, so the world
 * sees the head at the visitor's own height. The rig places that origin in the world: a point on the world's floor and a
 * turn about the vertical, world = T(x, y, z) · Ry(yaw) · local. Yaw follows the walk's convention (`walk.ts`: 0 looks
 * along -Z, positive turns left), so a rig yaw equal to the walk's yaw faces where the walk faced. Scale is 1:1.
 */
import type { Vec3 } from '@aether/core';
import { STEP_UP, WALK_EYE, WALK_RADIUS, type WalkProbe } from '../walk';

/** One snap turn (degrees). */
export const SNAP_TURN_DEG = 30;
/** A stick pushed past this fires (a snap turn, or starts aiming a teleport). */
export const STICK_FIRE = 0.6;
/** A stick back under this re-arms the snap turn (and releases an aimed teleport). */
export const STICK_REARM = 0.3;
/** Launch speed (m/s) and gravity (m/s²) of the teleport arc. */
export const ARC_SPEED = 7.5;
export const ARC_GRAVITY = 9.8;
/** Time step (s) between the arc's points, and its most points. */
export const ARC_STEP_S = 0.045;
export const ARC_MAX_POINTS = 48;
/** Room over the landing spot (m) and around it at waist height (m). */
export const HEADROOM = 1.8;
export const BODY_CLEARANCE = WALK_RADIUS * 0.6;
/** A raised surface up to this far (m) over the visitor's eyes still counts as furniture (see {@link teleportTarget}). */
export const RAISED_TOP_MARGIN = 0.2;
/** Fade of a teleport (ms): to black, held, back. */
export const FADE_OUT_MS = 120;
export const FADE_HOLD_MS = 40;
export const FADE_IN_MS = 180;

/** Where the play space's floor origin stands in the world (see the module docs). */
export interface XRRig {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** A position and a unit quaternion, as an `XRRigidTransform` takes them. */
export interface RigidTransform {
  position: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
}

/** A point of the play space (`local-floor` coordinates) in the world: written into `out`, which is returned. */
export function localToWorld(rig: Readonly<XRRig>, lx: number, ly: number, lz: number, out: Vec3): Vec3 {
  const c = Math.cos(rig.yaw);
  const s = Math.sin(rig.yaw);
  out[0] = rig.x + c * lx + s * lz;
  out[1] = rig.y + ly;
  out[2] = rig.z - s * lx + c * lz;
  return out;
}

/** A direction of the play space in the world (the rig's turn only), into `out`. */
export function directionToWorld(rig: Readonly<XRRig>, dx: number, dy: number, dz: number, out: Vec3): Vec3 {
  const c = Math.cos(rig.yaw);
  const s = Math.sin(rig.yaw);
  out[0] = c * dx + s * dz;
  out[1] = dy;
  out[2] = -s * dx + c * dz;
  return out;
}

/**
 * The origin offset of the reference space that shows the play space where the rig puts it (`getOffsetReferenceSpace`).
 * WebXR expresses a pose in the offset space as inverse(offset) · pose in the base space; the rig wants
 * T(p) · Ry(yaw) · pose, so the offset is Ry(-yaw) · T(-p). Written into `out`.
 */
export function rigOffset(rig: Readonly<XRRig>, out: RigidTransform): RigidTransform {
  const c = Math.cos(rig.yaw);
  const s = Math.sin(rig.yaw);
  // Ry(-yaw) applied to p, negated.
  out.position.x = -(c * rig.x - s * rig.z);
  out.position.y = -rig.y;
  out.position.z = -(s * rig.x + c * rig.z);
  out.orientation.x = 0;
  out.orientation.y = Math.sin(-rig.yaw / 2);
  out.orientation.z = 0;
  out.orientation.w = Math.cos(-rig.yaw / 2);
  return out;
}

/** The rig that stands a visitor whose head is at (`hx`, `hz`) of the play space with their feet on `feet` (yaw kept). */
export function teleportRig(rig: XRRig, hx: number, hz: number, feet: Readonly<Vec3>): XRRig {
  const c = Math.cos(rig.yaw);
  const s = Math.sin(rig.yaw);
  rig.x = feet[0] - (c * hx + s * hz);
  rig.y = feet[1];
  rig.z = feet[2] - (-s * hx + c * hz);
  return rig;
}

/** Turn the rig by `delta` radians about the visitor's head (at (`hx`, `hz`) of the play space): they turn on the spot. */
export function turnRig(rig: XRRig, hx: number, hz: number, delta: number): XRRig {
  const c = Math.cos(rig.yaw);
  const s = Math.sin(rig.yaw);
  const wx = rig.x + c * hx + s * hz;
  const wz = rig.z - s * hx + c * hz;
  const dc = Math.cos(delta);
  const ds = Math.sin(delta);
  const px = rig.x - wx;
  const pz = rig.z - wz;
  rig.x = wx + dc * px + ds * pz;
  rig.z = wz - ds * px + dc * pz;
  rig.yaw = wrapAngle(rig.yaw + delta);
  return rig;
}

/** An angle in (-π, π]. */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** The rig that starts a session standing at the walk's eye `eye`, facing `yaw` (the head recentred once it is tracked). */
export function rigAtWalk(eye: Readonly<Vec3>, yaw: number): XRRig {
  return { x: eye[0], y: eye[1] - WALK_EYE, z: eye[2], yaw: wrapAngle(yaw) };
}

/**
 * The walk pose a session hands back: the feet under the head on the rig's floor, facing where the head faces (its
 * forward in the play space, `fx`, `fz`; looking straight up or down keeps the rig's own heading).
 */
export function walkPoseOnExit(rig: Readonly<XRRig>, hx: number, hz: number, fx: number, fz: number): { feet: Vec3; yaw: number } {
  const feet: Vec3 = [0, 0, 0];
  localToWorld(rig, hx, 0, hz, feet);
  const dir: Vec3 = [0, 0, 0];
  directionToWorld(rig, fx, 0, fz, dir);
  const flat = Math.hypot(dir[0], dir[2]);
  const yaw = flat > 1e-3 ? Math.atan2(-dir[0], -dir[2]) : rig.yaw;
  return { feet, yaw };
}

/**
 * Snap turn on a thumbstick: one {@link SNAP_TURN_DEG} step each time the stick is pushed sideways past
 * {@link STICK_FIRE}; it fires again only once the stick came back under {@link STICK_REARM}. Right turns right.
 */
export class SnapTurn {
  private armed = true;

  /** The turn (radians, the rig's convention: positive turns left) for the stick's sideways axis now; 0 for none. */
  update(x: number): number {
    if (!Number.isFinite(x)) return 0;
    if (!this.armed) {
      if (Math.abs(x) < STICK_REARM) this.armed = true;
      return 0;
    }
    if (Math.abs(x) < STICK_FIRE) return 0;
    this.armed = false;
    return (-Math.sign(x) * SNAP_TURN_DEG * Math.PI) / 180;
  }

  reset(): void {
    this.armed = true;
  }
}

/** Whether a stick aims a teleport: pushed forward past {@link STICK_FIRE}, held until it comes back under {@link STICK_REARM}. */
export function stickAiming(wasAiming: boolean, y: number): boolean {
  if (!Number.isFinite(y)) return false;
  // Forward is negative on the xr-standard mapping.
  return wasAiming ? y < -STICK_REARM : y < -STICK_FIRE;
}

/** What the arc hit (filled in place by an {@link ArcCast}). */
export interface ArcHit {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

/** Cast one straight piece of the arc: true and `out` filled when something is hit within `len`. */
export type ArcCast = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, out: ArcHit) => boolean;

/**
 * Trace the teleport arc from `origin` along the unit `dir`: a throw at {@link ARC_SPEED} under gravity, cast piece by
 * piece until something is hit, the points written into `points` (x, y, z each; at most `points.length / 3`). Returns the
 * points written; `hit` holds the hit when `hitOut.hit` is true. Ends without a hit after {@link ARC_MAX_POINTS} or once
 * the arc falls 30 m under its start.
 */
export function traceArc(origin: Readonly<Vec3>, dir: Readonly<Vec3>, cast: ArcCast, points: Float32Array, hit: ArcHit, hitOut: { hit: boolean }): number {
  const max = Math.min(ARC_MAX_POINTS, Math.floor(points.length / 3));
  hitOut.hit = false;
  if (max < 2) return 0;
  const vx = dir[0] * ARC_SPEED;
  const vy = dir[1] * ARC_SPEED;
  const vz = dir[2] * ARC_SPEED;
  let px = origin[0];
  let py = origin[1];
  let pz = origin[2];
  points[0] = px;
  points[1] = py;
  points[2] = pz;
  let n = 1;
  for (let i = 1; i < max; i++) {
    const t = i * ARC_STEP_S;
    const qx = origin[0] + vx * t;
    const qy = origin[1] + vy * t - 0.5 * ARC_GRAVITY * t * t;
    const qz = origin[2] + vz * t;
    const dx = qx - px;
    const dy = qy - py;
    const dz = qz - pz;
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-6 && cast(px, py, pz, dx / len, dy / len, dz / len, len, hit)) {
      points[n * 3] = hit.x;
      points[n * 3 + 1] = hit.y;
      points[n * 3 + 2] = hit.z;
      hitOut.hit = true;
      return n + 1;
    }
    points[n * 3] = qx;
    points[n * 3 + 1] = qy;
    points[n * 3 + 2] = qz;
    n++;
    px = qx;
    py = qy;
    pz = qz;
    if (qy < origin[1] - 30) break;
  }
  return n;
}

/**
 * Where a teleport aimed at `hit` stands the visitor (their feet), or null when it is nowhere to stand: not a floor
 * (a wall, a steep slope), the top of furniture, no headroom, or pressed against something at waist height. Uses the
 * walk view's probes (`walk.ts`). Furniture is judged as the walk view's glides judge it: a surface more than a step above
 * the visitor's feet (`feetY`) and under their eyes, with a floor below it (a table, a bed, a plinth). A floor higher
 * still (a mezzanine, the top of a stair) or lower (a drop) is somewhere to stand; stairs are climbed a few steps at a
 * time.
 */
export function teleportTarget(hit: Readonly<ArcHit>, probe: WalkProbe, feetY: number): Vec3 | null {
  if (!(hit.ny >= 0.7) || !Number.isFinite(hit.x + hit.y + hit.z)) return null;
  const { x, y, z } = hit;
  // The walk's own floor under the spot (the scene's ground plane included) must agree with what the arc hit.
  const floor = probe.floor(x, z, y + STEP_UP * 0.5);
  if (floor === null || Math.abs(floor - y) > 0.12) return null;
  if (floor > feetY + STEP_UP && floor < feetY + WALK_EYE + RAISED_TOP_MARGIN) {
    const under = probe.floor(x, z, floor - 0.05);
    if (under !== null && floor - under > STEP_UP) return null;
  }
  if (probe.free([x, floor + 0.1, z], [0, 1, 0], HEADROOM) < HEADROOM - 1e-6) return null;
  const waist = floor + 1;
  for (const [dx, dz] of CLEARANCE_DIRS) if (probe.free([x, waist, z], [dx, 0, dz], BODY_CLEARANCE) < BODY_CLEARANCE - 1e-6) return null;
  return [x, floor, z];
}

const CLEARANCE_DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * The comfort fade of a teleport: to black over {@link FADE_OUT_MS}, held for {@link FADE_HOLD_MS} (the move happens at
 * the start of the hold), back over {@link FADE_IN_MS}.
 */
export class TeleportFade {
  private t = -1;
  private moved = true;

  /** A fade is under way. */
  get active(): boolean {
    return this.t >= 0;
  }

  start(): void {
    this.t = 0;
    this.moved = false;
  }

  /**
   * Advance by `ms`; `out.alpha` is the cover (0 clear, 1 black), `out.move` true exactly once, on the frame the view is
   * black. Returns `out`.
   */
  step(ms: number, out: { alpha: number; move: boolean }): { alpha: number; move: boolean } {
    out.move = false;
    if (this.t < 0) {
      out.alpha = 0;
      return out;
    }
    this.t += Math.max(0, Number.isFinite(ms) ? ms : 0);
    const t = this.t;
    if (t < FADE_OUT_MS) out.alpha = t / FADE_OUT_MS;
    else {
      if (!this.moved) {
        this.moved = true;
        out.move = true;
      }
      if (t < FADE_OUT_MS + FADE_HOLD_MS) out.alpha = 1;
      else if (t < FADE_OUT_MS + FADE_HOLD_MS + FADE_IN_MS) out.alpha = 1 - (t - FADE_OUT_MS - FADE_HOLD_MS) / FADE_IN_MS;
      else {
        out.alpha = 0;
        this.t = -1;
      }
    }
    return out;
  }
}

/**
 * The XR framebuffer scale for the render tier the GPU budget picked: a Quest's recommended eye buffer at 1.0 is about
 * 1,700 px square per eye, which the heavier tiers can hold and the lighter ones cannot at 72-90 Hz.
 */
export function xrFramebufferScale(tier: string, gpuTier: string): number {
  if (gpuTier === 'software') return 0.5;
  switch (tier) {
    case 'ultra':
    case 'high':
      return 1;
    case 'medium':
      return 0.85;
    default:
      return 0.7;
  }
}
