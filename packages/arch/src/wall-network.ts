/**
 * Wall network of a level derived from its room outlines. Room polygons are
 * wall CENTRELINES: every room edge becomes wall, shared edges become one
 * interior wall, edges with a room on one side only are exterior walls.
 *
 * Steps: split every edge at every room vertex lying on it (T-junctions,
 * partially shared edges), deduplicate, classify, then merge collinear runs
 * through degree-2 nodes so a facade is one wall rather than many pieces.
 */
import { EPS, pointInPolygon, pointSegmentDistance, samePoint, type P2 } from './math2';

/** One wall of the network (level plan coordinates). */
export interface NetworkWall {
  a: P2;
  b: P2;
  /** Exactly one side borders a room (or the other side is outdoors). */
  exterior: boolean;
  /** Room ids on side A (right of a→b) and side B (left of a→b), null outdoors. */
  roomA: string | null;
  roomB: string | null;
}

/** A room outline for the network. */
export interface NetworkRoom {
  id: string;
  polygon: readonly P2[];
  /** Outdoor rooms (terraces) get no walls of their own. */
  outdoor?: boolean;
}

const KEY_SCALE = 1000;

function key(p: P2): string {
  return `${Math.round(p[0] * KEY_SCALE)},${Math.round(p[1] * KEY_SCALE)}`;
}

function segKey(a: P2, b: P2): string {
  const ka = key(a);
  const kb = key(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/** The room containing a plan point (first match), or null. */
function roomAt(rooms: readonly NetworkRoom[], x: number, z: number): string | null {
  for (const r of rooms) if (!r.outdoor && pointInPolygon(x, z, r.polygon)) return r.id;
  return null;
}

/** Build the wall network of a level. Deterministic for a given input order. */
export function wallNetwork(rooms: readonly NetworkRoom[], tolerance = 0.01): NetworkWall[] {
  const indoor = rooms.filter((r) => !r.outdoor && r.polygon.length >= 3);
  const vertices: P2[] = [];
  for (const r of indoor) for (const p of r.polygon) if (!vertices.some((v) => samePoint(v, p, tolerance))) vertices.push([p[0], p[1]]);
  // 1. Split edges at vertices lying on them.
  const segs = new Map<string, { a: P2; b: P2 }>();
  for (const r of indoor) {
    const n = r.polygon.length;
    for (let i = 0; i < n; i++) {
      const a = r.polygon[i] as P2;
      const b = r.polygon[(i + 1) % n] as P2;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < EPS) continue;
      const cuts: number[] = [0, 1];
      for (const v of vertices) {
        if (pointSegmentDistance(v[0], v[1], a[0], a[1], b[0], b[1]) > tolerance) continue;
        const t = ((v[0] - a[0]) * (b[0] - a[0]) + (v[1] - a[1]) * (b[1] - a[1])) / (len * len);
        if (t > tolerance / len && t < 1 - tolerance / len) cuts.push(t);
      }
      cuts.sort((p, q) => p - q);
      for (let k = 0; k + 1 < cuts.length; k++) {
        const t0 = cuts[k] as number;
        const t1 = cuts[k + 1] as number;
        if ((t1 - t0) * len < tolerance) continue;
        const p: P2 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
        const q: P2 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
        const k2 = segKey(p, q);
        if (!segs.has(k2)) segs.set(k2, key(p) < key(q) ? { a: p, b: q } : { a: q, b: p });
      }
    }
  }
  // 2. Classify each segment by sampling both sides.
  const classified: NetworkWall[] = [];
  for (const { a, b } of segs.values()) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / len;
    const nz = (b[0] - a[0]) / len;
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    const off = 0.05;
    const roomB = roomAt(indoor, mx + nx * off, mz + nz * off);
    const roomA = roomAt(indoor, mx - nx * off, mz - nz * off);
    if (roomA === null && roomB === null) continue;
    classified.push({ a, b, exterior: roomA === null || roomB === null, roomA, roomB });
  }
  return mergeCollinear(classified, tolerance);
}

/** Merge collinear walls joined at nodes of degree 2 with matching classification. */
function mergeCollinear(walls: NetworkWall[], tolerance: number): NetworkWall[] {
  const list = walls.slice();
  let merged = true;
  while (merged) {
    merged = false;
    const degree = new Map<string, number>();
    for (const w of list) {
      degree.set(key(w.a), (degree.get(key(w.a)) ?? 0) + 1);
      degree.set(key(w.b), (degree.get(key(w.b)) ?? 0) + 1);
    }
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const w = list[i] as NetworkWall;
        const v = list[j] as NetworkWall;
        if (w.exterior !== v.exterior) continue;
        let shared: P2 | null = null;
        let wa: P2 | null = null;
        let vb: P2 | null = null;
        if (samePoint(w.b, v.a, tolerance)) [shared, wa, vb] = [w.b, w.a, v.b];
        else if (samePoint(w.a, v.b, tolerance)) [shared, wa, vb] = [w.a, w.b, v.a];
        else if (samePoint(w.b, v.b, tolerance)) [shared, wa, vb] = [w.b, w.a, v.a];
        else if (samePoint(w.a, v.a, tolerance)) [shared, wa, vb] = [w.a, w.b, v.b];
        if (!shared || !wa || !vb || degree.get(key(shared)) !== 2) continue;
        // Collinear and pointing the same way through the shared node.
        const d1x = shared[0] - wa[0];
        const d1z = shared[1] - wa[1];
        const d2x = vb[0] - shared[0];
        const d2z = vb[1] - shared[1];
        const cross = d1x * d2z - d1z * d2x;
        const dot = d1x * d2x + d1z * d2z;
        if (Math.abs(cross) > tolerance * Math.hypot(d1x, d1z) || dot <= 0) continue;
        // Same rooms on the same sides (orientation-aware).
        const wForward = samePoint(w.b, shared, tolerance);
        const vForward = samePoint(v.a, shared, tolerance);
        const wSides = wForward ? [w.roomA, w.roomB] : [w.roomB, w.roomA];
        const vSides = vForward ? [v.roomA, v.roomB] : [v.roomB, v.roomA];
        if (wSides[0] !== vSides[0] || wSides[1] !== vSides[1]) continue;
        const next: NetworkWall = { a: wa, b: vb, exterior: w.exterior, roomA: wSides[0] ?? null, roomB: wSides[1] ?? null };
        list.splice(j, 1);
        list.splice(i, 1, next);
        merged = true;
        break outer;
      }
    }
  }
  return list;
}
