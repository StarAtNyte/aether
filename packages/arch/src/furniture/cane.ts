/**
 * Cane chair: a bent rattan pole frame (swept tubes along smooth curves: legs that flow up into the back posts, hoops,
 * stretchers) with woven-cane panels for the seat and back. The weave is geometry (four layers of thin flat strands at 0, 90,
 * 45 and -45 degrees, clipped to the panel outline), so it needs no texture support and keeps the open hexagonal look.
 * Variants: `dining` chair, tall `bar` chair (footrest ring) and a backless round `stool`.
 */
import { Geom } from '../mesh';
import { PartSet } from '../parts';
import type { P2 } from '../math2';
import { choice, color, mat, num, type FurnitureDef } from './kit';
import { hoop, pole, superEllipse } from './shape';

type V3 = [number, number, number];

/** A flat strand: a thin box of length `len` along `dir`, width `bw` along `side`, thickness `th` along `nrm`, centred on `c`. */
function strand(g: Geom, c: V3, dir: V3, side: V3, nrm: V3, len: number, bw: number, th: number): void {
  const pt = (a: number, b: number, d: number): V3 => [c[0] + dir[0] * a + side[0] * b + nrm[0] * d, c[1] + dir[1] * a + side[1] * b + nrm[1] * d, c[2] + dir[2] * a + side[2] * b + nrm[2] * d];
  const hl = len / 2;
  const hb = bw / 2;
  const ht = th / 2;
  const quad = (p0: V3, p1: V3, p2: V3, p3: V3): void => {
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    let n = [(u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number), (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number), (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number)];
    const l = Math.hypot(n[0] as number, n[1] as number, n[2] as number) || 1;
    n = n.map((x) => x / l);
    const mid = [(p0[0] + p2[0]) / 2 - c[0], (p0[1] + p2[1]) / 2 - c[1], (p0[2] + p2[2]) / 2 - c[2]];
    const flip = (n[0] as number) * (mid[0] as number) + (n[1] as number) * (mid[1] as number) + (n[2] as number) * (mid[2] as number) < 0;
    const ps = flip ? [p0, p3, p2, p1] : [p0, p1, p2, p3];
    const s = flip ? -1 : 1;
    const base = g.vertexCount;
    ps.forEach((p, k) => g.vertex(p[0], p[1], p[2], (n[0] as number) * s, (n[1] as number) * s, (n[2] as number) * s, k === 1 || k === 2 ? len : 0, k >= 2 ? bw : 0));
    g.tri(base, base + 1, base + 2).tri(base, base + 2, base + 3);
  };
  quad(pt(-hl, -hb, ht), pt(hl, -hb, ht), pt(hl, hb, ht), pt(-hl, hb, ht));
  quad(pt(-hl, -hb, -ht), pt(hl, -hb, -ht), pt(hl, hb, -ht), pt(-hl, hb, -ht));
  quad(pt(-hl, -hb, -ht), pt(hl, -hb, -ht), pt(hl, -hb, ht), pt(-hl, -hb, ht));
  quad(pt(-hl, hb, -ht), pt(hl, hb, -ht), pt(hl, hb, ht), pt(-hl, hb, ht));
}

