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
import { stairFootprint, stairGuardOutlines, stairLayout } from './stair';
import { analyzeRoomPlacements } from './placement';
import { placedPolygon } from './entity-geom';
import { parsePlan } from './compile';
import { roomPolygon } from './rooms';
import { fitStair, stairJson, stairSideEntry, stairLandingDepth, STAIR_BODY, STAIR_BODY_CLEARANCE } from './stair-fit';
import type { PlanStair } from './plan';

export { placedPolygon };

/** One problem found by the checks, with the entities involved and a concrete fix. */
export interface ArchIssue {
  code: 'unreachable_room' | 'door_blocked' | 'furniture_overlap' | 'floating' | 'no_entrance' | 'wall_item_on_opening' | 'wall_item_overlap' | 'curtain_off_window';
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
/**
 * Radius a walker needs on a stair landing (m): half its body (the walkthrough bot's capsule and skin) and a
 * margin for the grid, which measures from cell centres. The rest of the building is checked with the walkway
 * clearance, which lets doorways pass.
 */
const LANDING_RADIUS = STAIR_BODY / 2 + 0.05;
/** How far from the end of a stair a walker must get on clear floor for its landing to lead somewhere (m). */
const LANDING_ESCAPE = 1.5;
/** A landing that reaches this close to a doorway leads on through it (m). */
const LANDING_DOORWAY = 0.6;
/** Half-thickness of a railing's collider (m). */
const RAIL_HALF = 0.04;
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
export class Grid {
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
export function flood(grid: Grid, walk: Uint8Array, seeds: readonly number[], reached: Uint8Array): void {
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
/** How far the top of a stair may be from walkable floor on the level above (m). */
export const STAIR_ARRIVAL_SNAP = 0.3;

export function nearestWalkable(grid: Grid, walk: Uint8Array, p: P2, maxDist: number, within?: readonly P2[]): number {
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
export function doorSweep(e: Entity): P2[] | null {
  const behavior = e.behaviors.find((b) => b.type === 'door');
  // A hinged leaf swings by animation ('swing') or on a physical hinge ('joint'); a sliding leaf sweeps nothing.
  if (!behavior || (behavior.params['motion'] !== 'swing' && behavior.params['motion'] !== 'joint')) return null;
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

/** A railing's collider as one thin rectangle per segment (in its parent's frame). */
function railingObstacles(e: Entity): P2[][] {
  const pts = params(e)['points'];
  if (!Array.isArray(pts)) return [];
  const pos = e.transform.position;
  const yaw = e.transform.rotation[1];
  const at = (q: P2): P2 => {
    const r = rotateYaw(q[0], q[1], yaw);
    return [pos[0] + r[0], pos[2] + r[1]];
  };
  const line = pts.slice(0, 64).filter((p): p is [number, number] => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number').map((p) => at([p[0], p[1]]));
  const out: P2[][] = [];
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k] as P2;
    const b = line[k + 1] as P2;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    // Across by the collider's half-thickness, and as far past each end (the posts).
    const nx = -uz * RAIL_HALF;
    const nz = ux * RAIL_HALF;
    const ex = ux * RAIL_HALF;
    const ez = uz * RAIL_HALF;
    out.push([
      [a[0] - ex + nx, a[1] - ez + nz],
      [b[0] + ex + nx, b[1] + ez + nz],
      [b[0] + ex - nx, b[1] + ez - nz],
      [a[0] - ex - nx, a[1] - ez - nz],
    ]);
  }
  return out;
}

/**
 * Whether a walker standing at `seed` on a landing gets away from it: a flood over the landing mask that reaches
 * `LANDING_ESCAPE` from `origin`, or a doorway.
 */
function escapes(grid: Grid, walk: Uint8Array, seed: number, origin: P2, doorways: readonly P2[]): boolean {
  if (seed < 0 || !walk[seed]) return false;
  const seen = new Uint8Array(walk.length);
  const queue = [seed];
  seen[seed] = 1;
  const nx = grid.nx;
  const far = LANDING_ESCAPE * LANDING_ESCAPE;
  const near = LANDING_DOORWAY * LANDING_DOORWAY;
  while (queue.length > 0) {
    const c = queue.pop() as number;
    const p = grid.centre(c);
    if ((p[0] - origin[0]) ** 2 + (p[1] - origin[1]) ** 2 >= far) return true;
    if (doorways.some((d) => (p[0] - d[0]) ** 2 + (p[1] - d[1]) ** 2 <= near)) return true;
    const i = c % nx;
    for (const nb of [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, c - nx, c + nx]) {
      if (nb < 0 || nb >= walk.length || !walk[nb] || seen[nb]) continue;
      seen[nb] = 1;
      queue.push(nb);
    }
  }
  return false;
}

/** Clear floor straight out from `from` along `dir` before the first blocked cell (m, up to 3). */
function clearAhead(grid: Grid, from: P2, dir: P2): number {
  for (let t = 0.02; t <= 3; t += 0.01) {
    const idx = grid.index(from[0] + dir[0] * t, from[1] + dir[1] * t);
    if (idx < 0 || grid.blocked[idx]) return Math.max(0, t - 0.01);
  }
  return 3;
}

/** A stair between two levels, in its level's frame. */
interface StairLink {
  from: number;
  id: EntityId;
  /** In front of the first riser, and beside the first treads (either side). */
  bottom: P2;
  besides: [P2, P2];
  foot: P2;
  footDir: P2;
  /** Where the top step leads, its front edge and the direction the last flight climbs. */
  top: P2;
  topEdge: P2;
  topDir: P2;
  width: number;
}

/** A stair that fixes `stairId` (an entity `<building>-l<level>-stair<i>`), as a ready op, or '' when none is found. */
function stairFix(world: WorldDoc, buildingId: EntityId, stairId: EntityId): string {
  const m = /-l(\d+)-stair(\d+)$/.exec(stairId);
  const raw = world.entities[buildingId]?.arch?.plan;
  if (!m || raw === undefined) return '';
  try {
    const plan = parsePlan(raw);
    const li = Number(m[1]);
    const si = Number(m[2]);
    const stair: PlanStair | undefined = plan.levels[li]?.stairs[si];
    if (!stair) return '';
    const others = (plan.levels[li]?.stairs ?? []).filter((_, k) => k !== si);
    let fit = fitStair(plan, li, { near: stair, others, room: roomOfStair(plan, li, stair) });
    if (!fit.ok) fit = fitStair(plan, li, { near: stair, others });
    if (!fit.ok) return ` No stair fits instead: ${fit.reasons.join('; ')}.`;
    return ` A stair that works: build_architecture {"op":"add_stairs","building":"${plan.id}","level":${li},"replace":${si},"stair":${stairJson(fit.stair)}} (${fit.line}).`;
  } catch {
    return '';
  }
}

/** Whether a stair can be stepped onto from the side of its first treads, by the building's plan (true when the plan is not at hand). */
function sideEntryAt(world: WorldDoc, buildingId: EntityId, stairId: EntityId): boolean {
  const m = /-l(\d+)-stair(\d+)$/.exec(stairId);
  const raw = world.entities[buildingId]?.arch?.plan;
  if (!m || raw === undefined) return true;
  try {
    return stairSideEntry(parsePlan(raw), Number(m[1]), Number(m[2]));
  } catch {
    return true;
  }
}

/** The room whose outline holds the first riser of a stair. */
function roomOfStair(plan: ReturnType<typeof parsePlan>, li: number, s: PlanStair): string | undefined {
  return (plan.levels[li]?.rooms ?? []).find((r) => r.type !== 'terrace' && pointInPolygon(s.at[0], s.at[1], roomPolygon(r)))?.id;
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
  // Stair links between levels.
  const links: StairLink[] = [];
  // Seeds per level with how far they may snap to walkable floor: the entrance is found loosely, but the top of a
  // stair must arrive on floor right there (a flight that runs into a wall does not reach the room behind it).
  const pending = new Map<number, Array<{ p: P2; snap: number; stair?: EntityId; link?: StairLink }>>();
  pending.set(levels[0]?.index ?? 0, [{ p: entrance, snap: 1.5 }]);

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
      else if (role === 'railing' && generatorOf(e) === 'arch-railing') for (const o of railingObstacles(e)) grid.fill(o);
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
        // Its balustrades stand just outside the flights and landings.
        for (const o of stairGuardOutlines(sp2.data)) grid.fill(o.map(world2));
        const { flights } = stairLayout(sp2.data);
        const last = flights[flights.length - 1];
        if (last) {
          const run = last.treads * sp2.data.going;
          const w = sp2.data.width;
          const dir = (dx: number, dz: number): P2 => rotateYaw(dx, dz, yaw);
          links.push({
            from: L.index,
            id: e.id,
            bottom: world2([-0.35, 0]),
            besides: [world2([0.3, -(w / 2 + 0.45)]), world2([0.3, w / 2 + 0.45])],
            foot: world2([0, 0]),
            footDir: dir(1, 0),
            top: world2([last.x + last.dx * (run + 0.4), last.z + last.dz * (run + 0.4)]),
            topEdge: world2([last.x + last.dx * run, last.z + last.dz * run]),
            topDir: dir(last.dx, last.dz),
            width: w,
          });
        }
      }
    }
    const walk = grid.walkable(radius);
    const reached = new Uint8Array(walk.length);
    const seeds = (pending.get(L.index) ?? []).map((s) => nearestWalkable(grid, walk, s.p, s.snap));
    if (ground && seeds.every((s) => s < 0)) {
      issues.push({ code: 'no_entrance', message: `${buildingId}: the entrance (player spawn) is not on walkable floor`, entities: [buildingId], hint: 'Add a door to "outside" (main: true) and keep 1 m in front of it clear; the player starts just inside the main door facing the house.' });
      // Fall back to the first room so the rest is still checked.
      const r0 = roomPolys[0];
      if (r0) seeds.push(nearestWalkable(grid, walk, r0.poly[0] ?? [0, 0], 50, r0.poly));
    }
    // An upper level is reached only where a stair arrives on its floor: no stair (or one that runs into a wall)
    // leaves its rooms unreachable instead of being waved through.
    // Landings are measured for the walker's body (walls, railings, the stairwell and furniture block): only then
    // does the stair lead anywhere.
    let landingWalk: Uint8Array | null = null;
    const landing = (): Uint8Array => (landingWalk ??= grid.walkable(LANDING_RADIUS));
    const doorways = L.children.filter((e) => e.arch?.role === 'opening').map((e) => [e.transform.position[0], e.transform.position[2]] as P2);
    const need = (w: number): string => `${stairLandingDepth(w).toFixed(2)} m (${stairLandingDepth(w) > STAIR_BODY + 2 * STAIR_BODY_CLEARANCE + 1e-9 ? "the stair's width" : `a ${STAIR_BODY.toFixed(2)} m body with ${STAIR_BODY_CLEARANCE.toFixed(2)} m each side`})`;
    if (!ground) {
      (pending.get(L.index) ?? []).forEach((s, i) => {
        if (s.stair && (seeds[i] ?? -1) < 0) {
          issues.push({ code: 'unreachable_room', message: `${s.stair}: the top step arrives at (${s.p[0].toFixed(1)}, ${s.p[1].toFixed(1)}), which is not open floor on the level above (a wall, the stairwell or furniture is in the way)`, entities: [s.stair], hint: `Turn or move the stair so a landing of ${need(s.link?.width ?? 1)} beyond its top step is clear floor of a room on the level above.${stairFix(world, buildingId, s.stair)}` });
          return;
        }
        const link = s.link;
        if (!s.stair || !link) return;
        const strict = landing();
        const seed = nearestWalkable(grid, strict, s.p, STAIR_ARRIVAL_SNAP);
        if (escapes(grid, strict, seed, link.topEdge, doorways)) return;
        const depth = clearAhead(grid, [link.topEdge[0] + link.topDir[0] * 0.03, link.topEdge[1] + link.topDir[1] * 0.03], link.topDir) + 0.03;
        issues.push({
          code: 'unreachable_room',
          message: `${s.stair}: the top step comes out at (${link.topEdge[0].toFixed(2)}, ${link.topEdge[1].toFixed(2)}) onto a landing a walker cannot get off: ${depth.toFixed(2)} m of clear floor beyond it before a wall, railing or piece of furniture, and no way off it ${(2 * LANDING_RADIUS).toFixed(2)} m wide for the body, where it needs a landing ${need(link.width)} deep`,
          entities: [s.stair],
          hint: `Move or turn the stair so its top step comes out onto ${need(link.width)} of clear floor that leads on into the room.${stairFix(world, buildingId, s.stair)}`,
        });
        seeds[i] = -1;
      });
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
      if (!(b >= 0 && reached[b] && next)) continue;
      // The foot needs a landing too: in front of the first riser or beside the first treads, that the body gets onto.
      const strict = landing();
      // A stair against the wall at its foot is stepped onto from the side only where the floor behind the first riser
      // is deep enough for the body to reach the low treads (stair-fit measures it on the plan, in centimetres).
      const sides = sideEntryAt(world, buildingId, link.id) ? link.besides : [];
      const feet = [link.bottom, ...sides].map((p) => nearestWalkable(grid, strict, p, 0.3));
      if (!feet.some((f) => f >= 0 && escapes(grid, strict, f, link.foot, doorways))) {
        const depth = clearAhead(grid, [link.foot[0] - link.footDir[0] * 0.03, link.foot[1] - link.footDir[1] * 0.03], [-link.footDir[0], -link.footDir[1]]) + 0.03;
        issues.push({
          code: 'unreachable_room',
          message: `${link.id}: the foot of the stair at (${link.foot[0].toFixed(2)}, ${link.foot[1].toFixed(2)}) has no landing a walker can step onto it from: ${depth.toFixed(2)} m of clear floor in front of the first riser and none beside its first treads, where it needs ${need(link.width)}`,
          entities: [link.id],
          hint: `Move or turn the stair so ${need(link.width)} of clear floor lies in front of its first riser (or beside its first treads).${stairFix(world, buildingId, link.id)}`,
        });
        continue;
      }
      pending.set(next.index, [...(pending.get(next.index) ?? []), { p: link.top, snap: STAIR_ARRIVAL_SNAP, stair: link.id, link }]);
    }
    // Door clearance.
    for (const e of L.children) {
      if (e.arch?.role !== 'door' || e.arch.kind === 'sliding') continue;
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
        ok = furniture.some((f) => pointInPolygon(p[0], p[2], f.poly) && (Math.abs(f.top - y) <= 0.04 || (f.kind === 'bed' && Math.abs(y - 0.58) <= 0.08)));
      }
      if (!ok) issues.push({ code: 'floating', message: `${def.kind} ${e.id} is not supported (y = ${y.toFixed(2)})`, entities: [e.id], hint: def.mount === 'floor' ? 'Set its y to 0 (floor level of its storey).' : def.mount === 'surface' ? 'Put it on top of a table or nightstand (y = the host top).' : `Hang it at the ceiling (y = ${(L.height - 0.22).toFixed(2)}).` });
    }
  }
  // Wall pieces (pictures, curtains, mirrors, TVs …) must not sit over doors, windows or each other.
  for (const p of analyzeRoomPlacements(world, buildingId)) issues.push({ code: p.code, message: p.message, entities: p.entities, hint: p.hint });
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
