/**
 * Geometry of the window and door styles beyond the plain casement / picture / panel: double-hung sash windows with
 * glazing bars, arched windows, three-light bay windows, interior casings, glazed and French door leaves and the arched
 * fanlight head of a door frame. `openings.ts` calls these from `buildWindow`, `buildDoor` and `buildFrame`.
 *
 * Window frame: the window is centred on x = 0 and z = 0 (the wall centreline), local y = 0 is the sill, `inside` is +1
 * when the room is on the +Z side (`interior: 'b'`) and −1 otherwise. Every piece is a flat-shaded prism with metric UVs;
 * glass is a thin slab; planes that would coincide are separated by a millimetre.
 */
import { Geom, box, extrude } from './mesh';
import type { P2 } from './math2';
import type { FrameParams, WindowParams } from './params';

type V3 = readonly [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** One flat triangle whose normal faces the side `hint` points to; UVs are metres projected on the dominant axis. */
function tri(g: Geom, a: V3, b: V3, c: V3, hint: V3): void {
  let n = cross(sub(b, a), sub(c, a));
  const len = Math.hypot(n[0], n[1], n[2]);
  if (!(len > 1e-12)) return;
  let q = b;
  let r = c;
  if (dot(n, hint) < 0) {
    q = c;
    r = b;
    n = [-n[0], -n[1], -n[2]];
  }
  const nn: V3 = [n[0] / len, n[1] / len, n[2] / len];
  const ax = Math.abs(nn[0]);
  const ay = Math.abs(nn[1]);
  const az = Math.abs(nn[2]);
  const uv = (p: V3): [number, number] => (az >= ax && az >= ay ? [p[0], p[1]] : ax >= ay ? [p[2], p[1]] : [p[0], p[2]]);
  const ia = g.vertex(a[0], a[1], a[2], nn[0], nn[1], nn[2], ...uv(a));
  const ib = g.vertex(q[0], q[1], q[2], nn[0], nn[1], nn[2], ...uv(q));
  const ic = g.vertex(r[0], r[1], r[2], nn[0], nn[1], nn[2], ...uv(r));
  g.tri(ia, ib, ic);
}

function quadH(g: Geom, a: V3, b: V3, c: V3, d: V3, hint: V3): void {
  tri(g, a, b, c, hint);
  tri(g, a, c, d, hint);
}

/** Triangle fan from `pts[0]` over the rest (a convex or from-the-first-point star-shaped polygon), facing `hint`. */
function fan(g: Geom, pts: readonly V3[], hint: V3): void {
  for (let k = 1; k + 1 < pts.length; k++) tri(g, pts[0] as V3, pts[k] as V3, pts[k + 1] as V3, hint);
}

/** Points of an ellipse arc (centre cx, cy; radii rx, ry) from angle a0 to a1 (degrees, 0 = +x, 90 = up). */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, seg: number): P2[] {
  const out: P2[] = [];
  for (let k = 0; k <= seg; k++) {
    const t = ((a0 + ((a1 - a0) * k) / seg) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return out;
}

/** A band between two concentric ellipse arcs, from z0 to z1 (front and back faces, outer and inner walls). */
function ringBand(g: Geom, cx: number, cy: number, rxO: number, ryO: number, rxI: number, ryI: number, z0: number, z1: number, seg = 20): void {
  const o = arc(cx, cy, rxO, ryO, 0, 180, seg);
  const i = arc(cx, cy, rxI, ryI, 0, 180, seg);
  for (let k = 0; k < seg; k++) {
    const o0 = o[k] as P2;
    const o1 = o[k + 1] as P2;
    const i0 = i[k] as P2;
    const i1 = i[k + 1] as P2;
    quadH(g, [o0[0], o0[1], z1], [i0[0], i0[1], z1], [i1[0], i1[1], z1], [o1[0], o1[1], z1], [0, 0, 1]);
    quadH(g, [o0[0], o0[1], z0], [i0[0], i0[1], z0], [i1[0], i1[1], z0], [o1[0], o1[1], z0], [0, 0, -1]);
    const mx = (o0[0] + o1[0]) / 2 - cx;
    const my = (o0[1] + o1[1]) / 2 - cy;
    quadH(g, [o0[0], o0[1], z0], [o1[0], o1[1], z0], [o1[0], o1[1], z1], [o0[0], o0[1], z1], [mx, my, 0]);
    quadH(g, [i0[0], i0[1], z0], [i1[0], i1[1], z0], [i1[0], i1[1], z1], [i0[0], i0[1], z1], [-mx, -my, 0]);
  }
}

/** A bar in the XY plane from `a` to `b` of the given width, from z0 to z1. */
function barXY(g: Geom, a: P2, b: P2, width: number, z0: number, z1: number): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const px = (-dy / l) * (width / 2);
  const py = (dx / l) * (width / 2);
  const c: P2[] = [
    [a[0] + px, a[1] + py],
    [b[0] + px, b[1] + py],
    [b[0] - px, b[1] - py],
    [a[0] - px, a[1] - py],
  ];
  quadH(g, [c[0]![0], c[0]![1], z1], [c[1]![0], c[1]![1], z1], [c[2]![0], c[2]![1], z1], [c[3]![0], c[3]![1], z1], [0, 0, 1]);
  quadH(g, [c[0]![0], c[0]![1], z0], [c[1]![0], c[1]![1], z0], [c[2]![0], c[2]![1], z0], [c[3]![0], c[3]![1], z0], [0, 0, -1]);
  for (let k = 0; k < 4; k++) {
    const p = c[k] as P2;
    const q = c[(k + 1) % 4] as P2;
    const mx = (p[0] + q[0]) / 2 - (a[0] + b[0]) / 2;
    const my = (p[1] + q[1]) / 2 - (a[1] + b[1]) / 2;
    quadH(g, [p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1], [mx, my, 0]);
  }
}

/** A vertical slab standing on the plan line a→b (thickness `thick`), from y0 to y1. */
function slab(a: P2, b: P2, thick: number, y0: number, y1: number): Geom {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  const nx = (-dz / l) * (thick / 2);
  const nz = (dx / l) * (thick / 2);
  return extrude(
    [
      [a[0] + nx, a[1] + nz],
      [b[0] + nx, b[1] + nz],
      [b[0] - nx, b[1] - nz],
      [a[0] - nx, a[1] - nz],
    ],
    y0,
    y1,
  );
}

/** A square post centred on a plan point. */
function post(c: P2, size: number, y0: number, y1: number): Geom {
  const h = size / 2;
  return extrude(
    [
      [c[0] - h, c[1] - h],
      [c[0] + h, c[1] - h],
      [c[0] + h, c[1] + h],
      [c[0] - h, c[1] + h],
    ],
    y0,
    y1,
  );
}

const zr = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);

