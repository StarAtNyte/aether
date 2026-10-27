/**
 * Eyes of the review loop: where to put the cameras (corner to corner, each
 * wall, top-down plan) and which numbered marks to draw on each image, so the
 * AI can say "item 14" and the tools know exactly which piece that is.
 *
 * Pure geometry. The studio renders the poses and draws the marks; nothing
 * here touches a renderer. Poses are in WORLD coordinates (the building's
 * position, rotation and the level's height applied).
 */
import { hasOwn, type EntityId, type Vec3, type WorldDoc } from '@aether/core';
import { rotateYaw, type P2 } from '../math2';
import { cmr } from './geom';
import { itemLine } from './facts';
import { readScene } from './read';
import type { Scene, SceneItem, SceneOpening, SceneRoom } from './types';
import type { PlanOverlay } from './advice';

/** A camera for one review image. */
export interface ReviewPose {
  /** Stable name ("bedroom-corner-1"). */
  name: string;
  /** What the image shows, in words, for the model. */
  label: string;
  /** Plan id of the room (or "level-N" for a whole-level plan). */
  room: string;
  kind: 'corner' | 'wall' | 'plan' | 'exterior';
  position: Vec3;
  target: Vec3;
  up: Vec3;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Ceilings and roofs must be hidden (a plan view from above). */
  hideTops: boolean;
}

/** One numbered thing the model can refer to. */
export interface MarkEntry {
  /** The number drawn on the images. */
  n: number;
  /** Entity id (of a piece, a door or a window). */
  id: EntityId;
  kind: string;
  /** One line of facts for the legend. */
  line: string;
}

/** A mark on one image, in normalised image coordinates (0..1, origin top-left). */
export interface ImageMark {
  n: number;
  /** Box centre and half size. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Options of {@link reviewPoses}. */
export interface PoseOptions {
  /** Plan ids of the rooms to look at (default: all). */
  rooms?: readonly string[];
  /** At most this many images (default 8, hard cap 12). */
  maxViews?: number;
  /** Image aspect ratio width / height (default 1.5). */
  aspect?: number;
}

const HARD_MAX_VIEWS = 12;
const SKIP_KINDS: ReadonlySet<string> = new Set(['switch']);
const MAX_MARKS = 99;

interface Frame {
  origin: P2;
  yaw: number;
  levelY: Map<EntityId, number>;
}

function frameOf(world: WorldDoc, scene: Scene): Frame {
  const b = hasOwn(world.entities, scene.building) ? world.entities[scene.building] : undefined;
  const levelY = new Map<EntityId, number>();
  for (const l of scene.levels) {
    const e = hasOwn(world.entities, l.id) ? world.entities[l.id] : undefined;
    levelY.set(l.id, e?.transform.position[1] ?? 0);
  }
  return { origin: [b?.transform.position[0] ?? 0, b?.transform.position[2] ?? 0], yaw: b?.transform.rotation[1] ?? 0, levelY };
}

function toWorld(f: Frame, p: P2, y: number, levelId: EntityId): Vec3 {
  const r = rotateYaw(p[0], p[1], f.yaw);
  return [cmr(f.origin[0] + r[0]), cmr((f.levelY.get(levelId) ?? 0) + y), cmr(f.origin[1] + r[1])];
}

function centroid(poly: readonly P2[]): P2 {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  return [x / Math.max(1, poly.length), z / Math.max(1, poly.length)];
}

/** Distance from `from` along unit `dir` to the polygon boundary (inside → out), or 0. */
function rayExit(poly: readonly P2[], from: P2, dir: P2): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as P2;
    const b = poly[(i + 1) % poly.length] as P2;
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const den = dir[0] * ez - dir[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - from[0]) * ez - (a[1] - from[1]) * ex) / den;
    const u = ((a[0] - from[0]) * dir[1] - (a[1] - from[1]) * dir[0]) / den;
    if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
  }
  return Number.isFinite(best) ? best : 0;
}

function fovForWidth(width: number, distance: number, aspect: number): number {
  const h = 2 * Math.atan(width / 2 / Math.max(0.5, distance));
  const v = 2 * Math.atan(Math.tan(h / 2) / aspect);
  return Math.max(50, Math.min(100, (v * 180) / Math.PI + 6));
}

function itemsIn(scene: Scene, room: SceneRoom): SceneItem[] {
  return scene.items.filter((i) => i.room === room.id);
}

