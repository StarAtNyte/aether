/**
 * Procedural wind for vegetation: a TSL position node that bends each
 * vertex sideways by an amount growing with its height above the mesh base
 * (quadratic: trunks stay put, crowns sway), with a phase taken from its
 * position so neighbouring trees never move in lockstep. Pure vertex-shader
 * work on both backends (WebGPU and WebGL2): no CPU cost per instance.
 *
 * It is attached to classic materials as `positionNode`; WebGPURenderer
 * copies the property when it converts the material to its node version.
 */
import type { Material } from 'three';
import { T, type Nd } from './tsl-lite';
import { windHeading, windSpeed } from './water-state';

/** Sway (metres) at 1 m height; quadratic term per m². */
export const WIND_LINEAR = 0.006;
export const WIND_QUADRATIC = 0.0026;
/** Amplitude (metres) of the leaf flutter at unit gain. */
export const WIND_FLUTTER = 0.006;
/** Sway gain at 0 m/s (a still day is not a dead one) and per m/s of wind. */
export const WIND_CALM_GAIN = 0.6;
export const WIND_GAIN_PER_MS = 0.12;

/** Sway gain of the vegetation for a wind speed (m/s): what the shader computes, for tests and tuning. */
export function windGain(speed: number): number {
  return WIND_CALM_GAIN + WIND_GAIN_PER_MS * Math.max(0, Math.min(30, speed));
}

let node: unknown = null;

/**
 * The shared wind position node (built on first use). The bend runs along the world's wind heading and grows with its
 * speed (the same uniforms the water reads), gusts get quicker in a stronger wind, and a smaller sideways component
 * keeps crowns from swaying on a line.
 */
function windNode(): unknown {
  if (node) return node;
  const p = T.positionLocal;
  const h = T.max(T.positionGeometry.y, 0);
  const speed = windSpeed as unknown as Nd;
  const heading = windHeading as unknown as Nd;
  const phase = p.x.mul(0.13).add(p.z.mul(0.09));
  const gain = speed.mul(WIND_GAIN_PER_MS).add(WIND_CALM_GAIN);
  const quick = speed.mul(0.05).add(1);
  const gust = T.sin(T.time.mul(1.25).mul(quick).add(phase)).mul(0.65).add(T.sin(T.time.mul(2.9).mul(quick).add(phase.mul(1.9))).mul(0.25)).add(T.min(speed.mul(0.03), 0.5));
  const bend = h.mul(WIND_LINEAR).add(h.mul(h).mul(WIND_QUADRATIC)).mul(gust).mul(gain);
  const side = T.sin(T.time.mul(1.7).mul(quick).add(phase.mul(1.4))).mul(0.25).mul(bend);
  const dx = heading.x.mul(bend).add(heading.y.negate().mul(side));
  const dz = heading.y.mul(bend).add(heading.x.mul(side));
  // Leaf flutter: a quick, small shiver with a phase per position, so neighbouring cards do not move together.
  const shiverPhase = p.x.mul(3.1).add(p.y.mul(2.3)).add(p.z.mul(2.9));
  const shiver = T.sin(T.time.mul(6.3).mul(quick).add(shiverPhase)).mul(T.min(h, 1)).mul(gain).mul(WIND_FLUTTER);
  node = T.vec3(p.x.add(dx).add(shiver.mul(0.6)), p.y.add(shiver), p.z.add(dz).sub(shiver.mul(0.4)));
  return node;
}

/** Give `material` the wind position node (vegetation fields). */
export function applyWind(material: Material): void {
  (material as Material & { positionNode?: unknown }).positionNode = windNode();
}

/** Built-in generators whose scatter fields sway in the wind. */
export const FOLIAGE_GENERATORS: ReadonlySet<string> = new Set(['tree-pine', 'tree-oak', 'tree-palm', 'bush', 'grass-tuft', 'flowers', 'tree-broadleaf', 'tree-birch', 'tree-spruce', 'shrub', 'fern', 'meadow-grass', 'wildflowers']);
