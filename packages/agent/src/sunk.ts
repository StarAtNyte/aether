/**
 * Sunk pieces: buildings and props whose floor sits below the terrain on their high side (a house on a slope set on its
 * lowest corner buries its uphill ground floor; a shrine dropped onto a rise disappears to the lintel). The grounding check
 * of the level tools finds what hovers; this finds the opposite, measured against the terrain heightfield under the
 * piece's real footprint (the generator's own bounds), for every separate piece and every instance of a scatter layer.
 *
 * The same footprint read, sampled on every side, finds the opposite too: a piece whose foot is well above the ground on
 * one side hangs over a cliff edge or a steep bank (finding `over_edge`).
 *
 * It runs in every review round by default, so the model sees it without asking. Pieces meant to sit in the ground are
 * left out: walls, fences, stairs, piers, bridges, roads, natural pieces (rocks, trees), and anything tagged "sunk",
 * "buried" or "underground".
 */
import type { Entity, Json, WorldDoc } from '@aether/core';
import { findingKey, scoreFindings, type Finding } from '@aether/arch';
import type { ReviewSnapshot } from './review';
import { generateBuiltinSync, getBuiltinGenerator } from '@aether/procgen';
import { worldGround } from './land';

/** Most pieces and scatter instances measured per call. */
export const SUNK_LIMITS = Object.freeze({ MAX_PIECES: 400, MAX_INSTANCES: 3000 });

const CHECKED_CATEGORIES: ReadonlySet<string> = new Set(['architecture', 'props', 'interior', 'vehicles']);
/** Generators that are built to go into the ground or follow it. */
// Whole words of the hyphenated id ("dwelling" is not a well).
const IN_GROUND = /(^|-)(walls?|fences?|hedges?|stairs?|steps?|stairway|retaining|terraces?|piers?|piles?|bridges?|aqueducts?|cliffs?|roads?|streets?|lanes?|paths?|paving|pavement|plaza|bollards?|kerbs?|curbs?|ramps?|tunnels?|wells?|pools?|ponds?|canals?|docks?|quays?|graves?|ruins?|rubble|ground|terrain|water|waterfall|fall|sheet)(s)?($|-)/;
const OPT_OUT = /^(sunk|buried|underground|in-ground|dug-in)$/;
/** Tags that say a piece hangs out over a drop on purpose (a cantilevered deck, a balcony shrine). */
const OVERHANG_OK = /float|cantilever|overhang|hanging|balcony/;
const SKIP_TAG = /^(terrain|land|hill|backdrop|water|sky|scenery)$|float|hover|fly|cloud|bird|hanging|ceiling/;

/** One piece (or scatter layer) that is sunk into the ground. */
export interface SunkPiece {
  id: string;
  generator: string;
  /** Metres between the bottom and the highest ground under the footprint (the worst instance of a layer). */
  depth: number;
  height: number;
  /** Instances of a scatter layer that are sunk, and how many were measured (1 and 1 for a single piece). */
  sunk: number;
  of: number;
  /** Ground rise across the footprint at the worst instance (what a footing would have to make up). */
  climb: number;
  /** sunk: the floor is under the ground on the high side; overhang: the foot is above the ground on the low side (a cliff edge). */
  kind: 'sunk' | 'overhang';
}

const boundsCache = new Map<string, { min: [number, number, number]; max: [number, number, number] } | null>();

function localBounds(generator: string, params: Record<string, Json>, seed: number): { min: [number, number, number]; max: [number, number, number] } | null {
  const key = `${generator}|${seed}|${JSON.stringify(params)}`;
  if (boundsCache.has(key)) return boundsCache.get(key) ?? null;
  let b: { min: [number, number, number]; max: [number, number, number] } | null = null;
  try {
    const out = generateBuiltinSync(generator, params, seed);
    if (out.bounds.min.every(Number.isFinite) && out.bounds.max.every(Number.isFinite)) b = { min: [...out.bounds.min] as [number, number, number], max: [...out.bounds.max] as [number, number, number] };
  } catch {
    b = null;
  }
  if (boundsCache.size > 600) boundsCache.clear();
  boundsCache.set(key, b);
  return b;
}

