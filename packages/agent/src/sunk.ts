/**
 * Sunk pieces: buildings and props whose floor sits below the terrain on their high side (a house on a slope set on its
 * lowest corner buries its uphill ground floor; a shrine dropped onto a rise disappears to the lintel). The grounding check
 * of the level tools finds what hovers; this finds the opposite, measured against the terrain heightfield under the
 * piece's real footprint (the generator's own bounds), for every separate piece and every instance of a scatter layer.
 *
 * The same footprint read, sampled on every side, finds the opposite too: a piece whose foot is well above the ground on
 * one side hangs over a cliff edge or a steep bank (finding `over_edge`).
 *
 * Rocks, boulders and bushes are measured the other way round ({@link findAfloat}): one whose foot is in the air (perched on a
 * cliff edge, a scatter row laid out at one height across a cliff face) is reported as `afloat`.
 *
 * It runs in every review round by default, so the model sees it without asking. Pieces meant to sit in the ground are
 * left out: walls, fences, stairs, piers, bridges, roads, natural pieces (rocks, trees), and anything tagged "sunk",
 * "buried" or "underground".
 */
import type { Entity, Json, WorldDoc } from '@aether/core';
import { findingKey, scoreFindings, type Finding } from '@aether/arch';
import type { ReviewSnapshot } from './review';
import { getBuiltinGenerator, isLibraryGenerator } from '@aether/procgen';
import { worldGround } from './land';
import { localBounds, paramBounds, pieceBounds } from './footprint';
import { IN_GROUND, LIBRARY_BUILT } from './settle-core';

export { localBounds, paramBounds };
import { rockTop } from './falls';

/** Most pieces and scatter instances measured per call. */
export const SUNK_LIMITS = Object.freeze({ MAX_PIECES: 400, MAX_INSTANCES: 3000 });

const CHECKED_CATEGORIES: ReadonlySet<string> = new Set(['architecture', 'props', 'interior', 'vehicles']);
const OPT_OUT = /^(sunk|buried|underground|in-ground|dug-in)$/;
/** Tags that say a piece hangs out over a drop on purpose (a cantilevered deck, a balcony shrine). */
const OVERHANG_OK = /float|cantilever|overhang|hanging|balcony/;
/** Generators that are a solid mass of rock (see falls.ts). */
const ROCK_GEN = /(^|-)(cliffs?|crags?|bluffs?|escarpments?|scarps?|rockface|rock-wall|mesas?|buttes?)($|-)/;
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
  /** sunk: the floor is under the ground on the high side; overhang: the foot is above the ground on the low side (a cliff edge);
   * afloat: a rock or bush whose foot is in the air (see {@link findAfloat}). */
  kind: 'sunk' | 'overhang' | 'afloat';
}

/** A building the world defines itself (its generator code lives in the world): looked at by name and sized from its params. */
const BUILT = /house|home|cottage|villa|temple|shrine|tholos|chapel|church|tower|hall|shop|inn|tavern|barn|hut|cabin|pavilion|kiosk|stoa|palace|castle|fort|mill|building|dwelling|block|apartment/;

function checked(e: Entity, generator: string, world: WorldDoc): boolean {
  if (e.template || !e.visible || e.parent) return false;
  if (e.tags.some((t) => OPT_OUT.test(t) || SKIP_TAG.test(t))) return false;
  if (IN_GROUND.test(generator)) return false;
  const builtin = getBuiltinGenerator(generator);
  if (builtin) return CHECKED_CATEGORIES.has(builtin.category);
  return (BUILT.test(generator) && world.generators?.[generator] !== undefined) || (isLibraryGenerator(generator) && LIBRARY_BUILT.test(generator));
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
  // Piers and stone bases the harness or the model added under a building (tag "foundation"): it stands on them over the drop on purpose.
  const foundations = Object.values(world.entities).filter((f) => f.tags.includes('foundation')).map((f) => f.transform.position);
  const out: SunkPiece[] = [];
  let pieces = 0;
  let instances = 0;
  for (const e of Object.values(world.entities)) {
    if (pieces >= SUNK_LIMITS.MAX_PIECES || instances >= SUNK_LIMITS.MAX_INSTANCES) break;
    const s = e.shape;
    const shape = s.kind === 'scatter' ? s.of : s;
    if (shape.kind !== 'procedural' || !checked(e, shape.generator, world)) continue;
    const params = shape.params as Record<string, Json>;
    const b = pieceBounds(shape.generator, params, shape.seed ?? 0);
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
          // What the foot can stand on at this point: the terrain or a built surface (a platform, a landing, a terrace) under it,
          // or rock it is set into (a cliff top higher than the foot on the uphill side carries it there).
          const under = Math.max(h, decks.top(px + lx * c + lz * sn, pz - lx * sn + lz * c, foot + Math.max(0.4, height), e.id));
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
    const footed = foundations.some((f) => Math.abs(f[0] - ox) <= narrow + 2 && Math.abs(f[2] - oz) <= narrow + 2);
    if (over > 0 && !footed && !e.tags.some((t) => OVERHANG_OK.test(t))) out.push({ id: e.id, generator: shape.generator, depth: worstOver, height, sunk: over, of: pts.length, climb: overClimb, kind: 'overhang' });
  }
  return out.sort((p, q) => q.depth - p.depth);
}

