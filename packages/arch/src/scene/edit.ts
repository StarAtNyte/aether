/**
 * Placement tools: place, move, rotate, resize, remove, snap to a wall,
 * anchor to an opening, centre over another piece. Each takes the document
 * and returns the minimal patches plus the measured facts of the result, or a
 * refusal that says what is wrong and what would work.
 *
 * The AI chooses what goes where; these functions never choose. A placement
 * is applied to a copy of the document and then audited with the same checks
 * the review loop uses: when any of them reports an error that involves the
 * piece (overlap, through a wall, over a door or window, in a doorway, on the
 * stairs, in a door's swing, walling a room in), the placement is refused.
 */
import { applyPatches, Entity, hasOwn, type EntityId, type Json, type Patch, type WorldDoc } from '@aether/core';
import { assetShapeSize, catalogEntry } from '@aether/assets';
import { furnitureByKind, furnitureSize } from '../furniture/index';
import { yawFacingIn } from '../layout';
import type { Compass } from '../plan';
import type { RoomEdge } from '../rooms';
import { collisions, CURTAIN_WINDOW_OVERLAP, nearestMountCentre, mountRule, type MountSpec } from '../wall-space';
import { reviewScene, walkability, freeFrontDepth, type Finding } from './checks';
import { findItem, findOpening, findRoom, findWall, isLookupError, itemLine, wallBlockers, facingOf } from './facts';
import { cmr, compassWord, describeOffset, mm, polygonGap } from './geom';
import { defaultWallBottom, fittingLight, itemEntity, partInfo, partKinds, resolvePartParams } from './parts';
import { readScene } from './read';
import type { Scene, SceneItem, SceneOpening, SceneRoom, SceneWall } from './types';

/** Result of an edit tool. */
export type EditResult =
  | { ok: true; patches: Patch[]; /** Short commit message. */ message: string; /** Facts for the model. */ text: string; /** Entity ids created or changed. */ ids: EntityId[]; warnings: string[] }
  | { ok: false; error: string };

const MAX_COORD = 2000;
const GAP_DEFAULT = 0.02;

/** Where a piece should go (the same vocabulary for place and move). */
export interface Target {
  /** Floor / ceiling pieces: plan x, z of the footprint centre. */
  at?: [number, number];
  /** Wall: stand against it (floor pieces) or hang on it (wall pieces). */
  wall?: string;
  edge?: number;
  /** Centre along the wall (see `Scene` conventions). */
  t?: number;
  /** With a wall and no `t`: where along the wall. */
  align?: 'centre' | 'start' | 'end';
  /** Back-to-wall gap for floor pieces (default 0.02 m). */
  gap?: number;
  /** Surface pieces: the host piece they stand on. */
  on?: string;
  /** Offset on the host (east, south in the host's own frame: x across, z depth). */
  offset?: [number, number];
  /** Wall pieces: bottom height; ceiling pieces ignore it. */
  y?: number;
  /** Floor / ceiling pieces: yaw in degrees (0: front faces south). */
  yaw?: number;
  /** Turn the front toward this piece or point instead of using `yaw`. */
  faces?: string | { point: [number, number] };
}

