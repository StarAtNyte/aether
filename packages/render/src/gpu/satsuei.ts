/**
 * The compositing layer of a painted (anime) world as pure policy (no three.js, unit-tested): the world's defaults from
 * `environment.look.satsuei`, the per-shot grade a cinematic animates on top of them, and the values the post chain's
 * uniforms take. Everything here is a uniform: a shot grade never builds or links a program (see `post.ts`, where the
 * effects are built into the composite whenever the world's look is anime).
 *
 * The layer (all screen space, in the one composite pass plus one quarter-resolution pass for the light rays):
 * - bloom on what is brighter than white (the sun, lamps, glitter) and a soft diffusion glow of the bright mid-tones
 *   (the sky round the sun, sunlit cloud tops), both through the chain's one bloom;
 * - light rays from the sun: a radial blur toward the sun's screen position of the bright sky round it;
 * - a faint lens flare (ghosts mirrored through the frame centre) and dust motes drifting in the light;
 * - a colour fringe toward the frame corners, the vignette, a fine grain;
 * - a gradient layer: a top and a bottom colour blended over the frame (soft light) at an amount;
 * - letterbox bars toward 2.39:1.
 */

/** A per-shot grade (all optional: an absent field keeps the world's default). */
export interface ShotGrade {
  /** Stops added to the world's exposure. */
  exposureEv?: number;
  /** Multiplies the grade's saturation (1 keeps it). */
  saturation?: number;
  /** Multiplies the grade's contrast (1 keeps it). */
  contrast?: number;
  /** Warm (+) / cool (-) white balance, -1..1, added to the grade's. */
  temperature?: number;
  /** Gradient layer: the colour at the top and at the bottom of the frame ('#rrggbb'), blended (soft light) at `gradientAmount` 0..1. */
  gradientTop?: string;
  gradientBottom?: string;
  gradientAmount?: number;
  /** Multiplies the world's bloom (1 keeps it). */
  bloom?: number;
  /** Soft glow of the bright mid-tones, 0..1. */
  diffusion?: number;
  /** Light rays from the sun, 0..1. */
  godRays?: number;
  /** Lens flare ghosts of the sun, 0..1. */
  flare?: number;
  /** Dust motes drifting in the light, 0..1. */
  dust?: number;
  /** Film grain, 0..1. */
  grain?: number;
  /** Colour fringe toward the frame corners, 0..1. */
  chroma?: number;
  /** Edge darkening, 0..1 (absolute, like `environment.look.vignette`). */
  vignette?: number;
  /** Emissive strength of the world's model materials (lamps, windows, lanterns), 0 off .. 1 as authored. */
  practicals?: number;
  /** Letterbox bars, 0 none .. 1 full 2.39:1. */
  letterbox?: number;
}

/** The world's compositing defaults (`environment.look.satsuei`). */
export interface SatsueiLook {
  diffusion?: number;
  godRays?: number;
  flare?: number;
  dust?: number;
  grain?: number;
  chroma?: number;
  gradientTop?: string;
  gradientBottom?: string;
  gradientAmount?: number;
  letterbox?: number;
  /** Direction toward the painted sun (world space); absent: the world's sun light. */
  sunDirection?: readonly [number, number, number];
}

/** Defaults of an anime world that does not set them. Subtle: the layer finishes the picture, it does not restyle it. */
export const SATSUEI_DEFAULTS = Object.freeze({
  diffusion: 0.35,
  godRays: 0.35,
  flare: 0.25,
  dust: 0.3,
  grain: 0.3,
  chroma: 0.3,
  gradientTop: '#808080',
  gradientBottom: '#808080',
  gradientAmount: 0,
  letterbox: 0,
});

