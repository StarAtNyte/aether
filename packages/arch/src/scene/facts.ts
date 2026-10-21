/**
 * Measured facts about a scene: reference resolution (ids, room keys, walls,
 * openings), `query_wall`, `measure`, `list_entities`. Everything returns
 * plain numbers in metres plus a short text a model can read; a reference
 * that does not resolve returns an error that names what exists.
 */
import { hasOwn } from '@aether/core';
import { mountRule, freeWallSpans, type WallBlocker } from '../wall-space';
import type { Compass } from '../plan';
import { cmr, compassWord, describeOffset, meanPoint, polygonGap } from './geom';
import type { Scene, SceneItem, SceneOpening, SceneRoom, SceneWall } from './types';
import type { P2 } from '../math2';

/** Result of a failed lookup. */
export interface LookupError {
  error: string;
}

/** True for a {@link LookupError}. */
export function isLookupError(v: unknown): v is LookupError {
  return typeof v === 'object' && v !== null && hasOwn(v, 'error') && typeof (v as LookupError).error === 'string';
}

/** Room by entity id, plan id ("bedroom") or name (case-insensitive); `level` disambiguates a plan id used on several levels. */
export function findRoom(scene: Scene, ref: unknown, level?: number): SceneRoom | LookupError {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 80) return { error: `room must be a room id; rooms are: ${roomList(scene)}` };
  const q = ref.trim().toLowerCase();
  const hits = scene.rooms.filter((r) => r.id === q || r.key === q || r.name.toLowerCase() === q);
  const byLevel = level !== undefined ? hits.filter((r) => r.level === level) : hits;
  if (byLevel.length === 1) return byLevel[0] as SceneRoom;
  if (byLevel.length > 1) return { error: `"${ref}" is on several levels (${byLevel.map((r) => `level ${r.level}`).join(', ')}); pass the room entity id (${byLevel.map((r) => r.id).join(' or ')}) or a level` };
  return { error: `no room "${ref.slice(0, 40)}"; rooms are: ${roomList(scene)}` };
}

function roomList(scene: Scene): string {
  const l = scene.rooms.slice(0, 24).map((r) => `${r.key}${scene.levels.length > 1 ? ` (level ${r.level})` : ''}`);
  return l.length > 0 ? l.join(', ') : '(none: the building has no rooms)';
}

/** Item by entity id. */
export function findItem(scene: Scene, ref: unknown): SceneItem | LookupError {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 80) return { error: 'an item id is required' };
  const q = ref.trim();
  // The handle given at placement ("bed") names the piece as well as its entity id ("home-bed").
  const it = scene.items.find((i) => i.id === q) ?? scene.items.find((i) => i.id === `${scene.building}-${q}`);
  if (it) return it;
  const near = scene.items.filter((i) => i.id.includes(ref.trim()) || i.kind === ref.trim()).slice(0, 6).map((i) => i.id);
  return { error: `no item "${ref.slice(0, 60)}"${near.length > 0 ? `; did you mean ${near.join(', ')}?` : '; use list_entities to see ids'}` };
}

/** Wall of a room by compass side; with several edges on that side the longest one (or the one named by `edge`). */
export function findWall(room: SceneRoom, wall: unknown, edge?: number): SceneWall | LookupError {
  if (edge !== undefined) {
    const w = room.walls[edge];
    return w ?? { error: `${room.key} has no edge ${edge} (edges 0..${room.walls.length - 1})` };
  }
  const c = typeof wall === 'string' ? wall.trim().toLowerCase() : '';
  if (c !== 'north' && c !== 'south' && c !== 'east' && c !== 'west') return { error: `wall must be north, south, east or west; ${room.key} has ${wallList(room)}` };
  const same = room.walls.filter((w) => w.compass === c);
  if (same.length === 0) return { error: `${room.key} has no ${c} wall; it has ${wallList(room)}` };
  return same.slice().sort((a, b) => b.length - a.length)[0] as SceneWall;
}

function wallList(room: SceneRoom): string {
  return room.walls.map((w) => `${w.compass} ${cmr(w.length)} m`).join(', ');
}

