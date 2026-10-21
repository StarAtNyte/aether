/**
 * Ceiling styles and crown moulding for rectangular rooms (see `shell.ts` and `CeilingParams`).
 *
 * Frame: the entity sits at the ceiling plane (y = 0). The polygon runs to the wall centrelines; `faces` is the rectangle
 * of the INSIDE faces of the walls (the wall bodies hide whatever lies between the two). Styles:
 * - coved: a concave quarter-round of radius `rise` (default 0.25 m) sweeps from the wall (y = -radius) up into the flat field at y = 0.
 * - barrel: a circular-arc vault, crown at y = 0, eaves `rise` (default 0.8 m) lower at the polygon edge, axis `ridge`.
 * - coffered: ribs at y = 0 in a nx by nz grid inside a border of one rib width; the panels are recessed UP by `depth`.
 * - beamed: flat field with `count` beams hanging `depth` below it.
 * - tray: a border at y = 0 and a central field raised by `drop`, inset `inset` from the faces.
 * - cornice (all of these but barrel; flat and vaulted too): a mitred ring round the faces, `height` down the wall, `depth` into the room.
 * Vaulted (gable) ceilings are built in `elements.ts` and carry no cornice.
 */
import { Geom, box } from './mesh';
import { PartSet } from './parts';
import { bounds, type P2 } from './math2';
import type { CeilingParams } from './params';
import type { CorniceProfile } from './shell';

type Rect = readonly [number, number, number, number];
type Cornice = NonNullable<CeilingParams['cornice']>;

/** The inside-face rectangle of a ceiling: `faces`, else the polygon bounds pulled in by a typical interior wall half-thickness. */
export function ceilingFaces(p: Pick<CeilingParams, 'polygon' | 'faces'>): Rect {
  if (p.faces) {
    const [a, b, c, d] = p.faces;
    return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
  }
  const [x0, z0, x1, z1] = bounds(p.polygon);
  return [x0 + 0.06, z0 + 0.06, x1 - 0.06, z1 - 0.06];
}

type Pt2 = readonly [number, number];

/** Inward unit direction (x, z) of each side of a rectangle: north (z0), east (x1), south (z1), west (x0). */
const INWARD: ReadonlyArray<Pt2> = [[0, 1], [-1, 0], [0, -1], [1, 0]];

/** The rectangle's corner `k` (0: x0,z0; 1: x1,z0; 2: x1,z1; 3: x0,z1) shrunk by `d` on every side. */
function corner(r: Rect, d: number, k: number): P2 {
  const [x0, z0, x1, z1] = r;
  return k === 0 ? [x0 + d, z0 + d] : k === 1 ? [x1 - d, z0 + d] : k === 2 ? [x1 - d, z1 - d] : [x0 + d, z1 - d];
}

/**
 * Sweep a profile round a rectangle. The profile is a polyline of `[d, y]` (d: distance into the room from the face; y: height
 * relative to the ceiling plane) listed from the wall towards the room, so that the open side of the surface (the side that
 * is seen) is to the right of the direction of travel (normal `(Δy, -Δd)`). Sides share the mitre of the shrinking rectangle.
 * `smooth` averages the normals of consecutive segments (curved profiles).
 */
