/**
 * Residents: believable people in a compiled building. A house with nobody in it reads as a model; this places a few
 * rigged, idle-animated people (the character cast, `entity.character` + `entity.npc`) where people actually stand:
 * in the living room near the sofa, at the kitchen counter, in the library, a visitor in the lobby. Placement is
 * measured, not guessed: every spot is clear of furniture, stairs, walls and door swings and out of the spawn's way,
 * so a resident never blocks a doorway or a walkway (the same clearances the navigation check uses). Pure and
 * deterministic: the same plan always gives the same people.
 */
import type { EntityInput, Json } from '@aether/core';
import { centroid, dist, pointInPolygon, rotateYaw, type P2 } from './math2';
import { offsetPolygon } from './rooms';
import type { RoomType } from './plan';

/** Most residents one building may get. */
export const MAX_RESIDENTS = 8;

/** A room as seen by the placement (plan frame, metres). */
export interface ResidentRoom {
  id: string;
  type: RoomType;
  name: string;
  polygon: P2[];
  /** Floor footprints that must stay clear (furniture, stairs, stairwell holes). */
  blockers: P2[][];
  /** Floor people keep out of beyond the blockers (the walkway round a stair and its stairwell): never stood on, but not solid. */
  avoid?: P2[][];
  /** Level index and the height of its floor above the ground (building frame). */
  level: number;
  elevation: number;
}

/** A spot that must stay open: a doorway, the spawn. */
export interface KeepOut {
  at: P2;
  r: number;
  level: number | 'all';
}

/** Where one resident stands. */
export interface ResidentSpot {
  room: string;
  roomName: string;
  type: RoomType;
  level: number;
  elevation: number;
  at: P2;
  /** Plan-frame direction (unit) the person faces. */
  facing: P2;
}

/** How likely people are to be found in a room of this type (0 = never). */
const WEIGHT: Readonly<Record<RoomType, number>> = {
  living: 3,
  kitchen: 2.4,
  dining: 2,
  bedroom: 0.5,
  bathroom: 0,
  office: 1.5,
  hall: 0.3,
  entry: 0.3,
  cafe: 3,
  meeting: 2,
  'open-office': 2.2,
  lobby: 2,
  storage: 0,
  laundry: 0,
  terrace: 0.4,
  garage: 0,
  studio: 1.6,
  kids: 0.8,
};

/** Clear radius around a resident (m): body, a step of wander and a margin. */
const BODY_CLEAR = 0.62;
/** Distance kept from a doorway centre (m): the leaf's swing and a person passing. */
const DOOR_CLEAR = 1.55;
/** Distance kept from the spawn (m). */
const SPAWN_CLEAR = 2.6;
/** Half width kept clear along the line between two doorways of a room (m). */
const LANE_CLEAR = 1.0;
/** Search grid step (m). */
const STEP = 0.25;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Distance from `p` to the boundary of a polygon. */
function edgeDistance(p: P2, poly: readonly P2[]): number {
  let best = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i] as P2;
    const b = poly[(i + 1) % n] as P2;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz)));
  }
  return best;
}

