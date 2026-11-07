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
 *
 * The tier caps (`post-medium`, `post-off`) lower what the frame costs, not the materials (`QualityOptions.ladderCap`):
 * the lower tier's level of detail, draw distances and shadow casters, and its post passes except the composite. Lights,
 * sky and the scene pass's output stay those of the tier the materials were built for, so a step links no program
 * (Firefox's cautious start excepted: it asks for the lightest programs).
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
  /**
   * The climb also counts time when the median frame is this fast and the p90 one above `climbFloorFps`: on a 60 Hz display a
   * GPU that misses one vsync in ten has a p90 of exactly 30 fps (33 ms) at a 55 fps average, which never reached `upFps`, so
   * a fast GPU started low stayed low.
   */
  upMedianFps: 55,
  /** See `upMedianFps`: the p90 frame rate a vsync-quantised climb still needs (above `lowFps`, well clear of a step down). */
  climbFloorFps: 28,
  /** Seconds above `upFps` before a step back up. */
  upAfter: 10,
  /** Seconds after any move before the next step up (frames settle first). */
  settle: 20,
  /** A step down this soon (s) after a step up pins the floor. */
  retreat: 45,
  /** Sustained full-resolution headroom before retrying a failed climb. */
  retryAfter: 120,
  maxRetryAfter: 480,
  /** Seconds above `upFps` before a step up while climbing from a cautious start (nothing measured has been given up yet). */
  startUpAfter: 4,
  /** Seconds after a move before the next step up while climbing from a cautious start. */
  startSettle: 6,
});

/**
 * Steps down the {@link PERFORMANCE_STEPS} ladder while frames stay slow: p90 of the last frames under `lowFps` for
 * `after` seconds with resolution already lowered, or under `badFps` for `afterBad` seconds. Only back-to-back frames
 * count (an idle editor or a hidden tab never looks slow).
 *
 * It also climbs back, one step at a time, when frames are comfortably fast: p90 above `upFps` with the resolution at full
 * scale for `upAfter` seconds, and not sooner than `settle` seconds after the last move. Every step changes the level of
 * detail (and some, the light volume or the cascades, a shadow technique), so the climb is slow on purpose and has hysteresis: `upFps` is well above `lowFps`, and when a climb is undone by a step down
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
  /** Frame rate (p90) that made the last step down (0: none since the start). */
  stepFps = 0;
  /**
   * Climbing from a quick {@link start} above level 0 with nothing measured given up: the climb uses the shorter `startUpAfter`
   * and `startSettle` (a guess is not evidence, so a fast GPU should not spend two minutes of motion proving it).
   */
  cautious = false;
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

  /**
   * Begin at `level` (a cautious start): the climb may come back down to 0. `quick`: the start is a guess about a fast GPU
   * (Firefox on a discrete one), so the climb uses the shorter waits until something measured is given up.
   */
  start(level: number, quick = false): void {
    this.level = Math.max(0, Math.min(PERFORMANCE_STEPS.length, Math.floor(Number.isFinite(level) ? level : 0)));
    this.floor = 0;
    this.failedClimbs = 0;
    this.retryWait = this.o.retryAfter;
    this.lastMove = 0;
    this.lastMoveAt = this.clock;
    this.lastUpAt = Number.NEGATIVE_INFINITY;
    this.stepFps = 0;
    this.cautious = quick && this.level > 0;
    this.reset();
  }

  /** Frame rate implied by the p90 frame time of the window (0: no data). */
  get fps(): number {
    return this.rate(0.9);
  }

  /** Frame rate implied by the median frame time of the window (0: no data). */
  get medianFps(): number {
    return this.rate(0.5);
  }

  private rate(q: number): number {
    if (this.filled < 8) return 0;
    const s = this.sorted;
    for (let i = 0; i < this.filled; i++) s[i] = this.ring[i] as number;
    s.fill(Infinity, this.filled);
    s.sort();
    return 1 / (s[Math.min(this.filled - 1, Math.floor(this.filled * q))] as number);
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
        this.stepFps = fps;
        this.cautious = false;
        this.level++;
        this.lastMove = 1;
        this.lastMoveAt = this.clock;
        this.reset();
        return true;
      }
    }
    const fastEnough = fps >= this.o.upFps || (fps >= this.o.climbFloorFps && this.medianFps >= this.o.upMedianFps);
    const roomy = fastEnough && (scale === 0 || scale >= 0.99);
    this.floorFast = roomy && this.floor > 0 && this.level === this.floor ? this.floorFast + dt : 0;
    if (this.floorFast >= this.retryWait) {
      this.floor--;
      this.floorFast = 0;
    }
    this.fast = roomy && this.level > this.floor ? this.fast + dt : 0;
    const upAfter = this.cautious ? this.o.startUpAfter : this.o.upAfter;
    const settle = this.cautious ? this.o.startSettle : this.o.settle;
    if (this.fast >= upAfter && this.clock - this.lastMoveAt >= settle) {
      this.level--;
      if (this.level === 0) this.cautious = false;
      this.lastMove = -1;
      this.lastMoveAt = this.clock;
      this.lastUpAt = this.clock;
      this.reset();
      return true;
    }
    return false;
  }
}

