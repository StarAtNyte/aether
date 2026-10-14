/**
 * Physical usability checks of buildings in a World IR document, used by the
 * `navigable` verification test and by the agent's `verify_building` tool:
 *
 * - reachability: every room can be reached on foot from the entrance over a
 *   coarse navigation grid (10 cm cells) per level — walls block except at
 *   doorways, window holes stay blocked, floor furniture blocks; the grid is
 *   eroded by a body radius so gaps narrower than a person are closed.
 *   Stairs connect a level to the one above (the top of the flight seeds the
 *   upper level).
 * - door swing: each swinging leaf's swept area is free of furniture.
 * - furniture: floor pieces rest on the floor and do not overlap each other
 *   (chairs may tuck under tables, rugs are ignored).
 *
 * Works on entities only (their `arch` metadata, shapes and transforms), so
 * buildings edited by hand or by a model are checked as they are.
 */
import type { Entity, EntityId, Json, WorldDoc } from '@aether/core';
import { furnitureById, furnitureSize } from './furniture/index';
import { convexOverlap, obb, tucksUnder } from './layout';
import { interiorPoint, pointInPolygon, rotateYaw, type P2 } from './math2';
import { SlabParams, StairParams, WallParams } from './params';
import { stairFootprint, stairLayout } from './stair';

/** Navigation grid cell size (metres). */
export const NAV_CELL = 0.1;
/** Most cells one level grid may have (bounds memory / time on huge plans). */
export const MAX_NAV_CELLS = 600_000;
/** Most problems listed per check. */
const MAX_LISTED = 6;

/** Result of checking one building. */
export interface BuildingReport {
  building: EntityId;
  passed: boolean;
  rooms: number;
  reachable: number;
  /** Human-readable problems with a concrete fix hint each. */
  problems: string[];
}

interface Level {
  id: EntityId;
  index: number;
  children: Entity[];
}

