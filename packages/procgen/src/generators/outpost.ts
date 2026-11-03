/**
 * Outpost and industrial props: ISO shipping container, sandbag wall and a lattice radio mast with its equipment shelter.
 * Built like the other props: physically based finishes tinted per vertex, every part of one finish merged into one draw,
 * weathering (grime at the foot, rust, worn edges) drawn per pixel by material surface layers rather than geometry, thin
 * members as few-sided prisms, and compound primitive colliders.
 */
import type { MaterialSpec, Vec3 } from '@aether/core';
import type { InternalApi } from '../api';
import type { ColliderDesc } from '../types';
import { boxCollider, cylinderCollider } from '../colliders';
import { mixLinear } from '../color';
import { MeshBuilder, type Mesh } from '../kernel/mesh';
import {
  addFinish, boxUvs, defineGenerator, doubleSided, finishMat, glow, lin, pBool, pColor, pInt, pNum, pVariant, shade, triBoxUvs,
} from './kit';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Paint a part one colour and give it metre box UVs (ready to merge into a vertex-coloured finish part). */
export function solid(m: Mesh, color: string): Mesh {
  boxUvs(m);
  return m.paint(lin(color));
}

/** A finish material with weathering layers drawn per pixel (see the renderer's surface layers). */
export function weathered(finish: NonNullable<MaterialSpec['finish']>, roughness: number, layers: NonNullable<MaterialSpec['surface']>['layers']): MaterialSpec {
  return { ...finishMat(finish, roughness), surface: { layers } };
}

/**
 * A straight member from `a` to `b` with `sides` flat (or smooth) sides and no end caps, appended to `b`: lattice bracing,
 * guy wires, rope. Three sides are six triangles.
 */
export function strut(mb: MeshBuilder, a: Vec3, c: Vec3, r: number, sides: number, smooth = false): void {
  const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-5) return;
  const d: Vec3 = [dx / len, dy / len, dz / len];
  const up: Vec3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let e1: Vec3 = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]];
  const l1 = Math.hypot(e1[0], e1[1], e1[2]);
  e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
  const e2: Vec3 = [d[1] * e1[2] - d[2] * e1[1], d[2] * e1[0] - d[0] * e1[2], d[0] * e1[1] - d[1] * e1[0]];
  const dir = (t: number): Vec3 => {
    const cs = Math.cos(t), sn = Math.sin(t);
    return [cs * e1[0] + sn * e2[0], cs * e1[1] + sn * e2[1], cs * e1[2] + sn * e2[2]];
  };
  for (let k = 0; k < sides; k++) {
    const t0 = (k / sides) * Math.PI * 2;
    const t1 = ((k + 1) / sides) * Math.PI * 2;
    const o0 = dir(t0), o1 = dir(t1), om = dir((t0 + t1) / 2);
    const n0 = smooth ? o0 : om, n1 = smooth ? o1 : om;
    const u0 = (k / sides) * Math.PI * 2 * r, u1 = ((k + 1) / sides) * Math.PI * 2 * r;
    const i0 = mb.vertex(a[0] + o0[0] * r, a[1] + o0[1] * r, a[2] + o0[2] * r, n0[0], n0[1], n0[2], u0, 0);
    const i1 = mb.vertex(a[0] + o1[0] * r, a[1] + o1[1] * r, a[2] + o1[2] * r, n1[0], n1[1], n1[2], u1, 0);
    const i2 = mb.vertex(c[0] + o1[0] * r, c[1] + o1[1] * r, c[2] + o1[2] * r, n1[0], n1[1], n1[2], u1, len);
    const i3 = mb.vertex(c[0] + o0[0] * r, c[1] + o0[1] * r, c[2] + o0[2] * r, n0[0], n0[1], n0[2], u0, len);
    mb.quad(i0, i1, i2, i3);
  }
}

/** 3 × 5 stencil glyphs, rows top to bottom. */
const FONT: Readonly<Record<string, readonly string[]>> = {
  A: ['111', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'], C: ['111', '100', '100', '100', '111'],
  D: ['110', '101', '101', '101', '110'], E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
  G: ['111', '100', '101', '101', '111'], H: ['101', '101', '111', '101', '101'], I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '111'], K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'], N: ['110', '101', '101', '101', '101'], O: ['111', '101', '101', '101', '111'],
  P: ['111', '101', '111', '100', '100'], Q: ['111', '101', '101', '111', '001'], R: ['110', '101', '110', '101', '101'],
  S: ['111', '100', '111', '001', '111'], T: ['111', '010', '010', '010', '010'], U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'], W: ['101', '101', '111', '111', '101'], X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'],
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '011', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'], '.': ['000', '000', '000', '000', '010'], '-': ['000', '000', '111', '000', '000'],
  '/': ['001', '001', '010', '100', '100'],
};

/**
 * Rectangles [u0, v0, u1, v1] of `text` in stencil glyphs `h` high with its lower-left corner at (u, v); runs of a row are
 * merged and identical runs of consecutive rows joined, so a glyph is two to five quads.
 */
export function stencilRects(text: string, u: number, v: number, h: number): number[][] {
  const px = h / 5;
  const out: number[][] = [];
  let x = u;
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch];
    if (g) {
      const open = new Map<string, number[]>();
      for (let row = 0; row < 5; row++) {
        const line = g[row] as string;
        const seen = new Set<string>();
        let c = 0;
        while (c < 3) {
          if (line[c] !== '1') {
            c++;
            continue;
          }
          let e = c;
          while (e < 3 && line[e] === '1') e++;
          const key = `${c}:${e}`;
          seen.add(key);
          const y1 = v + h - row * px;
          const r = open.get(key);
          if (r) r[1] = y1 - px;
          else {
            const nr = [x + c * px, y1 - px, x + e * px, y1];
            open.set(key, nr);
            out.push(nr);
          }
          c = e;
        }
        for (const k of [...open.keys()]) if (!seen.has(k)) open.delete(k);
      }
    }
    x += px * 4;
  }
  return out;
}

/** Width of `text` in stencil glyphs `h` high. */
export function stencilWidth(text: string, h: number): number {
  return (h / 5) * (text.length * 4 - 1);
}

