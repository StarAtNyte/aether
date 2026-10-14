/**
 * Plan editing helpers for interactive tools (the studio's floor-plan view):
 * snapping clicked points, turning a drawn outline into a room with doors to
 * its neighbours, and finding which wall a click on the plan means for a new
 * door or window. Everything works in the building's PLAN frame (x east,
 * z south) and returns ordinary `ArchOp`s, so a drawn room goes through the
 * same validation, compilation and usability checks as an agent's edit.
 * Pure and bounded.
 */
import type { BuildingPlan, PlanLevel, RoomType } from './plan';
import { PlanError } from './compile';
import { area, bounds, isAxisRectangle, isSimplePolygon, positive, simplifyPolygon, type P2 } from './math2';
import { edgePoint, exteriorSpans, overlapArea, roomEdges, roomPolygon, sharedSpans, type EdgeSpan } from './rooms';

/** Grid (metres) clicked points snap to when no room corner is near. */
export const PLAN_GRID = 0.1;
/** Distance (metres) within which a click snaps to an existing room corner or edge. */
export const SNAP_REACH = 0.3;
/** Smallest room a tool may draw (m²). */
export const MIN_DRAWN_ROOM_AREA = 1.5;
/** Most points of a drawn outline. */
export const MAX_DRAWN_POINTS = 32;
/** Distance (metres) from a wall centreline within which a click picks that wall. */
export const WALL_PICK_REACH = 0.45;
/** Shortest shared wall that gets an automatic door to a new room (metres). */
const AUTO_DOOR_MIN_SPAN = 1.1;

function roundGrid(n: number, grid: number): number {
  const r = Math.round(n / grid) * grid;
  return Math.round(r * 1000) / 1000 || 0;
}

/** Rooms of a level as plan polygons (positive winding). */
export function levelPolygons(level: PlanLevel): Array<{ id: string; type: RoomType; polygon: P2[] }> {
  return level.rooms.map((r) => ({ id: r.id, type: r.type, polygon: simplifyPolygon(roomPolygon(r)) }));
}

/**
 * Snap a clicked plan point: to the nearest room corner within
 * {@link SNAP_REACH}, else onto the nearest room edge within reach (then
 * along it to the grid), else to the {@link PLAN_GRID} grid.
 */
export function snapPlanPoint(p: P2, level: PlanLevel | null, grid = PLAN_GRID): P2 {
  const x = Number.isFinite(p[0]) ? p[0] : 0;
  const z = Number.isFinite(p[1]) ? p[1] : 0;
  if (level) {
    let best: P2 | null = null;
    let bestD = SNAP_REACH;
    for (const r of levelPolygons(level)) {
      for (const c of r.polygon) {
        const d = Math.hypot(c[0] - x, c[1] - z);
        if (d < bestD) {
          bestD = d;
          best = [c[0], c[1]];
        }
      }
    }
    if (best) return best;
    for (const r of levelPolygons(level)) {
      for (const e of roomEdges(r.polygon)) {
        const t = Math.max(0, Math.min(e.length, (x - e.a[0]) * e.dir[0] + (z - e.a[1]) * e.dir[1]));
        const q = edgePoint(e, t);
        const d = Math.hypot(q[0] - x, q[1] - z);
        if (d < bestD) {
          bestD = d;
          // Slide along the edge to the grid, keeping the point on the edge.
          const ts = Math.max(0, Math.min(e.length, roundGrid(t, grid)));
          best = edgePoint(e, ts);
        }
      }
    }
    if (best) return [Math.round(best[0] * 1000) / 1000, Math.round(best[1] * 1000) / 1000];
  }
  return [roundGrid(x, grid), roundGrid(z, grid)];
}

/** A short unique room id for a new room of `type` (e.g. "bedroom-2"). */
export function nextRoomId(plan: BuildingPlan, type: RoomType): string {
  const taken = new Set(plan.levels.flatMap((l) => l.rooms.map((r) => r.id)));
  const base = type.replace(/[^a-z0-9-]/g, '').slice(0, 16) || 'room';
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const id = `${base}-${i}`;
    if (!taken.has(id)) return id;
  }
  return `${base}-${taken.size + 1}`;
}

