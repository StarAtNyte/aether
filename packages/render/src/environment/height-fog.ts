/**
 * Height fog: the world's `FogExp2` with an air that thins above the ground layer.
 *
 * three's exponential-squared fog depends on the distance alone, so from a drone's height the whole ground went under the
 * same veil as at the end of a street: a dusty world (Kestrel Outpost) read as trees and rock in brown milk. Real haze is a
 * layer: its density falls off with height. The density here falls as `exp(-(y - base) / height)` above the content's
 * middle height, and the fog of a ray is that of its mean density between the eye and the point (the exact integral of the
 * falloff), so:
 *
 * - at the ground (eye and point in the layer) nothing changes: a fog or night world keeps its mood where it is walked,
 * - looking down from above, the ray spends most of its length in thin air and the land stays clear,
 * - the far horizon, seen through the layer, still melts into the haze.
 *
 * The node reads the scene's own fog object (colour and density by reference), so density changes (captures zero it,
 * the content size retunes it) apply as before. It is offered as `scene.fogNode` only while `scene.fog` is that object
 * (underwater fog and any other swap fall back to three's own fog).
 */
import type { FogExp2, Scene } from 'three';
import * as TSL from 'three/tsl';

/** Smallest thickness (m) of the ground layer (its density falls by e over this height). */
export const FOG_LAYER_MIN = 60;

/** CPU twin of the shader (unit-tested): mean density share along a ray from eye height `a` to point height `b` (in layer heights above the base). */
export function layerShare(a: number, b: number): number {
  const x = Math.max(0, a);
  const y = Math.max(0, b);
  if (Math.abs(x - y) < 1e-3) return Math.exp(-x);
  return (Math.exp(-y) - Math.exp(-x)) / (x - y);
}

/** Thickness (m) of the ground layer for content of radius `radius`. */
export function layerHeight(radius: number): number {
  return Math.max(FOG_LAYER_MIN, Number.isFinite(radius) ? radius : 0);
}

type N = {
  sub(o: unknown): N; mul(o: unknown): N; div(o: unknown): N; add(o: unknown): N; max(o: unknown): N; negate(): N; exp(): N;
  oneMinus(): N; abs(): N; lessThan(o: unknown): N; select(a: unknown, b: unknown): N; y: N; z: N; value: number;
};

/** The height fog of one scene and fog object. */
export class HeightFog {
  private readonly base: N;
  private readonly height: N;
  private readonly node: unknown;

  constructor(scene: Scene, fogObject: FogExp2) {
    const t = TSL as unknown as Record<string, (...a: unknown[]) => N> & { positionWorld: N; cameraPosition: N; positionView: N };
    this.base = t['uniform']!(0);
    this.height = t['uniform']!(FOG_LAYER_MIN);
    let node: unknown = null;
    try {
      const color = (t['reference'] as unknown as (p: string, ty: string, o: unknown) => { setGroup(g: unknown): N })('color', 'color', fogObject).setGroup(t['renderGroup']);
      const density = (t['reference'] as unknown as (p: string, ty: string, o: unknown) => { setGroup(g: unknown): N })('density', 'float', fogObject).setGroup(t['renderGroup']);
      const a = t.cameraPosition.y.sub(this.base).div(this.height).max(0);
      const b = t.positionWorld.y.sub(this.base).div(this.height).max(0);
      const diff = a.sub(b);
      const mean = diff.abs().lessThan(1e-3).select(a.negate().exp(), b.negate().exp().sub(a.negate().exp()).div(diff));
      const z = t.positionView.z.negate();
      const d = density.mul(mean).mul(z);
      const factor = d.mul(d).negate().exp().oneMinus();
      node = t['fog']!(color, factor);
    } catch {
      node = null;
    }
    this.node = node;
    if (!node || (globalThis as { __AETHER_HEIGHT_FOG?: boolean }).__AETHER_HEIGHT_FOG === false) return;
    Object.defineProperty(scene, 'fogNode', {
      configurable: true,
      enumerable: true,
      get: () => (scene.fog === fogObject ? this.node : null),
      set: () => undefined,
    });
  }

  /** The ground layer: its base height (m, the content's middle) and its thickness from the content radius. */
  setLayer(baseY: number, radius: number): void {
    if (Number.isFinite(baseY)) this.base.value = baseY;
    this.height.value = layerHeight(radius);
  }
}
