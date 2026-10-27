/**
 * Spiral (helical) stairs: treads fanned round a vertical axis, a centre post or an open core, a balustrade on the
 * outer edge (and the inner one of an open stair) and a guard round the stairwell on the floor above.
 *
 * Plan frame: the axis is the entity's Y axis; a point at radius `r` and angle `a` is `(r cos a, r sin a)` in (x, z),
 * so the angle grows from +X toward +Z (clockwise seen from above). A `right` stair climbs with growing angle, a
 * `left` one against it. The stair has `n` risers: the first `n − 1` are treads (tread `k` is `(k + 1)` risers up and
 * spans `dθ` of angle), the last lands on the floor above, which fills the sector after the last tread.
 *
 * Everything the walkers need is derived from the same layout as the mesh: the stairwell outline, the walking line (a
 * path up the middle of the treads, ramping in from the floor and out onto the landing), the headroom, and the
 * colliders (one convex wedge per tread, the post, and boxes along the balustrades).
 */
import { Geom, box, cylinder, tube } from './mesh';
import { PartSet } from './parts';
import type { SpiralStairParams } from './params';
import type { ArchOutput } from './types';
import type { P2 } from './math2';
import { stairRisers } from './stair';

type V3 = [number, number, number];

/** Height of the balustrade's top rail above a tread (m). */
export const SPIRAL_GUARD_HEIGHT = 0.9;
/** Thickness of a tread (m). */
const TREAD = 0.045;
/** Clear height needed above a tread (m). */
export const SPIRAL_HEADROOM = 2.0;
/** Radius of the walking line, as a share of the tread's depth from the inner edge. */
const WALK_SHARE = 0.68;
/** Least width of the landing at the walking radius, so a body steps off the last tread onto floor (m). */
const LANDING_WIDTH = 1.0;
/** How far past the outer edge the walking line runs on the landing (m). */
const RUN_OUT = 0.5;

/** Resolved geometry of a spiral stair. */
export interface SpiralLayout {
  /** Risers (the last lands on the floor above) and the height of each. */
  n: number;
  riser: number;
  /** Angle of one riser (radians, positive) and the direction the angle grows (+1 right, −1 left). */
  dTheta: number;
  dir: 1 | -1;
  /** Angle of the first tread's leading edge (radians). */
  a0: number;
  /** Inner and outer radius of the treads. */
  inner: number;
  outer: number;
  /** Radius of the centre post or core. */
  post: number;
  /** Radius of the walking line. */
  walk: number;
  /** Angle of the landing sector on the floor above (radians, at least one riser's and a metre wide at the walking radius). */
  landing: number;
}

/** Layout of a spiral stair. */
export function spiralLayout(p: SpiralStairParams): SpiralLayout {
  const { count, riser } = stairRisers({ rise: p.rise, steps: p.steps });
  const n = Math.max(3, count);
  const post = p.postRadius ?? (p.core === 'solid' ? 0.08 : 0.05);
  const inner = Math.min(post, p.radius * 0.5);
  const dir = p.hand === 'right' ? 1 : -1;
  const walk = inner + WALK_SHARE * (p.radius - inner);
  const dTheta = (p.turns * 2 * Math.PI) / n;
  return { n, riser: p.rise / n, dTheta, dir, a0: (p.startAngle * Math.PI) / 180, inner, outer: p.radius, post: inner, walk, landing: Math.min(Math.PI / 2, Math.max(dTheta, LANDING_WIDTH / walk)) };
}

/** Angle of the leading edge of riser `k` (k = 0 is the first tread's). */
function angleAt(l: SpiralLayout, k: number): number {
  return l.a0 + l.dir * k * l.dTheta;
}

const at = (r: number, a: number): P2 => [r * Math.cos(a), r * Math.sin(a)];

/**
 * The stairwell outline in the floor above (plan, local frame): the disc of the stair without the sector the landing
 * occupies, as a pie shape from the axis. A polygon, ready for a slab's `holes`.
 */
export function spiralFootprint(p: SpiralStairParams): P2[] {
  const l = spiralLayout(p);
  // The landing floor is the sector after the last tread, `landing` wide; the well is the rest of the disc.
  const from = angleAt(l, l.n - 1) + l.dir * l.landing;
  const sweep = l.dir * (2 * Math.PI - l.landing);
  const arcs = Math.max(6, Math.ceil(Math.abs(sweep) / (Math.PI / 12)));
  const out: P2[] = [[0, 0]];
  for (let i = 0; i <= arcs; i++) out.push(at(p.radius + 0.02, from + (sweep * i) / arcs));
  return out;
}

