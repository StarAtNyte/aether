/**
 * Layered navigation: one {@link NavGrid} per floor level of a building (the ground, each storey) and the stairs
 * between them as links that follow the stair's walking line. A route across floors is a short list of stairs to
 * take (up or down); between them, and after the last one, an NPC walks the grid of the floor it stands on.
 *
 * Choosing the stairs is a search over a handful of nodes (the two ends of every stair, the start and the goal):
 * two nodes on one floor are joined when the grid connects them (the regions of {@link NavGrid.components}), at
 * their straight-line distance; a stair joins its two ends at its line's length plus a small penalty. Everything is
 * preallocated: a route search allocates nothing and is deterministic (fixed node order, index tie-breaks).
 */
import type { Vec3, WorldDoc } from '@aether/core';
import { NavGrid } from './nav';
import { buildNavFor, type BoundsProvider } from './obstacles';
import { insidePolygon, MAX_STAIR_LINKS, stairLinks, type StairLink } from './stairs';

/** Most floor levels of one layered build. */
export const MAX_LAYERS = 6;
/** Two floor heights closer than this are one level (m). */
const SAME_LEVEL = 0.6;
/** Extra cost of taking a stair, so a route never climbs to save a few metres on one floor (m). */
const STAIR_PENALTY = 2;
/** Most stairs one route takes. */
export const MAX_ROUTE_LINKS = 8;
/** Room around the points an upper floor's grid must cover (m). */
const UPPER_PAD = 12;
/** Room around the points the lowest floor's grid covers in a building with stairs (m). */
const GROUND_PAD = 24;
/** Cell size of floor grids in a building (m): fine enough for doorways. */
const FLOOR_CELL = 0.25;
/**
 * Largest body radius the floor grids keep clear (m): a 0.9 m doorway leaves room for the centre of a 0.6 m wide
 * body on a 0.25 m grid; a bulkier NPC brushes the door frame (kinematic characters do not collide with it).
 */
const FLOOR_CLEARANCE = 0.3;
/**
 * Highest step on a building's floor grids (m): a threshold or a plinth step, never a bed or a sofa (the default
 * outdoor step of 0.55 m stood people on the furniture).
 */
const FLOOR_STEP = 0.3;
/** How far inside a stair's footprint a position counts as on that stair (between its floors). */
const ON_STAIR_MARGIN = 0.3;

/** A route across floors: the stairs to take in order, `+(i + 1)` up stair `i`, `−(i + 1)` down it. */
export class NavRoute {
  readonly steps = new Int16Array(MAX_ROUTE_LINKS);
  n = 0;
}

/** Points a layered build must cover, with the feet height they stand at. */
export interface LayerPoint {
  x: number;
  y: number;
  z: number;
}

/** Navigation grids per floor level, linked by stairs. */
export class NavLayers {
  /** Grid of each level, lowest first, and the feet height it describes. */
  readonly grids: NavGrid[];
  readonly heights: number[];
  readonly links: StairLink[];
  /** Level index of each stair's foot and top. */
  readonly lower: Int8Array;
  readonly upper: Int8Array;
  // --- route search scratch (nodes: 0 start, 1 goal, 2 + 2i foot of stair i, 3 + 2i its top) ------------------------
  private readonly dist: Float64Array;
  private readonly prev: Int16Array;
  private readonly done: Uint8Array;
  private readonly nodeLayer: Int8Array;
  private readonly nodeRegion: Int32Array;
  private readonly nodeX: Float64Array;
  private readonly nodeZ: Float64Array;
  private readonly chain: Int16Array;

  private constructor(grids: NavGrid[], heights: number[], links: StairLink[], lower: Int8Array, upper: Int8Array) {
    this.grids = grids;
    this.heights = heights;
    this.links = links;
    this.lower = lower;
    this.upper = upper;
    const nodes = 2 + links.length * 2;
    this.dist = new Float64Array(nodes);
    this.prev = new Int16Array(nodes);
    this.done = new Uint8Array(nodes);
    this.nodeLayer = new Int8Array(nodes);
    this.nodeRegion = new Int32Array(nodes);
    this.nodeX = new Float64Array(nodes);
    this.nodeZ = new Float64Array(nodes);
    this.chain = new Int16Array(nodes);
    for (let i = 0; i < links.length; i++) {
      const l = links[i] as StairLink;
      const g0 = grids[lower[i] as number] as NavGrid;
      const g1 = grids[upper[i] as number] as NavGrid;
      const foot = 2 + i * 2;
      this.nodeLayer[foot] = lower[i] as number;
      this.nodeX[foot] = l.line[0] as number;
      this.nodeZ[foot] = l.line[2] as number;
      this.nodeRegion[foot] = g0.regionAt(this.nodeX[foot] as number, this.nodeZ[foot] as number, 8);
      const top = foot + 1;
      this.nodeLayer[top] = upper[i] as number;
      this.nodeX[top] = l.line[(l.n - 1) * 3] as number;
      this.nodeZ[top] = l.line[(l.n - 1) * 3 + 2] as number;
      this.nodeRegion[top] = g1.regionAt(this.nodeX[top] as number, this.nodeZ[top] as number, 8);
    }
  }