/** Opening by entity id, searching every room. Returns the room face it is seen from first. */
export function findOpening(scene: Scene, ref: unknown, room?: SceneRoom): { opening: SceneOpening; wall: SceneWall; room: SceneRoom } | LookupError {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 80) return { error: 'an opening id is required (a door or window id from query_wall)' };
  const id = ref.trim();
  const rooms = room ? [room, ...scene.rooms.filter((r) => r !== room)] : scene.rooms;
  for (const r of rooms) for (const w of r.walls) for (const o of w.openings) if (o.id === id) return { opening: o, wall: w, room: r };
  const all = scene.rooms.flatMap((r) => r.walls.flatMap((w) => w.openings.map((o) => o.id)));
  return { error: `no opening "${id.slice(0, 60)}"; openings are: ${[...new Set(all)].slice(0, 20).join(', ') || '(none)'}` };
}

/** The wall blockers of one face (openings, corners, pieces on it, furniture standing against it) for wall-space rules. */
export function wallBlockers(scene: Scene, room: SceneRoom, wall: SceneWall, ignore: ReadonlySet<string> = new Set()): WallBlocker[] {
  const n = room.walls.length;
  const prev = room.walls[(wall.edge + n - 1) % n]?.inset ?? 0.06;
  const next = room.walls[(wall.edge + 1) % n]?.inset ?? 0.06;
  const out: WallBlocker[] = [
    { kind: 'corner', t0: -1, t1: prev + 0.04, y0: 0, y1: 99, ref: 'corner' },
    { kind: 'corner', t0: wall.length - next - 0.04, t1: wall.length + 1, y0: 0, y1: 99, ref: 'corner' },
  ];
  for (const o of wall.openings) out.push({ kind: o.kind === 'window' ? 'window' : 'door', t0: o.t0, t1: o.t1, y0: o.sill, y1: o.top, ref: o.id });
  for (const it of scene.items) {
    if (ignore.has(it.id) || it.room !== room.id || it.kind === 'cornice' || it.kind === 'pelmet') continue;
    if (it.mount === 'wall' && it.wall?.edge === wall.edge) {
      const reach = mountRule(it.kind).reach;
      out.push({ kind: 'item', t0: it.wall.t - it.wall.width / 2 - reach, t1: it.wall.t + it.wall.width / 2 + reach, y0: it.y0, y1: it.y1, ref: it.id });
    } else if (it.mount === 'floor' && it.kind !== 'rug') {
      const ag = it.against?.find((a) => a.edge === wall.edge);
      if (ag) out.push({ kind: 'furniture', t0: ag.t0, t1: ag.t1, y0: 0, y1: it.y1, ref: it.id });
    }
  }
  return out;
}

/** Result of {@link queryWall}. */
export interface WallQuery {
  room: SceneRoom;
  wall: SceneWall;
  /** Wall stretch usable by pieces (corners excluded). */
  usable: [number, number];
  openings: SceneOpening[];
  pieces: Array<{ id: string; kind: string; mount: 'wall' | 'floor'; t0: number; t1: number; y0: number; y1: number; gap?: number }>;
  /** Clear stretches (extents, rod / reach included) for a piece of `kind` spanning heights `y0..y1`. */
  free: Array<{ t0: number; t1: number; width: number }>;
  probe: { kind: string; y0: number; y1: number };
}

