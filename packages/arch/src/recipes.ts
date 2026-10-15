/**
 * Furnishing recipes per room type. Each builds a real-world furniture group
 * with standard clearances (sofa → coffee table 42 cm, chairs 75 cm apart,
 * 90 cm around beds and tables, 1 m kitchen aisles), places decor (art,
 * curtains, plants), one main light fitting with a light source, and a
 * switch by the door. Pieces that do not fit are skipped.
 */
import { furnitureAsset } from './furniture/assets';
import type { Json, LightSpec } from '@aether/core';
import { RoomLayout, yawFacingIn, type Placed, type RoomContext } from './layout';
import { furnitureSize } from './furniture/index';
import { bounds, interiorPoint, type P2 } from './math2';
import type { PlanItem } from './plan';
import { compassNormal, type RoomEdge } from './rooms';

/**
 * Level of interior lamps relative to the recipe strengths below. World IR
 * light units are calibrated against a full sun of 2.5: at night the
 * evening exposure makes a 0.4–1.4 lamp read as a warm, lit room, while
 * stronger lamps blow white walls out.
 */
export const LAMP_LEVEL = 0.45;

/** Warm interior light (≈ 2700 K) of a given strength. */
function warm(intensity: number, range: number): Partial<LightSpec> {
  return { type: 'point', color: '#ffd7a6', intensity: Math.round(intensity * LAMP_LEVEL * 100) / 100, range, castShadow: false };
}

/** Edges sorted by their longest free interval for a piece of height h. */
function edgesByFree(L: RoomLayout, h: number, exclude: ReadonlySet<number> = new Set()): Array<{ edge: number; s: number; t: number }> {
  const out: Array<{ edge: number; s: number; t: number }> = [];
  L.ctx.edges.forEach((_, i) => {
    if (exclude.has(i)) return;
    for (const [s, t] of L.freeIntervals(i, h)) out.push({ edge: i, s, t });
  });
  return out.sort((a, b) => b.t - b.s - (a.t - a.s));
}

/** The edge most directly opposite `edge` (facing it across the room). */
function opposite(L: RoomLayout, edge: number): number | null {
  const e = L.ctx.edges[edge] as RoomEdge;
  let best: number | null = null;
  let bestDot = -0.9;
  L.ctx.edges.forEach((o, i) => {
    if (i === edge) return;
    const d = o.out[0] * e.out[0] + o.out[1] * e.out[1];
    if (d < bestDot) {
      bestDot = d;
      best = i;
    }
  });
  return best;
}

/** Position along an edge closest to a plan point. */
function tAlong(e: RoomEdge, p: P2): number {
  return Math.min(e.length, Math.max(0, (p[0] - e.a[0]) * e.dir[0] + (p[1] - e.a[1]) * e.dir[1]));
}

/** Move from a placement along its facing direction (local +Z) by `fwd` and sideways (local +X) by `side`. */
function ahead(p: Placed, fwd: number, side = 0): P2 {
  const t = (p.yaw * Math.PI) / 180;
  return [p.x + side * Math.cos(t) + fwd * Math.sin(t), p.z - side * Math.sin(t) + fwd * Math.cos(t)];
}

/** Corners of the room inset for plants / lamps. */
function corners(L: RoomLayout, inset: number): P2[] {
  return L.ctx.edges.map((e, i) => {
    const prev = L.ctx.edges[(i + L.ctx.edges.length - 1) % L.ctx.edges.length] as RoomEdge;
    const a = e.a;
    const ia = (L.ctx.inset[i] ?? 0.06) + inset;
    const ib = (L.ctx.inset[(i + L.ctx.edges.length - 1) % L.ctx.edges.length] ?? 0.06) + inset;
    return [a[0] - e.out[0] * ia - prev.out[0] * ib, a[1] - e.out[1] * ia - prev.out[1] * ib] as P2;
  });
}

function plantInCorners(L: RoomLayout, count: number, height: number): void {
  const species = ['fig', 'olive', 'snake'];
  let placed = 0;
  const cs = corners(L, 0.32);
  for (let k = 0; k < cs.length && placed < count; k++) {
    const c = cs[(k + L.ctx.seed) % cs.length] as P2;
    if (L.tryAt('plant', { height, species: species[(placed + L.ctx.seed) % species.length] as string, potColor: L.ctx.palette.linen }, c[0], c[1], (L.ctx.seed * 37) % 360)) placed++;
  }
}

function curtains(L: RoomLayout): void {
  L.ctx.windows.forEach((_, i) => L.hangCurtain(i, L.ctx.palette.curtain));
}

function art(L: RoomLayout, edge: number, t: number, bottom: number, width: number, height: number): void {
  L.onAnyWall('art', { width, height, frame: L.ctx.palette.metal === 'brass' ? 'brass' : 'black-metal', palette: L.ctx.palette.artPalette }, edge, t, bottom);
}

function mainLight(L: RoomLayout, x: number, z: number, intensity: number): void {
  const [x0, z0, x1, z1] = bounds(L.ctx.polygon);
  const range = Math.max(6, Math.hypot(x1 - x0, z1 - z0) * 1.1);
  const pal = L.ctx.palette;
  const kind = L.ctx.type === 'bathroom' || L.ctx.type === 'hall' || L.ctx.type === 'entry' || L.ctx.type === 'storage' || L.ctx.type === 'laundry' ? 'ceiling-light' : 'pendant';
  if (kind === 'pendant') L.ceiling('pendant', { style: pal.pendant, drop: Math.max(0.3, L.ctx.ceiling - 2.15), size: pal.pendant === 'globe' ? 0.36 : 0.42, finish: pal.pendantFinish }, x, z, warm(intensity, range), 0, 'Pendant light');
  else L.ceiling('ceiling-light', { size: 0.36 }, x, z, warm(intensity * 0.9, range), 0, 'Ceiling light');
}

