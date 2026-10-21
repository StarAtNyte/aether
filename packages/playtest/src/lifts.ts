/**
 * Lifts: platforms that patrol straight up and down. The bot reads the patrol (waypoints, speed, pause, mode) into
 * a clock that says where the deck is at any moment and how long it stays within reach of a stop, plans on that
 * (when a boarding is possible at all, what it costs in waiting) and rides it by the clock: wait at the boarding
 * point until the deck is level and will stay so long enough to cross, step on at the centre, stand still, step
 * off at the destination when level. A lift that cannot be used (gap too wide, cycle too fast, never reaching the
 * stop) is reported with the reason instead of being tried until the clock runs out.
 */
import type { Vec3 } from '@aether/core';
import type { Aabb, PhysicsWorld } from '@aether/physics';
import { jumpReach, type NavGraph, type NavParams } from './nav';

/**
 * The widest gap the player runs across without jumping: the capsule carries on at running speed while it drops, and
 * lands on the far edge as long as it has dropped less than about half its radius by then (a wider run is marginal when the deck moves). Wider gaps are jumped.
 */
export function runGap(p: NavParams): number {
  const r = 0.28;
  return Math.min(1.5, Math.max(0.4, 0.6 * r + Math.max(1, p.speed) * Math.sqrt((2 * 0.6 * r) / p.gravity)));
}

/** The deck may be this far below the ground at the boarding point (a short drop) ... */
export const BOARD_BELOW = 0.7;
/** ... or this far above it (a low step), when it rests there at its lowest stop; moving, it must not be above the ground by more than 0.2. */
export const BOARD_ABOVE = 0.4;

/** The band of deck heights from which the player can get on at ground height `boardY`. */
export function boardBand(clock: LiftClock, boardY: number): { lo: number; hi: number } {
  const resting = clock.low > boardY + 0.2 && clock.low <= boardY + BOARD_ABOVE;
  return { lo: boardY - BOARD_BELOW, hi: resting ? clock.low + 0.05 : boardY + 0.2 };
}
/** Same for the destination: the deck at its highest may be this far below the landing (a hop up) ... */
export const EXIT_BELOW = 0.45;
/** ... or this far above it (a short drop onto the landing). */
export const EXIT_ABOVE = 0.7;

/** How a patrol repeats. */
type PatrolMode = 'loop' | 'pingpong' | 'once';

/** One leg of the patrol: pause at a waypoint, then travel to the next. */
interface Leg {
  /** Deck top height while pausing. */
  y0: number;
  /** Deck top height at the end of the travel. */
  y1: number;
  /** Pause (s). */
  dwell: number;
  /** Travel (s). */
  travel: number;
}

/** A span of time (s). */
export interface Span {
  a: number;
  b: number;
}

/** Where the deck of a patrolling platform is, when. */
export class LiftClock {
  readonly legs: readonly Leg[];
  /** Seconds in one full cycle; Infinity when the patrol ends ('once'). */
  readonly period: number;
  /** Offset of the world clock to the patrol's own (s), set by {@link sync}. */
  offset = 0;
  /** The highest and lowest deck top. */
  readonly low: number;
  readonly high: number;
  /** Deck top heights the patrol pauses at, lowest first. */
  readonly stops: readonly number[];
  /** The fastest the deck moves (m/s). */
  readonly maxRate: number;

  /**
   * `tops` are the deck's top heights at the waypoints in order, `lengths` the distances between consecutive
   * waypoints (n - 1), `speed` m/s, `wait` s at each waypoint.
   */
  constructor(tops: readonly number[], lengths: readonly number[], speed: number, wait: number, readonly mode: PatrolMode) {
    const n = tops.length;
    const order: number[] = [];
    for (let i = 0; i < n; i++) order.push(i);
    if (mode === 'pingpong') for (let i = n - 2; i >= 1; i--) order.push(i);
    const legs: Leg[] = [];
    const dist = (i: number, j: number): number => {
      if (Math.abs(i - j) === 1) return lengths[Math.min(i, j)] as number;
      // Loop mode closes the route straight from the last waypoint to the first.
      return Math.abs((tops[i] as number) - (tops[j] as number));
    };
    for (let k = 0; k < order.length; k++) {
      const i = order[k] as number;
      const last = k === order.length - 1;
      if (last && mode === 'once') {
        legs.push({ y0: tops[i] as number, y1: tops[i] as number, dwell: Infinity, travel: 0 });
        break;
      }
      const j = last ? 0 : (order[k + 1] as number);
      legs.push({ y0: tops[i] as number, y1: tops[j] as number, dwell: wait, travel: dist(i, j) / speed });
    }
    this.legs = legs;
    this.period = legs.reduce((s, l) => s + l.dwell + l.travel, 0);
    this.maxRate = legs.reduce((m, l) => (l.travel > 0 ? Math.max(m, Math.abs(l.y1 - l.y0) / l.travel) : m), 0);
    this.stops = [...new Set((tops as number[]).map((y) => Math.round(y * 20) / 20))].sort((a, b) => a - b);
    this.low = Math.min(...(tops as number[]));
    this.high = Math.max(...(tops as number[]));
  }

