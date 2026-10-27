/**
 * Ground truth of a self-test photo: a world we built ourselves, drawn from a camera we chose, so everything the photo
 * pipeline estimates (camera, room box, depth, objects, colours) has a known right answer. No model, no photo pixels here:
 * pure geometry and bookkeeping, shared by the fixture renderer (GPU) and the scorer (CPU).
 *
 * Conventions (the same words the pipeline uses): plan x east, z south, y up; heading in degrees clockwise from north
 * (0 looks along -z, 90 along +x); pitch in degrees, positive looks up; `hfov` is the HORIZONTAL field of view of the
 * photo, `vfov` the vertical one at the photo's aspect. Room frame: `u` metres from the left wall (as the camera looks),
 * `v` metres from the back wall toward the camera, the back wall being the wall the camera faces most squarely.
 */
import type { EntityId, Vec3, WorldDoc } from '@aether/core';
import { readScene, type Scene, type SceneItem, type SceneRoom } from '@aether/arch';

export interface TruthCamera {
  /** World position of the eye. */
  pos: Vec3;
  heading: number;
  pitch: number;
  hfov: number;
  vfov: number;
  aspect: number;
  /** The eye on the level plan and its height above the floor top (what the photo camera spec uses). */
  plan: { at: [number, number]; height: number };
}

export interface TruthItem {
  id: string;
  kind: string;
  name: string;
  mount: string;
  yaw: number;
  /** Centre and axis-aligned extents of the whole piece in the room frame (w along the back wall, d toward the camera). */
  centre: { u: number; v: number };
  size: { w: number; d: number; h: number };
  y0: number;
  y1: number;
  /** Every colour the entity's generator parameters name, by key, and the one that stands for the piece. */
  hexes: Record<string, string>;
  mainHex: string | null;
}

export interface TruthRoom {
  building: string;
  roomKey: string;
  /** Interior rectangle on the plan: x0, z0, x1, z1. */
  bbox: [number, number, number, number];
  /** Interior size along the back wall, toward the camera, and floor to ceiling. */
  width: number;
  depth: number;
  height: number;
  /** Compass index of the back wall (0 north, 1 east, 2 south, 3 west). */
  back: number;
  /** Degrees the camera is turned from squarely facing the back wall (positive: to the right). */
  yawRel: number;
}

/** Compass index (0 north, 1 east, 2 south, 3 west) of the wall the camera looks at, as the build plan chooses it. */
export const backIndex = (headingDeg: number): number => ((Math.round((((headingDeg % 360) + 360) % 360) / 90) % 4) + 4) % 4;

/** Plan point (x east, z south) to the room frame of a rectangle with the given back wall. `W`,`D` are the plan extents along x and z. */
export function planToRoom(back: number, x: number, z: number, W: number, D: number): [number, number] {
  switch (back) {
    case 0: return [x, z];
    case 1: return [z, W - x];
    case 2: return [W - x, D - z];
    default: return [D - z, x];
  }
}

/** Direction vectors of a camera: forward, right, up. */
export function basis(heading: number, pitch: number): { fwd: Vec3; right: Vec3; up: Vec3 } {
  const h = (heading * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  const fwd: Vec3 = [Math.sin(h) * Math.cos(p), Math.sin(p), -Math.cos(h) * Math.cos(p)];
  const right: Vec3 = [Math.cos(h), 0, Math.sin(h)];
  const up: Vec3 = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  return { fwd, right, up };
}

/** The ray through the centre of pixel (i, j) of a w x h grid. */
export function rayAt(cam: TruthCamera, i: number, j: number, w: number, h: number): Vec3 {
  const { fwd, right, up } = basis(cam.heading, cam.pitch);
  const t = Math.tan((cam.vfov * Math.PI) / 360);
  const nx = ((i + 0.5) / w) * 2 - 1;
  const ny = 1 - ((j + 0.5) / h) * 2;
  const d: Vec3 = [fwd[0] + right[0] * nx * t * cam.aspect + up[0] * ny * t, fwd[1] + right[1] * nx * t * cam.aspect + up[1] * ny * t, fwd[2] + right[2] * nx * t * cam.aspect + up[2] * ny * t];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
}

/** Vertical field of view of a horizontal one at an aspect. */
export const vfovOf = (hfov: number, aspect: number): number => (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / aspect) * 180) / Math.PI;

/** A camera standing at plan point `at`, `height` above the floor top of the level, looking along `heading`. */
export function makeCamera(levelY: number, at: [number, number], height: number, heading: number, pitch: number, hfov: number, aspect: number): TruthCamera {
  return { pos: [at[0], levelY + height, at[1]], heading, pitch, hfov, vfov: vfovOf(hfov, aspect), aspect, plan: { at, height } };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
/** Colours named in a procedural shape's parameters (nested one level), keyed by their parameter name. */
export function paramHexes(params: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (o: unknown, path: string, depth: number): void => {
    if (!o || typeof o !== 'object' || depth > 2) return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === 'string' && HEX.test(v)) out[path ? `${path}.${k}` : k] = v.toLowerCase();
      else if (v && typeof v === 'object') walk(v, k, depth + 1);
    }
  };
  walk(params, '', 0);
  return out;
}

