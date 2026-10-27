/**
 * Dormers: a small gabled, shed-roofed or hipped projection with a window, standing on a pitched roof plane.
 *
 * Local frame: the origin is the foot of the front wall on the roof surface (centred across the dormer), +Z runs down
 * the slope (outward), +Y up. The main roof plane through the origin is `y = −tan(roofPitch) · z`. The front wall is
 * vertical at z = 0; the cheeks (side walls) and the dormer's roof run back up the slope until they meet that plane,
 * so the dormer's depth is a result of its height and the roof's pitch, not a parameter. Where the cheeks and the
 * front apron touch the roof a flashing strip is laid on the roof surface.
 */
import { Geom, box } from './mesh';
import { PartSet } from './parts';
import type { DormerParams, RoofParams } from './params';
import type { ArchOutput } from './types';

type V3 = [number, number, number];

const rad = (d: number): number => (d * Math.PI) / 180;
/** Flashing strip width on the roof (m), and how far it stands above the roof surface. */
const FLASH = 0.1;
const FLASH_LIFT = 0.012;
/** Thickness of the dormer's roof panels and of the jambs round the window (m). */
const SLAB = 0.07;
const JAMB = 0.22;

/** Resolved dimensions of a dormer. */
export interface DormerShape {
  style: DormerParams['style'];
  /** Pitch of the dormer roof actually used (degrees; a shed dormer is kept under the main roof's). */
  pitch: number;
  /** Height of the ridge (gable, hip) or of the front edge of the roof (shed) above the foot of the front wall. */
  top: number;
  /** Horizontal depth from the front wall to where the ridge (or shed roof top) meets the main roof. */
  depth: number;
  /** Half the width over the roof, with its overhang. */
  halfRoof: number;
}

/** Dimensions of a dormer: where its roof meets the main roof plane follows from the two pitches. */
export function dormerShape(p: DormerParams): DormerShape {
  const tr = Math.tan(rad(p.roofPitch));
  let pitch = p.pitch;
  if (p.style === 'shed') pitch = Math.min(pitch, p.roofPitch - 4);
  const t = Math.tan(rad(Math.max(2, pitch)));
  const hw = p.width / 2;
  if (p.style === 'shed') {
    const top = p.wallHeight;
    return { style: p.style, pitch, top, depth: top / Math.max(0.05, tr - t), halfRoof: hw + p.overhang };
  }
  const top = p.wallHeight + hw * t;
  return { style: p.style, pitch, top, depth: top / tr, halfRoof: hw + p.overhang };
}

/**
 * Where to put a dormer on a roof: the position in the roof entity's frame and the yaw (degrees about +Y) that turns
 * the dormer's +Z down the chosen slope. `side` is the compass side of the slope (`south` is +Z, `north` −Z, `east` +X,
 * `west` −X); `along` is the offset along the eaves from the centre of that side and `up` how far up the slope from the
 * eaves (m, measured in plan from the footprint edge). Gable and hip roofs only; the roof's own ridge direction picks
 * which sides slope (a ridge along X slopes toward ±Z).
 */
export function dormerPlacement(roof: Pick<RoofParams, 'width' | 'depth' | 'pitch' | 'thickness' | 'ridgeAlongX' | 'shape'>, side: 'north' | 'south' | 'east' | 'west', along = 0, up = 1): { position: V3; rotationY: number } | null {
  const slopesZ = roof.shape === 'hip' || roof.ridgeAlongX;
  const slopesX = roof.shape === 'hip' || !roof.ridgeAlongX;
  if (roof.shape === 'flat' || (roof.shape === 'shed' && side !== (roof.ridgeAlongX ? 'south' : 'east'))) return null;
  if ((side === 'north' || side === 'south') && !slopesZ) return null;
  if ((side === 'east' || side === 'west') && !slopesX) return null;
  const tan = Math.tan(rad(roof.pitch));
  const lift = roof.thickness / Math.cos(rad(roof.pitch));
  const y = up * tan + lift;
  const hw = roof.width / 2;
  const hd = roof.depth / 2;
  switch (side) {
    case 'south':
      return { position: [along, y, hd - up], rotationY: 0 };
    case 'north':
      return { position: [-along, y, -hd + up], rotationY: 180 };
    case 'east':
      return { position: [hw - up, y, -along], rotationY: 90 };
    case 'west':
      return { position: [-hw + up, y, along], rotationY: -90 };
  }
}