/** Camera poses to review the given rooms of a building. */
export function reviewPoses(world: WorldDoc, building: EntityId, opts: PoseOptions = {}): ReviewPose[] {
  const scene = readScene(world, building);
  if (!scene) return [];
  const f = frameOf(world, scene);
  const aspect = opts.aspect && Number.isFinite(opts.aspect) ? Math.max(0.5, Math.min(3, opts.aspect)) : 1.5;
  const max = Math.max(1, Math.min(HARD_MAX_VIEWS, Math.floor(opts.maxViews ?? 8)));
  const wanted = opts.rooms && opts.rooms.length > 0 ? new Set(opts.rooms) : null;
  const rooms = scene.rooms.filter((r) => !wanted || wanted.has(r.key) || wanted.has(r.id));
  const out: ReviewPose[] = [];

  // One plan per level that has a room in scope.
  for (const lvl of scene.levels) {
    const inLevel = rooms.filter((r) => r.levelId === lvl.id);
    if (inLevel.length === 0) continue;
    const pts = inLevel.flatMap((r) => r.polygon);
    const x0 = Math.min(...pts.map((p) => p[0]));
    const x1 = Math.max(...pts.map((p) => p[0]));
    const z0 = Math.min(...pts.map((p) => p[1]));
    const z1 = Math.max(...pts.map((p) => p[1]));
    const c: P2 = [(x0 + x1) / 2, (z0 + z1) / 2];
    const fov = 50;
    const half = Math.max((x1 - x0) / aspect, z1 - z0) / 2 + 0.4;
    const height = Math.max(lvl.ceiling + 1, half / Math.tan((fov * Math.PI) / 360));
    out.push({
      name: `level-${lvl.index}-plan`,
      label: `top-down plan of level ${lvl.index} (north is up, ceilings and roof removed)`,
      room: `level-${lvl.index}`,
      kind: 'plan',
      position: toWorld(f, c, height, lvl.id),
      target: toWorld(f, c, 0, lvl.id),
      up: [0, 0, -1],
      fov,
      hideTops: true,
    });
  }

  for (const room of rooms) {
    const inside = room.polygon;
    const c = centroid(inside);
    const items = itemsIn(scene, room);
    const eye = Math.min(1.55, room.ceiling - 0.4);
    // Corner views: the two vertices that see the most pieces toward the room's middle.
    const scored = inside
      .map((v) => {
        const d: P2 = [c[0] - v[0], c[1] - v[1]];
        const l = Math.hypot(d[0], d[1]) || 1;
        const dir: P2 = [d[0] / l, d[1] / l];
        let seen = 0;
        for (const it of items) {
          const to: P2 = [it.pos[0] - v[0], it.pos[2] - v[1]];
          const tl = Math.hypot(to[0], to[1]) || 1;
          if ((to[0] * dir[0] + to[1] * dir[1]) / tl > 0.55) seen++;
        }
        return { v, dir, seen, far: l };
      })
      .sort((a, b) => b.seen - a.seen || b.far - a.far);
    const picks: typeof scored = [];
    for (const s of scored) {
      if (picks.length >= (room.area > 9 ? 2 : 1)) break;
      if (picks.every((p) => Math.hypot(p.v[0] - s.v[0], p.v[1] - s.v[1]) > 1.2)) picks.push(s);
    }
    picks.forEach((s, i) => {
      const pos: P2 = [s.v[0] + s.dir[0] * 0.4, s.v[1] + s.dir[1] * 0.4];
      out.push({
        name: `${room.key}-corner-${i + 1}`,
        label: `${room.key} seen from its ${compassOf(s.v, c)} corner toward the middle (eye height)`,
        room: room.key,
        kind: 'corner',
        position: toWorld(f, pos, eye, room.levelId),
        target: toWorld(f, c, 0.9, room.levelId),
        up: [0, 1, 0],
        fov: 78,
        hideTops: false,
      });
    });
    // Wall views: walls that carry something, longest first.
    const busy = room.walls
      .map((w) => ({
        w,
        n: w.openings.length + items.filter((i) => (i.wall && i.wall.edge === w.edge) || i.against?.some((a) => a.edge === w.edge)).length,
      }))
      .filter((x) => x.n > 0 && x.w.length >= 1)
      .sort((a, b) => b.n - a.n || b.w.length - a.w.length);
    for (const { w } of busy) {
      const mid: P2 = [w.a[0] + w.dir[0] * (w.length / 2) - w.out[0] * w.inset, w.a[1] + w.dir[1] * (w.length / 2) - w.out[1] * w.inset];
      const inward: P2 = [-w.out[0], -w.out[1]];
      const reach = rayExit(inside, [mid[0] + inward[0] * 0.05, mid[1] + inward[1] * 0.05], inward);
      const dist = Math.max(1.2, reach - 0.2);
      const pos: P2 = [mid[0] + inward[0] * dist, mid[1] + inward[1] * dist];
      out.push({
        name: `${room.key}-wall-${w.compass}`,
        label: `the ${w.compass} wall of ${room.key}, straight on from the opposite side (t grows left to right in the image)`,
        room: room.key,
        kind: 'wall',
        position: toWorld(f, pos, eye, room.levelId),
        target: toWorld(f, mid, Math.min(1.3, room.ceiling / 2), room.levelId),
        up: [0, 1, 0],
        fov: fovForWidth(w.length, dist, aspect),
        hideTops: false,
      });
    }
  }
  // Level plans first, then per room: corners and walls interleaved by room order (already in `out` order).
  return out.slice(0, max);
}