/** A building the world defines itself (its generator code lives in the world): looked at by name and sized from its params. */
const BUILT = /house|home|cottage|villa|temple|shrine|tholos|chapel|church|tower|hall|shop|inn|tavern|barn|hut|cabin|pavilion|kiosk|stoa|palace|castle|fort|mill|building|dwelling|block|apartment/;

function checked(e: Entity, generator: string, world: WorldDoc): boolean {
  if (e.template || !e.visible || e.parent) return false;
  if (e.tags.some((t) => OPT_OUT.test(t) || SKIP_TAG.test(t))) return false;
  if (IN_GROUND.test(generator)) return false;
  const builtin = getBuiltinGenerator(generator);
  if (builtin) return CHECKED_CATEGORIES.has(builtin.category);
  return BUILT.test(generator) && world.generators?.[generator] !== undefined;
}

/** Footprint and height of a world-defined piece from its params (width, depth, height or floors), or null. */
function paramBounds(params: Record<string, Json>): { min: [number, number, number]; max: [number, number, number] } | null {
  const num = (k: string): number | null => (typeof params[k] === 'number' && Number.isFinite(params[k]) ? (params[k] as number) : null);
  const w = num('width') ?? num('size') ?? num('length');
  if (w === null || w <= 0) return null;
  const d = num('depth') ?? w;
  const h = num('height') ?? (num('floors') ?? 1) * 3.2 + 1.5;
  return { min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] };
}

/**
 * Every sunk piece of `world`: the floor of the piece is more than 0.6 to 1.2 m (a fifth of its height) under the highest
 * terrain point of its footprint. Worlds with no terrain have nothing to sink into and return an empty list.
 */
