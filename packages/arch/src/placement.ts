/**
 * Placement analysis: audits the wall-mounted pieces of a World IR document
 * (pictures, mirrors, TVs, whiteboards, sconces, switches, curtains) against
 * the openings of the wall they hang on and against each other.
 *
 * - a piece that overlaps a door, a window, the wall end or another wall
 *   piece is reported with the wall (and its compass side), the offsets and
 *   the entity ids;
 * - a curtain that is not beside a window (a curtain over a door, or in the
 *   middle of a blank wall) is reported;
 * - every report carries a minimal fix: the nearest clear spot on the same
 *   wall (a new position), or removal when the wall has no room.
 *
 * It is computed from the document alone, with the same wall-space rules the
 * layout uses to place the pieces (`wall-space.ts`), so it audits generated
 * rooms, edited rooms and rooms an agent hand-built the same way.
 */
import { resolveSelector, type Entity, type EntityId, type WorldDoc } from '@aether/core';
import { furnitureOfEntity } from './furniture/assets';
import { obb } from './layout';
import { pointInPolygon, rotateYaw, type P2 } from './math2';
import { compassOf } from './rooms';
import { WallParams } from './params';
import { placedPolygon } from './entity-geom';
import { collisions, CURTAIN_WINDOW_OVERLAP, mountExtent, nearestMountCentre, WALL_MOUNT_KINDS, type MountSpec, type WallBlocker } from './wall-space';

/** One wall-mounted piece resolved onto its wall. */
export interface WallMount {
  id: EntityId;
  kind: string;
  name: string;
  room?: string;
  /** Wall entity and the side of it the piece hangs on. */
  wall: EntityId;
  side: 'A' | 'B';
  /** Compass name of the side ("north wall"). */
  compass: string;
  /** Centre along the wall (metres from its start). */
  t: number;
  width: number;
  y0: number;
  y1: number;
}

/** One opening of a wall, in the same terms. */
export interface WallOpeningInfo {
  kind: 'door' | 'window' | 'opening';
  t: number;
  width: number;
  sill: number;
  height: number;
}

/** A wall seen from one side: its openings and the pieces hanging on it. */
export interface WallView {
  wall: EntityId;
  side: 'A' | 'B';
  compass: string;
  room?: string;
  length: number;
  openings: WallOpeningInfo[];
  mounts: WallMount[];
}

export interface PlacementFix {
  entity: EntityId;
  /** New position (same parent frame) for a move; omitted when `remove`. */
  position?: [number, number, number];
  /** The wall has no clear stretch: delete the piece. */
  remove?: boolean;
}

export interface PlacementIssue {
  code: 'wall_item_on_opening' | 'wall_item_overlap' | 'curtain_off_window';
  message: string;
  hint: string;
  entities: EntityId[];
  wall: EntityId;
  compass: string;
  room?: string;
  /** Offset of the offending piece along the wall (metres). */
  t: number;
  fix: PlacementFix;
}

interface WallFrame {
  entity: Entity;
  params: ReturnType<typeof WallParams.parse>;
  pos: [number, number, number];
  yaw: number;
  parent: string | null;
}

/** Half a metre either way of the nominal sizes is not worth reporting. */
const NEAR_WINDOW = 0.35;

function toLocal(w: WallFrame, x: number, z: number): P2 {
  return rotateYaw(x - w.pos[0], z - w.pos[2], -w.yaw);
}

function toWorld(w: WallFrame, along: number, off: number): P2 {
  const r = rotateYaw(along, off, w.yaw);
  return [w.pos[0] + r[0], w.pos[2] + r[1]];
}

function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return Math.abs(d);
}

interface Scan {
  walls: Map<EntityId, WallFrame>;
  mounts: Array<WallMount & { entity: Entity; frame: WallFrame; reachWidth: number }>;
  furniture: Array<{ id: EntityId; kind: string; poly: P2[]; top: number; parent: string | null }>;
}

