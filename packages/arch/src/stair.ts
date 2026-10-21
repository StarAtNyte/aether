/**
 * Stairs: straight, L (quarter turn with a landing) and U (half turn). Each
 * flight is a monolithic concrete-style profile (sawtooth top, sloped
 * soffit) extruded across the width, with timber treads on top. Riser
 * heights are equal over the whole stair (≈ 17.5 cm by default) and the last
 * riser lands on the floor above, so the upper slab edge is the top step.
 *
 * Local frame: the first riser is at x = 0, the first flight ascends along
 * +X centred on z = 0; "left" turns toward −Z (facing +X with Y up).
 * Colliders are smooth ramps (hulls) along each flight plus landing boxes,
 * so a character controller walks up without snagging on nosings.
 */
import { Geom, box, cylinder, tube } from './mesh';
import { PartSet } from './parts';
import type { StairParams } from './params';
import type { ArchOutput } from './types';
import { rect, type P2 } from './math2';

/** Comfortable riser height used when `steps` is automatic (metres). */
export const DEFAULT_RISER = 0.175;
const TREAD = 0.04;
const NOSING = 0.02;
const WAIST = 0.18;

/** A straight run of treads in the stair's local frame. */
interface Flight {
  /** Start of the first tread (plan) and the unit direction of travel. */
  x: number;
  z: number;
  dx: number;
  dz: number;
  /** Height of the floor / landing the flight starts from. */
  y0: number;
  /** Treads in this flight (each one riser above the previous). */
  treads: number;
}

/** Riser count and height for a stair. */
export function stairRisers(p: Pick<StairParams, 'rise' | 'steps'>): { count: number; riser: number } {
  const count = p.steps > 0 ? p.steps : Math.max(2, Math.round(p.rise / DEFAULT_RISER));
  return { count, riser: p.rise / count };
}

/** Layout of the flights and landings (local plan). */
export function stairLayout(p: StairParams): { flights: Flight[]; landings: Array<{ x0: number; z0: number; x1: number; z1: number; y: number }>; riser: number } {
  const { count, riser } = stairRisers(p);
  const g = p.going;
  const w = p.width;
  if (p.shape === 'straight' || count < 4) {
    return { flights: [{ x: 0, z: 0, dx: 1, dz: 0, y0: 0, treads: count - 1 }], landings: [], riser };
  }
  const n1 = Math.floor(count / 2);
  const t1 = n1 - 1;
  const t2 = count - n1 - 1;
  const lx0 = t1 * g;
  const s = p.turn === 'left' ? -1 : 1;
  if (p.shape === 'l') {
    // Landing w×w at the end of flight 1; flight 2 leaves it sideways.
    const landing = { x0: lx0, z0: -w / 2, x1: lx0 + w, z1: w / 2, y: n1 * riser };
    const f2: Flight = { x: lx0 + w / 2, z: s * (w / 2), dx: 0, dz: s, y0: n1 * riser, treads: t2 };
    return { flights: [{ x: 0, z: 0, dx: 1, dz: 0, y0: 0, treads: t1 }, f2], landings: [landing], riser };
  }
  // U: full-width landing; flight 2 runs back along −X beside flight 1.
  const off = s * (w + p.gap);
  const landing = { x0: lx0, z0: Math.min(-w / 2, off - w / 2), x1: lx0 + w, z1: Math.max(w / 2, off + w / 2), y: n1 * riser };
  const f2: Flight = { x: lx0, z: off, dx: -1, dz: 0, y0: n1 * riser, treads: t2 };
  return { flights: [{ x: 0, z: 0, dx: 1, dz: 0, y0: 0, treads: t1 }, f2], landings: [landing], riser };
}

/** How far the walking line runs onto the floor before the first riser and beyond the top step (m). */
export const STAIR_WALK_LINE_RUN_OUT = 0.4;

/**
 * The stair's walking line in its local frame: feet positions `[x, y, z]` from the floor before the first riser,
 * up the middle of each flight, through the centre of the landing (where an L or U stair turns) to the floor beyond
 * the top step. A person keeps to it; cutting the turn walks the inner edge of the flight, under the slab that
 * borders the stairwell there.
 */
