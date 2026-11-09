/**
 * The terrain settle's measurement (pure, no world): see settle.ts for the rule. Kept apart so the offline builder can use
 * it without pulling in the sunk check.
 */
import type { Json } from '@aether/core';
import { pieceBounds, type Bounds } from './footprint';

/** Generators that are built to go into the ground or follow it (walls, bridges, docks, paths...): never settled on a plinth. Whole words of the hyphenated id ("dwelling" is not a well). */
export const IN_GROUND = /(^|-)(walls?|fences?|hedges?|stairs?|steps?|stairway|retaining|terraces?|piers?|piles?|bridges?|aqueducts?|cliffs?|roads?|streets?|lanes?|paths?|paving|pavement|plaza|bollards?|kerbs?|curbs?|ramps?|tunnels?|wells?|pools?|ponds?|canals?|docks?|quays?|graves?|ruins?|rubble|ground|terrain|water|waterfall|fall|sheet)(s)?($|-)/;
/** Library structures (not built in) that stand on the ground: a pagoda, a gazebo, a torii. */
export const LIBRARY_BUILT = /(^|-)(house|home|cottage|villa|temple|shrine|pagoda|gazebo|torii|pavilion|tower|lighthouse|windmill|chapel|church|hut|cabin|barn|pergola|kiosk)(s)?($|-)/;
/** Building and structure words of generator ids (built-in, library or world-defined). */
const STRUCTURE = /(^|-)(house|home|cottage|villa|temple|shrine|chapel|church|tower|hall|shop|inn|tavern|barn|hut|cabin|pavilion|kiosk|palace|castle|fort|mill|building|dwelling|apartment|gazebo|pagoda|tholos|teahouse|chashitsu|machiya|minka|lodge|bungalow|manor|farmhouse)(s)?($|-)/;

/** True when a generator makes a building or structure that stands on its footprint (settled on terrain by default). */
export function isSettleable(generator: string): boolean {
  if (IN_GROUND.test(generator)) return false;
  return STRUCTURE.test(generator) || LIBRARY_BUILT.test(generator);
}

/** On a slope the base stands this far above the highest ground of the footprint (m): a footing shows, the floor is never in the ground. */
export const SETTLE_CLEARANCE = 0.06;
/** Ground rise across the footprint (m) under which no plinth is needed (the floor slab covers a hand's height). */
export const SETTLE_FLAT = 0.08;
/** The plinth reaches this far past the footprint on every side and this far below the lowest ground (m). */
export const PLINTH_MARGIN = 0.3;
const PLINTH_DEPTH = 0.6;

/** What settling a footprint on the ground measured. */
export interface Settled {
  /** Floor height: the highest ground of the footprint plus the clearance. */
  floorY: number;
  /** Highest and lowest ground under the footprint. */
  hi: number;
  lo: number;
  /** The plinth to add (centre, size, yaw in degrees), or null on level ground. */
  plinth: { position: [number, number, number]; size: [number, number, number]; yaw: number } | null;
}

/**
 * Settle a footprint on the ground: sample the real (rotated, scaled) footprint of `bounds` at `at` (x, z) and return
 * the floor height and the plinth that fills the slope under it.
 */
export function settleOnTerrain(h: (x: number, z: number) => number, at: readonly [number, number], bounds: Bounds, yawDeg = 0, scale: readonly [number, number, number] = [1, 1, 1]): Settled {
  const yaw = (yawDeg * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) {
      const lx = (bounds.min[0] + ((bounds.max[0] - bounds.min[0]) * i) / 4) * scale[0];
      const lz = (bounds.min[2] + ((bounds.max[2] - bounds.min[2]) * j) / 4) * scale[2];
      const g = h(at[0] + lx * c + lz * s, at[1] - lx * s + lz * c);
      hi = Math.max(hi, g);
      lo = Math.min(lo, g);
    }
  }
  if (hi - lo <= SETTLE_FLAT) return { floorY: r2(hi), hi, lo, plinth: null };
  const floorY = r2(hi + SETTLE_CLEARANCE);
  const w = (bounds.max[0] - bounds.min[0]) * scale[0] + PLINTH_MARGIN * 2;
  const d = (bounds.max[2] - bounds.min[2]) * scale[2] + PLINTH_MARGIN * 2;
  const bottom = lo - PLINTH_DEPTH;
  // The footprint's centre in the local frame, carried to the world (the bounds need not be centred on the origin).
  const mx = ((bounds.min[0] + bounds.max[0]) / 2) * scale[0];
  const mz = ((bounds.min[2] + bounds.max[2]) / 2) * scale[2];
  return {
    floorY,
    hi,
    lo,
    plinth: { position: [r2(at[0] + mx * c + mz * s), r2((floorY + bottom) / 2), r2(at[1] - mx * s + mz * c)], size: [r2(w), r2(floorY - bottom), r2(d)], yaw: yawDeg },
  };
}

/** Bounds of a piece's generator for settling (null when the piece has no footprint). */
export function settleBounds(generator: string, params: Record<string, Json>, seed: number): Bounds | null {
  const b = pieceBounds(generator, params, seed);
  return b && b.max[1] - b.min[1] > 0.3 ? b : null;
}

/** Stone of the plinths the harness adds. */
export const PLINTH_MATERIAL = Object.freeze({ preset: 'stone', color: '#9a948a', roughness: 0.9 });


const r2 = (n: number): number => Math.round(n * 100) / 100;
