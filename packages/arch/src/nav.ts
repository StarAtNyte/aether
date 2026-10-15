/**
 * Physical usability checks of buildings in a World IR document:
 *
 * - reachability: a navigation grid per level (5 cm cells) where walls
 *   (doorways open, window holes closed), door linings and floor furniture
 *   block, inflated by half the required walkway width; a flood fill from
 *   the main entrance (outside the building) crosses doorways and climbs
 *   stairs to the levels above. Every room must be reached.
 * - door clearance: the quarter disc each swing leaf sweeps must be free of
 *   furniture (sliding doors and open passages need nothing).
 * - furniture: floor pieces must not overlap (chairs may tuck under tables),
 *   must stand on the floor, surface pieces on another piece, wall pieces on
 *   a wall, ceiling fittings at the ceiling.
 *
 * Everything is computed from the document (no physics engine needed), so it
 * runs in the verification worker, in Node tests and in agent tools.
 */
import { resolveSelector, type Entity, type EntityId, type Json, type WorldDoc } from '@aether/core';
import { furnitureOfEntity } from './furniture/assets';
import { convexOverlap, obb, tucksUnder } from './layout';
import { pointInPolygon, rotateYaw, type P2 } from './math2';
import { DOOR_CLEARANCE, LINING } from './openings';
import { openingSpans } from './wall';
import { StairParams, WallParams } from './params';
import { stairFootprint, stairLayout } from './stair';

/** One problem found by the checks, with the entities involved and a concrete fix. */
export interface ArchIssue {
  code: 'unreachable_room' | 'door_blocked' | 'furniture_overlap' | 'floating' | 'no_entrance';
  message: string;
  entities: EntityId[];
  hint: string;
}

/** Result for one building. */
export interface BuildingReport {
  building: EntityId;
  passed: boolean;
  rooms: number;
  reachable: number;
  doors: number;
  doorsClear: number;
  issues: ArchIssue[];
  ms: number;
}

/** Navigation grid cell size (metres). */
export const NAV_CELL = 0.05;
/** Grid margin around a level's rooms (the outside approach). */
const MARGIN = 3;
/** Upper bound of cells per level grid (keeps hostile documents cheap). */
const MAX_CELLS = 600_000;

interface LevelData {
  entity: Entity;
  index: number;
  height: number;
  children: Entity[];
}

interface Footprint {
  id: EntityId;
  kind: string;
  poly: P2[];
  top: number;
}

/** Children by parent id (one pass). */
function childrenIndex(world: WorldDoc): Map<string, Entity[]> {
  const out = new Map<string, Entity[]>();
  for (const e of Object.values(world.entities)) {
    if (!e.parent) continue;
    const list = out.get(e.parent) ?? [];
    list.push(e);
    out.set(e.parent, list);
  }
  return out;
}

function params(e: Entity): Record<string, Json> {
  return e.shape.kind === 'procedural' ? e.shape.params : {};
}

function generatorOf(e: Entity): string | null {
  return e.shape.kind === 'procedural' ? e.shape.generator : null;
}

/** Plan polygon of a slab-like entity (polygon param + transform), in its parent's frame. */
/** World-space outline of a room or slab entity (`polygon` param), or null. */
export function placedPolygon(e: Entity, key = 'polygon'): P2[] | null {
  const raw = params(e)[key];
  if (!Array.isArray(raw)) return null;
  const pos = e.transform.position;
  const yaw = e.transform.rotation[1];
  const out: P2[] = [];
  for (const p of raw.slice(0, 256)) {
    if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') return null;
    const r = rotateYaw(p[0], p[1], yaw);
    out.push([pos[0] + r[0], pos[2] + r[1]]);
  }
  return out.length >= 3 ? out : null;
}

/** Floor footprint of a furniture entity (null for wall / ceiling / surface pieces and rugs). */
function furnitureFootprint(e: Entity): Footprint | null {
  const f = furnitureOfEntity(e);
  const def = f?.def;
  if (!f || !def || def.mount !== 'floor' || def.kind === 'rug') return null;
  const [w, h, d] = f.size;
  const p = e.transform.position;
  return { id: e.id, kind: def.kind, poly: obb(p[0], p[2], e.transform.rotation[1], w, d), top: p[1] + h };
}

/** Grid over a rectangle with a blocked mask. */
class Grid {
  readonly nx: number;
  readonly nz: number;
  readonly blocked: Uint8Array;
  constructor(
    readonly x0: number,
    readonly z0: number,
    x1: number,
    z1: number,
    readonly cell: number,
  ) {
    this.nx = Math.max(1, Math.ceil((x1 - x0) / cell));
    this.nz = Math.max(1, Math.ceil((z1 - z0) / cell));
    this.blocked = new Uint8Array(this.nx * this.nz);
  }

