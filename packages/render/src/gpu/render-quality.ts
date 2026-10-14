/**
 * Render quality policy (pure, unit-tested): the realtime look used while
 * editing and playing, and the `studio` look for architectural stills —
 * ambient occlusion, temporal anti-aliasing, larger and softer sun
 * shadows, and progressive refinement that keeps drawing for a number of
 * frames after the camera stops so the temporal passes converge into a
 * clean image, then idles again.
 */
import type { RenderBudget } from './budget';
import type { PostQuality } from './post';

/** Render quality chosen by the user. */
export type RenderQuality = 'realtime' | 'studio';

/** Frames refined after the view comes to rest in studio quality (desktop GPUs). */
export const STUDIO_ACCUMULATE_FRAMES = 48;
/** Frames refined on software rasterizers (each frame is slow there). */
export const STUDIO_ACCUMULATE_FRAMES_SOFTWARE = 16;
/** Largest sun shadow map the studio quality asks for. */
export const STUDIO_SHADOW_MAP_MAX = 4096;
/** Sun shadow blur radius (PCF) per quality. */
export const SHADOW_RADIUS: Readonly<Record<RenderQuality, number>> = Object.freeze({ realtime: 3, studio: 6 });

/** What a quality asks of the renderer. */
export interface QualityPlan {
  quality: RenderQuality;
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
}

/** Studio quality needs the post pass (unavailable in low-memory mode). */
export function studioAvailable(budget: Pick<RenderBudget, 'post'>): boolean {
  return budget.post === true;
}

/**
 * The plan for `quality` under `budget`. Studio falls back to realtime when
 * the budget forbids the post pass; its shadow map doubles the budget's
 * (at most {@link STUDIO_SHADOW_MAP_MAX}) because a still is drawn once.
 */
export function qualityPlan(quality: RenderQuality, budget: Pick<RenderBudget, 'post' | 'shadowMapCap'>, software = false): QualityPlan {
  const cap = Number.isFinite(budget.shadowMapCap) && budget.shadowMapCap > 0 ? budget.shadowMapCap : 1024;
  if (quality !== 'studio' || !studioAvailable(budget)) {
    return { quality: 'realtime', post: budget.post ? 'standard' : null, shadowMapCap: cap, shadowRadius: SHADOW_RADIUS.realtime, accumulateFrames: 0, adaptiveResolution: true };
  }
  return {
    quality: 'studio',
    post: 'studio',
    shadowMapCap: Math.min(STUDIO_SHADOW_MAP_MAX, software ? cap : cap * 2),
    shadowRadius: SHADOW_RADIUS.studio,
    accumulateFrames: software ? STUDIO_ACCUMULATE_FRAMES_SOFTWARE : STUDIO_ACCUMULATE_FRAMES,
    adaptiveResolution: false,
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
