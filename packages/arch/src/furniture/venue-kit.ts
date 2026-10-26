/**
 * Shared builders of the venue and public-space pieces (cinema seats, stages, pews, display cases): side-profile prisms,
 * pivoted rotation, pleated cloth, bevelled slabs. Geometry is plain `Geom`, so a piece stays one mesh per material and a
 * hundred copies instance as one draw call per material.
 */
import { Geom, box } from '../mesh';
import type { P2 } from '../math2';
import type { PartSet } from '../parts';
import type { MaterialSpec } from '@aether/core';

type V3 = readonly [number, number, number];

/** Push a triangle whose winding agrees with the outward normal `n` (a hint: only its sign against the face matters). */
function faceTri(g: Geom, a: V3, b: V3, c: V3, n: V3): void {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const gx = (u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number);
  const gy = (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number);
  const gz = (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number);
  const flip = gx * n[0] + gy * n[1] + gz * n[2] < 0;
  const base = g.vertexCount;
  const pts = flip ? [a, c, b] : [a, b, c];
  for (const p of pts) g.vertex(p[0], p[1], p[2], n[0], n[1], n[2], p[2], p[1]);
  g.tri(base, base + 1, base + 2);
}

/**
 * A prism along X from a side profile `[z, y]` (a star-shaped polygon, any winding), spanning x0..x1. Flat shaded.
 * Used for end standards, pew ends, tapered podium sides: anything that is a profile cut out of a plank.
 */
export function prismX(profile: readonly P2[], x0: number, x1: number): Geom {
  const g = new Geom();
  let area = 0;
  let cz = 0;
  let cy = 0;
  for (const p of profile) {
    cz += p[0];
    cy += p[1];
  }
  cz /= profile.length;
  cy /= profile.length;
  for (let k = 0; k < profile.length; k++) {
    const a = profile[k] as P2;
    const b = profile[(k + 1) % profile.length] as P2;
    area += a[0] * b[1] - b[0] * a[1];
  }
  const pts = area >= 0 ? profile.slice() : profile.slice().reverse();
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k] as P2;
    const b = pts[(k + 1) % pts.length] as P2;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
    g.quadAuto([x0, a[1], a[0]], [x1, a[1], a[0]], [x1, b[1], b[0]], [x0, b[1], b[0]], a[0], a[1]);
  }
  for (const [x, nx] of [[x1, 1], [x0, -1]] as const) {
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k] as P2;
      const b = pts[(k + 1) % pts.length] as P2;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
      faceTri(g, [x, cy, cz], [x, a[1], a[0]], [x, b[1], b[0]], [nx, 0, 0]);
    }
  }
  return g;
}

/** Rotate `g` about the X axis through (y = py, z = pz) by `deg` (negative lifts the +Z side up). */
export function rotateXAbout(g: Geom, deg: number, py: number, pz: number): Geom {
  return g.translate(0, -py, -pz).rotateX(deg).translate(0, py, pz);
}

/** Rotate `g` about the Y axis through (x = px, z = pz). */
export function rotateYAbout(g: Geom, deg: number, px: number, pz: number): Geom {
  return g.translate(-px, 0, -pz).rotateY(deg).translate(px, 0, pz);
}

/**
 * A vertical sheet of pleated cloth in the plane z = z0 spanning x0..x1 and yBot..yTop, folds running up and down with
 * amplitude `amp` (m) and `folds` pleats; `sag` pulls the hem in a little between pleats. Double sided. `gather` (0..1) bunches
 * the cloth into tight pleats towards the right edge (a curtain drawn to one side).
 */
export function pleatedCloth(x0: number, x1: number, yBot: number, yTop: number, z0: number, folds: number, amp: number, opts: { rows?: number; segPerFold?: number; hemWave?: number } = {}): Geom {
  const g = new Geom();
  const rows = opts.rows ?? 2;
  const per = Math.max(3, opts.segPerFold ?? 5);
  const cols = Math.max(2, Math.round(folds * per));
  const hem = opts.hemWave ?? 0;
  const at = (c: number, r: number): { p: [number, number, number]; n: [number, number, number] } => {
    const u = c / cols;
    const x = x0 + (x1 - x0) * u;
    const ph = u * folds * Math.PI * 2;
    const t = r / rows;
    const fade = 0.55 + 0.45 * (1 - t);
    const z = z0 + Math.sin(ph) * amp * fade;
    const dz = Math.cos(ph) * amp * fade * ((folds * Math.PI * 2) / (x1 - x0));
    const y = yTop + (yBot - yTop) * t + (t > 0.99 ? Math.sin(ph * 0.5) * hem : 0);
    const l = Math.hypot(dz, 1);
    return { p: [x, y, z], n: [-dz / l, 0, 1 / l] };
  };
  const emit = (back: boolean): void => {
    const base = g.vertexCount;
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const { p, n } = at(c, r);
        const s = back ? -1 : 1;
        g.vertex(p[0], p[1], p[2] + (back ? -0.002 : 0), n[0] * s, n[1] * s, n[2] * s, p[0], p[1]);
      }
    }
    const w = cols + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = base + r * w + c;
        const b = a + 1;
        const d = a + w;
        const e = d + 1;
        // Front faces +z: top-left, bottom-left, bottom-right is counter-clockwise seen from +z.
        if (back) g.tri(a, e, d).tri(a, b, e);
        else g.tri(a, d, e).tri(a, e, b);
      }
    }
  };
  emit(false);
  emit(true);
  return g;
}

