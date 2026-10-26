/**
 * Physical and design checks of a building scene: overlaps, pieces poking
 * through walls, openings blocked by furniture, door and walking clearance,
 * reachability of every piece, implausible sizes and heights, empty or unlit
 * rooms. Every finding carries the entities, the measured numbers and a
 * concrete fix. The checks are the AI's measuring tools and the offline
 * planner's validators; they never decide a layout.
 */
import { resolveSelector, type EntityId, type WorldDoc } from '@aether/core';
import { tucksUnder, obb } from '../layout';
import { checkBuilding } from '../nav';
import { pointInPolygon, pointSegmentDistance, rotateYaw, type P2 } from '../math2';
import { partInfo, KIND_SIZE_LIMITS, wallBottomRange } from './parts';
import { cmr, compassWord, describeOffset, penetration, polygonGap } from './geom';
import { Grid, flood, nearestWalkable } from '../nav';
import type { Scene, SceneItem, SceneRoom, SceneWall } from './types';
import { readScene } from './read';

/** Severity of a finding: errors are physically wrong, warnings are likely mistakes, info is advice. */
export type FindingSeverity = 'error' | 'warning' | 'info';

/** One problem found by the checks. */
export interface Finding {
  code: string;
  severity: FindingSeverity;
  message: string;
  entities: EntityId[];
  /** Plan id of the room, when the problem belongs to one. */
  room?: string;
  /** What to do about it (a concrete move, a removal, a different size). */
  fix: string;
  /** A ready position for the first entity (plan x, z), when the fix is a move. */
  moveTo?: [number, number];
}

const LIGHT_KINDS: ReadonlySet<string> = new Set(['ceiling-light', 'pendant', 'floor-lamp', 'table-lamp', 'sconce']);
const ESSENTIALS: Readonly<Record<string, readonly string[]>> = {
  bedroom: ['bed'],
  kids: ['bed'],
  living: ['sofa'],
  kitchen: ['kitchen', 'island'],
  dining: ['dining-table'],
  bathroom: ['toilet'],
  office: ['desk'],
  'open-office': ['desk'],
  meeting: ['dining-table'],
  cafe: ['cafe-counter', 'dining-table'],
};
/** Floor pieces a lived-in room of each type usually holds (rug, lamps, plants and side pieces included). */
const DRESSED_DENSITY: Readonly<Record<string, number>> = { living: 7, bedroom: 5, kitchen: 4, dining: 4, office: 4, kids: 5, studio: 5 };
/** Rooms that need no light fitting of their own. */
const UNLIT_OK: ReadonlySet<string> = new Set(['terrace', 'garage', 'storage']);
/** Kinds that sit with a person in front and need free floor there. */
const NO_FRONT_CHECK: ReadonlySet<string> = new Set(['chair', 'office-chair', 'bar-stool', 'cane-chair', 'plant', 'floor-lamp', 'rug']);

const area = (i: SceneItem): number => i.size[0] * i.size[2];

function roomOf(scene: Scene, id: EntityId | null): SceneRoom | undefined {
  return id ? scene.rooms.find((r) => r.id === id) : undefined;
}

/** Inward unit normal of a wall face. */
function inward(w: SceneWall): P2 {
  return [-w.out[0], -w.out[1]];
}

/** Pieces that stand on the floor or hang from the ceiling (not on a wall). */
function solids(scene: Scene): SceneItem[] {
  return scene.items.filter((i) => i.mount !== 'wall' && i.kind !== 'rug');
}

