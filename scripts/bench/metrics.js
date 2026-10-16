/**
 * Pure metric code of the benchmark: token estimates, statistics, JSON leaf
 * diffs and the collateral-change accounting that compares a minimal patch
 * against a regenerated world. No I/O and no physics, so every function here
 * is unit-tested (`metrics.test.ts`).
 */
import { stableStringify } from '@aether/core';
/** Token estimate shared with the offline provider: one token per four characters. */
export function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
/** Estimated tokens of a JSON value in its canonical serialisation. */
export function jsonTokens(value) {
    return estimateTokens(stableStringify(value));
}
/** Arithmetic mean (0 for an empty list). */
export function mean(xs) {
    return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}
/** Linear-interpolated percentile `p` in [0, 100] (0 for an empty list). */
export function percentile(xs, p) {
    if (xs.length === 0)
        return 0;
    const sorted = [...xs].sort((a, b) => a - b);
    const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    const a = sorted[lo];
    const b = sorted[hi];
    return a + (b - a) * (rank - lo);
}
/** Median (50th percentile). */
export function median(xs) {
    return percentile(xs, 50);
}
/**
 * `k` successes out of `n` with the Wilson 95 % interval (well behaved for
 * small n and for rates near 0 or 1, unlike the normal approximation).
 */
export function rate(k, n) {
    if (n <= 0)
        return { k: 0, n: 0, rate: 0, lo: 0, hi: 0 };
    const z = 1.959964;
    const p = k / n;
    const denom = 1 + (z * z) / n;
    const centre = (p + (z * z) / (2 * n)) / denom;
    const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
    return { k, n, rate: p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}
/** "37/48 (77%, 95% CI 63-87%)". */
export function formatRate(r) {
    if (r.n === 0)
        return 'n/a (0 samples)';
    return `${r.k}/${r.n} (${(r.rate * 100).toFixed(0)}%, 95% CI ${(r.lo * 100).toFixed(0)}-${(r.hi * 100).toFixed(0)}%)`;
}
/** Simulated seconds per wall second (0 when no time elapsed). */
export function realtimeMultiple(simulatedSeconds, wallMs) {
    return wallMs > 0 ? simulatedSeconds / (wallMs / 1000) : 0;
}
/** Round to `digits` decimals. */
export function round(v, digits = 1) {
    const f = 10 ** digits;
    return Math.round(v * f) / f;
}
const PATH_SEP = '.';
/**
 * Flatten a JSON value to `path -> leaf` (objects by key, arrays by index,
 * `null` and primitives are leaves; empty containers are leaves too so that
 * "became empty" is visible). Capped at `max` leaves.
 */
export function leaves(value, max = 200_000) {
    const out = new Map();
    const walk = (v, path) => {
        if (out.size >= max || v === undefined)
            return;
        if (Array.isArray(v)) {
            if (v.length === 0)
                out.set(path, v);
            v.forEach((x, i) => walk(x, path ? `${path}${PATH_SEP}${i}` : String(i)));
        }
        else if (v !== null && typeof v === 'object') {
            const keys = Object.keys(v);
            if (keys.length === 0)
                out.set(path, v);
            for (const k of keys)
                walk(v[k], path ? `${path}${PATH_SEP}${k}` : k);
        }
        else
            out.set(path, v);
    };
    walk(value, '');
    return out;
}
/** Leaf paths whose value differs (added, removed or modified) between `a` and `b`. */
export function changedLeaves(a, b) {
    const la = leaves(a);
    const lb = leaves(b);
    const out = [];
    for (const [k, v] of la)
        if (!lb.has(k) || stableStringify(lb.get(k)) !== stableStringify(v))
            out.push(k);
    for (const k of lb.keys())
        if (!la.has(k))
            out.push(k);
    return out.sort();
}
const SECTION_KEYS = [
    ['environment', (w) => w.environment],
    ['player', (w) => w.player],
    ['rules', (w) => w.rules],
    ['state', (w) => w.state],
    ['hud', (w) => w.hud],
    ['tests', (w) => w.tests],
    ['generators', (w) => w.generators],
    ['scripts', (w) => w.scripts],
    ['meta', (w) => ({ name: w.name, description: w.description, seed: w.seed, intro: w.intro ?? null })],
    ['voxel', (w) => (w.voxel ?? null)],
];
/** Compare two worlds leaf by leaf (entities by id, other sections wholesale). */
export function worldChanges(before, after) {
    const added = [];
    const removed = [];
    const modified = {};
    const eb = before.entities;
    const ea = after.entities;
    for (const id of Object.keys(ea)) {
        if (!Object.hasOwn(eb, id))
            added.push(id);
        else if (eb[id] !== ea[id]) {
            const paths = changedLeaves(eb[id], ea[id]);
            if (paths.length > 0)
                modified[id] = paths;
        }
    }
    for (const id of Object.keys(eb))
        if (!Object.hasOwn(ea, id))
            removed.push(id);
    const sections = {};
    for (const [name, pick] of SECTION_KEYS) {
        const paths = changedLeaves(pick(before), pick(after));
        if (paths.length > 0)
            sections[name] = paths;
    }
    return { added: added.sort(), removed: removed.sort(), modified, sections };
}
const anyMatch = (patterns, path) => (patterns ?? []).some((p) => p.test(path));
/**
 * Score a change against its intent: was the requested change made, and how
 * much else moved? Added entities count as intended only up to what
 * `expectAdded` asks for; with no `expectAdded`, every added entity is
 * collateral. A leaf of an entity counts as requested when the entity is a
 * target and the path matches `allowedPaths`.
 */
export function scoreChange(changes, intent) {
    const targets = new Set(intent.targets);
    const expectRemoved = new Set(intent.expectRemoved ?? []);
    let collateralLeaves = 0;
    let totalLeaves = 0;
    const badEntities = new Set();
    const examples = [];
    const note = (s) => {
        if (examples.length < 4)
            examples.push(s);
    };
    for (const [id, paths] of Object.entries(changes.modified)) {
        totalLeaves += paths.length;
        for (const p of paths) {
            if (targets.has(id) && anyMatch(intent.allowedPaths, p))
                continue;
            collateralLeaves++;
            badEntities.add(id);
            note(`${id}:${p}`);
        }
    }
    let collateralRemoved = 0;
    for (const id of changes.removed) {
        totalLeaves++;
        if (expectRemoved.has(id))
            continue;
        collateralRemoved++;
        badEntities.add(id);
        note(`removed ${id}`);
    }
    let collateralAdded = 0;
    const matching = intent.expectAdded ? changes.added.filter((id) => intent.expectAdded.match.test(id)) : [];
    for (const id of changes.added) {
        totalLeaves++;
        if (intent.expectAdded?.match.test(id))
            continue;
        collateralAdded++;
        badEntities.add(id);
        note(`added ${id}`);
    }
    const sectionsRequired = new Set(intent.requireSections ?? []);
    let sectionsOk = true;
    for (const [name, paths] of Object.entries(changes.sections)) {
        totalLeaves += paths.length;
        for (const p of paths) {
            if (anyMatch(intent.allowedSections?.[name], p))
                continue;
            collateralLeaves++;
            note(`${name}:${p}`);
        }
    }
    for (const name of sectionsRequired)
        if (!changes.sections[name])
            sectionsOk = false;
    collateralLeaves += collateralRemoved + collateralAdded;
    const removedOk = [...expectRemoved].every((id) => changes.removed.includes(id));
    const addedOk = intent.expectAdded ? matching.length >= intent.expectAdded.min : true;
    const wantsModify = targets.size > 0 && (intent.allowedPaths?.length ?? 0) > 0;
    const modifyOk = !wantsModify || [...targets].every((id) => (changes.modified[id] ?? []).some((p) => anyMatch(intent.allowedPaths, p)));
    const hasRequirement = wantsModify || expectRemoved.size > 0 || intent.expectAdded !== undefined || sectionsRequired.size > 0;
    const satisfied = hasRequirement && removedOk && addedOk && modifyOk && sectionsOk;
    // How much of the request was done: the weakest requirement decides.
    const parts = [];
    if (wantsModify)
        parts.push([...targets].filter((id) => (changes.modified[id] ?? []).some((p) => anyMatch(intent.allowedPaths, p))).length / targets.size);
    if (expectRemoved.size > 0)
        parts.push([...expectRemoved].filter((id) => changes.removed.includes(id)).length / expectRemoved.size);
    if (intent.expectAdded)
        parts.push(Math.min(1, matching.length / Math.max(1, intent.expectAdded.min)));
    if (sectionsRequired.size > 0)
        parts.push([...sectionsRequired].filter((n) => changes.sections[n]).length / sectionsRequired.size);
    const completion = parts.length > 0 ? Math.min(...parts) : 0;
    return { satisfied, completion, collateralLeaves, collateralEntities: badEntities.size, collateralRemoved, collateralAdded, totalLeaves, examples };
}
/** A regression: it worked before the edit and does not afterwards. */
export function isRegression(v) {
    return v.before && !v.after;
}
/** A fix: it did not work before and does afterwards. */
export function isFix(v) {
    return !v.before && v.after;
}
/**
 * Projected end-to-end latency (ms) of a model path: local compute that was
 * measured plus the time a hosted model needs to emit `outputTokens` at an
 * assumed `tokensPerSecond`. The rate is an assumption, stated in the report;
 * only the local part is measured.
 */
export function projectedLatencyMs(localMs, outputTokens, tokensPerSecond) {
    return localMs + (tokensPerSecond > 0 ? (outputTokens / tokensPerSecond) * 1000 : 0);
}
