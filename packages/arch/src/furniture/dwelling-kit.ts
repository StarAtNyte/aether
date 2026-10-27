/**
 * Building blocks of the village dwellings (`dwelling.ts`): wall runs with real openings (boxes round the hole, so a
 * window sits in a reveal as deep as the wall), thick roof planes with a separate soffit, gable and hip roofs with
 * eaves and verges, dormers, chimneys and a window dressing in six manners. All geometry is in metres, flat shaded, with
 * metric UVs from `quadAuto`, so the stone, plaster, timber, tile, slate and thatch finishes tile at their real size.
 */
import { Geom, box, cylinder, sphere } from '../mesh';
import { prismX } from './venue-kit';

export type V3 = readonly [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const centroid = (p: readonly V3[]): V3 => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length, p.reduce((s, q) => s + q[2], 0) / p.length];

/**
 * A flat quad a-b-c-d (u runs a to b along the eave, v runs a to d up the slope) facing away from `ref`; a triangle is a quad
 * whose last two corners coincide.
 */
export function faceAway(g: Geom, a: V3, b: V3, c: V3, d: V3, ref: V3): Geom {
  const n = cross(sub(b, a), sub(d, a));
  const flip = dot(n, sub(centroid([a, b, c, d]), ref)) < 0;
  return flip ? g.quadAuto(b, a, d, c) : g.quadAuto(a, b, c, d);
}

/** Unit normal of the quad a-b-c-d pointing away from `ref`. */
function outward(a: V3, b: V3, c: V3, d: V3, ref: V3): V3 {
  const n = norm(cross(sub(b, a), sub(d, a)));
  return dot(n, sub(centroid([a, b, c, d]), ref)) < 0 ? [-n[0], -n[1], -n[2]] : n;
}

/** The three skins of a roof plane of thickness `t`: the weathering surface, the soffit seen from below and the edge. */
export interface RoofSkins {
  top: Geom;
  soffit: Geom;
  edge: Geom;
}

/** A roof plane with thickness: `corners` a-b-c-d are the top surface; `ref` is a point inside the building. */
export function roofPlane(skins: RoofSkins, corners: readonly [V3, V3, V3, V3], t: number, ref: V3): void {
  const [a, b, c, d] = corners;
  faceAway(skins.top, a, b, c, d, ref);
  const n = outward(a, b, c, d, ref);
  const lo = corners.map((p) => [p[0] - n[0] * t, p[1] - n[1] * t, p[2] - n[2] * t] as V3) as unknown as [V3, V3, V3, V3];
  const mid = centroid([...corners, ...lo]);
  // The underside faces away from a point far outside the slab.
  const far: V3 = [mid[0] + n[0] * 50, mid[1] + n[1] * 50, mid[2] + n[2] * 50];
  faceAway(skins.soffit, lo[0], lo[1], lo[2], lo[3], far);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    faceAway(skins.edge, corners[i] as V3, corners[j] as V3, lo[j] as V3, lo[i] as V3, mid);
  }
}

/** An opening in a wall: centre along the wall, width, and the vertical extent above the wall's base. */
export interface Hole {
  c: number;
  w: number;
  y0: number;
  y1: number;
}

/**
 * A wall as boxes round its openings. `axis` is the direction the wall runs along; `fixed` the outer face (z for a wall
 * along x, x for a wall along z), `dir` which way is out (+1 or -1), `t` the thickness.
 */
export function wallRun(g: Geom, axis: 'x' | 'z', fixed: number, dir: 1 | -1, t: number, a0: number, a1: number, yA: number, yB: number, holes: readonly Hole[]): void {
  const f0 = Math.min(fixed, fixed - dir * t);
  const f1 = Math.max(fixed, fixed - dir * t);
  const put = (u0: number, u1: number, y0: number, y1: number): void => {
    if (u1 - u0 < 0.004 || y1 - y0 < 0.004) return;
    g.merge(axis === 'x' ? box(u0, y0, f0, u1, y1, f1) : box(f0, y0, u0, f1, y1, u1));
  };
  const sorted = [...holes].sort((p, q) => p.c - q.c);
  let cur = a0;
  for (const h of sorted) {
    const l = h.c - h.w / 2;
    const r = h.c + h.w / 2;
    put(cur, l, yA, yB);
    put(l, r, yA, h.y0);
    put(l, r, h.y1, yB);
    cur = r;
  }
  put(cur, a1, yA, yB);
}

/** A thin stick between two points with a square section. */
export function beam(g: Geom, a: V3, b: V3, s: number): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (len < 1e-4) return;
  const m = box(-s / 2, -s / 2, -len / 2, s / 2, s / 2, len / 2);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
  const pitch = (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
  m.rotateX(pitch).rotateY(yaw).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  g.merge(m);
}