/** Specification of a new piece. */
export interface PlaceSpec extends Target {
  kind?: string;
  /** Library model id (alternative to `kind`; give `kind` too when it is not a catalogue kind). */
  asset?: string;
  room: string;
  level?: number;
  /** Handle of the piece (entity id becomes `<building>-<handle>`). */
  id?: string;
  name?: string;
  params?: Record<string, Json>;
  /** Curtains: the window they flank. */
  opening?: string;
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function fail(error: string): EditResult {
  return { ok: false, error };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/** Entity id of a handle in a building. */
export function itemEntityId(building: EntityId, handle: string): EntityId {
  return `${building}-${slug(handle)}`.slice(0, 64);
}

function isNum(v: unknown, lim = MAX_COORD): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
}

function normYaw(y: number): number {
  let v = y % 360;
  if (v > 180) v -= 360;
  if (v <= -180) v += 360;
  return mm(v);
}

function edgeOf(w: SceneWall): RoomEdge {
  return { a: w.a, b: w.b, length: w.length, dir: w.dir, out: w.out, side: w.compass };
}

/** Pose of a floor piece with its back against a wall face at `t`. */
function againstPose(w: SceneWall, t: number, depth: number, gap: number): { x: number; z: number; yaw: number } {
  const off = w.inset + gap + depth / 2;
  return { x: w.a[0] + w.dir[0] * t - w.out[0] * off, z: w.a[1] + w.dir[1] * t - w.out[1] * off, yaw: normYaw(yawFacingIn(edgeOf(w))) };
}

/** Pose of a wall piece hung on a wall face at `t` (its back on the face). */
function hungPose(w: SceneWall, t: number): { x: number; z: number; yaw: number } {
  const off = w.inset + 0.001;
  return { x: w.a[0] + w.dir[0] * t - w.out[0] * off, z: w.a[1] + w.dir[1] * t - w.out[1] * off, yaw: normYaw(yawFacingIn(edgeOf(w))) };
}

function nextHandle(scene: Scene, building: EntityId, base: string): string {
  const taken = new Set(scene.items.map((i) => i.id));
  for (let n = 1; n < 500; n++) {
    const h = `${slug(base)}-${n}`;
    if (!taken.has(itemEntityId(building, h)) && !taken.has(`${building}-${h}`)) return h;
  }
  return `${slug(base)}-${Date.now() % 100000}`;
}

/** Resolve the single building of an edit (or fail with the building list). */
export function resolveBuilding(world: WorldDoc, ref?: string): { id: EntityId; scene: Scene } | { error: string } {
  const ids = Object.values(world.entities).filter((e) => e.arch?.role === 'building').map((e) => e.id);
  let id: string | undefined = ref && ref.length > 0 ? ref : undefined;
  if (!id) {
    if (ids.length === 1) id = ids[0] as string;
    else return { error: ids.length === 0 ? 'there is no building yet: submit a design_plan first' : `which building? pass building: one of ${ids.join(', ')}` };
  }
  if (!hasOwn(world.entities, id) || world.entities[id]?.arch?.role !== 'building') return { error: `no building "${id.slice(0, 40)}"${ids.length > 0 ? `; buildings are ${ids.join(', ')}` : ''}` };
  const scene = readScene(world, id);
  return scene ? { id, scene } : { error: `cannot read building ${id}` };
}

/** What a model needs to know about where a piece ended up. */
export function describePlaced(scene: Scene, it: SceneItem): string {
  const room = scene.rooms.find((r) => r.id === it.room);
  const lines = [itemLine(it, scene) + `, facing ${facingOf(it)}`];
  if (room) {
    if (it.wall) {
      const w = room.walls[it.wall.edge] as SceneWall;
      const t0 = it.wall.t - it.wall.width / 2;
      const t1 = it.wall.t + it.wall.width / 2;
      lines.push(`on the ${w.compass} wall (length ${cmr(w.length)} m): ${cmr(t0).toFixed(2)} m from the left end, ${cmr(w.length - t1).toFixed(2)} m from the right end`);
      const near = w.openings.map((o) => ({ o, gap: Math.max(o.t0 - t1, t0 - o.t1) })).sort((a, b) => a.gap - b.gap)[0];
      if (near) lines.push(`nearest opening ${near.o.id} (${near.o.kind}, t ${near.o.t0}..${near.o.t1}): ${near.gap >= 0 ? `${cmr(near.gap).toFixed(2)} m clear` : `overlap ${cmr(-near.gap).toFixed(2)} m`}`);
    } else if (it.against && it.against.length > 0) {
      for (const a of it.against) {
        const w = room.walls[a.edge] as SceneWall;
        lines.push(`against the ${a.compass} wall (${a.gap <= 0.005 ? 'touching' : `${a.gap.toFixed(2)} m off`}), t ${a.t0}..${a.t1} of ${cmr(w.length)} m: ${cmr(a.t0).toFixed(2)} m from the left end, ${cmr(w.length - a.t1).toFixed(2)} m from the right end`);
      }
    } else if (it.mount === 'floor') {
      const sides = room.walls.map((w) => ({ w, d: -((it.pos[0] - w.a[0]) * w.out[0] + (it.pos[2] - w.a[1]) * w.out[1]) - w.inset })).sort((a, b) => a.d - b.d).slice(0, 2);
      lines.push(`wall distances from its centre: ${sides.map((s) => `${s.w.compass} ${cmr(s.d).toFixed(2)} m`).join(', ')}`);
    }
  }
  const others = scene.items
    .filter((o) => o !== it && o.level === it.level && o.mount !== 'wall' && it.mount !== 'wall')
    .map((o) => ({ o, gap: polygonGap(it.footprint, o.footprint) }))
    .filter((x) => x.gap < 1.0)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 3);
  if (others.length > 0) lines.push(`nearest pieces: ${others.map((x) => `${x.o.kind} ${x.o.id} ${x.gap < 0.005 ? 'touching' : `${cmr(x.gap).toFixed(2)} m ${compassWord(x.o.pos[0] - it.pos[0], x.o.pos[2] - it.pos[2])}`}`).join('; ')}`);
  if (it.mount === 'floor' && partInfo(it.kind) && (partInfo(it.kind)?.frontClearance ?? 0) >= 0.3) {
    const want = partInfo(it.kind)?.frontClearance ?? 0;
    lines.push(`clear floor in front: ${freeFrontDepth(scene, it, Math.max(want, 1.2)).toFixed(2)} m (wants ${want.toFixed(2)})`);
  }
  return lines.join('\n');
}

/** Everything the three audit steps found for the touched pieces. */
const INCOMPLETE_CODES: ReadonlySet<string> = new Set(['room_empty', 'no_light', 'missing_essential', 'plan_missing']);

function audit(before: WorldDoc, patches: Patch[], building: EntityId, ids: ReadonlySet<EntityId>): { world: WorldDoc; scene: Scene; errors: Finding[]; warnings: Finding[] } | { error: string } {
  const res = applyPatches(before, patches);
  if (res.errors.length > 0) return { error: `the change was rejected by the document: ${res.errors.slice(0, 3).map((e) => `${e.op}: ${e.message}`).join('; ')}` };
  const findings = reviewScene(res.world, building, { fast: true }).filter((f) => f.entities.some((e) => ids.has(e)));
  const scene = readScene(res.world, building);
  if (!scene) return { error: 'the building could not be read after the change' };
  const errors = findings.filter((f) => f.severity === 'error');
  // A room being furnished piece by piece is expected to be incomplete: leave those notes to the review.
  const warnings = findings.filter((f) => f.severity !== 'error' && !INCOMPLETE_CODES.has(f.code));
  // Walling a room in: compare walkability before and after (floor pieces only).
  const wasScene = readScene(before, building);
  if (wasScene) {
    const w0 = walkability(wasScene);
    const w1 = walkability(scene);
    const b0 = new Set(w0.blockedRooms.map((b) => b.room.id));
    for (const b of w1.blockedRooms) {
      if (!b0.has(b.room.id)) errors.push({ code: 'blocked_path', severity: 'error', message: `this blocks the way between the doors of ${b.room.key} (no 0.7 m wide path would remain)`, entities: [...ids], room: b.room.key, fix: 'Leave a 0.7 m wide path between the doors, or put it somewhere else.' });
    }
    const u0 = new Set(w0.unreachable.map((u) => u.item.id));
    for (const u of w1.unreachable) {
      if (!u0.has(u.item.id) && !ids.has(u.item.id)) errors.push({ code: 'unreachable_item', severity: 'error', message: `this walls in ${u.item.kind} ${u.item.id}: its front would no longer be reachable on foot`, entities: [...ids, u.item.id], room: u.room.key, fix: `Keep a 0.6 m path to the front of ${u.item.id}.` });
    }
  }
  return { world: res.world, scene, errors, warnings };
}

function refusal(what: string, errors: readonly Finding[]): EditResult {
  const lines = errors.slice(0, 6).map((f) => `- ${f.message}. ${f.fix}`);
  return fail(`${what} refused, nothing changed:\n${lines.join('\n')}${errors.length > 6 ? `\n- … ${errors.length - 6} more problems` : ''}`);
}