/**
 * How a building looks from outside: a street-level view at eye height facing the main entrance from the distance a
 * passer-by would stand at, and a three-quarter aerial. The entrance is the first door that leads outside on the ground
 * floor (south when there is none). Roofs stay on: this is the picture a visitor gets before going in.
 */
export function exteriorPoses(world: WorldDoc, building: EntityId, opts: { aspect?: number } = {}): ReviewPose[] {
  const scene = readScene(world, building);
  const lvl = scene?.levels[0];
  if (!scene || !lvl) return [];
  const f = frameOf(world, scene);
  const rooms = scene.rooms.filter((r) => r.levelId === lvl.id);
  const pts = rooms.flatMap((r) => r.polygon);
  if (pts.length === 0) return [];
  const x0 = Math.min(...pts.map((q) => q[0]));
  const x1 = Math.max(...pts.map((q) => q[0]));
  const z0 = Math.min(...pts.map((q) => q[1]));
  const z1 = Math.max(...pts.map((q) => q[1]));
  const c: P2 = [(x0 + x1) / 2, (z0 + z1) / 2];
  let door: { at: P2; out: P2 } | null = null;
  for (const r of rooms) {
    for (const w of r.walls) {
      const o = w.openings.find((q) => q.kind === 'door' && q.leadsTo === 'outside');
      if (o && !door) door = { at: [w.a[0] + w.dir[0] * o.centre, w.a[1] + w.dir[1] * o.centre], out: w.out };
    }
  }
  const out: P2 = door?.out ?? [0, 1];
  const at: P2 = door?.at ?? [c[0], z1];
  const tang: P2 = [-out[1], out[0]];
  const span = Math.max(0.1, ...pts.map((q) => Math.abs((q[0] - c[0]) * tang[0] + (q[1] - c[1]) * tang[1]))) * 2;
  const size = Math.max(x1 - x0, z1 - z0);
  const aspect = opts.aspect && Number.isFinite(opts.aspect) ? Math.max(0.5, Math.min(3, opts.aspect)) : 1.5;
  const fov = 62;
  const half = (Math.tan((fov * Math.PI) / 360) * aspect);
  const dist = Math.max(9, Math.min(70, (span / 2 + 2) / half + 1.5));
  const street: P2 = [at[0] + out[0] * dist, at[1] + out[1] * dist];
  const a = Math.PI / 4;
  const dir: P2 = [out[0] * Math.cos(a) - out[1] * Math.sin(a), out[0] * Math.sin(a) + out[1] * Math.cos(a)];
  const R = size * 0.9 + 12;
  const air: P2 = [c[0] + dir[0] * R, c[1] + dir[1] * R];
  return [
    { name: 'exterior-street', label: 'the building from the street at eye height (1.6 m), facing the entrance: the front, entrance, sign, windows, roofline and forecourt', room: 'exterior', kind: 'exterior', position: toWorld(f, street, 1.6, lvl.id), target: toWorld(f, at, 2.6, lvl.id), up: [0, 1, 0], fov, hideTops: false },
    { name: 'exterior-aerial', label: 'the building from a three-quarter aerial: roof, massing, forecourt and surroundings', room: 'exterior', kind: 'exterior', position: toWorld(f, air, Math.max(9, R * 0.7), lvl.id), target: toWorld(f, c, 1.5, lvl.id), up: [0, 1, 0], fov: 50, hideTops: false },
  ];
}

