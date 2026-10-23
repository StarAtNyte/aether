/**
 * Furniture layout machinery: a room context (outline, wall faces, doors,
 * windows), wall slots that avoid doorways and windows, oriented footprints
 * with separating-axis overlap tests, door-swing keep-outs and clearance
 * rules (walkways, approach zones). Recipes per room type (recipes.ts) use
 * it to place real-world furniture groups; anything that does not fit is
 * skipped rather than forced.
 */
import type { Json, LightSpec } from '@aether/core';
import { furnitureByKind, furnitureSize, type FurnitureDef } from './furniture/index';
import { furnitureAsset } from './furniture/assets';
import { pointInPolygon, type P2 } from './math2';
import type { ArchStyle, RoomType } from './plan';
import { edgePoint, roomEdges, type RoomEdge } from './rooms';
import type { StylePalette } from './style';
import { collisions, freeWallSpans, mountRule, nearestMountCentre, type MountSpec, type WallBlocker } from './wall-space';

/** A door as seen from one room. */
export interface RoomDoor {
  edge: number;
  /** Centre along the edge (metres from edge.a). */
  t: number;
  width: number;
  /** Swing leaf sweeps into this room. */
  swingsIn: boolean;
  /** Hinge end along the edge: −1 at the t − w/2 side, +1 at t + w/2. */
  hinge: -1 | 1;
}

/** A window as seen from one room. */
export interface RoomWindow {
  edge: number;
  t0: number;
  t1: number;
  sill: number;
  height: number;
}

/** Everything a recipe needs about a room. */
export interface RoomContext {
  id: string;
  type: RoomType;
  name: string;
  polygon: P2[];
  edges: RoomEdge[];
  /** Distance from each edge's centreline to its interior face (half the wall thickness). */
  inset: number[];
  doors: RoomDoor[];
  windows: RoomWindow[];
  ceiling: number;
  style: ArchStyle;
  palette: StylePalette;
  seed: number;
  omit: ReadonlySet<string>;
  /**
   * Floor areas no furniture may cover (convex polygons, level plan coordinates): a stairwell and the stair below,
   * each grown by a walkway, so a landing keeps a way from the top step to its doors.
   */
  keepClear?: readonly P2[][];
}

/** A placed piece (level plan coordinates). */
export interface Placed {
  kind: string;
  generator: string;
  params: Record<string, Json>;
  x: number;
  y: number;
  z: number;
  yaw: number;
  size: [number, number, number];
  def: FurnitureDef;
  /** Light source (fixtures), in the entity frame. */
  light?: Partial<LightSpec>;
  /** Floor footprint (oriented rectangle corners); empty for wall / ceiling / surface pieces. */
  footprint: P2[];
  name: string;
  /** Library model shown instead of the generator (see `furniture/assets.ts`); `size` is then the model's. */
  asset?: string;
  /** A library model resized to this largest dimension (metres). */
  assetFit?: number;
  /** Wall pieces: the edge they hang on and their centre along it. */
  wall?: { edge: number; t: number };
}

/** Standard door leaf height used for wall-space checks. */
export const DOOR_HEIGHT = 2.1;

/** Walkway kept free in front of furniture fronts and doors (metres). */
export const WALKWAY = 0.8;
/**
 * Radius of the body that must get from door to door through a room (m): the walkthrough capsule and the building
 * check's grid (a 0.8 m walkway less its slack).
 */
export const BODY_RADIUS = 0.34;
/** Cell of the door-to-door flood (m). */
const FLOW_CELL = 0.1;
/** A pocket of standable floor this big (cells of {@link FLOW_CELL}: 0.3 m2) cut off from the doors by a piece is refused. */
const POCKET_CELLS = 30;
/** Gap between a piece's back and the wall face. */
export const WALL_GAP = 0.02;

