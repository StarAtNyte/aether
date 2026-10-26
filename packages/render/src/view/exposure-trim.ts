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

/** How bright the picture should read: the author's lighting intent (`environment.look.intent.key`). */
export type LightKey = 'dim' | 'moderate' | 'bright';

/** Most stops the trim may take away or add. */
export const TRIM_MIN_EV = -2.5;
export const TRIM_MAX_EV = 1.2;
/** Largest change per read-back (stops). */
export const TRIM_STEP_EV = 0.4;
/** Changes smaller than this are not made (no hunting around the target). */
export const TRIM_DEADBAND_EV = 0.06;
/**
 * Mean display luminance (0..1) the picture may have for an intent: below `lo` it counts as crushed, above `hi` as washed.
 * Inside the band nothing moves, which is what keeps a settled room from pumping.
 */
export const TRIM_BANDS: Record<LightKey, { lo: number; hi: number }> = {
  dim: { lo: 0.15, hi: 0.38 },
  moderate: { lo: 0.26, hi: 0.58 },
  bright: { lo: 0.4, hi: 0.68 },
};
/** Mean luminance of a moderate picture too bright (washed), kept for callers that need one number. */
export const TRIM_WASHED = TRIM_BANDS.moderate.hi;
export const TRIM_CRUSHED = TRIM_BANDS.moderate.lo;

/** What the author wants: the key, and the exposure they set by eye (stops) which only biases the target. */
export interface TrimIntent {
  key?: LightKey;
  /** `log2(exposure) + exposureEv` the author set: a bias on the band, a third of a stop per stop. */
  biasEv?: number;
}

/** The band for an intent, shifted by the author's bias. */
export function trimBand(intent?: TrimIntent): { lo: number; hi: number } {
  const b = TRIM_BANDS[intent?.key ?? 'moderate'];
  const bias = Number.isFinite(intent?.biasEv) ? Math.max(-2, Math.min(2, intent?.biasEv as number)) : 0;
  const f = 2 ** (0.35 * bias);
  return { lo: Math.min(0.9, b.lo * f), hi: Math.min(0.95, b.hi * f) };
}

/**
 * Lowest trim for an intent. The author's own boost (`exposure` above 1, `exposureEv` above 0) is part of the picture the
 * trim sees, so it must be able to take that boost back and still have its whole range to dim a lit room: a model that
 * set +1.1 EV by eye and has lamps on would otherwise stand at the limit with a picture it cannot dim.
 */
export function trimFloor(intent?: TrimIntent): number {
  const boost = Number.isFinite(intent?.biasEv) ? Math.max(0, Math.min(2, intent?.biasEv as number)) : 0;
  return TRIM_MIN_EV - boost;
}

/** The trim after one more read-back of a picture drawn with `current`. */
export function nextTrim(current: number, s: TrimSample, intent?: TrimIntent): number {
  if (!Number.isFinite(s.mean) || s.mean <= 0 && s.high <= 0) return current;
  const key = Math.max(1e-3, s.mean / 255);
  const { lo, hi } = trimBand(intent);
  const washedTarget = hi * 0.87;
  const crushedTarget = lo * 1.2;
  let want = 0;
  if (key > hi) want = -Math.log2(key / washedTarget);
  else if (key < lo && s.high < 0.04) want = 0.7 * Math.log2(crushedTarget / key);
  else if (s.high > 0.15 && key > (lo + hi) / 2) want = -0.25;
  else if (s.low > 0.4 && s.high < 0.04 && key < (lo + hi) / 2) want = 0.3;
  const step = Math.max(-TRIM_STEP_EV, Math.min(TRIM_STEP_EV, want));
  if (Math.abs(step) < TRIM_DEADBAND_EV) return current;
  return Math.max(trimFloor(intent), Math.min(TRIM_MAX_EV, current + step));
}