function commit(what: string, patches: Patch[], before: WorldDoc, building: EntityId, ids: EntityId[], note: string[] = []): EditResult {
  const a = audit(before, patches, building, new Set(ids));
  if ('error' in a) return fail(a.error);
  if (a.errors.length > 0) return refusal(what, a.errors);
  const touched = a.scene.items.filter((i) => ids.includes(i.id));
  const text = [`${what}: done.`, ...touched.map((i) => describePlaced(a.scene, i)), ...note.map((n) => `note: ${n}`), ...a.warnings.slice(0, 4).map((w) => `heads-up (${w.code}): ${w.message}. ${w.fix}`)].join('\n');
  return { ok: true, patches, message: what.slice(0, 120), text, ids, warnings: a.warnings.map((w) => w.message) };
}

interface Resolved {
  room: SceneRoom;
  /** Wall for wall placements. */
  wall?: SceneWall;
  /** Centre along that wall. */
  t?: number;
}

/** Resolve the wall and `t` of a wall target; refuses a wall that is not usable. */
function resolveWall(room: SceneRoom, tgt: Target, width: number, depth: number, hung: boolean, defaultKind: string): Resolved | { error: string } {
  const w = findWall(room, tgt.wall, tgt.edge);
  if (isLookupError(w)) return w;
  let t = tgt.t;
  if (t === undefined) {
    const n = room.walls.length;
    const prev = room.walls[(w.edge + n - 1) % n]?.inset ?? 0.06;
    const next = room.walls[(w.edge + 1) % n]?.inset ?? 0.06;
    const reach = hung ? mountRule(defaultKind).reach : 0;
    const align = tgt.align ?? 'centre';
    t = align === 'start' ? prev + 0.02 + width / 2 + reach : align === 'end' ? w.length - next - 0.02 - width / 2 - reach : w.length / 2;
  }
  if (!isNum(t, 1000)) return { error: 't must be a number of metres along the wall' };
  void depth;
  return { room, wall: w, t: mm(t) };
}

/** Suggest the nearest valid centre on a wall for a hung piece, as text. */
function suggestWallSpot(scene: Scene, room: SceneRoom, wall: SceneWall, spec: MountSpec, ignore: ReadonlySet<string>, anchor?: string): string {
  const c = nearestMountCentre(wall.length, spec, wallBlockers(scene, room, wall, ignore), anchor);
  return c === null ? `The ${wall.compass} wall of ${room.key} has no clear stretch ${cmr(spec.width).toFixed(2)} m wide at that height; try another wall or a narrower piece` : `The nearest clear spot on the ${wall.compass} wall is t = ${cmr(c).toFixed(2)}`;
}

function defaultSizeFor(kind: string, params: Record<string, Json>): [number, number, number] | null {
  const def = furnitureByKind(kind);
  return def ? furnitureSize(def, params) : null;
}

/** Facing yaw toward a target piece or point from (x, z). */
function yawToward(scene: Scene, from: [number, number], faces: NonNullable<Target['faces']>): number | { error: string } {
  let p: [number, number];
  if (typeof faces === 'string') {
    const it = findItem(scene, faces);
    if (isLookupError(it)) return it;
    p = [it.pos[0], it.pos[2]];
  } else {
    if (!isNum(faces.point[0]) || !isNum(faces.point[1])) return { error: 'faces.point must be [x, z] in metres' };
    p = faces.point;
  }
  const dx = p[0] - from[0];
  const dz = p[1] - from[1];
  if (Math.hypot(dx, dz) < 1e-6) return { error: 'cannot face a point at the same place' };
  return normYaw((Math.atan2(dx, dz) * 180) / Math.PI);
}