export function findSunk(world: WorldDoc): SunkPiece[] {
  const hasTerrain = Object.values(world.entities).some((e) => e.shape.kind === 'procedural' && e.shape.generator === 'terrain' && !e.parent);
  if (!hasTerrain) return [];
  const ground = worldGround(world);
  const decks = supports(world);
  const out: SunkPiece[] = [];
  let pieces = 0;
  let instances = 0;
  for (const e of Object.values(world.entities)) {
    if (pieces >= SUNK_LIMITS.MAX_PIECES || instances >= SUNK_LIMITS.MAX_INSTANCES) break;
    const s = e.shape;
    const shape = s.kind === 'scatter' ? s.of : s;
    if (shape.kind !== 'procedural' || !checked(e, shape.generator, world)) continue;
    const params = shape.params as Record<string, Json>;
    const b = getBuiltinGenerator(shape.generator) ? localBounds(shape.generator, params, shape.seed ?? 0) : paramBounds(params);
    // A stone footing (a house on a slope) is meant to be in the ground: the floor is on top of it.
    const footing = typeof params['footing'] === 'number' && Number.isFinite(params['footing']) ? Math.max(0, params['footing']) : 0;
    if (!b) continue;
    const [sx, sy, sz] = e.transform.scale;
    const [ox, oy, oz] = e.transform.position;
    const yaw = (e.transform.rotation[1] * Math.PI) / 180;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const height = (b.max[1] - b.min[1]) * sy;
    const narrow = Math.min((b.max[0] - b.min[0]) * sx, (b.max[2] - b.min[2]) * sz);
    if (!(height > 0.3)) continue;
    const pts: Array<[number, number, number]> = s.kind === 'scatter' ? (s.points ?? []).slice(0, SUNK_LIMITS.MAX_INSTANCES - instances).map(([x, y, z]) => [ox + x * c + z * sn, oy + y, oz - x * sn + z * c]) : [[ox, oy, oz]];
    if (pts.length === 0) continue;
    pieces++;
    instances += pts.length;
    let worst = 0;
    let worstClimb = 0;
    let sunk = 0;
    let over = 0;
    let worstOver = 0;
    let overClimb = 0;
    for (const [px, py, pz] of pts) {
      const foot = py + b.min[1] * sy;
      const bottom = foot + footing * sy;
      let hi = -Infinity;
      let lo = Infinity;
      let held = Infinity;
      let dropped = 0;
      // Every side, corners and edges included: a slope or a cliff can fall away on one side only.
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        for (const v of [0, 0.25, 0.5, 0.75, 1]) {
          const lx = (b.min[0] + (b.max[0] - b.min[0]) * u) * sx;
          const lz = (b.min[2] + (b.max[2] - b.min[2]) * v) * sz;
          const h = ground(px + lx * c + lz * sn, pz - lx * sn + lz * c);
          hi = Math.max(hi, h);
          lo = Math.min(lo, h);
          // What the foot can stand on at this point: the terrain or a built surface (a platform, a landing, a terrace) under it.
          const under = Math.max(h, decks.top(px + lx * c + lz * sn, pz - lx * sn + lz * c, foot + 0.4, e.id));
          held = Math.min(held, under);
          if (foot - under > 1) dropped++;
        }
      }
      const depth = hi - bottom;
      if (depth > Math.max(0.6, Math.min(1.2, height * 0.2))) {
        sunk++;
        if (depth > worst) {
          worst = depth;
          worstClimb = hi - lo;
        }
      }
      // Hanging over a drop: the foot (of the footing, when it has one) is well above the ground on some side.
      const gap = foot - held;
      // A thin piece at an edge (a railing, a column, a banner) is meant to be there; so is a corner just past it: a fifth of
      // the footprint (5 of the 25 points) has to be over the drop.
      if (narrow < 1.5 || dropped < 5) continue;
      if (gap > Math.max(1, Math.min(2, height * 0.25))) {
        over++;
        if (gap > worstOver) {
          worstOver = gap;
          overClimb = hi - lo;
        }
      }
    }
    if (sunk > 0) out.push({ id: e.id, generator: shape.generator, depth: worst, height, sunk, of: pts.length, climb: worstClimb, kind: 'sunk' });
    if (over > 0 && !e.tags.some((t) => OVERHANG_OK.test(t))) out.push({ id: e.id, generator: shape.generator, depth: worstOver, height, sunk: over, of: pts.length, climb: overClimb, kind: 'overhang' });
  }
  return out.sort((p, q) => q.depth - p.depth);
}