function scan(world: WorldDoc, ids: readonly EntityId[]): Scan {
  const walls = new Map<EntityId, WallFrame>();
  const candidates: Entity[] = [];
  const furniture: Scan['furniture'] = [];
  const entities = ids.map((id) => world.entities[id]).filter((e): e is Entity => !!e);
  for (const e of entities) {
    if (e.arch?.role === 'wall' && e.shape.kind === 'procedural' && e.shape.generator === 'arch-wall') {
      const parsed = WallParams.safeParse(e.shape.params);
      if (parsed.success) walls.set(e.id, { entity: e, params: parsed.data, pos: [...e.transform.position] as [number, number, number], yaw: e.transform.rotation[1], parent: e.parent ?? null });
      continue;
    }
    const f = furnitureOfEntity(e);
    if (!f) continue;
    if (f.def.mount === 'wall' && WALL_MOUNT_KINDS.has(f.def.kind)) candidates.push(e);
    else if (f.def.mount === 'floor' && f.def.kind !== 'rug') {
      const p = e.transform.position;
      furniture.push({ id: e.id, kind: f.def.kind, poly: obb(p[0], p[2], e.transform.rotation[1], f.size[0], f.size[2]), top: p[1] + f.size[1], parent: e.parent ?? null });
    }
  }
  const mounts: Scan['mounts'] = [];
  for (const e of candidates) {
    const f = furnitureOfEntity(e);
    if (!f) continue;
    const p = e.transform.position;
    const yaw = e.transform.rotation[1];
    let best: { frame: WallFrame; side: 'A' | 'B'; along: number; d: number } | null = null;
    for (const w of walls.values()) {
      if (w.parent !== (e.parent ?? null)) continue;
      // Parallel to the wall, facing along either of its normals.
      const dy = angleDiff(yaw, w.yaw);
      if (dy > 8 && Math.abs(dy - 180) > 8) continue;
      const [along, off] = toLocal(w, p[0], p[2]);
      if (along < -0.05 || along > w.params.length + 0.05) continue;
      const d = Math.abs(Math.abs(off) - w.params.thickness / 2);
      if (d > 0.12) continue;
      if (!best || d < best.d) best = { frame: w, side: off < 0 ? 'A' : 'B', along, d };
    }
    if (!best) continue;
    const kind = f.def.kind;
    const width = f.size[0];
    const n = rotateYaw(0, best.side === 'A' ? -1 : 1, best.frame.yaw);
    mounts.push({
      id: e.id,
      kind,
      name: e.name,
      ...(e.arch?.room ? { room: e.arch.room } : {}),
      wall: best.frame.entity.id,
      side: best.side,
      compass: `${compassOf(-n[0], -n[1])} wall`,
      t: best.along,
      width,
      y0: p[1],
      y1: p[1] + f.size[1],
      entity: e,
      frame: best.frame,
      reachWidth: width,
    });
  }
  return { walls, mounts, furniture };
}

/** Blockers of one side of a wall: openings, wall ends, furniture, other mounts (except `self`). */
function blockersOf(s: Scan, frame: WallFrame, side: 'A' | 'B', self: EntityId | null): WallBlocker[] {
  const len = frame.params.length;
  const out: WallBlocker[] = [
    { kind: 'corner', t0: -1, t1: 0.05, y0: 0, y1: 99, ref: 'wall start' },
    { kind: 'corner', t0: len - 0.05, t1: len + 1, y0: 0, y1: 99, ref: 'wall end' },
  ];
  frame.params.openings.forEach((o, i) => {
    out.push({ kind: o.kind === 'window' ? 'window' : 'door', t0: o.offset - o.width / 2, t1: o.offset + o.width / 2, y0: o.sill, y1: o.sill + o.height, ref: `${o.kind}:${i}` });
  });
  for (const m of s.mounts) {
    if (m.wall !== frame.entity.id || m.side !== side || m.id === self || m.kind === 'pelmet') continue;
    out.push({ kind: 'item', t0: m.t - m.width / 2, t1: m.t + m.width / 2, y0: m.y0, y1: m.y1, ref: m.id });
  }
  const sign = side === 'A' ? -1 : 1;
  for (const f of s.furniture) {
    if (f.parent !== frame.parent) continue;
    let near = Infinity;
    let lo = Infinity;
    let hi = -Infinity;
    for (const q of f.poly) {
      const [al, off] = toLocal(frame, q[0], q[1]);
      near = Math.min(near, sign * off - frame.params.thickness / 2);
      lo = Math.min(lo, al);
      hi = Math.max(hi, al);
    }
    if (near < 0.12 && near > -0.3 && hi > 0 && lo < len) out.push({ kind: 'furniture', t0: lo, t1: hi, y0: 0, y1: f.top, ref: f.id });
  }
  return out;
}