/** Everything about one wall face: openings, pieces, and the free stretches for a piece of the given kind and height range. */
export function queryWall(scene: Scene, room: SceneRoom, wall: SceneWall, probe?: { kind?: string; y0?: number; y1?: number }): WallQuery {
  const kind = probe?.kind ?? 'art';
  const y0 = probe?.y0 ?? 0.9;
  const y1 = probe?.y1 ?? Math.max(y0 + 0.1, 1.9);
  const pieces: WallQuery['pieces'] = [];
  for (const it of scene.items) {
    if (it.room !== room.id) continue;
    if (it.mount === 'wall' && it.wall?.edge === wall.edge) pieces.push({ id: it.id, kind: it.kind, mount: 'wall', t0: cmr(it.wall.t - it.wall.width / 2), t1: cmr(it.wall.t + it.wall.width / 2), y0: cmr(it.y0), y1: cmr(it.y1) });
    else if (it.mount === 'floor') {
      const ag = it.against?.find((a) => a.edge === wall.edge);
      if (ag) pieces.push({ id: it.id, kind: it.kind, mount: 'floor', t0: cmr(ag.t0), t1: cmr(ag.t1), y0: 0, y1: cmr(it.y1), gap: cmr(ag.gap) });
    }
  }
  pieces.sort((a, b) => a.t0 - b.t0);
  const free = freeWallSpans(wall.length, kind, y0, y1, wallBlockers(scene, room, wall))
    .filter(([s, u]) => u - s >= 0.1)
    .map(([s, u]) => ({ t0: cmr(s), t1: cmr(u), width: cmr(u - s) }));
  const n = room.walls.length;
  const prev = room.walls[(wall.edge + n - 1) % n]?.inset ?? 0.06;
  const next = room.walls[(wall.edge + 1) % n]?.inset ?? 0.06;
  return { room, wall, usable: [cmr(prev), cmr(wall.length - next)], openings: wall.openings, pieces, free, probe: { kind, y0, y1 } };
}

/** Text of a {@link WallQuery} for a model. */
export function wallQueryText(q: WallQuery): string {
  const w = q.wall;
  const lines = [
    `${q.room.key} ${w.compass} wall (edge ${w.edge}): length ${cmr(w.length)} m, usable t ${q.usable[0]}..${q.usable[1]}; t runs ${tDirection(w.compass)}; the wall face is ${cmr(w.inset)} m inside the centreline; starts at plan (${cmr(w.a[0])}, ${cmr(w.a[1])}) and ends at (${cmr(w.b[0])}, ${cmr(w.b[1])}); ${w.exterior ? 'exterior' : 'interior'}`,
  ];
  if (q.openings.length === 0) lines.push('openings: none');
  for (const o of q.openings) lines.push(`opening ${o.id}: ${o.kind} t ${o.t0}..${o.t1} (centre ${o.centre}, width ${o.width}), ${o.kind === 'window' ? `sill ${o.sill}, top ${o.top}` : `height ${o.top}`}${o.leadsTo ? `, leads to ${o.leadsTo.replace(`${q.room.levelId}-`, '')}` : ''}`);
  if (q.pieces.length === 0) lines.push('pieces: none');
  for (const p of q.pieces) lines.push(`${p.mount === 'wall' ? 'hung' : 'standing'} ${p.id}: ${p.kind} t ${p.t0}..${p.t1}, y ${p.y0}..${p.y1}${p.gap !== undefined ? `, ${p.gap} m from the face` : ''}`);
  lines.push(
    q.free.length === 0
      ? `free for a ${q.probe.kind} at y ${q.probe.y0}..${q.probe.y1}: none`
      : `free for a ${q.probe.kind} at y ${q.probe.y0}..${q.probe.y1}: ${q.free.map((f) => `t ${f.t0}..${f.t1} (${f.width} m)`).join('; ')}`,
  );
  return lines.join('\n');
}

/** How `t` runs along a wall, as seen from inside the room. */
export function tDirection(c: Compass): string {
  switch (c) {
    case 'north':
      return 'from the west end to the east end';
    case 'south':
      return 'from the east end to the west end';
    case 'east':
      return 'from the north end to the south end';
    case 'west':
      return 'from the south end to the north end';
  }
}

/** One thing that can be measured. */
export interface Measurable {
  label: string;
  kind: 'item' | 'opening' | 'wall' | 'room' | 'point';
  polygon: P2[];
  y0: number;
  y1: number;
  centre: [number, number, number];
  /** The wall face it is on or against. */
  onWall?: { room: string; edge: number; compass: Compass; t0: number; t1: number };
}

