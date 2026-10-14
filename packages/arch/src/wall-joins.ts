/**
 * Wall join solver: given the wall centrelines of one level, compute how far
 * each side edge of each wall end extends past (or stops short of) its end
 * point, so L-corners mitre, T-junctions butt into the through wall, X
 * crossings meet cleanly and free ends stay square.
 *
 * Method: wall ends are clustered into junction nodes. Around a node the
 * incident ends are sorted by angle; each pair of angular neighbours shares
 * one corner point — the intersection of the facing side edges (offset by
 * each wall's half thickness). An edge's extension is the signed distance of
 * that corner behind the node along the wall. Collinear neighbours (a wall
 * running straight through) keep their edges as they are.
 */
import { EPS, type P2 } from './math2';

/** One wall centreline for the solver. */
export interface JoinWall {
  id: string;
  a: P2;
  b: P2;
  thickness: number;
}

/** Edge extensions of one wall (see `WallParams`). */
export interface WallJoin {
  startA: number;
  startB: number;
  endA: number;
  endB: number;
}

/** Endpoints closer than this are one junction (metres). */
export const JOIN_TOLERANCE = 0.02;

interface End {
  wall: number;
  atStart: boolean;
  /** Unit direction pointing away from the node along the wall. */
  ux: number;
  uz: number;
  half: number;
  angle: number;
}

/** Limit of a corner extension relative to the thicker wall (very acute angles). */
const MAX_EXTENSION_FACTOR = 4;

/** Solve the joins of a set of walls. Result is keyed by wall id. */
export function solveWallJoins(walls: readonly JoinWall[], tolerance = JOIN_TOLERANCE): Map<string, WallJoin> {
  const out = new Map<string, WallJoin>();
  for (const w of walls) out.set(w.id, { startA: 0, startB: 0, endA: 0, endB: 0 });
  // Cluster end points into nodes.
  const nodes: Array<{ x: number; z: number; ends: End[] }> = [];
  const nodeOf = (p: P2): { x: number; z: number; ends: End[] } => {
    for (const n of nodes) if (Math.abs(n.x - p[0]) <= tolerance && Math.abs(n.z - p[1]) <= tolerance) return n;
    const n = { x: p[0], z: p[1], ends: [] as End[] };
    nodes.push(n);
    return n;
  };
  walls.forEach((w, i) => {
    const dx = w.b[0] - w.a[0];
    const dz = w.b[1] - w.a[1];
    const len = Math.hypot(dx, dz);
    if (len < EPS) return;
    const ux = dx / len;
    const uz = dz / len;
    const half = Math.max(0.005, w.thickness / 2);
    nodeOf(w.a).ends.push({ wall: i, atStart: true, ux, uz, half, angle: Math.atan2(uz, ux) });
    nodeOf(w.b).ends.push({ wall: i, atStart: false, ux: -ux, uz: -uz, half, angle: Math.atan2(-uz, -ux) });
  });
  for (const node of nodes) {
    const ends = node.ends;
    if (ends.length < 2) continue;
    ends.sort((p, q) => p.angle - q.angle);
    for (let k = 0; k < ends.length; k++) {
      const e = ends[k] as End;
      const f = ends[(k + 1) % ends.length] as End;
      // Left edge of e (normal (-uz, ux)) meets the right edge of f (normal (uz, -ux)).
      const pe: P2 = [-e.uz * e.half, e.ux * e.half];
      const pf: P2 = [f.uz * f.half, -f.ux * f.half];
      const cross = e.ux * f.uz - e.uz * f.ux;
      let extE = 0;
      let extF = 0;
      if (Math.abs(cross) > 1e-6) {
        // pe + s·ue = pf + r·uf
        const s = ((pf[0] - pe[0]) * f.uz - (pf[1] - pe[1]) * f.ux) / cross;
        const r = ((pf[0] - pe[0]) * e.uz - (pf[1] - pe[1]) * e.ux) / cross;
        const cap = MAX_EXTENSION_FACTOR * Math.max(e.half, f.half) * 2;
        extE = clamp(-s, -cap, cap);
        extF = clamp(-r, -cap, cap);
      }
      assign(out, walls, e, 'left', extE);
      assign(out, walls, f, 'right', extF);
    }
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Map an end's left/right edge onto the wall's sides: walking from the start
 * (+X), the left edge is side B (+Z); walking back from the end, it is side A.
 */
function assign(out: Map<string, WallJoin>, walls: readonly JoinWall[], e: End, edge: 'left' | 'right', value: number): void {
  const w = walls[e.wall];
  if (!w) return;
  const j = out.get(w.id);
  if (!j) return;
  const v = Math.round(value * 1000) / 1000;
  if (e.atStart) {
    if (edge === 'left') j.startB = v;
    else j.startA = v;
  } else if (edge === 'left') j.endA = v;
  else j.endB = v;
}
