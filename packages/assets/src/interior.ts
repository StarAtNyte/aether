/**
 * Interior model finder: ranks the realistic furniture and decor models of the catalog by what the
 * object is (`interior.type`), the design style, the colour and the size wanted. Used by the
 * `find_model` tool (the model chooses and judges), by `place_items` (`model:<id>`, or a catalogue
 * kind resolved to the best model) and by layouts, which fall back to the parametric part when
 * nothing fits.
 */
import type { AssetCategory, AssetPlacement, Catalog, CatalogEntry } from './schema';
import { synonymsOf } from './synonyms';
import { searchAssets, tokenize } from './search';

/** What a furniture catalogue kind maps to: the interior types that can stand in for it. */
export const KIND_MODELS: Readonly<Record<string, { types: readonly string[]; mount?: AssetPlacement; avoid?: readonly string[] }>> = {
  sofa: { types: ['sofa'] },
  armchair: { types: ['armchair'] },
  lounger: { types: ['armchair'] },
  // A chair at a dining table or a desk in a home is not a swivel office chair on castors.
  chair: { types: ['chair'], avoid: ['swivel'] },
  'bar-stool': { types: ['stool'] },
  // Nor is a dining or meeting table a steel kitchen prep bench, a garage workbench or a low coffee table.
  'dining-table': { types: ['table'], avoid: ['prep', 'stainless', 'workbench', 'coffee'] },
  'coffee-table': { types: ['coffee-table'] },
  desk: { types: ['desk'] },
  bed: { types: ['bed'] },
  nightstand: { types: ['nightstand'] },
  sideboard: { types: ['sideboard', 'console'] },
  wardrobe: { types: ['wardrobe'] },
  bookshelf: { types: ['bookshelf'] },
  fireplace: { types: ['fireplace'] },
  pendant: { types: ['lamp'], mount: 'ceiling' },
  'ceiling-light': { types: ['lamp'], mount: 'ceiling' },
  'table-lamp': { types: ['lamp'], mount: 'surface' },
  sconce: { types: ['lamp'], mount: 'wall' },
  plant: { types: ['plant'] },
  mirror: { types: ['mirror'] },
  art: { types: ['picture'] },
  'tv-set': { types: ['tv'] },
  book: { types: ['books'] },
  accent: { types: ['vase'] },
};

/**
 * Kinds a layout may swap for a library model on its own. The rest (wardrobes, cabinets, kitchens,
 * fridges, nightstands) have doors and drawers that open in play mode, which a static model cannot do; mirrors and
 * pictures keep their parametric art, which follows the palette and varies. All of them take a model when the model
 * asks for one by id (`model:<id>`).
 */
export const AUTO_MODEL_KINDS: ReadonlySet<string> = new Set(['sofa', 'armchair', 'chair', 'dining-table', 'coffee-table', 'desk', 'bed', 'bookshelf', 'pendant', 'table-lamp', 'plant']);

/** Types whose style hardly matters (a plant or a vase suits any room), so a style miss does not disqualify them. */
const LOOSE_TYPES: ReadonlySet<string> = new Set(['plant', 'vase', 'books', 'basket', 'bowl', 'picture', 'mirror', 'clock', 'pillow', 'candle', 'statue', 'game']);

/** Design styles of the planner and the words the catalog describes models with. */
const STYLE_WORDS: Readonly<Record<string, readonly string[]>> = {
  modern: ['modern', 'contemporary', 'minimal'],
  scandinavian: ['scandinavian', 'modern', 'minimal'],
  industrial: ['industrial', 'loft', 'office'],
  japandi: ['minimal', 'scandinavian', 'asian', 'natural'],
  classic: ['classic', 'traditional', 'vintage', 'gothic'],
  mediterranean: ['rustic', 'traditional', 'farmhouse', 'natural'],
  rustic: ['rustic', 'farmhouse', 'traditional', 'vintage'],
  vintage: ['vintage', 'retro', 'classic'],
  asian: ['asian', 'traditional'],
  farmhouse: ['farmhouse', 'rustic'],
  loft: ['loft', 'industrial'],
  // Worlds outdoors and beyond: the biome words the outdoor models are tagged with.
  forest: ['forest', 'temperate', 'conifer'],
  woods: ['forest', 'temperate', 'conifer'],
  jungle: ['tropical', 'forest'],
  tropical: ['tropical', 'coastal'],
  desert: ['desert', 'arid'],
  canyon: ['canyon', 'desert', 'arid'],
  beach: ['coastal', 'beach'],
  coastal: ['coastal', 'harbour', 'beach'],
  harbour: ['harbour', 'coastal'],
  harbor: ['harbour', 'coastal'],
  city: ['urban', 'city'],
  urban: ['urban', 'city'],
  street: ['urban', 'city'],
  town: ['urban', 'city', 'medieval'],
  village: ['farm', 'rural', 'medieval', 'garden'],
  farm: ['farm', 'garden', 'rural'],
  rural: ['farm', 'rural', 'garden'],
  garden: ['garden', 'park', 'farm'],
  park: ['park', 'garden', 'urban'],
  factory: ['industrial'],
  warehouse: ['industrial'],
  'sci-fi': ['scifi', 'industrial'],
  scifi: ['scifi', 'industrial'],
  space: ['scifi', 'moon'],
  fantasy: ['fantasy', 'medieval'],
  medieval: ['medieval', 'fantasy'],
  pirate: ['pirate', 'coastal', 'fantasy'],
  swamp: ['swamp', 'forest'],
  mountain: ['mountain', 'alpine', 'forest'],
  wasteland: ['wasteland', 'industrial', 'desert'],
};