/** Parameter names that carry the piece's main surface, best first. */
const MAIN_KEYS = ['linen', 'fabric', 'cushion', 'upholstery', 'seat', 'top', 'body', 'colour', 'color', 'shade', 'leaf', 'cloth', 'fill', 'frame'];
function mainHex(h: Record<string, string>): string | null {
  for (const k of MAIN_KEYS) { const hit = Object.keys(h).find((x) => x === k || x.endsWith(`.${k}`)); if (hit) return h[hit] as string; }
  return Object.values(h)[0] ?? null;
}

/** The truth room: the largest rectangular room of the building, seen from this camera. */
export function truthRoom(world: WorldDoc, building: EntityId, cam: TruthCamera): { room: TruthRoom; scene: Scene; sr: SceneRoom } | null {
  const scene = readScene(world, building);
  if (!scene) return null;
  const rooms = scene.rooms.filter((r) => r.polygon.length === 4 && r.level === 0);
  const sr = [...rooms].sort((a, b) => b.area - a.area)[0];
  if (!sr) return null;
  const [x0, z0, x1, z1] = sr.bbox;
  const back = backIndex(cam.heading);
  const W = x1 - x0;
  const D = z1 - z0;
  const backHeading = back * 90;
  let yawRel = cam.heading - backHeading;
  yawRel = ((((yawRel + 180) % 360) + 360) % 360) - 180;
  return { room: { building, roomKey: sr.key, bbox: [x0, z0, x1, z1], width: back % 2 === 0 ? W : D, depth: back % 2 === 0 ? D : W, height: sr.ceiling, back, yawRel: Math.round(yawRel * 10) / 10 }, scene, sr };
}

/** Pieces of the room as truth items in the room frame of `room`. */
export function truthItems(world: WorldDoc, scene: Scene, room: TruthRoom, sr: SceneRoom): TruthItem[] {
  const [x0, z0, x1, z1] = room.bbox;
  const W = x1 - x0;
  const D = z1 - z0;
  const out: TruthItem[] = [];
  for (const it of scene.items as SceneItem[]) {
    if (it.levelId !== sr.levelId) continue;
    const pts = it.footprint.map((p) => planToRoom(room.back, p[0] - x0, p[1] - z0, W, D));
    if (pts.length === 0) continue;
    const us = pts.map((p) => p[0]);
    const vs = pts.map((p) => p[1]);
    const e = world.entities[it.id as EntityId];
    const hexes = paramHexes((e?.shape as { params?: unknown } | undefined)?.params);
    out.push({
      id: it.id, kind: it.kind, name: it.name, mount: it.mount, yaw: it.yaw,
      centre: { u: (Math.min(...us) + Math.max(...us)) / 2, v: (Math.min(...vs) + Math.max(...vs)) / 2 },
      size: { w: Math.max(...us) - Math.min(...us), d: Math.max(...vs) - Math.min(...vs), h: it.y1 - it.y0 },
      y0: it.y0, y1: it.y1, hexes, mainHex: mainHex(hexes),
    });
  }
  return out;
}

/** Whether a plan point lies inside any piece's footprint (a camera must not stand in furniture). */
export function insideAnyPiece(scene: Scene, x: number, z: number, y: number): boolean {
  for (const it of scene.items) {
    // a piece standing on the floor blocks the eye above it too (an eye floating over a bed is not a photograph)
    if (it.y0 > 0.1 && (y < it.y0 || y > it.y1)) continue;
    const xs = it.footprint.map((p) => p[0]);
    const zs = it.footprint.map((p) => p[1]);
    if (x >= Math.min(...xs) - 0.15 && x <= Math.max(...xs) + 0.15 && z >= Math.min(...zs) - 0.15 && z <= Math.max(...zs) + 0.15) return true;
  }
  return false;
}

export interface PoseSpec {
  name: string;
  /** Eye on the plan as shares of the interior rectangle (0..1 along x and z), heading and horizontal field of view. */
  at: [number, number];
  heading: number;
  pitch: number;
  hfov: number;
}

/** Standard poses for a rectangular room: from the middle of a short end looking down the room, and from a corner looking across. */
export function standardPoses(bbox: readonly [number, number, number, number], wide = false): PoseSpec[] {
  const [x0, z0, x1, z1] = bbox;
  const W = x1 - x0;
  const D = z1 - z0;
  const longX = W >= D;
  // end pose: stand 0.7 m inside the middle of a short wall, look along the long axis
  const end: PoseSpec = longX
    ? { name: 'end', at: [0.7 / W, 0.5], heading: 90, pitch: -3, hfov: 68 }
    : { name: 'end', at: [0.5, 1 - 0.7 / D], heading: 0, pitch: -3, hfov: 68 };
  // corner pose: stand 0.7 m from a corner, look at the opposite one
  const cx = 0.7 / W;
  const cz = 0.7 / D;
  const dx = x1 - x0 - 1.4;
  const dz = z1 - z0 - 1.4;
  const corner: PoseSpec = { name: 'corner', at: [cx, 1 - cz], heading: Math.round(((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360), pitch: -4, hfov: 70 };
  const list = [end, corner];
  if (wide) list.push({ ...end, name: 'end-wide', hfov: 92 });
  return list;
}