  /** Deck top at world time `t`. */
  topAt(t: number): number {
    let u = t + this.offset;
    if (Number.isFinite(this.period) && this.period > 0) u = u % this.period;
    if (u < 0) u += Number.isFinite(this.period) ? this.period : 0;
    for (const l of this.legs) {
      if (u <= l.dwell) return l.y0;
      u -= l.dwell;
      if (u <= l.travel) return l.y0 + ((l.y1 - l.y0) * u) / l.travel;
      u -= l.travel;
    }
    const lastLeg = this.legs[this.legs.length - 1] as Leg;
    return lastLeg.y1;
  }

  /**
   * The spans, from `from` to `to` (world time), in which the deck top is within [lo, hi]. Touching spans are
   * merged; a span that runs to `to` has b = `to`.
   */
  spans(lo: number, hi: number, from: number, to: number): Span[] {
    const out: Span[] = [];
    const add = (a: number, b: number): void => {
      const s = Math.max(a, from);
      const e = Math.min(b, to);
      if (e < s) return;
      const prev = out[out.length - 1];
      if (prev && s <= prev.b + 1e-6) prev.b = Math.max(prev.b, e);
      else out.push({ a: s, b: e });
    };
    // Cycle start times (patrol clock) covering the window.
    const finite = Number.isFinite(this.period) && this.period > 0;
    let cycle0 = finite ? Math.floor((from + this.offset) / this.period) * this.period - this.offset : -this.offset;
    if (!finite) cycle0 = -this.offset;
    for (let guard = 0; guard < 4096 && cycle0 <= to; guard++) {
      let t = cycle0;
      for (const l of this.legs) {
        // Pause at y0.
        const dEnd = t + l.dwell;
        if (l.y0 >= lo - 1e-9 && l.y0 <= hi + 1e-9) add(t, dEnd);
        t = dEnd;
        if (!Number.isFinite(t)) break;
        // Travel from y0 to y1, linearly.
        const tEnd = t + l.travel;
        if (l.travel > 0) {
          const dy = l.y1 - l.y0;
          let s = 0;
          let e = 1;
          if (Math.abs(dy) < 1e-12) {
            if (l.y0 < lo || l.y0 > hi) e = -1;
          } else {
            const f1 = (lo - l.y0) / dy;
            const f2 = (hi - l.y0) / dy;
            s = Math.max(0, Math.min(f1, f2));
            e = Math.min(1, Math.max(f1, f2));
          }
          if (e >= s) add(t + s * l.travel, t + e * l.travel);
        }
        t = tEnd;
        if (t > to) break;
      }
      if (!finite) break;
      cycle0 += this.period;
    }
    return out;
  }

  /** Seconds from `t` until the deck leaves [lo, hi]; 0 when it is outside now, Infinity when it never does. */
  stay(t: number, lo: number, hi: number): number {
    const horizon = Number.isFinite(this.period) ? this.period * 2 + 1 : 1e6;
    const sp = this.spans(lo, hi, t, t + horizon);
    const first = sp[0];
    if (!first || first.a > t + 1e-9) return 0;
    return first.b >= t + horizon - 1e-6 ? Infinity : first.b - t;
  }

  /** The longest stretch (s) the deck stays within [lo, hi] over a whole cycle (Infinity if it always does). */
  maxStay(lo: number, hi: number): number {
    if (!Number.isFinite(this.period)) {
      // One-way: from its last pause on, it stays.
      const sp = this.spans(lo, hi, 0, 1e6);
      let longest = 0;
      for (const sp1 of sp) longest = Math.max(longest, sp1.b >= 1e6 - 1e-3 ? Infinity : sp1.b - sp1.a);
      return longest;
    }
    const sp = this.spans(lo, hi, -this.offset, -this.offset + this.period * 3);
    let best = 0;
    for (const s of sp) best = Math.max(best, s.b - s.a);
    return best >= this.period * 3 - 1e-6 ? Infinity : best;
  }

