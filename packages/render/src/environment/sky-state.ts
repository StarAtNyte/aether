/**
 * Pure sky/sun/ambient parameters derived from `world.environment`. The sky
 * preset is authoritative: `timeOfDay` (or a per-preset default hour) moves
 * the sun only inside the preset's window, so `sky: 'sunset'` always reads
 * as a sunset even when a model asks for 19:00 (when the sun would already
 * be below the horizon). Natural presets (day/dawn/sunset/night) take their
 * sky gradient from the sun elevation; dawn and sunset sample the gradient a
 * few degrees lower than the light ({@link GOLDEN_SKY_DROP}) so the sky
 * glows orange while the key light still rakes across the scene.
 *
 * The sun's compass direction is art-directed relative to the default
 * three-quarter camera ({@link VIEW_AZIMUTH}): a low sun lights the scene
 * from the side (long shadows across the frame, warm lit faces against cool
 * shade) instead of straight from behind the camera (flat) or straight into
 * it (silhouettes). No three.js — unit-tested directly.
 */
import type { Environment, Vec3 } from '@aether/core';

/** Sky preset id. */
export type SkyPreset = Environment['sky'];

/** Everything the environment rig needs to light and color the scene. */
export interface SkyState {
  /** Hour actually used (0–24): `timeOfDay` clamped into the preset's window. */
  hour: number;
  /** Sun elevation in degrees (negative below the horizon). */
  elevation: number;
  /** Unit vector from the scene toward the key light (sun or moon). */
  lightDirection: Vec3;
  /** Key light color "#rrggbb". */
  lightColor: string;
  /** Key light intensity (already scaled by environment.sunIntensity). */
  lightIntensity: number;
  /** True when the key light is the moon. */
  moon: boolean;
  zenith: string;
  horizon: string;
  /** Color below the horizon (visible where there is no ground). */
  nadir: string;
  /** Glow color around the sun on the dome. */
  sunGlow: string;
  /** 0..1 glow strength (0 at night / overcast). */
  sunGlowStrength: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  /** 0..1 star visibility. */
  stars: number;
  /** Default fog color (horizon) when the world defines none. */
  fogColor: string;
  /**
   * Dimensionless aerial-perspective amount when the world defines no fog
   * (0 = none). {@link resolveFog} turns it into a density scaled to the
   * size of the content, so distant scenery fades but nearby content stays crisp.
   */
  hazeDensity: number;
  /** Whether the ground plane is shown for this preset. */
  showGround: boolean;
  /** Tone-mapping exposure multiplier of the preset (multiplied with `environment.exposure`). */
  exposure: number;
  /** Image-based (sky reflection) lighting intensity. */
  envIntensity: number;
}

/**
 * Hours each natural preset may use (inclusive). Day/overcast keep the sun
 * at least ~25° high, dawn/sunset keep it 3–16° above the horizon on the
 * correct side of noon, night keeps it well below the horizon (the moon is
 * the key light). Outside the window the hour is clamped to the nearest edge.
 */
export const PRESET_WINDOWS: Readonly<Record<'day' | 'overcast' | 'dawn' | 'sunset', readonly [number, number]>> = Object.freeze({
  day: [7.6, 16.4],
  overcast: [7.6, 16.4],
  dawn: [6.15, 6.9],
  sunset: [17.1, 17.85],
});

/** Night hours run from {@link NIGHT_WINDOW}[0] through midnight to [1]. */
export const NIGHT_WINDOW: readonly [number, number] = Object.freeze([20.5, 3.5]) as readonly [number, number];

/** Exposure multiplier per preset (dim presets are lifted so they stay readable). */
export const PRESET_EXPOSURE: Readonly<Record<SkyPreset, number>> = Object.freeze({
  day: 1,
  dawn: 1.08,
  sunset: 1.1,
  night: 1.45,
  overcast: 1.12,
  space: 1.05,
  studio: 1.02,
});

/**
 * Clamp an hour into the window of `preset` (see {@link PRESET_WINDOWS}).
 * Space and studio ignore the hour; they return it normalized.
 */
export function presetHour(preset: SkyPreset, hour: number): number {
  const h = normalizeHour(hour);
  if (preset === 'night') {
    const [from, to] = NIGHT_WINDOW;
    if (h >= from || h <= to) return h;
    return h < 12 ? to : from;
  }
  if (preset === 'space' || preset === 'studio') return h;
  const [lo, hi] = PRESET_WINDOWS[preset];
  return Math.min(hi, Math.max(lo, h));
}

/** Default hour for each preset when `timeOfDay` is not set. */
export const PRESET_HOURS: Readonly<Record<SkyPreset, number>> = Object.freeze({
  day: 13,
  dawn: 6.4,
  sunset: 17.7,
  night: 23,
  overcast: 12,
  space: 10,
  studio: 11,
});

/** Peak sun elevation at noon in degrees. */
const MAX_ELEVATION = 70;
/**
 * Horizontal direction (degrees) of the default framing camera as seen from
 * the content (0 = camera on +Z). Mirrors `DEFAULT_FRAMING_AZIMUTH` of the
 * view module; sun bearings are chosen relative to it.
 */
