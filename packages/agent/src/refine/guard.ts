/**
 * The minimal-patch guard. A small edit ("make the sofa green") must not move,
 * recolour or remove unrelated things, whoever wrote the patch. The scope of
 * a request is the entities it names; patches that change existing entities
 * outside that scope are refused with a message the model can act on.
 */
import { applyPatches, dependencyIndex, type EntityId, type WorldDoc } from '@aether/core';
import { changedEntityIds, worldChanges } from './changes';
import type { Command } from './command';
import { singular } from './lexicon';
import { parseEdit } from './parse';
import { resolveRef, type ResolveContext } from './resolve';
import { sceneOf, type SceneIndex } from './scene';

/** What a request is allowed to touch. */
export interface RequestScope {
  /** 'small': only the named things; 'broad': a scene-wide change. */
  kind: 'small' | 'broad';
  /** Entities the request names (with descendants); empty when none could be identified. */
  allowed: ReadonlySet<EntityId>;
  /** Short reason for logs and messages. */
  reason: string;
}

const BROAD = /\b(?:all|every|everything|everywhere|whole|entire|scene|world|theme|style|redecorate|redesign|makeover|rebuild|regenerate|from scratch|restyle|reorgani[sz]e|rearrange|overhaul|each|season|winter|autumn|summer|spring|harder|easier|difficulty|level|map|layout|floor ?plan|second floor|extra floor|another floor|upstairs|downstairs|new (?:room|level|area|section)|extend|expand)\b/;

/** Max existing entities a small edit without an identified target may change. */
export const UNTARGETED_LIMIT = 8;

function refsOf(c: Command): Array<NonNullable<Extract<Command, { ref: unknown }>['ref']>> {
  const out: Array<NonNullable<Extract<Command, { ref: unknown }>['ref']>> = [];
  if ('ref' in c && c.ref) out.push(c.ref);
  if (c.op === 'move' && c.to) out.push(c.to.anchor);
  return out;
}

/** Words that never name a thing ("the" would match "Shrine of the Five Lights"). */
const FUNCTION_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'onto', 'along', 'back', 'forth', 'make', 'more', 'less', 'than', 'that', 'this', 'these', 'those',
  'its', 'all', 'some', 'any', 'one', 'two', 'three', 'bit', 'very', 'just', 'also', 'then', 'them', 'they', 'their', 'there', 'here', 'over',
  'under', 'near', 'next', 'left', 'right', 'top', 'side', 'end', 'little', 'big', 'small', 'like', 'keep', 'please', 'can', 'you', 'new', 'add',
  'put', 'move', 'set', 'get', 'have', 'has', 'not', 'but', 'out', 'off', 'way', 'should', 'would', 'could', 'when', 'where', 'what', 'which',
  'metre', 'metres', 'meter', 'meters', 'bigger', 'smaller', 'larger', 'taller', 'shorter', 'other', 'each', 'every', 'around', 'between',
]);

/** Words of the request that name things in the world (beyond the references the parser resolved). */
function namedItems(index: SceneIndex, text: string, covered: ReadonlySet<string> = new Set()): Set<EntityId> {
  const raw = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !FUNCTION_WORDS.has(w) && !covered.has(w) && !covered.has(singular(w)));
  // "wolves" names the wolf: plural words count by their singular too.
  const words = new Set([...raw, ...raw.map(singular)]);
  const out = new Set<EntityId>();
  for (const it of index.items) {
    if (it.isPart || it.entity.tags.includes('backdrop')) continue;
    for (const t of it.tokens) {
      if (words.has(t) || words.has(`${t}s`)) {
        out.add(it.id);
        break;
      }
    }
  }
  return out;
}