/** Top faces of the built pieces (primitives and generated shapes, as world boxes), bucketed on a 10 m grid. */
function supports(world: WorldDoc): { top(x: number, z: number, below: number, not: string): number } {
  const cell = 10;
  const grid = new Map<string, Array<{ id: string; x0: number; x1: number; z0: number; z1: number; y: number }>>();
  for (const e of Object.values(world.entities)) {
    if (e.template || !e.visible || e.parent || e.tags.some((t) => SKIP_TAG.test(t))) continue;
    const s = e.shape;
    let b: { min: [number, number, number]; max: [number, number, number] } | null = null;
    if (s.kind === 'primitive' && Array.isArray(s.size)) {
      const [w, h, d] = s.size as number[];
      b = { min: [-(w ?? 1) / 2, -(h ?? 1) / 2, -(d ?? 1) / 2], max: [(w ?? 1) / 2, (h ?? 1) / 2, (d ?? 1) / 2] };
    } else if (s.kind === 'procedural' && s.generator !== 'terrain') {
      const params = s.params as Record<string, Json>;
      b = getBuiltinGenerator(s.generator) ? localBounds(s.generator, params, s.seed ?? 0) : paramBounds(params);
    }
    if (!b) continue;
    const [sx, sy, sz] = e.transform.scale;
    const [ox, oy, oz] = e.transform.position;
    const yaw = (e.transform.rotation[1] * Math.PI) / 180;
    const c = Math.abs(Math.cos(yaw));
    const sn = Math.abs(Math.sin(yaw));
    const hx = ((b.max[0] - b.min[0]) * sx) / 2;
    const hz = ((b.max[2] - b.min[2]) * sz) / 2;
    const cx = ox + ((b.max[0] + b.min[0]) / 2) * sx;
    const cz = oz + ((b.max[2] + b.min[2]) / 2) * sz;
    // The box turned by its yaw, as an axis-aligned box (a little generous for a turned piece).
    const ex = hx * c + hz * sn;
    const ez = hx * sn + hz * c;
    if (ex > 150 || ez > 150) continue;
    const box = { id: e.id, x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez, y: oy + b.max[1] * sy };
    for (let i = Math.floor(box.x0 / cell); i <= Math.floor(box.x1 / cell); i++) {
      for (let k = Math.floor(box.z0 / cell); k <= Math.floor(box.z1 / cell); k++) {
        const key = `${i},${k}`;
        const list = grid.get(key);
        if (list) list.push(box);
        else grid.set(key, [box]);
      }
    }
  }
  return {
    top(x, z, below, not) {
      let y = -Infinity;
      for (const b of grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []) {
        if (b.id !== not && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && b.y <= below && b.y > y) y = b.y;
      }
      return y;
    },
  };
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** The sunk pieces as review findings (warnings), with the fix for each. */
export function sunkFindings(world: WorldDoc): Finding[] {
  return findSunk(world)
    .slice(0, 24)
    .map((p) => {
      const what = p.of > 1 ? `${p.sunk} of ${p.of} ${p.generator} in ${p.id} are` : `${p.id} (${p.generator}) is`;
      const house = p.generator === 'furn-dwelling';
      if (p.kind === 'overhang') {
        const fix = house
          ? `stand it on the lowest ground of the footprint with params.footing ${r1(Math.min(6, Math.max(0.5, p.climb - 0.2)))} (a stone base down to the ground), or move it back from the edge`
          : `move it back from the edge onto ground that carries the whole footprint, or set it on a plinth, terrace or retaining wall that reaches the ground; tag it "floating" if it hangs out on purpose`;
        return { code: 'over_edge', severity: 'warning', message: `${what} hanging over a drop: the ground falls ${r1(p.depth)} m below its foot on the low side (a cliff edge or a steep bank).`, entities: [p.id], fix } as Finding;
      }
      const fix = house
        ? `give the house a stone footing: params.footing ${r1(Math.min(6, Math.max(0.5, p.climb - 0.2)))} with its y on the lowest ground of the footprint (shape_land street does this on a slope), or move it to flatter ground`
        : `raise it by about ${r1(Math.max(0.2, p.depth - 0.3))} m onto the ground, set it on a plinth or terrace, or move it to flatter ground; tag it "sunk" if it is dug in on purpose`;
      return { code: 'sunk_in_ground', severity: 'warning', message: `${what} sunk into the terrain: the floor is ${r1(p.depth)} m under the ground on the high side (${r1(p.height)} m tall).`, entities: [p.id], fix } as Finding;
    });
}

/** `snap` with the sunk pieces of `world` added to its findings (score and keys follow), so every review round checks it. */
export function withSunk(snap: ReviewSnapshot, world: WorldDoc): ReviewSnapshot {
  let extra: Finding[];
  try {
    extra = sunkFindings(world);
  } catch {
    return snap;
  }
  if (extra.length === 0) return snap;
  const findings = [...snap.findings.filter((f) => f.code !== 'sunk_in_ground' && f.code !== 'over_edge'), ...extra];
  return { ...snap, findings, score: scoreFindings(findings), keys: new Set(findings.map(findingKey)) };
}