/** Top faces of the built pieces (primitives and generated shapes, as world boxes), bucketed on a 10 m grid. */
export function supports(world: WorldDoc): { top(x: number, z: number, below: number, not: string): number; solidAt(x: number, z: number, y: number, not: string): boolean } {
  const cell = 10;
  type Deck = { id: string; x0: number; x1: number; z0: number; z1: number; y: number; bottom: number; rock?: { fn: (lx: number, lz: number) => number; ox: number; oy: number; oz: number; sx: number; sy: number; sz: number; c: number; s: number } };
  const grid = new Map<string, Deck[]>();
  for (const e of Object.values(world.entities)) {
    if (e.template || !e.visible || e.parent || e.tags.some((t) => SKIP_TAG.test(t))) continue;
    const s = e.shape;
    let b: { min: [number, number, number]; max: [number, number, number] } | null = null;
    let rock: ((lx: number, lz: number) => number) | null = null;
    if (s.kind === 'primitive' && Array.isArray(s.size)) {
      const [w, h, d] = s.size as number[];
      b = { min: [-(w ?? 1) / 2, -(h ?? 1) / 2, -(d ?? 1) / 2], max: [(w ?? 1) / 2, (h ?? 1) / 2, (d ?? 1) / 2] };
    } else if (s.kind === 'procedural' && s.generator !== 'terrain') {
      const params = s.params as Record<string, Json>;
      const builtin = getBuiltinGenerator(s.generator);
      b = builtin ? localBounds(s.generator, params, s.seed ?? 0) : paramBounds(params);
      // A cliff or crag carries what stands on its real top surface (its ledges are lower than its bounding box).
      if (builtin && ROCK_GEN.test(s.generator)) rock = rockTop(s.generator, params, s.seed ?? 0);
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
    const box: Deck = { id: e.id, x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez, y: oy + b.max[1] * sy, bottom: oy + b.min[1] * sy };
    if (rock && sx > 0 && sy > 0 && sz > 0) box.rock = { fn: rock, ox, oy, oz, sx, sy, sz, c: Math.cos(yaw), s: Math.sin(yaw) };
    for (let i = Math.floor(box.x0 / cell); i <= Math.floor(box.x1 / cell); i++) {
      for (let k = Math.floor(box.z0 / cell); k <= Math.floor(box.z1 / cell); k++) {
        const key = `${i},${k}`;
        const list = grid.get(key);
        if (list) list.push(box);
        else grid.set(key, [box]);
      }
    }
  }
  const topOf = (b: Deck, x: number, z: number): number => {
    if (!b.rock) return b.y;
    const r = b.rock;
    const dx = x - r.ox;
    const dz = z - r.oz;
    return r.oy + r.fn((dx * r.c - dz * r.s) / r.sx, (dx * r.s + dz * r.c) / r.sz) * r.sy;
  };
  return {
    top(x, z, below, not) {
      let y = -Infinity;
      for (const b of grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []) {
        if (b.id === not || x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
        const top = topOf(b, x, z);
        if (top <= below && top > y) y = top;
      }
      return y;
    },
    /** Whether (x, y, z) is inside a built piece or rock (its box, up to a rock's real top). */
    solidAt(x, z, y, not) {
      for (const b of grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []) {
        if (b.id === not || x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
        if (y >= b.bottom && y <= topOf(b, x, z)) return true;
      }
      return false;
    },
  };
}

/** Small natural pieces that must rest on something: rocks, boulders, stones, shrubs, bushes, ferns (not trees, not ivy). */
const NATURAL = /(^|-)(rocks?|boulders?|stones?|pebbles?|scree|shrubs?|bush(es)?|scrub|ferns?|tussocks?|grass-tuft)($|-)/;
/** Tags that say a natural piece hangs on purpose (a floating island's rocks, a planter in the air). */
const AFLOAT_OK = /float|fly|flying|hover|hanging|cloud|^sky$|levitat|orbit/;

/**
 * Footprints (world x, z, half-width) of the ground pieces whose height this module cannot read: built-in hills other than the
 * `terrain` heightfield (a mound, an island) and world-defined land generators. `null` means one covers an unknown area.
 */
function unreadLand(world: WorldDoc): Array<{ x0: number; x1: number; z0: number; z1: number }> | null {
  const out: Array<{ x0: number; x1: number; z0: number; z1: number }> = [];
  for (const e of Object.values(world.entities)) {
    if (e.template || !e.visible || e.parent || e.shape.kind !== 'procedural' || e.shape.generator === 'terrain') continue;
    const gen = e.shape.generator;
    const builtin = getBuiltinGenerator(gen);
    const land = builtin ? builtin.category === 'terrain' : e.tags.some((t) => /^(terrain|land|ground|massif|hill)$/.test(t)) || /terrain|massif|landscape|heightfield|island/.test(gen);
    if (!land) continue;
    const params = e.shape.params as Record<string, Json>;
    const b = builtin ? localBounds(gen, params, e.shape.seed ?? 0) : paramBounds(params);
    if (!b) return null;
    const [ox, , oz] = e.transform.position;
    const [sx, , sz] = e.transform.scale;
    const r = Math.max(Math.abs(b.min[0] * sx), Math.abs(b.max[0] * sx), Math.abs(b.min[2] * sz), Math.abs(b.max[2] * sz));
    out.push({ x0: ox - r, x1: ox + r, z0: oz - r, z1: oz + r });
  }
  return out;
}

/** Instance positions of a piece or scatter layer in world space (a scatter laid out at load time is sampled over its area). */
function instancesOf(e: Entity, limit: number): Array<[number, number, number]> {
  const s = e.shape;
  const [ox, oy, oz] = e.transform.position;
  const yaw = (e.transform.rotation[1] * Math.PI) / 180;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const at = (x: number, y: number, z: number): [number, number, number] => [ox + x * c + z * sn, oy + y, oz - x * sn + z * c];
  if (s.kind !== 'scatter') return [[ox, oy, oz]];
  if (s.points && s.points.length > 0) return s.points.slice(0, limit).map(([x, y, z]) => at(x, y, z));
  // Laid out when the world loads: on a surface it follows that surface (not measured here); otherwise every instance stands at
  // the layer's own height over its area, so a grid over the area is what the instances will be.
  if (s.onSurface || !Array.isArray(s.area)) return [];
  const [w, d] = s.area as [number, number];
  const n = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(s.count ?? 1))));
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) out.push(at(((i + 0.5) / n - 0.5) * w, 0, ((k + 0.5) / n - 0.5) * d));
  return out.slice(0, limit);
}