/** A slab with its top edges bevelled by `b`: a beam-like cap (benches, counter tops, stage nosings). */
export function bevelSlab(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: number): Geom {
  const g = new Geom();
  const k = Math.min(b, (y1 - y0) * 0.9, (x1 - x0) / 2.2, (z1 - z0) / 2.2);
  g.merge(box(x0, y0, z0, x1, y1 - k, z1));
  // Upper frustum: walls slope in by k on every side.
  const lo = [x0, x1, z0, z1] as const;
  const [a0, a1, c0, c1] = [lo[0] + k, lo[1] - k, lo[2] + k, lo[3] - k];
  g.quadAuto([x0, y1 - k, z1], [x1, y1 - k, z1], [a1, y1, c1], [a0, y1, c1], x0, y1);
  g.quadAuto([x1, y1 - k, z0], [x0, y1 - k, z0], [a0, y1, c0], [a1, y1, c0], -x1, y1);
  g.quadAuto([x1, y1 - k, z1], [x1, y1 - k, z0], [a1, y1, c0], [a1, y1, c1], -z1, y1);
  g.quadAuto([x0, y1 - k, z0], [x0, y1 - k, z1], [a0, y1, c1], [a0, y1, c0], z0, y1);
  g.quadAuto([a0, y1, c1], [a1, y1, c1], [a1, y1, c0], [a0, y1, c0], a0, -c1);
  return g;
}

/** Ring (annulus) in the XZ plane between radii r0 < r1 from y0 to y1, `seg` sides: cup holders, trim rings. */
export function ring(r0: number, r1: number, y0: number, y1: number, seg = 16): Geom {
  const g = new Geom();
  const n = Math.max(6, seg);
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2;
    const a1 = ((k + 1) / n) * Math.PI * 2;
    const [c0, s0, c1, s1] = [Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1)];
    const [cm, sm] = [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2)];
    // Outer wall (faces out), inner wall (faces the hole), top annulus (faces up); corner order gives the winding.
    g.quad([c0 * r1, y0, s0 * r1], [c0 * r1, y1, s0 * r1], [c1 * r1, y1, s1 * r1], [c1 * r1, y0, s1 * r1], [cm, 0, sm], [0, 0, 0, 1, 1, 1, 1, 0]);
    g.quad([c1 * r0, y0, s1 * r0], [c1 * r0, y1, s1 * r0], [c0 * r0, y1, s0 * r0], [c0 * r0, y0, s0 * r0], [-cm, 0, -sm], [0, 0, 0, 1, 1, 1, 1, 0]);
    g.quad([c0 * r0, y1, s0 * r0], [c1 * r0, y1, s1 * r0], [c1 * r1, y1, s1 * r1], [c0 * r1, y1, s0 * r1], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1]);
  }
  return g;
}

/** Mix two `#rrggbb` colours (t = 0 gives a). */
export function mixColor(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const out = pa.map((v, i) => Math.round((v as number) * (1 - t) + (pb[i] as number) * t));
  return `#${out.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

/** A view of a PartSet that moves everything added to it by (dx, dy, dz): lets a builder work in a convenient frame and still centre its footprint. */
export function shifted(set: PartSet, dx: number, dy: number, dz: number): { add(g: Geom, m: MaterialSpec): void; boxMinMax(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void } {
  return {
    add: (g, m) => void set.add(g.translate(dx, dy, dz), m),
    boxMinMax: (x0, y0, z0, x1, y1, z1) => void set.boxMinMax(x0 + dx, y0 + dy, z0 + dz, x1 + dx, y1 + dy, z1 + dz),
  };
}
