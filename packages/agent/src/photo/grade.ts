/**
 * Photo-matched exposure, white balance and tone, measured from pixels.
 *
 * A photograph carries a camera's exposure, a colour cast (tungsten lamps, a window of cold sky, an Instagram-style
 * filter) and a tone curve. A render of the same room never matches those by accident, which makes a correct room
 * look wrong next to its photo and makes the pixel similarity punish it for the wrong reason. This module reads the
 * grade off the picture ({@link estimatePhotoGrade}), says how a render must move to share it
 * ({@link matchGrade}), and applies that move to pixels ({@link applyGrade}); {@link nextExposure} turns the same
 * measurement into the environment's exposure for the next render.
 *
 * Pure functions on RGBA rasters, bounded work (a fixed analysis grid), no model.
 */
import { isRaster, resampleRgb, type Raster } from './score';

/** What a picture's grade is, in sRGB display space. */
export interface PhotoGrade {
  /** Median luminance, 0..1. */
  median: number;
  /** 5th and 95th percentile of luminance, 0..1. */
  p5: number;
  p95: number;
  /** Mean saturation (HSV), 0..1. */
  saturation: number;
  /** Colour of the light as red, green and blue gains that would turn the brightest near-neutral surfaces grey (green = 1). */
  cast: [number, number, number];
  /** Warm (+) or cool (-) cast, -1..1: how far the white point leans towards orange or blue. */
  warmth: number;
}

/** How a render is moved to share a photo's grade. */
export interface GradeMatch {
  /** Per channel linear gain (applied in linear light). */
  gain: [number, number, number];
  /** Tone curve exponent on luminance (below 1 lifts the midtones). */
  gamma: number;
  /** Saturation multiplier. */
  saturation: number;
  /** Contrast multiplier about the median. */
  contrast: number;
}

const GRID_W = 64;
/** Largest white balance correction applied (a coloured wall must not be read as a cast). */
const MAX_CAST = 1.28;

const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const enc = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function percentile(sorted: Float32Array, q: number): number {
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))] as number);
}

/**
 * Read the grade of a picture. The white point comes from the brightest pixels that are nearly neutral (a white
 * duvet, a lampshade, painted plaster): a strongly coloured scene has few of them, so the cast is then pulled
 * towards neutral instead of trusted. Returns null for a malformed raster.
 */
export function estimatePhotoGrade(r: Raster): PhotoGrade | null {
  if (!isRaster(r)) return null;
  const h = Math.max(8, Math.min(96, Math.round((GRID_W * r.height) / r.width)));
  const px = resampleRgb(r, GRID_W, h);
  const n = px.length / 3;
  const ys = new Float32Array(n);
  let sat = 0;
  for (let i = 0; i < n; i++) {
    const R = (px[i * 3] as number) / 255;
    const G = (px[i * 3 + 1] as number) / 255;
    const B = (px[i * 3 + 2] as number) / 255;
    ys[i] = lum(R, G, B);
    const mx = Math.max(R, G, B);
    sat += mx > 0 ? (mx - Math.min(R, G, B)) / mx : 0;
  }
  const sorted = ys.slice().sort();
  const median = percentile(sorted, 0.5);
  const p5 = percentile(sorted, 0.05);
  const p95 = percentile(sorted, 0.95);
  // Near-neutral highlights: the top quarter of luminance whose chroma is small.
  const lo = percentile(sorted, 0.85);
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    if ((ys[i] as number) < lo) continue;
    const R = lin((px[i * 3] as number) / 255);
    const G = lin((px[i * 3 + 1] as number) / 255);
    const B = lin((px[i * 3 + 2] as number) / 255);
    const mx = Math.max(R, G, B);
    const chroma = mx > 0 ? (mx - Math.min(R, G, B)) / mx : 0;
    if (chroma > 0.85 || mx < 0.05 || Math.max(px[i * 3] as number, px[i * 3 + 1] as number, px[i * 3 + 2] as number) > 247) continue;
    sr += R;
    sg += G;
    sb += B;
    cnt++;
  }
  // Too few neutral pixels: no cast is claimed. Few but some: the cast is only partly trusted.
  const trust = clamp(cnt / (n * 0.03), 0, 1);
  const castOf = (a: number): number => (sg > 0 && a > 0 ? clamp(1 + (sg / a - 1) * trust, 1 / MAX_CAST, MAX_CAST) : 1);
  const cast: [number, number, number] = [castOf(sr), 1, castOf(sb)];
  // Warm light has its red high and its blue low: the correction that neutralises it lowers red and raises blue.
  const warmth = clamp(Math.log(cast[2] / cast[0]) / Math.log(1.6), -1, 1);
  return { median, p5, p95, saturation: sat / n, cast, warmth };
}

/**
 * How `render` has to move to look like it was photographed the way `photo` was: the white point (the photo's cast
 * relative to the render's), the midtone level, the contrast and the saturation. All steps are bounded so a
 * mismatch of content (a render with a different amount of window) cannot produce an extreme image.
 */