function num(params: Record<string, Json>, key: string, fallback: number): number {
  const v = Object.hasOwn(params, key) ? params[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(params: Record<string, Json>, key: string, fallback: string): string {
  const v = Object.hasOwn(params, key) ? params[key] : undefined;
  return typeof v === 'string' ? v : fallback;
}

function generatorOf(e: Entity): string | null {
  return e.shape.kind === 'procedural' ? e.shape.generator : null;
}

function paramsOf(e: Entity): Record<string, Json> {
  return e.shape.kind === 'procedural' ? e.shape.params : {};
}

/** Plan position and yaw of an entity in its level frame. */
function pose(e: Entity): { x: number; y: number; z: number; yaw: number } {
  const p = e.transform.position;
  return { x: p[0], y: p[1], z: p[2], yaw: e.transform.rotation[1] };
}

/** World point of a local point (lx, lz) of an entity posed in the level frame. */
function toLevel(e: Entity, lx: number, lz: number): P2 {
  const { x, z, yaw } = pose(e);
  const r = rotateYaw(lx, lz, yaw);
  return [x + r[0], z + r[1]];
}

/** Floor footprint of a furniture entity (level frame), or null when not a floor piece. */
export function furnitureFootprint(e: Entity): { kind: string; fp: P2[]; y: number } | null {
  const gen = generatorOf(e);
  if (!gen) return null;
  const def = furnitureById(gen);
  if (!def || def.mount !== 'floor') return null;
  const [w, , d] = furnitureSize(def, paramsOf(e));
  const s = e.transform.scale;
  const { x, y, z, yaw } = pose(e);
  return { kind: def.kind, fp: obb(x, z, yaw, w * Math.abs(s[0]), d * Math.abs(s[2])), y };
}

/** Rasterises obstacles and walkable floor of one level. */
class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly walk: Uint8Array;
  readonly block: Uint8Array;

  constructor(readonly x0: number, readonly z0: number, x1: number, z1: number) {
    this.cols = Math.max(1, Math.ceil((x1 - x0) / NAV_CELL));
    this.rows = Math.max(1, Math.ceil((z1 - z0) / NAV_CELL));
    this.walk = new Uint8Array(this.cols * this.rows);
    this.block = new Uint8Array(this.cols * this.rows);
  }

  cell(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / NAV_CELL);
    const j = Math.floor((z - this.z0) / NAV_CELL);
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return -1;
    return j * this.cols + i;
  }

  centre(k: number): P2 {
    return [this.x0 + ((k % this.cols) + 0.5) * NAV_CELL, this.z0 + (Math.floor(k / this.cols) + 0.5) * NAV_CELL];
  }

  /** Set every cell whose centre lies in the polygon (even-odd test, so any simple polygon) to `value`. */
  fillConvex(poly: readonly P2[], arr: Uint8Array, value: number): void {
    let bx0 = Infinity;
    let bz0 = Infinity;
    let bx1 = -Infinity;
    let bz1 = -Infinity;
    for (const p of poly) {
      bx0 = Math.min(bx0, p[0]);
      bz0 = Math.min(bz0, p[1]);
      bx1 = Math.max(bx1, p[0]);
      bz1 = Math.max(bz1, p[1]);
    }
    const i0 = Math.max(0, Math.floor((bx0 - this.x0) / NAV_CELL));
    const i1 = Math.min(this.cols - 1, Math.floor((bx1 - this.x0) / NAV_CELL));
    const j0 = Math.max(0, Math.floor((bz0 - this.z0) / NAV_CELL));
    const j1 = Math.min(this.rows - 1, Math.floor((bz1 - this.z0) / NAV_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cx = this.x0 + (i + 0.5) * NAV_CELL;
        const cz = this.z0 + (j + 0.5) * NAV_CELL;
        if (pointInPolygon(cx, cz, poly)) arr[j * this.cols + i] = value;
      }
    }
  }

  /** Mark the polygon (any simple polygon) walkable. */
  fillConvexPolygon(poly: readonly P2[]): void {
    this.fillConvex(poly, this.walk, 1);
  }

  /** Walkable cells after eroding obstacles by `radius`. */
  eroded(radius: number): Uint8Array {
    const r = Math.max(0, Math.round(radius / NAV_CELL));
    const out = new Uint8Array(this.walk.length);
    // Distance-to-obstacle via two passes (chamfer, in cells) — linear time.
    const INF = 1 << 20;
    const d = new Int32Array(this.walk.length);
    for (let k = 0; k < d.length; k++) d[k] = this.walk[k] && !this.block[k] ? INF : 0;
    const C = this.cols;
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < C; i++) {
        const k = j * C + i;
        let v = d[k] as number;
        if (v === 0) continue;
        if (i > 0) v = Math.min(v, (d[k - 1] as number) + 2);
        if (j > 0) v = Math.min(v, (d[k - C] as number) + 2);
        if (i > 0 && j > 0) v = Math.min(v, (d[k - C - 1] as number) + 3);
        if (i + 1 < C && j > 0) v = Math.min(v, (d[k - C + 1] as number) + 3);
        d[k] = v;
      }
    }
    for (let j = this.rows - 1; j >= 0; j--) {
      for (let i = C - 1; i >= 0; i--) {
        const k = j * C + i;
        let v = d[k] as number;
        if (v === 0) continue;
        if (i + 1 < C) v = Math.min(v, (d[k + 1] as number) + 2);
        if (j + 1 < this.rows) v = Math.min(v, (d[k + C] as number) + 2);
        if (i + 1 < C && j + 1 < this.rows) v = Math.min(v, (d[k + C + 1] as number) + 3);
        if (i > 0 && j + 1 < this.rows) v = Math.min(v, (d[k + C - 1] as number) + 3);
        d[k] = v;
      }
    }
    // Chamfer 2-3 distance ≈ 2 per cell.
    for (let k = 0; k < out.length; k++) out[k] = (d[k] as number) > 2 * r ? 1 : 0;
    return out;
  }
}

/** Breadth-first flood fill from seeds over `open` cells (4-neighbour). */
function flood(grid: NavGrid, open: Uint8Array, seeds: readonly number[]): Uint8Array {
  const seen = new Uint8Array(open.length);
  const queue = new Int32Array(open.length);
  let head = 0;
  let tail = 0;
  for (const s of seeds) {
    if (s >= 0 && open[s] && !seen[s]) {
      seen[s] = 1;
      queue[tail++] = s;
    }
  }
  const C = grid.cols;
  while (head < tail) {
    const k = queue[head++] as number;
    const i = k % C;
    const nb = [i > 0 ? k - 1 : -1, i + 1 < C ? k + 1 : -1, k - C, k + C];
    for (const n of nb) {
      if (n < 0 || n >= open.length || seen[n] || !open[n]) continue;
      seen[n] = 1;
      queue[tail++] = n;
    }
  }
  return seen;
}

