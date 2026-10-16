const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
/** Normalize -0 to 0 so outputs serialize/compare cleanly. */
function clean(n) {
    return n === 0 ? 0 : n;
}
/**
 * Euler angles in degrees (XYZ order) → unit quaternion.
 * Identical to `new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'))`.
 */
export function eulerDegToQuat(r, out = [0, 0, 0, 1]) {
    const hx = r[0] * DEG2RAD * 0.5;
    const hy = r[1] * DEG2RAD * 0.5;
    const hz = r[2] * DEG2RAD * 0.5;
    const c1 = Math.cos(hx), c2 = Math.cos(hy), c3 = Math.cos(hz);
    const s1 = Math.sin(hx), s2 = Math.sin(hy), s3 = Math.sin(hz);
    out[0] = s1 * c2 * c3 + c1 * s2 * s3;
    out[1] = c1 * s2 * c3 - s1 * c2 * s3;
    out[2] = c1 * c2 * s3 + s1 * s2 * c3;
    out[3] = c1 * c2 * c3 - s1 * s2 * s3;
    return out;
}
/**
 * Quaternion → Euler angles in degrees (XYZ order). Matches three.js
 * `Euler.setFromQuaternion(q, 'XYZ')` including its gimbal-lock branch.
 * The input does not need to be normalized; a zero quaternion yields [0,0,0].
 */
export function quatToEulerDeg(q) {
    const len = Math.hypot(q[0], q[1], q[2], q[3]);
    if (len === 0 || !Number.isFinite(len))
        return [0, 0, 0];
    const x = q[0] / len, y = q[1] / len, z = q[2] / len, w = q[3] / len;
    const m11 = 1 - 2 * (y * y + z * z);
    const m12 = 2 * (x * y - w * z);
    const m13 = 2 * (x * z + w * y);
    const m22 = 1 - 2 * (x * x + z * z);
    const m23 = 2 * (y * z - w * x);
    const m32 = 2 * (y * z + w * x);
    const m33 = 1 - 2 * (x * x + y * y);
    const ry = Math.asin(Math.min(1, Math.max(-1, m13)));
    let rx;
    let rz;
    if (Math.abs(m13) < 0.9999999) {
        rx = Math.atan2(-m23, m33);
        rz = Math.atan2(-m12, m11);
    }
    else {
        rx = Math.atan2(m32, m22);
        rz = 0;
    }
    return [clean(rx * RAD2DEG), clean(ry * RAD2DEG), clean(rz * RAD2DEG)];
}
/** Hamilton product a·b (applies b first, then a). Safe when `out` aliases an input. */
export function quatMultiply(a, b, out = [0, 0, 0, 1]) {
    const ax = a[0], ay = a[1], az = a[2], aw = a[3];
    const bx = b[0], by = b[1], bz = b[2], bw = b[3];
    out[0] = ax * bw + aw * bx + ay * bz - az * by;
    out[1] = ay * bw + aw * by + az * bx - ax * bz;
    out[2] = az * bw + aw * bz + ax * by - ay * bx;
    out[3] = aw * bw - ax * bx - ay * by - az * bz;
    return out;
}
/** Rotate vector `v` by unit quaternion `q`. Safe when `out` aliases `v`. */
export function rotateVec3(q, v, out = [0, 0, 0]) {
    const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    const vx = v[0], vy = v[1], vz = v[2];
    // t = 2 * cross(q.xyz, v)
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    // v' = v + w * t + cross(q.xyz, t)
    out[0] = vx + qw * tx + (qy * tz - qz * ty);
    out[1] = vy + qw * ty + (qz * tx - qx * tz);
    out[2] = vz + qw * tz + (qx * ty - qy * tx);
    return out;
}