/** Where a roof of ridge height `yRidge` over a wall top at `yTop` and half span `hs` stands at distance `z` from the ridge. */
export const slopeY = (yTop: number, yRidge: number, hs: number, z: number): number => yTop + ((yRidge - yTop) * (hs - Math.abs(z))) / hs;

export interface GableRoof {
  /** Centre of the roof in plan (ridge runs along X through zc). */
  zc: number;
  /** Half the span between the walls, and half the length between the gable walls. */
  hs: number;
  hl: number;
  yTop: number;
  rise: number;
  eave: number;
  verge: number;
  t: number;
}

/** Two planes of a gable roof (ridge along X at z = zc), its ridge height returned. */
export function gableRoof(skins: RoofSkins, r: GableRoof): number {
  const yR = r.yTop + r.rise;
  const ratio = r.rise / r.hs;
  const ref: V3 = [0, r.yTop - 1, r.zc];
  const x0 = -r.hl - r.verge;
  const x1 = r.hl + r.verge;
  const he = r.hs + r.eave;
  const yE = r.yTop - r.eave * ratio;
  roofPlane(skins, [[x0, yE, r.zc + he], [x1, yE, r.zc + he], [x1, yR, r.zc], [x0, yR, r.zc]], r.t, ref);
  roofPlane(skins, [[x1, yE, r.zc - he], [x0, yE, r.zc - he], [x0, yR, r.zc], [x1, yR, r.zc]], r.t, ref);
  return yR;
}

/** The four planes of a hip roof, its ridge height returned. */
export function hipRoof(skins: RoofSkins, r: GableRoof): number {
  const he = r.hs + r.eave;
  const hle = r.hl + r.eave;
  const ratio = r.rise / r.hs;
  const yE = r.yTop - r.eave * ratio;
  const yR = r.yTop + r.rise;
  const rl = Math.max(0.05, hle - he);
  const ref: V3 = [0, r.yTop - 1, r.zc];
  roofPlane(skins, [[-hle, yE, r.zc + he], [hle, yE, r.zc + he], [rl, yR, r.zc], [-rl, yR, r.zc]], r.t, ref);
  roofPlane(skins, [[hle, yE, r.zc - he], [-hle, yE, r.zc - he], [-rl, yR, r.zc], [rl, yR, r.zc]], r.t, ref);
  roofPlane(skins, [[hle, yE, r.zc + he], [hle, yE, r.zc - he], [rl, yR, r.zc], [rl, yR, r.zc]], r.t, ref);
  roofPlane(skins, [[-hle, yE, r.zc - he], [-hle, yE, r.zc + he], [-rl, yR, r.zc], [-rl, yR, r.zc]], r.t, ref);
  return yR;
}

/** A triangular gable wall (profile in z, y) of thickness `t` whose outer face is at x = `x`, facing `dir`. */
export function gableWall(zc: number, hs: number, yTop: number, yR: number, x: number, dir: 1 | -1, t: number): Geom {
  const x0 = dir > 0 ? x - t : x;
  const x1 = dir > 0 ? x : x + t;
  return prismX([[zc - hs, yTop], [zc + hs, yTop], [zc, yR]], x0, x1);
}

/** A cylinder lying along X, centred on the origin. */
export function cylX(rBottom: number, rTop: number, len: number, seg = 10): Geom {
  return cylinder(rBottom, rTop, len, seg).translate(0, -len / 2, 0).rotateZ(90);
}

/** A cylinder lying along Z, centred on the origin. */
export function cylZ(rBottom: number, rTop: number, len: number, seg = 10): Geom {
  return cylinder(rBottom, rTop, len, seg).translate(0, -len / 2, 0).rotateX(90);
}

/** A half-round ridge cap along X at height y, or a thick roll (thatch). */
export function ridgeCap(x0: number, x1: number, y: number, z: number, r: number): Geom {
  return cylX(r, r, x1 - x0).translate((x0 + x1) / 2, y, z);
}

/**
 * A gabled dormer on a slope that falls towards +Z: `zf` is the plane of its front, `yBase` the height of the slope there,
 * `w` its width, `h` the wall height. Returns the wall box with a window opening, and the roof skins.
 */
