/**
 * Offline planner support for the generator library: nouns the built-in
 * vocabulary does not know ("a lighthouse", "two pagodas") resolve to library
 * generators, placed like any procedural asset. The host defines the
 * generator in the world on first use (see `AgentOptions.resolveGenerator`).
 */
import type { Asset } from './lexicon';
import { parseCount, singular } from './lexicon';
import { r2, type Builder } from './builder';

/** A library generator the offline planner may place by name. */
export interface MockLibraryItem {
  id: string;
  /** Lower-case nouns ("lighthouse", "light house"). */
  keywords: readonly string[];
  /** Bounding size [w, h, d] in metres at default params. */
  size: readonly [number, number, number];
}

/** A library hit in free text. */
export interface LibraryHit {
  item: MockLibraryItem;
  /** The catalog keyword that matched (as written in the catalog). */
  keyword: string;
  /** Count written right before the noun ("three rockets" → 3), else 1. */
  count: number;
}

const MAX_HITS = 4;
const MAX_COUNT = 12;

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(singular);
}

/** Library items named in `text` (whole words, plural-insensitive, longest keyword wins, order of appearance). */
export function findLibraryItems(text: string, library: readonly MockLibraryItem[]): LibraryHit[] {
  if (library.length === 0) return [];
  const w = words(text);
  const joined = ` ${w.join(' ')} `;
  const hits: Array<LibraryHit & { at: number; len: number }> = [];
  for (const item of library) {
    let best: { at: number; kw: string; original: string } | null = null;
    for (const k of item.keywords) {
      const kw = words(k).join(' ');
      if (!kw) continue;
      const at = joined.indexOf(` ${kw} `);
      if (at >= 0 && (!best || kw.length > best.kw.length)) best = { at, kw, original: k.toLowerCase() };
    }
    if (!best) continue;
    const before = joined.slice(0, best.at).trim().split(' ').pop();
    const n = parseCount(before);
    hits.push({ item, keyword: best.original, count: Math.max(1, Math.min(MAX_COUNT, n ?? 1)), at: best.at, len: best.kw.length });
  }
  // Drop hits whose keyword sits inside a longer hit ("tank" inside "toy tank").
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.len > h.len && h.at >= o.at && h.at + h.len <= o.at + o.len));
  kept.sort((a, b) => a.at - b.at);
  return kept.slice(0, MAX_HITS).map(({ item, keyword, count }) => ({ item, keyword, count }));
}

/** Footprint radius (metres) of a library item. */
export function libraryRadius(item: MockLibraryItem): number {
  return r2(Math.max(0.4, Math.hypot(item.size[0], item.size[2]) / 2));
}

/** An {@link Asset} that places one instance of a library generator. */
export function libraryAsset(item: MockLibraryItem): Asset {
  const label = item.keywords[0] ?? item.id;
  return {
    label,
    radius: libraryRadius(item),
    make: (b: Builder, x: number, z: number, color?: string) =>
      b.gen(item.id, item.id, color ? { color } : {}, [x, 0, z], { yaw: r2(b.rand(-25, 25)), physics: 'static', tags: ['library'] }),
  };
}
