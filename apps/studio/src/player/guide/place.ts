/**
 * Where the showroom guide and the visitor stand (scene rays through the renderer, the guide's own person skipped as the
 * shared-visit avatars skip theirs): the floor under a point, a viewpoint in front of a product (the clear side, at eye
 * level, far enough to see all of it) with a spot for the guide beside it, and the guide's walk there (straight, else
 * through one or two of the building's openings; null when no clear way is found and the guide steps there out of view).
 */
import type { Vec3, WorldDoc } from '@aether/core';
import { worldTransform } from '@aether/core';
import type { Simulation } from '../../engine/Simulation';
import { WALK_EYE } from '../walk';

type Renderer = Simulation['renderer'];

/** Distance (m) of the viewpoint from a product that fits in view at it. */
export const VIEW_M = 2.2;
/** A surface met this close (m) before an eye, on the way out from the piece, has the eye inside (or just behind) a wall. */
const INSIDE_WALL_M = 0.8;

/** The walkable floor under (x, z) within reach below `fromY`, or null. */
export function floorAt(r: Renderer, x: number, z: number, fromY: number, skip: ReadonlySet<string>): { y: number; id: string } | null {
  const hit = r.raycastWorld([x, fromY, z], [0, -1, 0], 4, skip);
  if (hit) return hit.normal[1] >= 0.55 ? { y: hit.point[1], id: hit.id } : null;
  // The environment's ground plane (y = 0) is outside the scene's entities.
  return fromY >= 0 && fromY - 4 <= 0 ? { y: 0, id: '' } : null;
}

/** Free distance from `a` toward `b` (up to their distance). */
function free(r: Renderer, a: Readonly<Vec3>, b: Readonly<Vec3>, skip: ReadonlySet<string>): number {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (d < 1e-3) return 0;
  const hit = r.raycastWorld([a[0], a[1], a[2]], [b[0] - a[0], b[1] - a[1], b[2] - a[2]], d, skip);
  return hit ? Math.hypot(hit.point[0] - a[0], hit.point[1] - a[1], hit.point[2] - a[2]) : d;
}

/**
 * A person can walk the straight line between two feet positions: a ray at hip height each way (a ray starting inside a
 * wall leaves it unseen through its back faces; the other way meets its front). One height only: long rays near the floor
 * are the costly ones. `fromGuide`: `a` is where the guide stands, and the segment stops {@link GUIDE_CLEAR_M} short of it:
 * a ray into the guide's own person tests every triangle of its skinned mesh (its id is skipped only after), and where
 * it stands is clear.
 */
export function clearWalk(r: Renderer, a: Readonly<Vec3>, b: Readonly<Vec3>, skip: ReadonlySet<string>, fromGuide = false): boolean {
  const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
  if (d < 0.05) return true;
  if (fromGuide && d <= GUIDE_CLEAR_M) return true;
  const h = 0.8;
  const k = fromGuide ? GUIDE_CLEAR_M / d : 0;
  const s: Vec3 = [a[0] + (b[0] - a[0]) * k, a[1] + h, a[2] + (b[2] - a[2]) * k];
  const e: Vec3 = [b[0], b[1] + h, b[2]];
  const len = Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2]);
  return free(r, s, e, skip) >= len - 0.05 && free(r, e, s, skip) >= len - 0.05;
}

/** Rays of the guide's walk stop this far (m) from where it stands. */
export const GUIDE_CLEAR_M = 1.1;

/**
 * Waypoints through the building's openings and doors (feet, on the floor): each one's middle, and a point 0.9 m in front
 * of it and behind it (across its wall, the thin side of its bounds).
 */
export function openings(world: WorldDoc, bounds: (id: string) => { min: Vec3; max: Vec3 } | null): Vec3[] {
  const out: Vec3[] = [];
  for (const [id, e] of Object.entries(world.entities)) {
    if ((e.arch as { role?: string } | undefined)?.role !== 'opening') continue;
    const b = bounds(id);
    if (b) {
      const c: Vec3 = [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2];
      const acrossX = b.max[0] - b.min[0] < b.max[2] - b.min[2];
      out.push(c, acrossX ? [c[0] + 0.9, c[1], c[2]] : [c[0], c[1], c[2] + 0.9], acrossX ? [c[0] - 0.9, c[1], c[2]] : [c[0], c[1], c[2] - 0.9]);
    } else {
      try {
        out.push(worldTransform(world, id).position);
      } catch {
        /* broken chain: skip */
      }
    }
  }
  return out;
}

