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
  /** Frame rate (p90) above which the climb back up counts time. Well above `lowFps`: no flapping between the two. */
  upFps: 48,
  /** Seconds above `upFps` before a step back up. */
  upAfter: 10,
  /** Seconds after any move before the next step up (a move recompiles shaders; frames settle first). */
  settle: 20,
  /** A step down this soon (s) after a step up pins the floor. */
  retreat: 45,
  /** Sustained full-resolution headroom before retrying a failed climb. */
  retryAfter: 120,
  maxRetryAfter: 480,
});

/**
 * Steps down the {@link PERFORMANCE_STEPS} ladder while frames stay slow: p90 of the last frames under `lowFps` for
 * `after` seconds with resolution already lowered, or under `badFps` for `afterBad` seconds. Only back-to-back frames
 * count (an idle editor or a hidden tab never looks slow).
 *
 * It also climbs back, one step at a time, when frames are comfortably fast: p90 above `upFps` with the resolution at full
 * scale for `upAfter` seconds, and not sooner than `settle` seconds after the last move. Every step recompiles shaders, so
 * the climb is slow on purpose and has hysteresis: `upFps` is well above `lowFps`, and when a climb is undone by a step down
 * within `retreat` seconds, that level becomes a temporary floor. Sustained full-resolution headroom permits a later
 * retry, with a longer wait after repeated failures. A governor
 * that starts above level 0 (a machine on a path known to need care) is told with {@link start}. Time here is the sum of
 * the continuous frames recorded, so a hidden tab does not move it. Allocation-free per frame.
 */
export class PerformanceGovernor {
  /** Steps taken so far (lower: less given up). */
  level = 0;
  /** Direction of the move the last true {@link record} made: 1 gave something up, -1 gave something back, 0 none yet. */
  lastMove: -1 | 0 | 1 = 0;
  /** Whether it may step (off when the user chose a tier). */
  enabled = true;
  /** Lowest level the climb may return to (raised when a climb was undone at once). */
  floor = 0;
  private readonly o: { [K in keyof typeof GOVERNOR_DEFAULTS]: number };
  private readonly ring: Float32Array;
  private readonly sorted: Float32Array;
  private cursor = 0;
  private filled = 0;
  private slow = 0;
  private bad = 0;
  private fast = 0;
  private floorFast = 0;
  private failedClimbs = 0;
  private retryWait: number = GOVERNOR_DEFAULTS.retryAfter;
  private clock = 0;
  private lastMoveAt = Number.NEGATIVE_INFINITY;
  private lastUpAt = Number.NEGATIVE_INFINITY;

  constructor(opts: { [K in keyof typeof GOVERNOR_DEFAULTS]?: number } = {}) {
    this.o = { ...GOVERNOR_DEFAULTS, ...opts };
    this.ring = new Float32Array(this.o.window);
    this.sorted = new Float32Array(this.o.window);
  }

  /** Begin at `level` (a cautious start): the climb may come back down to 0. */
  start(level: number): void {
    this.level = Math.max(0, Math.min(PERFORMANCE_STEPS.length, Math.floor(Number.isFinite(level) ? level : 0)));
    this.floor = 0;
    this.failedClimbs = 0;
    this.retryWait = this.o.retryAfter;
    this.lastMove = 0;
    this.lastMoveAt = this.clock;
    this.lastUpAt = Number.NEGATIVE_INFINITY;
    this.reset();
  }

  /** Frame rate implied by the p90 frame time of the window (0: no data). */
  get fps(): number {
    if (this.filled < 8) return 0;
    const s = this.sorted;
    for (let i = 0; i < this.filled; i++) s[i] = this.ring[i] as number;
    s.fill(Infinity, this.filled);
    s.sort();
    return 1 / (s[Math.min(this.filled - 1, Math.floor(this.filled * 0.9))] as number);
  }

  /** Forget the window (after a step, a world change or a tier choice). */
  reset(): void {
    this.filled = 0;
    this.cursor = 0;
    this.slow = 0;
    this.bad = 0;
    this.fast = 0;
    this.floorFast = 0;
  }

  /**
   * Record one drawn frame (`dt` seconds since the previous drawn one; `continuous` false when the previous animation
   * frame drew nothing) under adaptive resolution `scale` (0: adaptive resolution is off). Returns true when a move was
   * due: the caller applies {@link cutsAt}`(level)` and `level` has already moved ({@link lastMove} says which way).
   */
  record(dt: number, continuous: boolean, scale: number): boolean {
    if (!this.enabled || !(dt > 0) || !Number.isFinite(dt)) return false;
    if (!continuous || dt > this.o.maxContinuousDt) {
      this.reset();
      return false;
    }
    this.clock += dt;
    this.ring[this.cursor] = dt;
    this.cursor = (this.cursor + 1) % this.o.window;
    if (this.filled < this.o.window) this.filled++;
    const fps = this.fps;
    if (fps === 0) return false;
    if (this.level < PERFORMANCE_STEPS.length) {
      this.bad = fps < this.o.badFps ? this.bad + dt : 0;
      this.slow = fps < this.o.lowFps && scale <= this.o.afterScale ? this.slow + dt : 0;
      if (this.bad >= this.o.afterBad || this.slow >= this.o.after) {
        // A climb undone at once: the level it climbed to is too much for this machine.
        if (this.clock - this.lastUpAt <= this.o.retreat) {
          this.floor = Math.max(this.floor, this.level + 1);
          this.failedClimbs++;
          this.retryWait = Math.min(this.o.maxRetryAfter, this.o.retryAfter * 2 ** Math.min(8, this.failedClimbs - 1));
        }
        this.level++;
        this.lastMove = 1;
        this.lastMoveAt = this.clock;
        this.reset();
        return true;
      }
    }
    const roomy = fps >= this.o.upFps && (scale === 0 || scale >= 0.99);
    this.floorFast = roomy && this.floor > 0 && this.level === this.floor ? this.floorFast + dt : 0;
    if (this.floorFast >= this.retryWait) {
      this.floor--;
      this.floorFast = 0;
    }
    this.fast = roomy && this.level > this.floor ? this.fast + dt : 0;
    if (this.fast >= this.o.upAfter && this.clock - this.lastMoveAt >= this.o.settle) {
      this.level--;
      this.lastMove = -1;
      this.lastMoveAt = this.clock;
      this.lastUpAt = this.clock;
      this.reset();
      return true;
    }
    return false;
  }
}
