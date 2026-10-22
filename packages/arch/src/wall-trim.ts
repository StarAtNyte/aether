/**
 * Wall details that sit on or in a wall face: skirting profiles, picture rails, moulded dado panelling (shaker, raised,
 * batten, bead-board) and niches. All of it is built from the wall's local frame (see `wall.ts`): the wall runs along +X,
 * side A faces −Z (its face is at z = −t), side B faces +Z (z = +t), `t` is half the thickness.
 *
 * Everything here is optional. `buildWall` calls these only when a wall carries the matching params, so a wall without
 * them is byte-identical to the walls built before the vocabulary existed.
 */
import { Geom, box } from './mesh';
import type { SkirtingProfile } from './shell';
import type { OpeningSpan } from './wall';

/** A point of a moulding cross-section: distance proud of the wall face, height. */
export type ProfilePoint = readonly [number, number];

/** Most moulding strips (frames, battens, beads) one wall face may carry; panels thin out beyond it. */
export const MAX_TRIM_STRIPS = 400;
/** Free clearance between a panel frame and an opening or a wall end (metres). */
export const PANEL_CLEARANCE = 0.06;

type V3 = readonly [number, number, number];

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A quad whose front faces `n` (corners in any order round the quad); metric UVs. */
export function quadN(g: Geom, c0: V3, c1: V3, c2: V3, c3: V3, n: V3): void {
  const c = cross(sub(c1, c0), sub(c3, c0));
  if (dot(c, n) >= 0) g.quadAuto(c0, c1, c2, c3);
  else g.quadAuto(c0, c3, c2, c1);
}

/** A quad whose front faces away from `centre` (for the sides of a convex solid). */
export function quadOut(g: Geom, c0: V3, c1: V3, c2: V3, c3: V3, centre: V3): void {
  const mid: V3 = [(c0[0] + c1[0] + c2[0] + c3[0]) / 4, (c0[1] + c1[1] + c2[1] + c3[1]) / 4, (c0[2] + c1[2] + c2[2] + c3[2]) / 4];
  quadN(g, c0, c1, c2, c3, sub(mid, centre));
}

/** A triangle whose front faces `n`; UVs are the position projected on the plane most facing `n` (metres). */
export function triN(g: Geom, a: V3, b: V3, c: V3, n: V3): void {
  const cr = cross(sub(b, a), sub(c, a));
  const flip = dot(cr, n) < 0;
  const len = Math.hypot(cr[0], cr[1], cr[2]);
  if (!(len > 1e-12)) return;
  const nn: V3 = flip ? [-cr[0] / len, -cr[1] / len, -cr[2] / len] : [cr[0] / len, cr[1] / len, cr[2] / len];
  const ax = Math.abs(nn[0]);
  const ay = Math.abs(nn[1]);
  const az = Math.abs(nn[2]);
  const uv = (p: V3): [number, number] => (az >= ax && az >= ay ? [p[0], p[1]] : ax >= ay ? [p[2], p[1]] : [p[0], p[2]]);
  const order = flip ? [a, c, b] : [a, b, c];
  const ids = order.map((p) => {
    const [u, v] = uv(p);
    return g.vertex(p[0], p[1], p[2], nn[0], nn[1], nn[2], u, v);
  });
  g.tri(ids[0] as number, ids[1] as number, ids[2] as number);
}

/** Cross-section of a skirting board of `height` and `depth` (from the floor up; the last point is on the wall face). */
export function skirtingSection(profile: SkirtingProfile, height: number, depth: number): ProfilePoint[] {
  const h = Math.max(0.02, height);
  const D = Math.max(0.004, depth);
  switch (profile) {
    case 'square':
      return [[D, 0], [D, h], [0, h]];
    case 'bevel': {
      const c = Math.min(D * 0.85, h * 0.25);
      return [[D, 0], [D, h - c], [D - c, h], [0, h]];
    }
    case 'ogee': {
      const y1 = h * 0.58;
      const pts: ProfilePoint[] = [[D, 0], [D, y1]];
      const steps = 5;
      for (let k = 1; k <= steps; k++) {
        const s = k / steps;
        pts.push([D * (1 - s * s * (3 - 2 * s)), y1 + (h - y1) * s]);
      }
      return pts;
    }
    case 'stepped':
      return [[D, 0], [D, h * 0.6], [D * 0.5, h * 0.6], [D * 0.5, h], [0, h]];
  }
}