/** Two pieces that overlap in the floor plan and in height. */
export function overlapFindings(scene: Scene): Finding[] {
  const out: Finding[] = [];
  const s = solids(scene);
  for (let a = 0; a < s.length; a++) {
    for (let b = a + 1; b < s.length; b++) {
      const i = s[a] as SceneItem;
      const j = s[b] as SceneItem;
      if (i.level !== j.level || tucksUnder(i.kind, j.kind)) continue;
      const vertical = Math.min(i.y1, j.y1) - Math.max(i.y0, j.y0);
      if (vertical <= 0.03) continue;
      const pen = penetration(i.footprint, j.footprint, 0.01);
      if (!pen) continue;
      // Move the smaller piece (the one more likely to be a small addition).
      const mover = area(i) <= area(j) ? i : j;
      const other = mover === i ? j : i;
      const axis: P2 = mover === i ? pen.axis : [-pen.axis[0], -pen.axis[1]];
      const dist = pen.depth + 0.02;
      const to: [number, number] = [Math.round((mover.pos[0] + axis[0] * dist) * 1000) / 1000, Math.round((mover.pos[2] + axis[1] * dist) * 1000) / 1000];
      const room = roomOf(scene, mover.room);
      out.push({
        code: 'item_overlap',
        severity: 'error',
        message: `${mover.kind} ${mover.id} overlaps ${other.kind} ${other.id} by ${cmr(pen.depth).toFixed(2)} m`,
        entities: [mover.id, other.id],
        ...(room ? { room: room.key } : {}),
        fix: `Move ${mover.id} ${cmr(dist).toFixed(2)} m ${compassWord(axis[0], axis[1])} (to ${to[0]}, ${to[1]}), or resize or remove one of them.`,
        moveTo: to,
      });
    }
  }
  return out;
}

/** Pieces poking through a wall, standing outside every room, on stairs, or above the ceiling. */
export function boundaryFindings(scene: Scene): Finding[] {
  const out: Finding[] = [];
  for (const it of scene.items) {
    const room = roomOf(scene, it.room);
    if (!room) {
      out.push({ code: 'item_outside', severity: 'error', message: `${it.kind} ${it.id} is not inside any room (at ${cmr(it.pos[0])}, ${cmr(it.pos[2])})`, entities: [it.id], fix: `Move ${it.id} into a room, or remove it.` });
      continue;
    }
    if (it.mount === 'wall') {
      if (!it.wall) out.push({ code: 'wall_item_floating', severity: 'error', message: `${it.kind} ${it.id} is not on any wall face of ${room.key}: it hangs in mid-air at (${cmr(it.pos[0])}, ${cmr(it.pos[2])})`, entities: [it.id], room: room.key, fix: `Use snap_to_wall to put ${it.id} on a wall of ${room.key}.` });
    } else {
      const poke = worstPoke(room, it.footprint);
      if (poke && poke.depth > 0.01) {
        const n = inward(poke.wall);
        const to: [number, number] = [Math.round((it.pos[0] + n[0] * (poke.depth + 0.02)) * 1000) / 1000, Math.round((it.pos[2] + n[1] * (poke.depth + 0.02)) * 1000) / 1000];
        out.push({ code: 'item_through_wall', severity: 'error', message: `${it.kind} ${it.id} pokes ${cmr(poke.depth).toFixed(2)} m through the ${poke.wall.compass} wall of ${room.key}`, entities: [it.id], room: room.key, fix: `Move ${it.id} ${cmr(poke.depth + 0.02).toFixed(2)} m ${poke.wall.compass === 'north' ? 'south' : poke.wall.compass === 'south' ? 'north' : poke.wall.compass === 'east' ? 'west' : 'east'} (to ${to[0]}, ${to[1]}), or snap_to_wall it.`, moveTo: to });
      }
    }
    if (it.y1 > room.ceiling + 0.02 && it.mount !== 'ceiling') out.push({ code: 'taller_than_room', severity: 'error', message: `${it.kind} ${it.id} reaches ${cmr(it.y1).toFixed(2)} m but the ceiling of ${room.key} is at ${cmr(room.ceiling).toFixed(2)} m`, entities: [it.id], room: room.key, fix: `Make ${it.id} shorter or lower it (height at most ${cmr(room.ceiling - it.y0).toFixed(2)} m).` });
    if (it.mount === 'floor') {
      for (const o of scene.obstacles) {
        if (o.level !== it.level) continue;
        const pen = penetration(it.footprint, o.polygon, 0.02);
        if (pen) out.push({ code: 'item_on_stairs', severity: 'error', message: `${it.kind} ${it.id} stands ${o.kind === 'stair' ? 'on the stair' : 'over the stairwell opening'} ${o.id} (${cmr(pen.depth).toFixed(2)} m)`, entities: [it.id], ...(room ? { room: room.key } : {}), fix: `Move ${it.id} away from the ${o.kind === 'stair' ? 'stair' : 'stairwell'}.` });
      }
    }
  }
  return out;
}