/**
 * Frames between redraws of the cached sun shadow map while casters animate, at a measured frame rate `fps`. A redraw draws
 * every caster again (thousands of draws in a street of houses) for the few that moved, people and animals: a fast GPU does
 * it every other frame, a slow one less often, so the animated shadows lag a little instead of the whole frame rate falling
 * with them (an Intel UHD 770 on a 2,300-entity street: every other frame left it at 60-80 ms). Unknown rates keep 2.
 */
export function sunMapSoftRefreshFrames(fps: number, casterDraws = 0): number {
  const byRate = !Number.isFinite(fps) || fps <= 0 || fps >= 40 ? 2 : fps >= 30 ? 4 : 8;
  // A redraw costs one draw per caster: thousands on a street or a hillside town redrawn for a few walking people.
  // Past a few hundred casters the animated shadows update at 10-15 Hz instead (a lag nobody sees on a walking figure).
  const n = Number.isFinite(casterDraws) && casterDraws > 0 ? casterDraws : 0;
  const byCost = n >= SUN_CASTERS_HEAVY ? 6 : n >= SUN_CASTERS_MANY ? 4 : 2;
  return Math.max(byRate, byCost);
}

/** Shadow-pass draws above which animated casters refresh the sun map less often (see {@link sunMapSoftRefreshFrames}). */
export const SUN_CASTERS_MANY = 400;
/** The same, for the heaviest worlds. */
export const SUN_CASTERS_HEAVY = 1200;

/** Roles of the room contents {@link interiorDrawDistance} may leave undrawn far from the eye (doors and windows are the facade: they stay). */
const INTERIOR_ROLES: ReadonlySet<string> = new Set(['furniture', 'part', 'fixture', 'light', 'switch']);

/** Whether an entity is a room's content (furniture, a drawer, a lamp, a fitting, a switch) rather than part of the building or the world. */
export function interiorContent(arch: { role?: string; room?: string } | undefined): boolean {
  return !!arch && typeof arch.room === 'string' && arch.room.length > 0 && typeof arch.role === 'string' && INTERIOR_ROLES.has(arch.role);
}

/**
 * Distance from the eye (metres) beyond which the cheaper tiers do not draw room contents (Infinity: always drawn). From the
 * street a house's furniture, drawers and lamps are a few dim pixels behind glass, yet each is a draw call in the view and
 * another in the sun's shadow map: a terrace of ten furnished houses is 400-500 of them, most of the frame on a weak CPU.
 * Inside a room everything near is drawn as before; `high` and `ultra` and stills never leave anything out.
 */