/** Flat quads (rects in the XY plane facing +Z at depth z). */
export function flatQuads(api: InternalApi, rects: number[][], z: number): Mesh {
  const mb = new MeshBuilder(rects.length * 4, rects.length * 6);
  for (const [u0, v0, u1, v1] of rects as Array<[number, number, number, number]>) {
    const a = mb.vertex(u0, v0, z, 0, 0, 1, u0, v0);
    const b = mb.vertex(u1, v0, z, 0, 0, 1, u1, v0);
    const c = mb.vertex(u1, v1, z, 0, 0, 1, u1, v1);
    const d = mb.vertex(u0, v1, z, 0, 0, 1, u0, v1);
    mb.quad(a, b, c, d);
  }
  return api.fromBuilder(mb);
}

/**
 * Trapezoid corrugation of an ISO container sheet across x (in the XY plane, facing +Z): inner flat, rising web, outer
 * flat, falling web, in the proportions of the real 72 / 68 / 70 / 68 mm profile. Returns the breakpoints in x and z.
 */
function corrugation(x0: number, x1: number, pitch: number, depth: number, phase = 0): Array<[number, number]> {
  const marks: Array<[number, number]> = [[0.126, 0], [0.37, depth], [0.63, depth], [0.874, 0]];
  const zAt = (x: number): number => {
    const t = (((x - x0 - phase) / pitch) % 1 + 1) % 1;
    if (t < 0.126 || t >= 0.874) return 0;
    if (t < 0.37) return (depth * (t - 0.126)) / 0.244;
    if (t < 0.63) return depth;
    return (depth * (0.874 - t)) / 0.244;
  };
  const pts: Array<[number, number]> = [[x0, zAt(x0)]];
  for (let k = Math.floor((-phase) / pitch) - 1; x0 + phase + k * pitch < x1; k++) {
    for (const [f, z] of marks) {
      const x = x0 + phase + (k + f) * pitch;
      if (x > x0 + 1e-6 && x < x1 - 1e-6) pts.push([x, z]);
    }
  }
  pts.push([x1, zAt(x1)]);
  return pts;
}

/** Quads over a corrugated profile (the sheet itself, or stencil paint lying on it `lift` proud), rects [u0, v0, u1, v1]. */
function onProfile(api: InternalApi, prof: Array<[number, number]>, rects: number[][], lift: number): Mesh {
  const mb = new MeshBuilder(64, 96);
  const zAt = (x: number): number => {
    for (let i = 1; i < prof.length; i++) {
      const a = prof[i - 1] as [number, number], b = prof[i] as [number, number];
      if (x <= b[0]) return a[1] + ((b[1] - a[1]) * (x - a[0])) / Math.max(1e-9, b[0] - a[0]);
    }
    return (prof[prof.length - 1] as [number, number])[1];
  };
  for (const [u0, v0, u1, v1] of rects as Array<[number, number, number, number]>) {
    const xs = [u0, ...prof.map((p) => p[0]).filter((x) => x > u0 + 1e-6 && x < u1 - 1e-6), u1];
    for (let i = 1; i < xs.length; i++) {
      const xa = xs[i - 1] as number, xb = xs[i] as number;
      const za = zAt(xa) + lift, zb = zAt(xb) + lift;
      const len = Math.hypot(xb - xa, zb - za);
      const nx = -(zb - za) / len, nz = (xb - xa) / len;
      const a = mb.vertex(xa, v0, za, nx, 0, nz, xa, v0);
      const b = mb.vertex(xb, v0, zb, nx, 0, nz, xb, v0);
      const c = mb.vertex(xb, v1, zb, nx, 0, nz, xb, v1);
      const d = mb.vertex(xa, v1, za, nx, 0, nz, xa, v1);
      mb.quad(a, b, c, d);
    }
  }
  return api.fromBuilder(mb);
}

/** A corrugated sheet x0..x1 by y0..y1 (XY plane, facing +Z, crests at z = depth), painted `color`, metre UVs. */
function sheet(api: InternalApi, x0: number, x1: number, y0: number, y1: number, pitch: number, depth: number, color: string, rows: number[] = []): { mesh: Mesh; prof: Array<[number, number]> } {
  const prof = corrugation(x0, x1, pitch, depth);
  // Rows of vertices at `rows` (heights strictly inside y0..y1), so painted weathering can change up the sheet.
  const ys = [y0, ...rows.filter((y) => y > y0 + 0.02 && y < y1 - 0.02), y1];
  const rects: number[][] = [];
  for (let i = 1; i < ys.length; i++) rects.push([x0, ys[i - 1] as number, x1, ys[i] as number]);
  const mesh = onProfile(api, prof, rects, 0).paint(lin(color));
  return { mesh, prof };
}

/**
 * Painted-on weathering of steel, in place on a vertex-coloured mesh standing on y = 0: dark grime rising from the
 * ground, rust patches (more of them low down and under the top edge at `top`) in mottled orange-brown, by `wear` 0..1.
 */
export function rustPaint(m: Mesh, api: InternalApi, wear: number, top: number): Mesh {
  const col = m.colors;
  if (!col) return m;
  const pos = m.positions;
  const n = api.noise;
  const o = api.rng() * 100;
  const rust = lin('#7a4423');
  const rustDark = lin('#3e2618');
  const grime = lin('#3a3129');
  const tmp: [number, number, number] = [0, 0, 0];
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i] as number, y = pos[i + 1] as number, z = pos[i + 2] as number;
    out[0] = col[i] as number;
    out[1] = col[i + 1] as number;
    out[2] = col[i + 2] as number;
    const g = Math.max(0, Math.min(1, 1 - y / 0.45)) * (0.3 + 0.3 * wear) * (0.75 + 0.25 * n.noise3(x * 1.7 + o, 0, z * 1.7));
    mixLinear(out, grime, g, out);
    const lean = 0.5 + 0.5 * n.noise3(x * 1.1 + o, y * 0.7, z * 1.1 - o) + 0.25 * Math.max(0, 1 - y / 0.5) + 0.18 * Math.max(0, 1 - (top - y) / 0.5);
    const t0 = 0.95 - 0.35 * wear;
    const r = Math.max(0, Math.min(1, (lean - t0) / 0.12));
    if (r > 0) {
      mixLinear(rust, rustDark, 0.5 + 0.5 * n.noise3(x * 6, y * 6 + o, z * 6), tmp);
      mixLinear(out, tmp, r * 0.9, out);
    }
    col[i] = out[0];
    col[i + 1] = out[1];
    col[i + 2] = out[2];
  }
  return m;
}