/** Glazing bars inside a rectangle of light: `cols` x `rows` panes (cols − 1 vertical and rows − 1 horizontal bars). */
export function addMuntinBars(g: Geom, x0: number, y0: number, x1: number, y1: number, cols: number, rows: number, zc: number, depth = 0.02, width = 0.022): void {
  for (let k = 1; k < cols; k++) {
    const x = x0 + ((x1 - x0) * k) / cols;
    g.merge(box(x - width / 2, y0, zc - depth / 2, x + width / 2, y1, zc + depth / 2));
  }
  for (let k = 1; k < rows; k++) {
    const y = y0 + ((y1 - y0) * k) / rows;
    g.merge(box(x0, y - width / 2, zc - depth / 2, x1, y + width / 2, zc + depth / 2));
  }
}

/** What a window style contributes: frame pieces, glass, and the shape of the daylight pane behind the glass. */
export interface WindowShapeParts {
  frame: Geom;
  glass: Geom;
  /** Emissive daylight pane in the shape of the light (positioned behind the glass, outside). */
  daylight?: Geom;
}

const FW = 0.055;

function insideSign(p: WindowParams): 1 | -1 {
  return p.interior === 'b' ? 1 : -1;
}

/** Default glazing bars of a sash of the given light size. */
function defaultBars(w: number, h: number): { cols: number; rows: number } {
  return { cols: w < 0.7 ? 1 : w < 1.5 ? 2 : 3, rows: h > 1.05 ? 3 : h > 0.6 ? 2 : 1 };
}

