/**
 * Hub-first policy: when a real-world PROP is asked for (furniture, appliances, tools, vehicles, kitchenware, equipment,
 * decor) the asset hub is tried before the bundled library and the generators; a hub model is used only when its match
 * passes {@link HUB_FIRST} and its size is plausible for the request. Structural parts never come from the hub.
 *
 * Lookup order (docs/ASSETS.md, "Lookup order"): structural -> bundled library / crafted parts; prop -> hub (accepted) ->
 * bundled library -> crafted part -> generator. Pure and light (no zod, no DOM): the agent's lazy chunk imports it.
 *
 * "Semantic": the browser has no text tower for the CLIP embeddings (64 MB), so the match score is the library ranker's
 * (name, alias, tag, synonym) normalised to 0..1; the image embeddings serve `similar()` only.
 */
import { tokenize } from './search';

/** The one place the thresholds live. */
export const HUB_FIRST = {
  /** Minimum match confidence 0..1: 1 = every query word is a name word, 0.73 a tag, 0.33 a prefix match. */
  minConfidence: 0.7,
  /** The hub model's longest side must be within this factor of the reference size (typical size from the catalog). */
  sizeRatioMin: 0.4,
  sizeRatioMax: 2.5,
  /** Whatever the reference: no prop is longer than 30 m or shorter than 3 cm. */
  absMinMetres: 0.03,
  absMaxMetres: 30,
  /** The hub is given this long to answer; later is the same as unreachable. */
  timeoutMs: 3000,
} as const;

/** Per-word score of a name-word match in the ranker: the denominator of the confidence. */
const FULL_WORD_SCORE = 30;

/** Parts that must fit plan dimensions: never taken from the hub. */
export const STRUCTURAL_RE = /\b(walls?|doors?|doorways?|windows?|stair(?:s|case|cases)?|roof(?:s|ing)?|floors?|flooring|ceilings?|foundations?|facades?|skirting|baseboards?|archways?|balcon(?:y|ies)|terrain|beams?)\b/i;
export const isStructuralQuery = (q: string): boolean => STRUCTURAL_RE.test(q);

/** Hub categories that count as real-world props. */
export const HUB_PROP_CATEGORIES: ReadonlySet<string> = new Set(['furniture', 'kitchen', 'bathroom', 'decor', 'lighting', 'tools', 'vehicles', 'props', 'food']);

/** Typical longest side in metres [min, max] of common props; the catalog's own sizes are used when a word is not here. */
const TYPICAL_LONGEST: ReadonlyArray<readonly [string, number, number]> = [
  ['desk', 0.9, 2.6], ['table', 0.5, 4.5], ['chair', 0.4, 1.4], ['stool', 0.3, 1.1], ['sofa', 1.2, 3.4], ['couch', 1.2, 3.4], ['armchair', 0.6, 1.4],
  ['bed', 1.6, 2.7], ['wardrobe', 0.8, 2.6], ['shelf', 0.5, 2.6], ['bookcase', 0.6, 2.6], ['cabinet', 0.4, 2.6], ['fridge', 0.5, 2.3], ['refrigerator', 0.5, 2.3],
  ['oven', 0.4, 1.2], ['stove', 0.4, 1.2], ['dishwasher', 0.5, 1.0], ['washing machine', 0.5, 1.1], ['lamp', 0.15, 2.4], ['car', 3, 6.5], ['bicycle', 1.4, 2.2], ['motorcycle', 1.6, 2.8],
  ['hammer', 0.15, 0.6], ['wrench', 0.1, 0.8], ['mug', 0.07, 0.2], ['cup', 0.05, 0.2], ['plate', 0.1, 0.4], ['monitor', 0.3, 1.0], ['keyboard', 0.25, 0.6],
];

export interface HubFirstHit {
  id: string;
  name: string;
  category: string;
  /** Metres: width, height, depth. */
  size: readonly [number, number, number];
  /** Raw ranker score of this hit for the query (undefined: not given by the host, so no confidence). */
  score?: number;
}

