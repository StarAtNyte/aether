/**
 * Vocabulary of the mock planner: color words, number words, and the nouns it
 * can place ("add 3 lamps") mapped to asset factories built on the builtin
 * generators and primitives.
 */
import type { Json } from '@aether/core';
import { r2, type Builder } from './builder';
import { campfire, lamp } from './decor';
import { preferLibrary } from './library-assets';

/** Named colors → hex. */
export const COLORS: Readonly<Record<string, string>> = {
  red: '#e63946', crimson: '#b5179e', blue: '#277da1', navy: '#1d3557', green: '#43aa8b', lime: '#90be6d', yellow: '#f9c74f',
  orange: '#f8961e', purple: '#9b5de5', violet: '#7b2cbf', pink: '#f15bb5', white: '#f8f9fa', black: '#1d1d1f', gray: '#8d99ae',
  grey: '#8d99ae', brown: '#7f5539', gold: '#ffd166', golden: '#ffd166', silver: '#c0c0c0', cyan: '#00bbf9', teal: '#2a9d8f',
  turquoise: '#40e0d0', magenta: '#ff00a0',
};

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  a: 1, an: 1, one: 1, single: 1, two: 2, couple: 2, pair: 2, three: 3, few: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, dozen: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50, hundred: 100, some: 4, several: 5,
  many: 12, lots: 15, bunch: 6, more: 3,
};

/** Parse "12", "twelve", "a few", "lots of" → number; undefined when absent. */
export function parseCount(word: string | undefined): number | undefined {
  if (!word) return undefined;
  const w = word.trim().replace(/^(a|an)\s+(?=few|couple|pair|dozen|bunch)/, '').replace(/\s+of$/, '');
  if (/^\d+$/.test(w)) return Number(w);
  return NUMBER_WORDS[w];
}

/** Naive singularization good enough for our nouns. */
export function singular(noun: string): string {
  const n = noun.trim();
  const irregular: Readonly<Record<string, string>> = { cacti: 'cactus', sheep: 'sheep', dominoes: 'domino', people: 'person', geese: 'goose', mice: 'mouse', leaves: 'leaf', boxes: 'box', benches: 'bench', bushes: 'bush', torches: 'torch', ponies: 'pony', bodies: 'body', fireflies: 'firefly', berries: 'berry' };
  if (irregular[n]) return irregular[n] as string;
  if (n.endsWith('ies') && n.length > 4) return `${n.slice(0, -3)}y`;
  if (/(ches|shes|xes|sses)$/.test(n)) return n.slice(0, -2);
  if (n.endsWith('s') && !n.endsWith('ss') && n.length > 3) return n.slice(0, -1);
  return n;
}

/** Something the user can ask to add. */
export interface Asset {
  /** Display label. */
  label: string;
  /** Footprint radius in meters. */
  radius: number;
  /** Generator to scatter when many are requested (decorative). */
  scatter?: { generator: string; params: Record<string, Json> };
  /** Create one instance standing at (x, z); returns the root id. */
  make(b: Builder, x: number, z: number, color?: string): string;
}

function genAsset(label: string, generator: string, radius: number, params: (b: Builder, color?: string) => Record<string, Json>, opts: { physics?: boolean; scatter?: boolean; tags?: string[] } = {}): Asset {
  const asset: Asset = {
    label,
    radius,
    make: (b, x, z, color) =>
      b.gen(label.replace(/\s+/g, '-'), generator, params(b, color), [x, 0, z], {
        yaw: r2(b.rand(0, 360)),
        ...(opts.physics === false ? {} : { physics: 'static' as const }),
        ...(opts.tags ? { tags: opts.tags } : {}),
      }),
  };
  if (opts.scatter) asset.scatter = { generator, params: {} };
  return asset;
}

function withColor(base: Record<string, Json>, color?: string): Record<string, Json> {
  return color ? { ...base, color } : base;
}

