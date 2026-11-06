/**
 * Tour stops of a published world when it has none of its own: 4 to 8 camera poses the player's tour bar glides
 * between (and the cook stores in its manifest, so a cooked world does not compute them again).
 *
 * - Architecture: one stop per room, at eye height (1.6 m over its floor), from the spot and direction that see the most
 *   of the room: its middle or a corner looking across it (the estate photographer's view), never standing in furniture
 *   and with nothing within {@link NEAR_ZONE} of the lens where the room allows it.
 * - Scenes and cities: the opening-view search (`opening-view.ts`, with all its checks: open dry ground, clearance round
 *   the eye, the near zone, not under water) run once per section of the scene (`tourSections`: the clusters of built
 *   pieces a drone tour visits), filled up with the next best views of the whole scene, at least {@link MIN_STOP_SPACING}
 *   apart.
 *
 * Stops are ordered as a walk: from the first (the hero view) each next one is the nearest not yet visited.
 * Pure and deterministic (no three.js): the renderer supplies the probe.
 */
import type { Vec3 } from '@aether/core';
import type { FramingItem, SightTest } from './framing';
import { drainSteps, NEAR_ZONE, nearestInView, rankOpeningViewsSteps, type OpeningInput, type OpeningProbe } from './opening-view';
import { tourSections } from './tour';

/** One tour stop. */
export interface ViewStopPose {
  position: Vec3;
  target: Vec3;
  fov?: number;
  /** Label (a room's name, a landmark's). */
  name?: string;
  /** The room entity a room stop belongs to (architecture). */
  room?: string;
}

/** Fewest stops worth a tour bar (fewer only when the scene has no more places to stand). */
export const MIN_STOPS = 4;
/** Most stops computed. */
export const MAX_STOPS = 8;
/** Eye height of a room stop over its floor (m). */
export const ROOM_EYE = 1.6;
/** Closest two computed stops may be (m). */
export const MIN_STOP_SPACING = 8;
/** Downward pitch of a room stop (radians): a level horizon a little above the middle, more floor than ceiling. */
const ROOM_PITCH = -0.1;
/** Nearest content a room stop accepts in its frame when no spot of the room keeps {@link NEAR_ZONE} free (m). */
const ROOM_NEAR_MIN = 0.9;

const deg = Math.PI / 180;

/** A room of a building: its floor's box in the world and its name. */
export interface RoomArea {
  id: string;
  name: string;
  min: Vec3;
  max: Vec3;
  /** Height of the walking surface. */
  floorY: number;
}

/** What room stops ask of the scene. */
export interface RoomProbe {
  sight: SightTest;
  /** Short clearance tests (default `sight`). */
  near?: SightTest;
  /** The point lies on this room's floor (an L-shaped room's box covers more than the room); default: inside the box. */
  inRoom?(room: RoomArea, x: number, z: number): boolean;
}

/** Free share (0–1) of five eye-level rays across the view toward `yaw`, each up to `len` m. */
function openShare(sight: SightTest, eye: Vec3, yaw: number, hHalf: number, len: number): number {
  let open = 0;
  for (let i = -2; i <= 2; i++) {
    const a = yaw + (i / 2) * hHalf * 0.8;
    open += Math.min(len, sight(eye, [eye[0] + Math.sin(a) * len, eye[1], eye[2] + Math.cos(a) * len])) / len;
  }
  return open / 5;
}

/** Target of a pose at `eye` looking along `yaw` (0 looks along +Z) and `pitch`, `dist` m ahead. */
function aim(eye: Vec3, yaw: number, pitch: number, dist = 4): Vec3 {
  const c = Math.cos(pitch);
  return [eye[0] + Math.sin(yaw) * c * dist, eye[1] + Math.sin(pitch) * dist, eye[2] + Math.cos(yaw) * c * dist];
}

/**
 * The stop of one room: from its middle (eight directions) and from each corner, a little in from the walls, looking across
 * the room, the pose whose view is the most open with the nearest content farthest from the lens. Spots in furniture (a
 * bed, a table: something between the eye and the floor) are skipped. Null when no spot qualifies.
 */
export function roomStop(room: RoomArea, probe: RoomProbe, fovDeg: number, aspect: number): ViewStopPose | null {
  return drainSteps(roomStopSteps(room, probe, fovDeg, aspect));
}

