/**
 * Grounds of a house: a garden on a level plot (paved approach from the front door, hedges round the back and the
 * sides, planted beds along the front, trees in the corners, a few boulders) and, optionally, the land around it (an
 * estate terrain whose level pad is the plot, groves of broadleaf and spruce on the swells, meadow grass and
 * wildflowers off the plot). Everything is compiled into the building's subtree in the plan frame, so the grounds
 * follow the building, re-compile with it, and are what a model gets by setting `site.garden` / `site.surroundings`
 * (or the `set_site` op). Deterministic for a plan and seed.
 */
import { rng, type EntityInput, type Json, type MaterialSpec } from '@aether/core';
import { bounds, pointInPolygon, type P2 } from './math2';

/** What the garden needs to know about the compiled building (plan frame). */
export interface GardenInput {
  /** Building id (parent of everything emitted). */
  bid: string;
  /** Ground-floor outline loops (wall centrelines). */
  outline: readonly (readonly P2[])[];
  /** Half the exterior wall thickness. */
  ext: number;
  /** Terrace polygon, when the plan has one. */
  terrace?: readonly P2[];
  /** Pool rectangle (x0, z0, x1, z1), when the plan has one. */
  pool?: readonly [number, number, number, number];
  /** Main entrance: door centre and outward normal. */
  entry?: { c: P2; n: P2; width: number };
  /** Hedges, beds and trees on the plot. */
  garden: boolean;
  /** The land around the plot. */
  surroundings: 'none' | 'estate';
  seed: number;
}

/** What {@link compileGrounds} returns. */
export interface GardenOutput {
  entities: EntityInput[];
  /** The plot (x0, z0, x1, z1), for the building's bounds. */
  plot: [number, number, number, number];
}

const HEDGE: MaterialSpec = { finish: 'foliage', color: '#4b6a37' };
const PAVING: MaterialSpec = { finish: 'stone', color: '#c4bcaf' };
const SOIL: MaterialSpec = { finish: 'soil', color: '#4a3c2e' };
const EDGING: MaterialSpec = { finish: 'black-metal' };

