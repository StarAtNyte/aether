/**
 * Theme contract of the mock planner. A *setting* dresses the world around an
 * origin (and owns environment/backdrop when primary); an *activity* adds a
 * playable mechanic with rules and verification tests near the origin.
 */
import type { Builder } from './builder';
import type { ThemeCtx } from './decor';

/** A world template selectable by keywords. */
export interface Theme {
  id: string;
  kind: 'setting' | 'activity';
  /** Human title used for the world name. */
  title: string;
  /** Keyword matcher on the lowercased request. */
  match: RegExp;
  /** Activities: radius they need kept clear. Settings: radius of their content. */
  radius: number;
  /** Settings that can wrap around another setting's center (forests, snowfields…). */
  layerable?: boolean;
  /** Environment + player defaults (primary setting, or an activity with no setting). */
  env(b: Builder): void;
  /** Activities that look bare on their own get the default setting around them. */
  wantsSetting?: boolean;
  /** Ids of other themes of the same kind this one renders itself when both are requested. */
  absorbs?: readonly string[];
  /** Activities: player setup applied even when combined with a setting. */
  player?(b: Builder): void;
  /**
   * Activities: lay out what the settings must leave free before any setting builds (a race circuit reserves its
   * corridor and tells the landscape how much level ground it needs). Only the first activity's hook runs.
   */
  prepare?(c: ThemeCtx): void;
  build(c: ThemeCtx): void;
  /** One sentence for the finish message. */
  blurb: string;
  /** Title for this request, when the theme adapts to it ("Lantern Hunt"); defaults to {@link Theme.title}. */
  titleFor?(request: string): string;
  /** Finish-message sentence for this request; defaults to {@link Theme.blurb}. */
  blurbFor?(request: string): string;
}
