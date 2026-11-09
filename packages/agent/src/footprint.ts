/**
 * Footprints of generated pieces: the local bounds of what a generator draws, for a built-in generator (its own output),
 * a library generator (its catalogue size) or a world-defined one (its width, depth and height params). Shared by the
 * sunk check (sunk.ts), the terrain settle (settle.ts) and the offline builder, which place a building by its footprint.
 */
import type { Json } from '@aether/core';
import { GENERATOR_LIBRARY, generateBuiltinSync, getBuiltinGenerator } from '@aether/procgen';

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

const boundsCache = new Map<string, Bounds | null>();
const bodyCache = new Map<string, Bounds>();

/** Local bounds of a built-in generator's output for these params (cached), or null. */
export function localBounds(generator: string, params: Record<string, Json>, seed: number): Bounds | null {
  const key = `${generator}|${seed}|${JSON.stringify(params)}`;
  if (boundsCache.has(key)) return boundsCache.get(key) ?? null;
  let b: Bounds | null = null;
  try {
    const out = generateBuiltinSync(generator, params, seed);
    if (out.bounds.min.every(Number.isFinite) && out.bounds.max.every(Number.isFinite)) {
      b = { min: [...out.bounds.min] as [number, number, number], max: [...out.bounds.max] as [number, number, number] };
      // The building's own footprint: the box colliders are its solid mass (floor, walls, veranda), without a garden's stones or the eaves.
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const c of out.colliders) {
        if (c.kind !== 'box' || c.rotation) continue;
        const o = c.offset ?? [0, 0, 0];
        x0 = Math.min(x0, o[0] - c.halfExtents[0]);
        x1 = Math.max(x1, o[0] + c.halfExtents[0]);
        z0 = Math.min(z0, o[2] - c.halfExtents[2]);
        z1 = Math.max(z1, o[2] + c.halfExtents[2]);
      }
      if (Number.isFinite(x0) && (x1 - x0) * (z1 - z0) > 0.25 * (b.max[0] - b.min[0]) * (b.max[2] - b.min[2])) bodyCache.set(key, { min: [x0, b.min[1], z0], max: [x1, b.max[1], z1] });
    }
  } catch {
    b = null;
  }
  if (boundsCache.size > 600) {
    boundsCache.clear();
    bodyCache.clear();
  }
  boundsCache.set(key, b);
  return b;
}

/** The building's own footprint (the solid mass of its colliders) of a built-in generator, else its bounds: what a foundation is sized from. */
export function bodyBounds(generator: string, params: Record<string, Json>, seed: number): Bounds | null {
  const b = localBounds(generator, params, seed);
  return bodyCache.get(`${generator}|${seed}|${JSON.stringify(params)}`) ?? b;
}

/** Footprint and height of a world-defined piece from its params (width, depth, height or floors), or null. */
export function paramBounds(params: Record<string, Json>): Bounds | null {
  const num = (k: string): number | null => (typeof params[k] === 'number' && Number.isFinite(params[k]) ? (params[k] as number) : null);
  const w = num('width') ?? num('size') ?? num('length');
  if (w === null || w <= 0) return null;
  const d = num('depth') ?? w;
  const h = num('height') ?? (num('floors') ?? 1) * 3.2 + 1.5;
  return { min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] };
}

/**
 * Bounds of any generated piece: a built-in generator's output, else the width/depth/height params, else the library
 * catalogue's size at default params (a pagoda, a torii, a gazebo: their params do not carry a footprint), else null.
 */
export function pieceBounds(generator: string, params: Record<string, Json>, seed: number): Bounds | null {
  if (getBuiltinGenerator(generator)) return bodyBounds(generator, params, seed);
  const byParams = paramBounds(params);
  if (byParams) return byParams;
  const entry = GENERATOR_LIBRARY.find((e) => e.id === generator);
  if (!entry) return null;
  const [w, h, d] = entry.size;
  return { min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] };
}
