/**
 * What belongs to an object. A shrine is more than its mesh: its light, its
 * goal zone and its plinth go where it goes, and an edit of "the shrine" may
 * change them. Children belong through the hierarchy; everything else is
 * found here:
 *
 * - `attached`: the entity names its owner (`attachedTo`);
 * - `named`: its id or name is the owner's plus a part word ("shrine-light",
 *   "Shrine goal", "Shrine platform");
 * - `nearby`: a satellite (a light without a shape, an invisible or sensor
 *   zone with a goal, checkpoint or hazard, a zone a rule listens to) inside
 *   an object's footprint, which the smallest such object owns (the shrine,
 *   not the hill it stands on).
 *
 * Each dependent has one owner. Pure; one O(n) pass per index.
 */
import type { Entity, EntityId, Patch, Vec3, WorldDoc } from './schema';
import { hasOwn } from './json';
import { worldTransform } from './query';

/** How a dependent was found. */
export type DependencyWhy = 'attached' | 'named' | 'nearby';

/** The owner of a dependent. */
export interface Dependency {
  owner: EntityId;
  why: DependencyWhy;
}

/** Words that name a part of the object before them ("shrine light", "statue-plinth"). */
const PART_WORDS = new Set([
  'light', 'lights', 'lamp', 'glow', 'spotlight', 'spot', 'halo', 'aura', 'beacon', 'flame', 'fire',
  'goal', 'zone', 'trigger', 'area', 'sensor', 'volume', 'collider', 'hitbox', 'marker', 'checkpoint',
  'platform', 'plinth', 'base', 'pedestal', 'podium', 'footing', 'steps', 'stairs',
  'sign', 'banner', 'flag', 'label', 'sparkles', 'particles', 'fx', 'sound', 'ring',
]);
/** Behaviours that make an invisible thing a zone of the object it sits in. */
const ZONE_BEHAVIORS = new Set(['goal', 'checkpoint', 'hazard', 'windZone', 'pulseLight', 'launcher']);
/** Tags and generators of ground-like things, which own nothing by being near it. */
const GROUND_TAG = /^(?:terrain|ground|backdrop|scenery|water|river|lake|ocean|sky)$/;
const GROUND_GENERATORS = new Set(['terrain', 'island', 'mountain', 'hill', 'hills', 'cliff', 'water', 'river', 'ocean', 'lake', 'pond', 'waterfall']);
/** Footprint radius (m) above which an object owns nothing by proximity (a hill, a plaza). */
const MAX_OWNER_RADIUS = 14;
/** Margin (m) past the footprint within which a satellite still belongs. */
const NEAR_MARGIN = 1.5;

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** True for a light, zone or trigger with no body of its own to look at. */
export function isSatellite(e: Entity, zoneIds?: ReadonlySet<EntityId>): boolean {
  if (e.template || e.npc || e.character || e.arch) return false;
  const shapeless = e.shape.kind === 'none';
  if (e.light && shapeless) return true;
  const unseen = shapeless || !e.visible;
  if (!unseen && !e.physics?.sensor) return false;
  if (e.behaviors.some((b) => ZONE_BEHAVIORS.has(b.type))) return true;
  if (e.physics?.sensor && unseen) return true;
  // A zone a rule listens to, drawn or not (an altar the player steps on).
  return zoneIds?.has(e.id) === true && !e.behaviors.some((b) => b.type === 'collectible');
}