/** Plain colour names the catalog measures (see `scripts/assets/tex_tiers.py`) and the aliases people use. */
const COLOR_ALIASES: Readonly<Record<string, string>> = { gray: 'grey', charcoal: 'black', ivory: 'cream', tan: 'tan', wooden: 'brown', wood: 'brown', oak: 'tan', walnut: 'dark-brown', burgundy: 'red', turquoise: 'teal', mustard: 'yellow', rose: 'pink', lilac: 'purple' };

/** One ranked model with the reasons behind its score. */
export interface ModelHit {
  entry: CatalogEntry;
  score: number;
  /** Short facts the model can judge by ("style match: modern", "0.2 m wider than asked"). */
  notes: string[];
}

/** What the caller wants. Everything is optional; give at least `type`, `kind` or `text`. */
export interface ModelQuery {
  /** Interior type or a synonym ("sofa", "couch", "coffee-table"). */
  type?: string;
  /** A furniture catalogue kind ("dining-table"): resolved through {@link KIND_MODELS}. */
  kind?: string;
  /** Free text ("green velvet armchair"); its type word is used when `type` is absent, the rest ranks. */
  text?: string;
  /** A design style word ("modern", "classic"). */
  style?: string;
  /** A colour name or `#rrggbb`. */
  color?: string;
  /** Wanted size in metres, [width, height, depth]; use 0 or leave out a side that does not matter. */
  size?: ReadonlyArray<number | undefined>;
  mount?: AssetPlacement;
  /** When true, a model must match the style (a miss is dropped). */
  strictStyle?: boolean;
  /** Only this catalog category ("nature", "rocks", "street", "building", "props"...). */
  category?: string;
  /**
   * The art style of the model: "realistic" (photographed, the default), "stylised" / "low-poly" (the Kenney kits, for
   * cartoon or blocky worlds) or "any". Stylised kits are never offered to a realistic request.
   */
  look?: 'realistic' | 'stylised' | 'low-poly' | 'any';
  limit?: number;
}

/** Known interior types of a catalog (from `interior.type`). */
export function interiorTypes(catalog: Catalog): string[] {
  const out = new Set<string>();
  for (const e of catalog.entries) {
    const t = typeOf(e, null);
    if (t) out.add(t);
  }
  return [...out].sort();
}

const typeCache = new WeakMap<Catalog, Set<string>>();
function knownTypes(catalog: Catalog): Set<string> {
  let s = typeCache.get(catalog);
  if (!s) {
    s = new Set(catalog.entries.flatMap((e) => (e.interior ? [e.interior.type] : [])));
    typeCache.set(catalog, s);
  }
  return s;
}

/** The interior type of an entry: recorded, or (for earlier realistic models) the longest known type its id starts with. */
function typeOf(e: CatalogEntry, known: Set<string> | null): string | undefined {
  if (e.interior) return e.interior.type;
  if (!known || e.style !== 'realistic' || e.kind !== 'model') return undefined;
  const parts = e.id.split('-');
  for (let n = Math.min(2, parts.length); n >= 1; n--) {
    const t = parts.slice(0, n).join('-');
    if (known.has(t)) return t;
  }
  return undefined;
}

