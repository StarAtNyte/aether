/**
 * Advisory evidence about how a room can be lived in: where each door swings and the approach zone in front of it, whether people
 * can walk from the doors to the pieces, how crowded the floor is. It is drawn on the plan view and listed as text for the model
 * that reviews the room; the model decides what to move, remove or enlarge and renders again to check. Nothing here changes the
 * world or gates a round.
 */
import { pointInPolygon, pointSegmentDistance, type P2 } from '../math2';
import { DOOR_APPROACH } from './checks';
import type { Scene, SceneItem, SceneRoom } from './types';

/** A shape to draw over the plan view (plan metres, level frame). */
export interface PlanOverlay {
  kind: 'swing' | 'approach' | 'path' | 'blocked';
  pts: P2[];
  closed: boolean;
  label: string;
}

/** The advice for one room: shapes to draw and lines to read. */
export interface RoomAdvice {
  overlays: PlanOverlay[];
  lines: string[];
}

/** Half the width of a person (m): a path is only walkable where a body of this radius fits. */
const BODY = 0.3;
const CELL = 0.1;
const GOES_ON_FLOOR = (i: SceneItem): boolean => i.mount === 'floor' && i.kind !== 'rug' && i.y1 > 0.3 && i.y0 < 2.0;
/** Pieces a person walks up to (to sit, sleep, work, open). */
const VISITED = new Set(['bed', 'sofa', 'armchair', 'chair', 'desk', 'table', 'wardrobe', 'dresser', 'nightstand', 'bookshelf', 'tv_unit', 'sideboard', 'cabinet']);

const inwards = (w: SceneRoom['walls'][number]): P2 => [-w.out[0], -w.out[1]];

