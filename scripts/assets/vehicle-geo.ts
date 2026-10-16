/**
 * A small geometry kit for the vehicle models (dev-only, no dependencies): lofted bodies from superellipse
 * cross-sections, surfaces of revolution (tyres, rims), tubes (frames, hoops, arms), surface-conforming decals
 * and flat helpers. Meshes are indexed triangle lists with smooth (area-weighted) normals.
 *
 * Authoring frame: +X forward, +Y up, +Z to the right. `toLibraryFrame` rotates the finished model so it faces
 * -Z like every other library vehicle.
 */

/** Indexed triangle mesh. */
export interface Mesh {
  p: number[];
  n: number[];
  i: number[];
}

export type V3 = [number, number, number];

/** A fresh empty mesh. */
export function mesh(): Mesh {
  return { p: [], n: [], i: [] };
}

/** Append `src` to `dst`. */
export function append(dst: Mesh, src: Mesh): Mesh {
  const base = dst.p.length / 3;
  for (const v of src.p) dst.p.push(v);
  for (const v of src.n) dst.n.push(v);
  for (const v of src.i) dst.i.push(v + base);
  return dst;
}

/** Concatenate meshes. */
export function merge(...ms: Mesh[]): Mesh {
  const out = mesh();
  for (const m of ms) append(out, m);
  return out;
}

/** Number of triangles. */
export function triangles(m: Mesh): number {
  return m.i.length / 3;
}

/** Signed power: sgn(x) * |x|^p. */
export function sgnpow(x: number, p: number): number {
  return Math.sign(x) * Math.abs(x) ** p;
}

/** Recompute area-weighted vertex normals (for the vertices of triangles in `from`..end; default all). */
export function smooth(m: Mesh, fromTriangle = 0): Mesh {
  const acc = new Float64Array(m.p.length);
  for (let t = fromTriangle * 3; t < m.i.length; t += 3) {
    const a = m.i[t] as number;
    const b = m.i[t + 1] as number;
    const c = m.i[t + 2] as number;
    const ux = (m.p[b * 3] as number) - (m.p[a * 3] as number);
    const uy = (m.p[b * 3 + 1] as number) - (m.p[a * 3 + 1] as number);
    const uz = (m.p[b * 3 + 2] as number) - (m.p[a * 3 + 2] as number);
    const vx = (m.p[c * 3] as number) - (m.p[a * 3] as number);
    const vy = (m.p[c * 3 + 1] as number) - (m.p[a * 3 + 1] as number);
    const vz = (m.p[c * 3 + 2] as number) - (m.p[a * 3 + 2] as number);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      acc[v * 3] = (acc[v * 3] as number) + nx;
      acc[v * 3 + 1] = (acc[v * 3 + 1] as number) + ny;
      acc[v * 3 + 2] = (acc[v * 3 + 2] as number) + nz;
    }
  }
  m.n = new Array<number>(m.p.length).fill(0);
  for (let v = 0; v < m.p.length / 3; v++) {
    const x = acc[v * 3] as number;
    const y = acc[v * 3 + 1] as number;
    const z = acc[v * 3 + 2] as number;
    const l = Math.hypot(x, y, z) || 1;
    m.n[v * 3] = x / l;
    m.n[v * 3 + 1] = y / l;
    m.n[v * 3 + 2] = z / l;
  }
  return m;
}

/** Apply a function to every position (and recompute the normals). */
export function mapPoints(m: Mesh, f: (x: number, y: number, z: number) => V3): Mesh {
  for (let k = 0; k < m.p.length; k += 3) {
    const r = f(m.p[k] as number, m.p[k + 1] as number, m.p[k + 2] as number);
    m.p[k] = r[0];
    m.p[k + 1] = r[1];
    m.p[k + 2] = r[2];
  }
  return smooth(m);
}

/** Translate a mesh in place. */
export function move(m: Mesh, x: number, y: number, z: number): Mesh {
  for (let k = 0; k < m.p.length; k += 3) {
    m.p[k] = (m.p[k] as number) + x;
    m.p[k + 1] = (m.p[k + 1] as number) + y;
    m.p[k + 2] = (m.p[k + 2] as number) + z;
  }
  return m;
}