  /**
   * Mean wait (s) for a span of at least `need` seconds within [lo, hi] to begin, for an arrival at a random time;
   * Infinity when there is none.
   */
  meanWait(lo: number, hi: number, need: number): number {
    if (!Number.isFinite(this.period)) {
      const sp = this.spans(lo, hi, 0, 1e6).filter((s) => s.b - s.a >= need);
      return sp.length > 0 ? (sp[0] as Span).a / 2 : Infinity;
    }
    const base = -this.offset;
    const sp = this.spans(lo, hi, base, base + this.period * 3).filter((s) => s.b - s.a >= need);
    const starts = sp.filter((s) => s.a >= base + this.period * 0.999 && s.a < base + this.period * 2.001);
    if (starts.length === 0) return Infinity;
    let sum = 0;
    let prevEnd = (sp.filter((s) => s.a < (starts[0] as Span).a).pop()?.b ?? (starts[0] as Span).a - this.period);
    for (const s of starts) {
      const gap = Math.max(0, s.a - prevEnd);
      sum += (gap * gap) / 2;
      prevEnd = s.b;
    }
    return sum / this.period;
  }

  /**
   * Line the clock up with what was seen: the deck top was `prev` one tick (`dt`) before `now`'s `cur`. Searches the
   * cycle for the phase that matches both; leaves the offset alone when none does.
   */
  sync(now: number, prev: number, cur: number, dt: number): boolean {
    if (!Number.isFinite(this.period)) return false;
    const keep = this.offset;
    let best = Infinity;
    let bestOffset = keep;
    const steps = Math.ceil(this.period / dt);
    for (let k = 0; k < steps; k++) {
      this.offset = k * dt - now;
      const e = Math.abs(this.topAt(now) - cur) + Math.abs(this.topAt(now - dt) - prev) * 0.5;
      // Among equal fits take the one nearest to the offset already believed.
      if (e < best - 1e-6 || (Math.abs(e - best) <= 1e-6 && this.dist(this.offset, keep) < this.dist(bestOffset, keep))) {
        best = e;
        bestOffset = this.offset;
      }
    }
    this.offset = best < 0.02 ? bestOffset : keep;
    return best < 0.02;
  }

  private dist(a: number, b: number): number {
    const d = Math.abs(a - b) % this.period;
    return Math.min(d, this.period - d);
  }
}

/** A lift read from the world: its deck, its patrol and the clock. */
export interface LiftModel {
  entity: string;
  /** Horizontal bounds of the deck. */
  bounds: Aabb;
  centre: [number, number];
  /** Deck top at the start. */
  topY: number;
  /** Deck centre height at the start (the top is `thickness / 2` above it). */
  startY: number;
  clock: LiftClock;
  speed: number;
  wait: number;
}

/** Read a patrol platform as a vertical lift; null when it is something else (moves sideways, does not move). */
export function readLift(entity: string, params: Readonly<Record<string, unknown>>, bounds: Aabb, startY: number): LiftModel | null {
  const wps = params['waypoints'];
  if (!Array.isArray(wps) || wps.length < 2 || wps.length > 16) return null;
  const pts: Vec3[] = [];
  for (const w of wps) {
    if (!Array.isArray(w) || w.length !== 3 || !w.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    pts.push([w[0] as number, w[1] as number, w[2] as number]);
  }
  const first = pts[0] as Vec3;
  const relative = params['relative'] === true;
  const offs = pts.map((p) => [p[0] - (relative ? 0 : first[0]), p[1] - (relative ? 0 : first[1]), p[2] - (relative ? 0 : first[2])] as Vec3);
  const o0 = offs[0] as Vec3;
  const lateral = Math.max(...offs.map((o) => Math.hypot(o[0] - o0[0], o[2] - o0[2])));
  const rise = Math.max(...offs.map((o) => o[1] - o0[1]));
  const fall = Math.max(...offs.map((o) => o0[1] - o[1]));
  if (lateral > 0.3 || Math.max(rise, fall) < 1) return null;
  const speed = typeof params['speed'] === 'number' ? (params['speed'] as number) : 2;
  const wait = typeof params['wait'] === 'number' ? (params['wait'] as number) : 0;
  const m = params['mode'];
  const mode: PatrolMode = m === 'pingpong' || m === 'once' ? m : 'loop';
  if (!(speed > 0) || wait < 0) return null;
  const topY = bounds.max[1];
  const tops = offs.map((o) => topY + o[1] - o0[1]);
  const lengths: number[] = [];
  for (let i = 0; i + 1 < offs.length; i++) lengths.push(Math.hypot((offs[i + 1] as Vec3)[0] - (offs[i] as Vec3)[0], (offs[i + 1] as Vec3)[1] - (offs[i] as Vec3)[1], (offs[i + 1] as Vec3)[2] - (offs[i] as Vec3)[2]));
  return {
    entity,
    bounds,
    centre: [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[2] + bounds.max[2]) / 2],
    topY,
    startY,
    clock: new LiftClock(tops, lengths, speed, wait, mode),
    speed,
    wait,
  };
}