/** Door arcs, approach zones, walking paths from the doors to the pieces, and the numbers (sizes, clutter) behind them. */
export function roomAdvice(scene: Scene, room: SceneRoom): RoomAdvice {
  const overlays: PlanOverlay[] = [];
  const lines: string[] = [];
  const items = scene.items.filter((i) => i.room === room.id && GOES_ON_FLOOR(i));
  const doors: Array<{ id: string; at: P2; into: P2 }> = [];
  for (const wall of room.walls) {
    for (const o of wall.openings) {
      if (o.kind === 'window') continue;
      const c: P2 = [wall.a[0] + wall.dir[0] * o.centre - wall.out[0] * wall.inset, wall.a[1] + wall.dir[1] * o.centre - wall.out[1] * wall.inset];
      const n = inwards(wall);
      const half = o.width / 2;
      overlays.push({
        kind: 'approach',
        closed: true,
        label: `${o.id} approach`,
        pts: [
          [c[0] - wall.dir[0] * half, c[1] - wall.dir[1] * half],
          [c[0] + wall.dir[0] * half, c[1] + wall.dir[1] * half],
          [c[0] + wall.dir[0] * half + n[0] * DOOR_APPROACH, c[1] + wall.dir[1] * half + n[1] * DOOR_APPROACH],
          [c[0] - wall.dir[0] * half + n[0] * DOOR_APPROACH, c[1] - wall.dir[1] * half + n[1] * DOOR_APPROACH],
        ],
      });
      for (const poly of o.swing ?? []) overlays.push({ kind: 'swing', closed: true, label: `${o.id} swing`, pts: poly });
      doors.push({ id: o.id, at: c, into: n });
      const hit = items.filter((i) => [...(o.swing ?? []), overlays[overlays.length - 1 - (o.swing?.length ?? 0)]!.pts].some((z) => overlapsPoly(i.footprint, z)));
      if (hit.length > 0) lines.push(`${o.kind} ${o.id} (${o.width.toFixed(2)} m): ${hit.map((h) => h.id).join(', ')} stand${hit.length === 1 ? 's' : ''} in its swing or in the ${DOOR_APPROACH} m in front of it, so it cannot open fully.`);
    }
  }
  // Walkable floor on a grid: inside the room, a body's width from every wall and every floor piece.
  const [x0, z0, x1, z1] = room.bbox;
  const nx = Math.max(1, Math.ceil((x1 - x0) / CELL));
  const nz = Math.max(1, Math.ceil((z1 - z0) / CELL));
  const open = new Uint8Array(nx * nz);
  let openCount = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const p: P2 = [x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL];
      if (!pointInPolygon(p[0], p[1], room.polygon)) continue;
      if (nearEdge(room.polygon, p, BODY)) continue;
      if (items.some((it) => pointInPolygon(p[0], p[1], it.footprint) || nearEdge(it.footprint, p, BODY))) continue;
      open[j * nx + i] = 1;
      openCount++;
    }
  }
  const cell = (p: P2): number => Math.min(nz - 1, Math.max(0, Math.floor((p[1] - z0) / CELL))) * nx + Math.min(nx - 1, Math.max(0, Math.floor((p[0] - x0) / CELL)));
  const parent = new Int32Array(nx * nz).fill(-2);
  const queue: number[] = [];
  const doorCells: Array<{ id: string; c: number }> = [];
  for (const d of doors) {
    // The door's own cell can be inside the BODY margin of the wall: step in until a cell is open.
    for (let s = 0.2; s <= 1.4; s += 0.1) {
      const c = cell([d.at[0] + d.into[0] * s, d.at[1] + d.into[1] * s]);
      if (open[c]) {
        doorCells.push({ id: d.id, c });
        if (parent[c] === -2) {
          parent[c] = -1;
          queue.push(c);
        }
        break;
      }
    }
  }
  if (doors.length > 0 && doorCells.length === 0) lines.push(`No door of the room has a clear 0.6 m wide way in: furniture closes the way in from every door.`);
  for (let h = 0; h < queue.length; h++) {
    const c = queue[h] as number;
    const i = c % nx;
    const j = (c - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const k = b * nx + a;
      if (open[k] && parent[k] === -2) {
        parent[k] = c;
        queue.push(k);
      }
    }
  }
  const reached = queue.length;
  const pathTo = (c: number): P2[] => {
    const pts: P2[] = [];
    for (let k = c; k >= 0; k = parent[k] as number) pts.push([x0 + ((k % nx) + 0.5) * CELL, z0 + (Math.floor(k / nx) + 0.5) * CELL]);
    return pts.length > 24 ? pts.filter((_, i) => i % 4 === 0 || i === pts.length - 1) : pts;
  };
  const unreachable: string[] = [];
  let first = true;
  if (doorCells.length > 0) {
    for (const it of items.filter((i) => VISITED.has(i.kind))) {
      // The nearest reached cell within arm's length of the piece.
      let best = -1;
      let bd = 1e9;
      const cx = it.pos[0];
      const cz = it.pos[2];
      for (let k = 0; k < parent.length; k++) {
        if (parent[k] === -2) continue;
        const px = x0 + ((k % nx) + 0.5) * CELL;
        const pz = z0 + (Math.floor(k / nx) + 0.5) * CELL;
        const d = nearEdgeDist(it.footprint, [px, pz]);
        if (d < 0.9 && Math.hypot(px - cx, pz - cz) < bd) {
          bd = Math.hypot(px - cx, pz - cz);
          best = k;
        }
      }
      if (best < 0) {
        unreachable.push(it.id);
        overlays.push({ kind: 'blocked', closed: true, label: `${it.id} unreachable`, pts: it.footprint });
      } else if (first || it.kind === 'bed') {
        first = false;
        overlays.push({ kind: 'path', closed: false, label: `to ${it.id}`, pts: pathTo(best) });
      }
    }
  }
  const cover = items.reduce((s, i) => s + i.size[0] * i.size[2], 0);
  const w = Math.round((x1 - x0) * 100) / 100;
  const d = Math.round((z1 - z0) * 100) / 100;
  const free = openCount * CELL * CELL;
  lines.push(`Room ${w} x ${d} m (${room.area.toFixed(1)} m2), ${items.length} floor pieces cover ${cover.toFixed(1)} m2 (${Math.round((cover / Math.max(0.1, room.area)) * 100)}% of the floor); ${free.toFixed(1)} m2 of floor is walkable with a 0.6 m wide body (${Math.round((free / Math.max(0.1, room.area)) * 100)}%).`);
  if (doorCells.length > 0 && openCount > 0) lines.push(`Walking from the doors reaches ${Math.round((reached / openCount) * 100)}% of the walkable floor${reached < openCount * 0.9 ? ': some floor is cut off by furniture' : ''}.`);
  if (unreachable.length > 0) lines.push(`No 0.6 m wide path from a door to: ${unreachable.join(', ')}.`);
  return { overlays, lines };
}

function nearEdge(poly: readonly P2[], p: P2, r: number): boolean {
  return nearEdgeDist(poly, p) < r;
}

/** Distance from `p` to the outline of `poly`. */
function nearEdgeDist(poly: readonly P2[], p: P2): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as P2;
    const b = poly[(i + 1) % poly.length] as P2;
    best = Math.min(best, pointSegmentDistance(p[0], p[1], a[0], a[1], b[0], b[1]));
  }
  return best;
}

/** Whether a piece's footprint overlaps a zone by more than a few centimetres (any corner or centre of one inside the other). */
function overlapsPoly(a: readonly P2[], b: readonly P2[]): boolean {
  const inside = (p: P2, poly: readonly P2[]): boolean => pointInPolygon(p[0], p[1], poly) && nearEdgeDist(poly, p) > 0.03;
  const c = (poly: readonly P2[]): P2 => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  return a.some((p) => inside(p, b)) || b.some((p) => inside(p, a)) || inside(c(a), b) || inside(c(b), a);
}