/** Resolve a measure reference: an item id, an opening id, "room/north" (a wall face), a room id or `{point}`. */
export function measurable(scene: Scene, ref: unknown): Measurable | LookupError {
  if (typeof ref === 'object' && ref !== null && !Array.isArray(ref) && hasOwn(ref, 'point')) {
    const p = (ref as { point: unknown }).point;
    if (!Array.isArray(p) || p.length < 2 || p.length > 3 || !p.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 5000)) return { error: 'point must be [x, z] or [x, y, z] in metres' };
    const [x, y, z] = p.length === 2 ? [p[0] as number, 0, p[1] as number] : [p[0] as number, p[1] as number, p[2] as number];
    return { label: `point (${cmr(x)}, ${cmr(y)}, ${cmr(z)})`, kind: 'point', polygon: [[x, z]], y0: y, y1: y, centre: [x, y, z] };
  }
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 100) return { error: 'a reference is an id string, "room/north" or {point:[x,z]}' };
  const it = scene.items.find((i) => i.id === ref) ?? scene.items.find((i) => i.id === `${scene.building}-${ref}`);
  if (it) {
    const ag = it.against?.slice().sort((a, b) => a.gap - b.gap)[0];
    return {
      label: `${it.kind} ${it.id}`,
      kind: 'item',
      polygon: it.footprint,
      y0: it.y0,
      y1: it.y1,
      centre: [it.pos[0], (it.y0 + it.y1) / 2, it.pos[2]],
      ...(it.wall ? { onWall: { room: it.wall.room, edge: it.wall.edge, compass: it.wall.compass, t0: it.wall.t - it.wall.width / 2, t1: it.wall.t + it.wall.width / 2 } } : ag ? { onWall: { room: ag.room, edge: ag.edge, compass: ag.compass, t0: ag.t0, t1: ag.t1 } } : {}),
    };
  }
  const op = findOpening(scene, ref);
  if (!isLookupError(op)) {
    const { opening, wall, room } = op;
    const pt = (t: number, off: number): P2 => [wall.a[0] + wall.dir[0] * t + wall.out[0] * off, wall.a[1] + wall.dir[1] * t + wall.out[1] * off];
    const a = pt(opening.t0, -wall.inset);
    const b = pt(opening.t1, -wall.inset);
    const c = pt(opening.centre, -wall.inset);
    return { label: `${opening.kind} ${opening.id}`, kind: 'opening', polygon: [a, b], y0: opening.sill, y1: opening.top, centre: [c[0], (opening.sill + opening.top) / 2, c[1]], onWall: { room: room.id, edge: wall.edge, compass: wall.compass, t0: opening.t0, t1: opening.t1 } };
  }
  const slash = ref.indexOf('/');
  if (slash > 0) {
    const r = findRoom(scene, ref.slice(0, slash));
    if (isLookupError(r)) return r;
    const w = findWall(r, ref.slice(slash + 1));
    if (isLookupError(w)) return w;
    const a: P2 = [w.a[0] - w.out[0] * w.inset, w.a[1] - w.out[1] * w.inset];
    const b: P2 = [w.b[0] - w.out[0] * w.inset, w.b[1] - w.out[1] * w.inset];
    return { label: `${r.key} ${w.compass} wall face`, kind: 'wall', polygon: [a, b], y0: 0, y1: r.ceiling, centre: [(a[0] + b[0]) / 2, r.ceiling / 2, (a[1] + b[1]) / 2], onWall: { room: r.id, edge: w.edge, compass: w.compass, t0: 0, t1: w.length } };
  }
  const room = findRoom(scene, ref);
  if (!isLookupError(room)) {
    const c = meanPoint(room.polygon);
    return { label: `room ${room.key}`, kind: 'room', polygon: room.polygon, y0: 0, y1: room.ceiling, centre: [c[0], room.ceiling / 2, c[1]] };
  }
  return { error: `cannot resolve "${ref.slice(0, 60)}": use an item id, an opening id, "room/north" for a wall face, a room id or {point:[x,z]}` };
}

/** Result of {@link measure}. */
export interface Measurement {
  a: string;
  b: string;
  /** Distance between the centres in the floor plan. */
  centreDistance: number;
  /** Smallest distance between the footprints in the floor plan (0 when they overlap). */
  gap: number;
  /** Vertical gap between the two height ranges (negative: they overlap by that much in height). */
  gapY: number;
  /** b's centre relative to a's, plan metres (east, south). */
  dx: number;
  dz: number;
  /** Both on the same wall face: offsets along it. */
  alongWall?: { wall: string; aCentre: number; bCentre: number; centreOffset: number; gap: number };
  text: string;
}