export function stairWalkLine(p: StairParams): Array<[number, number, number]> {
  const { flights, landings } = stairLayout(p);
  const g = p.going;
  const w = p.width;
  const out = STAIR_WALK_LINE_RUN_OUT;
  const f1 = flights[0] as Flight;
  const line: Array<[number, number, number]> = [[-out, 0, 0]];
  const l = landings[0];
  const f2 = flights[1];
  if (!l || !f2) {
    const run = f1.treads * g;
    line.push([run, p.rise, 0], [run + out, p.rise, 0]);
    return line;
  }
  const cx = l.x0 + w / 2;
  // Up the first flight to the landing, to its centre (the turn), across to the second flight's centre line.
  line.push([l.x0, l.y, 0], [cx, l.y, 0]);
  if (p.shape === 'u') {
    line.push([cx, l.y, f2.z], [f2.x, l.y, f2.z]);
  } else line.push([f2.x, l.y, f2.z]);
  const run2 = f2.treads * g;
  const end: [number, number] = [f2.x + f2.dx * run2, f2.z + f2.dz * run2];
  line.push([end[0], p.rise, end[1]], [end[0] + f2.dx * out, p.rise, end[1] + f2.dz * out]);
  return line;
}

/** Plan footprint of the stair (the hole to cut in the floor above). */
export function stairFootprint(p: StairParams): P2[] {
  const { flights, landings } = stairLayout(p);
  const w = p.width;
  const g = p.going;
  const f1 = flights[0] as Flight;
  if (flights.length === 1) return rect(0, -w / 2, Math.max(g, f1.treads * g), w / 2);
  const l = landings[0] as { x0: number; z0: number; x1: number; z1: number };
  const f2 = flights[1] as Flight;
  if (p.shape === 'u') {
    // The return flight can be a tread longer than the first (an odd riser count): its top step then comes out
    // past the first riser, and the opening runs that far over it (the slab would otherwise sit on its last tread).
    const x2 = Math.min(0, f2.x + f2.dx * f2.treads * g);
    if (x2 > -1e-6) return rect(0, l.z0, l.x1, l.z1);
    const lo = f2.z - w / 2;
    const hi = f2.z + w / 2;
    return f2.z > 0
      ? [[0, l.z0], [l.x1, l.z0], [l.x1, l.z1], [x2, hi], [x2, lo], [0, lo]]
      : [[x2, lo], [l.x1, lo], [l.x1, l.z1], [0, l.z1], [0, hi], [x2, hi]];
  }
  // L: flight 1 + landing, plus flight 2 going sideways.
  const len2 = f2.treads * g;
  if (f2.dz < 0) {
    return [
      [0, -w / 2],
      [l.x0, -w / 2],
      [l.x0, -w / 2 - len2],
      [l.x1, -w / 2 - len2],
      [l.x1, w / 2],
      [0, w / 2],
    ];
  }
  return [
    [0, -w / 2],
    [l.x1, -w / 2],
    [l.x1, w / 2 + len2],
    [l.x0, w / 2 + len2],
    [l.x0, w / 2],
    [0, w / 2],
  ];
}

/** Height of a balustrade's top rail above the pitch line of a flight and above a landing (m). */
export const GUARD_HEIGHT = 0.9;
/** How far outside the stair's edge the balustrade's centre plane stands (m): the flights keep their full width. */
export const GUARD_OFFSET = 0.025;
/** Half the thickness of a balustrade's collider (m): it fills 5 mm to 45 mm outside the edge. */
export const GUARD_HALF = 0.02;
/**
 * Where the balustrade of a flight that starts from a floor begins, from the first riser (m): the first treads stay
 * open at the sides, so a stair along a wall can still be stepped onto beside them (stair-fit's side landing reaches
 * 0.6 m along the flight). The drop there is under half a metre.
 */
export const GUARD_START = 0.7;
/** How far the balustrade reaches below the pitch line (the string it is fixed to, m). */
const GUARD_BELOW = 0.12;

/**
 * One side of a flight or landing that may need a balustrade, in the stair's local frame: the edge from `a` to `b`
 * with the pitch-line (walking surface) heights `ya`, `yb` at its ends and its outward unit normal. A flight's side
 * also names its flight and which side it is (+1 toward the flight's local +Z, its right facing up the flight; −1 its left).
 */
export interface StairGuardPiece {
  a: P2;
  b: P2;
  ya: number;
  yb: number;
  out: P2;
  flight: number | null;
  side: 1 | -1;
  /** Under the floor above when built (outside the stairwell): kept below its soffit. False in a U stair's central gap. */
  underSlab: boolean;
  /**
   * How each end meets the next piece: round an outside corner (the balustrade runs on round it), into an inside
   * corner (it stops at the other one's plane), straight on along the same line, or not at all.
   */
  joinA: GuardJoin;
  joinB: GuardJoin;
}

