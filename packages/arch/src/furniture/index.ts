/**
 * Furniture catalogue: every `furn-*` generator, lookup by id or kind, param
 * resolution (defaults, clamping, enum matching — mirrors procgen's
 * `resolveParams`, which this package cannot import) and sizing for layouts.
 */
import { isForbiddenKey, type Json, type ParamSpec } from '@aether/core';
import type { ArchOutput } from '../types';
import { MovableSink, reader, type FurnitureDef, type MovableSpec, type ParamReader } from './kit';
import { PartSet } from '../parts';
import { SEATING } from './seating';
import { TABLES } from './tables';
import { BEDROOM } from './bedroom';
import { KITCHEN_SET } from './kitchen';
import { BATH } from './bath';
import { SINKS } from './sink';
import { CANE } from './cane';
import { DECOR } from './decor';
import { LIGHTING } from './lighting';
import { TREES } from './trees';
import { VENUE } from './venue';
import { CIVIC } from './civic';
import { WORLD_PIECES } from './world';

export type { FurnitureDef, Mount, MovableMotion, MovableSpec, ParamReader } from './kit';
export { glowMaterial } from './lighting';
export { tierHeights, TIER_BASE } from './venue';

/** Every furniture generator, in a stable order. */
export const FURNITURE: readonly FurnitureDef[] = Object.freeze([...SEATING, ...CANE, ...TABLES, ...BEDROOM, ...KITCHEN_SET, ...BATH, ...SINKS, ...DECOR, ...LIGHTING, ...TREES, ...VENUE, ...CIVIC, ...WORLD_PIECES]);

const BY_ID: ReadonlyMap<string, FurnitureDef> = new Map(FURNITURE.map((f) => [f.id, f]));
const BY_KIND: ReadonlyMap<string, FurnitureDef> = new Map(FURNITURE.map((f) => [f.kind, f]));

/** Names the older pieces are also asked for by (the newer ones carry `aliases` on the definition). */
const EXTRA_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'cane-chair': ['rattan chair', 'wicker chair', 'cane chair', 'bentwood chair'],
  sink: ['washbasin', 'wash basin', 'basin', 'hand basin', 'pedestal sink', 'vessel sink', 'utility sink'],
  fridge: ['refrigerator', 'fridge freezer'],
  oven: ['cooker', 'stove', 'range cooker', 'hob'],
  extractor: ['range hood', 'cooker hood', 'extractor hood'],
  bookshelf: ['bookcase', 'book shelf', 'bookshelves', 'shelving unit'],
  art: ['painting', 'picture frame', 'framed art', 'wall art', 'framed painting', 'poster frame', 'artwork'],
  'cafe-counter': ['coffee counter', 'espresso bar', 'cafe counter', 'coffee bar', 'bakery counter'],
  whiteboard: ['white board', 'dry erase board'],
  rug: ['carpet', 'area rug', 'carpet runner'],
  'bar-stool': ['bar stool', 'counter stool', 'high stool'],
  'office-chair': ['desk chair', 'swivel chair', 'task chair'],
  'dining-table': ['restaurant table', 'dining table', 'kitchen table'],
  tree: ['indoor tree', 'potted tree'],
};

const STOP = new Set(['a', 'an', 'the', 'of', 'for', 'and', 'with', 'in', 'on', 'to', 'small', 'big', 'large', 'old', 'new', 'wooden', 'modern']);
const singular = (w: string): string => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') ? w.slice(0, -1) : w);
/** Normalised phrase: lower case, punctuation to spaces, plural words made singular. */
function phrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(singular)
    .join(' ');
}

const ALIAS_KIND: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const f of FURNITURE) {
    for (const a of [f.kind, ...(f.aliases ?? []), ...(EXTRA_ALIASES[f.kind] ?? [])]) if (!m.has(phrase(a))) m.set(phrase(a), f.kind);
  }
  return m;
})();

/** The furniture kind a word names: the kind itself, else one of its aliases ("theatre seat" is a cinema-seat), else undefined. */
export function resolveFurnitureKind(word: string): string | undefined {
  if (BY_KIND.has(word)) return word;
  return ALIAS_KIND.get(phrase(word));
}

/** Furniture definition by generator id. */
export function furnitureById(id: string): FurnitureDef | undefined {
  return BY_ID.get(id);
}

/** Furniture definition by kind ("sofa", "bed") or by one of its aliases ("theatre seat"). */
export function furnitureByKind(kind: string): FurnitureDef | undefined {
  const direct = BY_KIND.get(kind);
  if (direct) return direct;
  const k = ALIAS_KIND.get(phrase(kind));
  return k ? BY_KIND.get(k) : undefined;
}

/**
 * The crafted parts that answer a free-text request ("cinema seat", "church pew", "glass display case"), best first. A part
 * matches by its kind or an alias appearing in the text (strongest), or by the words of the text found in its names and
 * description. Used by `find_model` so a real piece is offered before a box is built.
 */
