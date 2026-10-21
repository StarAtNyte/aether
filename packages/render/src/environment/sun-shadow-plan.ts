/**
 * Sun shadow policy (pure, unit-tested): how many shadow maps the sun gets on each render tier, how large, how they are
 * filtered and where the near ones sit.
 *
 * A single map fitted to the content (`shadow-fit.ts`) spends the same texel size everywhere: 15 cm on a 300 m level,
 * so a chair leg or a boot has no shadow of its own. Cascades add finer maps around what the eye looks at. Unlike the
 * classic view-frustum split (three's `CSMShadowNode` places its slices along the view depth from the camera's near
 * plane, which wastes the finest map on the air in front of an orbit camera 60 m from its subject), the near cascades
 * here are boxes centred on the focus of the view (the orbit target or the ground point the eye looks at), each a few
 * times larger than the last, and the outermost map stays the static content fit. A box only moves by whole texels
 * and only changes size in coarse steps with hysteresis, so shadow edges do not crawl while the camera orbits or walks.
 *
 * Filtering: `pcf` is three's rotated-disk PCF with a radius chosen per map so the penumbra has the same width in metres
 * in every cascade; `pcss` (high and ultra tiers and stills, which accumulate frames through temporal AA) estimates
 * the distance to the blocker and widens the penumbra with it, so a table leg's shadow is sharp where the leg meets the
 * floor and soft at the tip of a tree's shadow.
 */
import type { RenderTier } from '../gpu/finishing';

/** Shadow filtering of the sun. */
export type SunShadowFilter = 'pcf' | 'pcss';

/** What the sun's shadows are for the current tier and world. */
export interface SunShadowPlan {
  /** Shadow maps (1: the single content-fitted map; more: focus cascades plus the content fit as the outermost). */
  cascades: number;
  /** Edge (texels) of the near cascades. */
  nearMapSize: number;
  /** Edge (texels) of the outermost (content-fitted) map. */
  outerMapSize: number;
  filter: SunShadowFilter;
  /** Blocker-search taps of the soft filter (each tests four depths). */
  blockerSamples: number;
  /** Filter taps of the soft filter. */
  filterSamples: number;
  /** Apparent angular diameter of the sun used for penumbrae (radians). */
  sunAngle: number;
  /** Smallest penumbra (metres) in every map: hides texel steps. */
  minPenumbra: number;
  /** Half size (m) of the first focus cascade before distance scaling clamps it. */
  focusMin: number;
  focusMax: number;
  /** Size ratio between consecutive focus cascades. */
  ratio: number;
  /** Largest half size (m) of the outermost map. */
  outerMaxHalf: number;
  /** Identity of the parts that need a shader rebuild when they change. */
  key: string;
}

/** Inputs of {@link planSunShadows}. */
export interface SunShadowInput {
  tier: RenderTier;
  /** A still (studio / final quality). */
  still: boolean;
  /** Largest shadow map edge the budget allows. */
  shadowMapCap: number;
  /** Radius (m) of the meaningful content. */
  contentRadius: number;
  /** Block terrain shades itself with a column-height field (`voxel/shadow-field.ts`). */
  voxel: boolean;
  /** Software rasteriser. */
  software?: boolean;
}

/** Content smaller than this (radius, m) is sharp enough with one fitted map: no cascades. */
export const CASCADE_MIN_RADIUS = 16;
/**
 * Apparent sun diameter for penumbrae (radians, about 1.1 degrees). The disc is 0.53 degrees; haze and the
 * bright aureole around it widen real sun shadows, and a render reads as a photograph when a shadow 5 m from its
 * caster is softened by about 10 cm.
 */
export const SUN_ANGLE = 0.019;
/** Cascades per tier (including the content fit). */
export const TIER_CASCADES: Readonly<Record<RenderTier, number>> = Object.freeze({ low: 1, medium: 2, high: 3, ultra: 4 });
/** Cascades of a still. */
export const STILL_CASCADES = 4;
/** Fraction of a near cascade (from its edge inwards) over which it blends into the next one. */
export const CASCADE_BLEND = 0.18;