/** Place a new piece. */
export function placeItem(world: WorldDoc, buildingRef: string | undefined, spec: PlaceSpec): EditResult {
  const b = resolveBuilding(world, buildingRef);
  if ('error' in b) return fail(b.error);
  const { scene } = b;
  const room = findRoom(scene, spec.room, spec.level);
  if (isLookupError(room)) return fail(room.error);
  const kindWanted = typeof spec.kind === 'string' ? spec.kind.trim().toLowerCase() : '';
  if (!kindWanted && !spec.asset) return fail(`say what to place: kind is one of ${partKinds().join(', ')} (or an asset id)`);
  const def = kindWanted ? furnitureByKind(kindWanted) : undefined;
  let assetInfo: { id: string; size: [number, number, number]; placement?: string } | undefined;
  if (spec.asset) {
    if (typeof spec.asset !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(spec.asset)) return fail('asset must be a library asset id (see search_assets)');
    const entry = catalogEntry(spec.asset);
    const size = entry ? assetShapeSize({ id: spec.asset }) : null;
    if (!entry || !size) return fail(`unknown library asset "${spec.asset.slice(0, 60)}": find ids with search_assets`);
    assetInfo = { id: spec.asset, size, ...(entry.placement ? { placement: entry.placement } : {}) };
  }
  if (!def && !assetInfo) return fail(`unknown kind "${kindWanted.slice(0, 40)}": the parts are ${partKinds().join(', ')}`);
  // A catalogue kind carries the mount and parameters; a bare library asset is a generic floor / wall piece.
  const mount = def ? def.mount : assetInfo?.placement === 'wall' ? 'wall' : assetInfo?.placement === 'ceiling' ? 'ceiling' : 'floor';
  if (!def) return fail('place a library asset by giving its catalogue kind too (for example kind "sofa" with asset "sofa-classic"); generic assets are not supported yet');
  const given = spec.params && typeof spec.params === 'object' && !Array.isArray(spec.params) ? spec.params : {};
  const { params, notes } = resolvePartParams(def, given);
  const size = assetInfo ? assetInfo.size : (defaultSizeFor(def.kind, params) as [number, number, number]);
  const handle = spec.id ? slug(spec.id) : nextHandle(scene, b.id, def.kind);
  if (!handle || !ID_RE.test(handle)) return fail('id must be a short lowercase slug (letters, digits, dashes)');
  const entityId = itemEntityId(b.id, handle);
  if (scene.items.some((i) => i.id === entityId) || hasOwn(world.entities, entityId)) return fail(`"${entityId}" already exists: choose another id, or use move / resize on it`);
  if (def.kind === 'curtain') return placeCurtain(world, b.id, scene, room, spec, handle, params, notes);

  let pos: [number, number, number];
  let yaw = 0;
  const levelId = room.levelId;
  if (spec.on !== undefined) {
    if (mount !== 'surface') return fail(`${def.kind} is a ${mount} piece: "on" is for pieces that stand on a table or cabinet (table-lamp)`);
    const host = findItem(scene, spec.on);
    if (isLookupError(host)) return fail(host.error);
    if (host.mount !== 'floor') return fail(`${host.id} is a ${host.mount} piece and cannot carry ${def.kind}`);
    const off = spec.offset ?? [0, 0];
    if (!isNum(off[0], 5) || !isNum(off[1], 5)) return fail('offset must be [across, depth] in metres, within the host');
    const t = (host.yaw * Math.PI) / 180;
    const x = host.pos[0] + off[0] * Math.cos(t) + off[1] * Math.sin(t);
    const z = host.pos[2] - off[0] * Math.sin(t) + off[1] * Math.cos(t);
    pos = [mm(x), mm(host.y1), mm(z)];
    yaw = spec.yaw !== undefined ? normYaw(spec.yaw) : host.yaw;
    if (Math.abs(off[0]) > host.size[0] / 2 || Math.abs(off[1]) > host.size[2] / 2) return fail(`offset ${off[0]}, ${off[1]} is off ${host.id} (it spans ±${cmr(host.size[0] / 2)} across and ±${cmr(host.size[2] / 2)} deep)`);
    return finishPlace(world, b.id, scene, room, def, assetInfo, params, notes, entityId, spec, pos, yaw, levelId);
  }
  if (mount === 'wall') {
    if (spec.wall === undefined && spec.edge === undefined) return fail(`${def.kind} hangs on a wall: give wall (north, south, east or west) and t (metres along it, see query_wall)`);
    const r = resolveWall(room, spec, size[0], size[2], true, def.kind);
    if ('error' in r) return fail(r.error);
    const wall = r.wall as SceneWall;
    const t = r.t as number;
    const y = spec.y !== undefined ? spec.y : defaultWallBottom(def.kind, size[1], room.ceiling);
    if (!isNum(y, 50) || y < 0 || y + size[1] > room.ceiling + 0.02) return fail(`y must keep the piece between the floor and the ceiling: bottom from 0 to ${cmr(room.ceiling - size[1]).toFixed(2)} m for a ${cmr(size[1]).toFixed(2)} m tall ${def.kind}`);
    const pose = hungPose(wall, t);
    pos = [mm(pose.x), mm(y), mm(pose.z)];
    yaw = pose.yaw;
    const mspec: MountSpec = { kind: def.kind, t, width: size[0], y0: y, y1: y + size[1] };
    const hits = collisions(mspec, wallBlockers(scene, room, wall), undefined, 0.005);
    if (hits.length > 0) {
      const what = hits.map((h) => (h.kind === 'door' || h.kind === 'window' ? `${h.kind} ${h.ref ?? ''} (t ${cmr(h.t0).toFixed(2)}..${cmr(h.t1).toFixed(2)})` : h.kind === 'corner' ? 'the wall end' : `${h.kind} ${h.ref ?? ''}`)).join(', ');
      return fail(`${def.kind} at t=${cmr(t).toFixed(2)} (${cmr(t - size[0] / 2).toFixed(2)}..${cmr(t + size[0] / 2).toFixed(2)}, y ${cmr(y).toFixed(2)}..${cmr(y + size[1]).toFixed(2)}) would overlap ${what} on the ${wall.compass} wall of ${room.key}. ${suggestWallSpot(scene, room, wall, mspec, new Set())}.`);
    }
    return finishPlace(world, b.id, scene, room, def, assetInfo, params, notes, entityId, spec, pos, yaw, levelId);
  }
  if (mount === 'ceiling') {
    if (!spec.at || !isNum(spec.at[0]) || !isNum(spec.at[1])) return fail(`${def.kind} hangs from the ceiling: give at [x, z] inside ${room.key} (x ${cmr(room.bbox[0])}..${cmr(room.bbox[2])}, z ${cmr(room.bbox[1])}..${cmr(room.bbox[3])})`);
    pos = [mm(spec.at[0]), mm(room.ceiling), mm(spec.at[1])];
    yaw = spec.yaw !== undefined ? normYaw(spec.yaw) : 0;
    return finishPlace(world, b.id, scene, room, def, assetInfo, params, notes, entityId, spec, pos, yaw, levelId);
  }
  if (mount === 'surface') return fail(`${def.kind} stands on another piece: give on (the id of the table or cabinet)`);
  // Floor piece: against a wall, or at a point.
  if (spec.wall !== undefined || spec.edge !== undefined) {
    const r = resolveWall(room, spec, size[0], size[2], false, def.kind);
    if ('error' in r) return fail(r.error);
    const wall = r.wall as SceneWall;
    const t = r.t as number;
    const gap = spec.gap !== undefined ? spec.gap : GAP_DEFAULT;
    if (!isNum(gap, 3) || gap < 0) return fail('gap must be 0 or more metres');
    const p = againstPose(wall, t, size[2], gap);
    pos = [mm(p.x), 0, mm(p.z)];
    yaw = p.yaw;
    if (spec.yaw !== undefined) yaw = normYaw(spec.yaw);
  } else if (spec.at) {
    if (!isNum(spec.at[0]) || !isNum(spec.at[1])) return fail('at must be [x, z] in metres');
    pos = [mm(spec.at[0]), 0, mm(spec.at[1])];
    yaw = spec.yaw !== undefined ? normYaw(spec.yaw) : 0;
    if (spec.faces !== undefined) {
      const y = yawToward(scene, [spec.at[0], spec.at[1]], spec.faces);
      if (typeof y !== 'number') return fail(y.error);
      yaw = y;
    }
  } else return fail(`${def.kind} needs a position: at [x, z] (inside ${room.key}: x ${cmr(room.bbox[0])}..${cmr(room.bbox[2])}, z ${cmr(room.bbox[1])}..${cmr(room.bbox[3])}), or wall + t to stand against a wall`);
  return finishPlace(world, b.id, scene, room, def, assetInfo, params, notes, entityId, spec, pos, yaw, levelId);
}