/** Uniform random integer in [0, n). */
function pick(api: InternalApi, n: number): number {
  return Math.min(n - 1, Math.floor(api.rng() * n));
}

// ---------------------------------------------------------------------------
// Shipping container
// ---------------------------------------------------------------------------

const OWNER_CODES = ['AETU', 'KSLU', 'TRHU', 'OCMU', 'BXNU', 'GESU', 'MRVU', 'CLDU', 'NKTU', 'PSAU'];

const shippingContainer = defineGenerator({
  id: 'shipping-container',
  description:
    'ISO steel shipping container, long axis X, cargo doors at +X: trapezoid-corrugated side and end walls, corrugated roof, corner posts and castings, top and bottom rails, double doors with four locking bars, cam keepers and handles, stencilled owner code. Weathered paint (grime band at the foot, rust patches, worn edges). length 6.06 (20 ft) or 12.19 (40 ft). Solid box collider; good cover.',
  category: 'props',
  params: {
    length: pNum(6.06, 3, 12.19, 'length (x) in meters: 6.06 for a 20 ft box, 12.19 for 40 ft'),
    color: pColor('#9c3b28', 'paint color (container red #9c3b28, blue #2c5b86, green #3d6b48, grey #8a8f91, white #d8d8d2)'),
    wear: pNum(0.4, 0, 1, 'weathering: rust and grime'),
    variant: pVariant(2, '0 standard 8\'6", 1 high cube 9\'6", 2 standard with one door swung open'),
  },
  run(p, api) {
    const L = p.num('length');
    const c = p.color('color');
    const wear = p.num('wear');
    const variant = p.int('variant');
    const W = 2.438;
    const H = variant === 1 ? 2.896 : 2.591;
    const frame = shade(c, -0.1);
    const dark = '#16171a';
    const white = '#e6e4dc';
    const all = solid(api.box(L - 0.2, 0.06, W - 0.2).translate(0, 0.05, 0), dark);
    const add = (m: Mesh, color: string): void => {
      all.merge(solid(m, color));
    };
    // Corner posts and castings (slightly proud of the posts, with their oval apertures).
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        add(api.box(0.15, H - 0.2, 0.15).translate(sx * (L / 2 - 0.075), H / 2, sz * (W / 2 - 0.075)), frame);
        for (const y of [0.059, H - 0.059]) {
          add(api.box(0.178, 0.118, 0.162).translate(sx * (L / 2 - 0.089), y, sz * (W / 2 - 0.081)), shade(c, -0.18));
          add(api.box(0.012, 0.05, 0.07).translate(sx * (L / 2 + 0.001), y, sz * (W / 2 - 0.081)), dark);
          add(api.box(0.07, 0.05, 0.012).translate(sx * (L / 2 - 0.089), y, sz * (W / 2 + 0.001)), dark);
        }
      }
    }
    // The rear end's rails (the door end's sill and header are built with the doors).
    add(api.box(0.12, 0.12, W - 0.3).translate(-(L / 2 - 0.06), H - 0.06, 0), frame);
    add(api.box(0.12, 0.16, W - 0.3).translate(-(L / 2 - 0.06), 0.08, 0), frame);
    // Side rails and the corrugated side walls, roof and rear end.
    const code = `${OWNER_CODES[pick(api, OWNER_CODES.length)] as string}${String(100000 + pick(api, 900000))}`;
    const check = String(pick(api, 10));
    const sideH = 0.13;
    const sideText = `${code.slice(0, 4)} ${code.slice(4)}`;
    for (const sz of [-1, 1]) {
      add(api.box(L - 0.3, 0.16, 0.1).translate(0, 0.08, sz * (W / 2 - 0.05)), frame);
      add(api.box(L - 0.3, 0.1, 0.1).translate(0, H - 0.05, sz * (W / 2 - 0.05)), frame);
      const x0 = -L / 2 + 0.15, x1 = L / 2 - 0.15;
      const s = sheet(api, x0, x1, 0.16, H - 0.1, 0.278, 0.036, c, [0.45, 1.4]);
      // The owner code near the door end (local +x is world +x on the +Z side, -x on the -Z side).
      const tw = stencilWidth(sideText, sideH);
      const tx = sz > 0 ? x1 - 0.4 - tw : x0 + 0.4;
      const text = onProfile(api, s.prof, stencilRects(sideText, tx, H - 0.5, sideH), 0.002).paint(lin(white));
      s.mesh.merge(text);
      if (sz < 0) s.mesh.rotate(0, 180, 0);
      s.mesh.translate(0, 0, sz * (W / 2 - 0.045));
      all.merge(s.mesh);
    }
    const roof = sheet(api, -L / 2 + 0.15, L / 2 - 0.15, -(W / 2 - 0.1), W / 2 - 0.1, 0.3, 0.018, shade(c, 0.05));
    all.merge(roof.mesh.rotate(-90, 0, 0).translate(0, H - 0.03, 0));
    const rear = sheet(api, -(W / 2 - 0.15), W / 2 - 0.15, 0.16, H - 0.12, 0.278, 0.036, c, [0.45, 1.4]);
    all.merge(rear.mesh.rotate(0, -90, 0).translate(-(L / 2 - 0.045), 0, 0));
    // The doors, built facing +Z in a local frame (u across, z out), turned to face +X.
    const doors = solid(api.box(0.01, 0.01, 0.01).translate(0, 1, -0.02), dark);
    const uMax = W / 2 - 0.15;
    const opened = solid(api.box(0.01, 0.01, 0.01).translate(uMax, 1, 0.02), dark);
    // Door sill and header, set back so the cam keepers and bar ends stand on their faces.
    doors.merge(solid(api.box(W - 0.3, 0.16, 0.15).translate(0, 0.08, -0.025), frame));
    doors.merge(solid(api.box(W - 0.3, 0.24, 0.15).translate(0, H - 0.12, -0.025), frame));
    const ys = 0.16, yh = H - 0.24;
    const lw = uMax - 0.004;
    const swing = 105;
    for (const side of [-1, 1]) {
      const target = variant === 2 && side > 0 ? opened : doors;
      const u0 = side > 0 ? 0.004 : -uMax, u1 = side > 0 ? uMax : -0.004;
      const leaf = (m: Mesh, color: string): void => {
        target.merge(solid(m, color));
      };
      const cu = (u0 + u1) / 2;
      // Frame of the leaf and its corrugated panel (vertical ribs).
      leaf(api.box(lw, 0.08, 0.05).translate(cu, ys + 0.04, 0.025), frame);
      leaf(api.box(lw, 0.08, 0.05).translate(cu, yh - 0.04, 0.025), frame);
      leaf(api.box(0.07, yh - ys - 0.16, 0.05).translate(u0 + 0.035, (ys + yh) / 2, 0.025), frame);
      leaf(api.box(0.07, yh - ys - 0.16, 0.05).translate(u1 - 0.035, (ys + yh) / 2, 0.025), frame);
      const panel = sheet(api, u0 + 0.07, u1 - 0.07, ys + 0.08, yh - 0.08, 0.25, 0.024, c, [0.45, 1.4]);
      if (side > 0) {
        // Owner code with its boxed check digit, and the data lines below it.
        const th = 0.1;
        const cw = stencilWidth(code, th);
        const tx = u1 - 0.18 - cw - th;
        const rects = stencilRects(code, tx, yh - 0.42, th);
        rects.push(...stencilRects(check, tx + cw + th * 0.5, yh - 0.42, th));
        const bx0 = tx + cw + th * 0.35, bx1 = bx0 + th * 0.9, by0 = yh - 0.44, by1 = yh - 0.42 + th + 0.02;
        rects.push([bx0, by0, bx1, by0 + 0.012], [bx0, by1 - 0.012, bx1, by1], [bx0, by0, bx0 + 0.012, by1], [bx1 - 0.012, by0, bx1, by1]);
        rects.push(...stencilRects(variant === 1 ? '45G1' : L > 9 ? '42G1' : '22G1', tx, yh - 0.6, th * 0.8));
        for (let k = 0; k < 3; k++) rects.push(...stencilRects(['MAX GR 30480', 'TARE 2200', 'NET 28280'][k] as string, tx, yh - 1.0 - k * 0.09, 0.055));
        panel.mesh.merge(onProfile(api, panel.prof, rects, 0.002).paint(lin(white)));
      } else {
        // The safety approval plate.
        panel.mesh.merge(onProfile(api, panel.prof, [[u0 + 0.3, 1.4, u0 + 0.52, 1.52]], 0.003).paint(lin('#7d8080')));
      }
      // A swung leaf shows its inner face: give its sheet a back.
      if (target === opened) doubleSided(panel.mesh);
      target.merge(panel.mesh);
      // Two locking bars per leaf, their guides, handles and the cam keepers on the sill and header.
      for (const f of [0.27, 0.73]) {
        const ub = u0 + (u1 - u0) * f;
        const bars = new MeshBuilder(64, 96);
        strut(bars, [ub, 0.08, 0.075], [ub, H - 0.08, 0.075], 0.0135, 6, true);
        leaf(api.fromBuilder(bars), shade(c, -0.05));
        for (const y of [0.55, H * 0.5 + 0.2, yh - 0.35]) leaf(api.box(0.07, 0.04, 0.05).translate(ub, y, 0.07), frame);
        for (const y of [0.1, H - 0.1]) doors.merge(solid(api.box(0.08, 0.09, 0.06).translate(ub, y, 0.08), frame));
        const dir = side > 0 ? -1 : 1;
        const handle = new MeshBuilder(32, 48);
        strut(handle, [ub, 1.08, 0.09], [ub + dir * 0.3, 1.02, 0.095], 0.011, 5, true);
        leaf(api.fromBuilder(handle), shade(c, -0.05));
        leaf(api.box(0.05, 0.05, 0.05).translate(ub, 1.08, 0.08), frame);
        leaf(api.box(0.04, 0.06, 0.04).translate(ub + dir * 0.31, 1.0, 0.07), frame);
      }
      // Hinges on the outer edge.
      const uh = side > 0 ? u1 : u0;
      for (const y of [0.4, 0.95, yh - 0.85, yh - 0.3]) leaf(api.box(0.06, 0.1, 0.06).translate(uh, y, 0.05), frame);
    }
    // The rubber gasket between the closed leaves.
    if (variant !== 2) doors.merge(solid(api.box(0.012, yh - ys, 0.02).translate(0, (ys + yh) / 2, 0.01), dark));
    else {
      opened.translate(-uMax, 0, -0.025).rotate(0, swing, 0).translate(uMax, 0, 0.025);
      // The dark hold behind the open leaf: an inward-facing liner with a timber floor.
      const liner = api.box(L - 0.32, H - 0.32, W - 0.12);
      liner.flipWinding();
      const nr = liner.normals;
      for (let i = 0; i < nr.length; i++) nr[i] = -(nr[i] as number);
      boxUvs(liner);
      const hold = lin('#2a2a2a');
      const floor = lin('#4a3524');
      liner.paintFn((_x, _y, _z, _nx, ny, _nz, out) => {
        if (ny > 0.5) mixLinear(floor, floor, 0, out);
        else mixLinear(hold, hold, 0, out);
      });
      all.merge(liner.translate(0, H / 2 + 0.04, 0));
    }
    doors.merge(opened);
    all.merge(doors.rotate(0, 90, 0).translate(L / 2 - 0.1, 0, 0));
    rustPaint(all, api, wear, H);
    api.add(all, weathered('paint', 0.55, [{ kind: 'grime', amount: 0.2 + 0.3 * wear, color: '#3a2e22' }, { kind: 'edgeWear', amount: 0.4 }]));
    api.collider(boxCollider(0, H / 2, 0, L, H, W));
    if (variant === 2) {
      const t = (swing * Math.PI) / 180;
      const lu = uMax - (lw / 2) * Math.cos(t);
      const lz = 0.025 + (lw / 2) * Math.sin(t);
      api.collider({ kind: 'box', halfExtents: [lw / 2, (yh - ys) / 2, 0.04], offset: [L / 2 - 0.1 + lz, (ys + yh) / 2, -lu], rotation: [0, swing + 90, 0] });
    }
    return api.build();
  },
});

