/**
 * What the showroom guide knows and says (pure, no three.js): the world's catalogue (entities with `product`), the system
 * prompt and request for the site's model (`/api/llm`), the reply parser, the keyword answers used without a model, the
 * greeting, the product lines and the guided tour (route and narration).
 *
 * Products of the same name (the same rug hung twice) are one catalogue item: the model and the keyword match name it by
 * its first id, and the guide walks to the copy nearest the visitor ({@link nearestCopy}).
 */
import { worldTransform, type GuideSpec, type GuideStop, type ProductSpec, type Vec3, type WorldDoc } from '@aether/core';

/** One product of the world. */
export interface Product {
  id: string;
  name: string;
  price?: string;
  size?: string;
  details?: string;
  /** World position of the entity (its transform; the renderer's bounds are better once drawn). */
  position: Vec3 | null;
}

/** A catalogue item: products of one name, `id` the first. */
export interface Item extends Product {
  copies: string[];
}

/** One chat turn sent to the model. */
export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

/** What the guide answers: the line, and a product id to walk to (`tour`: start the guided tour). */
export interface Reply {
  say: string;
  goTo: string | null;
}

/** Turns of the conversation sent with each question. */
export const HISTORY_TURNS = 6;
/** Most stops of a tour built from the products. */
export const TOUR_MAX = 8;

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** The world's products in document order. */
export function products(world: WorldDoc): Product[] {
  const out: Product[] = [];
  for (const [id, e] of Object.entries(world.entities)) {
    const p = (e as { product?: ProductSpec }).product;
    if (!p) continue;
    let position: Vec3 | null = null;
    try {
      position = worldTransform(world, id).position;
    } catch {
      position = null;
    }
    out.push({
      id,
      name: (p.name || e.name || id).trim(),
      ...(p.price ? { price: p.price } : {}),
      ...(p.size ? { size: p.size } : {}),
      ...(p.details ? { details: p.details } : {}),
      position,
    });
  }
  return out;
}

/** Products grouped by name (first id kept). */
export function catalogue(list: readonly Product[]): Item[] {
  const by = new Map<string, Item>();
  for (const p of list) {
    const k = norm(p.name);
    const it = by.get(k);
    if (it) it.copies.push(p.id);
    else by.set(k, { ...p, copies: [p.id] });
  }
  return [...by.values()];
}

/** The copy of `id`'s item nearest `from` (the id itself when it has no copies or nothing is known). */
export function nearestCopy(id: string, list: readonly Product[], from: Readonly<Vec3> | null): string {
  const me = list.find((p) => p.id === id);
  if (!me || !from) return id;
  let best = id;
  let bestD = Number.POSITIVE_INFINITY;
  for (const p of list) {
    if (norm(p.name) !== norm(me.name) || !p.position) continue;
    const d = Math.hypot(p.position[0] - from[0], p.position[2] - from[2]);
    if (d < bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best;
}

const firstSentence = (s: string | undefined): string => {
  if (!s) return '';
  const m = /^[^.!?]*[.!?]/.exec(s.trim());
  return (m ? m[0] : s).trim();
};

/** One catalogue line of the prompt: `id | name | size | price | details`. */
export function productLine(p: Product): string {
  return [p.id, p.name, p.size || '-', p.price || '-', (p.details || '').replace(/\s+/g, ' ')].join(' | ');
}

/** The system prompt of the guide. */
export function systemPrompt(guide: Pick<GuideSpec, 'name' | 'about'>, worldName: string, items: readonly Product[]): string {
  const lines = [
    `You are ${guide.name}, the guide of "${worldName}", a 3D showroom a visitor is walking through in their browser. You stand in the room with them.`,
    guide.about ? `About the shop: ${guide.about.trim()}` : 'Nothing is known about the shop beyond the catalogue.',
    'Catalogue (id | name | size | price | details):',
    ...(items.length > 0 ? items.map(productLine) : ['(empty)']),
    '',
    'Rules:',
    '- Answer in 1 to 3 short sentences, warm and plain, like a good shop assistant. No lists, no markdown.',
    '- Only mention products, prices, sizes and facts that are written above. Never invent any. If you do not know, say so and offer to have the shop get in touch.',
    '- When the answer is about one product, set goTo to its id: you will walk the visitor to it.',
    '- When the visitor asks to be shown round or for a tour, set goTo to "tour".',
    '- Reply with strict JSON only, nothing else: {"say": "...", "goTo": "<product id>" | "tour" | null}',
  ];
  return lines.join('\n');
}

/** The `/api/llm` request (CompletionRequestSchema of apps/server: strict, no other keys). */
export function requestBody(system: string, turns: readonly Turn[]): { role: 'critic'; system: string; messages: Turn[]; maxTokens: number } {
  let messages = turns.slice(-HISTORY_TURNS).map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }));
  // The conversation must open with the visitor.
  while (messages.length > 0 && messages[0]?.role !== 'user') messages = messages.slice(1);
  return { role: 'critic', system, messages, maxTokens: 400 };
}

