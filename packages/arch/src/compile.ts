/**
 * Building compiler: BuildingPlan → World IR entities (as `add` patches).
 *
 * Hierarchy: building (origin + rotation) → levels (elevation) → rooms
 * (floor slabs), ceilings, walls (mitred network with openings), door frames
 * and leaves (swinging with the `door` behaviour, E to open), windows,
 * stairs (+ stairwell holes and railings above), furniture, light fittings
 * with real light sources, switches; a roof on top; optional terrace and
 * pool. Everything in a level is posed in the plan frame, so the plan stays
 * the single source of truth and can be re-compiled after edits.
 */
import type { EntityInput, Json, LightSpec, MaterialSpec, PatchInput } from '@aether/core';
import { BuildingPlan, MAX_BUILDING_ENTITIES, type BuildingPlanInput, type Compass, type PlanDoor, type PlanLevel, type PlanRoom, type RoomType } from './plan';
import { palette, floorFor, habitable, type StylePalette } from './style';
import { wallNetwork, type NetworkWall } from './wall-network';
import { solveWallJoins } from './wall-joins';
import { compassNormal, compassOf, edgePoint, exteriorSpans, outlineLoops, offsetPolygon, roomEdges, roomPolygon, sharedSpans, type EdgeSpan, type RoomEdge } from './rooms';
import { bounds, centroid, interiorPoint, isAxisRectangle, pointInPolygon, positive, rotateYaw, simplifyPolygon, yawOf, type P2 } from './math2';
import { furnishRoom } from './recipes';
import { type Placed, type RoomContext, type RoomDoor, type RoomWindow } from './layout';
import { stairFootprint, stairLayout } from './stair';
import { StairParams } from './params';
import { DOOR_CLEARANCE, LINING, sashHeight } from './openings';
import { roofRise } from './roof';
import { furnitureById, furnitureMovables } from './furniture/index';

/** Light sources kept per building (each costs per-pixel work); further fittings only glow. */
export const MAX_BUILDING_LIGHTS = 14;
/** Slab thickness between storeys. */
export const FLOOR_THICKNESS = 0.22;

/** Result of compiling a plan. */
export interface CompiledBuilding {
  /** Id of the building root entity. */
  id: string;
  /** Entities, parents before children. */
  entities: EntityInput[];
  /** `add` patches of {@link entities}. */
  patches: PatchInput[];
  /** @deprecated alias of {@link id}. */
  root: string;
  /** Element counts (agent summaries). */
  stats: { levels: number; rooms: number; floorArea: number; walls: number; doors: number; windows: number; stairs: number; furniture: number; lights: number };
  /** Player spawn in front of the main entrance (world frame). */
  spawn: [number, number, number];
  /** Yaw (degrees) facing the entrance from the spawn. */
  spawnYaw: number;
  /** Total height (top of the roof), world bounds. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** Rooms with their names, types and areas (summaries, floor plan labels). */
  rooms: Array<{ id: string; level: number; name: string; type: RoomType; area: number }>;
  /** Non-fatal notes (pieces that did not fit, unknown kinds …). */
  notes: string[];
}

export interface WallRec {
  id: string;
  w: NetworkWall;
  thickness: number;
  openings: Array<{ kind: 'door' | 'window' | 'opening'; offset: number; width: number; height: number; sill: number }>;
  len: number;
  dir: P2;
}

/** First-person start inside the entrance: where to stand and the plan-frame yaw (degrees, 0 faces −Z) to look along. */
export interface EntranceView {
  at: P2;
  yaw: number;
}

/** Eye distance cap of a sight line (metres). */
const SIGHT_CAP = 16;

/** How far a sight line travels and through how many doorless openings it passed. */
export interface Sight {
  distance: number;
  arches: number;
  /** What stops the line: a door (reachable, reads as a destination), a window (a view out) or plain wall. */
  end: 'door' | 'window' | 'wall';
}

/**
 * Distance a ray from `from` along `dir` travels before a wall stops it. Doorless openings (arches) let it through;
 * doors, windows and walls stop it. Pure plan geometry (the plan frame, metres).
 */
