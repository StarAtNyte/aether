/**
 * Layout fit: put each piece where the photograph has it.
 *
 * The model reads positions off a flat picture, so a piece's distance along its wall is often a few tens of centimetres
 * off even when the room, the camera and the piece are right. Each visible piece also comes with a box (where it
 * appears in the photo). With the camera fitted ({@link calibrateCamera}), the box of a piece standing against a wall
 * depends on one number, how far along the wall it stands: this module searches that number per piece, deterministically,
 * keeping the move small, inside the wall, clear of its neighbours, and only when the box clearly improves. Pieces
 * standing on a moved piece (a lamp on a table, a TV on its cabinet) move with it.
 *
 * Pure geometry on the built room: no model, no rendering. The result is a list of `edit_items` moves.
 */
import type { EntityId, WorldDoc } from '@aether/core';
import type { Json } from '@aether/core';
import { readScene } from '../scene/read';
import type { SceneItem, SceneRoom, SceneWall } from '../scene/types';
import { customPose, entityGeometry, planDelta, projectGeometry, type EntityGeometry, type ImageBox } from '../scene/views';
import { photoCameraSpec } from './camera';
import { boxError, MIN_FRAMING_TARGETS, type FramingTarget } from './calibrate';
import type { RoomDescription } from './description';
import { PHOTO_BUILDING_ID, PHOTO_ROOM_ID } from './derive';

/** Furthest a piece is moved along its wall (metres). */
export const MAX_LAYOUT_SHIFT = 0.7;
/** A move must lower the piece's box error by at least this much (0..1 scale of {@link boxError}). */
export const MIN_LAYOUT_GAIN = 0.05;
/** Search step (metres). */
const STEP = 0.05;

/** One move, as the `edit_items` tool takes it. */
export interface LayoutMove {
  /** Handle of the piece (the description id). */
  id: string;
  /** The `edit_items` edit. */
  edit: Record<string, Json>;
  /** Metres along the wall (positive: towards the right end seen from inside); 0 for pieces that ride on a host. */
  shift: number;
  /** Box error before and after (pieces that were moved by the search, not the riders). */
  before?: number;
  after?: number;
}

/** Result of {@link fitLayout}. */
export interface LayoutFit {
  moves: LayoutMove[];
  /** Mean box error of the moved pieces before and after. */
  before: number;
  after: number;
}

const round = (v: number, n: number): number => Math.round(v * 10 ** n) / 10 ** n;

/** The piece's handle in the description: the entity id without the building prefix. */
function handleOf(id: EntityId): string {
  return id.startsWith(`${PHOTO_BUILDING_ID}-`) ? id.slice(PHOTO_BUILDING_ID.length + 1) : id;
}

function extentAlong(it: SceneItem, dir: readonly [number, number]): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const p of it.footprint) {
    const v = p[0] * dir[0] + p[1] * dir[1];
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return [lo, hi];
}

/** The wall a piece stands against or hangs on, with its position along it. */
function wallOf(room: SceneRoom, it: SceneItem): { wall: SceneWall; edge: number; gap: number } | null {
  if (it.mount === 'wall' && it.wall) {
    const wall = room.walls[it.wall.edge];
    return wall ? { wall, edge: it.wall.edge, gap: 0 } : null;
  }
  if (it.mount === 'floor' && it.against && it.against.length > 0) {
    const a = it.against[0] as NonNullable<SceneItem['against']>[number];
    const wall = room.walls[a.edge];
    return wall ? { wall, edge: a.edge, gap: a.gap } : null;
  }
  return null;
}

/** Pieces standing on `host` (their origin inside its footprint, bottom at its top). */
function riders(items: readonly SceneItem[], host: SceneItem): SceneItem[] {
  const xs = host.footprint.map((p) => p[0]);
  const zs = host.footprint.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  return items.filter((o) => o.mount === 'surface' && o.id !== host.id && o.pos[0] >= x0 - 0.02 && o.pos[0] <= x1 + 0.02 && o.pos[2] >= z0 - 0.02 && o.pos[2] <= z1 + 0.02 && Math.abs(o.y0 - host.y1) < 0.08);
}

function shifted(g: EntityGeometry, d: readonly [number, number, number]): EntityGeometry {
  return { id: g.id, pts: g.pts.map((p) => [p[0] + d[0], p[1] + d[1], p[2] + d[2]] as [number, number, number]) };
}

/**
 * Search each piece's position along its wall for the best match of its photo box. `desc.camera` should already be the
 * fitted camera. Returns null when there are too few boxes or the room cannot be read; an empty list of moves when
 * nothing clearly improves.
 */
