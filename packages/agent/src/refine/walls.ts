/**
 * Wall geometry for edits like "wallpaper on the bedroom's back wall":
 * which wall entities bound a room, which of their two faces looks into it,
 * and which one is the "back" / "left" / "feature" wall for the viewer.
 */
import type { EntityId, Json } from '@aether/core';
import type { SceneIndex, SceneItem } from './scene';

/** A viewer heading in degrees: 0 looks toward −Z, 90 toward +X. */
export type Heading = number;

/** Forward and right vectors on the ground plane for a heading. */
export function viewVectors(heading: Heading): { forward: [number, number]; right: [number, number] } {
  const a = (heading * Math.PI) / 180;
  return { forward: [Math.sin(a), -Math.cos(a)], right: [Math.cos(a), Math.sin(a)] };
}

/** One face of one wall entity. */
export interface WallFace {
  wallId: EntityId;
  /** Which finish slot faces into the room ('a' → finishA). */
  side: 'a' | 'b';
}

/** A room edge with the wall faces that cover it. */
export interface RoomWall {
  roomId: EntityId;
  /** Outward unit normal on the ground plane (world). */
  out: [number, number];
  /** Edge midpoint (world). */
  mid: [number, number];
  length: number;
  faces: WallFace[];
  /** Longest wall entity covering this edge extends past it by more than this (metres): its finish is shared with the next room. */
  spill: number;
  /** Number of window / door openings along the edge. */
  windows: number;
  doors: number;
  exterior: boolean;
}

function rot(p: [number, number], yawDeg: number): [number, number] {
  const a = (yawDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c + p[1] * s, -p[0] * s + p[1] * c];
}

function inPoly(x: number, z: number, poly: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i] as [number, number];
    const [xj, zj] = poly[j] as [number, number];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** The room polygon in world coordinates (null when the entity is not a slab). */
export function roomPolygon(index: SceneIndex, room: SceneItem): [number, number][] | null {
  const sh = room.entity.shape;
  if (sh.kind !== 'procedural') return null;
  const poly = sh.params['polygon'] as Json | undefined;
  if (!Array.isArray(poly)) return null;
  const level = room.entity.parent !== null ? index.get(room.entity.parent) : undefined;
  const origin: [number, number] = level ? [level.pos[0], level.pos[2]] : [0, 0];
  const yaw = level ? level.yaw : 0;
  const out: [number, number][] = [];
  for (const p of poly) {
    if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') return null;
    const r = rot([p[0], p[1]], yaw);
    out.push([origin[0] + r[0], origin[1] + r[1]]);
  }
  return out.length >= 3 ? out : null;
}

function polygonSign(poly: readonly [number, number][]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as [number, number];
    const q = poly[(i + 1) % poly.length] as [number, number];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a >= 0 ? 1 : -1;
}

interface WallSeg {
  item: SceneItem;
  a: [number, number];
  b: [number, number];
  /** Unit direction of the wall (world). */
  dir: [number, number];
  length: number;
  openings: { kind: string }[];
}

function wallSegs(index: SceneIndex): WallSeg[] {
  const out: WallSeg[] = [];
  for (const it of index.items) {
    if (it.entity.arch?.role !== 'wall') continue;
    const sh = it.entity.shape;
    if (sh.kind !== 'procedural') continue;
    const len = typeof sh.params['length'] === 'number' ? sh.params['length'] : 0;
    if (len <= 0) continue;
    const a = (it.yaw * Math.PI) / 180;
    const dir: [number, number] = [Math.cos(a), -Math.sin(a)];
    const openings = Array.isArray(sh.params['openings']) ? (sh.params['openings'] as Json[]).filter((o): o is { kind: string } => typeof o === 'object' && o !== null && !Array.isArray(o) && typeof o['kind'] === 'string') : [];
    out.push({ item: it, a: [it.pos[0], it.pos[2]], b: [it.pos[0] + dir[0] * len, it.pos[2] + dir[1] * len], dir, length: len, openings });
  }
  return out;
}

const CACHE = new WeakMap<SceneIndex, WallSeg[]>();