/** Nearest window of the wall side to a curtain (by gap), or null. */
function anchorWindow(frame: WallFrame, m: WallMount): { ref: string; t0: number; t1: number; sill: number; top: number } | null {
  let best: { ref: string; t0: number; t1: number; sill: number; top: number; gap: number } | null = null;
  frame.params.openings.forEach((o, i) => {
    if (o.kind !== 'window') return;
    const t0 = o.offset - o.width / 2;
    const t1 = o.offset + o.width / 2;
    const gap = Math.max(0, t0 - (m.t + m.width / 2), m.t - m.width / 2 - t1);
    if (!best || gap < best.gap) best = { ref: `window:${i}`, t0, t1, sill: o.sill, top: o.sill + o.height, gap };
  });
  return best;
}

function describeBlocker(b: WallBlocker): string {
  if (b.kind === 'door') return 'a door';
  if (b.kind === 'window') return 'a window';
  if (b.kind === 'corner') return 'the end of the wall';
  if (b.kind === 'furniture') return 'tall furniture';
  return 'another wall piece';
}

function fixFor(s: Scan, m: Scan['mounts'][number], anchor: string | undefined, windowPref: { t0: number; t1: number } | null): PlacementFix {
  const frame = m.frame;
  const blockers = blockersOf(s, frame, m.side, m.id);
  let target: number | null = null;
  const spec: MountSpec = { kind: m.kind, t: m.t, width: m.width, y0: m.y0, y1: m.y1 };
  if (m.kind === 'blind') {
    if (windowPref) target = (windowPref.t0 + windowPref.t1) / 2;
  } else if (m.kind === 'curtain') {
    // Beside the window: the side panels sit with the inner edge over the frame.
    if (windowPref) {
      const cands = [windowPref.t0 + 0.08 - m.width / 2, windowPref.t1 - 0.08 + m.width / 2].sort((a, b) => Math.abs(a - m.t) - Math.abs(b - m.t));
      target = cands.find((c) => collisions({ ...spec, t: c }, blockers, anchor, 0.01).length === 0) ?? null;
    }
  } else target = nearestMountCentre(frame.params.length, spec, blockers);
  if (target === null) return { entity: m.id, remove: true };
  const [, off] = toLocal(frame, m.entity.transform.position[0], m.entity.transform.position[2]);
  const [x, z] = toWorld(frame, target, off);
  return { entity: m.id, position: [Math.round(x * 1000) / 1000, m.entity.transform.position[1], Math.round(z * 1000) / 1000] };
}

/** Every wall-mounted piece of the selected entities (default: the whole document), resolved onto walls. */
function scopeIds(world: WorldDoc, scope: string): EntityId[] {
  if (scope === '*') return Object.keys(world.entities);
  const roots = resolveSelector(world, scope);
  const all = new Set<EntityId>();
  const kids = new Map<string, EntityId[]>();
  for (const e of Object.values(world.entities)) {
    if (!e.parent) continue;
    const l = kids.get(e.parent) ?? [];
    l.push(e.id);
    kids.set(e.parent, l);
  }
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop() as string;
    if (all.has(id)) continue;
    all.add(id);
    stack.push(...(kids.get(id) ?? []));
  }
  return [...all];
}

/**
 * Audit the wall pieces under `scope` (a selector, `*` for the whole
 * document) and return every placement problem with a minimal fix.
 */
