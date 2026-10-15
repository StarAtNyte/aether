/**
 * Character archetypes of the offline planner: what a "guard", "shopkeeper"
 * or "wolf pack" is as an NPC spec, how it looks (primitives, or a library
 * model when one is available), what it says, and how to build one into a
 * world. Pure construction; request parsing lives in `npc.ts`.
 */
import type { EntityInput, Json, NpcSpecInput } from '@aether/core';
import { r2, type Builder, type V3 } from './builder';
import { libraryEntry } from './library-assets';

/** Body shapes the planner can draw from primitives. */
export type NpcLook = 'human' | 'wolf' | 'deer' | 'sentry';

/** A kind of character the user can ask for. */
export interface NpcKind {
  id: string;
  /** Singular noun used as role and entity name ("guard"). */
  label: string;
  /** Matcher on the lowercased request. */
  re: RegExp;
  archetype: NonNullable<NpcSpecInput['archetype']>;
  faction: string;
  look: NpcLook;
  /** Body colour. */
  coat: string;
  /** Library search words tried in order for a model (animated characters / animals). */
  models: readonly string[];
  /** Group nouns default to several. */
  packSize: number;
  names: readonly string[];
}

const HUMAN_NAMES = ['Ada', 'Bram', 'Cleo', 'Dorian', 'Esme', 'Finn', 'Gwen', 'Hugo', 'Ines', 'Jory', 'Kira', 'Lars'];

/** Every kind, most specific first (the first matching noun of a phrase wins). */
export const NPC_KINDS: readonly NpcKind[] = [
  { id: 'bandit', label: 'bandit', re: /\b(?:bandits?|thieves?|thief|raiders?|outlaws?|brigands?|robbers?)\b/, archetype: 'guard', faction: 'bandits', look: 'human', coat: '#6b2d2d', models: ['bandit', 'thief', 'man'], packSize: 3, names: ['Rook', 'Vex', 'Snare', 'Grim'] },
  { id: 'guard', label: 'guard', re: /\b(?:guards?|sentr(?:y|ies)|watch ?(?:man|men)|soldiers?|knights?|gate ?keepers?|wardens?|patrol ?(?:man|men)|police ?(?:man|men|officers?|women|woman))\b/, archetype: 'guard', faction: 'watch', look: 'human', coat: '#3d5a80', models: ['guard', 'soldier', 'knight', 'police', 'man'], packSize: 2, names: ['Bram', 'Hugo', 'Marek', 'Tess', 'Orla', 'Dain'] },
  { id: 'merchant', label: 'shopkeeper', re: /\b(?:shop ?keepers?|merchants?|vendors?|traders?|sellers?|store ?keepers?|shop owners?|salesm[ae]n|innkeepers?|bar ?keeps?|blacksmiths?|bakers?|stall ?holders?|pedlars?|peddlers?)\b/, archetype: 'merchant', faction: 'village', look: 'human', coat: '#8c5a3c', models: ['shopkeeper', 'merchant', 'woman'], packSize: 1, names: ['Mira', 'Osric', 'Pell', 'Tamsin', 'Wick'] },
  { id: 'wolf', label: 'wolf', re: /\b(?:wolf ?packs?|wolf|wolves|hyenas?|jackals?|coyotes?|predators?|lions?|bears?|tigers?|panthers?|foxes|fox|beasts?)\b/, archetype: 'predator', faction: 'wolves', look: 'wolf', coat: '#6b6f78', models: ['wolf', 'dog', 'fox'], packSize: 4, names: [] },
  { id: 'deer', label: 'deer', re: /\b(?:deer|rabbits?|hares?|gazelles?|prey|stags?)\b/, archetype: 'prey', faction: 'deer', look: 'deer', coat: '#a8754a', models: ['deer', 'rabbit'], packSize: 3, names: [] },
  { id: 'monster', label: 'monster', re: /\b(?:monsters?|zombies?|ghouls?|skeletons?|goblins?|orcs?|undead|ogres?|trolls?|demons?)\b/, archetype: 'predator', faction: 'monsters', look: 'human', coat: '#4f7a45', models: ['zombie', 'monster', 'goblin'], packSize: 3, names: [] },
  { id: 'dog', label: 'dog', re: /\b(?:dogs?|puppy|puppies|hounds?|pups?)\b/, archetype: 'follower', faction: 'friends', look: 'wolf', coat: '#a67c52', models: ['dog'], packSize: 1, names: ['Pip', 'Rex', 'Biscuit', 'Scout', 'Moss'] },
  { id: 'companion', label: 'companion', re: /\b(?:companions?|sidekicks?|followers?|pets?|escorts?|allies)\b/, archetype: 'follower', faction: 'friends', look: 'human', coat: '#d1a054', models: ['dog', 'companion', 'woman'], packSize: 1, names: ['Pip', 'Rue', 'Moss', 'Juno'] },
  { id: 'sentinel', label: 'sentinel', re: /\b(?:sentinels?|turrets?|gargoyles?|watchers?)\b/, archetype: 'sentinel', faction: 'ruins', look: 'sentry', coat: '#7d8590', models: ['statue'], packSize: 1, names: [] },
  { id: 'villager', label: 'villager', re: /\b(?:villagers?|townsp(?:eople|erson)|citizens?|farmers?|peasants?|npcs?|characters?|persons?|people|residents?|inhabitants?|strangers?|travell?ers?|wanderers?|pedestrians?|passers-?by|shoppers?|tourists?|townsfolk|men|women|man|woman)\b/, archetype: 'villager', faction: 'village', look: 'human', coat: '#5d8c3f', models: ['villager', 'man', 'woman', 'person'], packSize: 3, names: HUMAN_NAMES },
];

