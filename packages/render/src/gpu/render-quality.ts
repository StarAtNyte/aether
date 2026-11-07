/**
 * Render quality policy (pure, unit-tested): the realtime look used while editing and playing (its
 * cost follows a {@link RenderTier}), the `studio` look for architectural stills — the ultra chain
 * (AO, reflections, sun shafts, temporal AA), larger and softer sun shadows and progressive
 * refinement that keeps drawing for a number of frames after the camera stops so the temporal
 * passes converge into a clean image, then idles again — and the `final` look, which adds depth of
 * field and refines for much longer.
 */
import type { GpuTier, RenderBudget } from './budget';
import { effectsOf, needsPrePass, stillEffects, type PostEffects, type RenderTier } from './finishing';
import type { PostQuality } from './post';

/** Render quality chosen by the user. */
export type RenderQuality = 'realtime' | 'studio' | 'final';

/** Frames refined after the view comes to rest in studio quality (desktop GPUs). */
export const STUDIO_ACCUMULATE_FRAMES = 48;
/** Frames refined on software rasterizers (each frame is slow there). */
export const STUDIO_ACCUMULATE_FRAMES_SOFTWARE = 16;
/** Frames refined by the final render (desktop GPUs). */
export const FINAL_ACCUMULATE_FRAMES = 160;
/** Frames refined by the final render on software rasterizers. */
export const FINAL_ACCUMULATE_FRAMES_SOFTWARE = 24;
/** Frames the high and ultra tiers refine after the view rests (AO and shadow noise converge). */
export const TIER_ACCUMULATE_FRAMES = 16;
/** Same, on software rasterizers. */
export const TIER_ACCUMULATE_FRAMES_SOFTWARE = 4;
/** Largest sun shadow map the studio quality asks for. */
export const STUDIO_SHADOW_MAP_MAX = 4096;
/** Sun shadow blur radius (PCF) per quality. */
export const SHADOW_RADIUS: Readonly<Record<RenderQuality, number>> = Object.freeze({ realtime: 3, studio: 6, final: 7 });
/** Sun shadow blur radius of the high and ultra interactive tiers. */
export const TIER_SHADOW_RADIUS = 4;

/** What a quality asks of the renderer. */
export interface QualityPlan {
  quality: RenderQuality;
  /**
   * Render tier in effect: what the frame costs (level of detail, draw distances, shadow casters) follows it. Stills
   * always run the ultra chain.
   */
  tier: RenderTier;
  /**
   * Tier the material programs are built for: lights, sky detail, the photographed sky, the output of the scene pass.
   * Below {@link tier} only when the performance ladder lowered the cost without rebuilding the materials (see
   * {@link QualityOptions.ladderCap}); otherwise equal to it.
   */
  programTier: RenderTier;
  /** The effects the plan asks for (before user toggles and device failures; see `resolveEffects`). */
  effects: PostEffects;
  /** Post pipeline variant (null: none unless the world's bloom asks for the standard one). */
  post: PostQuality | null;
  /** Upper bound of the sun shadow map edge. */
  shadowMapCap: number;
  /** PCF blur radius of the sun shadow. */
  shadowRadius: number;
  /** Frames to keep refining after the view rests (0: draw on demand only). */
  accumulateFrames: number;
  /** Adaptive resolution may lower the resolution (never while refining a still). */
  adaptiveResolution: boolean;
  /**
   * Motion phase (null: no separate motion policy). Its lighting effects match the resting view;
   * adaptive resolution manages motion cost without changing the scene's look.
   */
  moveEffects: PostEffects | null;
  /** Tier and still flag the sun shadows are planned for (the same in motion and at rest: a change recompiles materials). */
  shadowTier: RenderTier;
  shadowStill: boolean;
}

