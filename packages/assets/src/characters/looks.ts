/**
 * Who a character is, from the World IR or from words.
 *
 * - {@link resolveLook} turns a `CharacterSpec` (possibly empty) plus a seed
 *   (the entity id) into one cast member with colours: deterministic, so a
 *   world looks the same on every machine and in every export, and varied, so
 *   a crowd of "villagers" is not one person repeated.
 * - {@link lookFromText} reads a phrase ("a tired old shopkeeper in a green
 *   coat") into a `CharacterSpec`; the offline planner and tests use it, and
 *   it gives a model a worked example of the vocabulary.
 * - {@link defaultWardrobe} is the archetype-to-look table.
 */
import type { CharacterHold, CharacterMood, CharacterSpec, CharacterSpecInput, CharacterWardrobe } from '@aether/core';
import { CAST, castById, type CastMember } from './library';

/** A resolved look: one body and the tints to apply. */
export interface ResolvedLook {
  body: CastMember;
  top?: string;
  bottom?: string;
  hair?: string;
  scale: number;
  mood: CharacterMood;
  hold: CharacterHold;
}

/** 32-bit FNV-1a hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Options of {@link resolveLook}. */
export interface ResolveOptions {
  /** Body ids already used nearby; the resolver prefers others (a crowd stays varied). */
  taken?: ReadonlySet<string>;
}

const OLD_WORDS = /^(old|elderly|aged|ancient|grey|gray|grandfather|grandmother|granny|senior)$/;
const YOUNG_WORDS = /^(young|youthful|teen|teenage|boy|girl|kid|student|lad|lass)$/;

/**
 * Pick the cast member for a spec. An explicit `body` wins; otherwise gender,
 * age and wardrobe narrow the cast and the seed picks among the best.
 */
export function resolveLook(spec: CharacterSpec | CharacterSpecInput | undefined, seed: string, opts: ResolveOptions = {}): ResolvedLook {
  const s = spec ?? {};
  const words = new Set((s.words ?? []).map((w) => w.toLowerCase()));
  let age = s.age;
  if (!age) {
    for (const w of words) {
      if (OLD_WORDS.test(w)) age = 'old';
      else if (YOUNG_WORDS.test(w)) age = 'young';
    }
  }
  let body = s.body ? castById(s.body) : undefined;
  if (!body) {
    const pool = CAST.filter((c) => !s.gender || c.gender === s.gender);
    const candidates = pool.length > 0 ? pool : CAST;
    const scored = candidates.map((c) => {
      let score = 0;
      if (age) score += c.traits.age === age ? 4 : age === 'adult' && c.traits.age !== 'old' ? 1 : 0;
      if (s.wardrobe) {
        const rank = c.traits.wardrobes.indexOf(s.wardrobe);
        score += rank < 0 ? 0 : 4 - Math.min(3, rank);
      }
      for (const w of words) if (c.traits.words.includes(w)) score += 2;
      if (opts.taken?.has(c.id)) score -= 3;
      return { c, score };
    });
    const best = Math.max(...scored.map((x) => x.score));
    const top = scored.filter((x) => x.score >= best - 1).map((x) => x.c);
    body = top[hashString(seed) % top.length] ?? CAST[0];
  }
  if (!body) throw new Error('the character library is empty');
  const mood: CharacterMood = s.mood ?? 'neutral';
  const out: ResolvedLook = { body, scale: s.scale ?? 1, mood, hold: s.hold ?? 'none' };
  if (s.top) out.top = s.top;
  if (s.bottom) out.bottom = s.bottom;
  if (s.hair) out.hair = s.hair;
  return out;
}

/** What each archetype wears by default (kind ids of the planner and NPC archetypes). */
export const DEFAULT_WARDROBE: Readonly<Record<string, CharacterWardrobe>> = {
  guard: 'guard',
  bandit: 'bandit',
  merchant: 'merchant',
  villager: 'villager',
  companion: 'traveller',
  follower: 'traveller',
  monster: 'bandit',
  sentinel: 'guard',
};

/** The wardrobe of an archetype or kind id (casual when unknown). */
export function defaultWardrobe(kind: string): CharacterWardrobe {
  return DEFAULT_WARDROBE[kind] ?? 'casual';
}

/** Colour words and the shade they mean on clothes (muted, so they read as cloth, not paint). */
export const COLOR_WORDS: Readonly<Record<string, string>> = {
  red: '#a8232d',
  crimson: '#8f1d2c',
  scarlet: '#c4272f',
  orange: '#c7651f',
  yellow: '#cdaa2b',
  mustard: '#b8902a',
  green: '#2f6f45',
  olive: '#58602c',
  teal: '#1f7076',
  blue: '#2c5aa0',
  navy: '#1c2d52',
  purple: '#5d3a8a',
  violet: '#6a45a0',
  pink: '#c9718a',
  brown: '#5e3d27',
  tan: '#a98f66',
  beige: '#b9a88a',
  white: '#e8e6df',
  cream: '#e3d9bd',
  grey: '#6b6e73',
  gray: '#6b6e73',
  black: '#1d1d20',
};

