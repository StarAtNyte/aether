/**
 * Closed-loop trim of the eye's exposure inside a building (pure, unit-tested).
 *
 * The room exposure is predicted from the light volume. The picture that reaches the screen also holds the lightmap,
 * lamps, the sky through the windows and the colours of the room, none of which the prediction sees: a room painted dark
 * stays crushed at the prediction's ceiling, a pale room with a lightmap comes out washed. The trim looks at what was
 * drawn (a tiny read-back at rest) and moves the exposure a fraction of a stop toward a picture that is neither crushed
 * nor washed. It is a bias per room, learned only while the view is at rest, so walking never makes it pump.
 */

/** Statistics of one read-back of the finished picture (0..255 luminance, shares 0..1). */
export interface TrimSample {
  mean: number;
  /** Share of texels that are near white (windows, lamp shades). */
  high: number;
  /** Share of texels that are near black. */
  low: number;
}

/** Most stops the trim may take away or add. */
export const TRIM_MIN_EV = -1.5;
export const TRIM_MAX_EV = 0.8;
/** Largest change per read-back (stops). */
export const TRIM_STEP_EV = 0.4;
/** Changes smaller than this are not made (no hunting around the target). */
export const TRIM_DEADBAND_EV = 0.06;
/** Mean display luminance (0..1) above which the picture counts as washed, and below which as crushed. */
export const TRIM_WASHED = 0.6;
export const TRIM_CRUSHED = 0.26;
/** Mean luminance a washed picture is brought toward, and a crushed one. */
const WASHED_TARGET = 0.52;
const CRUSHED_TARGET = 0.3;

/** The trim after one more read-back of a picture drawn with `current`. */
export function nextTrim(current: number, s: TrimSample): number {
  if (!Number.isFinite(s.mean) || s.mean <= 0 && s.high <= 0) return current;
  const key = Math.max(1e-3, s.mean / 255);
  let want = 0;
  if (key > TRIM_WASHED) want = -Math.log2(key / WASHED_TARGET);
  else if (key < TRIM_CRUSHED && s.high < 0.04) want = 0.7 * Math.log2(CRUSHED_TARGET / key);
  else if (s.high > 0.15 && key > 0.45) want = -0.25;
  const step = Math.max(-TRIM_STEP_EV, Math.min(TRIM_STEP_EV, want));
  if (Math.abs(step) < TRIM_DEADBAND_EV) return current;
  return Math.max(TRIM_MIN_EV, Math.min(TRIM_MAX_EV, current + step));
}
