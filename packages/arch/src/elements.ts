/**
 * Plate-like and linear architectural elements: floor slabs, ceilings,
 * columns, railings and pool basins. All outputs use metric UVs and carry
 * static colliders where people can touch them.
 */
import { Geom, box, cylinder, roundedBox, tube } from './mesh';
import { PartSet } from './parts';
import { isAxisRectangle, bounds, positive, signedArea, type P2 } from './math2';
import type { BasinParams, CeilingParams, ColumnParams, RailingParams, SlabParams } from './params';
import type { ArchOutput } from './types';
import { triangulate } from './triangulate';

/** Side band of a polygon from y0 to y1 (outward faces). */
function band(g: Geom, poly: readonly P2[], y0: number, y1: number, inward = false): void {
  const pts = positive(poly);
  let u = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k] as P2;
    const b = pts[(k + 1) % pts.length] as P2;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-6) continue;
    if (inward) g.quadAuto([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], u, y0);
    else g.quadAuto([b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], u, y0);
    u += l;
  }
}

/** Floor slab: top at y = 0 with the floor finish, edge band down to −thickness. */
export function buildSlab(p: SlabParams): ArchOutput {
  const set = new PartSet();
  const top = new Geom().flatPolygon(p.polygon, 0, true, p.holes);
  const edge = new Geom();
  band(edge, p.polygon, -p.thickness, 0);
  for (const h of p.holes) band(edge, h, -p.thickness, 0, true);
  if (p.bottom) edge.flatPolygon(p.polygon, -p.thickness, false, p.holes);
  set.add(top, p.finish).add(edge, p.edge);
  // Collider: one box for plain rectangles, a closed triangle mesh otherwise.
  if (p.holes.length === 0 && isAxisRectangle(p.polygon)) {
    const [x0, z0, x1, z1] = bounds(p.polygon);
    set.boxMinMax(x0, -p.thickness, z0, x1, 0, z1);
  } else {
    const solid = new Geom().flatPolygon(p.polygon, 0, true, p.holes).flatPolygon(p.polygon, -p.thickness, false, p.holes);
    band(solid, p.polygon, -p.thickness, 0);
    for (const h of p.holes) band(solid, h, -p.thickness, 0, true);
    set.trimesh(solid);
  }
  return set.build();
}

/** Ceiling: a downward-facing surface at y = 0 (with an optional recessed cove). */
export function buildCeiling(p: CeilingParams): ArchOutput {
  if (p.vault && p.holes.length === 0 && isAxisRectangle(p.polygon)) return buildVault(p, p.vault);
  const set = new PartSet();
  const g = new Geom();
  if (p.cove > 0.005) {
    // Inset field raised by the cove depth, with a vertical return.
    const inset = insetRect(p.polygon, 0.35);
    if (inset) {
      const ring = new Geom();
      ring.flatPolygon(p.polygon, 0, false, [inset, ...p.holes]);
      band(ring, inset, 0, p.cove, true);
      g.merge(ring);
      g.flatPolygon(inset, p.cove, false);
    } else g.flatPolygon(p.polygon, 0, false, p.holes);
  } else g.flatPolygon(p.polygon, 0, false, p.holes);
  set.add(g, p.finish);
  if (p.downlights.length > 0) {
    // Recessed cans: a white trim ring and a flush lens; inside a cove the field is raised by the cove depth.
    const inset = p.cove > 0.005 ? insetRect(p.polygon, 0.35) : null;
    const trim = new Geom();
    const lens = new Geom();
    for (const [x, z] of p.downlights) {
      const y0 = inset && x > Math.min(...inset.map((q) => q[0])) && x < Math.max(...inset.map((q) => q[0])) && z > Math.min(...inset.map((q) => q[1])) && z < Math.max(...inset.map((q) => q[1])) ? p.cove : 0;
      trim.merge(cylinder(0.062, 0.062, 0.014, 20).translate(x, y0 - 0.014, z));
      const ring: P2[] = [];
      for (let k = 0; k < 20; k++) ring.push([x + Math.cos((k / 20) * Math.PI * 2) * 0.046, z + Math.sin((k / 20) * Math.PI * 2) * 0.046]);
      lens.flatPolygon(ring, y0 - 0.0145, false);
    }
    set.add(trim, { finish: 'paint', color: '#f6f4f0', roughness: 0.4 });
    set.add(lens, { preset: 'emissive', color: '#ffe6c2', emissive: '#ffe0b0', emissiveIntensity: p.lit ? 1.5 : 0, roughness: 0.3 });
  }
  return set.build();
}