/** Oriented rectangle corners for a centre, yaw and size (w along local X, d along local Z). */
export function obb(x: number, z: number, yawDeg: number, w: number, d: number): P2[] {
  const t = (yawDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const pts: P2[] = [];
  for (const [lx, lz] of [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ] as const) {
    pts.push([x + lx * c + lz * s, z - lx * s + lz * c]);
  }
  return pts;
}

/** Separating-axis test for two convex polygons (shrunk by `margin` tolerance). */
export function convexOverlap(a: readonly P2[], b: readonly P2[], margin = 0.005): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as P2;
      const q = poly[(i + 1) % poly.length] as P2;
      const nx = q[1] - p[1];
      const nz = p[0] - q[0];
      const len = Math.hypot(nx, nz) || 1;
      let amin = Infinity;
      let amax = -Infinity;
      let bmin = Infinity;
      let bmax = -Infinity;
      for (const v of a) {
        const d = (v[0] * nx + v[1] * nz) / len;
        amin = Math.min(amin, d);
        amax = Math.max(amax, d);
      }
      for (const v of b) {
        const d = (v[0] * nx + v[1] * nz) / len;
        bmin = Math.min(bmin, d);
        bmax = Math.max(bmax, d);
      }
      if (amax - margin <= bmin || bmax - margin <= amin) return false;
    }
  }
  return true;
}

/** Wet fittings: other pieces keep {@link WET_CLEARANCE} metres off them (the shower's step-in, the bath's edge). */
const WET_KINDS: ReadonlySet<string> = new Set(['shower', 'bathtub']);
const WET_CLEARANCE = 0.4;
/** Loose pieces that must keep that distance (fixtures such as a toilet or vanity may stand beside a shower). */
const DRY_DECOR: ReadonlySet<string> = new Set(['plant', 'floor-lamp', 'side-table', 'armchair', 'chair', 'stool', 'pouf', 'bench', 'basket', 'laundry-basket', 'plant-stand']);

/** Pairs allowed to overlap (chairs tucked under tables, stools under islands). */
export function tucksUnder(kindA: string, kindB: string): boolean {
  const tuck = new Set(['chair', 'office-chair', 'bar-stool', 'cane-chair']);
  const host = new Set(['dining-table', 'desk', 'island', 'cafe-counter']);
  return (tuck.has(kindA) && host.has(kindB)) || (tuck.has(kindB) && host.has(kindA));
}

/** Yaw (degrees) that turns a +Z-front piece to face the inward normal of an edge. */
export function yawFacingIn(e: RoomEdge): number {
  return (Math.atan2(-e.out[0], -e.out[1]) * 180) / Math.PI;
}

/** Keep-out rectangle of a door on the room side (the swing square or the approach zone). */
export function doorKeepout(ctx: RoomContext, d: RoomDoor): P2[] {
  const e = ctx.edges[d.edge] as RoomEdge;
  // Measured from the wall's centreline: the wall's own half thickness comes first, then the clear zone from its room face.
  const depth = (d.swingsIn ? Math.max(d.width, 0.9) + 0.05 : 0.9) + (ctx.inset[d.edge] ?? 0.06);
  const c = edgePoint(e, d.t);
  const inX = -e.out[0];
  const inZ = -e.out[1];
  const half = d.width / 2 + 0.12;
  const pts: P2[] = [];
  for (const [u, v] of [
    [-half, 0],
    [half, 0],
    [half, depth],
    [-half, depth],
  ] as const) {
    pts.push([c[0] + e.dir[0] * u + inX * v, c[1] + e.dir[1] * u + inZ * v]);
  }
  return pts;
}

/** Whether a point is within `r` of a convex polygon's outline. */
function nearPolygon(x: number, z: number, poly: readonly P2[], r: number): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as P2;
    const b = poly[(i + 1) % poly.length] as P2;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    const u = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
    if (Math.hypot(x - a[0] - dx * u, z - a[1] - dz * u) < r) return true;
  }
  return false;
}

/** Collects placements for one room and validates every candidate. */
export class RoomLayout {
  readonly placed: Placed[] = [];
  readonly notes: string[] = [];
  private readonly keepouts: P2[][];

  constructor(readonly ctx: RoomContext) {
    this.keepouts = [...ctx.doors.map((d) => doorKeepout(ctx, d)), ...(ctx.keepClear ?? []).map((k) => [...k])];
  }

  /** Definition of a kind, unless omitted for this room. */
  def(kind: string): FurnitureDef | null {
    if (this.ctx.omit.has(kind)) return null;
    return furnitureByKind(kind) ?? null;
  }

  /** Inward unit normal of an edge. */
  inward(edge: number): P2 {
    const e = this.ctx.edges[edge] as RoomEdge;
    return [-e.out[0], -e.out[1]];
  }

