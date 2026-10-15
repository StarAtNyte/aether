/**
 * Vocabulary of the fine-edit parser: colours (with shade modifiers),
 * material words, nouns with synonyms, numbers, directions and amounts.
 * Pure data and small helpers, no world access.
 */
import type { MaterialFinish, MaterialPreset } from '@aether/core';

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/** Mid-tone base colours (design-friendly, not neon). */
const BASE_COLORS: Readonly<Record<string, string>> = {
  red: '#c0392b', crimson: '#a4161a', scarlet: '#d62828', burgundy: '#6d1a2b', maroon: '#6a1b2a', wine: '#722f37', rose: '#d6577a', pink: '#e87fa5',
  magenta: '#c2338f', fuchsia: '#c2338f', purple: '#7b4fa3', violet: '#6a4bb0', lavender: '#b7a4d6', lilac: '#c8a8d8', plum: '#6b3a6b',
  blue: '#2f6fb0', navy: '#1b2f55', cobalt: '#1f4eb4', azure: '#3b8fd6', sky: '#7fb8e0', cyan: '#2fb5c9', teal: '#1f7a7a', turquoise: '#2fbfb3', aqua: '#4fc8c8',
  green: '#3d8a56', emerald: '#1f8a5a', forest: '#2a5a3a', olive: '#6b7035', sage: '#9aae8a', moss: '#5a7a3a', lime: '#8cc63f', mint: '#a8dcc0', jade: '#3f9a7a',
  yellow: '#e8c547', mustard: '#c9a227', gold: '#cfa24a', golden: '#cfa24a', amber: '#e0a030', lemon: '#f0e060', cream: '#efe6cf', ivory: '#f2ecdc', beige: '#cdb99a',
  tan: '#b89a72', khaki: '#b0a272', sand: '#d2bd8c', camel: '#b88a55', orange: '#e07a2f', coral: '#e8705a', peach: '#f0b090', salmon: '#e8907a', terracotta: '#b9593b', rust: '#a8482a', copper: '#b8693a', bronze: '#8c6a3a',
  brown: '#6b4630', chocolate: '#4a2e22', espresso: '#4b362a', chestnut: '#7a4a30', walnut: '#5a3e2c', taupe: '#8a7968',
  white: '#f1efea', offwhite: '#ebe7de', snow: '#f6f8fa', black: '#1c1c1e', charcoal: '#36393d', graphite: '#44484d', gray: '#8a8d91', grey: '#8a8d91', slate: '#5a6470', silver: '#b8bbbf', stone: '#a29a8e',
};

const SHADE_MODS: Readonly<Record<string, { l?: number; s?: number; mixWhite?: number }>> = {
  dark: { l: 0.62 }, darker: { l: 0.62 }, deep: { l: 0.72, s: 1.1 }, rich: { l: 0.8, s: 1.1 }, light: { mixWhite: 0.38 }, lighter: { mixWhite: 0.38 }, pale: { mixWhite: 0.55, s: 0.8 },
  pastel: { mixWhite: 0.6 }, soft: { mixWhite: 0.3, s: 0.8 }, bright: { l: 1.12, s: 1.25 }, vivid: { s: 1.35 }, vibrant: { s: 1.35 }, neon: { l: 1.2, s: 1.6 }, muted: { s: 0.6 },
  dusty: { s: 0.55, mixWhite: 0.12 }, warm: {}, cool: {},
};

/** Words that can start a colour phrase but are not colours themselves. */
export const SHADE_WORDS: ReadonlySet<string> = new Set(Object.keys(SHADE_MODS));
/** Colour words that are also materials or common noun modifiers: never read as "the red chair"-style adjectives. */
export const NON_ADJECTIVE_COLORS: ReadonlySet<string> = new Set(['stone', 'sand', 'walnut', 'chocolate', 'gold', 'golden', 'silver', 'bronze', 'copper', 'snow', 'slate', 'rose', 'sky', 'forest', 'olive', 'moss', 'wine', 'jade', 'coral', 'mint', 'amber']);
/** Words that are a colour only as the tone of a two-word colour ("forest green", "sky blue"): alone they are nouns (a forest). */
export const TONE_ONLY_COLORS: ReadonlySet<string> = new Set(['forest', 'sky']);
/** Colour families a tone word can lead into. */
export const COLOR_FAMILIES: readonly string[] = ['green', 'blue', 'grey', 'gray', 'brown', 'red', 'pink', 'purple', 'yellow', 'orange', 'white'];
/** Colour words (single). */
export const COLOR_WORDS: ReadonlySet<string> = new Set(Object.keys(BASE_COLORS));

