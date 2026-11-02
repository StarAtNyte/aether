/**
 * The classical temple: a three-step crepidoma, fluted Doric or Ionic columns with entasis, a full entablature (architrave,
 * triglyph-and-metope or sculpted frieze, cornice with mutules or dentils), pediments with raking cornices and a relief
 * group in the tympanum, acroteria, a tiled roof with antefixes along the eaves, a cella with a pronaos; a round tholos and
 * a ruin variant. Marble is a fine-grained finish (normal and roughness maps) under vertex colour that carries the
 * weathering: per-block tone, faint veins, honey patina at joints and in patches, rain streaks and grime low down and in
 * sheltered undersides. Gilding (the accent colour) on the acroteria, the frieze shields and the pediment figures.
 *
 * Parts are merged by material and kept under ~20k triangles each (the colonnade is split in two), so the renderer's level
 * of detail never takes a large merged part apart.
 */
import type { MaterialSpec } from '@aether/core';
import type { InternalApi } from '../api';
import type { RGB } from '../color';
import { boxCollider, cylinderCollider } from '../colliders';
import { MeshBuilder, type Mesh } from '../kernel/mesh';

type P2 = [number, number];

export interface TempleParams {
  variant: number;
  width: number;
  length: number;
  height: number;
  columns: number;
  color: string;
  roofColor: string;
  accentColor: string;
}

const HONEY: RGB = [0.97, 0.8, 0.56];
const VEIN: RGB = [0.7, 0.72, 0.77];
const GRIME: RGB = [0.7, 0.66, 0.58];
const TYMPANUM: RGB = [0.66, 0.72, 0.8];

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Builder state shared by the parts of one temple. */
interface Ctx {
  api: InternalApi;
  /** Material of plain blocks: the lower building, then the entablature and gables (two parts). */
  cur: MaterialSpec;
  mats: { main: MaterialSpec; upper: MaterialSpec; colsA: MaterialSpec; colsB: MaterialSpec; sculpt: MaterialSpec; gold: MaterialSpec; roof: MaterialSpec; dark: MaterialSpec };
  /** Height of the drum joints of the colonnade (honey stains), as a function of world y; 0 elsewhere. */
  joint: (y: number) => number;
}

/** A block's own tone: most blocks near white, a third of them warmed by a honey patina. */
function blockTone(api: InternalApi): RGB {
  const b = 0.96 + api.rng() * 0.06;
  const h = api.rng() < 0.35 ? api.range(0.1, 0.32) : api.range(0, 0.07);
  return [b * (1 - h * (1 - HONEY[0])), b * (1 - h * (1 - HONEY[1])), b * (1 - h * (1 - HONEY[2]))];
}

/** Paint weathered marble on a mesh already placed in temple space. */
function weather(c: Ctx, m: Mesh, tone: RGB, joints = false): Mesh {
  const api = c.api;
  return m.paintFn((x, y, z, _nx, ny, _nz, out) => {
    const n = api.noise3(x * 0.19 + 13.1, y * 0.19, z * 0.19) + 0.5 * api.noise3(x * 0.55, y * 0.55 + 5.3, z * 0.55);
    const vein = Math.exp(-((n * 7) ** 2)) * 0.45;
    const patch = clamp01(0.45 + 0.9 * api.noise3(x * 0.08 - 4, y * 0.12 + 2, z * 0.08));
    const honey = Math.min(0.6, patch * patch * 0.32 + (joints ? c.joint(y) * 0.45 : 0));
    const streak = Math.max(0, api.noise3(x * 1.3 + 7, y * 0.06 + 2, z * 1.3) - 0.1) * (1 - Math.abs(ny));
    const low = clamp01(1 - y / 1.4);
    const under = Math.max(0, -ny);
    const g = Math.min(0.42, streak * 0.4 + low * low * 0.28 + under * 0.16);
    for (let i = 0; i < 3; i++) {
      let v = tone[i] as number;
      v *= 1 - vein * (1 - (VEIN[i] as number)) * 0.4;
      v *= 1 - honey * (1 - (HONEY[i] as number));
      v *= 1 - g * (1 - (GRIME[i] as number));
      out[i] = v;
    }
  });
}

/** Add one marble block (centre x, y, z) in its own tone. */
function block(c: Ctx, w: number, h: number, d: number, x: number, y: number, z: number, mat?: MaterialSpec, tone?: RGB): void {
  if (w <= 0.005 || h <= 0.005 || d <= 0.005) return;
  c.api.add(weather(c, c.api.box(w, h, d).translate(x, y, z), tone ?? blockTone(c.api)), mat ?? c.cur);
}

/** Split [a, b] into pieces of about `len`, with the joints shifted by `offset` of a piece (staggered courses). */
function spans(a: number, b: number, len: number, offset = 0): Array<[number, number]> {
  const n = Math.max(1, Math.round((b - a) / len));
  const step = (b - a) / n;
  const cuts = [a];
  for (let i = 0; i <= n; i++) {
    const t = a + (i + offset) * step;
    if (t > a + step * 0.2 && t < b - step * 0.2) cuts.push(t);
  }
  cuts.push(b);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < cuts.length; i++) out.push([cuts[i] as number, cuts[i + 1] as number]);
  return out;
}

// --------------------------------------------------------------------------------------------------------------------
// Columns
// --------------------------------------------------------------------------------------------------------------------

interface ColumnSpec {
  ionic: boolean;
  /** Column height, base to abacus top. */
  h: number;
  /** Lower shaft radius. */
  r: number;
  flutes: number;
  drums: number;
  /** Below 1: a broken shaft of that share of its height, no capital. */
  broken: number;
}

/**
 * A fluted shaft between y = a and y = b (each flute its own strip, so the arrises stay sharp), with entasis and a faint
 * groove at each drum joint. Doric: flutes meet in an arris; Ionic: a flat fillet between them.
 */
function fluteShaft(api: InternalApi, s: ColumnSpec, a: number, b: number, top: number): Mesh {
  const r0 = s.r, r1 = s.r * (s.ionic ? 0.84 : 0.78);
  const rad = (y: number): number => {
    const t = (y - a) / (b - a);
    return r0 + (r1 - r0) * t + (r0 - r1) * 0.22 * Math.sin(Math.PI * t);
  };
  const ys: number[] = [a];
  for (let k = 1; k < s.drums; k++) {
    const y = a + ((b - a) * k) / s.drums;
    if (y < top - 0.05) ys.push(y);
  }
  ys.push(top);
  const prof: P2[] = s.ionic ? [[0, 0], [0.2, 0], [0.6, 1], [1, 0]] : [[0, 0], [0.5, 1], [1, 0]];
  const depth = s.r * (s.ionic ? 0.085 : 0.075);
  const groove = s.r * 0.012;
  const m = prof.length;
  const bld = new MeshBuilder(ys.length * s.flutes * m, (ys.length - 1) * s.flutes * (m - 1) * 6);
  for (let k = 0; k < s.flutes; k++) {
    const base = bld.vcount;
    for (let i = 0; i < ys.length; i++) {
      const y = ys[i] as number;
      const isJoint = i > 0 && i < ys.length - 1;
      const rr = rad(y) - (isJoint ? groove : 0);
      for (const [f, dd] of prof) {
        const ang = ((k + f) / s.flutes) * Math.PI * 2;
        const rad2 = rr - depth * dd * (rr / r0);
        const sn = Math.sin(ang), cs = Math.cos(ang);
        bld.vertex(rad2 * sn, y, rad2 * cs, sn, 0, cs, (k + f) / s.flutes, y);
      }
    }
    for (let i = 0; i + 1 < ys.length; i++) {
      for (let j = 0; j + 1 < m; j++) {
        const v0 = base + i * m + j;
        bld.quad(v0, v0 + 1, v0 + m + 1, v0 + m);
      }
    }
  }
  return api.fromBuilder(bld).recomputeNormals();
}