export function sightLine(from: P2, dir: P2, walls: readonly WallRec[]): Sight {
  const hits: Array<{ t: number; through: boolean; end: 'door' | 'window' | 'wall' }> = [];
  for (const rec of walls) {
    const ex = rec.w.b[0] - rec.w.a[0];
    const ez = rec.w.b[1] - rec.w.a[1];
    const den = dir[0] * ez - dir[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const qx = rec.w.a[0] - from[0];
    const qz = rec.w.a[1] - from[1];
    const t = (qx * ez - qz * ex) / den;
    const u = (qx * dir[1] - qz * dir[0]) / den;
    if (t <= 0.05 || t >= SIGHT_CAP || u < 0 || u > 1) continue;
    const along = u * rec.len;
    const at = rec.openings.find((o) => Math.abs(along - o.offset) < o.width / 2 - 0.05);
    hits.push({ t, through: at?.kind === 'opening', end: at?.kind === 'door' ? 'door' : at?.kind === 'window' ? 'window' : 'wall' });
  }
  hits.sort((x, y) => x.t - y.t);
  let arches = 0;
  for (const h of hits) {
    if (!h.through) return { distance: h.t, arches, end: h.end };
    arches++;
  }
  return { distance: SIGHT_CAP, arches, end: 'wall' };
}

/**
 * Where a walkthrough starts: 1.4 to 2.2 m inside the main entrance (clear of the door leaf's swing, inside the
 * entrance room) looking along the direction, within 110° of straight in, that shows the most of the house (a long
 * sight line, better still through an open archway into the next room), so the first frame is the interior and the
 * door is behind the player. Null when no inside spot exists.
 */
export function entranceView(entry: { c: P2; n: P2; room: string }, walls: readonly WallRec[], polys: ReadonlyMap<string, P2[]>): EntranceView | null {
  const poly = polys.get(entry.room);
  if (!poly) return null;
  const inward: P2 = [-entry.n[0], -entry.n[1]];
  let at: P2 | null = null;
  for (const d of [2.2, 1.9, 1.6, 1.4]) {
    const p: P2 = [entry.c[0] + inward[0] * d, entry.c[1] + inward[1] * d];
    if (pointInPolygon(p[0], p[1], poly) && pointInPolygon(p[0], p[1], offsetPolygon(poly, -0.35))) {
      at = p;
      break;
    }
  }
  if (!at) return null;
  let bestScore = -Infinity;
  let bestDir: P2 = inward;
  for (let deg = -110; deg <= 110; deg += 5) {
    const r = (deg * Math.PI) / 180;
    const dir: P2 = [inward[0] * Math.cos(r) - inward[1] * Math.sin(r), inward[0] * Math.sin(r) + inward[1] * Math.cos(r)];
    const sight = sightLine(at, dir, walls);
    const score = Math.min(sight.distance, 9) + 4 * Math.min(2, sight.arches) + (sight.end === 'door' ? 2.5 : sight.end === 'window' ? 2 : 0) - Math.abs(deg) * 0.02;
    if (score > bestScore) {
      bestScore = score;
      bestDir = dir;
    }
  }
  return { at, yaw: (Math.atan2(-bestDir[0], -bestDir[1]) * 180) / Math.PI };
}

/** Refusal with a machine-readable code and a concrete fix hint (agents act on the hint). */
export class PlanError extends Error {
  override name = 'PlanError';
  readonly code: string;
  readonly hint: string;

  /** `new PlanError(message)` or `new PlanError(code, message, hint)`. */
  constructor(codeOrMessage: string, message?: string, hint?: string) {
    super(message ?? codeOrMessage);
    this.code = message === undefined ? 'invalid_plan' : codeOrMessage;
    this.hint = hint ?? 'Fix the plan and try again.';
  }
}

const NAMES: Record<RoomType, string> = {
  living: 'Living room', kitchen: 'Kitchen', dining: 'Dining room', bedroom: 'Bedroom', bathroom: 'Bathroom', office: 'Study', hall: 'Hallway', entry: 'Entry',
  cafe: 'Café', meeting: 'Meeting room', 'open-office': 'Open office', lobby: 'Lobby', storage: 'Storage', laundry: 'Laundry', terrace: 'Terrace', garage: 'Garage', studio: 'Studio', kids: "Kids' room",
};

/** Parse a plan (throws PlanError with readable issues). */
export function parsePlan(input: unknown): BuildingPlan {
  const res = BuildingPlan.safeParse(input);
  if (!res.success) {
    const issues = res.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new PlanError('invalid_plan', `building plan invalid: ${issues}`, 'A plan needs levels: [{rooms: [{id, type, rect: [x0,z0,x1,z1]}], doors: [{between: [roomA, roomB|"outside"]}]}]; adjacent rooms share edges.');
  }
  return res.data;
}

function round(n: number, d = 1000): number {
  const r = Math.round(n * d) / d;
  return r === 0 ? 0 : r;
}

/** Compile a building plan. Throws {@link PlanError} for invalid input. */
export function compileBuilding(input: BuildingPlanInput | BuildingPlan, opts: { seed?: number } = {}): CompiledBuilding {
  const plan = parsePlan(input);
  const pal = palette(plan.style);
  const bid = plan.id;
  const seed = (opts.seed ?? 1) >>> 0;
  const entities: EntityInput[] = [];
  const notes: string[] = [];
  const roomsOut: CompiledBuilding['rooms'] = [];
  let lights = 0;
  const add = (e: EntityInput): void => {
    if (entities.length >= MAX_BUILDING_ENTITIES) throw new PlanError('too_large', `building would exceed ${MAX_BUILDING_ENTITIES} entities`, 'Use fewer rooms or levels, or set furnish: false on some rooms.');
    entities.push(e);
  };
  // Validate rooms: unique ids per level, simple polygons, no overlaps.
  plan.levels.forEach((lvl, li) => {
    const ids = new Set<string>();
    for (const r of lvl.rooms) {
      if (ids.has(r.id)) throw new PlanError('duplicate_room', `level ${li}: duplicate room id "${r.id}"`, 'Give every room on a level its own id.');
      ids.add(r.id);
      const poly = simplifyPolygon(roomPolygon(r));
      if (poly.length < 3) throw new PlanError('bad_room', `room ${r.id}: outline is degenerate`, 'Use rect [x0,z0,x1,z1] with x1 > x0 and z1 > z0, or a polygon of 3+ distinct points.');
    }
  });

  add({ id: bid, name: plan.name, transform: { position: [plan.origin[0], 0, plan.origin[1]], rotation: [0, plan.rotation, 0] }, arch: { role: 'building', name: plan.name, plan: plan as unknown as Json }, tags: ['building', 'focus'] });

  let elevation = plan.plinth;
  let spawnLocal: P2 | null = null;
  let spawnYaw = 0;
  /** The main entrance: door centre, outward normal (plan frame) and the room behind it; the ground floor's walls and rooms. */
  let entry: { c: P2; n: P2; room: string } | null = null;
  let groundPlan: { walls: WallRec[]; polys: Map<string, P2[]> } | null = null;
  const levelOutlines: P2[][][] = [];
  const topLevelIndex = plan.levels.length - 1;
  let prevStairHoles: P2[][] = [];
  // Railings around stairwells, created on the level above the stair.
  type Rail = { points: P2[]; style: 'glass' | 'bars' | 'cable' | 'solid' };
  let railingsHere: Rail[] = [];
  let railingsNext: Rail[] = [];
  let maxY = elevation;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  for (let li = 0; li < plan.levels.length; li++) {
    const lvl = plan.levels[li] as PlanLevel;
    const lid = `${bid}-l${li}`;
    const height = lvl.height;
    const ceiling = round(height - FLOOR_THICKNESS - 0.004);
    const top = li === topLevelIndex;
    add({ id: lid, parent: bid, name: lvl.name ?? (li === 0 ? 'Ground floor' : `Floor ${li}`), transform: { position: [0, round(elevation), 0] }, arch: { role: 'level', name: lvl.name ?? (li === 0 ? 'Ground floor' : `Floor ${li}`), level: li, height } });
    const indoor = lvl.rooms.filter((r) => r.type !== 'terrace');
    const polys = new Map<string, P2[]>();
    for (const r of lvl.rooms) polys.set(r.id, simplifyPolygon(roomPolygon(r)));
    // --- walls ------------------------------------------------------------
    const network = wallNetwork(indoor.map((r) => ({ id: r.id, polygon: polys.get(r.id) as P2[], split: r.finish !== undefined || r.walls !== undefined || r.dado !== undefined })));
    const thick = (w: NetworkWall): number => (w.exterior ? plan.exteriorWall.thickness : plan.interiorWall.thickness);
    const joins = solveWallJoins(network.map((w, k) => ({ id: `w${k}`, a: w.a, b: w.b, thickness: thick(w) })));
    const walls: WallRec[] = network.map((w, k) => {
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      return { id: `${lid}-w${k}`, w, thickness: thick(w), openings: [], len, dir: [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len] };
    });
    if (li === 0) groundPlan = { walls, polys };
    const wallAt = (p: P2, tol = 0.03): { rec: WallRec; t: number } | null => {
      for (const rec of walls) {
        const t = (p[0] - rec.w.a[0]) * rec.dir[0] + (p[1] - rec.w.a[1]) * rec.dir[1];
        const off = -(p[0] - rec.w.a[0]) * rec.dir[1] + (p[1] - rec.w.a[1]) * rec.dir[0];
        if (t >= -tol && t <= rec.len + tol && Math.abs(off) <= tol) return { rec, t };
      }
      return null;
    };
    const free = (rec: WallRec, t0: number, t1: number): boolean => t0 >= 0.25 && t1 <= rec.len - 0.25 && rec.openings.every((o) => t1 + 0.15 <= o.offset - o.width / 2 || t0 - 0.15 >= o.offset + o.width / 2);

    // --- doors ------------------------------------------------------------
    const roomDoors = new Map<string, RoomDoor[]>();
    const roomWindows = new Map<string, RoomWindow[]>();
    const pushRoomDoor = (roomId: string, p: P2, width: number, swingsIn: boolean, hingePoint: P2): void => {
      const poly = polys.get(roomId);
      if (!poly) return;
      const edges = roomEdges(poly);
      const ei = edges.findIndex((e) => {
        const off = (p[0] - e.a[0]) * e.out[0] + (p[1] - e.a[1]) * e.out[1];
        const t = (p[0] - e.a[0]) * e.dir[0] + (p[1] - e.a[1]) * e.dir[1];
        return Math.abs(off) < 0.03 && t > 0 && t < e.length;
      });
      if (ei < 0) return;
      const e = edges[ei] as RoomEdge;
      const t = (p[0] - e.a[0]) * e.dir[0] + (p[1] - e.a[1]) * e.dir[1];
      const ht = (hingePoint[0] - e.a[0]) * e.dir[0] + (hingePoint[1] - e.a[1]) * e.dir[1];
      const list = roomDoors.get(roomId) ?? [];
      list.push({ edge: ei, t, width, swingsIn, hinge: ht < t ? -1 : 1 });
      roomDoors.set(roomId, list);
    };
    let doorN = 0;
    const roomType = (id: string): RoomType | 'outside' => (id === 'outside' ? 'outside' : (lvl.rooms.find((r) => r.id === id)?.type ?? 'living'));
    for (const d of lvl.doors) {
      const [ra, rb] = d.between;
      let span: EdgeSpan | undefined;
      if (ra === 'outside' || rb === 'outside') {
        const inner = ra === 'outside' ? rb : ra;
        const poly = polys.get(inner);
        if (!poly) {
          notes.push(`door ${ra}↔${rb}: room "${inner}" not found on level ${li}`);
          continue;
        }
        const others = indoor.filter((r) => r.id !== inner).map((r) => polys.get(r.id) as P2[]);
        const spans = exteriorSpans(poly, others, d.side);
        span = spans.find((s) => s.t1 - s.t0 >= d.width + 0.5) ?? spans[0];
      } else {
        const pa = polys.get(ra);
        const pb = polys.get(rb);
        if (!pa || !pb) {
          notes.push(`door ${ra}↔${rb}: room not found on level ${li}`);
          continue;
        }
        span = sharedSpans(pa, pb).find((s) => s.t1 - s.t0 >= d.width + 0.3) ?? sharedSpans(pa, pb)[0];
      }
      if (!span) {
        notes.push(`door ${ra}↔${rb}: the rooms do not share a wall`);
        continue;
      }
      const width = Math.min(d.width, span.t1 - span.t0 - 0.3);
      if (width < 0.6) {
        notes.push(`door ${ra}↔${rb}: shared wall too short for a door`);
        continue;
      }
      const tCentre = d.along !== undefined ? Math.max(span.t0 + 0.15 + width / 2, Math.min(span.t1 - 0.15 - width / 2, d.along)) : span.t0 + 0.15 + width / 2 + (span.t1 - span.t0 - 0.3 - width) * d.at;
      const c = edgePoint(span.edge, tCentre);
      const hit = wallAt(c);
      if (!hit) {
        notes.push(`door ${ra}↔${rb}: no wall at the shared edge`);
        continue;
      }
      const { rec, t } = hit;
      if (!free(rec, t - width / 2, t + width / 2)) {
        // Slide along the wall to the nearest free spot.
        let placed = false;
        for (let step = 0.1; step < rec.len && !placed; step += 0.1) {
          for (const s of [t + step, t - step]) {
            if (free(rec, s - width / 2, s + width / 2) && s - width / 2 >= Math.max(0, (span.t0 - tCentre) + t) && s + width / 2 <= (span.t1 - tCentre) + t) {
              addDoor(rec, s, width, d, ra, rb);
              placed = true;
              break;
            }
          }
        }
        if (!placed) notes.push(`door ${ra}↔${rb}: no free spot on the shared wall`);
        continue;
      }
      addDoor(rec, t, width, d, ra, rb);
    }

    /**
     * Side of wall `rec` (1 = side B, the left of a→b; -1 = side A) on which room `roomId` lies at
     * point `c`. Sampled geometrically: merged collinear walls run past several rooms, so their
     * stored `roomA` / `roomB` only name the rooms at one end.
     */
    function roomSide(rec: WallRec, c: P2, roomId: string): 1 | -1 | 0 {
      const poly = polys.get(roomId);
      if (poly) {
        const nx = -rec.dir[1];
        const nz = rec.dir[0];
        const off = rec.thickness / 2 + 0.05;
        if (pointInPolygon(c[0] + nx * off, c[1] + nz * off, poly)) return 1;
        if (pointInPolygon(c[0] - nx * off, c[1] - nz * off, poly)) return -1;
      }
      return rec.w.roomB === roomId ? 1 : rec.w.roomA === roomId ? -1 : 0;
    }

    function addDoor(rec: WallRec, t: number, width: number, d: PlanDoor, ra: string, rb: string): void {
      const kind = d.kind === 'opening' ? 'opening' : 'door';
      const height = Math.min(d.height, ceiling - 0.1);
      rec.openings.push({ kind, offset: round(t), width: round(width), height: round(height), sill: 0 });
      const n = doorN++;
      const yaw = round(yawOf(rec.dir[0], rec.dir[1]), 100);
      const c: P2 = [rec.w.a[0] + rec.dir[0] * t, rec.w.a[1] + rec.dir[1] * t];
      const fid = `${lid}-d${n}`;
      const name = d.main ? 'Front door' : `Door ${NAMES[roomType(ra) as RoomType] ?? 'outside'} / ${roomType(rb) === 'outside' ? 'outside' : (NAMES[roomType(rb) as RoomType] ?? rb)}`;
      add({ id: fid, parent: lid, name, transform: { position: [round(c[0]), 0, round(c[1])], rotation: [0, yaw, 0] }, shape: { kind: 'procedural', generator: 'arch-frame', params: { width: round(width), height: round(height), wallThickness: rec.thickness, finish: { finish: 'paint', color: pal.doorColor } } }, arch: { role: 'opening', wall: rec.id, kind }, tags: d.main ? ['arch', 'entrance'] : ['arch'] });
      // Which side does each room lie on? Side B is the left of a→b (+Z local).
      const sideOf = (roomId: string): 1 | -1 | 0 => (roomId === 'outside' ? 0 : roomSide(rec, c, roomId));
      let sa = sideOf(ra);
      let sb = sideOf(rb);
      if (sa === 0 && sb !== 0) sa = (-sb) as 1 | -1;
      if (sb === 0 && sa !== 0) sb = (-sa) as 1 | -1;
      if (kind === 'opening') {
        for (const r of [ra, rb]) if (r !== 'outside') pushRoomDoor(r, c, width, false, c);
        if (d.main) setSpawn(c, rec, sa === 0 ? sb : sa, ra === 'outside' ? rb : ra);
        return;
      }
      // Swing into the more private room (bedrooms, bathrooms, offices), or inward from outside.
      const privacy = (r: string): number => {
        const ty = roomType(r);
        if (ty === 'outside') return -1;
        return ty === 'bathroom' ? 5 : ty === 'bedroom' || ty === 'kids' ? 4 : ty === 'office' || ty === 'storage' || ty === 'laundry' ? 3 : ty === 'hall' || ty === 'entry' || ty === 'lobby' ? 0 : 1;
      };
      const into = privacy(ra) >= privacy(rb) ? ra : rb;
      const side: 1 | -1 = (into === ra ? sa : sb) === 1 ? 1 : -1;
      const leafW = round(width - 2 * LINING - 2 * DOOR_CLEARANCE);
      const leafH = round(height - LINING - 0.006);
      const hinge: 'left' | 'right' = n % 2 === 0 ? 'left' : 'right';
      // Leaf sits on the swing-side face of the lining (stops flush with the wall face).
      const zOff = side * (rec.thickness / 2 - 0.03);
      const lc = rotateYaw(0, zOff, yaw);
      const style = d.style ?? (d.main ? (plan.style === 'industrial' ? 'slab' : 'panel') : d.kind === 'sliding' ? 'glass' : pal.door);
      const leafId = `${fid}-leaf`;
      const door: EntityInput = {
        id: leafId,
        parent: lid,
        name: d.main ? 'Front door leaf' : 'Door leaf',
        transform: { position: [round(c[0] + lc[0]), 0.003, round(c[1] + lc[1])], rotation: [0, yaw, 0] },
        shape: { kind: 'procedural', generator: 'arch-door', params: { width: leafW, height: leafH, style, finish: d.main ? { finish: plan.style === 'scandinavian' ? 'ash' : 'walnut' } : { finish: 'paint', color: pal.doorColor }, hardware: { finish: pal.metal === 'brass' ? 'brass' : pal.metal === 'chrome' ? 'chrome' : 'brushed-metal' }, handle: hinge === 'left' ? 'right' : 'left' } },
        physics: { body: 'kinematic', collider: 'auto' },
        arch: { role: 'door', wall: rec.id, kind: d.kind, room: into === 'outside' ? undefined : `${lid}-${into}` },
        tags: d.main ? ['arch', 'door', 'entrance'] : ['arch', 'door'],
        interact: { kind: 'door', label: d.main ? 'front door' : d.kind === 'sliding' ? 'sliding door' : 'door', reach: 2.6 },
        state: { open: false },
      };
      if (d.kind === 'sliding') {
        const slide = rotateYaw(-leafW * 0.95, 0, yaw + plan.rotation);
        door.behaviors = [{ type: 'door', params: { trigger: 'key', key: 'e', radius: 1.8, motion: 'slide', slide: [round(slide[0]), 0, round(slide[1])], duration: 0.9 } }];
      } else {
        // Positive swing turns local +X toward −Z: a left-hinged leaf swings into side B with a negative angle.
        const angle = (hinge === 'left' ? -1 : 1) * 92 * side;
        if (d.physical ?? plan.physicalDoors) {
          // A real hinge: the leaf is a dynamic body on a revolute joint to the world (axis up, at the hinge edge, limited
          // to its swing), held shut by a spring motor; the door behavior servos it open and shut, the solver does the rest.
          door.physics = { body: 'dynamic', collider: 'auto', mass: 18, friction: 0.5, restitution: 0, angularDamping: 2, linearDamping: 1 };
          door.joint = {
            type: 'revolute',
            target: 'world',
            anchor: [round((hinge === 'left' ? -1 : 1) * (leafW / 2)), 0, 0],
            targetAnchor: [0, 0, 0],
            axis: [0, 1, 0],
            limits: [Math.min(0, angle), Math.max(0, angle)],
            motor: { targetVelocity: 0, targetPosition: 0, stiffness: 60, damping: 12, maxForce: 400 },
          };
          door.behaviors = [{ type: 'door', params: { trigger: 'key', key: 'e', radius: 1.8, motion: 'joint', jointOpen: angle, swingAngle: angle, hinge, duration: 0.85 } }];
        } else door.behaviors = [{ type: 'door', params: { trigger: 'key', key: 'e', radius: 1.8, motion: 'swing', swingAngle: angle, hinge, duration: 0.85 } }];
      }
      add(door);
      const hingeP: P2 = [c[0] + rec.dir[0] * (hinge === 'left' ? -leafW / 2 : leafW / 2), c[1] + rec.dir[1] * (hinge === 'left' ? -leafW / 2 : leafW / 2)];
      for (const r of [ra, rb]) if (r !== 'outside') pushRoomDoor(r, c, width, d.kind !== 'sliding' && r === into, hingeP);
      if (d.main) setSpawn(c, rec, into === ra ? sb : sa, ra === 'outside' ? rb : ra);
    }

    function setSpawn(c: P2, rec: WallRec, outsideSide: number, inner: string): void {
      if (li !== 0 || spawnLocal) return;
      const s = outsideSide === 0 ? -1 : outsideSide;
      const n: P2 = [-rec.dir[1] * s, rec.dir[0] * s];
      entry = { c, n, room: inner };
      spawnLocal = [c[0] + n[0] * 2.2, c[1] + n[1] * 2.2];
      // Face the door.
      spawnYaw = (Math.atan2(-n[0], -n[1]) * 180) / Math.PI;
    }

    // --- windows ----------------------------------------------------------
    let winN = 0;
    const placeWindow = (roomId: string, rec: WallRec, t: number, width: number, height: number, sill: number, style: string, daylight?: string): boolean => {
      if (!free(rec, t - width / 2, t + width / 2)) return false;
      rec.openings.push({ kind: 'window', offset: round(t), width: round(width), height: round(height), sill: round(sill) });
      const yaw = round(yawOf(rec.dir[0], rec.dir[1]), 100);
      const c: P2 = [rec.w.a[0] + rec.dir[0] * t, rec.w.a[1] + rec.dir[1] * t];
      const interior = roomSide(rec, c, roomId) === 1 ? 'b' : 'a';
      const frosted = roomType(roomId) === 'bathroom';
      // Plain casement windows open: the casement is a child entity that swings inward on its left hinge.
      const openable = style === 'casement' && !frosted && width <= 1.8 && width >= 0.6 && height >= 0.7;
      const winId = `${lid}-win${winN++}`;
      add({ id: winId, parent: lid, name: 'Window', transform: { position: [round(c[0]), round(sill), round(c[1])], rotation: [0, yaw, 0] }, shape: { kind: 'procedural', generator: 'arch-window', params: { width: round(width), height: round(height), wallThickness: rec.thickness, style, interior, frame: pal.windowFrame, glass: { finish: frosted ? 'frosted-glass' : 'glass' }, sillMaterial: { finish: plan.style === 'classic' || plan.style === 'modern' ? 'marble' : 'oak' }, ...(openable ? { sash: true } : {}), ...(daylight ? { daylight } : {}) } }, physics: { body: 'static', collider: 'auto' }, arch: { role: 'window', wall: rec.id, room: `${lid}-${roomId}` }, tags: ['arch', 'window'] });
      if (openable) {
        const fw = 0.055;
        const sashW = round(width - 2 * fw);
        const sashH = round(sashHeight(height));
        // Inward = toward the indoor side of the wall (local −Z when side A is indoors): a positive yaw turns +X toward −Z.
        const angle = interior === 'b' ? -78 : 78;
        add({
          id: `${winId}-sash`,
          parent: winId,
          name: 'Window casement',
          transform: { position: [0, fw, interior === 'b' ? 0.02 : -0.02] },
          shape: { kind: 'procedural', generator: 'arch-sash', params: { width: sashW, height: sashH, frame: pal.windowFrame, glass: { finish: 'glass' } } },
          physics: { body: 'kinematic', collider: 'auto' },
          behaviors: [{ type: 'operable', params: { trigger: 'use', motion: 'swing', swingAngle: angle, hinge: 'left', duration: 0.9 } }],
          state: { open: false },
          interact: { kind: 'window', label: 'window', reach: 2.4 },
          arch: { role: 'part', kind: 'sash', room: `${lid}-${roomId}`, name: 'Window casement' },
          tags: ['arch', 'part'],
        });
      }
      const poly = polys.get(roomId);
      if (poly) {
        const edges = roomEdges(poly);
        const ei = edges.findIndex((e) => Math.abs((c[0] - e.a[0]) * e.out[0] + (c[1] - e.a[1]) * e.out[1]) < 0.03);
        if (ei >= 0) {
          const e = edges[ei] as RoomEdge;
          const te = (c[0] - e.a[0]) * e.dir[0] + (c[1] - e.a[1]) * e.dir[1];
          const list = roomWindows.get(roomId) ?? [];
          list.push({ edge: ei, t0: te - width / 2, t1: te + width / 2, sill, height });
          roomWindows.set(roomId, list);
        }
      }
      return true;
    };
    for (const w of lvl.windows) {
      const poly = polys.get(w.room);
      if (!poly) {
        notes.push(`windows: room "${w.room}" not found on level ${li}`);
        continue;
      }
      const others = indoor.filter((r) => r.id !== w.room).map((r) => polys.get(r.id) as P2[]);
      const span = exteriorSpans(poly, others, w.side)[0];
      if (!span) {
        notes.push(`windows: room ${w.room} has no exterior wall facing ${w.side}`);
        continue;
      }
      const height = Math.min(w.height, ceiling - w.sill - 0.15);
      if (w.centres) {
        // Exact positions: each centre on the exterior span (of that side) that contains it.
        const spans = exteriorSpans(poly, others, w.side);
        for (const c of w.centres) {
          const sp = spans.find((s) => c >= s.t0 - 1e-6 && c <= s.t1 + 1e-6);
          const hit = sp ? wallAt(edgePoint(sp.edge, c)) : null;
          if (!hit) {
            notes.push(`window of ${w.room} at ${c} m on the ${w.side} wall: no exterior wall there`);
            continue;
          }
          if (!placeWindow(w.room, hit.rec, hit.t, w.width, height, w.sill, w.style ?? defaultWindowStyle(plan.style), w.daylight)) notes.push(`window of ${w.room} at ${c} m on the ${w.side} wall: overlaps another opening or the wall end`);
        }
        continue;
      }
      const len = span.t1 - span.t0;
      const n = Math.max(1, Math.min(w.count, Math.floor((len - 0.4) / (w.width + 0.4))));
      for (let k = 0; k < n; k++) {
        const t = span.t0 + (len * (k + 0.5)) / n;
        const hit = wallAt(edgePoint(span.edge, t));
        if (hit) placeWindow(w.room, hit.rec, hit.t, w.width, height, w.sill, w.style ?? defaultWindowStyle(plan.style), w.daylight);
      }
    }
    if (lvl.autoWindows) {
      for (const r of indoor) {
        if (!habitable(r.type) || lvl.windows.some((w) => w.room === r.id)) continue;
        const poly = polys.get(r.id) as P2[];
        const others = indoor.filter((o) => o.id !== r.id).map((o) => polys.get(o.id) as P2[]);
        for (const span of exteriorSpans(poly, others).slice(0, r.type === 'bathroom' ? 1 : 3)) {
          const len = span.t1 - span.t0;
          if (len < 1.2) continue;
          const big = r.type === 'living' || r.type === 'dining' || r.type === 'cafe' || r.type === 'lobby' || r.type === 'open-office' || r.type === 'meeting';
          const spec = r.type === 'bathroom' ? { w: 0.7, h: 0.7, sill: 1.5, style: 'fixed' } : big ? { w: Math.min(3.2, len * 0.55), h: ceiling - 0.45, sill: 0.25, style: plan.style === 'classic' ? 'grid' : 'picture' } : r.type === 'kitchen' ? { w: 1.2, h: 1.0, sill: 1.15, style: 'casement' } : { w: 1.3, h: 1.45, sill: 0.85, style: defaultWindowStyle(plan.style) };
          const n = Math.max(1, Math.min(3, Math.floor((len - 0.5) / (spec.w + 0.9))));
          for (let k = 0; k < n; k++) {
            const t = span.t0 + (len * (k + 0.5)) / n;
            const hit = wallAt(edgePoint(span.edge, t));
            if (hit) placeWindow(r.id, hit.rec, hit.t, spec.w, Math.min(spec.h, ceiling - spec.sill - 0.12), spec.sill, spec.style);
          }
        }
      }
    }

    // Emit walls (openings known now).
    for (const rec of walls) {
      const j = joins.get(`w${walls.indexOf(rec)}`) ?? { startA: 0, startB: 0, endA: 0, endB: 0 };
      const roomA = rec.w.roomA ? lvl.rooms.find((r) => r.id === rec.w.roomA) : undefined;
      const roomB = rec.w.roomB ? lvl.rooms.find((r) => r.id === rec.w.roomB) : undefined;
      // Compass side of the wall seen from inside a room: the room lies on side B (+n) or side A (−n) of the wall.
      const sideFinish = (room: PlanRoom | undefined, side: 1 | -1): MaterialSpec => {
        if (!room) return plan.exteriorWall.finish;
        const compass = compassOf(-side * -rec.dir[1], -side * rec.dir[0]);
        return wallFinish(room, pal, compass);
      };
      const sideDado = (room: PlanRoom | undefined): Record<string, Json> | undefined => (room?.dado ? (room.dado as unknown as Record<string, Json>) : undefined);
      const dadoA = sideDado(roomA);
      const dadoB = sideDado(roomB);
      const skirting = roomA && roomB ? 'both' : roomA ? 'a' : roomB ? 'b' : 'none';
      const yaw = round(yawOf(rec.dir[0], rec.dir[1]), 100);
      add({
        id: rec.id,
        parent: lid,
        name: rec.w.exterior ? 'Exterior wall' : 'Wall',
        transform: { position: [round(rec.w.a[0]), 0, round(rec.w.a[1])], rotation: [0, yaw, 0] },
        shape: { kind: 'procedural', generator: 'arch-wall', params: { length: round(rec.len), height: round(top ? height - 0.004 : height - 0.004), thickness: rec.thickness, startA: j.startA, startB: j.startB, endA: j.endA, endB: j.endB, openings: rec.openings.sort((p, q) => p.offset - q.offset), finishA: sideFinish(roomA, -1), finishB: sideFinish(roomB, 1), ...(dadoA ? { dadoA } : {}), ...(dadoB ? { dadoB } : {}), skirting, skirtingMaterial: { finish: 'paint', color: plan.style === 'industrial' ? '#2f3033' : '#f2f0eb' } } as unknown as Record<string, Json> },
        physics: { body: 'static', collider: 'auto' },
        arch: { role: 'wall', ...(rec.w.exterior ? { kind: 'exterior' } : { kind: 'interior' }) },
        tags: rec.w.exterior ? ['arch', 'wall', 'exterior'] : ['arch', 'wall'],
      });
    }

    // --- floors, ceilings, furniture ---------------------------------------
    const holesHere = prevStairHoles;
    for (const r of lvl.rooms) {
      const poly = polys.get(r.id) as P2[];
      const rid = `${lid}-${r.id}`;
      const name = r.name ?? NAMES[r.type];
      const floor = r.floor ?? floorFor(plan.style, r.type);
      const holes = holesHere.filter((h) => pointInPolygon(centroid(h)[0], centroid(h)[1], poly));
      const terrace = r.type === 'terrace';
      add({
        id: rid,
        parent: lid,
        name,
        shape: { kind: 'procedural', generator: 'arch-slab', params: { polygon: poly.map((p) => [round(p[0]), round(p[1])]), holes: holes.map((h) => h.map((p) => [round(p[0]), round(p[1])])), thickness: li === 0 ? round(plan.plinth + 0.02) : FLOOR_THICKNESS, finish: floor, edge: li === 0 ? { finish: 'concrete', color: '#b8b3ab' } : { finish: 'plaster', color: '#e9e6e0' }, bottom: li > 0 } as unknown as Record<string, Json> },
        physics: { body: 'static', collider: 'auto' },
        arch: { role: 'room', name, kind: r.type },
        tags: ['arch', 'room'],
      });
      const areaM2 = Math.abs(polyArea(poly)) - holes.reduce((s, h) => s + Math.abs(polyArea(h)), 0);
      roomsOut.push({ id: rid, level: li, name, type: r.type, area: Math.round(areaM2 * 10) / 10 });
      if (!terrace) add({ id: `${rid}-ceil`, parent: lid, name: `${name} ceiling`, transform: { position: [0, ceiling, 0] }, shape: { kind: 'procedural', generator: 'arch-ceiling', params: { polygon: poly.map((p) => [round(p[0]), round(p[1])]), holes: [], finish: { finish: 'paint', color: '#f4f2ee' }, ...(r.vault && isAxisRectangle(poly) ? { vault: r.vault } : {}), cove: r.type === 'living' && plan.style !== 'industrial' && isAxisRectangle(poly) ? 0.08 : 0, downlights: downlightGrid(poly, r.type, plan.style).map((q) => [round(q[0]), round(q[1])]) } as unknown as Record<string, Json> }, arch: { role: 'ceiling', room: rid }, tags: ['arch', 'ceiling'], castShadow: false });
      // Furniture.
      const ctx: RoomContext = {
        id: rid,
        type: r.type,
        name,
        polygon: positive(poly),
        edges: roomEdges(positive(poly)),
        inset: roomEdges(positive(poly)).map((e) => insetFor(e, walls)),
        doors: roomDoors.get(r.id) ?? [],
        windows: roomWindows.get(r.id) ?? [],
        ceiling,
        style: plan.style,
        palette: pal,
        seed: (seed + li * 131 + hashId(r.id)) >>> 0,
        omit: new Set(r.omit),
      };
      // Stairs on this level keep their footprint clear.
      const stairBlock = lvl.stairs.map((s) => stairWorldFootprint(s, lvl.height)).filter((f) => pointInPolygon(centroid(f)[0], centroid(f)[1], poly));
      const holeBlock = holes;
      const { placed, notes: fn } = furnishRoom(ctx, r.items, r.furnish);
      notes.push(...fn);
      let n = 0;
      for (const p of placed) {
        if (p.def.mount === 'floor' && [...stairBlock, ...holeBlock].some((b) => p.footprint.some((q) => pointInPolygon(q[0], q[1], b)) || pointInPolygon(p.x, p.z, b))) continue;
        const e = placedEntity(p, `${rid}-f${n++}`, lid, rid, li, lights < MAX_BUILDING_LIGHTS);
        if (e.light) lights++;
        add(e);
        for (const part of placedParts(p, e.id, rid, li, plan.rotation)) add(part);
      }
    }

    // --- stairs (+ holes & railings on the next level) ----------------------
    const nextHoles: P2[][] = [];
    lvl.stairs.forEach((s, si) => {
      if (li === plan.levels.length - 1) {
        notes.push(`stair on the top level ${li} leads nowhere — add a level above or remove it`);
        return;
      }
      const sp = StairParams.parse({ shape: s.shape, width: s.width, rise: height, turn: s.turn, finish: floorFor(plan.style, 'living'), rail: 'right', railMaterial: { finish: pal.metal === 'brass' ? 'brass' : 'black-metal' } });
      const yaw = headingYaw(s.heading);
      add({ id: `${lid}-stair${si}`, parent: lid, name: 'Stair', transform: { position: [round(s.at[0]), 0, round(s.at[1])], rotation: [0, yaw, 0] }, shape: { kind: 'procedural', generator: 'arch-stair', params: sp as unknown as Record<string, Json> }, physics: { body: 'static', collider: 'auto' }, arch: { role: 'stair' }, tags: ['arch', 'stair'] });
      const fp = stairWorldFootprint(s, height);
      nextHoles.push(fp);
      // Railing around the stairwell above (all sides but the arrival edge).
      const { flights } = stairLayout(sp);
      const last = flights[flights.length - 1];
      if (last) {
        const arrive = rotateYaw(last.dx, last.dz, yaw);
        const pts = fp.slice();
        // Find the edge whose outward normal matches the arrival direction and leave it open.
        const edges = roomEdges(positive(pts));
        const open = edges.findIndex((e) => e.out[0] * arrive[0] + e.out[1] * arrive[1] > 0.9);
        if (open >= 0) {
          const ring = positive(pts);
          const start = (open + 1) % ring.length;
          const chain: P2[] = [];
          for (let k = 0; k <= ring.length - 1; k++) chain.push(ring[(start + k) % ring.length] as P2);
          railingsNext.push({ points: chain, style: 'glass' });
        }
      }
    });
    prevStairHoles = nextHoles;

    // Railings declared on this level, and those carried from the stair below.
    const rails = [...lvl.railings, ...railingsHere];
    rails.forEach((r, ri) => {
      add({ id: `${lid}-rail${ri}`, parent: lid, name: 'Railing', shape: { kind: 'procedural', generator: 'arch-railing', params: { points: r.points.map((p) => [round(p[0]), round(p[1])]), style: r.style, finish: { finish: pal.metal === 'brass' ? 'brass' : 'black-metal' } } as unknown as Record<string, Json> }, physics: { body: 'static', collider: 'auto' }, arch: { role: 'railing' }, tags: ['arch'] });
    });
    railingsHere = railingsNext;
    railingsNext = [];

    // Outline for roofs and terraces.
    const loops = outlineLoops(network);
    levelOutlines.push(loops);
    for (const loop of loops) {
      const [x0, z0, x1, z1] = bounds(loop);
      minX = Math.min(minX, x0);
      minZ = Math.min(minZ, z0);
      maxX = Math.max(maxX, x1);
      maxZ = Math.max(maxZ, z1);
    }
    // Roof plates over parts of this level not covered by the next one.
    if (!top) {
      const above = plan.levels[li + 1] as PlanLevel;
      const abovePolys = above.rooms.filter((r) => r.type !== 'terrace').map((r) => simplifyPolygon(roomPolygon(r)));
      let k = 0;
      for (const r of indoor) {
        const poly = polys.get(r.id) as P2[];
        const c = interiorPoint(poly);
        if (abovePolys.some((p) => pointInPolygon(c[0], c[1], p))) continue;
        add({ id: `${lid}-terr${k++}`, parent: lid, name: 'Roof terrace', transform: { position: [0, round(height), 0] }, shape: { kind: 'procedural', generator: 'arch-slab', params: { polygon: offsetPolygon(positive(poly), 0.02).map((p) => [round(p[0]), round(p[1])]), thickness: FLOOR_THICKNESS, finish: { finish: 'decking' }, edge: { finish: 'plaster', color: '#ece9e3' }, bottom: false } as unknown as Record<string, Json> }, physics: { body: 'static', collider: 'auto' }, arch: { role: 'roof', kind: 'terrace' }, tags: ['arch', 'roof'] });
      }
    }
    elevation += height;
    maxY = elevation;
  }

  // --- roof -----------------------------------------------------------------
  const topIndex = plan.levels.length - 1;
  const topLevelId = `${bid}-l${topIndex}`;
  const topHeight = (plan.levels[topIndex] as PlanLevel).height;
  const topLoops = levelOutlines[topIndex] ?? [];
  const ext = plan.exteriorWall.thickness / 2;
  const roofFinish = plan.roof.finish ?? pal.roof;
  const rectangular = topLoops.length === 1 && isAxisRectangle(topLoops[0] as P2[]);
  if (plan.roof.shape !== 'flat' && rectangular) {
    const [x0, z0, x1, z1] = bounds(topLoops[0] as P2[]);
    const width = x1 - x0 + 2 * ext;
    const depth = z1 - z0 + 2 * ext;
    add({ id: `${bid}-roof`, parent: topLevelId, name: 'Roof', transform: { position: [round((x0 + x1) / 2), round(topHeight), round((z0 + z1) / 2)] }, shape: { kind: 'procedural', generator: 'arch-roof', params: { shape: plan.roof.shape, width: round(width), depth: round(depth), pitch: plan.roof.pitch, overhang: plan.roof.overhang, ridgeAlongX: width >= depth, finish: roofFinish, gableWall: plan.exteriorWall.finish } as unknown as Record<string, Json> }, physics: { body: 'static', collider: 'auto' }, arch: { role: 'roof' }, tags: ['arch', 'roof'] });
    maxY += roofRise({ shape: plan.roof.shape, width, depth, pitch: plan.roof.pitch, ridgeAlongX: width >= depth }) + 0.3;
  } else {
    if (plan.roof.shape !== 'flat') notes.push('pitched roofs need a rectangular top floor; used a flat roof');
    // Loops inside another loop are courtyards: the roof plate stops at them (with the same overhang) instead of covering them.
    const insideOther = (loop: P2[]): boolean => topLoops.some((o) => o !== loop && polyArea(o) > polyArea(loop) && loop.every((q) => pointInPolygon(q[0], q[1], o) || pointOnBoundary(q, o)));
    const solid = topLoops.filter((l) => !insideOther(l));
    const voids = topLoops.filter((l) => insideOther(l));
    solid.forEach((loop, k) => {
      const outline = offsetPolygon(loop, ext + 0.12);
      const holes = voids.filter((v) => v.every((q) => pointInPolygon(q[0], q[1], loop) || pointOnBoundary(q, loop))).map((v) => offsetPolygon(v, -(ext + 0.12)).map((q) => [round(q[0]), round(q[1])]));
      add({ id: `${bid}-roof${k === 0 ? '' : k}`, parent: topLevelId, name: 'Roof', transform: { position: [0, round(topHeight + 0.25), 0] }, shape: { kind: 'procedural', generator: 'arch-slab', params: { polygon: outline.map((p) => [round(p[0]), round(p[1])]), holes, thickness: 0.28, finish: { finish: 'gravel', color: '#9d968b' }, edge: { finish: 'plaster', color: '#f0eee9' }, bottom: true } as unknown as Record<string, Json> }, physics: { body: 'static', collider: 'auto' }, arch: { role: 'roof', kind: 'flat' }, tags: ['arch', 'roof'] });
      // Parapet as a thin railing-like solid band (round the outside and round every courtyard).
      const rings: P2[][] = [outline, ...holes.map((h) => h as P2[])];
      rings.forEach((ring, ri) => {
        add({ id: `${bid}-parapet${k === 0 && ri === 0 ? '' : `${k}-${ri}`}`, parent: topLevelId, name: 'Parapet', transform: { position: [0, round(topHeight + 0.25), 0] }, shape: { kind: 'procedural', generator: 'arch-railing', params: { points: [...ring, ring[0] as P2].map((p) => [round(p[0]), round(p[1])]), height: 0.35, style: 'solid', finish: { finish: 'plaster', color: '#f0eee9' } } as unknown as Record<string, Json> }, arch: { role: 'roof', kind: 'parapet' }, tags: ['arch', 'roof'] });
      });
    });
    maxY += 0.7;
  }

  // --- site: terrace and pool ------------------------------------------------
  if (plan.site?.terrace) {
    const site = plan.site;
    const terrace = positive(site.terrace as P2[]);
    const holes: P2[][] = [];
    if (site.pool) {
      const [px, pz] = site.pool.at;
      holes.push([
        [px - site.pool.width / 2 - 0.3, pz - site.pool.length / 2 - 0.3],
        [px + site.pool.width / 2 + 0.3, pz - site.pool.length / 2 - 0.3],
        [px + site.pool.width / 2 + 0.3, pz + site.pool.length / 2 + 0.3],
        [px - site.pool.width / 2 - 0.3, pz + site.pool.length / 2 + 0.3],
      ]);
    }
    add({ id: `${bid}-terrace`, parent: bid, name: 'Terrace', transform: { position: [0, round(plan.plinth - 0.03), 0] }, shape: { kind: 'procedural', generator: 'arch-slab', params: { polygon: terrace.map((p) => [round(p[0]), round(p[1])]), holes: holes.map((h) => h.map((p) => [round(p[0]), round(p[1])])), thickness: round(plan.plinth - 0.03 + 0.05), finish: site.terraceFinish, edge: { finish: 'stone', color: '#cfc8ba' } } as unknown as Record<string, Json> }, physics: { body: 'static', collider: 'auto' }, arch: { role: 'site', kind: 'terrace', name: 'Terrace' }, tags: ['arch', 'site'] });
    if (site.pool) {
      add({ id: `${bid}-pool`, parent: bid, name: 'Pool', transform: { position: [round(site.pool.at[0]), round(plan.plinth - 0.03), round(site.pool.at[1])] }, shape: { kind: 'procedural', generator: 'arch-basin', params: { width: site.pool.width, length: site.pool.length, depth: 1.4, freeboard: poolFreeboard(plan.plinth) } }, physics: { body: 'static', collider: 'auto' }, arch: { role: 'pool', name: 'Pool' }, tags: ['arch', 'pool'] });
      // Loungers along the long side.
      for (let k = 0; k < 3; k++) {
        const x = site.pool.at[0] - site.pool.width / 2 + 1 + k * 1.1;
        const z = site.pool.at[1] + site.pool.length / 2 + 1.3;
        add({ id: `${bid}-lounger${k}`, parent: bid, name: 'Lounger', transform: { position: [round(x), round(plan.plinth + 0.02), round(z)], rotation: [0, 0, 0] }, shape: { kind: 'procedural', generator: 'furn-armchair', params: { width: 0.7, upholstery: 'fabric', color: '#efebe4', legs: 'oak' } }, physics: { body: 'static', collider: 'auto' }, arch: { role: 'furniture', kind: 'armchair', name: 'Lounger' }, tags: ['arch', 'furniture'] });
      }
    }
    if (site.planting) {
      const [x0, z0, x1, z1] = bounds(terrace);
      const spots: P2[] = [
        [x0 + 0.5, z0 + 0.5],
        [x1 - 0.5, z0 + 0.5],
        [x1 - 0.5, z1 - 0.5],
        [x0 + 0.5, z1 - 0.5],
      ];
      spots.forEach((p, k) => {
        if (topLoops.some((loop) => pointInPolygon(p[0], p[1], offsetPolygon(loop, ext + 0.4))) || levelOutlines[0]?.some((loop) => pointInPolygon(p[0], p[1], offsetPolygon(loop, ext + 0.4)))) return;
        add({ id: `${bid}-planter${k}`, parent: bid, name: 'Olive tree', transform: { position: [round(p[0]), round(plan.plinth + 0.02), round(p[1])], rotation: [0, k * 47, 0] }, shape: { kind: 'procedural', generator: 'furn-plant', params: { height: 2.2, species: 'olive', pot: 'concrete' } }, physics: { body: 'static', collider: 'auto' }, arch: { role: 'furniture', kind: 'plant', name: 'Planter' }, tags: ['arch', 'furniture'] });
      });
    }
    const [tx0, tz0, tx1, tz1] = bounds(terrace);
    minX = Math.min(minX, tx0);
    minZ = Math.min(minZ, tz0);
    maxX = Math.max(maxX, tx1);
    maxZ = Math.max(maxZ, tz1);
  }

  // Spawn: just inside the main entrance facing into the house (the first frame of a walkthrough is the
  // room, not a closed door), else in front of the entrance, else south of the building.
  let sp: P2 = spawnLocal ?? [(minX + maxX) / 2, maxZ + 3];
  const inside = entry && groundPlan ? entranceView(entry, groundPlan.walls, groundPlan.polys) : null;
  if (inside) {
    sp = inside.at;
    spawnYaw = inside.yaw;
  }
  const sw = rotateYaw(sp[0], sp[1], plan.rotation);
  const spawn: [number, number, number] = [round(plan.origin[0] + sw[0]), 0.1, round(plan.origin[1] + sw[1])];
  const corners = [
    rotateYaw(minX, minZ, plan.rotation),
    rotateYaw(maxX, minZ, plan.rotation),
    rotateYaw(maxX, maxZ, plan.rotation),
    rotateYaw(minX, maxZ, plan.rotation),
  ];
  const bx = corners.map((c) => c[0] + plan.origin[0]);
  const bz = corners.map((c) => c[1] + plan.origin[1]);
  const count = (role: string): number => entities.filter((e) => e.arch?.role === role).length;
  const stats = {
    levels: plan.levels.length,
    rooms: roomsOut.length,
    floorArea: Math.round(roomsOut.reduce((a, r) => a + r.area, 0)),
    walls: count('wall'),
    doors: count('door') + entities.filter((e) => e.arch?.role === 'opening' && e.arch.kind === 'opening').length,
    windows: count('window'),
    stairs: count('stair'),
    furniture: count('furniture') + count('fixture'),
    lights: entities.filter((e) => e.light !== undefined).length,
  };
  return {
    id: bid,
    entities,
    patches: entities.map((entity) => ({ op: 'add', entity })),
    root: bid,
    stats,
    spawnYaw: round(spawnYaw + plan.rotation, 10),
    spawn,
    bounds: { min: [round(Math.min(...bx)), 0, round(Math.min(...bz))], max: [round(Math.max(...bx)), round(maxY), round(Math.max(...bz))] },
    rooms: roomsOut,
    notes,
  };

}

/**
 * Water level below the pool coping. The pool sits on the terrace (the
 * plinth above the ground plane); its water must stay above the ground
 * plane, which would otherwise cover it.
 */
export function poolFreeboard(plinth: number): number {
  return round(Math.max(0.005, Math.min(0.12, plinth - 0.03 - 0.015)));
}

function defaultWindowStyle(style: BuildingPlan['style']): string {
  return style === 'classic' ? 'grid' : style === 'industrial' ? 'grid' : 'casement';
}

function headingYaw(h: 'north' | 'south' | 'east' | 'west'): number {
  const n = compassNormal(h);
  return round(yawOf(n[0], n[1]), 100);
}

/** Stair footprint in the level frame. */
function stairWorldFootprint(s: { at: P2 | [number, number]; heading: 'north' | 'south' | 'east' | 'west'; shape: 'straight' | 'l' | 'u'; width: number; turn: 'left' | 'right' }, rise: number): P2[] {
  const sp = StairParams.parse({ shape: s.shape, width: s.width, rise, turn: s.turn });
  const yaw = headingYaw(s.heading);
  return stairFootprint(sp).map((p) => {
    const r = rotateYaw(p[0], p[1], yaw);
    return [s.at[0] + r[0], s.at[1] + r[1]] as P2;
  });
}

function polyArea(poly: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as P2;
    const q = poly[(i + 1) % poly.length] as P2;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Stable 32-bit hash of an id (seeds). */
export function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** True when `q` lies on the boundary of `poly` (within a millimetre). */
function pointOnBoundary(q: P2, poly: readonly P2[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as P2;
    const b = poly[(i + 1) % poly.length] as P2;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / l2));
    if (Math.hypot(q[0] - (a[0] + dx * t), q[1] - (a[1] + dz * t)) < 1e-3) return true;
  }
  return false;
}

