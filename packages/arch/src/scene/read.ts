/**
 * Reads the {@link Scene} of a building from a World IR document: rooms with
 * their wall faces and openings, furniture / decor / fixtures with their
 * footprints and the wall they hang on or stand against, and the fixed
 * obstacles (stairs, stairwell holes).
 *
 * It looks only at the document (never at the plan), so it measures what is
 * really there: rooms compiled from a plan, pieces placed by the design
 * tools, pieces the user dragged by hand, or a deliberately broken room.
 */
import { hasOwn, type Entity, type EntityId, type WorldDoc } from '@aether/core';
import { assetShapeSize } from '@aether/assets';
import { furnitureOfEntity } from '../furniture/assets';
import { FLOOR_THICKNESS } from '../compile';
import { obb, yawFacingIn } from '../layout';
import { area, bounds, pointInPolygon, positive, rotateYaw, type P2 } from '../math2';
import { StairParams, WallParams } from '../params';
import { placedPolygon } from '../entity-geom';
import { stairFootprint } from '../stair';
import { roomEdges, type RoomEdge } from '../rooms';
import type { Compass } from '../plan';
import type { ItemMount, Scene, SceneItem, SceneLevel, SceneObstacle, SceneOpening, SceneRoom, SceneWall } from './types';

/** Entities scanned at most per building (a hostile document stays cheap). */
const MAX_SCAN = 6000;

interface WallEnt {
  id: EntityId;
  a: P2;
  dir: P2;
  length: number;
  thickness: number;
  exterior: boolean;
  openings: WallParams['openings'];
}

const round = (v: number, d = 100): number => Math.round(v * d) / d;

/** Children of every entity (one pass). */
function childrenOf(world: WorldDoc): Map<string, Entity[]> {
  const out = new Map<string, Entity[]>();
  let n = 0;
  for (const e of Object.values(world.entities)) {
    if (++n > MAX_SCAN * 4) break;
    if (!e.parent) continue;
    const list = out.get(e.parent) ?? [];
    list.push(e);
    out.set(e.parent, list);
  }
  return out;
}

/** Geometry of an entity that counts as a furnishing, or null. */
export function itemGeometry(e: Entity): { kind: string; mount: ItemMount; size: [number, number, number]; asset?: string } | null {
  const f = furnitureOfEntity(e);
  const sc = e.transform.scale;
  if (f) {
    return { kind: f.def.kind, mount: f.def.mount, size: [f.size[0] * Math.abs(sc[0]), f.size[1] * Math.abs(sc[1]), f.size[2] * Math.abs(sc[2])], ...(e.shape.kind === 'asset' ? { asset: e.shape.id } : {}) };
  }
  const role = e.arch?.role;
  if (!(role === 'furniture' || role === 'fixture' || role === 'light' || role === 'switch') && !e.tags.includes('placed')) return null;
  let size: [number, number, number] | null = null;
  if (e.shape.kind === 'asset') size = assetShapeSize(e.shape) ?? null;
  else if (e.shape.kind === 'primitive') size = [e.shape.size[0], e.shape.size[1], e.shape.size[2]];
  if (!size) return null;
  const mount: ItemMount = e.tags.includes('mount-wall') ? 'wall' : e.tags.includes('mount-ceiling') ? 'ceiling' : e.tags.includes('mount-surface') ? 'surface' : 'floor';
  return { kind: e.arch?.kind ?? (e.shape.kind === 'asset' ? e.shape.id : 'object'), mount, size: [size[0] * Math.abs(sc[0]), size[1] * Math.abs(sc[1]), size[2] * Math.abs(sc[2])], ...(e.shape.kind === 'asset' ? { asset: e.shape.id } : {}) };
}

function wallEnts(level: Entity[]): WallEnt[] {
  const out: WallEnt[] = [];
  for (const e of level) {
    if (e.arch?.role !== 'wall' || e.shape.kind !== 'procedural' || e.shape.generator !== 'arch-wall') continue;
    const parsed = WallParams.safeParse(e.shape.params);
    if (!parsed.success) continue;
    const p = parsed.data;
    const dir = rotateYaw(1, 0, e.transform.rotation[1]);
    out.push({ id: e.id, a: [e.transform.position[0], e.transform.position[2]], dir, length: p.length, thickness: p.thickness, exterior: e.arch.kind === 'exterior', openings: p.openings });
  }
  return out;
}

function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return Math.abs(d);
}