/** Points round `p` (two rings of eight) for the way round furniture. */
function ring(p: Readonly<Vec3>): Vec3[] {
  const out: Vec3[] = [];
  for (const rad of [1.4, 2.8])
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + (rad > 2 ? Math.PI / 8 : 0);
      out.push([p[0] + Math.sin(a) * rad, p[1], p[2] + Math.cos(a) * rad]);
    }
  return out;
}

/** Milliseconds of rays per frame while the guide finds its way. */
const SLICE_MS = 6;
/** Longest leg tried between two waypoints (m). */
const LEG_M = 18;

/**
 * The guide's way from `a` to `b` (the points after `a`), or null when none is found: straight when clear, else the
 * shortest way over waypoints (the openings', and rings round both ends for furniture in the way), each leg checked
 * with {@link clearWalk} only when the search reaches it (A*).
 */
export async function walkPath(r: Renderer, a: Readonly<Vec3>, b: Readonly<Vec3>, doors: readonly Vec3[], skip: ReadonlySet<string>, cancelled: () => boolean = () => false): Promise<Vec3[] | null> {
  let slice = performance.now();
  /** Yield to the next frame every few milliseconds: the search never stalls the view. */
  const breathe = async (): Promise<void> => {
    if (performance.now() - slice < SLICE_MS) return;
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
    slice = performance.now();
  };
  const B: Vec3 = [b[0], b[1], b[2]];
  if (clearWalk(r, a, b, skip, true)) return [B];
  const nodes: Vec3[] = [[a[0], a[1], a[2]], B, ...doors.map((d) => [d[0], a[1], d[2]] as Vec3), ...ring(a), ...ring(b)];
  const n = nodes.length;
  const flat = (i: number, j: number): number => Math.hypot((nodes[i] as Vec3)[0] - (nodes[j] as Vec3)[0], (nodes[i] as Vec3)[2] - (nodes[j] as Vec3)[2]);
  // Lazy A*: a leg is checked only when the search takes it (the costly part is the rays).
  const from = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  const open: Array<{ v: number; u: number; g: number; f: number }> = [{ v: 0, u: -1, g: 0, f: flat(0, 1) }];
  let checks = 0;
  while (open.length > 0 && checks < 400) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if ((open[i] as { f: number }).f < (open[bi] as { f: number }).f) bi = i;
    const e = open.splice(bi, 1)[0] as { v: number; u: number; g: number; f: number };
    if (done[e.v]) continue;
    if (e.u >= 0) {
      checks++;
      await breathe();
      if (cancelled()) return null;
      if (!clearWalk(r, nodes[e.u] as Vec3, nodes[e.v] as Vec3, skip, e.u === 0)) continue;
    }
    done[e.v] = true;
    from[e.v] = e.u;
    if (e.v === 1) break;
    for (let v = 0; v < n; v++) {
      if (done[v] || v === e.v) continue;
      const d = flat(e.v, v);
      if (d <= LEG_M) open.push({ v, u: e.v, g: e.g + d, f: e.g + d + flat(v, 1) });
    }
  }
  if (!done[1]) return null;
  const path: Vec3[] = [];
  for (let i = 1; i > 0; i = from[i] as number) path.unshift(nodes[i] as Vec3);
  return path;
}

/** Where the visitor looks at a product from, and where the guide stands beside it. */
export interface Viewpoint {
  eye: Vec3;
  target: Vec3;
  stand: Vec3;
}

/**
 * The viewpoint of a product with `bounds`: on a clear side (a hanging piece: in front of it), at eye level over the floor
 * of `floorY`, {@link VIEW_M} away or more for a large piece, preferring the side the visitor is on (`eye`). Null when no
 * side is clear.
 */
