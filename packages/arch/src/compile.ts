/**
 * Building compiler: BuildingPlan → World IR entities.
 *
 *   building (root, plan stored in arch.plan)
 *   ├─ plinth (foundation slab, ground floor)
 *   ├─ level k (y = elevation)
 *   │   ├─ walls (one entity per network wall; mitred joins, openings)
 *   │   ├─ room floors (slabs, stair holes) + ceilings
 *   │   ├─ door frames + leaves (kinematic, `door` behaviour, key E)
 *   │   ├─ windows, stairs, railings, roof caps
 *   │   └─ furniture, lights (one main fitting per room), switches
 *   ├─ roof (over the top level)
 *   └─ terrace, pool, entry steps
 *
 * Every element is a procedural entity (`arch-*` / `furn-*`), so the
 * renderer, physics, history, diffing and sharing treat buildings like any
 * other content and every element stays parametric. Errors are thrown as
 * {@link PlanError}s with a code and a concrete fix hint for the agent.
 */
import { hashString, type EntityInput, type Json, type MaterialSpec, type Vec3 } from '@aether/core';
import { furnishRoom } from './recipes';
import type { Placed, RoomContext, RoomDoor, RoomWindow } from './layout';
import { area, bounds, centroid, clipPolygon, cm, dist, isAxisRectangle, isConvex, isSimplePolygon, pointInPolygon, pointSegmentDistance, rotateYaw, yawOf, type P2 } from './math2';
import { BuildingPlan, MAX_BUILDING_ENTITIES, type ArchStyle, type PlanDoor, type PlanLevel, type PlanRoom, type RoomType } from './plan';
import { compassNormal, edgePoint, exteriorSpans, offsetPolygon, outlineLoops, overlapArea, roomEdges, roomPolygon, sharedSpans, type EdgeSpan, type RoomEdge } from './rooms';
import { stairFootprint, stairLayout } from './stair';
import { StairParams } from './params';
import { floorFor, habitable, palette, type StylePalette } from './style';
import { solveWallJoins } from './wall-joins';
import { wallNetwork, type NetworkWall } from './wall-network';
import { DOOR_CLEARANCE, LINING } from './openings';