function compassOf(v: P2, c: P2): string {
  const ns = v[1] < c[1] ? 'north' : 'south';
  const ew = v[0] < c[0] ? 'west' : 'east';
  return `${ns}-${ew}`;
}

/** The numbered things of a building: pieces first (by id), then doors and windows. Stable for a given document. */
export function markIndex(world: WorldDoc, building: EntityId): MarkEntry[] {
  const scene = readScene(world, building);
  if (!scene) return [];
  const out: MarkEntry[] = [];
  const items = scene.items.filter((i) => !SKIP_KINDS.has(i.kind)).sort((a, b) => a.id.localeCompare(b.id));
  for (const it of items) {
    if (out.length >= MAX_MARKS) break;
    out.push({ n: out.length + 1, id: it.id, kind: it.kind, line: itemLine(it, scene) });
  }
  const seen = new Set<string>();
  for (const r of scene.rooms) {
    for (const w of r.walls) {
      for (const o of w.openings) {
        if (seen.has(o.id) || out.length >= MAX_MARKS) continue;
        seen.add(o.id);
        out.push({ n: out.length + 1, id: o.id, kind: o.kind, line: `${o.kind} ${o.id} in ${r.key} ${w.compass} wall t ${o.t0}..${o.t1}${o.kind === 'window' ? `, sill ${o.sill}` : ''}` });
      }
    }
  }
  return out;
}