const tree = genAsset('tree', 'tree-oak', 1.8, (b, c) => withColor({ height: r2(b.rand(5, 7.5)) }, c), { scatter: true, tags: ['tree'] });
const pine = genAsset('pine', 'tree-pine', 1.6, (b, c) => withColor({ height: r2(b.rand(6, 9)) }, c), { scatter: true, tags: ['tree'] });
const palm = genAsset('palm', 'tree-palm', 1.8, (b, c) => withColor({ height: r2(b.rand(6, 9)) }, c), { scatter: true, tags: ['tree'] });
const rock = genAsset('rock', 'rock', 1.2, (b, c) => withColor({ size: r2(b.rand(1, 2.2)), mossy: b.chance(0.5) }, c), { scatter: true, tags: ['rock'] });
const house = genAsset('house', 'house', 4.8, (b, c) => withColor({ floors: b.int(1, 2), lights: b.mood.night, variant: b.int(0, 2) }, c), { tags: ['house'] });

const ball: Asset = {
  label: 'ball',
  radius: 0.8,
  make: (b, x, z, color) =>
    b.prim('ball', 'sphere', [0.8, 0.8, 0.8], [x, 2.4, z], { material: { preset: 'rubber', color: color ?? b.pick(['#e63946', '#277da1', '#f9c74f', '#43aa8b']) }, physics: { body: 'dynamic', mass: 1, restitution: 0.7 }, tags: ['ball'] }),
};

const coin: Asset = {
  label: 'coin',
  radius: 0.8,
  make: (b, x, z) =>
    b.prim('coin', 'cylinder', [0.8, 0.12, 0.8], [x, 1, z], {
      name: 'Coin',
      rot: [90, 0, 0],
      material: { preset: 'gold', emissive: '#ffb703', emissiveIntensity: 0.5 },
      behaviors: [{ type: 'spin', params: { axis: [0, 0, 1], speed: 150 } }, { type: 'bob', params: { amplitude: 0.2 } }, { type: 'collectible', params: { scoreKey: 'score', value: 1 } }],
      tags: ['coin'],
    }),
};

const npc: Asset = {
  label: 'villager',
  radius: 0.8,
  make: (b, x, z, color) => {
    const names = ['Ada', 'Bram', 'Cleo', 'Dorian', 'Esme', 'Finn'];
    const name = b.pick(names);
    const id = b.prim('villager', 'capsule', [0.6, 1.7, 0.6], [x, 0.85, z], {
      name,
      material: { preset: 'fabric', color: color ?? b.pick(['#3f6e8c', '#8c3f5d', '#5d8c3f']) },
      behaviors: [{ type: 'npc', params: { name, lines: ['Hello there, traveler!', 'Lovely day, isn\'t it?', 'Watch your step out there.'] } }],
      tags: ['npc'],
    });
    b.prim(`${id}-head`, 'sphere', [0.45, 0.45, 0.45], [0, 1.05, 0], { parent: id, material: { color: '#f1c27d' } });
    return id;
  },
};

const enemy: Asset = {
  label: 'enemy',
  radius: 1,
  make: (b, x, z, color) =>
    b.prim('enemy', 'capsule', [0.8, 1.6, 0.8], [x, 0.8, z], {
      name: 'Enemy',
      material: { color: color ?? '#7b1e1e', emissive: '#ff2222', emissiveIntensity: 0.4 },
      behaviors: [{ type: 'follow', params: { target: 'player', distance: 0.5, speed: 2.2, range: 14 } }, { type: 'hazard', params: { mode: 'respawn', text: 'Caught!' } }],
      tags: ['enemy', 'hazard'],
    }),
};

const ghost: Asset = {
  label: 'ghost',
  radius: 1,
  make: (b, x, z) =>
    b.prim('ghost', 'capsule', [0.9, 1.8, 0.9], [x, 1.6, z], {
      name: 'Ghost',
      material: { color: '#e8f0ff', emissive: '#b8c8ff', emissiveIntensity: 1.5, opacity: 0.5 },
      behaviors: [{ type: 'bob', params: { amplitude: 0.4, period: 3 } }, { type: 'wander', params: { radius: 6, speed: 1.2 } }],
      castShadow: false,
      tags: ['ghost'],
    }),
};

