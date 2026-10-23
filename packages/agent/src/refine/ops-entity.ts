/**
 * Adding, duplicating and removing single things. In buildings the plan owns
 * the furniture, so adds go through `place_item` (the layout stays stable and
 * the piece survives a re-compile) and removals are remembered on the
 * building ("tombstones") instead of coming back.
 */
import { FURNITURE, applyArchOps, furnitureById, furnitureByKind, furnitureSize } from '@aether/arch';
import { Entity, dependencyIndex, isSatellite, type EntityId, type Json, type PatchInput, type Vec3, type WorldDoc } from '@aether/core';
import type { Command, Placement, Relation } from './command';
import { resolveRef, resolveRooms } from './resolve';
import type { SceneItem } from './scene';
import { ask, describeTargets, failed, outcome, type AddableSpec, type OpEnv, type OpOutcome } from './ops-types';
import { uniqueEntityId } from './ops-world';
import { synonymsOf } from './lexicon';
import { roomPolygon, viewVectors } from './walls';

const r2 = (n: number): number => Math.round(n * 100) / 100;

function buildingOf(env: OpEnv, item: SceneItem): SceneItem | undefined {
  let cur: SceneItem | undefined = item;
  for (let i = 0; i < 6 && cur; i++) {
    if (cur.entity.arch?.role === 'building') return cur;
    cur = cur.entity.parent !== null ? env.index.get(cur.entity.parent) : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

const REMOVABLE_ARCH = new Set(['furniture', 'fixture', 'light', 'switch']);

/** "bench" → "benches", "shelf" → "shelves", "tent" → "tents". */
function plural(noun: string): string {
  if (/(?:s|x|z|ch|sh)$/.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  if (/fe?$/.test(noun) && !/(?:ff|ef|oof|chief)$/.test(noun)) return `${noun.replace(/fe?$/, '')}ves`;
  return `${noun}s`;
}

/** How furniture kinds read in sentences. */
const KIND_LABEL: Readonly<Record<string, string>> = { art: 'painting', tv: 'TV', 'floor-lamp': 'floor lamp', 'table-lamp': 'table lamp', 'ceiling-light': 'ceiling light' };

/** Remove things. */
export function planRemove(env: OpEnv, cmd: Extract<Command, { op: 'remove' }>): OpOutcome {
  const res = resolveRef(env.index, cmd.ref, env.ctx);
  if (res.ambiguous && res.ambiguous.length > 0) return ask(res.reason ?? 'Which one?', res.ambiguous);
  if (res.items.length === 0) return failed(res.reason ?? `I can't find "${cmd.ref.text}"`);
  const removed: EntityId[] = [];
  const notes: string[] = [];
  const also: EntityId[] = [];
  const kept: string[] = [];
  const tombs = new Map<EntityId, EntityId[]>();
  for (const it of res.items) {
    const role = it.entity.arch?.role;
    if (role && !REMOVABLE_ARCH.has(role)) {
      kept.push(it.label.toLowerCase());
      continue;
    }
    if (role) {
      const b = buildingOf(env, it);
      if (b) tombs.set(b.id, [...(tombs.get(b.id) ?? []), it.id]);
    }
    for (const id of env.draft.remove(it.id, true)) removed.push(id);
  }
  // Its own light and zones go with it (an orphaned glow or goal is left otherwise); a plinth or sign stays.
  const deps = dependencyIndex(env.base);
  const extra = deps.closure(removed.filter((id) => !env.base.entities[id]?.arch));
  for (const id of extra) {
    const e = env.base.entities[id];
    if (!e || removed.includes(id) || e.locked || !Object.hasOwn(env.draft.world.entities, id)) continue;
    const why = deps.ownerOf(id)?.why;
    if (why !== 'attached' && !isSatellite(e)) continue;
    for (const r of env.draft.remove(id, true)) {
      removed.push(r);
      also.push(r);
    }
  }
  for (const [bid, ids] of tombs) {
    const b = env.draft.entity(bid);
    if (b.arch) b.arch = { ...b.arch, removed: [...new Set([...(b.arch.removed ?? []), ...ids])].slice(-400) };
    also.push(bid);
  }
  // Rules and tests that mention a removed thing keep working only when they were about a group; warn otherwise.
  const gone = new Set(removed);
  const mentions = env.base.rules.filter((r) => JSON.stringify(r).split(/[^a-z0-9_-]+/).some((w) => gone.has(w))).map((r) => r.id);
  if (mentions.length > 0) notes.push(`rule${mentions.length === 1 ? '' : 's'} ${mentions.slice(0, 3).join(', ')} mention${mentions.length === 1 ? 's' : ''} what you removed`);
  if (kept.length > 0) notes.push(`${kept.slice(0, 3).join(', ')} ${kept.length === 1 ? 'is' : 'are'} part of the building plan; I left ${kept.length === 1 ? 'it' : 'them'}`);
  if (removed.length === 0) return failed(`The ${kept[0] ?? 'thing'} is structural; I can't remove it without changing the building`, { notes });
  const roots = res.items.filter((i) => removed.includes(i.id));
  return outcome({ summary: `removed ${describeTargets(roots)}`, targets: roots.map((r) => r.id), also, notes, cosmetic: false });
}

// ---------------------------------------------------------------------------
// Placement helpers
// ---------------------------------------------------------------------------

function occupied(env: OpEnv, x: number, z: number, r: number, ignore: ReadonlySet<EntityId> = new Set()): boolean {
  for (const it of env.index.items) {
    if (ignore.has(it.id) || it.entity.tags.includes('backdrop') || it.isPart || it.entity.shape.kind === 'scatter' || it.entity.shape.kind === 'none') continue;
    if (it.entity.arch && ['room', 'ceiling', 'level', 'building', 'wall', 'roof', 'site', 'window', 'opening'].includes(it.entity.arch.role)) continue;
    if (it.size[1] < 0.25 && !it.entity.arch) continue;
    const rr = Math.max(it.size[0], it.size[2]) / 2 + r;
    if (Math.hypot(it.pos[0] - x, it.pos[2] - z) < rr) return true;
  }
  return false;
}

/** The nearest free spot on rings around (cx, cz). */
export function freeSpot(env: OpEnv, cx: number, cz: number, radius: number, start = 2.5, ignore?: ReadonlySet<EntityId>): [number, number] {
  for (let ring = 0; ring < 12; ring++) {
    const d = start + ring * (radius + 0.6);
    const n = 8 + ring * 4;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + ring * 0.5;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (!occupied(env, x, z, radius, ignore)) return [r2(x), r2(z)];
    }
  }
  return [r2(cx + start), r2(cz)];
}

function anchorSpot(env: OpEnv, anchor: SceneItem, rel: Relation, radius: number): [number, number, number] {
  const { forward, right } = viewVectors(env.ctx.heading);
  const reach = (v: [number, number]): number => (Math.abs(v[0]) * anchor.size[0] + Math.abs(v[1]) * anchor.size[2]) / 2 + radius + 0.15;
  switch (rel) {
    case 'left of':
      return [anchor.pos[0] - right[0] * reach(right), anchor.pos[1], anchor.pos[2] - right[1] * reach(right)];
    case 'right of':
    case 'next to':
    case 'near':
      return [anchor.pos[0] + right[0] * reach(right), anchor.pos[1], anchor.pos[2] + right[1] * reach(right)];
    case 'behind':
      return [anchor.pos[0] + forward[0] * reach(forward), anchor.pos[1], anchor.pos[2] + forward[1] * reach(forward)];
    case 'in front of':
      return [anchor.pos[0] - forward[0] * reach(forward), anchor.pos[1], anchor.pos[2] - forward[1] * reach(forward)];
    default:
      return [anchor.pos[0], anchor.pos[1], anchor.pos[2]];
  }
}

/** A free spot next to `anchor` in the wanted direction; other sides when that one is blocked or outside the room. */
function placeNear(env: OpEnv, anchor: SceneItem, rel: Relation, radius: number, room?: SceneItem, ignore: ReadonlySet<EntityId> = new Set()): [number, number, number] {
  const poly = room ? roomPolygon(env.index, room) : null;
  const order: Relation[] = rel === 'left of' ? ['left of', 'right of', 'in front of', 'behind'] : rel === 'behind' ? ['behind', 'left of', 'right of', 'in front of'] : rel === 'in front of' ? ['in front of', 'right of', 'left of', 'behind'] : ['right of', 'left of', 'in front of', 'behind'];
  for (const gap of [0, 0.5, 1]) {
    for (const r of order) {
      const p = anchorSpot(env, anchor, r, radius + gap);
      if (poly && !pointIn(p[0], p[2], poly)) continue;
      if (poly && !pointIn(p[0], p[2], shrink(poly, radius * 0.6))) continue;
      if (!occupied(env, p[0], p[2], radius * 0.8, new Set([anchor.id, ...ignore]))) return p;
    }
  }
  return anchorSpot(env, anchor, order[0] as Relation, radius);
}

function pointIn(x: number, z: number, poly: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i] as [number, number];
    const [xj, zj] = poly[j] as [number, number];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Polygon moved toward its centroid (inset approximation for convex-ish rooms). */
function shrink(poly: readonly [number, number][], by: number): [number, number][] {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map((p) => {
    const d = Math.hypot(p[0] - cx, p[1] - cz) || 1;
    const k = Math.max(0, (d - by) / d);
    return [cx + (p[0] - cx) * k, cz + (p[1] - cz) * k] as [number, number];
  });
}

function roomCentre(env: OpEnv, room: SceneItem): [number, number] {
  const poly = room.entity.shape.kind === 'procedural' ? (room.entity.shape.params['polygon'] as Json | undefined) : undefined;
  const level = room.entity.parent !== null ? env.index.get(room.entity.parent) : undefined;
  const ox = level ? level.pos[0] : 0;
  const oz = level ? level.pos[2] : 0;
  if (Array.isArray(poly) && poly.length >= 3) {
    const pts = poly as number[][];
    return [ox + pts.reduce((s, p) => s + (p[0] as number), 0) / pts.length, oz + pts.reduce((s, p) => s + (p[1] as number), 0) / pts.length];
  }
  return [room.pos[0], room.pos[2]];
}

// ---------------------------------------------------------------------------
// Arch add (place_item)
// ---------------------------------------------------------------------------

const KIND_ALIASES: Readonly<Record<string, string>> = {
  couch: 'sofa', settee: 'sofa', loveseat: 'sofa', carpet: 'rug', mat: 'rug', painting: 'art', picture: 'art', poster: 'art', artwork: 'art', frame: 'art', canvas: 'art',
  television: 'tv', screen: 'tv', drape: 'curtain', blind: 'curtain', cabinet: 'sideboard', console: 'sideboard', dresser: 'sideboard', shelf: 'bookshelf', bookcase: 'bookshelf', closet: 'wardrobe',
  houseplant: 'plant', 'pot plant': 'plant', stool: 'bar-stool', lamp: 'floor-lamp', chandelier: 'pendant', light: 'pendant', mattress: 'bed', fridge: 'fridge', refrigerator: 'fridge', sink: 'sink', basin: 'sink', washbasin: 'sink', oven: 'oven', cooker: 'oven', stove: 'oven', hood: 'extractor', 'rattan chair': 'cane-chair', 'wicker chair': 'cane-chair', 'cane chair': 'cane-chair', wc: 'toilet', bath: 'bathtub', tub: 'bathtub', counter: 'island',
};

/** The furniture kind a noun names, when the catalogue has one. */
export function furnitureKindFor(noun: string, anchor?: SceneItem): string | undefined {
  const n = noun.toLowerCase().replace(/\s+/g, '-');
  if (furnitureByKind(n)) return n;
  if (noun === 'table') return anchor && /bed|nightstand/.test(anchor.kind) ? 'nightstand' : anchor && /sofa|armchair|couch/.test(anchor.kind) ? 'coffee-table' : 'dining-table';
  if (noun === 'lamp' && anchor && /table|nightstand|desk|sideboard|island/.test(anchor.kind)) return 'table-lamp';
  const alias = KIND_ALIASES[noun] ?? KIND_ALIASES[n];
  if (alias && furnitureByKind(alias)) return alias;
  for (const syn of synonymsOf(noun)) {
    if (furnitureByKind(syn)) return syn;
    const a = KIND_ALIASES[syn];
    if (a && furnitureByKind(a)) return a;
  }
  return FURNITURE.find((f) => f.kind.split('-').includes(noun))?.kind;
}

function planArchAdd(env: OpEnv, noun: string, count: number, placement: Placement | undefined, look: Extract<Command, { op: 'add' }>['look'], paramsFrom?: Record<string, Json>): OpOutcome | null {
  const buildings = env.index.items.filter((i) => i.entity.arch?.role === 'building');
  if (buildings.length === 0) return null;
  // The anchor and room.
  let anchor: SceneItem | undefined;
  if (placement?.relation) {
    const a = resolveRef(env.index, placement.relation.anchor, env.ctx);
    if (a.ambiguous && a.ambiguous.length > 0) return ask(a.reason ?? 'Next to which one?', a.ambiguous);
    anchor = a.items[0];
    if (!anchor) return failed(a.reason ?? `I can't find "${placement.relation.anchor.text}"`);
  }
  const kind = furnitureKindFor(noun, anchor);
  if (!kind) return null;
  let room: SceneItem | undefined;
  if (placement?.room) {
    const rooms = resolveRooms(env.index, placement.room, env.ctx);
    if (rooms.length > 1) return ask(`Which ${placement.room.noun}?`, rooms);
    room = rooms[0];
    if (!room) return failed(`I can't find a room called "${placement.room.text}"`);
  }
  if (!room && anchor) room = anchor.entity.arch?.role === 'room' ? anchor : env.index.roomOf(anchor);
  if (!room) {
    const ctxItem = env.ctx.selection.concat(env.ctx.focus).map((id) => env.index.get(id)).find((x): x is SceneItem => !!x);
    if (ctxItem) room = ctxItem.entity.arch?.role === 'room' ? ctxItem : env.index.roomOf(ctxItem);
  }
  if (!room && env.index.rooms.length === 1) room = env.index.rooms[0];
  if (!room) return ask(`Which room should the ${noun} go in?`, env.index.rooms);
  const building = buildingOf(env, room) ?? (buildings[0] as SceneItem);
  const def = furnitureByKind(kind);
  const params: Record<string, Json> = { ...(paramsFrom ?? {}) };
  if (look?.color && def) {
    const ck = Object.keys(def.params).find((k) => def.params[k]?.type === 'color' && k === 'color') ?? Object.keys(def.params).find((k) => def.params[k]?.type === 'color');
    if (ck) params[ck] = look.color;
  }
  const bYaw = building.yaw;
  const toPlan = (x: number, z: number): [number, number] => {
    const a = (-bYaw * Math.PI) / 180;
    const dx = x - building.pos[0];
    const dz = z - building.pos[2];
    return [r2(dx * Math.cos(a) + dz * Math.sin(a)), r2(-dx * Math.sin(a) + dz * Math.cos(a))];
  };
  const ops: unknown[] = [];
  const rel = placement?.relation?.rel;
  for (let k = 0; k < count; k++) {
    const item: Record<string, unknown> = { kind, params };
    if (anchor && rel) {
      const stack = rel === 'under' || rel === 'on' || rel === 'above' || rel === 'inside' || rel === 'below';
      const spot = stack ? ([anchor.pos[0], anchor.pos[1], anchor.pos[2]] as [number, number, number]) : placeNear(env, anchor, rel, 0.5 + k * 0.7, room);
      item['at'] = toPlan(spot[0], spot[2]);
      item['yaw'] = r2(anchor.yaw - bYaw);
    } else if (placement?.side) {
      item['against'] = (['north', 'south', 'east', 'west'] as const).find((s) => s === placement.side);
    }
    ops.push({ op: 'place_item', building: building.id, room: room.id, item });
  }
  const res = applyArchOps(env.draft.world, ops);
  if (res.errors.length > 0 && res.patches.length === 0) return failed(res.errors[0]?.message ?? 'I could not place that', { notes: res.errors.slice(0, 2).map((e) => e.hint) });
  // The plan now holds the new piece (so it survives a re-compile); the room is NOT re-laid out under the user's
  // hands: only the new piece itself is taken from the compiled result.
  const planned = res.target;
  const pieces = newPieces(env, planned, room.id, kind, count);
  if (pieces.length === 0) return failed(`I could not find room for a ${noun} there`);
  const added: EntityId[] = [];
  const bPlan = planned.entities[building.id]?.arch;
  if (bPlan?.plan !== undefined) {
    const be = env.draft.entity(building.id);
    if (be.arch) be.arch = { ...be.arch, plan: bPlan.plan };
  }
  for (const piece of pieces) {
    const copy = structuredClone(piece) as Entity;
    copy.id = uniqueEntityId(env, `${room.id}-${kind}`, added);
    const clash = overlaps(env, copy, added);
    if (clash && !(anchor && rel)) {
      const spot = freeInRoom(env, room, copy);
      if (spot) copy.transform = { ...copy.transform, position: [spot[0], copy.transform.position[1], spot[1]] };
    }
    env.draft.add(copy);
    added.push(copy.id);
    if (anchor && rel === 'above' && (copy.arch?.role === 'fixture' || copy.arch?.role === 'light')) {
      // Just above the anchor, but never closer than a hand's width to the ceiling.
      const levelEntity = copy.parent !== null ? env.index.get(copy.parent)?.entity : undefined;
      const ceiling = levelEntity?.arch?.height ?? 2.9;
      const y = Math.max(1.2, Math.min(anchor.pos[1] + anchor.size[1] + 0.45, ceiling - 0.95));
      copy.transform = { ...copy.transform, position: [copy.transform.position[0], r2(y), copy.transform.position[2]] };
    }
  }
  const where = anchor && rel ? ` ${rel} the ${anchor.label.toLowerCase()}` : ` in the ${room.label.toLowerCase()}`;
  const label = KIND_LABEL[kind] ?? kind.replace(/-/g, ' ');
  const what = look?.color ? `${look.colorText ?? ''} ${label}`.trim() : label;
  return outcome({ summary: `added ${count > 1 ? `${count} ${plural(what)}` : /^[aeiou]/.test(what) ? `an ${what}` : `a ${what}`}${where}`, targets: [], added, also: [building.id], cosmetic: false, notes: res.errors.slice(0, 2).map((e) => e.message) });
}

/** The pieces `planned` has that the draft does not: greedy nearest matching of the room's pieces of that kind. */
function newPieces(env: OpEnv, planned: WorldDoc, roomId: EntityId, kind: string, count: number): Entity[] {
  const inRoom = (w: WorldDoc): Entity[] => Object.values(w.entities).filter((e) => e.arch?.room === roomId && e.arch.kind === kind && (e.arch.role === 'furniture' || e.arch.role === 'fixture' || e.arch.role === 'light'));
  const old = inRoom(env.draft.world);
  const next = inRoom(planned);
  const taken = new Set<EntityId>();
  for (const o of old) {
    let best: Entity | undefined;
    let bd = Infinity;
    for (const n of next) {
      if (taken.has(n.id)) continue;
      const d = Math.hypot(n.transform.position[0] - o.transform.position[0], n.transform.position[2] - o.transform.position[2]);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    if (best) taken.add(best.id);
  }
  return next.filter((n) => !taken.has(n.id)).slice(0, count);
}

function overlaps(env: OpEnv, e: Entity, ignore: readonly EntityId[]): boolean {
  const f = furnitureById(e.shape.kind === 'procedural' ? e.shape.generator : '');
  const size = f ? furnitureSize(f, e.shape.kind === 'procedural' ? (e.shape.params as Record<string, Json>) : undefined) : ([0.8, 1, 0.8] as [number, number, number]);
  const level = e.parent !== null ? env.index.get(e.parent) : undefined;
  const x = (level?.pos[0] ?? 0) + e.transform.position[0];
  const z = (level?.pos[2] ?? 0) + e.transform.position[2];
  if (e.arch?.role !== 'furniture' || e.arch.kind === 'rug') return false;
  return occupied(env, x, z, Math.max(size[0], size[2]) / 2 - 0.1, new Set(ignore));
}

function inPolygon(x: number, z: number, poly: readonly number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i] as [number, number];
    const [xj, zj] = poly[j] as [number, number];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** A free spot (level coordinates) inside the room polygon for `e`. */
function freeInRoom(env: OpEnv, room: SceneItem, e: Entity): [number, number] | null {
  const poly = room.entity.shape.kind === 'procedural' ? (room.entity.shape.params['polygon'] as Json | undefined) : undefined;
  if (!Array.isArray(poly)) return null;
  const pts = poly as number[][];
  const level = room.entity.parent !== null ? env.index.get(room.entity.parent) : undefined;
  const ox = level?.pos[0] ?? 0;
  const oz = level?.pos[2] ?? 0;
  const xs = pts.map((p) => p[0] as number);
  const zs = pts.map((p) => p[1] as number);
  const r = 0.5;
  for (let x = Math.min(...xs) + 0.6; x < Math.max(...xs) - 0.6; x += 0.4) {
    for (let z = Math.min(...zs) + 0.6; z < Math.max(...zs) - 0.6; z += 0.4) {
      if (inPolygon(x, z, pts) && !occupied(env, ox + x, oz + z, r)) return [r2(x), r2(z)];
    }
  }
  void e;
  return null;
}

// ---------------------------------------------------------------------------
// Add (any world)
// ---------------------------------------------------------------------------

function entityFrom(env: OpEnv, spec: AddableSpec, id: EntityId, pos: Vec3, yaw: number, look: Extract<Command, { op: 'add' }>['look']): Entity {
  const e = Entity.parse({
    id,
    name: spec.name,
    tags: spec.tags ?? [],
    transform: { position: pos, rotation: [0, yaw, 0], scale: [1, 1, 1] },
    shape: spec.shape,
    ...(spec.physics ? { physics: spec.physics } : { physics: { body: 'static' } }),
    ...(spec.behaviors ? { behaviors: spec.behaviors } : {}),
    ...(look?.color ? { material: { color: look.color } } : {}),
  });
  void env;
  return e;
}

/** Add one or several things. */
export function planAdd(env: OpEnv, cmd: Extract<Command, { op: 'add' }>): OpOutcome {
  // Buildings: furniture goes through the plan.
  const arch = planArchAdd(env, cmd.noun, cmd.count, cmd.placement, cmd.look);
  if (arch) return arch;
  const spec = env.addable?.(cmd.noun) ?? null;
  if (!spec) return failed(`I don't know how to add a ${cmd.noun} here. Try describing it, or pick one from the Assets panel`);
  let anchor: SceneItem | undefined;
  const rel = cmd.placement?.relation?.rel;
  if (cmd.placement?.relation) {
    const a = resolveRef(env.index, cmd.placement.relation.anchor, env.ctx);
    if (a.ambiguous && a.ambiguous.length > 0) return ask(a.reason ?? 'Next to which one?', a.ambiguous);
    anchor = a.items[0];
    if (!anchor) return failed(a.reason ?? `I can't find "${cmd.placement.relation.anchor.text}"`);
  }
  let centre: [number, number];
  let baseY = 0;
  if (anchor) {
    centre = [anchor.pos[0], anchor.pos[2]];
    baseY = rel === 'above' || rel === 'on' ? anchor.pos[1] + anchor.size[1] : 0;
  } else if (cmd.placement?.room) {
    const rooms = resolveRooms(env.index, cmd.placement.room, env.ctx);
    if (rooms.length > 1) return ask(`Which ${cmd.placement.room.noun}?`, rooms);
    if (!rooms[0]) return failed(`I can't find a room called "${cmd.placement.room.text}"`);
    centre = roomCentre(env, rooms[0]);
  } else {
    const ctxItem = env.ctx.selection.concat(env.ctx.focus).map((id) => env.index.get(id)).find((x): x is SceneItem => !!x);
    const spawn = env.base.player.spawn;
    centre = ctxItem ? [ctxItem.pos[0], ctxItem.pos[2]] : [spawn[0], spawn[2] - 5];
  }
  const added: EntityId[] = [];
  const n = Math.min(cmd.count, 40);
  for (let k = 0; k < n; k++) {
    let x: number;
    let z: number;
    if (anchor && rel && rel !== 'above' && rel !== 'on' && rel !== 'under' && rel !== 'inside') {
      const p = anchorSpot(env, anchor, rel, spec.radius + k * (spec.radius * 2 + 0.4));
      [x, z] = [p[0], p[2]];
    } else if (anchor) {
      [x, z] = [anchor.pos[0], anchor.pos[2]];
    } else [x, z] = freeSpot(env, centre[0], centre[1], spec.radius, 2.2 + spec.radius, new Set(added));
    const id = uniqueEntityId(env, cmd.noun.replace(/\s+/g, '-'), added);
    const primCentred = spec.shape['kind'] === 'primitive';
    const sizeY = primCentred ? ((spec.shape['size'] as number[] | undefined)?.[1] ?? 1) : 0;
    const y = r2(baseY + sizeY / 2);
    env.draft.add(entityFrom(env, spec, id, [r2(x), y, r2(z)], anchor ? r2(anchor.yaw) : (k * 47) % 360, cmd.look));
    added.push(id);
  }
  const where = anchor && rel ? ` ${rel} the ${anchor.label.toLowerCase()}` : '';
  return outcome({ summary: `added ${n > 1 ? `${n} ${plural(cmd.noun)}` : `${/^[aeiou]/.test(cmd.noun) ? 'an' : 'a'} ${cmd.noun}`}${where}`, targets: [], added, cosmetic: false });
}

/** Denser / sparser scatter fields ("make the forest denser", "fewer flowers", "more trees"). */
export function planDensity(env: OpEnv, cmd: Extract<Command, { op: 'density' }>): OpOutcome {
  const res = resolveRef(env.index, cmd.ref, env.ctx);
  const fields = res.items.filter((i) => i.entity.shape.kind === 'scatter');
  if (fields.length === 0) {
    if (cmd.fallbackAdd) return planAdd(env, { op: 'add', noun: cmd.fallbackAdd.noun, count: cmd.fallbackAdd.count, adjectives: cmd.ref.adjectives, text: cmd.fallbackAdd.noun });
    if (res.ambiguous && res.ambiguous.length > 0) return ask(res.reason ?? 'Which one?', res.ambiguous);
    return res.items.length > 0 ? failed(`${describeTargets(res.items, cmd.ref)} is a single object, not a field I can thin out or thicken`) : failed(res.reason ?? `I can't find "${cmd.ref.text}"`);
  }
  for (const it of fields) {
    const sh = env.draft.entity(it.id).shape;
    if (sh.kind !== 'scatter') continue;
    sh.count = Math.max(1, Math.min(1_000_000, Math.round(sh.count * cmd.factor)));
    if (sh.points) delete sh.points;
  }
  return outcome({ summary: `made ${describeTargets(fields)} ${cmd.factor >= 1 ? 'denser' : 'sparser'}`, targets: fields.map((f) => f.id), cosmetic: false });
}

/** Duplicate things. */
export function planDuplicate(env: OpEnv, cmd: Extract<Command, { op: 'duplicate' }>): OpOutcome {
  const res = resolveRef(env.index, cmd.ref, env.ctx);
  if (res.ambiguous && res.ambiguous.length > 0) return ask(res.reason ?? 'Which one?', res.ambiguous);
  if (res.items.length === 0) return failed(res.reason ?? `I can't find "${cmd.ref.text}"`);
  const src = res.items[0] as SceneItem;
  const { right } = viewVectors(env.ctx.heading);
  const added: EntityId[] = [];
  // Building furniture: ask the plan so the copy survives a re-compile.
  if (src.entity.arch && REMOVABLE_ARCH.has(src.entity.arch.role) && src.entity.arch.kind && src.entity.shape.kind === 'procedural') {
    const room = src.roomId ? env.index.get(src.roomId) : undefined;
    const out = planArchAdd(env, src.entity.arch.kind, cmd.count, { ...(cmd.placement ?? {}), relation: cmd.placement?.relation ?? { rel: 'next to', anchor: { text: src.id, noun: src.id, adjectives: [] } }, ...(room ? {} : {}) }, undefined, src.entity.shape.params);
    if (out) return out;
  }
  for (let k = 0; k < Math.min(cmd.count, 20); k++) {
    const id = uniqueEntityId(env, src.id.replace(/-\d+$/, ''), added);
    const copy = structuredClone(src.entity) as Entity;
    copy.id = id;
    copy.locked = undefined;
    delete copy.locked;
    const gap = Math.max(src.size[0], src.size[2]) + 0.3;
    const p = copy.transform.position;
    copy.transform = { ...copy.transform, position: [r2(p[0] + right[0] * gap * (k + 1)), p[1], r2(p[2] + right[1] * gap * (k + 1))] as Vec3 };
    env.draft.add(copy);
    added.push(id);
    // Children of a composite come along.
    const remap = new Map<EntityId, EntityId>([[src.id, id]]);
    for (const cid of env.index.subtree(src.id).slice(1)) {
      const c = env.index.get(cid);
      if (!c) continue;
      const child = structuredClone(c.entity) as Entity;
      child.id = uniqueEntityId(env, cid, added);
      child.parent = remap.get(c.entity.parent ?? '') ?? child.parent;
      remap.set(cid, child.id);
      env.draft.add(child);
      added.push(child.id);
    }
  }
  return outcome({ summary: `duplicated ${describeTargets([src])}${cmd.count > 1 ? ` ×${cmd.count}` : ''}`, targets: [], added, cosmetic: false });
}

export type { PatchInput };