function r(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function rect(x0: number, z0: number, x1: number, z1: number): Json {
  return [[r(x0), r(z0)], [r(x1), r(z0)], [r(x1), r(z1)], [r(x0), r(z1)]];
}

/** Grounds of a house (see the module docs). */
export function compileGrounds(g: GardenInput): GardenOutput {
  const out: EntityInput[] = [];
  const rand = rng((g.seed ^ 0x6a4d) >>> 0);
  const between = (a: number, b: number): number => a + (b - a) * rand();
  const { bid } = g;
  // Footprint of what stands on the plot: the walls' outer faces and the terrace.
  let [bx0, bz0, bx1, bz1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const loop of g.outline) {
    const [a, b, c, d] = bounds(loop as P2[]);
    bx0 = Math.min(bx0, a - g.ext);
    bz0 = Math.min(bz0, b - g.ext);
    bx1 = Math.max(bx1, c + g.ext);
    bz1 = Math.max(bz1, d + g.ext);
  }
  const [hx0, hz0, hx1, hz1] = [bx0, bz0, bx1, bz1];
  if (g.terrace) {
    const [a, b, c, d] = bounds(g.terrace as P2[]);
    bx0 = Math.min(bx0, a);
    bz0 = Math.min(bz0, b);
    bx1 = Math.max(bx1, c);
    bz1 = Math.max(bz1, d);
  }
  if (!Number.isFinite(bx0)) return { entities: [], plot: [0, 0, 0, 0] };
  // The door's facade gets a front garden; the plot is a few metres round everything else.
  const n = g.entry?.n ?? [0, 1];
  const front = (dx: number, dz: number): number => (Math.abs(n[0] - dx) < 0.3 && Math.abs(n[1] - dz) < 0.3 ? 9 : 4.5);
  const plot: [number, number, number, number] = [bx0 - front(-1, 0), bz0 - front(0, -1), bx1 + front(1, 0), bz1 + front(0, 1)];
  const [px0, pz0, px1, pz1] = plot;
  const inHouse = (x: number, z: number, m: number): boolean => x > hx0 - m && x < hx1 + m && z > hz0 - m && z < hz1 + m;
  const onTerrace = (x: number, z: number, m: number): boolean => !!g.terrace && (pointInPolygon(x, z, g.terrace as P2[]) || (() => { const [a, b, c, d] = bounds(g.terrace as P2[]); return x > a - m && x < c + m && z > b - m && z < d + m; })());

  // --- the approach: stepping slabs from the door (or the terrace edge in front of it) to the plot edge ---------------
  let pathLine: { a: P2; b: P2 } | null = null;
  if (g.entry) {
    const { c } = g.entry;
    // Walk out from the door until clear of the house and the terrace.
    let s = g.ext + 0.05;
    while (s < 40 && (inHouse(c[0] + n[0] * s, c[1] + n[1] * s, 0.02) || onTerrace(c[0] + n[0] * s, c[1] + n[1] * s, 0.05))) s += 0.1;
    let start: P2 = [c[0] + n[0] * s, c[1] + n[1] * s];
    // Never through the pool: slide sideways past it.
    if (g.pool && s > 1) {
      const [qx0, qz0, qx1, qz1] = g.pool;
      const side: P2 = [-n[1], n[0]];
      const along = side[0] !== 0 ? start[0] : start[1];
      const lo = side[0] !== 0 ? qx0 : qz0;
      const hi = side[0] !== 0 ? qx1 : qz1;
      if (along > lo - 1 && along < hi + 1) {
        const shift = along - lo < hi - along ? lo - 1.4 - along : hi + 1.4 - along;
        start = [start[0] + side[0] * Math.abs(side[0]) * shift, start[1] + side[1] * Math.abs(side[1]) * shift];
      }
    }
    const reach = Math.abs(n[0]) > Math.abs(n[1]) ? (n[0] > 0 ? px1 - start[0] : start[0] - px0) : n[1] > 0 ? pz1 - start[1] : start[1] - pz0;
    const end: P2 = [start[0] + n[0] * (reach + 0.4), start[1] + n[1] * (reach + 0.4)];
    pathLine = { a: start, b: end };
    const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const w = Math.max(1.3, Math.min(2.2, g.entry.width + 0.4));
    const slab = 0.75;
    const gap = 0.12;
    let k = 0;
    for (let t = 0.05; t + slab <= len + 0.01; t += slab + gap) {
      const m: P2 = [start[0] + n[0] * (t + slab / 2), start[1] + n[1] * (t + slab / 2)];
      const hw = Math.abs(n[0]) > 0.5 ? slab / 2 : w / 2;
      const hd = Math.abs(n[0]) > 0.5 ? w / 2 : slab / 2;
      out.push({ id: `${bid}-path${k++}`, parent: bid, name: 'Paving slab', transform: { position: [0, 0.045, 0] }, shape: { kind: 'procedural', generator: 'arch-slab', params: { polygon: rect(m[0] - hw, m[1] - hd, m[0] + hw, m[1] + hd), thickness: 0.07, finish: PAVING, edge: PAVING } as unknown as Record<string, Json> }, arch: { role: 'site', kind: 'path', name: 'Path' }, tags: ['arch', 'site'], castShadow: false });
    }
  }
  const nearPath = (x: number, z: number, d: number): boolean => {
    if (!pathLine) return false;
    const { a, b } = pathLine;
    const vx = b[0] - a[0];
    const vz = b[1] - a[1];
    const l2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / l2));
    return Math.hypot(x - (a[0] + vx * t), z - (a[1] + vz * t)) < d;
  };

  if (g.garden) {
    // --- hedges along the back and the sides (the front stays open to the approach) -------------------------------
    const H = 1.15;
    const D = 0.7;
    const hedge = (x0: number, z0: number, x1: number, z1: number): void => {
      if (x1 - x0 < 0.6 && z1 - z0 < 0.6) return;
      out.push({ id: `${bid}-hedge${out.filter((e) => e.arch?.kind === 'hedge').length}`, parent: bid, name: 'Hedge', transform: { position: [r((x0 + x1) / 2), r(H / 2), r((z0 + z1) / 2)] }, shape: { kind: 'primitive', primitive: 'box', size: [r(x1 - x0), H, r(z1 - z0)] }, material: HEDGE, physics: { body: 'static' }, arch: { role: 'site', kind: 'hedge', name: 'Hedge' }, tags: ['arch', 'site', 'hedge'] });
    };
    const sides: Array<{ dir: P2; seg: [number, number, number, number] }> = [
      { dir: [0, -1], seg: [px0, pz0, px1, pz0 + D] },
      { dir: [0, 1], seg: [px0, pz1 - D, px1, pz1] },
      { dir: [-1, 0], seg: [px0, pz0 + D, px0 + D, pz1 - D] },
      { dir: [1, 0], seg: [px1 - D, pz0 + D, px1, pz1 - D] },
    ];
    let border = 0;
    for (const s of sides) {
      const isFront = Math.abs(s.dir[0] - n[0]) < 0.3 && Math.abs(s.dir[1] - n[1]) < 0.3;
      if (isFront) continue;
      const [x0, z0, x1, z1] = s.seg;
      hedge(x0, z0, x1, z1);
      // A border bed in front of the hedge: soil, shrubs, flowers and ferns, broken where the house or the terrace come close.
      const alongX = Math.abs(s.dir[1]) > 0.5;
      const inward = alongX ? -s.dir[1] : -s.dir[0];
      const line = alongX ? (s.dir[1] < 0 ? z1 : z0) : s.dir[0] < 0 ? x1 : x0;
      const lo = (alongX ? px0 : pz0) + 3.6;
      const hi = (alongX ? px1 : pz1) - 3.6;
      const depth = 1.1;
      const at = (u: number, d: number): P2 => (alongX ? [u, line + inward * d] : [line + inward * d, u]);
      const blocked = (u: number): boolean => {
        const p = at(u, depth / 2);
        return inHouse(p[0], p[1], 1.2) || onTerrace(p[0], p[1], 0.8) || nearPath(p[0], p[1], 1.6);
      };
      let u = lo;
      while (u < hi) {
        while (u < hi && blocked(u)) u += 0.5;
        const start = u;
        while (u < hi && !blocked(u)) u += 0.5;
        const end = Math.min(u, hi);
        if (end - start < 2) continue;
        const a = at(start, 0.05);
        const b = at(end, depth);
        out.push({ id: `${bid}-border${border}`, parent: bid, name: 'Border bed', transform: { position: [0, 0.035, 0] }, shape: { kind: 'procedural', generator: 'arch-slab', params: { polygon: rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])), thickness: 0.06, finish: SOIL, edge: EDGING } as unknown as Record<string, Json> }, arch: { role: 'site', kind: 'bed', name: 'Border bed' }, tags: ['arch', 'site'], castShadow: false });
        let j = 0;
        for (let v = start + 0.6; v <= end - 0.5; v += 1.05) {
          const p = at(v + between(-0.12, 0.12), depth * between(0.35, 0.65));
          const pick = j % 4;
          const shape: EntityInput['shape'] =
            pick === 0 || pick === 2
              ? { kind: 'procedural', generator: 'shrub', params: { size: r(between(0.8, 1.15)), color: pick === 0 ? '#4b6c35' : '#647f43', variant: j % 2, detail: 0.8 }, seed: Math.floor(rand() * 100000) }
              : pick === 1
                ? { kind: 'procedural', generator: 'wildflowers', params: { size: 0.5, color: border % 2 === 0 ? '#a48ad0' : '#e8d9a8', variant: 0 }, seed: Math.floor(rand() * 100000) }
                : { kind: 'procedural', generator: 'fern', params: { size: 0.6, color: '#557a3a' }, seed: Math.floor(rand() * 100000) };
          out.push({ id: `${bid}-border${border}-p${j}`, parent: bid, name: 'Planting', transform: { position: [r(p[0]), 0.04, r(p[1])], rotation: [0, r(between(0, 360)), 0] }, shape, arch: { role: 'site', kind: 'planting', name: 'Planting' }, tags: ['arch', 'site'] });
          j++;
        }
        border++;
      }
    }

    // --- planted beds along the front facade, either side of the door -----------------------------------------------
    if (g.entry) {
      const { c } = g.entry;
      const t: P2 = [-n[1], n[0]];
      const faceOff = g.ext + 0.05;
      const bedDepth = 1.1;
      // The facade's extent along t (house bounds projected).
      const ends = Math.abs(t[0]) > 0.5 ? [hx0, hx1] : [hz0, hz1];
      const cAlong = Math.abs(t[0]) > 0.5 ? c[0] : c[1];
      const spans: Array<[number, number]> = [[ends[0] as number + 0.3, cAlong - g.entry.width / 2 - 1.1], [cAlong + g.entry.width / 2 + 1.1, ends[1] as number - 0.3]];
      let k = 0;
      for (const [u0, u1] of spans) {
        if (u1 - u0 < 1.2) continue;
        const pt = (u: number, d: number): P2 => (Math.abs(t[0]) > 0.5 ? [u, c[1] + n[1] * d] : [c[0] + n[0] * d, u]);
        const a = pt(u0, faceOff);
        const b = pt(u1, faceOff + bedDepth);
        const mid = pt((u0 + u1) / 2, faceOff + bedDepth / 2);
        if (onTerrace(mid[0], mid[1], 0) || (g.pool && mid[0] > g.pool[0] - 1 && mid[0] < g.pool[2] + 1 && mid[1] > g.pool[1] - 1 && mid[1] < g.pool[3] + 1)) continue;
        out.push({ id: `${bid}-bed${k}`, parent: bid, name: 'Planted bed', transform: { position: [0, 0.035, 0] }, shape: { kind: 'procedural', generator: 'arch-slab', params: { polygon: rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])), thickness: 0.06, finish: SOIL, edge: EDGING } as unknown as Record<string, Json> }, arch: { role: 'site', kind: 'bed', name: 'Planted bed' }, tags: ['arch', 'site'], castShadow: false });
        // Shrubs and lavender-like flowers alternating along the bed.
        let j = 0;
        for (let u = u0 + 0.5; u <= u1 - 0.4; u += 0.9) {
          const p = pt(u + between(-0.1, 0.1), faceOff + bedDepth * between(0.4, 0.6));
          const shrub = j % 3 !== 1;
          out.push({
            id: `${bid}-bed${k}-p${j}`,
            parent: bid,
            name: shrub ? 'Shrub' : 'Flowers',
            transform: { position: [r(p[0]), 0.04, r(p[1])], rotation: [0, r(between(0, 360)), 0] },
            shape: shrub
              ? { kind: 'procedural', generator: 'shrub', params: { size: r(between(0.75, 1.05)), color: j % 2 === 0 ? '#4e6f37' : '#5d7a3e', variant: 0, detail: 0.8 }, seed: Math.floor(rand() * 100000) }
              : { kind: 'procedural', generator: 'wildflowers', params: { size: 0.45, color: '#9c84c9', variant: 0 }, seed: Math.floor(rand() * 100000) },
            arch: { role: 'site', kind: 'planting', name: shrub ? 'Shrub' : 'Flowers' },
            tags: ['arch', 'site'],
          });
          j++;
        }
        k++;
      }
    }

    // --- trees in the plot corners, boulders by the beds -------------------------------------------------------------
    // Trees frame the house from behind and the sides; the front corners stay open so the house is seen from the approach.
    const cxm = (px0 + px1) / 2;
    const czm = (pz0 + pz1) / 2;
    const corners: P2[] = [[px0 + 2.2, pz0 + 2.2], [px1 - 2.2, pz0 + 2.2], [px1 - 2.2, pz1 - 2.2], [px0 + 2.2, pz1 - 2.2], [px0 + 2.4, czm], [px1 - 2.4, czm], [cxm, pz0 + 2.4], [cxm, pz1 - 2.4]].filter(([x, z]) => (x - cxm) * n[0] + (z - czm) * n[1] < 0.5) as P2[];
    let tree = 0;
    for (const [x, z] of corners) {
      if (inHouse(x, z, 2.6) || onTerrace(x, z, 1.2) || nearPath(x, z, 2.4)) continue;
      out.push({ id: `${bid}-tree${tree}`, parent: bid, name: 'Garden tree', transform: { position: [r(x), 0, r(z)], rotation: [0, r(between(0, 360)), 0] }, shape: { kind: 'procedural', generator: 'tree-broadleaf', params: { height: r(between(6.5, 8.5)), variant: tree % 3, color: tree % 2 === 0 ? '#557a36' : '#68863f', detail: 0.8 }, seed: Math.floor(rand() * 100000) }, physics: { body: 'static' }, arch: { role: 'site', kind: 'tree', name: 'Tree' }, tags: ['arch', 'site', 'tree'] });
      tree++;
    }
    for (let k = 0; k < 3; k++) {
      const x = between(px0 + 1.2, px1 - 1.2);
      const z = between(pz0 + 1.2, pz1 - 1.2);
      if (inHouse(x, z, 1.5) || onTerrace(x, z, 0.8) || nearPath(x, z, 1.5)) continue;
      out.push({ id: `${bid}-stone${k}`, parent: bid, name: 'Boulder', transform: { position: [r(x), -0.08, r(z)], rotation: [0, r(between(0, 360)), 0] }, shape: { kind: 'procedural', generator: 'boulder', params: { size: r(between(0.6, 1.1)), lichen: 0.3, variant: 0 }, seed: Math.floor(rand() * 100000) }, arch: { role: 'site', kind: 'boulder', name: 'Boulder' }, tags: ['arch', 'site'] });
    }
  }

  if (g.surroundings === 'estate') {
    const cx = (px0 + px1) / 2;
    const cz = (pz0 + pz1) / 2;
    const pad = Math.hypot(px1 - px0, pz1 - pz0) / 2 + 3;
    const size = 360;
    const land = `${bid}-land`;
    const laneEnd: P2 = [cx + n[0] * 80, cz + n[1] * 80];
    // The pad of the estate variant is exactly at the terrain's lowest height (no lake), so the plot sits at y = 0 (two
    // centimetres under it, so it never fights a world ground plane); a sunk pool's basin shows through a cut.
    const cut = g.pool ? { cutX0: r(g.pool[0] + 0.1), cutZ0: r(g.pool[1] + 0.1), cutX1: r(g.pool[2] - 0.1), cutZ1: r(g.pool[3] - 0.1) } : {};
    out.push({ id: land, parent: bid, name: 'Land', transform: { position: [0, -0.02, 0] }, shape: { kind: 'procedural', generator: 'terrain', params: { size, height: 42, resolution: 192, roughness: 0.5, color: '#6f8a4c', variant: 5, padX: r(cx), padZ: r(cz), padRadius: r(pad), laneX: r(laneEnd[0]), laneZ: r(laneEnd[1]), laneRadius: 2.6, ...cut }, seed: (g.seed % 100000) + 17 }, physics: { body: 'static', friction: 0.9 }, arch: { role: 'site', kind: 'terrain', name: 'Land' }, tags: ['arch', 'site', 'terrain'] });
    const pts = (count: number, rMin: number, rMax: number, spacing: number, avoidLane: number): Json => {
      const res: Array<[number, number, number]> = [];
      for (let i = 0; i < count * 4 && res.length < count; i++) {
        const a = rand() * Math.PI * 2;
        const d = Math.sqrt(rMin * rMin + rand() * (rMax * rMax - rMin * rMin));
        const x = cx + Math.cos(a) * d;
        const z = cz + Math.sin(a) * d;
        if (Math.abs(x) > size / 2 - 6 || Math.abs(z) > size / 2 - 6) continue;
        if (x > px0 - 2 && x < px1 + 2 && z > pz0 - 2 && z < pz1 + 2) continue;
        // Keep the drive clear.
        const lx = laneEnd[0] - cx;
        const lz = laneEnd[1] - cz;
        const t = Math.max(0, Math.min(1, ((x - cx) * lx + (z - cz) * lz) / (lx * lx + lz * lz)));
        if (Math.hypot(x - cx - lx * t, z - cz - lz * t) < avoidLane) continue;
        if (spacing > 0 && res.some((q) => Math.abs(q[0] - x) < spacing && Math.abs(q[2] - z) < spacing)) continue;
        res.push([r(x), 0, r(z)]);
      }
      return res;
    };
    const grove = (id: string, name: string, generator: string, params: Record<string, Json>, points: Json, scale: [number, number]): void => {
      const count = Array.isArray(points) ? points.length : 0;
      if (count === 0) return;
      out.push({ id: `${bid}-${id}`, parent: bid, name, transform: { position: [0, 0, 0] }, shape: { kind: 'scatter', of: { kind: 'procedural', generator, params }, count, area: [size, size], seed: Math.floor(rand() * 100000), scaleRange: scale, onSurface: land, points: points as Array<[number, number, number]> }, arch: { role: 'site', kind: 'grove', name }, tags: ['arch', 'site', 'grove'] });
    };
    grove('oaks', 'Broadleaf trees', 'tree-broadleaf', { height: 10, detail: 0.55, color: '#55783a', variant: 1 }, pts(70, pad + 10, 150, 6, 7), [0.75, 1.3]);
    grove('spruce', 'Spruce wood', 'tree-spruce', { height: 14, detail: 0.5, color: '#2f4d33' }, pts(150, pad + 30, 175, 5, 9), [0.7, 1.35]);
    grove('birch', 'Birches', 'tree-birch', { height: 9, detail: 0.6 }, pts(30, pad + 8, 80, 5, 6), [0.8, 1.2]);
    grove('shrubs', 'Shrubs', 'shrub', { size: 1.3, detail: 0.6, color: '#5a7a3e' }, pts(200, pad + 4, 140, 2, 4), [0.7, 1.5]);
    grove('meadow', 'Meadow grass', 'meadow-grass', { size: 0.55, color: '#7f9a52' }, pts(4200, pad + 1.5, 70, 0, 3.5), [0.7, 1.4]);
    grove('flowers', 'Wildflowers', 'wildflowers', { size: 0.45, color: '#ece6c2', variant: 1 }, pts(500, pad + 2, 60, 0, 3.5), [0.7, 1.3]);
    grove('rocks', 'Boulders', 'boulder', { size: 1.5, lichen: 0.35, variant: 0 }, pts(30, pad + 6, 150, 4, 5), [0.5, 1.6]);
  }
  return { entities: out, plot };
}