/** The first balanced `{…}` of `text` (strings respected), or null. */
function firstObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * The model's reply: the first JSON object's `say` and `goTo` (an id not in `ids` is dropped), else the text itself.
 * Null when there is nothing to say.
 */
export function parseReply(text: string, ids: ReadonlySet<string>): Reply | null {
  const raw = text.trim();
  if (!raw) return null;
  const obj = firstObject(raw);
  if (obj) {
    try {
      const v = JSON.parse(obj) as { say?: unknown; goTo?: unknown };
      const say = typeof v.say === 'string' ? v.say.trim() : '';
      const go = typeof v.goTo === 'string' ? v.goTo.trim() : '';
      if (say) return { say: say.slice(0, 600), goTo: go === 'tour' || ids.has(go) ? go : null };
    } catch {
      /* not JSON after all: plain text below */
    }
  }
  const plain = raw
    .replace(/^```[a-z]*\s*|```$/gi, '')
    .replace(/\{[\s\S]*\}/, '')
    .trim();
  return plain ? { say: plain.slice(0, 600), goTo: null } : null;
}

/** Colour words and the shades in product names they match. */
export const COLOURS: Readonly<Record<string, readonly string[]>> = {
  blue: ['blue', 'denim', 'marine', 'navy', 'teal', 'indigo', 'cobalt', 'azure', 'sapphire'],
  red: ['red', 'rust', 'brick', 'crimson', 'terracotta', 'burgundy', 'wine', 'madder'],
  green: ['green', 'teal', 'sage', 'olive', 'emerald', 'forest'],
  white: ['white', 'cream', 'ivory', 'beige', 'natural', 'off-white'],
  cream: ['cream', 'ivory', 'beige', 'natural'],
  grey: ['grey', 'gray', 'charcoal', 'silver', 'slate'],
  gray: ['grey', 'gray', 'charcoal', 'silver', 'slate'],
  black: ['black', 'charcoal', 'ebony'],
  brown: ['brown', 'chocolate', 'walnut', 'tan', 'camel', 'rust'],
  orange: ['orange', 'rust', 'terracotta', 'amber'],
  yellow: ['yellow', 'gold', 'mustard', 'ochre'],
  pink: ['pink', 'rose', 'blush'],
  purple: ['purple', 'violet', 'plum', 'lilac'],
};

/** Style words and the names that belong to them (a Kashan is a Persian rug). */
export const STYLES: Readonly<Record<string, readonly string[]>> = {
  persian: ['persian', 'kashan', 'isfahan', 'tabriz', 'heriz', 'mahal', 'kerman', 'qom', 'nain', 'bakhtiari', 'kilim'],
  oriental: ['persian', 'kashan', 'isfahan', 'tabriz', 'heriz', 'mahal', 'kerman', 'qom', 'nain', 'oriental'],
  modern: ['modern', 'contemporary', 'abstract', 'motion', 'brushstroke'],
  runner: ['runner', 'hall', 'corridor'],
  wall: ['wall', 'hanging', 'tapestry'],
};

const STOP = new Set(
  'a an and any are can could do does for from have how i in is it me my of on or our please show some something tell that the this to what which with you your yours rug rugs carpet carpets one ones got about like want looking see best'.split(' '),
);

const tokens = (s: string): string[] => norm(s).split(/[^a-z0-9-]+/).filter((t) => t.length >= 3 && !STOP.has(t));