// ---------------------------------------------------------------------------
// Sandbag wall
// ---------------------------------------------------------------------------

/** Length, width and height of one filled sandbag (m), and the course rise and stretch along the run. */
const BAG = { l: 0.52, w: 0.32, h: 0.13, rise: 0.112, step: 0.455 } as const;

/** Canonical bag along +X, centred: a pillowed, squared-off sack with a gathered, tied neck at one end. */
function bagMesh(api: InternalApi, detail: number): Mesh {
  const L = BAG.l;
  const prof: Array<[number, number]> = detail >= 2
    ? [[0, 0], [0.12, 0.0], [0.24, 0.03], [0.12, 0.055], [0.62, 0.085], [0.93, 0.13], [1, 0.19], [1, L - 0.12], [0.95, L - 0.05], [0.75, L - 0.012], [0, L]]
    : detail === 1
      ? [[0, 0], [0.2, 0.02], [0.14, 0.05], [0.7, 0.11], [1, 0.22], [1, L - 0.16], [0.86, L - 0.05], [0, L]]
      : detail === 0
        ? [[0, 0], [0.55, 0.04], [0.95, 0.13], [1, L - 0.14], [0.8, L - 0.04], [0, L]]
        : [[0, 0], [0.8, 0.06], [1, L - 0.1], [0.7, L - 0.02], [0, L]];
  const seg = detail >= 2 ? 10 : detail === 1 ? 8 : detail === 0 ? 6 : 5;
  const m = api.lathe(prof, seg).rotate(0, 0, -90).translate(-L / 2, 0, 0);
  // Square the round section (a filled bag presses flat against its neighbours), then flatten it.
  const pos = m.positions;
  for (let i = 0; i < pos.length; i += 3) {
    const y = pos[i + 1] as number, z = pos[i + 2] as number;
    const r = Math.hypot(y, z);
    if (r < 1e-6) continue;
    const cy = Math.abs(y) / r, cz = Math.abs(z) / r;
    const k = 1 / Math.pow(Math.pow(cy, 3.2) + Math.pow(cz, 3.2), 1 / 3.2);
    let ny = y * k * (BAG.h / 2);
    const nz = z * k * (BAG.w / 2);
    // The weight of the fill: a flat bottom, a slightly domed top.
    ny = Math.max(ny, -BAG.h * 0.42);
    pos[i + 1] = ny;
    pos[i + 2] = nz;
  }
  return m.recomputeNormals();
}