export function analyzeRoomPlacements(world: WorldDoc, scope = '*'): PlacementIssue[] {
  const s = scan(world, scopeIds(world, scope));
  const issues: PlacementIssue[] = [];
  const reportedPairs = new Set<string>();
  for (const m of s.mounts) {
    const blockers = blockersOf(s, m.frame, m.side, m.id);
    const win = m.kind === 'curtain' || m.kind === 'blind' ? anchorWindow(m.frame, m) : null;
    const anchor = win && win.ref ? win.ref : undefined;
    const spec: MountSpec = { kind: m.kind, t: m.t, width: m.width, y0: m.y0, y1: m.y1 };
    const hits = collisions(spec, blockers, anchor, 0.01);
    const name = `${m.name || m.kind} (${m.id})`;
    const where = `${m.compass}${m.room ? ` of ${m.room}` : ''}`;
    const [e0, e1] = mountExtent(spec);
    const span = `${e0.toFixed(2)}–${e1.toFixed(2)} m along the wall`;
    const openingHit = hits.find((b) => b.kind === 'door' || b.kind === 'window');
    if (openingHit) {
      const what = describeBlocker(openingHit);
      const fix = fixFor(s, m, anchor, win);
      issues.push({
        code: 'wall_item_on_opening',
        message: `${name} sits over ${what} on the ${where} (${span}; the ${what.replace('a ', '')} spans ${openingHit.t0.toFixed(2)}–${openingHit.t1.toFixed(2)} m)`,
        hint: fix.remove ? `Remove ${m.id}: that wall has no clear stretch wide enough.` : `Move ${m.id} to ${fix.position?.map((v) => v.toFixed(2)).join(', ')} (nearest clear stretch of the same wall).`,
        entities: [m.id, m.wall],
        wall: m.wall,
        compass: m.compass,
        ...(m.room ? { room: m.room } : {}),
        t: Math.round(m.t * 100) / 100,
        fix,
      });
      continue;
    }
    const other = hits.find((b) => b.kind === 'item' || b.kind === 'furniture' || b.kind === 'corner');
    if (other) {
      // One report per pair (the piece with the larger id moves).
      if (other.kind === 'item' && other.ref) {
        const key = [m.id, other.ref].sort().join('|');
        if (reportedPairs.has(key)) continue;
        reportedPairs.add(key);
      }
      const fix = fixFor(s, m, anchor, win);
      issues.push({
        code: 'wall_item_overlap',
        message: `${name} overlaps ${describeBlocker(other)}${other.kind === 'item' && other.ref ? ` (${other.ref})` : ''} on the ${where} (${span})`,
        hint: fix.remove ? `Remove ${m.id}: that wall has no clear stretch wide enough.` : `Move ${m.id} to ${fix.position?.map((v) => v.toFixed(2)).join(', ')} (nearest clear stretch of the same wall).`,
        entities: other.kind === 'item' && other.ref ? [m.id, other.ref] : [m.id],
        wall: m.wall,
        compass: m.compass,
        ...(m.room ? { room: m.room } : {}),
        t: Math.round(m.t * 100) / 100,
        fix,
      });
      continue;
    }
    if (m.kind === 'curtain' || m.kind === 'blind') {
      const near = win && m.frame.params.openings.some((o, i) => o.kind === 'window' && `window:${i}` === win.ref) ? win : null;
      const gap = near ? Math.max(0, near.t0 - (m.t + m.width / 2), m.t - m.width / 2 - near.t1) : Infinity;
      if (!near || gap > NEAR_WINDOW) {
        const fix = fixFor(s, m, anchor, win);
        issues.push({
          code: 'curtain_off_window',
          message: `${name} on the ${where} is not next to a window (${span})`,
          hint: fix.remove ? `Remove ${m.id}: curtains belong beside a window.` : `Move ${m.id} to ${fix.position?.map((v) => v.toFixed(2)).join(', ')}, beside the window.`,
          entities: [m.id],
          wall: m.wall,
          compass: m.compass,
          ...(m.room ? { room: m.room } : {}),
          t: Math.round(m.t * 100) / 100,
          fix,
        });
      }
    }
  }
  return issues;
}

/** Room entity whose floor outline contains a point, among `rooms`. */
function roomAt(rooms: ReadonlyArray<{ id: EntityId; poly: P2[] }>, p: P2): EntityId | undefined {
  return rooms.find((r) => pointInPolygon(p[0], p[1], r.poly))?.id;
}