/** Parse "#rrggbb" to [r, g, b] (0..255). */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** [r, g, b] (0..255) to "#rrggbb". */
export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  h /= 6;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Apply shade modifiers to a base colour. */
export function shade(hex: string, mods: readonly string[]): string {
  let [h, s, l] = rgbToHsl(...hexToRgb(hex));
  for (const m of mods) {
    const d = SHADE_MODS[m];
    if (!d) continue;
    if (d.l) l = Math.min(0.95, l * d.l);
    if (d.s) s = Math.min(1, s * d.s);
    if (d.mixWhite) l = l + (1 - l) * d.mixWhite;
  }
  return rgbToHex(...hslToRgb(h, s, l));
}

/** A parsed colour phrase. */
export interface ColorMatch {
  hex: string;
  /** The words consumed ("dark green"). */
  text: string;
}

/** Extract the first colour phrase of `text` ("a deep forest green", "#ff0000", "dark blue"); null when none. */
export function findColor(text: string): ColorMatch | null {
  const hex = /#[0-9a-f]{6}\b/i.exec(text);
  if (hex) return { hex: hex[0].toLowerCase(), text: hex[0] };
  const words = text.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
  const FAMILIES = ['green', 'blue', 'grey', 'gray', 'brown', 'red', 'pink', 'purple', 'yellow', 'orange', 'white'];
  for (let i = 0; i < words.length; i++) {
    if (!COLOR_WORDS.has(words[i] as string)) continue;
    if (TONE_ONLY_COLORS.has(words[i] as string) && !COLOR_FAMILIES.includes(words[i + 1] ?? '')) continue;
    // A run of colour words: "forest green", "navy blue", "sky blue" (tone name + family).
    let j = i;
    while (j + 1 < words.length && COLOR_WORDS.has(words[j + 1] as string)) j++;
    let start = i;
    while (start > 0 && SHADE_WORDS.has(words[start - 1] as string)) start--;
    const family = words[j] as string;
    const tone = j > i ? (words[j - 1] as string) : undefined;
    const base = tone !== undefined && FAMILIES.includes(family) && tone !== family ? (BASE_COLORS[tone] as string) : (BASE_COLORS[family] as string);
    const mods = words.slice(start, i).filter((m) => SHADE_WORDS.has(m));
    return { hex: shade(base, mods), text: words.slice(start, j + 1).join(' ') };
  }
  return null;
}

