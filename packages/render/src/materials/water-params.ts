/**
 * Water look parameters by scale (pure data and arithmetic, no three.js, so they are unit-testable).
 *
 * A puddle, a pond, a stream, a river, a lake and the sea do not differ by one scale factor: a puddle is a
 * mirror that only rings when something falls in, a stream is shallow, fast and white at every stone, a lake
 * is driven by the wind and the sea has long swell with white caps. Each class below sets the wave lengths,
 * how steep the surface is, how far the eye sees into it (clarity), the colour it takes with depth, the
 * current and how much foam it carries.
 */
import type { WaterKind } from './presets';

/** One scale class of water. */
export interface WaterClass {
  /** Longest wavelength (m); the four waves are this times 1, 0.55, 0.31 and 0.17. */
  wavelength: number;
  /** Surface slope (rise over run) of the steepest wave in calm air; the wind adds to it. */
  slope: number;
  /** Extra slope at 10 m/s wind. */
  windSlope: number;
  /** Depth (m) at which the bed is hidden for 63 % (absorption length of green light). */
  clarity: number;
  /** Colour of shallow water (over a bright bed) and of deep water, linear sRGB hex. */
  shallow: string;
  deep: string;
  /** Foam at the shore (0..1) and on wave crests (0..1). */
  shoreFoam: number;
  crestFoam: number;
  /** Water depth (m) below which the shoreline foam shows (a beach is shallow over metres; a pond rim is a line). */
  foamWidth: number;
  /**
   * Extra apparent depth (m) of a body whose floor is flat ground (a disc laid on the lawn has centimetres of real depth
   * but must read as a pond); it fades out where the measured depth is large, so carved basins keep their real depth.
   */
  basin: number;
  /** Small ripple detail strength (0..1). */
  detail: number;
  /** How fast the waves run relative to deep-water physics (rivers and streams are driven by the current). */
  waveSpeed: number;
  /** How strongly the refraction bends the picture behind the water (screen units per unit slope). */
  refraction: number;
  /** Whether the waves follow the current (rivers, streams) or the wind (ponds, lakes, the sea). */
  followsCurrent: boolean;
}

/** The scale classes (and falling water). */
export const WATER_CLASSES: Readonly<Record<WaterKind, WaterClass>> = Object.freeze({
  puddle: { wavelength: 0.45, slope: 0.012, windSlope: 0.02, clarity: 0.12, shallow: '#12171a', deep: '#080b0d', shoreFoam: 0, crestFoam: 0, foamWidth: 0.01, basin: 0.06, detail: 0.15, waveSpeed: 1, refraction: 0.02, followsCurrent: false },
  pond: { wavelength: 1.6, slope: 0.035, windSlope: 0.05, clarity: 1.1, shallow: '#4f7a62', deep: '#1d3a34', shoreFoam: 0.12, crestFoam: 0, foamWidth: 0.02, basin: 1.2, detail: 0.35, waveSpeed: 1, refraction: 0.05, followsCurrent: false },
  stream: { wavelength: 1.1, slope: 0.16, windSlope: 0.02, clarity: 1.6, shallow: '#6f9a8f', deep: '#2a5a58', shoreFoam: 0.85, crestFoam: 0.25, foamWidth: 0.18, basin: 0.3, detail: 0.9, waveSpeed: 1.6, refraction: 0.08, followsCurrent: true },
  river: { wavelength: 2.8, slope: 0.1, windSlope: 0.03, clarity: 2.6, shallow: '#6a9c96', deep: '#1f4a4e', shoreFoam: 0.55, crestFoam: 0.08, foamWidth: 0.22, basin: 0.5, detail: 0.75, waveSpeed: 1.25, refraction: 0.07, followsCurrent: true },
  lake: { wavelength: 6, slope: 0.05, windSlope: 0.1, clarity: 4, shallow: '#5f9aa0', deep: '#16405a', shoreFoam: 0.3, crestFoam: 0.1, foamWidth: 0.05, basin: 2.2, detail: 0.5, waveSpeed: 1, refraction: 0.06, followsCurrent: false },
  sea: { wavelength: 22, slope: 0.1, windSlope: 0.12, clarity: 9, shallow: '#4fa3a8', deep: '#0b3550', shoreFoam: 0.8, crestFoam: 0.5, foamWidth: 0.5, basin: 6, detail: 0.45, waveSpeed: 1, refraction: 0.05, followsCurrent: false },
  // Falling water is drawn by its own shader (`waterfall.ts`); this class only backs the fallback paths.
  fall: { wavelength: 0.8, slope: 0.12, windSlope: 0.02, clarity: 0.6, shallow: '#cfe4e6', deep: '#5d8c90', shoreFoam: 0.9, crestFoam: 0.6, foamWidth: 0.2, basin: 0.2, detail: 0.6, waveSpeed: 2, refraction: 0.04, followsCurrent: true },
});

/** Wavelength factors of the four summed waves. */
export const WAVE_FACTORS: readonly [number, number, number, number] = Object.freeze([1, 0.55, 0.31, 0.17]) as readonly [number, number, number, number];
/** Share of the slope each wave carries (sums to 1). */
export const WAVE_SHARES: readonly [number, number, number, number] = Object.freeze([0.4, 0.3, 0.2, 0.1]) as readonly [number, number, number, number];
/** Direction offsets (degrees) of the waves from the main heading: crossing seas, not a washboard. */
export const WAVE_SPREAD: readonly [number, number, number, number] = Object.freeze([0, 31, -47, 73]) as readonly [number, number, number, number];
/** Gravity (m/s²), for deep-water dispersion. */
const GRAVITY = 9.81;