export function interiorDrawDistance(tier: RenderTier, still: boolean, gpu?: GpuTier): number {
  if (still) return Number.POSITIVE_INFINITY;
  if (tier === 'low') return 16;
  if (tier === 'medium') return 28;
  // An integrated GPU draws room contents up to {@link INTEGRATED_INTERIOR_REACH} at the high tiers too: a street of
  // furnished houses is most of a frame's triangles, and furniture behind glass two streets away reads as nothing.
  // A discrete GPU draws them farther, but not without end: a street of furnished houses is millions of triangles of
  // furniture behind glass (an RTX 3050 held 30-37 ms down one at ultra with every room drawn).
  return gpu === 'integrated' || gpu === 'unknown' ? INTEGRATED_INTERIOR_REACH : DISCRETE_INTERIOR_REACH;
}

/** Distance (m) of room contents drawn by a discrete GPU at the high and ultra tiers. */
export const DISCRETE_INTERIOR_REACH = 60;

/** Distance (m) of room contents drawn by an integrated GPU at the high and ultra tiers. */
export const INTEGRATED_INTERIOR_REACH = 40;

/**
 * Scale of the picture height that virtual geometry and scatter fields plan their level of detail for (1: the drawn height).
 * Both keep their screen-space error under a pixel of that height; on the cheaper tiers a coarser cut is planned, as for
 * a smaller picture, so a hillside of a hundred and sixty houses draws a few million triangles fewer. `high`, `ultra` and
 * stills plan for the full picture.
 */
export function lodHeightScale(tier: RenderTier, still: boolean, gpu?: GpuTier): number {
  if (still) return 1;
  const base = tier === 'low' ? 0.4 : tier === 'medium' ? 0.7 : 1;
  // An integrated GPU (or one not recognised) runs out of vertex throughput long before pixels: a hillside town planned
  // at full height drew 6 million triangles a frame on an Intel UHD. It plans as for a picture about half as tall, at
  // every tier: the effects of the tier stay, the far geometry is a coarser cut nobody can tell at that distance.
  return gpu === 'integrated' || gpu === 'unknown' ? base * INTEGRATED_LOD_SCALE : base;
}

/** Factor on {@link lodHeightScale} for integrated and unrecognised GPUs. */
export const INTEGRATED_LOD_SCALE = 0.5;

/** Local lights the low tier draws at most (see {@link forwardLightBudget}). */
export const LOW_TIER_LIGHTS = 4;

/**
 * Live local lights (point, spot, area) for the tier: `base`, the GPU's budget, except on the low tier of the realtime
 * view, which keeps {@link LOW_TIER_LIGHTS}. Every lit pixel loops over every live light: on an Intel UHD 770 eight point
 * lights were half the frame of a colony or a street of houses, four save a third of it. Stills keep the full budget.
 */
export function forwardLightBudget(base: number, tier: RenderTier, still: boolean): number {
  return !still && tier === 'low' ? Math.min(base, LOW_TIER_LIGHTS) : base;
}

/**
 * A world this big (entities, or triangles of its content) starts on the light end of the ladder on a weak GPU. Entities
 * are what costs: each is draws in the view and the sun's map. Triangles alone count only far past what level of detail
 * and adaptive resolution absorb (a waterfall valley of 1.5-3 M triangles held 25 ms at medium on an Intel UHD 770, and
 * started at low it never climbed back).
 */
export const HEAVY_WORLD = Object.freeze({ entities: 250, triangles: 6_000_000 });

/**
 * Ladder level a world starts at (0: nothing given up). On an integrated, unrecognised or software GPU a heavy world starts
 * at the low tier's cost (level 4) and the governor climbs while frames are comfortably fast, instead of starting at medium
 * and stepping down through the slow frames first. (Steps once rebuilt the lit materials, and on a street of houses each
 * rebuild froze an Intel UHD 770 for seconds; a tier cap of the ladder now keeps the materials, see `cutsAt`.)
 */
export function startLevel(gpu: GpuTier, world: { entities: number; triangles: number }): number {
  if (gpu === 'discrete') return 0;
  return world.entities >= HEAVY_WORLD.entities || world.triangles >= HEAVY_WORLD.triangles ? 4 : 0;
}