/** One column standing on y = 0 (marble pieces, already in their final local positions). */
function templeColumn(api: InternalApi, s: ColumnSpec): Mesh[] {
  const { h, r } = s;
  const out: Mesh[] = [];
  const capH = s.ionic ? h * 0.075 : h * 0.09;
  const baseH = s.ionic ? h * 0.055 : 0;
  const shaftTop = h - capH;
  const top = s.broken < 1 ? baseH + (shaftTop - baseH) * s.broken : shaftTop;
  const r1 = r * (s.ionic ? 0.84 : 0.78);
  const segs = s.flutes >= 20 ? 20 : 14;
  if (s.ionic) {
    // Square plinth under an attic base: torus, scotia, torus.
    out.push(api.box(r * 2.7, baseH * 0.3, r * 2.7).translate(0, baseH * 0.15, 0));
    out.push(api.lathe([[r * 1.3, baseH * 0.3], [r * 1.34, baseH * 0.5], [r * 1.12, baseH * 0.7], [r * 1.18, baseH * 0.86], [r * 1.04, baseH], [r * 1.04, baseH], [0, baseH]], segs));
  }
  out.push(fluteShaft(api, s, baseH, shaftTop, top));
  if (s.broken < 1) {
    // A rough fracture across the top.
    const rt = r * 0.9;
    const cap = api.lathe([[rt, 0], [rt * 0.65, r * 0.12], [rt * 0.25, r * 0.05], [0, r * 0.1]], 10);
    cap.displace((x, y, z) => api.noise3(x * 2.1, y * 2.1 + 3, z * 2.1) * r * 0.25);
    out.push(cap.translate(0, top - 0.02, 0));
    return out;
  }
  if (s.ionic) {
    out.push(api.lathe([[r1, 0], [r1 * 1.12, capH * 0.18], [r1 * 1.22, capH * 0.34], [r1 * 1.22, capH * 0.34], [0, capH * 0.34]], segs).translate(0, shaftTop, 0));
    // Volute cushions running front to back, a stepped eye at each end (reads as the spiral), the canalis between them.
    const rv = r * 0.4;
    for (const sx of [-1, 1]) {
      out.push(api.cylinder(rv, rv, r * 1.9, 10).rotate(90, 0, 0).translate(sx * r * 1.12, shaftTop + capH * 0.42, 0));
      out.push(api.cylinder(rv * 0.55, rv * 0.55, r * 1.9 + r * 0.14, 8).rotate(90, 0, 0).translate(sx * r * 1.12, shaftTop + capH * 0.42, 0));
    }
    out.push(api.box(r * 2.24, capH * 0.3, r * 1.7).translate(0, shaftTop + capH * 0.7, 0));
    out.push(api.box(r * 2.5, capH * 0.15, r * 2.1).translate(0, h - capH * 0.075, 0));
  } else {
    // Necking with annulets, the swelling echinus, then the square abacus.
    const ch = capH;
    out.push(api.lathe([[r1, 0], [r1 * 1.035, ch * 0.08], [r1 * 1.0, ch * 0.16], [r1 * 1.16, ch * 0.34], [r1 * 1.36, ch * 0.5], [r1 * 1.5, ch * 0.6], [r1 * 1.5, ch * 0.6], [0, ch * 0.6]], segs).translate(0, shaftTop, 0));
    out.push(api.box(r1 * 3.0, ch * 0.4, r1 * 3.0).translate(0, h - ch * 0.2, 0));
  }
  return out;
}

// --------------------------------------------------------------------------------------------------------------------
// Relief figures (pediment groups, the Ionic frieze), acroteria and antefixes
// --------------------------------------------------------------------------------------------------------------------

/** A tapered strip from a to b (widths wa, wb). */
function limb2(a: P2, b: P2, wa: number, wb: number): P2[] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l, ny = dx / l;
  return [[a[0] + (nx * wa) / 2, a[1] + (ny * wa) / 2], [a[0] - (nx * wa) / 2, a[1] - (ny * wa) / 2], [b[0] - (nx * wb) / 2, b[1] - (ny * wb) / 2], [b[0] + (nx * wb) / 2, b[1] + (ny * wb) / 2]];
}

function disc2(cx: number, cy: number, r: number, n = 8, sy = 1): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * sy]);
  }
  return out;
}

type Pose = 'stand' | 'warrior' | 'seated' | 'recline' | 'simple';
/** Pose sizes in units of a standing figure: [width, height]. */
const POSE_SIZE: Record<Pose, P2> = { stand: [0.36, 1.0], warrior: [0.5, 1.0], seated: [0.42, 0.66], recline: [0.95, 0.34], simple: [0.3, 1.0] };

interface Shape2 { poly: P2[]; depth: number }

/**
 * A relief figure in unit height (feet on y = 0, facing +x when `dir` is 1): marble pieces (drapery, body, limbs, head)
 * at layered depths so the relief steps forward like a carving, and gilded highlights (diadem, belt, spear, shield).
 */
function figureShapes(pose: Pose, dir: number): { marble: Shape2[]; gold: Shape2[] } {
  const M: Shape2[] = [], G: Shape2[] = [];
  const m = (poly: P2[], depth: number): void => { M.push({ poly, depth }); };
  const g = (poly: P2[], depth: number): void => { G.push({ poly, depth }); };
  if (pose === 'stand' || pose === 'simple') {
    m([[-0.13, 0], [0.13, 0], [0.1, 0.52], [-0.1, 0.52]], 0.26); // peplos skirt
    m([[-0.1, 0.48], [0.1, 0.48], [0.13, 0.8], [-0.13, 0.8]], 0.32); // bodice
    m(limb2([0, 0.78], [0, 0.85], 0.06, 0.06), 0.24); // neck
    m(disc2(0, 0.9, 0.065), 0.3);
    m(limb2([-0.12, 0.78], [-0.16, 0.5], 0.06, 0.05), 0.36);
    if (pose === 'stand') {
      m(limb2([0.12, 0.78], [0.21, 0.94], 0.055, 0.045), 0.36);
      g(limb2([0.215, 0.02], [0.215, 0.99], 0.024, 0.024), 0.4); // staff
      g(limb2([-0.1, 0.6], [0.1, 0.6], 0.03, 0.03), 0.38); // belt
    } else {
      m(limb2([0.12, 0.78], [0.17, 0.52], 0.055, 0.045), 0.36);
    }
    g(limb2([-0.055, 0.95], [0.055, 0.95], 0.022, 0.022), 0.34); // diadem
  } else if (pose === 'warrior') {
    m(limb2([-0.14, 0], [-0.01, 0.48], 0.07, 0.09), 0.28);
    m(limb2([0.15, 0], [0.03, 0.48], 0.07, 0.09), 0.28);
    m([[-0.09, 0.44], [0.09, 0.44], [0.12, 0.78], [-0.12, 0.78]], 0.32);
    m(disc2(0.01, 0.87, 0.065), 0.3);
    m(limb2([0.11, 0.76], [0.21, 0.93], 0.05, 0.045), 0.36);
    g(limb2([-0.14, 0.38], [0.28, 0.99], 0.022, 0.022), 0.4); // spear
    g(disc2(-0.16, 0.6, 0.14, 10), 0.42); // shield
    g(limb2([-0.04, 0.93], [0.09, 0.97], 0.035, 0.02), 0.34); // helmet crest
  } else if (pose === 'seated') {
    m([[-0.16, 0], [0.06, 0], [0.06, 0.24], [-0.16, 0.24]], 0.26); // rock seat
    m(limb2([0.15, 0], [0.15, 0.26], 0.07, 0.08), 0.32);
    m(limb2([0.17, 0.26], [-0.06, 0.28], 0.1, 0.11), 0.34);
    m([[-0.12, 0.25], [0.05, 0.25], [0.06, 0.53], [-0.12, 0.53]], 0.32);
    m(disc2(-0.03, 0.61, 0.062), 0.3);
    m(limb2([0.04, 0.5], [0.16, 0.33], 0.05, 0.045), 0.38);
    g(limb2([-0.08, 0.66], [0.03, 0.66], 0.02, 0.02), 0.34);
    g(disc2(0.17, 0.33, 0.035, 6), 0.4); // a gilded cup
  } else {
    m([[-0.45, 0], [0.5, 0], [0.5, 0.05], [-0.45, 0.05]], 0.26); // drapery bed
    m(limb2([0.47, 0.06], [0.04, 0.11], 0.07, 0.12), 0.32);
    m(limb2([0.04, 0.12], [-0.26, 0.2], 0.14, 0.15), 0.34);
    m(disc2(-0.34, 0.27, 0.06), 0.3);
    m(limb2([-0.26, 0.23], [-0.31, 0.03], 0.05, 0.045), 0.36);
    g(limb2([0.42, 0.075], [0.02, 0.135], 0.022, 0.018), 0.36); // hem
    g(limb2([-0.39, 0.32], [-0.29, 0.32], 0.018, 0.018), 0.33); // diadem
  }
  if (dir < 0) {
    for (const s of [...M, ...G]) s.poly = s.poly.map(([x, y]) => [-x, y] as P2);
  }
  return { marble: M, gold: G };
}