/** Room types that get recessed downlights (not terraces, garages or storage). */
const DOWNLIGHT_ROOMS: ReadonlySet<RoomType> = new Set<RoomType>(['living', 'kitchen', 'dining', 'hall', 'entry', 'bedroom', 'office', 'bathroom', 'cafe', 'lobby', 'meeting', 'studio', 'kids']);

/**
 * Recessed downlight positions of a room: a regular grid about 1.9 m apart
 * kept 0.7 m off the walls (one or two for small rooms), at most 12.
 */
export function downlightGrid(poly: readonly P2[], type: RoomType, style: string): P2[] {
  if (!DOWNLIGHT_ROOMS.has(type) || style === 'industrial') return [];
  const [x0, z0, x1, z1] = [Math.min(...poly.map((p) => p[0])), Math.min(...poly.map((p) => p[1])), Math.max(...poly.map((p) => p[0])), Math.max(...poly.map((p) => p[1]))];
  const w = x1 - x0;
  const d = z1 - z0;
  if (w < 1.6 || d < 1.6) return [];
  const nx = Math.max(1, Math.min(4, Math.round((w - 1.2) / 1.9)));
  const nz = Math.max(1, Math.min(4, Math.round((d - 1.2) / 1.9)));
  const out: P2[] = [];
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      const x = x0 + ((i + 0.5) / nx) * w;
      const z = z0 + ((k + 0.5) / nz) * d;
      if (pointInPolygon(x, z, poly as P2[]) && out.length < 12) out.push([x, z]);
    }
  }
  return out;
}