/** One wave of the sum: unit direction, wavenumber, angular speed and slope amplitude. */
export interface Wave {
  dx: number;
  dz: number;
  k: number;
  omega: number;
  slope: number;
}

/** Wind used when the world sets none: a light breeze. */
export const DEFAULT_WIND = Object.freeze({ speed: 2.5, direction: 20 });

/** Unit vector `[x, z]` of a wind or wave heading in degrees (0 toward -Z, counter-clockwise from above). */
export function headingVector(degrees: number): [number, number] {
  const a = (degrees * Math.PI) / 180;
  return [-Math.sin(a), -Math.cos(a)];
}

/**
 * The four waves of a water class: along the current for rivers and streams, along the wind otherwise.
 * `windSpeed` (m/s) steepens the surface (up to a gale) and is what turns a pond into a chop.
 */
export function waveSet(kind: WaterKind, windSpeed: number, windDirection: number, flow: readonly [number, number]): Wave[] {
  const c = WATER_CLASSES[kind];
  const speed = Math.max(0, Math.min(30, Number.isFinite(windSpeed) ? windSpeed : DEFAULT_WIND.speed));
  const current = Math.hypot(flow[0], flow[1]);
  let heading = Number.isFinite(windDirection) ? windDirection : DEFAULT_WIND.direction;
  if (c.followsCurrent && Number.isFinite(current) && current > 0.01) heading = (Math.atan2(-flow[0], -flow[1]) * 180) / Math.PI;
  const total = c.slope + c.windSlope * Math.min(2.2, speed / 10);
  const out: Wave[] = [];
  for (let i = 0; i < 4; i++) {
    const wl = c.wavelength * (WAVE_FACTORS[i] as number) * (c.followsCurrent ? 1 : 1 + Math.min(1.5, speed / 12));
    const [dx, dz] = headingVector(heading + (WAVE_SPREAD[i] as number));
    const k = (2 * Math.PI) / Math.max(0.05, wl);
    // Deep-water dispersion, damped on shallow flowing water where the current carries the pattern.
    const omega = Math.sqrt(GRAVITY * k) * c.waveSpeed * (c.followsCurrent ? 0.55 : 1);
    out.push({ dx, dz, k, omega, slope: Math.min(0.5, total * (WAVE_SHARES[i] as number) * 2.2) });
  }
  return out;
}

/** Largest slope of the summed surface (for tests and for the foam threshold). */
export function maxSlope(waves: readonly Wave[]): number {
  return waves.reduce((s, w) => s + w.slope, 0);
}

/**
 * Scale class of a water entity from its footprint and names, used when the material does not name a
 * `waterKind`. `width` and `depth` are the plane's metres; names and tags win over the size.
 */
export function inferWaterKind(width: number, depth: number, words: readonly string[]): WaterKind {
  const text = words.join(' ').toLowerCase();
  if (/\b(puddle|puddles)\b/.test(text)) return 'puddle';
  if (/\b(stream|brook|creek|rill|rapids|waterfall)\b/.test(text)) return 'stream';
  if (/\b(river|canal|channel)\b/.test(text)) return 'river';
  if (/\b(sea|ocean|bay|coast|harbou?r)\b/.test(text)) return 'sea';
  if (/\b(lake|lagoon|reservoir|loch)\b/.test(text)) return 'lake';
  if (/\b(pond|pool|fountain|basin|trough|koi)\b/.test(text)) return 'pond';
  const w = Number.isFinite(width) ? Math.abs(width) : 10;
  const d = Number.isFinite(depth) ? Math.abs(depth) : 10;
  const big = Math.max(w, d);
  const small = Math.max(0.01, Math.min(w, d));
  if (big < 3) return 'puddle';
  if (big < 14) return 'pond';
  if (big / small > 5 && small < 40) return big > 70 ? 'river' : 'stream';
  if (big < 500) return 'lake';
  return 'sea';
}

/** Ripple physics: a ring spreads at this speed (m/s), is this wide (m), lives this long (s). */
export const RIPPLE = Object.freeze({ speed: 1.3, width: 0.32, life: 3.2, max: 12 });

/** Underwater look (the eye below the surface). */
export const UNDERWATER = Object.freeze({
  /** Fog density per metre of clarity (so a clear sea sees farther than a pond). */
  densityPerClarity: 0.9,
  /** Colour fraction of the surface light that reaches the eye at a metre of depth. */
  minDensity: 0.04,
  maxDensity: 0.9,
});

/** Fog density (per metre) seen from under water of `kind`. */
export function underwaterDensity(kind: WaterKind): number {
  const c = WATER_CLASSES[kind];
  return Math.max(UNDERWATER.minDensity, Math.min(UNDERWATER.maxDensity, UNDERWATER.densityPerClarity / c.clarity));
}

/** Render tiers of the water (see {@link waterTierFor}). */
export type WaterTier = 'simple' | 'standard' | 'high';

/**
 * Water tier by device: software rasterisers and low-memory mode get the cheap look (animated wave normals and a
 * sky reflection, no extra texture reads); real GPUs get depth absorption, foam, refraction and caustics; the
 * high tier adds the planar reflection (one extra pass of the scene at half size). The renderer asks for it only
 * when `studio` is true, which it is not by default: measured on the reference scenes the sky reflection of the
 * standard tier reads better in motion than the half-size mirror, which stays an opt-in.
 */
export function waterTierFor(gpuTier: string, lowMemory: boolean, studio: boolean): WaterTier {
  if (gpuTier === 'software' || lowMemory) return 'simple';
  if (studio && gpuTier === 'discrete') return 'high';
  return 'standard';
}
