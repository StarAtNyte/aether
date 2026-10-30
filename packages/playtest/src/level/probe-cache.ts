/**
 * A one-entry cache of the walking map. Building it (a physics world, the bot's session and the navigation
 * grid) costs 2-3 s on a 300 m level, and the assistant asks several reach questions about the same world in a
 * row (review, objectives, reach, summary). The probe is kept for the same gameplay content for 30 s, then
 * disposed; a different world replaces it. Callers never dispose a cached probe.
 */
import type { WorldDoc } from '@aether/core';
import { probeLevel, type LevelProbe } from '../agent';
import { hashWorld } from '../proof';
import { hasLevelColliders } from './colliders';

/** How long an unused probe is kept (ms). */
export const PROBE_TTL_MS = 30_000;

interface Entry {
  key: string;
  probe: LevelProbe;
  timer: ReturnType<typeof setTimeout> | null;
}

let cached: Entry | null = null;
const stats = { builds: 0, hits: 0 };
/** Calls run one after the other: a probe is never replaced while a question about it is being answered. */
let chain: Promise<unknown> = Promise.resolve();

function drop(): void {
  if (!cached) return;
  if (cached.timer) clearTimeout(cached.timer);
  try {
    cached.probe.dispose();
  } catch {
    /* already gone */
  }
  cached = null;
}

/**
 * Run `fn` with the walking map of `world` (built once per distinct gameplay content, see
 * {@link PROBE_TTL_MS}). `fn` must not keep the probe after it returns.
 */
export function withProbe<T>(world: WorldDoc, fn: (probe: LevelProbe) => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const key = `${hashWorld(world)}${hasLevelColliders() ? '+c' : ''}`;
    if (cached && cached.key === key) {
      stats.hits++;
      if (cached.timer) clearTimeout(cached.timer);
    } else {
      drop();
      stats.builds++;
      cached = { key, probe: await probeLevel(world), timer: null };
    }
    const entry = cached;
    try {
      return await fn(entry.probe);
    } finally {
      if (cached === entry) {
        entry.timer = setTimeout(drop, PROBE_TTL_MS);
        // A pending timer must not keep a Node process alive.
        (entry.timer as { unref?: () => void }).unref?.();
      }
    }
  };
  const result = chain.then(run, run);
  chain = result.catch(() => undefined);
  return result;
}

/** How many walking maps were built and how many questions were answered from the cache (informational). */
export function probeCacheStats(): { builds: number; hits: number } {
  return { ...stats };
}

/** Dispose the cached probe now (tests, shutdown). */
export function clearProbeCache(): void {
  drop();
}