export function sweepProfile(g: Geom, rect: Rect, profile: ReadonlyArray<Pt2>, smooth: boolean): void {
  const seg: Array<{ n: Pt2; len: number }> = [];
  for (let j = 0; j + 1 < profile.length; j++) {
    const a = profile[j] as Pt2;
    const b = profile[j + 1] as Pt2;
    const dd = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dd, dy);
    seg.push(len < 1e-9 ? { n: [0, -1], len: 0 } : { n: [dy / len, -dd / len], len });
  }
  const norm = (n: Pt2): Pt2 => {
    const l = Math.hypot(n[0], n[1]) || 1;
    return [n[0] / l, n[1] / l];
  };
  for (let k = 0; k < 4; k++) {
    const dir = INWARD[k] as Pt2;
    const horizontalU = k % 2 === 0;
    let v = 0;
    for (let j = 0; j < seg.length; j++) {
      const s = seg[j] as { n: Pt2; len: number };
      if (s.len === 0) continue;
      const a = profile[j] as Pt2;
      const b = profile[j + 1] as Pt2;
      const na = smooth && j > 0 ? norm([(seg[j - 1] as { n: Pt2 }).n[0] + s.n[0], (seg[j - 1] as { n: Pt2 }).n[1] + s.n[1]]) : s.n;
      const nb = smooth && j + 1 < seg.length ? norm([(seg[j + 1] as { n: Pt2 }).n[0] + s.n[0], (seg[j + 1] as { n: Pt2 }).n[1] + s.n[1]]) : s.n;
      const c0a = corner(rect, a[0], k);
      const c1a = corner(rect, a[0], (k + 1) % 4);
      const c0b = corner(rect, b[0], k);
      const c1b = corner(rect, b[0], (k + 1) % 4);
      const u0a = horizontalU ? c0a[0] : c0a[1];
      const u1a = horizontalU ? c1a[0] : c1a[1];
      const u0b = horizontalU ? c0b[0] : c0b[1];
      const u1b = horizontalU ? c1b[0] : c1b[1];
      const emit = (c: P2, y: number, n: Pt2, u: number, vv: number): number => g.vertex(c[0], y, c[1], dir[0] * n[0], n[1], dir[1] * n[0], u, vv);
      const i0 = emit(c0a, a[1], na, u0a, v);
      const i1 = emit(c1a, a[1], na, u1a, v);
      const i2 = emit(c1b, b[1], nb, u1b, v + s.len);
      const i3 = emit(c0b, b[1], nb, u0b, v + s.len);
      // Winding: the triangle's geometric normal must agree with the intended (segment) normal.
      const P = (i: number): number[] => [g.p[i * 3] as number, g.p[i * 3 + 1] as number, g.p[i * 3 + 2] as number];
      const A = P(i0);
      const B = P(i1);
      const C = P(i2);
      const e1 = [B[0]! - A[0]!, B[1]! - A[1]!, B[2]! - A[2]!];
      const e2 = [C[0]! - A[0]!, C[1]! - A[1]!, C[2]! - A[2]!];
      const cx = e1[1]! * e2[2]! - e1[2]! * e2[1]!;
      const cy = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
      const cz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
      const want = [dir[0] * s.n[0], s.n[1], dir[1] * s.n[0]];
      if (cx * want[0]! + cy * want[1]! + cz * want[2]! >= 0) g.tri(i0, i1, i2).tri(i0, i2, i3);
      else g.tri(i0, i2, i1).tri(i0, i3, i2);
      v += s.len;
    }
  }
}

/** The profile of a cornice, from the wall (d = 0) to the ceiling (y = 0). Starts 4 mm inside the wall so it closes to the face. */
export function corniceProfile(kind: CorniceProfile, h: number, D: number): { points: Pt2[]; smooth: boolean } {
  const arc = (d0: number, y0: number, d1: number, y1: number, n: number): Pt2[] => {
    const out: Pt2[] = [];
    for (let k = 0; k <= n; k++) {
      const t = ((k / n) * Math.PI) / 2;
      out.push([d0 + (d1 - d0) * (1 - Math.cos(t)), y0 + (y1 - y0) * Math.sin(t)]);
    }
    return out;
  };
  switch (kind) {
    case 'plain':
      return { points: [[-0.004, -h], [D, -h], [D, 0]], smooth: false };
    case 'stepped':
      return { points: [[-0.004, -h], [0.3 * D, -h], [0.3 * D, -0.62 * h], [0.62 * D, -0.62 * h], [0.62 * D, -0.3 * h], [D, -0.3 * h], [D, 0]], smooth: false };
    case 'cove':
      return { points: [[-0.004, -h], ...arc(0, -h, D, 0, 10).slice(0)], smooth: true };
    case 'classic':
      return { points: [[-0.004, -h], [0.18 * D, -h], [0.18 * D, -0.86 * h], [0.3 * D, -0.86 * h], ...arc(0.3 * D, -0.86 * h, 0.9 * D, -0.12 * h, 8).slice(1), [D, -0.12 * h], [D, 0]], smooth: false };
  }
}