/** One sash (stiles and rails round a pane) in the plane z = zc. */
function sashFrame(frame: Geom, glass: Geom, x0: number, y0: number, x1: number, y1: number, zc: number, depth: number, rb: number, rt: number, bars: { cols: number; rows: number }): void {
  const st = 0.045;
  const z0 = zc - depth / 2;
  const z1 = zc + depth / 2;
  frame.merge(box(x0, y0, z0, x1, y0 + rb, z1));
  frame.merge(box(x0, y1 - rt, z0, x1, y1, z1));
  frame.merge(box(x0, y0 + rb, z0, x0 + st, y1 - rt, z1));
  frame.merge(box(x1 - st, y0 + rb, z0, x1, y1 - rt, z1));
  glass.merge(box(x0 + st, y0 + rb, zc - 0.004, x1 - st, y1 - rt, zc + 0.004));
  addMuntinBars(frame, x0 + st, y0 + rb, x1 - st, y1 - rt, bars.cols, bars.rows, zc, depth * 0.6);
}

/** Double-hung sash window: outer frame, two sashes meeting at mid height, glazing bars, parting beads. */
export function sashWindow(p: WindowParams): WindowShapeParts {
  const W = p.width;
  const H = p.height;
  const fd = Math.min(0.09, p.wallThickness * 0.8);
  const inside = insideSign(p);
  const frame = new Geom();
  const glass = new Geom();
  frame.merge(box(-W / 2, 0, -fd / 2, W / 2, FW, fd / 2));
  frame.merge(box(-W / 2, H - FW, -fd / 2, W / 2, H, fd / 2));
  frame.merge(box(-W / 2, FW, -fd / 2, -W / 2 + FW, H - FW, fd / 2));
  frame.merge(box(W / 2 - FW, FW, -fd / 2, W / 2, H - FW, fd / 2));
  const x0 = -W / 2 + FW;
  const x1 = W / 2 - FW;
  const y0 = FW;
  const y1 = H - FW;
  const mid = y0 + (y1 - y0) * 0.5;
  const sd = 0.032;
  const lightH = (y1 - y0) / 2 + 0.02;
  const bars = p.muntins ?? defaultBars(x1 - x0, lightH - 0.1);
  // Lower sash toward the room, upper sash behind it.
  sashFrame(frame, glass, x0, y0, x1, mid + 0.02, inside * 0.014, sd, 0.06, 0.04, bars);
  sashFrame(frame, glass, x0, mid - 0.02, x1, y1, -inside * 0.014, sd, 0.04, 0.05, bars);
  // Parting beads between the sashes and the frame.
  for (const s of [-1, 1] as const) frame.merge(box(s * (W / 2 - FW) - 0.006 - (s > 0 ? 0.006 : 0), y0, -fd * 0.45, s * (W / 2 - FW) + 0.006 - (s > 0 ? 0.006 : 0), y1, fd * 0.45));
  return { frame, glass };
}

/** Segmental or semicircular arch rise of an arched window. */
export function archRise(W: number, H: number): number {
  return Math.min(W / 2, H * 0.4);
}