/** The whole disc of the stair (plan), as a polygon: what the stair occupies on its own floor. */
export function spiralDisc(p: SpiralStairParams): P2[] {
  const out: P2[] = [];
  const m = 24;
  for (let i = 0; i < m; i++) out.push(at(p.radius + 0.02, (i / m) * 2 * Math.PI));
  return out;
}

/**
 * The walking line, bottom to top, in the local frame: feet positions `[x, y, z]` from the floor before the first
 * riser, over the middle of every tread, onto the landing and out across it to the floor beyond the guard.
 */
export function spiralWalkLine(p: SpiralStairParams): Array<[number, number, number]> {
  const l = spiralLayout(p);
  const line: Array<[number, number, number]> = [];
  const push = (r: number, a: number, y: number): void => {
    const q = at(r, a);
    line.push([q[0], y, q[1]]);
  };
  push(l.walk, angleAt(l, 0) - l.dir * l.dTheta * 0.9, 0);
  push(l.walk, angleAt(l, 0) - l.dir * l.dTheta * 0.1, 0);
  for (let k = 0; k < l.n - 1; k++) push(l.walk, angleAt(l, k + 0.5), (k + 1) * l.riser);
  const aLand = angleAt(l, l.n - 1) + (l.dir * l.landing) / 2;
  push(l.walk, aLand, p.rise);
  push(l.outer + RUN_OUT, aLand, p.rise);
  return line;
}

/** Thickness of the floor above the stair (m): what hangs under the landing sector. */
const FLOOR_ABOVE = 0.2;

/**
 * Least clear height over a tread (m) where the stair passes under itself or under the floor above: a stair of one turn
 * or less has none (infinite). Beyond a turn, the rise of a turn less a tread's thickness, and under the landing sector
 * of the floor above (which is wider than a step) the rise of a turn less the sector's width in risers and the floor.
 */
export function spiralHeadroom(p: SpiralStairParams): number {
  if (p.turns <= 1) return Infinity;
  const l = spiralLayout(p);
  const perTurn = (2 * Math.PI) / l.dTheta;
  const overTreads = perTurn * l.riser - TREAD;
  const underFloor = (perTurn - l.landing / l.dTheta) * l.riser - FLOOR_ABOVE;
  return Math.min(overTreads, underFloor);
}

/** Most turns of this stair (radius, rise, steps as given) that leave {@link SPIRAL_HEADROOM} of headroom; never under a turn. */
export function spiralMaxTurns(p: SpiralStairParams): number {
  let t = 4;
  while (t > 1 && spiralHeadroom({ ...p, turns: t }) < SPIRAL_HEADROOM) t = Math.round((t - 0.05) * 100) / 100;
  return t;
}

/** Least tread depth along the walking line a body climbs without catching its next step (m). */
export const SPIRAL_MIN_TREAD = 0.24;
/** Half the width of the body that climbs (the player capsule's radius, m) and the least tread depth under its inner side. */
export const SPIRAL_BODY = 0.35;
export const SPIRAL_MIN_INNER_TREAD = 0.2;

/**
 * Problems a spiral stair has for someone climbing it: treads too shallow at the walking line, or too little headroom
 * where it passes over itself. Empty when it can be climbed comfortably.
 */
export function spiralProblems(p: SpiralStairParams): string[] {
  const out: string[] = [];
  const depth = spiralTreadDepth(p);
  const l = spiralLayout(p);
  if (depth < SPIRAL_MIN_TREAD) {
    const turnsMax = (SPIRAL_MIN_TREAD * l.n) / (2 * Math.PI * l.walk);
    out.push(`the treads are ${depth.toFixed(2)} m deep at the walking line (least ${SPIRAL_MIN_TREAD} m): use a larger radius, fewer risers (a higher \`rise\` per riser) or at most ${turnsMax.toFixed(2)} turns`);
  }
  // The inner side of a body on the walking line stands over narrower treads: where they are too shallow a body of the
  // player's width catches on the next riser and cannot climb (a 1.1 m radius stair with the player's 0.35 m capsule).
  const inner = Math.max(0, l.walk - SPIRAL_BODY) * l.dTheta;
  if (inner < SPIRAL_MIN_INNER_TREAD) out.push(`a body ${2 * SPIRAL_BODY} m wide catches on the inner treads (${inner.toFixed(2)} m deep there, least ${SPIRAL_MIN_INNER_TREAD} m): use a radius of about ${Math.min(3, Math.max(1.3, p.radius * 1.25)).toFixed(1)} m or more, or fewer risers`);
  const head = spiralHeadroom(p);
  if (head < SPIRAL_HEADROOM) out.push(`only ${head.toFixed(2)} m of headroom where the stair passes over itself (least ${SPIRAL_HEADROOM} m): at most ${spiralMaxTurns(p).toFixed(2)} turns for this rise`);
  return out;
}