export const VIEW_AZIMUTH = 28;
/** Bearing of the noon sun relative to the view (degrees, negative = from the camera's left). */
const NOON_BEARING = -60;
/** Bearing of the rising sun at 06:00 (from the right, slightly behind the content). */
const SUNRISE_BEARING = 92;
/** Bearing of the setting sun at 18:00 (from the left, slightly behind the content). */
const SUNSET_BEARING = -108;
/** Bearing of the moon at night (from the right, behind the content: silver rim light). */
export const MOON_BEARING = 105;
/** Moon elevation in degrees. */
const MOON_ELEVATION = 38;
/** Dawn/sunset skies are sampled this many degrees below the light elevation (deeper colors). */
export const GOLDEN_SKY_DROP = 6;

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(c: Rgb): string {
  const h = (v: number): string => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

/** Linear interpolation between two "#rrggbb" colors (sRGB space). */
export function mixHex(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const ca = parseHex(a);
  const cb = parseHex(b);
  return toHex([ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k]);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

interface Key {
  at: number;
  zenith: string;
  horizon: string;
  sun: string;
}

/** Natural sky keyframes by sun elevation (degrees). */
const NATURAL: readonly Key[] = [
  { at: -90, zenith: '#060b1f', horizon: '#1a2650', sun: '#9db4ff' },
  { at: -14, zenith: '#0a1430', horizon: '#22305c', sun: '#9db4ff' },
  { at: -6, zenith: '#1b2a5c', horizon: '#5a4670', sun: '#ff5a2a' },
  { at: 0, zenith: '#34508e', horizon: '#ff9459', sun: '#ff8340' },
  { at: 8, zenith: '#5582c6', horizon: '#ffc792', sun: '#ffc48a' },
  { at: 25, zenith: '#4a8be0', horizon: '#c2def5', sun: '#fff1dc' },
  { at: 90, zenith: '#3b7ad8', horizon: '#cfe5f7', sun: '#ffffff' },
];

function sampleKeys(elevation: number): { zenith: string; horizon: string; sun: string } {
  const first = NATURAL[0] as Key;
  if (elevation <= first.at) return first;
  for (let i = 1; i < NATURAL.length; i++) {
    const b = NATURAL[i] as Key;
    if (elevation <= b.at) {
      const a = NATURAL[i - 1] as Key;
      const t = (elevation - a.at) / (b.at - a.at);
      return { zenith: mixHex(a.zenith, b.zenith, t), horizon: mixHex(a.horizon, b.horizon, t), sun: mixHex(a.sun, b.sun, t) };
    }
  }
  return NATURAL[NATURAL.length - 1] as Key;
}

/** Normalize an hour into [0, 24). Non-finite → 12. */
export function normalizeHour(h: number): number {
  if (!Number.isFinite(h)) return 12;
  if (h >= 0 && h < 24) return h;
  return ((h % 24) + 24) % 24;
}

/**
 * Bearing of the sun relative to the default view (degrees, 0 = behind the
 * camera, ±90 = from the side, ±180 = straight into the camera) for an hour.
 * Morning light comes from the right, afternoon light from the left; the
 * bearing stays within ±110° so the camera never stares into a low sun.
 */
export function sunBearing(hour: number): number {
  const h = normalizeHour(hour);
  if (h <= 12) return NOON_BEARING + ((12 - Math.max(6, h)) / 6) * (SUNRISE_BEARING - NOON_BEARING);
  return NOON_BEARING + ((Math.min(18, h) - 12) / 6) * (SUNSET_BEARING - NOON_BEARING);
}

/** Unit vector toward a light at `bearing` (relative to the view) and `elevation` (degrees). */
export function bearingDirection(bearing: number, elevation: number): Vec3 {
  const phi = ((VIEW_AZIMUTH + bearing) * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  const c = Math.cos(e);
  return [Math.sin(phi) * c, Math.sin(e), Math.cos(phi) * c];
}

/** Sun elevation (degrees) and unit direction toward the sun for an hour. */
export function sunPosition(hour: number): { elevation: number; direction: Vec3 } {
  const h = normalizeHour(hour);
  const elevation = MAX_ELEVATION * Math.sin(((h - 6) / 12) * Math.PI);
  return { elevation, direction: bearingDirection(sunBearing(h), elevation) };
}

/** Moonlight key intensity for a world `sunIntensity` (bright enough to read the scene, never daylight). */
function moonIntensity(sunIntensity: number): number {
  return Math.min(0.9, 0.42 + sunIntensity * 0.12);
}

/** Compute the full sky state for an environment. */
export function computeSkyState(env: Pick<Environment, 'sky' | 'timeOfDay' | 'sunIntensity' | 'ambientIntensity'>): SkyState {
  const preset: SkyPreset = Object.hasOwn(PRESET_HOURS, env.sky) ? env.sky : 'day';
  const hour = presetHour(preset, env.timeOfDay ?? PRESET_HOURS[preset]);
  const sunIntensity = Number.isFinite(env.sunIntensity) ? Math.max(0, env.sunIntensity) : 2.5;
  const ambient = Number.isFinite(env.ambientIntensity) ? Math.max(0, env.ambientIntensity) : 0.4;
  const { elevation, direction } = sunPosition(hour);
  const golden = preset === 'dawn' || preset === 'sunset';
  // Golden-hour presets paint the sky (and tint the light) as if the sun sat a little lower.
  const skyElevation = golden ? elevation - GOLDEN_SKY_DROP : elevation;
  const day = smoothstep(-4, 10, elevation);
  const keys = sampleKeys(skyElevation);
  const moon = elevation < -4;
  const lightDirection: Vec3 = moon ? bearingDirection(MOON_BEARING, MOON_ELEVATION) : direction;
  normalize(lightDirection);
  const glow = 1 - smoothstep(4, 30, skyElevation);

  const state: SkyState = {
    hour,
    elevation,
    lightDirection,
    lightColor: moon ? '#a9bcff' : golden ? mixHex(keys.sun, '#ffb070', 0.25) : keys.sun,
    lightIntensity: moon ? moonIntensity(sunIntensity) : sunIntensity * Math.max(0.05, day) * (golden ? 1.15 : 1),
    moon,
    zenith: keys.zenith,
    horizon: keys.horizon,
    nadir: mixHex(keys.horizon, '#20242c', 0.6),
    sunGlow: keys.sun,
    sunGlowStrength: moon ? 0 : 0.25 + 0.75 * glow,
    hemiSky: moon ? '#5468a8' : mixHex(keys.zenith, keys.horizon, 0.45),
    hemiGround: moon ? '#1c1f2a' : mixHex('#4a3f2e', keys.sun, 0.12 + 0.2 * glow),
    hemiIntensity: ambient * 2 * (moon ? 0.62 : 0.4 + 0.6 * day),
    stars: smoothstep(-2, -12, elevation),
    fogColor: keys.horizon,
    hazeDensity: moon ? 0.5 : 0.4 + 0.25 * glow,
    showGround: true,
    exposure: PRESET_EXPOSURE[preset],
    envIntensity: moon ? 0.35 : 0.45 + 0.15 * glow,
  };

  switch (preset) {
    case 'dawn':
      // Cooler, pinker than a sunset at the same elevation.
      return {
        ...state,
        zenith: mixHex(state.zenith, '#6b7fc4', 0.35),
        horizon: mixHex(state.horizon, '#f7b6a8', 0.45),
        fogColor: mixHex(state.horizon, '#f7b6a8', 0.45),
        sunGlow: mixHex(state.sunGlow, '#ffd0b8', 0.4),
        lightColor: mixHex(state.lightColor, '#ffd6c2', 0.35),
      };
    case 'overcast':
      return {
        ...state,
        zenith: mixHex('#8c96a3', keys.zenith, 0.15),
        horizon: mixHex('#c9ced4', keys.horizon, 0.1),
        nadir: '#8e949b',
        lightColor: '#e8ecf0',
        lightIntensity: moon ? moonIntensity(sunIntensity) * 0.5 : sunIntensity * 0.35 * Math.max(0.1, day),
        sunGlowStrength: 0,
        hemiSky: '#c9ced6',
        hemiGround: '#5d5a52',
        hemiIntensity: ambient * 3.2 * (0.3 + 0.7 * day),
        stars: 0,
        fogColor: '#b8bec6',
        hazeDensity: 0.85,
        envIntensity: 0.6,
      };
    case 'space':
      return {
        ...state,
        lightDirection: normalize([0.45, 0.6, 0.35]),
        lightColor: '#ffffff',
        lightIntensity: sunIntensity,
        moon: false,
        zenith: '#000003',
        horizon: '#04050c',
        nadir: '#000002',
        sunGlow: '#fff6e0',
        sunGlowStrength: 0.4,
        hemiSky: '#3a4060',
        hemiGround: '#0a0a12',
        hemiIntensity: ambient * 0.8,
        stars: 1,
        fogColor: '#000003',
        hazeDensity: 0,
        showGround: false,
        envIntensity: 0.25,
      };
    case 'studio':
      return {
        ...state,
        lightDirection: normalize([0.5, 0.8, 0.45]),
        lightColor: '#fff8f0',
        lightIntensity: sunIntensity,
        moon: false,
        zenith: '#b9bec6',
        horizon: '#e9ebee',
        nadir: '#d4d7dc',
        sunGlow: '#ffffff',
        sunGlowStrength: 0,
        hemiSky: '#ffffff',
        hemiGround: '#8a8d93',
        hemiIntensity: ambient * 3,
        stars: 0,
        fogColor: '#e9ebee',
        hazeDensity: 0,
        envIntensity: 0.6,
      };
    default:
      return state;
  }
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l;
  v[1] /= l;
  v[2] /= l;
  return v;
}
