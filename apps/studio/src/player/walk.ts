/**
 * Eye-level walking of the architecture explore mode, without the physics session: WASD at a slow walk, collision with
 * walls and furniture from rays at knee and chest height (sliding along what blocks), the eye kept 1.6 m over the floor
 * (up and down stairs, not up anything taller than a step), and click-to-glide destinations. Pure: the scene answers
 * through a {@link WalkProbe} (the renderer's rays in the player, boxes in tests).
 */
import type { Vec3 } from '@aether/core';

/** Eye height over the floor (m). */
export const WALK_EYE = 1.6;
/** Walking speed (m/s): slow, no sprint. */
export const WALK_SPEED = 1.4;
/** Distance kept from walls and furniture (m). */
export const WALK_RADIUS = 0.3;
/** Highest step walked up (m). */
export const STEP_UP = 0.45;
/** Deepest drop walked down in one step (m): a stair; deeper is an edge. */
export const STEP_DOWN = 1.2;
/** Glide speed (m/s) and its shortest and longest duration (s). */
export const GLIDE_SPEED = 2.4;
export const GLIDE_MIN_S = 0.5;
export const GLIDE_MAX_S = 2.6;
/** A glide farther than this (m), or through a wall, fades instead of flying (the camera would cross walls). */
export const FADE_DISTANCE = 9;

/** What walking asks of the scene. */
export interface WalkProbe {
  /** Free distance from `from` along the unit `dir`, up to `max` (`max` when nothing is hit). */
  free(from: Readonly<Vec3>, dir: Readonly<Vec3>, max: number): number;
  /** Height of the walkable surface under (x, z), searched downward from `fromY`; null when there is none within reach. */
  floor(x: number, z: number, fromY: number): number | null;
}

/** Horizontal forward of a camera yaw (radians, 0 looks along −Z, as the camera rig). */
export function forwardOf(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}

/** Yaw and pitch (radians, the camera rig's convention) of a camera at `eye` looking at `target`. */
export function yawPitch(eye: Readonly<Vec3>, target: Readonly<Vec3>): { yaw: number; pitch: number } {
  const dx = target[0] - eye[0];
  const dy = target[1] - eye[1];
  const dz = target[2] - eye[2];
  const flat = Math.hypot(dx, dz);
  return { yaw: flat > 1e-9 ? Math.atan2(-dx, -dz) : 0, pitch: Math.atan2(dy, Math.max(1e-9, flat)) };
}