/** What boarding and leaving a lift takes, measured on the map. */
export interface RideInfo {
  entity: string;
  /** Horizontal centre of the deck. */
  centre: [number, number];
  /** Height of the deck's centre at the start (its pose when the graph was built). */
  startY: number;
  /** How far the deck rises above its start pose (the span of the patrol). */
  dyUp: number;
  /** Deck top minus deck centre height. */
  topOffset: number;
  /** Horizontal half extents of the deck. */
  half: [number, number];
  clock: LiftClock;
  /** Height of the ground at the boarding node and at the landing. */
  boardY: number;
  exitY: number;
  /** Width of the gap to jump or walk over when boarding / leaving (m), and the support's edge from the node. */
  boardGap: number;
  boardEdge: number;
  /** Distance from the boarding node, along the way to the deck, at which the deck's edge begins. */
  boardEntry: number;
  exitGap: number;
  /** Seconds the deck must stay in its band for the crossing. */
  boardNeed: number;
  exitNeed: number;
}

/** Why a lift cannot be used. */
export interface LiftVerdict {
  entity: string;
  ok: boolean;
  reason: string;
}

/** Longest gap (m) the player can jump over onto a deck at the same height. */
export function maxJumpGap(p: NavParams): number {
  return Math.max(0, jumpReach(p, 0) * 0.8 - 0.55);
}

/** Seconds a jump on level ground stays in the air. */
export function flightTime(p: NavParams): number {
  return (2 * p.jumpSpeed) / p.gravity;
}

/**
 * Seconds the deck must stay level with the boarding ground for the player to get onto it across `gap` m: a run
 * over a narrow gap, or a jump that is in the air for its whole flight over a wide one (the deck must not move
 * into the player on the way).
 */
export function boardingNeed(gap: number, p: NavParams): number {
  if (gap <= runGap(p)) return (gap + 0.6) / Math.max(1, p.speed) + 0.1;
  return flightTime(p) + 0.4;
}

/** Seconds the deck must stay level with a landing for the player to jump off it. */
export function exitingNeed(climb: number): number {
  return 0.2 + (climb > 0.3 ? 0.1 : 0);
}

/**
 * Distance along the horizontal heading (dx, dz) from (x, z) over which there is ground at about `level`
 * (stopping at `limit`): the support's edge.
 */
export function supportRun(pw: PhysicsWorld, x: number, z: number, dx: number, dz: number, level: number, limit: number, exclude: string): number {
  const origin: Vec3 = [0, 0, 0];
  const down: Vec3 = [0, -1, 0];
  let run = 0;
  for (let s = 0; s <= limit + 1e-9; s += 0.05) {
    origin[0] = x + dx * s;
    origin[1] = level + 0.6;
    origin[2] = z + dz * s;
    const hit = pw.raycast(origin, down, 1.4, exclude);
    const ok = hit !== null && hit.point[1] >= level - 0.5 && hit.point[1] <= level + 0.4;
    if (!ok) return run;
    run = s;
  }
  return limit;
}

/** Distance along (dx, dz) from (x, z) to where the ray leaves the box (x, z inside it); 0 when outside. */
export function leaveBox(b: Aabb, x: number, z: number, dx: number, dz: number): number {
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (b.max[0] - x) / dx);
  else if (dx < -1e-9) t = Math.min(t, (b.min[0] - x) / dx);
  if (dz > 1e-9) t = Math.min(t, (b.max[2] - z) / dz);
  else if (dz < -1e-9) t = Math.min(t, (b.min[2] - z) / dz);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/** Distance along (dx, dz) from (x, z) (outside the box) to where the ray enters it; Infinity if it misses. */
