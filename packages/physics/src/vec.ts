/**
 * Small allocation-conscious vector/quaternion helpers on plain tuples.
 * Functions taking an `out` parameter write into it and return it.
 */
import type { Vec3 } from '@aether/core';
import type { Quat } from './types';

/** True when every component is a finite number. */
export function isFiniteVec(v: readonly unknown[] | undefined, len = 3): boolean {
  if (!Array.isArray(v) || v.length < len) return false;
  for (let i = 0; i < len; i++) if (typeof v[i] !== 'number' || !Number.isFinite(v[i])) return false;
  return true;
}

/** Normalized copy of quaternion `q` (identity when degenerate or non-finite). */
export function normalizeQuat(q: readonly number[], out: Quat = [0, 0, 0, 1]): Quat {
  const x = q[0] ?? 0;
  const y = q[1] ?? 0;
  const z = q[2] ?? 0;
  const w = q[3] ?? 1;
  const len = Math.hypot(x, y, z, w);
  if (!Number.isFinite(len) || len < 1e-9) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    return out;
  }
  out[0] = x / len;
  out[1] = y / len;
  out[2] = z / len;
  out[3] = w / len;
  return out;
}

/** Conjugate (= inverse for unit quaternions). */
export function quatConjugate(q: Quat, out: Quat = [0, 0, 0, 1]): Quat {
  out[0] = -q[0];
  out[1] = -q[1];
  out[2] = -q[2];
  out[3] = q[3];
  return out;
}

/** Hamilton product a·b (applies b first, then a). Safe when `out` aliases an input. */
export function quatMul(a: Quat, b: Quat, out: Quat = [0, 0, 0, 1]): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** Rotate `v` by unit quaternion `q`. Safe when `out` aliases `v`. */
export function rotate(q: Quat, v: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
  return out;
}

/** Rotate `v` by the inverse of unit quaternion `q`. */
export function rotateInv(q: Quat, v: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  return rotate([-q[0], -q[1], -q[2], q[3]], v, out);
}

/** Euclidean distance between two points. */
export function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
}

/** Vector length. */
export function length(v: readonly number[]): number {
  return Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
}

/** True when `q` is (numerically) the identity rotation. */
export function isIdentityQuat(q: Quat, eps = 1e-6): boolean {
  return Math.abs(q[0]) < eps && Math.abs(q[1]) < eps && Math.abs(q[2]) < eps;
}

/** True when the three components are equal within a relative tolerance. */
export function isUniform(s: Vec3, rel = 1e-4): boolean {
  const m = Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2]), 1e-12);
  return Math.abs(s[0] - s[1]) / m < rel && Math.abs(s[1] - s[2]) / m < rel;
}

/**
 * Angle (degrees) between the body's up axis now (`q`) and at rest (`q0`).
 * Pure yaw rotations do not count — this measures tipping.
 */
export function tiltDegrees(q0: Quat, q: Quat): number {
  const up0 = rotate(q0, [0, 1, 0]);
  const up = rotate(q, [0, 1, 0]);
  const dot = Math.min(1, Math.max(-1, up0[0] * up[0] + up0[1] * up[1] + up0[2] * up[2]));
  return (Math.acos(dot) * 180) / Math.PI;
}

/** Round to a fixed number of decimals, normalizing -0 to 0. */
export function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round(v * f) / f;
  return r === 0 ? 0 : r;
}

/** Format a number for LLM-facing messages (meters, 2 decimals). */
export function fmt(v: number, decimals = 2): string {
  return String(round(v, decimals));
}