/** The wall the footprint sticks furthest through (null when inside). */
function worstPoke(room: SceneRoom, fp: readonly P2[]): { wall: SceneWall; depth: number } | null {
  let best: { wall: SceneWall; depth: number } | null = null;
  const consider = (wall: SceneWall, depth: number): void => {
    if (depth > 0 && (!best || depth > best.depth)) best = { wall, depth };
  };
  for (const q of fp) {
    const inside = pointInPolygon(q[0], q[1], room.polygon);
    for (const w of room.walls) {
      const along = (q[0] - w.a[0]) * w.dir[0] + (q[1] - w.a[1]) * w.dir[1];
      if (along < -0.01 || along > w.length + 0.01) continue;
      const d = -((q[0] - w.a[0]) * w.out[0] + (q[1] - w.a[1]) * w.out[1]);
      // d is the distance inward from the centreline; the face is `inset` inside it.
      if (inside) consider(w, w.inset - 0.004 - d);
      else consider(w, w.inset - d);
    }
    if (!inside) {
      // A corner beyond a convex end of every wall span: nearest edge.
      let near: SceneWall | null = null;
      let nd = Infinity;
      for (const w of room.walls) {
        const dd = pointSegmentDistance(q[0], q[1], w.a[0], w.a[1], w.b[0], w.b[1]);
        if (dd < nd) {
          nd = dd;
          near = w;
        }
      }
      if (near) consider(near, nd + near.inset);
    }
  }
  return best;
}

/** Floor furniture standing in front of a window (tall enough to hide it). */
export function windowFindings(scene: Scene): Finding[] {
  const out: Finding[] = [];
  for (const it of scene.items) {
    if (it.mount !== 'floor' || !it.against) continue;
    for (const ag of it.against) {
      const room = scene.rooms.find((r) => r.id === ag.room);
      const wall = room?.walls[ag.edge];
      if (!room || !wall) continue;
      for (const o of wall.openings) {
        if (o.kind !== 'window' || it.y1 <= o.sill + 0.05) continue;
        const overlap = Math.min(ag.t1, o.t1) - Math.max(ag.t0, o.t0);
        if (overlap > 0.25) out.push({ code: 'window_blocked', severity: 'warning', message: `${it.kind} ${it.id} (${cmr(it.y1).toFixed(2)} m high) stands in front of the window ${o.id} on the ${wall.compass} wall of ${room.key} and hides ${cmr(overlap).toFixed(2)} m of it (sill ${o.sill} m)`, entities: [it.id, o.id], room: room.key, fix: `Move ${it.id} off the window span (t ${o.t0}..${o.t1}) or choose a lower piece (under ${cmr(o.sill).toFixed(2)} m).` });
      }
    }
  }
  return out;
}

/** Metres of clear floor kept in front of every doorway (a person walking through, a leaf being pushed). */
export const DOOR_APPROACH = 0.9;

/**
 * Furniture in front of a doorway or in the sweep of its leaf. Hard rule for every door: the full arc a swinging leaf
 * sweeps into the room and a 0.9 m approach zone the width of the opening stay free of anything that stands on the floor
 * (head height and below), so the door opens fully without touching a collider and a person can step through.
 */
