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
import { float, Fn, positionGeometry, positionLocal, sin, time, vec3 } from 'three/tsl';
import type { Material } from 'three';

/** Sway (metres) at 1 m height; quadratic term per m². */
export const WIND_LINEAR = 0.006;
export const WIND_QUADRATIC = 0.0026;

let node: unknown = null;

/** The shared wind position node (built on first use). */
function windNode(): unknown {
  node ??= Fn(() => {
    const p = positionLocal;
    const h = positionGeometry.y.max(0);
    const phase = p.x.mul(0.13).add(p.z.mul(0.09));
    const gust = sin(time.mul(1.25).add(phase)).mul(0.65).add(sin(time.mul(2.9).add(phase.mul(1.9))).mul(0.25));
    const bend = h.mul(float(WIND_LINEAR)).add(h.mul(h).mul(float(WIND_QUADRATIC))).mul(gust);
    return p.add(vec3(bend, float(0), bend.mul(0.55)));
  })();
  return node;
}

/** Give `material` the wind position node (vegetation fields). */
export function applyWind(material: Material): void {
  (material as Material & { positionNode?: unknown }).positionNode = windNode();
}

/** Built-in generators whose scatter fields sway in the wind. */
export const FOLIAGE_GENERATORS: ReadonlySet<string> = new Set(['tree-pine', 'tree-oak', 'tree-palm', 'bush', 'grass-tuft', 'flowers', 'tree-broadleaf', 'tree-birch', 'tree-spruce', 'shrub', 'fern', 'meadow-grass', 'wildflowers']);
