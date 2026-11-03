/**
 * Best scores kept on this device, per world: a game whose world state has a numeric `score` shows the final score
 * and the best one on its end screen. Stored in localStorage (bounded); without storage the best is this run's.
 */
const KEY = 'aether.best.v1';
/** Most worlds remembered (the oldest are dropped). */
const MAX_WORLDS = 64;

type Table = Record<string, { best: number; at: number }>;

function read(storage: Storage | null): Table {
  if (!storage) return {};
  try {
    const raw = storage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Table) : {};
  } catch {
    return {};
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Record a finished run's `score` for `world` (an id or name). Returns the best score after it and whether this run
 * set it. Non-finite scores are ignored (best 0).
 */
export function recordScore(world: string, score: number, storage: Storage | null = defaultStorage()): { best: number; record: boolean } {
  if (!Number.isFinite(score)) return { best: 0, record: false };
  const key = world.slice(0, 120) || 'world';
  const table = read(storage);
  const prev = table[key];
  const prevBest = prev && Number.isFinite(prev.best) ? prev.best : Number.NEGATIVE_INFINITY;
  const record = score > prevBest && score > 0;
  const best = Math.max(score, Number.isFinite(prevBest) ? prevBest : score);
  table[key] = { best, at: Date.now() };
  const keys = Object.keys(table);
  if (keys.length > MAX_WORLDS) {
    keys.sort((a, b) => (table[a]?.at ?? 0) - (table[b]?.at ?? 0));
    for (const k of keys.slice(0, keys.length - MAX_WORLDS)) delete table[k];
  }
  try {
    storage?.setItem(KEY, JSON.stringify(table));
  } catch {
    // Storage full or blocked: the best of this session still shows.
  }
  return { best, record };
}