/** Mirror across the XY plane (z -> -z), flipping the winding. */
export function mirrorZ(m: Mesh): Mesh {
  const out = mesh();
  for (let k = 0; k < m.p.length; k += 3) {
    out.p.push(m.p[k] as number, m.p[k + 1] as number, -(m.p[k + 2] as number));
    out.n.push(m.n[k] as number, m.n[k + 1] as number, -(m.n[k + 2] as number));
  }
  for (let t = 0; t < m.i.length; t += 3) out.i.push(m.i[t] as number, m.i[t + 2] as number, m.i[t + 1] as number);
  return out;
}

/** Scale in place. */
export function scaleMesh(m: Mesh, sx: number, sy = sx, sz = sx): Mesh {
  for (let k = 0; k < m.p.length; k += 3) {
    m.p[k] = (m.p[k] as number) * sx;
    m.p[k + 1] = (m.p[k + 1] as number) * sy;
    m.p[k + 2] = (m.p[k + 2] as number) * sz;
  }
  return smooth(m);
}

/** Rotate about the X axis (radians). */
export function rotX(m: Mesh, a: number): Mesh {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return mapPoints(m, (x, y, z) => [x, y * c - z * s, y * s + z * c]);
}

/** Rotate about the Y axis (radians). */
export function rotY(m: Mesh, a: number): Mesh {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return mapPoints(m, (x, y, z) => [x * c + z * s, y, -x * s + z * c]);
}

/** Rotate about the Z axis (radians). */
export function rotZ(m: Mesh, a: number): Mesh {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return mapPoints(m, (x, y, z) => [x * c - y * s, x * s + y * c, z]);
}

/** Rotate from the authoring frame (+X forward) to the library frame (-Z forward): (x, y, z) -> (z, y, -x). */
export function toLibraryFrame(m: Mesh): Mesh {
  for (let k = 0; k < m.p.length; k += 3) {
    const x = m.p[k] as number;
    const z = m.p[k + 2] as number;
    m.p[k] = z;
    m.p[k + 2] = -x;
    const nx = m.n[k] as number;
    const nz = m.n[k + 2] as number;
    m.n[k] = nz;
    m.n[k + 2] = -nx;
  }
  return m;
}

/** One cross-section of a loft (a superellipse in the YZ plane at `x`). */
export interface Section {
  x: number;
  /** Half width. */
  hw: number;
  /** Bottom and top. */
  y0: number;
  y1: number;
  /** Lateral centre. */
  zc?: number;
  /** Superellipse exponent (2 = ellipse, large = box with rounded corners). */
  e?: number;
}

/** Linear interpolation of a section at `x` (clamped to the ends). */
export function sectionAt(secs: readonly Section[], x: number): Required<Section> {
  const first = secs[0] as Section;
  const last = secs[secs.length - 1] as Section;
  const fill = (s: Section): Required<Section> => ({ x: s.x, hw: s.hw, y0: s.y0, y1: s.y1, zc: s.zc ?? 0, e: s.e ?? 2.6 });
  if (x <= first.x) return fill(first);
  if (x >= last.x) return fill(last);
  for (let k = 0; k < secs.length - 1; k++) {
    const a = secs[k] as Section;
    const b = secs[k + 1] as Section;
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x || 1);
      const fa = fill(a);
      const fb = fill(b);
      const l = (u: number, v: number): number => u + (v - u) * t;
      return { x, hw: l(fa.hw, fb.hw), y0: l(fa.y0, fb.y0), y1: l(fa.y1, fb.y1), zc: l(fa.zc, fb.zc), e: l(fa.e, fb.e) };
    }
  }
  return fill(last);
}

