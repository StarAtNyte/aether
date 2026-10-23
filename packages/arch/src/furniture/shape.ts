/**
 * Shape helpers for crafted furniture: lofted shells with smooth normals (basins, bowls), smooth curves through
 * control points (rattan poles, tap spouts) and plan outlines from superellipses (rounded squares and ovals).
 */
import { Geom, tube } from '../mesh';
import type { P2 } from '../math2';

type V3 = readonly [number, number, number];

/**
 * Plan outline of a superellipse `|x/a|^n + |z/b|^n = 1` centred on (cx, cz), counter-clockwise in (x, z). `n` = 2 is an oval,
 * 4 a rounded square, 8 a square with soft corners.
 */
export function superEllipse(a: number, b: number, n: number, k = 32, cx = 0, cz = 0): P2[] {
  const out: P2[] = [];
  const e = 2 / n;
  for (let j = 0; j < k; j++) {
    const t = (j / k) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    out.push([cx + a * Math.sign(c) * Math.abs(c) ** e, cz + b * Math.sign(s) * Math.abs(s) ** e]);
  }
  return out;
}

/**
 * A smooth shell through rings of equal point counts (closed round each ring), with vertex normals from the neighbouring
 * rows and columns. `faces` says which way the surface looks: 'out' (away from the centre of the ring stack, a bowl's outside) or
 * 'in' (toward it, the inside of a basin). The winding follows.
 */
export function loft(rings: ReadonlyArray<ReadonlyArray<V3>>, faces: 'out' | 'in' = 'out'): Geom {
  const g = new Geom();
  const R = rings.length;
  if (R < 2) return g;
  const C = (rings[0] as ReadonlyArray<V3>).length;
  let cx = 0;
  let cz = 0;
  let cnt = 0;
  for (const ring of rings) for (const p of ring) { cx += p[0]; cz += p[2]; cnt++; }
  cx /= cnt;
  cz /= cnt;
  const at = (r: number, c: number): V3 => (rings[Math.max(0, Math.min(R - 1, r))] as ReadonlyArray<V3>)[((c % C) + C) % C] as V3;
  const normals: V3[] = [];
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const a = at(r, c - 1);
      const b = at(r, c + 1);
      const p = at(r - 1, c);
      const q = at(r + 1, c);
      const tc = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const tr = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      let nx = (tc[1] as number) * (tr[2] as number) - (tc[2] as number) * (tr[1] as number);
      let ny = (tc[2] as number) * (tr[0] as number) - (tc[0] as number) * (tr[2] as number);
      let nz = (tc[0] as number) * (tr[1] as number) - (tc[1] as number) * (tr[0] as number);
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) { nx = 0; ny = 1; nz = 0; } else { nx /= l; ny /= l; nz /= l; }
      normals.push([nx, ny, nz]);
    }
  }
  // Reference: the vertex farthest from the centre must look away from it for an outward shell.
  let far = 0;
  let farD = -1;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const p = at(r, c);
      const d = Math.hypot(p[0] - cx, p[2] - cz);
      if (d > farD) { farD = d; far = r * C + c; }
    }
  }
  const fp = at(Math.floor(far / C), far % C);
  const fn = normals[far] as V3;
  const outward = fn[0] * (fp[0] - cx) + fn[2] * (fp[2] - cz) >= 0;
  const flip = outward !== (faces === 'out');
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const p = at(r, c);
      const n = normals[r * C + c] as V3;
      const s = flip ? -1 : 1;
      g.vertex(p[0], p[1], p[2], n[0] * s, n[1] * s, n[2] * s, (c / C) * 1.2, r * 0.1);
    }
  }
  for (let r = 0; r + 1 < R; r++) {
    for (let c = 0; c < C; c++) {
      const a = r * C + c;
      const b = r * C + ((c + 1) % C);
      const d = (r + 1) * C + c;
      const e = (r + 1) * C + ((c + 1) % C);
      if (flip) g.tri(a, e, b).tri(a, d, e);
      else g.tri(a, b, e).tri(a, e, d);
    }
  }
  return g;
}

/** Centripetal-ish Catmull-Rom curve through the control points (`sub` samples per span), endpoints kept. */
export function spline(pts: readonly V3[], sub = 6): V3[] {
  if (pts.length < 3) return pts.slice() as V3[];
  const out: V3[] = [];
  const P = (i: number): V3 => pts[Math.max(0, Math.min(pts.length - 1, i))] as V3;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    for (let s = 0; s < sub; s++) {
      const t = s / sub;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (k: 0 | 1 | 2): number => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([f(0), f(1), f(2)]);
    }
  }
  out.push(pts[pts.length - 1] as V3);
  return out;
}

/** A tube of radius `r` along a smooth curve through `pts`. */
export function pole(pts: readonly V3[], r: number, seg = 8, sub = 5): Geom {
  return tube(spline(pts, sub), r, seg);
}

/** A closed loop tube along a plan outline at height `y`. */
export function hoop(outline: readonly P2[], y: number, r: number, seg = 6): Geom {
  const path: V3[] = outline.map((q) => [q[0], y, q[1]] as V3);
  if (path.length > 0) path.push(path[0] as V3, path[1] as V3);
  return tube(path, r, seg);
}