/**
 * Rocks, boulders and bushes that float or perch: their foot is well above the ground or the built surface under it at the
 * centre, or over two fifths of the footprint (a boulder balanced on a cliff edge, a bush in mid-air on a cliff face, a scatter
 * row laid out at one height across falling ground). Measured like {@link findSunk}, for single pieces and scatter instances.
 */
export function findAfloat(world: WorldDoc): SunkPiece[] {
  const hasTerrain = Object.values(world.entities).some((e) => e.shape.kind === 'procedural' && e.shape.generator === 'terrain' && !e.parent);
  const unread = unreadLand(world);
  if (unread === null) return [];
  const ground = worldGround(world);
  const decks = supports(world);
  const out: SunkPiece[] = [];
  let instances = 0;
  for (const e of Object.values(world.entities)) {
    if (instances >= SUNK_LIMITS.MAX_INSTANCES) break;
    if (e.template || !e.visible || e.parent || e.tags.some((t) => AFLOAT_OK.test(t))) continue;
    const s = e.shape;
    const shape = s.kind === 'scatter' ? s.of : s;
    if (shape.kind !== 'procedural' || !NATURAL.test(shape.generator)) continue;
    const builtin = getBuiltinGenerator(shape.generator);
    if (!builtin || builtin.category !== 'nature') continue;
    const b = localBounds(shape.generator, shape.params as Record<string, Json>, shape.seed ?? 0);
    if (!b) continue;
    const [sx, sy, sz] = e.transform.scale;
    const height = (b.max[1] - b.min[1]) * sy;
    if (!(height > 0.2)) continue;
    const pts = instancesOf(e, SUNK_LIMITS.MAX_INSTANCES - instances);
    if (pts.length === 0) continue;
    instances += pts.length;
    const yaw = (e.transform.rotation[1] * Math.PI) / 180;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    let afloat = 0;
    let measured = 0;
    let worst = 0;
    let worstClimb = 0;
    for (const [px, py, pz] of pts) {
      // On a hill this module cannot read, or (no terrain at all) on nothing but the flat plane: not measured.
      if (unread.some((r) => px >= r.x0 && px <= r.x1 && pz >= r.z0 && pz <= r.z1)) continue;
      measured++;
      const foot = py + b.min[1] * sy;
      const tol = Math.max(0.35, Math.min(1.5, height * 0.25));
      let dropped = 0;
      let centre = 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        for (const v of [0, 0.25, 0.5, 0.75, 1]) {
          // A rock's footprint is its middle (the round sides lift off the ground), so the samples cover 80 % of the bounds.
          const lx = (b.min[0] + (b.max[0] - b.min[0]) * (0.1 + 0.8 * u)) * sx;
          const lz = (b.min[2] + (b.max[2] - b.min[2]) * (0.1 + 0.8 * v)) * sz;
          const x = px + lx * c + lz * sn;
          const z = pz - lx * sn + lz * c;
          const h = hasTerrain ? ground(x, z) : 0;
          // Set into a block or rock that rises past the piece (a bush at the foot of a higher terrace): held there, not afloat.
          const under = decks.solidAt(x, z, foot + 0.05, e.id) ? foot : Math.max(h, decks.top(x, z, foot + Math.max(0.4, height), e.id));
          lo = Math.min(lo, under);
          hi = Math.max(hi, under);
          const gap = foot - under;
          if (gap > tol) dropped++;
          if (u === 0.5 && v === 0.5) centre = gap;
        }
      }
      if (centre > tol || dropped >= 10) {
        afloat++;
        const gap = foot - lo;
        if (gap > worst) {
          worst = gap;
          worstClimb = hi - lo;
        }
      }
    }
    if (afloat > 0 && afloat * 10 >= measured) out.push({ id: e.id, generator: shape.generator, depth: worst, height, sunk: afloat, of: measured, climb: worstClimb, kind: 'afloat' });
  }
  return out.sort((p, q) => q.depth - p.depth);
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** The rocks and bushes that float or perch over a drop, as review findings (warnings). */
export function afloatFindings(world: WorldDoc): Finding[] {
  return findAfloat(world)
    .slice(0, 16)
    .map((p) => {
      const what = p.of > 1 ? `${p.sunk} of ${p.of} ${p.generator} in ${p.id} are` : `${p.id} (${p.generator}) is`;
      const fix =
        p.of > 1
          ? `lay the layer on the ground (scatter onSurface the land, or each point's y on the ground under it) and drop the points over drops and cliff faces; tag it "floating" only if it really hangs in the air`
          : `lower it by about ${r1(Math.max(0.2, p.depth - 0.2))} m so its foot sits in the ground, or move it back from the edge onto ground that carries it`;
      return { code: 'afloat', severity: 'warning', message: `${what} floating: the foot is up to ${r1(p.depth)} m above the ground or ledge under it (a rock or bush perched over a drop or hanging in the air).`, entities: [p.id], fix } as Finding;
    });
}

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
    extra = [...sunkFindings(world), ...afloatFindings(world)];
  } catch {
    return snap;
  }
  if (extra.length === 0) return snap;
  const findings = [...snap.findings.filter((f) => f.code !== 'sunk_in_ground' && f.code !== 'over_edge' && f.code !== 'afloat'), ...extra];
  return { ...snap, findings, score: scoreFindings(findings), keys: new Set(findings.map(findingKey)) };
}