/** Cross-section of a picture rail: a stem with a lip, `0.045` tall, `0.03` proud, bottom at height 0. */
export function pictureRailSection(): ProfilePoint[] {
  return [[0.012, 0], [0.012, 0.02], [0.03, 0.028], [0.03, 0.045], [0, 0.045]];
}

/**
 * Extrude a cross-section along a wall face from x0 to x1. `section` runs from the bottom front point up to the point on
 * the wall face; the run is lifted by `y`. Ends are capped (a run stopping at a doorway shows its profile).
 */
export function extrudeProfile(g: Geom, x0: number, x1: number, side: -1 | 1, t: number, section: readonly ProfilePoint[], y = 0): void {
  if (x1 - x0 < 1e-4 || section.length < 2) return;
  const z = (d: number): number => side * (t + d);
  for (let k = 0; k + 1 < section.length; k++) {
    const [d1, y1] = section[k] as ProfilePoint;
    const [d2, y2] = section[k + 1] as ProfilePoint;
    // Outward normal of the segment in the (d, y) plane: perpendicular to (d2-d1, y2-y1), pointing away from the wall.
    const nd = y2 - y1;
    const nyy = -(d2 - d1);
    quadN(g, [x0, y + y1, z(d1)], [x1, y + y1, z(d1)], [x1, y + y2, z(d2)], [x0, y + y2, z(d2)], [0, nyy, side * nd]);
  }
  // End caps: a fan from the middle of the wall-face edge of the section.
  const ys = section.map((p) => p[1]);
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const poly: ProfilePoint[] = [[0, 0], ...section];
  for (const [x, nxs] of [[x0, -1], [x1, 1]] as const) {
    for (let k = 0; k + 1 < poly.length; k++) {
      const a = poly[k] as ProfilePoint;
      const b = poly[k + 1] as ProfilePoint;
      triN(g, [x, y + cy, z(0)], [x, y + a[1], z(a[0])], [x, y + b[1], z(b[0])], [nxs, 0, 0]);
    }
  }
}

/** Solid intervals of x in [a, b] not covered by the (x-sorted) spans whose height range meets [yLo, yHi], with clearance. */
export function freeStretches(spans: readonly OpeningSpan[], a: number, b: number, yLo: number, yHi: number, clearance: number): Array<[number, number]> {
  const blocked = spans
    .filter((s) => s.y1 > yLo && s.y0 < yHi)
    .map((s) => [s.x0 - clearance, s.x1 + clearance] as [number, number])
    .sort((p, q) => p[0] - q[0]);
  const out: Array<[number, number]> = [];
  let x = a;
  for (const [b0, b1] of blocked) {
    if (b0 > x) out.push([x, Math.min(b0, b)]);
    x = Math.max(x, b1);
  }
  if (x < b) out.push([x, b]);
  return out.filter(([p, q]) => q - p > 1e-4);
}

/** A strip standing proud of the face on side `side`: x0..x1, y0..y1, `proud` metres. */
function strip(g: Geom, x0: number, y0: number, x1: number, y1: number, side: -1 | 1, t: number, proud: number): void {
  const z0 = side < 0 ? -t - proud : t;
  const z1 = side < 0 ? -t : t + proud;
  g.merge(box(x0, y0, z0, x1, y1, z1, { bottom: true }));
}

/** A raised panel: a frustum whose base is the rectangle on the face and whose top is `bevel` smaller and `proud` high. */
function raisedPanel(g: Geom, x0: number, y0: number, x1: number, y1: number, side: -1 | 1, t: number, proud: number, bevel: number): void {
  const zf = side * t;
  const zt = side * (t + proud);
  const b = Math.min(bevel, (x1 - x0) / 3, (y1 - y0) / 3);
  const base: V3[] = [[x0, y0, zf], [x1, y0, zf], [x1, y1, zf], [x0, y1, zf]];
  const top: V3[] = [[x0 + b, y0 + b, zt], [x1 - b, y0 + b, zt], [x1 - b, y1 - b, zt], [x0 + b, y1 - b, zt]];
  const centre: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, zf];
  quadN(g, top[0] as V3, top[1] as V3, top[2] as V3, top[3] as V3, [0, 0, side]);
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    quadOut(g, base[k] as V3, base[k2] as V3, top[k2] as V3, top[k] as V3, centre);
  }
}

