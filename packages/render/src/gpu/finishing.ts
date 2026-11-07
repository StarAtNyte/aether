/**
 * The cinematic finishing chain as pure policy (no three.js, unit-tested): which effects each render
 * tier runs, how the tier follows the GPU budget automatically, what a user toggle changes, how a
 * failing effect degrades the chain and how the sun-matched colour-grade presets look.
 *
 * Tiers (interactive unless noted):
 * - `low`    — no post pass: direct MSAA rendering with the sky-derived tone curve (software rasterisers,
 *              low-memory mode, the e2e suites).
 * - `medium` — one composite pass: bloom, colour grade, vignette, fine grain.
 * - `high`   — adds ground-truth ambient occlusion (applied to indirect light only), temporal
 *              anti-aliasing from a normal/velocity pre-pass and screen-space contact shadows of the sun.
 * - `ultra`  — adds screen-space reflections for glossy surfaces, sun shafts ray-marched through the
 *              sun's shadow map, a wide warm halation bloom and a trace of chromatic aberration.
 *
 * The *studio* and *final* qualities (stills) always run the ultra chain; final also turns on depth of
 * field and refines for far longer. See `render-quality.ts`.
 */
import type { GpuTier, RenderBudget } from './budget';

/** Render tier chosen by the user, or picked automatically from the GPU budget. */
export type RenderTier = 'low' | 'medium' | 'high' | 'ultra';

/** Every tier, cheapest first. */
export const RENDER_TIERS: readonly RenderTier[] = Object.freeze(['low', 'medium', 'high', 'ultra'] as RenderTier[]);

/** One independently switchable effect of the post chain. */
export interface PostEffects {
  /** Bloom + grade + vignette composite (the post pass itself). */
  composite: boolean;
  /** Ground-truth ambient occlusion on the indirect light. */
  ao: boolean;
  /** Screen-space global illumination (experimental, off in every tier: a noisy single bounce of the lit surfaces on screen; switch it on in Settings). */
  gi: boolean;
  /** Temporal anti-aliasing (needs the velocity pre-pass). */
  taa: boolean;
  /** Screen-space contact shadows of the sun: feet, chair legs and small props grounded where the shadow map is too coarse. */
  contact: boolean;
  /** Screen-space reflections (glass, polished floors, water, metals). */
  ssr: boolean;
  /** Sun shafts ray-marched through the sun shadow map. */
  shafts: boolean;
  /** Wide warm halation bloom around bright light sources. */
  halation: boolean;
  /** Subtle chromatic aberration towards the frame edges. */
  aberration: boolean;
  /** Fine film grain (also dithers 8-bit banding in skies). */
  grain: boolean;
  /** Depth of field around the orbit target (final stills only). */
  dof: boolean;
  /**
   * The compositing layer of a painted (anime) world, built into the composite (see `satsuei.ts`): diffusion glow, light
   * rays from the sun, lens flare, dust motes, corner fringe, grain, gradient layer and letterbox, all driven by uniforms.
   * Optional: absent is off (realistic worlds never set it).
   */
  satsuei?: boolean;
}

/** The effect keys, in the order they degrade when one fails (first dropped first). */
export const DEGRADE_ORDER: readonly (keyof PostEffects)[] = Object.freeze(['dof', 'gi', 'satsuei', 'shafts', 'ssr', 'contact', 'halation', 'aberration', 'taa', 'ao'] as (keyof PostEffects)[]);

/** Effects that need the normal / velocity pre-pass. */
export function needsPrePass(e: PostEffects): boolean {
  // Sun shafts are not on the list: they march the scene pass's own depth when there is no pre-pass.
  return e.ao || e.gi || e.taa || e.contact || e.ssr || e.dof;
}

const NONE: PostEffects = Object.freeze({ composite: false, ao: false, gi: false, taa: false, contact: false, ssr: false, shafts: false, halation: false, aberration: false, grain: false, dof: false });

/** The effects of a tier. */
export function effectsOf(tier: RenderTier): PostEffects {
  switch (tier) {
    case 'low':
      return NONE;
    case 'medium':
      return { ...NONE, composite: true };
    case 'high':
      // No temporal AA and no grain while interactive: MSAA keeps edges steady, the AO is denoised in the same frame, and nothing
      // shimmers or crawls when the camera moves. Temporal AA, grain and the rest belong to ultra and to stills.
      return { ...NONE, composite: true, ao: true, contact: true };
    case 'ultra':
      return { ...NONE, composite: true, ao: true, taa: true, contact: true, ssr: true, shafts: true, halation: true, aberration: true, grain: true };
  }
}

