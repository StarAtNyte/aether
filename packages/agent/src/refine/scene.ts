/**
 * SceneIndex — a searchable view of a world for resolving "the sofa",
 * "the second chair", "the bedroom's back wall". Built once per world
 * object (cached), pure, no DOM.
 *
 * Each entity becomes a {@link SceneItem}: a display label, the set of words
 * that name it (name, id, arch kind, generator, tags), its world position and
 * a rough size, and the room it stands in.
 */
import { furnitureById, furnitureSize } from '@aether/arch';
import type { Entity, EntityId, Json, WorldDoc } from '@aether/core';
import { singular } from './lexicon';

/** A 3-vector. */
export type V3 = [number, number, number];

/** One entity as the resolver sees it. */
export interface SceneItem {
  id: EntityId;
  entity: Entity;
  /** Display name ("Sofa", "Mira the lamplighter"). */
  label: string;
  /** Primary noun ("sofa", "tree", "coin"). */
  kind: string;
  /** Singular lowercase words naming it. */
  tokens: ReadonlySet<string>;
  /** World position. */
  pos: V3;
  /** World yaw (degrees, accumulated over parents). */
  yaw: number;
  /** Approximate world size (width, height, depth). */
  size: V3;
  /** Room entity id, when it stands in one. */
  roomId?: EntityId;
  /** Nesting depth below a root. */
  depth: number;
  /** A sub-part of a composite object (not selectable unless named). */
  isPart: boolean;
  /** Creation order (document order). */
  order: number;
  /** Words naming the room it stands in ("dining", "kitchen", "bedroom"). */
  roomTokens: ReadonlySet<string>;
}

const HUMAN_SPLIT = /[^a-z0-9]+/;

function words(text: string): string[] {
  return text.toLowerCase().split(HUMAN_SPLIT).filter((w) => w.length > 0);
}

/** "coffee-table" → "coffee table". */
export function humanize(text: string): string {
  return words(text).filter((w) => !/^\d+$/.test(w)).join(' ');
}