  index(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / this.cell);
    const k = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) return -1;
    return k * this.nx + i;
  }

  centre(idx: number): P2 {
    const i = idx % this.nx;
    const k = Math.floor(idx / this.nx);
    return [this.x0 + (i + 0.5) * this.cell, this.z0 + (k + 0.5) * this.cell];
  }

  /** Mark cells whose centre lies inside a (simple) polygon. */
  fill(poly: readonly P2[]): void {
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
    const i0 = Math.max(0, Math.floor((bx0 - this.x0) / this.cell));
    const i1 = Math.min(this.nx - 1, Math.floor((bx1 - this.x0) / this.cell));
    const k0 = Math.max(0, Math.floor((bz0 - this.z0) / this.cell));
    const k1 = Math.min(this.nz - 1, Math.floor((bz1 - this.z0) / this.cell));
    for (let k = k0; k <= k1; k++) {
      const z = this.z0 + (k + 0.5) * this.cell;
      for (let i = i0; i <= i1; i++) {
        const x = this.x0 + (i + 0.5) * this.cell;
        if (pointInPolygon(x, z, poly)) this.blocked[k * this.nx + i] = 1;
      }
    }
  }

  /**
   * Walkable mask: free cells at least `radius` from every blocked cell
   * (two-pass chamfer distance transform, 3-4 weights ≈ Euclidean).
   */
  walkable(radius: number): Uint8Array {
    const n = this.nx * this.nz;
    const d = new Float32Array(n);
    const INF = 1e9;
    for (let i = 0; i < n; i++) d[i] = this.blocked[i] ? 0 : INF;
    const nx = this.nx;
    const a = 1;
    const b = Math.SQRT2;
    for (let k = 0; k < this.nz; k++) {
      for (let i = 0; i < nx; i++) {
        const idx = k * nx + i;
        let v = d[idx] as number;
        if (i > 0) v = Math.min(v, (d[idx - 1] as number) + a);
        if (k > 0) {
          v = Math.min(v, (d[idx - nx] as number) + a);
          if (i > 0) v = Math.min(v, (d[idx - nx - 1] as number) + b);
          if (i < nx - 1) v = Math.min(v, (d[idx - nx + 1] as number) + b);
        }
        d[idx] = v;
      }
    }
    for (let k = this.nz - 1; k >= 0; k--) {
      for (let i = nx - 1; i >= 0; i--) {
        const idx = k * nx + i;
        let v = d[idx] as number;
        if (i < nx - 1) v = Math.min(v, (d[idx + 1] as number) + a);
        if (k < this.nz - 1) {
          v = Math.min(v, (d[idx + nx] as number) + a);
          if (i < nx - 1) v = Math.min(v, (d[idx + nx + 1] as number) + b);
          if (i > 0) v = Math.min(v, (d[idx + nx - 1] as number) + b);
        }
        d[idx] = v;
      }
    }
    const out = new Uint8Array(n);
    const need = radius / this.cell;
    for (let i = 0; i < n; i++) out[i] = (d[i] as number) >= need ? 1 : 0;
    return out;
  }
}

/** Flood fill from seed cells over a walkable mask; returns the reached mask. */
function flood(grid: Grid, walk: Uint8Array, seeds: readonly number[], reached: Uint8Array): void {
  const queue: number[] = [];
  for (const s of seeds) {
    if (s >= 0 && walk[s] && !reached[s]) {
      reached[s] = 1;
      queue.push(s);
    }
  }
  const nx = grid.nx;
  while (queue.length > 0) {
    const c = queue.pop() as number;
    const i = c % nx;
    const neighbours = [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, c - nx, c + nx];
    for (const nb of neighbours) {
      if (nb < 0 || nb >= walk.length || !walk[nb] || reached[nb]) continue;
      reached[nb] = 1;
      queue.push(nb);
    }
  }
}

/** Nearest walkable cell to a point within `maxDist` metres (or -1). */
function nearestWalkable(grid: Grid, walk: Uint8Array, p: P2, maxDist: number, within?: readonly P2[]): number {
  const r = Math.ceil(maxDist / grid.cell);
  const ci = Math.floor((p[0] - grid.x0) / grid.cell);
  const ck = Math.floor((p[1] - grid.z0) / grid.cell);
  let best = -1;
  let bestD = Infinity;
  for (let dk = -r; dk <= r; dk++) {
    for (let di = -r; di <= r; di++) {
      const i = ci + di;
      const k = ck + dk;
      if (i < 0 || k < 0 || i >= grid.nx || k >= grid.nz) continue;
      const idx = k * grid.nx + i;
      if (!walk[idx]) continue;
      const d = di * di + dk * dk;
      if (d >= bestD) continue;
      if (within) {
        const c = grid.centre(idx);
        if (!pointInPolygon(c[0], c[1], within)) continue;
      }
      best = idx;
      bestD = d;
    }
  }
  return best;
}