/** "€1,290" → 1290; null when there is no number. */
export function priceValue(price: string | undefined): number | null {
  if (!price) return null;
  const m = /(\d[\d.,\s]*)/.exec(price);
  if (!m) return null;
  const n = Number((m[1] as string).replace(/[\s,]/g, '').replace(/\.(?=\d{3}\b)/g, ''));
  return Number.isFinite(n) ? n : null;
}

const has = (q: string, ...words: string[]): boolean => words.some((w) => new RegExp(`\\b${w}`, 'i').test(q));

/** The sentence of `about` that shares most words with the question (at least one), or null. */
function aboutSentence(about: string | undefined, q: string, hint: readonly string[] = []): string | null {
  if (!about) return null;
  const sentences = about.match(/[^.!?]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const want = new Set([...tokens(q), ...hint]);
  let best: string | null = null;
  let bestN = 0;
  for (const s of sentences) {
    const words = tokens(s);
    let n = 0;
    for (const w of want) if (words.some((x) => x.includes(w) || (x.length >= 4 && w.includes(x)))) n++;
    if (n > bestN) {
      bestN = n;
      best = s;
    }
  }
  return best;
}

/** One product in a sentence or two: name, size, price, its first detail. */
export function describe(p: Product): string {
  const facts = [p.size, p.price].filter(Boolean).join(', ');
  return `The ${p.name}${facts ? ` (${facts})` : ''}. ${firstSentence(p.details)}`.trim();
}

/**
 * The answer without a model: a tour, delivery and the shop from `about`, else the products whose name and details match
 * the question's words and colours (cheapest or finest when asked), else a hint of what to ask.
 */
export function keywordAnswer(question: string, items: readonly Item[], guide: Pick<GuideSpec, 'name' | 'about'>): Reply {
  const q = norm(question);
  if (has(q, 'tour', 'show me (a)?round', 'everything', 'show round', 'walk me')) return { say: 'Happily. Follow me, I will show you round.', goTo: 'tour' };
  if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(q) && tokens(q).length <= 2)
    return { say: `Hello! I'm ${guide.name}. Ask me about any piece here, or take the tour with me.`, goTo: null };
  if (has(q, 'deliver', 'ship', 'postage', 'courier')) {
    const s = aboutSentence(guide.about, q, ['deliver', 'ship']);
    return { say: s ?? "I don't have delivery details here, but the shop will gladly tell you. Use Enquire on any piece.", goTo: null };
  }
  if (has(q, 'measure', 'custom', 'bespoke', 'made to', 'order', 'buy', 'pay', 'return', 'open', 'hours', 'contact', 'visit', 'where are')) {
    const s = aboutSentence(guide.about, q, has(q, 'measure', 'custom', 'bespoke', 'made to', 'size') ? ['measure', 'request'] : ['order', 'open', 'contact']);
    if (s) return { say: s, goTo: null };
  }
  // Products: colour words expand to their shades; other words must appear in the name or details.
  const words = tokens(q);
  const shades = new Set<string>();
  for (const w of words) for (const s of COLOURS[w] ?? STYLES[w.replace(/s$/, '')] ?? []) shades.add(s);
  const scored = items
    .map((p) => {
      const name = norm(p.name);
      const text = `${name} ${norm(p.details ?? '')}`;
      let score = 0;
      for (const s of shades) if (new RegExp(`\\b${s}\\b`).test(name)) score += 3;
      for (const w of words) {
        if (COLOURS[w] || STYLES[w.replace(/s$/, '')]) continue;
        const stem = w.replace(/(es|s)$/, '');
        if (stem.length < 3) continue;
        if (name.includes(stem)) score += 2;
        else if (text.includes(stem)) score += 1;
      }
      return { p, score };
    })
    .filter((x) => x.score > 0);
  const cheap = has(q, 'cheap', 'least expensive', 'budget', 'affordable', 'lowest price', 'under');
  const dear = has(q, 'best', 'finest', 'most expensive', 'premium', 'luxur', 'special', 'top', 'heirloom');
  const pool = scored.length > 0 ? scored : cheap || dear ? items.map((p) => ({ p, score: 1 })) : [];
  if (pool.length === 0) {
    const s = aboutSentence(guide.about, q);
    if (s) return { say: s, goTo: null };
    return { say: 'I can tell you about the pieces here, delivery and ordering. Try "Show me something blue", or take the tour.', goTo: null };
  }
  const top = Math.max(...pool.map((x) => x.score));
  let best = pool.filter((x) => x.score === top).map((x) => x.p);
  if (cheap || dear) {
    const priced = (scored.length > 0 ? scored.map((x) => x.p) : best).filter((p) => priceValue(p.price) !== null);
    if (priced.length > 0) {
      priced.sort((a, b) => (priceValue(a.price) as number) - (priceValue(b.price) as number));
      best = cheap ? priced : priced.reverse();
    }
  }
  const pick = best[0] as Item;
  const other = best.find((p) => p.id !== pick.id);
  const lead = cheap ? 'Our most affordable is the' : dear ? 'Our finest is the' : 'You might like the';
  const facts = [pick.size, pick.price].filter(Boolean).join(', ');
  const say = `${lead} ${pick.name}${facts ? ` (${facts})` : ''}. ${firstSentence(pick.details)}${other ? ` There is also the ${other.name}.` : ''} Let me show you.`.replace(/\s+/g, ' ').trim();
  return { say, goTo: pick.id };
}

