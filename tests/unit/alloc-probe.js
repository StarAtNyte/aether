/**
 * Allocation probe for unit tests: runs a hot loop under V8's sampling heap
 * profiler (through `node:inspector`, including objects that were already
 * collected) and reports the bytes allocated per iteration by functions
 * whose source URL matches a filter. Used to keep per-frame code paths free
 * of garbage.
 */
import { Session } from 'node:inspector/promises';
/**
 * Run `fn` `iterations` times (after `warmup` untimed runs) under the
 * sampling heap profiler and attribute allocations to sources matching `match`.
 */
export async function probeAllocations(fn, opts) {
    // Warm up long enough for the optimizing compiler: baseline code boxes doubles that optimized code keeps unboxed.
    const warmup = opts.warmup ?? 20_000;
    for (let i = 0; i < warmup; i++)
        fn();
    // Optimisation runs on a background thread: on a busy machine it may not have finished yet. Give it
    // time, then warm again so the installed optimized code (not baseline code) is what gets measured.
    await new Promise((r) => setTimeout(r, 50));
    for (let i = 0; i < Math.ceil(warmup / 4); i++)
        fn();
    const session = new Session();
    session.connect();
    try {
        await session.post('HeapProfiler.enable');
        await session.post('HeapProfiler.startSampling', {
            samplingInterval: opts.samplingInterval ?? 64,
            includeObjectsCollectedByMajorGC: true,
            includeObjectsCollectedByMinorGC: true,
        });
        for (let i = 0; i < opts.iterations; i++)
            fn();
        const { profile } = (await session.post('HeapProfiler.stopSampling'));
        const sites = new Map();
        const walk = (n) => {
            if (n.selfSize > 0 && opts.match.test(n.callFrame.url)) {
                const key = `${n.callFrame.url}:${n.callFrame.lineNumber}:${n.callFrame.functionName}`;
                const s = sites.get(key) ?? { fn: n.callFrame.functionName || '(anonymous)', url: n.callFrame.url.replace(/^.*\/(packages|apps)\//, '$1/'), line: n.callFrame.lineNumber + 1, bytes: 0 };
                s.bytes += n.selfSize;
                sites.set(key, s);
            }
            for (const c of n.children)
                walk(c);
        };
        walk(profile.head);
        const list = [...sites.values()].sort((a, b) => b.bytes - a.bytes);
        const total = list.reduce((t, s) => t + s.bytes, 0);
        return { bytesPerIteration: total / opts.iterations, sites: list.slice(0, 8) };
    }
    finally {
        await session.post('HeapProfiler.disable').catch(() => undefined);
        session.disconnect();
    }
}
/** Human-readable sites for assertion messages. */
export function describeSites(r) {
    return r.sites.map((s) => `${s.fn} ${s.url}:${s.line} ${s.bytes} B`).join('\n') || '(none)';
}