/** Smooth a section list: Catmull-Rom resample to `count` sections between the first and last x. */
export function resample(secs: readonly Section[], count: number): Section[] {
  const out: Section[] = [];
  const x0 = (secs[0] as Section).x;
  const x1 = (secs[secs.length - 1] as Section).x;
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number): number =>
    0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  for (let k = 0; k < count; k++) {
    const x = x0 + ((x1 - x0) * k) / (count - 1);
    let j = 0;
    while (j < secs.length - 2 && x > (secs[j + 1] as Section).x) j++;
    const a = secs[Math.max(0, j - 1)] as Section;
    const b = secs[j] as Section;
    const c = secs[j + 1] as Section;
    const d = secs[Math.min(secs.length - 1, j + 2)] as Section;
    const t = (x - b.x) / (c.x - b.x || 1);
    const ch = (f: (s: Section) => number): number => cr(f(a), f(b), f(c), f(d), Math.max(0, Math.min(1, t)));
    out.push({ x, hw: Math.max(0.005, ch((s) => s.hw)), y0: ch((s) => s.y0), y1: Math.max(ch((s) => s.y0) + 0.004, ch((s) => s.y1)), zc: ch((s) => s.zc ?? 0), e: ch((s) => s.e ?? 2.6) });
  }
  return out;
}

/** Point of a section's ring at parameter angle `t`. */
export function ringPoint(s: Required<Section>, t: number): V3 {
  const c = Math.cos(t);
  const sn = Math.sin(t);
  const p = 2 / s.e;
  return [s.x, (s.y0 + s.y1) / 2 + ((s.y1 - s.y0) / 2) * sgnpow(sn, p), s.zc + s.hw * sgnpow(c, p)];
}

/** Height of a section's upper surface at lateral offset `z` (null when outside). */
export function topY(s: Required<Section>, z: number): number | null {
  const u = Math.abs(z - s.zc) / s.hw;
  if (u >= 1) return null;
  return (s.y0 + s.y1) / 2 + ((s.y1 - s.y0) / 2) * (1 - u ** s.e) ** (1 / s.e);
}

/** Side-surface lateral offset at height `y` (positive side), or null outside the section. */
export function sideZ(s: Required<Section>, y: number): number | null {
  const hh = (s.y1 - s.y0) / 2;
  const v = Math.abs(y - (s.y0 + s.y1) / 2) / hh;
  if (v >= 1) return null;
  return s.zc + s.hw * (1 - v ** s.e) ** (1 / s.e);
}

/** Loft sections into a closed solid with flat end caps. `ring` points per cross-section. */
export function loft(secs: readonly Section[], opts: { ring?: number; capStart?: boolean; capEnd?: boolean } = {}): Mesh {
  const ring = opts.ring ?? 28;
  const m = mesh();
  const full = secs.map((s) => ({ x: s.x, hw: s.hw, y0: s.y0, y1: s.y1, zc: s.zc ?? 0, e: s.e ?? 2.6 }));
  for (const s of full) {
    for (let k = 0; k < ring; k++) {
      const q = ringPoint(s, (k / ring) * Math.PI * 2);
      m.p.push(q[0], q[1], q[2]);
    }
  }
  for (let j = 0; j < full.length - 1; j++) {
    for (let k = 0; k < ring; k++) {
      const a = j * ring + k;
      const b = j * ring + ((k + 1) % ring);
      const c = (j + 1) * ring + k;
      const d = (j + 1) * ring + ((k + 1) % ring);
      // Counter-clockwise seen from outside (ring runs +Z -> +Y with x increasing).
      m.i.push(a, c, b, b, c, d);
    }
  }
  smooth(m);
  const cap = (s: Required<Section>, dir: 1 | -1): void => {
    const base = m.p.length / 3;
    const c = [s.x, (s.y0 + s.y1) / 2, s.zc] as V3;
    m.p.push(c[0], c[1], c[2]);
    m.n.push(dir, 0, 0);
    for (let k = 0; k < ring; k++) {
      const q = ringPoint(s, (k / ring) * Math.PI * 2);
      m.p.push(q[0], q[1], q[2]);
      m.n.push(dir, 0, 0);
    }
    for (let k = 0; k < ring; k++) {
      const a = base + 1 + k;
      const b = base + 1 + ((k + 1) % ring);
      if (dir === 1) m.i.push(base, a, b);
      else m.i.push(base, b, a);
    }
  };
  // Winding check: sides use (a, c, b) with the ring running +Z to +Y, which faces outward for increasing x.
  if (opts.capStart !== false) cap(full[0] as Required<Section>, -1);
  if (opts.capEnd !== false) cap(full[full.length - 1] as Required<Section>, 1);
  return m;
}