/**
 * Lay out a sculpture group in a triangular field (base half-width `half`, height at x of `avail(x)`), facing -z with its
 * back on z = 0, figures of standing height `S`. Returns the marble and gilded meshes.
 */
function pedimentGroup(api: InternalApi, half: number, avail: (x: number) => number, S: number, depthScale: number): { marble: Mesh | null; gold: Mesh | null } {
  const placed: Array<{ pose: Pose; x: number; dir: number; s: number }> = [];
  const centreS = Math.min(S * 1.1, avail(0) * 0.97);
  placed.push({ pose: 'stand', x: 0, dir: 1, s: centreS });
  const order: Pose[] = ['warrior', 'stand', 'warrior', 'seated', 'seated', 'recline'];
  let x = (POSE_SIZE.stand[0] * centreS) / 2 + S * 0.04;
  let k = 0;
  while (k < order.length) {
    const pose = order[k] as Pose;
    const [pw, ph] = POSE_SIZE[pose];
    const w = pw * S;
    const edge = x + w * (pose === 'recline' ? 0.35 : 0.5);
    if (edge > half * 0.97) break;
    if (ph * S <= avail(edge) * 0.97) {
      for (const side of [-1, 1]) placed.push({ pose, x: side * (x + w / 2), dir: -side, s: S });
      x += w + S * 0.05;
    }
    k++;
  }
  // Fill what is left of each corner with a smaller reclining figure.
  const left = half * 0.97 - x;
  if (left > S * 0.4) {
    const s2 = Math.min(S, left / POSE_SIZE.recline[0], avail(x + left * 0.5) / POSE_SIZE.recline[1] * 0.9);
    if (s2 > S * 0.3) for (const side of [-1, 1]) placed.push({ pose: 'recline', x: side * (x + (POSE_SIZE.recline[0] * s2) / 2), dir: -side, s: s2 });
  }
  let marble: Mesh | null = null, gold: Mesh | null = null;
  for (const f of placed) {
    const { marble: ms, gold: gs } = figureShapes(f.pose, f.dir);
    for (const [list, isGold] of [[ms, false], [gs, true]] as const) {
      for (const sh of list) {
        const d = sh.depth * f.s * depthScale;
        const mesh = api.extrude(sh.poly, d).scale(f.s, f.s, 1).translate(f.x, 0, -d / 2);
        if (isGold) gold = gold ? gold.merge(mesh) : mesh;
        else marble = marble ? marble.merge(mesh) : mesh;
      }
    }
  }
  return { marble, gold };
}

/** A palmette in unit height (base on y = 0, fan facing -z, extruded `depth`): the acroterion. */
function palmette(api: InternalApi, depth: number, leaves = 4): Mesh {
  const parts: P2[][] = [];
  parts.push(limb2([0, 0], [0, 0.32], 0.12, 0.08)); // stem
  for (const s of [-1, 1]) parts.push(disc2(s * 0.17, 0.14, 0.1, 8)); // base volutes
  parts.push([[0, 0.25], [0.075, 0.6], [0, 1], [-0.075, 0.6]]);
  for (let i = 1; i <= leaves; i++) {
    const a = (i / (leaves + 0.6)) * 1.25;
    const len = 0.72 - i * 0.07;
    for (const s of [-1, 1]) {
      const tip: P2 = [s * Math.sin(a) * len, 0.28 + Math.cos(a) * len];
      const mid: P2 = [s * Math.sin(a) * len * 0.55, 0.28 + Math.cos(a) * len * 0.55];
      const nx = Math.cos(a) * 0.055, ny = -Math.sin(a) * 0.055 * s;
      parts.push([[0, 0.28], [mid[0] + nx * s, mid[1] + ny * s], tip, [mid[0] - nx * s, mid[1] - ny * s]]);
    }
  }
  let m: Mesh | null = null;
  for (const p of parts) {
    const e = api.extrude(p, depth);
    m = m ? m.merge(e) : e;
  }
  return m as Mesh;
}

const ANTEFIX: P2[] = [[-0.5, 0], [0.5, 0], [0.42, 0.3], [0.55, 0.58], [0.32, 0.8], [0, 1], [-0.32, 0.8], [-0.55, 0.58], [-0.42, 0.3]];

// --------------------------------------------------------------------------------------------------------------------
// The rectangular temple (Doric, Ionic, ruin)
// --------------------------------------------------------------------------------------------------------------------