function finishPlace(
  world: WorldDoc,
  building: EntityId,
  scene: Scene,
  room: SceneRoom,
  def: NonNullable<ReturnType<typeof furnitureByKind>>,
  assetInfo: { id: string; size: [number, number, number] } | undefined,
  params: Record<string, Json>,
  notes: string[],
  entityId: EntityId,
  spec: PlaceSpec,
  pos: [number, number, number],
  yaw: number,
  levelId: EntityId,
): EditResult {
  const ent = itemEntity({
    id: entityId,
    def,
    params,
    pos,
    yaw,
    room: room.id,
    levelId,
    level: room.level,
    ...(spec.name ? { name: spec.name.slice(0, 80) } : {}),
    ...(assetInfo ? { asset: { id: assetInfo.id, size: assetInfo.size } } : {}),
    ...(def.kind === 'pendant' || def.kind === 'ceiling-light' ? { light: fittingLight(Math.hypot(room.bbox[2] - room.bbox[0], room.bbox[3] - room.bbox[1]) * 1.1) } : {}),
  });
  const parsed = Entity.safeParse(ent);
  if (!parsed.success) return fail(`could not build the ${def.kind}: ${parsed.error.issues.slice(0, 2).map((i) => i.message).join('; ')}`);
  void scene;
  return commit(`Place ${def.kind} ${entityId}`, [{ op: 'add', entity: ent } as Patch], world, building, [entityId], notes);
}

/** Curtains: a panel each side of a window, hung with the wall-space rules. */
function placeCurtain(world: WorldDoc, building: EntityId, scene: Scene, room: SceneRoom, spec: PlaceSpec, handle: string, params: Record<string, Json>, notes: string[]): EditResult {
  const def = furnitureByKind('curtain');
  if (!def) return fail('curtains are not available');
  if (!spec.opening) return fail('a curtain hangs beside a window: give opening (the window id from query_wall), never a door or a bare wall');
  const found = findOpening(scene, spec.opening, room);
  if (isLookupError(found)) return fail(found.error);
  const { opening, wall, room: openRoom } = found;
  if (openRoom.id !== room.id) return fail(`window ${opening.id} belongs to ${openRoom.key}, not ${room.key}`);
  if (opening.kind !== 'window') return fail(`${opening.id} is a ${opening.kind}, not a window: a curtain over it would hide the way through. Curtains go beside windows only`);
  const len = opening.t1 - opening.t0;
  // The caller may ask for the gathered width of one panel (the photo shows it); otherwise it follows the window.
  const askedWidth = spec.params && typeof spec.params['width'] === 'number' && Number.isFinite(spec.params['width']) ? Math.min(2.5, Math.max(0.3, spec.params['width'])) : null;
  const full = askedWidth ?? Math.min(0.9, Math.max(0.45, len * 0.28));
  const sillLength = ['kitchen', 'bathroom', 'laundry', 'cafe', 'terrace'].includes(String(room.type)) && opening.sill > 0.5;
  const y0 = sillLength ? Math.max(0, opening.sill - 0.1) : 0;
  const top = sillLength ? opening.top + 0.12 : Math.max(1.3, room.ceiling - 0.04);
  // The drop the photo shows (floor-length to the eaves, not to a vaulted ridge) when the caller gave one.
  const askedHeight = spec.params && typeof spec.params['height'] === 'number' && Number.isFinite(spec.params['height']) ? Math.min(6, Math.max(0.8, spec.params['height'])) : null;
  const height = Math.max(0.8, askedHeight !== null ? Math.min(top - y0, askedHeight) : top - y0);
  const color = typeof params['color'] === 'string' ? (params['color'] as string) : '#d8d2c6';
  const blockers = wallBlockers(scene, room, wall);
  const patches: Patch[] = [];
  const ids: EntityId[] = [];
  const hung: string[] = [];
  const nEdges = room.walls.length;
  const prevInset = room.walls[(wall.edge + nEdges - 1) % nEdges]?.inset ?? 0.06;
  const nextInset = room.walls[(wall.edge + 1) % nEdges]?.inset ?? 0.06;
  for (const side of [-1, 1] as const) {
    // A window near a corner has no room for a whole panel beside it: the panel then gathers flush into the corner and
    // overlaps the glass edge, as hung curtains do. Tried after the panels that fit beside the window.
    const candidates: Array<{ panel: number; t: number }> = [];
    for (const f of [1, 0.8, 0.62, 0.48]) {
      const panel = full * f;
      if (panel < 0.35) break;
      candidates.push({ panel, t: side < 0 ? opening.t0 + 0.08 - panel / 2 : opening.t1 - 0.08 + panel / 2 });
    }
    {
      // Room between the corner (rod included) and the part of the glass a panel may not cover.
      const outer = side < 0 ? prevInset + 0.04 + 0.08 + 0.015 : wall.length - nextInset - 0.04 - 0.08 - 0.015; // panel edge, rod reach already allowed
      const inner = side < 0 ? opening.t0 + CURTAIN_WINDOW_OVERLAP - 0.08 - 0.015 : opening.t1 - CURTAIN_WINDOW_OVERLAP + 0.08 + 0.015; // the glass a panel may not cover, rod reach allowed
      const avail = Math.abs(outer - inner);
      for (const f of [1, 0.85, 0.7]) {
        const panel = Math.min(full * f, avail);
        if (panel < 0.25) break;
        candidates.push({ panel, t: side < 0 ? outer + panel / 2 : outer - panel / 2 });
      }
    }
    for (const { panel, t } of candidates) {
      const mspec: MountSpec = { kind: 'curtain', t, width: panel, y0, y1: y0 + height };
      if (collisions(mspec, blockers, opening.id, 0.005).length > 0) continue;
      const pose = hungPose(wall, t);
      const id = itemEntityId(building, `${handle}-${side < 0 ? 'l' : 'r'}`);
      const ent = itemEntity({ id, def, params: { ...params, width: Math.round(panel * 100) / 100, height: Math.round(height * 100) / 100, color }, pos: [mm(pose.x), mm(y0), mm(pose.z)], yaw: pose.yaw, name: 'Curtain', room: room.id, levelId: room.levelId, level: room.level });
      patches.push({ op: 'add', entity: ent } as Patch);
      ids.push(id);
      hung.push(`${side < 0 ? 'left' : 'right'} panel ${id} (${cmr(panel).toFixed(2)} m wide at t ${cmr(t).toFixed(2)})`);
      break;
    }
  }
  if (patches.length === 0) return fail(`no room for curtain panels beside window ${opening.id} on the ${wall.compass} wall of ${room.key}: a door, a corner or furniture is too close on both sides`);
  const res = commit(`Hang curtains at window ${opening.id}`, patches, world, building, ids, notes);
  if (res.ok) res.text = `${res.text}\ncurtain: ${hung.join(' and ')}${hung.length === 1 ? '; the other side had no room' : ''}`;
  return res;
}

