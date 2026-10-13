/**
 * Memory budgets of the studio and the low-memory mode decision. Pure
 * functions plus one browser probe ({@link readMemorySignals}) that only
 * feature-detects: `navigator.deviceMemory` and `performance.memory` exist
 * in Chromium only, so on Firefox and Safari the automatic mode relies on
 * context-loss signals and the user's choice.
 */
import type { LowMemorySetting } from './storage';

/** History entries kept per branch normally / in low-memory mode. */
export const HISTORY_ENTRIES = { normal: 150, low: 40 } as const;
/** Device memory (GB, as reported by `navigator.deviceMemory`) at or below which low-memory mode turns on. */
export const LOW_DEVICE_MEMORY_GB = 4;
/** JS heap use, as a fraction of the heap limit, treated as memory pressure. */
export const HEAP_PRESSURE_RATIO = 0.7;
/** Absolute JS heap use treated as memory pressure (the studio's steady state is far below). */
export const HEAP_PRESSURE_BYTES = 600 * 1024 * 1024;
/** How often memory pressure is sampled (ms). */
export const MEMORY_SAMPLE_MS = 10_000;
/** Renderer restarts (context-loss recoveries) allowed within {@link RECOVERY_WINDOW_MS}. */
export const MAX_RECOVERIES = 3;
/** Window of {@link MAX_RECOVERIES} (ms). */
export const RECOVERY_WINDOW_MS = 120_000;

/** Signals that feed the automatic low-memory decision. */
export interface MemorySignals {
  /** `navigator.deviceMemory` (GB, rounded down by the browser), when exposed. */
  deviceMemoryGB?: number;
  /** `performance.memory.usedJSHeapSize`, when exposed. */
  heapUsedBytes?: number;
  /** `performance.memory.jsHeapSizeLimit`, when exposed. */
  heapLimitBytes?: number;
  /** GPU contexts lost in this session. */
  contextLosses?: number;
  /** Heap pressure was observed earlier in this session (latched so the mode does not flap). */
  pressure?: boolean;
}

/** Outcome of {@link decideLowMemory}. */
export interface LowMemoryDecision {
  on: boolean;
  /** Why it is on (shown to the user), null when off. */
  reason: string | null;
  /** True when the decision came from detection rather than the setting. */
  automatic: boolean;
}

function finitePositive(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** True when the JS heap signals memory pressure. */
export function heapUnderPressure(s: MemorySignals): boolean {
  const used = finitePositive(s.heapUsedBytes);
  if (used === undefined) return false;
  const limit = finitePositive(s.heapLimitBytes);
  return used >= HEAP_PRESSURE_BYTES || (limit !== undefined && used / limit >= HEAP_PRESSURE_RATIO);
}

/**
 * Decide whether low-memory mode is on. 'on' / 'off' are the user's word;
 * 'auto' turns it on for small devices (≤ 4 GB), under JS heap pressure or
 * after a lost GPU context.
 */
export function decideLowMemory(setting: LowMemorySetting, s: MemorySignals): LowMemoryDecision {
  if (setting === 'on') return { on: true, reason: 'Turned on in Settings', automatic: false };
  if (setting === 'off') return { on: false, reason: null, automatic: false };
  const device = finitePositive(s.deviceMemoryGB);
  if (device !== undefined && device <= LOW_DEVICE_MEMORY_GB) return { on: true, reason: `This device reports ${device} GB of memory`, automatic: true };
  if (s.pressure === true || heapUnderPressure(s)) return { on: true, reason: 'Memory pressure detected', automatic: true };
  if ((s.contextLosses ?? 0) > 0) return { on: true, reason: 'The graphics context was lost', automatic: true };
  return { on: false, reason: null, automatic: true };
}

/** Read the browser's memory signals (feature-detected; missing values are omitted). */
export function readMemorySignals(): MemorySignals {
  const out: MemorySignals = {};
  try {
    const nav = typeof navigator === 'undefined' ? undefined : (navigator as unknown as { deviceMemory?: unknown });
    const device = finitePositive(nav?.deviceMemory);
    if (device !== undefined) out.deviceMemoryGB = device;
    const perf = typeof performance === 'undefined' ? undefined : (performance as unknown as { memory?: { usedJSHeapSize?: unknown; jsHeapSizeLimit?: unknown } });
    const used = finitePositive(perf?.memory?.usedJSHeapSize);
    const limit = finitePositive(perf?.memory?.jsHeapSizeLimit);
    if (used !== undefined) out.heapUsedBytes = used;
    if (limit !== undefined) out.heapLimitBytes = limit;
  } catch {
    // Signals are best effort.
  }
  return out;
}

/**
 * Sliding-window limiter for renderer recoveries: a GPU that keeps resetting
 * must end in a clear error instead of an endless restart loop.
 */
export class RecoveryLimiter {
  private readonly times: number[] = [];

  constructor(
    private readonly max = MAX_RECOVERIES,
    private readonly windowMs = RECOVERY_WINDOW_MS,
  ) {}

  /** Record an attempt at `now` (ms); false when the budget is exhausted. */
  tryAcquire(now: number): boolean {
    while (this.times.length > 0 && now - (this.times[0] as number) > this.windowMs) this.times.shift();
    if (this.times.length >= this.max) return false;
    this.times.push(now);
    return true;
  }
}