/** What {@link panelDetail} needs to know about one dressed face. */
export interface PanelFace {
  style: 'shaker' | 'raised' | 'batten' | 'beadboard';
  /** Panel bays per 3 m of wall. */
  panels: number;
  side: -1 | 1;
  t: number;
  /** x extent of the face. */
  x0: number;
  x1: number;
  /** Top of the covering (the dado height, or the wall height for full-height panelling). */
  top: number;
  /** Skirting height under the covering. */
  skirt: number;
  /** A chair rail runs along the top. */
  rail: boolean;
  /** Openings and niches on this face (they interrupt the moulding). */
  spans: readonly OpeningSpan[];
}

/**
 * Moulded dressing of a dado face: returns the geometry (in the dado's material) and the number of strips it used.
 * Frames break at openings and keep {@link PANEL_CLEARANCE} clear of them and of the wall ends.
 */
export function panelDetail(f: PanelFace): Geom {
  const g = new Geom();
  const bottom = f.skirt + 0.03;
  const top = f.top - (f.rail ? 0.07 : 0.04);
  if (top - bottom < 0.2) return g;
  const free = freeStretches(f.spans, f.x0 + PANEL_CLEARANCE, f.x1 - PANEL_CLEARANCE, 0, f.top, PANEL_CLEARANCE);
  if (f.style === 'batten' || f.style === 'beadboard') {
    const bead = f.style === 'beadboard';
    const width = bead ? 0.012 : 0.045;
    const proud = bead ? 0.006 : 0.012;
    let pitch = bead ? 0.07 : 0.2;
    const lo = f.style === 'batten' ? bottom : f.skirt + 0.01;
    const hi = f.style === 'batten' ? top : f.top - (f.rail ? 0.045 : 0.01);
    const total = (p: number): number => free.reduce((s, [a, b]) => s + Math.max(0, Math.floor((b - a - width) / p) + 1), 0);
    while (total(pitch) > MAX_TRIM_STRIPS) pitch *= 1.25;
    for (const [a, b] of free) {
      const n = Math.max(0, Math.floor((b - a - width) / pitch) + 1);
      if (n === 0) continue;
      // Centre the row in the stretch.
      const used = (n - 1) * pitch + width;
      const start = a + (b - a - used) / 2;
      for (let k = 0; k < n; k++) strip(g, start + k * pitch, lo, start + k * pitch + width, hi, f.side, f.t, proud);
    }
    return g;
  }
  // Frames: a tall dado gets two rows of panels.
  const rows = top - bottom > 1.7 ? 2 : 1;
  const bays = (panels: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (const [a, b] of free) {
      const w = b - a;
      if (w < 0.3) continue;
      const n = Math.max(1, Math.round((w / 3) * panels));
      const bw = w / n;
      for (let k = 0; k < n; k++) out.push([a + k * bw, a + (k + 1) * bw]);
    }
    return out;
  };
  let panels = Math.max(1, f.panels);
  let list = bays(panels);
  while (list.length * rows * 4 > MAX_TRIM_STRIPS && panels > 0.2) {
    panels *= 0.8;
    list = bays(panels);
  }
  const stile = 0.055;
  const gap = 0.012;
  const raisedStyle = f.style === 'raised';
  for (const [a, b] of list) {
    const x0 = a + gap;
    const x1 = b - gap;
    if (x1 - x0 < 2 * stile + 0.06) continue;
    for (let r = 0; r < rows; r++) {
      const span = top - bottom;
      const y0 = rows === 1 ? bottom : r === 0 ? bottom : bottom + span * 0.58 + gap;
      const y1 = rows === 1 ? top : r === 0 ? bottom + span * 0.58 - gap : top;
      if (y1 - y0 < 2 * stile + 0.06) continue;
      strip(g, x0, y0, x1, y0 + stile, f.side, f.t, 0.014);
      strip(g, x0, y1 - stile, x1, y1, f.side, f.t, 0.014);
      strip(g, x0, y0 + stile, x0 + stile, y1 - stile, f.side, f.t, 0.014);
      strip(g, x1 - stile, y0 + stile, x1, y1 - stile, f.side, f.t, 0.014);
      if (raisedStyle) raisedPanel(g, x0 + stile, y0 + stile, x1 - stile, y1 - stile, f.side, f.t, 0.02, 0.025);
    }
  }
  return g;
}

