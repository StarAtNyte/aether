import { effectsOf, needsPrePass, stillEffects } from './finishing';
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
export const SHADOW_RADIUS = Object.freeze({ realtime: 3, studio: 6, final: 7 });
/** Sun shadow blur radius of the high and ultra interactive tiers. */
export const TIER_SHADOW_RADIUS = 4;
/** Largest single draw (pixels per side) a still may use, by GPU class (see {@link stillPlan}). */
export const STILL_DRAW_CAP = Object.freeze({ discrete: 4096, integrated: 2048, unknown: 2048, software: 1024 });
/**
 * Plan a `width`×`height` still. Screen-space effects with wide support (bloom, halation) differ between
 * tiles, which shows as faint seams, so a still is drawn in one piece whenever the GPU class allows:
 * `final` oversamples 2× when the oversampled image fits one draw, otherwise draws 1:1 (a 4K still on a
 * discrete GPU is still one draw). Larger images are tiled, with the usual overlap.
 */
export function stillPlan(width, height, quality, gpu) {
    const cap = STILL_DRAW_CAP[gpu] ?? 2048;
    const w = Number.isFinite(width) ? Math.max(16, Math.floor(width)) : 1920;
    const h = Number.isFinite(height) ? Math.max(16, Math.floor(height)) : 1080;
    const final = quality === 'final';
    const supersample = final && w * 2 <= cap && h * 2 <= cap ? 2 : 1;
    const single = w * supersample <= cap && h * supersample <= cap;
    const frames = gpu === 'software' ? (final ? 12 : 6) : final ? 48 : 24;
    // Tiled images use smaller draws than the cap: more tiles, but each one cheap (the studio default).
    return { supersample, tileSize: single ? cap : Math.min(cap, 1024), single, frames };
}
/** Studio and final quality need the post pass (unavailable in low-memory mode). */
export function studioAvailable(budget) {
    return budget.post === true;
}
/** The pipeline variant an effect set needs: with a pre-pass ('studio') or without ('standard'). */
export function postQualityOf(effects) {
    if (needsPrePass(effects))
        return 'studio';
    return effects.composite ? 'standard' : null;
}
/**
 * The plan for `quality` under `budget`. Stills fall back to realtime when the budget forbids the post
 * pass; their shadow map doubles the budget's (at most {@link STUDIO_SHADOW_MAP_MAX}) because a still
 * is drawn once. `tier` (default: `low` on software rasterisers, `medium` otherwise) only matters for
 * realtime.
 */
export function qualityPlan(quality, budget, software = false, tier) {
    const cap = Number.isFinite(budget.shadowMapCap) && budget.shadowMapCap > 0 ? budget.shadowMapCap : 1024;
    if (quality === 'realtime' || !studioAvailable(budget)) {
        const t = !budget.post ? 'low' : (tier ?? (software ? 'low' : 'medium'));
        const effects = effectsOf(t);
        const refined = effects.ao || effects.taa;
        return {
            quality: 'realtime',
            tier: t,
            effects,
            post: postQualityOf(effects),
            shadowMapCap: cap,
            shadowRadius: refined ? TIER_SHADOW_RADIUS : SHADOW_RADIUS.realtime,
            accumulateFrames: refined ? (software ? TIER_ACCUMULATE_FRAMES_SOFTWARE : TIER_ACCUMULATE_FRAMES) : 0,
            adaptiveResolution: true,
        };
    }
    const final = quality === 'final';
    const stillFrames = software ? STUDIO_ACCUMULATE_FRAMES_SOFTWARE : STUDIO_ACCUMULATE_FRAMES;
    const finalFrames = software ? FINAL_ACCUMULATE_FRAMES_SOFTWARE : FINAL_ACCUMULATE_FRAMES;
    return {
        quality,
        tier: 'ultra',
        effects: stillEffects(final),
        post: 'studio',
        shadowMapCap: Math.min(STUDIO_SHADOW_MAP_MAX, software ? cap : cap * 2),
        shadowRadius: SHADOW_RADIUS[quality],
        accumulateFrames: final ? finalFrames : stillFrames,
        adaptiveResolution: false,
    };
}
/**
 * Progressive refinement counter: {@link restart} whenever the view or the
 * content changes; {@link next} says whether one more refinement frame is
 * due and counts it. Allocation-free.
 */
export class Refinement {
    remaining = 0;
    total = 0;
    /** Frames per refinement (0 disables). */
    setFrames(frames) {
        this.total = Number.isFinite(frames) && frames > 0 ? Math.floor(frames) : 0;
        this.remaining = Math.min(this.remaining, this.total);
    }
    /** Something changed: refine from scratch. */
    restart() {
        this.remaining = this.total;
    }
    /** True (and counted) while refinement frames remain. */
    next() {
        if (this.remaining <= 0)
            return false;
        this.remaining--;
        return true;
    }
    /** Refinement progress in [0, 1] (1 when idle or disabled). */
    get progress() {
        return this.total === 0 ? 1 : 1 - this.remaining / this.total;
    }
    /** Refinement frames are still due. */
    get active() {
        return this.remaining > 0;
    }
}