/** A rounded box (superellipse loft of two sections). */
export function roundedBox(cx: number, cy: number, cz: number, w: number, h: number, d: number, e = 5): Mesh {
  return loft(
    [
      { x: cx - w / 2, hw: d / 2, y0: cy - h / 2, y1: cy + h / 2, zc: cz, e },
      { x: cx + w / 2, hw: d / 2, y0: cy - h / 2, y1: cy + h / 2, zc: cz, e },
    ],
    { ring: 20 },
  );
}

/** An ellipsoid (loft of ellipse sections). */
export function ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, steps = 14, ring = 20): Mesh {
  const secs: Section[] = [];
  for (let k = 0; k <= steps; k++) {
    const a = -Math.PI / 2 + (k / steps) * Math.PI;
    const r = Math.cos(a);
    secs.push({ x: cx + rx * Math.sin(a), hw: Math.max(0.002, rz * r), y0: cy - Math.max(0.002, ry * r), y1: cy + Math.max(0.002, ry * r), zc: cz, e: 2 });
  }
  return loft(secs, { ring, capStart: false, capEnd: false });
}

/** Surface of revolution about the X axis through the origin. `profile` is a list of [x, radius]. */
export function lathe(profile: ReadonlyArray<readonly [number, number]>, seg = 36, capEnds = true): Mesh {
  const m = mesh();
  for (const [x, r] of profile) {
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      m.p.push(x, r * Math.sin(a), r * Math.cos(a));
    }
  }
  for (let j = 0; j < profile.length - 1; j++) {
    for (let k = 0; k < seg; k++) {
      const a = j * seg + k;
      const b = j * seg + ((k + 1) % seg);
      const c = (j + 1) * seg + k;
      const d = (j + 1) * seg + ((k + 1) % seg);
      m.i.push(a, b, c, b, d, c);
    }
  }
  smooth(m);
  // Orient: make sure normals point away from the axis for a positive-radius outer surface.
  const first = profile[0] as readonly [number, number];
  const last = profile[profile.length - 1] as readonly [number, number];
  const flip = (): void => {
    for (let t = 0; t < m.i.length; t += 3) {
      const b = m.i[t + 1] as number;
      m.i[t + 1] = m.i[t + 2] as number;
      m.i[t + 2] = b;
    }
    smooth(m);
  };
  // Check the first vertex ring's normal against the radial direction at the profile's widest radius.
  let widest = 0;
  for (let j = 0; j < profile.length; j++) if ((profile[j] as readonly [number, number])[1] > (profile[widest] as readonly [number, number])[1]) widest = j;
  const vi = widest * seg;
  const radial = (m.p[vi * 3 + 1] as number) * (m.n[vi * 3 + 1] as number) + (m.p[vi * 3 + 2] as number) * (m.n[vi * 3 + 2] as number);
  if (radial < 0) flip();
  const cap = (x: number, r: number, dir: 1 | -1): void => {
    if (r < 1e-4) return;
    const base = m.p.length / 3;
    m.p.push(x, 0, 0);
    m.n.push(dir, 0, 0);
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      m.p.push(x, r * Math.sin(a), r * Math.cos(a));
      m.n.push(dir, 0, 0);
    }
    for (let k = 0; k < seg; k++) {
      const a = base + 1 + k;
      const b = base + 1 + ((k + 1) % seg);
      if (dir === 1) m.i.push(base, b, a);
      else m.i.push(base, a, b);
    }
  };
  if (capEnds) {
    cap(first[0], first[1], first[0] < last[0] ? -1 : 1);
    cap(last[0], last[1], first[0] < last[0] ? 1 : -1);
  }
  return m;
}