/** The piece the tools operate on (a curtain handle also names its two panels). */
function resolveItems(scene: Scene, ref: unknown, building: EntityId): SceneItem[] | { error: string } {
  const direct = findItem(scene, ref);
  if (!isLookupError(direct)) return [direct];
  if (typeof ref === 'string') {
    const base = itemEntityId(building, ref.replace(new RegExp(`^${building}-`), ''));
    const panels = scene.items.filter((i) => i.id === `${base}-l` || i.id === `${base}-r`);
    if (panels.length > 0) return panels;
  }
  return direct;
}

function targetOf(spec: Target, base: PlaceSpec): PlaceSpec {
  return { ...base, ...spec };
}

/** Move a piece to a new target (same vocabulary as {@link placeItem}). */
export function moveItem(world: WorldDoc, buildingRef: string | undefined, ref: string, target: Target): EditResult {
  const b = resolveBuilding(world, buildingRef);
  if ('error' in b) return fail(b.error);
  const items = resolveItems(b.scene, ref, b.id);
  if ('error' in items) return fail(items.error);
  if (items.length !== 1) return fail(`${ref} names ${items.length} panels: move each panel by its own id (${items.map((i) => i.id).join(', ')})`);
  const it = items[0] as SceneItem;
  const room = b.scene.rooms.find((r) => r.id === it.room);
  if (!room) return fail(`${it.id} is not inside a room`);
  const next = poseFor(b.scene, room, it, target);
  if ('error' in next) return fail(next.error);
  const patches: Patch[] = [{ op: 'update', id: it.id, set: { transform: { position: next.pos, rotation: [0, next.yaw, 0] } } } as unknown as Patch];
  const moved = describeMove(it, next.pos, next.yaw);
  return commit(`Move ${it.kind} ${it.id}`, patches, world, b.id, [it.id], [moved]);
}

function describeMove(it: SceneItem, pos: [number, number, number], yaw: number): string {
  return `moved ${describeOffset(pos[0] - it.pos[0], pos[2] - it.pos[2])}${Math.abs(normYaw(yaw - it.yaw)) > 0.5 ? `, turned ${cmr(normYaw(yaw - it.yaw))}°` : ''}`;
}

/** New pose of an existing piece for a target (validation happens in the audit). */
function poseFor(scene: Scene, room: SceneRoom, it: SceneItem, tgt: Target): { pos: [number, number, number]; yaw: number } | { error: string } {
  const [w, h, d] = it.size;
  if (it.mount === 'wall') {
    const wall0 = tgt.wall === undefined && tgt.edge === undefined ? (it.wall ? room.walls[it.wall.edge] : undefined) : undefined;
    const spec: Target = wall0 ? { ...tgt, wall: wall0.compass, edge: wall0.edge } : tgt;
    if (spec.wall === undefined && spec.edge === undefined) return { error: `${it.id} hangs on a wall: give wall and t` };
    const r = resolveWall(room, { ...spec, t: spec.t ?? it.wall?.t }, w, d, true, it.kind);
    if ('error' in r) return r;
    const y = tgt.y !== undefined ? tgt.y : it.y0;
    if (!isNum(y, 50) || y < 0 || y + h > room.ceiling + 0.02) return { error: `y must keep the piece between the floor and the ceiling: bottom from 0 to ${cmr(room.ceiling - h).toFixed(2)} m` };
    const p = hungPose(r.wall as SceneWall, r.t as number);
    return { pos: [mm(p.x), mm(y), mm(p.z)], yaw: p.yaw };
  }
  if (it.mount === 'surface') {
    if (tgt.on === undefined && tgt.at === undefined) return { error: `${it.id} stands on a piece: give on (host id) and offset, or at [x, z] on the host` };
    const host = tgt.on !== undefined ? findItem(scene, tgt.on) : scene.items.find((o) => o.mount === 'floor' && o.footprint.length > 0 && Math.abs(o.y1 - it.y0) < 0.05 && Math.hypot(o.pos[0] - it.pos[0], o.pos[2] - it.pos[2]) < Math.max(o.size[0], o.size[2]));
    if (!host || isLookupError(host)) return { error: host && isLookupError(host) ? host.error : 'no host piece there' };
    const off = tgt.offset ?? [0, 0];
    const t = (host.yaw * Math.PI) / 180;
    return { pos: [mm(host.pos[0] + off[0] * Math.cos(t) + off[1] * Math.sin(t)), mm(host.y1), mm(host.pos[2] - off[0] * Math.sin(t) + off[1] * Math.cos(t))], yaw: tgt.yaw !== undefined ? normYaw(tgt.yaw) : host.yaw };
  }
  if (it.mount === 'ceiling') {
    if (tgt.at === undefined && tgt.yaw === undefined) return { error: `${it.kind} ${it.id} hangs from the ceiling: move it with at [x, z] (it is at ${cmr(it.pos[0])}, ${cmr(it.pos[2])}); it cannot go on a wall` };
    const at = tgt.at ?? [it.pos[0], it.pos[2]];
    if (!isNum(at[0]) || !isNum(at[1])) return { error: 'at must be [x, z] in metres' };
    return { pos: [mm(at[0]), it.pos[1], mm(at[1])], yaw: tgt.yaw !== undefined ? normYaw(tgt.yaw) : it.yaw };
  }
  if (tgt.wall !== undefined || tgt.edge !== undefined) {
    const r = resolveWall(room, tgt, w, d, false, it.kind);
    if ('error' in r) return r;
    const gap = tgt.gap !== undefined ? tgt.gap : GAP_DEFAULT;
    if (!isNum(gap, 3) || gap < 0) return { error: 'gap must be 0 or more metres' };
    const p = againstPose(r.wall as SceneWall, r.t as number, d, gap);
    return { pos: [mm(p.x), 0, mm(p.z)], yaw: tgt.yaw !== undefined ? normYaw(tgt.yaw) : p.yaw };
  }
  if (tgt.at) {
    if (!isNum(tgt.at[0]) || !isNum(tgt.at[1])) return { error: 'at must be [x, z] in metres' };
    let yaw = tgt.yaw !== undefined ? normYaw(tgt.yaw) : it.yaw;
    if (tgt.faces !== undefined) {
      const y = yawToward(scene, tgt.at, tgt.faces);
      if (typeof y !== 'number') return y;
      yaw = y;
    }
    return { pos: [mm(tgt.at[0]), 0, mm(tgt.at[1])], yaw };
  }
  return { error: `say where: at [x, z], or wall + t (current position ${cmr(it.pos[0])}, ${cmr(it.pos[2])})` };
}