/** Walls bounding `room`, one entry per polygon edge. */
export function roomWalls(index: SceneIndex, room: SceneItem): RoomWall[] {
  const poly = roomPolygon(index, room);
  if (!poly) return [];
  let segs = CACHE.get(index);
  if (!segs) {
    segs = wallSegs(index);
    CACHE.set(index, segs);
  }
  const sign = polygonSign(poly);
  const out: RoomWall[] = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i] as [number, number];
    const B = poly[(i + 1) % poly.length] as [number, number];
    const dx = B[0] - A[0];
    const dz = B[1] - A[1];
    const length = Math.hypot(dx, dz);
    if (length < 0.2) continue;
    const ux = dx / length;
    const uz = dz / length;
    // Outward normal: for a counter-clockwise (positive) polygon in (x, z) the outside is to the right of the edge.
    const out2: [number, number] = sign > 0 ? [uz, -ux] : [-uz, ux];
    const faces: WallFace[] = [];
    let windows = 0;
    let doors = 0;
    let exterior = false;
    let spill = 0;
    for (const w of segs) {
      // Collinear and overlapping.
      const d1 = Math.abs((w.a[0] - A[0]) * uz - (w.a[1] - A[1]) * ux);
      const d2 = Math.abs((w.b[0] - A[0]) * uz - (w.b[1] - A[1]) * ux);
      if (d1 > 0.25 || d2 > 0.25) continue;
      const t0 = (w.a[0] - A[0]) * ux + (w.a[1] - A[1]) * uz;
      const t1 = (w.b[0] - A[0]) * ux + (w.b[1] - A[1]) * uz;
      const lo = Math.max(0, Math.min(t0, t1));
      const hi = Math.min(length, Math.max(t0, t1));
      if (hi - lo < 0.3) continue;
      const mid: [number, number] = [A[0] + ux * ((lo + hi) / 2), A[1] + uz * ((lo + hi) / 2)];
      // Face of the wall looking into the room: +n is side b.
      const n: [number, number] = [-w.dir[1], w.dir[0]];
      const inB = inPoly(mid[0] + n[0] * 0.25, mid[1] + n[1] * 0.25, poly);
      faces.push({ wallId: w.item.id, side: inB ? 'b' : 'a' });
      spill = Math.max(spill, w.length - (hi - lo));
      for (const o of w.openings) {
        if (o.kind === 'window') windows++;
        else doors++;
      }
      if (w.item.entity.arch?.kind === 'exterior') exterior = true;
    }
    if (faces.length === 0) continue;
    out.push({ roomId: room.id, out: out2, mid: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], length, faces, spill, windows, doors, exterior });
  }
  return out;
}

/** Pick walls of a room by a side word ("back", "left", "north", "feature"). Returns all walls for no/unknown side. */
export function wallsBySide(walls: readonly RoomWall[], side: string | undefined, heading: Heading): RoomWall[] {
  if (!side || walls.length === 0) return [...walls];
  const { forward, right } = viewVectors(heading);
  const dot = (w: RoomWall, v: [number, number]): number => w.out[0] * v[0] + w.out[1] * v[1];
  const best = (score: (w: RoomWall) => number): RoomWall[] => {
    let top = -Infinity;
    for (const w of walls) top = Math.max(top, score(w));
    // Walls that tie for the best direction (a wall split by another room's junction).
    return walls.filter((w) => score(w) > top - 0.15 && score(w) > 0.3);
  };
  switch (side) {
    case 'back':
    case 'rear':
    case 'far':
    case 'opposite':
      return best((w) => dot(w, forward));
    case 'front':
      return best((w) => -dot(w, forward));
    case 'left':
      return best((w) => -dot(w, right));
    case 'right':
      return best((w) => dot(w, right));
    case 'north':
      return best((w) => -w.out[1]);
    case 'south':
      return best((w) => w.out[1]);
    case 'east':
      return best((w) => w.out[0]);
    case 'west':
      return best((w) => -w.out[0]);
    case 'feature':
    case 'accent': {
      // The longest wall without openings (an accent wall is plain), else the longest.
      const plain = walls.filter((w) => w.windows + w.doors === 0);
      const pool = plain.length > 0 ? plain : walls;
      let pick = pool[0] as RoomWall;
      for (const w of pool) if (w.length > pick.length) pick = w;
      return [pick];
    }
    case 'window':
      return walls.filter((w) => w.windows > 0);
    case 'entrance':
      return walls.filter((w) => w.doors > 0);
    case 'main': {
      let pick = walls[0] as RoomWall;
      for (const w of walls) if (w.length > pick.length) pick = w;
      return [pick];
    }
    default:
      return [...walls];
  }
}

/** All interior faces (wall id + slot) of a room. */
export function roomFaces(index: SceneIndex, room: SceneItem): WallFace[] {
  return roomWalls(index, room).flatMap((w) => w.faces);
}