function rectTemple(c: Ctx, p: TempleParams): void {
  const api = c.api;
  const v = p.variant;
  const ruin = v === 3;
  const ionic = v === 1;
  const H = p.height;
  const W = p.width;
  const L = Math.max(p.length, W);
  const r = ionic ? H / 13 : H / 11;
  const step = H * 0.06;
  const y0 = step * 3;
  const inset = r * 1.6;
  const nF = p.columns;
  const spanX = Math.max(0.5, W - 2 * inset);
  const nS = Math.min(nF * 2 + 3, Math.max(nF, Math.round(((L - 2 * inset) / spanX) * (nF - 1)) + 1));
  const xs: number[] = [], zs: number[] = [];
  for (let i = 0; i < nF; i++) xs.push(-W / 2 + inset + (i / (nF - 1)) * (W - 2 * inset));
  for (let j = 0; j < nS; j++) zs.push(-L / 2 + inset + (j / (nS - 1)) * (L - 2 * inset));
  const nCols = 2 * nF + 2 * (nS - 2) + 4;
  const drums = Math.max(3, Math.min(6, Math.round(H / 1.8)));
  // Flutes within a budget of about 26k triangles for the whole colonnade (canonical 20 on a normal peristyle).
  const perCol = (fl: number): number => fl * (ionic ? 3 : 2) * 2 * drums + (ionic ? 380 : fl >= 20 ? 290 : 210);
  const flutes = [20, 16, 12].find((fl) => perCol(fl) * nCols <= 26_000) ?? 12;
  const shaftA = ionic ? H * 0.055 : 0, shaftB = H - (ionic ? H * 0.075 : H * 0.09);
  c.joint = (y: number): number => {
    const t = (y - y0 - shaftA) / ((shaftB - shaftA) / drums);
    return Math.abs(t - Math.round(t)) < 0.01 && t > 0.5 && t < drums - 0.5 ? 1 : 0;
  };

  // Crepidoma: three courses of blocks, the top one the stylobate, paved between the colonnade and the cella.
  const tread = step * 1.4;
  const bl = Math.max(0.9, Math.min(2.2, (W - 2 * inset) / Math.max(1, nF - 1) / 2));
  for (let i = 0; i < 3; i++) {
    const hx = W / 2 + (2 - i) * tread, hz = L / 2 + (2 - i) * tread;
    const yc = step * (i + 0.5);
    const band = Math.min(tread + 0.4, hx * 0.5);
    block(c, hx * 2 - band * 2, step * 0.98, hz * 2 - band * 2, 0, yc - step * 0.01, 0);
    const off = (i % 2) * 0.5;
    for (const sz of [-1, 1]) for (const [a, b] of spans(-hx, hx, bl * 1.1, off)) block(c, b - a - 0.012, step, band, (a + b) / 2, yc, sz * (hz - band / 2));
    for (const sx of [-1, 1]) for (const [a, b] of spans(-hz + band, hz - band, bl * 1.1, off)) block(c, band, step, b - a - 0.012, sx * (hx - band / 2), yc, (a + b) / 2);
  }
  // Paving slabs on the stylobate (the walk round the cella); the cella floor is hidden.
  {
    const cx0 = W / 2 - inset * 2.1, cz0 = L / 2 - inset * 2.5;
    const sl = bl * 0.9;
    for (const [a, b] of spans(-W / 2 + tread * 0.9, W / 2 - tread * 0.9, sl)) {
      for (const [e, f] of spans(-L / 2 + tread * 0.9, L / 2 - tread * 0.9, sl, 0.5)) {
        const mx = (a + b) / 2, mz = (e + f) / 2;
        if (Math.abs(mx) < cx0 - sl * 0.5 && Math.abs(mz) < cz0 - sl * 0.5) continue;
        c.api.add(weather(c, api.plane(b - a - 0.015, f - e - 0.015).translate(mx, y0 + 0.004, mz), blockTone(api)), c.mats.main);
      }
    }
  }

  // Colonnade.
  const at: Array<[number, number]> = [];
  for (const x of xs) at.push([x, zs[0] as number], [x, zs[nS - 1] as number]);
  for (let j = 1; j < nS - 1; j++) at.push([xs[0] as number, zs[j] as number], [xs[nF - 1] as number, zs[j] as number]);
  const cx = W / 2 - inset * 2.1, cz = L / 2 - inset * 2.5;
  const wt = Math.min(r * 0.9, cx * 0.25);
  const pd = Math.min(cz * 0.28, (zs[1] as number) - (zs[0] as number)) * 1.1;
  const antis: Array<[number, number]> = [];
  if (cx > r * 4) for (const sz of [-1, 1]) for (const sx of [-1, 1]) antis.push([(sx * cx) / 3, sz * (cz - r * 1.3)]);
  const brokenAt: number[] = [];
  for (const [x, z] of [...at, ...antis]) {
    let b = 1;
    if (ruin) b = api.rng() < 0.45 ? api.range(0.2, 0.75) : api.rng() < 0.15 ? 0 : 1;
    brokenAt.push(b);
    if (b === 0) continue;
    const pieces = templeColumn(api, { ionic, h: H, r: Math.abs(z) < cz ? r * 0.85 : r, flutes, drums, broken: b });
    const mat = z < 0 ? c.mats.colsA : c.mats.colsB;
    const tone = blockTone(api);
    for (const m of pieces) api.add(weather(c, m.translate(x, y0, z), tone, true), mat);
  }

  // Cella: coursed ashlar walls (a tall orthostate course at the foot), a pronaos and opisthodomos between antae, a
  // doorway with a moulded frame onto a dark interior.
  const ruinH = (x: number, z: number): number => (ruin ? H * clamp01(0.25 + 0.45 * (0.5 + 0.5 * api.noise3(x * 0.15, 3.1, z * 0.15))) : H);
  const nC = Math.max(5, Math.round(H / 0.85));
  const courseH = H / (nC + 1);
  const courses: Array<[number, number]> = [[y0, y0 + courseH * 2]];
  for (let k = 2; k <= nC; k++) courses.push([y0 + courseH * k, y0 + courseH * (k + 1)]);
  const doorTopK = Math.max(1, Math.round((H * 0.66) / courseH) - 1);
  const doorTop = (courses[doorTopK] as [number, number])[0];
  const dw = Math.min(cx * 0.55, H * 0.3);
  const zFront = -cz + pd, zBack = cz - pd;
  courses.forEach(([ya, yb], k) => {
    const ch = yb - ya;
    const off = (k % 2) * 0.5;
    const bLen = Math.max(1.2, H * 0.22, cz / 12);
    for (const sx of [-1, 1]) {
      for (const [a, b] of spans(-cz, cz, bLen, off)) {
        const xm = sx * (cx - wt / 2), zm = (a + b) / 2;
        if (yb - y0 > ruinH(xm, zm) + 0.01) continue;
        block(c, wt, ch, b - a - 0.01, xm, (ya + yb) / 2, zm);
      }
    }
    for (const [zw, door] of [[zFront, true], [zBack, false]] as const) {
      for (const [a, b] of spans(-cx + wt, cx - wt, bLen, off)) {
        let pieces: Array<[number, number]> = [[a, b]];
        if (door && ya < doorTop - 1e-6) pieces = ([[a, Math.min(b, -dw / 2)], [Math.max(a, dw / 2), b]] as Array<[number, number]>).filter(([e, f]) => f - e > 0.02);
        for (const [e, f] of pieces) {
          if (yb - y0 > ruinH((e + f) / 2, zw) + 0.01) continue;
          block(c, f - e - 0.01, ch, wt, (e + f) / 2, (ya + yb) / 2, zw);
        }
      }
    }
  });
  // Antae: the side walls end in thickened pilasters at both porches.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(c, wt * 1.35, ruin ? ruinH(sx * cx, sz * cz) : H, wt * 1.6, sx * (cx - wt * 0.6), y0 + (ruin ? ruinH(sx * cx, sz * cz) : H) / 2, sz * (cz - wt * 0.75));
  const doorH = doorTop - y0;
  if (!ruin || ruinH(0, zFront) > doorH) {
    const fw = dw * 0.12;
    block(c, fw, doorH, wt * 1.25, -dw / 2 - fw / 2, y0 + doorH / 2, zFront);
    block(c, fw, doorH, wt * 1.25, dw / 2 + fw / 2, y0 + doorH / 2, zFront);
    block(c, dw + fw * 3, courseH * 0.9, wt * 1.3, 0, doorTop + courseH * 0.45, zFront);
  }
  api.add(api.box((cx - wt) * 2 - 0.04, ruin ? H * 0.2 : H - 0.04, zBack - zFront - wt - 0.04).translate(0, y0 + (ruin ? H * 0.1 : H / 2), (zFront + zBack) / 2), c.mats.dark);

  if (ruin) {
    // A run of architrave still spanning pairs of standing columns on the fronts, fallen drums on the stylobate.
    const aH = H * 0.3 * 0.4;
    for (let i = 0; i + 1 < nF; i++) {
      for (const k of [0, 1]) {
        const ia = i * 2 + k, ib = (i + 1) * 2 + k;
        if (brokenAt[ia] === 1 && brokenAt[ib] === 1) {
          const z = k === 0 ? (zs[0] as number) : (zs[nS - 1] as number);
          block(c, (xs[i + 1] as number) - (xs[i] as number) + r * 2.2, aH, r * 2.2, ((xs[i] as number) + (xs[i + 1] as number)) / 2, y0 + H + aH / 2, z);
        }
      }
    }
    const dh = (shaftB - shaftA) / drums;
    for (let i = 0; i < Math.min(10, nCols); i++) {
      const side = api.rng() < 0.5 ? -1 : 1;
      const x = side * api.range(cx + wt, W / 2 - inset * 0.5);
      const z = api.range(-L / 2 + inset * 2, L / 2 - inset * 2);
      const drum = api.cylinder(r * 0.86, r * 0.92, dh, 14).rotate(90, 0, 0).rotate(0, api.range(-60, 60), 0).translate(x, y0 + r * 0.86, z);
      api.add(weather(c, drum, blockTone(api)), c.mats.colsA);
    }
    return;
  }

  // ---- Entablature ----
  c.cur = c.mats.upper;
  const eH = H * (ionic ? 0.27 : 0.32);
  const aH = eH * (ionic ? 0.42 : 0.38), fH = eH * (ionic ? 0.36 : 0.4), gH = eH - aH - fH;
  const yA = y0 + H, yF = yA + aH, yG = yF + fH, yT = yG + gH;
  const ax = W / 2 - inset + r * 1.12, az = L / 2 - inset + r * 1.12;
  const ov = eH * 0.26;
  const gx = ax + ov, gz = az + ov;
  const bd = r * 2.3; // depth of the perimeter beams
  const tp = r * 0.1; // relief of triglyphs and taenia
  const faces: Array<{ axis: 'x' | 'z'; s: number; half: number; other: number; joints: number[] }> = [
    { axis: 'x', s: -1, half: ax, other: az, joints: xs.slice(1, -1) },
    { axis: 'x', s: 1, half: ax, other: az, joints: xs.slice(1, -1) },
    { axis: 'z', s: -1, half: az - bd, other: ax, joints: zs.slice(1, -1) },
    { axis: 'z', s: 1, half: az - bd, other: ax, joints: zs.slice(1, -1) },
  ];
  /** A beam on a face: along the face from a to b, outer face at `out` from the centre, height h at y, depth d inward. */
  const beam = (f: (typeof faces)[number], a: number, b: number, out: number, y: number, h: number, d: number, mat?: MaterialSpec, tone?: RGB): void => {
    const len = b - a, mid = (a + b) / 2;
    if (f.axis === 'x') block(c, len, h, d, mid, y, f.s * (out - d / 2), mat, tone);
    else block(c, d, h, len, f.s * (out - d / 2), y, mid, mat, tone);
  };
  // Architrave: beams joined over the column axes (Doric: one face and a taenia; Ionic: three fasciae).
  block(c, (ax - bd) * 2 + 0.02, aH, (az - bd) * 2 + 0.02, 0, yA + aH / 2, 0);
  for (const f of faces) {
    const cuts = [-f.half, ...f.joints.filter((j) => Math.abs(j) < f.half - 0.2), f.half];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i] as number, b = cuts[i + 1] as number;
      if (ionic) {
        for (let q = 0; q < 3; q++) beam(f, a + 0.005, b - 0.005, f.other - tp * (2 - q) * 0.6, yA + (aH * (q + 0.5)) / 3, aH / 3, bd);
      } else beam(f, a + 0.005, b - 0.005, f.other, yA + aH * 0.45, aH * 0.9, bd);
    }
    const tone = blockTone(api);
    beam(f, -f.half - (f.axis === 'x' ? tp : 0), f.half + (f.axis === 'x' ? tp : 0), f.other + tp, yA + aH * 0.95, aH * 0.1, bd * 0.6, undefined, tone);
  }
  // Frieze.
  block(c, (ax - bd) * 2 + 0.02, fH, (az - bd) * 2 + 0.02, 0, yF + fH / 2, 0);
  const tw = r * 1.05;
  const trigs = (axes: number[], half: number): number[] => {
    const out: number[] = [-half + tw / 2];
    for (let i = 0; i + 1 < axes.length; i++) {
      if (i > 0) out.push(axes[i] as number);
      out.push(((axes[i] as number) + (axes[i + 1] as number)) / 2);
    }
    out.push(half - tw / 2);
    return out;
  };
  const metopeCentres: Array<{ f: (typeof faces)[number]; at: number; w: number }> = [];
  if (ionic) {
    // A continuous frieze; the fronts carry a procession in relief, the flanks gilded rosettes.
    for (const f of faces) {
      const hx = f.axis === 'x' ? ax : az;
      for (const [a, b] of spans(-hx + (f.axis === 'z' ? bd : 0), hx - (f.axis === 'z' ? bd : 0), H * 0.4)) beam(f, a + 0.004, b - 0.004, f.other - tp * 0.5, yF + fH / 2, fH, bd);
    }
  } else {
    for (const f of faces) {
      const hx = f.axis === 'x' ? ax : az;
      const axes = f.axis === 'x' ? xs : zs;
      const ts = trigs(axes, hx);
      for (let i = 0; i < ts.length; i++) {
        const t = ts[i] as number;
        // Triglyph: two glyphs and two half-glyphs standing proud of the metopes, under a capital band.
        if (f.axis === 'z' && Math.abs(t) > hx - tw) { /* the corner triglyphs belong to the fronts */ } else {
          const u = tw / 9;
          const tone = blockTone(api);
          for (const [p0, p1] of [[0, 1], [2, 4], [5, 7], [8, 9]] as const) beam(f, t - tw / 2 + p0 * u, t - tw / 2 + p1 * u, f.other, yF + fH * 0.44, fH * 0.88, tp + r * 0.3, undefined, tone);
          beam(f, t - tw / 2, t + tw / 2, f.other + tp * 0.3, yF + fH * 0.94, fH * 0.12, tp + r * 0.3, undefined, tone);
          // The grooves' back, on the metope plane (kept off the flank at a corner, where the wrapped glyphs stand).
          const corner = f.axis === 'x' && Math.abs(t) > hx - tw;
          beam(f, Math.max(t - tw / 2, -hx + (corner ? tp * 1.5 : 0)), Math.min(t + tw / 2, hx - (corner ? tp * 1.5 : 0)), f.other - tp * 1.5, yF + fH / 2, fH, bd, undefined, tone);
          // Regula with its guttae line, under the taenia.
          beam(f, t - tw / 2, t + tw / 2, f.other + tp * 0.6, yA + aH * 0.84, aH * 0.08, bd * 0.4, undefined, tone);
          if (f.axis === 'x' && Math.abs(Math.abs(t) - (hx - tw / 2)) < 1e-6) {
            // the corner triglyph wraps round onto the flank
            for (const [p0, p1] of [[0, 1], [2, 4], [5, 7], [8, 9]] as const) {
              const z0 = f.s * az - f.s * tw + f.s * p0 * u, z1 = f.s * az - f.s * tw + f.s * p1 * u;
              block(c, tp + r * 0.3, fH * 0.88, Math.abs(z1 - z0), Math.sign(t) * (ax - (tp + r * 0.3) / 2), yF + fH * 0.44, (z0 + z1) / 2, undefined, tone);
            }
          }
        }
        if (i + 1 < ts.length) {
          const a = t + tw / 2, b = (ts[i + 1] as number) - tw / 2;
          if (b - a > 0.05) {
            beam(f, a, b, f.other - tp * 1.5, yF + fH / 2, fH, bd);
            metopeCentres.push({ f, at: (a + b) / 2, w: b - a });
          }
        }
      }
    }
  }
  // Gilded shields hung on the metopes (Doric) or rosettes on the plain Ionic flanks.
  for (const mc of ionic ? [] : metopeCentres) {
    const sr = Math.min(fH * 0.3, mc.w * 0.34);
    const shield = api.lathe([[sr, 0], [sr * 0.9, sr * 0.16], [sr * 0.4, sr * 0.3], [0, sr * 0.36]], 10);
    const face = mc.f.other - tp * 1.5;
    if (mc.f.axis === 'x') api.add(shield.rotate(mc.f.s < 0 ? -90 : 90, 0, 0).translate(mc.at, yF + fH * 0.48, mc.f.s * face), c.mats.gold);
    else api.add(shield.rotate(0, 0, mc.f.s < 0 ? 90 : -90).translate(mc.f.s * face, yF + fH * 0.48, mc.at), c.mats.gold);
  }
  if (ionic) {
    for (const f of faces) {
      if (f.axis === 'z') {
        for (const [a, b] of spans(-az + bd, az - bd, Math.max(fH * 1.6, 1.2))) {
          const rz = (a + b) / 2;
          const ros = api.lathe([[fH * 0.18, 0], [fH * 0.12, fH * 0.06], [0, fH * 0.08]], 10).rotate(0, 0, f.s < 0 ? 90 : -90).translate(f.s * (ax - tp * 0.5), yF + fH / 2, rz);
          api.add(ros, c.mats.gold);
        }
      } else {
        const S = fH * 0.86;
        const n = Math.max(3, Math.min(36, Math.floor((ax * 2 - S * 0.4) / (S * 0.7))));
        let mar: Mesh | null = null, gol: Mesh | null = null;
        for (let i = 0; i < n; i++) {
          const fx = -ax + S * 0.3 + ((i + 0.5) / n) * (ax * 2 - S * 0.6);
          const shapes = figureShapes(i % 3 === 1 ? 'stand' : 'simple', 1);
          for (const sh of shapes.marble) {
            const e = api.extrude(sh.poly, sh.depth * S * 0.5).scale(S, S, 1).translate(fx, 0, -sh.depth * S * 0.25);
            mar = mar ? mar.merge(e) : e;
          }
          for (const sh of shapes.gold) {
            const e = api.extrude(sh.poly, sh.depth * S * 0.5).scale(S, S, 1).translate(fx, 0, -sh.depth * S * 0.25);
            gol = gol ? gol.merge(e) : e;
          }
        }
        const place = (m: Mesh): Mesh => (f.s < 0 ? m.translate(0, yF + fH * 0.06, -(az - tp * 0.5)) : m.rotate(0, 180, 0).translate(0, yF + fH * 0.06, az - tp * 0.5));
        if (mar) api.add(weather(c, place(mar), [1, 1, 1]), c.mats.sculpt);
        if (gol) api.add(place(gol), c.mats.gold);
      }
    }
  }
  // Horizontal cornice (geison) all round, mutules (Doric) or dentils (Ionic) under its soffit.
  block(c, gx * 2 - 0.4, gH, gz * 2 - 0.4, 0, yG + gH / 2, 0);
  for (const f of faces) {
    const half = f.axis === 'x' ? gx : gz - (ov + bd);
    const out = f.axis === 'x' ? gz : gx;
    const cuts = [-half, ...f.joints.filter((j) => Math.abs(j) < half - 0.3), half];
    for (let i = 0; i + 1 < cuts.length; i++) beam(f, (cuts[i] as number) + 0.004, (cuts[i + 1] as number) - 0.004, out, yG + gH / 2, gH, ov + bd);
    // Drip moulding along the top edge.
    beam(f, -half - (f.axis === 'x' ? 0.06 : 0), half + (f.axis === 'x' ? 0.06 : 0), out + 0.06, yG + gH * 0.92, gH * 0.16, 0.5);
  }
  if (ionic) {
    const dW = Math.max(gH * 0.32, 0.1);
    for (const f of faces) {
      const hx = f.axis === 'x' ? ax + ov * 0.55 : az - bd;
      const n = Math.min(140, Math.floor((hx * 2) / (dW * 1.6)));
      for (let i = 0; i < n; i++) {
        const t = -hx + ((i + 0.5) / n) * hx * 2;
        beam(f, t - dW / 2, t + dW / 2, f.other + ov * 0.55, yG - gH * 0.25, gH * 0.5, ov * 0.6);
      }
    }
  } else {
    for (const f of faces) {
      const hx = f.axis === 'x' ? ax : az;
      const ts = trigs(f.axis === 'x' ? xs : zs, hx);
      const spots: number[] = [];
      for (let i = 0; i < ts.length; i++) {
        spots.push(ts[i] as number);
        if (i + 1 < ts.length) spots.push(((ts[i] as number) + (ts[i + 1] as number)) / 2);
      }
      for (const t of spots) {
        if (f.axis === 'z' && Math.abs(t) > az - bd - tw) continue;
        beam(f, t - tw / 2, t + tw / 2, f.other + ov * 0.92, yG - gH * 0.09, gH * 0.18, ov * 0.85);
      }
    }
  }

  // ---- Pediments, roof, acroteria ----
  const theta = (13.5 * Math.PI) / 180;
  const tan = Math.tan(theta), cos = Math.cos(theta), sin = Math.sin(theta);
  const P = gx * tan;
  const rcH = gH * 0.85;
  // Tympanum: a solid gable wedge between the fronts, painted a soft blue-grey ground behind the figures.
  const pent: P2[] = [[-ax, 0], [ax, 0], [ax, P * (1 - ax / gx)], [0, P], [-ax, P * (1 - ax / gx)]];
  api.add(weather(c, api.extrude(pent, az * 2).translate(0, yT, 0), TYMPANUM), c.mats.upper);
  // Long-side eaves course carrying the tiles out over the cornice.
  for (const sx of [-1, 1]) block(c, ov + bd * 0.5, rcH, gz * 2 - 0.1, sx * (gx - (ov + bd * 0.5) / 2), yT + rcH / 2, 0);
  const Lr = Math.hypot(gx, P) + rcH * 0.4;
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      // Raking cornice and its sima.
      const nx = sx * sin, ny = cos;
      const mx = (sx * gx) / 2, my = yT + P / 2;
      const d = ov + 0.5;
      const zc = sz * (gz - d / 2);
      const tone = blockTone(api);
      c.api.add(weather(c, api.box(Lr, rcH, d).rotate(0, 0, -sx * (theta * 180) / Math.PI).translate(mx + nx * rcH * 0.5, my + ny * rcH * 0.5, zc), tone), c.mats.upper);
      c.api.add(weather(c, api.box(Lr, rcH * 0.55, 0.22).rotate(0, 0, -sx * (theta * 180) / Math.PI).translate(mx + nx * rcH * 1.2, my + ny * rcH * 1.2, sz * (gz + 0.03 - 0.11)), tone), c.mats.upper);
    }
    // The sculpture group, standing on the horizontal cornice against the tympanum.
    const S = P * 0.9;
    const grp = pedimentGroup(api, ax - 0.05, (x) => P * (1 - Math.abs(x) / gx) - 0.05, S, Math.min(1, (ov * 0.9) / (0.42 * S)));
    const place = (m: Mesh): Mesh => (sz < 0 ? m.translate(0, yT, -az) : m.rotate(0, 180, 0).translate(0, yT, az));
    if (grp.marble) api.add(weather(c, place(grp.marble), [1.02, 1.01, 0.98]), c.mats.sculpt);
    if (grp.gold) api.add(place(grp.gold), c.mats.gold);
  }
  // Tiled roof: stepped courses of pan tiles, half-round cover tiles down the slope, a ridge, antefixes at the eaves.
  const yR = yT + P + rcH / cos;
  const xe = gx + 0.18;
  const Ls = xe / cos;
  const Lz = gz * 2 - 0.12;
  const nCourse = Math.max(4, Math.round(Ls / 0.7));
  const cl = Ls / nCourse;
  const tt = 0.09;
  const dl = (3 * Math.PI) / 180;
  const roofSide: Mesh[] = [];
  const antefixes: Mesh[] = [];
  const pt = (u: number, lift: number): [number, number] => [u * cos + sin * lift, yR - u * sin + cos * lift];
  for (let k = 0; k < nCourse; k++) {
    const u = (k + 0.5) * cl;
    const [x, y] = pt(u, tt / 2 + (cl * Math.sin(dl)) / 2);
    roofSide.push(api.box(cl + 0.1, tt, Lz).rotate(0, 0, -((theta - dl) * 180) / Math.PI).translate(x, y, 0));
  }
  const cr = Math.max(0.09, Math.min(0.16, H * 0.012));
  const sp = Math.max(0.5, Math.min(0.8, H * 0.065));
  const nRow = Math.floor(Lz / sp);
  const aFix = Math.max(0.35, gH * 0.5);
  for (let j = 0; j < nRow; j++) {
    const z = -Lz / 2 + (j + 0.5) * (Lz / nRow);
    const [x, y] = pt(Ls / 2, tt + cl * Math.sin(dl) + cr * 0.4);
    roofSide.push(api.cylinder(cr, cr, Ls, 6).rotate(0, 0, 90).rotate(0, 0, -(theta * 180) / Math.PI).translate(x, y, z));
    const [ex, ey] = pt(Ls, tt);
    antefixes.push(api.extrude(ANTEFIX, 0.07).scale(aFix * 0.7, aFix, 1).rotate(0, 90, 0).translate(ex + 0.02, ey - aFix * 0.15, z));
  }
  let side: Mesh = roofSide[0] as Mesh;
  for (let i = 1; i < roofSide.length; i++) side = side.merge(roofSide[i] as Mesh);
  api.add(side, c.mats.roof);
  api.add(side.clone().rotate(0, 180, 0), c.mats.roof);
  api.add(api.cylinder(cr * 1.6, cr * 1.6, Lz + 0.1, 8).rotate(90, 0, 0).translate(0, yR + tt, 0), c.mats.roof);
  let fix: Mesh = antefixes[0] as Mesh;
  for (let i = 1; i < antefixes.length; i++) fix = fix.merge(antefixes[i] as Mesh);
  const fixB = fix.clone().rotate(0, 180, 0);
  api.add(weather(c, fix, [1, 0.99, 0.96]), c.mats.sculpt);
  api.add(weather(c, fixB, [1, 0.99, 0.96]), c.mats.sculpt);
  // Acroteria: a great gilded palmette at each apex, smaller ones at the corners, on marble plinths.
  const A = Math.max(1, P * 0.62);
  for (const sz of [-1, 1]) {
    const zc = sz * (gz - 0.35);
    block(c, A * 0.5, A * 0.12, 0.6, 0, yR + rcH * 0.5 + A * 0.06, zc);
    api.add(palmette(api, 0.18).scale(A * 0.95, A, 1).translate(0, yR + rcH * 0.5 + A * 0.12, zc), c.mats.gold);
    for (const sx of [-1, 1]) {
      const px = sx * (gx - A * 0.25);
      const py = yT + rcH * 1.5 + (P * A * 0.5) / gx;
      block(c, A * 0.42, A * 0.14, 0.6, px, py + A * 0.07, zc);
      api.add(palmette(api, 0.16, 3).scale(A * 0.6, A * 0.62, 1).translate(px, py + A * 0.14, zc), c.mats.gold);
    }
  }
}