/** Distance facts between two references. */
export function measure(scene: Scene, aRef: unknown, bRef: unknown): Measurement | LookupError {
  const a = measurable(scene, aRef);
  if (isLookupError(a)) return a;
  const b = measurable(scene, bRef);
  if (isLookupError(b)) return b;
  const dx = b.centre[0] - a.centre[0];
  const dz = b.centre[2] - a.centre[2];
  const pa = a.polygon.length === 1 ? ([a.polygon[0], a.polygon[0]] as P2[]) : a.polygon;
  const pb = b.polygon.length === 1 ? ([b.polygon[0], b.polygon[0]] as P2[]) : b.polygon;
  const gap = segmentsOrPolygonGap(pa, pb);
  const gapY = Math.max(a.y0 - b.y1, b.y0 - a.y1);
  const out: Measurement = { a: a.label, b: b.label, centreDistance: cmr(Math.hypot(dx, dz)), gap: cmr(gap), gapY: cmr(gapY), dx: cmr(dx), dz: cmr(dz), text: '' };
  const lines = [`${a.label} → ${b.label}: centres ${cmr(Math.hypot(dx, dz)).toFixed(2)} m apart (b is ${describeOffset(dx, dz)} of a)`];
  lines.push(gap > 0.004 ? `floor-plan gap between them ${cmr(gap).toFixed(2)} m` : 'their floor-plan footprints overlap or touch');
  lines.push(gapY > 0.004 ? `vertical gap ${cmr(gapY).toFixed(2)} m (${gapY === a.y0 - b.y1 ? 'a is above b' : 'b is above a'})` : `their heights overlap by ${cmr(-gapY).toFixed(2)} m (a ${cmr(a.y0)}..${cmr(a.y1)}, b ${cmr(b.y0)}..${cmr(b.y1)})`);
  if (a.onWall && b.onWall && a.onWall.room === b.onWall.room && a.onWall.edge === b.onWall.edge) {
    const ac = (a.onWall.t0 + a.onWall.t1) / 2;
    const bc = (b.onWall.t0 + b.onWall.t1) / 2;
    const g = Math.max(a.onWall.t0 - b.onWall.t1, b.onWall.t0 - a.onWall.t1);
    out.alongWall = { wall: `${a.onWall.compass} wall`, aCentre: cmr(ac), bCentre: cmr(bc), centreOffset: cmr(bc - ac), gap: cmr(g) };
    lines.push(`both on the ${a.onWall.compass} wall: a spans t ${cmr(a.onWall.t0)}..${cmr(a.onWall.t1)} (centre ${cmr(ac)}), b spans t ${cmr(b.onWall.t0)}..${cmr(b.onWall.t1)} (centre ${cmr(bc)}); centres differ by ${cmr(Math.abs(bc - ac)).toFixed(2)} m, gap along the wall ${g > 0 ? `${cmr(g).toFixed(2)} m` : `none (they overlap by ${cmr(-g).toFixed(2)} m)`}`);
  } else if (a.kind === 'wall' && b.kind === 'item' && b.onWall) {
    lines.push(`${b.label} spans t ${cmr(b.onWall.t0)}..${cmr(b.onWall.t1)} on the ${b.onWall.compass} wall`);
  }
  out.text = lines.join('\n');
  return out;
}

function segmentsOrPolygonGap(a: readonly P2[], b: readonly P2[]): number {
  return polygonGap(a.length >= 3 ? a : thin(a), b.length >= 3 ? b : thin(b));
}

/** A degenerate polygon (a point or a segment) as a thin quad so polygon tests work. */
function thin(p: readonly P2[]): P2[] {
  const a = p[0] as P2;
  const b = (p[1] ?? a) as P2;
  const d: P2 = [b[0] - a[0], b[1] - a[1]];
  const l = Math.hypot(d[0], d[1]);
  const n: P2 = l < 1e-9 ? [1e-4, 0] : [(-d[1] / l) * 1e-4, (d[0] / l) * 1e-4];
  return [a, b, [b[0] + n[0], b[1] + n[1]], [a[0] + n[0], a[1] + n[1]]];
}