const BOTTOM_NOUNS = /^(trousers|pants|jeans|skirt|shorts|slacks|leggings)$/;
const TOP_NOUNS = /^(coat|jacket|shirt|top|blouse|sweater|jumper|hoodie|cloak|tunic|dress|robe|uniform|vest|cardigan|armour|armor|overalls|t-shirt|tee)$/;
const HOLD_WORDS: Readonly<Record<string, CharacterHold>> = { torch: 'torch', lantern: 'lantern', sword: 'sword', blade: 'sword', spear: 'spear', pike: 'spear', halberd: 'spear', axe: 'axe', staff: 'staff', stick: 'staff', bag: 'bag', satchel: 'bag', crate: 'crate', box: 'crate', book: 'book', cup: 'cup', mug: 'cup', paddle: 'paddle', oar: 'paddle', backpack: 'backpack', rucksack: 'backpack', knapsack: 'backpack', umbrella: 'umbrella', brolly: 'umbrella' };
const MOOD_WORDS: Readonly<Record<string, CharacterMood>> = {
  tired: 'tired', weary: 'tired', exhausted: 'tired', sleepy: 'tired',
  cheerful: 'cheerful', happy: 'cheerful', jolly: 'cheerful', friendly: 'cheerful',
  angry: 'angry', grumpy: 'angry', gruff: 'angry', furious: 'angry', stern: 'angry',
  nervous: 'nervous', anxious: 'nervous', jumpy: 'nervous', scared: 'nervous', shy: 'nervous',
  calm: 'calm', relaxed: 'calm', serene: 'calm',
  hurt: 'hurt', injured: 'hurt', wounded: 'hurt', limping: 'hurt',
  drunk: 'drunk', drunken: 'drunk', tipsy: 'drunk',
};

/** A phrase read into a spec: `null` when it says nothing about looks. */
export function lookFromText(text: string): CharacterSpecInput | null {
  const t = text.toLowerCase();
  const out: CharacterSpecInput = {};
  const words = t.match(/[a-z][a-z-]*/g) ?? [];
  if (/\b(woman|women|female|girl|lady|ladies|mother|grandmother|granny|waitress|actress|queen|witch|shopkeeper woman)\b/.test(t)) out.gender = 'female';
  else if (/\b(man|men|male|boy|guy|gentleman|father|grandfather|waiter|actor|king|lad)\b/.test(t)) out.gender = 'male';
  if (/\b(old|elderly|aged|ancient|grey-haired|gray-haired|senior|grandfather|grandmother|granny)\b/.test(t)) out.age = 'old';
  else if (/\b(young|youth|teen|teenage|student|boy|girl|lad)\b/.test(t)) out.age = 'young';
  const mood = words.map((w) => MOOD_WORDS[w]).find((m) => m !== undefined);
  if (mood) out.mood = mood;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string;
    if ((w === 'with' || w === 'holding' || w === 'carrying') && i + 1 < words.length) {
      for (let k = i + 1; k < Math.min(words.length, i + 4); k++) {
        const h = HOLD_WORDS[words[k] as string];
        if (h) {
          out.hold = h;
          break;
        }
      }
    }
  }
  // "red-haired", "blonde hair", "black hair"
  const hair = /\b([a-z]+)[- ]hair(?:ed)?\b/.exec(t);
  if (hair && COLOR_WORDS[hair[1] as string]) out.hair = COLOR_WORDS[hair[1] as string] as string;
  else if (/\bblonde?\b/.test(t)) out.hair = '#c9a45c';
  else if (/\bredhead|ginger\b/.test(t)) out.hair = '#8f3a1c';
  // clothes: "in red", "in a green coat", "red jacket", "blue trousers"
  const clothes = /(?:\bin|wearing|dressed in|with)\s+(?:an?\s+|the\s+)?(?:(?:[a-z]+)\s+)?(red|crimson|scarlet|orange|yellow|mustard|green|olive|teal|blue|navy|purple|violet|pink|brown|tan|beige|white|cream|grey|gray|black)(?:\s+(?:and\s+\w+\s+)?([a-z-]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = clothes.exec(t))) {
    const colour = COLOR_WORDS[m[1] as string];
    const noun = m[2] ?? '';
    if (!colour) continue;
    if (BOTTOM_NOUNS.test(noun)) out.bottom = colour;
    else if (!/-?hair|haired/.test(noun)) out.top = colour;
  }
  const direct = /\b(red|crimson|scarlet|orange|yellow|mustard|green|olive|teal|blue|navy|purple|violet|pink|brown|tan|beige|white|cream|grey|gray|black)\s+(coat|jacket|shirt|top|blouse|sweater|jumper|hoodie|cloak|tunic|dress|robe|uniform|vest|cardigan|armour|armor|trousers|pants|jeans|skirt|shorts)\b/g;
  while ((m = direct.exec(t))) {
    const colour = COLOR_WORDS[m[1] as string];
    const noun = m[2] as string;
    if (!colour) continue;
    if (BOTTOM_NOUNS.test(noun)) out.bottom ??= colour;
    else if (TOP_NOUNS.test(noun)) out.top ??= colour;
  }
  const keywords = words.filter((w) => OLD_WORDS.test(w) || YOUNG_WORDS.test(w) || /^(balding|bald|blonde|blond|curly|hoodie|vest|denim|blouse|skirt|dress)$/.test(w));
  if (keywords.length > 0) out.words = [...new Set(keywords)].slice(0, 6);
  return Object.keys(out).length > 0 ? out : null;
}
