/**
 * The offline planner's character brain: "add a guard who patrols the gate
 * and chases me when he sees me", "a shopkeeper who greets me and sells a
 * key", "a wolf pack that hunts at night", and the follow-ups ("make the
 * guard faster", "give him a torch", "make the wolves afraid of fire").
 *
 * Requests become ordinary patches: `add` entities carrying an `npc` spec,
 * and minimal `update` patches such as `{ "npc": { "speed": 2.6 } }`. The
 * characters are addressed by role, name, id or faction, so the same target
 * resolution serves chat edits and the LLM tool path.
 */
import { slugify, type CharacterSpecInput, type Json } from '@aether/core';
import { Builder, r2, type V3 } from './builder';
import { campfire } from './decor';
import { parseIntent, normalizeRequest, type Intent } from './intent';
import { ASSETS, parseCount, singular } from './lexicon';
import type { MockPlan } from './planner';
import { lookFromText } from '@aether/assets';
import { addProp, addTorch, chatFor, isPluralNoun, kindOf, nameFor, NPC_KINDS, placeNpc, pluralOf, shopDialogue, type BuildOpts, type NpcKind } from './npc-kinds';
import { parseWorldSummary, type EntityView, type WorldView } from './world-view';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const REMOVE_VERBS = /\b(?:remove|delete|get rid of|take away|take out|destroy|erase|eliminate|kill|despawn)\b/;
const CREATE_VERBS = /\b(?:add|place|put|spawn|create|build|give me|insert|introduce|include|bring|summon|populate|plant|set up)\b/;
const EDIT_VERBS = /\b(?:make|let|have|tell|turn|change|set|give|teach|give|increase|decrease|raise|lower|boost|buff|nerf|rename|call|name|order|ask|get|stop|keep|allow|enable|disable|should|can|could|would|now|also)\b/;
const PRONOUN = /\b(?:him|her|them|it|he|she|they|his|their)\b/;
const COUNT_WORD = /(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|a few|a couple of|a pair of|a dozen|several|some|many|more)\s+(?:\w+\s+){0,2}$/;

/** Free-text fear targets → tags the world uses. */
const FEAR_TAGS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:fire|flames?|campfires?|bonfires?|torch(?:es)?|lanterns?|light|fireplace)\b/, 'fire'],
  [/\b(?:water|rain|lakes?)\b/, 'water'],
  [/\b(?:lava)\b/, 'lava'],
  [/\b(?:cars?|vehicles?|traffic)\b/, 'car'],
  [/\b(?:ghosts?)\b/, 'ghost'],
  [/\b(?:lamps?)\b/, 'lamp'],
  [/\b(?:crates?|boxes)\b/, 'crate'],
];

/** Place nouns a patrol can circle. */
const PLACE_NOUNS = /\b(?:gate|gates|archway|arch|bridge|tower|castle|house|cottage|hut|tent|camp|campfire|fire|well|market|stall|fountain|statue|barn|windmill|dock|pier|temple|shrine|village|square|road|path|door|entrance|wall|fence|lamp ?post)\b/;

/** Footprint radius of an existing entity (rough, by generator / name). */
function extentOf(e: EntityView): number {
  const g = `${e.generator ?? ''} ${e.id} ${e.name}`.toLowerCase();
  if (/castle|temple|windmill|barn|village/.test(g)) return 7 * e.scale;
  if (/house|cottage|tower|hut|bridge|dock|pier/.test(g)) return 5 * e.scale;
  if (/gate|arch/.test(g)) return 3.5 * e.scale;
  if (/tent|well|fountain|statue|stall|fire/.test(g)) return 2 * e.scale;
  return Math.max(1.5, 1.5 * e.scale);
}

/** The door a key opens: an existing door driven by a state flag (its id), when the world has one. */
function stateDoorOf(view: WorldView): string | undefined {
  const hit = view.entities.find((e) => !e.template && e.behaviors.some((x) => x.type === 'door' && x.params['trigger'] === 'state'));
  return hit?.id;
}

/** A found (or created) place the characters relate to. */
interface Place {
  id: string;
  x: number;
  z: number;
  r: number;
  kind: string;
}

function spawnOf(view: WorldView, b: Builder): V3 {
  const s = b.playerValue('spawn');
  if (Array.isArray(s) && s.length === 3 && s.every((n) => typeof n === 'number')) return s as V3;
  return [0, 1, 8];
}

/** The existing entity best matching a place phrase ("the gate"), nearest to the origin first. */
function findPlace(view: WorldView, phrase: string): Place | null {
  const m = PLACE_NOUNS.exec(phrase);
  if (!m) return null;
  const noun = singular(m[0].replace(/\s+/g, '-'));
  const base = noun === 'archway' ? 'arch' : noun;
  const hits = view.entities.filter((e) => {
    if (e.depth > 0 || e.npc || e.template) return false;
    const hay = `${e.id} ${e.name} ${e.generator ?? ''} ${e.tags.join(' ')}`.toLowerCase();
    return hay.includes(base) || (base === 'camp' && hay.includes('fire')) || (base === 'door' && hay.includes('gate'));
  });
  if (hits.length === 0) return null;
  const e = hits.reduce((best, h) => (Math.hypot(h.pos[0], h.pos[2]) < Math.hypot(best.pos[0], best.pos[2]) ? h : best));
  return { id: e.id, x: e.pos[0], z: e.pos[2], r: extentOf(e), kind: base };
}

// ---------------------------------------------------------------------------
// Places the planner can build
// ---------------------------------------------------------------------------

/** A stone gatehouse: two pillars, a lintel and (when locked) a sliding door leaf. */
export function makeGate(b: Builder, x: number, z: number, locked: boolean): Place {
  const stone = { preset: 'stone' as const, color: '#8d8a82' };
  const root = b.empty('gate', [x, 0, z], { name: 'Gate', tags: ['gate', 'focus'] });
  b.prim(`${root}-pillar-l`, 'box', [0.9, 4.2, 0.9], [x - 2.3, 2.1, z], { material: stone, physics: 'static', tags: ['gate'] });
  b.prim(`${root}-pillar-r`, 'box', [0.9, 4.2, 0.9], [x + 2.3, 2.1, z], { material: stone, physics: 'static', tags: ['gate'] });
  b.prim(`${root}-lintel`, 'box', [5.5, 0.9, 1], [x, 4.6, z], { material: stone, physics: 'static', tags: ['gate'] });
  let leaf = root;
  if (locked) {
    // The door opens when its own "<id>-unlocked" flag is set (a dialogue's openDoor effect sets it).
    leaf = b.id(`${root}-door`);
    b.add({
      id: leaf,
      name: 'Locked gate',
      transform: { position: [r2(x), 1.85, r2(z)] },
      shape: { kind: 'primitive', primitive: 'box', size: [3.7, 3.7, 0.3] },
      material: { preset: 'wood', color: '#5a3d2b' },
      physics: { body: 'kinematic' },
      behaviors: [{ type: 'door', params: { trigger: 'state', stateKey: `${leaf}-unlocked`, slide: [0, 3.8, 0], duration: 1.4 } }],
      tags: ['gate', 'door'],
    });
  }
  b.reserve(x, z, 6);
  return { id: leaf, x, z, r: 3.5, kind: 'gate' };
}

