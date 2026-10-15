/**
 * Noun-phrase parsing: "the second chair in the kitchen", "the lamp left of
 * the window", "the sofa's legs", "these" → a {@link Ref}.
 */
import type { Ref, Relation } from './command';
import { COLOR_WORDS, FILLER_WORDS, NON_ADJECTIVE_COLORS, ORDINALS, SHADE_WORDS, findColor, singular } from './lexicon';

/** Room words (singular) that mark a room phrase rather than an object. */
export const ROOM_WORDS: ReadonlySet<string> = new Set([
  'room', 'bedroom', 'bathroom', 'kitchen', 'hallway', 'hall', 'living', 'lounge', 'dining', 'office', 'garage', 'entry', 'entrance', 'lobby', 'terrace', 'balcony', 'studio',
  'nursery', 'laundry', 'storage', 'pantry', 'cafe', 'study', 'attic', 'basement', 'cellar', 'toilet room', 'washroom', 'loft',
]);

/** Named parts of an object. */
export const PART_WORDS: ReadonlySet<string> = new Set([
  'leg', 'frame', 'cushion', 'pillow', 'seat', 'top', 'base', 'shade', 'handle', 'trim', 'headboard', 'linen', 'border', 'worktop', 'countertop', 'front', 'fronts', 'accent', 'upholstery',
  'cover', 'pot', 'blade', 'sail', 'canopy', 'trunk', 'leaf', 'roof', 'body', 'wheel', 'door', 'window', 'skirting', 'baseboard',
]);

/** Wall-side words. */
export const SIDE_WORDS: ReadonlySet<string> = new Set(['back', 'rear', 'front', 'left', 'right', 'north', 'south', 'east', 'west', 'feature', 'accent', 'far', 'opposite', 'window', 'entrance']);

const RELATIONS: ReadonlyArray<{ re: RegExp; rel: Relation }> = [
  { re: /\b(?:to the )?left (?:of|side of)\b/, rel: 'left of' },
  { re: /\b(?:to the )?right (?:of|side of)\b/, rel: 'right of' },
  { re: /\b(?:on top of|above|over)\b/, rel: 'above' },
  { re: /\b(?:below|beneath|underneath|under)\b/, rel: 'under' },
  { re: /\bbehind\b/, rel: 'behind' },
  { re: /\bin front of\b/, rel: 'in front of' },
  { re: /\b(?:next to|beside|alongside|adjacent to|by)\b/, rel: 'next to' },
  { re: /\b(?:near|close to|around)\b/, rel: 'near' },
];

const PRONOUNS: Readonly<Record<string, NonNullable<Ref['pronoun']>>> = {
  it: 'it', this: 'this', that: 'that', these: 'these', those: 'those', them: 'them', same: 'same', 'the same': 'same', 'the same one': 'same', 'this one': 'this', 'that one': 'that', 'these ones': 'these', 'those ones': 'those', 'them all': 'them', 'the same thing': 'same', 'it too': 'it', 'the same item': 'same',
};