/** A tube along a polyline (Catmull-Rom smoothed) with optional per-end radii and flat caps. */
export function tube(points: readonly V3[], radius: number, opts: { seg?: number; steps?: number; r1?: number; smoothPath?: boolean } = {}): Mesh {
  const seg = opts.seg ?? 10;
  const per = opts.smoothPath === false ? 1 : (opts.steps ?? 6);
  const path: V3[] = [];
  const P = (k: number): V3 => points[Math.max(0, Math.min(points.length - 1, k))] as V3;
  for (let j = 0; j < points.length - 1; j++) {
    for (let s = 0; s < per; s++) {
      const t = s / per;
      const a = P(j - 1);
      const b = P(j);
      const c = P(j + 1);
      const d = P(j + 2);
      const f = (i: 0 | 1 | 2): number => (opts.smoothPath === false ? b[i] + (c[i] - b[i]) * t : 0.5 * (2 * b[i] + (-a[i] + c[i]) * t + (2 * a[i] - 5 * b[i] + 4 * c[i] - d[i]) * t * t + (-a[i] + 3 * b[i] - 3 * c[i] + d[i]) * t * t * t));
      path.push([f(0), f(1), f(2)]);
    }
  }
  path.push(points[points.length - 1] as V3);
  const m = mesh();
  let prevN: V3 = [0, 1, 0];
  const r1 = opts.r1 ?? radius;
  for (let j = 0; j < path.length; j++) {
    const a = path[Math.max(0, j - 1)] as V3;
    const b = path[Math.min(path.length - 1, j + 1)] as V3;
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    let tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    // Parallel-transport the frame.
    let nx = prevN[0];
    let ny = prevN[1];
    let nz = prevN[2];
    const dot = nx * tx + ny * ty + nz * tz;
    nx -= dot * tx;
    ny -= dot * ty;
    nz -= dot * tz;
    let nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-4) {
      nx = ty;
      ny = -tx;
      nz = 0;
      nl = Math.hypot(nx, ny, nz) || 1;
    }
    nx /= nl;
    ny /= nl;
    nz /= nl;
    prevN = [nx, ny, nz];
    const bx = ty * nz - tz * ny;
    const by = tz * nx - tx * nz;
    const bz = tx * ny - ty * nx;
    const r = radius + (r1 - radius) * (j / (path.length - 1));
    const c = path[j] as V3;
    for (let k = 0; k < seg; k++) {
      const ang = (k / seg) * Math.PI * 2;
      const ca = Math.cos(ang) * r;
      const sa = Math.sin(ang) * r;
      m.p.push(c[0] + nx * ca + bx * sa, c[1] + ny * ca + by * sa, c[2] + nz * ca + bz * sa);
    }
  }
  for (let j = 0; j < path.length - 1; j++) {
    for (let k = 0; k < seg; k++) {
      const a = j * seg + k;
      const b = j * seg + ((k + 1) % seg);
      const c = (j + 1) * seg + k;
      const d = (j + 1) * seg + ((k + 1) % seg);
      m.i.push(a, b, c, b, d, c);
    }
  }
  smooth(m);
  // Normals must face away from the axis; flip if the first ring points inward.
  const c0 = path[0] as V3;
  const dx = (m.p[0] as number) - c0[0];
  const dy = (m.p[1] as number) - c0[1];
  const dz = (m.p[2] as number) - c0[2];
  if (dx * (m.n[0] as number) + dy * (m.n[1] as number) + dz * (m.n[2] as number) < 0) {
    for (let t = 0; t < m.i.length; t += 3) {
      const b = m.i[t + 1] as number;
      m.i[t + 1] = m.i[t + 2] as number;
      m.i[t + 2] = b;
    }
    smooth(m);
  }
  // Round-ish ends: a flat cap on both.
  for (const [ring, centre, dirSign] of [[0, path[0] as V3, -1], [path.length - 1, path[path.length - 1] as V3, 1]] as const) {
    const base = m.p.length / 3;
    const pa = path[Math.max(0, ring === 0 ? 0 : ring - 1)] as V3;
    const pb = path[Math.min(path.length - 1, ring === 0 ? 1 : ring)] as V3;
    const tx = pb[0] - pa[0];
    const ty = pb[1] - pa[1];
    const tz = pb[2] - pa[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    m.p.push(centre[0], centre[1], centre[2]);
    m.n.push((tx / tl) * dirSign, (ty / tl) * dirSign, (tz / tl) * dirSign);
    for (let k = 0; k < seg; k++) {
      const v = (ring * seg + k) * 3;
      m.p.push(m.p[v] as number, m.p[v + 1] as number, m.p[v + 2] as number);
      m.n.push((tx / tl) * dirSign, (ty / tl) * dirSign, (tz / tl) * dirSign);
    }
    for (let k = 0; k < seg; k++) {
      const a = base + 1 + k;
      const b = base + 1 + ((k + 1) % seg);
      if (dirSign === 1) m.i.push(base, a, b);
      else m.i.push(base, b, a);
    }
  }
  return m;
}