/** A market stall: a counter with a striped awning. */
export function makeStall(b: Builder, x: number, z: number, yaw: number): void {
  const id = b.prim('counter', 'box', [2, 0.95, 0.8], [x, 0.475, z], { yaw, material: { preset: 'wood', color: '#8a5a36' }, physics: 'static', name: 'Counter', tags: ['stall'] });
  b.prim(`${id}-goods`, 'box', [0.5, 0.18, 0.4], [-0.4, 0.55, 0], { parent: id, material: { preset: 'fabric', color: '#d1495b' } });
  b.prim(`${id}-goods-2`, 'sphere', [0.3, 0.3, 0.3], [0.4, 0.58, 0], { parent: id, material: { preset: 'fabric', color: '#edae49' } });
  b.reserve(x, z, 1.8);
}

/** A few trees and rocks so a character-only request still reads as a place. */
function sceneryRing(b: Builder, around: V3, night: boolean): void {
  const tree = ASSETS['tree'];
  const pine = ASSETS['pine'];
  const rock = ASSETS['rock'];
  for (let i = 0; i < 14; i++) {
    const p = b.spot(around[0], around[2] - 6, 14, 42, 2);
    if (!p) continue;
    (i % 3 === 0 ? pine : tree)?.make(b, p[0], p[1]);
  }
  for (let i = 0; i < 5; i++) {
    const p = b.spot(around[0], around[2] - 6, 5, 30, 1.3);
    if (p) rock?.make(b, p[0], p[1]);
  }
  void night;
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

/** What one phrase says about a character. */
interface Traits {
  patrol: boolean;
  place: string | undefined;
  chase: boolean;
  hunts: boolean;
  night: boolean;
  day: boolean;
  greets: boolean;
  sells: { item: string; price: number | undefined } | undefined;
  fears: string[];
  follows: boolean;
  friendly: boolean;
  hostile: boolean;
  torch: boolean;
  props: string[];
  name: string | undefined;
  stands: boolean;
  wanders: boolean;
  says: string | undefined;
  /** Wants free conversation through a connected model. */
  chats: boolean;
  /** Wants free conversation turned off. */
  quiet: boolean;
}

function itemSlug(raw: string): string {
  const words = raw.replace(/\b(?:the|a|an|some|my|your|his|her|their)\b/g, ' ').trim().split(/\s+/).slice(0, 3);
  return slugify(words.join('-')).slice(0, 24) || 'key';
}

/** Read behaviours out of the words that follow (or describe) a character. */
export function parseTraits(seg: string): Traits {
  const t: Traits = {
    patrol: /\bpatrol(?:s|ling|led)?\b|\bwalks? (?:a )?(?:route|beat)\b|\bguard(?:s|ing)\b(?= (?:the|a) )/.test(seg),
    place: undefined,
    chase: /\b(?:chas(?:e|es|ing)|pursu(?:e|es|ing)|go(?:es)? after|runs? after|attack(?:s|ing)?|fights?|hunts?|hunting|hunted|stalks?|catch(?:es)?|tackles?|arrests?)\b/.test(seg),
    hunts: /\bhunt(?:s|ing)?\b|\bprowl(?:s|ing)?\b|\bstalk(?:s|ing)?\b/.test(seg),
    night: /\b(?:at night|by night|nocturnal|after dark|after sunset|in the dark|come out at night|only at night|nighttime)\b/.test(seg),
    day: /\b(?:during the day|by day|in daytime|at daytime|daylight only|only in the day)\b/.test(seg),
    greets: /\b(?:greets?|greeting|says? (?:hello|hi)|welcomes?|talks? (?:to|with) (?:me|you|us)|chats?|speaks?|says|gossips?|converses?|conversation)\b/.test(seg),
    sells: undefined,
    fears: [],
    follows: /\bfollow(?:s|ing)? (?:me|you|us|the player)\b|\b(?:companion|accompan\w+|sidekick|come with me|be my)\b/.test(seg),
    friendly: /\b(?:friendly|peaceful|harmless|gentle|kind|helpful|ally|allies|friend|calm|tame|docile)\b/.test(seg) && !/\bunfriendly\b/.test(seg),
    hostile: /\b(?:hostile|aggressive|angry|enemy|enemies|hates?|evil|dangerous|deadly|attacks? (?:me|you|on sight)|chas(?:e|es) (?:me|you)|hunts? (?:me|you|the player))\b/.test(seg),
    torch: /\b(?:torch(?:es)?|lantern)\b/.test(seg) && !/\bafraid|scared|fear|terrified\b/.test(seg),
    props: [],
    name: undefined,
    stands: /\b(?:stand(?:s|ing)? (?:still|guard|watch)|stays? (?:put|here|there)|stop(?:s)? (?:patrolling|moving|walking)|hold(?:s)? (?:the )?(?:position|post)|doesn'?t move|never moves|immobile|stationary)\b/.test(seg),
    wanders: /\b(?:wander(?:s|ing)?|roam(?:s|ing)?|strolls?|mill(?:s|ing)? about|walks? around)\b/.test(seg),
    says: undefined,
    chats: /\b(?:chat(?:s|ty)? freely|talks? freely|free(?:ly)? (?:talk|chat|convers\w+)|free[- ]form|open[- ]ended|talks? about anything|answers? (?:any|my|all) questions|(?:ai|llm|language[- ]model)[- ](?:powered|driven|brain)|real conversations?|converses?|fully conversational|conversational)\b/.test(seg),
    quiet: /\b(?:stop|no longer|disable|turn off|without)\b.{0,24}\b(?:free (?:talk|chat|conversation)|chatting freely|talking freely|conversation)\b/.test(seg),
  };
  const patrol = /\bpatrol(?:s|ling|led)?\s+(?:around |along |near |by |between |across |in |outside |inside |at |on )?((?:the |a |an )?[a-z -]{2,40}?)(?=\s+(?:and|but|who|that|when|while|so|then|if|with|at night|during|every)\b|[.,;!?]|$)/.exec(seg);
  if (patrol && patrol[1]) t.place = patrol[1].trim();
  const guarding = /\bguard(?:s|ing)\s+((?:the |a |an )?[a-z -]{2,30}?)(?=\s+(?:and|but|who|that|when|while|so|then|if|with)\b|[.,;!?]|$)/.exec(seg);
  if (!t.place && guarding && guarding[1] && PLACE_NOUNS.test(guarding[1])) {
    t.place = guarding[1].trim();
    t.patrol = true;
  }
  if (!t.place && t.patrol) {
    const near = PLACE_NOUNS.exec(seg);
    if (near) t.place = near[0];
  }
  const sells = /\bsell(?:s|ing)?\s+(?:me\s+|you\s+|us\s+)?((?:an?\s+|the\s+|some\s+|his\s+|her\s+)?[a-z][a-z -]{0,30}?)(?=\s+(?:for|at|and|but|who|that|to|when|if)\b|[.,;!?]|$)/.exec(seg);
  if (sells && sells[1]) {
    const price = /\bfor\s+(\d+)(?:\s+(?:gold|coins?|gp))?\b/.exec(seg);
    t.sells = { item: itemSlug(sells[1]), price: price ? Number(price[1]) : undefined };
  }
  for (const m of seg.matchAll(/\b(?:afraid|scared|frightened|terrified|fear(?:s|ful)?|fears)\s+(?:of|by)\s+((?:the\s+)?[a-z]+(?:\s*(?:,|and|or)\s+(?:the\s+)?[a-z]+)*)/g)) {
    for (const word of (m[1] ?? '').split(/\s*(?:,|\band\b|\bor\b)\s*/)) {
      const hit = FEAR_TAGS.find(([re]) => re.test(word.replace(/^the\s+/, '')));
      if (hit && !t.fears.includes(hit[1])) t.fears.push(hit[1]);
    }
  }
  for (const m of seg.matchAll(/\b(?:avoids?|flees? from|runs? (?:away )?from|keeps? away from)\s+((?:the\s+)?[a-z]+)/g)) {
    const hit = FEAR_TAGS.find(([re]) => re.test(m[1] ?? ''));
    if (hit && !t.fears.includes(hit[1])) t.fears.push(hit[1]);
  }
  for (const m of seg.matchAll(/\b(sword|spear|axe|shield|bow)\b/g)) if (!t.props.includes(m[1] as string)) t.props.push(m[1] as string);
  const named = /\b(?:named|called)\s+([a-z][a-z'-]{1,20})/i.exec(seg) ?? /\b(?:call|name|rename)\s+(?:the\s+[a-z]+|him|her|it|them)\s+(?:to\s+)?([a-z][a-z'-]{1,20})\b/i.exec(seg);
  if (named) t.name = (named[1] as string).replace(/^./, (c) => c.toUpperCase());
  const quote = /["“]([^"”]{2,100})["”]/.exec(seg);
  if (quote) t.says = quote[1];
  return t;
}

/** Night hours (19:00–06:00) for creatures that hunt in the dark. */
const NIGHT_HOURS: [number, number] = [19, 6];
const DAY_HOURS: [number, number] = [6, 19];

// ---------------------------------------------------------------------------
// Creating characters
// ---------------------------------------------------------------------------

/** One requested group of characters. */
interface Group {
  kind: NpcKind;
  count: number;
  traits: Traits;
  text: string;
  /** Look the request gave this group ("a tired old shopkeeper in a green coat"). */
  look: CharacterSpecInput | null;
}

/** Split a request into one group per character noun. */
function groupsOf(text: string): Group[] {
  const hits: Array<{ kind: NpcKind; word: string; at: number }> = [];
  for (const kind of NPC_KINDS) {
    const re = new RegExp(kind.re.source, 'g');
    for (const m of text.matchAll(re)) hits.push({ kind, word: m[0], at: m.index ?? 0 });
  }
  hits.sort((a, c) => a.at - c.at);
  // Drop hits swallowed by an earlier, longer match ("wolf" inside "wolf pack").
  const kept: typeof hits = [];
  for (const h of hits) {
    const last = kept[kept.length - 1];
    if (last && h.at < last.at + last.word.length) continue;
    // "companion dog", "friendly guard guard": the same creature named twice in a row.
    if (last && last.kind === h.kind && h.at - (last.at + last.word.length) <= 2) continue;
    if (last && h.kind.id === 'companion' && last.kind.id === 'dog' && h.at - (last.at + last.word.length) <= 2) continue;
    if (last && h.kind.id === 'dog' && last.kind.id === 'companion' && h.at - (last.at + last.word.length) <= 2) {
      kept[kept.length - 1] = h;
      continue;
    }
    kept.push(h);
  }
  // "guard" in "a guard patrols the gate" is the noun; "guard the gate" after a noun is a verb: ignore a hit that directly follows "to"/"will"/"must".
  // "a bandit camp", "a wolf den": the noun names the place, not a character.
  const named = kept.filter((h) => !/^\s+(?:camps?|gangs?|bands?|parties|party|hideouts?|dens?|lairs?|bases?|outposts?|territory|country|village|town|checkpoints?)\b/.test(text.slice(h.at + h.word.length, h.at + h.word.length + 14)));
  const real = (named.length > 0 ? named : kept).filter((h) => !/\b(?:to|will|must|should|and|who|that|which|then)\s+$/.test(text.slice(Math.max(0, h.at - 8), h.at)) || h.kind.id !== 'guard');
  const groups: Group[] = [];
  real.forEach((h, i) => {
    const end = real[i + 1]?.at ?? text.length;
    const seg = text.slice(h.at, end);
    const before = text.slice(Math.max(0, h.at - 28), h.at);
    const cm = COUNT_WORD.exec(before);
    let count = cm ? (parseCount(cm[1]) ?? 1) : 1;
    const plural = isPluralNoun(h.word);
    if (plural && !(cm && /\d|two|three|four|five|six|seven|eight|nine|ten|dozen|couple|pair|few/.test(cm[1] ?? ''))) count = Math.max(count, h.kind.packSize);
    if (/pack/.test(h.word) && count < 3) count = h.kind.packSize;
    count = Math.max(1, Math.min(12, count));
    // Behaviours may be phrased before the noun ("a patrolling guard") as well as after it.
    const lead = text.slice(Math.max(0, h.at - 40), h.at);
    groups.push({ kind: h.kind, count, look: lookOf(text, h.at, h.word.length, seg), traits: parseTraits(`${seg} ${/\b(?:patrolling|hunting|friendly|hostile|peaceful|angry|armed)\s*$/.test(lead) ? lead : ''}`), text: seg });
  });
  return groups;
}

/**
 * The look a phrase gives a character: the words just before the noun
 * ("a tired old shopkeeper") and the clothes after it ("in a green coat"),
 * bounded by the clause so a neighbour's description does not leak over.
 */
function lookOf(text: string, at: number, wordLen: number, seg: string): CharacterSpecInput | null {
  const lead = (text.slice(Math.max(0, at - 44), at).split(/[.,;!?]|\band\b|\bthen\b/).pop() ?? '').trim();
  const tail = (seg.slice(wordLen).split(/[.,;!?]|\band\b|\bthen\b|\bwho\b|\bthat\b|\bwhen\b/)[0] ?? '').slice(0, 48);
  const noun = seg.slice(0, wordLen);
  return lookFromText(`${lead} ${noun} ${tail}`);
}

/** Waypoints around a place: a front arc for gates, a ring for everything else. */
function routeAround(place: Place, spawn: V3, count: number): { points: V3[]; mode: 'loop' | 'pingpong' } {
  if (place.kind === 'gate' || place.kind === 'door' || place.kind === 'entrance') {
    const front = place.z + (spawn[2] >= place.z ? 1 : -1) * (place.r + 1.2);
    const half = place.r + 1.3;
    return { points: [[r2(place.x - half), 0, r2(front)], [r2(place.x + half), 0, r2(front)]], mode: 'pingpong' };
  }
  const r = place.r + 2.5;
  const n = Math.max(4, Math.min(8, count));
  const start = Math.atan2(spawn[2] - place.z, spawn[0] - place.x);
  const points: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = start + (i / n) * Math.PI * 2;
    points.push([r2(place.x + Math.cos(a) * r), 0, r2(place.z + Math.sin(a) * r)]);
  }
  return { points, mode: 'loop' };
}

/**
 * Waypoints that do not stand in something already placed (a house, a stall): each point that falls in a reserved
 * footprint slides along its circle round the place, a few degrees at a time, to the nearest free spot; a point with no
 * free spot near it is dropped (at least two are kept).
 */
function clearRoute(b: Builder, points: V3[], place: Place): V3[] {
  const out: V3[] = [];
  for (const p of points) {
    if (b.isFree(p[0], p[2], 0.45)) {
      out.push(p);
      continue;
    }
    const r = Math.hypot(p[0] - place.x, p[2] - place.z);
    const a0 = Math.atan2(p[2] - place.z, p[0] - place.x);
    let moved: V3 | null = null;
    for (let k = 1; k <= 8 && !moved; k++) {
      for (const sgn of [1, -1]) {
        const a = a0 + sgn * k * 0.14;
        const q: V3 = [r2(place.x + Math.cos(a) * r), 0, r2(place.z + Math.sin(a) * r)];
        if (b.isFree(q[0], q[2], 0.45)) {
          moved = q;
          break;
        }
      }
    }
    if (moved) out.push(moved);
  }
  return out.length >= 2 ? out : points;
}

/** Yaw (degrees) that makes a −Z-facing character look from (fx, fz) toward (tx, tz). */
function yawToward(fx: number, fz: number, tx: number, tz: number): number {
  return r2((Math.atan2(-(tx - fx), -(tz - fz)) * 180) / Math.PI);
}

interface CreateCtx {
  b: Builder;
  view: WorldView;
  intent: Intent;
  spawn: V3;
  empty: boolean;
  notes: string[];
  made: Array<{ id: string; name: string; kind: NpcKind }>;
  gate: Place | null;
  stateAdded: Set<string>;
  /** Someone sells a key: a gate built for the scene starts locked. */
  lockGate: boolean;
}

function ensureCounter(c: CreateCtx, key: string, label: string, initial: number): void {
  if (c.view.stateKeys.includes(key) || c.stateAdded.has(key)) return;
  c.stateAdded.add(key);
  c.b.state(key, initial);
  c.b.hud(key, label);
}

function buildGroup(c: CreateCtx, g: Group, index: number): void {
  const { b, spawn } = c;
  const { kind, traits: t } = g;
  let place: Place | null = null;
  if (t.place) {
    place = findPlace(c.view, t.place);
    if (!place && /\bgates?\b|archway|entrance|door/.test(t.place)) {
      const gx = c.empty ? 0 : r2(spawn[0] + b.rand(-3, 3));
      const gz = c.empty ? -4 : r2(spawn[2] - 16);
      place = makeGate(b, gx, gz, c.lockGate);
      c.gate = place;
      c.notes.push('built a gate');
    } else if (!place) {
      const noun = PLACE_NOUNS.exec(t.place)?.[0];
      const asset = noun ? ASSETS[noun] : undefined;
      if (asset) {
        const p = b.spot(spawn[0], spawn[2] - 10, 8, 20, asset.radius + 2);
        if (p) {
          const id = asset.make(b, p[0], p[1]);
          place = { id, x: p[0], z: p[1], r: Math.max(2.5, asset.radius), kind: noun ?? 'place' };
          c.notes.push(`built a ${noun}`);
        }
      }
    }
  }
  if (!place && c.gate && (t.patrol || kind.id === 'guard')) place = c.gate;
  const opts: BuildOpts = {};
  const hunter = kind.archetype === 'predator';
  // Anchor the group.
  let ax: number;
  let az: number;
  if (place) {
    const route = routeAround(place, spawn, 6);
    ax = route.points[0]?.[0] ?? place.x;
    az = route.points[0]?.[2] ?? place.z;
    if (t.patrol || kind.id === 'guard' || kind.id === 'bandit') {
      opts.waypoints = clearRoute(b, route.points, place);
      opts.patrol = route.mode;
    }
  } else if (hunter) {
    ax = r2(spawn[0] + (index % 2 === 0 ? -1 : 1) * b.rand(8, 14));
    az = r2(spawn[2] - b.rand(24, 32));
  } else if (kind.id === 'merchant') {
    ax = r2(spawn[0] - 6 - index * 3);
    az = r2(spawn[2] - 9);
  } else if (kind.id === 'companion') {
    ax = r2(spawn[0] + 1.6);
    az = r2(spawn[2] + 0.5);
  } else {
    const p = b.spot(spawn[0], spawn[2] - 8, 3, 11 + index * 3, 1.4);
    ax = p?.[0] ?? r2(spawn[0] + 4 + index * 2);
    az = p?.[1] ?? r2(spawn[2] - 8);
  }
  // A guard without a named place patrols a square near where it stands.
  if ((kind.id === 'guard' || kind.id === 'bandit') && !opts.waypoints && t.patrol && !t.stands) {
    const r = 4.5;
    const square: V3[] = [[r2(ax + r), 0, r2(az)], [r2(ax + r), 0, r2(az + r)], [r2(ax), 0, r2(az + r)], [r2(ax), 0, r2(az)]];
    opts.waypoints = clearRoute(b, square, { id: 'patrol', kind: 'square', x: ax + r / 2, z: az + r / 2, r: r / 2 });
    opts.patrol = 'loop';
  }
  if (t.stands) {
    delete opts.waypoints;
    opts.wander = 0;
  }
  if (t.wanders && !opts.waypoints) opts.wander = hunter ? 10 : 6;
  if (hunter && (t.night || c.intent.mood.night) && !t.day) opts.hours = NIGHT_HOURS;
  if (t.day && !t.night) opts.hours = DAY_HOURS;
  if (t.fears.length > 0) opts.fears = t.fears;
  if (t.follows) opts.follow = true;
  if (t.friendly) opts.allies = ['player'];
  if (t.hostile || (t.chase && !hunter)) opts.enemies = ['player'];
  const carries: string[] = [];
  if (t.torch) carries.push('torch');
  carries.push(...t.props);
  if (carries.length > 0) opts.carries = carries;
  if (t.says) opts.greeting = t.says;
  const facts: string[] = [];
  if (c.gate) facts.push('The gate is locked and only a key opens it.');
  if (kind.id === 'wolf' || c.intent.mood.night) facts.push('Wolves hunt at night and fear fire.');
  // Merchants: a stall, a ware, a price.
  let shop: { item: string; price: number } | undefined;
  if (kind.id === 'merchant' || t.sells) {
    const item = t.sells?.item ?? 'key';
    const price = t.sells?.price ?? 5;
    shop = { item, price };
  }
  for (let n = 0; n < g.count; n++) {
    let x = ax;
    let z = az;
    if (g.count > 1) {
      const a = (n / g.count) * Math.PI * 2 + b.rand(0, 0.5);
      const ring = hunter ? 3.2 : 2.2;
      x = r2(ax + Math.cos(a) * ring);
      z = r2(az + Math.sin(a) * ring);
    }
    const heldProp = kind.look === 'human' && !g.look?.hold ? (t.props.find((p) => p === 'sword' || p === 'spear' || p === 'axe') as 'sword' | 'spear' | 'axe' | undefined) : undefined;
    const asked: CharacterSpecInput | undefined = g.look || heldProp ? { ...(g.look ?? {}), ...(heldProp ? { hold: heldProp } : {}) } : undefined;
    const own: BuildOpts = { ...opts, ...(asked ? { character: asked } : {}), yaw: yawToward(x, z, opts.waypoints?.[1]?.[0] ?? spawn[0], opts.waypoints?.[1]?.[2] ?? spawn[2]) };
    if (t.name && g.count === 1) own.name = t.name;
    if (shop) {
      const nameForShop = own.name ?? b.pick(kind.names.length > 0 ? kind.names : ['Mira']);
      own.name = nameForShop;
      const doorId = c.gate && c.gate.id.includes('door') ? c.gate.id : stateDoorOf(c.view);
      own.dialogue = shopDialogue(nameForShop, { item: shop.item, price: shop.price, currency: 'coins', ...(doorId ? { door: doorId } : {}), ...(t.says ? { greeting: t.says } : t.greets ? { greeting: `Welcome, traveller! I am ${nameForShop}. Looking for a ${shop.item.replace(/-/g, ' ')}?` } : {}) });
      own.yaw = yawToward(x, z, spawn[0], spawn[2]);
    }
    if (t.chats) {
      const sellFacts = shop ? [`The ${shop.item.replace(/-/g, ' ')} costs ${shop.price} coins.`, ...facts] : facts;
      own.chat = chatFor(kind, own.name ?? nameFor(kind, b), sellFacts);
    }
    const placed = placeNpc(b, kind, x, z, own);
    c.made.push({ id: placed.id, name: placed.name, kind });
    if (own.carries?.includes('torch')) addTorch(b, placed.id, kind.look === 'human' ? 1.7 : 0.9, kind.look === 'human');
    // A person holds sword, spear or axe in the hand (`character.hold`); only a shield or bow is still a loose prop.
    for (const prop of t.props) if (kind.look === 'human' && (prop === 'shield' || prop === 'bow')) addProp(b, placed.id, prop);
    if (shop && n === 0) {
      makeStall(b, r2(x + Math.sin((own.yaw ?? 0) * (Math.PI / 180)) * -1.2), r2(z + Math.cos((own.yaw ?? 0) * (Math.PI / 180)) * -1.2), r2(own.yaw ?? 0));
    }
  }
  if (shop) {
    ensureCounter(c, 'coins', 'Coins', 0);
    ensureCounter(c, shop.item, shop.item.replace(/-/g, ' ').replace(/^./, (ch) => ch.toUpperCase()), 0);
    // Something to earn the price with.
    if (!c.view.entities.some((e) => e.tags.includes('coin')) && !c.stateAdded.has('coin-pickups')) {
      c.stateAdded.add('coin-pickups');
      const total = Math.ceil((shop.price + 2) / 2);
      for (let i = 0; i < total; i++) {
        const p = b.spot(spawn[0], spawn[2] - 5, 3, 14, 0.9);
        if (!p) continue;
        b.prim('coin', 'cylinder', [0.7, 0.1, 0.7], [p[0], 0.9, p[1]], {
          name: 'Gold coin',
          rot: [90, 0, 0],
          material: { preset: 'gold', emissive: '#ffb703', emissiveIntensity: 0.5 },
          behaviors: [{ type: 'spin', params: { axis: [0, 0, 1], speed: 140 } }, { type: 'bob', params: { amplitude: 0.15 } }, { type: 'collectible', params: { scoreKey: 'coins', value: 2 } }],
          tags: ['coin'],
        });
      }
      c.notes.push(`scattered ${total} coins (worth 2 each) to pay with`);
    }
  }
}

function describeMade(c: CreateCtx, groups: readonly Group[]): string {
  const parts = groups.map((g) => {
    const t = g.traits;
    const many = g.count > 1;
    const bits: string[] = [];
    const verb = (base: string, rest: string): string => `${many ? base : base.endsWith('ch') || base.endsWith('s') ? `${base}es` : `${base}s`}${rest ? ` ${rest}` : ''}`;
    if (g.kind.archetype === 'guard') bits.push(t.place ? verb('patrol', `the ${t.place.replace(/^the\s+/, '')}`) : verb('keep', 'watch'));
    if (g.kind.archetype === 'predator') bits.push(verb('hunt', t.night || c.intent.mood.night ? 'at night' : ''));
    if (g.kind.archetype === 'guard' || g.kind.archetype === 'predator' || t.chase) bits.push(verb('chase', 'you on sight'));
    if (g.kind.archetype === 'merchant') bits.push(t.sells ? verb('sell', `a ${t.sells.item.replace(/-/g, ' ')}`) : verb('trade', ''));
    if (g.kind.archetype === 'merchant' || t.greets || g.kind.archetype === 'villager') bits.push(verb('greet', 'you when you press E'));
    if (g.kind.id === 'dog' || t.follows) bits.push(verb('follow', 'you'));
    if (t.fears.length > 0) bits.push(`${many ? 'are' : 'is'} afraid of ${t.fears.join(' and ')}`);
    if (t.chats) bits.push(verb('chat', 'freely when a model is connected'));
    return `${many ? `${g.count} ${pluralOf(g.kind.label)}` : `a ${g.kind.label}`}${bits.length > 0 ? ` that ${bits.join(', ')}` : ''}`;
  });
  return parts.join('; ');
}

const sellsKey = (g: Group): boolean => g.traits.sells !== undefined || g.kind.id === 'merchant';

/** Place every group, then the shared extras (health, a fire for hunters, the verification test). */
function populate(c: CreateCtx, groups: readonly Group[]): void {
  const { b, view } = c;
  groups.forEach((g, i) => buildGroup(c, g, i));
  const armed = groups.some((g) => g.kind.archetype === 'guard' || g.kind.archetype === 'predator' || g.kind.archetype === 'sentinel' || g.traits.chase);
  if (armed && !view.stateKeys.includes('health') && !c.stateAdded.has('health')) {
    c.stateAdded.add('health');
    b.state('health', 100);
    b.hud('health', 'Health');
  }
  // Predators want a fire to run to.
  const predators = groups.some((g) => g.kind.archetype === 'predator');
  if (predators && !view.entities.some((e) => e.tags.includes('fire') || (e.generator ?? '').includes('campfire')) && !c.stateAdded.has('campfire')) {
    c.stateAdded.add('campfire');
    const p = b.spot(c.spawn[0], c.spawn[2] - 4, 2.5, 6, 2.4);
    campfire(b, p?.[0] ?? r2(c.spawn[0] + 3), p?.[1] ?? r2(c.spawn[2] - 4));
    c.notes.push('lit a campfire the animals fear');
  }
  b.test({ id: 'npcs-work', kind: 'npcs', target: '#npc', seconds: 12, stuckAfter: 5 });
}

function create(text: string, view: WorldView, intent: Intent, groups: Group[]): MockPlan {
  const empty = view.entityCount === 0;
  const b = new Builder(hash(text), view.entities.map((e) => e.id), intent.mood, view.testIds, view.ruleIds);
  b.keepHud(view.hud);
  const c: CreateCtx = { b, view, intent, spawn: [0, 1, 8], empty, notes: [], made: [], gate: null, stateAdded: new Set(), lockGate: groups.some(sellsKey) };
  if (empty) {
    b.env({ sky: 'day', timeOfDay: 15, bloom: 0.5, fog: { color: '#c9d2dc', density: 0.006 } });
    b.player({ mode: 'thirdPerson', spawn: [0, 1, 8] });
  }
  if (Object.keys(intent.env).length > 0) b.env(intent.env as Record<string, Json>);
  if (intent.mood.night && empty) b.env({ weather: 'fireflies' });
  c.spawn = spawnOf(view, b);
  b.reserve(c.spawn[0], c.spawn[2], 3);
  if (empty) sceneryRing(b, c.spawn, intent.mood.night);
  populate(c, groups);
  if (empty) {
    const first = groups[0];
    b.meta(first ? `${first.kind.label.replace(/^./, (ch) => ch.toUpperCase())}${first.count > 1 ? 's' : ''}` : 'Characters', text.slice(0, 200));
  }
  const summary = describeMade(c, groups);
  const extras = c.notes.length > 0 ? ` (${c.notes.join('; ')})` : '';
  return {
    plan: `Plan: ${groups.map((g) => `${g.count} ${g.kind.id}${g.count > 1 ? 's' : ''}`).join(' + ')}; ${b.entityCount} entities.`,
    patches: b.build(),
    message: `Added ${summary}${extras}. Walk up and press E to talk; the characters are verified not to get stuck.`,
  };
}

/**
 * Characters named inside a scene description ("a bandit camp with two
 * bandits"): placed with the scene's own builder so nothing overlaps.
 * Returns a short description for the finish message, or null when the
 * request names no character.
 */
export function addCharactersToScene(b: Builder, request: string, view: WorldView, intent: Intent): string | null {
  const text = normalizeRequest(request);
  const groups = groupsOf(text);
  if (groups.length === 0) return null;
  const c: CreateCtx = { b, view, intent, spawn: spawnOf(view, b), empty: true, notes: [], made: [], gate: null, stateAdded: new Set(), lockGate: groups.some(sellsKey) };
  populate(c, groups);
  return describeMade(c, groups);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Editing characters
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set(['the', 'a', 'an', 'my', 'your', 'to', 'be', 'make', 'give', 'let', 'have', 'tell', 'all', 'every', 'of', 'that', 'this', 'those', 'these', 'and', 'it', 'him', 'her', 'them', 'more', 'much', 'a', 'bit', 'little', 'little', 'is', 'are', 'should', 'now', 'also', 'so', 'too', 'very', 'really', 'who', 'which', 'when', 'then', 'with', 'from', 'as', 'at', 'on', 'in', 'for', 'if']);

/** NPCs a phrase refers to: by role, name, id, faction or archetype. */
export function resolveNpcTargets(view: WorldView, phrase: string, fallback: readonly EntityView[]): EntityView[] {
  const npcs = view.entities.filter((e) => e.npc && !e.locked && !e.template && e.depth === 0);
  if (npcs.length === 0) return [];
  const words = phrase
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w));
  const hits = new Map<string, number>();
  const plural = /\b(?:all|every|each)\b|\b(?:guards|wolves|villagers|bandits|monsters|shopkeepers|merchants|deer|companions|sentinels|the \w+s)\b/.test(phrase);
  for (const e of npcs) {
    const n = e.npc;
    if (!n) continue;
    const hay = new Set<string>([
      ...e.id.split('-'),
      ...e.name.toLowerCase().split(/\s+/),
      ...n.role.toLowerCase().split(/\s+/),
      n.faction,
      n.archetype,
    ]);
    // Role synonyms through the planner's own vocabulary ("merchant" finds the shopkeeper).
    for (const w of words) {
      const base = singular(w);
      if (hay.has(w) || hay.has(base)) hits.set(e.id, (hits.get(e.id) ?? 0) + 2);
      const kind = kindOf(w);
      if (kind && (kind.kind.label === n.role || kind.kind.archetype === n.archetype) && kind.kind.id !== 'villager') hits.set(e.id, (hits.get(e.id) ?? 0) + 1);
      if (w === 'wolves' && n.role === 'wolf') hits.set(e.id, (hits.get(e.id) ?? 0) + 2);
    }
  }
  let found = npcs.filter((e) => hits.has(e.id));
  if (found.length === 0) return fallback.filter((e) => e.npc);
  const top = Math.max(...found.map((e) => hits.get(e.id) ?? 0));
  found = found.filter((e) => (hits.get(e.id) ?? 0) === top);
  if (plural || found.length === 1) return found;
  // One requested, several match: the one the user touched last, else the closest to the origin.
  const edited = found.filter((e) => e.userEditedAge !== undefined);
  if (edited.length > 0) return [edited[0] as EntityView];
  return [found.reduce((best, e) => (Math.hypot(e.pos[0], e.pos[2]) < Math.hypot(best.pos[0], best.pos[2]) ? e : best))];
}