const sandbagWall = defineGenerator({
  id: 'sandbag-wall',
  description:
    'Sandbag wall along X: lumpy filled burlap bags with tied necks laid in staggered courses like brickwork, each bag squashed and jittered. Single row, double thick with header courses, or a slumped heap; optional bend into an arc. Defensive cover for outposts, checkpoints and gun pits. One draw, box colliders.',
  category: 'props',
  params: {
    length: pNum(3, 0.6, 8, 'length of the run in meters'),
    courses: pInt(4, 1, 6, 'height in courses of bags (about 0.11 m each)'),
    bend: pNum(0, -150, 150, 'bend of the run in degrees (0 straight; 90 a quarter ring)'),
    color: pColor('#a8976f', 'bag color (burlap #a8976f, olive #6f6a46, sand #c2b28a)'),
    variant: pVariant(2, '0 single row, 1 double thick with header courses, 2 slumped heap'),
  },
  run(p, api) {
    const L = p.num('length');
    const courses = p.int('courses');
    const bendRad = (p.num('bend') * Math.PI) / 180;
    const base = p.color('color');
    const variant = p.int('variant');
    interface Slot { x: number; y: number; z: number; yaw: number; roll: number; pitch: number }
    const slots: Slot[] = [];
    const jit = (a: number): number => (api.rng() * 2 - 1) * a;
    for (let k = 0; k < courses; k++) {
      const y = k * BAG.rise + BAG.h * 0.42;
      const header = variant === 1 && k % 2 === 1;
      const rows = variant === 1 && !header ? [-0.16, 0.16] : [0];
      const shrink = variant === 2 ? k * BAG.step * 0.5 : 0;
      const step = header ? BAG.w - 0.03 : BAG.step;
      const half = L / 2 - shrink - (header ? BAG.w / 2 : BAG.l / 2 - 0.03);
      if (half < -0.05) break;
      const off = header ? 0 : (k % 2) * BAG.step * 0.5;
      for (const rz of rows) {
        for (let x = -half + off; x <= half + 1e-6; x += step) {
          if (variant === 2 && api.rng() < 0.12 * k) continue;
          slots.push({
            x: x + jit(0.02),
            y: y + (variant === 2 ? jit(0.02) : 0),
            z: rz + jit(variant === 2 ? 0.06 : 0.015) - (variant === 0 ? k * 0.012 : 0),
            yaw: (header ? 90 : 0) + jit(variant === 2 ? 14 : 4) + (api.rng() < 0.5 ? 180 : 0),
            roll: jit(variant === 2 ? 6 : 2.5),
            pitch: jit(variant === 2 ? 8 : 3),
          });
        }
      }
    }
    // Detail of each bag so the run stays within its triangle budget.
    const n = Math.max(1, slots.length);
    let proto = bagMesh(api, 2);
    for (const d of [1, 0, -1]) if (n * proto.triangleCount > 3600) proto = bagMesh(api, d);
    const all = api.box(0.01, 0.01, 0.01).translate(0, BAG.h * 0.4, 0);
    const pal = [base, shade(base, 0.08), shade(base, -0.1), mixHexSafe(base, '#7d7a55', 0.25), mixHexSafe(base, '#b9a782', 0.3)];
    const dirt = lin('#5a4a36');
    const nz = api.noise;
    const place = (x: number, z: number): { px: number; pz: number; yaw: number } => {
      if (Math.abs(bendRad) < 1e-3) return { px: x, pz: z, yaw: 0 };
      const R = L / bendRad;
      const t = x / R;
      return { px: R * Math.sin(t) - z * Math.sin(t), pz: R * (1 - Math.cos(t)) + z * Math.cos(t), yaw: (-t * 180) / Math.PI };
    };
    for (const s of slots) {
      const b = proto.clone();
      const sc = 1 + jit(0.05);
      // Lumps of the fill, different for every bag, fading out toward the gathered ends.
      const o = api.rng() * 100;
      b.displace((x, y, z) => Math.min(1, Math.max(0, (BAG.l / 2 - Math.abs(x)) / 0.1)) * (0.009 * nz.noise3(x * 9 + o, y * 9, z * 9) + 0.004 * nz.noise3(x * 23, y * 23 + o, z * 23)));
      b.scale(sc, 0.92 + jit(0.1), 1 + jit(0.06)).rotate(s.roll, 0, s.pitch).rotate(0, s.yaw, 0);
      const at = place(s.x, s.z);
      b.rotate(0, at.yaw, 0).translate(at.px, s.y, at.pz);
      const tint = lin(pal[pick(api, pal.length)] as string);
      const shadow = lin(shade(pal[0] as string, -0.45));
      b.paintFn((x, y, z, _nx, ny, _nz, out) => {
        mixLinear(tint, tint, 0, out);
        // Seams and the undersides pressed into the course below darken; mud splashed on the lowest course.
        if (ny < -0.2) mixLinear(out, shadow, Math.min(0.7, (-ny - 0.2) * 1.2), out);
        const mud = Math.max(0, 1 - y / 0.22) * (0.55 + 0.35 * nz.noise3(x * 4, y * 4, z * 4));
        if (mud > 0) mixLinear(out, dirt, Math.min(0.75, mud), out);
        const k = 1 + 0.07 * nz.noise3(x * 13 + 5, y * 13, z * 13);
        out[0] *= k;
        out[1] *= k;
        out[2] *= k;
      });
      all.merge(b);
    }
    triBoxUvs(all);
    // Burlap: a coarser, finer-threaded weave than the default cloth scale (about 5 mm a cell).
    const uv = all.uvs;
    for (let i = 0; i < uv.length; i++) uv[i] = (uv[i] as number) * 2;
    api.add(all, finishMat('fabric', 0.95));
    // Colliders: one box per straight stretch (about 1.2 m of an arc).
    const top = slots.reduce((m, s) => Math.max(m, s.y + BAG.h / 2), BAG.h as number);
    const thick = variant === 1 ? 0.62 : variant === 2 ? 0.7 : 0.36;
    const pieces = Math.abs(bendRad) < 1e-3 ? 1 : Math.max(2, Math.ceil(L / 1.2));
    const colliders: ColliderDesc[] = [];
    for (let i = 0; i < pieces; i++) {
      const xc = -L / 2 + (L * (i + 0.5)) / pieces;
      const at = place(xc, 0);
      colliders.push({ kind: 'box', halfExtents: [L / pieces / 2 + 0.05, top / 2, thick / 2], offset: [at.px, top / 2, at.pz], rotation: [0, at.yaw, 0] });
    }
    for (const c of colliders) api.collider(c);
    return api.build();
  },
});