export function matchGrade(photo: PhotoGrade, render: PhotoGrade): GradeMatch {
  // Cast: the render is brought to the photo's white point. photo.cast neutralises the photo, so the photo's own
  // white is 1/photo.cast; the render's is 1/render.cast.
  const g = (c: number): number => clamp(render.cast[c] === 0 ? 1 : photo.cast[c]! === 0 ? 1 : render.cast[c]! / photo.cast[c]!, 1 / MAX_CAST, MAX_CAST);
  const gain: [number, number, number] = [g(0), 1, g(2)];
  const gamma = clamp(Math.log(clamp(photo.median, 0.04, 0.96)) / Math.log(clamp(render.median, 0.04, 0.96)), 0.55, 1.8);
  const spreadPhoto = Math.max(0.05, photo.p95 - photo.p5);
  const spreadRender = Math.max(0.05, render.p95 - render.p5);
  return {
    gain,
    gamma,
    saturation: clamp(photo.saturation / Math.max(0.03, render.saturation), 0.6, 1.6),
    contrast: clamp(spreadPhoto / spreadRender, 0.7, 1.4),
  };
}

/** Apply a {@link GradeMatch} to pixels in place (RGBA, alpha untouched). Returns the same raster. */
export function applyGrade(r: Raster, m: GradeMatch): Raster {
  if (!isRaster(r)) return r;
  const d = r.data;
  const total = r.width * r.height;
  // Contrast pivots on mid grey after the tone curve; saturation works around the pixel's own luminance.
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    let R = lin((d[o] as number) / 255) * m.gain[0];
    let G = lin((d[o + 1] as number) / 255) * m.gain[1];
    let B = lin((d[o + 2] as number) / 255) * m.gain[2];
    const y = lum(R, G, B);
    if (y > 1e-6) {
      const yEnc = enc(clamp(y, 0, 1));
      const curved = clamp(0.5 + (yEnc ** m.gamma - 0.5) * m.contrast, 0, 1);
      const scale = lin(curved) / y;
      R *= scale;
      G *= scale;
      B *= scale;
      const y2 = lum(R, G, B);
      R = y2 + (R - y2) * m.saturation;
      G = y2 + (G - y2) * m.saturation;
      B = y2 + (B - y2) * m.saturation;
    }
    d[o] = Math.round(enc(clamp(R, 0, 1)) * 255);
    d[o + 1] = Math.round(enc(clamp(G, 0, 1)) * 255);
    d[o + 2] = Math.round(enc(clamp(B, 0, 1)) * 255);
  }
  return r;
}

/**
 * The environment exposure for the next render: the current one scaled so the render's median luminance moves
 * towards the photo's. One damped step per round (a render's tone mapping is not linear), within 0.6..1.8.
 */
export function nextExposure(current: number, photo: PhotoGrade, render: PhotoGrade): number {
  const target = clamp(photo.median, 0.05, 0.95);
  const have = clamp(render.median, 0.03, 0.97);
  // Median luminance in display space is about linear light ^ (1/2.2): the ratio in linear light, damped.
  const ratio = (target / have) ** (2.2 * 0.7);
  return Math.round(clamp(current * clamp(ratio, 0.6, 1.7), GRADE_RANGE.exposure[0], GRADE_RANGE.exposure[1]) * 100) / 100;
}

/** The environment fields a grade implies for the photo's light: warm photos get a lower, warmer sun. */
export function lightFromGrade(grade: PhotoGrade): { exposureHint: number; warmth: 'cool' | 'neutral' | 'warm' } {
  return { exposureHint: clamp(0.6 + grade.median * 1.6, 0.6, 2.2), warmth: grade.warmth > 0.18 ? 'warm' : grade.warmth < -0.18 ? 'cool' : 'neutral' };
}

/** The range the environment grade may reach (inside the schema's: a photo's grade is a hint, not a filter). */
export const GRADE_RANGE = Object.freeze({ temperature: 0.35, saturation: [0.8, 1.25] as const, contrast: [0.9, 1.2] as const, exposure: [0.6, 1.8] as const });

/** The `grade` field of the world's environment (see `Environment.grade`). */
export interface EnvironmentGrade {
  temperature: number;
  saturation: number;
  contrast: number;
}

/**
 * The environment grade that moves the renderer's look by `m` (a {@link GradeMatch} of the latest render against the
 * photo), on top of the grade already set: the white balance follows the red/blue gains (the renderer's balance moves red
 * by 0.16 and blue by -0.2 per unit), saturation and contrast multiply. One damped step, bounded to the schema's range.
 */
export function nextEnvironmentGrade(current: Partial<EnvironmentGrade> | undefined, m: GradeMatch): EnvironmentGrade {
  const dtR = (m.gain[0] - 1) / 0.16;
  const dtB = (1 - m.gain[2]) / 0.2;
  const dt = (dtR + dtB) / 2;
  // Gentle: a photograph and a render never frame the same content, so their global statistics differ for reasons that are
  // not grade; the step is half the measured difference and the result stays within a modest range.
  const damp = 0.5;
  return {
    temperature: Math.round(clamp((current?.temperature ?? 0) + dt * damp, -GRADE_RANGE.temperature, GRADE_RANGE.temperature) * 1000) / 1000,
    saturation: Math.round(clamp((current?.saturation ?? 1) * (1 + (m.saturation - 1) * damp), GRADE_RANGE.saturation[0], GRADE_RANGE.saturation[1]) * 1000) / 1000,
    contrast: Math.round(clamp((current?.contrast ?? 1) * (1 + (m.contrast - 1) * damp), GRADE_RANGE.contrast[0], GRADE_RANGE.contrast[1]) * 1000) / 1000,
  };
}