/** Options of {@link qualityPlan} beyond the budget. */
export interface QualityOptions {
  /**
   * Use adaptive resolution in motion and full-resolution refinement at rest, with medium-tier shadows throughout.
   * Both phases retain the same lighting effects to avoid camera-driven brightness changes.
   */
  split?: boolean;
  /** Most expensive tier the performance ladder still allows (null: any). Stills: the effects of the chain. */
  tierCap?: RenderTier | null;
  /**
   * Realtime: the performance ladder's cap on the tier's cost (null: none). The plan's {@link QualityPlan.tier} is capped
   * and the post passes the lower tier lacks are dropped, but the material programs stay those of the tier asked for
   * ({@link QualityPlan.programTier}): the scene pass keeps its output (the composite stays), the shadow technique and
   * radius stay. A ladder step then links no program: on an integrated GPU a step from medium to low rebuilt every lit
   * material, 29-35 links and GPU-process tasks of 100-900 ms each, while the frame was bound by triangles, which the
   * lower tier's level of detail and draw distances cut.
   */
  ladderCap?: RenderTier | null;
}

const ORDER: readonly RenderTier[] = ['low', 'medium', 'high', 'ultra'];

/** The cheaper of `tier` and `cap` (null: `tier`). */
function capTier(tier: RenderTier, cap: RenderTier | null): RenderTier {
  return cap !== null && ORDER.indexOf(cap) < ORDER.indexOf(tier) ? cap : tier;
}

/** The effects of `base` that `cap`'s tier also runs. */
function clampEffects(base: PostEffects, cap: RenderTier | null | undefined): PostEffects {
  if (!cap || cap === 'ultra') return base;
  const allow = effectsOf(cap);
  const out = { ...base };
  for (const k of Object.keys(out) as (keyof PostEffects)[]) out[k] = base[k] && allow[k];
  return out;
}

/** Largest single draw (pixels per side) a still may use, by GPU class (see {@link stillPlan}). */
export const STILL_DRAW_CAP: Readonly<Record<GpuTier, number>> = Object.freeze({ discrete: 4096, integrated: 2048, unknown: 2048, software: 1024 });

/** How a still of a given size is drawn. */
export interface StillPlan {
  /** Render at this many times the size and filter down (1 or 2). */
  supersample: 1 | 2;
  /** Largest draw (tile) edge in pixels. */
  tileSize: number;
  /** The whole (oversampled) image fits one draw, so screen-space effects (bloom, halation, AO) have no tile seams. */
  single: boolean;
  /** Temporal samples accumulated per draw. */
  frames: number;
}

/**
 * Plan a `width`×`height` still. Screen-space effects with wide support (bloom, halation) differ between
 * tiles, which shows as faint seams, so a still is drawn in one piece whenever the GPU class allows:
 * `final` oversamples 2× when the oversampled image fits one draw, otherwise draws 1:1 (a 4K still on a
 * discrete GPU is still one draw). Larger images are tiled, with the usual overlap.
 */
export function stillPlan(width: number, height: number, quality: 'studio' | 'final', gpu: GpuTier): StillPlan {
  const cap = STILL_DRAW_CAP[gpu] ?? 2048;
  const w = Number.isFinite(width) ? Math.max(16, Math.floor(width)) : 1920;
  const h = Number.isFinite(height) ? Math.max(16, Math.floor(height)) : 1080;
  const final = quality === 'final';
  const supersample: 1 | 2 = final && w * 2 <= cap && h * 2 <= cap ? 2 : 1;
  const single = w * supersample <= cap && h * supersample <= cap;
  const frames = gpu === 'software' ? (final ? 12 : 6) : final ? 48 : 24;
  // Tiled images use smaller draws than the cap: more tiles, but each one cheap (the studio default).
  return { supersample, tileSize: single ? cap : Math.min(cap, 1024), single, frames };
}

/** Studio and final quality need the post pass (unavailable in low-memory mode). */
export function studioAvailable(budget: Pick<RenderBudget, 'post'>): boolean {
  return budget.post === true;
}

/** The pipeline variant an effect set needs: with a pre-pass ('studio') or without ('standard'). */
export function postQualityOf(effects: PostEffects): PostQuality | null {
  if (needsPrePass(effects)) return 'studio';
  return effects.composite ? 'standard' : null;
}