/** Effects of a still (studio / final): the ultra chain, plus depth of field for final. */
export function stillEffects(final: boolean): PostEffects {
  return { ...effectsOf('ultra'), dof: final };
}

/**
 * The tier a GPU budget affords by default. Software rasterisers and low-memory mode get `low`;
 * integrated and unknown GPUs `medium` (one cheap composite pass); discrete GPUs `high`.
 * `ultra` is always an explicit choice.
 */
export function autoTier(gpu: GpuTier, budget: Pick<RenderBudget, 'post'>): RenderTier {
  if (!budget.post || gpu === 'software') return 'low';
  if (gpu === 'discrete') return 'high';
  return 'medium';
}

/** True when `value` names a tier. */
export function isRenderTier(value: unknown): value is RenderTier {
  return typeof value === 'string' && (RENDER_TIERS as readonly string[]).includes(value);
}

/** User toggles: `undefined` keeps the tier's choice, a boolean forces the effect on or off. */
export type EffectOverrides = Partial<Record<keyof PostEffects, boolean>>;

/**
 * Apply user toggles and the effects that failed on this device. Dependencies are kept coherent:
 * temporal AA, reflections, shafts and depth of field cannot run without the composite pass, so
 * switching `composite` off switches the whole chain off; AO and the others stay independent.
 */
export function resolveEffects(base: PostEffects, overrides: EffectOverrides = {}, failed: ReadonlySet<keyof PostEffects> = new Set()): PostEffects {
  const out: PostEffects = { ...base };
  for (const key of Object.keys(out) as (keyof PostEffects)[]) {
    const forced = overrides[key];
    if (typeof forced === 'boolean') out[key] = forced;
    if (failed.has(key)) out[key] = false;
  }
  if (!out.composite) return { ...NONE };
  return out;
}

/** The next effect to drop when the chain fails to build or draw (null: nothing left to drop). */
export function degrade(effects: PostEffects): { effects: PostEffects; dropped: keyof PostEffects } | null {
  for (const key of DEGRADE_ORDER) {
    if (effects[key]) return { effects: { ...effects, [key]: false }, dropped: key };
  }
  return null;
}

/** Stable key of an effect set (a pipeline is rebuilt when it changes). */
export function effectsKey(e: PostEffects): string {
  // The compositing layer adds a character only when on: the keys of realistic chains stay as they were.
  return (Object.keys(NONE) as (keyof PostEffects)[]).map((k) => (e[k] ? '1' : '0')).join('') + (e.satsuei ? 's' : '');
}

// ---------------------------------------------------------------------------
// Colour-grade presets
// ---------------------------------------------------------------------------

/** Tone-mapping operator of a grade. */
export type ToneCurve = 'agx' | 'aces' | 'neutral' | 'linear';

/** A named look: sun-matched grading of the linear HDR image before the tone curve. */
export interface GradePreset {
  id: GradePresetId;
  /** Tone curve (AgX keeps highlights photographic, ACES is punchier, neutral is the Khronos PBR curve). */
  tone: ToneCurve;
  /** Exposure offset in stops (added to the world's own exposure). */
  exposureEv: number;
  saturation: number;
  contrast: number;
  /** Warm (+) / cool (−) white balance in [-1, 1]. */
  temperature: number;
  /** Green (+) / magenta (−) tint in [-1, 1]. */
  tint: number;
  /** Multiplier on the post chain's grain amplitude. */
  grain: number;
  /** Multiplier on the bloom strength. */
  bloom: number;
  /**
   * Strength of the AgX look (0 = AgX Base, 1 = Blender's "Punchy": deeper mid-tones and the chroma the curve takes
   * back; see `agx-look.ts`). Ignored by the other curves. Absent = 0.
   */
  look?: number;
}

/** Preset ids. */
export type GradePresetId = 'archviz-daylight' | 'golden-hour' | 'dusk-interior' | 'overcast' | 'night' | 'neutral' | 'anime';