export function viewpoint(r: Renderer, id: string, bounds: { min: Vec3; max: Vec3 }, eyeNow: Readonly<Vec3>, floorY: number, skip: ReadonlySet<string>): Viewpoint | null {
  const c: Vec3 = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
  const sx = bounds.max[0] - bounds.min[0];
  const sy = bounds.max[1] - bounds.min[1];
  const sz = bounds.max[2] - bounds.min[2];
  // A hanging piece (thin in plan, tall): look at its face.
  const upright = sy > 0.5 && Math.min(sx, sz) < 0.35 * Math.max(sx, sz);
  const faceAxis: [number, number] | null = upright ? (sx < sz ? [1, 0] : [0, 1]) : null;
  const big = Math.max(upright ? Math.max(sx, sz) : 0, sy, upright ? 0 : Math.max(sx, sz) * 0.6);
  const base = Math.min(4.2, Math.max(VIEW_M, big * 0.95 + 0.6));
  const toEye = [eyeNow[0] - c[0], eyeNow[2] - c[2]];
  const toLen = Math.hypot(toEye[0] as number, toEye[1] as number) || 1;
  const fromY = floorY + WALK_EYE;
  const pieceSkip = new Set([...skip, id]);
  const found: Array<{ eye: Vec3; dx: number; dz: number; d: number; score: number; seen: boolean }> = [];
  let best: { vp: Viewpoint; rank: number } | null = null;
  for (const k of [1, 0.75, 1.3]) {
    const d = base * k + (upright ? 0 : Math.max(sx, sz) * 0.35);
    for (let i = 0; i < 12; i++) {
      // A hanging piece: only the sides in front of or behind its face.
      const a = (i / 12) * Math.PI * 2;
      if (faceAxis && Math.abs(Math.sin(a) * faceAxis[0] + Math.cos(a) * faceAxis[1]) < 0.7) continue;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      const x = c[0] + dx * d;
      const z = c[2] + dz * d;
      const f = floorAt(r, x, z, fromY + 0.3, skip);
      // The same floor (not a table top, not the floor below).
      if (!f || Math.abs(f.y - floorY) > 0.35 || f.id === id) continue;
      const eye: Vec3 = [x, f.y + WALK_EYE, z];
      // The piece is in sight (the ray reaches it or stops just short of its middle).
      const dist = Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]);
      const hit = r.raycastWorld(eye, [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]], dist, skip);
      if (hit && hit.id !== id && Math.hypot(hit.point[0] - eye[0], hit.point[1] - eye[1], hit.point[2] - eye[2]) < dist - 0.2) continue;
      // Seen for certain: the ray meets the piece itself first (a ray that meets nothing may have passed a model the
      // scene's rays do not test; such a side is kept only when no side is seen for certain).
      const seen = !!hit && hit.id === id;
      // Not inside a wall either: a ray from the eye starting inside one leaves it unseen (its back faces), but one from the
      // piece out to the eye meets the wall's face just short of the eye.
      const out = r.raycastWorld(c, [eye[0] - c[0], eye[1] - c[1], eye[2] - c[2]], dist, pieceSkip);
      if (out && out.id !== id) {
        const at = Math.hypot(out.point[0] - c[0], out.point[1] - c[1], out.point[2] - c[2]);
        if (at > dist - INSIDE_WALL_M && at < dist - 0.02) continue;
      }
      // Not inside a wall: room round the eye.
      if ((([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([ox, oz]) => free(r, eye, [eye[0] + ox * 0.35, eye[1], eye[2] + oz * 0.35], skip) < 0.34))) continue;
      let score = ((dx * (toEye[0] as number) + dz * (toEye[1] as number)) / toLen) * 0.6;
      if (faceAxis) score += Math.abs(dx * faceAxis[0] + dz * faceAxis[1]) * 3;
      if (seen) score += 2;
      found.push({ eye, dx, dz, d, score, seen });
    }
    // The best clear side with room for the guide beside the piece, out of the visitor's view of it.
    found.sort((p, q) => q.score - p.score);
    for (const f of found.slice(0, 5)) {
      const stand = standBeside(r, id, c, f.eye, f.dx, f.dz, f.d, skip, bounds);
      if (!stand) continue;
      // Look a little below the middle of a hanging piece, at the middle of a floor piece.
      const vp: Viewpoint = { eye: f.eye, target: [c[0], upright ? c[1] - 0.1 : c[1], c[2]], stand: stand.feet };
      if (stand.clear && f.seen) return vp;
      const rank = (stand.clear ? 1 : 0) + (f.seen ? 2 : 0);
      if (!best || rank > best.rank) best = { vp, rank };
    }
    found.length = 0;
  }
  return best?.vp ?? null;
}