/** Interior wall paint of a room (wet rooms get tiles, kitchens a washable paint). */
function wallFinish(room: PlanRoom, pal: StylePalette, compass?: Compass): MaterialSpec {
  const own = compass ? room.walls?.[compass] : undefined;
  if (own) return own;
  const own2 = compass ? room.wallColors?.[compass] : undefined;
  if (!room.finish && own2) return { finish: 'paint', color: own2 };
  if (room.finish) return room.wallColor && !room.finish.color ? { ...room.finish, color: room.wallColor } : room.finish;
  if (room.type === 'bathroom') return { finish: 'tile', color: '#ece9e3' };
  if (room.type === 'terrace') return { finish: 'plaster', color: '#ece9e3' };
  return { finish: 'paint', color: room.wallColor ?? pal.wall };
}

/** Half the thickness of the wall along a room edge (distance from centreline to face). */
function insetFor(e: RoomEdge, walls: readonly WallRec[]): number {
  const m: P2 = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
  for (const w of walls) {
    const t = (m[0] - w.w.a[0]) * w.dir[0] + (m[1] - w.w.a[1]) * w.dir[1];
    const off = -(m[0] - w.w.a[0]) * w.dir[1] + (m[1] - w.w.a[1]) * w.dir[0];
    if (t > -0.02 && t < w.len + 0.02 && Math.abs(off) < 0.03) return w.thickness / 2;
  }
  return 0.06;
}