export function dormer(wall: Geom, glass: Geom, frame: Geom, skins: RoofSkins, cx: number, zf: number, yBase: number, w: number, h: number, back: number, pitchDeg: number, wallT: number): void {
  const ref: V3 = [cx, yBase - 0.5, zf - back / 2];
  // Cheeks and back are one solid box; the front gets a window.
  const ww = 0.7;
  const wh = Math.min(0.95, h - 0.45);
  const wy0 = yBase + (h - wh) / 2 - 0.1;
  wallRun(wall, 'x', zf, 1, wallT, cx - w / 2, cx + w / 2, yBase - 0.35, yBase + h, [{ c: cx, w: ww, y0: wy0, y1: wy0 + wh }]);
  wall.merge(box(cx - w / 2, yBase - 0.35, zf - back, cx - w / 2 + wallT, yBase + h, zf - wallT));
  wall.merge(box(cx + w / 2 - wallT, yBase - 0.35, zf - back, cx + w / 2, yBase + h, zf - wallT));
  glass.merge(box(cx - ww / 2 + 0.03, wy0 + 0.03, zf - wallT * 0.6, cx + ww / 2 - 0.03, wy0 + wh - 0.03, zf - wallT * 0.6 + 0.012));
  const f = new Geom();
  const s = 0.05;
  f.merge(box(cx - ww / 2, wy0, zf - wallT * 0.6 - 0.03, cx + ww / 2, wy0 + s, zf - wallT * 0.6 + 0.04));
  f.merge(box(cx - ww / 2, wy0 + wh - s, zf - wallT * 0.6 - 0.03, cx + ww / 2, wy0 + wh, zf - wallT * 0.6 + 0.04));
  f.merge(box(cx - ww / 2, wy0, zf - wallT * 0.6 - 0.03, cx - ww / 2 + s, wy0 + wh, zf - wallT * 0.6 + 0.04));
  f.merge(box(cx + ww / 2 - s, wy0, zf - wallT * 0.6 - 0.03, cx + ww / 2, wy0 + wh, zf - wallT * 0.6 + 0.04));
  f.merge(box(cx - 0.015, wy0, zf - wallT * 0.6 - 0.02, cx + 0.015, wy0 + wh, zf - wallT * 0.6 + 0.03));
  frame.merge(f);
  // Roof of the dormer: ridge along Z, pitch like the main roof, a small overhang.
  const hs = w / 2 + 0.12;
  const rise = hs * Math.tan((pitchDeg * Math.PI) / 180);
  const yTop = yBase + h;
  const yR = yTop + rise;
  const z0 = zf + 0.18;
  const z1 = zf - back;
  const yE = yTop - 0.12 * Math.tan((pitchDeg * Math.PI) / 180);
  roofPlane(skins, [[cx - hs - 0.1, yE, z0], [cx - hs - 0.1, yE, z1], [cx, yR, z1], [cx, yR, z0]], 0.07, ref);
  roofPlane(skins, [[cx + hs + 0.1, yE, z1], [cx + hs + 0.1, yE, z0], [cx, yR, z0], [cx, yR, z1]], 0.07, ref);
  // The front gable above the window.
  wall.merge(triangleFront(cx, zf, yTop, yR, hs - 0.06, wallT));
}

/** A triangular front gable (in the plane z = zf, thickness `t` going back), centred on cx. */
function triangleFront(cx: number, zf: number, y0: number, y1: number, hw: number, t: number): Geom {
  const g = new Geom();
  const a: V3 = [cx - hw, y0, zf];
  const b: V3 = [cx + hw, y0, zf];
  const c: V3 = [cx, y1, zf];
  g.quadAuto(a, b, c, c);
  const back = zf - t;
  g.quadAuto([cx + hw, y0, back], [cx - hw, y0, back], [cx, y1, back], [cx, y1, back]);
  return g;
}

/** A brick, stone or plaster chimney stack with a cap and clay pots, standing from y0 to y1. */
export function chimneyStack(stack: Geom, cap: Geom, pots: Geom, cx: number, cz: number, w: number, d: number, y0: number, y1: number, nPots: number): void {
  stack.merge(box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y1, cz + d / 2));
  cap.merge(box(cx - w / 2 - 0.07, y1, cz - d / 2 - 0.07, cx + w / 2 + 0.07, y1 + 0.09, cz + d / 2 + 0.07));
  cap.merge(box(cx - w / 2 - 0.03, y1 - 0.12, cz - d / 2 - 0.03, cx + w / 2 + 0.03, y1, cz + d / 2 + 0.03));
  for (let i = 0; i < nPots; i++) {
    const px = nPots === 1 ? cx : cx + (i - (nPots - 1) / 2) * Math.min(0.3, (w - 0.2) / nPots);
    pots.merge(cylinder(0.075, 0.095, 0.34, 10).translate(px, y1 + 0.09, cz));
    pots.merge(cylinder(0.105, 0.075, 0.05, 10).translate(px, y1 + 0.43, cz));
  }
}

/** A potted plant: clay pot and a clump of foliage. Returns pot and leaves. */
export function pottedPlant(pot: Geom, leaves: Geom, x: number, y: number, z: number, s: number): void {
  pot.merge(cylinder(0.13 * s, 0.19 * s, 0.34 * s, 12).translate(x, y, z));
  pot.merge(cylinder(0.2 * s, 0.2 * s, 0.04 * s, 12).translate(x, y + 0.34 * s, z));
  leaves.merge(sphere(0.22 * s, 7).scale(1, 0.85, 1).translate(x, y + 0.5 * s, z));
  leaves.merge(sphere(0.14 * s, 6).translate(x + 0.1 * s, y + 0.62 * s, z + 0.04 * s));
}