/** Match confidence 0..1 from the ranker's raw score (undefined without one). */
export function hubConfidence(query: string, score: number | undefined): number | undefined {
  if (score === undefined) return undefined;
  const words = Math.max(1, tokenize(query).length);
  return Math.min(1, Math.max(0, score / (words * FULL_WORD_SCORE)));
}

const longest = (s: readonly number[]): number => Math.max(...s);

/** Plausible longest side [min, max] for the request: typical-size table first, then the catalog's sizes for the same request. */
export function plausibleRange(query: string, refSizes: ReadonlyArray<readonly [number, number, number]> = []): [number, number] {
  const q = query.toLowerCase();
  let lo: number = HUB_FIRST.absMinMetres;
  let hi: number = HUB_FIRST.absMaxMetres;
  const known = TYPICAL_LONGEST.find(([w]) => new RegExp(`\\b${w}s?\\b`).test(q));
  if (known) {
    lo = Math.max(lo, known[1]);
    hi = Math.min(hi, known[2]);
  } else if (refSizes.length > 0) {
    const m = refSizes.map(longest).sort((a, b) => a - b);
    const med = m[Math.floor(m.length / 2)] as number;
    if (med > 0) {
      lo = Math.max(lo, med * HUB_FIRST.sizeRatioMin);
      hi = Math.min(hi, med * HUB_FIRST.sizeRatioMax);
    }
  }
  return [lo, hi];
}

export type HubFirstSkip = 'structural' | 'not-a-prop' | 'hub-unavailable' | 'no-match' | 'below-threshold' | 'implausible-size';
export type HubFirstVerdict = { use: true; hit: HubFirstHit; confidence: number } | { use: false; reason: HubFirstSkip };

/**
 * Decide whether a hub model answers the request. `hits` are the hub's ranked matches (best first); `refSizes` are the sizes of
 * the bundled catalog's matches for the same words. The first hit that passes both checks wins.
 */
export function pickHubFirst(query: string, hits: readonly HubFirstHit[] | null, refSizes: ReadonlyArray<readonly [number, number, number]> = []): HubFirstVerdict {
  if (isStructuralQuery(query)) return { use: false, reason: 'structural' };
  if (hits === null) return { use: false, reason: 'hub-unavailable' };
  if (hits.length === 0) return { use: false, reason: 'no-match' };
  const props = hits.filter((h) => HUB_PROP_CATEGORIES.has(h.category));
  if (props.length === 0) return { use: false, reason: 'not-a-prop' };
  const [lo, hi] = plausibleRange(query, refSizes);
  let confident = false;
  for (const h of props) {
    const c = hubConfidence(query, h.score);
    if (c === undefined || c < HUB_FIRST.minConfidence) continue;
    confident = true;
    const l = longest(h.size);
    if (l >= lo && l <= hi) return { use: true, hit: h, confidence: c };
  }
  return { use: false, reason: confident ? 'implausible-size' : 'below-threshold' };
}

/** The reason in words, for the result line the judge and the chat read. */
export const HUB_SKIP_TEXT: Readonly<Record<HubFirstSkip, string>> = {
  structural: 'a structural part (must fit the plan), never from the hub',
  'not-a-prop': 'the hub has no prop of that kind',
  'hub-unavailable': 'the hub was not reachable in time',
  'no-match': 'the hub has no match',
  'below-threshold': `no hub match reached the ${HUB_FIRST.minConfidence} confidence threshold`,
  'implausible-size': 'the hub matches have an implausible size for the request',
};

/** Run `fn` but give up after `ms` (and abort it): null when it is late, throws or is aborted. Never throws. */
export async function withHubTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number = HUB_FIRST.timeoutMs, outer?: AbortSignal): Promise<T | null> {
  const ctl = new AbortController();
  const onAbort = (): void => ctl.abort();
  outer?.addEventListener('abort', onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(ctl.signal).catch(() => null),
      new Promise<null>((res) => {
        timer = setTimeout(() => {
          ctl.abort();
          res(null);
        }, ms);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}
