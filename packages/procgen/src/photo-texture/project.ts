/**
 * The photo's camera as a projection, and the room's surfaces as planes: the geometry that turns a region of the photograph into a
 * flat, metric picture of a wall, the floor or the ceiling.
 *
 * Frame (as in `../description`): metres, x east, z south, y up; the room is x 0..width by z 0..depth, ceiling at `ceiling`. The
 * camera stands at (x, height, z), looks `heading` degrees clockwise from north and `pitch` degrees up, with a HORIZONTAL field of
 * view of `fov` degrees; the picture's v axis points down.
 */
import type { PhotoCamera } from '@aether/arch/photo';

export type V3 = readonly [number, number, number];

/** A pinhole camera. */
export interface CameraModel {
  pos: V3;
  right: V3;
  up: V3;
  fwd: V3;
  /** tan of half the horizontal and vertical field of view. */
  tanH: number;
  tanV: number;
}

const rad = (d: number): number => (d * Math.PI) / 180;
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The camera the description implies for a picture of `aspect` (width / height). */
export function cameraModel(cam: Pick<PhotoCamera, 'x' | 'z' | 'height' | 'heading' | 'pitch' | 'fov'>, aspect: number): CameraModel {
  const h = rad(cam.heading);
  const p = rad(cam.pitch);
  const fwd: V3 = [Math.sin(h) * Math.cos(p), Math.sin(p), -Math.cos(h) * Math.cos(p)];
  const right: V3 = [Math.cos(h), 0, Math.sin(h)];
  const up = cross(right, fwd);
  const tanH = Math.tan(rad(Math.max(20, Math.min(130, cam.fov))) / 2);
  return { pos: [cam.x, cam.height, cam.z], right, up, fwd, tanH, tanV: tanH / Math.max(0.3, aspect) };
}

/** Where a world point lands in the picture: u, v in 0..1 (v down) and the depth along the view axis; null behind the camera. */
export function project(m: CameraModel, p: V3): { u: number; v: number; depth: number } | null {
  const d = sub(p, m.pos);
  const z = dot(d, m.fwd);
  if (z < 0.05) return null;
  return { u: 0.5 + (0.5 * dot(d, m.right)) / (z * m.tanH), v: 0.5 - (0.5 * dot(d, m.up)) / (z * m.tanV), depth: z };
}

/** A rectangle of a surface: world point = origin + u * uAxis + v * vAxis, for u in 0..width, v in 0..height (metres). */
export interface PlaneSpec {
  id: string;
  origin: V3;
  uAxis: V3;
  vAxis: V3;
  /** Outward-facing normal on the room side (towards the room's inside). */
  normal: V3;
  width: number;
  height: number;
}

/** The inside faces of a rectangular room as planes (`wall-<compass>`, `floor`, `ceiling`); the v axis of a wall points down. */
export function roomPlanes(room: { width: number; depth: number; ceiling: number }): Record<string, PlaneSpec> {
  const { width: W, depth: D, ceiling: H } = room;
  return {
    floor: { id: 'floor', origin: [0, 0, 0], uAxis: [1, 0, 0], vAxis: [0, 0, 1], normal: [0, 1, 0], width: W, height: D },
    ceiling: { id: 'ceiling', origin: [0, H, 0], uAxis: [1, 0, 0], vAxis: [0, 0, 1], normal: [0, -1, 0], width: W, height: D },
    'wall-north': { id: 'wall-north', origin: [0, H, 0], uAxis: [1, 0, 0], vAxis: [0, -1, 0], normal: [0, 0, 1], width: W, height: H },
    'wall-south': { id: 'wall-south', origin: [W, H, D], uAxis: [-1, 0, 0], vAxis: [0, -1, 0], normal: [0, 0, -1], width: W, height: H },
    'wall-east': { id: 'wall-east', origin: [W, H, 0], uAxis: [0, 0, 1], vAxis: [0, -1, 0], normal: [-1, 0, 0], width: D, height: H },
    'wall-west': { id: 'wall-west', origin: [0, H, D], uAxis: [0, 0, -1], vAxis: [0, -1, 0], normal: [1, 0, 0], width: D, height: H },
  };
}

/** World point of plane coordinates (metres). */
export function planePoint(pl: PlaneSpec, s: number, t: number): V3 {
  return [pl.origin[0] + pl.uAxis[0] * s + pl.vAxis[0] * t, pl.origin[1] + pl.uAxis[1] * s + pl.vAxis[1] * t, pl.origin[2] + pl.uAxis[2] * s + pl.vAxis[2] * t];
}

/** Cosine between the view ray to a world point and the plane's normal (1 face on, 0 grazing); 0 when the plane faces away. */
export function viewCosine(m: CameraModel, pl: PlaneSpec, p: V3): number {
  const d = sub(p, m.pos);
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return 0;
  return Math.max(0, -dot(d, pl.normal) / len);
}