/** Blocked segments of a wall at walking height, as oriented rectangles in its parent's frame. */
function wallObstacles(e: Entity): P2[][] {
  const parsed = WallParams.safeParse(params(e));
  if (!parsed.success) return [];
  const p = parsed.data;
  const spans = openingSpans(p).filter((s) => s.kind !== 'window' && s.y0 < 0.05 && s.y1 >= 1.9);
  const t = p.thickness / 2;
  const pieces: Array<[number, number]> = [];
  let x = -Math.max(0, Math.min(p.startA, p.startB)) - 0.001;
  const end = p.length + Math.max(0, Math.min(p.endA, p.endB)) + 0.001;
  for (const s of spans) {
    // Door linings narrow the passage.
    const lining = s.kind === 'door' ? LINING + DOOR_CLEARANCE : 0;
    if (s.x0 + lining > x) pieces.push([x, s.x0 + lining]);
    x = Math.max(x, s.x1 - lining);
  }
  if (end > x) pieces.push([x, end]);
  const pos = e.transform.position;
  const yaw = e.transform.rotation[1];
  return pieces.map(([a, b]) =>
    (
      [
        [a, -t],
        [b, -t],
        [b, t],
        [a, t],
      ] as P2[]
    ).map((q) => {
      const r = rotateYaw(q[0], q[1], yaw);
      return [pos[0] + r[0], pos[2] + r[1]] as P2;
    }),
  );
}

/** Quarter disc swept by a swing door leaf (in its parent's frame), or null. */
function doorSweep(e: Entity): P2[] | null {
  const behavior = e.behaviors.find((b) => b.type === 'door');
  if (!behavior || behavior.params['motion'] !== 'swing') return null;
  const w = typeof params(e)['width'] === 'number' ? (params(e)['width'] as number) : 0.9;
  const hinge = behavior.params['hinge'] === 'right' ? 1 : -1;
  const angle = typeof behavior.params['swingAngle'] === 'number' ? (behavior.params['swingAngle'] as number) : 90;
  const pos = e.transform.position;
  const yaw = e.transform.rotation[1];
  const pts: P2[] = [[hinge * (w / 2), 0]];
  for (let k = 0; k <= 8; k++) {
    const a = ((angle * k) / 8) * (Math.PI / 180);
    // Leaf vector from the hinge to the latch edge, rotated by the swing (three.js yaw).
    const lx = -hinge * w;
    const x = lx * Math.cos(a);
    const z = -lx * Math.sin(a);
    pts.push([hinge * (w / 2) + x * 0.97, z * 0.97]);
  }
  return pts.map((q) => {
    const r = rotateYaw(q[0], q[1], yaw);
    return [pos[0] + r[0], pos[2] + r[1]] as P2;
  });
}