export function doorwayFindings(scene: Scene): Finding[] {
  const out: Finding[] = [];
  for (const room of scene.rooms) {
    for (const wall of room.walls) {
      for (const o of wall.openings) {
        if (o.kind === 'window') continue;
        const half = o.width / 2 + 0.05;
        const c: P2 = [wall.a[0] + wall.dir[0] * o.centre - wall.out[0] * wall.inset, wall.a[1] + wall.dir[1] * o.centre - wall.out[1] * wall.inset];
        const n = inward(wall);
        const zone: P2[] = [
          [c[0] - wall.dir[0] * half, c[1] - wall.dir[1] * half],
          [c[0] + wall.dir[0] * half, c[1] + wall.dir[1] * half],
          [c[0] + wall.dir[0] * half + n[0] * DOOR_APPROACH, c[1] + wall.dir[1] * half + n[1] * DOOR_APPROACH],
          [c[0] - wall.dir[0] * half + n[0] * DOOR_APPROACH, c[1] - wall.dir[1] * half + n[1] * DOOR_APPROACH],
        ];
        const zones: Array<{ poly: P2[]; what: string }> = [{ poly: zone, what: `the ${DOOR_APPROACH} m approach` }, ...(o.swing ?? []).map((poly) => ({ poly, what: 'the sweep of its leaf' }))];
        for (const it of scene.items) {
          if (it.room !== room.id || it.mount === 'wall' || it.mount === 'ceiling' || it.kind === 'rug' || it.y0 > 2.0) continue;
          if (it.y1 < 0.3) continue;
          let worst: { depth: number; what: string } | null = null;
          for (const z of zones) {
            const pen = penetration(it.footprint, z.poly, 0.02);
            if (pen && pen.depth > 0.03 && (!worst || pen.depth > worst.depth)) worst = { depth: pen.depth, what: z.what };
          }
          if (worst) out.push({ code: 'doorway_blocked', severity: 'error', message: `${it.kind} ${it.id} stands in ${worst.what} of the ${o.kind} ${o.id} on the ${wall.compass} wall of ${room.key} (${cmr(worst.depth).toFixed(2)} m in): the door would not open fully`, entities: [it.id, o.id], room: room.key, fix: `Move ${it.id} out of the door's sweep and the ${DOOR_APPROACH} m in front of it (along the wall, or to another wall), or put it somewhere else.` });
        }
      }
    }
  }
  return out;
}

/** Height (m) from which a hanging piece leaves the floor under it free to stand and walk on. */
const HEAD_ROOM = 2.0;

/** Free depth in front of a piece (up to `want`), measured against the room and the other pieces. */
export function freeFrontDepth(scene: Scene, it: SceneItem, want: number): number {
  const room = roomOf(scene, it.room);
  if (!room) return want;
  const f = rotateYaw(0, 1, it.yaw);
  // A ceiling light (anything above head height) takes no floor: only what stands in the way counts.
  const others = solids(scene).filter((o) => o !== it && o.room === it.room && !tucksUnder(it.kind, o.kind) && o.y1 > 0.15 && o.y0 < HEAD_ROOM);
  let free = 0;
  for (let s = 0.05; s <= want + 1e-9; s += 0.05) {
    const centre: P2 = [it.pos[0] + f[0] * (it.size[2] / 2 + s / 2), it.pos[2] + f[1] * (it.size[2] / 2 + s / 2)];
    const rect = obb(centre[0], centre[1], it.yaw, it.size[0] * 0.9, s);
    if (others.some((o) => penetration(rect, o.footprint, 0.01))) break;
    const poke = worstPoke(room, rect);
    if (poke && poke.depth > 0.01) break;
    free = s;
  }
  return Math.round(free * 100) / 100;
}