/** Furniture kinds the player can sit on (see the studio's seat poses). */
const SEAT_KINDS: ReadonlySet<string> = new Set(['sofa', 'armchair', 'chair', 'office-chair', 'bar-stool']);

/** Furniture placement → entity (also used by the design tools to instantiate parts). */
export function placedEntity(p: Placed, id: string, parent: string, room: string, level: number, withLight: boolean): EntityInput {
  const def = furnitureById(p.generator);
  // Interactive pieces hand their drawers and doors to child entities (see placedParts).
  if (def?.interactive && !p.asset && !p.params['interactive']) p = { ...p, params: { ...p.params, interactive: true } };
  const lightRole = p.kind === 'pendant' || p.kind === 'ceiling-light' || p.kind === 'floor-lamp' || p.kind === 'table-lamp' || p.kind === 'sconce';
  const role = p.kind === 'switch' ? 'switch' : lightRole ? 'light' : def?.mount === 'floor' || def?.mount === 'surface' ? 'furniture' : 'fixture';
  const e: EntityInput = {
    id,
    parent,
    name: p.name,
    // Library models stand on their base: a ceiling model hangs below the fixing point by its height.
    transform: { position: [round(p.x), round(p.asset && def?.mount === 'ceiling' ? p.y - p.size[1] : p.y), round(p.z)], rotation: [0, round(p.yaw, 100), 0] },
    shape: p.asset
      ? { kind: 'asset', id: p.asset, fallback: { kind: 'procedural', generator: p.generator, params: p.params, seed: (hashId(id) % 100000) + level } }
      : { kind: 'procedural', generator: p.generator, params: p.params, seed: (hashId(id) % 100000) + level },
    arch: { role, kind: p.kind, room, name: p.name, ...(!p.asset && variantsFor(p) ? { variants: variantsFor(p) } : {}) },
    tags: ['arch', role],
    castShadow: p.kind !== 'rug' && p.kind !== 'switch',
  };
  if (SEAT_KINDS.has(p.kind) && (def?.mount === 'floor' || def?.mount === 'surface')) e.interact = { kind: 'seat', label: p.kind.replace('-', ' '), reach: 2.4 };
  if (def?.portable && !p.asset) {
    e.physics = { body: 'dynamic', collider: 'auto', mass: def.portable.mass, friction: 0.7, restitution: 0.1 };
    e.interact = { kind: 'pickup', label: p.kind, reach: 2.2 };
  } else if (def?.mount === 'floor' && p.kind !== 'rug') e.physics = { body: 'static', collider: 'auto' };
  if (p.light && withLight && Object.keys(p.light).length > 0) {
    const l = p.light as Partial<LightSpec>;
    // Light source sits just under the fitting.
    e.light = { type: l.type ?? 'point', color: l.color ?? '#ffd7a6', intensity: l.intensity ?? 2, range: l.range ?? 8, castShadow: false };
    e.state = { on: true };
  }
  return e;
}