/** Arched window: rectangular lower part, rounded head with a fan of radiating bars, spandrels in the frame colour. */
export function archedWindow(p: WindowParams): WindowShapeParts {
  const W = p.width;
  const H = p.height;
  const fd = Math.min(0.09, p.wallThickness * 0.8);
  const rh = archRise(W, H);
  const ys = H - rh;
  const frame = new Geom();
  const glass = new Geom();
  const z0 = -fd / 2;
  const z1 = fd / 2;
  frame.merge(box(-W / 2, 0, z0, W / 2, FW, z1));
  frame.merge(box(-W / 2, FW, z0, -W / 2 + FW, ys, z1));
  frame.merge(box(W / 2 - FW, FW, z0, W / 2, ys, z1));
  ringBand(frame, 0, ys, W / 2, rh, W / 2 - FW, Math.max(0.05, rh - FW), z0, z1, 24);
  // Glass: the rectangle plus the half ellipse of the inner outline, a thin slab (two faces).
  const inner = arc(0, ys, W / 2 - FW, Math.max(0.05, rh - FW), 0, 180, 24);
  const outline: V3[] = [[0, (FW + ys) / 2, 0], [W / 2 - FW, FW, 0], [W / 2 - FW, ys, 0], ...inner.map((q): V3 => [q[0], q[1], 0]), [-W / 2 + FW, ys, 0], [-W / 2 + FW, FW, 0], [W / 2 - FW, FW, 0]];
  const front = outline.map((q): V3 => [q[0], q[1], 0.004]);
  const back = outline.map((q): V3 => [q[0], q[1], -0.004]);
  fan(glass, front, [0, 0, 1]);
  fan(glass, back, [0, 0, -1]);
  // Spandrels above the arc corners, filling the hole of the wall.
  for (const s of [-1, 1] as const) {
    const a = arc(0, ys, W / 2, rh, s > 0 ? 0 : 180, 90, 12);
    const pts: V3[] = [[s * W / 2, H, 0], ...a.map((q): V3 => [q[0], q[1], 0])];
    fan(frame, pts.map((q): V3 => [q[0], q[1], z1]), [0, 0, 1]);
    fan(frame, pts.map((q): V3 => [q[0], q[1], z0]), [0, 0, -1]);
  }
  // Glazing bars: vertical bars and a springing bar in the lower light, a fan of spokes in the head.
  const cols = p.muntins?.cols ?? (W < 0.8 ? 1 : 2);
  const rowsAll = p.muntins?.rows ?? 3;
  addMuntinBars(frame, -W / 2 + FW, FW, W / 2 - FW, ys, cols, Math.max(1, Math.round(((rowsAll - 1) * (ys - FW)) / (H - FW) + 1)), 0, fd * 0.5);
  frame.merge(box(-W / 2 + FW, ys - 0.011, -fd * 0.25, W / 2 - FW, ys + 0.011, fd * 0.25));
  const ri = Math.max(0.05, rh - FW);
  for (const ang of [30, 60, 90, 120, 150]) {
    const t = (ang * Math.PI) / 180;
    barXY(frame, [0, ys], [(W / 2 - FW) * Math.cos(t), ys + ri * Math.sin(t)], 0.02, -fd * 0.25, fd * 0.25);
  }
  const daylight = new Geom();
  const dz = -insideSign(p) * (fd / 2 + 0.02);
  fan(daylight, outline.map((q): V3 => [q[0], q[1], dz + 0.003]), [0, 0, 1]);
  fan(daylight, outline.map((q): V3 => [q[0], q[1], dz - 0.003]), [0, 0, -1]);
  return { frame, glass, daylight };
}

/** Plan points of a bay (entity frame): the two wall-side corners and the two outer corners, on the outside. */
export function bayPlan(p: WindowParams): { depth: number; pts: [P2, P2, P2, P2] } {
  const W = p.width;
  const T = p.wallThickness / 2;
  const out = -insideSign(p);
  const b = p.bay ?? { depth: 0.5, angle: 35 };
  const tan = Math.tan((b.angle * Math.PI) / 180);
  const depth = Math.min(b.depth, Math.max(0.1, (W / 2 - 0.15) / tan));
  const zf = out * T;
  const half = W / 2 - depth * tan;
  return { depth, pts: [[-W / 2, zf], [-half, zf + out * depth], [half, zf + out * depth], [W / 2, zf]] };
}