/** Half her width (m) as the visitor's view meets her. */
export const PERSON_HALF_M = 0.35;
/** Least gap (m, in plan) between where the guide stands and the piece's footprint. */
export const STAND_CLEAR_M = 0.6;
/** Widest angle (rad) off the line to the piece she may stand at and still be in view beside it. */
const STAND_IN_VIEW = 0.75;

/** Signed angle (rad) of the direction (`x`, `z`) from the heading (`fx`, `fz`), positive to the visitor's right. */
function angleOff(fx: number, fz: number, x: number, z: number): number {
  // Right of a heading (fx, fz) is (-fz, fx) (the walk's convention: yaw 0 looks down -z, its right is +x).
  return Math.atan2(x * -fz + z * fx, x * fx + z * fz);
}

/**
 * The visitor's view of the piece from `eye`, in plan: the angles (rad, positive right) its footprint's corners span about
 * the line to its centre, and the heading of that line.
 */
export function viewCone(eye: Readonly<Vec3>, bounds: { min: Vec3; max: Vec3 }): { fx: number; fz: number; min: number; max: number } {
  const cx = (bounds.min[0] + bounds.max[0]) / 2 - eye[0];
  const cz = (bounds.min[2] + bounds.max[2]) / 2 - eye[2];
  const l = Math.hypot(cx, cz) || 1;
  const fx = cx / l;
  const fz = cz / l;
  let min = 0;
  let max = 0;
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const z of [bounds.min[2], bounds.max[2]]) {
      const a = angleOff(fx, fz, x - eye[0], z - eye[2]);
      min = Math.min(min, a);
      max = Math.max(max, a);
    }
  return { fx, fz, min, max };
}

/**
 * The guide at `feet` leaves the visitor's view of the piece free: outside the cone its footprint spans from `eye` (her own
 * width included, a little to spare), at least {@link STAND_CLEAR_M} from its footprint, and still in view beside it.
 */
export function clearOfView(eye: Readonly<Vec3>, bounds: { min: Vec3; max: Vec3 }, feet: Readonly<Vec3>): boolean {
  const ox = Math.max(bounds.min[0] - feet[0], 0, feet[0] - bounds.max[0]);
  const oz = Math.max(bounds.min[2] - feet[2], 0, feet[2] - bounds.max[2]);
  if (Math.hypot(ox, oz) < STAND_CLEAR_M) return false;
  const cone = viewCone(eye, bounds);
  const px = feet[0] - eye[0];
  const pz = feet[2] - eye[2];
  const dist = Math.hypot(px, pz);
  if (dist < 0.5) return false;
  const a = angleOff(cone.fx, cone.fz, px, pz);
  const half = Math.atan2(PERSON_HALF_M, dist) + 0.03;
  if (Math.abs(a) > STAND_IN_VIEW) return false;
  return a - half > cone.max || a + half < cone.min;
}

/**
 * A spot for the guide beside the piece, to one side of the visitor's view of it (clear of the cone its footprint spans:
 * {@link clearOfView}) and in view from `eye`; on the visitor's left first (the product card docks right). Near the piece
 * first. When no such spot has a floor and a clear walk, the first spot that has (the guide still beside it).
 */