/**
 * The openable parts (drawers, cabinet doors, appliance doors) of a placed
 * interactive piece as child entities of the piece: each has its own
 * kinematic body and an `operable` behavior that slides or swings it when the
 * player uses it. `frameYaw` is the yaw of the parent frame (the building's
 * rotation) so slide offsets, given in the world frame, point out of the front.
 */
export function placedParts(p: Placed, id: string, room: string, level: number, frameYaw = 0): EntityInput[] {
  const def = furnitureById(p.generator);
  if (!def?.interactive || p.asset) return [];
  const seed = (hashId(id) % 100000) + level;
  const params: Record<string, Json> = { ...p.params, interactive: true };
  const out: EntityInput[] = [];
  for (const m of furnitureMovables(def, params, seed)) {
    if (m.motion.type === 'toggle') {
      // A tap: the part flips "<id>.on" and shows a stream of water between spout and basin.
      const { from, to } = m.motion.stream;
      const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      const mid: [number, number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
      const streamId = `${id}-${m.id}-water`;
      out.push({
        id: streamId,
        parent: id,
        name: 'Water',
        transform: { position: [round(mid[0]), round(mid[1]), round(mid[2])] },
        shape: { kind: 'primitive', primitive: 'cylinder', size: [0.014, round(len), 0.014] },
        material: { finish: 'water', color: '#a9d8ee', opacity: 0.6, roughness: 0.05 },
        visible: false,
        castShadow: false,
        arch: { role: 'part', kind: 'water', room, name: 'Water' },
        tags: ['arch', 'part', 'water'],
      });
      out.push({
        id: `${id}-${m.id}`,
        parent: id,
        name: m.name,
        transform: { position: [round(m.center[0]), round(m.center[1]), round(m.center[2])] },
        shape: { kind: 'procedural', generator: 'furn-part', params: { of: p.generator, part: m.id, p: params, size: m.size.map((n) => round(n, 10000)) }, seed },
        physics: { body: 'kinematic', collider: 'auto' },
        behaviors: [{ type: 'toggle', params: { show: [streamId], sound: 'click' } }],
        state: { on: false },
        interact: { kind: 'tap', label: 'tap', reach: 2.4 },
        arch: { role: 'part', kind: 'tap', room, name: m.name },
        tags: ['arch', 'part'],
      });
      continue;
    }
    const behavior: Record<string, Json> =
      m.motion.type === 'slide'
        ? (() => {
            const w = rotateYaw(m.motion.offset[0], m.motion.offset[2], p.yaw + frameYaw);
            return { trigger: 'use', motion: 'slide', slide: [round(w[0]), round(m.motion.offset[1]), round(w[1])], duration: 0.55 };
          })()
        : { trigger: 'use', motion: 'swing', swingAngle: m.motion.angle, hinge: m.motion.hinge, duration: 0.7 };
    out.push({
      id: `${id}-${m.id}`,
      parent: id,
      name: m.name,
      transform: { position: [round(m.center[0]), round(m.center[1]), round(m.center[2])] },
      shape: { kind: 'procedural', generator: 'furn-part', params: { of: p.generator, part: m.id, p: params, size: m.size.map((n) => round(n, 10000)) }, seed },
      physics: { body: 'kinematic', collider: 'auto' },
      behaviors: [{ type: 'operable', params: behavior }],
      state: { open: false },
      interact: { kind: m.kind === 'drawer' ? 'drawer' : /fridge|freezer/i.test(m.name) ? 'appliance' : 'cabinet', label: m.name.toLowerCase(), reach: 2.4 },
      arch: { role: 'part', kind: m.kind, room, name: m.name },
      tags: ['arch', 'part'],
      castShadow: true,
    });
  }
  return out;
}

/**
 * Alternative looks for the walkthrough's material swap (key R): each is a
 * set of generator param overrides of the piece (cover material and colour
 * of seating, field and border of rugs, linen and headboard of beds).
 */
export function variantsFor(p: Pick<Placed, 'kind'>): Array<Record<string, Json>> | undefined {
  switch (p.kind) {
    case 'sofa':
    case 'armchair':
      return [
        { upholstery: 'velvet', color: '#3f5a52' },
        { upholstery: 'leather', color: '#8a5a3b' },
        { upholstery: 'fabric', color: '#d9d3c7' },
        { upholstery: 'velvet', color: '#2f3640' },
      ];
    case 'rug':
      return [
        { color: '#8c3f36', border: '#5a2a24' },
        { color: '#2f4858', border: '#1f2f3a' },
        { color: '#e3dccf', border: '#b9ae9c' },
      ];
    case 'bed':
      return [
        { linen: '#f1eee8', headboard: '#55606b' },
        { linen: '#dfe6ea', headboard: '#9aa58f' },
        { linen: '#efe6d6', headboard: '#8a6a52' },
      ];
    default:
      return undefined;
  }
}