/** A quad (counter-clockwise from outside) by corners; normal from the corners. */
function quad(g: Geom, a: V3, b: V3, c: V3, d: V3, flip = false): void {
  if (flip) g.quadAuto(a, d, c, b);
  else g.quadAuto(a, b, c, d);
}

/** Planar polygon (convex, up to 5 corners) as a fan, normal facing away from `away` (a point behind it). */
function poly(g: Geom, pts: readonly V3[], away: V3): void {
  const [a, b, c] = pts as [V3, V3, V3];
  const n: V3 = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  const face = n[0] * (a[0] - away[0]) + n[1] * (a[1] - away[1]) + n[2] * (a[2] - away[2]) >= 0 ? 1 : -1;
  const base = g.vertexCount;
  for (const q of pts) g.vertex(q[0], q[1], q[2], (face * n[0]) / len, (face * n[1]) / len, (face * n[2]) / len, q[0] + q[2], q[1]);
  for (let i = 1; i + 1 < pts.length; i++) {
    if (face > 0) g.i.push(base, base + i, base + i + 1);
    else g.i.push(base, base + i + 1, base + i);
  }
}

/** Dormer. */
export function buildDormer(p: DormerParams): ArchOutput {
  const set = new PartSet();
  const s = dormerShape(p);
  const hw = p.width / 2;
  const H = p.wallHeight;
  const tr = Math.tan(rad(p.roofPitch));
  const t = Math.tan(rad(Math.max(2, s.pitch)));
  const o = p.overhang;
  const W = s.halfRoof;
  /** Height of the main roof plane at depth z (z < 0 runs up the slope). */
  const plane = (z: number): number => -tr * z;
  const walls = new Geom();
  const roof = new Geom();
  const trim = new Geom();
  const flashing = new Geom();

  // Front wall: strips round the window opening, then (gable) the triangle above the eaves line.
  const ww = Math.max(0.3, p.width - 2 * JAMB);
  const sill = Math.min(p.sill, H - 0.45);
  const head = H - 0.2;
  const x0 = -ww / 2;
  const x1 = ww / 2;
  const front = (a: number, b: number, c: number, d: number): void => quad(walls, [a, b, 0], [c, b, 0], [c, d, 0], [a, d, 0], false);
  front(-hw, 0, hw, sill);
  front(-hw, sill, x0, head);
  front(x1, sill, hw, head);
  front(-hw, head, hw, H);
  if (s.style === 'gable') poly(walls, [[-hw, H, 0], [hw, H, 0], [0, s.top, 0]], [0, H, -1]);
  // Reveals of the opening.
  const rv = 0.12;
  quad(walls, [x0, sill, 0], [x0, sill, -rv], [x0, head, -rv], [x0, head, 0], false);
  quad(walls, [x1, sill, -rv], [x1, sill, 0], [x1, head, 0], [x1, head, -rv], false);
  quad(walls, [x0, head, 0], [x0, head, -rv], [x1, head, -rv], [x1, head, 0], false);
  // Sill of the opening.
  quad(walls, [x0, sill, -rv], [x0, sill, 0], [x1, sill, 0], [x1, sill, -rv], false);
  // Cheeks: triangles from the foot of the front wall up to the top of the wall, closed by the roof plane.
  const run = s.style === 'shed' ? s.depth : H / tr;
  const cheek = (x: number, sign: 1 | -1): void => {
    const pts: V3[] = [[x, 0, 0], [x, H, 0], [x, plane(-run), -run]];
    poly(walls, pts, [x - sign, H / 2, -run / 2]);
    poly(walls, pts.slice().reverse(), [x + sign, H / 2, -run / 2]);
  };
  cheek(-hw, -1);
  cheek(hw, 1);

  // Roof panels, soffits and fascias.
  const lo = (q: V3): V3 => [q[0], q[1] - SLAB, q[2]];
  /** The underside of a panel at its back edge: lowered by the slab, but kept on the main roof plane (not below it). */
  const dropBack = (q: V3): V3 => [q[0], q[1] - SLAB, (q[1] - SLAB) / -tr];
  const eaveY = Math.max(0.1, H - o * t);
  if (s.style === 'gable') {
    const zr = s.top / tr;
    const ze = eaveY / tr;
    for (const sign of [-1, 1] as const) {
      const ex = sign * W;
      const A: V3 = [ex, eaveY, o];
      const B: V3 = [0, s.top, o];
      const C: V3 = [0, s.top, -zr];
      const D: V3 = [ex, eaveY, -ze];
      poly(roof, [A, B, C, D], [ex / 2, 0, -zr / 2]);
      poly(roof, [lo(A), lo(B), dropBack(C), dropBack(D)], [ex / 2, s.top + 5, -zr / 2]);
      poly(trim, [A, lo(A), lo(B), B], [0, s.top, -5]);
      poly(trim, [D, dropBack(D), lo(A), A], [0, s.top, 0]);
    }
  } else if (s.style === 'shed') {
    const yAt = (z: number): number => H - z * t;
    const zb = s.depth;
    const A: V3 = [-W, yAt(o), o];
    const B: V3 = [W, yAt(o), o];
    const C: V3 = [W, yAt(-zb), -zb];
    const D: V3 = [-W, yAt(-zb), -zb];
    poly(roof, [A, B, C, D], [0, 0, -zb / 2]);
    // The underside meets the main roof plane a little nearer than the top does.
    const zs = (H - SLAB) / Math.max(0.05, tr - t);
    const C2: V3 = [W, tr * zs, -zs];
    const D2: V3 = [-W, tr * zs, -zs];
    poly(roof, [lo(A), lo(B), C2, D2], [0, 5, -zb / 2]);
    poly(trim, [A, lo(A), lo(B), B], [0, A[1], -5]);
    poly(trim, [D, D2, lo(A), A], [5, A[1], 0]);
    poly(trim, [B, lo(B), C2, C], [-5, A[1], 0]);
  } else {
    // Hip: four faces meeting at a ridge along z, the front face sloping down to the front.
    const zr = Math.max(hw + 0.1, s.top / tr);
    const ze = eaveY / tr;
    const tip: V3 = [0, s.top, -hw];
    const backRidge: V3 = [0, s.top, -zr];
    const fl: V3 = [-W, eaveY, o];
    const fr: V3 = [W, eaveY, o];
    const bl: V3 = [-W, eaveY, -ze];
    const br: V3 = [W, eaveY, -ze];
    poly(roof, [fl, fr, tip], [0, 0, -2]);
    poly(roof, [fl, tip, backRidge, bl], [3, 0, 0]);
    poly(roof, [fr, br, backRidge, tip], [-3, 0, 0]);
    poly(trim, [fl, lo(fl), lo(fr), fr], [0, eaveY, -5]);
    poly(trim, [bl, dropBack(bl), lo(fl), fl], [5, eaveY, 0]);
    poly(trim, [fr, lo(fr), dropBack(br), br], [-5, eaveY, 0]);
  }

  // Flashing: a strip on the roof along the foot of each cheek and across the front, a hair above the surface.
  const strip = (xa: number, za: number, xb: number, zb: number, wx: number, wz: number): void => {
    const lift = (x: number, z: number): V3 => [x, plane(z) + FLASH_LIFT, z];
    poly(flashing, [lift(xa, za), lift(xb, zb), lift(xb + wx, zb + wz), lift(xa + wx, za + wz)], [xa, -5, za]);
  };
  strip(-hw - FLASH, 0, -hw - FLASH, -run, FLASH, 0);
  strip(hw, 0, hw, -run, FLASH, 0);
  strip(-hw - FLASH, FLASH, hw + FLASH, FLASH, 0, -FLASH);

  // The window: frame, glazing bars and glass, set back in the reveal.
  const frame = new Geom();
  const glass = new Geom();
  const fw = 0.05;
  const zf = -rv * 0.6;
  frame.merge(box(x0 + 0.01, sill + 0.01, zf - 0.02, x1 - 0.01, sill + fw, zf + 0.02));
  frame.merge(box(x0 + 0.01, head - fw, zf - 0.02, x1 - 0.01, head - 0.01, zf + 0.02));
  frame.merge(box(x0 + 0.01, sill + 0.01, zf - 0.02, x0 + fw, head - 0.01, zf + 0.02));
  frame.merge(box(x1 - fw, sill + 0.01, zf - 0.02, x1 - 0.01, head - 0.01, zf + 0.02));
  const gx = (x0 + x1) / 2;
  const gy = (sill + head) / 2;
  if (p.bars === 'cross' || p.bars === 'grid') frame.merge(box(gx - 0.012, sill + fw, zf - 0.015, gx + 0.012, head - fw, zf + 0.015));
  if (p.bars === 'cross' || p.bars === 'grid') frame.merge(box(x0 + fw, gy - 0.012, zf - 0.015, x1 - fw, gy + 0.012, zf + 0.015));
  if (p.bars === 'grid') {
    for (const f of [0.25, 0.75]) {
      frame.merge(box(x0 + (x1 - x0) * f - 0.01, sill + fw, zf - 0.012, x0 + (x1 - x0) * f + 0.01, head - fw, zf + 0.012));
      frame.merge(box(x0 + fw, sill + (head - sill) * f - 0.01, zf - 0.012, x1 - fw, sill + (head - sill) * f + 0.01, zf + 0.012));
    }
  }
  glass.quadAuto([x0 + fw, sill + fw, zf], [x1 - fw, sill + fw, zf], [x1 - fw, head - fw, zf], [x0 + fw, head - fw, zf]);
  glass.quadAuto([x0 + fw, sill + fw, zf], [x0 + fw, head - fw, zf], [x1 - fw, head - fw, zf], [x1 - fw, sill + fw, zf]);
  // A drip sill on the front.
  trim.merge(box(x0 - 0.04, sill - 0.035, 0, x1 + 0.04, sill + 0.005, 0.07));

  set.add(walls, p.finish).add(roof, p.roof).add(trim, p.trim).add(frame, p.frame).add(glass, p.glass).add(flashing, p.flashing);

  // Collider: the dormer's volume as a convex hull (front wall, the eaves, the ridge and the points where they meet the roof).
  const pts: number[] = [];
  const add = (x: number, y: number, z: number): void => void pts.push(x, y, z);
  for (const sx of [-1, 1]) {
    add(sx * hw, 0, 0);
    add(sx * hw, H, 0);
    if (s.style === 'shed') {
      add(sx * hw, H + s.depth * t, -s.depth);
      add(sx * hw, plane(-s.depth), -s.depth);
    } else {
      add(sx * hw, H, -H / tr);
      add(sx * hw, plane(-H / tr), -H / tr);
    }
  }
  if (s.style === 'gable') {
    add(0, s.top, 0);
    add(0, s.top, -s.top / tr);
  } else if (s.style === 'hip') {
    add(0, s.top, -hw);
    add(0, s.top, -s.top / tr);
  }
  set.hull(pts);
  return set.build();
}
