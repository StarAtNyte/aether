/**
 * Performance policy (pure, unit-tested): what the machine can afford before the first frame, and what to give up,
 * in order, when frames still come slowly.
 *
 * The GPU class alone (`budget.ts`) misses the other half of weak hardware: a four-core laptop with an integrated GPU
 * links shaders, builds geometry and runs the physics worker on the same few cores that draw the page, and a
 * low-memory device cannot hold the post chain's targets. {@link hardwareTierCap} lowers the automatic tier for
 * those; {@link PerformanceGovernor} lowers it further, one visible cost at a time, when the frame time says so.
 */
import type { RenderTier } from './finishing';
import type { GpuTier } from './budget';

/** What the browser says about the machine (each field is absent when the browser does not tell). */
export interface HardwareHints {
  /** `navigator.hardwareConcurrency`. */
  cores?: number;
  /** `navigator.deviceMemory` (GB, rounded down to a power of two by the browser, at most 8). */
  memoryGB?: number;
}

/** Read the hints from the browser (empty outside one). */
export function readHardware(nav: { hardwareConcurrency?: number; deviceMemory?: number } | null = typeof navigator === 'undefined' ? null : (navigator as unknown as { hardwareConcurrency?: number; deviceMemory?: number })): HardwareHints {
  const out: HardwareHints = {};
  const c = nav?.hardwareConcurrency;
  const m = nav?.deviceMemory;
  if (typeof c === 'number' && Number.isFinite(c) && c > 0) out.cores = Math.floor(c);
  if (typeof m === 'number' && Number.isFinite(m) && m > 0) out.memoryGB = m;
  return out;
}

/** Few cores or little memory: the page, the workers and the driver share a machine that cannot spare them. */
export function weakHardware(h: HardwareHints): boolean {
  return (h.cores !== undefined && h.cores <= 4) || (h.memoryGB !== undefined && h.memoryGB <= 4);
}

/**
 * The most expensive automatic tier the hardware affords, or null for no limit. Two cores or 2 GB: `low`. Four
 * cores or 4 GB: `medium` on a discrete GPU, `low` on anything else (a four-core laptop with an integrated GPU
 * cannot afford the post chain's passes and the shaders that go with it).
 */
export function hardwareTierCap(h: HardwareHints, gpu: GpuTier): RenderTier | null {
  if ((h.cores !== undefined && h.cores <= 2) || (h.memoryGB !== undefined && h.memoryGB <= 2)) return 'low';
  if (weakHardware(h)) return gpu === 'discrete' ? 'medium' : 'low';
  return null;
}

const ORDER: readonly RenderTier[] = ['low', 'medium', 'high', 'ultra'];

/** The cheaper of two tiers (`cap` null: `tier`). */
export function capTier(tier: RenderTier, cap: RenderTier | null): RenderTier {
  if (cap === null) return tier;
  return ORDER.indexOf(tier) <= ORDER.indexOf(cap) ? tier : cap;
}

/** Largest pixel ratio of weak hardware (the fill rate of an integrated GPU is the first thing to go). */
export const WEAK_PIXEL_RATIO = 1;

/**
 * What each step of the ladder gives up, cheapest loss of looks first. Resolution is not on the ladder: adaptive
 * resolution goes first and the ladder starts when it has fallen to {@link GOVERNOR_DEFAULTS.afterScale}.
 */
export const PERFORMANCE_STEPS = Object.freeze(['light-volume', 'cascades', 'post-medium', 'post-off', 'effects'] as const);
export type PerformanceStep = (typeof PERFORMANCE_STEPS)[number];

/** The state a level of the ladder asks for. */
export interface PerformanceCuts {
  /** The baked light volume of buildings (the analytic interior fills stay). */
  lightVolume: boolean;
  /** Cascaded sun shadows (one fitted map stays). */
  cascades: boolean;
  /** Most expensive tier allowed (null: the tier chosen). */
  tierCap: RenderTier | null;
  /** Particle emission scale. */
  effects: number;
}

