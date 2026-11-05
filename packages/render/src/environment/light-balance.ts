/**
 * Bounds on the colour of the light (pure, unit-tested).
 *
 * The sky model already gives the sun its colour for the hour (orange near the horizon) and the sky light its blue. A world's
 * `look.sunTint` and `look.ambientTint` multiply on top, and the grade warms and saturates after that: on Lisbon Hills an
 * orange tint over an orange 17:00 sun, a plum ambient and a +0.18 warm, 1.3 saturation grade turned the white and pastel
 * stucco salmon and the shadows violet. Light in a photograph is never that coloured: a low afternoon sun is about 3500 K
 * (its blue channel near 40 % of its red in linear light), open shade a little blue, and white walls still read white.
 *
 * - a tint keeps at most {@link TINT_MAX_CHROMA} of its chroma (it nudges the light, it does not dye it),
 * - the tinted sun is never more coloured than a 3200 K sun ({@link SUN_MIN_RATIO}),
 * - the tinted sky light never more than {@link AMBIENT_MIN_RATIO}.
 */

/** Linear RGB triple. */
export type Rgb = { r: number; g: number; b: number };

/** Largest chroma (1 - min/max of the linear channels) a look tint keeps. */
export const TINT_MAX_CHROMA = 0.3;
/** Smallest min/max channel ratio of the tinted sun (about a 3200 K sun in linear light). */
export const SUN_MIN_RATIO = 0.36;
/** Smallest min/max channel ratio of the tinted sky (ambient) light. */
export const AMBIENT_MIN_RATIO = 0.55;

/** Chroma of a colour: 1 - min/max of its channels (0 grey, 1 a pure primary). */
export function chroma(c: Rgb): number {
  const hi = Math.max(c.r, c.g, c.b);
  const lo = Math.min(c.r, c.g, c.b);
  return hi > 1e-6 ? 1 - lo / hi : 0;
}

/**
 * Move `c` toward the grey of its own brightest channel until its min/max ratio is at least `minRatio` (in place; returns
 * it). Hue and the brightest channel stay; only the saturation drops.
 */
export function limitChroma<T extends Rgb>(c: T, minRatio: number): T {
  const hi = Math.max(c.r, c.g, c.b);
  if (!(hi > 1e-6)) return c;
  const cur = chroma(c);
  const max = 1 - Math.max(0, Math.min(1, minRatio));
  if (cur <= max) return c;
  // Lerp each channel toward `hi` by k so the new chroma is exactly `max`: chroma scales by (1 - k).
  const k = 1 - max / cur;
  c.r += (hi - c.r) * k;
  c.g += (hi - c.g) * k;
  c.b += (hi - c.b) * k;
  return c;
}

/** A look tint with at most {@link TINT_MAX_CHROMA} of chroma (in place). */
export function boundTint<T extends Rgb>(c: T): T {
  return limitChroma(c, 1 - TINT_MAX_CHROMA);
}

/** Largest total saturation of the grade (sky-derived base times the look's). */
export const GRADE_SATURATION_MAX = 1.16;
/** Smallest total saturation of the grade outside night and stylised looks (no grey world). */
export const GRADE_SATURATION_MIN = 0.8;
/** Largest total contrast of the grade. */
export const GRADE_CONTRAST_MAX = 1.24;
/** Largest white-balance shift a document grade may ask for (the sky already colours the light). */
export const GRADE_TEMPERATURE_MAX = 0.14;
/** Largest green/magenta tint a document grade may ask for. */
export const GRADE_TINT_MAX = 0.08;

/** Clamp `v` into [lo, hi] (non-finite: `fallback`). */
export function within(v: number, lo: number, hi: number, fallback: number): number {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
}
