/**
 * Standard-size sanity for a room built from a photograph, as advisory text for the assistant. A picture has no scale of its own:
 * the model reads the room's size from the furniture it knows, and a misread shows as a room that feels small (beds wall to
 * wall, a door that cannot open) or too big. These are the ordinary sizes of the things in a room, measured on the built room;
 * the assistant compares them with what the photograph shows and decides whether to change the footprint. Nothing here changes
 * the room or gates a round.
 */
import type { WorldDoc } from '@aether/core';
import { readScene } from '../scene/read';
import { roomAdvice } from '../scene/advice';
import { PHOTO_BUILDING_ID, PHOTO_ROOM_ID } from './derive';

/** Usual size ranges (metres) of things a room holds: [min, max] of the width (the long edge for beds). */
const STANDARD: ReadonlyArray<{ kind: string; label: string; w: readonly [number, number]; d: readonly [number, number] }> = [
  { kind: 'door', label: 'a door', w: [0.8, 1.0], d: [0, 0] },
  { kind: 'bed', label: 'a bed (single 0.9 x 1.9-2.0 m, double 1.4-1.6 x 2.0 m)', w: [0.9, 1.8], d: [1.9, 2.1] },
];

/** The advisory (empty when the room cannot be read or everything is in the usual range). */
export function scaleAdvisory(world: WorldDoc): string {
  const scene = readScene(world, PHOTO_BUILDING_ID);
  const room = scene?.rooms.find((r) => r.key === PHOTO_ROOM_ID);
  if (!scene || !room) return '';
  const lines: string[] = [];
  const [x0, z0, x1, z1] = room.bbox;
  const w = Math.round((x1 - x0) * 100) / 100;
  const d = Math.round((z1 - z0) * 100) / 100;
  const type = String(room.type);
  const beds = scene.items.filter((i) => i.kind === 'bed' && i.room === room.id);
  const bedRoom = type === 'bedroom' || type === 'kids';
  const floor = scene.items.filter((i) => i.mount === 'floor' && i.room === room.id && i.kind !== 'rug');
  const covered = floor.reduce((s, i) => s + i.size[0] * i.size[2], 0);
  lines.push(`Scale check (standard sizes, advisory): the ${type} is ${w} x ${d} m (${room.area.toFixed(1)} m2) under a ${room.ceiling.toFixed(2)} m ceiling, with ${floor.length} floor pieces covering ${covered.toFixed(1)} m2 (${Math.round((covered / Math.max(0.1, room.area)) * 100)}% of the floor).`);
  const notes: string[] = [];
  if (bedRoom && Math.min(w, d) < 3.5) notes.push(`a bedroom is usually 3.5 x 4 m or more (this one is ${Math.min(w, d)} m across)`);
  if (bedRoom && beds.length >= 2 && Math.min(w, d) < 4) notes.push('two beds with a walking gap (0.7 m between them, 0.9 m round the door) want about 4 m across');
  if (room.ceiling < 2.4 || room.ceiling > 3.2) notes.push(`ceilings are usually 2.4 to 2.8 m (this one is ${room.ceiling.toFixed(2)} m)`);
  if (covered / Math.max(0.1, room.area) > 0.38) notes.push(`furniture covers over a third of the floor, so it reads cramped: either the room is larger than read or a piece is not there`);
  for (const b of beds) {
    const [bw, bd] = [Math.min(b.size[0], b.size[2]), Math.max(b.size[0], b.size[2])];
    const std = STANDARD[1]!;
    if (bw < std.w[0] - 0.05 || bw > std.w[1] + 0.05 || bd < std.d[0] - 0.1 || bd > std.d[1] + 0.2) notes.push(`bed ${b.id} is ${bw.toFixed(2)} x ${bd.toFixed(2)} m, ${std.label} is the usual`);
  }
  for (const wall of room.walls) {
    for (const o of wall.openings) {
      if (o.kind !== 'door') continue;
      if (o.width < 0.7 || o.width > 1.3) notes.push(`door ${o.id} is ${o.width.toFixed(2)} m wide (usual: 0.8 to 1.0 m; a wide glazed door hangs as a pair of leaves)`);
      if (o.top < 1.95 || o.top > 2.5) notes.push(`door ${o.id} is ${o.top.toFixed(2)} m tall (usual: 2.05 m)`);
    }
  }
  const advice = roomAdvice(scene, room).lines;
  if (notes.length === 0) lines.push('Everything measured is in the ordinary range for such a room.');
  else lines.push(...notes.map((n) => `- ${n}`), 'Compare these with what the photograph shows (the size of the beds and doors against the room, the walking space). If the room looks cramped against the picture, decide what to do: enlarge the footprint, move a piece, or remove one that the picture does not show, then render again and look. If the picture really is a small room, keep it.');
  if (advice.length > 0) lines.push('Circulation (advisory; drawn on the plan view: green swing arcs, amber approach zones, blue walking paths, red blocked pieces):', ...advice.map((a) => `- ${a}`));
  return lines.join('\n');
}
/** The parts of a room description that move when the room is resized (a description as read, parsed or not). */
interface Resizable {
  footprint: { width: number; depth: number; [k: string]: unknown };
  items?: Array<{ wall?: string; along?: number; at?: readonly [number, number] | number[] }>;
  openings?: Array<{ wall?: string; along?: number }>;
  niches?: Array<{ wall?: string; along?: number }>;
  camera?: { x: number; z: number; [k: string]: unknown };
  [k: string]: unknown;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

/** A position along a wall or on the floor that keeps its distance from the nearer end: pieces stay against the wall they stand on. */
export function anchored(v: number, from: number, to: number): number {
  return r2(v <= from / 2 ? v : v + (to - from));
}

/** A position that keeps its distance from the middle: openings and what hangs beside them stay centred on the wall. */
export function centred(v: number, from: number, to: number): number {
  return r2(v + (to - from) / 2);
}

/**
 * The same room at another floor size. Furniture and openings keep their real sizes: floor pieces stay against the wall they
 * stand on (the new floor opens up in the middle, where people walk), pieces along a wall and openings stay centred on it. A
 * decision tool (the assistant, or a fixture that records its decision), never a silent step of the build. The input is not changed.
 */
export function rescaleDescription<T extends Resizable>(d: T, width: number, depth: number): T {
  const W = d.footprint.width;
  const D = d.footprint.depth;
  const out = structuredClone(d) as T;
  out.footprint.width = r2(width);
  out.footprint.depth = r2(depth);
  const along = (wall: string | undefined, v: number): number => (wall === 'north' || wall === 'south' ? centred(v, W, width) : centred(v, D, depth));
  for (const it of out.items ?? []) {
    if (it.along !== undefined) it.along = along(it.wall, it.along);
    if (it.at) it.at = [anchored(it.at[0] as number, W, width), anchored(it.at[1] as number, D, depth)];
  }
  for (const o of out.openings ?? []) if (o.along !== undefined) o.along = along(o.wall, o.along);
  for (const n of out.niches ?? []) if (n.along !== undefined) n.along = along(n.wall, n.along);
  if (out.camera) out.camera = { ...out.camera, x: centred(out.camera.x, W, width), z: anchored(out.camera.z, D, depth) };
  return out;
}