export function findCrafted(text: string, limit = 4): FurnitureDef[] {
  const q = phrase(text);
  if (!q) return [];
  const words = q.split(' ').filter((w) => !STOP.has(w));
  const padded = ` ${q} `;
  const scored: Array<{ def: FurnitureDef; score: number }> = [];
  for (const f of FURNITURE) {
    let score = 0;
    const names = [f.kind, ...(f.aliases ?? []), ...(EXTRA_ALIASES[f.kind] ?? [])].map(phrase);
    for (const n of names) {
      if (n === q) score = Math.max(score, 100);
      else if (padded.includes(` ${n} `)) score = Math.max(score, 60 + n.split(' ').length * 8);
    }
    if (score === 0) {
      const hay = new Set(names.join(' ').split(' ').concat(phrase(f.description.split(/[.;:]/)[0] ?? '').split(' ')));
      const hits = words.filter((w) => hay.has(w)).length;
      if (hits > 0 && hits >= Math.ceil(words.length / 2)) score = 20 + 10 * hits;
    }
    if (score >= 30) scored.push({ def: f, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.def);
}

function coerce(spec: ParamSpec, v: unknown): Json | undefined {
  switch (spec.type) {
    case 'number':
    case 'int': {
      let n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && v.length < 32 ? Number(v) : Number.NaN;
      if (!Number.isFinite(n)) return undefined;
      if (spec.type === 'int') n = Math.round(n);
      if (spec.min !== undefined && n < spec.min) n = spec.min;
      if (spec.max !== undefined && n > spec.max) n = spec.max;
      return n;
    }
    case 'boolean':
      return typeof v === 'boolean' ? v : undefined;
    case 'color':
      return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined;
    case 'enum': {
      if (typeof v !== 'string') return undefined;
      const opts = spec.options ?? [];
      return opts.find((o) => o.toLowerCase() === v.toLowerCase());
    }
  }
}

/** Resolve untrusted params against a spec (defaults, clamping; unknown keys dropped). */
export function resolveSpec(spec: Record<string, ParamSpec>, params: Record<string, Json> | undefined): Record<string, Json> {
  const out: Record<string, Json> = {};
  const given = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  for (const key of Object.keys(spec)) {
    if (isForbiddenKey(key)) continue;
    const s = spec[key] as ParamSpec;
    const v = Object.hasOwn(given, key) ? coerce(s, given[key]) : undefined;
    out[key] = v !== undefined ? v : (coerce(s, s.default) ?? s.default);
  }
  return out;
}

/** Reader over resolved params of a furniture definition. */
export function furnitureReader(def: FurnitureDef, params: Record<string, Json> | undefined): ParamReader {
  return reader(resolveSpec(def.params, params), def.params);
}

/** Footprint (width X, height, depth Z) of a piece with the given params. */
export function furnitureSize(def: FurnitureDef, params?: Record<string, Json>): [number, number, number] {
  return def.size(furnitureReader(def, params));
}

/** Build a piece of furniture (with `interactive: true`, without the parts that open: see {@link buildFurniturePart}). */
export function buildFurniture(def: FurnitureDef, params: Record<string, Json> | undefined, seed: number): ArchOutput {
  const r = furnitureReader(def, params);
  return def.build(r, seed >>> 0, def.interactive && r.bool('interactive') ? new MovableSink() : undefined);
}

/** The drawers, cabinet doors and appliance doors of an `interactive` piece (empty otherwise). */
export function furnitureMovables(def: FurnitureDef, params: Record<string, Json> | undefined, seed: number): MovableSpec[] {
  if (!def.interactive) return [];
  const r = furnitureReader(def, { ...(params ?? {}), interactive: true });
  const sink = new MovableSink();
  def.build(r, seed >>> 0, sink);
  return sink.specs;
}

/**
 * Geometry of one movable part, centred on the part's own origin (the entity
 * sits at `spec.center` in the piece frame) with a box collider the size of
 * the part. Null for an unknown part id.
 */
export function buildFurniturePart(def: FurnitureDef, params: Record<string, Json> | undefined, seed: number, partId: string): ArchOutput | null {
  const spec = furnitureMovables(def, params, seed).find((m) => m.id === partId);
  if (!spec) return null;
  const set = new PartSet();
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const part of spec.parts) {
    const g = part.geom.clone().translate(-spec.center[0], -spec.center[1], -spec.center[2]);
    set.add(g, part.material);
    const b = g.bounds();
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a] as number, b[a] as number);
      hi[a] = Math.max(hi[a] as number, b[a + 3] as number);
    }
  }
  // One box around everything the part draws (front, handle and a drawer's tray): aiming at the inside of an open
  // drawer finds it, and the player cannot walk through it.
  if (Number.isFinite(lo[0] + hi[0])) set.box([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2]);
  else set.box([0, 0, 0], [spec.size[0] / 2, spec.size[1] / 2, spec.size[2] / 2]);
  return set.build();
}