function standBeside(r: Renderer, id: string, c: Vec3, eye: Vec3, dx: number, dz: number, d: number, skip: ReadonlySet<string>, bounds: { min: Vec3; max: Vec3 }): { feet: Vec3; clear: boolean } | null {
  const feetEye: Vec3 = [eye[0], eye[1] - WALK_EYE, eye[2]];
  const spots = standSpots(c, eye, dx, dz, d, bounds);
  let fallback: Vec3 | null = null;
  for (const [x, z, clear] of spots) {
    const f = floorAt(r, x, z, eye[1] + 0.3, skip);
    if (!f || f.id === id || Math.abs(f.y - (eye[1] - WALK_EYE)) > 0.35) continue;
    const feet: Vec3 = [x, f.y, z];
    if (!clear && fallback) continue;
    if (!clearWalk(r, feetEye, feet, skip)) continue;
    if (clear) return { feet, clear: true };
    fallback ??= feet;
  }
  return fallback ? { feet: fallback, clear: false } : null;
}

/**
 * Candidate spots for the guide (x, z, clear of the view), best first: clear ones, on the visitor's left, near the piece,
 * close to the line of sight. Pure (exported for tests).
 */
export function standSpots(c: Readonly<Vec3>, eye: Readonly<Vec3>, dx: number, dz: number, d: number, bounds: { min: Vec3; max: Vec3 }): Array<[number, number, boolean]> {
  // The piece's half width across the line of sight.
  const cone = viewCone(eye, bounds);
  const across = Math.max(Math.abs(Math.tan(cone.min)), Math.abs(Math.tan(cone.max))) * d;
  const px = dz;
  const pz = -dx;
  const out: Array<{ x: number; z: number; clear: boolean; score: number }> = [];
  for (const along of [0.32, 0.5, 0.7, 0.2])
    for (const mag of [1.1, 1.6, across + PERSON_HALF_M + STAND_CLEAR_M, across + 1.3, 2.2])
      for (const sign of [1, -1]) {
        const side = mag * sign;
        const x = c[0] + dx * d * along + px * side;
        const z = c[2] + dz * d * along + pz * side;
        const clear = clearOfView(eye, bounds, [x, 0, z]);
        // The visitor's left: the far side from the product card.
        const left = angleOff(-dx, -dz, x - eye[0], z - eye[2]) < 0;
        out.push({ x, z, clear, score: (clear ? 0 : 100) + (left ? 0 : 1.5) + mag + along });
      }
  out.sort((a, b) => a.score - b.score);
  return out.map((o) => [o.x, o.z, o.clear]);
}

/** A part of the screen in normalised device coordinates (x and y from -1 to 1, y up). */
export interface ScreenArea {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Share of the free area the piece may fill (a margin round it). */
const FRAME_FILL = 0.86;

/**
 * Frame a piece in the part of the screen the interface leaves free (`free`: left of the product card, above the caption
 * and the tour bar), seen from `eye` looking at `target`: the view turns so the piece's middle sits in the middle of the
 * free area, and steps back along its line (up to `maxBack` metres, the room behind the eye) until the piece fits it. The
 * lens: vertical field `vfov` (radians) and `aspect`. Pure; returns the new eye and the point it looks at.
 */
export function framePiece(eye: Readonly<Vec3>, target: Readonly<Vec3>, bounds: { min: Vec3; max: Vec3 }, free: ScreenArea, vfov: number, aspect: number, maxBack: number): { eye: Vec3; look: Vec3 } {
  const tanV = Math.tan(vfov / 2);
  const tanH = tanV * aspect;
  const dx = target[0] - eye[0];
  const dy = target[1] - eye[1];
  const dz = target[2] - eye[2];
  const dist = Math.hypot(dx, dy, dz);
  if (!(dist > 1e-3) || !(tanV > 0) || !(aspect > 0)) return { eye: [eye[0], eye[1], eye[2]], look: [target[0], target[1], target[2]] };
  const yaw = Math.atan2(-dx, -dz);
  // The piece's extent in the view (tangent units), from its box's corners.
  const f: Vec3 = [dx / dist, dy / dist, dz / dist];
  const right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up: Vec3 = [f[1] * right[2] - f[2] * right[1], f[2] * right[0] - f[0] * right[2], f[0] * right[1] - f[1] * right[0]];
  let wx = 0;
  let wy = 0;
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const px = x - target[0];
        const py = y - target[1];
        const pz = z - target[2];
        const depth = Math.max(0.3, dist + px * f[0] + py * f[1] + pz * f[2]);
        wx = Math.max(wx, Math.abs(px * right[0] + py * right[1] + pz * right[2]) / depth);
        wy = Math.max(wy, Math.abs(px * up[0] + py * up[1] + pz * up[2]) / depth);
      }
  const fx = ((free.x1 - free.x0) / 2) * tanH * FRAME_FILL;
  const fy = ((free.y1 - free.y0) / 2) * tanV * FRAME_FILL;
  // Step back until it fits (its size in the view goes as one over the distance; the tilt adds a little, checked below).
  const k = Math.max(1, fx > 0 ? wx / fx : 1, fy > 0 ? wy / fy : 1);
  const room = Math.max(0, maxBack);
  let back = Math.min(room, dist * (k - 1));
  let shot = aimAt(eye, target, f, back, free, tanH, tanV);
  for (let i = 0; i < 6 && back < room && !fits(shot, bounds, free, tanH, tanV); i++) {
    back = Math.min(room, back + Math.max(0.15, (dist + back) * 0.12));
    shot = aimAt(eye, target, f, back, free, tanH, tanV);
  }
  return shot;
}

