/**
 * Interior bounce light: the cheapest believable global-illumination term of a building. Daylight that
 * enters through the windows lands on the floor, the floor throws part of it back up, so ceilings and
 * the lower parts of walls are never as dark as a sky-only ambient (whose "ground" half is dark) would
 * make them. The term is one hemisphere light with a black sky half and a warm ground half: a surface
 * facing down receives it in full, a wall half of it, a floor none. Pure (no three.js).
 */
import type { SkyState } from './sky-state';

/** Result of {@link interiorBounce}: the ground colour of the bounce hemisphere and its intensity. */
export interface InteriorBounce {
  color: string;
  intensity: number;
}

/** Albedo of the typical lit floor the bounce comes from (mid-light timber, tile and stone). */
export const BOUNCE_FLOOR_ALBEDO = 0.62;
/** Intensity of the bounce without any sun (sky light alone coming through the windows). */
export const BOUNCE_BASE = 0.6;
/** Intensity added per unit of key-light intensity at full daylight. */
export const BOUNCE_PER_SUN = 0.16;
/** Strength of the neutral ambient fill relative to the bounce intensity (a rendered room is never lit by the sky alone). */
export const INTERIOR_FILL = 0.9;
/** Share of the bounce kept under the moon (lamps carry the night). */
export const BOUNCE_MOON_SHARE = 0.18;

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const v = m ? parseInt(m[1] as string, 16) : 0xffffff;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToHex(c: readonly [number, number, number]): string {
  return `#${c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The bounce of a sky state. Warm sun lands on a warm floor: the colour is the key light mixed toward
 * warm white and darkened by the floor albedo; a low sun bounces less than a high one.
 */
export function interiorBounce(sky: Pick<SkyState, 'lightColor' | 'lightIntensity' | 'elevation' | 'moon' | 'preset'>): InteriorBounce {
  const light = hexToRgb(sky.lightColor);
  const warm = hexToRgb('#ffe9d0');
  const mixed = light.map((c, i) => (c * 0.5 + (warm[i] as number) * 0.5) * BOUNCE_FLOOR_ALBEDO) as [number, number, number];
  const elevation = Number.isFinite(sky.elevation) ? sky.elevation : 0;
  const day = Math.max(0, Math.min(1, Math.sin((elevation * Math.PI) / 180)));
  const sun = Math.max(0, Math.min(4, Number.isFinite(sky.lightIntensity) ? sky.lightIntensity : 0));
  let intensity = BOUNCE_BASE + BOUNCE_PER_SUN * sun * (0.35 + 0.65 * day);
  if (sky.moon || sky.preset === 'space') intensity *= BOUNCE_MOON_SHARE;
  return { color: rgbToHex(mixed), intensity };
}