/** The walls under `scope` seen from each side: openings and the wall pieces hanging on them (for the agent's views). */
export function wallViews(world: WorldDoc, scope = '*'): WallView[] {
  const ids = scopeIds(world, scope);
  const s = scan(world, ids);
  const rooms = ids
    .map((id) => world.entities[id])
    .filter((e): e is Entity => !!e && e.arch?.role === 'room')
    .map((e) => ({ id: e.id, poly: placedPolygon(e) }))
    .filter((r): r is { id: EntityId; poly: P2[] } => r.poly !== null);
  const out: WallView[] = [];
  for (const frame of s.walls.values()) {
    for (const side of ['A', 'B'] as const) {
      const sign = side === 'A' ? -1 : 1;
      const n = rotateYaw(0, sign, frame.yaw);
      const groups = new Map<EntityId, { openings: WallOpeningInfo[]; mounts: WallMount[] }>();
      const group = (room: EntityId | undefined): { openings: WallOpeningInfo[]; mounts: WallMount[] } | null => {
        if (!room) return null;
        let g = groups.get(room);
        if (!g) groups.set(room, (g = { openings: [], mounts: [] }));
        return g;
      };
      for (const o of frame.params.openings) {
        const at = toWorld(frame, o.offset, sign * (frame.params.thickness / 2 + 0.3));
        group(roomAt(rooms, at))?.openings.push({ kind: o.kind, t: round(o.offset), width: round(o.width), sill: round(o.sill), height: round(o.height) });
      }
      for (const m of s.mounts) {
        if (m.wall !== frame.entity.id || m.side !== side) continue;
        const at = toWorld(frame, m.t, sign * (frame.params.thickness / 2 + 0.3));
        const { entity: _e, frame: _f, reachWidth: _r, ...rest } = m;
        group(roomAt(rooms, at) ?? m.room)?.mounts.push({ ...rest, t: round(rest.t), width: round(rest.width), y0: round(rest.y0), y1: round(rest.y1) });
      }
      for (const [room, g] of groups) out.push({ wall: frame.entity.id, side, compass: `${compassOf(-n[0], -n[1])} wall`, room, length: round(frame.params.length), openings: g.openings, mounts: g.mounts });
    }
  }
  return out.sort((x, y) => (x.room ?? '').localeCompare(y.room ?? '') || x.compass.localeCompare(y.compass) || x.wall.localeCompare(y.wall));
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Where each wall piece hangs: wall face, offset along it and heights, keyed by entity id. */
export function wallMountIndex(world: WorldDoc, scope = '*'): Map<EntityId, WallMount> {
  const s = scan(world, scopeIds(world, scope));
  return new Map(s.mounts.map(({ entity: _e, frame: _f, reachWidth: _r, ...rest }) => [rest.id, { ...rest, t: round(rest.t), width: round(rest.width), y0: round(rest.y0), y1: round(rest.y1) }]));
}

/** Most lines of {@link describeWallPlacements}. */
const MAX_WALL_LINES = 60;
/** Most placement problems listed. */
const MAX_ISSUE_LINES = 8;

/**
 * Compact text of one building's wall openings and wall pieces plus any
 * placement problem (with the entity ids and a ready fix). This is what the
 * agent sees in the world summary, so it can answer "why is the curtain over
 * the door" and repair it without guessing.
 */
export function describeWallPlacements(world: WorldDoc, buildingId: EntityId, opts: { compact?: boolean } = {}): string[] {
  const views = wallViews(world, buildingId);
  if (views.length === 0) return [];
  const lines = opts.compact ? [] : [`walls (t = metres from the wall start, y = heights; ${views.length} wall faces):`];
  for (const v of opts.compact ? [] : views.slice(0, MAX_WALL_LINES)) {
    const parts = [
      ...v.openings.map((o) => `${o.kind} t=${o.t} w=${o.width}${o.kind === 'window' ? ` sill=${o.sill} h=${o.height}` : ''}`),
      ...v.mounts.map((m) => `${m.kind}#${m.id} t=${m.t} w=${m.width} y=${m.y0}-${m.y1}`),
    ];
    lines.push(`${v.room} ${v.compass} len=${v.length}: ${parts.join(' | ')}`);
  }
  if (!opts.compact && views.length > MAX_WALL_LINES) lines.push(`... ${views.length - MAX_WALL_LINES} more wall faces`);
  const issues = analyzeRoomPlacements(world, buildingId);
  if (issues.length === 0) {
    if (!opts.compact) lines.push('placement-check: ok (no wall piece overlaps a door, a window or another wall piece)');
  }
  else {
    lines.push(`placement-check: ${issues.length} problem(s)`);
    for (const i of issues.slice(0, MAX_ISSUE_LINES)) {
      const fix = i.fix.remove ? 'remove' : `move to ${i.fix.position?.join(',')}`;
      lines.push(`placement-issue ${i.code} ${i.entities[0]} ${i.compass} ${i.room ?? ''} t=${i.t} fix=${fix} — ${i.message}`);
    }
    if (issues.length > MAX_ISSUE_LINES) lines.push(`... ${issues.length - MAX_ISSUE_LINES} more placement problems`);
  }
  return lines;
}

/** One-line verdict text for a set of issues (used by the verifier and the planner). */
export function summarizePlacementIssues(issues: readonly PlacementIssue[], limit = 6): string {
  if (issues.length === 0) return 'no wall piece overlaps a door, a window or another wall piece';
  const shown = issues.slice(0, limit).map((i) => `${i.message} — ${i.hint}`).join('; ');
  return `${issues.length} wall placement problem(s): ${shown}${issues.length > limit ? ` (+${issues.length - limit} more)` : ''}`;
}