/** Flat polygon extruded along Z (outline in X/Y, centred on z = 0 with `depth`). */
export function extrudeXY(outline: ReadonlyArray<readonly [number, number]>, depth: number): Mesh {
  const m = mesh();
  const n = outline.length;
  const hz = depth / 2;
  // Side walls with flat normals.
  for (let k = 0; k < n; k++) {
    const a = outline[k] as readonly [number, number];
    const b = outline[(k + 1) % n] as readonly [number, number];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const l = Math.hypot(ex, ey) || 1;
    const nx = ey / l;
    const ny = -ex / l;
    const base = m.p.length / 3;
    m.p.push(a[0], a[1], -hz, b[0], b[1], -hz, b[0], b[1], hz, a[0], a[1], hz);
    for (let q = 0; q < 4; q++) m.n.push(nx, ny, 0);
    m.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // Caps by ear clipping (outline is simple, counter-clockwise).
  const idx = outline.map((_, k) => k);
  const tris: Array<[number, number, number]> = [];
  const area = (a: number, b: number, c: number): number => {
    const A = outline[a] as readonly [number, number];
    const B = outline[b] as readonly [number, number];
    const C = outline[c] as readonly [number, number];
    return (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 2000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const a = idx[(k + idx.length - 1) % idx.length] as number;
      const b = idx[k] as number;
      const c = idx[(k + 1) % idx.length] as number;
      if (area(a, b, c) <= 1e-9) continue;
      let inside = false;
      for (const o of idx) {
        if (o === a || o === b || o === c) continue;
        if (area(a, b, o) >= 0 && area(b, c, o) >= 0 && area(c, a, o) >= 0) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      tris.push([a, b, c]);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) tris.push([idx[0] as number, idx[1] as number, idx[2] as number]);
  for (const side of [1, -1] as const) {
    const base = m.p.length / 3;
    for (const [x, y] of outline) {
      m.p.push(x, y, side * hz);
      m.n.push(0, 0, side);
    }
    for (const [a, b, c] of tris) {
      if (side === 1) m.i.push(base + a, base + b, base + c);
      else m.i.push(base + a, base + c, base + b);
    }
  }
  return m;
}

/**
 * A ribbon decal following the upper surface of a loft at fixed lateral offset `z` from x0 to x1 (half-width `w`),
 * lifted `lift` above it.
 */
export function topRibbon(secs: readonly Section[], x0: number, x1: number, z: number, w: number, lift = 0.004, steps = 40): Mesh {
  const m = mesh();
  for (let k = 0; k <= steps; k++) {
    const x = x0 + ((x1 - x0) * k) / steps;
    const s = sectionAt(secs, x);
    for (const zz of [z - w, z + w]) {
      const y = topY(s, Math.max(-s.hw * 0.995, Math.min(s.hw * 0.995, zz))) ?? s.y1;
      m.p.push(x, y + lift, zz);
    }
  }
  for (let k = 0; k < steps; k++) {
    const a = k * 2;
    m.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return smooth(m);
}

/** A disc-shaped decal on the side surface (z > 0 side when `side` is 1) of a loft, centred at (cx, cy). */
export function sideDisc(secs: readonly Section[], cx: number, cy: number, radius: number, side: 1 | -1, lift = 0.004, rings = 5, seg = 28, squashY = 1): Mesh {
  const m = mesh();
  const point = (px: number, py: number): V3 => {
    const s = sectionAt(secs, px);
    const y = Math.min(s.y1 - 0.01, Math.max(s.y0 + 0.01, py));
    const z = sideZ(s, y);
    const zz = z === null ? s.hw : z;
    return [px, y, side * (zz + lift)];
  };
  const c = point(cx, cy);
  m.p.push(c[0], c[1], c[2]);
  for (let r = 1; r <= rings; r++) {
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const q = point(cx + Math.cos(a) * radius * (r / rings), cy + Math.sin(a) * radius * (r / rings) * squashY);
      m.p.push(q[0], q[1], q[2]);
    }
  }
  for (let k = 0; k < seg; k++) m.i.push(0, 1 + k, 1 + ((k + 1) % seg));
  for (let r = 1; r < rings; r++) {
    for (let k = 0; k < seg; k++) {
      const a = 1 + (r - 1) * seg + k;
      const b = 1 + (r - 1) * seg + ((k + 1) % seg);
      const c2 = 1 + r * seg + k;
      const d = 1 + r * seg + ((k + 1) % seg);
      m.i.push(a, b, c2, b, d, c2);
    }
  }
  if (side === -1) for (let t = 0; t < m.i.length; t += 3) [m.i[t + 1], m.i[t + 2]] = [m.i[t + 2] as number, m.i[t + 1] as number];
  smooth(m);
  // Decals face outward: orient normals by side.
  for (let k = 0; k < m.n.length; k += 3) if ((m.n[k + 2] as number) * side < 0) {
    m.n[k] = -(m.n[k] as number);
    m.n[k + 1] = -(m.n[k + 1] as number);
    m.n[k + 2] = -(m.n[k + 2] as number);
  }
  return m;
}

/** A ribbon decal on the side surface along a polyline of (x, y) points, width `w` (door seams, trim lines). */
export function sideLine(secs: readonly Section[], pts: ReadonlyArray<readonly [number, number]>, w: number, side: 1 | -1, lift = 0.003): Mesh {
  const m = mesh();
  for (let k = 0; k < pts.length; k++) {
    const [x, y] = pts[k] as readonly [number, number];
    const a = pts[Math.max(0, k - 1)] as readonly [number, number];
    const b = pts[Math.min(pts.length - 1, k + 1)] as readonly [number, number];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    for (const sgn of [-1, 1]) {
      const px = x - ty * w * sgn;
      const py = y + tx * w * sgn;
      const s = sectionAt(secs, px);
      const z = sideZ(s, py) ?? s.hw;
      m.p.push(px, py, side * (z + lift));
    }
  }
  for (let k = 0; k < pts.length - 1; k++) {
    const a = k * 2;
    if (side === 1) m.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    else m.i.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  smooth(m);
  for (let k = 0; k < m.n.length; k += 3) if ((m.n[k + 2] as number) * side < 0) {
    m.n[k] = -(m.n[k] as number);
    m.n[k + 1] = -(m.n[k + 1] as number);
    m.n[k + 2] = -(m.n[k + 2] as number);
  }
  return m;
}

/** Axis-aligned bounds of a mesh. */
export function bounds(m: Mesh): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < m.p.length; k += 3) {
    for (let a = 0; a < 3; a++) {
      const v = m.p[k + a] as number;
      if (v < min[a]!) min[a] = v;
      if (v > max[a]!) max[a] = v;
    }
  }
  return { min, max };
}
