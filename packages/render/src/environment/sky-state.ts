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
import { skyKeys, sunTransmittance, type Radiance } from './atmosphere';

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
  /**
   * 0..1 strength of the procedural nebula / galactic band painted on the
   * dome (full in space, a faint band on clear nights).
   */
  nebula: number;
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
  /** The sky preset this state was computed for. */
  preset: SkyPreset;
  /** 0..1 cloud cover painted on the dome (0 in space and the studio). */
  clouds: number;
  /**
   * Set for the natural presets: the dome is painted per direction by the physical sky model from this
   * sun (direction, elevation in degrees as used for the sky, i.e. after the golden-hour drop), blended
   * over the keyed gradient by `weight` (0 at night, 1 in daylight).
   */
  physical?: { sunDirection: Vec3; elevation: number; weight: number; turbidity: number };
}

/**
 * Hours each natural preset may use (inclusive). Day reaches from early
 * morning into the late afternoon (sun ~13° up at either end: the warm, raking
 * light of 17:00 is a clear day's, not only a sunset preset's); overcast keeps
 * the sun at least ~25° high, dawn/sunset keep it ~7–17° above the horizon on the
 * correct side of noon, night keeps it well below the horizon (the moon is
 * the key light). Outside the window the hour is clamped to the nearest edge.
 */
export const PRESET_WINDOWS: Readonly<Record<'day' | 'overcast' | 'dawn' | 'sunset', readonly [number, number]>> = Object.freeze({
  day: [6.7, 17.3],
  overcast: [7.6, 16.4],
  dawn: [6.38, 7],
  sunset: [17, 17.62],
});

/** Night hours run from {@link NIGHT_WINDOW}[0] through midnight to [1]. */
export const NIGHT_WINDOW: readonly [number, number] = Object.freeze([20.5, 3.5]) as readonly [number, number];