/** Nearest open cell to a point within `maxR` metres (or -1). */
function nearestOpen(grid: NavGrid, open: Uint8Array, p: P2, maxR = 1.2): number {
  const c = grid.cell(p[0], p[1]);
  if (c >= 0 && open[c]) return c;
  const steps = Math.ceil(maxR / NAV_CELL);
  for (let r = 1; r <= steps; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
        const k = grid.cell(p[0] + di * NAV_CELL, p[1] + dj * NAV_CELL);
        if (k >= 0 && open[k]) return k;
      }
    }
  }
  return -1;
}

/** Wall rectangle pieces (level frame) without doorways. */
function wallSolids(e: Entity): P2[][] {
  const parsed = WallParams.safeParse(paramsOf(e));
  if (!parsed.success) return [];
  const w = parsed.data;
  const t = w.thickness / 2;
  const doors = w.openings.filter((o) => o.kind !== 'window' && o.sill < 0.3).map((o) => [o.offset - o.width / 2, o.offset + o.width / 2] as [number, number]).sort((a, b) => a[0] - b[0]);
  const pieces: Array<[number, number]> = [];
  let x = -Math.max(0, Math.min(w.startA, w.startB));
  for (const [a, b] of doors) {
    if (a > x) pieces.push([x, a]);
    x = Math.max(x, b);
  }
  const end = w.length + Math.max(0, Math.min(w.endA, w.endB));
  if (end > x) pieces.push([x, end]);
  return pieces.map(([a, b]) => [toLevel(e, a, -t), toLevel(e, b, -t), toLevel(e, b, t), toLevel(e, a, t)]);
}

/** Top-of-stair seed point (in the upper level's frame, which shares the plan frame). */
function stairTop(e: Entity): P2 | null {
  const parsed = StairParams.safeParse(paramsOf(e));
  if (!parsed.success) return null;
  const { flights } = stairLayout(parsed.data);
  const f = flights[flights.length - 1];
  if (!f) return null;
  const run = f.treads * parsed.data.going + 0.45;
  return toLevel(e, f.x + f.dx * run, f.z + f.dz * run);
}

/** Bottom-of-stair point (level frame). */
function stairBottom(e: Entity): P2 {
  return toLevel(e, -0.4, 0);
}

function stairFoot(e: Entity): P2[] | null {
  const parsed = StairParams.safeParse(paramsOf(e));
  if (!parsed.success) return null;
  return stairFootprint(parsed.data).map((p) => toLevel(e, p[0], p[1]));
}

/** Swept points of a swinging door leaf (level frame), or null for non-swinging doors. */
function doorSweep(e: Entity): P2[] | null {
  const door = e.behaviors.find((b) => b.type === 'door' && b.enabled);
  if (!door || str(door.params, 'motion', 'slide') !== 'swing') return null;
  const p = paramsOf(e);
  const w = num(p, 'width', 0.9);
  const hingeSide = str(door.params, 'hinge', 'left');
  const angle = num(door.params, 'swingAngle', 90);
  const hx = hingeSide === 'right' ? w / 2 : hingeSide === 'center' ? 0 : -w / 2;
  const hinge = toLevel(e, hx, 0);
  const out: P2[] = [];
  const steps = 8;
  for (let k = 1; k <= steps; k++) {
    const theta = (angle * k) / steps;
    for (let s = 0.15; s <= 0.98; s += 0.2) {
      const local = toLevel(e, hx + (hx <= 0 ? 1 : -1) * w * s, 0);
      const v = rotateYaw(local[0] - hinge[0], local[1] - hinge[1], theta);
      out.push([hinge[0] + v[0], hinge[1] + v[1]]);
    }
  }
  return out;
}