/** Width of a tread along the walking line (m): what a foot lands on. */
export function spiralTreadDepth(p: SpiralStairParams): number {
  const l = spiralLayout(p);
  return l.walk * l.dTheta;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** A quad whose normal faces away from `centre`, whatever the order of its corners. */
function face(g: Geom, a: V3, b: V3, c: V3, d: V3, centre: V3): void {
  const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2: V3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  const n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const m: V3 = [(a[0] + b[0] + c[0] + d[0]) / 4 - centre[0], (a[1] + b[1] + c[1] + d[1]) / 4 - centre[1], (a[2] + b[2] + c[2] + d[2]) / 4 - centre[2]];
  if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] >= 0) g.quadAuto(a, b, c, d);
  else g.quadAuto(a, d, c, b);
}

/** Segments an arc of `sweep` radians needs. */
const arcSegs = (sweep: number, per = Math.PI / 10): number => Math.max(1, Math.ceil(Math.abs(sweep) / per));

/**
 * A bent prism between two radii and two angles with a bottom and a top that may slope (heights at the start and end
 * angle): a tread (flat), or a band of balustrade glass (sloped).
 */
function sector(g: Geom, ri: number, ro: number, a0: number, a1: number, yb0: number, yb1: number, yt0: number, yt1: number): void {
  const segs = arcSegs(a1 - a0);
  const rm = (ri + ro) / 2;
  const am = (a0 + a1) / 2;
  const mid: V3 = [rm * Math.cos(am), (yb0 + yb1 + yt0 + yt1) / 4, rm * Math.sin(am)];
  const pt = (r: number, a: number, y: number): V3 => [r * Math.cos(a), y, r * Math.sin(a)];
  const lerp = (t: number, u: number, v: number): number => u + (v - u) * t;
  for (let s = 0; s < segs; s++) {
    const ta = s / segs;
    const tb = (s + 1) / segs;
    const aa = a0 + (a1 - a0) * ta;
    const ab = a0 + (a1 - a0) * tb;
    const bA = lerp(ta, yb0, yb1);
    const bB = lerp(tb, yb0, yb1);
    const tA = lerp(ta, yt0, yt1);
    const tB = lerp(tb, yt0, yt1);
    face(g, pt(ri, aa, tA), pt(ro, aa, tA), pt(ro, ab, tB), pt(ri, ab, tB), mid);
    face(g, pt(ri, aa, bA), pt(ro, aa, bA), pt(ro, ab, bB), pt(ri, ab, bB), mid);
    face(g, pt(ro, aa, bA), pt(ro, ab, bB), pt(ro, ab, tB), pt(ro, aa, tA), mid);
    face(g, pt(ri, aa, bA), pt(ri, ab, bB), pt(ri, ab, tB), pt(ri, aa, tA), mid);
  }
  face(g, pt(ri, a0, yb0), pt(ro, a0, yb0), pt(ro, a0, yt0), pt(ri, a0, yt0), mid);
  face(g, pt(ri, a1, yb1), pt(ro, a1, yb1), pt(ro, a1, yt1), pt(ri, a1, yt1), mid);
}

/** Convex hull points (packed xyz) of the wedge of one tread. */
function wedgePoints(l: SpiralLayout, a0: number, a1: number, y0: number, y1: number): number[] {
  const pts: number[] = [];
  const segs = arcSegs(a1 - a0, Math.PI / 6);
  for (let s = 0; s <= segs; s++) {
    const a = a0 + ((a1 - a0) * s) / segs;
    for (const r of [l.inner, l.outer]) for (const y of [y0, y1]) pts.push(r * Math.cos(a), y, r * Math.sin(a));
  }
  return pts;
}