  /**
   * Free intervals of an edge for a piece against it: the edge minus the
   * corners (inset of the neighbouring walls), doorways (± margin) and, for
   * pieces taller than a window sill, the window spans.
   */
  freeIntervals(edge: number, height: number): Array<[number, number]> {
    const e = this.ctx.edges[edge] as RoomEdge;
    const n = this.ctx.edges.length;
    const prevInset = this.ctx.inset[(edge + n - 1) % n] ?? 0.06;
    const nextInset = this.ctx.inset[(edge + 1) % n] ?? 0.06;
    let free: Array<[number, number]> = [[prevInset + 0.02, e.length - nextInset - 0.02]];
    const cut = (a: number, b: number): void => {
      const out: Array<[number, number]> = [];
      for (const [s, t] of free) {
        if (b <= s || a >= t) out.push([s, t]);
        else {
          if (a > s) out.push([s, a]);
          if (b < t) out.push([b, t]);
        }
      }
      free = out;
    };
    for (const d of this.ctx.doors) {
      if (d.edge !== edge) continue;
      const extra = d.swingsIn ? 0.15 : 0.1;
      cut(d.t - d.width / 2 - extra, d.t + d.width / 2 + extra);
      // A leaf swinging in sweeps along the wall on its hinge side.
      if (d.swingsIn) {
        if (d.hinge < 0) cut(d.t - d.width / 2 - d.width - 0.05, d.t - d.width / 2);
        else cut(d.t + d.width / 2, d.t + d.width / 2 + d.width + 0.05);
      }
    }
    for (const w of this.ctx.windows) if (w.edge === edge && height > w.sill - 0.05) cut(w.t0 - 0.08, w.t1 + 0.08);
    // Wall pieces already hanging here (a picture, a curtain) stay clear of tall furniture.
    for (const p of this.placed) {
      if (!p.wall || p.wall.edge !== edge || p.y >= height - 0.1) continue;
      const half = p.size[0] / 2 + mountRule(p.kind).reach;
      cut(p.wall.t - half - 0.02, p.wall.t + half + 0.02);
    }
    return free.filter(([s, t]) => t - s > 0.1);
  }

  /** Wall-face point at `t` along an edge, pushed `off` metres into the room. */
  facePoint(edge: number, t: number, off: number): P2 {
    const e = this.ctx.edges[edge] as RoomEdge;
    const p = edgePoint(e, t);
    const inset = this.ctx.inset[edge] ?? 0.06;
    return [p[0] - e.out[0] * (inset + off), p[1] - e.out[1] * (inset + off)];
  }

  /** True when the footprint lies inside the room (inside the wall faces). */
  insideRoom(fp: readonly P2[]): boolean {
    for (const p of fp) {
      if (!pointInPolygon(p[0], p[1], this.ctx.polygon)) return false;
      for (let i = 0; i < this.ctx.edges.length; i++) {
        const e = this.ctx.edges[i] as RoomEdge;
        const inset = (this.ctx.inset[i] ?? 0.06) - 0.004;
        // Signed distance inward from the centreline.
        const d = -((p[0] - e.a[0]) * e.out[0] + (p[1] - e.a[1]) * e.out[1]);
        const along = (p[0] - e.a[0]) * e.dir[0] + (p[1] - e.a[1]) * e.dir[1];
        if (along > -0.01 && along < e.length + 0.01 && d < inset && d > -0.5) return false;
      }
    }
    return true;
  }

  /** True when a floor footprint is valid: in the room, clear of doors and other pieces. */
  fits(fp: readonly P2[], kind: string, ignore: ReadonlySet<Placed> = new Set(), height = 0): boolean {
    if (!this.insideRoom(fp)) return false;
    if (height > 0 && kind !== 'rug' && this.hitsWallPiece(fp, height)) return false;
    if (kind !== 'rug') {
      for (const k of this.keepouts) if (convexOverlap(fp, k, 0.01)) return false;
      for (const p of this.placed) {
        if (ignore.has(p) || p.footprint.length === 0 || p.kind === 'rug') continue;
        if (tucksUnder(kind, p.kind)) continue;
        if (convexOverlap(fp, p.footprint)) return false;
        // Decor keeps out of the wet zone: no plant in the shower, nothing at the bath's edge where one steps in.
        if (WET_KINDS.has(p.kind) && DRY_DECOR.has(kind) && convexOverlap(fp, p.footprint, -WET_CLEARANCE)) return false;
      }
      // Door to door: a piece that would shut the way between two doorways of the room (a sofa, two armchairs and a
      // bookshelf in a row across a small living room) is not placed, whatever stands clear of each door's swing.
      if (!this.keepsDoorsConnected(fp, ignore)) return false;
    }
    return true;
  }