/** Distance from `p` to the segment a-b. */
function segmentDistance(p: P2, a: P2, b: P2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

interface Scored {
  at: P2;
  score: number;
}

/** Candidate spots of a room, best first. */
function candidates(room: ResidentRoom, keep: readonly KeepOut[], seed: number): Scored[] {
  const inner = offsetPolygon(room.polygon, -BODY_CLEAR);
  if (inner.length < 3) return [];
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of room.polygon) {
    x0 = Math.min(x0, p[0]);
    z0 = Math.min(z0, p[1]);
    x1 = Math.max(x1, p[0]);
    z1 = Math.max(z1, p[1]);
  }
  const c = centroid(room.polygon);
  const out: Scored[] = [];
  // Doorways of this room (a keep-out centre on its boundary) and the lanes people walk between them.
  const doors = keep.filter((k) => k.r >= DOOR_CLEAR - 1e-6 && (k.level === 'all' || k.level === room.level) && edgeDistance(k.at, room.polygon) < 0.3).map((k) => k.at);
  const lanes: Array<[P2, P2]> = [];
  for (let i = 0; i < doors.length; i++) for (let j = i + 1; j < doors.length; j++) lanes.push([doors[i] as P2, doors[j] as P2]);
  for (let x = x0 + STEP; x < x1; x += STEP) {
    for (let z = z0 + STEP; z < z1; z += STEP) {
      const p: P2 = [x, z];
      if (!pointInPolygon(x, z, inner)) continue;
      let blocked = false;
      let nearest = Infinity;
      for (const b of [...room.blockers, ...(room.avoid ?? [])]) {
        if (pointInPolygon(x, z, b)) {
          blocked = true;
          break;
        }
        nearest = Math.min(nearest, edgeDistance(p, b));
      }
      if (blocked || nearest < BODY_CLEAR) continue;
      let ok = true;
      for (const k of keep) {
        if ((k.level === 'all' || k.level === room.level) && dist(p, k.at) < k.r) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (lanes.some(([a, b]) => segmentDistance(p, a, b) < LANE_CLEAR)) continue;
      // People stand near things they use (a sofa, a counter), not in the middle of an empty floor, and a little off the walls.
      const social = nearest < 1.5 ? 1 : nearest < 2.2 ? 0.4 : 0;
      const wall = edgeDistance(p, room.polygon);
      const wallBias = wall > 0.9 ? 0.3 : 0;
      const centre = -dist(p, c) * 0.05;
      const jitter = ((hash(`${room.id}:${x.toFixed(2)}:${z.toFixed(2)}:${seed}`) % 1000) / 1000) * 0.35;
      out.push({ at: [Math.round(x * 100) / 100, Math.round(z * 100) / 100], score: social + wallBias + centre + jitter });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Choose where `count` people stand. Rooms are picked by how people use them (the living room and kitchen before the
 * hall), one person per room first, a second in a large room; a room with no clear spot is skipped.
 */
export function planResidents(rooms: readonly ResidentRoom[], keep: readonly KeepOut[], count: number, seed: number): ResidentSpot[] {
  const n = Math.max(0, Math.min(MAX_RESIDENTS, Math.floor(count)));
  if (n === 0) return [];
  const ranked = rooms
    .map((r) => ({ r, w: WEIGHT[r.type] * (0.85 + ((hash(`${r.id}:${seed}`) % 100) / 100) * 0.3) }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w);
  const picked: ResidentSpot[] = [];
  const taken: Array<{ at: P2; level: number }> = [];
  const pool = new Map<string, Scored[]>();
  for (const { r } of ranked) pool.set(r.id, candidates(r, keep, seed));
  const place = (room: ResidentRoom): boolean => {
    for (const cand of pool.get(room.id) ?? []) {
      if (taken.some((t) => t.level === room.level && dist(t.at, cand.at) < 2.2)) continue;
      // Face the middle of the room (toward the people or the furniture the person is standing at).
      const c = centroid(room.polygon);
      let fx = c[0] - cand.at[0];
      let fz = c[1] - cand.at[1];
      const len = Math.hypot(fx, fz);
      if (len < 0.4) {
        fx = 0;
        fz = 1;
      } else {
        fx /= len;
        fz /= len;
      }
      picked.push({ room: room.id, roomName: room.name, type: room.type, level: room.level, elevation: room.elevation, at: cand.at, facing: [fx, fz] });
      taken.push({ at: cand.at, level: room.level });
      return true;
    }
    return false;
  };
  for (const { r } of ranked) {
    if (picked.length >= n) break;
    place(r);
  }
  const large = ranked.filter(({ r }) => polygonArea(r.polygon) > 28);
  for (const { r } of large) {
    if (picked.length >= n) break;
    place(r);
  }
  return picked;
}

/** How much people go to a room of this type in the course of a day (0 = not a place to spend time). */
const ROUTINE_WEIGHT: Readonly<Record<RoomType, number>> = {
  living: 3,
  kitchen: 2.6,
  dining: 2,
  bedroom: 1.8,
  bathroom: 0,
  office: 1.6,
  hall: 0.2,
  entry: 0.1,
  cafe: 2.5,
  meeting: 1.8,
  'open-office': 2,
  lobby: 1.2,
  storage: 0,
  laundry: 0.3,
  terrace: 0.8,
  garage: 0,
  studio: 1.4,
  kids: 1.2,
};

/** One stop of a resident's day: a spot in a room and how long they stay (s). */
export interface RoutineStopPlan {
  room: string;
  level: number;
  elevation: number;
  at: P2;
  stay: number;
}

/**
 * A day for each resident: where they stand, then another room — upstairs or downstairs first when the building has
 * more than one floor (a bedroom, a study, the kitchen) — and a third room on their own floor, each a measured clear
 * spot like the first. Deterministic for a plan and seed; residents never share a spot.
 */
export function planRoutines(rooms: readonly ResidentRoom[], keep: readonly KeepOut[], spots: readonly ResidentSpot[], seed: number): RoutineStopPlan[][] {
  const pool = new Map<string, Scored[]>();
  const used: Array<{ at: P2; level: number }> = spots.map((sp) => ({ at: sp.at, level: sp.level }));
  const levels = new Set(rooms.map((r) => r.level));
  const spotIn = (room: ResidentRoom): P2 | null => {
    let list = pool.get(room.id);
    if (!list) {
      list = candidates(room, keep, seed + 7);
      pool.set(room.id, list);
    }
    for (const c of list) if (!used.some((u) => u.level === room.level && dist(u.at, c.at) < 1.6)) return c.at;
    return null;
  };
  return spots.map((sp, k) => {
    const stops: RoutineStopPlan[] = [{ room: sp.room, level: sp.level, elevation: sp.elevation, at: sp.at, stay: 40 }];
    const ranked = rooms
      .filter((r) => ROUTINE_WEIGHT[r.type] > 0 && r.id !== sp.room)
      .map((r) => ({ r, w: ROUTINE_WEIGHT[r.type] * (0.8 + ((hash(`${r.id}:${k}:${seed}`) % 100) / 100) * 0.4) }))
      .sort((a, b) => b.w - a.w);
    // Another floor first (people go up to the bedroom, down to the kitchen), then the best room on their own.
    const order = levels.size > 1 ? [...ranked.filter((x) => x.r.level !== sp.level), ...ranked.filter((x) => x.r.level === sp.level)] : ranked;
    for (const { r } of order) {
      if (stops.length >= 3) break;
      if (stops.some((s) => s.room === r.id)) continue;
      // The third stop stays on the resident's own floor (a day is not all stairs).
      if (stops.length === 2 && r.level !== sp.level && levels.size > 1) continue;
      const at = spotIn(r);
      if (!at) continue;
      used.push({ at, level: r.level });
      stops.push({ room: r.id, level: r.level, elevation: r.elevation, at, stay: 30 + (hash(`${r.id}:stay:${k}:${seed}`) % 20) });
    }
    return stops;
  });
}

function polygonArea(poly: readonly P2[]): number {
  let s = 0;
  for (let i = 0, k = poly.length; i < k; i++) {
    const a = poly[i] as P2;
    const b = poly[(i + 1) % k] as P2;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

const NAMES_F = ['Marta', 'Inês', 'Clara', 'Sofia', 'Helena', 'Rita'];
const NAMES_M = ['João', 'Tomás', 'Pedro', 'Rui', 'Miguel', 'André'];
const TOPS = ['#c9b99b', '#7a8f9c', '#a3534a', '#5f7a62', '#d6cdbf', '#3f4f6b', '#b88a4a', '#8c6f8f'];
const BOTTOMS = ['#3a3f4a', '#5a5046', '#2f3a3f', '#6b6458'];

interface Talk {
  hello: string;
  more: string;
}

/** A few words a person in this kind of room might say. */
function talkFor(type: RoomType, name: string): Talk {
  switch (type) {
    case 'kitchen':
      return { hello: `Coffee's just made. Help yourself, the mugs are on the counter.`, more: 'Everything in here opens: try the drawers and the cupboards.' };
    case 'living':
      return { hello: `Come in, make yourself at home. The light is best at this hour.`, more: `Have a look at the view, then try the lights: the switches are by the doors.` };
    case 'dining':
      return { hello: 'Dinner is at eight, if you are staying.', more: 'The windows open onto the garden when the evening cools.' };
    case 'office':
      return { hello: 'I was just reading in here. It is the quietest room in the house.', more: 'Take any book you like from the shelves.' };
    case 'cafe':
      return { hello: 'Welcome! Take any table you like.', more: 'The coffee is good today.' };
    case 'lobby':
      return { hello: 'Good afternoon. Let me know if you need anything.', more: 'The meeting rooms are down the hall.' };
    default:
      return { hello: `Hello. Welcome to the ${name.toLowerCase()}.`, more: 'Have a look around.' };
  }
}

/** The entity of one resident, in the world frame (`origin` and `rotation` are the building's). */
export function residentEntity(spot: ResidentSpot, index: number, buildingId: string, origin: P2, rotation: number, seed: number, routine: readonly RoutineStopPlan[] = []): EntityInput {
  const female = (index + (seed % 2)) % 2 === 0;
  const names = female ? NAMES_F : NAMES_M;
  const name = names[(hash(`${buildingId}:${index}:${seed}`) >>> 3) % names.length] as string;
  const w = rotateYaw(spot.at[0], spot.at[1], rotation);
  const x = Math.round((origin[0] + w[0]) * 100) / 100;
  const z = Math.round((origin[1] + w[1]) * 100) / 100;
  const face = rotateYaw(spot.facing[0], spot.facing[1], rotation);
  const yaw = Math.round(((Math.atan2(face[0], face[1]) * 180) / Math.PI) * 10) / 10;
  const talk = talkFor(spot.type, spot.roomName);
  const hold = spot.type === 'office' ? 'book' : spot.type === 'living' || spot.type === 'kitchen' || spot.type === 'dining' || spot.type === 'cafe' ? 'cup' : 'none';
  const top = TOPS[(hash(`${name}:top:${seed}`) >>> 2) % TOPS.length] as string;
  const bottom = BOTTOMS[(hash(`${name}:bot:${seed}`) >>> 2) % BOTTOMS.length] as string;
  const role = spot.type === 'lobby' || spot.type === 'meeting' || spot.type === 'open-office' ? 'visitor' : 'resident';
  // Their day, in world coordinates (`y` is the floor of the storey, which picks the level across the stairs).
  const stops = routine.length > 1
    ? routine.map((r) => {
        const q = rotateYaw(r.at[0], r.at[1], rotation);
        return { at: [Math.round((origin[0] + q[0]) * 100) / 100, Math.round(r.elevation * 100) / 100, Math.round((origin[1] + q[1]) * 100) / 100], stay: r.stay, wander: 0.5 };
      })
    : undefined;
  return {
    id: `${buildingId}-resident${index}`,
    name,
    shape: { kind: 'primitive', primitive: 'capsule', size: [0.56, 1.7, 0.56] },
    transform: { position: [x, Math.round((spot.elevation + 0.85 + 0.02) * 100) / 100, z], rotation: [0, yaw, 0] },
    physics: { body: 'kinematic' },
    character: { wardrobe: spot.type === 'office' || spot.type === 'lobby' || spot.type === 'meeting' ? 'formal' : 'casual', gender: female ? 'female' : 'male', age: index === 2 ? 'old' : 'adult', top, bottom, mood: 'calm', hold },
    npc: {
      role,
      archetype: 'villager',
      faction: 'household',
      speed: 0.9,
      radius: 0.3,
      wander: 0.35,
      ...(stops ? { routine: stops } : {}),
      talkRange: 2.8,
      perception: { sight: 8, fov: 120, hearing: 5, memory: 3, alert: 0 },
      dialogue: {
        start: 'start',
        nodes: {
          start: { text: talk.hello, choices: [{ text: 'Tell me more.', next: 'more' }, { text: 'Thanks.', next: null }] },
          more: { text: talk.more, next: null },
        },
      },
    } as unknown as Json as never,
    arch: { role: 'resident', room: spot.room, name: spot.roomName },
    tags: ['npc', 'resident', 'arch'],
  } as EntityInput;
}
