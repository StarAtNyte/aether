/**
 * Cinematic colour grade derived from the sky, applied in the post pass
 * (linear HDR, before tone mapping). Pure policy, so it is unit-tested:
 *
 * - split toning: highlights lean toward the key light's colour (golden at
 *   sunset, cool under the moon), shadows toward the sky's zenith,
 * - saturation follows the light (rich by day, muted at night),
 * - a gentle contrast pivot around mid grey (log space).
 *
 * The grade is a handful of ALU operations inside the existing composite
 * pass: no extra render target, no extra pass.
 */
import type { SkyState } from '../environment/sky-state';
import { evScale, whiteBalance, type GradePreset } from './finishing';
import { GRADE_CONTRAST_MAX, GRADE_SATURATION_MAX } from '../environment/light-balance';

/** Grade parameters (linear RGB tints). */
export interface Grade {
  saturation: number;
  contrast: number;
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  /** Linear exposure multiplier applied in the post pass (default 1). */
  exposure?: number;
  /** Linear white-balance multipliers (default identity). */
  balance?: [number, number, number];
  /** Grain amplitude multiplier (default 1). */
  grain?: number;
  /** Strength of the AgX look (see `agx-look.ts`; default 0 = AgX Base). */
  look?: number;
}

/** Neutral grade (identity). */
export const NEUTRAL_GRADE: Readonly<Grade> = Object.freeze({ saturation: 1, contrast: 1, shadowTint: [1, 1, 1] as [number, number, number], highlightTint: [1, 1, 1] as [number, number, number] });

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear RGB of "#rrggbb" (white for invalid input). */
export function hexLinear(hex: string): [number, number, number] {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return [1, 1, 1];
  const n = parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

/** A tint: `amount` of the colour's chroma, normalised to unit luminance (keeps exposure). */
function tint(rgb: [number, number, number], amount: number): [number, number, number] {
  const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  if (!(l > 1e-4)) return [1, 1, 1];
  const n = [rgb[0] / l, rgb[1] / l, rgb[2] / l];
  const out: [number, number, number] = [1 + ((n[0] as number) - 1) * amount, 1 + ((n[1] as number) - 1) * amount, 1 + ((n[2] as number) - 1) * amount];
  // Clamp extreme chroma (saturated sky colours) to a subtle range.
  for (let i = 0; i < 3; i++) out[i] = Math.min(1.25, Math.max(0.8, out[i] as number));
  return out;
}

/** The grade of a sky state. */
export function gradeFor(sky: Pick<SkyState, 'lightColor' | 'zenith' | 'elevation' | 'moon' | 'sunGlowStrength'>): Grade {
  const golden = Math.max(0, Math.min(1, sky.sunGlowStrength));
  const night = sky.moon || sky.elevation < -2;
  return {
    saturation: night ? 0.86 : 1.04 + 0.06 * golden,
    contrast: night ? 1.02 : 1.05,
    shadowTint: tint(hexLinear(sky.zenith), night ? 0.22 : 0.14),
    // The light itself is already the sun's colour: the highlights lean toward it only a little more (at golden hour 0.22 of
    // its chroma on top turned white stucco salmon).
    highlightTint: tint(hexLinear(sky.lightColor), night ? 0.12 : 0.08 + 0.06 * golden),
  };
}

/**
 * Layer a named look on a sky-derived grade: the preset's saturation and contrast scale the grade's,
 * its exposure offset and white balance go to the post pass, and the grain follows it.
 */
export function gradeWithPreset(base: Grade, preset: Pick<GradePreset, 'saturation' | 'contrast' | 'exposureEv' | 'temperature' | 'tint' | 'grain' | 'look'>): Grade {
  // Both factors are looks of their own; stacked (a golden sky's 1.1 times a world's 1.2) they dyed the picture. The total is
  // bounded; a preset below neutral (night, overcast) keeps its own value.
  const saturation = base.saturation * preset.saturation;
  const contrast = base.contrast * preset.contrast;
  return {
    saturation: saturation > 1 ? Math.min(GRADE_SATURATION_MAX, saturation) : saturation,
    contrast: contrast > 1 ? Math.min(GRADE_CONTRAST_MAX, contrast) : contrast,
    shadowTint: base.shadowTint,
    highlightTint: base.highlightTint,
    exposure: (base.exposure ?? 1) * evScale(preset.exposureEv),
    balance: whiteBalance(preset.temperature, preset.tint),
    grain: preset.grain,
    look: preset.look ?? 0,
  };
}