/** The kind whose noun appears in `text`, with the matched word. */
export function kindOf(text: string): { kind: NpcKind; word: string } | null {
  let best: { kind: NpcKind; word: string; at: number } | null = null;
  for (const kind of NPC_KINDS) {
    const m = kind.re.exec(text);
    if (m && (best === null || m.index < best.at)) best = { kind, word: m[0], at: m.index };
  }
  return best ? { kind: best.kind, word: best.word } : null;
}

const PLURAL = /(?:s|es|ves|people|men|women|packs?)$/;

/** True when a matched noun is plural ("wolves", "guards", "wolf pack"). */
export function isPluralNoun(word: string): boolean {
  if (/pack/.test(word)) return true;
  if (/(?:ss|us)$/.test(word)) return false;
  return PLURAL.test(word) && !/^(?:deer|sheep|prey|undead)$/.test(word);
}

// ---------------------------------------------------------------------------
// Dialogue
// ---------------------------------------------------------------------------

type Dialogue = NonNullable<NpcSpecInput['dialogue']>;

const GREETINGS = ['Well met, traveller.', 'Good day to you!', 'Hello there! You are not from around here.', 'Ah, a new face. Welcome.'];
const NEWS: readonly string[] = [
  'They say wolves have been seen near the hills after dark. Keep a fire close.',
  'The gate is locked since last week. Someone sells keys, if you have coin.',
  'Stay on the road and you will be fine.',
  'Nothing ever happens here. That is how we like it.',
];

/** A friendly small-talk dialogue. */
export function villagerDialogue(b: Builder, name: string, greeting?: string): Dialogue {
  const hello = greeting ?? b.pick(GREETINGS);
  return {
    start: 'start',
    nodes: {
      start: { text: hello, choices: [{ text: 'Any news?', next: 'news' }, { text: 'Who are you?', next: 'who', once: true }, { text: 'Goodbye.', next: null }] },
      news: { text: b.pick(NEWS), next: 'start' },
      who: { text: `I am ${name}. I live here.`, next: 'start' },
    },
  } as Dialogue;
}

/** A guard on friendly terms with the player: terse but helpful. */
export function guardDialogue(b: Builder, name: string, gate?: string): Dialogue {
  const gateLine = gate ? `The ${gate} is shut. Find whoever holds the key.` : 'Keep out of trouble and we will get along.';
  return {
    start: 'start',
    nodes: {
      start: { text: `Halt. ${name} of the watch. State your business.`, choices: [{ text: 'Just passing through.', next: 'pass' }, { text: 'Any trouble lately?', next: 'trouble' }, { text: 'Never mind.', next: null }] },
      pass: { text: gateLine, next: null },
      trouble: { text: 'Wolves after dark. Do not wander far from the fire.', next: 'start' },
    },
  } as Dialogue;
}

/** Options of a shop dialogue. */
export interface ShopOptions {
  item: string;
  price: number;
  /** World-state counter that pays for it. */
  currency: string;
  /** Door (entity id) the item opens, when any. */
  door?: string;
  greeting?: string;
}