/** Check every building selected by `target` ('*' = all). */
export function checkBuildings(world: WorldDoc, target = '*', clearance = 0.8): BuildingReport[] {
  const entities = world.entities;
  const buildings = Object.values(entities).filter((e) => e.arch?.role === 'building' && !e.template && (target === '*' || target === e.id || (target.startsWith('#') && e.tags.includes(target.slice(1)))));
  const byParent = new Map<EntityId, Entity[]>();
  for (const e of Object.values(entities)) {
    if (!e.parent || e.template) continue;
    const list = byParent.get(e.parent) ?? [];
    list.push(e);
    byParent.set(e.parent, list);
  }
  const radius = Math.min(0.3, Math.max(0.18, clearance * 0.32));
  const reports: BuildingReport[] = [];
  for (const b of buildings) {
    const problems: string[] = [];
    const levels: Level[] = (byParent.get(b.id) ?? [])
      .filter((e) => e.arch?.role === 'level')
      .map((e) => ({ id: e.id, index: e.arch?.level ?? 0, children: byParent.get(e.id) ?? [] }))
      .sort((p, q) => p.index - q.index);
    let rooms = 0;
    let reachable = 0;
    let seedsFromBelow: P2[] = [];
    let entrance: P2 | null = null;
    for (const level of levels) {
      const roomEnts = level.children.filter((e) => e.arch?.role === 'room');
      const polys: Array<{ e: Entity; poly: P2[] }> = [];
      for (const r of roomEnts) {
        const parsed = SlabParams.safeParse(paramsOf(r));
        if (!parsed.success) continue;
        polys.push({ e: r, poly: parsed.data.polygon.map((p) => toLevel(r, p[0], p[1])) });
      }
      if (polys.length === 0) continue;
      let x0 = Infinity;
      let z0 = Infinity;
      let x1 = -Infinity;
      let z1 = -Infinity;
      for (const { poly } of polys) {
        for (const p of poly) {
          x0 = Math.min(x0, p[0]);
          z0 = Math.min(z0, p[1]);
          x1 = Math.max(x1, p[0]);
          z1 = Math.max(z1, p[1]);
        }
      }
      // A margin outside the walls lets the entrance be reached from outdoors.
      x0 -= 1.5;
      z0 -= 1.5;
      x1 += 1.5;
      z1 += 1.5;
      if (((x1 - x0) / NAV_CELL) * ((z1 - z0) / NAV_CELL) > MAX_NAV_CELLS) {
        problems.push(`level ${level.id} is too large to check on foot (over ${MAX_NAV_CELLS} grid cells)`);
        continue;
      }
      const grid = new NavGrid(x0, z0, x1, z1);
      for (const { poly } of polys) grid.fillConvexPolygon(poly);
      const outdoor = level.index === 0;
      if (outdoor) {
        // Ground floor: the band around the building is walkable outdoors.
        for (let k = 0; k < grid.walk.length; k++) {
          const c = grid.centre(k);
          if (!polys.some(({ poly }) => pointInPolygon(c[0], c[1], poly))) grid.walk[k] = 1;
        }
      }
      const pieces: Array<{ e: Entity; kind: string; fp: P2[]; y: number }> = [];
      for (const e of level.children) {
        const role = e.arch?.role;
        if (role === 'wall') for (const piece of wallSolids(e)) grid.fillConvex(piece, grid.block, 1);
        else if (role === 'column') {
          const s = num(paramsOf(e), 'size', 0.3) / 2;
          grid.fillConvex(obb(e.transform.position[0], e.transform.position[2], 0, s * 2, s * 2), grid.block, 1);
        } else if (role === 'furniture' || role === 'fixture' || role === 'light') {
          const f = furnitureFootprint(e);
          if (!f) continue;
          pieces.push({ e, ...f });
          if (f.kind !== 'rug') grid.fillConvex(f.fp, grid.block, 1);
        } else if (role === 'pool') {
          const p = paramsOf(e);
          grid.fillConvex(obb(e.transform.position[0], e.transform.position[2], e.transform.rotation[1], num(p, 'width', 8), num(p, 'length', 4)), grid.block, 1);
        }
      }
      // Stairs: the flight itself is walkable on its level (people use it).
      const stairs = level.children.filter((e) => e.arch?.role === 'stair');
      for (const s of stairs) {
        const fp = stairFoot(s);
        if (fp) {
          grid.fillConvexPolygon(fp);
          grid.fillConvex(fp, grid.block, 0);
        }
      }
      const open = grid.eroded(radius);
      // Seeds: the main entrance (ground) or the tops of stairs from below.
      const seeds: number[] = [];
      if (outdoor) {
        const main = level.children.find((e) => e.arch?.role === 'door' && e.tags.includes('entrance'));
        if (main) {
          entrance = toLevel(main, 0, 1.2);
          const alt = toLevel(main, 0, -1.2);
          // Outdoors is whichever side is not inside a room.
          if (polys.some(({ poly }) => pointInPolygon(entrance![0], entrance![1], poly))) entrance = alt;
        } else {
          const first = polys[0] as { poly: P2[] };
          entrance = interiorPoint(first.poly);
        }
        seeds.push(nearestOpen(grid, open, entrance));
      } else {
        for (const p of seedsFromBelow) seeds.push(nearestOpen(grid, open, p));
        if (seeds.every((s) => s < 0)) problems.push(`level ${level.id}: no stair leads up to it (add a stair on the level below)`);
      }
      const reached = flood(grid, open, seeds.filter((s) => s >= 0));
      for (const { e, poly } of polys) {
        if (e.arch?.kind === 'terrace' && !outdoor) continue;
        rooms++;
        let ok = false;
        // Reached when any eroded cell of the room interior was reached.
        for (let k = 0; k < reached.length && !ok; k++) {
          if (!reached[k]) continue;
          const c = grid.centre(k);
          if (pointInPolygon(c[0], c[1], poly)) ok = true;
        }
        if (ok) reachable++;
        else problems.push(`room ${e.arch?.name ?? e.id} (${e.id}) cannot be reached on foot — add a door to a neighbouring room or move furniture blocking its doorway`);
      }
      // Stairs on this level seed the next level up, if their bottom is reachable.
      seedsFromBelow = [];
      for (const s of stairs) {
        const bottom = nearestOpen(grid, open, stairBottom(s), 0.8);
        const top = stairTop(s);
        if (!top) continue;
        if (bottom >= 0 && reached[bottom]) seedsFromBelow.push(top);
        else problems.push(`stair ${s.id}: its bottom step is not reachable — clear the space in front of it`);
      }
      // Door swings.
      for (const d of level.children) {
        if (d.arch?.role !== 'door') continue;
        const sweep = doorSweep(d);
        if (!sweep) continue;
        const hit = pieces.find((p) => p.kind !== 'rug' && sweep.some((q) => pointInPolygon(q[0], q[1], p.fp)));
        if (hit) problems.push(`door ${d.id} hits ${hit.e.id} when it opens — move ${hit.e.id} out of the door swing or make the door swing the other way`);
      }
      // Furniture rests on the floor and does not overlap.
      for (const p of pieces) if (Math.abs(p.y) > 0.03) problems.push(`${p.e.id} floats ${p.y.toFixed(2)} m above the floor — set its y to 0`);
      for (let i = 0; i < pieces.length; i++) {
        for (let j = i + 1; j < pieces.length; j++) {
          const a = pieces[i] as (typeof pieces)[number];
          const c = pieces[j] as (typeof pieces)[number];
          if (a.kind === 'rug' || c.kind === 'rug' || tucksUnder(a.kind, c.kind)) continue;
          if (convexOverlap(a.fp, c.fp, 0.02)) problems.push(`${a.e.id} overlaps ${c.e.id} — move one of them apart`);
        }
      }
    }
    if (levels.length === 0) problems.push(`building ${b.id} has no levels`);
    reports.push({ building: b.id, passed: problems.length === 0, rooms, reachable, problems: problems.slice(0, 40) });
  }
  return reports;
}

/** One-line verdict for a `navigable` test. */
export function navigableVerdict(world: WorldDoc, target: string, clearance: number): { passed: boolean; message: string } {
  const reports = checkBuildings(world, target, clearance);
  if (reports.length === 0) return { passed: false, message: `no building matches '${target}' (buildings carry arch.role "building")` };
  const failed = reports.filter((r) => !r.passed);
  if (failed.length === 0) {
    const rooms = reports.reduce((s, r) => s + r.rooms, 0);
    return { passed: true, message: `${reports.length} building(s): all ${rooms} rooms reachable on foot, doors open freely, furniture grounded without overlaps` };
  }
  const problems = failed.flatMap((r) => r.problems);
  const shown = problems.slice(0, MAX_LISTED).join('; ');
  return { passed: false, message: `${problems.length} problem(s): ${shown}${problems.length > MAX_LISTED ? ` (+${problems.length - MAX_LISTED} more)` : ''}` };
}