/** Rough perceived brightness 0..1 of a hex colour. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Human name of a colour ("dark green", "light grey", "terracotta"), for diff lines. */
export function colorName(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  if (l < 0.1) return 'black';
  if (l > 0.93) return 'white';
  if (s < 0.1) return l < 0.3 ? 'dark grey' : l > 0.75 ? 'light grey' : 'grey';
  const deg = h * 360;
  const family = deg < 15 || deg >= 345 ? 'red' : deg < 40 ? (l < 0.4 ? 'brown' : 'orange') : deg < 65 ? (l < 0.4 ? 'olive' : 'yellow') : deg < 160 ? 'green' : deg < 200 ? 'teal' : deg < 255 ? 'blue' : deg < 290 ? 'purple' : 'pink';
  if (family === 'brown' || family === 'olive') return l < 0.2 ? `dark ${family}` : family;
  const tone = l < 0.3 ? 'dark ' : l > 0.72 ? 'light ' : s < 0.3 ? 'muted ' : '';
  return `${tone}${family}`;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/** What a material word means. */
export interface MaterialWord {
  finish?: MaterialFinish;
  preset?: MaterialPreset;
  /** A fixed colour the material implies when the user gives none. */
  color?: string;
  /** Shown name. */
  label: string;
  /** Roughly "soft/upholstery" or "hard/structural" (picks the right slot). */
  kind: 'soft' | 'wood' | 'wall' | 'metal' | 'stone' | 'glass' | 'ground' | 'other';
}

/** Material vocabulary (longest phrases first when matching). */
export const MATERIAL_WORDS: Readonly<Record<string, MaterialWord>> = {
  velvet: { finish: 'velvet', label: 'velvet', kind: 'soft' },
  suede: { finish: 'velvet', label: 'suede', kind: 'soft' },
  leather: { finish: 'leather', label: 'leather', kind: 'soft' },
  fabric: { finish: 'fabric', label: 'fabric', kind: 'soft' },
  linen: { finish: 'fabric', label: 'linen', kind: 'soft' },
  wool: { finish: 'fabric', label: 'wool', kind: 'soft' },
  cotton: { finish: 'fabric', label: 'cotton', kind: 'soft' },
  tweed: { finish: 'fabric', label: 'tweed', kind: 'soft' },
  boucle: { finish: 'fabric', label: 'bouclé', kind: 'soft' },
  carpet: { finish: 'carpet', label: 'carpet', kind: 'soft' },
  oak: { finish: 'oak', label: 'oak', kind: 'wood' },
  walnut: { finish: 'walnut', label: 'walnut', kind: 'wood' },
  ash: { finish: 'ash', label: 'ash', kind: 'wood' },
  wood: { finish: 'oak', label: 'wood', kind: 'wood' },
  wooden: { finish: 'oak', label: 'wood', kind: 'wood' },
  timber: { finish: 'oak', label: 'timber', kind: 'wood' },
  herringbone: { finish: 'herringbone', label: 'herringbone wood', kind: 'wood' },
  parquet: { finish: 'herringbone', label: 'parquet', kind: 'wood' },
  marble: { finish: 'marble', label: 'marble', kind: 'stone' },
  terrazzo: { finish: 'terrazzo', label: 'terrazzo', kind: 'stone' },
  concrete: { finish: 'concrete', label: 'concrete', kind: 'stone' },
  stone: { finish: 'stone', label: 'stone', kind: 'stone' },
  brick: { finish: 'brick', label: 'brick', kind: 'stone' },
  bricks: { finish: 'brick', label: 'brick', kind: 'stone' },
  plaster: { finish: 'plaster', label: 'plaster', kind: 'wall' },
  paint: { finish: 'paint', label: 'paint', kind: 'wall' },
  tile: { finish: 'tile', label: 'tile', kind: 'stone' },
  tiles: { finish: 'tile', label: 'tile', kind: 'stone' },
  'subway tile': { finish: 'subway-tile', label: 'subway tile', kind: 'stone' },
  'subway tiles': { finish: 'subway-tile', label: 'subway tile', kind: 'stone' },
  'metro tile': { finish: 'subway-tile', label: 'subway tile', kind: 'stone' },
  'metro tiles': { finish: 'subway-tile', label: 'subway tile', kind: 'stone' },
  ceramic: { finish: 'ceramic', label: 'ceramic', kind: 'stone' },
  metal: { finish: 'brushed-metal', label: 'brushed metal', kind: 'metal' },
  steel: { finish: 'brushed-metal', label: 'steel', kind: 'metal' },
  'brushed metal': { finish: 'brushed-metal', label: 'brushed metal', kind: 'metal' },
  chrome: { finish: 'chrome', label: 'chrome', kind: 'metal' },
  brass: { finish: 'brass', label: 'brass', kind: 'metal' },
  'black metal': { finish: 'black-metal', label: 'black metal', kind: 'metal' },
  glass: { finish: 'glass', label: 'glass', kind: 'glass' },
  'frosted glass': { finish: 'frosted-glass', label: 'frosted glass', kind: 'glass' },
  mirror: { finish: 'mirror', label: 'mirror', kind: 'glass' },
  decking: { finish: 'decking', label: 'decking', kind: 'wood' },
  gravel: { finish: 'gravel', label: 'gravel', kind: 'ground' },
  grass: { finish: 'grass', label: 'grass', kind: 'ground' },
  water: { finish: 'water', label: 'water', kind: 'ground' },
  gold: { preset: 'gold', label: 'gold', kind: 'metal' },
  plastic: { preset: 'plastic', label: 'plastic', kind: 'other' },
  rubber: { preset: 'rubber', label: 'rubber', kind: 'other' },
  ice: { preset: 'ice', label: 'ice', kind: 'glass' },
  snow: { preset: 'snow', label: 'snow', kind: 'ground' },
  sand: { preset: 'sand', label: 'sand', kind: 'ground' },
  dirt: { preset: 'dirt', label: 'dirt', kind: 'ground' },
  lava: { preset: 'lava', label: 'lava', kind: 'ground' },
  crystal: { preset: 'crystal', label: 'crystal', kind: 'glass' },
  neon: { preset: 'neon', label: 'neon', kind: 'other' },
  emissive: { preset: 'emissive', label: 'glowing', kind: 'other' },
};

/** Wallpaper has no finish of its own yet: a tintable woven pattern stands in for it. */
export const WALLPAPER: MaterialWord = { finish: 'fabric', label: 'wallpaper', kind: 'wall' };

/** The longest material phrase in `text`, or null. Wallpaper is handled by the caller. */
export function findMaterial(text: string): { word: MaterialWord; text: string } | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/[\s-]+/g, ' ')} `;
  let best: { word: MaterialWord; text: string } | null = null;
  for (const [phrase, word] of Object.entries(MATERIAL_WORDS)) {
    if (t.includes(` ${phrase} `) && (best === null || phrase.length > best.text.length)) best = { word, text: phrase };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Numbers, amounts, directions
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
  fifty: 50, hundred: 100, half: 0.5,
};

/** Ordinals to indexes (1-based); "last" is -1. */
export const ORDINALS: Readonly<Record<string, number>> = {
  first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5, sixth: 6, '6th': 6, seventh: 7, '7th': 7, eighth: 8, '8th': 8, ninth: 9, '9th': 9, tenth: 10, '10th': 10, last: -1, final: -1,
};

/** Parse "12", "2.5", "twelve", "half" → number; undefined otherwise. */
export function parseNumber(word: string | undefined): number | undefined {
  if (word === undefined) return undefined;
  const w = word.trim().toLowerCase();
  if (/^-?\d+(\.\d+)?$/.test(w)) return Number(w);
  return NUMBER_WORDS[w];
}

/** Degrees implied by an amount word for moves in metres: "a bit" 0.5, default 1, "a lot" 3. */
export function amountMetres(text: string): number {
  const num = /(\d+(?:\.\d+)?)\s*(?:m\b|meters?|metres?)/.exec(text);
  if (num) return Number(num[1]);
  const cm = /(\d+(?:\.\d+)?)\s*(?:cm|centimet(?:er|re)s?)/.exec(text);
  if (cm) return Number(cm[1]) / 100;
  const ft = /(\d+(?:\.\d+)?)\s*(?:ft|feet|foot)/.exec(text);
  if (ft) return Number(ft[1]) * 0.3048;
  if (/\b(?:a\s+)?(?:tiny|touch|hair|smidge|little|slightly|bit|notch|nudge)\b/.test(text)) return 0.4;
  if (/\b(?:a\s+)?(?:lot|far|much|way|considerably)\b/.test(text)) return 3;
  if (/\b(?:some|somewhat|more)\b/.test(text)) return 1.5;
  return 1;
}

/** Multiplicative size factor from words: "a bit bigger" 1.2, "bigger" 1.5, "much bigger" 2, "double" 2, "twice as" 2, "half" 0.5. */
export function sizeFactor(text: string, grow: boolean): number {
  const pct = /(\d+(?:\.\d+)?)\s*(?:%|percent)/.exec(text);
  if (pct) {
    const p = Number(pct[1]) / 100;
    return grow ? 1 + p : Math.max(0.05, 1 - p);
  }
  const times = /(\d+(?:\.\d+)?)\s*(?:x|times)\b/.exec(text);
  if (times) return grow ? Number(times[1]) : 1 / Number(times[1]);
  if (/\b(?:double|twice|2x)\b/.test(text)) return grow ? 2 : 0.5;
  if (/\bhalf\b/.test(text)) return grow ? 1.5 : 0.5;
  if (/\btriple\b/.test(text)) return grow ? 3 : 1 / 3;
  const mild = /\b(?:a\s+)?(?:bit|little|slightly|touch|tad|notch|somewhat)\b/.test(text);
  const strong = /\b(?:much|way|lot|far|huge|massively|considerably|a\s+lot|giant|enormous)\b/.test(text);
  if (grow) return mild ? 1.2 : strong ? 2 : 1.5;
  return mild ? 0.85 : strong ? 0.4 : 0.65;
}

// ---------------------------------------------------------------------------
// Nouns
// ---------------------------------------------------------------------------

/** Naive singularisation. */
export function singular(word: string): string {
  const n = word.toLowerCase();
  const irregular: Readonly<Record<string, string>> = { cacti: 'cactus', sheep: 'sheep', leaves: 'leaf', shelves: 'shelf', knives: 'knife', people: 'person', mice: 'mouse', boxes: 'box', benches: 'bench', bushes: 'bush', glasses: 'glass', dresses: 'dress', lights: 'light', tvs: 'tv' };
  if (irregular[n]) return irregular[n] as string;
  if (n.endsWith('ies') && n.length > 4) return `${n.slice(0, -3)}y`;
  if (/(ches|shes|xes|sses)$/.test(n)) return n.slice(0, -2);
  if (n.endsWith('s') && !n.endsWith('ss') && !n.endsWith('us') && n.length > 3) return n.slice(0, -1);
  return n;
}

/** Synonym groups: every word of a group names the same kind of thing. The first is canonical. */
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['sofa', 'couch', 'settee', 'loveseat', 'divan'],
  ['armchair', 'recliner', 'lounge chair', 'accent chair'],
  ['chair', 'seat', 'stool', 'dining chair'],
  ['table', 'desk'],
  ['rug', 'carpet', 'mat', 'runner'],
  ['art', 'painting', 'picture', 'artwork', 'poster', 'frame', 'canvas', 'print'],
  ['lamp', 'light', 'lamps', 'lighting', 'sconce', 'pendant', 'chandelier', 'lantern'],
  ['curtain', 'drape', 'blind', 'shade'],
  ['tv', 'television', 'screen', 'monitor'],
  ['bed', 'mattress'],
  ['bookshelf', 'bookcase', 'shelf', 'shelves'],
  ['wardrobe', 'closet'],
  ['sideboard', 'cabinet', 'console', 'dresser', 'credenza'],
  ['plant', 'pot plant', 'houseplant', 'planter'],
  ['window', 'glazing'],
  ['door', 'doorway', 'entrance'],
  ['wall', 'walls'],
  ['floor', 'flooring'],
  ['ceiling'],
  ['tree', 'trees', 'oak', 'pine', 'palm'],
  ['rock', 'boulder', 'stone'],
  ['car', 'vehicle', 'kart', 'truck'],
  ['coin', 'coins', 'collectible', 'pickup'],
  ['enemy', 'monster', 'foe', 'rival', 'opponent', 'zombie', 'guard'],
  ['hero', 'player', 'avatar', 'character', 'protagonist'],
  ['npc', 'villager', 'keeper', 'lamplighter', 'storyteller'],
  ['house', 'cottage', 'cabin', 'home', 'hut'],
  ['bush', 'shrub', 'hedge'],
  ['cloud', 'clouds'],
  ['fire', 'campfire', 'fireplace', 'bonfire'],
];

const SYNONYM_INDEX: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, readonly string[]>();
  for (const g of SYNONYM_GROUPS) for (const w of g) m.set(w, [...(m.get(w) ?? []), ...g]);
  return m;
})();

/** All words that name the same thing as `noun` (including itself, singular). */
export function synonymsOf(noun: string): string[] {
  const s = singular(noun);
  const set = new Set<string>([s]);
  for (const w of SYNONYM_INDEX.get(s) ?? []) set.add(singular(w));
  return [...set];
}

/** Words ignored when reducing a phrase to its noun. */
export const FILLER_WORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'my', 'that', 'this', 'those', 'these', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'please', 'just', 'one', 'ones', 'some', 'all', 'every', 'each', 'both',
  'big', 'small', 'large', 'little', 'tiny', 'huge', 'tall', 'short', 'old', 'new', 'nice', 'main', 'other', 'another', 'same', 'whole', 'entire', 'current',
]);