/** Turn a piece: absolute `yaw`, a `delta`, or toward a piece / point. */
export function rotateItem(world: WorldDoc, buildingRef: string | undefined, ref: string, opts: { yaw?: number; delta?: number; faces?: string | { point: [number, number] } }): EditResult {
  const b = resolveBuilding(world, buildingRef);
  if ('error' in b) return fail(b.error);
  const items = resolveItems(b.scene, ref, b.id);
  if ('error' in items) return fail(items.error);
  if (items.length !== 1) return fail(`${ref} names ${items.length} panels; rotate one by its id`);
  const it = items[0] as SceneItem;
  if (it.mount === 'wall') return fail(`${it.id} hangs flat on a wall: use move to change its wall, not rotate`);
  let yaw: number;
  if (opts.faces !== undefined) {
    const y = yawToward(b.scene, [it.pos[0], it.pos[2]], opts.faces);
    if (typeof y !== 'number') return fail(y.error);
    yaw = y;
  } else if (opts.yaw !== undefined) {
    if (!isNum(opts.yaw, 100000)) return fail('yaw must be a number of degrees');
    yaw = normYaw(opts.yaw);
  } else if (opts.delta !== undefined) {
    if (!isNum(opts.delta, 100000)) return fail('delta must be a number of degrees');
    yaw = normYaw(it.yaw + opts.delta);
  } else return fail('give yaw (absolute degrees, 0 faces south), delta, or faces');
  const patches: Patch[] = [{ op: 'update', id: it.id, set: { transform: { rotation: [0, yaw, 0] } } } as unknown as Patch];
  return commit(`Rotate ${it.kind} ${it.id}`, patches, world, b.id, [it.id], [`now facing ${compassWord(Math.sin((yaw * Math.PI) / 180), Math.cos((yaw * Math.PI) / 180))} (yaw ${yaw}°)`]);
}

/** Change a piece's parameters (size, colour, finish); a piece against a wall stays against it, a hung piece keeps its spot. */
export function resizeItem(world: WorldDoc, buildingRef: string | undefined, ref: string, params: Record<string, Json>): EditResult {
  const b = resolveBuilding(world, buildingRef);
  if ('error' in b) return fail(b.error);
  const items = resolveItems(b.scene, ref, b.id);
  if ('error' in items) return fail(items.error);
  if (typeof params !== 'object' || params === null || Array.isArray(params) || Object.keys(params).length === 0) return fail('params is required: for example {"width": 2.2}');
  const patches: Patch[] = [];
  const notes: string[] = [];
  for (const it of items) {
    const e = world.entities[it.id];
    if (!e || e.shape.kind !== 'procedural') return fail(`${it.id} is not a parametric piece (its size comes from a library model); remove it and place another`);
    const def = furnitureByKind(it.kind);
    if (!def) return fail(`${it.id} has no parameters to change`);
    const merged = { ...e.shape.params, ...params };
    const { params: resolved, notes: n } = resolvePartParams(def, merged);
    notes.push(...n.map((x) => `${it.id}: ${x}`));
    const size = furnitureSize(def, resolved);
    const set: Record<string, unknown> = { shape: { params: resolved } };
    const room = b.scene.rooms.find((r) => r.id === it.room);
    if (room && it.mount === 'floor' && it.against && it.against.length > 0) {
      // Keep the back on the same wall at the same centre.
      const ag = it.against.slice().sort((x, y) => x.gap - y.gap)[0] as NonNullable<SceneItem['against']>[number];
      const wall = room.walls[ag.edge] as SceneWall;
      const t = (it.pos[0] - wall.a[0]) * wall.dir[0] + (it.pos[2] - wall.a[1]) * wall.dir[1];
      const aligned = Math.abs(((it.yaw - normYaw(yawFacingIn(edgeOf(wall)))) % 360 + 540) % 360 - 180) < 8;
      if (aligned) {
        const p = againstPose(wall, t, size[2], ag.gap);
        set['transform'] = { position: [mm(p.x), it.pos[1], mm(p.z)] };
      }
    } else if (room && it.mount === 'wall' && it.wall) {
      const wall = room.walls[it.wall.edge] as SceneWall;
      const p = hungPose(wall, it.wall.t);
      set['transform'] = { position: [mm(p.x), it.pos[1], mm(p.z)] };
    }
    patches.push({ op: 'update', id: it.id, set } as unknown as Patch);
  }
  return commit(`Resize ${items.map((i) => i.id).join(', ')}`, patches, world, b.id, items.map((i) => i.id), notes);
}

/** Remove a piece (a curtain handle removes both panels). */
export function removeItem(world: WorldDoc, buildingRef: string | undefined, ref: string): EditResult {
  const b = resolveBuilding(world, buildingRef);
  if ('error' in b) return fail(b.error);
  const items = resolveItems(b.scene, ref, b.id);
  if ('error' in items) return fail(items.error);
  const locked = items.find((i) => world.entities[i.id]?.locked);
  if (locked) return fail(`${locked.id} is locked by the user: it cannot be removed by the agent`);
  const patches: Patch[] = items.map((i) => ({ op: 'remove', id: i.id }) as Patch);
  const res = applyPatches(world, patches);
  if (res.errors.length > 0) return fail(`could not remove: ${res.errors[0]?.message ?? 'rejected'}`);
  return { ok: true, patches, message: `Remove ${items.map((i) => i.id).join(', ')}`.slice(0, 120), text: `removed ${items.map((i) => `${i.kind} ${i.id}`).join(', ')}`, ids: items.map((i) => i.id), warnings: [] };
}