/** Pieces that need floor in front of them (to sit, open, walk) and do not have it. */
export function clearanceFindings(scene: Scene): Finding[] {
  const out: Finding[] = [];
  for (const it of scene.items) {
    if (it.mount !== 'floor' || NO_FRONT_CHECK.has(it.kind)) continue;
    const info = partInfo(it.kind);
    const want = info?.frontClearance ?? 0;
    if (want < 0.3) continue;
    const free = freeFrontDepth(scene, it, want);
    const room = roomOf(scene, it.room);
    if (free < want * 0.7 - 1e-6 && free < 0.6) {
      out.push({ code: 'no_front_clearance', severity: 'warning', message: `${it.kind} ${it.id}: only ${free.toFixed(2)} m of clear floor in front (wants ${want.toFixed(2)} m), facing ${compassWord(Math.sin((it.yaw * Math.PI) / 180), Math.cos((it.yaw * Math.PI) / 180))}`, entities: [it.id], ...(room ? { room: room.key } : {}), fix: `Move ${it.id} so ${want.toFixed(2)} m in front of it is free, or turn it.` });
    }
  }
  return out;
}

/** Results of {@link walkability}. */
export interface Walkability {
  /** Rooms in which two doors cannot be walked between (furniture blocks the way). */
  blockedRooms: Array<{ room: SceneRoom; blockers: SceneItem[] }>;
  /** Pieces whose front cannot be reached from a door of their room. */
  unreachable: Array<{ item: SceneItem; room: SceneRoom; blockers: SceneItem[] }>;
}

/** Walk each room on a 5 cm grid: can every door reach every other door and the front of every piece? */
export function walkability(scene: Scene, clearance = 0.7): Walkability {
  const blockedRooms: Walkability['blockedRooms'] = [];
  const unreachable: Walkability['unreachable'] = [];
  for (const room of scene.rooms) {
    const [bx0, bz0, bx1, bz1] = room.bbox;
    let cell = 0.05;
    while (((bx1 - bx0 + 1) / cell) * ((bz1 - bz0 + 1) / cell) > 160_000) cell *= 1.5;
    const grid = new Grid(bx0 - 0.5, bz0 - 0.5, bx1 + 0.5, bz1 + 0.5, cell);
    for (let idx = 0; idx < grid.blocked.length; idx++) {
      const c = grid.centre(idx);
      if (!pointInPolygon(c[0], c[1], room.polygon)) grid.blocked[idx] = 1;
    }
    const blockers = scene.items.filter((i) => i.room === room.id && (i.mount === 'floor' || i.mount === 'surface') && i.kind !== 'rug' && i.y1 > 0.15 && i.mount === 'floor');
    for (const b of blockers) grid.fill(b.footprint);
    for (const o of scene.obstacles) if (o.level === room.level) grid.fill(o.polygon);
    const walk = grid.walkable(Math.max(0.15, clearance / 2 - 0.04));
    const seeds: Array<{ idx: number; door: string }> = [];
    for (const w of room.walls) {
      for (const o of w.openings) {
        if (o.kind === 'window') continue;
        const n = inward(w);
        const p: P2 = [w.a[0] + w.dir[0] * o.centre - w.out[0] * w.inset + n[0] * 0.45, w.a[1] + w.dir[1] * o.centre - w.out[1] * w.inset + n[1] * 0.45];
        seeds.push({ idx: nearestWalkable(grid, walk, p, 0.6, room.polygon), door: o.id });
      }
    }
    if (seeds.length === 0) continue;
    const valid = seeds.filter((s) => s.idx >= 0);
    const reached = new Uint8Array(walk.length);
    // Flood from the first usable door; doors outside that region are cut off.
    if (valid.length > 0) flood(grid, walk, [(valid[0] as { idx: number }).idx], reached);
    const cutOff = seeds.filter((s) => s.idx < 0 || !reached[s.idx]);
    if (cutOff.length > 0 && seeds.length > 1) blockedRooms.push({ room, blockers: nearestBlockers(blockers, room, cutOff.length > 0 ? seeds[0]!.idx : -1, grid) });
    if (valid.length === 0) continue;
    for (const it of blockers) {
      if (it.mount !== 'floor' || NO_FRONT_CHECK.has(it.kind) || it.size[0] * it.size[2] < 0.12) continue;
      const f = rotateYaw(0, 1, it.yaw);
      const p: P2 = [it.pos[0] + f[0] * (it.size[2] / 2 + 0.3), it.pos[2] + f[1] * (it.size[2] / 2 + 0.3)];
      const idx = nearestWalkable(grid, walk, p, 0.35, room.polygon);
      if (idx < 0 || !reached[idx]) {
        unreachable.push({ item: it, room, blockers: blockers.filter((b) => b !== it && polygonGap(b.footprint, [p, p, p]) < 0.9) });
      }
    }
  }
  return { blockedRooms, unreachable };
}