/** Entity ids that rules use as zones (`enter` / `exit` triggers). */
function ruleZones(world: WorldDoc): Set<EntityId> {
  const out = new Set<EntityId>();
  for (const r of world.rules) if ((r.when.on === 'enter' || r.when.on === 'exit') && hasOwn(world.entities, r.when.zone)) out.add(r.when.zone);
  return out;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** Rough horizontal radius (m) of an entity's own shape, or null when it has none to own things by. */
export function footprintRadius(e: Entity): number | null {
  const s = e.transform.scale;
  const k = Math.max(Math.abs(s[0]), Math.abs(s[2]));
  const sh = e.shape;
  switch (sh.kind) {
    case 'primitive':
      return (Math.max(sh.size[0], sh.primitive === 'sphere' ? sh.size[0] : sh.size[2]) / 2) * k;
    case 'procedural': {
      const p = sh.params as Record<string, unknown>;
      const r = num(p['radius']) ?? (num(p['diameter']) !== null ? (num(p['diameter']) as number) / 2 : null);
      const w = num(p['width']) ?? num(p['size']) ?? num(p['length']) ?? num(p['span']);
      const d = num(p['depth']) ?? num(p['length']);
      const half = r ?? (w !== null || d !== null ? Math.max(w ?? 0, d ?? 0) / 2 : 1.5);
      return half * k;
    }
    case 'asset':
    case 'model':
    case 'mesh':
      return 1.5 * k;
    default:
      return null;
  }
}

function ownerCandidate(e: Entity): boolean {
  if (e.template || e.npc || e.character || e.shape.kind === 'none' || e.shape.kind === 'scatter') return false;
  if (e.arch) return false;
  if (e.tags.some((t) => GROUND_TAG.test(t))) return false;
  if (e.shape.kind === 'procedural' && GROUND_GENERATORS.has(e.shape.generator)) return false;
  if (e.behaviors.some((b) => b.type === 'collectible' || b.type === 'patrol' || b.type === 'wander')) return false;
  return true;
}

/** The owner a name or id points at: "shrine-light" → shrine, "Shrine goal" → the entity named "Shrine". */
function namedOwner(e: Entity, byId: ReadonlyMap<string, EntityId>, byName: ReadonlyMap<string, EntityId>): EntityId | null {
  const idParts = e.id.split(/[-_]/);
  for (let n = idParts.length - 1; n >= 1; n--) {
    const head = idParts.slice(0, n).join('-');
    const next = idParts[n] as string;
    if (!PART_WORDS.has(next)) continue;
    const owner = byId.get(head) ?? byId.get(idParts.slice(0, n).join('_'));
    if (owner && owner !== e.id) return owner;
  }
  const nw = words(e.name);
  for (let n = nw.length - 1; n >= 1; n--) {
    if (!PART_WORDS.has(nw[n] as string)) continue;
    const owner = byName.get(nw.slice(0, n).join(' '));
    if (owner && owner !== e.id) return owner;
  }
  return null;
}

/** Who owns what in one world. */
export interface DependencyIndex {
  /** The owner of `id` (not its parent), or null. */
  ownerOf(id: EntityId): Dependency | null;
  /** Direct dependents of `id` (not its children). */
  dependentsOf(id: EntityId): EntityId[];
  /**
   * `ids` with everything that belongs to them: children, dependents, their
   * children and dependents, and so on (capped).
   */
  closure(ids: Iterable<EntityId>): Set<EntityId>;
}

/** Build the dependency index of a world. */
export function dependencyIndex(world: WorldDoc): DependencyIndex {
  const ents = world.entities;
  const owners = new Map<EntityId, Dependency>();
  const children = new Map<EntityId, EntityId[]>();
  const byId = new Map<string, EntityId>();
  const byName = new Map<string, EntityId>();
  const nameCount = new Map<string, number>();
  for (const id of Object.keys(ents)) {
    const e = ents[id] as Entity;
    if (e.parent !== null) {
      const list = children.get(e.parent);
      if (list) list.push(id);
      else children.set(e.parent, [id]);
    }
    if (!ownerCandidate(e)) continue;
    byId.set(id, id);
    const n = words(e.name).join(' ');
    if (n.length >= 3) {
      nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
      byName.set(n, id);
    }
  }
  // A name several objects share ("Tree") points at none of them.
  for (const [n, c] of nameCount) if (c > 1) byName.delete(n);
  const zones = ruleZones(world);
  const pos = new Map<EntityId, Vec3>();
  const at = (id: EntityId): Vec3 | null => {
    const hit = pos.get(id);
    if (hit) return hit;
    try {
      const p = worldTransform(world, id).position;
      pos.set(id, p);
      return p;
    } catch {
      return null;
    }
  };
  // Owners by proximity: top-level objects with a footprint.
  const near: Array<{ id: EntityId; r: number }> = [];
  for (const id of byId.keys()) {
    const e = ents[id] as Entity;
    const r = footprintRadius(e);
    if (r !== null && r <= MAX_OWNER_RADIUS) near.push({ id, r: Math.max(0.5, r) });
  }
  for (const id of Object.keys(ents)) {
    const e = ents[id] as Entity;
    if (e.template) continue;
    if (e.attachedTo !== undefined && e.attachedTo !== id && hasOwn(ents, e.attachedTo)) {
      owners.set(id, { owner: e.attachedTo, why: 'attached' });
      continue;
    }
    if (e.npc || e.character) continue;
    const named = namedOwner(e, byId, byName);
    if (named && (ents[named] as Entity).parent === e.parent && !isAncestor(ents, id, named)) {
      owners.set(id, { owner: named, why: 'named' });
      continue;
    }
    if (e.parent !== null || !isSatellite(e, zones)) continue;
    const p = at(id);
    if (!p) continue;
    let best: { id: EntityId; score: number } | null = null;
    for (const o of near) {
      if (o.id === id || (ents[o.id] as Entity).parent !== null) continue;
      const q = at(o.id);
      if (!q) continue;
      const d = Math.hypot(p[0] - q[0], p[2] - q[2]);
      const dy = p[1] - q[1];
      if (d > o.r + NEAR_MARGIN || dy < -2 || dy > 12 + o.r) continue;
      // The most specific object wins: the shrine on the hill, not the hill under it (smallest footprint, then nearest).
      const score = o.r + d * 0.01;
      if (!best || score < best.score) best = { id: o.id, score };
    }
    if (best) owners.set(id, { owner: best.id, why: 'nearby' });
  }
  // Owners never form a loop: an entity that would own its own owner keeps the explicit side.
  for (const [id, dep] of [...owners]) {
    const seen = new Set<EntityId>([id]);
    let cur: EntityId | undefined = dep.owner;
    while (cur !== undefined && !seen.has(cur) && seen.size < 64) {
      seen.add(cur);
      cur = owners.get(cur)?.owner;
    }
    if (cur !== undefined && seen.has(cur) && dep.why !== 'attached') owners.delete(id);
  }
  const deps = new Map<EntityId, EntityId[]>();
  for (const [id, dep] of owners) {
    const list = deps.get(dep.owner);
    if (list) list.push(id);
    else deps.set(dep.owner, [id]);
  }
  return {
    ownerOf: (id) => owners.get(id) ?? null,
    dependentsOf: (id) => [...(deps.get(id) ?? [])],
    closure(ids) {
      const out = new Set<EntityId>();
      const stack = [...ids].filter((id) => hasOwn(ents, id));
      while (stack.length > 0 && out.size < 5000) {
        const id = stack.pop() as EntityId;
        if (out.has(id)) continue;
        out.add(id);
        for (const c of children.get(id) ?? []) if (!out.has(c)) stack.push(c);
        for (const d of deps.get(id) ?? []) if (!out.has(d)) stack.push(d);
      }
      return out;
    },
  };
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** A dependent carried along with its owner. */
export interface CarriedDependent {
  id: EntityId;
  owner: EntityId;
}

/**
 * Patches that carry the dependents of moved objects along: when an object in `moved` changed its position (or
 * its heading) from `before` to `after`, everything that belongs to it and was not changed itself (`touched`)
 * gets the same rigid move (a turn swings it round the owner). Children follow their parent anyway and are left
 * out; so is a dependent in another frame than its owner (a different parent). Pure.
 */
export function carryPatches(before: WorldDoc, after: WorldDoc, moved: Iterable<EntityId>, touched: ReadonlySet<EntityId> = new Set()): { patches: Patch[]; carried: CarriedDependent[] } {
  const index = dependencyIndex(before);
  const patches: Patch[] = [];
  const carried: CarriedDependent[] = [];
  const done = new Set<EntityId>();
  for (const id of moved) {
    const a = hasOwn(before.entities, id) ? (before.entities[id] as Entity) : undefined;
    const b = hasOwn(after.entities, id) ? (after.entities[id] as Entity) : undefined;
    if (!a || !b || a.parent !== b.parent) continue;
    const p0 = a.transform.position;
    const p1 = b.transform.position;
    const turn = b.transform.rotation[1] - a.transform.rotation[1];
    const tilted = b.transform.rotation[0] !== a.transform.rotation[0] || b.transform.rotation[2] !== a.transform.rotation[2];
    const shift = Math.abs(p1[0] - p0[0]) + Math.abs(p1[1] - p0[1]) + Math.abs(p1[2] - p0[2]);
    const yaw = tilted ? 0 : (turn * Math.PI) / 180;
    if (shift < 1e-6 && Math.abs(yaw) < 1e-9) continue;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const stack = index.dependentsOf(id);
    while (stack.length > 0 && carried.length < 200) {
      const d = stack.pop() as EntityId;
      if (done.has(d) || touched.has(d) || d === id || !hasOwn(after.entities, d)) continue;
      const de = after.entities[d] as Entity;
      if (de.parent !== a.parent) continue;
      done.add(d);
      // The offset from the owner turns with it (yaw about +Y: x' = x cos + z sin, z' = -x sin + z cos).
      const q = de.transform.position;
      const ox = q[0] - p0[0];
      const oz = q[2] - p0[2];
      const position: Vec3 = [r3(p1[0] + ox * c + oz * s), r3(q[1] + (p1[1] - p0[1])), r3(p1[2] - ox * s + oz * c)];
      const rot = de.transform.rotation;
      const transform: Record<string, Vec3> = { position };
      if (yaw !== 0) transform['rotation'] = [rot[0], r3(rot[1] + turn), rot[2]];
      patches.push({ op: 'update', id: d, set: { transform } });
      carried.push({ id: d, owner: id });
      for (const next of index.dependentsOf(d)) stack.push(next);
    }
  }
  return { patches, carried };
}

function isAncestor(ents: WorldDoc['entities'], ancestor: EntityId, id: EntityId): boolean {
  let cur: EntityId | null = id;
  for (let i = 0; cur !== null && i < 64; i++) {
    if (cur === ancestor) return true;
    cur = hasOwn(ents, cur) ? (ents[cur] as Entity).parent : null;
  }
  return false;
}
