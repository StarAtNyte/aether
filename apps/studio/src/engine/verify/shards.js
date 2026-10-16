/** Minimum total simulated seconds before splitting pays for a second world build. */
export const MIN_PARALLEL_SECONDS = 3;
/** Simulated seconds a test needs at most (its horizon), capped by `maxSeconds`. */
export function testHorizon(test, maxSeconds) {
    switch (test.kind) {
        case 'noOverlap':
        case 'navigable':
            return 0;
        case 'stable':
        case 'npcs':
            return Math.min(maxSeconds, test.seconds);
        default:
            return Math.min(maxSeconds, test.within);
    }
}
/**
 * Plan shards for `lanes` workers. Returns a single shard (all tests plus
 * diagnostics) when there is one lane, fewer than two tests or too little
 * simulation to be worth a second world build.
 */
export function planShards(tests, lanes, maxSeconds) {
    const all = tests.map((_, i) => i);
    const weights = tests.map((t) => testHorizon(t, maxSeconds));
    const total = weights.reduce((a, b) => a + b, 0);
    const n = Math.max(1, Math.min(Math.floor(lanes), tests.length));
    if (n < 2 || total < MIN_PARALLEL_SECONDS)
        return [{ tests: all, diagnostics: true, load: total }];
    const shards = Array.from({ length: n }, () => ({ tests: [], diagnostics: false, load: 0 }));
    const order = all.slice().sort((a, b) => weights[b] - weights[a] || a - b);
    for (const i of order) {
        let best = shards[0];
        for (const s of shards)
            if (s.load < best.load || (s.load === best.load && s.tests.length < best.tests.length))
                best = s;
        best.tests.push(i);
        best.load += weights[i];
    }
    const used = shards.filter((s) => s.tests.length > 0);
    for (const s of used)
        s.tests.sort((a, b) => a - b);
    let lightest = used[0];
    for (const s of used)
        if (s.load < lightest.load)
            lightest = s;
    lightest.diagnostics = true;
    return used;
}
/**
 * Merge shard reports into one report over all `testCount` tests (results
 * in `world.tests` order). Tests no shard reported become failed results.
 */
export function mergeShardReports(tests, shards) {
    const byIndex = new Map();
    const diagnostics = [];
    let simulatedSeconds = 0;
    let ms = 0;
    for (const s of shards) {
        const indices = s.report.testIndices ?? s.tests;
        indices.forEach((testIndex, k) => {
            const r = s.report.results[k];
            if (r && Number.isInteger(testIndex) && testIndex >= 0 && testIndex < tests.length)
                byIndex.set(testIndex, r);
        });
        diagnostics.push(...s.report.diagnostics);
        simulatedSeconds = Math.max(simulatedSeconds, s.report.simulatedSeconds);
        ms = Math.max(ms, s.report.ms);
    }
    const results = tests.map((t, i) => byIndex.get(i) ?? { id: t.id, kind: t.kind, passed: false, message: 'not decided: no verification result' });
    const passed = results.every((r) => r.passed) && !diagnostics.some((d) => d.severity === 'error');
    const merged = { passed, results, diagnostics, simulatedSeconds, ms };
    // At most one shard records the motion trace (see VerifyPool); keep the first one found.
    const trace = shards.find((s) => s.report.trace)?.report.trace;
    if (trace)
        merged.trace = trace;
    return merged;
}
/** Maximum verification workers. */
export const MAX_VERIFY_LANES = 2;
/**
 * Worker lanes this device can afford: 2 on machines with at least four
 * logical cores and more than 4 GB of memory (unknown memory counts as
 * enough, e.g. Firefox and Safari do not report it), otherwise 1.
 * Low-memory mode always uses one lane.
 */
export function verifyLanes(s) {
    if (s.lowMemory)
        return 1;
    const cores = typeof s.hardwareConcurrency === 'number' && Number.isFinite(s.hardwareConcurrency) ? s.hardwareConcurrency : 2;
    if (cores < 4)
        return 1;
    if (typeof s.deviceMemory === 'number' && Number.isFinite(s.deviceMemory) && s.deviceMemory <= 4)
        return 1;
    return MAX_VERIFY_LANES;
}
