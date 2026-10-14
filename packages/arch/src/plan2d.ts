/**
 * 2D floor-plan drawing of a compiled building, read back from the World IR
 * (the entities the compiler produced, so manual edits show up too): wall
 * outlines with their openings, door leaves with swing arcs, windows, room
 * outlines with names and areas, furniture footprints, stairs with treads,
 * and overall dimensions.
 *
 * Coordinates are metres in the building's PLAN frame (x east, z south),
 * the frame `BuildingPlan` rooms are written in, so a room drawn on the plan
 * can be sent straight back as an `add_room` op. Pure and bounded.
 */
import type { Entity, EntityId, WorldDoc } from '@aether/core';
import { furnitureOfEntity } from './furniture/assets';
import { area, bounds, interiorPoint, rotateYaw, type P2 } from './math2';
import { SlabParams, StairParams, WallParams } from './params';
import { stairFootprint, stairLayout } from './stair';

/** A room on the plan. */
export interface Plan2dRoom {
  id: EntityId;
  name: string;
  kind: string;
  polygon: P2[];
  /** Floor area (m²). */
  area: number;
  /** Label anchor (inside the room). */
  label: P2;
}

/** A wall segment drawn as a filled outline (pieces between openings). */
export interface Plan2dWall {
  id: EntityId;
  exterior: boolean;
  /** Solid pieces, each a quad. */
  pieces: P2[][];
}

/** A door: its opening, the leaf in the open position and the swing arc. */
export interface Plan2dDoor {
  id: EntityId;
  /** Opening ends on the wall centreline. */
  a: P2;
  b: P2;
  kind: 'swing' | 'sliding' | 'opening';
  /** Swing doors: hinge, open-leaf end and arc end (quarter circle hinge → leaf → closed end). */
  hinge?: P2;
  open?: P2;
  closed?: P2;
}

/** A window opening (on the wall centreline) with the wall thickness. */
export interface Plan2dWindow {
  id: EntityId;
  a: P2;
  b: P2;
  thickness: number;
}

/** A furniture / fixture footprint. */
export interface Plan2dItem {
  id: EntityId;
  kind: string;
  polygon: P2[];
}

/** A stair: footprint and tread lines. */
export interface Plan2dStair {
  id: EntityId;
  outline: P2[];
  treads: Array<[P2, P2]>;
  /** Arrow from the first riser along the walking line. */
  arrow: [P2, P2];
}

/** A dimension line with its label (metres). */
export interface Plan2dDimension {
  a: P2;
  b: P2;
  /** Offset direction (unit) of the dimension line from the measured edge. */
  normal: P2;
  label: string;
}

/** Everything drawn for one storey. */
export interface FloorPlan2d {
  building: EntityId;
  level: number;
  levelName: string;
  /** Floor-to-floor height of the storey. */
  height: number;
  rooms: Plan2dRoom[];
  walls: Plan2dWall[];
  doors: Plan2dDoor[];
  windows: Plan2dWindow[];
  items: Plan2dItem[];
  stairs: Plan2dStair[];
  dimensions: Plan2dDimension[];
  /** [x0, z0, x1, z1] of everything drawn. */
  bounds: [number, number, number, number];
}

/** Storeys of a building (index, name, floor-to-floor height). */
export interface Plan2dLevel {
  id: EntityId;
  index: number;
  name: string;
  height: number;
}

/** Most drawable elements per plan (hostile documents stay cheap). */
const MAX_ELEMENTS = 4000;

function pose(e: Entity): { x: number; z: number; yaw: number } {
  return { x: e.transform.position[0], z: e.transform.position[2], yaw: e.transform.rotation[1] };
}