const crateAsset: Asset = {
  label: 'crate',
  radius: 0.8,
  make: (b, x, z, color) => b.gen('crate', 'crate', withColor({ size: 1 }, color), [x, 0, z], { yaw: r2(b.rand(0, 90)), physics: { body: 'dynamic', mass: 5 }, tags: ['crate'] }),
};

const lampAsset: Asset = { label: 'lamp post', radius: 0.6, make: (b, x, z, color) => lamp(b, x, z, color ?? '#ffd27a') };
const fireAsset: Asset = { label: 'campfire', radius: 2, make: (b, x, z) => campfire(b, x, z) };

const goal: Asset = {
  label: 'goal',
  radius: 2,
  make: (b, x, z) => b.gen('goal', 'portal', { size: 3, glowColor: '#ffd166' }, [x, 0, z], { physics: { body: 'static', sensor: true }, behaviors: [{ type: 'goal', params: { text: 'You made it!' } }], name: 'Goal' }),
};

const checkpoint: Asset = {
  label: 'checkpoint',
  radius: 1,
  make: (b, x, z) => b.prim('checkpoint', 'cylinder', [1.6, 0.08, 1.6], [x, 0.04, z], { material: { preset: 'neon', color: '#80ff72', emissive: '#80ff72', emissiveIntensity: 1.5 }, behaviors: [{ type: 'checkpoint', params: {} }], tags: ['checkpoint'] }),
};

const lava: Asset = {
  label: 'lava pool',
  radius: 3,
  make: (b, x, z) =>
    b.prim('lava', 'cylinder', [5, 0.1, 5], [x, 0.05, z], { material: { preset: 'lava', emissive: '#ff4d00', emissiveIntensity: 2.5 }, physics: { body: 'static', sensor: true }, behaviors: [{ type: 'hazard', params: { mode: 'respawn' } }], tags: ['hazard', 'lava'] }),
};

const jumpPad: Asset = {
  label: 'jump pad',
  radius: 1,
  make: (b, x, z) => b.prim('jump-pad', 'cylinder', [1.6, 0.15, 1.6], [x, 0.075, z], { material: { preset: 'neon', color: '#00f5d4', emissive: '#00f5d4', emissiveIntensity: 1.5 }, physics: 'static', behaviors: [{ type: 'launcher', params: { direction: [0, 1, 0], speed: 14 } }], tags: ['launcher'] }),
};

const snowman: Asset = {
  label: 'snowman',
  radius: 1,
  make: (b, x, z) => {
    const id = b.prim('snowman', 'sphere', [1.4, 1.4, 1.4], [x, 0.7, z], { material: { preset: 'snow' }, physics: 'static', name: 'Snowman' });
    b.prim(`${id}-body`, 'sphere', [1, 1, 1], [0, 1.05, 0], { parent: id, material: { preset: 'snow' } });
    b.prim(`${id}-head`, 'sphere', [0.7, 0.7, 0.7], [0, 1.8, 0], { parent: id, material: { preset: 'snow' } });
    b.prim(`${id}-nose`, 'cone', [0.12, 0.4, 0.12], [0, 1.82, 0.38], { parent: id, rot: [90, 0, 0], material: { color: '#f77f00' } });
    return id;
  },
};

const pumpkin: Asset = {
  label: 'pumpkin',
  radius: 0.6,
  make: (b, x, z) => b.prim('pumpkin', 'sphere', [0.7, 0.55, 0.7], [x, 0.28, z], { scale: [1, 0.8, 1], material: { color: '#e86a17', emissive: '#ff7b00', emissiveIntensity: 1.2 }, physics: 'static', tags: ['pumpkin'] }),
};