/** The guide's first line. */
export function greetingFor(guide: Pick<GuideSpec, 'name' | 'greeting'>, worldName: string, canTour: boolean): string {
  if (guide.greeting?.trim()) return guide.greeting.trim();
  return `Welcome to ${worldName || 'the showroom'}! I'm ${guide.name}.${canTour ? ' Shall I show you round?' : ' Ask me about anything you see.'}`;
}

/**
 * The tour: `ids` (the world's `guide.tour`, unknown ids dropped) in order, else a nearest-neighbour walk from `start`
 * over the products, one of each name, at most {@link TOUR_MAX} stops.
 */
export function tourRoute(list: readonly Product[], start: Readonly<Vec3> | null, ids?: readonly string[]): Product[] {
  const byId = new Map(list.map((p) => [p.id, p]));
  if (ids && ids.length > 0) {
    const out: Product[] = [];
    for (const id of ids) {
      const p = byId.get(id);
      if (p && !out.includes(p)) out.push(p);
    }
    if (out.length > 0) return out;
  }
  const left = list.filter((p) => p.position);
  const seen = new Set<string>();
  const out: Product[] = [];
  let at: Readonly<Vec3> | null = start ?? (left[0]?.position as Vec3 | undefined) ?? null;
  while (left.length > 0 && out.length < TOUR_MAX && at) {
    let bi = 0;
    let bd = Number.POSITIVE_INFINITY;
    for (const [i, p] of left.entries()) {
      const q = p.position as Vec3;
      const d = Math.hypot(q[0] - (at as Vec3)[0], q[2] - (at as Vec3)[2]);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    const p = left.splice(bi, 1)[0] as Product;
    const k = norm(p.name);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    at = p.position;
  }
  return out;
}

/** The guide's line at stop `i` of `n`: the product's name, size and price, and its first detail. */
export function narrate(p: Product, i: number, n: number): string {
  const lead = i === 0 ? `We start with the ${p.name}.` : i === n - 1 ? `And last, the ${p.name}.` : i % 2 === 1 ? `Next, the ${p.name}.` : `Here is the ${p.name}.`;
  const facts = p.size && p.price ? `It's ${p.size} and costs ${p.price}.` : p.price ? `It costs ${p.price}.` : p.size ? `It's ${p.size}.` : '';
  return [lead, facts, firstSentence(p.details)].filter(Boolean).join(' ');
}

/** The guide's last line of a tour. */
export const TOUR_END = "That's the tour. Ask me about anything you liked.";
/** The last line when the visitor saved favourites on the way. */
export const TOUR_END_SAVED = "That's the tour. I've gathered your favourites here, so you can enquire or ask me about any of them.";
/** The first line of a tour whose first stop has no chapter intro. */
export const TOUR_START = 'Follow me, I will show you round.';
/** Lines of `guide.ts` that are always the same (recorded with the rest). */
export const FIXED_LINES: readonly string[] = [TOUR_START, 'This way.', 'All right. Ask me about anything you like.', 'Hello again! How can I help?', TOUR_END, TOUR_END_SAVED];

/** One stop of the guided tour, resolved against the world. */
export interface TourStop {
  /** The entity the stop shows. */
  id: string;
  /** The product there (null: a stop at something else, the reception, a sculpture). */
  product: Product | null;
  /** Chapter it belongs to ('' outside chapters). */
  chapter: string;
  /** The line said walking into its chapter (the chapter's first stop only). */
  intro?: string;
  title: string;
  /** Authored line said there. */
  say?: string;
  position: Vec3 | null;
}

/**
 * The tour of a world: `guide.tour` (plain ids and `{ at, chapter, intro, title, say }` stops; unknown entities and
 * repeats dropped; a chapter carries on until the next names one), else {@link tourRoute} over the products.
 */
export function tourStops(world: WorldDoc, list: readonly Product[], spec?: readonly GuideStop[]): TourStop[] {
  const byId = new Map(list.map((p) => [p.id, p]));
  const out: TourStop[] = [];
  let chapter = '';
  for (const s of spec ?? []) {
    const o = typeof s === 'string' ? { at: s } : s;
    const e = world.entities[o.at];
    if (!e || out.some((x) => x.id === o.at)) continue;
    const product = byId.get(o.at) ?? null;
    const named = o.chapter?.trim();
    const intro = named && o.intro?.trim();
    if (named) chapter = named;
    let position: Vec3 | null = product?.position ?? null;
    if (!product)
      try {
        position = worldTransform(world, o.at).position;
      } catch {
        position = null;
      }
    const say = o.say?.trim();
    out.push({ id: o.at, product, chapter, ...(intro ? { intro } : {}), title: o.title?.trim() || product?.name || e.name || o.at, ...(say ? { say } : {}), position });
  }
  if (out.length > 0) return out;
  return tourRoute(list, world.player.spawn).map((p) => ({ id: p.id, product: p, chapter: '', title: p.name, position: p.position }));
}

/** What the guide says at stop `i` of `stops`: its own line, else one made from its product, else its title. */
export function stopLine(stops: readonly TourStop[], i: number): string {
  const s = stops[i] as TourStop;
  if (s.say) return s.say;
  if (s.product) return narrate(s.product, i, stops.length);
  return i === 0 ? `We start at the ${s.title}.` : `Here is the ${s.title}.`;
}

/** Seconds a line takes to say (about 15 characters a second), when no recording tells. */
export const speechSeconds = (text: string): number => Math.min(22, 1 + text.trim().length / 15);

/** Seconds each stop holds after its line before the tour moves on (the countdown). */
export const COUNTDOWN_S = 4;

/**
 * Whole minutes the tour takes (at least 1): the walk between stops from `start` (straight lines, a fifth longer for
 * detours, at 1.3 m/s), each line said, the framing and the countdown.
 */
export function tourMinutes(stops: readonly TourStop[], start: Readonly<Vec3> | null): number {
  let s = 0;
  let at = start;
  for (const [i, st] of stops.entries()) {
    if (at && st.position) s += (Math.hypot(st.position[0] - at[0], st.position[2] - at[2]) * 1.2) / 1.3;
    at = st.position ?? at;
    s += (st.intro ? speechSeconds(st.intro) : 0) + speechSeconds(stopLine(stops, i)) + 1.5 + COUNTDOWN_S;
  }
  return Math.max(1, Math.round(s / 60));
}

/**
 * Every line the guide can say from what the world holds, as it is said (the recording's text): the greeting, the fixed
 * lines, the tour's intros and stop lines, and each product's line for "Ask the guide".
 */
export function guideLines(world: WorldDoc): string[] {
  const spec = world.guide;
  if (!spec) return [];
  const list = products(world);
  const stops = tourStops(world, list, spec.tour);
  const out = new Set<string>([greetingFor(spec, world.name, stops.length > 1), ...FIXED_LINES]);
  for (const [i, s] of stops.entries()) {
    if (s.intro) out.add(s.intro);
    out.add(stopLine(stops, i));
  }
  for (const p of catalogue(list)) out.add(talkLine(p));
  return [...out];
}

/** The line of "Ask the guide" on a product's card. */
export const talkLine = (p: Product): string => `${describe(p)} Ask me anything about it.`;
