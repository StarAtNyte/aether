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
  const found: Array<{ eye: Vec3; dx: number; dz: number; d: number; score: number }> = [];
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
      // Not inside a wall: room round the eye.
      if ((([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([ox, oz]) => free(r, eye, [eye[0] + ox * 0.35, eye[1], eye[2] + oz * 0.35], skip) < 0.34))) continue;
      let score = ((dx * (toEye[0] as number) + dz * (toEye[1] as number)) / toLen) * 0.6;
      if (faceAxis) score += Math.abs(dx * faceAxis[0] + dz * faceAxis[1]) * 3;
      found.push({ eye, dx, dz, d, score });
    }
    // The best clear side with room for the guide beside the piece.
    found.sort((p, q) => q.score - p.score);
    for (const f of found.slice(0, 4)) {
      const stand = standBeside(r, id, c, f.eye, f.dx, f.dz, f.d, skip);
      // Look a little below the middle of a hanging piece, at the middle of a floor piece.
      if (stand) return { eye: f.eye, target: [c[0], upright ? c[1] - 0.1 : c[1], c[2]], stand };
    }
    found.length = 0;
  }
  return null;
}

/** A spot for the guide beside the piece, to one side of the visitor's line of sight and in view from `eye`. */
function standBeside(r: Renderer, id: string, c: Vec3, eye: Vec3, dx: number, dz: number, d: number, skip: ReadonlySet<string>): Vec3 | null {
  const px = dz;
  const pz = -dx;
  // Near the piece and to one side, so the visitor sees both.
  for (const along of [0.32, 0.5, 0.7]) {
    for (const side of [1.1, -1.1, 1.6, -1.6]) {
      const x = c[0] + dx * d * along + px * side;
      const z = c[2] + dz * d * along + pz * side;
      const f = floorAt(r, x, z, eye[1] + 0.3, skip);
      if (!f || f.id === id || Math.abs(f.y - (eye[1] - WALK_EYE)) > 0.35) continue;
      const feet: Vec3 = [x, f.y, z];
      if (!clearWalk(r, [eye[0], eye[1] - WALK_EYE, eye[2]], feet, skip)) continue;
      return feet;
    }
  }
  return null;
}