/** Check one building (see the module docs). */
export function checkBuilding(world: WorldDoc, buildingId: EntityId, clearance = 0.8): BuildingReport {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const issues: ArchIssue[] = [];
  const kids = childrenIndex(world);
  const building = world.entities[buildingId];
  const levels: LevelData[] = [];
  for (const e of kids.get(buildingId) ?? []) {
    if (e.arch?.role === 'level') levels.push({ entity: e, index: e.arch.level ?? levels.length, height: e.arch.height ?? 3, children: kids.get(e.id) ?? [] });
  }
  levels.sort((a, b) => a.index - b.index);
  const report: BuildingReport = { building: buildingId, passed: true, rooms: 0, reachable: 0, doors: 0, doorsClear: 0, issues, ms: 0 };
  if (!building || levels.length === 0) {
    report.ms = 0;
    return report;
  }
  // Doorways are short: a leaf width equal to the walkway passes (4 cm slack + half a cell for grid quantisation).
  const radius = Math.max(0.2, clearance / 2 - 0.04 - NAV_CELL / 2);
  // Entrance: the player spawn in this building's frame (world → building: inverse yaw).
  const bp = building.transform.position;
  const sp = world.player.spawn;
  const rel = rotateYaw(sp[0] - bp[0], sp[2] - bp[2], -building.transform.rotation[1]);
  const entrance: P2 = [rel[0], rel[1]];
  // Stair links between levels: [level index, bottom approach, top arrival].
  const links: Array<{ from: number; bottom: P2; top: P2 }> = [];
  const pending = new Map<number, P2[]>();
  pending.set(levels[0]?.index ?? 0, [entrance]);

  for (const L of levels) {
    const rooms = L.children.filter((e) => e.arch?.role === 'room');
    const roomPolys = rooms.map((r) => ({ id: r.id, poly: placedPolygon(r) })).filter((r): r is { id: EntityId; poly: P2[] } => r.poly !== null);
    report.rooms += roomPolys.length;
    if (roomPolys.length === 0) continue;
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const r of roomPolys) for (const p of r.poly) {
      x0 = Math.min(x0, p[0]);
      z0 = Math.min(z0, p[1]);
      x1 = Math.max(x1, p[0]);
      z1 = Math.max(z1, p[1]);
    }
    const ground = L.index === levels[0]?.index;
    const margin = ground ? MARGIN : 0.5;
    let cell = NAV_CELL;
    while (((x1 - x0 + 2 * margin) / cell) * ((z1 - z0 + 2 * margin) / cell) > MAX_CELLS) cell *= 1.5;
    const grid = new Grid(x0 - margin, z0 - margin, x1 + margin, z1 + margin, cell);
    // Upper levels: outside the rooms is air.
    if (!ground) {
      for (let idx = 0; idx < grid.blocked.length; idx++) {
        const c = grid.centre(idx);
        if (!roomPolys.some((r) => pointInPolygon(c[0], c[1], r.poly))) grid.blocked[idx] = 1;
      }
    }
    const furniture: Footprint[] = [];
    for (const e of L.children) {
      const role = e.arch?.role;
      if (role === 'room') {
        // Stair holes in this floor are drops, not floor.
        const holes = params(e)['holes'];
        if (Array.isArray(holes)) {
          for (const h of holes.slice(0, 16)) {
            const poly = placedPolygon({ ...e, shape: { kind: 'procedural', generator: 'arch-slab', params: { polygon: h } } } as Entity);
            if (poly) grid.fill(poly);
          }
        }
      } else if (role === 'wall') for (const o of wallObstacles(e)) grid.fill(o);
      else if (role === 'furniture' || role === 'light' || role === 'switch') {
        const f = furnitureFootprint(e);
        if (f) {
          furniture.push(f);
          grid.fill(f.poly);
        }
      } else if (role === 'stair' && generatorOf(e) === 'arch-stair') {
        const sp2 = StairParams.safeParse(params(e));
        if (!sp2.success) continue;
        const fp = stairFootprint(sp2.data);
        const pos = e.transform.position;
        const yaw = e.transform.rotation[1];
        const world2 = (q: P2): P2 => {
          const r = rotateYaw(q[0], q[1], yaw);
          return [pos[0] + r[0], pos[2] + r[1]];
        };
        grid.fill(fp.map(world2));
        const { flights } = stairLayout(sp2.data);
        const last = flights[flights.length - 1];
        if (last) {
          const run = last.treads * sp2.data.going;
          links.push({ from: L.index, bottom: world2([-0.35, 0]), top: world2([last.x + last.dx * (run + 0.4), last.z + last.dz * (run + 0.4)]) });
        }
      }
    }
    const walk = grid.walkable(radius);
    const reached = new Uint8Array(walk.length);
    const seeds = (pending.get(L.index) ?? []).map((p) => nearestWalkable(grid, walk, p, 1.5));
    if (seeds.every((s) => s < 0)) {
      if (ground) issues.push({ code: 'no_entrance', message: `${buildingId}: the entrance (player spawn) is not next to a walkable approach`, entities: [buildingId], hint: 'Add a door to "outside" (main: true) and keep 1 m in front of it clear; the player starts outside the main door.' });
      // Fall back to the first room so the rest is still checked.
      const r0 = roomPolys[0];
      if (r0) seeds.push(nearestWalkable(grid, walk, r0.poly[0] ?? [0, 0], 50, r0.poly));
    }
    flood(grid, walk, seeds, reached);
    for (const r of roomPolys) {
      let ok = false;
      for (let idx = 0; idx < reached.length && !ok; idx++) {
        if (!reached[idx]) continue;
        const c = grid.centre(idx);
        if (pointInPolygon(c[0], c[1], r.poly)) ok = true;
      }
      if (ok) {
        report.reachable++;
      } else {
        const name = world.entities[r.id]?.name || r.id;
        issues.push({
          code: 'unreachable_room',
          message: `${name} (${r.id}) cannot be reached on foot with ${clearance.toFixed(1)} m walkways`,
          entities: [r.id],
          hint: `Add a door (between: [${r.id.replace(`${buildingId}-`, '')}, <neighbour>]) or move furniture that blocks its doorway; keep ${clearance.toFixed(1)} m clear in front of doors.`,
        });
      }
    }
    // Stairs from this level seed the level above when their bottom is reached.
    for (const link of links.filter((k) => k.from === L.index)) {
      const b = nearestWalkable(grid, walk, link.bottom, 0.8);
      const next = levels.find((x) => x.index > L.index);
      if (b >= 0 && reached[b] && next) pending.set(next.index, [...(pending.get(next.index) ?? []), link.top]);
    }
    // Door clearance.
    for (const e of L.children) {
      if (e.arch?.role !== 'door' || e.arch.kind !== 'leaf') continue;
      report.doors++;
      const sweep = doorSweep(e);
      if (!sweep) {
        report.doorsClear++;
        continue;
      }
      const hit = furniture.find((f) => convexOverlap(sweep, f.poly, 0.01));
      if (hit) {
        issues.push({ code: 'door_blocked', message: `${e.name || e.id} cannot open: its leaf hits ${hit.kind} ${hit.id}`, entities: [e.id, hit.id], hint: `Move ${hit.id} at least ${(Number(params(e)['width'] ?? 0.9) + 0.1).toFixed(1)} m from the door, or swing the door the other way.` });
      } else report.doorsClear++;
    }
    // Overlaps between floor pieces.
    for (let i = 0; i < furniture.length; i++) {
      for (let j = i + 1; j < furniture.length; j++) {
        const a = furniture[i] as Footprint;
        const b = furniture[j] as Footprint;
        if (tucksUnder(a.kind, b.kind) || !convexOverlap(a.poly, b.poly, 0.02)) continue;
        issues.push({ code: 'furniture_overlap', message: `${a.kind} ${a.id} overlaps ${b.kind} ${b.id}`, entities: [a.id, b.id], hint: `Move ${b.id} so the footprints are apart (pieces are boxes of their catalogue size).` });
      }
    }
    // Support.
    for (const e of L.children) {
      const f = furnitureOfEntity(e);
      const def = f?.def;
      if (!f || !def) continue;
      // Ceiling library models hang from their top (procedural fixtures have their origin at the ceiling).
      const y = e.transform.position[1] + (def.mount === 'ceiling' && e.shape.kind === 'asset' ? f.size[1] : 0);
      let ok = true;
      if (def.mount === 'floor') ok = Math.abs(y) <= 0.03;
      else if (def.mount === 'ceiling') ok = Math.abs(y - (L.height - 0.22)) <= 0.06;
      else if (def.mount === 'surface') {
        const p = e.transform.position;
        ok = furniture.some((f) => pointInPolygon(p[0], p[2], f.poly) && Math.abs(f.top - y) <= 0.04);
      }
      if (!ok) issues.push({ code: 'floating', message: `${def.kind} ${e.id} is not supported (y = ${y.toFixed(2)})`, entities: [e.id], hint: def.mount === 'floor' ? 'Set its y to 0 (floor level of its storey).' : def.mount === 'surface' ? 'Put it on top of a table or nightstand (y = the host top).' : `Hang it at the ceiling (y = ${(L.height - 0.22).toFixed(2)}).` });
    }
  }
  report.passed = issues.length === 0;
  report.ms = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10;
  return report;
}

/** Check every building matched by a selector ("*" = all buildings). */
export function checkBuildings(world: WorldDoc, target = '*', clearance = 0.8): BuildingReport[] {
  const ids = target === '*' ? Object.keys(world.entities) : resolveSelector(world, target);
  const out: BuildingReport[] = [];
  for (const id of ids) {
    const e = world.entities[id];
    if (e?.arch?.role === 'building') out.push(checkBuilding(world, id, clearance));
    if (out.length >= 16) break;
  }
  return out;
}

/** Compact text of reports for the agent's repair turn. */
export function summarizeBuildingReports(reports: readonly BuildingReport[]): string {
  if (reports.length === 0) return 'no buildings to check';
  return reports
    .map((r) => {
      const head = `${r.building}: ${r.reachable}/${r.rooms} rooms reachable, ${r.doorsClear}/${r.doors} doors open freely`;
      if (r.issues.length === 0) return `${head} — OK`;
      return [head, ...r.issues.slice(0, 8).map((i) => `- ${i.message}. Fix: ${i.hint}`), ...(r.issues.length > 8 ? [`- … ${r.issues.length - 8} more`] : [])].join('\n');
    })
    .join('\n');
}