  /**
   * Build the levels for agents of one size from the document: the floor heights of the stairs (their feet and tops)
   * and of `points` (where NPCs stand and walk to), one grid per level covering the points and stair ends on it.
   * Returns null when the world has neither stairs nor buildings (a coarse single-floor grid does the job); a
   * building without stairs gets its floors' fine grids all the same (doorways need them).
   */
  static build(world: WorldDoc, o: { radius: number; height: number; points: readonly LayerPoint[]; groundPad?: number }, bounds?: BoundsProvider): NavLayers | null {
    const links = stairLinks(world).slice(0, MAX_STAIR_LINKS);
    if (links.length === 0 && !hasBuildings(world)) return null;
    // Floor levels: stair ends first (exact), then the points' feet heights.
    const heights: number[] = [];
    const levelOf = (y: number): number => {
      let best = -1;
      let bestD = SAME_LEVEL;
      for (let i = 0; i < heights.length; i++) {
        const d = Math.abs((heights[i] as number) - y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };
    const addLevel = (y: number): void => {
      if (levelOf(y) < 0 && heights.length < MAX_LAYERS) heights.push(y);
    };
    for (const l of links) {
      addLevel(l.y0);
      addLevel(l.y1);
    }
    for (const p of o.points) addLevel(p.y);
    heights.sort((a, b) => a - b);
    const lower = new Int8Array(links.length);
    const upper = new Int8Array(links.length);
    links.forEach((l, i) => {
      lower[i] = Math.max(0, levelOf(l.y0));
      upper[i] = Math.max(0, levelOf(l.y1));
    });
    const grids: NavGrid[] = [];
    for (let li = 0; li < heights.length; li++) {
      const h = heights[li] as number;
      const pts: Vec3[] = [];
      for (const p of o.points) if (levelOf(p.y) === li) pts.push([p.x, h, p.z]);
      links.forEach((l, i) => {
        if (lower[i] === li) pts.push([l.line[0] as number, h, l.line[2] as number]);
        if (upper[i] === li) pts.push([l.line[(l.n - 1) * 3] as number, h, l.line[(l.n - 1) * 3 + 2] as number]);
      });
      if (li === 0) pts.push(world.player.spawn);
      // The lowest level drapes over terrain like a single-floor grid; floors above are flat storeys.
      const grid = buildNavFor(world, { refY: h, radius: Math.min(o.radius, FLOOR_CLEARANCE), height: o.height, points: pts, pad: li === 0 ? (o.groundPad ?? GROUND_PAD) : UPPER_PAD, cell: FLOOR_CELL, step: FLOOR_STEP }, li === 0 ? bounds : withoutTerrain(bounds));
      grids.push(grid);
    }
    // A stair is not floor on either level: its flights below, its well above (the slab under the opening and the
    // ramp's bounding box would read as floor there). The ends of its walking line stay just outside.
    links.forEach((l, i) => {
      (grids[lower[i] as number] as NavGrid).blockPolygon(l.footprint, 0);
      (grids[upper[i] as number] as NavGrid).blockPolygon(l.footprint, Math.max(0, Math.min(o.radius, FLOOR_CLEARANCE) - 0.1));
    });
    for (const g of grids) g.components();
    return new NavLayers(grids, heights, links, lower, upper);
  }

  /** Level of the floor at (x, z) closest to feet height `y` (where that level's grid has floor nearby), else by height alone. */
  levelAt(x: number, y: number, z: number): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.grids.length; i++) {
      const g = this.grids[i] as NavGrid;
      const k = g.index(x, z);
      const f = k >= 0 ? (g.floor[k] as number) : Number.NaN;
      const ref = Number.isNaN(f) ? (this.heights[i] as number) : f;
      // A floor above the feet only counts within a step (a point is never on a storey over its head).
      const d = ref > y + 0.6 ? Infinity : Math.abs(ref - y) + (Number.isNaN(f) ? 1 : 0);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return bestD === Infinity ? this.closestHeight(y) : best;
  }

  private closestHeight(y: number): number {
    let best = 0;
    for (let i = 1; i < this.heights.length; i++) if (Math.abs((this.heights[i] as number) - y) < Math.abs((this.heights[best] as number) - y)) best = i;
    return best;
  }

  /** The stair a feet position stands on (inside its footprint, between its floors), or −1. */
  stairAt(x: number, y: number, z: number): number {
    for (let i = 0; i < this.links.length; i++) {
      const l = this.links[i] as StairLink;
      if (y < l.y0 + ON_STAIR_MARGIN * 0.5 || y > l.y1 - ON_STAIR_MARGIN * 0.5) continue;
      if (insidePolygon(x, z, l.footprint)) return i;
    }
    return -1;
  }

  /**
   * Where to aim for a target at feet position (x, y, z): its level, or — standing on a stair — the end of that stair
   * nearer by height. Writes the level and the aim point into `out` [level, x, z].
   */
  aimFor(x: number, y: number, z: number, out: Float64Array): void {
    const s = this.stairAt(x, y, z);
    if (s >= 0) {
      const l = this.links[s] as StairLink;
      const up = y - l.y0 > (l.y1 - l.y0) / 2;
      const k = up ? (l.n - 1) * 3 : 0;
      out[0] = up ? (this.upper[s] as number) : (this.lower[s] as number);
      out[1] = l.line[k] as number;
      out[2] = l.line[k + 2] as number;
      return;
    }
    out[0] = this.levelAt(x, y, z);
    out[1] = x;
    out[2] = z;
  }

  /**
   * The stairs to take from (x, z) on level `from` to (gx, gz) on level `to`, written into `route`. False when the
   * goal cannot be reached (the grids do not connect it through any stair). A goal on the same level and connected
   * on it gives an empty route.
   */
  route(from: number, x: number, z: number, to: number, gx: number, gz: number, route: NavRoute): boolean {
    route.n = 0;
    const gs = this.grids[from];
    const gg = this.grids[to];
    if (!gs || !gg) return false;
    const n = 2 + this.links.length * 2;
    const nl = this.nodeLayer;
    const nr = this.nodeRegion;
    const nx = this.nodeX;
    const nz = this.nodeZ;
    nl[0] = from;
    nr[0] = gs.regionAt(x, z, 8);
    nx[0] = x;
    nz[0] = z;
    nl[1] = to;
    nr[1] = gg.regionAt(gx, gz, 8);
    nx[1] = gx;
    nz[1] = gz;
    if (nr[0] === 0 || nr[1] === 0) return false;
    if (from === to && nr[0] === nr[1]) return true;
    const dist = this.dist;
    const prev = this.prev;
    const done = this.done;
    for (let i = 0; i < n; i++) {
      dist[i] = Infinity;
      prev[i] = -1;
      done[i] = 0;
    }
    dist[0] = 0;
    for (;;) {
      let cur = -1;
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        if (done[i] === 0 && (dist[i] as number) < best) {
          best = dist[i] as number;
          cur = i;
        }
      }
      if (cur < 0 || cur === 1) break;
      done[cur] = 1;
      for (let j = 1; j < n; j++) {
        if (done[j] !== 0 || j === cur) continue;
        let w = Infinity;
        // The two ends of one stair.
        if (cur >= 2 && j >= 2 && cur >> 1 === j >> 1) w = (this.links[(cur - 2) >> 1] as StairLink).length + STAIR_PENALTY;
        else if (nl[cur] === nl[j] && nr[cur] === nr[j] && (nr[j] as number) !== 0) w = Math.hypot((nx[j] as number) - (nx[cur] as number), (nz[j] as number) - (nz[cur] as number));
        if (w === Infinity) continue;
        const d = best + w;
        if (d < (dist[j] as number)) {
          dist[j] = d;
          prev[j] = cur;
        }
      }
    }
    if (prev[1] === -1) return false;
    // Walk back from the goal; every foot → top (or top → foot) hop is a stair taken.
    let m = 0;
    for (let c = 1; c >= 0 && m < this.chain.length; c = prev[c] as number) this.chain[m++] = c;
    for (let k = m - 1; k > 0 && route.n < MAX_ROUTE_LINKS; k--) {
      const a = this.chain[k] as number;
      const b = this.chain[k - 1] as number;
      if (a >= 2 && b >= 2 && a >> 1 === b >> 1) {
        const link = (a - 2) >> 1;
        route.steps[route.n++] = (a & 1) === 0 ? link + 1 : -(link + 1);
      }
    }
    return true;
  }
}

/** Whether the world has compiled buildings (walls or stairs of `@aether/arch`). */
export function hasBuildings(world: WorldDoc): boolean {
  for (const id of Object.keys(world.entities)) {
    const e = world.entities[id];
    if (e && e.shape.kind === 'procedural' && (e.shape.generator === 'arch-wall' || e.shape.generator === 'arch-stair' || e.shape.generator === 'arch-spiral-stair')) return true;
  }
  return false;
}

/** The same bounds without the terrain sampler (floors above the ground do not drape over hills). */
function withoutTerrain(b: BoundsProvider | undefined): BoundsProvider | undefined {
  if (!b) return undefined;
  const out: BoundsProvider = {};
  if (b.getBounds) out.getBounds = (id) => b.getBounds?.(id);
  if (b.getColliderBounds) out.getColliderBounds = (id) => b.getColliderBounds?.(id) ?? [];
  return out;
}