/** Spiral stair. */
export function buildSpiralStair(p: SpiralStairParams): ArchOutput {
  const l = spiralLayout(p);
  const set = new PartSet();
  const treads = new Geom();
  const structure = new Geom();
  const rail = new Geom();
  const timber = new Geom();
  const glass = new Geom();
  const hull = (pts: number[]): void => void set.hull(pts);

  // Treads and risers. Tread k: top (k + 1) risers up; its leading edge is at angle(k).
  for (let k = 0; k < l.n - 1; k++) {
    const a0 = angleAt(l, k);
    const a1 = angleAt(l, k + 1);
    const top = (k + 1) * l.riser;
    const ri = p.core === 'solid' ? l.inner * 0.9 : l.inner;
    sector(treads, ri, l.outer, a0, a1, top - TREAD, top - TREAD, top, top);
    // The riser closing the gap under the tread's leading edge (not for the first tread: it rests on the floor).
    const edge = (r: number): V3 => [r * Math.cos(a0), 0, r * Math.sin(a0)];
    const yb = top - l.riser;
    const yt = top - TREAD;
    if (yt - yb > 1e-3) {
      const c: V3 = [((ri + l.outer) / 2) * Math.cos(a0 + l.dir * 0.1), (yb + yt) / 2, ((ri + l.outer) / 2) * Math.sin(a0 + l.dir * 0.1)];
      const q0 = edge(ri);
      const q1 = edge(l.outer);
      // Faces the foot of the climber (away from the tread it rises to).
      face(structure, [q0[0], yb, q0[2]], [q1[0], yb, q1[2]], [q1[0], yt, q1[2]], [q0[0], yt, q0[2]], c);
    }
    // One wedge collider per tread, a riser deep (the tread's own thickness down to the previous tread's top).
    hull(wedgePoints(l, a0, a1, top - l.riser, top));
  }

  // The post / core: from the floor up to the top rail's height above the landing.
  const postTop = p.rise + (p.core === 'solid' ? SPIRAL_GUARD_HEIGHT : 0.05);
  structure.merge(cylinder(l.post, l.post, postTop, 20));
  {
    const pts: number[] = [];
    for (let i = 0; i < 12; i++) for (const y of [0, postTop]) pts.push(l.post * Math.cos((i / 12) * 2 * Math.PI), y, l.post * Math.sin((i / 12) * 2 * Math.PI));
    hull(pts);
  }

  // Balustrade along a helix at `r`: from the first tread to the last, and at the top round the open part of the well.
  const helix = (r: number, side: 'outer' | 'inner'): void => {
    const steps = l.n - 1;
    const pitch = (t: number): number => l.riser * (t + 0.5);
    const pathPoints = (t0: number, t1: number, per: number): V3[] => {
      const out: V3[] = [];
      const m = Math.max(2, Math.ceil((t1 - t0) * per));
      for (let i = 0; i <= m; i++) {
        const t = t0 + ((t1 - t0) * i) / m;
        const a = angleAt(l, t);
        out.push([r * Math.cos(a), pitch(t) + SPIRAL_GUARD_HEIGHT, r * Math.sin(a)]);
      }
      return out;
    };
    const handrail = pathPoints(0, steps, 3);
    if (p.balustrade === 'timber') timber.merge(tube(handrail, 0.032, 8));
    else rail.merge(tube(handrail, p.balustrade === 'glass' ? 0.02 : 0.022, 8));
    if (p.balustrade === 'glass') {
      for (let k = 0; k < steps; k++) {
        const a0 = angleAt(l, k);
        const a1 = angleAt(l, k + 1);
        const half = 0.006;
        const top0 = pitch(k) + SPIRAL_GUARD_HEIGHT - 0.03;
        const top1 = pitch(k + 1) + SPIRAL_GUARD_HEIGHT - 0.03;
        const lo = (k + 1) * l.riser + 0.05;
        const lo1 = (k + 1) * l.riser + 0.05;
        const [aa, ab] = a0 < a1 ? [a0, a1] : [a1, a0];
        const [ta, tb] = a0 < a1 ? [top0, top1] : [top1, top0];
        sector(glass, r - half, r + half, aa + 0.004, ab - 0.004, lo, lo1, ta, tb);
      }
    } else {
      const arc = r * l.dTheta;
      const per = Math.max(1, Math.ceil(arc / 0.105));
      for (let k = 0; k < steps; k++) {
        for (let j = 0; j < per; j++) {
          const t = k + (j + 0.5) / per;
          const a = angleAt(l, t);
          const y0 = (k + 1) * l.riser;
          const y1 = pitch(t) + SPIRAL_GUARD_HEIGHT - 0.02;
          if (p.balustrade === 'steel') rail.merge(cylinder(0.008, 0.008, y1 - y0, 6, { top: false, bottom: false }).translate(r * Math.cos(a), y0, r * Math.sin(a)));
          else timber.merge(box(-0.015, 0, -0.015, 0.015, y1 - y0, 0.015).rotateY((-a * 180) / Math.PI).translate(r * Math.cos(a), y0, r * Math.sin(a)));
        }
      }
      // A newel at the foot.
      const a = angleAt(l, 0.05);
      const g = cylinder(0.025, 0.025, SPIRAL_GUARD_HEIGHT + l.riser, 8).translate(r * Math.cos(a), 0, r * Math.sin(a));
      if (p.balustrade === 'timber') timber.merge(g);
      else rail.merge(g);
    }
    if (side === 'outer') {
      // Colliders: an upright box along every tread's chord.
      for (let k = 0; k < steps; k++) {
        const a = angleAt(l, k);
        const b = angleAt(l, k + 1);
        const x0 = r * Math.cos(a);
        const z0 = r * Math.sin(a);
        const x1 = r * Math.cos(b);
        const z1 = r * Math.sin(b);
        const len = Math.hypot(x1 - x0, z1 - z0);
        const yb = (k + 1) * l.riser;
        const yt = pitch(k + 0.5) + SPIRAL_GUARD_HEIGHT;
        set.box([(x0 + x1) / 2, (yb + yt) / 2, (z0 + z1) / 2], [len / 2, (yt - yb) / 2, 0.025], [0, (Math.atan2(-(z1 - z0), x1 - x0) * 180) / Math.PI, 0]);
      }
    }
  };
  if (p.rail !== 'none') {
    helix(l.outer - 0.03, 'outer');
    if (p.rail === 'both' && p.core === 'open') helix(l.post + 0.05, 'inner');
  }

  // The guard round the stairwell on the floor above: along the open part of the disc.
  if (p.landingRail) {
    const r = l.outer + 0.04;
    const t0 = l.n - 1 + l.landing / l.dTheta;
    const t1 = l.n - 1 + (2 * Math.PI) / l.dTheta;
    const pts: V3[] = [];
    const m = Math.max(2, Math.ceil(Math.abs(t1 - t0) * l.dTheta / (Math.PI / 16)));
    for (let i = 0; i <= m; i++) {
      const a = angleAt(l, t0 + ((t1 - t0) * i) / m);
      pts.push([r * Math.cos(a), p.rise + SPIRAL_GUARD_HEIGHT, r * Math.sin(a)]);
    }
    if (p.balustrade === 'timber') timber.merge(tube(pts, 0.032, 8));
    else rail.merge(tube(pts, 0.022, 8));
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i] as V3;
      const col = cylinder(0.015, 0.015, SPIRAL_GUARD_HEIGHT - 0.02, 6, { top: false, bottom: false }).translate(q[0], p.rise, q[2]);
      if (p.balustrade === 'timber') timber.merge(col);
      else rail.merge(col);
      if (i + 1 < pts.length) {
        const nx = pts[i + 1] as V3;
        const len = Math.hypot(nx[0] - q[0], nx[2] - q[2]);
        // Balusters in between, under a tenth of a metre apart.
        const extra = Math.floor(len / 0.105);
        for (let j = 1; j <= extra; j++) {
          const f = j / (extra + 1);
          const b = cylinder(0.008, 0.008, SPIRAL_GUARD_HEIGHT - 0.02, 6, { top: false, bottom: false }).translate(q[0] + (nx[0] - q[0]) * f, p.rise, q[2] + (nx[2] - q[2]) * f);
          if (p.balustrade === 'timber') timber.merge(b);
          else rail.merge(b);
        }
        set.box([(q[0] + nx[0]) / 2, p.rise + SPIRAL_GUARD_HEIGHT / 2, (q[2] + nx[2]) / 2], [len / 2, SPIRAL_GUARD_HEIGHT / 2, 0.025], [0, (Math.atan2(-(nx[2] - q[2]), nx[0] - q[0]) * 180) / Math.PI, 0]);
      }
    }
  }

  set.add(treads, p.finish).add(structure, p.structure);
  set.add(rail, p.railMaterial).add(timber, p.finish).add(glass, { finish: 'glass' });
  return set.build();
}