/** Exposure multiplier per preset (dim presets are lifted so they stay readable). */
export const PRESET_EXPOSURE: Readonly<Record<SkyPreset, number>> = Object.freeze({
  day: 1,
  dawn: 1,
  sunset: 1.02,
  night: 1.6,
  overcast: 1.05,
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
  dawn: 6.5,
  sunset: 17.5,
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
export const MOON_ELEVATION = 38;
/** Exponent of the dome's horizon → zenith gradient (lower = the zenith color reaches further down). */
export const SKY_GRADIENT_POWER = 0.42;
/** Share of the image light (sky reflections and ambient) taken away under a clear low sun (deeper, cooler shade). */
export const LOW_SUN_FILL_CUT = 0.25;
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
  { at: 25, zenith: '#3f82db', horizon: '#b3d3f0', sun: '#fff1dc' },
  { at: 90, zenith: '#336fd0', horizon: '#bcd9f2', sun: '#ffffff' },
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

/** Linear [0, 1] RGB to "#rrggbb" (sRGB encoded). */
function linearToHex(c: Radiance): string {
  const enc = (v: number): number => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055);
  return toHex([enc(c[0]), enc(c[1]), enc(c[2])]);
}

/** Sky turbidity (aerosol amount) of the physical sky model. */
const TURBIDITY = 1.6;

/**
 * Sky colours for a sun elevation: the physical single-scattering model ({@link skyKeys}) takes over from the
 * art-directed night keyframes as the sun rises through the twilight belt (-9° to -2°), so dawn, noon and
 * dusk skies come out of the same model as the dome's per-direction colours.
 */
function sampleSky(elevation: number): { zenith: string; horizon: string; sun: string } {
  const legacy = sampleKeys(elevation);
  const w = smoothstep(-9, -2, elevation);
  if (w <= 0) return legacy;
  const phys = skyKeys(elevation, TURBIDITY);
  const t = sunTransmittance(elevation, [0, 0, 0]);
  // Direct sun: the physical transmittance, softened toward the keyed colour (keeps a warm white at noon).
  const sunPhys = linearToHex([Math.pow(t[0], 0.9), Math.pow(t[1], 1.15), Math.pow(t[2], 1.5)]);
  return {
    zenith: mixHex(legacy.zenith, linearToHex(phys.zenith), w),
    horizon: mixHex(legacy.horizon, linearToHex(phys.horizon), w),
    sun: mixHex(legacy.sun, mixHex(legacy.sun, sunPhys, 0.55), w),
  };
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
  return Math.min(1, 0.52 + sunIntensity * 0.14);
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
  const keys = sampleSky(skyElevation);
  const moon = elevation < -4;
  const lightDirection: Vec3 = moon ? bearingDirection(MOON_BEARING, MOON_ELEVATION) : direction;
  normalize(lightDirection);
  const glow = 1 - smoothstep(4, 30, skyElevation);
  // A clear day's low sun (late afternoon, early morning) turns warm before the sunset preset's window begins.
  const low = preset === 'day' ? 1 - smoothstep(14, 40, elevation) : 0;
  // A clear low sun: the key rakes in strong and the open shade is lit by the deep blue overhead alone (no grey veil,
  // a sky dimmer relative to the sun than at noon). Overcast is not a clear sky and keeps its own soft light below.
  const clearLow = moon ? 0 : golden ? 1 : low;
  const fillGrey = 0.62 - 0.24 * clearLow;

  const state: SkyState = {
    hour,
    elevation,
    lightDirection,
    lightColor: moon ? '#a9bcff' : golden ? mixHex(keys.sun, '#ffb070', 0.25) : mixHex(keys.sun, '#ffb070', 0.3 * low),
    lightIntensity: moon ? moonIntensity(sunIntensity) : sunIntensity * Math.max(0.05, day) * (golden ? 1.15 : 1 + 0.15 * low),
    moon,
    zenith: keys.zenith,
    horizon: keys.horizon,
    nadir: mixHex(keys.horizon, '#20242c', 0.6),
    sunGlow: keys.sun,
    sunGlowStrength: moon ? 0 : 0.25 + 0.75 * glow,
    // Skylight is bluish but not the zenith's saturated blue: shaded white walls read pale blue-grey.
    hemiSky: moon ? '#4d5a80' : mixHex(mixHex(keys.zenith, keys.horizon, 0.45), '#dcdad6', fillGrey),
    hemiGround: moon ? '#1c1f2a' : mixHex('#4a3f2e', keys.sun, 0.12 + 0.2 * glow),
    hemiIntensity: ambient * 2 * (moon ? 0.75 : 0.4 + 0.6 * day),
    stars: smoothstep(-2, -12, elevation),
    nebula: 0.3 * smoothstep(-8, -20, elevation),
    // Fog is the horizon haze: pale at noon, tinted by the sunlight (gold, rose) as the sun gets low.
    fogColor: mixHex(mixHex(keys.horizon, '#e4e2de', 0.32 * day), keys.sun, 0.28 * glow * day),
    hazeDensity: moon ? 0.5 : 0.4 + 0.25 * glow,
    showGround: true,
    exposure: PRESET_EXPOSURE[preset],
    envIntensity: moon ? 0.35 : (0.45 + 0.15 * glow) * (1 - LOW_SUN_FILL_CUT * clearLow),
    preset,
    clouds: moon ? 0.28 : golden ? 0.5 : 0.42,
  };

  if (preset === 'day' || preset === 'dawn' || preset === 'sunset' || preset === 'night') {
    const weight = smoothstep(-9, -2, skyElevation);
    if (weight > 0) state.physical = { sunDirection: normalize(bearingDirection(sunBearing(hour), skyElevation)), elevation: skyElevation, weight, turbidity: TURBIDITY };
  }

  switch (preset) {
    case 'dawn':
      // Softer and pinker than a sunset at the same elevation.
      return {
        ...state,
        zenith: mixHex(state.zenith, '#5d78c9', 0.35),
        horizon: mixHex(state.horizon, '#ffb48c', 0.4),
        fogColor: mixHex(state.horizon, '#f2b9a2', 0.4),
        sunGlow: mixHex(state.sunGlow, '#ffd0b8', 0.4),
        lightColor: mixHex(state.lightColor, '#ffd6c2', 0.3),
      };
    case 'overcast':
      return {
        ...state,
        // Moody grey-blue cloud deck: diffuse, almost shadowless light.
        zenith: mixHex('#66717f', keys.zenith, 0.1),
        horizon: mixHex('#a7afb9', keys.horizon, 0.08),
        nadir: '#7d848c',
        lightColor: '#dfe6ee',
        lightIntensity: moon ? moonIntensity(sunIntensity) * 0.5 : sunIntensity * 0.2 * Math.max(0.1, day),
        sunGlowStrength: 0,
        hemiSky: '#bcc5d0',
        hemiGround: '#55534d',
        hemiIntensity: ambient * 3.4 * (0.3 + 0.7 * day),
        stars: 0,
        nebula: 0,
        fogColor: '#9ea7b2',
        hazeDensity: 0.9,
        envIntensity: 0.55,
        clouds: 0.9,
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
        nebula: 1,
        fogColor: '#000003',
        hazeDensity: 0,
        showGround: false,
        envIntensity: 0.25,
        clouds: 0,
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
        nebula: 0,
        fogColor: '#e9ebee',
        hazeDensity: 0,
        envIntensity: 0.6,
        clouds: 0,
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
