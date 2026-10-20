/**
 * Shared types of the edit operations: the environment an op reads, the
 * outcome it reports. Ops mutate a {@link Draft}; the patch list is derived
 * from the draft afterwards.
 */
import type { EntityId, ParamSpec, WorldDoc } from '@aether/core';
import type { Ref } from './command';
import type { Draft } from './draft';
import type { ResolveContext } from './resolve';
import type { SceneIndex, SceneItem } from './scene';

/** Parameter specs of a generator id (built-in catalogue, furniture, the world's own generators). */
export type ParamCatalog = (generatorId: string) => Record<string, ParamSpec> | undefined;

/** A short question back to the user, with the candidates to click. */
export interface Question {
  text: string;
  candidates: Array<{ id: EntityId; label: string }>;
}

/** What an op needs. */
export interface OpEnv {
  /** The world before the edit. */
  base: WorldDoc;
  index: SceneIndex;
  ctx: ResolveContext;
  params: ParamCatalog;
  /** Draft being edited. */
  draft: Draft;
  /** Pre-resolved generator definitions that may be added (id → description). */
  addable?: (noun: string) => AddableSpec | null;
}

/** A thing the add op can create. */
export interface AddableSpec {
  /** Entity template (without id/transform). */
  name: string;
  shape: Record<string, unknown>;
  /** Footprint radius in metres. */
  radius: number;
  tags?: string[];
  physics?: Record<string, unknown>;
  behaviors?: Array<{ type: string; params: Record<string, unknown> }>;
}

/** Result of one op. */
export interface OpOutcome {
  ok: boolean;
  /** One short sentence in the past tense ("made the sofa dark green velvet"). */
  summary: string;
  /** Entities the op acted on. */
  targets: EntityId[];
  /** Entities that may legitimately change besides the targets (parents, anchors). */
  also: EntityId[];
  /** True when nothing physical changed (colours, lights, names, text, sky): re-verification can be skipped. */
  cosmetic: boolean;
  /** Notes shown with the result (limitations, assumptions). */
  notes: string[];
  /** Why it could not be done (user-facing). */
  failure?: string;
  /** The refusal is final (a capability limit), not a resolution miss: answer the user instead of asking a model. */
  final?: boolean;
  /** Ask which one. */
  question?: Question;
  /** Entities created. */
  added: EntityId[];
  /** Rooms the edit was about ("the other bedroom" later means a different one). */
  rooms?: EntityId[];
}

/** An empty successful outcome to build on. */
export function outcome(partial: Partial<OpOutcome> = {}): OpOutcome {
  return { ok: true, summary: '', targets: [], also: [], cosmetic: true, notes: [], added: [], ...partial };
}

/** A failed outcome that is the answer ("the bookshelf only comes in wood finishes"). */
export function refused(reason: string, partial: Partial<OpOutcome> = {}): OpOutcome {
  return outcome({ ok: false, failure: reason, final: true, ...partial });
}

/** A failed outcome. */
export function failed(reason: string, partial: Partial<OpOutcome> = {}): OpOutcome {
  return outcome({ ok: false, failure: reason, ...partial });
}

/** Question outcome for an ambiguous reference. */
export function ask(text: string, candidates: readonly SceneItem[]): OpOutcome {
  const shown = candidates.slice(0, 8);
  const cap = text.charAt(0).toUpperCase() + text.slice(1);
  return outcome({ ok: false, failure: cap, question: { text: cap, candidates: shown.map((c, i) => ({ id: c.id, label: distinctLabel(c, shown, i) })) } });
}

/** A label that tells candidates apart: the name, then the room, then the id ("Tent 1"). */
function distinctLabel(item: SceneItem, all: readonly SceneItem[], index: number): string {
  const same = all.filter((o) => o.label === item.label);
  if (same.length < 2) return item.label;
  const rooms = new Set(same.map((o) => o.roomId));
  if (rooms.size === same.length && item.roomId) {
    const room = item.roomTokens.size > 0 ? [...item.roomTokens].filter((t) => !/^(room|f\d+)$/.test(t)).slice(0, 2).join(' ') : '';
    if (room) return `${item.label} · ${room}`;
  }
  const h = item.id.replace(/[-_]+/g, ' ').trim();
  const nice = h.charAt(0).toUpperCase() + h.slice(1);
  return nice.toLowerCase() === item.label.toLowerCase() ? `${item.label} ${index + 1}` : nice;
}

/** Display label of an item with a disambiguating suffix. */
export function labelOf(item: SceneItem): string {
  return item.label;
}

const ORDINAL_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

/** "the sofa" / "the second chair" / "3 chairs". */
/** English plural of a kind noun ("wolf" → "wolves", "bench" → "benches"). */
export function plural(noun: string): string {
  const irregular: Readonly<Record<string, string>> = { wolf: 'wolves', thief: 'thieves', shelf: 'shelves', leaf: 'leaves', knife: 'knives', half: 'halves', elf: 'elves', dwarf: 'dwarves', person: 'people', man: 'men', woman: 'women', child: 'children', mouse: 'mice', goose: 'geese', sheep: 'sheep', fish: 'fish', deer: 'deer' };
  const last = /([a-z]+)$/i.exec(noun)?.[1]?.toLowerCase() ?? '';
  if (irregular[last]) return noun.slice(0, noun.length - last.length) + irregular[last];
  if (/s$/.test(noun)) return noun;
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  if (/(?:ch|sh|x|z)$/i.test(noun)) return `${noun}es`;
  return `${noun}s`;
}

export function describeTargets(items: readonly SceneItem[], ref?: Pick<Ref, 'ordinal'>): string {
  if (items.length === 0) return 'nothing';
  const first = items[0] as SceneItem;
  if (items.length === 1) {
    const ord = ref?.ordinal;
    const word = ord === -1 ? 'last' : ord !== undefined ? ORDINAL_WORDS[ord] : undefined;
    return `the ${word ? `${word} ` : ''}${first.label.toLowerCase()}`;
  }
  const kinds = new Set(items.map((i) => i.kind));
  return kinds.size === 1 ? `${items.length} ${plural(first.kind)}` : `${items.length} objects`;
}