/** How a balustrade piece's end meets its neighbour (see {@link StairGuardPiece}). */
export type GuardJoin = 'outside' | 'inside' | 'straight' | 'none';

/**
 * The sides of the flights and landings a balustrade may stand on, in a fixed order for each shape (the order of
 * `StairParams.guards`). Straight: the flight's two sides. L: the first flight's outer side, the landing's outer side
 * and end, the second flight's outer side, then the two inner sides of the turn. U: the first flight's outer side, the
 * landing's three open edges, the return flight's outer side, then the inner sides of both flights along the gap
 * (only when the gap leaves room for both balustrades).
 */
export function stairGuardPieces(p: StairParams): StairGuardPiece[] {
  const { flights, landings, riser } = stairLayout(p);
  const g = p.going;
  const w = p.width;
  const hw = w / 2;
  const slope = riser / g;
  const f1 = flights[0] as Flight;
  // Pitch line of a flight at distance s along it: through the nosings, landing on the floor or landing above.
  const pitch = (f: Flight, s: number): number => Math.min(f.y0 + (f.treads + 1) * riser, f.y0 + riser + s * slope);
  const start = (f: Flight): number => (f.y0 > 0.01 ? 0 : Math.min(GUARD_START, f.treads * g * 0.5));
  const sideOf = (f: Flight, out: P2): 1 | -1 => (out[0] * -f.dz + out[1] * f.dx >= 0 ? 1 : -1);
  const flightSide = (fi: number, t: number, out: P2, joinB: GuardJoin, underSlab = true): StairGuardPiece => {
    const f = flights[fi] as Flight;
    const s0 = start(f);
    const run = f.treads * g;
    const px = -f.dz * t;
    const pz = f.dx * t;
    return {
      a: [f.x + f.dx * s0 + px, f.z + f.dz * s0 + pz],
      b: [f.x + f.dx * run + px, f.z + f.dz * run + pz],
      ya: pitch(f, s0),
      yb: pitch(f, run),
      out,
      flight: fi,
      side: sideOf(f, out),
      underSlab,
      joinA: 'none',
      joinB,
    };
  };
  const flat = (a: P2, b: P2, y: number, out: P2, joinA: GuardJoin, joinB: GuardJoin): StairGuardPiece => ({ a, b, ya: y, yb: y, out, flight: null, side: 1, underSlab: true, joinA, joinB });
  const l = landings[0];
  const f2 = flights[1];
  if (!l || !f2 || f1.treads <= 0) {
    if (f1.treads <= 0) return [];
    return [flightSide(0, hw, [0, 1], 'none'), flightSide(0, -hw, [0, -1], 'none')];
  }
  const s = p.turn === 'left' ? -1 : 1;
  const run2 = f2.treads * g;
  const lx0 = l.x0;
  const lx1 = l.x1;
  if (p.shape === 'l') {
    const outer = flightSide(0, -s * hw, [0, -s], 'straight');
    const inner = flightSide(0, s * hw, [0, s], f2.treads > 0 ? 'inside' : 'none');
    // Flight 2 climbs along (0, s) from the landing's side; its outer side is x = lx1, its inner side x = lx0.
    const f2Outer: StairGuardPiece = { a: [lx1, s * hw], b: [lx1, s * (hw + run2)], ya: l.y, yb: pitch(f2, run2), out: [1, 0], flight: 1, side: sideOf(f2, [1, 0]), underSlab: true, joinA: 'outside', joinB: 'none' };
    const f2Inner: StairGuardPiece = { a: [lx0, s * hw], b: [lx0, s * (hw + run2)], ya: l.y, yb: pitch(f2, run2), out: [-1, 0], flight: 1, side: sideOf(f2, [-1, 0]), underSlab: true, joinA: 'inside', joinB: 'none' };
    const side = flat([lx0, -s * hw], [lx1, -s * hw], l.y, [0, -s], 'straight', 'outside');
    if (f2.treads <= 0) return [outer, side, flat([lx1, -s * hw], [lx1, s * hw], l.y, [1, 0], 'outside', 'none'), inner];
    return [outer, side, flat([lx1, -s * hw], [lx1, s * hw], l.y, [1, 0], 'outside', 'outside'), f2Outer, inner, f2Inner];
  }
  // U: the return flight runs along −X at z = off, a gap away from the first.
  const off = f2.z;
  const x2 = lx0 - run2;
  const pieces: StairGuardPiece[] = [
    flightSide(0, -s * hw, [0, -s], 'straight'),
    flat([lx0, -s * hw], [lx1, -s * hw], l.y, [0, -s], 'straight', 'outside'),
    flat([lx1, -s * hw], [lx1, off + s * hw], l.y, [1, 0], 'outside', 'outside'),
    flat([lx1, off + s * hw], [lx0, off + s * hw], l.y, [0, s], 'outside', f2.treads > 0 ? 'straight' : 'none'),
  ];
  if (f2.treads > 0) pieces.push({ a: [lx0, off + s * hw], b: [x2, off + s * hw], ya: l.y, yb: pitch(f2, run2), out: [0, s], flight: 1, side: sideOf(f2, [0, s]), underSlab: true, joinA: 'straight', joinB: 'none' });
  // Along the gap both balustrades fit side by side only when it is wider than their two colliders.
  if (p.gap >= 2 * (GUARD_OFFSET + GUARD_HALF)) {
    pieces.push(flightSide(0, s * hw, [0, s], 'none', false));
    if (f2.treads > 0) pieces.push({ a: [lx0, off - s * hw], b: [x2, off - s * hw], ya: l.y, yb: pitch(f2, run2), out: [0, -s], flight: 1, side: sideOf(f2, [0, -s]), underSlab: false, joinA: 'none', joinB: 'none' });
  }
  return pieces;
}