/** Put a piece against (floor) or on (wall) a wall: sugar for move with wall alignment. */
export function snapToWall(world: WorldDoc, buildingRef: string | undefined, ref: string, opts: { wall?: string; edge?: number; t?: number; align?: 'centre' | 'start' | 'end'; gap?: number }): EditResult {
  const b = resolveBuilding(world, buildingRef);
  if ('error' in b) return fail(b.error);
  const items = resolveItems(b.scene, ref, b.id);
  if ('error' in items) return fail(items.error);
  if (items.length !== 1) return fail(`${ref} names ${items.length} panels; snap one by its id`);
  const it = items[0] as SceneItem;
  const room = b.scene.rooms.find((r) => r.id === it.room);
  if (!room) return fail(`${it.id} is not inside a room`);
  if (opts.wall === undefined && opts.edge === undefined) {
    // Nearest wall of the room (by the piece's back for floor pieces).
    const nearest = room.walls.map((w) => ({ w, d: Math.abs(-((it.pos[0] - w.a[0]) * w.out[0] + (it.pos[2] - w.a[1]) * w.out[1]) - w.inset) })).sort((a, c) => a.d - c.d)[0];
    if (!nearest) return fail('the room has no walls');
    opts = { ...opts, edge: nearest.w.edge };
  }
  const keepT = opts.t === undefined && opts.align === undefined;
  let t = opts.t;
  if (keepT) {
    const wall = findWall(room, opts.wall, opts.edge);
    if (isLookupError(wall)) return fail(wall.error);
    t = (it.pos[0] - wall.a[0]) * wall.dir[0] + (it.pos[2] - wall.a[1]) * wall.dir[1];
  }
  const target: Target = { ...(opts.wall !== undefined ? { wall: opts.wall } : {}), ...(opts.edge !== undefined ? { edge: opts.edge } : {}), ...(t !== undefined ? { t: Math.max(0, t) } : {}), ...(opts.align ? { align: opts.align } : {}), ...(opts.gap !== undefined ? { gap: opts.gap } : {}) };
  return moveItem(world, buildingRef, ref, target);
}

/** Align a piece with an opening: centred on it, or (curtains) flanking a window. */
export function anchorToOpening(world: WorldDoc, buildingRef: string | undefined, ref: string, opts: { opening: string; mode?: 'centre' | 'left' | 'right'; gap?: number; y?: number }): EditResult {
  const b = resolveBuilding(world, buildingRef);
  if ('error' in b) return fail(b.error);
  const items = resolveItems(b.scene, ref, b.id);
  if ('error' in items) return fail(items.error);
  if (items.length !== 1) return fail(`${ref} names ${items.length} panels; anchor one by its id (or remove and place the curtain again)`);
  const it = items[0] as SceneItem;
  const room = b.scene.rooms.find((r) => r.id === it.room);
  if (!room) return fail(`${it.id} is not inside a room`);
  const found = findOpening(b.scene, opts.opening, room);
  if (isLookupError(found)) return fail(found.error);
  const { opening, wall } = found;
  if (found.room.id !== room.id) return fail(`${opening.id} is in ${found.room.key}, not ${room.key}`);
  const mode = opts.mode ?? 'centre';
  const w = it.size[0];
  let t: number;
  if (it.kind === 'curtain') {
    if (opening.kind !== 'window') return fail(`${opening.id} is a ${opening.kind}: curtains belong beside windows only`);
    t = mode === 'right' ? opening.t1 - 0.08 + w / 2 : opening.t0 + 0.08 - w / 2;
  } else if (mode === 'left') t = opening.t0 - (opts.gap ?? 0.1) - w / 2;
  else if (mode === 'right') t = opening.t1 + (opts.gap ?? 0.1) + w / 2;
  else t = opening.centre;
  if (it.mount === 'wall') return moveItem(world, buildingRef, ref, { edge: wall.edge, t, ...(opts.y !== undefined ? { y: opts.y } : {}) });
  return moveItem(world, buildingRef, ref, { edge: wall.edge, t, ...(opts.gap !== undefined && it.kind !== 'curtain' ? {} : {}) });
}

/** Centre a piece horizontally over (or beside) another and set its height relative to it. */
export function centerOver(world: WorldDoc, buildingRef: string | undefined, ref: string, targetRef: string, opts: { gap?: number } = {}): EditResult {
  const b = resolveBuilding(world, buildingRef);
  if ('error' in b) return fail(b.error);
  const items = resolveItems(b.scene, ref, b.id);
  if ('error' in items) return fail(items.error);
  if (items.length !== 1) return fail(`${ref} names ${items.length} panels; use one id`);
  const it = items[0] as SceneItem;
  const tg = findItem(b.scene, targetRef);
  if (isLookupError(tg)) return fail(tg.error);
  const room = b.scene.rooms.find((r) => r.id === it.room);
  if (!room) return fail(`${it.id} is not inside a room`);
  const gap = opts.gap !== undefined ? opts.gap : 0.25;
  if (!isNum(gap, 3)) return fail('gap must be a number of metres');
  if (it.mount === 'wall') {
    // Same wall as the target: a floor piece against it, or a piece hung on it.
    const onWall = tg.wall ? { edge: tg.wall.edge, t: tg.wall.t } : tg.against && tg.against[0] ? { edge: tg.against[0].edge, t: (tg.against[0].t0 + tg.against[0].t1) / 2 } : null;
    if (!onWall) return fail(`${tg.id} is not against or on a wall, so there is no wall to centre ${it.id} on: use move with wall and t`);
    const wall = room.walls[onWall.edge] as SceneWall;
    // Centre of the target along the wall: a rotated piece's footprint extent, not its origin.
    const t = onWall.t;
    const y = tg.y1 + gap;
    return moveItem(world, buildingRef, ref, { edge: wall.edge, t, y });
  }
  if (it.mount === 'floor') {
    // Floor piece centred beside the target on its facing axis: put it at the target's x/z.
    return moveItem(world, buildingRef, ref, { at: [tg.pos[0], tg.pos[2]], yaw: it.yaw });
  }
  return fail(`centre_over applies to wall pieces (pictures over a bed) and floor pieces; ${it.id} is a ${it.mount} piece`);
}

/** Opening info for tools that need to list what a wall has (used by the tool layer). */
export function openingsOf(scene: Scene): SceneOpening[] {
  return scene.rooms.flatMap((r) => r.walls.flatMap((w) => w.openings));
}
