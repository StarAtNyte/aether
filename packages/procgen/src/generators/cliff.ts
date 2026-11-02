/**
 * Sheer limestone cliff, built as one wrapped skin rather than a displaced plane on a box.
 *
 * The plan is a rounded rectangle: the face runs along the front (+Z), turns back round both ends and closes against a
 * back wall `depth` behind it, so the silhouette is never a box edge. Up the face the rock is cut into strata of varying
 * thickness; every bed has its own outward offset, and the step between two beds is an explicit horizontal strip, so a
 * ledge (the lower bed juts) or an overhang (the upper bed juts) breaks light and shadow hard instead of being smoothed
 * away. Gullies and vertical joints cut through the beds, the top edge is uneven and notched where the gullies reach it,
 * and a cap closes the top.
 *
 * Colour is per vertex (the photographed rock finish multiplies it): cream-white beds with honey and grey ones between,
 * vertical honey and grey streaks, dark water stains running down from under every ledge and overhang, darker gullies
 * and joints, soil on the ledge tops and damp rock at the foot. UVs run in metres along the face (u = distance along
 * the plan, v = height), so the texture keeps its scale on every vertical face.
 */
import type { MaterialSpec } from '@aether/core';
import type { InternalApi } from '../api';
import { MeshBuilder, type Mesh } from '../kernel/mesh';
import { mixHex, mixLinear, type RGB } from '../color';
import { lin, triBoxUvs } from './kit';
import { FOLIAGE_CELLS, foliageCellUv } from '../foliage-pixels';

/** Rock part of the face (albedo per vertex) and of the scree at its foot: two parts, so the cliff keeps its own colours. */
const FACE_MAT: MaterialSpec = { finish: 'rock', color: '#ffffff', vertexColors: true, roughness: 0.9 };
const LEAF_MAT: MaterialSpec = { foliage: 'shrub', color: '#ffffff', vertexColors: true, roughness: 0.8, metalness: 0 };
const SCREE_MAT: MaterialSpec = { finish: 'rock', color: '#ffffff', vertexColors: true, roughness: 0.95 };

/** Quads the face, cap and back may use (two triangles each): the whole cliff stays under ~9 k triangles. */
const MAX_QUADS = 3300;
/** Mean standing of the face in front of z = 0, and the furthest it juts (before the overhanging variant's lean). */
const FRONT = 1.5;
const FRONT_MAX = 3.2;

interface Band {
  /** Bottom and top of the bed (metres, before the gentle waviness along the face). */
  y0: number;
  y1: number;
  /** Outward offset of the bed (positive juts out as a ledge, negative is a recessed soft bed). */
  off: number;
  /** Extra outward lean of the overhanging variant. */
  lean: number;
  hard: boolean;
  /** Row positions across the bed, 0 (bottom) to 1 (top). */
  rows: number[];
  tint: RGB;
  /** How strongly water stains the bed below its top (from a ledge or an overhang above). */
  stain: number;
}

interface Gully {
  s: number;
  w: number;
  d: number;
}

interface Joint {
  s: number;
  w: number;
  d: number;
  y0: number;
  y1: number;
}