/** A balustrade piece laid out along its own frame: u along it, y up. */
interface GuardFrame {
  /** Start of the centre line (offset outward and extended round joined corners), unit direction, length. */
  x: number;
  z: number;
  dx: number;
  dz: number;
  len: number;
  /** Breakpoints along u (sorted) with the rail top and the bottom there. */
  u: number[];
  top: number[];
  bottom: number[];
}

/** Lay out a piece as built (offset, extended at corners, kept under the soffit). */
function guardFrame(pc: StairGuardPiece, soffit: number): GuardFrame | null {
  const ex = pc.b[0] - pc.a[0];
  const ez = pc.b[1] - pc.a[1];
  const l = Math.hypot(ex, ez);
  if (l < 0.05) return null;
  const dx = ex / l;
  const dz = ez / l;
  const below = pc.flight === null ? 0.25 : GUARD_BELOW;
  const cap = pc.underSlab ? soffit - 0.02 : Infinity;
  // Where the flight's string would rise into the floor above, the balustrade ends: the slab's edge guards from there.
  // In a U's central gap it ends at the same height (the stairwell railing upstairs takes over), so it never stands
  // up beside the top step where people step off.
  const tEnd = pc.yb > pc.ya ? (soffit - 0.08 + below - pc.ya) / (pc.yb - pc.ya) : 1;
  if (tEnd <= 0.05) return null;
  const cut = tEnd < 1;
  const l2 = cut ? l * tEnd : l;
  const ext = (j: GuardJoin): number => (j === 'outside' ? GUARD_OFFSET + GUARD_HALF : j === 'inside' ? -(GUARD_OFFSET - GUARD_HALF) : 0);
  const extA = ext(pc.joinA);
  const extB = cut ? 0 : ext(pc.joinB);
  const len = l2 + extA + extB;
  const x = pc.a[0] + pc.out[0] * GUARD_OFFSET - dx * extA;
  const z = pc.a[1] + pc.out[1] * GUARD_OFFSET - dz * extA;
  const pitchAt = (u: number): number => pc.ya + (pc.yb - pc.ya) * Math.min(1, Math.max(0, (u - extA) / l));
  const us = [0, Math.max(0, extA), Math.min(len, extA + l2), len];
  // Where the rail meets the soffit (the pitch rises through cap − height), a kink.
  if (pc.yb !== pc.ya) {
    const t = (cap - GUARD_HEIGHT - pc.ya) / (pc.yb - pc.ya);
    if (t > 0 && t < tEnd) us.push(extA + t * l);
  }
  const u = [...new Set(us.map((v) => Math.round(v * 1e4) / 1e4))].filter((v) => v >= 0 && v <= len).sort((a, b) => a - b);
  const bottom = u.map((v) => pitchAt(v) - below);
  const top = u.map((v, i) => Math.max((bottom[i] as number) + 0.04, Math.min(pitchAt(v) + GUARD_HEIGHT, cap)));
  return { x, z, dx, dz, len, u, top, bottom };
}