function finitePositive(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** The sun shadow plan for a tier, budget and world. */
export function planSunShadows(input: SunShadowInput): SunShadowPlan {
  const cap = Math.max(256, Math.floor(finitePositive(input.shadowMapCap, 1024)));
  const radius = finitePositive(input.contentRadius, 0);
  const tier: RenderTier = input.still ? 'ultra' : input.tier;
  const soft = input.still || tier === 'high' || tier === 'ultra';
  const filter: SunShadowFilter = soft && input.software !== true ? 'pcss' : 'pcf';
  let cascades = input.still ? STILL_CASCADES : TIER_CASCADES[tier];
  if (input.voxel || radius < CASCADE_MIN_RADIUS || input.software === true) cascades = 1;
  // Integrated GPUs (medium) get a cheaper near map; stills keep the doubled budget for the content fit only.
  const nearMapSize = cascades === 1 ? 0 : tier === 'medium' ? Math.min(cap, 1024) : Math.min(cap, 2048);
  const outerMapSize = cap;
  const blockerSamples = input.still ? 8 : 6;
  const filterSamples = input.still ? 16 : 10;
  const plan = {
    cascades,
    nearMapSize,
    outerMapSize,
    filter,
    blockerSamples,
    filterSamples,
    sunAngle: SUN_ANGLE,
    minPenumbra: 0.012,
    focusMin: 5,
    focusMax: 40,
    ratio: 3.5,
    outerMaxHalf: cascades > 1 ? 320 : 160,
  };
  return { ...plan, key: `${cascades}:${nearMapSize}:${filter}:${blockerSamples}:${filterSamples}` };
}

/** Quantise a half size to steps of √2 (4, 5.66, 8, …) so a box changes size rarely. */
export function quantizeHalf(h: number): number {
  if (!Number.isFinite(h) || h <= 0) return 1;
  return 2 ** (Math.round(Math.log2(h) * 2) / 2);
}

/**
 * The half size of the first focus cascade for a view `distance` (m) from the eye to the focus, keeping `previous`
 * while the wanted size stays within a step of it (no flicker between two sizes at a boundary).
 */
export function focusHalf(distance: number, previous: number, plan: Pick<SunShadowPlan, 'focusMin' | 'focusMax'>): number {
  const want = Math.max(plan.focusMin, Math.min(plan.focusMax, (Number.isFinite(distance) ? distance : plan.focusMin) * 0.5));
  if (previous > 0 && want <= previous * 1.45 && want >= previous / 1.45) return previous;
  return quantizeHalf(want);
}

/** Snap a light-space coordinate to whole texels of a map (texel size `texel` m), so edges do not crawl. */
export function snapToTexel(v: number, texel: number): number {
  if (!Number.isFinite(v)) return 0;
  if (!Number.isFinite(texel) || texel <= 0) return v;
  return Math.round(v / texel) * texel;
}

/** PCF radius (texels) that gives a penumbra of `metres` in a map whose texels are `texel` m wide. */
export function pcfRadius(metres: number, texel: number): number {
  if (!Number.isFinite(texel) || texel <= 0) return 1;
  return Math.max(1, Math.min(6, metres / texel));
}

/**
 * The focus of a view: the orbit target when it lies ahead of the eye inside the view cone and within `maxDistance`,
 * else the point where the view ray meets the ground plane, else a point `fallback` m ahead. Writes into `out`
 * (x, y, z) and returns the distance from the eye. Pure and allocation-free.
 */
export function viewFocus(
  eye: readonly [number, number, number],
  forward: readonly [number, number, number],
  target: readonly [number, number, number] | null,
  groundY: number,
  halfFov: number,
  maxDistance: number,
  fallback: number,
  out: [number, number, number],
): number {
  const [ex, ey, ez] = eye;
  const fl = Math.hypot(forward[0], forward[1], forward[2]) || 1;
  const fx = forward[0] / fl;
  const fy = forward[1] / fl;
  const fz = forward[2] / fl;
  if (target && target.every(Number.isFinite)) {
    const dx = target[0] - ex;
    const dy = target[1] - ey;
    const dz = target[2] - ez;
    const d = Math.hypot(dx, dy, dz);
    if (d > 0.5 && d <= maxDistance && (dx * fx + dy * fy + dz * fz) / d >= Math.cos(Math.min(1.4, halfFov * 1.15))) {
      out[0] = target[0];
      out[1] = target[1];
      out[2] = target[2];
      return d;
    }
  }
  let t = fallback;
  if (Number.isFinite(groundY) && fy < -0.03) t = Math.min(maxDistance, Math.max(1, (groundY - ey) / fy));
  if (!Number.isFinite(t) || t <= 0) t = fallback;
  out[0] = ex + fx * t;
  out[1] = ey + fy * t;
  out[2] = ez + fz * t;
  return t;
}
