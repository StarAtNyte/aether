import { probeLevel } from '../agent';
import { hashWorld } from '../proof';
/** How long an unused probe is kept (ms). */
export const PROBE_TTL_MS = 30_000;
let cached = null;
const stats = { builds: 0, hits: 0 };
/** Calls run one after the other: a probe is never replaced while a question about it is being answered. */
let chain = Promise.resolve();
function drop() {
    if (!cached)
        return;
    if (cached.timer)
        clearTimeout(cached.timer);
    try {
        cached.probe.dispose();
    }
    catch {
        /* already gone */
    }
    cached = null;
}
/**
 * Run `fn` with the walking map of `world` (built once per distinct gameplay content, see
 * {@link PROBE_TTL_MS}). `fn` must not keep the probe after it returns.
 */
export function withProbe(world, fn) {
    const run = async () => {
        const key = hashWorld(world);
        if (cached && cached.key === key) {
            stats.hits++;
            if (cached.timer)
                clearTimeout(cached.timer);
        }
        else {
            drop();
            stats.builds++;
            cached = { key, probe: await probeLevel(world), timer: null };
        }
        const entry = cached;
        try {
            return await fn(entry.probe);
        }
        finally {
            if (cached === entry) {
                entry.timer = setTimeout(drop, PROBE_TTL_MS);
                // A pending timer must not keep a Node process alive.
                entry.timer.unref?.();
            }
        }
    };
    const result = chain.then(run, run);
    chain = result.catch(() => undefined);
    return result;
}
/** How many walking maps were built and how many questions were answered from the cache (informational). */
export function probeCacheStats() {
    return { ...stats };
}
/** Dispose the cached probe now (tests, shutdown). */
export function clearProbeCache() {
    drop();
}
