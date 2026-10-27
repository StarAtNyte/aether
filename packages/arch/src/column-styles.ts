/**
 * Column styles: fluted shafts, classical columns (base, tapering shaft with entasis, capital) and pilasters engaged to
 * a wall. The plain round and square columns stay in `elements.ts`; a column without a `style` never comes through here.
 *
 * Proportions follow the size (the shaft diameter or the width of the pier): a base about half a diameter high, a
 * shaft that narrows to four fifths of its width, a capital three quarters of a diameter high.
 */
import { Geom, box, cylinder, lathe } from './mesh';
import { PartSet } from './parts';
import type { ColumnParams } from './params';
import type { ArchOutput } from './types';
import type { P2 } from './math2';

type V3 = [number, number, number];

/** Base and capital heights for a column. */
export function columnProportions(size: number, height: number): { base: number; cap: number; shaft: number } {
  const base = Math.min(size * 0.5, height * 0.1);
  const cap = Math.min(size * 0.75, height * 0.14);
  return { base, cap, shaft: Math.max(0.05, height - base - cap) };
}

/**
 * A fluted (or smooth) tapering shaft from y0 to y0 + h as one smooth-shaded surface: `flutes` grooves cut into a shaft
 * of radius `r0` at the bottom narrowing to `r1`, with a gentle swelling (entasis) a third of the way up.
 */
function shaft(r0: number, r1: number, y0: number, h: number, flutes: number, entasis: boolean): Geom {
  const g = new Geom();
  const rows = 12;
  const cols = flutes > 0 ? flutes * 6 : 28;
  const depth = flutes > 0 ? 0.075 : 0;
  const pos: V3[][] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const swell = entasis ? 1 + 0.018 * Math.sin(Math.PI * Math.min(1, t * 1.4)) : 1;
    const r = (r0 + (r1 - r0) * t) * swell;
    const row: V3[] = [];
    for (let j = 0; j < cols; j++) {
      const a = (j / cols) * 2 * Math.PI;
      const q = flutes > 0 ? Math.abs(Math.sin((flutes * a) / 2)) : 0;
      // Arrises are sharp, the flute between them a shallow arc.
      const rr = r * (1 - depth * Math.pow(q, 3));
      row.push([rr * Math.cos(a), y0 + h * t, rr * Math.sin(a)]);
    }
    pos.push(row);
  }
  const idx: number[][] = [];
  const circ = 2 * Math.PI * r0;
  for (let i = 0; i <= rows; i++) {
    const row: number[] = [];
    for (let j = 0; j <= cols; j++) {
      const jj = j % cols;
      const p = (pos[i] as V3[])[jj] as V3;
      const a = (pos[i] as V3[])[(jj + 1) % cols] as V3;
      const b = (pos[i] as V3[])[(jj + cols - 1) % cols] as V3;
      const up = (pos[Math.min(rows, i + 1)] as V3[])[jj] as V3;
      const dn = (pos[Math.max(0, i - 1)] as V3[])[jj] as V3;
      const t1: V3 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const t2: V3 = [up[0] - dn[0], up[1] - dn[1], up[2] - dn[2]];
      let n: V3 = [t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]];
      // Orient outward (away from the axis).
      if (n[0] * p[0] + n[2] * p[2] < 0) n = [-n[0], -n[1], -n[2]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      row.push(g.vertex(p[0], p[1], p[2], n[0] / l, n[1] / l, n[2] / l, (j / cols) * circ, p[1]));
    }
    idx.push(row);
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = (idx[i] as number[])[j] as number;
      const b = (idx[i] as number[])[j + 1] as number;
      const c = (idx[i + 1] as number[])[j + 1] as number;
      const d = (idx[i + 1] as number[])[j] as number;
      // Outward winding: seen from outside the angle grows to the right-hand side.
      g.i.push(a, c, b, a, d, c);
    }
  }
  return g;
}

/** Profile of a torus-like moulding between two radii: `[radius, y]` going up. */
function torus(rIn: number, rOut: number, y0: number, h: number): P2[] {
  const out: P2[] = [[rIn, y0]];
  const m = 6;
  for (let i = 0; i <= m; i++) {
    const a = (i / m) * Math.PI;
    out.push([rIn + (rOut - rIn) * Math.sin(a), y0 + h * (i / m)]);
  }
  out.push([rIn, y0 + h]);
  return out;
}

