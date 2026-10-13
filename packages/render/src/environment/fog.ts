/**
 * Fog policy: turns `environment.fog` (or the preset's haze) into an
 * exponential-squared fog density scaled to the size of the content, and a
 * fog color matched to the sky horizon. Pure (no three.js).
 *
 * `FogExp2` attenuates as `1 - exp(-(density × distance)²)`, so a density
 * that looks right for a 10 m bowling lane turns a 150 m village into a
 * white wall. The policy therefore caps the density so content at framing
 * distance stays clear (≤ ~15 % fog) while scenery several times further out
 * (backdrop mountains, the horizon skirt) fades into the sky.
 */
import type { Environment } from '@aether/core';
import { mixHex, type SkyState } from './sky-state';

/** Absolute density cap honored for any world (higher values are a wall). */
export const MAX_FOG_DENSITY = 0.25;
/** Content radii are clamped into this range (metres) before scaling the fog. */
export const FOG_RADIUS_RANGE: readonly [number, number] = Object.freeze([6, 150]) as readonly [number, number];
/** How strongly a world fog color is pulled toward the sky horizon (0 = untouched). */
export const FOG_HORIZON_PULL = 0.45;

/** Resolved fog parameters. */
export interface FogParams {
  /** "#rrggbb". */
  color: string;
  /** FogExp2 density. */
  density: number;
}

/** Density of the preset haze for a content radius (`amount` = {@link SkyState.hazeDensity}). */
export function hazeDensity(amount: number, radius: number): number {
  if (!(amount > 0)) return 0;
  const r = clampRadius(radius);
  return amount / (r * 4 + 120);
}

/** Largest world-fog density that keeps content of `radius` readable from framing distance. */
export function maxContentFogDensity(radius: number): number {
  return 0.45 / (clampRadius(radius) * 3 + 20);
}

function clampRadius(radius: number): number {
  const [lo, hi] = FOG_RADIUS_RANGE;
  return Number.isFinite(radius) ? Math.min(hi, Math.max(lo, radius)) : lo;
}

/**
 * Fog for an environment, its computed sky and the radius of the meaningful
 * content (see `contentFraming`). Null when there is no fog at all (space,
 * studio without a world fog).
 */
export function resolveFog(env: Pick<Environment, 'fog' | 'ground'>, sky: SkyState, contentRadius: number): FogParams | null {
  const haze = sky.showGround && env.ground ? hazeDensity(sky.hazeDensity, contentRadius) : 0;
  const fog = env.fog;
  if (fog && Number.isFinite(fog.density) && fog.density > 0) {
    const wanted = Math.min(MAX_FOG_DENSITY, fog.density);
    const density = Math.max(haze, Math.min(wanted, maxContentFogDensity(contentRadius)));
    return { color: mixHex(fog.color, sky.fogColor, FOG_HORIZON_PULL), density };
  }
  return haze > 0 ? { color: sky.fogColor, density: haze } : null;
}