/** Woven cane over a panel: `inside(x, v)` is the outline in panel coordinates; (u, v) are the panel axes in space, `nrm` its normal. */
function cane(o: V3, u: V3, v: V3, nrm: V3, inside: (x: number, y: number) => boolean, extent: number, pitch: number): Geom {
  const g = new Geom();
  const th = 0.0026;
  const bw = pitch * 0.34;
  const at = (x: number, y: number, layer: number): V3 => [o[0] + u[0] * x + v[0] * y + nrm[0] * layer * th, o[1] + u[1] * x + v[1] * y + nrm[1] * layer * th, o[2] + u[2] * x + v[2] * y + nrm[2] * layer * th];
  const dirs: Array<[number, number]> = [[0, 0], [90, 1], [45, 2], [-45, 3]];
  for (const [deg, layer] of dirs) {
    const a = (deg * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const px = -dy;
    const py = dx;
    const step = deg % 90 === 0 ? pitch : pitch * 1.25;
    const dirW: V3 = [u[0] * dx + v[0] * dy, u[1] * dx + v[1] * dy, u[2] * dx + v[2] * dy];
    const sideW: V3 = [u[0] * px + v[0] * py, u[1] * px + v[1] * py, u[2] * px + v[2] * py];
    for (let off = -extent; off <= extent + 1e-6; off += step) {
      let s0: number | null = null;
      let s1 = 0;
      for (let s = -extent * 1.5; s <= extent * 1.5; s += 0.004) {
        if (inside(px * off + dx * s, py * off + dy * s)) {
          if (s0 === null) s0 = s;
          s1 = s;
        }
      }
      if (s0 === null || s1 - s0 < 0.02) continue;
      const mid = (s0 + s1) / 2;
      strand(g, at(px * off + dx * mid, py * off + dy * mid, layer), dirW, sideW, nrm, s1 - s0, bw, th);
    }
  }
  return g;
}

/** Inside test of a superellipse centred at the origin. */
const insideSuper = (a: number, b: number, n: number) => (x: number, y: number): boolean => Math.abs(x / a) ** n + Math.abs(y / b) ** n <= 1;

export const CANE_CHAIR: FurnitureDef = {
  id: 'furn-cane-chair',
  kind: 'cane-chair',
  description:
    'Rattan / wicker / cane chair: bent rattan pole frame with woven-cane seat and back panel. `variant` dining (default), bar (tall, footrest ring) or stool (backless, round woven seat); set `height` to the seat height (bar 0.65-0.75). Front faces +Z.',
  params: {
    variant: choice(['dining', 'bar', 'stool'], 'dining', 'dining chair with an oval cane back, tall bar chair, or backless round stool'),
    height: num(0.46, 0.35, 0.8, 'seat height (m): 0.46 dining, 0.65-0.75 bar / counter'),
    frame: choice(['oak', 'walnut', 'ash', 'black-metal', 'brass'], 'oak', 'pole frame finish (oak tinted honey reads as rattan)'),
    tint: color('#c99c63', 'frame colour (rattan honey by default)'),
    cane: color('#e6d3a4', 'colour of the woven cane'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.4,
  size: (p) => (p.str('variant') === 'stool' ? [0.42, p.num('height'), 0.42] : [0.52, p.num('height') + 0.45, 0.62]),
  build(p) {
    const set = new PartSet();
    const h = p.num('height');
    const variant = p.str('variant');
    const R = 0.0135;
    const frame = new Geom();
    const frameMat = p.str('frame') === 'oak' || p.str('frame') === 'walnut' || p.str('frame') === 'ash' ? mat(p.str('frame'), p.color('tint')) : mat(p.str('frame'));
    const caneMat = mat('ash', p.color('cane'));
    const weave = new Geom();
    if (variant === 'stool') {
      const seatY = h - 0.02;
      const out: P2[] = superEllipse(0.2, 0.2, 2, 28);
      frame.merge(hoop(out, seatY, R, 7));
      frame.merge(hoop(out.map((q): P2 => [q[0] * 0.97, q[1] * 0.97]), seatY - 0.035, R * 0.85, 6));
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const c = Math.cos(a);
        const s = Math.sin(a);
        frame.merge(pole([[c * 0.27, 0.001, s * 0.27], [c * 0.225, h * 0.55, s * 0.225], [c * 0.19, seatY, s * 0.19]], R, 8, 4));
      }
      frame.merge(hoop(superEllipse(0.235, 0.235, 2, 28), h * 0.4, R * 0.9, 6));
      weave.merge(cane([0, seatY - 0.004, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], insideSuper(0.195, 0.195, 2), 0.21, 0.02));
      set.add(frame, frameMat).add(weave, caneMat);
      set.boxMinMax(-0.21, 0, -0.21, 0.21, h, 0.21);
      return set.build();
    }
    const seatY = h - 0.02;
    const sx = 0.235;
    const sz = 0.225;
    const cz = 0.02;
    const out = superEllipse(sx, sz, 5, 40, 0, cz);
    frame.merge(hoop(out, seatY, R, 7));
    frame.merge(hoop(superEllipse(sx * 0.97, sz * 0.97, 5, 40, 0, cz), seatY - 0.04, R * 0.85, 6));
    for (const side of [-1, 1]) {
      // Front legs splay a little; the rear legs sweep up into the back posts.
      frame.merge(pole([[side * 0.215, 0.002, 0.275], [side * 0.222, h * 0.55, 0.24], [side * 0.225, seatY, 0.215]], R, 8, 4));
      frame.merge(pole([[side * 0.205, 0.002, -0.27], [side * 0.215, h * 0.55, -0.225], [side * 0.222, seatY, -0.2], [side * 0.208, h + 0.2, -0.262], [side * 0.186, h + 0.4, -0.318]], R, 8, 6));
    }
    if (variant === 'bar') {
      frame.merge(hoop(superEllipse(0.255, 0.265, 3, 36, 0, 0.0), h * 0.36, R * 0.95, 6));
    } else {
      for (const side of [-1, 1]) frame.merge(pole([[side * 0.219, h * 0.4, 0.246], [side * 0.219, h * 0.4, -0.228]], R * 0.85, 6, 1));
      frame.merge(pole([[-0.219, h * 0.4, 0.246], [0.219, h * 0.4, 0.246]], R * 0.85, 6, 1));
    }
    // Curved back: an oval cane panel in a hoop between the posts, plus a bowed top rail.
    const hb = h - 0.02;
    const lean = -0.262;
    const yc = h + 0.22;
    const zc = -0.2 + lean * (yc - hb);
    const vx: V3 = [0, 1, lean];
    const vl = Math.hypot(1, lean);
    const v: V3 = [0, 1 / vl, lean / vl];
    const nrm: V3 = [0, -lean / vl, 1 / vl];
    const o: V3 = [0, yc, zc];
    const a = 0.178;
    const b = variant === 'bar' ? 0.135 : 0.13;
    void vx;
    const outline = superEllipse(a, b, 3, 36);
    const ring = outline.map((q): V3 => [q[0], yc + v[1] * q[1], zc + v[2] * q[1]]);
    frame.merge(pole([...ring, ring[0] as V3, ring[1] as V3], R * 0.85, 6, 1));
    frame.merge(pole([[-0.186, h + 0.4, -0.318], [-0.09, h + 0.425, -0.312], [0, h + 0.43, -0.31], [0.09, h + 0.425, -0.312], [0.186, h + 0.4, -0.318]], R, 8, 5));
    weave.merge(cane(o, [1, 0, 0], v, nrm, insideSuper(a - 0.006, b - 0.006, 3), 0.2, 0.02));
    weave.merge(cane([0, seatY - 0.004, cz], [1, 0, 0], [0, 0, 1], [0, 1, 0], (x, y) => Math.abs(x / (sx - 0.01)) ** 5 + Math.abs(y / (sz - 0.01)) ** 5 <= 1, 0.26, 0.02));
    set.add(frame, frameMat).add(weave, caneMat);
    set.boxMinMax(-0.24, 0, -0.24, 0.24, seatY, 0.245);
    set.boxMinMax(-0.22, seatY, -0.34, 0.22, h + 0.43, -0.2);
    return set.build();
  },
};

/** Cane / rattan seating. */
export const CANE: readonly FurnitureDef[] = [CANE_CHAIR];