/** Mix two hex colours by t (0 = a). */
function mixHexSafe(a: string, b: string, t: number): string {
  const ca = lin(a), cb = lin(b);
  const out: [number, number, number] = [0, 0, 0];
  mixLinear(ca, cb, t, out);
  const toHex = (v: number): string => {
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, s)) * 255).toString(16).padStart(2, '0');
  };
  return `#${toHex(out[0])}${toHex(out[1])}${toHex(out[2])}`;
}

// ---------------------------------------------------------------------------
// Radio mast
// ---------------------------------------------------------------------------

const radioMast = defineGenerator({
  id: 'radio-mast',
  description:
    'Radio relay / antenna station: a triangular lattice steel mast with zigzag cross bracing, sector panel antennas, two microwave dishes, a lightning rod and a red aviation beacon, a cable ladder and ice bridge to an equipment shelter with vents, an air-conditioner, a door and a glowing status light, on concrete pads; optional guy wires. Galvanized, red-and-white aviation bands, or a tapered self-supporting tower.',
  category: 'props',
  params: {
    height: pNum(15, 6, 40, 'mast height in meters'),
    color: pColor('#a9aeb1', 'steel color (galvanized grey)'),
    guyed: pBool(true, 'guy wires to ground anchors (variants 0 and 1)'),
    variant: pVariant(2, '0 galvanized guyed mast, 1 red-and-white aviation bands, 2 tapered self-supporting tower'),
  },
  run(p, api) {
    const H = p.num('height');
    const steel = p.color('color');
    const variant = p.int('variant');
    const guyed = p.bool('guyed') && variant !== 2;
    const wTop = 0.5;
    const wBase = variant === 2 ? Math.max(1.4, H * 0.1) : wTop;
    const width = (y: number): number => wBase + (wTop - wBase) * Math.min(1, y / H);
    const ang = [90, 210, 330].map((a) => (a * Math.PI) / 180);
    const leg = (i: number, y: number): Vec3 => {
      const r = width(y) / Math.sqrt(3);
      const a = ang[i % 3] as number;
      return [Math.cos(a) * r, y, Math.sin(a) * r];
    };
    // Colour bins: members of one colour share a builder (aviation bands are solid red or white per band).
    const bins = new Map<string, MeshBuilder>();
    const bin = (color: string): MeshBuilder => {
      let b = bins.get(color);
      if (!b) bins.set(color, (b = new MeshBuilder(1024, 1536)));
      return b;
    };
    const bands = 7;
    const colorAt = (y: number): string => (variant === 1 ? (Math.floor((y / H) * bands) % 2 === 0 ? '#c8402c' : '#e9e7e2') : steel);
    // Legs, split at the bands.
    const legPieces = variant === 1 ? bands : Math.max(1, Math.ceil(H / 6));
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < legPieces; k++) {
        const y0 = (H * k) / legPieces, y1 = (H * (k + 1)) / legPieces;
        strut(bin(colorAt((y0 + y1) / 2)), leg(i, y0), leg(i, y1), 0.03, 6, true);
      }
    }
    // Bracing: a zigzag diagonal and a horizontal on each face per section.
    const sections = Math.max(4, Math.round(H / 0.6));
    for (let s = 0; s < sections; s++) {
      const y0 = (H * s) / sections, y1 = (H * (s + 1)) / sections;
      for (let f = 0; f < 3; f++) {
        const flip = (s + f) % 2 === 0;
        const col = colorAt((y0 + y1) / 2);
        strut(bin(col), leg(flip ? f : f + 1, y0), leg(flip ? f + 1 : f, y1), 0.011, 3);
        strut(bin(colorAt(y1 - 0.01)), leg(f, y1), leg(f + 1, y1), 0.011, 3);
      }
    }
    // Lightning rod and whip on top, a cable ladder down one face.
    strut(bin(steel), [0, H, 0], [0, H + 1.6, 0], 0.012, 4);
    strut(bin(steel), leg(1, H), [leg(1, H)[0], H + 0.9, leg(1, H)[2]], 0.008, 3);
    const cableX = (y: number): Vec3 => {
      const a = leg(0, y), b = leg(1, y);
      return [(a[0] * 0.75 + b[0] * 0.25), y, (a[2] * 0.75 + b[2] * 0.25) - 0.05];
    };
    const tray = new MeshBuilder(256, 384);
    // Antenna mounts: a triangular head frame with three vertical pipes, the sector panels on them.
    const headY = H - 1.0;
    const panelColor = '#dcdcd6';
    const paint = api.box(0.01, 0.01, 0.01).translate(0, headY, 0);
    for (let i = 0; i < 3; i++) {
      const a = ang[i] as number;
      const out = (r: number, y: number): Vec3 => [Math.cos(a) * r, y, Math.sin(a) * r];
      const r0 = width(headY) / Math.sqrt(3);
      for (const y of [headY - 0.5, headY + 0.5]) strut(bin(steel), out(r0, y), out(r0 + 0.45, y), 0.02, 4);
      strut(bin(steel), out(r0 + 0.45, headY - 0.9), out(r0 + 0.45, headY + 0.9), 0.025, 6, true);
      const panel = api.box(0.28, 1.3, 0.09).rotate(-4, 0, 0).translate(0, 0, 0.09);
      panel.merge(api.box(0.24, 0.04, 0.05).translate(0, -0.67, 0.08));
      paint.merge(solid(panel, panelColor).rotate(0, 90 - (a * 180) / Math.PI, 0).translate(Math.cos(a) * (r0 + 0.47), headY, Math.sin(a) * (r0 + 0.47)));
    }
    // Two microwave dishes with shrouds and white radomes, on stand-off arms.
    for (const [fy, yawDeg] of [[0.62, 25], [0.78, 160]] as const) {
      const y = H * fy;
      const a = (yawDeg * Math.PI) / 180;
      const R = 0.34;
      const dish = api.cylinder(R, R, 0.24, 14).rotate(90, 0, 0);
      solid(dish, '#d9d9d3');
      const dome = api.lathe([[R * 0.98, 0], [R * 0.85, 0.035], [0, 0.06]], 14).rotate(90, 0, 0).translate(0, 0, 0.12);
      dish.merge(solid(dome, '#efefea'));
      dish.merge(solid(api.cone(R * 0.55, 0.16, 10).rotate(-90, 0, 0).translate(0, 0, -0.2), '#cfcfc9'));
      const r0 = width(y) / Math.sqrt(3);
      const dist = r0 + 0.55;
      dish.rotate(0, 90 - yawDeg, 0).translate(Math.cos(a) * dist, y, Math.sin(a) * dist);
      paint.merge(dish);
      const from = leg(Math.round((((yawDeg - 90) / 120) % 3 + 3) % 3), y);
      strut(bin(steel), from, [Math.cos(a) * (dist - 0.2), y, Math.sin(a) * (dist - 0.2)], 0.025, 6, true);
      strut(bin(steel), [from[0], y - 0.4, from[2]], [Math.cos(a) * (dist - 0.2), y - 0.05, Math.sin(a) * (dist - 0.2)], 0.015, 4);
      // A feeder cable from the dish to the ladder.
      strut(tray, [Math.cos(a) * (dist - 0.2), y - 0.15, Math.sin(a) * (dist - 0.2)], cableX(y - 0.4), 0.012, 4);
    }
    // Shelter at +X, the ice bridge carrying the feeders across.
    const sW = 2.4, sH = 2.5, sD = 2.0;
    const sx = Math.max(wBase / 2, 0.4) + 2.4 + sW / 2;
    const bridgeY = 2.45;
    for (let k = 0; k < 4; k++) {
      const dz = -0.06 + k * 0.04;
      const top = cableX(headY - 0.6);
      const bot = cableX(bridgeY + 0.1);
      strut(tray, [top[0], top[1], top[2] + dz], [bot[0], bot[1], bot[2] + dz], 0.011, 4);
      strut(tray, [bot[0], bridgeY + 0.1, bot[2] + dz], [sx - sW / 2, bridgeY + 0.1, bot[2] + dz * 2], 0.011, 4);
    }
    const ladderTop = cableX(headY - 0.6);
    strut(bin(steel), [ladderTop[0], bridgeY, ladderTop[2] - 0.02], [ladderTop[0], headY - 0.6, ladderTop[2] - 0.02], 0.02, 4);
    const steelMesh = api.box(0.01, 0.01, 0.01).translate(0, 1, 0);
    // The ice bridge: a grating on two posts.
    steelMesh.merge(solid(api.box(sx - sW / 2 - ladderTop[0], 0.03, 0.4).translate((sx - sW / 2 + ladderTop[0]) / 2, bridgeY, ladderTop[2]), steel));
    for (const f of [0.35, 0.8]) {
      const x = ladderTop[0] + (sx - sW / 2 - ladderTop[0]) * f;
      steelMesh.merge(solid(api.cylinder(0.04, 0.04, bridgeY, 8).translate(x, bridgeY / 2, ladderTop[2]), steel));
    }
    // Guy wires to three anchors.
    const concrete = api.box(wBase + 0.8, 0.25, wBase + 0.8).translate(0, 0.125, 0);
    if (guyed) {
      const ra = H * 0.45;
      for (let i = 0; i < 3; i++) {
        const a = (ang[i] as number) + Math.PI / 3 + Math.PI / 3;
        const anchor: Vec3 = [Math.cos(a) * ra, 0.3, Math.sin(a) * ra];
        concrete.merge(api.box(0.7, 0.35, 0.7).rotate(0, (-a * 180) / Math.PI, 0).translate(anchor[0], 0.175, anchor[2]));
        for (const f of [0.35, 0.68, 0.95]) {
          const att = leg(i + 1, H * f);
          strut(bin(steel), att, anchor, 0.006, 3);
        }
      }
    }
    for (const [color, b] of bins) {
      const m = api.fromBuilder(b);
      boxUvs(m);
      steelMesh.merge(m.paint(lin(color)));
    }
    // The equipment shelter.
    const beige = '#cfc9b8';
    const shelter = solid(api.box(sW, sH, sD).translate(sx, sH / 2 + 0.15, 0), beige);
    shelter.merge(solid(api.box(sW + 0.2, 0.12, sD + 0.2).translate(sx, sH + 0.21, 0), shade(beige, -0.08)));
    shelter.merge(solid(api.box(0.9, 2.0, 0.04).translate(sx - 0.4, 1.15, sD / 2 + 0.02), shade(beige, -0.05)));
    shelter.merge(solid(api.box(0.66, 0.3, 0.02).translate(sx - 0.4, 1.75, sD / 2 + 0.045), '#e2c02c'));
    // Louvred vents: a lower one in the door and a high one on the side.
    const louvre = (cx: number, cy: number, z: number, w: number, rows: number, yaw: number): void => {
      const v = api.box(w + 0.04, rows * 0.05 + 0.04, 0.02).translate(0, 0, 0);
      solid(v, shade(beige, -0.15));
      for (let r = 0; r < rows; r++) v.merge(solid(api.box(w, 0.012, 0.05).rotate(-35, 0, 0).translate(0, -rows * 0.025 + 0.025 + r * 0.05, 0.02), shade(beige, -0.1)));
      shelter.merge(v.rotate(0, yaw, 0).translate(cx, cy, z));
    };
    louvre(sx - 0.4, 0.5, sD / 2 + 0.05, 0.5, 5, 0);
    louvre(sx + 0.6, 2.1, sD / 2 + 0.01, 0.6, 4, 0);
    louvre(sx - sW / 2 - 0.01, 1.8, -0.5, 0.5, 4, -90);
    // The air conditioner on the +X wall, its fan behind a dark grille.
    const ac = solid(api.box(0.36, 0.8, 0.75).translate(sx + sW / 2 + 0.18, 1.2, 0.2), '#e1e0db');
    shelter.merge(ac);
    const darkParts = api.cylinder(0.25, 0.25, 0.02, 16).rotate(0, 0, 90).translate(sx + sW / 2 + 0.365, 1.2, 0.2);
    darkParts.merge(api.box(0.035, 0.16, 0.04).translate(sx - 0.05, 1.05, sD / 2 + 0.06));
    darkParts.merge(api.box(0.12, 0.03, 0.03).translate(sx - 0.75, 1.1, sD / 2 + 0.06));
    darkParts.merge(api.box(0.06, 0.25, 0.25).translate(sx - sW / 2 - 0.03, bridgeY + 0.05, ladderTop[2]));
    concrete.merge(api.box(sW + 0.8, 0.15, sD + 0.8).translate(sx, 0.075, 0));
    // Merge the parts into their finishes.
    addFinish(api, concrete, 'concrete', '#a7a39b', { variation: 0.06 });
    const galv = variant === 1 ? weathered('paint', 0.5, [{ kind: 'grime', amount: 0.3 }, { kind: 'streaks', amount: 0.25 }]) : weathered('brushed-metal', 0.55, [{ kind: 'grime', amount: 0.3 }, { kind: 'streaks', amount: 0.3 }]);
    api.add(steelMesh, galv);
    shelter.merge(paint);
    api.add(shelter, weathered('paint', 0.6, [{ kind: 'grime', amount: 0.45, color: '#5a4a38' }, { kind: 'streaks', amount: 0.3 }]));
    const cables = api.fromBuilder(tray);
    boxUvs(cables);
    darkParts.merge(cables);
    addFinish(api, darkParts, 'black-metal', '#26272a', { variation: 0 });
    api.add(api.box(0.06, 0.06, 0.03).translate(sx + 0.25, 2.05, sD / 2 + 0.015), glow('#39ff7a', 3));
    api.add(api.cylinder(0.07, 0.07, 0.14, 10).translate(0, H + 0.08, 0), glow('#ff2a1a', 4));
    // Colliders: the mast, its pad and the shelter.
    api.collider(variant === 2 ? boxCollider(0, H / 2, 0, (wBase + wTop) / 2, H, (wBase + wTop) / 2) : cylinderCollider(0, H / 2, 0, wTop * 0.6, H));
    api.collider(boxCollider(0, 0.125, 0, wBase + 0.8, 0.25, wBase + 0.8));
    api.collider(boxCollider(sx, (sH + 0.27) / 2, 0, sW + 0.2, sH + 0.27, sD + 0.2));
    return api.build();
  },
});

/** Outpost and industrial props in catalog order. */
export const OUTPOST_GENERATORS = [shippingContainer, sandbagWall, radioMast];