function switchByDoor(L: RoomLayout): void {
  const d = L.ctx.doors[0];
  if (!d) return;
  const e = L.ctx.edges[d.edge] as RoomEdge;
  // On the latch side (opposite the hinge), just past the frame.
  const t = d.t - d.hinge * (d.width / 2 + 0.18);
  if (t < 0.15 || t > e.length - 0.15) return;
  const p = L.onWall('switch', { finish: L.ctx.palette.metal === 'brass' ? 'brass' : 'paint' }, d.edge, t, 1.1, 'Light switch');
  if (p) p.name = 'Light switch';
}

// ---------------------------------------------------------------------------

function living(L: RoomLayout): void {
  const pal = L.ctx.palette;
  const ctx = L.ctx;
  // A fireplace placed explicitly becomes the focal wall.
  const fire = L.placed.find((p) => p.kind === 'fireplace');
  let sofa: Placed | null = null;
  let sofaEdge = -1;
  // Facing the fireplace when its opposite wall has room, else along the freest other wall.
  const fireEdge = fire ? edgeOf(L, fire) : -1;
  const candidates = fire ? [{ edge: opposite(L, fireEdge) ?? 0, s: 0, t: 0 }, ...edgesByFree(L, 0.8).filter((c) => c.edge !== fireEdge)] : edgesByFree(L, 0.8);
  for (const c of candidates.slice(0, 6)) {
    const free = L.freeIntervals(c.edge, 0.8).sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
    if (!free || free[1] - free[0] < 1.7) continue;
    const width = Math.min(2.6, Math.max(1.6, free[1] - free[0] - 0.5));
    const e = ctx.edges[c.edge] as RoomEdge;
    const target = fire && c.edge === opposite(L, fireEdge) ? tAlong(e, [fire.x, fire.z]) : (free[0] + free[1]) / 2;
    sofa = L.againstWall('sofa', { width, upholstery: pal.upholstery, color: pal.sofa, accent: pal.accent, legs: pal.wood }, c.edge, target);
    if (sofa) {
      sofaEdge = c.edge;
      break;
    }
  }
  if (sofa) {
    const sw = sofa.size[0];
    const ctW = Math.min(1.3, Math.max(0.8, sw * 0.52));
    // 0.42 m of knee room in front of the seat; the table's own half depth (a library model may be deeper).
    const ctDepth = furnitureAsset('coffee-table', ctx.style)?.size[2] ?? 0.6;
    const ctPos = ahead(sofa, sofa.size[2] / 2 + 0.42 + ctDepth / 2);
    L.tryAt('rug', { width: Math.min(3.4, sw + 0.8), depth: 2.2, color: pal.rug, border: pal.rugBorder }, ...ahead(sofa, sofa.size[2] / 2 + 0.55), sofa.yaw);
    L.tryAt('coffee-table', { width: ctW, depth: 0.6, top: pal.worktop === 'oak' ? 'walnut' : pal.worktop, legs: pal.metal === 'brass' ? 'brass' : 'black-metal', shape: ctx.style === 'japandi' ? 'oval' : 'rect' }, ctPos[0], ctPos[1], sofa.yaw);
    // Armchairs at the sides of the coffee table, turned toward it.
    for (const s of [1, -1] as const) {
      const p = ahead(sofa, sofa.size[2] / 2 + 0.42 + 0.3, s * (ctW / 2 + 0.75));
      L.tryAt('armchair', { upholstery: pal.upholstery === 'leather' ? 'leather' : 'fabric', color: pal.armchair, legs: pal.wood }, p[0], p[1], sofa.yaw + s * 90);
    }
    const lampPos = ahead(sofa, -sofa.size[2] / 2 + 0.28, (sw / 2 + 0.32) * (ctx.seed % 2 === 0 ? 1 : -1));
    L.tryAt('floor-lamp', { style: ctx.style === 'modern' ? 'arc' : 'tripod', finish: pal.metal === 'chrome' ? 'chrome' : pal.metal === 'brass' ? 'brass' : 'black-metal', shade: pal.linen }, lampPos[0], lampPos[1], sofa.yaw);
    const e = ctx.edges[sofaEdge] as RoomEdge;
    art(L, sofaEdge, tAlong(e, [sofa.x, sofa.z]), 1.32, Math.min(1.6, sw * 0.6), 0.8);
    // Media wall opposite the sofa.
    const opp = opposite(L, sofaEdge);
    if (opp !== null && !fire) {
      const oe = ctx.edges[opp] as RoomEdge;
      const t = tAlong(oe, [sofa.x, sofa.z]);
      const console = L.againstWall('sideboard', { width: 1.8, height: 0.5, body: pal.wood, fronts: ctx.style === 'japandi' || ctx.style === 'scandinavian' ? 'slats' : 'doors', legs: pal.metal === 'chrome' ? 'chrome' : 'black-metal' }, opp, t, 'Media console');
      if (console) {
        const ct = tAlong(oe, [console.x, console.z]);
        L.onWall('tv', { inches: 65 }, opp, ct, 1.05, 'TV');
        L.onTop('table-lamp', { base: pal.linen, shade: pal.linen }, console, console.size[0] / 2 - 0.25, 0);
      }
    }
  }
  // Bookshelf on the largest remaining wall.
  const used = new Set<number>(sofaEdge >= 0 ? [sofaEdge] : []);
  const shelfSpot = edgesByFree(L, 2, used).find((c) => c.t - c.s >= 1.2);
  if (shelfSpot) L.againstWall('bookshelf', { width: Math.min(2, shelfSpot.t - shelfSpot.s - 0.2), height: Math.min(2.2, ctx.ceiling - 0.4), finish: pal.wood, fill: 0.75 }, shelfSpot.edge, null);
  plantInCorners(L, 2, 1.5);
  curtains(L);
  const c = sofa ? ahead(sofa, sofa.size[2] / 2 + 0.9) : interiorPoint(ctx.polygon);
  mainLight(L, c[0], c[1], 3.2);
  switchByDoor(L);
}