// --------------------------------------------------------------------------------------------------------------------
// Tholos
// --------------------------------------------------------------------------------------------------------------------

function tholos(c: Ctx, p: TempleParams): { R: number; y0: number; rc: number } {
  const api = c.api;
  const H = p.height;
  const R = p.width / 2;
  const r = H / 11;
  const step = H * 0.06;
  const y0 = step * 3;
  const tread = step * 1.4;
  // Round crepidoma of ring blocks.
  for (let i = 0; i < 3; i++) {
    const ro = R + (2 - i) * tread;
    const ri = Math.max(0.2, ro - tread - 0.5);
    const n = Math.max(12, Math.min(80, Math.round((Math.PI * 2 * ro) / 1.4)));
    // Ring of blocks on the circle (cheap, and they read as the coursed step at any distance).
    for (let k = 0; k < n; k++) {
      const a = ((k + (i % 2) * 0.5) / n) * Math.PI * 2;
      const bw = ((Math.PI * 2 * (ro - tread / 2)) / n) * 1.04;
      const m = api.box(bw, step, tread + 0.5).translate(0, step * (i + 0.5), ro - (tread + 0.5) / 2).rotate(0, (a * 180) / Math.PI, 0);
      c.api.add(weather(c, m, blockTone(api)), c.mats.main);
    }
    c.api.add(weather(c, api.cylinder(ri + 0.05, ri + 0.05, step, 24).translate(0, step * (i + 0.5), 0), blockTone(api)), c.mats.main);
  }
  const rc = R - r * 1.6;
  const n = Math.max(8, Math.min(36, Math.round((Math.PI * 2 * rc) / (r * 5))));
  const drums = Math.max(3, Math.min(6, Math.round(H / 1.8)));
  const shaftB = H - H * 0.09;
  c.joint = (y: number): number => {
    const t = (y - y0) / (shaftB / drums);
    return Math.abs(t - Math.round(t)) < 0.01 && t > 0.5 && t < drums - 0.5 ? 1 : 0;
  };
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const tone = blockTone(api);
    const mat = Math.cos(a) < 0 ? c.mats.colsA : c.mats.colsB;
    for (const m of templeColumn(api, { ionic: false, h: H, r, flutes: n > 20 ? 16 : 20, drums, broken: 1 })) {
      api.add(weather(c, m.rotate(0, (a * 180) / Math.PI, 0).translate(Math.sin(a) * rc, y0, Math.cos(a) * rc), tone, true), mat);
    }
  }
  // Round cella in courses, a doorway facing -z.
  const Rc = rc - r * 2.6;
  const nC = Math.max(5, Math.round(H / 0.85));
  for (let k = 0; k < nC; k++) {
    const ya = y0 + (H * k) / nC, h = H / nC;
    const m = api.cylinder(Rc + (k === 0 ? 0.04 : 0), Rc + (k === 0 ? 0.04 : 0), h - 0.006, 28).translate(0, ya + h / 2, 0);
    c.api.add(weather(c, m, blockTone(api)), c.mats.main);
  }
  const dw = Math.min(Rc * 0.6, H * 0.28), dh = H * 0.62;
  api.add(api.box(dw, dh, 0.12).translate(0, y0 + dh / 2, -Rc + 0.02), c.mats.dark);
  block(c, dw * 0.14, dh, 0.3, -dw * 0.57, y0 + dh / 2, -Rc - 0.05);
  block(c, dw * 0.14, dh, 0.3, dw * 0.57, y0 + dh / 2, -Rc - 0.05);
  block(c, dw * 1.3, H * 0.06, 0.32, 0, y0 + dh + H * 0.03, -Rc - 0.05);
  // Ring entablature: architrave, a frieze of triglyphs with gilded shields on the metopes, the cornice.
  const eH = H * 0.3;
  const aH = eH * 0.38, fH = eH * 0.4, gH = eH - aH - fH;
  const yA = y0 + H, yF = yA + aH, yG = yF + fH, yT = yG + gH;
  const Ro = rc + r * 1.12;
  const ring = (ri: number, ro: number, y: number, h: number, segs: number): Mesh => api.lathe([[ri, y], [ro, y], [ro, y + h], [ri, y + h]], segs);
  c.api.add(weather(c, ring(0, Ro, yA, aH, 40), blockTone(api)), c.mats.main);
  c.api.add(weather(c, ring(0, Ro - r * 0.12, yF, fH, 40), blockTone(api)), c.mats.main);
  const nT = n * 2;
  for (let i = 0; i < nT; i++) {
    const a = (i / nT) * Math.PI * 2;
    const deg = (a * 180) / Math.PI;
    const tw = r * 1.0;
    const tone = blockTone(api);
    for (const [p0, p1] of [[0, 1], [2, 4], [5, 7], [8, 9]] as const) {
      const u0 = -tw / 2 + (p0 * tw) / 9, u1 = -tw / 2 + (p1 * tw) / 9;
      c.api.add(weather(c, api.box(u1 - u0, fH * 0.88, r * 0.3).translate((u0 + u1) / 2, yF + fH * 0.44, Ro - r * 0.15).rotate(0, deg, 0), tone), c.mats.main);
    }
    const am = a + Math.PI / nT;
    const sr = Math.min(fH * 0.28, ((Math.PI * 2 * Ro) / nT - tw) * 0.32);
    const shield = api.lathe([[sr, 0], [sr * 0.9, sr * 0.16], [sr * 0.4, sr * 0.3], [0, sr * 0.36]], 10).rotate(90, 0, 0).translate(0, yF + fH * 0.48, Ro - r * 0.12).rotate(0, (am * 180) / Math.PI, 0);
    api.add(shield, c.mats.gold);
    // Mutules under the cornice.
    c.api.add(weather(c, api.box(tw, gH * 0.18, eH * 0.22).translate(0, yG - gH * 0.09, Ro + eH * 0.1).rotate(0, deg, 0), tone), c.mats.main);
  }
  const Rg = Ro + eH * 0.26;
  c.api.add(weather(c, api.lathe([[0, yG], [Ro, yG], [Rg, yG + gH * 0.15], [Rg, yG + gH], [Rg - 0.02, yG + gH], [0, yG + gH]], 48), blockTone(api)), c.mats.main);
  // Conical tiled roof with radial cover tiles, antefixes round the eaves and a gilded finial.
  const Rr = Rg + 0.2;
  const hR = Rr * 0.42;
  api.add(api.lathe([[Rr, yT], [Rr, yT + 0.1], [0.3, yT + hR], [0, yT + hR]], 48), c.mats.roof);
  const slope = Math.hypot(Rr - 0.3, hR);
  const ang = (Math.atan2(hR, Rr - 0.3) * 180) / Math.PI;
  const nRib = Math.max(16, Math.min(100, Math.round((Math.PI * 2 * Rr) / 0.7)));
  const cr = Math.max(0.08, Math.min(0.14, H * 0.012));
  const aFix = Math.max(0.3, gH * 0.5);
  let ribs: Mesh | null = null;
  let fixes: Mesh | null = null;
  for (let i = 0; i < nRib; i++) {
    const deg = (i / nRib) * 360;
    const rib = api.cylinder(cr * 0.6, cr, slope, 6).rotate(0, 0, 90 - ang).translate((Rr + 0.3) / 2, yT + 0.1 + hR / 2 + cr * 0.6, 0).rotate(0, deg, 0);
    ribs = ribs ? ribs.merge(rib) : rib;
    const fx = api.extrude(ANTEFIX, 0.07).scale(aFix * 0.7, aFix, 1).rotate(0, 90, 0).translate(Rr + 0.03, yT + 0.05, 0).rotate(0, deg, 0);
    fixes = fixes ? fixes.merge(fx) : fx;
  }
  if (ribs) api.add(ribs, c.mats.roof);
  if (fixes) api.add(weather(c, fixes, [1, 0.99, 0.96]), c.mats.sculpt);
  const A = Math.max(0.9, hR * 0.45);
  api.add(api.lathe([[0.35, 0], [0.3, A * 0.15], [0.12, A * 0.2], [0, A * 0.2]], 12).translate(0, yT + hR - 0.05, 0), c.mats.gold);
  const fin = palmette(api, 0.14, 3).scale(A * 0.8, A, 1);
  api.add(fin.clone().translate(0, yT + hR + A * 0.12, 0), c.mats.gold);
  api.add(fin.rotate(0, 90, 0).translate(0, yT + hR + A * 0.12, 0), c.mats.gold);
  return { R, y0, rc };
}