/** Capital geometry on a round shaft ending at radius `r` at height y: neck, echinus, abacus (and scrolls for ionic). */
function capital(kind: NonNullable<ColumnParams['capital']>, r: number, y: number, h: number): Geom {
  const g = new Geom();
  const abacus = h * 0.28;
  const wide = r * 1.55;
  if (kind === 'ionic') {
    // Scroll block: a bolster between two volutes, an abacus above.
    g.merge(lathe([[r, y], [r * 1.12, y + h * 0.25], [r * 1.1, y + h * 0.4]], 24));
    g.merge(box(-wide, y + h * 0.35, -r * 1.05, wide, y + h * 0.72, r * 1.05));
    for (const sx of [-1, 1]) g.merge(cylinder(h * 0.32, h * 0.32, r * 2.05, 16).rotateX(90).translate(sx * (wide - h * 0.05), y + h * 0.53, -r * 1.02 + (r * 2.05) * 0).translate(0, 0, 0));
    g.merge(box(-wide * 1.02, y + h * 0.72, -r * 1.08, wide * 1.02, y + h, r * 1.08));
    return g;
  }
  // Tuscan: a plain echinus; doric: the same with a necking ring and annulets under it.
  const prof: P2[] = [[r, y]];
  if (kind === 'doric') {
    prof.push([r * 1.06, y + h * 0.06], [r, y + h * 0.12], [r * 1.04, y + h * 0.18], [r, y + h * 0.24]);
  } else prof.push([r, y + h * 0.1]);
  const top = y + h - abacus;
  prof.push([r * 1.08, top - h * 0.2], [r * 1.28, top - h * 0.05], [r * 1.34, top]);
  g.merge(lathe(prof, 28));
  g.merge(box(-wide, top, -wide, wide, y + h, wide));
  return g;
}

/** Styled column (not `plain`). */
export function buildStyledColumn(p: ColumnParams): ArchOutput {
  const style = p.style ?? 'plain';
  const set = new PartSet();
  const H = p.height;
  const D = p.size;
  const R = D / 2;
  const { base, cap, shaft: sh } = columnProportions(D, H);
  const cKind = p.capital ?? 'doric';
  const g = new Geom();

  if (style === 'pilaster') {
    // Back on z = 0, projecting toward +Z; the capital and base are moulded blocks.
    const pr = p.projection ?? D / 3;
    g.merge(box(-R * 1.18, 0, 0, R * 1.18, base * 0.55, pr + 0.04));
    g.merge(box(-R * 1.06, base * 0.55, 0, R * 1.06, base, pr + 0.015));
    g.merge(box(-R, base, 0, R, base + sh, pr));
    const top = base + sh;
    g.merge(box(-R * 1.1, top, 0, R * 1.1, top + cap * 0.55, pr + 0.015));
    g.merge(box(-R * 1.3, top + cap * 0.55, 0, R * 1.3, top + cap, pr + 0.045));
    set.add(g, p.finish);
    set.boxMinMax(-R * 1.3, 0, 0, R * 1.3, H, pr + 0.045);
    return set.build();
  }

  if (p.shape === 'square') {
    // A square pier with a moulded base and capital (classical) -- grooves are a round-shaft feature.
    g.merge(box(-R * 1.2, 0, -R * 1.2, R * 1.2, base * 0.55, R * 1.2));
    g.merge(box(-R * 1.08, base * 0.55, -R * 1.08, R * 1.08, base, R * 1.08));
    g.merge(box(-R, base, -R, R, base + sh, R));
    const top = base + sh;
    g.merge(box(-R * 1.1, top, -R * 1.1, R * 1.1, top + cap * 0.5, R * 1.1));
    g.merge(box(-R * 1.32, top + cap * 0.5, -R * 1.32, R * 1.32, top + cap, R * 1.32));
    set.add(g, p.finish);
    set.boxMinMax(-R * 1.32, 0, -R * 1.32, R * 1.32, H, R * 1.32);
    return set.build();
  }

  const flutes = p.flutes ?? (style === 'fluted' ? 20 : 0);
  if (style === 'classical') {
    // Square plinth, a torus and a fillet, then the shaft, the necking and the capital.
    g.merge(box(-R * 1.3, 0, -R * 1.3, R * 1.3, base * 0.4, R * 1.3));
    g.merge(lathe(torus(R * 1.02, R * 1.16, base * 0.4, base * 0.45), 28));
    g.merge(cylinder(R * 1.0, R * 0.96, base * 0.15, 28).translate(0, base * 0.85, 0));
    g.merge(shaft(R * 0.94, R * 0.78, base, sh, flutes, true));
    g.merge(capital(cKind, R * 0.78, base + sh, cap));
    set.add(g, p.finish);
    set.boxMinMax(-R * 1.3, 0, -R * 1.3, R * 1.3, H, R * 1.3);
    return set.build();
  }

  // Fluted: the plain shaft with grooves, on a plain base and cap.
  g.merge(shaft(R, R * 0.92, 0, H, flutes, false));
  set.add(g, p.finish);
  set.boxMinMax(-R, 0, -R, R, H, R);
  return set.build();
}