/** {@link roomStop} in steps (it yields after each spot; see `rankOpeningViewsSteps`). */
export function* roomStopSteps(room: RoomArea, probe: RoomProbe, fovDeg: number, aspect: number): Generator<void, ViewStopPose | null, void> {
  const w = room.max[0] - room.min[0];
  const d = room.max[2] - room.min[2];
  if (!(w > 0.8 && d > 0.8) || !Number.isFinite(room.floorY)) return null;
  const vHalf = (Math.max(10, Math.min(120, fovDeg || 60)) * deg) / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * (aspect > 0 ? aspect : 16 / 9));
  const cx = (room.min[0] + room.max[0]) / 2;
  const cz = (room.min[2] + room.max[2]) / 2;
  const inset = Math.min(0.8, w / 4, d / 4);
  const eyeY = room.floorY + ROOM_EYE;
  const len = Math.min(14, Math.hypot(w, d));
  const near = probe.near ?? probe.sight;
  const inRoom = probe.inRoom ?? ((r: RoomArea, x: number, z: number) => x >= r.min[0] && x <= r.max[0] && z >= r.min[2] && z <= r.max[2]);
  const spots: Array<{ x: number; z: number; yaws: number[] }> = [];
  spots.push({ x: cx, z: cz, yaws: Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4) });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const x = sx < 0 ? room.min[0] + inset : room.max[0] - inset;
    const z = sz < 0 ? room.min[2] + inset : room.max[2] - inset;
    const across = Math.atan2(cx - x, cz - z);
    spots.push({ x, z, yaws: [across, across - 20 * deg, across + 20 * deg] });
  }
  let best: { pose: ViewStopPose; score: number } | null = null;
  for (const s of spots) {
    if (!inRoom(room, s.x, s.z)) continue;
    const eye: Vec3 = [s.x, eyeY, s.z];
    // Standing in furniture: something between the eye and the floor below it.
    if (near(eye, [s.x, room.floorY + 0.12, s.z]) < ROOM_EYE - 0.15) continue;
    // In a wardrobe or a wall: blocked within half a metre on most sides.
    let boxed = 0;
    for (let i = 0; i < 4; i++) if (near(eye, [s.x + Math.sin((i * Math.PI) / 2) * 0.5, eyeY, s.z + Math.cos((i * Math.PI) / 2) * 0.5]) < 0.45) boxed++;
    if (boxed >= 3) continue;
    for (const yaw of s.yaws) {
      const target = aim(eye, yaw, ROOM_PITCH);
      // The frame's near zone (`nearZone` would take a room's walls round the eye for being inside something).
      const nz = nearestInView(probe.sight, eye, target, fovDeg, aspect);
      if (nz < ROOM_NEAR_MIN) continue;
      const open = openShare(probe.sight, eye, yaw, hHalf, len);
      const score = open * 3 + (Math.min(nz, NEAR_ZONE) / NEAR_ZONE) * 2 + (nz >= NEAR_ZONE ? 1 : 0);
      if (!best || score > best.score + 1e-9) best = { pose: { position: eye, target, name: room.name, room: room.id }, score };
    }
    yield;
  }
  return best ? best.pose : null;
}

/** Order `stops` as a walk from the first: each next one is the nearest not yet visited. */
export function orderStops<T extends { position: Vec3 }>(stops: readonly T[]): T[] {
  if (stops.length <= 2) return [...stops];
  const left = stops.slice(1);
  const out: T[] = [stops[0] as T];
  while (left.length > 0) {
    const at = (out[out.length - 1] as T).position;
    let bi = 0;
    let bd = Number.POSITIVE_INFINITY;
    for (let i = 0; i < left.length; i++) {
      const p = (left[i] as T).position;
      const dd = Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]);
      if (dd < bd) {
        bd = dd;
        bi = i;
      }
    }
    out.push(left.splice(bi, 1)[0] as T);
  }
  return out;
}

/** Add `pose` unless a stop within `spacing` m is already there; returns whether it was added. */
function addSpaced(out: ViewStopPose[], pose: ViewStopPose, spacing: number): boolean {
  if (out.some((q) => Math.hypot(q.position[0] - pose.position[0], q.position[1] - pose.position[1], q.position[2] - pose.position[2]) < spacing)) return false;
  out.push(pose);
  return true;
}