/** Mitred crown moulding round the wall faces. */
function addCornice(set: PartSet, p: CeilingParams, cornice: Cornice, defaultColor: string): void {
  const rect = ceilingFaces(p);
  const maxD = Math.max(0.01, Math.min(rect[2] - rect[0], rect[3] - rect[1]) / 2 - 0.05);
  const { points, smooth } = corniceProfile(cornice.profile, cornice.height, Math.min(cornice.depth, maxD));
  const g = new Geom();
  sweepProfile(g, rect, points, smooth);
  set.add(g, { finish: 'paint', color: cornice.color ?? defaultColor });
}

const rectPoly = (r: Rect): P2[] => [
  [r[0], r[1]],
  [r[2], r[1]],
  [r[2], r[3]],
  [r[0], r[3]],
];

/** A vertical quad from `a` to `b` between two heights, facing the point `toward`. */
function wall(g: Geom, a: P2, b: P2, y0: number, y1: number, toward: P2): void {
  // Normal candidates ±(dz, -dx): take the one pointing at `toward`.
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const mx = (a[0] + b[0]) / 2;
  const mz = (a[1] + b[1]) / 2;
  const sgn = dz * (toward[0] - mx) - dx * (toward[1] - mz) >= 0 ? 1 : -1;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  const n = [(sgn * dz) / len, 0, (-sgn * dx) / len];
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  const c = [
    [a[0], lo, a[1]],
    [b[0], lo, b[1]],
    [b[0], hi, b[1]],
    [a[0], hi, a[1]],
  ];
  const uv = [0, lo, len, lo, len, hi, 0, hi];
  // quad() wants counter-clockwise corners seen from the front: reverse when the winding disagrees with the normal.
  const ex = [dx, 0, dz];
  const ey = [0, 1, 0];
  const nx = ex[1]! * ey[2]! - ex[2]! * ey[1]!;
  const nz = ex[0]! * ey[1]! - ex[1]! * ey[0]!;
  if (nx * n[0]! + nz * n[2]! >= 0) g.quad(c[0]!, c[1]!, c[2]!, c[3]!, n, uv);
  else g.quad(c[1]!, c[0]!, c[3]!, c[2]!, n, [len, lo, 0, lo, 0, hi, len, hi]);
}

/** Vertical returns round a rectangular recess (they face its centre). */
function recessReturns(g: Geom, r: Rect, y0: number, y1: number): void {
  const c: P2 = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
  const pts = rectPoly(r);
  for (let k = 0; k < 4; k++) wall(g, pts[k] as P2, pts[(k + 1) % 4] as P2, y0, y1, c);
}

/** Emit the recessed downlights; `lift(x, z)` is the height of the ceiling surface they sit in. */
function addDownlights(set: PartSet, p: CeilingParams, lift: (x: number, z: number) => number): void {
  if (p.downlights.length === 0) return;
  const trim = new Geom();
  const lens = new Geom();
  for (const [x, z] of p.downlights) {
    const y0 = lift(x, z);
    trim.merge(boxRing(x, z, y0));
    const ring: P2[] = [];
    for (let k = 0; k < 20; k++) ring.push([x + Math.cos((k / 20) * Math.PI * 2) * 0.046, z + Math.sin((k / 20) * Math.PI * 2) * 0.046]);
    lens.flatPolygon(ring, y0 - 0.0145, false);
  }
  set.add(trim, { finish: 'paint', color: '#f6f4f0', roughness: 0.4 });
  set.add(lens, { preset: 'emissive', color: '#ffe6c2', emissive: '#ffe0b0', emissiveIntensity: p.lit ? 1.5 : 0, roughness: 0.3 });
}