function nearestBlockers(blockers: readonly SceneItem[], room: SceneRoom, idx: number, grid: Grid): SceneItem[] {
  void idx;
  void grid;
  void room;
  return blockers.filter((b) => b.size[0] * b.size[2] > 0.3).sort((a, b) => b.size[0] * b.size[2] - a.size[0] * a.size[2]).slice(0, 3);
}

/** Findings from {@link walkability}. */
export function reachabilityFindings(scene: Scene): Finding[] {
  const w = walkability(scene);
  const out: Finding[] = [];
  for (const b of w.blockedRooms) {
    out.push({ code: 'blocked_path', severity: 'error', message: `${b.room.key}: furniture blocks the way between its doors (no 0.7 m wide path)${b.blockers.length > 0 ? `; the largest pieces are ${b.blockers.map((x) => x.id).join(', ')}` : ''}`, entities: b.blockers.map((x) => x.id), room: b.room.key, fix: 'Move or remove a piece so a 0.7 m wide path joins the doors.' });
  }
  for (const u of w.unreachable) {
    out.push({ code: 'unreachable_item', severity: 'warning', message: `${u.item.kind} ${u.item.id} cannot be reached on foot in ${u.room.key}: its front is walled in${u.blockers.length > 0 ? ` by ${u.blockers.slice(0, 3).map((x) => x.id).join(', ')}` : ''}`, entities: [u.item.id, ...u.blockers.slice(0, 3).map((x) => x.id)], room: u.room.key, fix: `Move ${u.item.id} or a neighbour so a 0.6 m wide path reaches its front.` });
  }
  return out;
}

/** Sizes and heights that read as mistakes. */
export function sanityFindings(scene: Scene): Finding[] {
  const out: Finding[] = [];
  for (const it of scene.items) {
    const lim = KIND_SIZE_LIMITS[it.kind];
    const room = roomOf(scene, it.room);
    const rk = room ? { room: room.key } : {};
    if (lim) {
      const bad: string[] = [];
      if (lim.w && (it.size[0] < lim.w[0] - 0.01 || it.size[0] > lim.w[1] + 0.01)) bad.push(`width ${cmr(it.size[0])} m (usual ${lim.w[0]}–${lim.w[1]})`);
      if (lim.d && (it.size[2] < lim.d[0] - 0.01 || it.size[2] > lim.d[1] + 0.01)) bad.push(`depth ${cmr(it.size[2])} m (usual ${lim.d[0]}–${lim.d[1]})`);
      if (lim.h && (it.size[1] < lim.h[0] - 0.01 || it.size[1] > lim.h[1] + 0.01)) bad.push(`height ${cmr(it.size[1])} m (usual ${lim.h[0]}–${lim.h[1]})`);
      if (bad.length > 0) out.push({ code: 'implausible_size', severity: 'warning', message: `${it.kind} ${it.id}: ${bad.join(', ')}`, entities: [it.id], ...rk, fix: `Resize ${it.id} to a believable ${it.kind}.` });
    }
    if (it.mount === 'wall' && room) {
      const [lo, hi] = wallBottomRange(it.kind, it.size[1], room.ceiling);
      if (it.y0 < lo - 0.02 || it.y0 > hi + 0.02) out.push({ code: 'implausible_height', severity: 'warning', message: `${it.kind} ${it.id} hangs with its bottom at ${cmr(it.y0).toFixed(2)} m; usual ${cmr(lo).toFixed(2)}–${cmr(hi).toFixed(2)} m`, entities: [it.id], ...rk, fix: `Hang ${it.id} with its bottom between ${cmr(lo).toFixed(2)} and ${cmr(hi).toFixed(2)} m.` });
    }
    if (room && it.mount === 'floor' && it.kind !== 'rug' && area(it) > room.area * 0.55) out.push({ code: 'implausible_size', severity: 'warning', message: `${it.kind} ${it.id} covers ${cmr((area(it) / room.area) * 100)}% of ${room.key}`, entities: [it.id], ...rk, fix: 'Choose a smaller piece for this room.' });
    const sc = Math.max(...(Object.values(it.size) as number[]));
    if (!Number.isFinite(sc) || sc > 12) out.push({ code: 'implausible_size', severity: 'error', message: `${it.kind} ${it.id} has an absurd size ${it.size.map(cmr).join('×')} m`, entities: [it.id], ...rk, fix: `Remove or resize ${it.id}.` });
  }
  return out;
}