/** Options of {@link sceneStops}. */
export interface SceneStopOptions {
  /** The hero view: the first stop. */
  first?: ViewStopPose | null;
  /** Most stops (default {@link MAX_STOPS}). */
  limit?: number;
  /** Label of a stop (a landmark's name), or null. */
  name?: (pose: { position: Vec3; target: Vec3; landmark: Vec3 }) => string | null;
}

/**
 * Viewpoints of a scene or a city: the hero view first, then the best opening view of each section of the scene
 * (largest first), then the next best views of the whole scene, at least {@link MIN_STOP_SPACING} m apart, ordered as a walk.
 */
export function sceneStops(input: OpeningInput, probe: OpeningProbe, opts: SceneStopOptions = {}): ViewStopPose[] {
  return drainSteps(sceneStopsSteps(input, probe, opts));
}

/** Content radius (m) from which a scene's sections get a viewpoint each (a city, a large landscape). */
export const SECTION_STOPS_RADIUS = 45;
/** Most sections searched one by one (each is an opening-view search of its own). */
const MAX_SECTION_STOPS = 4;

/** {@link sceneStops} in steps (see `rankOpeningViewsSteps`). */
export function* sceneStopsSteps(input: OpeningInput, probe: OpeningProbe, opts: SceneStopOptions = {}): Generator<void, ViewStopPose[], void> {
  const limit = Math.max(1, Math.min(MAX_STOPS, opts.limit ?? MAX_STOPS));
  const out: ViewStopPose[] = [];
  if (opts.first) out.push({ ...opts.first, position: [...opts.first.position], target: [...opts.first.target] });
  const named = (p: { position: Vec3; target: Vec3; landmark: Vec3 }): ViewStopPose => {
    const name = opts.name?.(p) ?? null;
    return { position: p.position, target: p.target, ...(name ? { name } : {}) };
  };
  const { framing, items } = input;
  if (framing.radius >= SECTION_STOPS_RADIUS) {
    for (const s of tourSections(items, framing.radius, MAX_SECTION_STOPS)) {
      if (out.length >= limit) break;
      const reach = s.size * 1.5;
      const sub = items.filter((it: FramingItem) => Math.hypot((it.min[0] + it.max[0]) / 2 - s.center[0], (it.min[2] + it.max[2]) / 2 - s.center[2]) <= reach + Math.max(it.max[0] - it.min[0], it.max[2] - it.min[2]) / 2);
      if (sub.length === 0) continue;
      const [v] = yield* rankOpeningViewsSteps({ ...input, framing: { center: s.center, radius: Math.max(10, s.size * 1.4) }, items: sub }, probe, 1);
      if (v) addSpaced(out, named(v), MIN_STOP_SPACING);
    }
  }
  if (out.length < limit) {
    for (const v of yield* rankOpeningViewsSteps(input, probe, limit + 4)) {
      if (out.length >= limit) break;
      addSpaced(out, named(v), MIN_STOP_SPACING);
    }
  }
  return orderStops(out.slice(0, limit));
}

/**
 * Stops of a building: the hero view (outside, from the garden) first, then one per room (largest rooms first when there are
 * more than fit), ordered as a walk; fewer than {@link MIN_STOPS} rooms are filled up with `extra` (views of the grounds).
 */
export function archStops(rooms: readonly RoomArea[], probe: RoomProbe, fovDeg: number, aspect: number, opts: { first?: ViewStopPose | null; extra?: readonly ViewStopPose[]; limit?: number } = {}): ViewStopPose[] {
  return drainSteps(archStopsSteps(rooms, probe, fovDeg, aspect, opts));
}