/** Read the scene of building `buildingId`; null when it is not a building. */
export function readScene(world: WorldDoc, buildingId: EntityId): Scene | null {
  if (!hasOwn(world.entities, buildingId)) return null;
  const root = world.entities[buildingId] as Entity;
  if (root.arch?.role !== 'building') return null;
  const kids = childrenOf(world);
  const levelEntities = (kids.get(buildingId) ?? []).filter((e) => e.arch?.role === 'level').sort((a, b) => (a.arch?.level ?? 0) - (b.arch?.level ?? 0));
  const levels: SceneLevel[] = [];
  const rooms: SceneRoom[] = [];
  const items: SceneItem[] = [];
  const obstacles: SceneObstacle[] = [];
  let scanned = 0;
  for (const L of levelEntities) {
    const index = L.arch?.level ?? levels.length;
    const height = L.arch?.height ?? 3;
    const ceiling = round(height - FLOOR_THICKNESS - 0.004);
    levels.push({ id: L.id, index, height, ceiling });
    const children = kids.get(L.id) ?? [];
    scanned += children.length;
    if (scanned > MAX_SCAN) break;
    const walls = wallEnts(children);
    // Frames, windows and door leaves by host wall.
    const byWall = new Map<EntityId, Entity[]>();
    for (const e of children) {
      const w = e.arch?.wall;
      if (!w || !(e.arch?.role === 'opening' || e.arch?.role === 'window' || e.arch?.role === 'door')) continue;
      const l = byWall.get(w) ?? [];
      l.push(e);
      byWall.set(w, l);
    }
    const roomEntities = children.filter((e) => e.arch?.role === 'room');
    const polys = roomEntities.map((e) => ({ e, poly: placedPolygon(e) })).filter((r): r is { e: Entity; poly: P2[] } => r.poly !== null).map((r) => ({ e: r.e, poly: positive(r.poly) }));
    const keyOf = (id: EntityId): string => (id.startsWith(`${L.id}-`) ? id.slice(L.id.length + 1) : id);
    const levelRooms: SceneRoom[] = [];
    for (const { e, poly } of polys) {
      const edges = roomEdges(poly);
      const sceneWalls: SceneWall[] = [];
      edges.forEach((ed, ei) => {
        sceneWalls.push(wallFace(e.id, ei, ed, walls, byWall, polys, e.id));
      });
      levelRooms.push({
        id: e.id,
        key: keyOf(e.id),
        name: e.name || keyOf(e.id),
        type: e.arch?.kind ?? 'room',
        level: index,
        levelId: L.id,
        polygon: poly,
        walls: sceneWalls,
        area: round(area(poly), 10),
        bbox: bounds(poly),
        ceiling,
      });
      // Stairwell holes in this floor are not floor.
      const holes = e.shape.kind === 'procedural' ? e.shape.params['holes'] : undefined;
      if (Array.isArray(holes)) {
        holes.slice(0, 16).forEach((h, hi) => {
          const hp = placedPolygon({ ...e, shape: { kind: 'procedural', generator: 'arch-slab', params: { polygon: h } } } as Entity);
          if (hp) obstacles.push({ id: `${e.id}-hole${hi}`, kind: 'hole', level: index, polygon: positive(hp) });
        });
      }
    }
    rooms.push(...levelRooms);
    for (const e of children) {
      if (e.arch?.role === 'stair' && e.shape.kind === 'procedural' && e.shape.generator === 'arch-stair') {
        const sp = StairParams.safeParse(e.shape.params);
        if (!sp.success) continue;
        const fp = stairFootprint(sp.data);
        const pos = e.transform.position;
        const yaw = e.transform.rotation[1];
        obstacles.push({ id: e.id, kind: 'stair', level: index, polygon: positive(fp.map((q) => { const r = rotateYaw(q[0], q[1], yaw); return [pos[0] + r[0], pos[2] + r[1]] as P2; })) });
        continue;
      }
      const g = itemGeometry(e);
      if (!g) continue;
      items.push(readItem(e, g, L.id, index, levelRooms, ceiling));
    }
  }
  return { building: buildingId, levels, rooms, items, obstacles };
}

/** Opening angle the sweep is measured to (a little over the leaf's 92 degrees). */
const SWEEP_STEPS = 9;

/**
 * The floor a swinging door leaf sweeps into `room` while it opens: a quarter disc about its hinge, from the closed leaf to the
 * open one. Empty for sliding leaves and for leaves that open into the room on the other side of the wall.
 */