/** Resolve a word or phrase to an interior type of this catalog ("couch" gives "sofa"), or null. */
export function resolveType(catalog: Catalog, word: string): string | null {
  const known = knownTypes(catalog);
  const w = word.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (known.has(w)) return w;
  for (const t of tokenize(word)) {
    if (known.has(t)) return t;
    for (const alt of synonymsOf(t)) {
      const a = alt.replace(/\s+/g, '-');
      if (known.has(a)) return a;
    }
  }
  const sing = tokenize(w.replace(/-/g, ' ')).join('-');
  return known.has(sing) ? sing : null;
}

/** A phrase that is itself a type or a synonym of one ("coffee table", "end table"), or null. */
function resolvePhrase(catalog: Catalog, phrase: string): string | null {
  const known = knownTypes(catalog);
  const w = phrase.trim().toLowerCase().replace(/\s+/g, '-');
  if (known.has(w)) return w;
  for (const alt of synonymsOf(phrase.trim().toLowerCase())) {
    const a = alt.replace(/\s+/g, '-');
    if (known.has(a)) return a;
  }
  return null;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function styleHits(e: CatalogEntry, style: string | undefined): string[] {
  if (!style || !e.interior) return [];
  const wanted = new Set([style.toLowerCase(), ...(STYLE_WORDS[style.toLowerCase()] ?? [])]);
  return e.interior.styles.filter((s) => wanted.has(s));
}

/**
 * Rank interior models. A model must be of the wanted type; style, colour and size then order them
 * (more style words matched, closer colour, closer size first), ties going to the lighter file.
 */
export function findModels(catalog: Catalog, q: ModelQuery): ModelHit[] {
  const known = knownTypes(catalog);
  const types = new Set<string>();
  let mount = q.mount;
  const avoid = new Set<string>(q.kind ? (KIND_MODELS[q.kind]?.avoid ?? []) : []);
  if (q.kind && KIND_MODELS[q.kind]) {
    for (const t of KIND_MODELS[q.kind]!.types) types.add(t);
    mount ??= KIND_MODELS[q.kind]!.mount;
  }
  if (q.type) {
    const t = resolveType(catalog, q.type);
    if (t) types.add(t);
  }
  let rest = q.text ?? '';
  if (types.size === 0 && rest) {
    // The type word is the last word that names one ("green velvet armchair").
    const words = tokenize(rest);
    for (let i = words.length - 1; i >= 0 && types.size === 0; i--) {
      // A two-word type only as a phrase ("coffee table"): "table lamp" is a lamp, not a table.
      const two = i > 0 ? resolvePhrase(catalog, `${words[i - 1]} ${words[i]}`) : null;
      const one = resolveType(catalog, words[i]!);
      const t = two ?? one;
      if (t) {
        types.add(t);
        rest = words.filter((_, k) => k !== i && !(two && k === i - 1)).join(' ');
      }
    }
  }
  const limit = Math.max(1, Math.min(30, q.limit ?? 6));
  const look = q.look ?? 'realistic';
  if (types.size === 0 || look === 'stylised' || look === 'low-poly') {
    // No known type, or a stylised world: plain search over the models of that look, so a rare object still has a chance.
    const text = [q.text ?? q.type ?? q.kind ?? '', q.style ?? ''].join(' ').trim();
    return searchAssets(catalog, { text, kind: 'model', ...(look === 'any' ? {} : { style: look }), ...(q.category ? { category: q.category as AssetCategory } : {}), limit: 60 })
      .filter((h) => h.entry.category !== 'characters' && h.entry.category !== 'animals')
      .slice(0, limit)
      .map((h) => ({ entry: h.entry, score: h.score, notes: [`text match, ${h.entry.style}`] }));
  }
  const wantColors = new Set<string>();
  let wantRgb: [number, number, number] | null = null;
  for (const raw of [q.color ?? '', ...tokenize(rest)]) {
    const c = raw.toLowerCase();
    const rgb = hexToRgb(c);
    if (rgb) wantRgb = rgb;
    else if (c) wantColors.add(COLOR_ALIASES[c] ?? c);
  }
  const hits: ModelHit[] = [];
  for (const e of catalog.entries) {
    if (e.kind !== 'model') continue;
    const t = typeOf(e, known);
    if (!t || !types.has(t)) continue;
    if (mount && e.placement !== mount) continue;
    if (avoid.size > 0 && e.tags.some((g) => avoid.has(g))) continue;
    if (q.category && e.category !== q.category) continue;
    if (look === 'realistic' && e.style !== 'realistic') continue;
    const notes: string[] = [];
    let score = 100;
    const sh = styleHits(e, q.style);
    if (q.style) {
      if (sh.length > 0) {
        score += 20 * sh.length;
        notes.push(`style: ${sh.join(', ')}`);
      } else if (q.strictStyle && !LOOSE_TYPES.has(t)) continue;
      else score -= LOOSE_TYPES.has(t) ? 0 : 25;
    }
    if (e.interior) {
      const cn = e.interior.colors.filter((c) => wantColors.has(c));
      if (cn.length > 0) {
        score += 25;
        notes.push(`colour: ${cn.join(', ')}`);
      }
      if (wantRgb) {
        const d = Math.hypot(e.interior.rgb[0] - wantRgb[0], e.interior.rgb[1] - wantRgb[1], e.interior.rgb[2] - wantRgb[2]);
        score += Math.round(25 * (1 - Math.min(1, d / 300)));
        notes.push(`colour distance ${Math.round(d)}`);
      }
    }
    if (q.size) {
      for (let i = 0; i < 3; i++) {
        const want = q.size[i];
        const have = e.size[i]!;
        if (!want || want <= 0 || have <= 0) continue;
        const off = Math.abs(Math.log(have / want));
        score -= Math.round(40 * Math.min(1, off));
        if (off > 0.15) notes.push(`${['width', 'height', 'depth'][i]} ${have.toFixed(2)} m (wanted ${want.toFixed(2)})`);
      }
    }
    hits.push({ entry: e, score, notes });
  }
  hits.sort((a, b) => b.score - a.score || a.entry.bytes - b.entry.bytes || (a.entry.id < b.entry.id ? -1 : 1));
  return hits.slice(0, limit);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The model a layout should use for a catalogue kind in a style, or null when none suits. Among the
 * models near the best score, `seed` picks one, so a house gets varied but repeatable furniture.
 */
export function pickModel(catalog: Catalog, kind: string, style: string, opts: { seed?: string; size?: ReadonlyArray<number | undefined>; color?: string } = {}): CatalogEntry | null {
  const hits = findModels(catalog, { kind, style, strictStyle: true, limit: 12, ...(opts.size ? { size: opts.size } : {}), ...(opts.color ? { color: opts.color } : {}) });
  if (hits.length === 0) return null;
  const top = hits[0]!.score;
  const near = hits.filter((h) => h.score >= top - 15);
  return near[opts.seed ? hash(opts.seed) % near.length : 0]!.entry;
}

/** One line for the model to judge a candidate by. */
export function describeModel(h: ModelHit): string {
  const e = h.entry;
  const size = e.size.map((v) => Math.round(v * 100) / 100).join('x');
  const i = e.interior;
  const bits = [`${size} m`, `${e.category}, ${e.style}`, i ? `styles ${i.styles.join('/')}` : '', i && i.colors.length > 0 ? `colours ${i.colors.join('/')}` : '', e.placement !== 'floor' ? `goes on ${e.placement}` : '', ...h.notes.slice(0, 3)].filter(Boolean);
  return `${e.id} — ${e.name}: ${bits.join('; ')}`;
}


const NOT_A_NOUN: ReadonlySet<string> = new Set(['a', 'an', 'the', 'of', 'for', 'and', 'with', 'in', 'on', 'to', 'small', 'big', 'large', 'old', 'new', 'wooden', 'wood', 'modern', 'classic', 'antique', 'vintage', 'realistic', 'photographed', 'tall', 'short', 'long', 'low', 'high', 'round', 'square', 'red', 'green', 'blue', 'black', 'white', 'grey', 'gray', 'brown', 'yellow', 'gold', 'golden', 'metal', 'stone', 'marble', 'glass', 'plastic', 'ornate', 'simple', 'cheap', 'fancy']);
const singularOf = (w: string): string => (w.length > 3 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') ? w.slice(0, -1) : w);

/** The noun a request is about: its last plain word ("church pew" gives "pew", "tall wooden bookcase" gives "bookcase"). */
export function headNoun(text: string): string | null {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !NOT_A_NOUN.has(w));
  const w = words[words.length - 1];
  return w ? singularOf(w) : null;
}

/** True when nothing in a model's id, name, tags or interior type names the noun (a bench is found for a pew through a synonym). */
export function lacksNoun(e: CatalogEntry, noun: string): boolean {
  const hay = ` ${[e.id, e.name, ...e.tags, e.interior?.type ?? ''].join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const plural = `${noun}s`;
  return !(hay.includes(` ${noun} `) || hay.includes(` ${plural} `) || hay.includes(` ${noun}es `));
}
