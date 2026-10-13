/**
 * Allocation probe for unit tests: runs a hot loop under V8's sampling heap
 * profiler (through `node:inspector`, including objects that were already
 * collected) and reports the bytes allocated per iteration by functions
 * whose source URL matches a filter. Used to keep per-frame code paths free
 * of garbage.
 */
import { Session } from 'node:inspector/promises';

/** One allocation site. */
export interface AllocationSite {
  fn: string;
  url: string;
  line: number;
  bytes: number;
}

/** Result of {@link probeAllocations}. */
export interface AllocationReport {
  /** Sampled bytes per iteration attributed to matching functions. */
  bytesPerIteration: number;
  /** The largest matching sites (for failure messages). */
  sites: AllocationSite[];
}

interface ProfileNode {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: ProfileNode[];
}

/**
 * Run `fn` `iterations` times (after `warmup` untimed runs) under the
 * sampling heap profiler and attribute allocations to sources matching `match`.
 */
export async function probeAllocations(fn: () => void, opts: { iterations: number; warmup?: number; match: RegExp; samplingInterval?: number }): Promise<AllocationReport> {
  // Warm up long enough for the optimizing compiler: baseline code boxes doubles that optimized code keeps unboxed.
  for (let i = 0; i < (opts.warmup ?? 20_000); i++) fn();
  const session = new Session();
  session.connect();
  try {
    await session.post('HeapProfiler.enable');
    await session.post('HeapProfiler.startSampling', {
      samplingInterval: opts.samplingInterval ?? 64,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    } as never);
    for (let i = 0; i < opts.iterations; i++) fn();
    const { profile } = (await session.post('HeapProfiler.stopSampling')) as unknown as { profile: { head: ProfileNode } };
    const sites = new Map<string, AllocationSite>();
    const walk = (n: ProfileNode): void => {
      if (n.selfSize > 0 && opts.match.test(n.callFrame.url)) {
        const key = `${n.callFrame.url}:${n.callFrame.lineNumber}:${n.callFrame.functionName}`;
        const s = sites.get(key) ?? { fn: n.callFrame.functionName || '(anonymous)', url: n.callFrame.url.replace(/^.*\/(packages|apps)\//, '$1/'), line: n.callFrame.lineNumber + 1, bytes: 0 };
        s.bytes += n.selfSize;
        sites.set(key, s);
      }
      for (const c of n.children) walk(c);
    };
    walk(profile.head);
    const list = [...sites.values()].sort((a, b) => b.bytes - a.bytes);
    const total = list.reduce((t, s) => t + s.bytes, 0);
    return { bytesPerIteration: total / opts.iterations, sites: list.slice(0, 8) };
  } finally {
    await session.post('HeapProfiler.disable').catch(() => undefined);
    session.disconnect();
  }
}

/** Human-readable sites for assertion messages. */
export function describeSites(r: AllocationReport): string {
  return r.sites.map((s) => `${s.fn} ${s.url}:${s.line} ${s.bytes} B`).join('\n') || '(none)';
}