export function enterBox(b: Aabb, x: number, z: number, dx: number, dz: number): number {
  let t0 = 0;
  let t1 = Infinity;
  for (const [o, d, lo, hi] of [[x, dx, b.min[0], b.max[0]], [z, dz, b.min[2], b.max[2]]] as const) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      const a = (lo - o) / d;
      const c = (hi - o) / d;
      t0 = Math.max(t0, Math.min(a, c));
      t1 = Math.min(t1, Math.max(a, c));
    }
  }
  return t0 <= t1 ? t0 : Infinity;
}

/** A ride edge found for a lift. */
export interface LiftRide {
  from: number;
  to: number;
  info: RideInfo;
  cost: number;
}

/** A boarding or landing node may be this far beyond the longest jumpable gap from the deck's edge (m). */
const NEAR_MARGIN = 1.5;

const r1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

/**
 * Work out, for one lift, which boarding and landing nodes of the map it joins and whether the player can use
 * it: ground level with its lowest stop on one side (a short drop or step at most), ground level with its highest
 * on the other, gaps the player can cross, and a stay at each stop long enough to cross. The reason is
 * written for the user when it cannot be used.
 */
export function wireLift(model: LiftModel, g: NavGraph, pw: PhysicsWorld, p: NavParams): { rides: LiftRide[]; verdict: LiftVerdict } {
  const { clock, bounds } = model;
  const [cx, cz] = model.centre;
  const NEAR = Math.max(0, jumpReach(p, 0) * 0.8 - 0.55) + NEAR_MARGIN;
  const low = clock.low;
  const high = clock.high;
  const half: [number, number] = [(bounds.max[0] - bounds.min[0]) / 2, (bounds.max[2] - bounds.min[2]) / 2];
  const dist = (x: number, z: number): number => Math.hypot(Math.max(bounds.min[0] - x, 0, x - bounds.max[0]), Math.max(bounds.min[2] - z, 0, z - bounds.max[2]));
  const boards: Array<number | undefined> = [undefined, undefined, undefined, undefined];
  // Landings: ground level with any stop above the lowest, nearest to the deck on each side.
  const exits = new Map<string, number>();
  const upper = clock.stops.filter((y) => y > low + 0.5);
  const score = (n: number): number => dist(g.px[n] as number, g.pz[n] as number) + 0.01 * Math.min(Math.abs((g.px[n] as number) - cx), Math.abs((g.pz[n] as number) - cz));
  // The nearest ground of any height, for the reason.
  let nearestOff = Infinity;
  let nearestAbove = true;
  let anyNear = false;
  for (let n = 0; n < g.count; n++) {
    const x = g.px[n] as number;
    const z = g.pz[n] as number;
    const d = dist(x, z);
    if (d <= 0 || d > NEAR) continue;
    const y = g.py[n] as number;
    anyNear = true;
    const sector = Math.abs(x - cx) / half[0] > Math.abs(z - cz) / half[1] ? (x > cx ? 0 : 1) : z > cz ? 2 : 3;
    if (y >= low - BOARD_ABOVE && y <= low + BOARD_BELOW) {
      const cur = boards[sector];
      if (cur === undefined || score(n) < score(cur)) boards[sector] = n;
    }
    for (let k = 0; k < upper.length; k++) {
      const stop = upper[k] as number;
      if (y < stop - EXIT_ABOVE || y > stop + EXIT_BELOW) continue;
      const key = `${k}:${sector}`;
      const cur = exits.get(key);
      if (cur === undefined || score(n) < score(cur)) exits.set(key, n);
    }
    const off = Math.min(Math.abs(y - low), Math.abs(y - high));
    if (off < nearestOff) {
      nearestOff = off;
      nearestAbove = y > high || (y > low && Math.abs(y - high) > Math.abs(y - low));
    }
  }
  const verdict = (reason: string): { rides: LiftRide[]; verdict: LiftVerdict } => ({ rides: [], verdict: { entity: model.entity, ok: false, reason } });
  const boardNodes = boards.filter((n): n is number => n !== undefined);
  const exitNodes = [...new Set(exits.values())];
  const near = (): string => (anyNear ? ` (the nearest ground is ${r1(nearestOff)} m ${nearestAbove ? 'above' : 'below'} it)` : ` (there is no ground within ${r1(NEAR)} m)`);
  if (boardNodes.length === 0) return verdict(`nothing to board from: no ground within ${r1(NEAR)} m of the lift is level with its lowest stop at ${r1(low)} m${near()}`);
  if (exitNodes.length === 0) return verdict(`the lift never reaches a landing: it tops out at ${r1(high)} m and no ground within ${r1(NEAR)} m of it is level with that${near()}`);

  const maxGap = (dy: number): number => Math.max(0, jumpReach(p, Math.max(0, dy)) * 0.8 - 0.55);
  const rides: LiftRide[] = [];
  const reasons: Array<{ rank: number; text: string }> = [];
  const topOffset = bounds.max[1] - model.startY;
  const info0 = { entity: model.entity, centre: model.centre, startY: model.startY, dyUp: high - low, topOffset, half, clock };
  for (const f of boardNodes) {
    const fx = g.px[f] as number;
    const fy = g.py[f] as number;
    const fz = g.pz[f] as number;
    const dl = Math.hypot(cx - fx, cz - fz) || 1;
    const ux = (cx - fx) / dl;
    const uz = (cz - fz) / dl;
    const entry = enterBox(bounds, fx, fz, ux, uz);
    if (!Number.isFinite(entry)) continue;
    const edge = supportRun(pw, fx, fz, ux, uz, fy, entry, model.entity);
    const boardGap = Math.max(0, entry - edge - 0.05);
    const boardNeed = boardingNeed(boardGap, p);
    const { lo: boardLo, hi: boardHi } = boardBand(clock, fy);
    if (boardGap > maxGap(0)) {
      reasons.push({ rank: 2, text: `the gap between the ground and the lift is ${r1(boardGap)} m, wider than the ${r1(maxGap(0))} m the player can jump` });
      continue;
    }
    const stay = clock.maxStay(boardLo, boardHi);
    if (stay < boardNeed) {
      reasons.push({ rank: 1, text: `the lift is level with the ground for only ${stay.toFixed(2)} s at a time but getting onto it across the ${r1(boardGap)} m gap needs ${boardNeed.toFixed(2)} s: it moves too fast and does not pause long enough (${model.speed} m/s, ${model.wait} s pause)` });
      continue;
    }
    for (const t of exitNodes) {
      if (t === f) continue;
      const tx = g.px[t] as number;
      const ty = g.py[t] as number;
      const tz = g.pz[t] as number;
      const el = Math.hypot(tx - cx, tz - cz) || 1;
      const vx = (tx - cx) / el;
      const vz = (tz - cz) / el;
      const leave = leaveBox(bounds, cx, cz, vx, vz);
      const run = supportRun(pw, tx, tz, -vx, -vz, ty, Math.max(0, el - leave), model.entity);
      const groundBegins = el - run;
      const exitGap = Math.max(0, groundBegins - leave - 0.05);
      const exitNeed = exitingNeed(ty - high);
      if (exitGap > maxGap(ty - high)) {
        reasons.push({ rank: 2, text: `the gap between the lift and the landing is ${r1(exitGap)} m, wider than the ${r1(maxGap(ty - high))} m the player can jump` });
        continue;
      }
      const exitStay = clock.maxStay(ty - EXIT_BELOW, ty + EXIT_ABOVE);
      if (exitStay < exitNeed) {
        reasons.push({ rank: 1, text: `the lift is level with the landing for only ${exitStay.toFixed(2)} s at a time but getting off across the ${r1(exitGap)} m gap needs ${exitNeed.toFixed(2)} s: it moves too fast and does not pause long enough (${model.speed} m/s, ${model.wait} s pause)` });
        continue;
      }
      const wait = clock.meanWait(boardLo, boardHi, boardNeed);
      const span = Math.hypot(tx - fx, tz - fz);
      const cost = Math.max(span, 2 + 1.5 * (Math.min(wait, 40) + (high - low) / model.speed));
      rides.push({ from: f, to: t, info: { ...info0, boardY: fy, exitY: ty, boardGap, boardEdge: edge, boardEntry: entry, exitGap, boardNeed, exitNeed }, cost });
    }
  }
  if (rides.length === 0) {
    reasons.sort((a, b) => a.rank - b.rank);
    return verdict(reasons[0]?.text ?? 'no way found to get on and off it');
  }
  return { rides, verdict: { entity: model.entity, ok: true, reason: '' } };
}