/** Three-light bay window projecting outside the wall: posts, rails, glass, bars, a flat roof cap and a sill ledge. */
export function bayWindow(p: WindowParams): WindowShapeParts {
  const H = p.height;
  const out = -insideSign(p);
  const { pts } = bayPlan(p);
  const frame = new Geom();
  const glass = new Geom();
  const daylight = new Geom();
  for (const c of pts) frame.merge(post(c, 0.07, 0, H));
  const bars = p.muntins ?? { cols: 2, rows: H > 1.5 ? 3 : 2 };
  for (let f = 0; f < 3; f++) {
    const a = pts[f] as P2;
    const b = pts[f + 1] as P2;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const inset = 0.035;
    const a2: P2 = [a[0] + dir[0] * inset, a[1] + dir[1] * inset];
    const b2: P2 = [b[0] - dir[0] * inset, b[1] - dir[1] * inset];
    frame.merge(slab(a2, b2, 0.05, 0, FW));
    frame.merge(slab(a2, b2, 0.05, H - FW, H));
    glass.merge(slab(a2, b2, 0.008, FW, H - FW));
    const cols = f === 1 ? bars.cols : Math.max(1, Math.round(bars.cols / 2));
    for (let k = 1; k < cols; k++) {
      const t = k / cols;
      const c: P2 = [a2[0] + (b2[0] - a2[0]) * t, a2[1] + (b2[1] - a2[1]) * t];
      frame.merge(post(c, 0.022, FW, H - FW));
    }
    for (let k = 1; k < bars.rows; k++) {
      const y = FW + ((H - 2 * FW) * k) / bars.rows;
      frame.merge(slab(a2, b2, 0.02, y - 0.011, y + 0.011));
    }
    const sh = (q: P2): P2 => [q[0], q[1] + out * 0.03];
    daylight.merge(slab(sh(a2), sh(b2), 0.004, FW, H - FW));
  }
  // Roof cap and sill ledge: the plan outline grown a little.
  const cx = pts.reduce((s, q) => s + q[0], 0) / 4;
  const cz = pts.reduce((s, q) => s + q[1], 0) / 4;
  const grow = (d: number): P2[] => pts.map((q): P2 => {
    const dx = q[0] - cx;
    const dz = q[1] - cz;
    const l = Math.hypot(dx, dz) || 1;
    return [q[0] + (dx / l) * d, q[1] + (dz / l) * d];
  });
  frame.merge(extrude(grow(0.05), H, H + 0.06));
  frame.merge(extrude(grow(0.045), -0.05, -0.002));
  return { frame, glass, daylight };
}

/** Interior architrave (and apron under the sill board) round a window opening, on the room side of the wall. */
export function windowCasing(p: WindowParams, arched: boolean): Geom {
  const g = new Geom();
  const W = p.width;
  const H = p.height;
  const T = p.wallThickness / 2;
  const inside = insideSign(p);
  const c = 0.07;
  const [z0, z1] = zr(inside * T, inside * (T + 0.018));
  const top = arched ? H - archRise(W, H) : H;
  g.merge(box(-W / 2 - c, 0, z0, -W / 2, top, z1));
  g.merge(box(W / 2, 0, z0, W / 2 + c, top, z1));
  if (arched) ringBand(g, 0, top, W / 2 + c, archRise(W, H) + c, W / 2, archRise(W, H), z0, z1, 24);
  else g.merge(box(-W / 2 - c, H, z0, W / 2 + c, H + c, z1));
  if (p.sill) {
    const [a0, a1] = zr(inside * T, inside * (T + 0.022));
    g.merge(box(-W / 2 - c, -0.1, a0, W / 2 + c, -0.025, a1));
  }
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------------------------------------------------

/** Panel rows and columns of a panelled leaf: two columns (one on a narrow leaf), two rows (three on a tall leaf). */
export function panelLayout(w: number, h: number): { cols: number; rows: number } {
  return { cols: w < 0.62 ? 1 : 2, rows: h > 2.25 ? 3 : 2 };
}

/** Moulded panel rectangles `[x0, y0, x1, y1]` of a leaf (local frame, base at y = 0) between `yLo` and `yHi`. */
export function panelRects(w: number, yLo: number, yHi: number, cols: number, rows: number, stile: number, mid: number): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  const weights = rows === 3 ? [1.3, 1, 0.8] : rows === 2 ? [1, 1] : [1];
  const total = weights.reduce((s, v) => s + v, 0);
  const innerW = w - 2 * stile - (cols - 1) * mid;
  const avail = yHi - yLo - (rows - 1) * mid;
  let y = yLo;
  for (let r = 0; r < rows; r++) {
    const rh = (avail * (weights[r] as number)) / total;
    for (let c = 0; c < cols; c++) {
      const x0 = -w / 2 + stile + (c * (innerW + (cols - 1) * mid)) / cols;
      out.push([x0, y, x0 + innerW / cols, y + rh]);
    }
    y += rh + mid;
  }
  return out;
}