function edgeOf(L: RoomLayout, p: Placed): number {
  let best = 0;
  let bestD = Infinity;
  L.ctx.edges.forEach((e, i) => {
    const d = Math.abs((p.x - e.a[0]) * e.out[0] + (p.z - e.a[1]) * e.out[1]);
    const along = (p.x - e.a[0]) * e.dir[0] + (p.z - e.a[1]) * e.dir[1];
    if (along < -0.2 || along > e.length + 0.2) return;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function bedroom(L: RoomLayout, kids = false): void {
  const pal = L.ctx.palette;
  const ctx = L.ctx;
  const [x0, z0, x1, z1] = bounds(ctx.polygon);
  const small = Math.min(x1 - x0, z1 - z0) < 3.2 || kids;
  const size = small ? (Math.min(x1 - x0, z1 - z0) < 2.8 || kids ? 'single' : 'double') : Math.min(x1 - x0, z1 - z0) > 3.8 ? 'king' : 'queen';
  // Headboard wall: the longest free wall without windows (beds block windows otherwise).
  let bed: Placed | null = null;
  let bedEdge = -1;
  for (const c of edgesByFree(L, 1.1)) {
    const width = size === 'single' ? 1.02 : size === 'double' ? 1.52 : size === 'queen' ? 1.72 : 1.92;
    if (c.t - c.s < width + (small ? 0.1 : 1.1)) continue;
    bed = L.againstWall('bed', { size, frame: pal.wood, headboard: pal.armchair, linen: pal.linen, throw: pal.throw }, c.edge, (c.s + c.t) / 2);
    if (bed) {
      bedEdge = c.edge;
      break;
    }
  }
  if (bed) {
    const e = ctx.edges[bedEdge] as RoomEdge;
    L.tryAt('rug', { width: Math.min(3, bed.size[0] + 1.2), depth: 1.8, color: pal.rug, border: pal.rugBorder }, ...ahead(bed, 0.35), bed.yaw);
    for (const s of [-1, 1] as const) {
      const p = ahead(bed, -bed.size[2] / 2 + 0.2 + 0.02, s * (bed.size[0] / 2 + 0.3));
      const ns = L.tryAt('nightstand', { body: pal.wood }, p[0], p[1], bed.yaw);
      if (ns) L.onTop('table-lamp', { base: pal.linen, shade: pal.linen }, ns, 0.08, -0.05);
    }
    art(L, bedEdge, tAlong(e, [bed.x, bed.z]), 1.25, Math.min(1.4, bed.size[0] * 0.8), 0.6);
  }
  const used = new Set<number>(bedEdge >= 0 ? [bedEdge] : []);
  const robe = edgesByFree(L, 2.3, used).find((c) => c.t - c.s >= 1.3);
  if (robe) L.againstWall('wardrobe', { width: Math.min(2.4, Math.floor((robe.t - robe.s - 0.1) * 2) / 2), height: Math.min(2.4, ctx.ceiling - 0.2), finish: ctx.style === 'industrial' ? 'walnut' : 'paint', color: pal.kitchenColor }, robe.edge, null);
  if (kids || !small) {
    const desk = edgesByFree(L, 0.75, used).find((c) => c.t - c.s >= 1.3);
    if (desk) {
      const d = L.againstWall('desk', { width: 1.2, depth: 0.6, top: pal.wood, base: pal.metal === 'brass' ? 'brass' : 'black-metal' }, desk.edge, null);
      if (d) {
        const p = ahead(d, d.size[2] / 2 + 0.15);
        L.tryAt('chair', { wood: pal.wood, seat: 'fabric', color: pal.armchair }, p[0], p[1], d.yaw + 180);
      }
    }
  }
  plantInCorners(L, 1, 1.2);
  curtains(L);
  const c = bed ? ahead(bed, 0.4) : interiorPoint(ctx.polygon);
  mainLight(L, c[0], c[1], 2.4);
  switchByDoor(L);
}

function kitchen(L: RoomLayout, withDining: boolean): void {
  const pal = L.ctx.palette;
  const ctx = L.ctx;
  let run: Placed | null = null;
  for (const c of edgesByFree(L, 0.92)) {
    if (c.t - c.s < 2) continue;
    const len = Math.min(4.8, c.t - c.s - 0.85);
    if (len < 1.6) continue;
    // Upper cabinets only where no window interrupts the wall.
    const upper = !ctx.windows.some((w) => w.edge === c.edge && w.sill < 1.45);
    run = L.againstWall('kitchen', { length: len, worktop: pal.worktop, fronts: pal.kitchenFronts, color: pal.kitchenColor, upper, sink: 'left', hob: 'right', splashback: ctx.style === 'industrial' ? 'subway-tile' : ctx.style === 'classic' ? 'marble' : 'subway-tile' }, c.edge, c.s + 0.75 + len / 2);
    if (run) {
      const e = ctx.edges[c.edge] as RoomEdge;
      const t = tAlong(e, [run.x, run.z]);
      L.againstWall('fridge', { width: 0.7, finish: ctx.style === 'industrial' ? 'black-metal' : 'brushed-metal' }, c.edge, t - len / 2 - 0.37);
      break;
    }
  }
  let island: Placed | null = null;
  if (run) {
    const p = ahead(run, run.size[2] / 2 + 1.05 + 0.5);
    island = L.tryAt('island', { width: Math.min(2.4, run.size[0] * 0.65), depth: 1.0, worktop: pal.worktop, fronts: pal.kitchenFronts === 'paint' ? pal.wood : pal.kitchenFronts, color: pal.kitchenColor }, p[0], p[1], run.yaw + 180);
    if (island) {
      const n = Math.max(2, Math.min(4, Math.floor(island.size[0] / 0.6)));
      for (let k = 0; k < n; k++) {
        const side = (k - (n - 1) / 2) * 0.6;
        const sp = ahead(island, island.size[2] / 2 + 0.05, side);
        L.tryAt('bar-stool', { height: 0.65, seat: ctx.style === 'industrial' ? 'leather' : pal.wood, color: pal.armchair, legs: pal.metal === 'chrome' ? 'chrome' : pal.metal === 'brass' ? 'brass' : 'black-metal' }, sp[0], sp[1], island.yaw + 180);
      }
      // Two pendants over the island.
      for (const s of [-1, 1] as const) {
        const lp = ahead(island, 0, s * island.size[0] * 0.25);
        L.ceiling('pendant', { style: pal.pendant === 'linear' ? 'dome' : pal.pendant, drop: Math.max(0.3, ctx.ceiling - 1.75), size: 0.3, finish: pal.pendantFinish }, lp[0], lp[1], s < 0 ? warm(2.2, 7) : {}, 0, 'Island pendant');
      }
    }
  }
  if (withDining) dining(L, false);
  if (!island && !withDining) mainLight(L, ...interiorPoint(ctx.polygon), 2.8);
  plantInCorners(L, 1, 0.9);
  switchByDoor(L);
}

function dining(L: RoomLayout, decorate = true): void {
  const pal = L.ctx.palette;
  const ctx = L.ctx;
  const [x0, z0, x1, z1] = bounds(ctx.polygon);
  const W = x1 - x0;
  const D = z1 - z0;
  const alongX = W >= D;
  const long = (alongX ? W : D) - 2.0;
  const short = (alongX ? D : W) - 2.0;
  if (long < 0.9 || short < 0.6) return;
  const seats = long >= 2.2 ? 8 : long >= 1.6 ? 6 : 4;
  const tl = Math.min(2.4, Math.max(0.9, long));
  const td = Math.min(1.0, Math.max(0.8, short));
  // Free spot: the room centre, or the largest free area away from the kitchen run.
  const centre = interiorPoint(ctx.polygon);
  const tries: P2[] = [centre];
  for (const dx of [-1, 1, -2, 2]) tries.push(alongX ? [centre[0] + dx * 0.5, centre[1]] : [centre[0], centre[1] + dx * 0.5]);
  for (const [cx, cz] of [...tries, ...(L.placed.length > 0 ? [[x0 + W * 0.3, z0 + D * 0.7], [x0 + W * 0.7, z0 + D * 0.7], [x0 + W * 0.7, z0 + D * 0.3], [x0 + W * 0.3, z0 + D * 0.3]] as P2[] : [])]) {
    const yaw = alongX ? 0 : 90;
    const table = L.tryAt('dining-table', { width: tl, depth: td, top: pal.wood, legs: pal.wood, base: ctx.style === 'industrial' ? 'trestle' : 'four' }, cx, cz, yaw);
    if (!table) continue;
    const perSide = Math.max(1, Math.floor(seats / 2) - (seats >= 6 ? 1 : 0));
    for (const s of [-1, 1] as const) {
      for (let k = 0; k < perSide; k++) {
        const along = (k - (perSide - 1) / 2) * Math.min(0.68, tl / perSide);
        const p = ahead(table, s * (td / 2 + 0.12), along);
        L.tryAt('chair', { wood: pal.wood, seat: ctx.style === 'industrial' ? 'leather' : 'fabric', color: pal.armchair, style: ctx.style === 'classic' ? 'panel' : ctx.style === 'scandinavian' ? 'spindle' : 'slat' }, p[0], p[1], table.yaw + (s < 0 ? 0 : 180));
      }
    }
    if (seats >= 6) {
      for (const s of [-1, 1] as const) {
        const p = ahead(table, 0, s * (tl / 2 + 0.12));
        L.tryAt('chair', { wood: pal.wood, seat: 'fabric', color: pal.armchair }, p[0], p[1], table.yaw + (s < 0 ? 90 : -90));
      }
    }
    L.ceiling('pendant', { style: tl > 1.9 ? 'linear' : pal.pendant, drop: Math.max(0.3, ctx.ceiling - 1.6), size: tl > 1.9 ? 1.2 : 0.45, finish: pal.pendantFinish }, table.x, table.z, warm(2.6, 8), table.yaw, 'Dining pendant');
    break;
  }
  if (decorate) {
    const sb = edgesByFree(L, 0.8).find((c) => c.t - c.s >= 1.6);
    if (sb) {
      const p = L.againstWall('sideboard', { width: Math.min(2, sb.t - sb.s - 0.3), height: 0.78, body: pal.wood, fronts: 'doors', legs: 'black-metal' }, sb.edge, null);
      if (p) art(L, sb.edge, tAlong(ctx.edges[sb.edge] as RoomEdge, [p.x, p.z]), 1.3, 1.0, 0.7);
    }
    plantInCorners(L, 1, 1.4);
    curtains(L);
    switchByDoor(L);
  }
}

function bathroom(L: RoomLayout): void {
  const pal = L.ctx.palette;
  const ctx = L.ctx;
  const [x0, z0, x1, z1] = bounds(ctx.polygon);
  const long = Math.max(x1 - x0, z1 - z0);
  const free = edgesByFree(L, 0.9);
  const used = new Set<number>();
  // Tub along the longest wall when the room allows, else a shower in a corner.
  if (long >= 2.4) {
    for (const c of free) {
      if (c.t - c.s < 1.75) continue;
      const tub = L.againstWall('bathtub', { length: Math.min(1.8, c.t - c.s - 0.3) - 0.3, color: '#f4f2ee' }, c.edge, c.s + (c.t - c.s) / 2);
      if (tub) {
        used.add(c.edge);
        break;
      }
    }
  }
  if (used.size === 0) {
    for (const c of free) {
      if (c.t - c.s < 1.0) continue;
      const sh = L.againstWall('shower', { width: Math.min(1.2, c.t - c.s - 0.1), depth: 0.9 }, c.edge, c.s + 0.6);
      if (sh) {
        used.add(c.edge);
        break;
      }
    }
  }
  const vanitySpot = edgesByFree(L, 0.9, used).find((c) => c.t - c.s >= 0.8);
  if (vanitySpot) {
    const v = L.againstWall('vanity', { width: Math.min(1.2, vanitySpot.t - vanitySpot.s - 0.1), body: pal.wood === 'walnut' ? 'walnut' : 'oak', top: pal.worktop === 'oak' || pal.worktop === 'walnut' ? 'marble' : pal.worktop }, vanitySpot.edge, null);
    if (v) {
      L.onWall('mirror', { width: 0.6, height: 0.8, shape: ctx.style === 'classic' ? 'arch' : 'round', frame: pal.metal === 'brass' ? 'brass' : 'black-metal' }, vanitySpot.edge, tAlong(ctx.edges[vanitySpot.edge] as RoomEdge, [v.x, v.z]), 1.05);
      used.add(vanitySpot.edge);
    }
  }
  const wc = edgesByFree(L, 1.1).find((c) => c.t - c.s >= 0.8);
  if (wc) L.againstWall('toilet', { color: '#f3f1ed' }, wc.edge, null);
  plantInCorners(L, 1, 0.6);
  mainLight(L, ...interiorPoint(ctx.polygon), 2.2);
  switchByDoor(L);
}

function office(L: RoomLayout): void {
  const pal = L.ctx.palette;
  const ctx = L.ctx;
  // Desk facing a window when possible.
  const win = ctx.windows[0];
  let desk: Placed | null = null;
  if (win && win.sill >= 0.7) desk = L.againstWall('desk', { width: 1.5, depth: 0.7, top: pal.wood, base: 'black-metal' }, win.edge, (win.t0 + win.t1) / 2);
  if (!desk) {
    const c = edgesByFree(L, 0.75)[0];
    if (c) desk = L.againstWall('desk', { width: Math.min(1.6, c.t - c.s - 0.2), depth: 0.7, top: pal.wood, base: 'black-metal' }, c.edge, null);
  }
  if (desk) {
    const p = ahead(desk, desk.size[2] / 2 + 0.15);
    L.tryAt('office-chair', { color: pal.sofa, base: 'chrome' }, p[0], p[1], desk.yaw + 180);
    L.onTop('table-lamp', { base: pal.linen, shade: pal.linen }, desk, desk.size[0] / 2 - 0.2, -0.15);
  }
  const shelf = edgesByFree(L, 2).find((c) => c.t - c.s >= 1.2);
  if (shelf) L.againstWall('bookshelf', { width: Math.min(2.2, shelf.t - shelf.s - 0.2), height: Math.min(2.2, ctx.ceiling - 0.3), finish: pal.wood, fill: 0.8 }, shelf.edge, null);
  const ac = edgesByFree(L, 0.8).find((c) => c.t - c.s >= 1.2);
  if (ac) {
    const chair = L.againstWall('armchair', { upholstery: pal.upholstery === 'leather' ? 'leather' : 'fabric', color: pal.armchair, legs: pal.wood }, ac.edge, null);
    if (chair) L.tryAt('floor-lamp', { style: 'tripod', finish: pal.metal === 'chrome' ? 'chrome' : 'black-metal', shade: pal.linen }, ...ahead(chair, 0, 0.7), chair.yaw);
  }
  plantInCorners(L, 1, 1.3);
  curtains(L);
  mainLight(L, ...interiorPoint(ctx.polygon), 2.6);
  switchByDoor(L);
}

function hall(L: RoomLayout): void {
  const pal = L.ctx.palette;
  const spot = edgesByFree(L, 0.8).find((c) => c.t - c.s >= 1.1);
  if (spot) {
    const p = L.againstWall('sideboard', { width: Math.min(1.4, spot.t - spot.s - 0.2), height: 0.8, body: pal.wood, fronts: 'drawers', legs: 'black-metal' }, spot.edge, null, 'Console');
    if (p) L.onWall('mirror', { width: 0.7, height: 1.0, shape: 'arch', frame: pal.metal === 'brass' ? 'brass' : 'black-metal' }, spot.edge, tAlong(L.ctx.edges[spot.edge] as RoomEdge, [p.x, p.z]), 1.1);
  }
  const [x0, z0, x1, z1] = bounds(L.ctx.polygon);
  const c = interiorPoint(L.ctx.polygon);
  L.tryAt('rug', { width: Math.max(0.8, Math.min(3, (x1 - x0) * 0.6)), depth: Math.max(0.8, Math.min(2.4, (z1 - z0) * 0.5)), color: pal.rug, border: pal.rugBorder }, c[0], c[1], 0);
  plantInCorners(L, 1, 1.2);
  mainLight(L, c[0], c[1], 2);
  switchByDoor(L);
}

function cafe(L: RoomLayout): void {
  const pal = L.ctx.palette;
  const ctx = L.ctx;
  // Counter parallel to the wall farthest from the main door, barista side to the wall.
  const door = ctx.doors[0];
  const doorEdge = door ? door.edge : 0;
  const back = opposite(L, doorEdge) ?? 0;
  const be = ctx.edges[back] as RoomEdge;
  const len = Math.min(4.2, be.length - 2.2);
  if (len >= 1.6) {
    const t = be.length / 2;
    const p = L.facePoint(back, t, 1.25 + 0.35);
    L.tryAt('cafe-counter', { length: len, front: ctx.style === 'industrial' ? 'walnut' : 'oak', top: 'terrazzo' }, p[0], p[1], yawFacingIn(be));
    L.againstWall('kitchen', { length: Math.min(3, len), upper: true, sink: 'center', hob: 'none', worktop: 'concrete', fronts: pal.kitchenFronts, color: pal.kitchenColor, splashback: 'subway-tile' }, back, t, 'Back bar');
  }
  // Tables in a grid with two chairs each.
  const [x0, z0, x1, z1] = bounds(ctx.polygon);
  let n = 0;
  for (let x = x0 + 1.4; x < x1 - 1.0; x += 1.9) {
    for (let z = z0 + 1.4; z < z1 - 1.0; z += 1.9) {
      const table = L.tryAt('dining-table', { width: 0.7, depth: 0.7, shape: 'round', top: (n % 2 === 0 ? 'marble' : 'terrazzo') as string, base: 'pedestal', legs: pal.metal === 'brass' ? 'brass' : 'black-metal' }, x, z, 0, 'Café table');
      if (!table) continue;
      n++;
      for (const s of [-1, 1] as const) {
        const p = ahead(table, s * 0.52);
        L.tryAt('chair', { wood: pal.wood, seat: 'wood', style: 'spindle' }, p[0], p[1], s < 0 ? 0 : 180);
      }
      if (n % 2 === 1) L.ceiling('pendant', { style: 'globe', drop: Math.max(0.4, ctx.ceiling - 1.9), size: 0.3, finish: 'frosted-glass' }, x, z, n <= 6 ? warm(1.6, 6) : {}, 0, 'Café pendant');
    }
  }
  const lounge = edgesByFree(L, 0.8).find((c) => c.t - c.s >= 2.4);
  if (lounge) L.againstWall('sofa', { width: Math.min(2.4, lounge.t - lounge.s - 0.4), upholstery: 'leather', color: '#6e4128', accent: pal.accent, legs: 'black-metal' }, lounge.edge, null, 'Banquette');
  plantInCorners(L, 3, 1.6);
  for (const w of edgesByFree(L, 2.5).slice(0, 2)) art(L, w.edge, (w.s + w.t) / 2, 1.4, 0.9, 1.1);
  switchByDoor(L);
}

function meeting(L: RoomLayout): void {
  const pal = L.ctx.palette;
  const ctx = L.ctx;
  const [x0, z0, x1, z1] = bounds(ctx.polygon);
  const W = x1 - x0;
  const D = z1 - z0;
  const alongX = W >= D;
  const tl = Math.min(4.8, Math.max(1.6, (alongX ? W : D) - 2.4));
  const td = Math.min(1.3, Math.max(0.9, (alongX ? D : W) - 2.2));
  const c = interiorPoint(ctx.polygon);
  const table = L.tryAt('dining-table', { width: tl, depth: td, top: pal.wood, base: 'trestle', legs: 'black-metal' }, c[0], c[1], alongX ? 0 : 90, 'Meeting table');
  if (table) {
    const per = Math.max(2, Math.floor(tl / 0.8));
    for (const s of [-1, 1] as const) {
      for (let k = 0; k < per; k++) {
        const p = ahead(table, s * (td / 2 + 0.2), (k - (per - 1) / 2) * 0.8);
        L.tryAt('office-chair', { color: pal.sofa, base: 'chrome' }, p[0], p[1], table.yaw + (s < 0 ? 0 : 180));
      }
    }
    L.ceiling('pendant', { style: 'linear', drop: Math.max(0.3, ctx.ceiling - 2.0), size: Math.min(2.4, tl * 0.6), finish: 'black-metal' }, table.x, table.z, warm(3, 9), table.yaw, 'Linear pendant');
    // Screen on an end wall, whiteboard on a side wall.
    const end = ctx.edges.findIndex((e) => Math.abs(e.dir[0]) < 0.5 === alongX);
    if (end >= 0) L.onWall('tv', { inches: 75 }, end, (ctx.edges[end] as RoomEdge).length / 2, 0.95, 'Screen');
    const side = edgesByFree(L, 1.3).find((c2) => c2.t - c2.s >= 1.9 && c2.edge !== end);
    if (side) L.onWall('whiteboard', { width: 1.8 }, side.edge, (side.s + side.t) / 2, 0.9);
  }
  plantInCorners(L, 2, 1.5);
  switchByDoor(L);
}

function openOffice(L: RoomLayout): void {
  const pal = L.ctx.palette;
  const ctx = L.ctx;
  const [x0, z0, x1, z1] = bounds(ctx.polygon);
  let lights = 0;
  // Benching: pairs of desks facing each other in rows along X.
  for (let z = z0 + 1.6; z < z1 - 1.5; z += 3.1) {
    for (let x = x0 + 1.3; x < x1 - 1.2; x += 1.7) {
      for (const s of [-1, 1] as const) {
        const d = L.tryAt('desk', { width: 1.5, depth: 0.75, top: pal.wood, base: 'black-metal' }, x, z + s * 0.38, s < 0 ? 0 : 180, 'Desk');
        if (!d) continue;
        const p = ahead(d, d.size[2] / 2 + 0.15);
        L.tryAt('office-chair', { color: pal.sofa, base: 'chrome' }, p[0], p[1], d.yaw + 180);
      }
      if (lights < 6 && x + 1.7 >= x1 - 1.2) {
        lights++;
        L.ceiling('pendant', { style: 'linear', drop: Math.max(0.4, ctx.ceiling - 2.1), size: Math.min(2.4, x1 - x0 - 2.6), finish: 'black-metal' }, (x0 + x1) / 2, z, warm(3, 10), 0, 'Linear pendant');
      }
    }
  }
  plantInCorners(L, 4, 1.7);
  for (const w of edgesByFree(L, 2.2).slice(0, 2)) if (w.t - w.s >= 2) L.againstWall('bookshelf', { width: 1.8, height: 1.2, shelves: 3, finish: pal.wood, fill: 0.6 }, w.edge, null, 'Storage');
  switchByDoor(L);
}

function lobby(L: RoomLayout): void {
  const pal = L.ctx.palette;
  const spot = edgesByFree(L, 0.8)[0];
  if (spot && spot.t - spot.s >= 2.2) {
    const sofa = L.againstWall('sofa', { width: Math.min(2.4, spot.t - spot.s - 0.4), upholstery: pal.upholstery, color: pal.sofa, accent: pal.accent, legs: pal.wood }, spot.edge, null);
    if (sofa) {
      const p = ahead(sofa, sofa.size[2] / 2 + 0.72);
      L.tryAt('coffee-table', { width: 1.1, depth: 0.6, shape: 'oval', top: 'marble', legs: 'black-metal' }, p[0], p[1], sofa.yaw);
      for (const s of [-1, 1] as const) L.tryAt('armchair', { upholstery: pal.upholstery, color: pal.armchair, legs: pal.wood }, ...ahead(sofa, sofa.size[2] / 2 + 0.72, s * 1.3), sofa.yaw + s * 90);
    }
  }
  const desk = edgesByFree(L, 0.8).find((c) => c.t - c.s >= 2);
  if (desk) L.againstWall('sideboard', { width: 1.8, height: 1.05, body: pal.wood, fronts: 'slats', legs: 'black-metal' }, desk.edge, null, 'Reception desk');
  plantInCorners(L, 3, 1.8);
  mainLight(L, ...interiorPoint(L.ctx.polygon), 3);
  switchByDoor(L);
}

function terrace(L: RoomLayout): void {
  const pal = L.ctx.palette;
  const c = interiorPoint(L.ctx.polygon);
  const t = L.tryAt('dining-table', { width: 1.8, depth: 0.9, top: 'oak', legs: 'black-metal' }, c[0], c[1], 0, 'Outdoor table');
  if (t) {
    for (const s of [-1, 1] as const) {
      for (const along of [-0.5, 0.5]) {
        const p = ahead(t, s * 0.57, along);
        L.tryAt('chair', { wood: 'oak', seat: 'wood' }, p[0], p[1], s < 0 ? 0 : 180);
      }
    }
  }
  plantInCorners(L, 3, 1.4);
  void pal;
}

function storage(L: RoomLayout): void {
  for (const c of edgesByFree(L, 2).slice(0, 2)) if (c.t - c.s >= 1) L.againstWall('bookshelf', { width: Math.min(2, c.t - c.s - 0.1), height: 2, shelves: 5, finish: 'paint', fill: 0.4 }, c.edge, null, 'Shelving');
  mainLight(L, ...interiorPoint(L.ctx.polygon), 1.6);
  switchByDoor(L);
}

/**
 * A wall piece the plan asks for on a compass wall. Curtains hang on the
 * windows (of that wall, else of the room); everything else takes the
 * nearest clear stretch of the wall, then of the other walls, so nothing
 * lands on a door or a window.
 */
function hangExplicit(L: RoomLayout, kind: string, params: Record<string, Json>, edge: number, side: string, at: number | null = null): void {
  const e = L.ctx.edges[edge] as RoomEdge;
  if (kind === 'curtain') {
    const color = typeof params['color'] === 'string' ? params['color'] : L.ctx.palette.curtain;
    let idx = L.ctx.windows.map((w, i) => (w.edge === edge ? i : -1)).filter((i) => i >= 0);
    if (idx.length === 0) {
      idx = L.ctx.windows.map((_, i) => i);
      if (idx.length > 0) L.notes.push(`no window on the ${side} wall of ${L.ctx.id}; the curtain hangs on a window of the room`);
    }
    if (idx.length === 0) {
      L.notes.push(`no window in ${L.ctx.id} for the curtain`);
      return;
    }
    let hung = 0;
    for (const i of idx) hung += L.hangCurtain(i, color).length;
    if (hung === 0) L.notes.push(`no clear wall beside the windows of ${L.ctx.id} for the curtain`);
    return;
  }
  const y = kind === 'tv' ? 1.05 : kind === 'sconce' ? 1.7 : kind === 'switch' ? 1.1 : kind === 'whiteboard' ? 0.9 : 1.3;
  const p = L.onAnyWall(kind, params, edge, at ?? e.length / 2, y);
  if (!p) L.notes.push(`no clear wall in ${L.ctx.id} for the ${kind} (doors and windows take the rest)`);
  else if (p.wall && p.wall.edge !== edge) L.notes.push(`the ${side} wall of ${L.ctx.id} had no clear stretch for the ${kind}; hung on the ${(L.ctx.edges[p.wall.edge] as RoomEdge).side} wall`);
}

/** Place explicit plan items first (they win over the recipe). */
function explicitItems(L: RoomLayout, items: readonly PlanItem[]): void {
  // Curtains claim the wall beside their windows before pictures and mirrors take what is left.
  const ordered = [...items.filter((i) => i.kind === 'curtain'), ...items.filter((i) => i.kind !== 'curtain')];
  for (const item of ordered) {
    const def = L.def(item.kind);
    if (!def) {
      L.notes.push(`unknown furniture kind "${item.kind}" in room ${L.ctx.id}`);
      continue;
    }
    const params = item.params as Record<string, Json>;
    if (def.mount === 'wall') {
      // Wall pieces snap to a wall: the requested one, the one nearest `at`, else the freest.
      let edge = -1;
      let t: number | null = null;
      let side = 'room';
      if (item.against) {
        const n = compassNormal(item.against);
        edge = L.ctx.edges.findIndex((e) => e.out[0] * n[0] + e.out[1] * n[1] > 0.9);
        side = item.against;
      } else if (item.at) {
        let bestD = Infinity;
        L.ctx.edges.forEach((e, i) => {
          const along = (item.at![0] - e.a[0]) * e.dir[0] + (item.at![1] - e.a[1]) * e.dir[1];
          const off = Math.abs((item.at![0] - e.a[0]) * e.out[0] + (item.at![1] - e.a[1]) * e.out[1]);
          if (along < 0 || along > e.length || off >= bestD) return;
          bestD = off;
          edge = i;
          t = along;
        });
        if (edge >= 0) side = (L.ctx.edges[edge] as RoomEdge).side;
      }
      if (edge < 0) edge = edgesByFree(L, 1.5)[0]?.edge ?? 0;
      hangExplicit(L, item.kind, params, edge, side, t);
      continue;
    }
    if (item.at) {
      const placed = L.make(def, params, item.at[0], item.at[1], item.yaw ?? 0, def.mount === 'ceiling' ? L.ctx.ceiling : 0);
      L.push(placed);
      continue;
    }
    if (item.against) {
      const n = compassNormal(item.against);
      const edge = L.ctx.edges.findIndex((e) => e.out[0] * n[0] + e.out[1] * n[1] > 0.9);
      if (edge >= 0) {
        const e = L.ctx.edges[edge] as RoomEdge;
        // Anywhere free along the requested wall; else fall through to the freest wall.
        if (L.againstWall(item.kind, params, edge, e.length / 2) || L.againstWall(item.kind, params, edge, null)) continue;
        L.notes.push(`no room for ${item.kind} on the ${item.against} wall of ${L.ctx.id}; placed elsewhere`);
      }
    }
    const best = edgesByFree(L, furnitureSize(def, params)[1])[0];
    if (best && def.againstWall && L.againstWall(item.kind, params, best.edge, null)) continue;
    const c = interiorPoint(L.ctx.polygon);
    if (!L.tryAt(item.kind, params, c[0], c[1], 0)) L.notes.push(`no room for ${item.kind} in ${L.ctx.id}`);
  }
}

/** Furnish one room. Returns the placements and notes. */
export function furnishRoom(ctx: RoomContext, items: readonly PlanItem[], auto: boolean): { placed: Placed[]; notes: string[] } {
  const L = new RoomLayout(ctx);
  explicitItems(L, items);
  if (auto) {
    switch (ctx.type) {
      case 'living':
        living(L);
        break;
      case 'bedroom':
        bedroom(L);
        break;
      case 'kids':
        bedroom(L, true);
        break;
      case 'studio':
        bedroom(L);
        living(L);
        break;
      case 'kitchen': {
        const [x0, z0, x1, z1] = bounds(ctx.polygon);
        kitchen(L, (x1 - x0) * (z1 - z0) > 22);
        break;
      }
      case 'dining':
        dining(L);
        break;
      case 'bathroom':
      case 'laundry':
        bathroom(L);
        break;
      case 'office':
        office(L);
        break;
      case 'hall':
      case 'entry':
        hall(L);
        break;
      case 'cafe':
        cafe(L);
        break;
      case 'meeting':
        meeting(L);
        break;
      case 'open-office':
        openOffice(L);
        break;
      case 'lobby':
        lobby(L);
        break;
      case 'terrace':
        terrace(L);
        break;
      case 'storage':
      case 'garage':
        storage(L);
        break;
    }
  }
  return { placed: L.placed, notes: L.notes };
}