/** A quad whose normal points down, whatever order the corners were given in. */
function downQuad(g: Geom, c0: readonly number[], c1: readonly number[], c2: readonly number[], c3: readonly number[]): void {
  const ex = [(c1[0] as number) - (c0[0] as number), (c1[1] as number) - (c0[1] as number), (c1[2] as number) - (c0[2] as number)];
  const ey = [(c3[0] as number) - (c0[0] as number), (c3[1] as number) - (c0[1] as number), (c3[2] as number) - (c0[2] as number)];
  const ny = (ex[2] as number) * (ey[0] as number) - (ex[0] as number) * (ey[2] as number);
  if (ny > 0) g.quadAuto(c0, c3, c2, c1);
  else g.quadAuto(c0, c1, c2, c3);
}

/** A straight beam of rectangular section from `a` to `b`; `side` is the horizontal direction of its width. */
function beam(a: readonly [number, number, number], b: readonly [number, number, number], width: number, depth: number, side: readonly [number, number, number]): Geom {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0] as number, d[1] as number, d[2] as number) || 1;
  const dn = d.map((v) => v / len) as [number, number, number];
  // The depth direction is perpendicular to both the beam and its width.
  const dx = [dn[1] * side[2] - dn[2] * side[1], dn[2] * side[0] - dn[0] * side[2], dn[0] * side[1] - dn[1] * side[0]];
  const dl = Math.hypot(dx[0] as number, dx[1] as number, dx[2] as number) || 1;
  const up = dx.map((v) => v / dl) as [number, number, number];
  const corner = (p: readonly [number, number, number], sw: number, sd: number): [number, number, number] => [p[0] + side[0] * sw * (width / 2) + up[0] * sd * (depth / 2), p[1] + side[1] * sw * (width / 2) + up[1] * sd * (depth / 2), p[2] + side[2] * sw * (width / 2) + up[2] * sd * (depth / 2)];
  const A = [corner(a, -1, -1), corner(a, 1, -1), corner(a, 1, 1), corner(a, -1, 1)];
  const B = [corner(b, -1, -1), corner(b, 1, -1), corner(b, 1, 1), corner(b, -1, 1)];
  const centre = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const g = new Geom();
  const face = (c0: number[], c1: number[], c2: number[], c3: number[]): void => {
    const fc = [(c0[0]! + c2[0]!) / 2, (c0[1]! + c2[1]!) / 2, (c0[2]! + c2[2]!) / 2];
    const ex = [c1[0]! - c0[0]!, c1[1]! - c0[1]!, c1[2]! - c0[2]!];
    const ey = [c3[0]! - c0[0]!, c3[1]! - c0[1]!, c3[2]! - c0[2]!];
    const n = [ex[1]! * ey[2]! - ex[2]! * ey[1]!, ex[2]! * ey[0]! - ex[0]! * ey[2]!, ex[0]! * ey[1]! - ex[1]! * ey[0]!];
    const out = n[0]! * (fc[0]! - centre[0]!) + n[1]! * (fc[1]! - centre[1]!) + n[2]! * (fc[2]! - centre[2]!);
    if (out >= 0) g.quadAuto(c0, c1, c2, c3);
    else g.quadAuto(c0, c3, c2, c1);
  };
  for (let k = 0; k < 4; k++) face(A[k] as number[], A[(k + 1) % 4] as number[], B[(k + 1) % 4] as number[], B[k] as number[]);
  face(A[0] as number[], A[1] as number[], A[2] as number[], A[3] as number[]);
  face(B[0] as number[], B[1] as number[], B[2] as number[], B[3] as number[]);
  return g;
}