interface Cam {
  p: Vec3;
  right: Vec3;
  upv: Vec3;
  fwd: Vec3;
  tan: number;
  aspect: number;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function camOf(pose: ReviewPose, aspect: number): Cam {
  const fwd = norm(sub(pose.target, pose.position));
  let right = cross(fwd, pose.up);
  if (Math.hypot(right[0], right[1], right[2]) < 1e-6) right = cross(fwd, [0, 0, -1]);
  right = norm(right);
  const upv = norm(cross(right, fwd));
  return { p: pose.position, right, upv, fwd, tan: Math.tan((pose.fov * Math.PI) / 360), aspect };
}

function project(cam: Cam, w: Vec3): { x: number; y: number; z: number } | null {
  const d = sub(w, cam.p);
  const z = dot(d, cam.fwd);
  if (z < 0.15) return null;
  const nx = dot(d, cam.right) / (z * cam.tan * cam.aspect);
  const ny = dot(d, cam.upv) / (z * cam.tan);
  return { x: (nx + 1) / 2, y: (1 - ny) / 2, z };
}

/**
 * The marks to draw on one image: each numbered piece whose box is in front of
 * the camera and inside the frame, as a normalised box. Occlusion is not
 * modelled: a mark can sit on something hidden behind a nearer piece, so the
 * legend says which pieces are meant (the model also gets the facts).
 */
export function projectMarks(world: WorldDoc, building: EntityId, pose: ReviewPose, aspect = 1.5): ImageMark[] {
  const scene = readScene(world, building);
  if (!scene) return [];
  const f = frameOf(world, scene);
  const cam = camOf(pose, aspect);
  const index = markIndex(world, building);
  const byId = new Map(index.map((m) => [m.id, m.n]));
  const marks: ImageMark[] = [];
  const room = pose.kind === 'plan' ? null : scene.rooms.find((r) => r.key === pose.room);
  const box = (pts: Vec3[], n: number): void => {
    const proj = pts.map((p) => project(cam, p)).filter((p): p is NonNullable<typeof p> => p !== null);
    if (proj.length < Math.ceil(pts.length / 2)) return;
    const xs = proj.map((p) => p.x);
    const ys = proj.map((p) => p.y);
    const x0 = Math.max(0, Math.min(...xs));
    const x1 = Math.min(1, Math.max(...xs));
    const y0 = Math.max(0, Math.min(...ys));
    const y1 = Math.min(1, Math.max(...ys));
    if (x1 <= x0 || y1 <= y0 || x1 - x0 < 0.004 || y1 - y0 < 0.004) return;
    marks.push({ n, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: (x1 - x0) / 2, h: (y1 - y0) / 2 });
  };
  for (const it of scene.items) {
    const n = byId.get(it.id);
    if (n === undefined) continue;
    // Pieces of other rooms are behind walls in a room view.
    if (room && it.room !== room.id) continue;
    const pts: Vec3[] = [];
    for (const p of it.footprint) {
      pts.push(toWorld(f, p, it.y0, it.levelId), toWorld(f, p, it.y1, it.levelId));
    }
    box(pts, n);
  }
  const seen = new Set<string>();
  for (const r of scene.rooms) {
    for (const w of r.walls) {
      for (const o of w.openings) {
        const n = byId.get(o.id);
        if (n === undefined || seen.has(o.id)) continue;
        seen.add(o.id);
        if (room && r.id !== room.id) continue;
        box(openingCorners(f, r, w, o), n);
      }
    }
  }
  return marks.sort((a, b) => a.n - b.n);
}

function openingCorners(f: Frame, room: SceneRoom, w: SceneRoom['walls'][number], o: SceneOpening): Vec3[] {
  const at = (t: number): P2 => [w.a[0] + w.dir[0] * t - w.out[0] * w.inset, w.a[1] + w.dir[1] * t - w.out[1] * w.inset];
  const a = at(o.t0);
  const b = at(o.t1);
  return [toWorld(f, a, o.sill, room.levelId), toWorld(f, a, o.top, room.levelId), toWorld(f, b, o.sill, room.levelId), toWorld(f, b, o.top, room.levelId)];
}

/** Legend text for the numbered marks of the given images (numbers that appear in at least one). */
export function legendText(index: readonly MarkEntry[], shown: ReadonlySet<number>, limit = 60): string {
  const lines = index.filter((m) => shown.has(m.n)).slice(0, limit).map((m) => `${m.n} = ${m.line}`);
  return lines.length === 0 ? 'no numbered marks in these images' : lines.join('\n');
}

/** What {@link customPose} needs. */
export interface CustomPoseSpec {
  name: string;
  label: string;
  /** Plan id of the room the camera is in (marks of other rooms are left out). */
  room: string;
  /** Camera position on the level plan (x east, z south) and height above the floor top. */
  at: [number, number];
  height: number;
  /** Degrees clockwise from north (0 = north, 90 = east). */
  heading: number;
  /** Degrees looking up (positive) or down. */
  pitch?: number;
  /** Vertical field of view, degrees. */
  fov: number;
  /** Level index (default 0). */
  level?: number;
}

/**
 * A camera at a given spot of a building (the photo's camera, a viewpoint the user names), as a world-space
 * {@link ReviewPose}. Null when the building or level does not exist.
 */
export function customPose(world: WorldDoc, building: EntityId, spec: CustomPoseSpec): ReviewPose | null {
  const scene = readScene(world, building);
  if (!scene) return null;
  const lvl = scene.levels.find((l) => l.index === (spec.level ?? 0)) ?? scene.levels[0];
  if (!lvl) return null;
  const f = frameOf(world, scene);
  const h = (spec.heading * Math.PI) / 180;
  const pitch = ((spec.pitch ?? 0) * Math.PI) / 180;
  const reach = 6;
  const dx = Math.sin(h) * Math.cos(pitch) * reach;
  const dz = -Math.cos(h) * Math.cos(pitch) * reach;
  const dy = Math.sin(pitch) * reach;
  const to: P2 = [spec.at[0] + dx, spec.at[1] + dz];
  return {
    name: spec.name,
    label: spec.label,
    room: spec.room,
    kind: 'corner',
    position: toWorld(f, spec.at, spec.height, lvl.id),
    target: toWorld(f, to, spec.height + dy, lvl.id),
    up: [0, 1, 0],
    fov: Math.max(20, Math.min(120, spec.fov)),
    hideTops: false,
  };
}

/** The world-space corner points of every piece and opening of a building, for repeated projection from many cameras. */
export interface EntityGeometry {
  id: EntityId;
  pts: Vec3[];
}

/** Corner points of each piece and opening (the same boxes {@link projectMarks} draws), computed once. */
export function entityGeometry(world: WorldDoc, building: EntityId): EntityGeometry[] {
  const scene = readScene(world, building);
  if (!scene) return [];
  const f = frameOf(world, scene);
  const out: EntityGeometry[] = [];
  for (const it of scene.items) {
    const pts: Vec3[] = [];
    for (const p of it.footprint) pts.push(toWorld(f, p, it.y0, it.levelId), toWorld(f, p, it.y1, it.levelId));
    out.push({ id: it.id, pts });
  }
  const seen = new Set<string>();
  for (const r of scene.rooms) {
    for (const w of r.walls) {
      for (const o of w.openings) {
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        out.push({ id: o.id, pts: openingCorners(f, r, w, o) });
      }
    }
  }
  return out;
}

/** The world-space displacement of a plan displacement `d` (the building may be turned and placed anywhere). */
export function planDelta(world: WorldDoc, building: EntityId, d: P2): Vec3 | null {
  const scene = readScene(world, building);
  if (!scene) return null;
  const f = frameOf(world, scene);
  const r = rotateYaw(d[0], d[1], f.yaw);
  return [r[0], 0, r[1]];
}

/** The plan displacement (x, z of the building's frame) of a world displacement: the inverse of {@link planDelta}. */
export function planDeltaOfWorld(world: WorldDoc, building: EntityId, d: Vec3): P2 | null {
  const scene = readScene(world, building);
  if (!scene) return null;
  const f = frameOf(world, scene);
  return rotateYaw(d[0], d[2], -f.yaw);
}

/** Where a world point appears in the picture of `pose` (normalised, origin top-left; z is the depth), or null behind the camera. */
export function projectPoint(pose: ReviewPose, aspect: number, w: Vec3): { x: number; y: number; z: number } | null {
  return project(camOf(pose, aspect), w);
}

/**
 * The world point where the ray through the picture point (x, y in 0..1, origin top-left) meets a plane, or null when the ray is
 * parallel to it or the point lies behind the camera.
 */
export function unprojectToPlane(pose: ReviewPose, aspect: number, x: number, y: number, plane: { point: Vec3; normal: Vec3 }): Vec3 | null {
  const cam = camOf(pose, aspect);
  const nx = 2 * x - 1;
  const ny = 1 - 2 * y;
  const d: Vec3 = [
    cam.fwd[0] + cam.right[0] * nx * cam.tan * cam.aspect + cam.upv[0] * ny * cam.tan,
    cam.fwd[1] + cam.right[1] * nx * cam.tan * cam.aspect + cam.upv[1] * ny * cam.tan,
    cam.fwd[2] + cam.right[2] * nx * cam.tan * cam.aspect + cam.upv[2] * ny * cam.tan,
  ];
  const den = dot(d, plane.normal);
  if (Math.abs(den) < 1e-6) return null;
  const t = dot(sub(plane.point, cam.p), plane.normal) / den;
  if (t <= 0) return null;
  return [cam.p[0] + d[0] * t, cam.p[1] + d[1] * t, cam.p[2] + d[2] * t];
}

/** A normalised image box (x0, y0, x1, y1; origin top-left). */
export type ImageBox = [number, number, number, number];

/**
 * Project precomputed geometry through a camera: the box of each entity that is in front of it and inside the frame
 * (clipped to the image). Entities that cannot be seen are left out. No occlusion.
 */
export function projectGeometry(geometry: readonly EntityGeometry[], pose: ReviewPose, aspect: number): Map<EntityId, ImageBox> {
  const cam = camOf(pose, aspect);
  const out = new Map<EntityId, ImageBox>();
  for (const g of geometry) {
    const proj = g.pts.map((p) => project(cam, p)).filter((p): p is NonNullable<typeof p> => p !== null);
    if (proj.length < Math.ceil(g.pts.length / 2)) continue;
    const xs = proj.map((p) => p.x);
    const ys = proj.map((p) => p.y);
    const x0 = Math.max(0, Math.min(...xs));
    const x1 = Math.min(1, Math.max(...xs));
    const y0 = Math.max(0, Math.min(...ys));
    const y1 = Math.min(1, Math.max(...ys));
    if (x1 <= x0 || y1 <= y0) continue;
    out.set(g.id, [x0, y0, x1, y1]);
  }
  return out;
}

/** A shape on one image, in normalised image coordinates (origin top-left). */
export interface ImageOverlay {
  kind: PlanOverlay['kind'];
  closed: boolean;
  label: string;
  pts: Array<[number, number]>;
}

/** The advisory shapes of the room (door arcs, approach zones, walking paths) projected onto one image. */
export function projectOverlays(world: WorldDoc, building: EntityId, pose: ReviewPose, overlays: readonly PlanOverlay[], levelId?: EntityId, aspect = 1.5): ImageOverlay[] {
  const scene = readScene(world, building);
  if (!scene) return [];
  const f = frameOf(world, scene);
  const cam = camOf(pose, aspect);
  const lv = levelId ?? scene.levels[0]?.id;
  if (!lv) return [];
  const out: ImageOverlay[] = [];
  for (const o of overlays) {
    const pts = o.pts.map((p) => project(cam, toWorld(f, p, 0.02, lv)));
    if (pts.some((p) => p === null)) continue;
    out.push({ kind: o.kind, closed: o.closed, label: o.label, pts: pts.map((p) => [p!.x, p!.y] as [number, number]) });
  }
  return out;
}