/** Clean a noun phrase: lowercase, drop punctuation and trailing politeness. */
export function cleanPhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']s\b/g, ' ’s')
    .replace(/[^a-z0-9#’\s-]/g, ' ')
    .replace(/\b(?:please|thanks|thank you|for me|now|too|also|as well)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRoomPhrase(words: readonly string[]): boolean {
  const last = words[words.length - 1];
  return last !== undefined && ROOM_WORDS.has(singular(last)) && words.length <= 4;
}

/** Parse a noun phrase into a {@link Ref}. */
export function parseRef(raw: string, depth = 0): Ref {
  let text = cleanPhrase(raw).replace(/^(?:and|then|also)\s+/, '');
  const original = text;
  const empty: Ref = { text: raw.trim(), noun: '', adjectives: [] };

  // Pronouns (alone).
  const pro = PRONOUNS[text.replace(/^(?:the )?(?=same)/, 'the ')] ?? PRONOUNS[text];
  if (pro) return { ...empty, pronoun: pro };

  // Relation to an anchor: "lamp left of the window".
  if (depth < 2) {
    let best: { index: number; length: number; rel: Relation } | null = null;
    for (const r of RELATIONS) {
      const m = r.re.exec(text);
      if (m && (best === null || m.index < best.index)) best = { index: m.index, length: m[0].length, rel: r.rel };
    }
    if (best && best.index > 0) {
      const head = text.slice(0, best.index).trim();
      const anchorText = text.slice(best.index + best.length).trim();
      if (head && anchorText) {
        const ref = parseRef(head, depth + 1);
        const anchor = parseRef(anchorText, depth + 1);
        // "the lamp in the bedroom" is not a relation; room words become the room qualifier.
        if (anchor.noun && ROOM_WORDS.has(anchor.noun) && best.rel !== 'next to') return { ...ref, room: anchor, text: raw.trim() };
        return { ...ref, relation: { rel: best.rel, anchor }, text: raw.trim() };
      }
    }
    // Room qualifier: "in/inside/of/from the kitchen", "kitchen's walls".
    const inRoom = /\b(?:in|inside|within|of|from|at)\s+(?:the\s+)?((?:[a-z0-9]+\s+){0,2}[a-z0-9]+)\s*$/.exec(text);
    if (inRoom && inRoom.index > 0) {
      const roomWords = (inRoom[1] as string).split(' ');
      if (isRoomPhrase(roomWords) || roomWords.some((w) => ROOM_WORDS.has(singular(w)))) {
        const ref = parseRef(text.slice(0, inRoom.index), depth + 1);
        return { ...ref, room: parseRef(inRoom[1] as string, depth + 1), text: raw.trim() };
      }
    }
    // "bedroom's back wall", "the kitchen walls"
    const poss = /^(?:the\s+)?((?:[a-z0-9]+\s+){0,2}?[a-z0-9]+?)\s+’s\s+(.+)$/.exec(text);
    if (poss) {
      const ownerWords = (poss[1] as string).split(' ');
      if (isRoomPhrase(ownerWords)) {
        const ref = parseRef(poss[2] as string, depth + 1);
        return { ...ref, room: parseRef(poss[1] as string, depth + 1), text: raw.trim() };
      }
      // "sofa's legs"
      const partRef = parseRef(poss[2] as string, depth + 1);
      if (partRef.noun && PART_WORDS.has(partRef.noun)) {
        const owner = parseRef(poss[1] as string, depth + 1);
        return { ...owner, part: partRef.noun, text: raw.trim() };
      }
    }
    // "legs of the sofa"
    const partOf = /^(?:the\s+)?([a-z]+)\s+of\s+(?:the\s+)?(.+)$/.exec(text);
    if (partOf && PART_WORDS.has(singular(partOf[1] as string))) {
      const owner = parseRef(partOf[2] as string, depth + 1);
      return { ...owner, part: singular(partOf[1] as string), text: raw.trim() };
    }
  }

  const words = text.replace(/’s\b/g, '').split(' ').filter(Boolean);
  const ref: Ref = { text: raw.trim(), noun: '', adjectives: [] };
  const rest: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string;
    const next = words[i + 1];
    if (w === 'all' || w === 'every' || w === 'each' || w === 'both' || w === 'everything') {
      ref.all = true;
      ref.allWord = true;
      continue;
    }
    if (w === 'whole' || w === 'entire') {
      ref.whole = true;
      continue;
    }
    if (w === 'other' || w === 'another') {
      ref.other = true;
      continue;
    }
    if (w === 'same') {
      ref.pronoun = 'same';
      continue;
    }
    if ((w === 'this' || w === 'that' || w === 'these' || w === 'those') && next !== undefined) {
      ref.pronoun = w;
      continue;
    }
    if (ORDINALS[w] !== undefined && !(w === 'last' && next === undefined)) {
      ref.ordinal = ORDINALS[w];
      continue;
    }
    // "chair 2", "chair #2", "chair number 2"
    if (/^\d+$/.test(w) && rest.length > 0) {
      ref.ordinal = Number(w);
      continue;
    }
    if (w === '#' || w === 'number' || w === 'no') continue;
    if (/^#\d+$/.test(w)) {
      ref.ordinal = Number(w.slice(1));
      continue;
    }
    if (FILLER_WORDS.has(w) && w !== 'main') continue;
    rest.push(w);
  }

  // Colour adjective: "the red chair". Only when something follows the colour.
  const nounish = rest.filter((w) => !SHADE_WORDS.has(w));
  if (nounish.length > 1 && COLOR_WORDS.has(nounish[0] as string) && !NON_ADJECTIVE_COLORS.has(nounish[0] as string)) {
    const col = findColor(rest.join(' '));
    if (col) {
      ref.colorAdj = col.hex;
      const used = new Set(col.text.split(' '));
      for (let i = rest.length - 1; i >= 0; i--) if (used.has(rest[i] as string)) rest.splice(i, 1);
    }
  }

  // Wall side / part words as qualifiers on the head noun.
  const sideIdx = rest.findIndex((w, i) => SIDE_WORDS.has(w) && i < rest.length - 1);
  if (sideIdx >= 0) {
    ref.side = rest[sideIdx] as string;
    rest.splice(sideIdx, 1);
  }
  const head = rest[rest.length - 1];
  if (head === undefined) {
    if (ref.all && !ref.noun) ref.noun = '';
    return ref;
  }
  // Part: "sofa legs", "table top".
  if (rest.length >= 2 && PART_WORDS.has(singular(head)) && !ROOM_WORDS.has(singular(head))) {
    const owner = rest[rest.length - 2] as string;
    if (!['wall', 'floor', 'ceiling', 'room'].includes(owner)) {
      ref.part = singular(head);
      ref.noun = singular(owner);
      ref.adjectives = rest.slice(0, -2);
      return finish(ref, original);
    }
  }
  ref.noun = singular(head);
  ref.adjectives = rest.slice(0, -1).map((w) => (w.length > 3 ? singular(w) : w));
  // Side words only qualify walls; for anything else ("the front door") they are plain adjectives.
  if (ref.side && !['wall', 'floor', 'ceiling'].includes(ref.noun)) {
    ref.adjectives.unshift(ref.side);
    delete ref.side;
  }
  // "the bedroom walls": a room word leading the head noun is the room qualifier.
  if (rest.length >= 2 && ['wall', 'floor', 'ceiling', 'door', 'window', 'light', 'lamp', 'tile'].includes(ref.noun)) {
    const lead = rest.slice(0, -1);
    const roomLead = lead.filter((w) => ROOM_WORDS.has(singular(w)));
    if (roomLead.length > 0 && !ref.room) {
      const roomNoun = singular(lead[lead.length - 1] as string);
      ref.room = { text: lead.join(' '), noun: ROOM_WORDS.has(roomNoun) ? roomNoun : singular(roomLead[roomLead.length - 1] as string), adjectives: ROOM_WORDS.has(roomNoun) ? lead.slice(0, -1) : lead.filter((w) => !ROOM_WORDS.has(singular(w))) };
      ref.adjectives = [];
    }
  }
  if (!ref.all && singular(head) !== head.toLowerCase() && !/ss$/.test(head) && head !== 'glass') ref.all = true;
  return finish(ref, original);
}

function finish(ref: Ref, _original: string): Ref {
  return ref;
}

/** "log" + part "seat" read as the compound noun "log seat" (for edits where parts make no sense). */
export function flattenPart(ref: Ref): Ref {
  if (!ref.part) return ref;
  const { part, ...rest } = ref;
  return { ...rest, noun: part, adjectives: [...(ref.noun ? [ref.noun] : []), ...ref.adjectives] };
}

/** True when `ref` carries no noun and no pronoun (nothing to resolve). */
export function isEmptyRef(ref: Ref): boolean {
  return !ref.noun && !ref.pronoun && !ref.all && !ref.relation && !ref.room && !ref.part;
}