/** Vaulted ceiling: two sloping planes to a ridge, with optional exposed trusses (see {@link CeilingParams.vault}). */
function buildVault(p: CeilingParams, v: NonNullable<CeilingParams['vault']>): ArchOutput {
  const set = new PartSet();
  const [x0, z0, x1, z1] = bounds(p.polygon);
  const alongZ = v.ridge === 'z';
  // u runs across the ridge, w along it; (u, w, y) maps to the plan.
  const u0 = alongZ ? x0 : z0;
  const u1 = alongZ ? x1 : z1;
  const w0 = alongZ ? z0 : x0;
  const w1 = alongZ ? z1 : x1;
  const um = (u0 + u1) / 2;
  const pt = (u: number, w: number, y: number): [number, number, number] => (alongZ ? [u, y, w] : [w, y, u]);
  const g = new Geom();
  downQuad(g, pt(u0, w0, -v.rise), pt(um, w0, 0), pt(um, w1, 0), pt(u0, w1, -v.rise));
  downQuad(g, pt(um, w0, 0), pt(u1, w0, -v.rise), pt(u1, w1, -v.rise), pt(um, w1, 0));
  set.add(g, p.finish);
  if (v.trusses > 0) {
    const side: [number, number, number] = alongZ ? [0, 0, 1] : [1, 0, 0];
    const beams = new Geom();
    const sl = (w1 - w0) / (v.trusses + 1);
    const inset = 0.04;
    for (let k = 1; k <= v.trusses; k++) {
      const w = w0 + sl * k;
      // Rafters just under the slope, a tie beam a little above the eaves, a king post.
      beams.merge(beam(pt(u0, w, -v.rise - 0.0), pt(um, w, -0.0), 0.07, 0.15, side).translate(0, -0.075, 0));
      beams.merge(beam(pt(u1, w, -v.rise - 0.0), pt(um, w, -0.0), 0.07, 0.15, side).translate(0, -0.075, 0));
      const tieY = -v.rise * 0.72;
      beams.merge(beam(pt(u0 + inset, w, tieY), pt(u1 - inset, w, tieY), 0.07, 0.14, side));
      beams.merge(beam(pt(um, w, tieY), pt(um, w, -0.1), 0.07, 0.12, side));
    }
    set.add(beams, { finish: 'paint', color: v.beam });
  }
  return set.build();
}

/** Inset of an axis-aligned rectangle (null for other shapes or when too small). */
function insetRect(poly: readonly P2[], d: number): P2[] | null {
  if (!isAxisRectangle(poly)) return null;
  const [x0, z0, x1, z1] = bounds(poly);
  if (x1 - x0 < 2 * d + 0.5 || z1 - z0 < 2 * d + 0.5) return null;
  return [
    [x0 + d, z0 + d],
    [x1 - d, z0 + d],
    [x1 - d, z1 - d],
    [x0 + d, z1 - d],
  ];
}

/** Column standing on y = 0. */
export function buildColumn(p: ColumnParams): ArchOutput {
  const set = new PartSet();
  const r = p.size / 2;
  if (p.shape === 'round') {
    set.add(cylinder(r, r, p.height, 28), p.finish);
    set.box([0, p.height / 2, 0], [r, p.height / 2, r]);
  } else {
    set.add(roundedBox(p.size, p.height, p.size, Math.min(0.012, r * 0.2), 2).translate(0, p.height / 2, 0), p.finish);
    set.box([0, p.height / 2, 0], [r, p.height / 2, r]);
  }
  return set.build();
}