/**
 * The plan for `quality` under `budget`. Stills fall back to realtime when the budget forbids the post
 * pass; their shadow map doubles the budget's (at most {@link STUDIO_SHADOW_MAP_MAX}) because a still
 * is drawn once. `tier` (default: `low` on software rasterisers, `medium` otherwise) only matters for
 * realtime.
 */
export function qualityPlan(quality: RenderQuality, budget: Pick<RenderBudget, 'post' | 'shadowMapCap'>, software = false, tier?: RenderTier, opts: QualityOptions = {}): QualityPlan {
  const cap = Number.isFinite(budget.shadowMapCap) && budget.shadowMapCap > 0 ? budget.shadowMapCap : 1024;
  if (quality === 'realtime' || !studioAvailable(budget)) {
    const t: RenderTier = !budget.post ? 'low' : (tier ?? (software ? 'low' : 'medium'));
    const cost = capTier(t, opts.ladderCap ?? null);
    const own = effectsOf(t);
    // The lower tier's post passes, with the scene pass's output kept (a composite draws through it: dropping it would
    // put the tone mapping back into every material).
    const effects = cost === t ? own : { ...clampEffects(own, cost), composite: own.composite };
    const refined = effects.ao || effects.taa;
    const ownRefined = own.ao || own.taa;
    return {
      quality: 'realtime',
      tier: cost,
      programTier: t,
      effects,
      post: postQualityOf(effects),
      shadowMapCap: cap,
      shadowRadius: ownRefined ? TIER_SHADOW_RADIUS : SHADOW_RADIUS.realtime,
      accumulateFrames: refined ? (software ? TIER_ACCUMULATE_FRAMES_SOFTWARE : TIER_ACCUMULATE_FRAMES) : 0,
      adaptiveResolution: true,
      moveEffects: null,
      shadowTier: t,
      shadowStill: false,
    };
  }
  const final = quality === 'final';
  const stillFrames = software ? STUDIO_ACCUMULATE_FRAMES_SOFTWARE : STUDIO_ACCUMULATE_FRAMES;
  const finalFrames = software ? FINAL_ACCUMULATE_FRAMES_SOFTWARE : FINAL_ACCUMULATE_FRAMES;
  const split = opts.split === true && !final && !software;
  const effects = clampEffects(stillEffects(final), opts.tierCap);
  const move = split ? effects : null;
  return {
    quality,
    tier: 'ultra',
    programTier: 'ultra',
    effects,
    post: 'studio',
    shadowMapCap: split ? cap : Math.min(STUDIO_SHADOW_MAP_MAX, software ? cap : cap * 2),
    shadowRadius: split ? TIER_SHADOW_RADIUS : SHADOW_RADIUS[quality],
    accumulateFrames: final ? finalFrames : stillFrames,
    adaptiveResolution: split,
    moveEffects: move,
    shadowTier: split ? 'medium' : 'ultra',
    shadowStill: !split,
  };
}

/**
 * Progressive refinement counter: {@link restart} whenever the view or the
 * content changes; {@link next} says whether one more refinement frame is
 * due and counts it. Allocation-free.
 */
export class Refinement {
  private remaining = 0;
  private total = 0;

  /** Frames per refinement (0 disables). */
  setFrames(frames: number): void {
    this.total = Number.isFinite(frames) && frames > 0 ? Math.floor(frames) : 0;
    this.remaining = Math.min(this.remaining, this.total);
  }

  /** Something changed: refine from scratch. */
  restart(): void {
    this.remaining = this.total;
  }

  /** True (and counted) while refinement frames remain. */
  next(): boolean {
    if (this.remaining <= 0) return false;
    this.remaining--;
    return true;
  }

  /** Refinement progress in [0, 1] (1 when idle or disabled). */
  get progress(): number {
    return this.total === 0 ? 1 : 1 - this.remaining / this.total;
  }

  /** Refinement frames are still due. */
  get active(): boolean {
    return this.remaining > 0;
  }
}