/** What `level` (0 = nothing given up) asks for. Cumulative. */
export function cutsAt(level: number): PerformanceCuts {
  const l = Math.max(0, Math.min(PERFORMANCE_STEPS.length, Math.floor(Number.isFinite(level) ? level : 0)));
  return {
    lightVolume: l < 1,
    cascades: l < 2,
    tierCap: l >= 4 ? 'low' : l >= 3 ? 'medium' : null,
    effects: l >= 5 ? 0.25 : 1,
  };
}

/** Tunables of {@link PerformanceGovernor}. */
export const GOVERNOR_DEFAULTS = Object.freeze({
  /** Frame rate (of the 90th-percentile frame time) under which a step is taken. */
  lowFps: 20,
  /** Under this the wait is the short one. */
  badFps: 12,
  /** Seconds below `lowFps` before a step. */
  after: 6,
  /** Seconds below `badFps` before a step. */
  afterBad: 1.5,
  /** Adaptive resolution must have fallen to this scale first. */
  afterScale: 0.72,
  /** Frames in the percentile window. */
  window: 40,
  /** Frame deltas above this break the continuous streak (s; shader links and loads are not slowness). */
  maxContinuousDt: 0.25,
});

/**
 * Steps down the {@link PERFORMANCE_STEPS} ladder while frames stay slow: p90 of the last frames under `lowFps` for
 * `after` seconds with resolution already lowered, or under `badFps` for `afterBad` seconds. Only back-to-back frames
 * count (an idle editor or a hidden tab never looks slow), and it never goes back up: every step recompiles shaders, so
 * trying again would turn one slow patch into a stutter every few seconds. Allocation-free per frame.
 */
export class PerformanceGovernor {
  /** Steps taken so far. */
  level = 0;
  /** Whether it may step (off when the user chose a tier). */
  enabled = true;
  private readonly o: typeof GOVERNOR_DEFAULTS;
  private readonly ring: Float32Array;
  private readonly sorted: Float32Array;
  private cursor = 0;
  private filled = 0;
  private slow = 0;
  private bad = 0;

  constructor(opts: Partial<typeof GOVERNOR_DEFAULTS> = {}) {
    this.o = { ...GOVERNOR_DEFAULTS, ...opts };
    this.ring = new Float32Array(this.o.window);
    this.sorted = new Float32Array(this.o.window);
  }

  /** Frame rate implied by the p90 frame time of the window (0: no data). */
  get fps(): number {
    if (this.filled < 8) return 0;
    const s = this.sorted.subarray(0, this.filled);
    for (let i = 0; i < this.filled; i++) s[i] = this.ring[i] as number;
    s.sort();
    return 1 / (s[Math.min(this.filled - 1, Math.floor(this.filled * 0.9))] as number);
  }

  /** Forget the window (after a step, a world change or a tier choice). */
  reset(): void {
    this.filled = 0;
    this.cursor = 0;
    this.slow = 0;
    this.bad = 0;
  }

  /**
   * Record one drawn frame (`dt` seconds since the previous drawn one; `continuous` false when the previous animation
   * frame drew nothing) under adaptive resolution `scale`. Returns true when a step was due: the caller applies
   * {@link cutsAt}`(level)` and `level` has already advanced.
   */
  record(dt: number, continuous: boolean, scale: number): boolean {
    if (!this.enabled || this.level >= PERFORMANCE_STEPS.length || !(dt > 0) || !Number.isFinite(dt)) return false;
    if (!continuous || dt > this.o.maxContinuousDt) {
      this.reset();
      return false;
    }
    this.ring[this.cursor] = dt;
    this.cursor = (this.cursor + 1) % this.o.window;
    if (this.filled < this.o.window) this.filled++;
    const fps = this.fps;
    if (fps === 0) return false;
    this.bad = fps < this.o.badFps ? this.bad + dt : 0;
    this.slow = fps < this.o.lowFps && scale <= this.o.afterScale ? this.slow + dt : 0;
    if (this.bad >= this.o.afterBad || this.slow >= this.o.after) {
      this.level++;
      this.reset();
      return true;
    }
    return false;
  }
}