/** A drawn room: the outline as a `rect` when it is an axis-aligned rectangle, else a `polygon`. */
export function roomShape(points: readonly P2[]): { rect: [number, number, number, number] } | { polygon: P2[] } {
  const raw = points.slice(0, MAX_DRAWN_POINTS).map((p): P2 => [p[0], p[1]]);
  const poly = simplifyPolygon(positive(raw));
  if (poly.length < 3) throw new PlanError('bad_room', 'a room needs at least three distinct corners', 'Click three or more corners, then close the outline on the first one.');
  if (!isSimplePolygon(poly)) throw new PlanError('bad_room', 'the outline crosses itself', 'Draw the corners in order around the room.');
  if (area(poly) < MIN_DRAWN_ROOM_AREA) throw new PlanError('bad_room', `the room is smaller than ${MIN_DRAWN_ROOM_AREA} m²`, 'Draw a larger room.');
  if (poly.length === 4 && isAxisRectangle(poly)) {
    const [x0, z0, x1, z1] = bounds(poly);
    return { rect: [x0, z0, x1, z1] };
  }
  return { polygon: poly };
}

/**
 * `add_room` op for a room drawn on storey `levelIndex`: refuses outlines
 * that overlap existing rooms, and adds a door to the neighbour sharing the
 * longest wall (or, for a free-standing first room, an entrance).
 */
export function drawRoomOp(plan: BuildingPlan, levelIndex: number, points: readonly P2[], type: RoomType, name?: string): Record<string, unknown> {
  const level = plan.levels[levelIndex];
  if (!level) throw new PlanError('level_not_found', `building "${plan.id}" has no level ${levelIndex}`, 'Pick an existing storey.');
  const shape = roomShape(points);
  const poly = 'rect' in shape ? positive([[shape.rect[0], shape.rect[1]], [shape.rect[2], shape.rect[1]], [shape.rect[2], shape.rect[3]], [shape.rect[0], shape.rect[3]]]) : shape.polygon;
  const rooms = levelPolygons(level);
  for (const r of rooms) {
    if (overlapArea(poly, r.polygon) > 0.05) throw new PlanError('room_overlap', `the new room overlaps "${r.id}"`, 'Draw rooms side by side: neighbours share a wall edge but never overlap.');
  }
  const id = nextRoomId(plan, type);
  let bestRoom: string | null = null;
  let bestLen = 0;
  for (const r of rooms) {
    if (r.type === 'terrace') continue;
    const s = sharedSpans(poly, r.polygon)[0];
    const len = s ? s.t1 - s.t0 : 0;
    if (len > bestLen) {
      bestLen = len;
      bestRoom = r.id;
    }
  }
  const doors: Array<Record<string, unknown>> = [];
  if (bestRoom && bestLen >= AUTO_DOOR_MIN_SPAN) doors.push({ between: [bestRoom, id], width: type === 'bathroom' ? 0.8 : 0.9 });
  else if (!bestRoom) doors.push({ between: [id, 'outside'], width: 1 });
  return { op: 'add_room', building: plan.id, level: levelIndex, room: { id, type, ...(name ? { name: name.slice(0, 60) } : {}), ...shape }, doors };
}

/**
 * Alternative `add_room` ops for the same drawn outline, best first: the
 * door to the main neighbour at mid-wall, then near either end of the shared
 * wall, then to every other neighbour sharing ≥ 1.1 m, then an entrance from
 * outside. Tools try them in order and keep the first whose result passes
 * the usability checks (furniture in the neighbour may block a door).
 * Bounded (≤ 8 ops).
 */
export function drawRoomCandidates(plan: BuildingPlan, levelIndex: number, points: readonly P2[], type: RoomType, name?: string): Array<Record<string, unknown>> {
  const primary = drawRoomOp(plan, levelIndex, points, type, name);
  const level = plan.levels[levelIndex] as PlanLevel;
  const room = primary['room'] as { id: string; rect?: [number, number, number, number]; polygon?: P2[] };
  const poly = room.rect ? positive([[room.rect[0], room.rect[1]], [room.rect[2], room.rect[1]], [room.rect[2], room.rect[3]], [room.rect[0], room.rect[3]]]) : positive(room.polygon ?? []);
  const out: Array<Record<string, unknown>> = [primary];
  const doors = primary['doors'] as Array<Record<string, unknown>>;
  const main = doors[0];
  if (main) for (const at of [0.12, 0.88]) out.push({ ...primary, doors: [{ ...main, at }] });
  const mainNeighbour = main ? (main['between'] as [string, string])[0] : null;
  for (const r of levelPolygons(level)) {
    if (r.type === 'terrace' || r.id === mainNeighbour) continue;
    const s = sharedSpans(poly, r.polygon)[0];
    if (s && s.t1 - s.t0 >= AUTO_DOOR_MIN_SPAN) out.push({ ...primary, doors: [{ between: [r.id, room.id], width: type === 'bathroom' ? 0.8 : 0.9 }] });
  }
  out.push({ ...primary, doors: [{ between: [room.id, 'outside'], width: 1 }] });
  return out.slice(0, 8);
}