/** Point on the plan path: position and outward normal (XZ). */
interface PlanPoint {
  x: number;
  z: number;
  nx: number;
  nz: number;
  /** 0 on the front, 1 on the end arcs and sides (inward displacement is limited there). */
  bend: number;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface CliffParams {
  width: number;
  height: number;
  depth: number;
  color: string;
  /** 0 thin-bedded limestone with many ledges, 1 massive jointed limestone, 2 overhanging. */
  variant: number;
}

/** Build the cliff into `api` (face part, scree part). Returns nothing: the caller adds the collider. */
export function buildCliff(api: InternalApi, P: CliffParams): void {
  const W = P.width;
  const H = P.height;
  const D = P.depth;
  const v = P.variant;
  const noise2 = (x: number, y: number): number => api.noise2(x, y);
  const fbm = (x: number, y: number, o = 3): number => api.fbm2(x, y, o);
  // Relief amplitude: full on a large cliff, gentler on a small or thin one.
  const A = Math.min(1, H / 20, D / 8);
  const Dt = D + 0.8;
  const R = Math.max(0.8, Math.min(D * 0.7, W * 0.2, 9));
  const sideLen = Math.max(0, Dt - R);
  const arc = (Math.PI * R) / 2;
  const front = W - 2 * R;
  const L = 2 * sideLen + 2 * arc + front;
  const frontS0 = sideLen + arc;
  const frontS1 = frontS0 + front;
  const maxIn = 0.8 * R;

  const plan = (s: number): PlanPoint => {
    if (s < sideLen) return { x: -W / 2, z: -Dt + s, nx: -1, nz: 0, bend: 1 };
    if (s < frontS0) {
      const t = (s - sideLen) / R;
      return { x: -W / 2 + R - R * Math.cos(t), z: -R + R * Math.sin(t), nx: -Math.cos(t), nz: Math.sin(t), bend: 1 };
    }
    if (s <= frontS1) return { x: -W / 2 + R + (s - frontS0), z: 0, nx: 0, nz: 1, bend: 0 };
    if (s < frontS1 + arc) {
      const t = (s - frontS1) / R;
      return { x: W / 2 - R + R * Math.sin(t), z: -R + R * Math.cos(t), nx: Math.sin(t), nz: Math.cos(t), bend: 1 };
    }
    return { x: W / 2, z: -R - (s - frontS1 - arc), nx: 1, nz: 0, bend: 1 };
  };

  // --- Palette from the rock colour: cream-white body, whiter, honey and grey beds and streaks, dark water stains.
  const C = P.color;
  const cream = mixHex(C, '#fdf5e4', 0.8);
  const pal = {
    cream: lin(cream),
    white: lin(mixHex(cream, '#fffcf4', 0.6)),
    honey: lin(mixHex(cream, '#d1a062', 0.62)),
    grey: lin(mixHex(C, '#a19f99', 0.55)),
    stain: lin(mixHex(C, '#4a4337', 0.72)),
    soil: lin(mixHex(C, '#7d7458', 0.6)),
    shade: lin(mixHex(C, '#5d574b', 0.55)),
  };

  // --- Strata: beds of varying thickness, grouped (thin packages between massive beds), set back in tiers up the face.
  const sH = Math.min(2.6, Math.max(0.6, H / 34));
  const thinShare = v === 1 ? 0.2 : 0.36;
  const thickShare = v === 1 ? 0.36 : 0.18;
  const tiers: Array<{ y: number; back: number }> = [];
  const nTiers = H > 14 ? 1 : 0;
  for (let i = 0; i < nTiers; i++) tiers.push({ y: H * api.range(0.3 + i * 0.3, 0.45 + i * 0.3), back: api.range(1.0, 1.8) * A });
  const bands: Band[] = [];
  let y = -0.5;
  let thinRun = 0;
  while (y < H - 0.3) {
    const r = api.rng();
    let t: number;
    if (thinRun > 0 || r < thinShare) {
      t = api.range(0.45, 1.05);
      thinRun = thinRun > 0 ? thinRun - 1 : Math.floor(api.range(1, 4));
    } else if (r < thinShare + thickShare) t = api.range(2.8, 5.5);
    else t = api.range(1.2, 2.6);
    t *= sH;
    if (H - (y + t) < 0.8 * sH) t = H - y;
    const hard = t > 2.4 * sH ? api.rng() < 0.8 : api.rng() < (v === 1 ? 0.6 : 0.5);
    const mid = y + t / 2;
    let off = hard ? api.range(0.5, 1.2) : api.range(-1.1, -0.45);
    if (hard && api.rng() < 0.2) off += api.range(0.6, 1.2);
    off *= A;
    // A tier: the beds below stand forward of those above it, so a broad ledge runs along the face.
    for (const tier of tiers) off += mid > tier.y ? -tier.back / 2 : tier.back / 2;
    const lean = v === 2 ? Math.min(8, Math.max(0, (mid / H - 0.55) * 2.4) * D * 0.25) : 0;
    // A bed's colour: mostly cream, some whiter, honey or grey beds.
    const k = api.rng();
    const tint: RGB = [0, 0, 0];
    if (k < 0.42) mixLinear(pal.cream, pal.white, api.range(0, 0.3), tint);
    else if (k < 0.62) mixLinear(pal.cream, pal.white, api.range(0.5, 1), tint);
    else if (k < 0.82) mixLinear(pal.cream, pal.honey, api.range(0.3, 0.75), tint);
    else mixLinear(pal.cream, pal.grey, api.range(0.4, 0.85), tint);
    // The photographed rock finish under the tint is mid-grey brown: pale beds are tinted a little past white to read cream.
    const bright = api.range(1.08, 1.25);
    tint[0] *= bright;
    tint[1] *= bright;
    tint[2] *= bright;
    const rows = [0];
    if (hard && t > 1.1) rows.push(Math.min(0.3, 0.45 / t));
    const inner = Math.max(1, Math.round(t / (3.2 * Math.max(1, sH * 0.8))));
    for (let j = 1; j < inner; j++) rows.push(j / inner);
    rows.push(1);
    rows.sort((a, b) => a - b);
    bands.push({ y0: y, y1: y + t, off, lean, hard, rows, tint, stain: 0 });
    y += t;
  }
  // Stains: below a bed that juts out over the one beneath it, and from the lip of every ledge.
  for (let b = 0; b < bands.length; b++) {
    const cur = bands[b] as Band;
    const above = bands[b + 1];
    const over = above ? Math.max(0, above.off - cur.off) : 0;
    cur.stain = Math.min(1, 0.35 + over * 0.5 + (cur.hard ? 0.25 : 0));
  }

  // --- Gullies and joints, on the front only (the end arcs keep their curvature clean).
  const gullies: Gully[] = [];
  const nG = Math.max(front > 12 ? 1 : 0, Math.round(front / (v === 1 ? 20 : 30)));
  for (let i = 0; i < nG; i++) {
    gullies.push({ s: frontS0 + front * ((i + api.range(0.25, 0.75)) / nG), w: api.range(2, 4.5) * Math.max(0.7, A), d: api.range(1.8, 3.8) * A });
  }
  // --- Column budget: the quads of every row (face beds, the steps between them, the cap) share MAX_QUADS.
  const quadRows = bands.reduce((n, b) => n + b.rows.length - 1, 0) + (bands.length - 1) + 3;
  const budgetCols = Math.max(16, Math.floor(MAX_QUADS / quadRows));
  const joints: Joint[] = [];
  const nJ = Math.min(Math.round(front / (v === 1 ? 7 : 10)), Math.floor((budgetCols * 0.25) / 3));
  for (let i = 0; i < nJ; i++) {
    const s = frontS0 + front * ((i + api.range(0.15, 0.85)) / Math.max(1, nJ));
    if (gullies.some((g) => Math.abs(g.s - s) < g.w + 1)) continue;
    const y0 = api.rng() < 0.5 ? -1 : H * api.range(0, 0.5);
    const w = api.range(0.35, 0.6);
    joints.push({ s, w, d: Math.min(1.5 * w, api.range(0.5, 1.3) * Math.max(0.5, A)), y0, y1: Math.min(H + 1, y0 + H * api.range(0.4, 1.1)) });
  }

  // --- Columns: even spacing within the quad budget, plus the edges and middle of every joint.
  const nCols = Math.max(12, budgetCols - joints.length * 3);
  const cols: number[] = [];
  for (let i = 0; i <= nCols; i++) {
    const s = (L * i) / nCols;
    // A joint is cut by its own three columns; an even column inside it would only make slivers.
    if (!joints.some((j) => Math.abs(s - j.s) < j.w + 0.15)) cols.push(s);
  }
  cols.push(0, L);
  for (const j of joints) cols.push(j.s - j.w, j.s, j.s + j.w);
  cols.sort((a, b) => a - b);
  const S: number[] = [];
  for (const s of cols) if (S.length === 0 || s - (S[S.length - 1] as number) > 0.12) S.push(s);
  S[S.length - 1] = L;

  // --- Displacement fields along the plan normal.
  const dip = api.range(-0.015, 0.015);
  const waveAmp = (b: number): number => {
    const lo = bands[b - 1];
    const hi = bands[b];
    return 0.22 * Math.min(lo ? lo.y1 - lo.y0 : 1, hi ? hi.y1 - hi.y0 : 1);
  };
  /** Height of the boundary below bed `b` at `s` (strata stay level but wander a little and dip gently). */
  const boundaryY = (b: number, s: number): number => {
    const band = bands[b] as Band;
    if (b === 0) return band.y0;
    return band.y0 + noise2(s * 0.035, b * 2.37) * waveAmp(b) + (s - L / 2) * dip;
  };
  const yBack = H * 0.84;
  /** Uneven top edge: broad dips, a few crenels, notched where a gully reaches it; level with the back at the ends. */
  const topAt = (s: number): number => {
    let t = H * (1 - 0.1 * (0.5 + 0.5 * fbm(s * 0.03, 9.1)) - 0.035 * Math.max(0, noise2(s * 0.16, 4.2)));
    for (const g of gullies) {
      const d = Math.abs(s - g.s) / (g.w * 1.6);
      if (d < 1) t -= g.d * 1.2 * (1 - d * d);
    }
    t = Math.max(H * 0.78, t);
    const end = Math.min(smooth(0, 2.5, s), smooth(0, 2.5, L - s));
    return yBack + (t - yBack) * end;
  };
  const endFade = (s: number): number => Math.min(smooth(0, 3, s), smooth(0, 3, L - s));
  /** Recess (≤ 0) cut by gullies and joints at (s, y). */
  const cutAt = (s: number, yy: number): number => {
    let c = 0;
    for (const g of gullies) {
      const gs = g.s + noise2(yy * 0.05, g.s) * 1.2;
      const d = Math.abs(s - gs) / g.w;
      if (d < 1) c -= g.d * (1 - d * d) * (0.75 + 0.25 * smooth(0, H, yy));
    }
    for (const j of joints) {
      if (yy < j.y0 || yy > j.y1) continue;
      const d = Math.abs(s - j.s) / j.w;
      if (d < 1) c -= j.d * (1 - d) * Math.min(smooth(j.y0, j.y0 + 1.5, yy), 1 - smooth(j.y1 - 1.5, j.y1, yy));
    }
    return c;
  };
  /** Displacement of bed `b` at (s, height y, position t across the bed). */
  const dispAt = (b: number, s: number, yy: number, t: number, pt: PlanPoint): { d: number; cut: number } => {
    const band = bands[b] as Band;
    // Buttresses and bays, changing slowly with height.
    const big = fbm(s * 0.022, yy * 0.006 + 3.7, 3) * 1.2 * A;
    // A ledge comes and goes along the face.
    const breakMul = band.off > 0 ? Math.min(1, Math.max(0, 0.55 + 1.3 * noise2(s * 0.06, b * 5.1))) : 1;
    let prof = 0;
    if (band.hard) prof = t < 0.25 ? -0.35 * A * (1 - t / 0.25) : 0;
    else prof = -0.25 * A;
    // Vertical rills and flutes (limestone weathers in vertical grooves), a little roughness across them.
    const fine = fbm(s * 0.32, yy * 0.04, 3) * 0.28 * A + noise2(s * 0.2, yy * 0.2) * 0.1 * A;
    const cut = cutAt(s, yy);
    // The face stands a little forward of z = 0 (where the old flat face stood) and never far past it, so scenes laid
    // out around the face (a plateau behind it, walls beside it) still see it.
    let d = Math.min(FRONT_MAX, FRONT * A + big + band.off * breakMul + prof + fine) + cut + band.lean;
    if (pt.bend > 0) d = Math.max(-maxIn, Math.min(1, d));
    else d = Math.max(-Dt * 0.6, d);
    return { d: d * endFade(s), cut };
  };

  // --- Colour of a vertex.
  const tmp: RGB = [0, 0, 0];
  const colourAt = (kind: 'face' | 'up' | 'down' | 'cap' | 'back', b: number, s: number, yy: number, cut: number, out: RGB): void => {
    const band = bands[Math.min(bands.length - 1, Math.max(0, b))] as Band;
    out[0] = band.tint[0];
    out[1] = band.tint[1];
    out[2] = band.tint[2];
    // Broad honey washes and fine vertical honey and grey streaks.
    mixLinear(out, pal.honey, Math.max(0, fbm(s * 0.045, yy * 0.018 + 1.3)) * 0.45, out);
    mixLinear(out, pal.honey, smooth(0.45, 0.85, noise2(s * 0.55, yy * 0.025 + 7.1)) * 0.4, out);
    mixLinear(out, pal.grey, smooth(0.3, 0.8, noise2(s * 0.42 + 13.7, yy * 0.02)) * 0.5, out);
    if (kind === 'face' || kind === 'down') {
      // Water stains: streaks running down from the bed's top (under a ledge lip or an overhang), fading downward.
      const below = band.y1 - yy;
      const streak = smooth(-0.15, 0.55, noise2(s * 0.75 + b * 3.1, b * 1.7)) * (0.6 + 0.4 * noise2(s * 2.1, b));
      const len = 1.2 + (band.y1 - band.y0) * 0.9;
      mixLinear(out, pal.stain, Math.min(0.7, band.stain * streak * Math.exp(-below / len) * 0.8), out);
      // Long dark streaks from the top edge down the face.
      const long = smooth(0.35, 0.8, noise2(s * 0.3 + 31.7, 2.2)) * smooth(H * 0.15, H, yy);
      mixLinear(out, pal.stain, long * 0.3, out);
      // Gullies and joints hold shade and run with water.
      if (cut < 0) mixLinear(out, pal.stain, Math.min(0.65, -cut * 0.22), out);
      // Damp rock at the foot.
      mixLinear(out, pal.stain, (1 - smooth(-0.5, 2.2, yy)) * 0.45, out);
    }
    if (kind === 'down') mixLinear(out, pal.shade, 0.45, out);
    if (kind === 'up' || kind === 'cap') mixLinear(out, pal.soil, 0.25 + 0.25 * Math.max(0, noise2(s * 0.4, yy * 0.4)), out);
    if (kind === 'back') mixLinear(out, pal.grey, 0.5, out);
  };

  // --- Face and cap and back (smooth within a bed), ledge strips (flat).
  const nS = S.length;
  const faceB = new MeshBuilder(nS * 64, nS * 64 * 6);
  const faceCol: number[] = [];
  const ledgeB = new MeshBuilder(nS * bands.length * 2, nS * bands.length * 6);
  const ledgeCol: number[] = [];
  const pts = S.map(plan);
  const rowOf = (B: MeshBuilder, colArr: number[], xyz: Array<[number, number, number]>, nrm: (i: number) => [number, number, number], uv: (i: number) => [number, number], col: (i: number) => RGB): number => {
    const first = B.vcount;
    for (let i = 0; i < xyz.length; i++) {
      const p = xyz[i] as [number, number, number];
      const n = nrm(i);
      const t = uv(i);
      B.vertex(p[0], p[1], p[2], n[0], n[1], n[2], t[0], t[1]);
      const c = col(i);
      colArr.push(c[0], c[1], c[2]);
    }
    return first;
  };
  const strip = (B: MeshBuilder, a: number, b: number): void => {
    for (let i = 0; i < nS - 1; i++) B.quad(a + i, a + i + 1, b + i + 1, b + i);
  };
  // The uneven top lowers the upper part of the face: heights above 0.3 H are squeezed so H lands on the top edge
  // (beds up there thin a little where the edge dips; the lower strata stay level).
  const tops0 = S.map(topAt);
  const lower = (yy: number, top: number): number => (yy <= H * 0.3 ? yy : yy - ((H - top) * (yy - H * 0.3)) / (H * 0.7));
  const spots: Array<{ x: number; y: number; z: number; nx: number; nz: number; wide: number }> = [];
  const tops: Array<[number, number, number]> = [];
  const topCuts: number[] = [];
  let prevTop: { pos: Array<[number, number, number]>; cut: number[] } | null = null;
  for (let b = 0; b < bands.length; b++) {
    const band = bands[b] as Band;
    const yLo = S.map((s, i) => lower(boundaryY(b, s), tops0[i] as number));
    const yHi = S.map((s, i) => (b + 1 < bands.length ? lower(boundaryY(b + 1, s), tops0[i] as number) : (tops0[i] as number)));
    let prevRow = -1;
    let firstRow: { pos: Array<[number, number, number]>; cut: number[] } | null = null;
    let lastRow: { pos: Array<[number, number, number]>; cut: number[] } = { pos: [], cut: [] };
    for (const t of band.rows) {
      const pos: Array<[number, number, number]> = [];
      const cuts: number[] = [];
      for (let i = 0; i < nS; i++) {
        const s = S[i] as number;
        const pt = pts[i] as PlanPoint;
        const yy = (yLo[i] as number) + ((yHi[i] as number) - (yLo[i] as number)) * t;
        const { d, cut } = dispAt(b, s, yy, t, pt);
        pos.push([pt.x + pt.nx * d, yy, pt.z + pt.nz * d]);
        cuts.push(cut);
      }
      const row = rowOf(faceB, faceCol, pos, (i) => [(pts[i] as PlanPoint).nx, 0, (pts[i] as PlanPoint).nz], (i) => [S[i] as number, (pos[i] as [number, number, number])[1]], (i) => {
        colourAt('face', b, S[i] as number, (pos[i] as [number, number, number])[1], cuts[i] as number, tmp);
        return tmp;
      });
      if (prevRow >= 0) strip(faceB, prevRow, row);
      prevRow = row;
      if (!firstRow) firstRow = { pos, cut: cuts };
      lastRow = { pos, cut: cuts };
    }
    // The step between the bed below and this one: a ledge where the lower bed juts, an overhang where this one does.
    if (prevTop && firstRow) {
      const lo = prevTop;
      const hi = firstRow;
      const upward = (i: number): boolean => {
        const pt = pts[i] as PlanPoint;
        const a = lo.pos[i] as [number, number, number];
        const c = hi.pos[i] as [number, number, number];
        return (a[0] - c[0]) * pt.nx + (a[2] - c[2]) * pt.nz >= 0;
      };
      const ledgeUv = (p: [number, number, number], i: number): [number, number] => [S[i] as number, -((p[0] * (pts[i] as PlanPoint).nx + p[2] * (pts[i] as PlanPoint).nz))];
      const ledgeColour = (p: [number, number, number], i: number, bed: number): RGB => {
        colourAt(upward(i) ? 'up' : 'down', bed, S[i] as number, p[1], 0, tmp);
        return tmp;
      };
      const a = rowOf(ledgeB, ledgeCol, lo.pos, () => [0, 1, 0], (i) => ledgeUv(lo.pos[i] as [number, number, number], i), (i) => ledgeColour(lo.pos[i] as [number, number, number], i, upward(i) ? b - 1 : b));
      const c = rowOf(ledgeB, ledgeCol, hi.pos, () => [0, 1, 0], (i) => ledgeUv(hi.pos[i] as [number, number, number], i), (i) => ledgeColour(hi.pos[i] as [number, number, number], i, upward(i) ? b - 1 : b));
      strip(ledgeB, a, c);
      // Ledge tops wide enough to hold soil are where plants take hold.
      for (let i = 1; i < nS - 1; i++) {
        if ((pts[i] as PlanPoint).bend > 0 || !upward(i)) continue;
        const pa = lo.pos[i] as [number, number, number];
        const pc = hi.pos[i] as [number, number, number];
        const pt = pts[i] as PlanPoint;
        const wide = (pa[0] - pc[0]) * pt.nx + (pa[2] - pc[2]) * pt.nz;
        if (wide > 0.7) spots.push({ x: (pa[0] + pc[0]) / 2, y: pa[1], z: (pa[2] + pc[2]) / 2, nx: pt.nx, nz: pt.nz, wide });
      }
    }
    prevTop = lastRow;
    if (b === bands.length - 1) {
      tops.push(...lastRow.pos);
      topCuts.push(...lastRow.cut);
    }
  }

  // Cap: from the top edge back to the back wall, a lip, a crest and a slope down to the back.
  const inner = W / 2 - R;
  const capF = [0, 0.05, 0.3, 1];
  let prevCap = -1;
  for (let k = 0; k < capF.length; k++) {
    const f = capF[k] as number;
    const pos: Array<[number, number, number]> = tops.map((p, i) => {
      const pt = pts[i] as PlanPoint;
      const bx = Math.max(-inner, Math.min(inner, pt.x));
      const x = p[0] + (bx - p[0]) * f;
      const z = p[2] + (-Dt - p[2]) * f;
      const lift = k === 1 ? -0.15 * A : k === 2 ? 0.2 * A * (0.5 + 0.5 * fbm(x * 0.08, z * 0.08)) : 0;
      return [x, p[1] + (yBack - p[1]) * f * f + lift * endFade(S[i] as number), z];
    });
    const row = rowOf(ledgeB, ledgeCol, pos, () => [0, 1, 0], (i) => [(pos[i] as [number, number, number])[0], -(pos[i] as [number, number, number])[2]], (i) => {
      colourAt(k === 0 ? 'up' : 'cap', bands.length - 1, S[i] as number, (pos[i] as [number, number, number])[1], 0, tmp);
      return tmp;
    });
    if (prevCap >= 0) strip(ledgeB, prevCap, row);
    prevCap = row;
  }
  // Back wall at z = -Dt, facing -Z.
  const nBack = Math.max(2, Math.ceil(W / 8));
  const backTop: number[] = [];
  const backBot: number[] = [];
  for (let i = 0; i <= nBack; i++) {
    const x = W / 2 - (W * i) / nBack;
    backTop.push(faceB.vertex(x, yBack, -Dt, 0, 0, -1, -x, yBack));
    backBot.push(faceB.vertex(x, -0.5, -Dt, 0, 0, -1, -x, -0.5));
    for (let r = 0; r < 2; r++) {
      colourAt('back', bands.length - 1, x, yBack, 0, tmp);
      faceCol.push(tmp[0] * 0.8, tmp[1] * 0.8, tmp[2] * 0.8);
    }
  }
  for (let i = 0; i < nBack; i++) faceB.quad(backBot[i] as number, backBot[i + 1] as number, backTop[i + 1] as number, backTop[i] as number);

  const face: Mesh = api.fromBuilder(faceB);
  face.colors = Float32Array.from(faceCol);
  face.recomputeNormals();
  const ledges: Mesh = api.fromBuilder(ledgeB);
  ledges.colors = Float32Array.from(ledgeCol);
  face.merge(ledges.toFlat());
  api.add(face, FACE_MAT);

  // --- Plants clinging to the ledges: small shrub clumps of leaf cards, facing out of the rock and up.
  const nClumps = Math.min(26, spots.length, Math.round((front * H) / 190));
  if (nClumps > 0) {
    const sheet = new MeshBuilder(nClumps * 9 * 4, nClumps * 9 * 6);
    const leafCol: number[] = [];
    const deep = lin('#2f3f1e');
    const mid = lin('#5b6f30');
    const sun = lin('#8f9a45');
    const c0: RGB = [0, 0, 0];
    const c1: RGB = [0, 0, 0];
    for (let k = 0; k < nClumps; k++) {
      const sp = spots[Math.floor(api.rng() * spots.length)] as (typeof spots)[number];
      const size = api.range(0.7, 1.5) * Math.min(1.3, Math.max(0.6, sp.wide / 1.2));
      const cards = 7 + Math.floor(api.rng() * 3);
      const tone = api.rng();
      for (let c = 0; c < cards; c++) {
        // The card's normal leans out of the face and up; its plane stands across that normal.
        const a = api.range(-0.9, 0.9);
        const up = api.range(0.35, 0.9);
        let nx = sp.nx * Math.cos(a) - sp.nz * Math.sin(a) * 0.8;
        let nz = sp.nz * Math.cos(a) + sp.nx * Math.sin(a) * 0.8;
        const len = Math.hypot(nx, up, nz);
        nx /= len;
        const ny = up / len;
        nz /= len;
        // u: horizontal across the normal; v = n x u (up the card).
        const ul = Math.hypot(nz, nx) || 1;
        const u: [number, number, number] = [nz / ul, 0, -nx / ul];
        const vv: [number, number, number] = [ny * u[2] - nz * u[1], nz * u[0] - nx * u[2], nx * u[1] - ny * u[0]];
        const w = size * api.range(0.55, 0.9);
        const h = size * api.range(0.5, 0.85);
        const ox = sp.x + api.range(-0.5, 0.5) * size + sp.nx * api.range(-0.2, 0.25) * size;
        const oz = sp.z + api.range(-0.5, 0.5) * size * Math.abs(sp.nx) + sp.nz * api.range(-0.2, 0.25) * size;
        const oy = sp.y - 0.08 + api.range(0, 0.25) * size;
        const [u0, v0, u1, v1] = foliageCellUv(Math.floor(api.rng() * FOLIAGE_CELLS * FOLIAGE_CELLS));
        const corner = (cu: number, cv: number): [number, number, number] => [ox + u[0] * (cu - 0.5) * w + vv[0] * cv * h, oy + vv[1] * cv * h, oz + u[2] * (cu - 0.5) * w + vv[2] * cv * h];
        const quad: Array<[[number, number, number], number, number]> = [[corner(0, 0), u0, v1], [corner(1, 0), u1, v1], [corner(1, 1), u1, v0], [corner(0, 1), u0, v0]];
        const light = Math.min(1, 0.35 + 0.5 * tone + api.range(-0.2, 0.25));
        mixLinear(deep, mid, light, c0);
        mixLinear(mid, sun, light * 0.6, c1);
        const ids = quad.map(([q, tu, tv]) => sheet.vertex(q[0], q[1], q[2], nx, ny, nz, tu, tv));
        sheet.quad(ids[0] as number, ids[1] as number, ids[2] as number, ids[3] as number);
        leafCol.push(c0[0] * 0.6, c0[1] * 0.6, c0[2] * 0.6, c0[0], c0[1], c0[2], c1[0], c1[1], c1[2], c1[0], c1[1], c1[2]);
      }
    }
    const leaves = api.fromBuilder(sheet);
    leaves.colors = Float32Array.from(leafCol);
    api.add(leaves, LEAF_MAT);
  }

  // --- Scree: fallen blocks at the foot, pale where fresh, stained where old.
  const nBoulders = Math.min(10, 4 + Math.round(front / 14));
  let scree: Mesh | null = null;
  for (let i = 0; i < nBoulders; i++) {
    const r = api.range(0.5, 1.5) * Math.min(1.3, H / 15);
    const s = frontS0 + api.range(0.03, 0.97) * front;
    const pt = plan(s);
    const base = dispAt(0, s, 0, 0, pt).d;
    const m = api.icosphereRock(r, 0.5, 1).scale(api.range(1, 1.5), api.range(0.55, 0.8), api.range(0.9, 1.2)).rotate(0, api.range(0, 360), 0);
    m.translate(pt.x, r * 0.3, Math.min(FRONT_MAX + 1 - r, base + api.range(0.2, 1.0) + r * 0.6));
    const fresh = api.rng();
    m.paintFn((x, yy, z, _nx, ny, _nz, out) => {
      mixLinear(pal.white, pal.cream, 0.5 + 0.5 * api.noise.noise3(x * 0.7, yy * 0.7, z * 0.7), out);
      mixLinear(out, pal.grey, fresh * 0.6, out);
      if (ny > 0.5) mixLinear(out, pal.soil, 0.25, out);
      mixLinear(out, pal.stain, Math.max(0, 0.4 - yy * 0.4), out);
    });
    scree = scree ? scree.merge(m) : m;
  }
  if (scree) api.add(triBoxUvs(scree), SCREE_MAT);
}