/** Raised moulding frame round a panel on both faces. */
export function panelMoulding(leaf: Geom, rect: readonly [number, number, number, number], t: number, mw = 0.012): void {
  const [x0, y0, x1, y1] = rect;
  for (const side of [-1, 1] as const) {
    const z0 = side > 0 ? t / 2 : -t / 2 - 0.006;
    const z1 = side > 0 ? t / 2 + 0.006 : -t / 2;
    leaf.merge(box(x0, y0, z0, x1, y0 + mw, z1));
    leaf.merge(box(x0, y1 - mw, z0, x1, y1, z1));
    leaf.merge(box(x0, y0 + mw, z0, x0 + mw, y1 - mw, z1));
    leaf.merge(box(x1 - mw, y0 + mw, z0, x1, y1 - mw, z1));
  }
}

/** Glazing bars of a door light through the leaf thickness (slightly slimmer than the leaf). */
function doorBars(g: Geom, x0: number, y0: number, x1: number, y1: number, cols: number, rows: number, t: number): void {
  addMuntinBars(g, x0, y0, x1, y1, cols, rows, 0, t * 0.8, 0.026);
}

/** Glazed or French leaf: stiles and rails round one tall light with a bar grid. Returns the glass slab. */
export function glazedLeaf(leaf: Geom, w: number, h: number, t: number, kind: 'glazed' | 'french'): Geom {
  const glass = new Geom();
  const st = kind === 'french' ? Math.min(0.075, w * 0.14) : Math.min(0.13, w * 0.16);
  const top = kind === 'french' ? 0.075 : 0.13;
  const bottom = kind === 'french' ? 0.12 : 0.13;
  const half = kind === 'glazed';
  // The lower part of a half-glazed leaf is panelled; its glass starts at the lock rail.
  const lockTop = half ? h * 0.42 : bottom;
  leaf.merge(box(-w / 2, 0, -t / 2, -w / 2 + st, h, t / 2));
  leaf.merge(box(w / 2 - st, 0, -t / 2, w / 2, h, t / 2));
  leaf.merge(box(-w / 2 + st, h - top, -t / 2, w / 2 - st, h, t / 2));
  leaf.merge(box(-w / 2 + st, 0, -t / 2, w / 2 - st, bottom, t / 2));
  if (half) {
    leaf.merge(box(-w / 2 + st, lockTop - 0.05, -t / 2, w / 2 - st, lockTop + 0.05, t / 2));
    leaf.merge(box(-w / 2 + st, bottom, -t / 2, w / 2 - st, lockTop - 0.05, t / 2));
    const cols = w < 0.62 ? 1 : 2;
    for (const r of panelRects(w, bottom + 0.03, lockTop - 0.08, cols, 1, st + 0.03, 0.09)) panelMoulding(leaf, r, t);
  }
  const gy0 = half ? lockTop + 0.05 : bottom;
  glass.merge(box(-w / 2 + st, gy0, -0.004, w / 2 - st, h - top, 0.004));
  const cols = kind === 'french' ? (w > 0.45 ? 2 : 1) : w < 0.62 ? 1 : 2;
  const rows = kind === 'french' ? Math.max(3, Math.min(7, Math.round((h - top - gy0) / 0.42))) : 3;
  doorBars(leaf, -w / 2 + st, gy0, w / 2 - st, h - top, cols, rows, t);
  return glass;
}

