/**
 * Small fuzzy matcher for the command palette and project search. Scores a
 * query against a label: every query character must appear in order;
 * consecutive runs, word starts and an early first match score higher.
 * Pure and allocation-light (no regex built from user input).
 */

/** Longest query considered (longer input is truncated). */
export const MAX_QUERY = 64;

function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text.charCodeAt(i - 1);
  // space, dash, underscore, slash, dot, hash, colon
  return prev === 32 || prev === 45 || prev === 95 || prev === 47 || prev === 46 || prev === 35 || prev === 58;
}

/**
 * Score `query` against `text` (case-insensitive). Returns null when the
 * query is not a subsequence of the text; higher is better otherwise. An
 * empty query matches everything with score 0.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase().slice(0, MAX_QUERY);
  if (q === '') return 0;
  const t = text.toLowerCase();
  // Exact substring: best class of match, earlier is better.
  const sub = t.indexOf(q);
  if (sub >= 0) return 1000 - Math.min(sub, 200) + (isWordStart(t, sub) ? 200 : 0) + (q.length === t.length ? 300 : 0);
  let score = 0;
  let ti = 0;
  let run = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q.charCodeAt(qi);
    if (c === 32) {
      run = 0;
      continue;
    }
    let found = -1;
    while (ti < t.length) {
      if (t.charCodeAt(ti) === c) {
        found = ti;
        ti++;
        break;
      }
      ti++;
      run = 0;
    }
    if (found < 0) return null;
    run++;
    score += 1 + run * 2 + (isWordStart(t, found) ? 6 : 0);
  }
  return score;
}

/** Items of `items` matching `query`, best first (stable for equal scores). */
export function fuzzyFilter<T>(items: readonly T[], query: string, label: (item: T) => string, limit = 50): T[] {
  const scored: Array<{ item: T; score: number; index: number }> = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as T;
    const score = fuzzyScore(query, label(item));
    if (score !== null) scored.push({ item, score, index: i });
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, Math.max(0, limit)).map((s) => s.item);
}