/** A trim ring (a low 20-sided prism) under a downlight. */
function boxRing(x: number, z: number, y0: number): Geom {
  const g = new Geom();
  const n = 20;
  const r = 0.062;
  const top = y0;
  const bot = y0 - 0.014;
  const ring: P2[] = [];
  for (let k = 0; k < n; k++) ring.push([x + Math.cos((k / n) * Math.PI * 2) * r, z + Math.sin((k / n) * Math.PI * 2) * r]);
  g.flatPolygon(ring, bot, false);
  for (let k = 0; k < n; k++) {
    const a = ring[k] as P2;
    const b = ring[(k + 1) % n] as P2;
    const m: P2 = [x, z];
    // Outward facing side quad: `wall` points at `toward`, so aim away from the axis through a far point.
    wall(g, a, b, bot, top, [m[0] + (a[0] + b[0] - 2 * m[0]) * 10, m[1] + (a[1] + b[1] - 2 * m[1]) * 10]);
  }
  return g;
}

const inside = (r: Rect, x: number, z: number): boolean => x > r[0] && x < r[2] && z > r[1] && z < r[3];

/** The ribbon of a beam or rib that follows a height function across the room (used by barrel ribs). */
function archRib(g: Geom, w: number, width: number, depth: number, axisZ: boolean, u0: number, u1: number, yAt: (u: number) => number, n: number): void {
  const pt = (u: number, y: number, ww: number): [number, number, number] => (axisZ ? [u, y, ww] : [ww, y, u]);
  const hw = width / 2;
  for (let k = 0; k < n; k++) {
    const ua = u0 + ((u1 - u0) * k) / n;
    const ub = u0 + ((u1 - u0) * (k + 1)) / n;
    const ya = yAt(ua);
    const yb = yAt(ub);
    // Underside and the two faces; the top lies against the vault.
    const under = [pt(ua, ya - depth, -hw + w), pt(ub, yb - depth, -hw + w), pt(ub, yb - depth, hw + w), pt(ua, ya - depth, hw + w)];
    downFacing(g, under[0]!, under[1]!, under[2]!, under[3]!, [0, -1, 0]);
    const side = (s: 1 | -1): void => {
      const lo = [pt(ua, ya - depth, s * hw + w), pt(ub, yb - depth, s * hw + w)];
      const hi = [pt(ua, ya, s * hw + w), pt(ub, yb, s * hw + w)];
      const nrm = axisZ ? [0, 0, s] : [s, 0, 0];
      downFacing(g, lo[0]!, lo[1]!, hi[1]!, hi[0]!, nrm);
    };
    side(-1);
    side(1);
  }
}

/** A quad wound to face `hint`, whatever order its corners come in. */
function downFacing(g: Geom, c0: readonly number[], c1: readonly number[], c2: readonly number[], c3: readonly number[], hint: readonly number[]): void {
  const ex = [c1[0]! - c0[0]!, c1[1]! - c0[1]!, c1[2]! - c0[2]!];
  const ey = [c3[0]! - c0[0]!, c3[1]! - c0[1]!, c3[2]! - c0[2]!];
  const nx = ex[1]! * ey[2]! - ex[2]! * ey[1]!;
  const ny = ex[2]! * ey[0]! - ex[0]! * ey[2]!;
  const nz = ex[0]! * ey[1]! - ex[1]! * ey[0]!;
  if (nx * hint[0]! + ny * hint[1]! + nz * hint[2]! >= 0) g.quadAuto(c0, c1, c2, c3);
  else g.quadAuto(c0, c3, c2, c1);
}