/** A refusal with a machine-readable code and a fix hint (agent tools surface both). */
export class PlanError extends Error {
  override name = 'PlanError';
  constructor(
    readonly code: string,
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

/** Result of compiling a plan. */
export interface CompiledBuilding {
  id: string;
  entities: EntityInput[];
  /** Player start (world coordinates) in front of the main entrance, and the yaw facing it. */
  spawn: Vec3 | null;
  spawnYaw: number;
  notes: string[];
  stats: { levels: number; rooms: number; walls: number; doors: number; windows: number; stairs: number; furniture: number; lights: number; entities: number; floorArea: number };
}

const CEILING_DROP = 0.22;
const UPPER_SLAB = 0.22;

/** Entity id from parts, clipped to the 64-char slug limit. */
function eid(...parts: Array<string | number>): string {
  const s = parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s.slice(0, 64).replace(/-$/, '');
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function pt(p: P2): [number, number] {
  return [r3(p[0]), r3(p[1])];
}

/** The main entrance as placed (plan coordinates of its level). */
interface MainDoor {
  point: P2;
  /** Unit vector pointing out of the building. */
  out: P2;
  width: number;
  wallThickness: number;
}

interface WallInfo {
  id: string;
  net: NetworkWall;
  thickness: number;
  length: number;
  dir: P2;
  yaw: number;
  openings: Array<{ kind: 'door' | 'window' | 'opening'; offset: number; width: number; height: number; sill: number }>;
}

interface LevelInfo {
  index: number;
  id: string;
  plan: PlanLevel;
  elevation: number;
  height: number;
  polys: Map<string, P2[]>;
  rooms: PlanRoom[];
  walls: WallInfo[];
  /** Plan-space stair holes to cut into this level's floors, per room id. */
  holes: Map<string, P2[][]>;
  /** Stair holes to cut into this level's ceilings (stairs rising from this level). */
  ceilingHoles: Map<string, P2[][]>;
  roomDoors: Map<string, RoomDoor[]>;
  roomWindows: Map<string, RoomWindow[]>;
}

/** Find the wall carrying a plan point (closest centreline within 4 cm). */
function wallAt(walls: readonly WallInfo[], p: P2): WallInfo | null {
  let best: WallInfo | null = null;
  let bestD = 0.04;
  for (const w of walls) {
    const d = pointSegmentDistance(p[0], p[1], w.net.a[0], w.net.a[1], w.net.b[0], w.net.b[1]);
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

/** Index of the room edge containing a plan point. */
function edgeIndexAt(edges: readonly RoomEdge[], p: P2): number {
  let best = -1;
  let bestD = 0.05;
  edges.forEach((e, i) => {
    const d = pointSegmentDistance(p[0], p[1], e.a[0], e.a[1], e.b[0], e.b[1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function interiorMaterial(type: RoomType, color: string): MaterialSpec {
  if (type === 'bathroom' || type === 'laundry') return { finish: 'subway-tile', color: '#eeece7' };
  return { finish: 'plaster', color };
}

/** Windows for a room type in a style: [sill, height (null = to the ceiling), style, glass]. */
function windowSpec(type: RoomType, style: ArchStyle, ceiling: number): { sill: number; height: number; style: 'casement' | 'fixed' | 'sliding' | 'grid' | 'picture'; frosted: boolean; width: (span: number) => number } {
  const big = style === 'modern' || style === 'industrial' || style === 'japandi';
  switch (type) {
    case 'living':
    case 'dining':
    case 'lobby':
    case 'cafe':
    case 'studio':
      return { sill: big ? 0.08 : 0.45, height: ceiling - (big ? 0.08 : 0.45) - 0.28, style: style === 'classic' ? 'grid' : big ? 'picture' : 'casement', frosted: false, width: (s) => Math.min(big ? 3.2 : 1.6, s * 0.7) };
    case 'bedroom':
    case 'kids':
    case 'office':
    case 'meeting':
    case 'open-office':
      return { sill: 0.8, height: Math.min(1.6, ceiling - 1.1), style: style === 'classic' ? 'grid' : 'casement', frosted: false, width: (s) => Math.min(type === 'open-office' || type === 'meeting' ? 2.6 : 1.6, s * 0.6) };
    case 'kitchen':
      return { sill: 1.05, height: Math.min(1.1, ceiling - 1.4), style: 'casement', frosted: false, width: (s) => Math.min(1.4, s * 0.5) };
    case 'bathroom':
    case 'laundry':
      return { sill: 1.5, height: 0.6, style: 'fixed', frosted: true, width: (s) => Math.min(0.9, s * 0.45) };
    default:
      return { sill: 0.9, height: 1.3, style: 'casement', frosted: false, width: (s) => Math.min(1.2, s * 0.5) };
  }
}

/** Parse a plan (untrusted) into a validated BuildingPlan or throw a PlanError. */
export function parsePlan(input: unknown): BuildingPlan {
  const res = BuildingPlan.safeParse(input);
  if (!res.success) {
    const issues = res.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new PlanError('invalid_plan', `invalid building plan: ${issues}`, 'Fix the listed fields. Rooms need an id and `rect` [x0,z0,x1,z1] (metres, wall centrelines); doors use `between: [roomId, roomId|"outside"]`.');
  }
  return res.data;
}

/** Validate geometry and references of a parsed plan. */
function validate(plan: BuildingPlan): void {
  const ids = new Set<string>();
  plan.levels.forEach((lvl, li) => {
    const polys: Array<{ id: string; poly: P2[] }> = [];
    for (const room of lvl.rooms) {
      if (ids.has(room.id)) throw new PlanError('duplicate_room', `room id "${room.id}" is used twice`, 'Give every room in the building a unique id (e.g. "bed-1", "bed-2", "bath-up").');
      ids.add(room.id);
      const poly = roomPolygon(room);
      if (!isSimplePolygon(poly)) throw new PlanError('bad_room', `room "${room.id}" outline crosses itself`, 'List polygon points in order around the room without crossing edges, or use `rect`.');
      const a = area(poly);
      if (a < 1) throw new PlanError('room_too_small', `room "${room.id}" is ${a.toFixed(2)} m²`, 'Rooms must be at least 1 m² (a WC is ~1.2 × 1.5 m); widen the rect.');
      for (const o of polys) {
        const ov = overlapArea(poly, o.poly);
        if (ov > 0.08) throw new PlanError('rooms_overlap', `rooms "${room.id}" and "${o.id}" overlap by ${ov.toFixed(1)} m² on level ${li}`, 'Room outlines are wall centrelines: adjacent rooms should SHARE an edge (e.g. living [0,0,5,4] and kitchen [5,0,8,4]), never overlap.');
      }
      polys.push({ id: room.id, poly });
    }
    let mains = 0;
    for (const d of lvl.doors) {
      for (const r of d.between) if (r !== 'outside' && !lvl.rooms.some((x) => x.id === r)) throw new PlanError('unknown_room', `door between "${d.between[0]}" and "${d.between[1]}": no room "${r}" on level ${li}`, `Use room ids of level ${li}: ${lvl.rooms.map((x) => x.id).join(', ')} or "outside".`);
      if (d.between[0] === d.between[1]) throw new PlanError('bad_door', `door connects "${d.between[0]}" to itself`, 'A door joins two different rooms, or a room and "outside".');
      if (d.main) mains++;
    }
    if (mains > 1) throw new PlanError('two_entrances', `level ${li} has ${mains} main doors`, 'Mark only the front door with `main: true`.');
    for (const w of lvl.windows) if (!lvl.rooms.some((x) => x.id === w.room)) throw new PlanError('unknown_room', `window in unknown room "${w.room}" on level ${li}`, `Use one of: ${lvl.rooms.map((x) => x.id).join(', ')}.`);
    if (lvl.stairs.length > 0 && li === plan.levels.length - 1) throw new PlanError('no_upper_level', `level ${li} has a stair but no level above it`, 'Add the upper level (add_level) or remove the stair.');
  });
}

/** Compile a plan into entities (see the module docs). Deterministic. */
export function compileBuilding(input: unknown): CompiledBuilding {
  const plan = parsePlan(input);
  validate(plan);
  const pal = palette(plan.style);
  const bid = plan.id;
  const entities: EntityInput[] = [];
  const notes: string[] = [];
  const stats = { levels: plan.levels.length, rooms: 0, walls: 0, doors: 0, windows: 0, stairs: 0, furniture: 0, lights: 0, entities: 0, floorArea: 0 };
  let spawn: Vec3 | null = null;
  let spawnYaw = 0;
  const toWorld = (p: P2, y: number): Vec3 => {
    const r = rotateYaw(p[0], p[1], plan.rotation);
    return [cm(plan.origin[0] + r[0]), cm(y), cm(plan.origin[1] + r[1])];
  };

  entities.push({
    id: bid,
    name: plan.name,
    description: `${plan.levels.length}-storey ${plan.style} building`,
    shape: { kind: 'none' },
    transform: { position: [plan.origin[0], 0, plan.origin[1]], rotation: [0, plan.rotation, 0], scale: [1, 1, 1] },
    tags: ['architecture', 'focus'],
    arch: { role: 'building', name: plan.name, plan: plan as unknown as Json },
  });

  // -- levels, walls, openings ---------------------------------------------
  const levels: LevelInfo[] = [];
  let elevation = plan.plinth;
  plan.levels.forEach((lvl, index) => {
    const id = eid(bid, `l${index}`);
    const polys = new Map<string, P2[]>();
    for (const r of lvl.rooms) polys.set(r.id, roomPolygon(r));
    const indoor = lvl.rooms.filter((r) => r.type !== 'terrace');
    const net = wallNetwork(indoor.map((r) => ({ id: r.id, polygon: polys.get(r.id) as P2[] })));
    const walls: WallInfo[] = net.map((w, k) => {
      const length = dist(w.a, w.b);
      const dir: P2 = [(w.b[0] - w.a[0]) / length, (w.b[1] - w.a[1]) / length];
      return { id: eid(bid, `l${index}`, `w${k}`), net: w, thickness: w.exterior ? plan.exteriorWall.thickness : plan.interiorWall.thickness, length, dir, yaw: yawOf(dir[0], dir[1]), openings: [] };
    });
    levels.push({ index, id, plan: lvl, elevation, height: lvl.height, polys, rooms: lvl.rooms, walls, holes: new Map(), ceilingHoles: new Map(), roomDoors: new Map(), roomWindows: new Map() });
    entities.push({
      id,
      name: lvl.name ?? (index === 0 ? 'Ground floor' : `Floor ${index}`),
      parent: bid,
      shape: { kind: 'none' },
      transform: { position: [0, cm(elevation), 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      arch: { role: 'level', level: index, height: lvl.height, name: lvl.name ?? (index === 0 ? 'Ground floor' : `Floor ${index}`) },
    });
    elevation += lvl.height;
  });

  // -- stairs (need the level above for holes) -------------------------------
  levels.forEach((L, li) => {
    L.plan.stairs.forEach((s, k) => {
      const upper = levels[li + 1];
      if (!upper) return;
      const n = compassNormal(s.heading);
      const yaw = yawOf(n[0], n[1]);
      const params = StairParams.parse({ shape: s.shape, width: s.width, rise: L.height, turn: s.turn, finish: floorFor(plan.style, 'living'), rail: 'right', railMaterial: { finish: pal.metal === 'brass' ? 'brass' : 'black-metal' } });
      const local = stairFootprint(params);
      const fp = local.map((p) => {
        const r = rotateYaw(p[0], p[1], yaw);
        return [s.at[0] + r[0], s.at[1] + r[1]] as P2;
      });
      // Bottom: the start must be inside a room of this level.
      const hostRoom = L.rooms.find((r) => pointInPolygon(s.at[0] + n[0] * 0.3, s.at[1] + n[1] * 0.3, L.polys.get(r.id) as P2[]));
      if (!hostRoom) throw new PlanError('stair_outside', `stair ${k} on level ${li} starts outside every room`, `Put its \`at\` inside a room of level ${li} (e.g. a hall) with room for the run ahead (${(local.length > 0 ? Math.max(...local.map((p) => p[0])) : 4).toFixed(1)} m toward ${s.heading}).`);
      const cut = (target: Map<string, P2[][]>, lvl: LevelInfo): void => {
        for (const r of lvl.rooms) {
          const poly = lvl.polys.get(r.id) as P2[];
          if (overlapArea(fp, poly, 0.1) < 0.05) continue;
          let hole: P2[];
          if (isConvex(poly)) hole = clipPolygon(fp, poly);
          else if (fp.every((p) => pointInPolygon(p[0], p[1], poly))) hole = fp;
          else {
            notes.push(`stair ${k}: could not cut the floor of non-convex room ${r.id}`);
            continue;
          }
          // Keep the hole a little inside the room outline (triangulation needs a gap).
          const shrunk = hole.map((p) => {
            const c = centroid(hole);
            return [p[0] + (c[0] - p[0]) * 0.002, p[1] + (c[1] - p[1]) * 0.002] as P2;
          });
          if (area(shrunk) > 0.3) target.set(r.id, [...(target.get(r.id) ?? []), shrunk]);
        }
      };
      cut(upper.holes, upper);
      cut(L.ceilingHoles, L);
      const sid = eid(bid, `l${li}`, `stair${k}`);
      entities.push({
        id: sid,
        name: 'Stair',
        parent: L.id,
        shape: { kind: 'procedural', generator: 'arch-stair', params: params as unknown as Record<string, Json> },
        transform: { position: [r3(s.at[0]), 0, r3(s.at[1])], rotation: [0, r3(yaw), 0], scale: [1, 1, 1] },
        physics: { body: 'static' },
        arch: { role: 'stair', room: eid(bid, hostRoom.id) },
      });
      stats.stairs++;
      // Guard rail around the hole on the upper level, open at the arrival edge.
      const { flights } = stairLayout(params);
      const last = flights[flights.length - 1];
      if (last) {
        const run = last.treads * params.going;
        const arrivalLocal: P2 = [last.x + last.dx * run, last.z + last.dz * run];
        const ar = rotateYaw(arrivalLocal[0], arrivalLocal[1], yaw);
        const arrival: P2 = [s.at[0] + ar[0], s.at[1] + ar[1]];
        const edges = roomEdges(fp);
        let skip = 0;
        let best = Infinity;
        edges.forEach((e, i) => {
          const d = pointSegmentDistance(arrival[0], arrival[1], e.a[0], e.a[1], e.b[0], e.b[1]);
          if (d < best) {
            best = d;
            skip = i;
          }
        });
        const pts: P2[] = [];
        for (let i = 1; i <= edges.length; i++) {
          const e = edges[(skip + i) % edges.length] as RoomEdge;
          if (i === 1) pts.push(e.a);
          if (i < edges.length) pts.push(e.b);
        }
        if (pts.length >= 2) {
          entities.push({
            id: eid(bid, `l${li + 1}`, `stairrail${k}`),
            name: 'Stair rail',
            parent: upper.id,
            shape: { kind: 'procedural', generator: 'arch-railing', params: { points: pts.map(pt), style: plan.style === 'classic' ? 'bars' : 'glass', finish: { finish: pal.metal === 'brass' ? 'brass' : 'black-metal' } } },
            physics: { body: 'static' },
            arch: { role: 'railing' },
          });
        }
      }
    });
  });

  // -- doors -------------------------------------------------------------------
  // The main entrance: the door marked `main`, else the first door to outside on the ground floor.
  let mainLevel = plan.levels.findIndex((l) => l.doors.some((d) => d.main));
  let mainIndex = mainLevel >= 0 ? (plan.levels[mainLevel] as PlanLevel).doors.findIndex((d) => d.main) : -1;
  if (mainLevel < 0) {
    mainLevel = 0;
    mainIndex = (plan.levels[0] as PlanLevel).doors.findIndex((d) => d.between.includes('outside'));
  }
  let main: MainDoor | null = null;
  levels.forEach((L) => {
    const indoorPolys = L.rooms.filter((r) => r.type !== 'terrace').map((r) => L.polys.get(r.id) as P2[]);
    L.plan.doors.forEach((d, k) => placeDoor(plan, pal, L, d, k, indoorPolys, entities, stats, notes, L.index === mainLevel && k === mainIndex, (m) => {
      main = m;
    }));
  });
  const entrance = main as MainDoor | null;
  if (entrance) {
    const lvl = levels[mainLevel] as LevelInfo;
    const onTerrace = plan.site?.terrace ? pointInPolygon(entrance.point[0] + entrance.out[0] * 1.2, entrance.point[1] + entrance.out[1] * 1.2, plan.site.terrace as P2[]) : false;
    let reach = entrance.wallThickness / 2 + 0.05;
    if (mainLevel === 0 && plan.plinth >= 0.2 && !onTerrace) {
      // Entry steps from the ground up to the raised floor, ending at the plinth edge.
      const steps = StairParams.parse({ shape: 'straight', width: r3(Math.max(1.2, entrance.width + 0.6)), rise: plan.plinth, going: 0.32, rail: 'none', finish: { finish: 'stone', color: '#cfc8bb' }, structure: { finish: 'stone', color: '#bdb6a9' } });
      const run = (stairLayout(steps).flights[0]?.treads ?? 1) * steps.going;
      const at: P2 = [entrance.point[0] + entrance.out[0] * (reach + run), entrance.point[1] + entrance.out[1] * (reach + run)];
      entities.push({
        id: eid(bid, 'entry-steps'),
        name: 'Entry steps',
        parent: bid,
        shape: { kind: 'procedural', generator: 'arch-stair', params: steps as unknown as Record<string, Json> },
        transform: { position: [r3(at[0]), 0, r3(at[1])], rotation: [0, r3(yawOf(-entrance.out[0], -entrance.out[1])), 0], scale: [1, 1, 1] },
        physics: { body: 'static' },
        arch: { role: 'stair', name: 'Entry steps' },
      });
      reach += run;
    }
    const s: P2 = [entrance.point[0] + entrance.out[0] * (reach + 1.6), entrance.point[1] + entrance.out[1] * (reach + 1.6)];
    spawn = toWorld(s, mainLevel === 0 && !onTerrace ? 0 : lvl.elevation);
    spawnYaw = yawOf(-entrance.out[0], -entrance.out[1]) + plan.rotation;
  }

  // -- windows -----------------------------------------------------------------
  levels.forEach((L) => placeWindows(plan, pal, L, entities, stats));

  // -- walls -------------------------------------------------------------------
  levels.forEach((L) => {
    const joins = solveWallJoins(L.walls.map((w) => ({ id: w.id, a: w.net.a, b: w.net.b, thickness: w.thickness })));
    const roomById = new Map(L.rooms.map((r) => [r.id, r]));
    for (const w of L.walls) {
      const j = joins.get(w.id) ?? { startA: 0, startB: 0, endA: 0, endB: 0 };
      const side = (roomId: string | null): MaterialSpec => {
        if (!roomId) return plan.exteriorWall.finish;
        const r = roomById.get(roomId);
        return interiorMaterial(r?.type ?? 'living', r?.wallColor ?? pal.wall);
      };
      const wet = (roomId: string | null): boolean => roomId !== null && (roomById.get(roomId)?.type === 'bathroom' || roomById.get(roomId)?.type === 'laundry');
      const skirtA = w.net.roomA !== null && !wet(w.net.roomA);
      const skirtB = w.net.roomB !== null && !wet(w.net.roomB);
      entities.push({
        id: w.id,
        name: w.net.exterior ? 'Exterior wall' : 'Wall',
        parent: L.id,
        shape: {
          kind: 'procedural',
          generator: 'arch-wall',
          params: {
            length: r3(w.length),
            height: L.height,
            thickness: w.thickness,
            startA: j.startA,
            startB: j.startB,
            endA: j.endA,
            endB: j.endB,
            openings: w.openings.map((o) => ({ kind: o.kind, offset: r3(o.offset), width: r3(o.width), height: r3(o.height), sill: r3(o.sill) })),
            finishA: side(w.net.roomA) as Json,
            finishB: side(w.net.roomB) as Json,
            skirting: skirtA && skirtB ? 'both' : skirtA ? 'a' : skirtB ? 'b' : 'none',
          },
        },
        transform: { position: [r3(w.net.a[0]), 0, r3(w.net.a[1])], rotation: [0, r3(w.yaw), 0], scale: [1, 1, 1] },
        physics: { body: 'static' },
        arch: { role: 'wall', ...(w.net.roomA ? { room: eid(bid, w.net.roomA) } : w.net.roomB ? { room: eid(bid, w.net.roomB) } : {}) },
      });
      stats.walls++;
    }
  });

  // -- floors, ceilings, furniture ---------------------------------------------
  levels.forEach((L, li) => {
    const upper = levels[li + 1];
    for (const room of L.rooms) {
      const poly = L.polys.get(room.id) as P2[];
      const c = centroid(poly);
      const cx = cm(c[0]);
      const cz = cm(c[1]);
      const local = poly.map((p) => pt([p[0] - cx, p[1] - cz]));
      const toLocal = (h: P2[]): Array<[number, number]> => h.map((p) => pt([p[0] - cx, p[1] - cz]));
      const outdoor = room.type === 'terrace';
      const roomId = eid(bid, room.id);
      const floor = room.floor ?? floorFor(plan.style, room.type);
      stats.rooms++;
      stats.floorArea += area(poly);
      entities.push({
        id: roomId,
        name: room.name ?? titleOf(room.type),
        parent: L.id,
        shape: {
          kind: 'procedural',
          generator: 'arch-slab',
          params: { polygon: local, holes: (L.holes.get(room.id) ?? []).map(toLocal), thickness: li === 0 ? cm(plan.plinth) : UPPER_SLAB, finish: floor as Json, edge: { finish: 'concrete', color: '#b9b5ae' }, bottom: li === 0 || outdoor },
        },
        transform: { position: [cx, 0, cz], rotation: [0, 0, 0], scale: [1, 1, 1] },
        physics: { body: 'static' },
        arch: { role: 'room', name: room.name ?? titleOf(room.type), kind: room.type, variants: floorVariants(floor) },
      });
      if (!outdoor) {
        entities.push({
          id: eid(bid, room.id, 'ceil'),
          name: `${room.name ?? titleOf(room.type)} ceiling`,
          parent: L.id,
          shape: { kind: 'procedural', generator: 'arch-ceiling', params: { polygon: local, holes: (L.ceilingHoles.get(room.id) ?? []).map(toLocal), finish: { finish: 'paint', color: '#f4f2ee' } } },
          transform: { position: [cx, r3(L.height - CEILING_DROP), cz], rotation: [0, 0, 0], scale: [1, 1, 1] },
          castShadow: true,
          receiveShadow: true,
          arch: { role: 'ceiling', room: roomId },
        });
        // Exposed roof over rooms with nothing above (a stepped-back upper storey).
        const covered = upper ? upper.rooms.some((r) => pointInPolygon(c[0], c[1], upper.polys.get(r.id) as P2[])) : false;
        if (upper && !covered) {
          entities.push({
            id: eid(bid, room.id, 'roof'),
            name: 'Roof terrace',
            parent: L.id,
            shape: { kind: 'procedural', generator: 'arch-slab', params: { polygon: local, thickness: CEILING_DROP + 0.06, finish: { finish: 'gravel' }, edge: plan.exteriorWall.finish as Json, bottom: false } },
            transform: { position: [cx, r3(L.height + 0.06), cz], rotation: [0, 0, 0], scale: [1, 1, 1] },
            physics: { body: 'static' },
            arch: { role: 'roof' },
          });
        }
      }
      // Furniture.
      const edges = roomEdges(poly);
      const inset = edges.map((e) => {
        const w = wallAt(L.walls, edgePoint(e, e.length / 2));
        return w ? w.thickness / 2 : outdoor ? 0 : plan.interiorWall.thickness / 2;
      });
      const ctx: RoomContext = {
        id: room.id,
        type: room.type,
        name: room.name ?? titleOf(room.type),
        polygon: poly,
        edges,
        inset,
        doors: L.roomDoors.get(room.id) ?? [],
        windows: L.roomWindows.get(room.id) ?? [],
        ceiling: L.height - CEILING_DROP,
        style: plan.style,
        palette: pal,
        seed: hashString(`${bid}/${room.id}`) & 0xffff,
        omit: new Set(room.omit),
      };
      const { placed, notes: n } = furnishRoom(ctx, room.items, room.furnish);
      notes.push(...n);
      const counts = new Map<string, number>();
      for (const p of placed) {
        const k = (counts.get(p.kind) ?? 0) + 1;
        counts.set(p.kind, k);
        entities.push(furnitureEntity(bid, room.id, roomId, L.id, p, k, ctx.seed + k * 7919));
        if (p.light && p.light.type) stats.lights++;
        else stats.furniture++;
      }
    }
  });

  // -- explicit railings ---------------------------------------------------------
  levels.forEach((L) =>
    L.plan.railings.forEach((r, k) =>
      entities.push({ id: eid(bid, `l${L.index}`, `rail${k}`), name: 'Railing', parent: L.id, shape: { kind: 'procedural', generator: 'arch-railing', params: { points: r.points.map((p) => pt(p as P2)), style: r.style } }, physics: { body: 'static' }, arch: { role: 'railing' } }),
    ),
  );

  // -- plinth / foundation ------------------------------------------------------------
  const ground = levels[0] as LevelInfo;
  const loops = outlineLoops(ground.walls.map((w) => w.net));
  loops.forEach((loop, k) => {
    const outer = offsetPolygon(loop, plan.exteriorWall.thickness / 2 + 0.05);
    entities.push({
      id: eid(bid, 'plinth', k),
      name: 'Plinth',
      parent: bid,
      shape: { kind: 'procedural', generator: 'arch-slab', params: { polygon: outer.map(pt), thickness: cm(plan.plinth), finish: { finish: 'concrete', color: '#8f8b85' }, edge: { finish: 'concrete', color: '#8f8b85' } } },
      transform: { position: [0, r3(plan.plinth - 0.004), 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      physics: { body: 'static' },
      arch: { role: 'site', name: 'Plinth' },
    });
  });

  // -- roof ---------------------------------------------------------------------
  const top = levels[levels.length - 1] as LevelInfo;
  const topLoops = outlineLoops(top.walls.map((w) => w.net));
  const roofFinish = plan.roof.finish ?? (plan.roof.shape === 'flat' ? { finish: 'gravel' as const } : pal.roof);
  if (topLoops.length === 1 && isAxisRectangle(topLoops[0] as P2[])) {
    const [x0, z0, x1, z1] = bounds(topLoops[0] as P2[]);
    const t = plan.exteriorWall.thickness;
    const width = x1 - x0 + t;
    const depth = z1 - z0 + t;
    entities.push({
      id: eid(bid, 'roof'),
      name: 'Roof',
      parent: top.id,
      shape: {
        kind: 'procedural',
        generator: 'arch-roof',
        params: { shape: plan.roof.shape, width: r3(width), depth: r3(depth), pitch: plan.roof.pitch, overhang: plan.roof.shape === 'flat' ? 0 : plan.roof.overhang, ridgeAlongX: width >= depth, finish: roofFinish as Json, gableWall: plan.exteriorWall.finish as Json, trim: { finish: 'paint', color: '#e9e6e0' } },
      },
      transform: { position: [r3((x0 + x1) / 2), r3(top.height), r3((z0 + z1) / 2)], rotation: [0, 0, 0], scale: [1, 1, 1] },
      physics: { body: 'static' },
      arch: { role: 'roof' },
    });
  } else {
    if (plan.roof.shape !== 'flat') notes.push('pitched roofs need a rectangular top floor; used flat roofs instead');
    for (const room of top.rooms) {
      if (room.type === 'terrace') continue;
      const poly = top.polys.get(room.id) as P2[];
      const c = centroid(poly);
      entities.push({
        id: eid(bid, room.id, 'roof'),
        name: 'Roof',
        parent: top.id,
        shape: { kind: 'procedural', generator: 'arch-slab', params: { polygon: poly.map((p) => pt([p[0] - cm(c[0]), p[1] - cm(c[1])])), thickness: CEILING_DROP + 0.25, finish: roofFinish as Json, edge: plan.exteriorWall.finish as Json } },
        transform: { position: [cm(c[0]), r3(top.height + 0.25), cm(c[1])], rotation: [0, 0, 0], scale: [1, 1, 1] },
        physics: { body: 'static' },
        arch: { role: 'roof' },
      });
    }
  }

  // -- site: terrace + pool ----------------------------------------------------------
  const site = plan.site;
  if (site?.terrace) {
    const terrace = site.terrace.map((p) => [p[0], p[1]] as P2);
    const holes: P2[][] = [];
    if (site.pool) {
      const { at, width, length } = site.pool;
      const hx = width / 2 + 0.3;
      const hz = length / 2 + 0.3;
      holes.push([
        [at[0] - hx, at[1] - hz],
        [at[0] + hx, at[1] - hz],
        [at[0] + hx, at[1] + hz],
        [at[0] - hx, at[1] + hz],
      ]);
      if (!holes[0]?.every((p) => pointInPolygon(p[0], p[1], terrace))) throw new PlanError('pool_outside', 'the pool does not fit inside the terrace', 'Make the terrace polygon larger than the pool plus a 0.5 m deck on every side, or move `pool.at`.');
      entities.push({
        id: eid(bid, 'pool'),
        name: 'Pool',
        parent: bid,
        shape: { kind: 'procedural', generator: 'arch-basin', params: { width, length, depth: r3(Math.max(0.2, plan.plinth - 0.06)), finish: { finish: 'tile', color: '#a9dde6' }, coping: { finish: 'stone', color: '#e3ddd1' } } },
        transform: { position: [r3(at[0]), r3(plan.plinth), r3(at[1])], rotation: [0, 0, 0], scale: [1, 1, 1] },
        physics: { body: 'static' },
        arch: { role: 'pool', name: 'Pool' },
      });
    }
    entities.push({
      id: eid(bid, 'terrace'),
      name: 'Terrace',
      parent: bid,
      shape: { kind: 'procedural', generator: 'arch-slab', params: { polygon: terrace.map(pt), holes: holes.map((h) => h.map(pt)), thickness: cm(plan.plinth - 0.01), finish: site.terraceFinish as Json, edge: { finish: 'stone', color: '#c9c2b5' } } },
      transform: { position: [0, r3(plan.plinth - 0.01), 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      physics: { body: 'static' },
      arch: { role: 'site', name: 'Terrace' },
    });
    if (site.planting) {
      const [x0, z0, x1, z1] = bounds(terrace);
      let n = 0;
      for (const [x, z] of [
        [x0 + 0.5, z0 + 0.5],
        [x1 - 0.5, z0 + 0.5],
        [x1 - 0.5, z1 - 0.5],
        [x0 + 0.5, z1 - 0.5],
      ] as const) {
        if (ground.rooms.some((r) => pointInPolygon(x, z, ground.polys.get(r.id) as P2[]))) continue;
        if (!pointInPolygon(x, z, terrace)) continue;
        n++;
        entities.push({ id: eid(bid, 'planter', n), name: 'Olive tree', parent: bid, shape: { kind: 'procedural', generator: 'furn-plant', params: { height: 2.2, species: 'olive', pot: 'concrete' }, seed: n }, transform: { position: [r3(x), r3(plan.plinth), r3(z)], rotation: [0, n * 47, 0], scale: [1, 1, 1] }, physics: { body: 'static' }, arch: { role: 'furniture', kind: 'plant' } });
      }
    }
  }

  stats.entities = entities.length;
  if (entities.length > MAX_BUILDING_ENTITIES) throw new PlanError('too_large', `the building would have ${entities.length} entities (max ${MAX_BUILDING_ENTITIES})`, 'Use fewer or larger rooms, fewer levels, or set `furnish: false` on some rooms.');
  stats.floorArea = Math.round(stats.floorArea * 10) / 10;
  return { id: bid, entities, spawn, spawnYaw, notes, stats };
}

/** Floor variants for the interactive material swap. */
function floorVariants(current: MaterialSpec): Array<Record<string, Json>> {
  const options: MaterialSpec[] = [{ finish: 'oak' }, { finish: 'walnut' }, { finish: 'herringbone' }, { finish: 'marble' }, { finish: 'terrazzo' }, { finish: 'concrete', color: '#a9a49c' }];
  return options.filter((o) => o.finish !== current.finish).slice(0, 4).map((o) => ({ finish: o as Json }));
}

/** Upholstery / finish variants per furniture kind (key R). */
function furnitureVariants(kind: string): Array<Record<string, Json>> | undefined {
  switch (kind) {
    case 'sofa':
    case 'armchair':
      return [
        { upholstery: 'velvet', color: '#3f5a52' },
        { upholstery: 'leather', color: '#7a4a2c' },
        { upholstery: 'fabric', color: '#d9d3c7' },
        { upholstery: 'velvet', color: '#8a5a44' },
      ];
    case 'bed':
      return [
        { linen: '#e9e4da', throw: '#6f7d74', headboard: '#8f8678' },
        { linen: '#f4f2ee', throw: '#b9764a', headboard: '#3f5a52' },
        { linen: '#dfe4e6', throw: '#2f4858', headboard: '#c7b9a5' },
      ];
    case 'dining-table':
    case 'coffee-table':
      return [{ top: 'marble' }, { top: 'walnut' }, { top: 'terrazzo' }, { top: 'oak' }];
    case 'kitchen':
    case 'island':
      return [{ fronts: 'walnut' }, { fronts: 'paint', color: '#4d5a52' }, { fronts: 'oak' }, { fronts: 'paint', color: '#e8e4dd' }];
    case 'rug':
      return [{ color: '#b9764a', border: '#5a3a26' }, { color: '#d9d3c7', border: '#9a917f' }, { color: '#3f5a52', border: '#26362f' }];
    default:
      return undefined;
  }
}

function titleOf(type: RoomType): string {
  switch (type) {
    case 'living':
      return 'Living room';
    case 'open-office':
      return 'Open office';
    case 'kids':
      return "Kids' room";
    default:
      return type.charAt(0).toUpperCase() + type.slice(1).replace('-', ' ');
  }
}

function furnitureEntity(bid: string, roomKey: string, roomId: string, levelId: string, p: Placed, n: number, seed: number): EntityInput {
  const solid = p.def.mount === 'floor' && p.kind !== 'rug';
  const role = p.light && p.light.type ? 'light' : p.kind === 'switch' ? 'switch' : 'furniture';
  const variants = furnitureVariants(p.kind);
  const e: EntityInput = {
    id: eid(bid, roomKey, p.kind, n),
    name: p.name,
    parent: levelId,
    shape: { kind: 'procedural', generator: p.generator, params: p.params, seed: seed & 0xffff },
    transform: { position: [r3(p.x), r3(p.y), r3(p.z)], rotation: [0, r3(((p.yaw % 360) + 540) % 360 - 180), 0], scale: [1, 1, 1] },
    castShadow: p.kind !== 'rug' && p.kind !== 'curtain',
    receiveShadow: true,
    arch: { role, kind: p.kind, room: roomId, name: p.name, ...(variants ? { variants } : {}) },
  };
  if (solid) e.physics = { body: 'static' };
  if (p.light && p.light.type) {
    // Light hangs just below the fitting's diffuser.
    e.light = { type: p.light.type, color: p.light.color ?? '#ffd7a6', intensity: p.light.intensity ?? 2.5, range: p.light.range ?? 8, castShadow: false };
  }
  return e;
}

function placeDoor(
  plan: BuildingPlan,
  pal: StylePalette,
  L: LevelInfo,
  d: PlanDoor,
  k: number,
  indoorPolys: readonly P2[][],
  entities: EntityInput[],
  stats: CompiledBuilding['stats'],
  notes: string[],
  isMain: boolean,
  onMain: (door: MainDoor) => void,
): void {
  const [ra, rb] = d.between;
  const inside = ra === 'outside' ? rb : ra;
  const other = ra === 'outside' ? ra : rb;
  const poly = L.polys.get(inside) as P2[];
  let span: EdgeSpan | undefined;
  if (other === 'outside') span = exteriorSpans(poly, indoorPolys.filter((p) => p !== poly), d.side)[0];
  else span = sharedSpans(poly, L.polys.get(other) as P2[])[0];
  if (!span) {
    throw new PlanError(
      'no_shared_wall',
      other === 'outside' ? `room "${inside}" has no exterior wall${d.side ? ` on its ${d.side} side` : ''} for a door` : `rooms "${inside}" and "${other}" do not share a wall`,
      other === 'outside' ? 'Pick a side where the room touches the outside, or omit `side`.' : 'Doors need two rooms that share an edge; connect through a hall or move the rooms so their outlines touch.',
    );
  }
  const spanLen = span.t1 - span.t0;
  const margin = 0.12 + plan.exteriorWall.thickness / 2;
  let width = d.width;
  if (spanLen - 2 * margin < width) {
    width = Math.max(0.6, spanLen - 2 * margin);
    if (spanLen - 2 * margin < 0.6) throw new PlanError('wall_too_short', `the wall between "${ra}" and "${rb}" is only ${spanLen.toFixed(2)} m long`, 'Doors need at least 0.85 m of shared wall; lengthen the shared edge.');
    notes.push(`door ${ra}→${rb} narrowed to ${width.toFixed(2)} m to fit its wall`);
  }
  const t = span.t0 + margin + d.at * (spanLen - 2 * margin - width) + width / 2;
  const p = edgePoint(span.edge, t);
  const wall = L.walls.find((w) => pointSegmentDistance(p[0], p[1], w.net.a[0], w.net.a[1], w.net.b[0], w.net.b[1]) < 0.04) ?? wallAt(L.walls, p);
  if (!wall) throw new PlanError('no_wall', `no wall found for the door between "${ra}" and "${rb}"`, 'Check that the rooms share a straight edge.');
  const offset = (p[0] - wall.net.a[0]) * wall.dir[0] + (p[1] - wall.net.a[1]) * wall.dir[1];
  const openingW = d.kind === 'opening' ? width : width + 2 * (LINING + DOOR_CLEARANCE);
  const openingH = d.kind === 'opening' ? d.height : d.height + LINING + DOOR_CLEARANCE;
  wall.openings.push({ kind: d.kind === 'opening' ? 'opening' : 'door', offset, width: openingW, height: openingH, sill: 0 });
  // Swing into the second room (or into the building for outside doors).
  const into = other === 'outside' ? inside : rb;
  const intoPoly = L.polys.get(into) as P2[];
  const left: P2 = [-wall.dir[1], wall.dir[0]];
  const intoB = pointInPolygon(p[0] + left[0] * 0.4, p[1] + left[1] * 0.4, intoPoly);
  // Hinge at the end of the span closer to a corner, so the leaf opens against a wall.
  const nearStart = t - span.t0 < span.t1 - t;
  const spanAlongWall = span.edge.dir[0] * wall.dir[0] + span.edge.dir[1] * wall.dir[1] > 0;
  const hingeLeft = nearStart === spanAlongWall; // wall-local −X end
  const swingAngle = hingeLeft ? (intoB ? -90 : 90) : intoB ? 90 : -90;
  const yaw = wall.yaw;
  const fid = eid(L.id, `d${k}`);
  const doorName = other === 'outside' ? 'Front door' : `Door ${titleOf(L.rooms.find((r) => r.id === into)?.type ?? 'living')}`;
  entities.push({
    id: fid,
    name: `${doorName} frame`,
    parent: L.id,
    shape: { kind: 'procedural', generator: 'arch-frame', params: { width: r3(openingW), height: r3(openingH), wallThickness: wall.thickness, casing: d.kind === 'opening' ? 0.05 : 0.07, finish: { finish: 'paint', color: pal.doorColor } } },
    transform: { position: [r3(p[0]), 0, r3(p[1])], rotation: [0, r3(yaw), 0], scale: [1, 1, 1] },
    arch: { role: d.kind === 'opening' ? 'opening' : 'door', wall: wall.id, room: eid(plan.id, into), name: doorName },
  });
  stats.doors++;
  if (d.kind !== 'opening') {
    const sideSign = intoB ? 1 : -1;
    const leafT = 0.045;
    const zOff = d.kind === 'sliding' ? sideSign * (wall.thickness / 2 + 0.03) : sideSign * (wall.thickness / 2 - leafT / 2 - 0.004);
    const pos: P2 = [p[0] + left[0] * zOff, p[1] + left[1] * zOff];
    const style = d.style ?? (d.kind === 'sliding' ? 'glass' : other === 'outside' ? (plan.style === 'classic' ? 'panel' : 'slab') : pal.door);
    const finish: MaterialSpec = other === 'outside' ? { finish: plan.style === 'industrial' ? 'black-metal' : 'walnut' } : { finish: 'paint', color: pal.doorColor };
    const slideDir = rotateYaw(wall.dir[0] * (hingeLeft ? 1 : -1), wall.dir[1] * (hingeLeft ? 1 : -1), plan.rotation);
    entities.push({
      id: eid(fid, 'leaf'),
      name: doorName,
      parent: L.id,
      shape: { kind: 'procedural', generator: 'arch-door', params: { width: r3(width), height: d.height, thickness: leafT, style, finish: finish as Json, hardware: { finish: pal.metal === 'brass' ? 'brass' : pal.metal === 'chrome' ? 'chrome' : 'brushed-metal' }, handle: hingeLeft ? 'right' : 'left' } },
      transform: { position: [r3(pos[0]), 0.003, r3(pos[1])], rotation: [0, r3(yaw), 0], scale: [1, 1, 1] },
      physics: { body: 'kinematic' },
      behaviors: [
        d.kind === 'sliding'
          ? { type: 'door', params: { trigger: 'key', key: 'e', radius: 1.8, motion: 'slide', slide: [r3(-slideDir[0] * width * 0.95), 0, r3(-slideDir[1] * width * 0.95)], duration: 0.8 } }
          : { type: 'door', params: { trigger: 'key', key: 'e', radius: 1.6, motion: 'swing', hinge: hingeLeft ? 'left' : 'right', swingAngle, duration: 0.9 } },
      ],
      state: { open: false },
      arch: { role: 'door', kind: 'leaf', wall: wall.id, room: eid(plan.id, into), name: doorName },
    });
  }
  // Room-side records for the layouts.
  for (const roomId of [ra, rb]) {
    if (roomId === 'outside') continue;
    const rp = L.polys.get(roomId) as P2[];
    const edges = roomEdges(rp);
    const ei = edgeIndexAt(edges, p);
    if (ei < 0) continue;
    const e = edges[ei] as RoomEdge;
    const te = (p[0] - e.a[0]) * e.dir[0] + (p[1] - e.a[1]) * e.dir[1];
    const hingeAlongEdge = (hingeLeft ? -1 : 1) * (e.dir[0] * wall.dir[0] + e.dir[1] * wall.dir[1] > 0 ? 1 : -1);
    const list = L.roomDoors.get(roomId) ?? [];
    list.push({ edge: ei, t: te, width: openingW, swingsIn: d.kind === 'swing' && roomId === into, hinge: hingeAlongEdge > 0 ? 1 : -1 });
    L.roomDoors.set(roomId, list);
  }
  if (isMain) {
    const out: P2 = intoB ? [-left[0], -left[1]] : left;
    onMain({ point: p, out, width: openingW, wallThickness: wall.thickness });
  }
}

function placeWindows(plan: BuildingPlan, pal: StylePalette, L: LevelInfo, entities: EntityInput[], stats: CompiledBuilding['stats']): void {
  const indoor = L.rooms.filter((r) => r.type !== 'terrace');
  const polysOf = (id: string): P2[] => L.polys.get(id) as P2[];
  const ceiling = L.height - CEILING_DROP;
  let k = 0;
  const add = (room: PlanRoom, span: EdgeSpan, centreT: number, width: number, height: number, sill: number, style: 'casement' | 'fixed' | 'sliding' | 'grid' | 'picture', frosted: boolean): void => {
    const p = edgePoint(span.edge, centreT);
    const wall = wallAt(L.walls, p);
    if (!wall) return;
    const offset = (p[0] - wall.net.a[0]) * wall.dir[0] + (p[1] - wall.net.a[1]) * wall.dir[1];
    // Keep clear of doors and other windows on the same wall (0.25 m of wall between).
    for (const o of wall.openings) if (Math.abs(o.offset - offset) < (o.width + width) / 2 + 0.25) return;
    if (offset - width / 2 < 0.35 || offset + width / 2 > wall.length - 0.35) return;
    wall.openings.push({ kind: 'window', offset, width, height, sill });
    const left: P2 = [-wall.dir[1], wall.dir[0]];
    const interiorB = pointInPolygon(p[0] + left[0] * 0.4, p[1] + left[1] * 0.4, polysOf(room.id));
    entities.push({
      id: eid(L.id, `win${k++}`),
      name: 'Window',
      parent: L.id,
      shape: { kind: 'procedural', generator: 'arch-window', params: { width: r3(width), height: r3(height), wallThickness: wall.thickness, style, frame: pal.windowFrame as Json, glass: (frosted ? { finish: 'frosted-glass' } : { finish: 'glass' }) as Json, interior: interiorB ? 'b' : 'a', sillMaterial: { finish: plan.style === 'scandinavian' || plan.style === 'japandi' ? 'oak' : 'marble' } } },
      transform: { position: [r3(p[0]), r3(sill), r3(p[1])], rotation: [0, r3(wall.yaw), 0], scale: [1, 1, 1] },
      physics: { body: 'static' },
      arch: { role: 'window', wall: wall.id, room: eid(plan.id, room.id) },
    });
    stats.windows++;
    const edges = roomEdges(polysOf(room.id));
    const ei = edgeIndexAt(edges, p);
    if (ei >= 0) {
      const e = edges[ei] as RoomEdge;
      const te = (p[0] - e.a[0]) * e.dir[0] + (p[1] - e.a[1]) * e.dir[1];
      const list = L.roomWindows.get(room.id) ?? [];
      list.push({ edge: ei, t0: te - width / 2, t1: te + width / 2, sill, height });
      L.roomWindows.set(room.id, list);
    }
  };
  for (const w of L.plan.windows) {
    const room = L.rooms.find((r) => r.id === w.room);
    if (!room) continue;
    const span = exteriorSpans(polysOf(room.id), indoor.filter((r) => r.id !== room.id).map((r) => polysOf(r.id)), w.side)[0];
    if (!span) continue;
    const len = span.t1 - span.t0;
    const spacing = len / w.count;
    const width = Math.min(w.width, spacing - 0.4);
    if (width < 0.4) continue;
    for (let i = 0; i < w.count; i++) add(room, span, span.t0 + spacing * (i + 0.5), width, Math.min(w.height, ceiling - w.sill - 0.1), w.sill, w.style ?? windowSpec(room.type, plan.style, ceiling).style, room.type === 'bathroom');
  }
  if (!L.plan.autoWindows) return;
  for (const room of indoor) {
    if (!habitable(room.type) || room.type === 'hall' || room.type === 'entry') continue;
    if (L.plan.windows.some((w) => w.room === room.id)) continue;
    const spec = windowSpec(room.type, plan.style, ceiling);
    for (const span of exteriorSpans(polysOf(room.id), indoor.filter((r) => r.id !== room.id).map((r) => polysOf(r.id)))) {
      const len = span.t1 - span.t0;
      if (len < 1.4) continue;
      const n = Math.max(1, Math.floor(len / (room.type === 'bathroom' ? 6 : spec.style === 'picture' ? 4.2 : 2.8)));
      const width = Math.max(0.6, Math.min(spec.width(len / n), len / n - 0.6));
      for (let i = 0; i < n; i++) add(room, span, span.t0 + (len / n) * (i + 0.5), width, spec.height, spec.sill, spec.style, spec.frosted);
    }
  }
}
