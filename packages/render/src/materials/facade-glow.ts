/**
 * Lit windows of building facades. The `facade` finish stores which panes glow in the blue channel of its
 * occlusion / roughness / lit map; a single shared uniform scales that emission with the darkness of the
 * sky, so a skyline is dark glass by day and a field of warm windows at dusk and night. One uniform for the
 * whole scene: changing the hour recompiles nothing and costs no per-material work.
 *
 * Pure node (TSL) code, identical on the WebGPU and WebGL2 backends.
 */
import { dot, floor, fract, mix, sin, smoothstep, texture, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { Material, Texture } from 'three';

/** Sun elevation (degrees) at which windows start to light up, and below which they are fully lit. */
export const GLOW_START_ELEVATION = 4;
export const GLOW_FULL_ELEVATION = -5;
/** Emission of a lit window (linear radiance before tone mapping): bright enough to bloom at dusk, not blown out. */
export const WINDOW_EMISSION = 0.85;
/** Metres between two windows of the facade grid (one bay / one floor). */
export const WINDOW_CELL = 3;
/** Share of the windows that are lit at night. */
export const LIT_SHARE = 0.42;
/** Warm tungsten-to-fluorescent colour of the windows (linear). */
export const WINDOW_COLOR: readonly [number, number, number] = Object.freeze([1.0, 0.5, 0.18]) as readonly [number, number, number];

/** Cool fluorescent / screen-light colour a share of the windows take instead of the warm tungsten (linear). */
export const WINDOW_COOL_COLOR: readonly [number, number, number] = Object.freeze([0.45, 0.72, 1.0]) as readonly [number, number, number];

/** How much of the windows glow (0..1) for a sun elevation in degrees. */
export function nightGlow(elevationDeg: number): number {
  if (!Number.isFinite(elevationDeg)) return 0;
  const t = (GLOW_START_ELEVATION - elevationDeg) / (GLOW_START_ELEVATION - GLOW_FULL_ELEVATION);
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** The shared glow uniform (0 = day, 1 = night). */
export const facadeGlow = uniform(0);

/** Attach the lit-window emission to a facade material; `orm` is the finish's ORM map (blue = lit mask). */
export function applyFacadeGlow(material: Material, orm: Texture): void {
  const metres = uv();
  const mask = texture(orm, metres.mul(uniform(orm.repeat))).b;
  // Which window of the 3 m grid is lit: a hash of its cell (metre UVs), so no tile-sized pattern repeats down a tower.
  const cell = floor(metres.div(WINDOW_CELL));
  const h0 = fract(sin(dot(cell, vec2(12.9898, 78.233))).mul(43758.5453));
  // Whole floors and neighbouring bays tend to be lit together (offices, flats): a per-floor bias and a per-pair hash blended into the window's own.
  const rowH = fract(sin(dot(vec2(cell.y, 3.7), vec2(41.3, 17.17))).mul(24634.6345));
  const pairH = fract(sin(dot(vec2(floor(cell.x.div(2)), cell.y), vec2(27.1, 91.7))).mul(53758.5453));
  const h = mix(h0, pairH, 0.45);
  const share = rowH.mul(1.1).add(0.5).mul(LIT_SHARE);
  const on = smoothstep(share.oneMinus().sub(0.02), share.oneMinus(), h);
  const level = on.mul(fract(h0.mul(97.0)).mul(0.6).add(0.55));
  // About a fifth of the lit windows are cool (offices, screens), the rest warm: a skyline of one flat colour reads as a texture.
  const cool = smoothstep(0.78, 0.8, fract(h0.mul(53.0)));
  const tint = mix(vec3(WINDOW_COLOR[0], WINDOW_COLOR[1], WINDOW_COLOR[2]), vec3(WINDOW_COOL_COLOR[0], WINDOW_COOL_COLOR[1], WINDOW_COOL_COLOR[2]), cool);
  (material as Material & { emissiveNode?: unknown }).emissiveNode = tint.mul(mask.mul(level).mul(facadeGlow).mul(WINDOW_EMISSION));
}