/** {@link archStops} in steps (see `rankOpeningViewsSteps`). */
export function* archStopsSteps(rooms: readonly RoomArea[], probe: RoomProbe, fovDeg: number, aspect: number, opts: { first?: ViewStopPose | null; extra?: readonly ViewStopPose[]; limit?: number } = {}): Generator<void, ViewStopPose[], void> {
  const limit = Math.max(1, Math.min(MAX_STOPS, opts.limit ?? MAX_STOPS));
  const out: ViewStopPose[] = [];
  if (opts.first) out.push({ ...opts.first, position: [...opts.first.position], target: [...opts.first.target] });
  const area = (r: RoomArea): number => (r.max[0] - r.min[0]) * (r.max[2] - r.min[2]);
  const byArea = [...rooms].sort((a, b) => area(b) - area(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const r of byArea) {
    if (out.length >= limit) break;
    const s = yield* roomStopSteps(r, probe, fovDeg, aspect);
    if (s) addSpaced(out, s, 1.5);
  }
  for (const e of opts.extra ?? []) {
    if (out.length >= Math.min(limit, MIN_STOPS)) break;
    addSpaced(out, e, MIN_STOP_SPACING);
  }
  return orderStops(out);
}

/** What the quick viewpoints ask of the scene: a few rays each, no opening-view search. */
export interface QuickStopProbe {
  /** Height of the topmost surface at (x, z) and whether it is water; null where there is nothing. */
  ground(x: number, z: number): { y: number; water: boolean } | null;
  /** `from` sees `to` (nothing solid in between). */
  clear(from: Vec3, to: Vec3): boolean;
  /** Nearest content in the frame of the view `eye` → `target` (m), for street-level spots; absent: not checked. */
  near?(eye: Vec3, target: Vec3): number;
}

/** One part of a scene a quick viewpoint looks at (as `tourSections`). */
export interface StopSection {
  center: Vec3;
  size: number;
}

/**
 * Viewpoints of a scene for a viewer that cannot afford the opening-view search on a large live world (the cook runs the
 * full {@link sceneStops} and stores its result): per section of the scene a camera that sees it, from outside it (away from
 * the scene's middle first) over dry ground. `street`: at eye height in the street (a city), with {@link NEAR_ZONE} clear
 * in the frame; otherwise raised over the section, a drone's viewpoint. Ordered as a walk from `first`.
 */
export function* quickSceneStopsSteps(sections: readonly StopSection[], center: Vec3, probe: QuickStopProbe, opts: { first?: ViewStopPose | null; street?: boolean; limit?: number; name?: (at: Vec3) => string | null } = {}): Generator<void, ViewStopPose[], void> {
  const limit = Math.max(1, Math.min(MAX_STOPS, opts.limit ?? MAX_STOPS));
  const out: ViewStopPose[] = [];
  if (opts.first) out.push({ ...opts.first, position: [...opts.first.position], target: [...opts.first.target] });
  for (const s of sections) {
    if (out.length >= limit) break;
    const away = Math.atan2(s.center[0] - center[0], s.center[2] - center[2]);
    const base = Number.isFinite(away) && Math.hypot(s.center[0] - center[0], s.center[2] - center[2]) > 1 ? away : 0.6;
    let found: ViewStopPose | null = null;
    for (let k = 0; k < 8 && !found; k++) {
      const a = base + Math.ceil(k / 2) * (k % 2 === 1 ? 1 : -1) * (Math.PI / 4);
      for (const street of opts.street ? [true, false] : [false]) {
        const d = street ? Math.max(10, s.size * 1.2) : Math.max(14, s.size * 1.8);
        const x = s.center[0] + Math.sin(a) * d;
        const z = s.center[2] + Math.cos(a) * d;
        const g = probe.ground(x, z);
        if (!g || g.water || !Number.isFinite(g.y)) continue;
        const eye: Vec3 = [x, street ? g.y + 1.7 : Math.max(g.y + 8, s.center[1] + s.size * 0.6), z];
        const target: Vec3 = [s.center[0], street ? Math.max(s.center[1], g.y + 1.2) : s.center[1], s.center[2]];
        if (!probe.clear(eye, target)) continue;
        if (street && probe.near && probe.near(eye, target) < NEAR_ZONE) continue;
        const name = opts.name?.(s.center) ?? null;
        found = { position: eye, target, ...(name ? { name } : {}) };
        break;
      }
      yield;
    }
    if (found) addSpaced(out, found, MIN_STOP_SPACING);
  }
  return orderStops(out);
}

/** {@link quickSceneStopsSteps} at once. */
export function quickSceneStops(sections: readonly StopSection[], center: Vec3, probe: QuickStopProbe, opts: { first?: ViewStopPose | null; street?: boolean; limit?: number; name?: (at: Vec3) => string | null } = {}): ViewStopPose[] {
  return drainSteps(quickSceneStopsSteps(sections, center, probe, opts));
}