/** Build the temple into `api` (parts and colliders). */
export function buildTemple(api: InternalApi, p: TempleParams): void {
  const marble: MaterialSpec = { finish: 'plaster', color: p.color, roughness: 0.55, vertexColors: true };
  const c: Ctx = {
    api,
    // The same marble in separate parts (each under the renderer's per-part LOD threshold): the colonnade split front and
    // back, the carved pieces on their own.
    mats: {
      main: marble,
      upper: { ...marble, roughness: 0.54 },
      colsA: { ...marble, roughness: 0.56 },
      colsB: { ...marble, roughness: 0.57 },
      sculpt: { ...marble, roughness: 0.5 },
      gold: { finish: 'brass', color: p.accentColor, roughness: 0.3, metalness: 0.95 },
      roof: { finish: 'roof-tile', color: p.roofColor, roughness: 0.8 },
      dark: { finish: 'stone', color: '#2b2622', roughness: 0.9 },
    },
    joint: () => 0,
    cur: marble,
  };
  const H = p.height;
  const step = H * 0.06;
  const y0 = step * 3;
  if (p.variant === 2) {
    const { R, rc } = tholos(c, p);
    api.collider(cylinderCollider(0, y0 / 2, 0, R + step * 2.8, y0));
    api.collider(cylinderCollider(0, y0 + H / 2, 0, rc - (H / 11) * 2.6, H));
    return;
  }
  rectTemple(c, p);
  const W = p.width, L = Math.max(p.length, W);
  const r = p.variant === 1 ? H / 13 : H / 11;
  const inset = r * 1.6;
  api.collider(boxCollider(0, y0 / 2, 0, W + step * 5.6, y0, L + step * 5.6));
  api.collider(boxCollider(0, y0 + H / 2, 0, (W / 2 - inset * 2.1) * 2, H, (L / 2 - inset * 2.5) * 2));
  const nF = p.columns;
  const spanX = Math.max(0.5, W - 2 * inset);
  const nS = Math.min(nF * 2 + 3, Math.max(nF, Math.round(((L - 2 * inset) / spanX) * (nF - 1)) + 1));
  const at: Array<[number, number]> = [];
  for (let i = 0; i < nF; i++) {
    const x = -W / 2 + inset + (i / (nF - 1)) * (W - 2 * inset);
    at.push([x, -L / 2 + inset], [x, L / 2 - inset]);
  }
  for (let j = 1; j < nS - 1; j++) {
    const z = -L / 2 + inset + (j / (nS - 1)) * (L - 2 * inset);
    at.push([-W / 2 + inset, z], [W / 2 - inset, z]);
  }
  for (const [x, z] of at.slice(0, 40)) api.collider(cylinderCollider(x, y0 + H / 2, z, r, H));
}