/** Interpolate a breakpoint series at u. */
function at(f: GuardFrame, ys: readonly number[], u: number): number {
  const us = f.u;
  if (u <= (us[0] as number)) return ys[0] as number;
  for (let i = 0; i + 1 < us.length; i++) {
    const u0 = us[i] as number;
    const u1 = us[i + 1] as number;
    if (u <= u1) return (ys[i] as number) + ((ys[i + 1] as number) - (ys[i] as number)) * ((u - u0) / Math.max(1e-9, u1 - u0));
  }
  return ys[ys.length - 1] as number;
}

/** Profile (u, y) between two breakpoint series offset by `lo`/`hi`, from u0 to u1. */
function bandProfile(f: GuardFrame, u0: number, u1: number, lo: (u: number) => number, hi: (u: number) => number): P2[] {
  const us = [u0, ...f.u.filter((v) => v > u0 + 1e-4 && v < u1 - 1e-4), u1];
  const bottom = us.map((u) => [u, lo(u)] as P2);
  const top = us.map((u) => [u, hi(u)] as P2).reverse();
  return [...bottom, ...top];
}

/** Geometry of one balustrade in its frame (u along +X, symmetric about its centre plane z = 0), by style. */
function guardGeometry(f: GuardFrame, p: StairParams, glass: Geom, metal: Geom, timber: Geom, painted: Geom): void {
  const top = (u: number): number => at(f, f.top, u);
  const bottom = (u: number): number => at(f, f.bottom, u);
  const len = f.len;
  const local = { glass: new Geom(), metal: new Geom(), timber: new Geom(), painted: new Geom() };
  const railPath = (dy: number): Array<[number, number, number]> => f.u.map((u, i) => [u, (f.top[i] as number) + dy, 0]);
  if (p.balustrade === 'glass') {
    // Frameless toughened glass in panels up to 1.2 m with 10 mm joints, a slim steel cap rail on top.
    const n = Math.max(1, Math.ceil(len / 1.2));
    for (let k = 0; k < n; k++) {
      const u0 = (len * k) / n + (k > 0 ? 0.005 : 0);
      const u1 = (len * (k + 1)) / n - (k < n - 1 ? 0.005 : 0);
      local.glass.merge(extrudeProfile(bandProfile(f, u0, u1, (u) => bottom(u) + 0.04, (u) => top(u) - 0.03), -0.006, 0.006));
    }
    local.metal.merge(tube(railPath(-0.012), 0.02, 10));
    // The base shoe the panels stand in: a slim steel channel along the stair's edge.
    local.metal.merge(extrudeProfile(bandProfile(f, 0, len, bottom, (u) => bottom(u) + 0.07), -0.02, 0.02));
  } else if (p.balustrade === 'steel') {
    // A round top rail, a lower rail and vertical bars less than 0.1 m apart, newel posts at the ends.
    local.metal.merge(tube(railPath(-0.02), 0.022, 10));
    const lowY = (u: number): number => bottom(u) + 0.1;
    local.metal.merge(tube(f.u.map((u) => [u, lowY(u), 0] as [number, number, number]), 0.011, 8));
    const bars = Math.max(1, Math.ceil(len / 0.105));
    for (let k = 1; k < bars; k++) {
      const u = (len * k) / bars;
      const y0 = lowY(u);
      const y1 = top(u) - 0.03;
      if (y1 - y0 > 0.05) local.metal.merge(cylinder(0.008, 0.008, y1 - y0, 6, { bottom: false, top: false }).translate(u, y0, 0));
    }
    for (const u of [0.02, len - 0.02]) local.metal.merge(cylinder(0.022, 0.022, Math.max(0.1, top(u) - bottom(u)), 10, { bottom: false }).translate(u, bottom(u), 0));
    // A flat steel string under the treads' edge.
    local.metal.merge(extrudeProfile(bandProfile(f, 0, len, bottom, (u) => bottom(u) + 0.06), -0.006, 0.006));
  } else {
    // Timber: a closed string and square spindles painted like the stair, a waxed handrail and newel posts at the ends.
    local.painted.merge(extrudeProfile(bandProfile(f, 0, len, bottom, (u) => bottom(u) + 0.18), -0.016, 0.016));
    local.timber.merge(extrudeProfile(bandProfile(f, 0, len, (u) => top(u) - 0.055, top), -0.033, 0.033));
    const spindles = Math.max(1, Math.ceil(len / 0.12));
    for (let k = 1; k < spindles; k++) {
      const u = (len * k) / spindles;
      const y0 = bottom(u) + 0.18;
      const y1 = top(u) - 0.055;
      if (y1 - y0 > 0.05) local.painted.merge(box(u - 0.016, y0, -0.016, u + 0.016, y1, 0.016));
    }
    for (const u of [0.045, len - 0.045]) local.timber.merge(box(u - 0.045, bottom(u), -0.045, u + 0.045, top(u) + 0.06, 0.045));
  }
  const yaw = (Math.atan2(-f.dz, f.dx) * 180) / Math.PI;
  // Built about the centre plane (z = 0), so no flip is needed for the outward side.
  for (const [g, into] of [[local.glass, glass], [local.metal, metal], [local.timber, timber], [local.painted, painted]] as const) into.merge(g.rotateY(yaw).translate(f.x, 0, f.z));
}