  private flow: { x0: number; z0: number; nx: number; nz: number; wall: Uint8Array; seeds: number[]; cells: Map<Placed, number[]> } | null | undefined;

  /** The room's grid for the door-to-door flood: cells a body of {@link BODY_RADIUS} cannot stand on at the walls, and the doors' cells. */
  private flowGrid(): NonNullable<RoomLayout['flow']> | null {
    if (this.flow !== undefined) return this.flow;
    this.flow = null;
    const ctx = this.ctx;
    if (ctx.doors.length < 1) return null;
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const [x, z] of ctx.polygon) {
      x0 = Math.min(x0, x);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      z1 = Math.max(z1, z);
    }
    const nx = Math.max(1, Math.ceil((x1 - x0) / FLOW_CELL));
    const nz = Math.max(1, Math.ceil((z1 - z0) / FLOW_CELL));
    if (nx * nz > 40_000) return null;
    const wall = new Uint8Array(nx * nz);
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        const x = x0 + (i + 0.5) * FLOW_CELL;
        const z = z0 + (k + 0.5) * FLOW_CELL;
        if (!pointInPolygon(x, z, ctx.polygon)) {
          wall[k * nx + i] = 1;
          continue;
        }
        for (let e = 0; e < ctx.edges.length; e++) {
          const ed = ctx.edges[e] as RoomEdge;
          const along = Math.max(0, Math.min(ed.length, (x - ed.a[0]) * ed.dir[0] + (z - ed.a[1]) * ed.dir[1]));
          const d = Math.hypot(x - (ed.a[0] + ed.dir[0] * along), z - (ed.a[1] + ed.dir[1] * along));
          if (d < (ctx.inset[e] ?? 0.06) + BODY_RADIUS - 0.03) {
            wall[k * nx + i] = 1;
            break;
          }
        }
      }
    }
    const seeds: number[] = [];
    for (const d of ctx.doors) {
      const e = ctx.edges[d.edge] as RoomEdge;
      const c = edgePoint(e, d.t);
      const off = (ctx.inset[d.edge] ?? 0.06) + BODY_RADIUS + 0.03;
      const i = Math.floor((c[0] - e.out[0] * off - x0) / FLOW_CELL);
      const k = Math.floor((c[1] - e.out[1] * off - z0) / FLOW_CELL);
      if (i < 0 || k < 0 || i >= nx || k >= nz || wall[k * nx + i]) continue;
      seeds.push(k * nx + i);
    }
    if (seeds.length < 1) return null;
    this.flow = { x0, z0, nx, nz, wall, seeds, cells: new Map() };
    return this.flow;
  }

  /** Cells a body cannot stand on because of a footprint: within {@link BODY_RADIUS} of it. */
  private blockedBy(g: NonNullable<RoomLayout['flow']>, fp: readonly P2[]): number[] {
    let bx0 = Infinity;
    let bz0 = Infinity;
    let bx1 = -Infinity;
    let bz1 = -Infinity;
    for (const [x, z] of fp) {
      bx0 = Math.min(bx0, x);
      bz0 = Math.min(bz0, z);
      bx1 = Math.max(bx1, x);
      bz1 = Math.max(bz1, z);
    }
    const r = BODY_RADIUS - 0.03;
    const i0 = Math.max(0, Math.floor((bx0 - r - g.x0) / FLOW_CELL));
    const i1 = Math.min(g.nx - 1, Math.floor((bx1 + r - g.x0) / FLOW_CELL));
    const k0 = Math.max(0, Math.floor((bz0 - r - g.z0) / FLOW_CELL));
    const k1 = Math.min(g.nz - 1, Math.floor((bz1 + r - g.z0) / FLOW_CELL));
    const out: number[] = [];
    for (let k = k0; k <= k1; k++) {
      for (let i = i0; i <= i1; i++) {
        const x = g.x0 + (i + 0.5) * FLOW_CELL;
        const z = g.z0 + (k + 0.5) * FLOW_CELL;
        if (pointInPolygon(x, z, fp) || nearPolygon(x, z, fp, r)) out.push(k * g.nx + i);
      }
    }
    return out;
  }

  /**
   * Floods the room's floor from its first doorway with the placed pieces and `extra` standing in it: whether every
   * doorway was reached, and how many cells a body can stand on but not reach (a pocket cut off by the furniture).
   */
  private flood(g: NonNullable<RoomLayout['flow']>, extra: readonly P2[] | null, ignore: ReadonlySet<Placed>): { doors: boolean; stranded: number } {
    const blocked = new Uint8Array(g.wall);
    for (const p of this.placed) {
      if (ignore.has(p) || p.footprint.length === 0 || p.kind === 'rug' || p.wall) continue;
      let cells = g.cells.get(p);
      if (!cells) g.cells.set(p, (cells = this.blockedBy(g, p.footprint)));
      for (const c of cells) blocked[c] = 1;
    }
    if (extra) for (const c of this.blockedBy(g, extra)) blocked[c] = 1;
    let free = 0;
    for (let c = 0; c < blocked.length; c++) if (!blocked[c]) free++;
    const start = g.seeds[0] as number;
    if (blocked[start]) return { doors: false, stranded: free };
    const seen = new Uint8Array(blocked.length);
    const queue = [start];
    seen[start] = 1;
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q] as number;
      const i = c % g.nx;
      const k = (c - i) / g.nx;
      if (i + 1 < g.nx && !seen[c + 1] && !blocked[c + 1]) (seen[c + 1] = 1), queue.push(c + 1);
      if (i > 0 && !seen[c - 1] && !blocked[c - 1]) (seen[c - 1] = 1), queue.push(c - 1);
      if (k + 1 < g.nz && !seen[c + g.nx] && !blocked[c + g.nx]) (seen[c + g.nx] = 1), queue.push(c + g.nx);
      if (k > 0 && !seen[c - g.nx] && !blocked[c - g.nx]) (seen[c - g.nx] = 1), queue.push(c - g.nx);
    }
    return { doors: g.seeds.every((c) => seen[c] === 1), stranded: free - queue.length };
  }

  /**
   * False when the footprint would cut the way between two doorways of the room that is open now, or cut a pocket off
   * from the doors that a body could stand in (a player who spawns there would be shut in). A room that was cut
   * already (behind a wall or a stairwell) is not made worse by it: nothing is rejected on account of what was.
   */
  private keepsDoorsConnected(fp: readonly P2[], ignore: ReadonlySet<Placed>): boolean {
    const g = this.flowGrid();
    if (!g) return true;
    const before = this.flood(g, null, ignore);
    const after = this.flood(g, fp, ignore);
    if (before.doors && !after.doors) return false;
    return after.stranded - before.stranded <= POCKET_CELLS;
  }

  /** True when a floor piece of `height` standing against a wall would run into a picture, curtain or other piece hanging there. */
  private hitsWallPiece(fp: readonly P2[], height: number): boolean {
    for (const w of this.placed) {
      if (!w.wall || w.y >= height - 0.1) continue;
      const e = this.ctx.edges[w.wall.edge] as RoomEdge;
      const inset = this.ctx.inset[w.wall.edge] ?? 0.06;
      let near = Infinity;
      let lo = Infinity;
      let hi = -Infinity;
      for (const q of fp) {
        near = Math.min(near, -((q[0] - e.a[0]) * e.out[0] + (q[1] - e.a[1]) * e.out[1]) - inset);
        const along = (q[0] - e.a[0]) * e.dir[0] + (q[1] - e.a[1]) * e.dir[1];
        lo = Math.min(lo, along);
        hi = Math.max(hi, along);
      }
      if (near > 0.12) continue;
      const half = w.size[0] / 2 + mountRule(w.kind).reach;
      if (hi > w.wall.t - half + 0.01 && lo < w.wall.t + half - 0.01) return true;
    }
    return false;
  }

  /** Add a placement (no validation). */
  push(p: Placed): Placed {
    this.placed.push(p);
    return p;
  }

  /** Make a placement record. */
  /** Placements made while true use the parametric piece even when a library model exists. */
  private parametricOnly = false;

  /** Run `fn` with library models first; when it places nothing, retry with the parametric piece. */
  private withFallback(fn: () => Placed | null): Placed | null {
    const first = fn();
    if (first || this.parametricOnly) return first;
    this.parametricOnly = true;
    try {
      return fn();
    } finally {
      this.parametricOnly = false;
    }
  }

  make(def: FurnitureDef, params: Record<string, Json>, x: number, z: number, yaw: number, y = 0, name?: string): Placed {
    // The room's seed picks among equally good models: every piece of a kind in a room is the same model, rooms differ.
    const asset = this.parametricOnly ? null : furnitureAsset(def.kind, this.ctx.style, { seed: String(this.ctx.seed) });
    const wanted = furnitureSize(def, params);
    const size = asset ? asset.size : wanted;
    const floor = def.mount === 'floor';
    return {
      ...(asset ? { asset: asset.id } : {}),
      kind: def.kind,
      generator: def.id,
      params,
      x,
      y,
      z,
      yaw,
      size,
      def,
      footprint: floor ? obb(x, z, yaw, size[0], size[2]) : [],
      name: name ?? titleCase(def.kind),
    };
  }

  /** Place a floor piece at a centre and yaw if it fits. */
  tryAt(kind: string, params: Record<string, Json>, x: number, z: number, yaw: number, name?: string): Placed | null {
    const def = this.def(kind);
    if (!def) return null;
    // A library model can be larger than the parametric piece the spot was planned for.
    return this.withFallback(() => {
      const p = this.make(def, params, x, z, yaw, 0, name);
      if (def.mount === 'floor' && !this.fits(p.footprint, kind, new Set(), p.size[1])) return null;
      return this.push(p);
    });
  }

  /**
   * Place a floor piece with its back against an edge, centred at `t` (or
   * the best spot of the free intervals when `t` is null). Searches along
   * the edge for the closest valid position. `front` adds required clear
   * floor in front (checked against other pieces).
   */
  againstWall(kind: string, params: Record<string, Json>, edge: number, t: number | null, name?: string): Placed | null {
    return this.withFallback(() => this.againstWallOnce(kind, params, edge, t, name));
  }

  private againstWallOnce(kind: string, params: Record<string, Json>, edge: number, t: number | null, name?: string): Placed | null {
    const def = this.def(kind);
    if (!def) return null;
    const size = (this.parametricOnly ? null : furnitureAsset(def.kind, this.ctx.style, { seed: String(this.ctx.seed) }))?.size ?? furnitureSize(def, params);
    const e = this.ctx.edges[edge] as RoomEdge;
    const yaw = yawFacingIn(e);
    const free = this.freeIntervals(edge, size[1]);
    const candidates: number[] = [];
    for (const [s, u] of free) {
      if (u - s < size[0]) continue;
      const lo = s + size[0] / 2;
      const hi = u - size[0] / 2;
      if (t !== null) candidates.push(Math.min(hi, Math.max(lo, t)));
      else candidates.push((lo + hi) / 2);
      // Fallback spots along the interval.
      for (let k = 1; k <= 6; k++) candidates.push(lo + ((hi - lo) * k) / 7);
    }
    if (t !== null) candidates.sort((a, b) => Math.abs(a - t) - Math.abs(b - t));
    for (const c of candidates) {
      const p = this.facePoint(edge, c, WALL_GAP + size[2] / 2);
      const placed = this.make(def, params, p[0], p[1], yaw, 0, name);
      if (this.fits(placed.footprint, kind, new Set(), placed.size[1])) return this.push(placed);
    }
    return null;
  }

  /**
   * Everything on an edge's wall face that keeps wall pieces away: the
   * corners, door and window openings, pieces already hanging there and
   * furniture standing against it.
   */
  wallBlockers(edge: number): WallBlocker[] {
    const e = this.ctx.edges[edge] as RoomEdge;
    const n = this.ctx.edges.length;
    const prevInset = this.ctx.inset[(edge + n - 1) % n] ?? 0.06;
    const nextInset = this.ctx.inset[(edge + 1) % n] ?? 0.06;
    const out: WallBlocker[] = [
      { kind: 'corner', t0: -1, t1: prevInset + 0.04, y0: 0, y1: 99, ref: 'corner' },
      { kind: 'corner', t0: e.length - nextInset - 0.04, t1: e.length + 1, y0: 0, y1: 99, ref: 'corner' },
    ];
    this.ctx.doors.forEach((d, i) => {
      if (d.edge === edge) out.push({ kind: 'door', t0: d.t - d.width / 2, t1: d.t + d.width / 2, y0: 0, y1: DOOR_HEIGHT, ref: `door:${i}` });
    });
    this.ctx.windows.forEach((w, i) => {
      if (w.edge === edge) out.push({ kind: 'window', t0: w.t0, t1: w.t1, y0: w.sill, y1: w.sill + w.height, ref: `window:${i}` });
    });
    for (const p of this.placed) {
      if (p.wall && p.wall.edge === edge) {
        const half = p.size[0] / 2 + mountRule(p.kind).reach;
        out.push({ kind: 'item', t0: p.wall.t - half, t1: p.wall.t + half, y0: p.y, y1: p.y + p.size[1], ref: p.kind });
      } else if (p.footprint.length > 0 && p.kind !== 'rug') {
        // Floor piece close to this wall face: its stretch along the wall.
        const inset = this.ctx.inset[edge] ?? 0.06;
        let near = Infinity;
        let lo = Infinity;
        let hi = -Infinity;
        for (const q of p.footprint) {
          const dist = -((q[0] - e.a[0]) * e.out[0] + (q[1] - e.a[1]) * e.out[1]) - inset;
          const along = (q[0] - e.a[0]) * e.dir[0] + (q[1] - e.a[1]) * e.dir[1];
          near = Math.min(near, dist);
          lo = Math.min(lo, along);
          hi = Math.max(hi, along);
        }
        if (near < 0.12) out.push({ kind: 'furniture', t0: lo, t1: hi, y0: 0, y1: p.size[1], ref: p.kind });
      }
    }
    return out;
  }

  /** True when a wall piece of this kind and size fits exactly at `t` (no blocker touches it). */
  wallSpotFree(kind: string, edge: number, t: number, width: number, y: number, height: number, anchor?: string): boolean {
    const spec: MountSpec = { kind, t, width, y0: y, y1: y + height };
    return collisions(spec, this.wallBlockers(edge), anchor).length === 0;
  }

  /**
   * Wall-mounted piece (art, TV, mirror, sconce, switch) on an edge face with
   * its bottom at `y`. It never overlaps a door, a window, a corner, another
   * wall piece or tall furniture: when `t` is blocked it slides to the
   * nearest clear stretch of that wall, and when none is wide enough art and
   * mirrors shrink before giving up (null). Curtains go through
   * {@link hangCurtain}.
   */
  onWall(kind: string, params: Record<string, Json>, edge: number, t: number, y: number, name?: string): Placed | null {
    const def = this.def(kind);
    if (!def) return null;
    const e = this.ctx.edges[edge] as RoomEdge;
    const shrinkable = kind === 'art' || kind === 'mirror';
    for (const f of shrinkable ? [1, 0.8, 0.65, 0.5] : [1]) {
      const pr: Record<string, Json> = f === 1 ? params : { ...params, width: Number(params['width'] ?? 1) * f, ...(typeof params['height'] === 'number' ? { height: params['height'] * f } : {}) };
      const size = furnitureSize(def, pr);
      const c = nearestMountCentre(e.length, { kind, t, width: size[0], y0: y, y1: y + size[1] }, this.wallBlockers(edge));
      if (c === null) continue;
      const p = this.facePoint(edge, c, 0.001);
      const placed = this.push(this.make(def, pr, p[0], p[1], yawFacingIn(e), y, name));
      placed.wall = { edge, t: c };
      return placed;
    }
    return null;
  }

  /** Like {@link onWall}, but tries the other walls (longest clear stretch first) when the preferred one has no room. */
  onAnyWall(kind: string, params: Record<string, Json>, edge: number, t: number, y: number, name?: string): Placed | null {
    const first = this.onWall(kind, params, edge, t, y, name);
    if (first) return first;
    const def = this.def(kind);
    if (!def) return null;
    const h = furnitureSize(def, params)[1];
    const others = this.ctx.edges
      .map((_, i) => i)
      .filter((i) => i !== edge)
      .map((i) => ({ i, room: Math.max(0, ...freeWallSpans((this.ctx.edges[i] as RoomEdge).length, kind, y, y + h, this.wallBlockers(i)).map(([s, u]) => u - s)) }))
      .sort((a, b) => b.room - a.room);
    for (const o of others) {
      const p = this.onWall(kind, params, o.i, (this.ctx.edges[o.i] as RoomEdge).length / 2, y, name);
      if (p) return p;
    }
    return null;
  }

  /**
   * Hang the curtain panels of one window (index into `ctx.windows`): a
   * panel each side, its rod reaching past the frame, anchored to the
   * window. A side with a door, a corner, a neighbouring window or a tall
   * piece too close gets a narrower panel, or none.
   */
  hangCurtain(windowIndex: number, color: string): Placed[] {
    const def = this.def('curtain');
    const w = this.ctx.windows[windowIndex];
    if (!def || !w) return [];
    const e = this.ctx.edges[w.edge] as RoomEdge;
    const len = w.t1 - w.t0;
    const full = Math.min(0.9, Math.max(0.45, len * 0.28));
    const sillLength = ['kitchen', 'bathroom', 'laundry', 'cafe', 'terrace'].includes(this.ctx.type) && w.sill > 0.5;
    const y0 = sillLength ? Math.max(0, w.sill - 0.1) : 0;
    const top = sillLength ? w.sill + w.height + 0.12 : Math.max(1.3, this.ctx.ceiling - 0.04);
    const height = Math.max(0.8, top - y0);
    const out: Placed[] = [];
    const anchor = `window:${windowIndex}`;
    for (const side of [-1, 1] as const) {
      for (const f of [1, 0.8, 0.62, 0.48]) {
        const panel = full * f;
        if (panel < 0.35) break;
        // Inner edge overlaps the window frame by 8 cm.
        const t = side < 0 ? w.t0 + 0.08 - panel / 2 : w.t1 - 0.08 + panel / 2;
        if (!this.wallSpotFree('curtain', w.edge, t, panel, y0, height, anchor)) continue;
        const p = this.facePoint(w.edge, t, 0.001);
        const placed = this.push(this.make(def, { width: Math.round(panel * 100) / 100, height: Math.round(height * 100) / 100, color }, p[0], p[1], yawFacingIn(e), y0, 'Curtain'));
        placed.wall = { edge: w.edge, t };
        out.push(placed);
        break;
      }
    }
    return out;
  }

  /** Hang a blind over one window (index into `ctx.windows`), centred on it. */
  hangBlind(windowIndex: number, params: Record<string, Json>): Placed[] {
    const def = this.def('blind');
    const w = this.ctx.windows[windowIndex];
    if (!def || !w) return [];
    const e = this.ctx.edges[w.edge] as RoomEdge;
    const y0 = Math.max(0, w.sill - 0.05);
    const width = Math.min(4, w.t1 - w.t0 + 0.1);
    const height = Math.min(3.2, Math.max(0.5, Math.min(this.ctx.ceiling - 0.04, w.sill + w.height + 0.05) - y0));
    const t = (w.t0 + w.t1) / 2;
    const p = this.facePoint(w.edge, t, 0.001);
    const placed = this.push(this.make(def, { ...params, width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100 }, p[0], p[1], yawFacingIn(e), y0, 'Blind'));
    placed.wall = { edge: w.edge, t };
    return [placed];
  }

  /** Surface piece (table lamp …) standing on another placement's top. */
  onTop(kind: string, params: Record<string, Json>, host: Placed, dx = 0, dz = 0, name?: string): Placed | null {
    const def = this.def(kind);
    if (!def) return null;
    const t = (host.yaw * Math.PI) / 180;
    const x = host.x + dx * Math.cos(t) + dz * Math.sin(t);
    const z = host.z - dx * Math.sin(t) + dz * Math.cos(t);
    return this.push(this.make(def, params, x, z, host.yaw, host.size[1], name));
  }

  /** Ceiling piece at a plan point (hangs from the ceiling). */
  ceiling(kind: string, params: Record<string, Json>, x: number, z: number, light: Partial<LightSpec>, yaw = 0, name?: string): Placed | null {
    const def = this.def(kind);
    if (!def) return null;
    const p = this.push(this.make(def, params, x, z, yaw, this.ctx.ceiling, name));
    p.light = light;
    return p;
  }
}

/** "office-chair" → "Office chair". */
export function titleCase(kind: string): string {
  const s = kind.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
