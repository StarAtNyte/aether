/**
 * The terrain settle's measurement (pure, no world): see settle.ts for the rule. Kept apart so the offline builder can use
 * it without pulling in the sunk check.
 */
import type { Json } from '@aether/core';
import { getBuiltinGenerator } from '@aether/procgen';
import { bodyBounds, pieceBounds, type Bounds } from './footprint';

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
/** A stone base reaches this far past the footprint on its upper tier, and this far on its lower tier (m): a modest foundation. */
export const PLINTH_MARGIN = 0.3;
export const PLINTH_MARGIN_LOW = 0.6;
const PLINTH_DEPTH = 0.3;
/** Above this fall across the footprint (m) a solid wall would be a retaining wall: the floor stands on stone piers (pilotis). */
export const STILT_FALL = 1.5;
/** Pier radius and the most piers along a side. */
const PIER_R = 0.2;
const MAX_PIERS_SIDE = 5;

/** One part of a foundation (a box or a pier), in world space. */
export interface FoundationPart {
  shape: 'box' | 'cylinder';
  position: [number, number, number];
  /** Box: width, height, depth. Cylinder: diameter, height, diameter. */
  size: [number, number, number];
  yaw: number;
}

/** What settling a footprint on the ground measured. */
export interface Settled {
  /** Floor height: the highest ground of the footprint plus the clearance (on a slope). */
  floorY: number;
  /** Highest and lowest ground under the footprint. */
  hi: number;
  lo: number;
  /** The foundation to add: a one or two tier stone base, or piers on a steep fall; empty on level ground. */
  foundation: FoundationPart[];
}

/**
 * Settle a footprint on the ground: sample the real (rotated, scaled) footprint of `bounds` at `at` (x, z) and return
 * the floor height and a modest foundation under it: a stone base a little larger than the building (two stepped tiers on
 * a fall over half a metre), or stone piers (pilotis) where the fall is over {@link STILT_FALL}, never a terrace.
 */
export function settleOnTerrain(h: (x: number, z: number) => number, at: readonly [number, number], bounds: Bounds, yawDeg = 0, scale: readonly [number, number, number] = [1, 1, 1]): Settled {
  const yaw = (yawDeg * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const world = (lx: number, lz: number): [number, number] => [at[0] + lx * c + lz * s, at[1] - lx * s + lz * c];
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) {
      const lx = (bounds.min[0] + ((bounds.max[0] - bounds.min[0]) * i) / 4) * scale[0];
      const lz = (bounds.min[2] + ((bounds.max[2] - bounds.min[2]) * j) / 4) * scale[2];
      const g = h(...world(lx, lz));
      hi = Math.max(hi, g);
      lo = Math.min(lo, g);
    }
  }
  if (hi - lo <= SETTLE_FLAT) return { floorY: r2(hi), hi, lo, foundation: [] };
  const floorY = r2(hi + SETTLE_CLEARANCE);
  const fw = (bounds.max[0] - bounds.min[0]) * scale[0];
  const fd = (bounds.max[2] - bounds.min[2]) * scale[2];
  // The footprint's centre in the local frame, carried to the world (the bounds need not be centred on the origin).
  const mx = ((bounds.min[0] + bounds.max[0]) / 2) * scale[0];
  const mz = ((bounds.min[2] + bounds.max[2]) / 2) * scale[2];
  const foundation: FoundationPart[] = [];
  if (hi - lo > STILT_FALL) {
    const nx = Math.min(MAX_PIERS_SIDE, Math.max(2, Math.ceil(fw / 2.4) + 1));
    const nz = Math.min(MAX_PIERS_SIDE, Math.max(2, Math.ceil(fd / 2.4) + 1));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const lx = mx - fw / 2 + 0.25 + ((fw - 0.5) * i) / (nx - 1);
        const lz = mz - fd / 2 + 0.25 + ((fd - 0.5) * j) / (nz - 1);
        const [px, pz] = world(lx, lz);
        const bottom = h(px, pz) - 0.4;
        foundation.push({ shape: 'cylinder', position: [r2(px), r2((floorY + bottom) / 2), r2(pz)], size: [PIER_R * 2, r2(floorY - bottom), PIER_R * 2], yaw: yawDeg });
      }
    }
    return { floorY, hi, lo, foundation };
  }
  const bottom = lo - PLINTH_DEPTH;
  const [cx, cz] = world(mx, mz);
  const tier = (margin: number, y0: number, y1: number): FoundationPart => ({ shape: 'box', position: [r2(cx), r2((y0 + y1) / 2), r2(cz)], size: [r2(fw + margin * 2), r2(y1 - y0), r2(fd + margin * 2)], yaw: yawDeg });
  if (hi - lo > 0.5) {
    const mid = (floorY + bottom) / 2;
    foundation.push(tier(PLINTH_MARGIN_LOW, bottom, mid), tier(PLINTH_MARGIN, mid - 0.02, floorY));
  } else foundation.push(tier(PLINTH_MARGIN, bottom, floorY));
  return { floorY, hi, lo, foundation };
}

/** Bounds of a piece's generator for settling (null when the piece has no footprint). */
export function settleBounds(generator: string, params: Record<string, Json>, seed: number): Bounds | null {
  const b = getBuiltinGenerator(generator) ? bodyBounds(generator, params, seed) : pieceBounds(generator, params, seed);
  return b && b.max[1] - b.min[1] > 0.3 ? b : null;
}

/** Stone of the plinths the harness adds. */
export const PLINTH_MATERIAL = Object.freeze({ preset: 'stone', color: '#9a948a', roughness: 0.9 });


const r2 = (n: number): number => Math.round(n * 100) / 100;