/** Longest stretch one balustrade collider box covers along a slope (m): about a tread. */
const GUARD_BOX_STEP = 0.3;

/**
 * Colliders of one balustrade, {@link GUARD_HALF} either side of its plane: upright boxes, each as long as about a
 * tread and as tall as the balustrade over it (a stepped wall along a flight, one box along a landing). A thin sloped
 * hull (or a pitched box) along the whole flight held the character controller back at the step onto the landing
 * when the player pressed against it; upright faces slide like a wall.
 */
function guardCollider(f: GuardFrame, set: PartSet): void {
  const yaw = (Math.atan2(-f.dz, f.dx) * 180) / Math.PI;
  const len = f.len;
  for (let i = 0; i + 1 < f.u.length; i++) {
    const u0 = f.u[i] as number;
    const u1 = f.u[i + 1] as number;
    if (u1 - u0 < 1e-3) continue;
    const flat = Math.abs((f.bottom[i + 1] as number) - (f.bottom[i] as number)) < 1e-4 && Math.abs((f.top[i + 1] as number) - (f.top[i] as number)) < 1e-4;
    const n = flat ? 1 : Math.max(1, Math.ceil((u1 - u0) / GUARD_BOX_STEP));
    for (let k = 0; k < n; k++) {
      const a = u0 + ((u1 - u0) * k) / n;
      const b = u0 + ((u1 - u0) * (k + 1)) / n;
      const lo = Math.min(at(f, f.bottom, a), at(f, f.bottom, b));
      const hi = Math.max(at(f, f.top, a), at(f, f.top, b));
      const um = (a + b) / 2;
      set.box([f.x + f.dx * um, (lo + hi) / 2, f.z + f.dz * um], [(b - a) / 2, (hi - lo) / 2, GUARD_HALF], [0, yaw, 0]);
    }
  }
  void len;
}

/** Plan outline of each built balustrade (local frame, a thin rectangle round its collider), for navigation checks. */
export function stairGuardOutlines(p: StairParams): P2[][] {
  if (!p.guards) return [];
  const soffit = p.soffit ?? p.rise - 0.22;
  const out: P2[][] = [];
  stairGuardPieces(p).forEach((pc, k) => {
    if (p.guards?.[k] !== true) return;
    const f = guardFrame(pc, soffit);
    if (!f) return;
    const nx = -f.dz * GUARD_HALF;
    const nz = f.dx * GUARD_HALF;
    const ex = f.x + f.dx * f.len;
    const ez = f.z + f.dz * f.len;
    out.push([[f.x - nx, f.z - nz], [ex - nx, ez - nz], [ex + nx, ez + nz], [f.x + nx, f.z + nz]]);
  });
  return out;
}