/** What a click on the plan means for an opening tool. */
export interface WallPick {
  /** Rooms on either side ("outside" for exterior walls). */
  between: [string, string];
  /** Exterior walls: compass side of the room's wall. */
  side?: 'north' | 'south' | 'east' | 'west';
  /** The span of the room edge the click lies on and the click's distance along it. */
  span: EdgeSpan;
  t: number;
}

/** The wall (shared or exterior) nearest to plan point `p` on a storey, or null when none is within reach. */
export function pickWall(level: PlanLevel, p: P2): WallPick | null {
  const rooms = levelPolygons(level).filter((r) => r.type !== 'terrace');
  let best: WallPick | null = null;
  let bestD = WALL_PICK_REACH;
  const consider = (between: [string, string], span: EdgeSpan, side?: WallPick['side']): void => {
    const e = span.edge;
    const t = (p[0] - e.a[0]) * e.dir[0] + (p[1] - e.a[1]) * e.dir[1];
    if (t < span.t0 - 0.05 || t > span.t1 + 0.05) return;
    const q = edgePoint(e, Math.max(span.t0, Math.min(span.t1, t)));
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bestD) {
      bestD = d;
      best = { between, span, t: Math.max(span.t0, Math.min(span.t1, t)), ...(side ? { side } : {}) };
    }
  };
  for (let i = 0; i < rooms.length; i++) {
    const a = rooms[i] as (typeof rooms)[number];
    for (let j = i + 1; j < rooms.length; j++) {
      const b = rooms[j] as (typeof rooms)[number];
      for (const s of sharedSpans(a.polygon, b.polygon)) consider([a.id, b.id], s);
    }
    const others = rooms.filter((r) => r !== a).map((r) => r.polygon);
    for (const s of exteriorSpans(a.polygon, others)) consider([a.id, 'outside'], s, s.edge.side);
  }
  return best;
}

/** Position (0–1) along a wall span for a door of `width` centred at `t` (inverse of the compiler's placement). */
export function doorAtFraction(span: EdgeSpan, t: number, width: number): number {
  const free = span.t1 - span.t0 - 0.3 - width;
  if (!(free > 1e-6)) return 0.5;
  return Math.max(0, Math.min(1, (t - span.t0 - 0.15 - width / 2) / free));
}

/** `add_door` op for a click on the plan (doors between rooms, or to the outside). */
export function doorAtOp(plan: BuildingPlan, levelIndex: number, p: P2, opts: { width?: number; kind?: 'swing' | 'sliding' | 'opening' } = {}): Record<string, unknown> {
  const level = plan.levels[levelIndex];
  if (!level) throw new PlanError('level_not_found', `building "${plan.id}" has no level ${levelIndex}`, 'Pick an existing storey.');
  const pick = pickWall(level, p);
  if (!pick) throw new PlanError('no_wall', 'no wall near that point', 'Click on a wall between two rooms, or on an outside wall.');
  const width = Math.max(0.6, Math.min(2.4, opts.width ?? 0.9));
  if (pick.span.t1 - pick.span.t0 < width + 0.3) throw new PlanError('wall_too_short', 'that wall is too short for a door', 'Pick a longer wall, or a narrower door.');
  const door: Record<string, unknown> = { between: pick.between, at: Math.round(doorAtFraction(pick.span, pick.t, width) * 1000) / 1000, width, kind: opts.kind ?? 'swing' };
  if (pick.side) door['side'] = pick.side;
  return { op: 'add_door', building: plan.id, level: levelIndex, door };
}

/** `add_window` op for a click on an exterior wall. */
export function windowAtOp(plan: BuildingPlan, levelIndex: number, p: P2, opts: { width?: number } = {}): Record<string, unknown> {
  const level = plan.levels[levelIndex];
  if (!level) throw new PlanError('level_not_found', `building "${plan.id}" has no level ${levelIndex}`, 'Pick an existing storey.');
  const pick = pickWall(level, p);
  if (!pick || !pick.side || pick.between[1] !== 'outside') throw new PlanError('no_exterior_wall', 'windows go on outside walls', 'Click on an outside wall of a room.');
  const width = Math.max(0.4, Math.min(4, opts.width ?? 1.2));
  return { op: 'add_window', building: plan.id, level: levelIndex, window: { room: pick.between[0], side: pick.side, count: 1, width } };
}