const sheep: Asset = {
  label: 'sheep',
  radius: 1,
  make: (b, x, z, color) => {
    const id = b.prim('sheep', 'sphere', [1.2, 1.2, 1.2], [x, 0.7, z], { scale: [1.2, 0.85, 0.85], name: 'Sheep', material: { preset: 'fabric', color: color ?? '#f5f3ee' }, behaviors: [{ type: 'wander', params: { radius: 5, speed: 0.8, pause: 2 } }], tags: ['animal'] });
    b.prim(`${id}-head`, 'sphere', [0.5, 0.5, 0.5], [0.6, 0.15, 0], { parent: id, material: { color: '#2b2b2b' } });
    return id;
  },
};

const cactus: Asset = {
  label: 'cactus',
  radius: 1,
  make: (b, x, z) => {
    const id = b.prim('cactus', 'capsule', [0.5, 3, 0.5], [x, 1.5, z], { material: { preset: 'leaf', color: '#4a7c3a' }, physics: 'static', tags: ['cactus'] });
    b.prim(`${id}-arm`, 'capsule', [0.32, 1.1, 0.32], [0.45, 0.45, 0], { parent: id, material: { preset: 'leaf', color: '#4a7c3a' } });
    return id;
  },
};

const cloudAsset: Asset = {
  label: 'cloud',
  radius: 0,
  make: (b, x, z, color) => b.gen('cloud', 'cloud', withColor({ size: r2(b.rand(4, 8)) }, color), [x, r2(b.rand(22, 32)), z], { castShadow: false, behaviors: [{ type: 'bob', params: { amplitude: 0.6, period: 8 } }] }),
};

/** Noun → asset. Keys are singular. */
export const ASSETS: Readonly<Record<string, Asset>> = {
  tree, oak: tree, pine, 'pine tree': pine, fir: pine, palm, 'palm tree': palm, rock, boulder: rock, stone: rock,
  bush: genAsset('bush', 'bush', 1, (b, c) => withColor({ size: r2(b.rand(0.9, 1.4)), berries: b.chance(0.4) }, c), { physics: false, scatter: true }),
  shrub: genAsset('bush', 'bush', 1, (_b, c) => withColor({}, c), { physics: false, scatter: true }),
  flower: genAsset('flowers', 'flowers', 0.5, (b, c) => withColor({ color: b.pick(['#e84a8a', '#ffd23f', '#9b5de5']) }, c), { physics: false, scatter: true }),
  mushroom: genAsset('mushroom', 'mushroom', 0.5, (_b, c) => withColor({}, c), { physics: false, scatter: true }),
  grass: genAsset('grass', 'grass-tuft', 0.3, (_b, c) => withColor({}, c), { physics: false, scatter: true }),
  house, home: house, cottage: house, cabin: house, building: house, hut: house,
  tower: genAsset('tower', 'tower', 3, (b, c) => withColor({ height: r2(b.rand(10, 16)) }, c)),
  wall: genAsset('wall', 'wall', 4, (_b, c) => withColor({}, c)),
  fence: genAsset('fence', 'fence', 3, (_b, c) => withColor({}, c)),
  bridge: genAsset('bridge', 'bridge', 5, (_b, c) => withColor({}, c)),
  stair: genAsset('stairs', 'stairs', 2, (_b, c) => withColor({}, c)), staircase: genAsset('stairs', 'stairs', 2, (_b, c) => withColor({}, c)),
  arch: genAsset('arch', 'arch', 2.5, (_b, c) => withColor({}, c)),
  ramp: genAsset('ramp', 'ramp', 2.5, (_b, c) => withColor({}, c)),
  lamp: lampAsset, 'lamp post': lampAsset, lamppost: lampAsset, streetlight: lampAsset, 'street light': lampAsset, light: lampAsset, lantern: lampAsset,
  bench: genAsset('bench', 'bench', 1.1, (_b, c) => withColor({}, c)),
  table: genAsset('table', 'table', 1, (_b, c) => withColor({}, c)),
  chair: genAsset('chair', 'chair', 0.6, (_b, c) => withColor({}, c)),
  crate: crateAsset, box: crateAsset, cube: crateAsset,
  barrel: genAsset('barrel', 'barrel', 0.6, (_b, c) => withColor({}, c), { tags: ['barrel'] }),
  car: genAsset('car', 'car', 2.4, (b, c) => withColor({ color: b.pick(['#d62828', '#277da1', '#f9c74f', '#2a9d8f']), variant: b.int(0, 2) }, c), { tags: ['car'] }),
  truck: genAsset('truck', 'car', 2.6, (_b, c) => withColor({ variant: 1, length: 5 }, c), { tags: ['car'] }),
  boat: genAsset('boat', 'boat', 3, (b, c) => withColor({ variant: b.int(0, 2) }, c), { physics: false }),
  windmill: genAsset('windmill', 'windmill', 3.5, (_b, c) => withColor({}, c)),
  crystal: genAsset('crystal', 'crystal', 1, (_b, c) => withColor({ glow: 2 }, c), { tags: ['crystal'] }),
  gem: genAsset('crystal', 'crystal', 1, (_b, c) => withColor({ glow: 2, size: 0.8 }, c), { tags: ['crystal'] }),
  campfire: fireAsset, fire: fireAsset, bonfire: fireAsset,
  tent: genAsset('tent', 'tent', 2, (_b, c) => withColor({}, c)),
  dock: genAsset('dock', 'dock', 4, (_b, c) => withColor({}, c)), pier: genAsset('dock', 'dock', 4, (_b, c) => withColor({}, c)),
  cloud: cloudAsset,
  statue: genAsset('statue', 'statue', 1.5, (_b, c) => withColor({}, c)),
  portal: genAsset('portal', 'portal', 2, (_b, c): Record<string, Json> => (c ? { glowColor: c } : {})),
  ball, 'beach ball': ball, coin,
  villager: npc, person: npc, npc, character: npc, guard: npc, merchant: npc, citizen: npc,
  enemy, monster: enemy, zombie: enemy, goblin: enemy, ghost,
  goal, finish: goal, 'finish line': goal, checkpoint, lava, 'lava pool': lava, 'jump pad': jumpPad, trampoline: jumpPad, launcher: jumpPad,
  snowman, pumpkin, sheep, animal: sheep, cow: sheep, cactus, mountain: genAsset('mountain', 'mountain', 20, (_b, c) => withColor({}, c), { physics: false }),
};