/** The eye `back` metres behind `eye` along the plan of `f`, turned so `target` lands in the middle of `free`. */
function aimAt(eye: Readonly<Vec3>, target: Readonly<Vec3>, f: Readonly<Vec3>, back: number, free: ScreenArea, tanH: number, tanV: number): { eye: Vec3; look: Vec3 } {
  const fl = Math.hypot(f[0], f[2]) || 1;
  const e: Vec3 = [eye[0] - (f[0] / fl) * back, eye[1], eye[2] - (f[2] / fl) * back];
  const yaw = Math.atan2(-(target[0] - e[0]), -(target[2] - e[2]));
  // Keep the eye's height: step back in plan, and look again at the piece from there.
  const nd = Math.hypot(target[0] - e[0], target[1] - e[1], target[2] - e[2]);
  const nflat = Math.hypot(target[0] - e[0], target[2] - e[2]) || 1e-9;
  const nPitch = Math.atan2(target[1] - e[1], nflat);
  // Turn so the piece's middle lands on the free area's middle: a free area to the left puts the piece left of the
  // view's middle (the view turns right of it), one high up tilts the view down.
  const cx = (free.x0 + free.x1) / 2;
  const cy = (free.y0 + free.y1) / 2;
  const turnYaw = yaw + Math.atan(cx * tanH);
  const turnPitch = Math.max(-1.2, Math.min(1, nPitch - Math.atan(cy * tanV)));
  const look: Vec3 = [e[0] - Math.sin(turnYaw) * Math.cos(turnPitch) * nd, e[1] + Math.sin(turnPitch) * nd, e[2] - Math.cos(turnYaw) * Math.cos(turnPitch) * nd];
  return { eye: e, look };
}

/** Every corner of `bounds` lands inside `free` (a little margin) seen from the shot. */
function fits(shot: { eye: Vec3; look: Vec3 }, bounds: { min: Vec3; max: Vec3 }, free: ScreenArea, tanH: number, tanV: number): boolean {
  const { eye, look } = shot;
  const fx = look[0] - eye[0];
  const fy = look[1] - eye[1];
  const fz = look[2] - eye[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  const f = [fx / fl, fy / fl, fz / fl] as const;
  const yaw = Math.atan2(-f[0], -f[2]);
  const r = [Math.cos(yaw), 0, -Math.sin(yaw)] as const;
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]] as const;
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const dx = x - eye[0];
        const dy = y - eye[1];
        const dz = z - eye[2];
        const depth = dx * f[0] + dy * f[1] + dz * f[2];
        if (depth <= 0.05) return false;
        const sx = (dx * r[0] + dy * r[1] + dz * r[2]) / depth / tanH;
        const sy = (dx * u[0] + dy * u[1] + dz * u[2]) / depth / tanV;
        if (sx < free.x0 || sx > free.x1 || sy < free.y0 || sy > free.y1) return false;
      }
  return true;
}