interface EditCtx {
  b: Builder;
  view: WorldView;
  intent: Intent;
  done: string[];
  /** Characters the previous clause talked about (for "him"). */
  last: EntityView[];
}

const SPEED_UP = /\b(?:fast(?:er)?|quick(?:er)?|speed(?:s|ier)? up|speedy|hurr(?:y|ies)|swift(?:er)?|run(?:s)? faster|sprint\w*)\b/;
const SPEED_DOWN = /\b(?:slow(?:er)?|sluggish|lazy|lazier|calm(?:er)? pace|walks? slower|crawl\w*)\b/;
const STRONGER = /\b(?:stronger|hit(?:s)? harder|more dangerous|deadlier|deadly|more damage|hurts? more|fiercer|meaner)\b/;
const WEAKER = /\b(?:weaker|hit(?:s)? softer|less dangerous|less damage|hurts? less|wimpy)\b/;
const TOUGHER = /\b(?:tougher|tankier|more health|healthier|more hit ?points|sturdier|harder to kill|beefier)\b/;
const SEES_MORE = /\b(?:see(?:s)? (?:farther|further|more|better)|sharper (?:eyes|sight|vision)|keener|better (?:eyes|eyesight|sight|vision)|longer sight|more (?:alert|vigilant|observant|perceptive)|wider (?:view|vision|fov)|spot(?:s)? (?:me )?(?:from )?farther)\b/;
const SEES_LESS = /\b(?:blind(?:er)?|half-blind|short-sighted|worse (?:eyes|sight|vision)|see(?:s)? (?:less|worse|nearer)|narrower (?:view|vision))\b/;
const HEARS_MORE = /\b(?:hear(?:s)? (?:better|more|farther|further)|sharper (?:ears|hearing)|better (?:ears|hearing)|keen ears)\b/;
const HEARS_LESS = /\b(?:deaf|hear(?:s)? (?:less|worse)|worse hearing)\b/;
const UNAFRAID = /\b(?:not (?:afraid|scared)|fearless|unafraid|no longer (?:afraid|scared)|isn'?t (?:afraid|scared)|brave)\b/;
const NIGHT_ONLY = /\b(?:only (?:at night|come out at night|hunt at night|hunts? at night|active at night)|(?:come|comes|hunt|hunts|prowl|prowls) (?:out )?(?:only )?at night|nocturnal)\b/;
const ALWAYS_AWAKE = /\b(?:all day|always (?:awake|active)|around the clock|day and night|no longer (?:sleep|rest)|at any time)\b/;
const DAY_ONLY = /\b(?:only (?:during the day|in the day|by day)|daytime only|diurnal)\b/;
const STOP_FOLLOW = /\b(?:stop(?:s)? following|no longer follow|don'?t follow|doesn'?t follow|stay here)\b/;

function patchNpc(c: EditCtx, e: EntityView, set: Record<string, Json>): void {
  c.b.patch({ op: 'update', id: e.id, set: { npc: set } });
}

function who(targets: readonly EntityView[], phrase: string): string {
  if (targets.length === 1) return (targets[0] as EntityView).name || (targets[0] as EntityView).id;
  return `${targets.length} × ${phrase.trim() || 'characters'}`;
}

function applyClause(c: EditCtx, clause: string, targets: readonly EntityView[], subjectPhrase: string): void {
  const { b } = c;
  const label = who(targets, subjectPhrase);
  const t = parseTraits(clause);
  let any = false;
  const note = (msg: string): void => {
    c.done.push(`${label} ${msg}`);
    any = true;
  };
  if (SPEED_UP.test(clause)) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { speed: r2(Math.max(0.2, e.npc.speed) * 1.6), runSpeed: r2(Math.max(1, e.npc.runSpeed) * 1.4) });
    note('moves faster');
  } else if (SPEED_DOWN.test(clause)) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { speed: r2(e.npc.speed * 0.6), runSpeed: r2(e.npc.runSpeed * 0.7) });
    note('moves slower');
  }
  if (STRONGER.test(clause)) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { attack: { damage: r2((e.npc.damage ?? 8) * 1.7) } });
    note('hits harder');
  } else if (WEAKER.test(clause)) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { attack: { damage: r2(Math.max(1, (e.npc.damage ?? 8) * 0.5)) } });
    note('hits softer');
  }
  if (TOUGHER.test(clause)) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { health: r2(e.npc.health * 2) });
    note('is tougher (double health)');
  }
  if (SEES_MORE.test(clause)) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { perception: { sight: r2(Math.min(200, e.npc.sight * 1.6)), fov: Math.min(360, e.npc.fov + 40) } });
    note('sees farther and wider');
  } else if (SEES_LESS.test(clause)) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { perception: { sight: r2(Math.max(2, e.npc.sight * 0.5)), fov: Math.max(40, e.npc.fov - 40) } });
    note('sees less far');
  }
  if (HEARS_MORE.test(clause)) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { perception: { hearing: r2(Math.min(100, e.npc.hearing * 2)) } });
    note('hears better');
  } else if (HEARS_LESS.test(clause)) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { perception: { hearing: 0 } });
    note('is deaf');
  }
  if (UNAFRAID.test(clause)) {
    const tags = t.fears.length > 0 ? t.fears : [];
    for (const e of targets) if (e.npc) patchNpc(c, e, { fears: tags.length > 0 ? e.npc.fears.filter((f) => !tags.includes(f)) : [] });
    note(`is no longer afraid${tags.length > 0 ? ` of ${tags.join(', ')}` : ''}`);
  } else if (t.fears.length > 0) {
    let added = false;
    for (const e of targets) {
      if (!e.npc) continue;
      const fears = [...new Set([...e.npc.fears, ...t.fears])];
      if (fears.length !== e.npc.fears.length) {
        patchNpc(c, e, { fears });
        added = true;
      }
    }
    if (added) {
      note(`is now afraid of ${t.fears.join(' and ')}`);
      if (t.fears.includes('fire') && !c.view.entities.some((x) => x.tags.includes('fire') || (x.generator ?? '').includes('campfire'))) {
        const spawn = spawnOf(c.view, b);
        const p = b.spot(spawn[0], spawn[2] - 5, 2.5, 7, 2.4);
        campfire(b, p?.[0] ?? r2(spawn[0] + 3), p?.[1] ?? r2(spawn[2] - 5));
        c.done.push('lit a campfire for it to fear');
      }
    } else {
      c.done.push(`${label} already fears ${t.fears.join(' and ')}`);
      any = true;
    }
  }
  if (t.friendly && !t.hostile) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { allies: [...new Set([...e.npc.allies, 'player'])], enemies: e.npc.foes.filter((f) => f !== 'player') });
    note('is friendly to you now');
  } else if (t.hostile || (t.chase && /\b(?:me|you|player)\b/.test(clause))) {
    for (const e of targets) {
      if (!e.npc) continue;
      patchNpc(c, e, { enemies: [...new Set([...e.npc.foes, 'player'])], allies: e.npc.allies.filter((f) => f !== 'player'), ...(e.npc.damage === undefined ? { attack: { damage: 8 } } : {}) });
    }
    note('is hostile and chases you on sight');
  }
  if (t.stands) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { waypoints: [], wander: 0 });
    note('stands its ground');
  } else if (t.patrol || (t.place && /\bpatrol/.test(clause))) {
    const spawn = spawnOf(c.view, b);
    for (const e of targets) {
      if (!e.npc) continue;
      const place = (t.place ? findPlace(c.view, t.place) : null) ?? { id: e.id, x: e.pos[0], z: e.pos[2], r: 3, kind: 'spot' };
      const route = routeAround(place, spawn, 6);
      patchNpc(c, e, { waypoints: route.points, patrol: { mode: route.mode }, wander: 0 });
    }
    note(t.place ? `patrols the ${t.place.replace(/^the\s+/, '')}` : 'patrols around where it stands');
  } else if (t.wanders) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { waypoints: [], wander: 8 });
    note('wanders around');
  }
  if (STOP_FOLLOW.test(clause)) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { follow: false });
    note('stops following you');
  } else if (t.follows) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { follow: true });
    note('follows you');
  }
  if (NIGHT_ONLY.test(clause) || t.night) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { activeHours: NIGHT_HOURS });
    note('is only active at night');
  } else if (DAY_ONLY.test(clause) || t.day) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { activeHours: DAY_HOURS });
    note('is only active by day');
  } else if (ALWAYS_AWAKE.test(clause)) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { activeHours: null });
    note('is active around the clock');
  }
  if (t.torch && /\b(?:give|hold|carry|carries|holding|with|equip)\b/.test(clause)) {
    for (const e of targets) {
      if (!e.npc || e.npc.carries.includes('torch')) continue;
      addTorch(b, e.id, e.npc.fears.length > 0 || /wolf|deer/.test(e.npc.role) ? 0.9 : 1.7);
      patchNpc(c, e, { carries: [...e.npc.carries, 'torch'] });
    }
    note('carries a torch');
  }
  for (const prop of t.props) {
    for (const e of targets) {
      if (!e.npc || e.npc.carries.includes(prop)) continue;
      addProp(b, e.id, prop);
      patchNpc(c, e, { carries: [...e.npc.carries, prop] });
    }
    if (/\b(?:give|hold|carry|carries|holding|with|equip)\b/.test(clause)) note(`carries a ${prop}`);
  }
  if (t.sells) {
    for (const e of targets) {
      if (!e.npc) continue;
      const door = stateDoorOf(c.view);
      const price = t.sells.price ?? 5;
      patchNpc(c, e, { dialogue: shopDialogue(e.name || e.id, { item: t.sells.item, price, currency: 'coins', ...(door ? { door } : {}) }) as unknown as Json });
      if (!c.view.stateKeys.includes('coins')) {
        b.state('coins', 0);
        b.hud('coins', 'Coins');
      }
      if (!c.view.stateKeys.includes(t.sells.item)) {
        b.state(t.sells.item, 0);
        b.hud(t.sells.item, t.sells.item.replace(/-/g, ' ').replace(/^./, (ch) => ch.toUpperCase()));
      }
    }
    note(`sells a ${t.sells.item.replace(/-/g, ' ')} for ${t.sells.price ?? 5} coins`);
  }
  if (t.quiet) {
    for (const e of targets) if (e.npc) patchNpc(c, e, { chat: null });
    note('no longer chats freely (the authored dialogue stays)');
  } else if (t.chats) {
    for (const e of targets) {
      if (!e.npc) continue;
      const kind = kindOf(e.npc.role)?.kind ?? kindOf(e.npc.archetype)?.kind ?? NPC_KINDS[NPC_KINDS.length - 1];
      if (kind) patchNpc(c, e, { chat: chatFor(kind, e.name || e.id) as unknown as Json });
    }
    note('can chat freely when a model is connected (the authored dialogue is the offline fallback)');
  }
  if (t.name && targets.length === 1) {
    const e = targets[0] as EntityView;
    b.patch({ op: 'update', id: e.id, set: { name: t.name } });
    c.done.push(`${label} is now called ${t.name}`);
    any = true;
  }
  const quote = clause.match(/\b(?:say(?:s)?|greet(?:s)?(?: me)? with|shout(?:s)?|yell(?:s)?|call(?:s)? out)\s+["“']?([^"”'.]{2,90})["”']?/);
  if (quote && !t.sells) {
    const line = (quote[1] ?? '').trim().replace(/^./, (ch) => ch.toUpperCase());
    const shout = /\b(?:shout|yell|call out)\b/.test(clause) || /\b(?:when|as) (?:he|she|it|they) (?:see|spot)/.test(clause);
    for (const e of targets) {
      if (!e.npc) continue;
      if (shout) patchNpc(c, e, { barks: { spot: [line] } });
      else patchNpc(c, e, { dialogue: { start: 'start', nodes: { start: { text: line } } } });
    }
    c.done.push(`${label} ${shout ? 'shouts' : 'says'} "${line}"`);
    any = true;
  }
  if (!any) c.done.push(`couldn't tell what to change about ${label} in "${clause.trim().slice(0, 60)}"`);
}

