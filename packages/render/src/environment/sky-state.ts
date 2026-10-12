/**
 * Pure sky/sun/ambient parameters derived from `world.environment`. The sun
 * follows `timeOfDay` (or a per-preset default hour); natural presets
 * (day/dawn/sunset/night) take their sky gradient from the sun elevation, so
 * any hour looks plausible. No three.js — unit-tested directly.
 */
import type { Environment, Vec3 } from '@aether/core';

/** Sky preset id. */
export type SkyPreset = Environment['sky'];

/** Everything the environment rig needs to light and color the scene. */
export interface SkyState {
  /** Hour actually used (0–24). */
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
  /** Default haze density when the world defines no fog (0 = none). */
  hazeDensity: number;
  /** Whether the ground plane is shown for this preset. */
  showGround: boolean;
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
/** Azimuth offset so the noon sun lights scenes from the side, not straight from the camera. */
const AZIMUTH_OFFSET = (35 * Math.PI) / 180;

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
  { at: -90, zenith: '#03060f', horizon: '#0b1228', sun: '#9db4ff' },
  { at: -14, zenith: '#050a1a', horizon: '#121c3a', sun: '#9db4ff' },
  { at: -6, zenith: '#14204a', horizon: '#4a3a5e', sun: '#ff5a2a' },
  { at: 0, zenith: '#2c4682', horizon: '#ff8a4c', sun: '#ff7b3a' },
  { at: 8, zenith: '#4a78c0', horizon: '#ffc58a', sun: '#ffc48a' },
  { at: 25, zenith: '#3d7fd9', horizon: '#b9d8f2', sun: '#fff1dc' },
  { at: 90, zenith: '#2f6fd0', horizon: '#c4def4', sun: '#ffffff' },
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

/** Sun elevation (degrees) and unit direction toward the sun for an hour. */
export function sunPosition(hour: number): { elevation: number; direction: Vec3 } {
  const h = normalizeHour(hour);
  const elevation = MAX_ELEVATION * Math.sin(((h - 6) / 12) * Math.PI);
  const az = ((h - 12) / 12) * Math.PI + AZIMUTH_OFFSET;
  const e = (elevation * Math.PI) / 180;
  const c = Math.cos(e);
  return { elevation, direction: [-Math.sin(az) * c, Math.sin(e), Math.cos(az) * c] };
}

/** Compute the full sky state for an environment. */
export function computeSkyState(env: Pick<Environment, 'sky' | 'timeOfDay' | 'sunIntensity' | 'ambientIntensity'>): SkyState {
  const preset: SkyPreset = env.sky;
  const hour = normalizeHour(env.timeOfDay ?? PRESET_HOURS[preset] ?? 12);
  const sunIntensity = Number.isFinite(env.sunIntensity) ? Math.max(0, env.sunIntensity) : 2.5;
  const ambient = Number.isFinite(env.ambientIntensity) ? Math.max(0, env.ambientIntensity) : 0.4;
  const { elevation, direction } = sunPosition(hour);
  const day = smoothstep(-4, 10, elevation);
  const keys = sampleKeys(elevation);
  const moon = elevation < -4;
  const lightDirection: Vec3 = moon ? [-direction[0], Math.max(0.35, -direction[1]), -direction[2]] : direction;
  normalize(lightDirection);

  const state: SkyState = {
    hour,
    elevation,
    lightDirection,
    lightColor: moon ? '#9db4ff' : keys.sun,
    lightIntensity: moon ? sunIntensity * 0.12 : sunIntensity * Math.max(0.05, day),
    moon,
    zenith: keys.zenith,
    horizon: keys.horizon,
    nadir: mixHex(keys.horizon, '#20242c', 0.6),
    sunGlow: keys.sun,
    sunGlowStrength: moon ? 0 : 0.25 + 0.75 * (1 - smoothstep(5, 40, elevation)),
    hemiSky: mixHex(keys.zenith, keys.horizon, 0.35),
    hemiGround: mixHex('#3b3326', keys.horizon, 0.15),
    hemiIntensity: ambient * (0.35 + 0.65 * day) * 2,
    stars: smoothstep(-2, -12, elevation),
    fogColor: keys.horizon,
    hazeDensity: 0.0022,
    showGround: true,
  };

  switch (preset) {
    case 'overcast':
      return {
        ...state,
        zenith: mixHex('#8c96a3', keys.zenith, 0.15),
        horizon: mixHex('#c9ced4', keys.horizon, 0.1),
        nadir: '#8e949b',
        lightColor: '#e8ecf0',
        lightIntensity: moon ? sunIntensity * 0.06 : sunIntensity * 0.35 * Math.max(0.1, day),
        sunGlowStrength: 0,
        hemiSky: '#c9ced6',
        hemiGround: '#5d5a52',
        hemiIntensity: ambient * 3.2 * (0.3 + 0.7 * day),
        stars: 0,
        fogColor: '#b8bec6',
        hazeDensity: 0.006,
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