/** Railing along a plan polyline (top rail, posts, infill). */
export function buildRailing(p: RailingParams): ArchOutput {
  const set = new PartSet();
  const metal = new Geom();
  const infill = new Geom();
  const h = p.height;
  const pts = p.points;
  const timber = new Geom();
  // Top rail (a moulded timber handrail on timber balustrades).
  if (p.style !== 'timber') metal.merge(tube(pts.map((q) => [q[0], h, q[1]] as const), 0.022, 10));
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k] as P2;
    const b = pts[k + 1] as P2;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-3) continue;
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    const yaw = (Math.atan2(-uz, ux) * 180) / Math.PI;
    if (p.style === 'timber') {
      // Newel posts at the corners, square spindles between a bottom rail and the handrail.
      timber.merge(box(-0.02, h - 0.055, -0.033, len + 0.02, h, 0.033).rotateY(yaw).translate(a[0], 0, a[1]));
      timber.merge(box(0, 0.04, -0.025, len, 0.1, 0.025).rotateY(yaw).translate(a[0], 0, a[1]));
      const n = Math.max(1, Math.ceil(len / 0.12));
      for (let i = 1; i < n; i++) timber.merge(box((len * i) / n - 0.016, 0.1, -0.016, (len * i) / n + 0.016, h - 0.055, 0.016).rotateY(yaw).translate(a[0], 0, a[1]));
      if (k === 0) timber.merge(box(-0.045, 0, -0.045, 0.045, h + 0.06, 0.045).translate(a[0], 0, a[1]));
      timber.merge(box(-0.045, 0, -0.045, 0.045, h + 0.06, 0.045).translate(b[0], 0, b[1]));
      set.box([(a[0] + b[0]) / 2, h / 2, (a[1] + b[1]) / 2], [len / 2, h / 2, 0.04], [0, yaw, 0]);
      continue;
    }
    // Posts every ~1.2 m (glass) or 0.12 m bars.
    const spacing = p.style === 'bars' ? 0.12 : 1.2;
    const n = Math.max(1, Math.round(len / spacing));
    for (let i = 0; i <= n; i++) {
      if (i === n && k + 2 < pts.length) continue; // shared with the next segment
      const x = a[0] + ux * (len * i) / n;
      const z = a[1] + uz * (len * i) / n;
      const r = p.style === 'bars' ? 0.009 : 0.022;
      metal.merge(cylinder(r, r, h, 8, { bottom: false }).translate(x, 0, z));
    }
    if (p.style === 'glass') {
      const pane = box(0.02, 0.06, -0.006, len - 0.02, h - 0.06, 0.006).rotateY(yaw).translate(a[0], 0, a[1]);
      infill.merge(pane);
    } else if (p.style === 'cable') {
      for (let y = 0.15; y < h - 0.05; y += 0.12) metal.merge(tube([[a[0], y, a[1]], [b[0], y, b[1]]], 0.003, 6));
    } else if (p.style === 'solid') {
      infill.merge(box(0, 0, -0.06, len, h - 0.03, 0.06).rotateY(yaw).translate(a[0], 0, a[1]));
    }
    set.box([(a[0] + b[0]) / 2, h / 2, (a[1] + b[1]) / 2], [len / 2, h / 2, 0.04], [0, yaw, 0]);
  }
  set.add(metal, p.finish);
  set.add(timber, { finish: 'oak' });
  if (p.style === 'glass') set.add(infill, { finish: 'glass' });
  else if (p.style === 'solid') set.add(infill, { finish: 'plaster' });
  return set.build();
}

/**
 * Pool basin recessed below y = 0: tiled walls and floor facing inward, a
 * stone coping ring at the top and a water surface `freeboard` below it.
 * Centred on the origin (width along X, length along Z).
 */
export function buildBasin(p: BasinParams): ArchOutput {
  const set = new PartSet();
  const hx = p.width / 2;
  const hz = p.length / 2;
  const inner: P2[] = [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ];
  const tiles = new Geom();
  band(tiles, inner, -p.depth, 0, true);
  tiles.flatPolygon(inner, -p.depth, true);
  set.add(tiles, p.finish);
  // Coping: a 0.3 m ring slightly proud of the deck.
  const c = 0.3;
  const outer: P2[] = [
    [-hx - c, -hz - c],
    [hx + c, -hz - c],
    [hx + c, hz + c],
    [-hx - c, hz + c],
  ];
  const coping = new Geom().flatPolygon(outer, 0.03, true, [inner]);
  band(coping, outer, 0, 0.03);
  band(coping, inner, -0.04, 0.03, true);
  set.add(coping, p.coping);
  if (p.water) {
    const water = new Geom().flatPolygon(inner, -p.freeboard, true);
    // Opaque: the basin sits below the ground plane, which must not show through the water.
    set.add(water, { finish: 'water', opacity: 1 });
  }
  // Colliders: floor and four walls (people can walk around and fall in).
  const t = 0.1;
  set.boxMinMax(-hx, -p.depth - t, -hz, hx, -p.depth, hz);
  set.boxMinMax(-hx - t, -p.depth, -hz - t, -hx, 0.03, hz + t);
  set.boxMinMax(hx, -p.depth, -hz - t, hx + t, 0.03, hz + t);
  set.boxMinMax(-hx, -p.depth, -hz - t, hx, 0.03, -hz);
  set.boxMinMax(-hx, -p.depth, hz, hx, 0.03, hz + t);
  return set.build();
}

/** Area of a slab's walkable top in m² (outline minus holes). */
export function slabArea(polygon: readonly P2[], holes: readonly (readonly P2[])[] = []): number {
  const { points, triangles } = triangulate(polygon, holes);
  let s = 0;
  for (let i = 0; i < triangles.length; i += 3) s += signedArea([points[triangles[i] as number] as P2, points[triangles[i + 1] as number] as P2, points[triangles[i + 2] as number] as P2]);
  return Math.abs(s);
}