/** A shopkeeper who greets, haggles a little and sells one thing. */
export function shopDialogue(name: string, o: ShopOptions): Dialogue {
  const label = o.item.replace(/-/g, ' ');
  const buyEffects: Array<Record<string, Json>> = [{ do: 'take', item: o.currency, count: o.price }, { do: 'give', item: o.item }];
  if (o.door) buyEffects.push({ do: 'openDoor', target: o.door });
  return {
    start: 'start',
    nodes: {
      start: {
        text: o.greeting ?? `Welcome, traveller! I am ${name}. Looking for a ${label}?`,
        variants: [{ if: [{ key: o.item, op: '>=', value: 1 }], text: `You again! Is the ${label} serving you well?` }],
        choices: [
          { text: `Buy the ${label} (${o.price} ${o.currency})`, if: [{ key: o.currency, op: '>=', value: o.price }, { key: o.item, op: '<', value: 1 }], effects: buyEffects, next: 'sold' },
          { text: `How much for the ${label}?`, next: 'price' },
          { text: 'Just looking.', next: null },
        ],
      },
      price: { text: `${o.price} ${o.currency}, and it is yours.`, next: 'start' },
      sold: { text: `A pleasure doing business. Use the ${label} well.`, mode: 'trade', next: null },
    },
  } as Dialogue;
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

/** Per-instance options of a built character. */
export interface BuildOpts {
  name?: string;
  waypoints?: V3[];
  patrol?: 'loop' | 'pingpong' | 'random';
  wander?: number;
  dialogue?: Dialogue;
  /** Hours the character is active in, e.g. [19, 6] for night hunters. */
  hours?: [number, number];
  fears?: string[];
  carries?: string[];
  enemies?: string[];
  allies?: string[];
  follow?: boolean;
  /** Greeting override (first dialogue line). */
  greeting?: string;
  /** Free conversation through a connected model (the dialogue stays the offline fallback). */
  chat?: NpcSpecInput['chat'];
  /** Yaw in degrees (the character's −Z side faces this way). */
  yaw?: number;
  tags?: string[];
}

/** The NPC spec of a kind, before per-request edits. */
export function specFor(kind: NpcKind, b: Builder, o: BuildOpts, name: string): NpcSpecInput {
  const base: NpcSpecInput = { role: kind.label, archetype: kind.archetype, faction: kind.faction };
  switch (kind.id) {
    case 'guard':
      Object.assign(base, { speed: 1.6, runSpeed: 4.6, attack: { damage: 10, range: 1.8, cooldown: 1.1 }, perception: { sight: 15, fov: 110, hearing: 7, memory: 6 }, barks: { spot: ['Halt!', 'Stop right there!', 'Hey, you!'], lose: ['Where did he go?', 'Lost him...'], hurt: ['Ow!'], alert: ['Who goes there?'] } });
      break;
    case 'bandit':
      Object.assign(base, { speed: 1.7, runSpeed: 4.8, attack: { damage: 14, range: 1.7, cooldown: 1 }, perception: { sight: 14, fov: 120, hearing: 8, memory: 7 }, enemies: ['player'], barks: { spot: ['Hand it over!', 'Fresh meat!'], flee: ['Run for it!'] } });
      break;
    case 'merchant':
      Object.assign(base, { speed: 1.2, runSpeed: 3.6, health: 60, talkRange: 3.4, barks: { idle: ['Fresh wares!', 'Best prices in the hollow!'], flee: ['Help!'] } });
      break;
    case 'wolf':
      Object.assign(base, { speed: 2.2, runSpeed: 6.4, radius: 0.45, height: 0.9, health: 60, attack: { damage: 8, range: 1.4, cooldown: 0.9 }, perception: { sight: 20, fov: 200, hearing: 12, memory: 8, alert: 24 }, wander: 8, fears: ['fire'], fearRange: 8, leash: 60 });
      break;
    case 'deer':
      Object.assign(base, { speed: 1.6, runSpeed: 7, radius: 0.4, height: 1.2, health: 40, perception: { sight: 18, fov: 300, hearing: 14, memory: 4 }, wander: 8 });
      break;
    case 'monster':
      Object.assign(base, { speed: 1.1, runSpeed: 2.8, health: 120, attack: { damage: 12, range: 1.6, cooldown: 1.3 }, perception: { sight: 14, fov: 140, hearing: 10, memory: 9, alert: 12 }, wander: 6, fearRange: 6 });
      break;
    case 'companion':
      Object.assign(base, { speed: 2, runSpeed: 5.5, health: 80, talkRange: 3, enemies: [], allies: ['player'] });
      break;
    case 'dog':
      Object.assign(base, { speed: 2.2, runSpeed: 6, radius: 0.35, height: 0.6, health: 80, enemies: [], allies: ['player'], wander: 5, perception: { sight: 14, fov: 300, hearing: 10, memory: 4 }, barks: { idle: ['Woof!'], spot: ['Woof woof!'] } });
      break;
    case 'sentinel':
      Object.assign(base, { speed: 0, runSpeed: 0, health: 200, attack: { damage: 8, range: 7, cooldown: 1.4 }, perception: { sight: 16, fov: 160, hearing: 6, memory: 3 } });
      break;
    default:
      Object.assign(base, { speed: 1.3, runSpeed: 4, wander: 5, health: 60, barks: { flee: ['Help!', 'Run!'], hurt: ['Ouch!'] } });
  }
  if (o.waypoints && o.waypoints.length > 0) {
    base.waypoints = o.waypoints;
    base.patrol = { mode: o.patrol ?? 'loop', wait: kind.id === 'guard' ? 1.5 : 1 };
    base.wander = 0;
  }
  if (o.wander !== undefined) base.wander = o.wander;
  if (o.hours) base.activeHours = o.hours;
  if (o.fears && o.fears.length > 0) base.fears = [...new Set([...(base.fears ?? []), ...o.fears])];
  if (o.carries && o.carries.length > 0) base.carries = o.carries;
  if (o.enemies) base.enemies = [...new Set([...(base.enemies ?? []), ...o.enemies])];
  if (o.allies) base.allies = [...new Set([...(base.allies ?? []), ...o.allies])];
  if (o.follow) base.follow = true;
  if (o.chat) base.chat = o.chat;
  if (o.dialogue) base.dialogue = o.dialogue;
  else if (kind.archetype === 'villager') base.dialogue = villagerDialogue(b, name, o.greeting);
  else if (kind.id === 'guard') base.dialogue = guardDialogue(b, name);
  else if (kind.id === 'companion') base.dialogue = villagerDialogue(b, name, o.greeting ?? 'Lead on, I am right behind you.');
  if (kind.id === 'dog') delete base.dialogue;
  return base;
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

/** Pick a display name for the n-th character of a kind. */
export function nameFor(kind: NpcKind, b: Builder, requested?: string): string {
  if (requested) return requested;
  if (kind.names.length > 0) return b.pick(kind.names);
  return kind.label.replace(/^./, (c) => c.toUpperCase());
}

const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524'];

function human(b: Builder, id: string, kind: NpcKind, extra: { hat?: boolean; spear?: boolean; apron?: boolean; scarf?: string }): void {
  b.prim(`${id}-head`, 'sphere', [0.42, 0.42, 0.42], [0, 1.02, 0], { parent: id, material: { preset: 'plastic', color: kind.id === 'monster' ? '#7fa36b' : b.pick(SKIN), roughness: 0.7 } });
  if (extra.hat) {
    b.prim(`${id}-hat`, 'cylinder', [0.5, 0.16, 0.5], [0, 1.22, 0], { parent: id, material: { preset: 'fabric', color: '#5a3d2b' } });
    b.prim(`${id}-hat-top`, 'cylinder', [0.3, 0.2, 0.3], [0, 1.34, 0], { parent: id, material: { preset: 'fabric', color: '#5a3d2b' } });
  }
  if (kind.id === 'guard') {
    b.prim(`${id}-helmet`, 'sphere', [0.5, 0.36, 0.5], [0, 1.1, 0], { parent: id, material: { preset: 'metal', color: '#9aa4b0' } });
  }
  if (extra.spear) {
    b.prim(`${id}-spear`, 'cylinder', [0.05, 2.1, 0.05], [0.42, 0.95, -0.1], { parent: id, material: { preset: 'wood', color: '#6d4c2f' } });
    b.prim(`${id}-spear-tip`, 'cone', [0.1, 0.28, 0.1], [0.42, 2.1, -0.1], { parent: id, material: { preset: 'metal', color: '#cfd6dd' } });
  }
  if (extra.apron) b.prim(`${id}-apron`, 'box', [0.5, 0.7, 0.08], [0, 0.55, -0.26], { parent: id, material: { preset: 'fabric', color: '#e9e4d6' } });
  if (extra.scarf) b.prim(`${id}-scarf`, 'torus', [0.4, 0.1, 0.4], [0, 0.82, 0], { parent: id, rot: [90, 0, 0], material: { preset: 'fabric', color: extra.scarf } });
}

function wolfBody(b: Builder, id: string, coat: string): void {
  const dark = '#3b3e45';
  b.prim(`${id}-head`, 'sphere', [0.42, 0.4, 0.46], [0, 0.18, -0.7], { parent: id, material: { preset: 'fabric', color: coat } });
  b.prim(`${id}-snout`, 'box', [0.2, 0.18, 0.3], [0, 0.1, -0.98], { parent: id, material: { preset: 'fabric', color: dark } });
  b.prim(`${id}-ear-l`, 'cone', [0.12, 0.22, 0.12], [-0.13, 0.46, -0.66], { parent: id, material: { preset: 'fabric', color: dark } });
  b.prim(`${id}-ear-r`, 'cone', [0.12, 0.22, 0.12], [0.13, 0.46, -0.66], { parent: id, material: { preset: 'fabric', color: dark } });
  b.prim(`${id}-tail`, 'capsule', [0.14, 0.7, 0.14], [0, 0.18, 0.78], { parent: id, rot: [70, 0, 0], material: { preset: 'fabric', color: coat } });
  b.prim(`${id}-eye-l`, 'sphere', [0.06, 0.06, 0.06], [-0.1, 0.25, -0.9], { parent: id, material: { color: '#ffd23f', emissive: '#ffb300', emissiveIntensity: 1.5 } });
  b.prim(`${id}-eye-r`, 'sphere', [0.06, 0.06, 0.06], [0.1, 0.25, -0.9], { parent: id, material: { color: '#ffd23f', emissive: '#ffb300', emissiveIntensity: 1.5 } });
}

function deerBody(b: Builder, id: string, coat: string): void {
  b.prim(`${id}-neck`, 'capsule', [0.2, 0.7, 0.2], [0, 0.55, -0.55], { parent: id, rot: [-30, 0, 0], material: { preset: 'fabric', color: coat } });
  b.prim(`${id}-head`, 'sphere', [0.3, 0.3, 0.4], [0, 0.95, -0.85], { parent: id, material: { preset: 'fabric', color: coat } });
  b.prim(`${id}-antler`, 'cone', [0.06, 0.4, 0.06], [0, 1.2, -0.8], { parent: id, material: { preset: 'wood', color: '#5a4630' } });
}

/** Result of drawing a character. */
export interface Placed {
  id: string;
  name: string;
}

/**
 * Create one character of `kind` standing at (x, z), facing `yaw`, with its NPC
 * spec. A library model is used when the catalog has one; the primitive body is
 * both the collider and the fallback.
 */
export function placeNpc(b: Builder, kind: NpcKind, x: number, z: number, o: BuildOpts = {}): Placed {
  const name = nameFor(kind, b, o.name);
  const spec = specFor(kind, b, o, name);
  const yaw = o.yaw ?? 0;
  const tags = ['npc', kind.id, ...(kind.id === 'wolf' ? ['animal'] : []), ...(o.tags ?? [])];
  let id: string;
  const common = { name, yaw: r2(yaw), physics: { body: 'kinematic' as const }, npc: spec, tags, footprint: 0.9 };
  if (kind.look === 'human') {
    const color = kind.id === 'villager' ? b.pick(['#3f6e8c', '#8c3f5d', '#5d8c3f', '#8c7a3f']) : kind.coat;
    const entry = kind.models.map((m) => libraryEntry(m)).find((e) => e !== null && (e.category === 'characters' || e.category === 'animals')) ?? null;
    if (entry) {
      id = b.asset(kind.label, entry.id, [x, 0, z], {
        ...common,
        physics: { body: 'kinematic', collider: 'capsule' },
        fallback: { kind: 'primitive', primitive: 'capsule', size: [0.56, 1.7, 0.56] },
      });
      return { id, name };
    }
    id = b.prim(kind.label, 'capsule', [0.56, 1.7, 0.56], [x, 0.85, z], { ...common, material: { preset: 'fabric', color } });
    human(b, id, kind, {
      hat: kind.id === 'merchant' || (kind.id === 'villager' && b.chance(0.4)),
      spear: kind.id === 'guard',
      apron: kind.id === 'merchant',
      ...(kind.id === 'companion' ? { scarf: '#d1495b' } : {}),
    });
    return { id, name };
  }
  if (kind.look === 'wolf') {
    const entry = kind.models.map((m) => libraryEntry(m)).find((e) => e !== null && e.category === 'animals') ?? null;
    const small = kind.id === 'dog';
    if (entry) {
      id = b.asset(kind.label, entry.id, [x, 0, z], { ...common, physics: { body: 'kinematic', collider: 'box' }, fallback: { kind: 'primitive', primitive: 'box', size: [0.5, 0.7, 1.2] } });
      return { id, name };
    }
    id = b.prim(kind.label, 'box', [0.5, 0.7, 1.2], [x, small ? 0.32 : 0.45, z], { ...common, ...(small ? { scale: 0.7 } : {}), material: { preset: 'fabric', color: kind.coat } });
    wolfBody(b, id, kind.coat);
    return { id, name };
  }
  if (kind.look === 'deer') {
    id = b.prim(kind.label, 'box', [0.45, 0.7, 1.2], [x, 0.7, z], { ...common, material: { preset: 'fabric', color: kind.coat } });
    deerBody(b, id, kind.coat);
    return { id, name };
  }
  // sentry: a stone watcher
  id = b.prim(kind.label, 'cylinder', [0.8, 2.2, 0.8], [x, 1.1, z], { ...common, material: { preset: 'stone', color: kind.coat } });
  b.prim(`${id}-eye`, 'sphere', [0.24, 0.24, 0.24], [0, 0.7, -0.4], { parent: id, material: { color: '#ff5533', emissive: '#ff3311', emissiveIntensity: 2 } });
  return { id, name };
}

/** A torch child entity (handle, flame, flickering light) for a character; returns the flame id. */
export function addTorch(b: Builder, parent: string, tall = 1.7): string {
  const handle = b.prim(`${parent}-torch`, 'cylinder', [0.06, 0.55, 0.06], [-0.4, tall * 0.55, -0.15], { parent, material: { preset: 'wood', color: '#5a3d2b' }, tags: ['torch'] });
  const flame = b.prim(`${handle}-flame`, 'sphere', [0.2, 0.28, 0.2], [0, 0.34, 0], { parent: handle, material: { color: '#ffb347', emissive: '#ff8a1f', emissiveIntensity: 3 }, tags: ['fire'], castShadow: false });
  b.light(flame, [0, 0.1, 0], '#ffb066', 2.6, 11, [{ type: 'pulseLight', params: { min: 1.9, max: 3, period: 0.4 } }]);
  return flame;
}

/** A hand-held weapon prop (cosmetic). */
export function addProp(b: Builder, parent: string, item: string): void {
  const length = item === 'spear' ? 2.0 : item === 'bow' ? 1.1 : item === 'axe' ? 0.9 : 0.85;
  const metal = item !== 'spear' && item !== 'bow';
  b.prim(`${parent}-${item}`, 'box', [0.06, length, 0.06], [0.42, 0.9, -0.15], { parent, rot: [0, 0, item === 'shield' ? 0 : 8], material: metal ? { preset: 'metal', color: '#b6bec7' } : { preset: 'wood', color: '#6d4c2f' } });
}

/** Plural of a kind's noun ("wolf" → "wolves"). */
export function pluralOf(label: string): string {
  if (label === 'wolf') return 'wolves';
  if (label === 'deer') return 'deer';
  return `${label}s`;
}

const PERSONA: Readonly<Record<string, string>> = {
  guard: 'stern but fair, speaks in short clipped sentences, suspicious of strangers and proud of your post',
  bandit: 'sly and menacing, mocks people, never tells the truth about the loot',
  merchant: 'warm, shrewd and talkative, loves a bargain and flatters customers',
  villager: 'friendly and a little gossipy, knows everyone and everything about the hamlet',
  companion: 'loyal, upbeat and curious, always ready to follow the player anywhere',
  dog: 'a dog: you answer in barks and eager one-line thoughts a dog would have',
  wolf: 'a wolf: you cannot speak, you only growl; describe growls and snarls in a few words',
  deer: 'a skittish deer: you cannot speak, you only describe nervous snorts and twitching ears',
  monster: 'a slow, dim monster who speaks in grunts and broken words',
  sentinel: 'an ancient stone watcher who speaks rarely, in riddles',
};

/** A persona and the facts a character may use in free conversation. */
export function chatFor(kind: NpcKind, name: string, facts: readonly string[] = []): NonNullable<NpcSpecInput['chat']> {
  const how = PERSONA[kind.id] ?? 'friendly and curious';
  return { persona: `You are ${name}, a ${kind.label} in this world: ${how}.`.slice(0, 500), facts: facts.slice(0, 8).map((f) => f.slice(0, 160)), maxTurns: 12 };
}