/** Build one flight's structure and treads into the geometry sets. */
function buildFlight(f: Flight, p: StairParams, riser: number, structure: Geom, treads: Geom, set: PartSet): void {
  if (f.treads <= 0) return;
  const g = p.going;
  const w = p.width;
  const n = f.treads;
  // Side profile in (s, y): sawtooth top and a sloped soffit.
  const profile: P2[] = [[0, f.y0]];
  for (let i = 0; i < n; i++) {
    const y = f.y0 + (i + 1) * riser - TREAD;
    profile.push([i * g, y], [(i + 1) * g, y]);
  }
  const run = n * g;
  const yTop = f.y0 + n * riser - TREAD;
  const slope = (n * riser) / Math.max(1e-3, run);
  const waist = WAIST * Math.sqrt(1 + slope * slope);
  profile.push([run, Math.max(f.y0, yTop - waist)]);
  if (f.y0 > 0.01) profile.push([0, Math.max(0, f.y0 - waist)]);
  // Extrude across the width: the profile lies in (s, y), the width runs along Z.
  const hw = w / 2;
  const local = extrudeProfile(profile, -hw, hw);
  // Treads with a small nosing.
  const tr = new Geom();
  for (let i = 0; i < n; i++) {
    const y = f.y0 + (i + 1) * riser;
    tr.merge(box(i * g - NOSING, y - TREAD, -hw, (i + 1) * g, y, hw));
  }
  // Orient the flight: local +X → (dx, dz).
  const yaw = (Math.atan2(-f.dz, f.dx) * 180) / Math.PI;
  for (const geom of [local, tr]) geom.rotateY(yaw).translate(f.x, 0, f.z);
  structure.merge(local);
  treads.merge(tr);
  // Ramp collider along the nosing line.
  const pts: number[] = [];
  const corners: Array<[number, number, number]> = [
    [0, f.y0, -hw],
    [0, f.y0, hw],
    [run, f.y0 + n * riser, -hw],
    [run, f.y0 + n * riser, hw],
    [run, Math.max(f.y0, f.y0 + n * riser - 0.3), -hw],
    [run, Math.max(f.y0, f.y0 + n * riser - 0.3), hw],
  ];
  for (const [s, y, t] of corners) {
    const r = rotate(s, t, yaw);
    pts.push(f.x + r[0], y, f.z + r[1]);
  }
  set.hull(pts);
  // The last riser up onto the landing or floor above is a step the ramp leaves (it runs under the nosings). Over the
  // last treads a steeper wedge closes it, kept under 40° so nobody slides down it: a character pressed against a
  // balustrade or wall there otherwise failed to step up and stood still.
  const k = Math.min(n, ARRIVAL_WEDGE_TREADS);
  if (k >= 1) {
    const s0 = run - k * g;
    const yTop = f.y0 + (n + 1) * riser;
    const w2: number[] = [];
    for (const [sv, y] of [[s0, f.y0 + (n - k) * riser], [run, yTop], [run, yTop - 0.3]] as const) {
      for (const t of [-hw, hw]) {
        const r = rotate(sv, t, yaw);
        w2.push(f.x + r[0], y, f.z + r[1]);
      }
    }
    set.hull(w2);
  }
}

/** Treads over which a flight's collider climbs onto the landing or floor at its top (see buildFlight). */
const ARRIVAL_WEDGE_TREADS = 4;

/**
 * A side profile in (s, y) extruded along Z from `z0` to `z1`: both faces and the bands round its outline, facing
 * out of it. Flights are built this way across their width, balustrade panels and strings across their thickness.
 */
function extrudeProfile(profile: readonly P2[], z0: number, z1: number): Geom {
  const local = new Geom();
  const face = (pts: readonly P2[], t: number, facing: 1 | -1): void => {
    const tmp = new Geom().flatPolygon(pts, 0, facing > 0);
    // flatPolygon lays (s, y) on (x, z) facing ±Y: swap y and z to stand it up at z = t.
    for (let k = 0; k < tmp.p.length; k += 3) {
      const sv = tmp.p[k] as number;
      const yv = tmp.p[k + 2] as number;
      tmp.p[k + 1] = yv;
      tmp.p[k + 2] = t;
      tmp.n[k] = 0;
      tmp.n[k + 1] = 0;
      tmp.n[k + 2] = facing;
      tmp.uv[(k / 3) * 2] = sv;
      tmp.uv[(k / 3) * 2 + 1] = yv;
    }
    // The y/z swap is a mirror: restore front-facing winding.
    tmp.flip();
    local.merge(tmp);
  };
  face(profile, z1, 1);
  face(profile, z0, -1);
  // Bands across the width (risers, tread beds, soffit), facing out of the profile.
  const ccw = profileArea(profile) > 0;
  for (let k = 0; k < profile.length; k++) {
    const a = profile[k] as P2;
    const b = profile[(k + 1) % profile.length] as P2;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-5) continue;
    const q0 = [a[0], a[1], z0];
    const q1 = [b[0], b[1], z0];
    const q2 = [b[0], b[1], z1];
    const q3 = [a[0], a[1], z1];
    // (q0, q1, q2, q3) faces the right-hand normal of a→b, which is outward for a counter-clockwise profile.
    if (ccw) local.quadAuto(q0, q1, q2, q3);
    else local.quadAuto(q3, q2, q1, q0);
  }
  return local;
}