/** Find an asset for a free-text noun phrase ("big red cars" → car, red). */
export function lookupAsset(phrase: string): { asset: Asset; noun: string; color?: string } | null {
  const words = phrase.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(Boolean);
  let color: string | undefined;
  const rest: string[] = [];
  for (const w of words) {
    if (COLORS[w] && color === undefined) color = COLORS[w];
    else if (!['big', 'small', 'large', 'tiny', 'huge', 'giant', 'little', 'new', 'more', 'extra', 'the', 'some', 'of', 'tall', 'short', 'glowing', 'old', 'wooden', 'stone'].includes(w)) rest.push(w);
  }
  // Try two-word then one-word nouns, from the end of the phrase. Everyday objects become real
  // library models when the asset catalog is loaded; nature, terrain and game pieces stay procedural.
  const pick = (noun: string, base: Asset | null): { asset: Asset; noun: string; color?: string } | null => {
    const asset = preferLibrary(noun, base) ?? base;
    return asset ? { asset, noun, ...(color ? { color } : {}) } : null;
  };
  for (let i = rest.length - 1; i >= 0; i--) {
    const two = i > 0 ? `${rest[i - 1]} ${singular(rest[i] as string)}` : undefined;
    if (two && ASSETS[two]) return pick(two, ASSETS[two] as Asset);
    const one = singular(rest[i] as string);
    if (Object.prototype.hasOwnProperty.call(ASSETS, one)) return pick(one, ASSETS[one] as Asset);
  }
  // Not in the built-in vocabulary: any noun the library knows ("add a sofa", "two police cars").
  for (let i = rest.length - 1; i >= 0; i--) {
    const two = i > 0 ? `${rest[i - 1]} ${singular(rest[i] as string)}` : undefined;
    const hit = (two ? pick(two, null) : null) ?? pick(singular(rest[i] as string), null);
    if (hit) return hit;
  }
  return null;
}