function leafSweep(leaf: Entity, e: RoomEdge, room: EntityId): P2[][] {
  const beh = leaf.behaviors?.find((b) => b.type === 'door');
  const prm = (beh?.params ?? {}) as Record<string, unknown>;
  if (!beh || prm['motion'] === 'slide' || leaf.arch?.room !== room) return [];
  const width = (leaf.shape as { params?: Record<string, unknown> }).params?.['width'];
  if (typeof width !== 'number' || !(width > 0.2)) return [];
  const yaw = leaf.transform.rotation[1];
  const sgn = prm['hinge'] === 'right' ? 1 : -1;
  const along = rotateYaw(1, 0, yaw);
  const c: P2 = [leaf.transform.position[0], leaf.transform.position[2]];
  const h: P2 = [c[0] + along[0] * sgn * (width / 2), c[1] + along[1] * sgn * (width / 2)];
  // From the hinge towards the leaf's far edge, then round into the room.
  const u: P2 = [-along[0] * sgn, -along[1] * sgn];
  const n: P2 = [-e.out[0], -e.out[1]];
  const poly: P2[] = [h];
  for (let i = 0; i <= SWEEP_STEPS; i++) {
    const a = (Math.PI / 2) * (92 / 90) * (i / SWEEP_STEPS);
    const r = width + 0.02;
    poly.push([h[0] + (u[0] * Math.cos(a) + n[0] * Math.sin(a)) * r, h[1] + (u[1] * Math.cos(a) + n[1] * Math.sin(a)) * r]);
  }
  return [poly];
}

/** The wall face of one room edge: the wall that lies on it and the openings that fall on it. */
function wallFace(room: EntityId, index: number, e: RoomEdge, walls: readonly WallEnt[], byWall: ReadonlyMap<EntityId, Entity[]>, polys: ReadonlyArray<{ e: Entity; poly: P2[] }>, self: EntityId): SceneWall {
  const mid: P2 = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
  let thickness = 0.12;
  let exterior = true;
  for (const w of walls) {
    const t = (mid[0] - w.a[0]) * w.dir[0] + (mid[1] - w.a[1]) * w.dir[1];
    const off = -(mid[0] - w.a[0]) * w.dir[1] + (mid[1] - w.a[1]) * w.dir[0];
    if (t > -0.05 && t < w.length + 0.05 && Math.abs(off) < 0.04) {
      thickness = w.thickness;
      exterior = w.exterior;
      break;
    }
  }
  const inset = thickness / 2;
  const openings: SceneOpening[] = [];
  for (const w of walls) {
    // Only walls lying on this edge's centreline.
    const offMid = -(mid[0] - w.a[0]) * w.dir[1] + (mid[1] - w.a[1]) * w.dir[0];
    if (Math.abs(offMid) > 0.04) continue;
    const kids = byWall.get(w.id) ?? [];
    w.openings.forEach((o, oi) => {
      const c: P2 = [w.a[0] + w.dir[0] * o.offset, w.a[1] + w.dir[1] * o.offset];
      const off = (c[0] - e.a[0]) * e.out[0] + (c[1] - e.a[1]) * e.out[1];
      const t = (c[0] - e.a[0]) * e.dir[0] + (c[1] - e.a[1]) * e.dir[1];
      if (Math.abs(off) > 0.06 || t < 0 || t > e.length) return;
      const wantWindow = o.kind === 'window';
      let frame: Entity | undefined;
      let leaf: Entity | undefined;
      const leaves: Entity[] = [];
      for (const k of kids) {
        const kt = (k.transform.position[0] - w.a[0]) * w.dir[0] + (k.transform.position[2] - w.a[1]) * w.dir[1];
        // A double door's leaves stand a quarter of the opening off its centre.
        if (Math.abs(kt - o.offset) > (!wantWindow && k.arch?.role === 'door' ? Math.max(0.08, o.width / 2) : 0.08)) continue;
        if (wantWindow && k.arch?.role === 'window') frame = k;
        else if (!wantWindow && k.arch?.role === 'opening') frame = k;
        else if (!wantWindow && k.arch?.role === 'door') {
          leaf = leaf ?? k;
          leaves.push(k);
        }
      }
      const swing = leaves.flatMap((l) => leafSweep(l, e, room));
      // The room on the other side of the wall.
      const beyond: P2 = [c[0] + e.out[0] * (thickness / 2 + 0.35), c[1] + e.out[1] * (thickness / 2 + 0.35)];
      const other = polys.find((p) => p.e.id !== self && pointInPolygon(beyond[0], beyond[1], p.poly));
      openings.push({
        id: frame?.id ?? `${w.id}:o${oi}`,
        kind: o.kind,
        t0: round(t - o.width / 2),
        t1: round(t + o.width / 2),
        centre: round(t),
        width: round(o.width),
        sill: round(o.sill),
        top: round(o.sill + o.height),
        leadsTo: other ? other.e.id : o.kind === 'window' ? 'outside' : exterior ? 'outside' : null,
        ...(leaf ? { leaf: leaf.id } : {}),
        wall: w.id,
        ...(swing.length > 0 ? { swing } : {}),
      });
    });
  }
  openings.sort((x, y) => x.t0 - y.t0);
  return { room, edge: index, compass: e.side, length: round(e.length), inset, a: e.a, b: e.b, dir: e.dir, out: e.out, exterior, openings };
}