/** Empty rooms, missing essentials and unlit rooms (advice: the designer may have reasons). */
export function programmeFindings(scene: Scene): Finding[] {
  const out: Finding[] = [];
  for (const room of scene.rooms) {
    if (room.type === 'terrace') continue;
    const here = scene.items.filter((i) => i.room === room.id);
    const kinds = new Set(here.map((i) => i.kind));
    const need = ESSENTIALS[room.type];
    if (need && !need.some((k) => kinds.has(k))) out.push({ code: 'missing_essential', severity: 'warning', message: `${room.key} (${room.type}) has no ${need.join(' or ')}`, entities: [], room: room.key, fix: `Place a ${need[0]} in ${room.key}.` });
    const floor = here.filter((i) => i.mount === 'floor' && i.kind !== 'rug');
    if (room.area >= 7 && floor.length + (room.free?.pieces ?? 0) < 2 && !['hall', 'entry', 'lobby'].includes(String(room.type))) out.push({ code: 'room_empty', severity: 'warning', message: `${room.key} (${cmr(room.area).toFixed(1)} m²) looks empty: ${floor.length} piece${floor.length === 1 ? '' : 's'} of furniture`, entities: floor.map((i) => i.id), room: room.key, fix: `Furnish ${room.key} to suit a ${room.type}.` });
    // A furnished but bare room reads as a show flat: suggest the dressing pass (information only; never for a photo copy).
    const want = DRESSED_DENSITY[String(room.type)];
    if (want && room.area >= 8 && floor.length + (room.free?.pieces ?? 0) >= 2 && (room.free?.pieces ?? 0) < want && (floor.length < want || !here.some((i) => i.kind === 'rug' || i.kind === 'plant'))) out.push({ code: 'room_sparse', severity: 'info', message: `${room.key} (${room.type}, ${cmr(room.area).toFixed(1)} m²) holds ${floor.length} pieces${here.some((i) => i.kind === 'rug') ? '' : ', no rug'}${here.some((i) => i.kind === 'plant') ? '' : ', no plant'}: a lived-in ${room.type} this size holds about ${want}`, entities: [], room: room.key, fix: `build_architecture dress_room {building, room:"${room.key}"} adds a rug, lamps, plants, curtains and styling where they fit (not for a room copied from a photo).` });
    if (!UNLIT_OK.has(String(room.type)) && !here.some((i) => LIGHT_KINDS.has(i.kind)) && (room.free?.lights ?? 0) === 0) out.push({ code: 'no_light', severity: 'warning', message: `${room.key} has no light fitting`, entities: [], room: room.key, fix: `Place a ceiling-light or pendant in the middle of ${room.key} (and lamps where they help).` });
  }
  return out;
}

/** Options of {@link reviewScene}. */
export interface ReviewOptions {
  /** Skip the nav-grid checks (a large building on a slow device). */
  fast?: boolean;
}