/** Filters of {@link listEntities}. */
export interface ListFilter {
  room?: string;
  wall?: string;
  kind?: string;
  level?: number;
}

/** Item / opening / room listing for the model (one line each, capped). */
export function listEntities(scene: Scene, filter: ListFilter = {}, limit = 120): { lines: string[]; total: number } {
  let room: SceneRoom | undefined;
  if (filter.room) {
    const r = findRoom(scene, filter.room, filter.level);
    if (isLookupError(r)) return { lines: [r.error], total: 0 };
    room = r;
  }
  const wallFilter = room && filter.wall ? findWall(room, filter.wall) : null;
  if (wallFilter && isLookupError(wallFilter)) return { lines: [wallFilter.error], total: 0 };
  const lines: string[] = [];
  const rooms = room ? [room] : scene.rooms.filter((r) => filter.level === undefined || r.level === filter.level);
  if (!filter.kind || filter.kind === 'room') {
    for (const r of rooms) if (!wallFilter) lines.push(`room ${r.id} (${r.key}, ${r.type}) level ${r.level}: ${cmr(r.bbox[2] - r.bbox[0])}×${cmr(r.bbox[3] - r.bbox[1])} m bbox, ${cmr(r.area)} m², ceiling ${cmr(r.ceiling)}; walls: ${r.walls.map((w) => `${w.compass} ${cmr(w.length)}`).join(', ')}`);
  }
  if (!filter.kind || filter.kind === 'opening' || filter.kind === 'door' || filter.kind === 'window') {
    for (const r of rooms) {
      for (const w of r.walls) {
        if (wallFilter && w !== wallFilter) continue;
        for (const o of w.openings) if (!filter.kind || filter.kind === 'opening' || filter.kind === o.kind) lines.push(`opening ${o.id}: ${o.kind} in ${r.key} ${w.compass} wall t ${o.t0}..${o.t1}, ${o.kind === 'window' ? `sill ${o.sill}, top ${o.top}` : `height ${o.top}`}`);
      }
    }
  }
  const roomIds = new Set(rooms.map((r) => r.id));
  const items = scene.items.filter((i) => (i.room === null ? !room : roomIds.has(i.room)) && (!filter.kind || filter.kind === i.kind || filter.kind === 'item') && (!wallFilter || (wallFilter && ((i.wall && i.wall.edge === wallFilter.edge && i.wall.room === wallFilter.room) || i.against?.some((a) => a.edge === wallFilter.edge && a.room === wallFilter.room)))));
  for (const i of items) lines.push(itemLine(i, scene));
  return { lines: lines.slice(0, limit).concat(lines.length > limit ? [`… ${lines.length - limit} more (narrow with room, wall or kind)`] : []), total: lines.length };
}

/** One-line description of an item. */
export function itemLine(i: SceneItem, scene?: Scene): string {
  const room = scene?.rooms.find((r) => r.id === i.room);
  const where = i.wall ? `on ${i.wall.compass} wall t ${cmr(i.wall.t - i.wall.width / 2)}..${cmr(i.wall.t + i.wall.width / 2)} y ${cmr(i.y0)}..${cmr(i.y1)}` : i.against && i.against.length > 0 ? `against ${i.against.map((a) => `${a.compass} wall t ${a.t0}..${a.t1}${a.gap > 0.005 ? ` (${a.gap} m off)` : ''}`).join(' + ')}` : i.mount === 'ceiling' ? `at the ceiling y ${cmr(i.y1)}` : `y ${cmr(i.y0)}..${cmr(i.y1)}`;
  return `${i.kind} ${i.id}${room ? ` in ${room.key}` : ''}: at (${cmr(i.pos[0])}, ${cmr(i.pos[2])}) yaw ${cmr(i.yaw)}, ${i.size.map(cmr).join('×')} m, ${where}${i.placed ? ', placed' : ''}`;
}

/** Facing direction of an item as a compass word (its front looks along local +Z). */
export function facingOf(i: SceneItem): 'north' | 'south' | 'east' | 'west' {
  const t = (i.yaw * Math.PI) / 180;
  return compassWord(Math.sin(t), Math.cos(t));
}