/** The preset table. Frozen. */
export const GRADE_PRESETS: Readonly<Record<GradePresetId, GradePreset>> = Object.freeze({
  // AgX Base under a clear sun is a grey veil (lifted blacks, dull whites, a golden light turned beige): the sunlit looks
  // take most of Blender's "Punchy" look (and a little less pre-curve saturation, which the look returns); dim and soft
  // light takes less.
  'archviz-daylight': { id: 'archviz-daylight', tone: 'agx', exposureEv: 0.15, saturation: 1.1, contrast: 1.14, temperature: 0.04, tint: 0, grain: 1, bloom: 0.85, look: 0.8 },
  // The low sun is already orange in the light: the golden look warms and saturates less than it once did (0.2 warm, 1.12
  // saturation and the full Punchy look over a sunset sun gave salmon walls and violet shadows).
  'golden-hour': { id: 'golden-hour', tone: 'agx', exposureEv: 0.15, saturation: 1.06, contrast: 1.12, temperature: 0.1, tint: 0.01, grain: 1, bloom: 1.1, look: 0.7 },
  'dusk-interior': { id: 'dusk-interior', tone: 'agx', exposureEv: 0.25, saturation: 1.02, contrast: 1.12, temperature: 0.1, tint: -0.02, grain: 1.2, bloom: 1.25, look: 0.4 },
  overcast: { id: 'overcast', tone: 'agx', exposureEv: 0.2, saturation: 1.04, contrast: 1.14, temperature: -0.06, tint: 0, grain: 1, bloom: 0.7, look: 0.4 },
  night: { id: 'night', tone: 'agx', exposureEv: 0.35, saturation: 0.9, contrast: 1.1, temperature: -0.12, tint: 0, grain: 1.5, bloom: 1.3, look: 0.3 },
  neutral: { id: 'neutral', tone: 'aces', exposureEv: 0, saturation: 1, contrast: 1, temperature: 0, tint: 0, grain: 0.6, bloom: 1 },
  // Painted, cel-shaded worlds (`environment.look.style: 'anime'`): the surfaces already hold their final colour, so the curve
  // is linear (a colour below white is shown as authored: no ACES hue shift toward yellow, no AgX desaturation), the grade
  // is neutral and only what is brighter than white (the sun, lamps, glitter) blooms.
  anime: { id: 'anime', tone: 'linear', exposureEv: 0, saturation: 1, contrast: 1, temperature: 0, tint: 0, grain: 0, bloom: 1 },
});

/**
 * The effects an `anime` world keeps: the composite (bloom, vignette), anti-aliasing and halation, plus the compositing layer
 * (`satsuei`, with its own grain and corner fringe) whenever the composite runs. Ambient occlusion, contact
 * shadows, reflections, GI, sun shafts, aberration and grain shade or texture the picture, and a painted flat colour has
 * nothing for them to add.
 */
export function animeEffects(e: PostEffects): PostEffects {
  return { ...e, ao: false, gi: false, contact: false, ssr: false, shafts: false, aberration: false, grain: false, satsuei: e.composite };
}

/** True when `value` names a preset. */
export function isGradePresetId(value: unknown): value is GradePresetId {
  return typeof value === 'string' && Object.hasOwn(GRADE_PRESETS, value);
}

/** The sky facts a preset is chosen from. */
export interface SkyLook {
  elevation: number;
  moon: boolean;
  sunGlowStrength: number;
  /** The sky preset id ('overcast', 'studio' and 'space' have looks of their own). */
  preset?: string;
}

/** The preset that matches the sky: night, golden hour, overcast or clear daylight. */
export function presetFor(sky: SkyLook): GradePresetId {
  if (sky.preset === 'studio') return 'neutral';
  if (sky.moon || sky.elevation < -2 || sky.preset === 'space') return 'night';
  if (sky.preset === 'overcast') return 'overcast';
  if (sky.sunGlowStrength > 0.45 || sky.elevation < 9) return 'golden-hour';
  return 'archviz-daylight';
}

/** Linear white-balance multipliers of a temperature / tint pair (luminance preserving, subtle). */
export function whiteBalance(temperature: number, tint: number): [number, number, number] {
  const t = Math.max(-1, Math.min(1, Number.isFinite(temperature) ? temperature : 0));
  const g = Math.max(-1, Math.min(1, Number.isFinite(tint) ? tint : 0));
  const r = 1 + 0.16 * t;
  const b = 1 - 0.2 * t;
  const gr = 1 + 0.1 * g;
  const l = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
  return [r / l, gr / l, b / l];
}

/** Exposure multiplier of `ev` stops. */
export function evScale(ev: number): number {
  return 2 ** (Number.isFinite(ev) ? Math.max(-6, Math.min(6, ev)) : 0);
}

/** Grain amplitude (linear display units) of the chain, scaled by the preset. */
export const GRAIN_AMPLITUDE = 0.012;
/** Chromatic aberration strength at the frame corner (UV units; well under a pixel at 1080p). */
export const ABERRATION_STRENGTH = 0.0016;