/** A niche as the wall builder sees it (a `WallNiche` after validation). */
export interface NicheSpec {
  offset: number;
  width: number;
  height: number;
  sill: number;
  depth: number;
  shelves: number;
  color?: string | undefined;
  arched: boolean;
}

/** The rectangle of a niche on the wall face as an opening span (it interrupts the face tiling, not the wall). */
export function nicheSpan(n: NicheSpec): OpeningSpan {
  return { kind: 'window', x0: n.offset - n.width / 2, x1: n.offset + n.width / 2, y0: n.sill, y1: n.sill + n.height };
}

/** Niches that fit the wall and do not touch an opening or each other (the others are skipped). */
export function usableNiches(niches: readonly NicheSpec[], spans: readonly OpeningSpan[], length: number, height: number): NicheSpec[] {
  const out: NicheSpec[] = [];
  const taken = spans.map((s) => [s.x0 - 0.05, s.x1 + 0.05] as [number, number]);
  for (const n of niches) {
    const x0 = n.offset - n.width / 2;
    const x1 = n.offset + n.width / 2;
    if (x0 < 0.05 || x1 > length - 0.05 || n.sill + n.height > height - 0.05) continue;
    if (taken.some(([a, b]) => x0 < b && x1 > a)) continue;
    taken.push([x0 - 0.05, x1 + 0.05]);
    out.push(n);
  }
  return out;
}

const ARCH_SEGMENTS = 12;

/**
 * Build one niche into `face` (the spandrels of an arched head on the wall face) and `inside` (back, returns, soffit and
 * shelves). The recess goes from the face of side `side` towards the other side by `n.depth`.
 */
export function buildNiche(face: Geom, inside: Geom, n: NicheSpec, side: -1 | 1, t: number): void {
  const x0 = n.offset - n.width / 2;
  const x1 = n.offset + n.width / 2;
  const y0 = n.sill;
  const yTop = n.sill + n.height;
  const zf = side * t;
  const zb = side * (t - n.depth);
  const r = n.arched && n.height > n.width / 2 + 0.1 ? n.width / 2 : 0;
  const yc = yTop - r;
  const toward: V3 = [0, 0, side];
  // Back plane, returns and sill.
  quadN(inside, [x0, y0, zb], [x1, y0, zb], [x1, yc, zb], [x0, yc, zb], toward);
  quadN(inside, [x0, y0, zf], [x0, y0, zb], [x0, yc, zb], [x0, yc, zf], [1, 0, 0]);
  quadN(inside, [x1, y0, zf], [x1, y0, zb], [x1, yc, zb], [x1, yc, zf], [-1, 0, 0]);
  quadN(inside, [x0, y0, zf], [x1, y0, zf], [x1, y0, zb], [x0, y0, zb], [0, 1, 0]);
  if (r === 0) {
    quadN(inside, [x0, yc, zf], [x1, yc, zf], [x1, yc, zb], [x0, yc, zb], [0, -1, 0]);
  } else {
    const cx = (x0 + x1) / 2;
    const pt = (k: number): [number, number] => {
      const a = Math.PI - (Math.PI * k) / ARCH_SEGMENTS;
      return [cx + r * Math.cos(a), yc + r * Math.sin(a)];
    };
    for (let k = 0; k < ARCH_SEGMENTS; k++) {
      const [px, py] = pt(k);
      const [qx, qy] = pt(k + 1);
      const am = Math.PI - (Math.PI * (k + 0.5)) / ARCH_SEGMENTS;
      // Back: a fan from the springing centre. Soffit: faces the centre of the arch. Spandrel: on the wall face.
      triN(inside, [cx, yc, zb], [px, py, zb], [qx, qy, zb], toward);
      quadN(inside, [px, py, zf], [qx, qy, zf], [qx, qy, zb], [px, py, zb], [-Math.cos(am), -Math.sin(am), 0]);
      quadN(face, [px, py, zf], [qx, qy, zf], [qx, yTop, zf], [px, yTop, zf], toward);
    }
  }
  // Shelves: thin boards across the width, evenly spaced below the springing.
  const shelfTop = r > 0 ? yc - 0.05 : yTop;
  for (let k = 1; k <= n.shelves; k++) {
    const y = y0 + ((shelfTop - y0) * k) / (n.shelves + 1);
    const za = Math.min(zf, zb);
    const zbb = Math.max(zf, zb);
    inside.merge(box(x0, y - 0.01, za, x1, y + 0.01, zbb));
  }
}