export function fitLayout(world: WorldDoc, desc: RoomDescription, aspect: number, targets: readonly FramingTarget[]): LayoutFit | null {
  if (targets.length < MIN_FRAMING_TARGETS) return null;
  const scene = readScene(world, PHOTO_BUILDING_ID);
  if (!scene) return null;
  const room = scene.rooms.find((r) => r.key === PHOTO_ROOM_ID);
  if (!room) return null;
  const pose = customPose(world, PHOTO_BUILDING_ID, photoCameraSpec(desc, aspect));
  if (!pose) return null;
  const geometry = new Map(entityGeometry(world, PHOTO_BUILDING_ID).map((g) => [g.id, g]));
  const want = new Map<EntityId, ImageBox>();
  for (const t of targets) if (t.ids.length === 1 && t.ids[0]) want.set(t.ids[0], t.box);
  const errorOf = (geos: readonly EntityGeometry[], id: EntityId): number => {
    const w = want.get(id);
    if (!w) return 0;
    return boxError(w, projectGeometry(geos, pose, aspect).get(id) ?? null);
  };
  // Furthest-off pieces first: their moves leave room for the others.
  const candidates = scene.items
    .filter((it) => want.has(it.id) && (it.mount === 'wall' || it.mount === 'floor') && it.kind !== 'curtain' && it.kind !== 'cornice' && wallOf(room, it) !== null)
    .map((it) => ({ it, err: errorOf([geometry.get(it.id) as EntityGeometry], it.id) }))
    .filter((c) => c.err > 0.06 && geometry.has(c.it.id))
    .sort((a, b) => b.err - a.err);
  const occupied = new Map<EntityId, [number, number]>();
  for (const o of scene.items) {
    const w = wallOf(room, o);
    if (w && o.mount === 'floor') occupied.set(o.id, extentAlong(o, w.wall.dir));
  }
  const moves: LayoutMove[] = [];
  let sumBefore = 0;
  let sumAfter = 0;
  for (const { it, err } of candidates) {
    const w = wallOf(room, it) as NonNullable<ReturnType<typeof wallOf>>;
    const dir = w.wall.dir;
    const [e0, e1] = extentAlong(it, dir);
    const a0 = w.wall.a[0] * dir[0] + w.wall.a[1] * dir[1];
    const half = (e1 - e0) / 2;
    const tNow = (e0 + e1) / 2 - a0;
    const lo = half + w.wall.inset + 0.06;
    const hi = w.wall.length - half - w.wall.inset - 0.06;
    if (hi < lo) continue;
    const group = [it, ...(it.mount === 'floor' ? riders(scene.items, it) : [])];
    let best = { dx: 0, cost: groupError(group, geometry, errorOf, null) };
    for (let dx = -MAX_LAYOUT_SHIFT; dx <= MAX_LAYOUT_SHIFT + 1e-9; dx += STEP) {
      if (Math.abs(dx) < 1e-9) continue;
      const tNew = tNow + dx;
      if (tNew < lo || tNew > hi) continue;
      // Not into a neighbour standing against the same wall.
      if (it.mount === 'floor') {
        let clash = false;
        for (const [id, [o0, o1]] of occupied) {
          if (id === it.id) continue;
          if (e0 + dx < o1 - 0.01 && e1 + dx > o0 + 0.01) clash = true;
        }
        if (clash) continue;
      }
      const delta = planDelta(world, PHOTO_BUILDING_ID, [dir[0] * dx, dir[1] * dx]);
      if (!delta) continue;
      const c = groupError(group, geometry, errorOf, delta);
      if (c < best.cost - 1e-9) best = { dx, cost: c };
    }
    const own0 = err;
    const delta = best.dx === 0 ? null : planDelta(world, PHOTO_BUILDING_ID, [dir[0] * best.dx, dir[1] * best.dx]);
    if (!delta || best.dx === 0) continue;
    const own1 = errorOf([shifted(geometry.get(it.id) as EntityGeometry, delta)], it.id);
    if (own0 - own1 < MIN_LAYOUT_GAIN) continue;
    const tNew = round(tNow + best.dx, 3);
    moves.push({
      id: handleOf(it.id),
      shift: round(best.dx, 3),
      before: round(own0, 3),
      after: round(own1, 3),
      edit: { op: 'move', ref: handleOf(it.id), wall: w.wall.compass, t: tNew, ...(it.mount === 'floor' ? { gap: round(w.gap, 3) } : {}) },
    });
    sumBefore += own0;
    sumAfter += own1;
    if (it.mount === 'floor') occupied.set(it.id, [e0 + best.dx, e1 + best.dx]);
    if (it.mount === 'floor') {
      for (const r of riders(scene.items, it)) {
        const host = it;
        const t = (host.yaw * Math.PI) / 180;
        const dxw = r.pos[0] - host.pos[0];
        const dzw = r.pos[2] - host.pos[2];
        const off0 = dxw * Math.cos(t) - dzw * Math.sin(t);
        const off1 = dxw * Math.sin(t) + dzw * Math.cos(t);
        moves.push({ id: handleOf(r.id), shift: 0, edit: { op: 'move', ref: handleOf(r.id), on: handleOf(host.id), offset: [round(off0, 3), round(off1, 3)] } });
      }
    }
  }
  const n = moves.filter((m) => m.before !== undefined).length;
  return { moves, before: n > 0 ? sumBefore / n : 0, after: n > 0 ? sumAfter / n : 0 };
}

/** Mean box error of a piece and the pieces riding on it when all are displaced by `delta` (null: not displaced). */
function groupError(group: readonly SceneItem[], geometry: ReadonlyMap<EntityId, EntityGeometry>, errorOf: (g: readonly EntityGeometry[], id: EntityId) => number, delta: readonly [number, number, number] | null): number {
  let sum = 0;
  let n = 0;
  for (const m of group) {
    const g = geometry.get(m.id);
    if (!g) continue;
    sum += errorOf([delta ? shifted(g, delta) : g], m.id);
    n++;
  }
  return n === 0 ? 0 : sum / n;
}
