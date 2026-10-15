/**
 * Pure metric code of the benchmark: token estimates, statistics, JSON leaf
 * diffs and the collateral-change accounting that compares a minimal patch
 * against a regenerated world. No I/O and no physics, so every function here
 * is unit-tested (`metrics.test.ts`).
 */
import { stableStringify, type Json, type WorldDoc } from '@aether/core';

/** Token estimate shared with the offline provider: one token per four characters. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimated tokens of a JSON value in its canonical serialisation. */
export function jsonTokens(value: unknown): number {
  return estimateTokens(stableStringify(value));
}

/** Arithmetic mean (0 for an empty list). */
export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Linear-interpolated percentile `p` in [0, 100] (0 for an empty list). */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (rank - lo);
}

/** Median (50th percentile). */
export function median(xs: readonly number[]): number {
  return percentile(xs, 50);
}

/** A rate with its sample size and a 95 % Wilson score interval. */
export interface Rate {
  k: number;
  n: number;
  /** k / n, or 0 when n is 0. */
  rate: number;
  lo: number;
  hi: number;
}

/**
 * `k` successes out of `n` with the Wilson 95 % interval (well behaved for
 * small n and for rates near 0 or 1, unlike the normal approximation).
 */
export function rate(k: number, n: number): Rate {
  if (n <= 0) return { k: 0, n: 0, rate: 0, lo: 0, hi: 0 };
  const z = 1.959964;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { k, n, rate: p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** "37/48 (77%, 95% CI 63-87%)". */
export function formatRate(r: Rate): string {
  if (r.n === 0) return 'n/a (0 samples)';
  return `${r.k}/${r.n} (${(r.rate * 100).toFixed(0)}%, 95% CI ${(r.lo * 100).toFixed(0)}-${(r.hi * 100).toFixed(0)}%)`;
}

/** Simulated seconds per wall second (0 when no time elapsed). */
export function realtimeMultiple(simulatedSeconds: number, wallMs: number): number {
  return wallMs > 0 ? simulatedSeconds / (wallMs / 1000) : 0;
}

/** Round to `digits` decimals. */
export function round(v: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

const PATH_SEP = '.';

/**
 * Flatten a JSON value to `path -> leaf` (objects by key, arrays by index,
 * `null` and primitives are leaves; empty containers are leaves too so that
 * "became empty" is visible). Capped at `max` leaves.
 */
export function leaves(value: Json | undefined, max = 200_000): Map<string, Json> {
  const out = new Map<string, Json>();
  const walk = (v: Json | undefined, path: string): void => {
    if (out.size >= max || v === undefined) return;
    if (Array.isArray(v)) {
      if (v.length === 0) out.set(path, v);
      v.forEach((x, i) => walk(x, path ? `${path}${PATH_SEP}${i}` : String(i)));
    } else if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length === 0) out.set(path, v);
      for (const k of keys) walk((v as Record<string, Json>)[k], path ? `${path}${PATH_SEP}${k}` : k);
    } else out.set(path, v);
  };
  walk(value, '');
  return out;
}

/** Leaf paths whose value differs (added, removed or modified) between `a` and `b`. */
export function changedLeaves(a: Json | undefined, b: Json | undefined): string[] {
  const la = leaves(a);
  const lb = leaves(b);
  const out: string[] = [];
  for (const [k, v] of la) if (!lb.has(k) || stableStringify(lb.get(k) as Json) !== stableStringify(v)) out.push(k);
  for (const k of lb.keys()) if (!la.has(k)) out.push(k);
  return out.sort();
}

/** World sections other than entities that a change can touch. */
export type WorldSection = 'environment' | 'player' | 'rules' | 'state' | 'hud' | 'tests' | 'generators' | 'scripts' | 'meta' | 'voxel';

/** What differs between two worlds, as leaf paths. */
export interface WorldChanges {
  added: string[];
  removed: string[];
  /** Entity id -> changed leaf paths (entity-relative, e.g. `transform.scale.0`). */
  modified: Record<string, string[]>;
  /** Section -> changed leaf paths (section-relative). */
  sections: Partial<Record<WorldSection, string[]>>;
}

const SECTION_KEYS: ReadonlyArray<readonly [WorldSection, (w: WorldDoc) => Json]> = [
  ['environment', (w) => w.environment as unknown as Json],
  ['player', (w) => w.player as unknown as Json],
  ['rules', (w) => w.rules as unknown as Json],
  ['state', (w) => w.state as unknown as Json],
  ['hud', (w) => w.hud as unknown as Json],
  ['tests', (w) => w.tests as unknown as Json],
  ['generators', (w) => w.generators as unknown as Json],
  ['scripts', (w) => w.scripts as unknown as Json],
  ['meta', (w) => ({ name: w.name, description: w.description, seed: w.seed, intro: w.intro ?? null }) as unknown as Json],
  ['voxel', (w) => (w.voxel ?? null) as unknown as Json],
];

/** Compare two worlds leaf by leaf (entities by id, other sections wholesale). */
export function worldChanges(before: WorldDoc, after: WorldDoc): WorldChanges {
  const added: string[] = [];
  const removed: string[] = [];
  const modified: Record<string, string[]> = {};
  const eb = before.entities;
  const ea = after.entities;
  for (const id of Object.keys(ea)) {
    if (!Object.hasOwn(eb, id)) added.push(id);
    else if (eb[id] !== ea[id]) {
      const paths = changedLeaves(eb[id] as unknown as Json, ea[id] as unknown as Json);
      if (paths.length > 0) modified[id] = paths;
    }
  }
  for (const id of Object.keys(eb)) if (!Object.hasOwn(ea, id)) removed.push(id);
  const sections: Partial<Record<WorldSection, string[]>> = {};
  for (const [name, pick] of SECTION_KEYS) {
    const paths = changedLeaves(pick(before), pick(after));
    if (paths.length > 0) sections[name] = paths;
  }
  return { added: added.sort(), removed: removed.sort(), modified, sections };
}

/**
 * What an edit request is allowed to change (the oracle for collateral).
 * Everything outside it that differs afterwards is collateral.
 */
export interface EditIntent {
  /** Entities the request is about (modify/remove). Empty for add and environment edits. */
  targets: readonly string[];
  /** Entity-relative leaf path patterns the request may change on a target. */
  allowedPaths?: readonly RegExp[];
  /** Entities that must disappear. */
  expectRemoved?: readonly string[];
  /** Minimum number of new entities (added) whose id or tags match `addMatch`. */
  expectAdded?: { min: number; match: RegExp };
  /** Whole sections the request may rewrite, with an allowed-path pattern per section. */
  allowedSections?: Partial<Record<WorldSection, readonly RegExp[]>>;
  /** Sections whose change is required for the edit to count as done. */
  requireSections?: readonly WorldSection[];
}

/** Outcome of comparing a world change with an {@link EditIntent}. */
export interface CollateralReport {
  /** The requested change happened. */
  satisfied: boolean;
  /** Fraction of the request that was done (1 when satisfied; e.g. 0.5 when half of the named objects changed). */
  completion: number;
  /** Changed leaves that the request did not ask for (entities, sections). */
  collateralLeaves: number;
  /** Distinct entities with at least one unrequested change (modified, removed or added). */
  collateralEntities: number;
  /** Entities removed that were not meant to go. */
  collateralRemoved: number;
  /** Entities added that were not meant to appear. */
  collateralAdded: number;
  /** Total changed leaves (requested and not) — the churn. */
  totalLeaves: number;
  /** A few offending paths, for the report. */
  examples: string[];
}

const anyMatch = (patterns: readonly RegExp[] | undefined, path: string): boolean => (patterns ?? []).some((p) => p.test(path));

/**
 * Score a change against its intent: was the requested change made, and how
 * much else moved? Added entities count as intended only up to what
 * `expectAdded` asks for; with no `expectAdded`, every added entity is
 * collateral. A leaf of an entity counts as requested when the entity is a
 * target and the path matches `allowedPaths`.
 */
export function scoreChange(changes: WorldChanges, intent: EditIntent): CollateralReport {
  const targets = new Set(intent.targets);
  const expectRemoved = new Set(intent.expectRemoved ?? []);
  let collateralLeaves = 0;
  let totalLeaves = 0;
  const badEntities = new Set<string>();
  const examples: string[] = [];
  const note = (s: string): void => {
    if (examples.length < 4) examples.push(s);
  };

  for (const [id, paths] of Object.entries(changes.modified)) {
    totalLeaves += paths.length;
    for (const p of paths) {
      if (targets.has(id) && anyMatch(intent.allowedPaths, p)) continue;
      collateralLeaves++;
      badEntities.add(id);
      note(`${id}:${p}`);
    }
  }

  let collateralRemoved = 0;
  for (const id of changes.removed) {
    totalLeaves++;
    if (expectRemoved.has(id)) continue;
    collateralRemoved++;
    badEntities.add(id);
    note(`removed ${id}`);
  }

  let collateralAdded = 0;
  const matching = intent.expectAdded ? changes.added.filter((id) => (intent.expectAdded as { match: RegExp }).match.test(id)) : [];
  for (const id of changes.added) {
    totalLeaves++;
    if (intent.expectAdded?.match.test(id)) continue;
    collateralAdded++;
    badEntities.add(id);
    note(`added ${id}`);
  }

  const sectionsRequired = new Set(intent.requireSections ?? []);
  let sectionsOk = true;
  for (const [name, paths] of Object.entries(changes.sections) as Array<[WorldSection, string[]]>) {
    totalLeaves += paths.length;
    for (const p of paths) {
      if (anyMatch(intent.allowedSections?.[name], p)) continue;
      collateralLeaves++;
      note(`${name}:${p}`);
    }
  }
  for (const name of sectionsRequired) if (!changes.sections[name]) sectionsOk = false;

  collateralLeaves += collateralRemoved + collateralAdded;

  const removedOk = [...expectRemoved].every((id) => changes.removed.includes(id));
  const addedOk = intent.expectAdded ? matching.length >= intent.expectAdded.min : true;
  const wantsModify = targets.size > 0 && (intent.allowedPaths?.length ?? 0) > 0;
  const modifyOk = !wantsModify || [...targets].every((id) => (changes.modified[id] ?? []).some((p) => anyMatch(intent.allowedPaths, p)));
  const hasRequirement = wantsModify || expectRemoved.size > 0 || intent.expectAdded !== undefined || sectionsRequired.size > 0;
  const satisfied = hasRequirement && removedOk && addedOk && modifyOk && sectionsOk;
  // How much of the request was done: the weakest requirement decides.
  const parts: number[] = [];
  if (wantsModify) parts.push([...targets].filter((id) => (changes.modified[id] ?? []).some((p) => anyMatch(intent.allowedPaths, p))).length / targets.size);
  if (expectRemoved.size > 0) parts.push([...expectRemoved].filter((id) => changes.removed.includes(id)).length / expectRemoved.size);
  if (intent.expectAdded) parts.push(Math.min(1, matching.length / Math.max(1, intent.expectAdded.min)));
  if (sectionsRequired.size > 0) parts.push([...sectionsRequired].filter((n) => changes.sections[n]).length / sectionsRequired.size);
  const completion = parts.length > 0 ? Math.min(...parts) : 0;

  return { satisfied, completion, collateralLeaves, collateralEntities: badEntities.size, collateralRemoved, collateralAdded, totalLeaves, examples };
}

/** Verification verdicts around an edit. */
export interface VerdictPair {
  before: boolean;
  after: boolean;
}

/** A regression: it worked before the edit and does not afterwards. */
export function isRegression(v: VerdictPair): boolean {
  return v.before && !v.after;
}

/** A fix: it did not work before and does afterwards. */
export function isFix(v: VerdictPair): boolean {
  return !v.before && v.after;
}

/**
 * Projected end-to-end latency (ms) of a model path: local compute that was
 * measured plus the time a hosted model needs to emit `outputTokens` at an
 * assumed `tokensPerSecond`. The rate is an assumption, stated in the report;
 * only the local part is measured.
 */
export function projectedLatencyMs(localMs: number, outputTokens: number, tokensPerSecond: number): number {
  return localMs + (tokensPerSecond > 0 ? (outputTokens / tokensPerSecond) * 1000 : 0);
}