/** Arch rise of a door frame's fanlight (the space between the leaf's top and the opening's head). */
export function fanlightRise(p: Pick<FrameParams, 'height' | 'springing'>): number {
  const s = p.springing ?? p.height * 0.78;
  return Math.max(0.1, p.height - Math.min(s, p.height - 0.1));
}

/** Arched head of a door frame: a transom rail at the springing line, a glazed fanlight with spokes and spandrels. */
export function archedFrameHead(p: FrameParams, lining: number): { frame: Geom; glass: Geom } {
  const frame = new Geom();
  const glass = new Geom();
  const W = p.width;
  const H = p.height;
  const rh = fanlightRise(p);
  const ys = H - rh;
  const T = p.wallThickness / 2;
  const L = lining;
  const ring = L * 1.6;
  frame.merge(box(-W / 2, ys - L, -T, W / 2, ys + 0.045, T));
  const ry = rh;
  ringBand(frame, 0, ys + 0.045, W / 2, ry - 0.045, W / 2 - ring, Math.max(0.04, ry - 0.045 - ring), -T, T, 24);
  const inner = arc(0, ys + 0.045, W / 2 - ring, Math.max(0.04, ry - 0.045 - ring), 0, 180, 24);
  const outline: V3[] = [[0, ys + 0.045, 0], [W / 2 - ring, ys + 0.045, 0], ...inner.map((q): V3 => [q[0], q[1], 0]), [-W / 2 + ring, ys + 0.045, 0]];
  fan(glass, outline.map((q): V3 => [q[0], q[1], 0.004]), [0, 0, 1]);
  fan(glass, outline.map((q): V3 => [q[0], q[1], -0.004]), [0, 0, -1]);
  for (const s of [-1, 1] as const) {
    const a = arc(0, ys + 0.045, W / 2, ry - 0.045, s > 0 ? 0 : 180, 90, 12);
    const pts: V3[] = [[s * W / 2, H, 0], ...a.map((q): V3 => [q[0], q[1], 0])];
    fan(frame, pts.map((q): V3 => [q[0], q[1], T]), [0, 0, 1]);
    fan(frame, pts.map((q): V3 => [q[0], q[1], -T]), [0, 0, -1]);
  }
  const ri = Math.max(0.04, ry - 0.045 - ring);
  for (const ang of [30, 60, 90, 120, 150]) {
    const t = (ang * Math.PI) / 180;
    barXY(frame, [0, ys + 0.045], [(W / 2 - ring) * Math.cos(t), ys + 0.045 + ri * Math.sin(t)], 0.02, -T * 0.4, T * 0.4);
  }
  return { frame, glass };
}

/** Architrave round an arched door head: a curved band over the fanlight on both wall faces. */
export function archedCasing(p: FrameParams): Geom {
  const g = new Geom();
  const W = p.width;
  const H = p.height;
  const T = p.wallThickness / 2;
  const c = p.casing;
  const rh = fanlightRise(p);
  const ys = H - rh;
  for (const side of [-1, 1] as const) {
    const [z0, z1] = zr(side * T, side * (T + 0.018));
    g.merge(box(-W / 2 - c, 0, z0, -W / 2, ys + 0.045, z1));
    g.merge(box(W / 2, 0, z0, W / 2 + c, ys + 0.045, z1));
    ringBand(g, 0, ys + 0.045, W / 2 + c, rh - 0.045 + c, W / 2, rh - 0.045, z0, z1, 24);
  }
  return g;
}