/** What the post chain and the renderer apply. */
export interface SatsueiState {
  /** Added to the grade (stops, additive warmth) and multiplying it (saturation, contrast). */
  exposureEv: number;
  saturation: number;
  contrast: number;
  temperature: number;
  /** Multiplier on the world's bloom. */
  bloom: number;
  diffusion: number;
  godRays: number;
  flare: number;
  dust: number;
  grain: number;
  chroma: number;
  /** Absolute vignette, or null for the world's own. */
  vignette: number | null;
  /** Gradient layer colours in display (sRGB) units 0..1, and its amount. */
  gradientTop: [number, number, number];
  gradientBottom: [number, number, number];
  gradientAmount: number;
  letterbox: number;
  /** Scale of the practicals' emission, or null to leave the materials as authored. */
  practicals: number | null;
}

/** Context of the resolution: the low tier drops the light rays, flare and dust; a tiled capture drops what depends on the frame. */
export interface SatsueiContext {
  lowTier?: boolean;
  /** A tiled capture is drawing (each tile is not the frame): no gradient, flare, letterbox or fringe. */
  tiled?: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const num = (v: unknown, d: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);

/** '#rrggbb' as 0..1 channels (null when it is not one). */
export function parseHex(hex: unknown): [number, number, number] | null {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** The state for a world's defaults and an optional shot grade over them. */
export function resolveSatsuei(look: SatsueiLook | null | undefined, shot: ShotGrade | null | undefined, ctx: SatsueiContext = {}): SatsueiState {
  const l = look ?? {};
  const s = shot ?? {};
  const D = SATSUEI_DEFAULTS;
  const pick = (k: 'diffusion' | 'godRays' | 'flare' | 'dust' | 'grain' | 'chroma' | 'gradientAmount' | 'letterbox'): number => num(s[k], num(l[k], D[k], 0, 1), 0, 1);
  const colour = (k: 'gradientTop' | 'gradientBottom'): [number, number, number] => parseHex(s[k]) ?? parseHex(l[k]) ?? (parseHex(D[k]) as [number, number, number]);
  const low = ctx.lowTier === true;
  const tiled = ctx.tiled === true;
  return {
    exposureEv: num(s.exposureEv, 0, -4, 4),
    saturation: num(s.saturation, 1, 0, 2),
    contrast: num(s.contrast, 1, 0.5, 1.6),
    temperature: num(s.temperature, 0, -1, 1),
    bloom: num(s.bloom, 1, 0, 3),
    diffusion: pick('diffusion'),
    godRays: low ? 0 : pick('godRays'),
    flare: low || tiled ? 0 : pick('flare'),
    dust: low ? 0 : pick('dust'),
    grain: pick('grain'),
    chroma: tiled ? 0 : pick('chroma'),
    vignette: s.vignette !== undefined && Number.isFinite(s.vignette) ? clamp(s.vignette, 0, 1) : null,
    gradientTop: colour('gradientTop'),
    gradientBottom: colour('gradientBottom'),
    gradientAmount: tiled ? 0 : pick('gradientAmount'),
    letterbox: tiled ? 0 : pick('letterbox'),
    practicals: s.practicals !== undefined && Number.isFinite(s.practicals) ? clamp(s.practicals, 0, 1) : null,
  };
}

/** The cinema aspect the letterbox bars reach at full amount. */
export const LETTERBOX_ASPECT = 2.39;

/** Height of each letterbox bar as a share of the frame height (the CPU twin of the composite's mask). */
export function letterboxBar(aspect: number, amount: number): number {
  if (!(aspect > 0) || !(amount > 0)) return 0;
  const full = Math.max(0, (1 - aspect / LETTERBOX_ASPECT) / 2);
  return full * Math.min(1, amount);
}

/**
 * True when an emissive material is a practical light (a lamp, a lantern, a window, a sign): every emissive material of the
 * world's models but the sky's bodies and the sea's glitter, which are not switched on and off with the town's lights.
 */
export function isPracticalMaterial(name: string): boolean {
  const words = name.toLowerCase().split(/[^a-z0-9]+/);
  return !words.some((w) => w === 'sun' || w === 'moon' || w === 'star' || w === 'stars' || w === 'sky' || w === 'glitter' || w === 'glint');
}