/** The shortest signed turn from angle `a` to `b` (radians). */
export function turn(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/**
 * The body's horizontal path from `eye` along the unit (dx, dz) by `len` is clear at knee and chest height, keeping
 * {@link WALK_RADIUS} free along the move and along each of its x and z parts (a diagonal move does not graze a wall).
 */
function clear(eye: Readonly<Vec3>, dx: number, dz: number, len: number, probe: WalkProbe): boolean {
  if (len <= 0) return true;
  const feet = eye[1] - WALK_EYE;
  const rays: Array<[Vec3, number]> = [[[dx, 0, dz], len]];
  if (Math.abs(dx) > 1e-6 && Math.abs(dz) > 1e-6) rays.push([[Math.sign(dx), 0, 0], Math.abs(dx) * len], [[0, 0, Math.sign(dz)], Math.abs(dz) * len]);
  for (const h of [STEP_UP + 0.05, 1.1]) {
    for (const [dir, l] of rays) if (probe.free([eye[0], feet + h, eye[2]], dir, l + WALK_RADIUS) < l + WALK_RADIUS - 1e-6) return false;
  }
  return true;
}

/** Try one horizontal move; the new eye or null when blocked (a wall, furniture, a tall step, an edge). */
function tryMove(eye: Readonly<Vec3>, dx: number, dz: number, len: number, probe: WalkProbe): Vec3 | null {
  if (!clear(eye, dx, dz, len, probe)) return null;
  const x = eye[0] + dx * len;
  const z = eye[2] + dz * len;
  const feet = eye[1] - WALK_EYE;
  const f = probe.floor(x, z, feet + STEP_UP + 0.05);
  if (f === null || f > feet + STEP_UP || f < feet - STEP_DOWN) return null;
  return [x, f + WALK_EYE, z];
}

/**
 * One step of the walk: `input.forward` / `input.right` in −1…1 relative to the view's yaw, over `dt` seconds. Blocked
 * moves slide along the obstacle (the move split into its x and z parts); returns the new eye (unchanged when nothing moves).
 */
export function walkStep(eye: Readonly<Vec3>, yaw: number, input: { forward: number; right: number }, dt: number, probe: WalkProbe, speed = WALK_SPEED): Vec3 {
  const [fx, fz] = forwardOf(yaw);
  // Right of the view: forward turned a quarter clockwise seen from above.
  const rx = -fz;
  const rz = fx;
  let mx = fx * input.forward + rx * input.right;
  let mz = fz * input.forward + rz * input.right;
  const m = Math.hypot(mx, mz);
  if (!(m > 1e-6) || !(dt > 0)) return [eye[0], eye[1], eye[2]];
  mx /= m;
  mz /= m;
  const len = Math.min(0.5, speed * Math.min(1, m) * Math.min(dt, 0.1));
  const full = tryMove(eye, mx, mz, len, probe);
  if (full) return full;
  // Slide: the larger part of the move first.
  const parts: Array<[number, number]> = Math.abs(mx) >= Math.abs(mz) ? [[Math.sign(mx), 0], [0, Math.sign(mz)]] : [[0, Math.sign(mz)], [Math.sign(mx), 0]];
  for (const [px, pz] of parts) {
    const share = Math.abs(px !== 0 ? mx : mz);
    if (share < 0.2) continue;
    const moved = tryMove(eye, px, pz, len * share, probe);
    if (moved) return moved;
  }
  return [eye[0], eye[1], eye[2]];
}

/**
 * Where a click on the scene glides to: on a floor (an upward face) the eye over the clicked point; on a wall or a piece of
 * furniture a step back from it toward the viewer, over the floor there. The destination stops short of anything in the way
 * at body height. Null when there is nowhere to stand.
 */
export function glideDestination(eye: Readonly<Vec3>, hit: { point: Vec3; normal: Vec3 }, probe: WalkProbe): Vec3 | null {
  let x = hit.point[0];
  let z = hit.point[2];
  let floorY: number | null;
  if (hit.normal[1] > 0.7) floorY = hit.point[1];
  else {
    const dx = x - eye[0];
    const dz = z - eye[2];
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return null;
    const back = Math.min(d, 0.7);
    x -= (dx / d) * back;
    z -= (dz / d) * back;
    floorY = probe.floor(x, z, Math.min(eye[1], hit.point[1] + WALK_EYE));
  }
  if (floorY === null || !Number.isFinite(floorY)) return null;
  // A table top or a bed clicked from standing height: the floor under it.
  if (floorY > eye[1] - WALK_EYE + STEP_UP && floorY < eye[1]) {
    const under = probe.floor(x, z, floorY - 0.05);
    if (under !== null) floorY = under;
  }
  const dest: Vec3 = [x, floorY + WALK_EYE, z];
  // Stop short of what is in the way at chest height (a sofa back, a glass door).
  const dx = dest[0] - eye[0];
  const dz = dest[2] - eye[2];
  const d = Math.hypot(dx, dz);
  if (d > 0.05) {
    const free = probe.free([eye[0], eye[1] - WALK_EYE + 1.1, eye[2]], [dx / d, 0, dz / d], d);
    // Something just before the destination (a sofa back, the bed): stop short of it. Farther back (a wall the view
    // looked past) the move fades instead (see needsFade).
    if (free < d - 1e-6 && d - free < 1.5) {
      const stop = Math.max(0, free - WALK_RADIUS - 0.2);
      const f = probe.floor(eye[0] + (dx / d) * stop, eye[2] + (dz / d) * stop, eye[1]);
      if (f !== null) return [eye[0] + (dx / d) * stop, f + WALK_EYE, eye[2] + (dz / d) * stop];
    }
  }
  return dest;
}

/** Duration (s) of a glide over `distance` m. */
export function glideSeconds(distance: number): number {
  return Math.max(GLIDE_MIN_S, Math.min(GLIDE_MAX_S, distance / GLIDE_SPEED));
}

/** A move from `from` to `to` fades instead of gliding: far, or a wall in between at chest height. */
export function needsFade(from: Readonly<Vec3>, to: Readonly<Vec3>, probe: WalkProbe): boolean {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const d = Math.hypot(dx, dy, dz);
  if (d > FADE_DISTANCE) return true;
  if (d < 0.05) return false;
  return probe.free(from, [dx / d, dy / d, dz / d], d) < d - 0.25;
}