/** Build a styled ceiling (style other than flat/vaulted). Returns the filled part set (without the cornice, added by the caller). */
export function buildStyledCeilingParts(p: CeilingParams, set: PartSet): void {
  const style = p.style ?? 'flat';
  const [px0, pz0, px1, pz1] = bounds(p.polygon);
  const faces = ceilingFaces(p);
  const finishColor = (p.finish.color ?? '#f4f2ee');
  const beamMaterial = p.beamColor ? { finish: 'paint' as const, color: p.beamColor } : undefined;

  if (style === 'barrel') {
    const rise = p.rise ?? 0.8;
    const alongZ = (p.ridge ?? (px1 - px0 >= pz1 - pz0 ? 'x' : 'z')) === 'z';
    // u runs across the axis, w along it.
    const [u0, u1, w0, w1] = alongZ ? [px0, px1, pz0, pz1] : [pz0, pz1, px0, px1];
    const span = u1 - u0;
    const R = (span * span) / 4 / rise / 2 + rise / 2;
    const um = (u0 + u1) / 2;
    const yAt = (u: number): number => -rise + (Math.sqrt(Math.max(0, R * R - (u - um) * (u - um))) - (R - rise));
    const g = new Geom();
    const n = 16;
    const pt = (u: number, w: number): [number, number, number] => (alongZ ? [u, yAt(u), w] : [w, yAt(u), u]);
    for (let k = 0; k <= n; k++) {
      const u = u0 + (span * k) / n;
      const slope = (u - um) / Math.sqrt(Math.max(1e-9, R * R - (u - um) * (u - um)));
      const l = Math.hypot(slope, 1);
      // Downward facing: (y', -1) in the (u, y) plane, with y' = -(u - um)/sqrt(..).
      const nu = -slope / l;
      const ny = -1 / l;
      for (const w of [w0, w1]) {
        const q = pt(u, w);
        g.vertex(q[0], q[1], q[2], alongZ ? nu : 0, ny, alongZ ? 0 : nu, alongZ ? u : w, alongZ ? w : u);
      }
    }
    for (let k = 0; k < n; k++) {
      const a = k * 2;
      // Order chosen to face down for both axes.
      if (alongZ) g.tri(a, a + 1, a + 3).tri(a, a + 3, a + 2);
      else g.tri(a, a + 3, a + 1).tri(a, a + 2, a + 3);
    }
    // Make sure the winding agrees with the normals (axis-dependent): flip when the first triangle faces up.
    const faceY = triNormalY(g, 0);
    if (faceY > 0) for (let t = 0; t < g.i.length; t += 3) swap(g.i, t + 1, t + 2);
    set.add(g, p.finish);
    const ribs = p.trusses ?? 0;
    if (ribs > 0) {
      const rg = new Geom();
      const step = (w1 - w0) / (ribs + 1);
      for (let r = 1; r <= ribs; r++) archRib(rg, w0 + step * r, 0.08, 0.14, alongZ, u0, u1, yAt, 16);
      set.add(rg, beamMaterial ?? { finish: 'paint', color: finishColor });
    }
    addDownlights(set, p, (x, z) => (alongZ ? yAt(x) : yAt(z)));
    return;
  }

  if (style === 'coved') {
    const r = Math.min(p.rise ?? 0.25, 0.45 * Math.min(faces[2] - faces[0], faces[3] - faces[1]));
    const profile: Pt2[] = [];
    for (let k = 0; k <= 10; k++) {
      const t = ((k / 10) * Math.PI) / 2;
      profile.push([r - r * Math.cos(t), -r + r * Math.sin(t)]);
    }
    const g = new Geom();
    sweepProfile(g, faces, [[-0.004, -r], ...profile], true);
    set.add(g, p.finish);
    set.add(new Geom().flatPolygon(p.polygon as P2[], 0, false, p.holes as P2[][]), p.finish);
    addDownlights(set, p, () => 0);
    return;
  }

  if (style === 'coffered') {
    const c = p.coffers ?? { nx: 3, nz: 3, rib: 0.12, depth: 0.12 };
    const W = faces[2] - faces[0];
    const D = faces[3] - faces[1];
    const rib = c.rib;
    let nx = c.nx;
    let nz = c.nz;
    while (nx > 1 && (W - (nx + 1) * rib) / nx < 0.15) nx--;
    while (nz > 1 && (D - (nz + 1) * rib) / nz < 0.15) nz--;
    const pw = (W - (nx + 1) * rib) / nx;
    const pd = (D - (nz + 1) * rib) / nz;
    const panels: Rect[] = [];
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const x0 = faces[0] + rib + i * (pw + rib);
        const z0 = faces[1] + rib + j * (pd + rib);
        panels.push([x0, z0, x0 + pw, z0 + pd]);
      }
    const holes = panels.map(rectPoly);
    const ribMat = beamMaterial ?? p.finish;
    // Rim outside the faces (hidden by the walls), ribs inside, panels and returns.
    set.add(new Geom().flatPolygon(p.polygon as P2[], 0, false, [rectPoly(faces)]), p.finish);
    set.add(new Geom().flatPolygon(rectPoly(faces), 0, false, holes), ribMat);
    const returns = new Geom();
    const pg = new Geom();
    for (const r of panels) {
      pg.flatPolygon(rectPoly(r), c.depth, false);
      recessReturns(returns, r, 0, c.depth);
    }
    set.add(pg, p.finish);
    set.add(returns, ribMat);
    addDownlights(set, p, (x, z) => (panels.some((r) => inside(r, x, z)) ? c.depth : 0));
    return;
  }

  if (style === 'tray') {
    const t = p.tray ?? { inset: 0.5, drop: 0.12 };
    const inset = Math.min(t.inset, 0.4 * Math.min(faces[2] - faces[0], faces[3] - faces[1]));
    const field: Rect = [faces[0] + inset, faces[1] + inset, faces[2] - inset, faces[3] - inset];
    set.add(new Geom().flatPolygon(p.polygon as P2[], 0, false, [rectPoly(field)]), p.finish);
    set.add(new Geom().flatPolygon(rectPoly(field), t.drop, false), p.finish);
    const returns = new Geom();
    recessReturns(returns, field, 0, t.drop);
    set.add(returns, p.finish);
    addDownlights(set, p, (x, z) => (inside(field, x, z) ? t.drop : 0));
    return;
  }

  // beamed (and any other style that keeps the flat field).
  set.add(new Geom().flatPolygon(p.polygon as P2[], 0, false, p.holes as P2[][]), p.finish);
  if (style === 'beamed') {
    const b = p.beams ?? { count: 4, width: 0.15, depth: 0.2 };
    const W = faces[2] - faces[0];
    const D = faces[3] - faces[1];
    // `dir` is the direction the beams run; by default they span the shorter side.
    const runsZ = (b.dir ?? (W >= D ? 'z' : 'x')) === 'z';
    const bg = new Geom();
    for (let k = 1; k <= b.count; k++) {
      const f = k / (b.count + 1);
      if (runsZ) {
        const x = faces[0] + W * f;
        bg.merge(box(x - b.width / 2, -b.depth, faces[1] - 0.02, x + b.width / 2, 0, faces[3] + 0.02, { top: false }));
      } else {
        const z = faces[1] + D * f;
        bg.merge(box(faces[0] - 0.02, -b.depth, z - b.width / 2, faces[2] + 0.02, 0, z + b.width / 2, { top: false }));
      }
    }
    set.add(bg, beamMaterial ?? { finish: 'oak' });
  }
  addDownlights(set, p, () => 0);
}

/** Y component of the geometric normal of triangle `t` (index of its first vertex slot / 3). */
function triNormalY(g: Geom, t: number): number {
  const a = g.i[t * 3] as number;
  const b = g.i[t * 3 + 1] as number;
  const c = g.i[t * 3 + 2] as number;
  const P = (i: number): number[] => [g.p[i * 3] as number, g.p[i * 3 + 1] as number, g.p[i * 3 + 2] as number];
  const A = P(a);
  const B = P(b);
  const C = P(c);
  return (B[2]! - A[2]!) * (C[0]! - A[0]!) - (B[0]! - A[0]!) * (C[2]! - A[2]!);
}

function swap(arr: number[], i: number, j: number): void {
  const t = arr[i] as number;
  arr[i] = arr[j] as number;
  arr[j] = t;
}

/** Add the cornice of a ceiling (no-op without one, or on a barrel / vaulted ceiling). */
export function addCeilingCornice(set: PartSet, p: CeilingParams): void {
  if (!p.cornice || p.style === 'barrel' || p.style === 'vaulted' || p.style === 'coved' || p.vault) return;
  addCornice(set, p, p.cornice, p.finish.color ?? '#f4f2ee');
}