function readItem(e: Entity, g: NonNullable<ReturnType<typeof itemGeometry>>, levelId: EntityId, level: number, rooms: readonly SceneRoom[], ceiling: number): SceneItem {
  const p = e.transform.position;
  const yaw = e.transform.rotation[1];
  const [w, h, d] = g.size;
  const footprint = obb(p[0], p[2], yaw, w, d);
  let y0 = p[1];
  let y1 = p[1] + h;
  if (g.mount === 'ceiling') {
    if (e.shape.kind === 'asset') {
      y0 = p[1];
      y1 = p[1] + h;
    } else {
      y1 = p[1];
      y0 = p[1] - h;
    }
  }
  void ceiling;
  const roomEntity = e.arch?.room && rooms.some((r) => r.id === e.arch?.room) ? (e.arch.room as EntityId) : (rooms.find((r) => pointInPolygon(p[0], p[2], r.polygon))?.id ?? null);
  const room = roomEntity ? rooms.find((r) => r.id === roomEntity) : undefined;
  const item: SceneItem = {
    id: e.id,
    kind: g.kind,
    name: e.name || g.kind,
    mount: g.mount,
    room: roomEntity,
    level,
    levelId,
    pos: [p[0], p[1], p[2]],
    yaw,
    size: [w, h, d],
    footprint,
    y0,
    y1,
    placed: e.tags.includes('placed'),
    ...(g.asset ? { asset: g.asset } : {}),
  };
  if (!room) return item;
  if (g.mount === 'wall') {
    let best: { wall: SceneWall; t: number; d: number } | null = null;
    for (const wl of room.walls) {
      const t = (p[0] - wl.a[0]) * wl.dir[0] + (p[2] - wl.a[1]) * wl.dir[1];
      const dist = -((p[0] - wl.a[0]) * wl.out[0] + (p[2] - wl.a[1]) * wl.out[1]) - wl.inset;
      if (t < -0.05 || t > wl.length + 0.05 || dist < -0.04 || dist > 0.1) continue;
      if (angleDiff(yaw, yawFacingIn({ a: wl.a, b: wl.b, length: wl.length, dir: wl.dir, out: wl.out, side: wl.compass } as RoomEdge)) > 8) continue;
      if (!best || dist < best.d) best = { wall: wl, t, d: dist };
    }
    if (best) item.wall = { room: room.id, edge: best.wall.edge, compass: best.wall.compass, t: round(best.t), width: w };
    return item;
  }
  if (g.mount === 'floor') {
    const against: NonNullable<SceneItem['against']> = [];
    for (const wl of room.walls) {
      let near = Infinity;
      let lo = Infinity;
      let hi = -Infinity;
      for (const q of footprint) {
        near = Math.min(near, -((q[0] - wl.a[0]) * wl.out[0] + (q[1] - wl.a[1]) * wl.out[1]) - wl.inset);
        const t = (q[0] - wl.a[0]) * wl.dir[0] + (q[1] - wl.a[1]) * wl.dir[1];
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
      if (near < 0.12 && near > -0.3 && hi > 0 && lo < wl.length) against.push({ room: room.id, edge: wl.edge, compass: wl.compass, gap: round(Math.max(0, near)), t0: round(lo), t1: round(hi) });
    }
    if (against.length > 0) item.against = against;
  }
  return item;
}

/** All buildings of a document. */
export function buildingIds(world: WorldDoc): EntityId[] {
  return Object.values(world.entities).filter((e) => e.arch?.role === 'building').map((e) => e.id);
}

/** Compass side from a user-given word (case-insensitive), or null. */
export function parseCompass(v: unknown): Compass | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return s === 'north' || s === 'south' || s === 'east' || s === 'west' ? s : null;
}