function profileArea(profile: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < profile.length; i++) {
    const p = profile[i] as P2;
    const q = profile[(i + 1) % profile.length] as P2;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function rotate(x: number, z: number, yawDeg: number): P2 {
  const t = (yawDeg * Math.PI) / 180;
  return [x * Math.cos(t) + z * Math.sin(t), -x * Math.sin(t) + z * Math.cos(t)];
}

/** Build a stair (see the module docs). */
export function buildStair(p: StairParams): ArchOutput {
  const set = new PartSet();
  const { flights, landings, riser } = stairLayout(p);
  const structure = new Geom();
  const treads = new Geom();
  for (const f of flights) buildFlight(f, p, riser, structure, treads, set);
  for (const l of landings) {
    structure.merge(box(l.x0, Math.max(0, l.y - WAIST - TREAD), l.z0, l.x1, l.y - TREAD, l.z1));
    treads.merge(box(l.x0, l.y - TREAD, l.z0, l.x1, l.y, l.z1));
    set.boxMinMax(l.x0, l.y - 0.2, l.z0, l.x1, l.y, l.z1);
  }
  set.add(structure, p.structure).add(treads, p.finish);
  // Balustrades on the open sides (each with its collider); the sides against a wall get a wall handrail.
  const wallRail: Array<Set<number>> = flights.map(() => new Set<number>());
  if (p.guards) {
    const soffit = p.soffit ?? p.rise - 0.22;
    const glass = new Geom();
    const metal = new Geom();
    const timber = new Geom();
    const painted = new Geom();
    stairGuardPieces(p).forEach((pc, k) => {
      if (p.guards?.[k] !== true) {
        if (pc.flight !== null) wallRail[pc.flight]?.add(pc.side);
        return;
      }
      const f = guardFrame(pc, soffit);
      if (!f) return;
      guardGeometry(f, p, glass, metal, timber, painted);
      guardCollider(f, set);
    });
    set.add(glass, { finish: 'glass' }).add(metal, p.railMaterial).add(timber, { finish: p.finish.finish === 'walnut' ? 'walnut' : 'oak' }).add(painted, p.structure);
  } else if (p.rail !== 'none') {
    for (const set2 of wallRail) {
      if (p.rail === 'left' || p.rail === 'both') set2.add(-1);
      if (p.rail === 'right' || p.rail === 'both') set2.add(1);
    }
  }
  // Wall handrails: sloped tube at 0.9 m above the nosing line, with posts.
  if (wallRail.some((r) => r.size > 0)) {
    const rails = new Geom();
    for (const [fi, f] of flights.entries()) {
      if (f.treads <= 0) continue;
      const run = f.treads * p.going;
      const yaw = (Math.atan2(-f.dz, f.dx) * 180) / Math.PI;
      const sides = [...(wallRail[fi] ?? [])].sort((a, b) => a - b);
      for (const side of sides) {
        // Beside a wall (balustraded stairs) the rail is held off the wall on brackets; otherwise it stands on posts.
        const onWall = p.guards !== undefined;
        const t = side * (p.width / 2 - (onWall ? 0.07 : 0.05));
        const h0 = f.y0 + riser + 0.9;
        const h1 = f.y0 + (f.treads + 1) * riser + 0.9;
        const r = new Geom().merge(tube([[0, h0, t], [run, h1, t]], 0.022, 10));
        const posts = Math.max(2, Math.round(run / 1.1) + 1);
        for (let k = 0; k < posts; k++) {
          const s = (run * k) / (posts - 1);
          const base = f.y0 + Math.min(f.treads, Math.floor(s / p.going) + 1) * riser;
          const top = h0 + ((h1 - h0) * s) / Math.max(1e-3, run);
          const u = Math.min(run - 0.03, Math.max(0.03, s));
          if (onWall) {
            const z0 = Math.min(t, side * p.width / 2);
            const z1 = Math.max(t, side * p.width / 2);
            r.merge(box(u - 0.01, top - 0.05, z0, u + 0.01, top - 0.03, z1));
          } else r.merge(cylinder(0.012, 0.012, Math.max(0.1, top - base), 8, { bottom: false }).translate(u, base, t));
        }
        rails.merge(r.rotateY(yaw).translate(f.x, 0, f.z));
      }
    }
    set.add(rails, p.railMaterial);
  }
  return set.build();
}