/** Does this clause change a character (as opposed to the world)? */
function clauseHasNpcChange(clause: string): boolean {
  const t = parseTraits(clause);
  return (
    SPEED_UP.test(clause) || SPEED_DOWN.test(clause) || STRONGER.test(clause) || WEAKER.test(clause) || TOUGHER.test(clause) || SEES_MORE.test(clause) ||
    SEES_LESS.test(clause) || HEARS_MORE.test(clause) || HEARS_LESS.test(clause) || UNAFRAID.test(clause) || t.fears.length > 0 || t.friendly || t.hostile ||
    t.stands || t.patrol || t.wanders || STOP_FOLLOW.test(clause) || t.follows || NIGHT_ONLY.test(clause) || DAY_ONLY.test(clause) || ALWAYS_AWAKE.test(clause) ||
    t.torch || t.props.length > 0 || t.sells !== undefined || t.name !== undefined || t.chats || t.quiet || /\b(?:say|says|greet|shout|yell)\b.*["“']/.test(clause)
  );
}

function edit(text: string, view: WorldView, intent: Intent): MockPlan | null {
  const b = new Builder(
    hash(`${text}|${view.entityCount}`),
    view.entities.map((e) => e.id),
    intent.mood,
    view.testIds,
    view.ruleIds,
  );
  b.keepHud(view.hud);
  b.player({});
  const c: EditCtx = { b, view, intent, done: [], last: [] };
  const npcs = view.entities.filter((e) => e.npc && !e.locked && e.depth === 0);
  const fallback: EntityView[] = npcs.length === 1 ? npcs : (() => {
    const touched = npcs.filter((e) => e.userEditedAge !== undefined);
    return touched.length > 0 ? [touched[0] as EntityView] : [];
  })();
  const clauses = text.split(/[;.!?]|,\s*(?:and\s+)?(?:then\s+)?|\band then\b|\bthen\b|\band\b(?=\s+(?:make|give|let|have|tell|set|turn|he|she|it|they|the|his|her|their)\b)/).map((s) => s.trim()).filter(Boolean);
  let subject: { phrase: string; targets: EntityView[] } | null = null;
  for (const clause of clauses) {
    if (!clauseHasNpcChange(clause)) continue;
    // The subject is the first character noun, name or role named in the clause; pronouns carry the previous one.
    const nounHit = kindOf(clause);
    let targets: EntityView[] = [];
    let phrase = '';
    if (nounHit || npcs.some((e) => clause.includes((e.name || e.id).toLowerCase()))) {
      phrase = clause;
      targets = resolveNpcTargets(view, clause, []);
    }
    if (targets.length === 0 && subject && PRONOUN.test(clause)) {
      targets = subject.targets;
      phrase = subject.phrase;
    }
    if (targets.length === 0) {
      targets = fallback;
      phrase = targets[0]?.name ?? '';
    }
    if (targets.length === 0) {
      c.done.push(`couldn't tell which character you mean by "${clause.slice(0, 50)}" (name one: ${npcs.slice(0, 4).map((e) => e.name || e.id).join(', ')})`);
      continue;
    }
    subject = { phrase: nounHit?.word ?? phrase, targets };
    applyClause(c, clause, targets, nounHit?.word ?? phrase);
  }
  if (c.done.length === 0) return null;
  const patches = b.build();
  if (patches.length === 0) return { plan: '', patches: [], message: `${c.done.join('; ')}.` };
  return { plan: `Plan: ${c.done.join('; ')}.`, patches, message: `Done — ${c.done.join('; ')}.` };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/**
 * Plan a request about characters. Returns null when the request is not about
 * NPCs (the generic planner then handles it).
 */
export function planNpc(request: string, summary: string): MockPlan | null {
  const text = normalizeRequest(request);
  if (!text || /^voxel /m.test(summary)) return null;
  if (REMOVE_VERBS.test(text) && !/\b(?:add|create|place|spawn|put)\b/.test(text)) return null;
  const view = parseWorldSummary(summary);
  const intent = parseIntent(request);
  const npcs = view.entities.filter((e) => e.npc && e.depth === 0);
  const noun = kindOf(text);
  // 1. Edits of characters that exist.
  if (npcs.length > 0 && EDIT_VERBS.test(text) && clauseHasNpcChange(text)) {
    const addNew = /\b(?:add|place|put|spawn|create|summon|bring)\s+(?:an?|\d+|two|three|four|five|some|more|another|a few)\b/.test(text);
    if (!addNew) {
      const done = edit(text, view, intent);
      if (done) return done;
    }
  }
  // 2. New characters.
  if (!noun) return null;
  const themed = intent.settings.length > 0 || intent.activities.length > 0;
  const behaviour = /\b(?:who|that|which|and|then|when|while)\b.*\b(?:patrol|chase|greet|sell|hunt|guard|follow|attack|talk|wander|stand|flee|trade|watch)/.test(text) || /\b(?:patrolling|hunting|friendly|hostile)\b/.test(text);
  // "add / spawn / create a guard" creates; "make the wolves bigger" talks about wolves that exist.
  const creates = CREATE_VERBS.test(text);
  const before = text.slice(Math.max(0, text.indexOf(noun.word) - 32), text.indexOf(noun.word));
  const definite = /\b(?:the|these|those|my|his|her|their|all|every|each|both)\s+(?:[a-z'-]+\s+){0,2}$/.test(before);
  const indefinite = /\b(?:an?|\d+|one|two|three|four|five|six|seven|eight|nine|ten|some|several|many|few|couple|dozen|pair|another|more)\s+(?:[a-z'-]+\s+){0,2}$/.test(before) || /^\s*$/.test(before);
  const adding = creates || (indefinite && !definite) || (behaviour && !definite);
  if (!adding) return null;
  // Scene prompts ("a haunted castle with guards") belong to the scene builder.
  if (themed && view.entityCount === 0) return null;
  const groups = groupsOf(text);
  if (groups.length === 0) return null;
  return create(text, view, intent, groups);
}
