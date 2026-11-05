/**
 * A change of quality tier as one transition (pure, unit-tested): begun when the person picks a tier, over when everything
 * the tier affects has been rebuilt, and never longer than {@link TRANSITION_MAX_MS}.
 *
 * A tier change rebuilds every lit program and the post chain (the view keeps its last complete picture meanwhile, see
 * `rebuildSince` in the renderer) and may let the baked light start again (the automatic bake runs only above the low tier,
 * the ladder's cuts come back). The host reports each frame whether that work is still under way; the transition ends once it
 * has stayed quiet for {@link TRANSITION_QUIET_MS}, so a bake that is scheduled a moment after the programs link still counts.
 * A long lightmap bake is not waited for: once it runs, its own status (progress, cancel) takes over.
 *
 * Rapid toggles restart the transition with the newest tier; the bound is counted from the last choice. Whatever happens, the
 * transition ends: a stuck "applying" state is not possible.
 */
import type { RenderTier } from '../gpu/finishing';

/** Quiet time (ms) with nothing rebuilding before the transition ends. */
export const TRANSITION_QUIET_MS = 400;
/** Longest a transition is shown (ms), whatever is still pending. */
export const TRANSITION_MAX_MS = 75_000;

/** What the host reports each frame. */
export interface TransitionWork {
  /** Programs of the new plan still link, or the view still holds the last complete picture. */
  programs: boolean;
  /** The baked light is being decided or the light volume bakes (not a running lightmap bake: that has its own status). */
  light: boolean;
}

export type TransitionStage = 'programs' | 'light';

export interface TransitionState {
  /** The tier being applied. */
  tier: RenderTier;
  /** What is still under way. */
  stage: TransitionStage;
  /** When the transition began (ms, the host's clock). */
  since: number;
}

export class QualityTransition {
  private target: RenderTier | null = null;
  private began = 0;
  private quietSince = 0;
  private stage: TransitionStage = 'programs';
  /** Transitions begun so far. */
  started = 0;
  /** Transitions that ran into {@link TRANSITION_MAX_MS} (diagnostics). */
  timedOut = 0;

  /** The person chose a tier at time `t`: a transition to `tier` begins (one already under way is replaced). */
  begin(tier: RenderTier, t: number): void {
    this.target = tier;
    this.began = t;
    this.quietSince = 0;
    this.stage = 'programs';
    this.started++;
  }

  /** Report the work still under way at time `t`. Returns true when the visible state changed (begun stage, ended). */
  update(work: TransitionWork, t: number): boolean {
    if (this.target === null) return false;
    if (t - this.began >= TRANSITION_MAX_MS) {
      this.timedOut++;
      this.end();
      return true;
    }
    const stage: TransitionStage = work.programs ? 'programs' : 'light';
    const changed = stage !== this.stage;
    this.stage = stage;
    if (work.programs || work.light) {
      this.quietSince = 0;
      return changed;
    }
    if (this.quietSince === 0) {
      this.quietSince = t;
      return changed;
    }
    if (t - this.quietSince >= TRANSITION_QUIET_MS) {
      this.end();
      return true;
    }
    return changed;
  }

  /** Stop at once (the renderer is disposed, the context is lost). */
  end(): void {
    this.target = null;
    this.quietSince = 0;
  }

  /** The transition under way, or null. */
  get state(): TransitionState | null {
    return this.target === null ? null : { tier: this.target, stage: this.stage, since: this.began };
  }
}
