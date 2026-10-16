const DEG = Math.PI / 180;
/** New identity matrix. */
export function mat3Identity() {
    const m = new Float64Array(9);
    m[0] = 1;
    m[4] = 1;
    m[8] = 1;
    return m;
}
/** Rotation matrix from Euler angles in degrees (XYZ order, like three.js `Euler('XYZ')`). */
export function mat3FromEulerDeg(xDeg, yDeg, zDeg, out = new Float64Array(9)) {
    const a = Math.cos(xDeg * DEG);
    const b = Math.sin(xDeg * DEG);
    const c = Math.cos(yDeg * DEG);
    const d = Math.sin(yDeg * DEG);
    const e = Math.cos(zDeg * DEG);
    const f = Math.sin(zDeg * DEG);
    const ae = a * e;
    const af = a * f;
    const be = b * e;
    const bf = b * f;
    out[0] = c * e;
    out[1] = -c * f;
    out[2] = d;
    out[3] = af + be * d;
    out[4] = ae - bf * d;
    out[5] = -b * c;
    out[6] = bf - ae * d;
    out[7] = be + af * d;
    out[8] = a * c;
    return out;
}
/** Diagonal scale matrix. */
export function mat3Scale(x, y, z, out = new Float64Array(9)) {
    out.fill(0);
    out[0] = x;
    out[4] = y;
    out[8] = z;
    return out;
}
/** Rotation about a unit axis by `angle` radians (Rodrigues). */
export function mat3AxisAngle(kx, ky, kz, angle, out = new Float64Array(9)) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;
    out[0] = c + kx * kx * t;
    out[1] = kx * ky * t - kz * s;
    out[2] = kx * kz * t + ky * s;
    out[3] = ky * kx * t + kz * s;
    out[4] = c + ky * ky * t;
    out[5] = ky * kz * t - kx * s;
    out[6] = kz * kx * t - ky * s;
    out[7] = kz * ky * t + kx * s;
    out[8] = c + kz * kz * t;
    return out;
}
/** Shortest-arc rotation taking +Y onto direction (dx, dy, dz). Zero vectors yield identity. */
export function mat3AlignY(dx, dy, dz, out = new Float64Array(9)) {
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-12) {
        out.set(mat3Identity());
        return out;
    }
    const x = dx / len;
    const y = dy / len;
    const z = dz / len;
    if (y > 1 - 1e-9) {
        out.set(mat3Identity());
        return out;
    }
    if (y < -1 + 1e-9)
        return mat3AxisAngle(1, 0, 0, Math.PI, out);
    // axis = Y × d = (z, 0, -x)
    const ax = z;
    const az = -x;
    const al = Math.hypot(ax, az);
    return mat3AxisAngle(ax / al, 0, az / al, Math.acos(y), out);
}
/** out = a · b. `out` may alias neither input. */
export function mat3Multiply(a, b, out = new Float64Array(9)) {
    for (let r = 0; r < 3; r++) {
        const a0 = a[r * 3];
        const a1 = a[r * 3 + 1];
        const a2 = a[r * 3 + 2];
        out[r * 3] = a0 * b[0] + a1 * b[3] + a2 * b[6];
        out[r * 3 + 1] = a0 * b[1] + a1 * b[4] + a2 * b[7];
        out[r * 3 + 2] = a0 * b[2] + a1 * b[5] + a2 * b[8];
    }
    return out;
}
/** Euler degrees (XYZ order) of a pure rotation matrix (inverse of {@link mat3FromEulerDeg}). */
export function mat3ToEulerDeg(m) {
    const m00 = m[0];
    const m01 = m[1];
    const m02 = m[2];
    const m11 = m[4];
    const m12 = m[5];
    const m21 = m[7];
    const m22 = m[8];
    const y = Math.asin(Math.min(1, Math.max(-1, m02)));
    let x;
    let z;
    if (Math.abs(m02) < 0.9999999) {
        x = Math.atan2(-m12, m22);
        z = Math.atan2(-m01, m00);
    }
    else {
        x = Math.atan2(m21, m11);
        z = 0;
    }
    return [x / DEG, y / DEG, z / DEG];
}
/** Transform a vector in place-free style: returns m · (x, y, z). */
export function mat3Apply(m, x, y, z) {
    return [
        m[0] * x + m[1] * y + m[2] * z,
        m[3] * x + m[4] * y + m[5] * z,
        m[6] * x + m[7] * y + m[8] * z,
    ];
}