/** Decide what `text` may touch in `world`. */
export function classifyScope(world: WorldDoc, text: string, ctx: ResolveContext): RequestScope {
  const index = sceneOf(world);
  const parsed = parseEdit(text);
  if (parsed.newWorld) return { kind: 'broad', allowed: new Set(), reason: 'asks for a new world' };
  if (BROAD.test(text.toLowerCase())) return { kind: 'broad', allowed: new Set(), reason: 'asks for a scene-wide change' };
  const allowed = new Set<EntityId>();
  // Words of references that resolved ("the second tent"): their precise reading stands, the loose word match below
  // must not widen it to every tent.
  const covered = new Set<string>();
  for (const c of parsed.commands) {
    if (c.op === 'env' || c.op === 'game' || c.op === 'undo' || c.op === 'redo') {
      if (c.op === 'env' && c.set.season) return { kind: 'broad', allowed, reason: 'changes the season' };
      continue;
    }
    for (const ref of refsOf(c)) {
      const r = resolveRef(index, ref, ctx);
      if (r.items.length > 0 || (r.ambiguous?.length ?? 0) > 0) for (const w of ref.text.toLowerCase().split(/[^a-z0-9]+/)) if (w) covered.add(singular(w));
      for (const it of r.items) for (const id of index.subtree(it.id)) allowed.add(id);
      for (const it of r.ambiguous ?? []) for (const id of index.subtree(it.id)) allowed.add(id);
      if (r.faces) for (const f of r.faces) allowed.add(f.wallId);
    }
  }
  for (const id of ctx.selection) for (const s of index.subtree(id)) allowed.add(s);
  // What the request names is in scope even when the parser read only part of it ("make the wolves patrol along the
  // river bank" names the wolves as well as the river).
  for (const id of namedItems(index, text, covered)) for (const s of index.subtree(id)) allowed.add(s);
  // What belongs to a named thing is part of it: the shrine's light, goal zone and plinth move and change with it.
  if (allowed.size > 0) for (const id of dependencyIndex(world).closure([...allowed])) allowed.add(id);
  // So are the pieces its id names as its own ("shrine" owns "shrine-torii" and "shrine-beacon"; "wolf-2" is a sibling, not a piece).
  for (const id of [...allowed]) for (const other of Object.keys(world.entities)) if (other.startsWith(`${id}-`) && !/^\d+$/.test(other.slice(id.length + 1))) allowed.add(other);
  return { kind: 'small', allowed, reason: allowed.size > 0 ? `names ${allowed.size} object${allowed.size === 1 ? '' : 's'}` : 'names no object' };
}

/** Outcome of auditing a patch list. */
export interface PatchAudit {
  ok: boolean;
  /** Existing entities the patches change outside the scope. */
  offending: EntityId[];
  /** Existing entities changed in total. */
  touched: number;
  /** A message the model can act on (when not ok). */
  message: string;
}

/**
 * Check `patches` against the request scope. New entities are always fine;
 * what matters is how many *existing* entities change or disappear. What the
 * assistant itself added earlier in the same turn (`turnStart` lacks it) is its own
 * work in progress: a failed first attempt may be replaced or removed.
 */
export function auditPatches(world: WorldDoc, patches: readonly unknown[], scope: RequestScope, turnStart?: WorldDoc): PatchAudit {
  if (scope.kind === 'broad') return { ok: true, offending: [], touched: 0, message: '' };
  const result = applyPatches(world, patches);
  const changes = worldChanges(world, result.world).filter((c) => c.scope === 'entity' && Object.hasOwn(world.entities, c.id));
  const touched = changedEntityIds(changes).filter((id) => Object.hasOwn(world.entities, id));
  // Children of a removed/changed parent that were reparented are not offenders; bookkeeping on the building (tombstones) is expected.
  const offending = touched.filter((id) => !scope.allowed.has(id) && !(world.entities[id]?.arch?.role === 'building') && !(turnStart && !Object.hasOwn(turnStart.entities, id)));
  const limit = scope.allowed.size === 0 ? UNTARGETED_LIMIT : 0;
  if (offending.length <= limit) return { ok: true, offending: [], touched: touched.length, message: '' };
  const names = offending.slice(0, 6).map((id) => `${world.entities[id]?.name || id} (${id})`).join(', ');
  const allowedNames = [...scope.allowed].filter((id) => Object.hasOwn(world.entities, id)).slice(0, 6).join(', ');
  return {
    ok: false,
    offending,
    touched: touched.length,
    message: `Rejected: this is a small edit, but the patch also changes ${offending.length} unrelated existing object(s): ${names}${offending.length > 6 ? ', …' : ''}. Nothing was applied. Resend a minimal patch that changes only what the user named${allowedNames ? ` (${allowedNames})` : ''}; leave everything else untouched, with property-level "update" patches (never remove and re-add, never clear).`,
  };
}
