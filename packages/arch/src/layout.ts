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
}

/** Walkway kept free in front of furniture fronts and doors (metres). */
export const WALKWAY = 0.8;
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

/** Pairs allowed to overlap (chairs tucked under tables, stools under islands). */
export function tucksUnder(kindA: string, kindB: string): boolean {
  const tuck = new Set(['chair', 'office-chair', 'bar-stool']);
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
  const depth = d.swingsIn ? Math.max(d.width, 0.9) + 0.05 : 0.9;
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

/** Collects placements for one room and validates every candidate. */
export class RoomLayout {
  readonly placed: Placed[] = [];
  readonly notes: string[] = [];
  private readonly keepouts: P2[][];

  constructor(readonly ctx: RoomContext) {
    this.keepouts = ctx.doors.map((d) => doorKeepout(ctx, d));
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
  fits(fp: readonly P2[], kind: string, ignore: ReadonlySet<Placed> = new Set()): boolean {
    if (!this.insideRoom(fp)) return false;
    if (kind !== 'rug') {
      for (const k of this.keepouts) if (convexOverlap(fp, k, 0.01)) return false;
      for (const p of this.placed) {
        if (ignore.has(p) || p.footprint.length === 0 || p.kind === 'rug') continue;
        if (tucksUnder(kind, p.kind)) continue;
        if (convexOverlap(fp, p.footprint)) return false;
      }
    }
    return true;
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
    const asset = this.parametricOnly ? null : furnitureAsset(def.kind, this.ctx.style);
    const size = asset ? asset.size : furnitureSize(def, params);
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
      if (def.mount === 'floor' && !this.fits(p.footprint, kind)) return null;
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
    const size = (this.parametricOnly ? null : furnitureAsset(def.kind, this.ctx.style))?.size ?? furnitureSize(def, params);
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
      if (this.fits(placed.footprint, kind)) return this.push(placed);
    }
    return null;
  }

  /** Wall-mounted piece (art, TV, mirror, curtain, sconce, switch) on an edge face at height `y`. */
  onWall(kind: string, params: Record<string, Json>, edge: number, t: number, y: number, name?: string): Placed | null {
    const def = this.def(kind);
    if (!def) return null;
    const e = this.ctx.edges[edge] as RoomEdge;
    const p = this.facePoint(edge, t, 0.001);
    return this.push(this.make(def, params, p[0], p[1], yawFacingIn(e), y, name));
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
