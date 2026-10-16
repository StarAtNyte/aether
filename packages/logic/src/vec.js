const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
/** Copy `src` into `out`. */
export function copy3(out, src) {
    out[0] = src[0];
    out[1] = src[1];
    out[2] = src[2];
    return out;
}
/** Copy `src` into `out`. */
export function copyQuat(out, src) {
    out[0] = src[0];
    out[1] = src[1];
    out[2] = src[2];
    out[3] = src[3];
    return out;
}
/** Horizontal (XZ) distance between two points. */
export function distXZ(a, b) {
    const dx = a[0] - b[0], dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dz * dz);
}
/** Length of a vector. */
export function len3(v) {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}
/** Normalize `v` into `out` (zero vector stays zero). */
export function normalize3(out, v) {
    const l = len3(v);
    if (l < 1e-12) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        return out;
    }
    out[0] = v[0] / l;
    out[1] = v[1] / l;
    out[2] = v[2] / l;
    return out;
}
/** Quaternion for a rotation of `angleDeg` around the unit-or-not `axis`. */
export function axisAngleQuat(out, axis, angleDeg) {
    const l = len3(axis);
    if (l < 1e-12) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        out[3] = 1;
        return out;
    }
    const half = angleDeg * DEG2RAD * 0.5;
    const s = Math.sin(half) / l;
    out[0] = axis[0] * s;
    out[1] = axis[1] * s;
    out[2] = axis[2] * s;
    out[3] = Math.cos(half);
    return out;
}
/** Quaternion for a yaw (rotation about +Y) of `deg` degrees. */
export function yawQuat(out, deg) {
    const half = deg * DEG2RAD * 0.5;
    out[0] = 0;
    out[1] = Math.sin(half);
    out[2] = 0;
    out[3] = Math.cos(half);
    return out;
}
/**
 * Yaw (degrees) that makes an entity's forward axis (−Z, three.js convention)
 * point along the horizontal direction (dx, dz). Returns `fallback` for a zero direction.
 */
export function yawFromDirection(dx, dz, fallback) {
    if (dx * dx + dz * dz < 1e-12)
        return fallback;
    return Math.atan2(-dx, -dz) * RAD2DEG;
}
/** Yaw (degrees) of the −Z forward axis of quaternion `q`. */
export function yawOfQuat(q) {
    const [x, y, z, w] = q;
    // Forward = q · (0, 0, -1)
    const fx = -(2 * (x * z + w * y));
    const fz = -(1 - 2 * (x * x + y * y));
    return yawFromDirection(fx, fz, 0);
}
/** Shortest signed difference `to - from` in degrees, in (-180, 180]. */
export function angleDelta(from, to) {
    let d = (to - from) % 360;
    if (d > 180)
        d -= 360;
    else if (d <= -180)
        d += 360;
    return d;
}
/** Inverse-rotate `v` by unit quaternion `q` (i.e. rotate by its conjugate) into `out`. */
export function inverseRotate(q, v, out) {
    const qx = -q[0], qy = -q[1], qz = -q[2], qw = q[3];
    const vx = v[0], vy = v[1], vz = v[2];
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    out[0] = vx + qw * tx + (qy * tz - qz * ty);
    out[1] = vy + qw * ty + (qz * tx - qx * tz);
    out[2] = vz + qw * tz + (qx * ty - qy * tx);
    return out;
}
/** Clamp `v` to [lo, hi]. */
export function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}
/** True when every component is a finite number. */
export function isFiniteVec(v) {
    return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}
/** Round to 2 decimals for log output. */
export function fmt(n) {
    return String(Math.round(n * 100) / 100);
}
/** Format a vector for log output. */
export function fmtVec(v) {
    return `[${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])}]`;
}