function toPlan(p: { x: number; z: number; yaw: number }, lx: number, lz: number): P2 {
  const r = rotateYaw(lx, lz, p.yaw);
  return [round(p.x + r[0]), round(p.z + r[1])];
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function params(e: Entity): Record<string, unknown> | null {
  return e.shape.kind === 'procedural' ? (e.shape.params as Record<string, unknown>) : null;
}

/** The buildings of a world (id + name). */
export function listBuildings(world: WorldDoc): Array<{ id: EntityId; name: string }> {
  return Object.values(world.entities)
    .filter((e) => e.arch?.role === 'building')
    .map((e) => ({ id: e.id, name: e.arch?.name ?? e.name ?? e.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Storeys of building `id`, ground floor first. */
export function listLevels(world: WorldDoc, building: EntityId): Plan2dLevel[] {
  return Object.values(world.entities)
    .filter((e) => e.parent === building && e.arch?.role === 'level')
    .map((e) => ({ id: e.id, index: e.arch?.level ?? 0, name: e.arch?.name ?? e.name ?? e.id, height: e.arch?.height ?? 3 }))
    .sort((a, b) => a.index - b.index);
}

/** Draw storey `level` of building `building`, or null when it does not exist. */
export function floorPlan2d(world: WorldDoc, building: EntityId, level: number): FloorPlan2d | null {
  const lvl = listLevels(world, building).find((l) => l.index === level);
  if (!lvl) return null;
  const children = Object.values(world.entities).filter((e) => e.parent === lvl.id).slice(0, MAX_ELEMENTS);
  const out: FloorPlan2d = { building, level, levelName: lvl.name, height: lvl.height, rooms: [], walls: [], doors: [], windows: [], items: [], stairs: [], dimensions: [], bounds: [0, 0, 0, 0] };
  const wallThickness = new Map<EntityId, number>();
  for (const e of children) {
    const role = e.arch?.role;
    const p = params(e);
    if (!p) continue;
    if (role === 'room') {
      const slab = SlabParams.safeParse(p);
      if (!slab.success) continue;
      const at = pose(e);
      const poly = slab.data.polygon.map((q) => toPlan(at, q[0], q[1]));
      const holes = slab.data.holes.reduce((s, h) => s + area(h), 0);
      out.rooms.push({ id: e.id, name: e.arch?.name ?? e.name ?? e.id, kind: e.arch?.kind ?? 'room', polygon: poly, area: Math.round((area(poly) - holes) * 10) / 10, label: interiorPoint(poly) });
    } else if (role === 'wall') {
      const w = WallParams.safeParse(p);
      if (!w.success) continue;
      const at = pose(e);
      const t = w.data.thickness / 2;
      wallThickness.set(e.id, w.data.thickness);
      const cuts = w.data.openings.map((o) => [o.offset - o.width / 2, o.offset + o.width / 2] as const).sort((a, b) => a[0] - b[0]);
      const pieces: P2[][] = [];
      // Mitred ends: side A (−z) and side B (+z) extend by their join offsets.
      let s0 = 0;
      const ends = (x0: number, x1: number, first: boolean, last: boolean): P2[] => [
        toPlan(at, first ? -w.data.startA : x0, -t),
        toPlan(at, last ? w.data.length + w.data.endA : x1, -t),
        toPlan(at, last ? w.data.length + w.data.endB : x1, t),
        toPlan(at, first ? -w.data.startB : x0, t),
      ];
      for (const [c0, c1] of cuts) {
        if (c0 > s0 + 1e-3) pieces.push(ends(s0, c0, s0 === 0, false));
        s0 = Math.max(s0, c1);
      }
      if (w.data.length > s0 + 1e-3) pieces.push(ends(s0, w.data.length, s0 === 0, true));
      out.walls.push({ id: e.id, exterior: e.arch?.kind === 'exterior', pieces });
    }
  }
  for (const e of children) {
    const role = e.arch?.role;
    const p = params(e);
    const at = pose(e);
    if (role === 'opening' && p) {
      const w = typeof p['width'] === 'number' ? p['width'] : 0.9;
      if (e.arch?.kind === 'opening') out.doors.push({ id: e.id, a: toPlan(at, -w / 2, 0), b: toPlan(at, w / 2, 0), kind: 'opening' });
    } else if (role === 'door' && p) {
      const w = typeof p['width'] === 'number' ? p['width'] : 0.86;
      const b = e.behaviors.find((x) => x.type === 'door');
      const motion = b?.params['motion'];
      if (motion === 'slide') {
        out.doors.push({ id: e.id, a: toPlan(at, -w / 2, 0), b: toPlan(at, w / 2, 0), kind: 'sliding' });
        continue;
      }
      const hinge = b?.params['hinge'] === 'right' ? 1 : -1;
      const angle = typeof b?.params['swingAngle'] === 'number' ? (b.params['swingAngle'] as number) : 90;
      // Leaf frame: hinge at x = hinge·w/2; the open leaf rotates about it by the swing angle.
      const hx = (hinge * w) / 2;
      const rad = (angle * Math.PI) / 180;
      const lx = -hinge * w;
      // Positive swing turns +X toward −Z (three's Y rotation).
      const ox = hx + lx * Math.cos(rad);
      const oz = -lx * Math.sin(rad);
      out.doors.push({ id: e.id, a: toPlan(at, -w / 2, 0), b: toPlan(at, w / 2, 0), kind: 'swing', hinge: toPlan(at, hx, 0), open: toPlan(at, ox, oz), closed: toPlan(at, hx + lx, 0) });
    } else if (role === 'window' && p) {
      const w = typeof p['width'] === 'number' ? p['width'] : 1.2;
      const t = typeof p['wallThickness'] === 'number' ? p['wallThickness'] : (wallThickness.get(e.arch?.wall ?? '') ?? 0.2);
      out.windows.push({ id: e.id, a: toPlan(at, -w / 2, 0), b: toPlan(at, w / 2, 0), thickness: t });
    } else if (role === 'furniture' || role === 'fixture' || role === 'light') {
      const f = furnitureOfEntity(e);
      const def = f?.def;
      if (!f || !def || def.mount === 'ceiling' || def.mount === 'wall') continue;
      const [sx, , sz] = f.size;
      const hx = sx / 2;
      const hz = sz / 2;
      out.items.push({ id: e.id, kind: e.arch?.kind ?? def.kind, polygon: [toPlan(at, -hx, -hz), toPlan(at, hx, -hz), toPlan(at, hx, hz), toPlan(at, -hx, hz)] });
    } else if (role === 'stair' && p) {
      const sp = StairParams.safeParse(p);
      if (!sp.success) continue;
      const outline = stairFootprint(sp.data).map((q) => toPlan(at, q[0], q[1]));
      const { flights } = stairLayout(sp.data);
      const treads: Array<[P2, P2]> = [];
      const hw = sp.data.width / 2;
      for (const f of flights) {
        for (let k = 0; k <= f.treads; k++) {
          const d = k * sp.data.going;
          const cx = f.x + f.dx * d;
          const cz = f.z + f.dz * d;
          // Tread line across the walking direction.
          treads.push([toPlan(at, cx - f.dz * hw, cz + f.dx * hw), toPlan(at, cx + f.dz * hw, cz - f.dx * hw)]);
          if (treads.length > 200) break;
        }
      }
      const f0 = flights[0];
      const len = f0 ? Math.max(0.6, f0.treads * sp.data.going * 0.8) : 1;
      out.stairs.push({ id: e.id, outline, treads, arrow: [toPlan(at, 0.15, 0), toPlan(at, len, 0)] });
    }
  }
  // Bounds and overall dimensions (along the plan axes).
  const pts: P2[] = [...out.rooms.flatMap((r) => r.polygon), ...out.walls.flatMap((w) => w.pieces.flat())];
  if (pts.length === 0) return out;
  const [x0, z0, x1, z1] = bounds(pts);
  out.bounds = [round(x0), round(z0), round(x1), round(z1)];
  out.dimensions.push({ a: [x0, z0], b: [x1, z0], normal: [0, -1], label: `${(x1 - x0).toFixed(2)} m` });
  out.dimensions.push({ a: [x1, z0], b: [x1, z1], normal: [1, 0], label: `${(z1 - z0).toFixed(2)} m` });
  // Per-room width × depth for axis-aligned rooms (on the room's top edge).
  for (const r of out.rooms) {
    if (r.polygon.length !== 4 || r.kind === 'terrace') continue;
    const [rx0, rz0, rx1, rz1] = bounds(r.polygon);
    if (Math.abs(area(r.polygon) - (rx1 - rx0) * (rz1 - rz0)) > 0.05) continue;
    out.dimensions.push({ a: [rx0, rz1], b: [rx1, rz1], normal: [0, -1], label: `${(rx1 - rx0).toFixed(2)}` });
  }
  return out;
}

/** Plan point → world (x, z) of a building whose root sits at `origin` with `yaw` degrees. */
export function planToWorld(origin: readonly [number, number], yaw: number, p: P2): P2 {
  const r = rotateYaw(p[0], p[1], yaw);
  return [origin[0] + r[0], origin[1] + r[1]];
}

/** World (x, z) → plan point (inverse of {@link planToWorld}). */
export function worldToPlan(origin: readonly [number, number], yaw: number, p: P2): P2 {
  return rotateYaw(p[0] - origin[0], p[1] - origin[1], -yaw);
}
