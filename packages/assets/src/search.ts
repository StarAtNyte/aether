/**
 * Asset search: tokenised, synonym-expanded, typo-tolerant ranking over the
 * catalog. Pure and allocation-light; the per-entry token index is built
 * once per catalog object and cached.
 */
import type { AssetCategory, AssetPlacement, AssetStyle, Catalog, CatalogEntry } from './schema';
import { synonymsOf } from './synonyms';

/** Optional filters for {@link searchAssets}. */
export interface AssetQuery {
  /** Free text ("modern couch", "oak tree", "police car"). Empty = everything (filtered). */
  text?: string;
  category?: AssetCategory;
  kind?: CatalogEntry['kind'];
  style?: AssetStyle;
  placement?: AssetPlacement;
  /** Only animated models (characters / animals with clips). */
  animated?: boolean;
  /** Maximum results (default 24, capped at 200). */
  limit?: number;
}

/** One ranked hit. */
export interface AssetHit {
  entry: CatalogEntry;
  score: number;
}

const MAX_QUERY_CHARS = 200;
const MAX_TOKENS = 8;

/** Lowercase words of a free-text string (simple plural folding: "chairs" → "chair"). */
export function tokenize(text: string): string[] {
  const words = text
    .slice(0, MAX_QUERY_CHARS)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
  return words.map(singular);
}

function singular(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}

interface Indexed {
  entry: CatalogEntry;
  id: string;
  nameWords: Set<string>;
  tags: Set<string>;
}

const cache = new WeakMap<Catalog, Indexed[]>();

function indexOf(catalog: Catalog): Indexed[] {
  let idx = cache.get(catalog);
  if (!idx) {
    idx = catalog.entries.map((entry) => ({
      entry,
      id: entry.id,
      nameWords: new Set([...tokenize(entry.name), ...tokenize(entry.id.replace(/-/g, ' '))]),
      tags: new Set(entry.tags.flatMap((t) => tokenize(t))),
    }));
    cache.set(catalog, idx);
  }
  return idx;
}

/** Levenshtein distance ≤ 1 (one insert, delete or substitution). */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a.charCodeAt(i) === b.charCodeAt(j)) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

/** Score one token against one entry (0 = no match). */
function tokenScore(token: string, alts: readonly string[], it: Indexed): number {
  if (it.nameWords.has(token)) return 30;
  if (it.tags.has(token)) return 22;
  for (const alt of alts) {
    if (alt === token) continue;
    // Multi-word synonyms ("lounge chair") match when every word is present.
    const parts = alt.split(' ');
    const all = parts.every((p) => it.nameWords.has(p) || it.tags.has(p));
    if (all) return parts.length > 1 ? 24 : 18;
  }
  if (it.entry.category === token) return 14;
  if (token.length >= 3) {
    for (const w of it.nameWords) if (w.startsWith(token)) return 10;
    for (const w of it.tags) if (w.startsWith(token)) return 8;
  }
  if (token.length >= 5) {
    for (const w of it.nameWords) if (withinOneEdit(token, w)) return 6;
    for (const w of it.tags) if (withinOneEdit(token, w)) return 5;
  }
  return 0;
}

function passes(e: CatalogEntry, q: AssetQuery): boolean {
  if (q.category && e.category !== q.category) return false;
  if (q.kind && e.kind !== q.kind) return false;
  if (q.style && e.style !== q.style) return false;
  if (q.placement && e.placement !== q.placement) return false;
  if (q.animated && !(e.anims && e.anims.clips.length > 0)) return false;
  return true;
}

/**
 * Rank catalog entries for a query. Every query word must match (directly,
 * through a synonym, by prefix or with one typo); entries matching more
 * strongly rank first, ties broken by smaller triangle count then id.
 */
export function searchAssets(catalog: Catalog, query: AssetQuery | string): AssetHit[] {
  const q: AssetQuery = typeof query === 'string' ? { text: query } : query;
  const limit = Math.max(1, Math.min(200, Math.floor(q.limit ?? 24)));
  const tokens = tokenize(q.text ?? '').slice(0, MAX_TOKENS);
  const exact = (q.text ?? '').trim().toLowerCase();
  const alts = tokens.map((t) => synonymsOf(t));
  const hits: AssetHit[] = [];
  for (const it of indexOf(catalog)) {
    if (!passes(it.entry, q)) continue;
    if (tokens.length === 0) {
      hits.push({ entry: it.entry, score: 1 });
      continue;
    }
    let score = it.id === exact ? 100 : 0;
    let matched = 0;
    for (let i = 0; i < tokens.length; i++) {
      const s = tokenScore(tokens[i]!, alts[i]!, it);
      if (s > 0) matched++;
      score += s;
    }
    if (matched < tokens.length && score < 100) continue;
    hits.push({ entry: it.entry, score });
  }
  hits.sort((a, b) => b.score - a.score || a.entry.tris - b.entry.tris || (a.entry.id < b.entry.id ? -1 : 1));
  return hits.length > limit ? hits.slice(0, limit) : hits;
}

/** Best single match for a noun phrase, or null. Used by the offline planner and furnishing. */
export function bestAsset(catalog: Catalog, text: string, filter: Omit<AssetQuery, 'text' | 'limit'> = {}): CatalogEntry | null {
  return searchAssets(catalog, { ...filter, text, limit: 1 })[0]?.entry ?? null;
}
