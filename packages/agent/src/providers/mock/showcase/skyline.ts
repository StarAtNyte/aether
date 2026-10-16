/**
 * City skyline staging for the flagships: rings and blocks of `skyline-tower` volumes (window-grid facades
 * that light up at night) with varied heights, setbacks and materials, plus a street grid far below.
 * Deterministic from the builder's seed.
 */
import type { Builder, V3 } from '../builder';
import { r2 } from '../builder';

/** Wall colours of the towers: warm concrete, pale stone and brick, and the darker blue-grey of glass curtain walls. */
const PALETTE = ['#b9b2a6', '#c4bdb0', '#a8a39b', '#b49a8a', '#9d9a94'] as const;
const GLASS_PALETTE = ['#5d6b7a', '#4f6270', '#6a7a86', '#46586a', '#566873'] as const;

/** Options of {@link skylineRing}. */
export interface SkylineRingOptions {
  /** Ring centre (x, z). */
  center: readonly [number, number];
  /** Number of towers. */
  count: number;
  /** Nearest and farthest tower centres from the centre (m). */
  radius: readonly [number, number];
  /** Tower top above the base y (m), nearest to farthest-tallest. */
  height: readonly [number, number];
  /** Base height of the towers (m): the street level they stand on. */
  baseY: number;
  /** Glass share 0..1 (the rest concrete, some brick). */
  glass?: number;
}

/** A ring of towers around `center`, taller at the back; returns their ids. */
export function skylineRing(b: Builder, o: SkylineRingOptions): string[] {
  const ids: string[] = [];
  for (let i = 0; i < o.count; i++) {
    const a = (i / o.count) * Math.PI * 2 + b.rand(-0.5, 0.5) * ((Math.PI * 2) / o.count);
    const d = b.rand(o.radius[0], o.radius[1]);
    const t = (d - o.radius[0]) / Math.max(1, o.radius[1] - o.radius[0]);
    // A few landmarks far out are much taller.
    const landmark = i % 9 === 0;
    const h = r2(landmark ? o.height[1] * b.rand(1.1, 1.35) : b.rand(o.height[0], o.height[0] + (o.height[1] - o.height[0]) * (0.35 + 0.65 * t)));
    const w = r2(b.rand(18, 42));
    const glass = b.rand(0, 1) < (o.glass ?? 0.45);
    const variant = glass ? 0 : b.rand(0, 1) < 0.2 ? 2 : 1;
    const pos: V3 = [r2(o.center[0] + Math.cos(a) * d), o.baseY, r2(o.center[1] + Math.sin(a) * d)];
    ids.push(
      b.gen('tower', 'skyline-tower', { width: w, depth: r2(w * b.rand(0.7, 1.2)), height: h, setbacks: landmark ? 3 : b.int(0, 2), variant, color: b.pick(variant === 0 ? [...GLASS_PALETTE] : [...PALETTE]) }, pos, {
        yaw: r2(b.rand(-8, 8) + Math.round((a * 180) / Math.PI / 90) * 90),
        tags: ['backdrop', 'city'],
        castShadow: false,
      }),
    );
  }
  return ids;
}

/**
 * A street grid on the ground far below a rooftop: dark asphalt slab with pale lane lines, so the gaps between
 * towers show streets rather than a void.
 */
export function cityStreets(b: Builder, center: readonly [number, number], baseY: number, extent: number): void {
  b.prim('city-ground', 'box', [extent * 2, 0.4, extent * 2], [center[0], baseY - 0.2, center[1]], { name: 'City streets', material: { finish: 'asphalt', color: '#4a4a4e' }, castShadow: false, tags: ['backdrop', 'city'] });
  for (let k = -3; k <= 3; k++) {
    const o = k * (extent / 3.4);
    b.prim('avenue-line', 'box', [extent * 2, 0.05, 0.5], [center[0], baseY + 0.03, center[1] + o], { material: { preset: 'plastic', color: '#d7d0bd', roughness: 0.6 }, castShadow: false, tags: ['backdrop', 'city'] });
    b.prim('avenue-line', 'box', [0.5, 0.05, extent * 2], [center[0] + o, baseY + 0.03, center[1]], { material: { preset: 'plastic', color: '#d7d0bd', roughness: 0.6 }, castShadow: false, tags: ['backdrop', 'city'] });
  }
}