/**
 * Every check on one building: the building checks (reachability of rooms,
 * door swing, support, wall pieces on openings) plus overlaps, boundary,
 * clearance, walkability, sanity and programme. Sorted: errors first.
 */
export function reviewScene(world: WorldDoc, buildingId: EntityId, opts: ReviewOptions = {}): Finding[] {
  const scene = readScene(world, buildingId);
  if (!scene) return [];
  const out: Finding[] = [];
  const base = checkBuilding(world, buildingId);
  for (const i of base.issues) {
    // Floor overlaps are reported with depth and a move by overlapFindings.
    if (i.code === 'furniture_overlap') continue;
    const sev: FindingSeverity = i.code === 'floating' || i.code === 'curtain_off_window' ? 'warning' : 'error';
    const room = i.entities.map((e) => scene.items.find((x) => x.id === e)).find((x) => x?.room)?.room;
    const rk = roomOf(scene, room ?? null);
    out.push({ code: i.code, severity: sev, message: i.message, entities: i.entities, ...(rk ? { room: rk.key } : {}), fix: i.hint });
  }
  out.push(...overlapFindings(scene), ...boundaryFindings(scene), ...windowFindings(scene), ...doorwayFindings(scene), ...clearanceFindings(scene), ...sanityFindings(scene), ...programmeFindings(scene));
  // A house on the flat default plane with no grounds of its own: suggest the garden and the land round it.
  const plan = world.entities[buildingId]?.arch?.plan as { site?: { garden?: unknown; surroundings?: unknown } } | undefined;
  if (world.environment.ground !== null && !plan?.site?.garden && !plan?.site?.surroundings && scene.rooms.some((r) => r.type === 'living' || r.type === 'bedroom')) {
    out.push({ code: 'no_grounds', severity: 'info', message: 'The house stands on the bare default plane: no garden, no land round it', entities: [buildingId], fix: 'build_architecture set_site {building, site:{garden:true, surroundings:"estate"}} adds a paved approach, hedges, planted beds and trees and rolling wooded land; then set environment ground null and a light fog (visibility 600 m).' });
  }
  if (!opts.fast) out.push(...reachabilityFindings(scene));
  const rank = { error: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.code.localeCompare(b.code));
}

/** Review every building matched by `target` ("*" all). */
export function reviewBuildings(world: WorldDoc, target = '*', opts: ReviewOptions = {}): Array<{ building: EntityId; findings: Finding[] }> {
  const ids = target === '*' ? Object.keys(world.entities) : resolveSelector(world, target);
  const out: Array<{ building: EntityId; findings: Finding[] }> = [];
  for (const id of ids) {
    if (world.entities[id]?.arch?.role !== 'building') continue;
    out.push({ building: id, findings: reviewScene(world, id, opts) });
    if (out.length >= 8) break;
  }
  return out;
}

/** Score 0..100 of a finding list (errors weigh most; saturates at 0). */
export function scoreFindings(findings: readonly Finding[]): number {
  let penalty = 0;
  for (const f of findings) penalty += f.severity === 'error' ? 9 : f.severity === 'warning' ? 3.5 : 1;
  return Math.max(0, Math.round(100 - penalty));
}

/** Stable identity of a finding (code + sorted entities), for stall detection. */
export function findingKey(f: Finding): string {
  return `${f.code}:${[...f.entities].sort().join(',')}:${f.room ?? ''}`;
}

/** Text of findings for a model: one numbered line each with the fix. */
export function findingsText(findings: readonly Finding[], limit = 40): string {
  if (findings.length === 0) return 'no problems found';
  const lines = findings.slice(0, limit).map((f, i) => `${i + 1}. [${f.severity}] ${f.code}: ${f.message}. Fix: ${f.fix}`);
  if (findings.length > limit) lines.push(`… ${findings.length - limit} more`);
  return lines.join('\n');
}

export { describeOffset };