function num(v: Json | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Rough footprint/height of an entity in metres (before parent scale). */
export function estimateSize(e: Entity): V3 {
  const s = e.transform.scale;
  const sh = e.shape;
  switch (sh.kind) {
    case 'primitive':
      return [Math.abs(sh.size[0] * s[0]), Math.abs(sh.size[1] * s[1]), Math.abs(sh.size[2] * s[2])];
    case 'procedural': {
      const p = sh.params;
      const furn = furnitureById(sh.generator);
      if (furn) {
        const [w, h, d] = furnitureSize(furn, p as Record<string, Json>);
        return [w * s[0], h * s[1], d * s[2]];
      }
      const r = num(p['radius'], 0);
      const w = num(p['width'], num(p['length'], num(p['size'], r > 0 ? r * 2 : 1.5)));
      const h = num(p['height'], num(p['size'], r > 0 ? r * 2 : 1.5));
      const d = num(p['depth'], num(p['width'], r > 0 ? r * 2 : w));
      return [w * s[0], h * s[1], d * s[2]];
    }
    case 'asset':
      return [(sh.fitSize ?? 1) * s[0], (sh.fitSize ?? 1) * s[1], (sh.fitSize ?? 1) * s[2]];
    case 'model':
      return [(sh.fitSize ?? 1) * s[0], (sh.fitSize ?? 1) * s[1], (sh.fitSize ?? 1) * s[2]];
    case 'scatter':
      return [sh.area[0], 1, sh.area[1]];
    default:
      return [s[0], s[1], s[2]];
  }
}

function kindOf(e: Entity): string {
  // A door's kind is its style ("swing"), a wall's is exterior/interior: the thing is a door, a wall.
  if (e.arch && ['door', 'window', 'wall', 'opening', 'stair', 'roof', 'ceiling', 'railing'].includes(e.arch.role)) return e.arch.role;
  if (e.arch?.kind) return humanize(e.arch.kind);
  const sh = e.shape;
  if (sh.kind === 'procedural') return humanize(sh.generator.replace(/^(furn|arch)-/, ''));
  if (sh.kind === 'asset') return humanize(sh.id);
  if (sh.kind === 'scatter') return humanize(sh.of.kind === 'procedural' ? sh.of.generator : sh.of.primitive);
  if (sh.kind === 'primitive') return humanize(e.name || e.id) || sh.primitive;
  return humanize(e.name || e.id);
}

function tokensOf(e: Entity, kind: string): Set<string> {
  const t = new Set<string>();
  const add = (text: string | undefined): void => {
    if (!text) return;
    for (const w of words(text)) t.add(singular(w));
  };
  add(e.name);
  for (const w of words(e.id)) if (!/^\d+$/.test(w)) t.add(singular(w));
  add(kind);
  add(e.arch?.kind);
  add(e.arch?.name);
  if (e.arch?.role && e.arch.role !== 'furniture') add(e.arch.role);
  for (const tag of e.tags) add(tag);
  const sh = e.shape;
  if (sh.kind === 'procedural') add(sh.generator.replace(/^(furn|arch)-/, ''));
  else if (sh.kind === 'asset') add(sh.id);
  else if (sh.kind === 'primitive') add(sh.primitive);
  else if (sh.kind === 'scatter') add(sh.of.kind === 'procedural' ? sh.of.generator : sh.of.primitive);
  for (const b of e.behaviors) {
    if (b.type === 'collectible') t.add('collectible');
    if (b.type === 'npc') t.add('npc');
    if (b.type === 'patrol' || b.type === 'wander' || b.type === 'follow') t.add('mover');
    if (b.type === 'playerController') t.add('player');
  }
  if (e.light) t.add('light');
  return t;
}

const EMPTY_TOKENS: ReadonlySet<string> = new Set();

/** Scale contributed by the parents (world / local). */
function ratio(world: number, local: number): number {
  return local !== 0 ? Math.abs(world / local) : 1;
}

/** The world as a list of resolvable items. */
export class SceneIndex {
  readonly items: SceneItem[] = [];
  readonly byId = new Map<EntityId, SceneItem>();
  readonly rooms: SceneItem[] = [];
  private readonly kids = new Map<EntityId, EntityId[]>();

  constructor(readonly world: WorldDoc) {
    const ents = Object.values(world.entities).filter((e) => !e.template);
    for (const e of Object.values(world.entities)) {
      if (e.parent !== null) {
        const list = this.kids.get(e.parent);
        if (list) list.push(e.id);
        else this.kids.set(e.parent, [e.id]);
      }
    }
    const frame = new Map<EntityId, { pos: V3; yaw: number; scale: V3; depth: number }>();
    const resolve = (e: Entity, guard = 0): { pos: V3; yaw: number; scale: V3; depth: number } => {
      const hit = frame.get(e.id);
      if (hit) return hit;
      const parent = e.parent !== null && guard < 24 ? world.entities[e.parent] : undefined;
      const t = e.transform;
      let out: { pos: V3; yaw: number; scale: V3; depth: number };
      if (!parent) out = { pos: [t.position[0], t.position[1], t.position[2]], yaw: t.rotation[1], scale: [t.scale[0], t.scale[1], t.scale[2]], depth: 0 };
      else {
        const pf = resolve(parent, guard + 1);
        const a = (pf.yaw * Math.PI) / 180;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const lx = t.position[0] * pf.scale[0];
        const lz = t.position[2] * pf.scale[2];
        out = {
          pos: [pf.pos[0] + lx * c + lz * s, pf.pos[1] + t.position[1] * pf.scale[1], pf.pos[2] - lx * s + lz * c],
          yaw: pf.yaw + t.rotation[1],
          scale: [pf.scale[0] * t.scale[0], pf.scale[1] * t.scale[1], pf.scale[2] * t.scale[2]],
          depth: pf.depth + 1,
        };
      }
      frame.set(e.id, out);
      return out;
    };
    let order = 0;
    for (const e of ents) {
      const f = resolve(e);
      const kind = kindOf(e);
      const parent = e.parent !== null ? world.entities[e.parent] : undefined;
      const archParent = parent?.arch?.role === 'level' || parent?.arch?.role === 'building';
      const size = estimateSize(e);
      const item: SceneItem = {
        id: e.id,
        entity: e,
        label: e.name || kind || e.id,
        kind,
        tokens: tokensOf(e, kind),
        pos: f.pos,
        yaw: f.yaw,
        size: [size[0] * ratio(f.scale[0], e.transform.scale[0]), size[1] * ratio(f.scale[1], e.transform.scale[1]), size[2] * ratio(f.scale[2], e.transform.scale[2])],
        ...(e.arch?.room ? { roomId: e.arch.room } : {}),
        depth: f.depth,
        isPart: parent !== undefined && !archParent,
        order: order++,
        roomTokens: EMPTY_TOKENS,
      };
      this.items.push(item);
      this.byId.set(e.id, item);
      if (e.arch?.role === 'room') this.rooms.push(item);
    }
    for (const it of this.items) {
      const room = it.roomId ? this.byId.get(it.roomId) : undefined;
      if (room) it.roomTokens = room.tokens;
      // A door's leaf is "the front door" when its frame is the entrance.
      if (it.entity.arch?.role === 'door' && it.id.endsWith('-leaf')) {
        const frame = this.byId.get(it.id.slice(0, -5));
        if (frame?.entity.tags.includes('entrance')) for (const w of ['front', 'main', 'entrance', 'entry']) (it.tokens as Set<string>).add(w);
      }
    }
  }

  /** Item by id. */
  get(id: EntityId): SceneItem | undefined {
    return this.byId.get(id);
  }

  /** Direct child ids. */
  childrenOf(id: EntityId): readonly EntityId[] {
    return this.kids.get(id) ?? [];
  }

  /** The id and all descendants. */
  subtree(id: EntityId): EntityId[] {
    const out: EntityId[] = [];
    const stack = [id];
    while (stack.length > 0 && out.length < 5000) {
      const cur = stack.pop() as EntityId;
      out.push(cur);
      for (const c of this.childrenOf(cur)) stack.push(c);
    }
    return out;
  }

  /** The room an item stands in: its declared room, else the room polygon containing it. */
  roomOf(item: SceneItem): SceneItem | undefined {
    if (item.roomId) return this.byId.get(item.roomId);
    return undefined;
  }
}

const CACHE = new WeakMap<WorldDoc, SceneIndex>();

/** The (cached) index of a world. */
export function sceneOf(world: WorldDoc): SceneIndex {
  let idx = CACHE.get(world);
  if (!idx) {
    idx = new SceneIndex(world);
    CACHE.set(world, idx);
  }
  return idx;
}

/** Distance between two items on the ground plane. */
export function groundDistance(a: SceneItem, b: SceneItem): number {
  return Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]);
}
