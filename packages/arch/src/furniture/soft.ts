/**
 * Window dressings: curtains (pleated, pinch-pleated, eyelet, ripple-fold, sheer; pelmets, valances and swags; rods and
 * tracks; tie-backs; panels that hang open or are drawn) and blinds (roller, roman, venetian, plantation shutters,
 * vertical). Wall pieces: the back is at z = 0 (the wall face), the bottom at y = 0, the width along X.
 *
 * Fabric is a smooth, double-sided sheet whose folds are real sinusoids (normals from finite differences), so the
 * pleats catch light the way fabric does. Everything is bounded: a curtain pair stays under 6k triangles.
 */
import { Geom, box, cylinder, roundedBox, sphere, tube } from '../mesh';
import { PartSet } from '../parts';
import { choice, color, flag, int, mat, num, type FurnitureDef, type ParamReader } from './kit';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (e0: number, e1: number, v: number): number => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

type Fn = (t: number, a: number) => [number, number, number];

/**
 * A smooth double-sided sheet over (t, a) in 0..1 (t across, a down from the top), with normals from the surface's own
 * derivatives. `cols` x `rows` quads.
 */
function sheet(cols: number, rows: number, fn: Fn): Geom {
  const g = new Geom();
  const e = 1e-3;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const t = i / cols;
      const a = j / rows;
      const p = fn(t, a);
      const pt = fn(Math.min(1, t + e), a);
      const pt0 = fn(Math.max(0, t - e), a);
      const pa = fn(t, Math.min(1, a + e));
      const pa0 = fn(t, Math.max(0, a - e));
      const du = [pt[0] - pt0[0], pt[1] - pt0[1], pt[2] - pt0[2]];
      const dv = [pa[0] - pa0[0], pa[1] - pa0[1], pa[2] - pa0[2]];
      // du x dv, pointing toward the room (+Z) for a sheet whose t runs +X and a runs down.
      let nx = (du[1] as number) * (dv[2] as number) - (du[2] as number) * (dv[1] as number);
      let ny = (du[2] as number) * (dv[0] as number) - (du[0] as number) * (dv[2] as number);
      let nz = (du[0] as number) * (dv[1] as number) - (du[1] as number) * (dv[0] as number);
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      if (nz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      g.vertex(p[0], p[1], p[2], nx, ny, nz, p[0], p[1]);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const c = a + cols + 2;
      const d = a + cols + 1;
      g.i.push(a, c, b, a, d, c);
    }
  }
  // The back face: a flipped copy with reversed normals.
  const back = g.clone().flip();
  for (let k = 0; k < back.n.length; k++) back.n[k] = -(back.n[k] as number);
  return g.merge(back);
}

/** Free-standing pieces of the soft furnishings: kinds of curtain fabric treatment. */
export const CURTAIN_STYLES = ['pleated', 'pinch', 'eyelet', 'ripple', 'sheer'] as const;

interface PanelSpec {
  cx: number;
  width: number;
  /** Fabric amplitude multiplier (a drawn panel is stretched: shallower folds). */
  relax: number;
}

/** Where the panels are for the curtain's `panels`, `gap` and `closed` params (centres relative to the piece). */
function panelsOf(p: ParamReader): PanelSpec[] {
  const w = p.num('width');
  const g = p.num('gap');
  const c = p.num('closed');
  const two = p.int('panels') === 2;
  if (!two) {
    const pw = w + (Math.max(w, g) - w) * c;
    return [{ cx: 0, width: pw, relax: Math.min(1, (w / pw) ** 1.5) }];
  }
  const pw = w + (Math.max(w, g / 2 + 0.04) - w) * c;
  const open = g / 2 + w / 2;
  const shut = pw / 2 - 0.02;
  const cx = open + (shut - open) * c;
  const relax = Math.min(1, (w / pw) ** 1.5);
  return [
    { cx: -cx, width: pw, relax },
    { cx, width: pw, relax },
  ];
}

/** Overall width of the treatment (both panels and the clear window between them). */
function spanOf(p: ParamReader): number {
  const w = p.num('width');
  if (p.int('panels') === 2) return p.num('gap') + 2 * w;
  return p.num('closed') > 0 ? Math.max(w, p.num('gap')) : w;
}

function curtainFabric(p: ParamReader, panel: PanelSpec, h: number, styleName: string, yTop: number): { fabric: Geom; rings: Geom } {
  const tie = p.bool('tieback');
  const pool = p.num('pool');
  const pw = panel.width;
  const pitch = styleName === 'pinch' ? 0.2 : styleName === 'eyelet' ? 0.16 : styleName === 'ripple' ? 0.2 : styleName === 'sheer' ? 0.09 : 0.11;
  const amp0 = (styleName === 'pinch' ? 0.05 : styleName === 'eyelet' ? 0.045 : styleName === 'ripple' ? 0.06 : styleName === 'sheer' ? 0.03 : 0.035) * panel.relax;
  const folds = Math.max(3, Math.round(p.num('width') / pitch));
  const cols = folds * 4;
  const yBot = 0.006;
  const a0 = 1 - (pool * 1.5 + 0.02) / Math.max(0.5, yTop);
  const zBase = 0.07;
  const fn: Fn = (t, a) => {
    const y = yTop - (yTop - yBot) * a;
    const ph = t * folds * Math.PI * 2;
    // Pinch pleats are tight at the head and flare below; ripple folds keep one regular wave; a tie gathers the middle.
    let amp = amp0;
    if (styleName === 'pinch') amp *= 0.45 + 0.55 * smooth(0, 0.28, a);
    if (styleName === 'ripple') amp *= 0.9 + 0.1 * Math.cos(a * 3);
    if (tie) amp *= 1 + 0.7 * Math.exp(-(((y - 1.0) / 0.16) ** 2));
    const s = tie ? 1 - 0.32 * Math.exp(-(((y - 1.0) / 0.2) ** 2)) : 1;
    let z = zBase + amp * Math.sin(ph);
    if (pool > 0 && a > a0) z += pool * smooth(0, 1, (a - a0) / (1 - a0));
    return [panel.cx + (t - 0.5) * pw * s, a > a0 && pool > 0 ? Math.max(yBot, y) : y, z];
  };
  const fabric = sheet(cols, 8, fn);
  const rings = new Geom();
  if (styleName === 'eyelet') {
    for (let k = 0; k < folds; k++) {
      const t = (k + 0.25) / folds;
      const [x, y, z] = fn(t, 0.045 / yTop);
      const path: Array<[number, number, number]> = [];
      for (let m = 0; m <= 12; m++) path.push([x + Math.cos((m / 12) * Math.PI * 2) * 0.024, y + Math.sin((m / 12) * Math.PI * 2) * 0.024, z + 0.004]);
      rings.merge(tube(path, 0.004, 5));
    }
  }
  return { fabric, rings };
}

/** A pelmet (boxed), valance (gathered) or swags across `span`, its top edge at height `h` above the piece's origin. */
function addPelmet(set: PartSet, pelmet: string, span: number, h: number, col: string): void {
  if (pelmet === 'box') {
    set.add(box(-span / 2 - 0.05, h - 0.18, 0.004, span / 2 + 0.05, h, 0.18), mat('fabric', col));
  } else if (pelmet === 'valance') {
    const vw = span + 0.1;
    const folds = Math.max(4, Math.round(vw / 0.12));
    set.add(
      sheet(folds * 4, 4, (t, a) => [(t - 0.5) * vw, h - 0.02 - a * (0.26 + 0.03 * Math.sin(t * folds * Math.PI * 2 + 1)), 0.13 + 0.025 * Math.sin(t * folds * Math.PI * 2)]),
      mat('fabric', col),
    );
  } else if (pelmet === 'swag') {
    const n = Math.max(1, Math.round(span / 0.55));
    const vw = span + 0.1;
    set.add(
      sheet(n * 16, 4, (t, a) => {
        const u = (t * n) % 1 || (t >= 1 ? 1 : 0);
        const sag = 0.17 * Math.sin(Math.PI * u);
        return [(t - 0.5) * vw, h - 0.02 - a * (0.07 + sag), 0.12 + 0.04 * Math.sin(Math.PI * u) * (0.4 + a * 0.6)];
      }),
      mat('fabric', col),
    );
  }
}

export const CURTAIN: FurnitureDef = {
  id: 'furn-curtain',
  kind: 'curtain',
  description: 'Curtain panel (pleated, pinch, eyelet, ripple or sheer) on a rod or track, hung beside a window; optional pelmet, tie-back, drawn across, a pair with `panels: 2` (back at z = 0 on the wall).',
  params: {
    width: num(1.6, 0.4, 6, 'gathered width of one panel (m)'),
    height: num(2.6, 1, 4, 'drop (m)'),
    color: color('#e6dfd2', 'fabric colour'),
    sheer: choice(['linen', 'sheer'], 'linen', 'fabric weight'),
    style: choice([...CURTAIN_STYLES], 'pleated', 'heading and fold: pleated, pinch (grouped pleats), eyelet (rings), ripple (deep regular wave), sheer (see-through voile)'),
    pelmet: choice(['none', 'box', 'valance', 'swag'], 'none', 'top treatment: boxed pelmet, gathered valance or draped swags'),
    rod: choice(['rod', 'track', 'none'], 'rod', 'pole with finials, slim track or nothing visible'),
    tieback: flag(false, 'gathered at about 1 m with a tie'),
    closed: num(0, 0, 1, 'how far the panels are drawn across the window (0 open at the sides, 1 closed)'),
    panels: int(1, 1, 2, '1 = one panel; 2 = a pair with the window between them'),
    gap: num(1.2, 0.2, 5, 'clear window width between the two panels (m, panels = 2; also how far a single drawn panel reaches)'),
    pool: num(0, 0, 0.15, 'fabric lying on the floor at the hem (m)'),
  },
  mount: 'wall',
  againstWall: true,
  frontClearance: 0,
  size: (p) => [spanOf(p), p.num('height'), p.str('pelmet') !== 'none' ? 0.2 : 0.14],
  build(p) {
    const set = new PartSet();
    const h = p.num('height');
    const style = p.str('sheer') === 'sheer' && p.str('style') === 'pleated' ? 'sheer' : p.str('style');
    const track = p.str('rod') === 'track';
    const yTop = h - (track ? 0.03 : 0.04);
    const span = spanOf(p);
    const fabricGeom = new Geom();
    const ringGeom = new Geom();
    for (const panel of panelsOf(p)) {
      const { fabric, rings } = curtainFabric(p, panel, h, style, yTop);
      fabricGeom.merge(fabric);
      ringGeom.merge(rings);
    }
    const col = p.color('color');
    const sheerMat = { finish: 'fabric' as const, color: col, opacity: 0.55 };
    set.add(fabricGeom, style === 'sheer' ? sheerMat : mat('fabric', col));
    if (ringGeom.i.length > 0) set.add(ringGeom, mat('brushed-metal', '#8c8f93'));
    if (p.bool('tieback')) {
      const bands = new Geom();
      for (const panel of panelsOf(p)) bands.merge(roundedBox(panel.width * 0.42 + 0.05, 0.05, 0.13, 0.012, 2).translate(panel.cx, 1.0, 0.07));
      set.add(bands, mat('fabric', '#8a7b66'));
    }
    const rod = p.str('rod');
    const pelmet = p.str('pelmet');
    if (rod === 'rod' && pelmet !== 'box') {
      const fit = new Geom();
      fit.merge(tube([[-span / 2 - 0.08, h - 0.035, 0.07], [span / 2 + 0.08, h - 0.035, 0.07]], 0.012, 8));
      for (const s of [-1, 1]) fit.merge(sphere(0.022, 10).translate(s * (span / 2 + 0.09), h - 0.035, 0.07));
      set.add(fit, mat('black-metal'));
    } else if (rod === 'track' && pelmet !== 'box') {
      set.add(box(-span / 2 - 0.02, h - 0.03, 0.02, span / 2 + 0.02, h, 0.055), mat('paint', '#f1eee8'));
    }
    if (pelmet !== 'none') addPelmet(set, pelmet, span, h, col);
    return set.build();
  },
};

export const BLIND_STYLES = ['roller', 'roman', 'venetian', 'shutter', 'vertical'] as const;

export const BLIND: FurnitureDef = {
  id: 'furn-blind',
  kind: 'blind',
  description: 'Window blind (roller, roman, venetian, plantation shutter or vertical) hung over a window; `drawn` is how far it is lowered (shutters: louvres closed). Back at z = 0 on the wall, hung centred on the window.',
  params: {
    width: num(1.2, 0.3, 4, 'width (m): the window width plus about 0.1'),
    height: num(1.5, 0.5, 3.2, 'height (m): the window height plus about 0.1'),
    color: color('#e9e4d8', 'fabric / slat colour'),
    style: choice([...BLIND_STYLES], 'roller', 'roller, roman (stacked folds), venetian (slats), shutter (louvred leaves in a frame), vertical (hanging slats)'),
    drawn: num(0.5, 0, 1, 'how far the blind is lowered from the head (shutters: how closed the louvres are)'),
  },
  mount: 'wall',
  againstWall: true,
  frontClearance: 0,
  size: (p) => [p.num('width'), p.num('height'), p.str('style') === 'shutter' ? 0.07 : 0.1],
  build(p) {
    const set = new PartSet();
    const w = p.num('width');
    const h = p.num('height');
    const col = p.color('color');
    const drawn = p.num('drawn');
    const style = p.str('style');
    const rail = h - 0.05;
    const lowered = Math.max(0.02, drawn * (h - 0.06));
    const bottom = Math.max(0.02, h - 0.05 - lowered);
    if (style === 'roller') {
      set.add(cylinder(0.035, 0.035, w, 16).translate(0, -w / 2, 0).rotateZ(90).translate(0, h - 0.04, 0.045), mat('paint', '#f1eee8'));
      set.add(box(-w / 2 + 0.005, bottom, 0.036, w / 2 - 0.005, h - 0.05, 0.042), mat('fabric', col));
      set.add(box(-w / 2 + 0.005, bottom - 0.02, 0.032, w / 2 - 0.005, bottom + 0.006, 0.05), mat('paint', '#d9d4c8'));
    } else if (style === 'roman') {
      set.add(box(-w / 2, h - 0.05, 0.0, w / 2, h, 0.07), mat('paint', '#f1eee8'));
      const folds = Math.max(1, Math.round(lowered / 0.18));
      set.add(
        sheet(Math.max(2, Math.round(w / 0.1)), folds * 6, (t, a) => {
          const y = h - 0.05 - a * lowered;
          const f = (a * folds) % 1;
          return [(t - 0.5) * (w - 0.01), y, 0.03 + 0.032 * Math.sin(Math.PI * (a >= 1 ? 1 : f))];
        }),
        mat('fabric', col),
      );
      set.add(box(-w / 2 + 0.005, bottom - 0.015, 0.02, w / 2 - 0.005, bottom + 0.01, 0.07), mat('paint', '#d9d4c8'));
    } else if (style === 'venetian') {
      set.add(box(-w / 2, h - 0.05, 0.0, w / 2, h, 0.05), mat('paint', '#f1eee8'));
      const slats = new Geom();
      const n = Math.max(1, Math.floor(lowered / 0.027));
      for (let k = 0; k < n; k++) slats.merge(box(-w / 2 + 0.01, -0.0015, -0.0125, w / 2 - 0.01, 0.0015, 0.0125).rotateX(-18).translate(0, h - 0.06 - k * 0.027, 0.03));
      set.add(slats, { finish: 'paint', color: col, roughness: 0.45 });
      set.add(box(-w / 2 + 0.01, h - 0.07 - n * 0.027, 0.015, w / 2 - 0.01, h - 0.06 - n * 0.027 + 0.008, 0.045), mat('paint', '#d9d4c8'));
      set.add(box(-w / 2 + 0.02, h - 0.06 - n * 0.027, 0.0, -w / 2 + 0.024, h - 0.05, 0.002), mat('paint', '#cfcabd'));
    } else if (style === 'shutter') {
      const stile = 0.05;
      const frame = new Geom();
      frame.merge(box(-w / 2, 0, 0, -w / 2 + stile, h, 0.05));
      frame.merge(box(w / 2 - stile, 0, 0, w / 2, h, 0.05));
      frame.merge(box(-w / 2, 0, 0, w / 2, 0.08, 0.05));
      frame.merge(box(-w / 2, h - 0.08, 0, w / 2, h, 0.05));
      frame.merge(box(-0.012, 0.08, 0.0, 0.012, h - 0.08, 0.05));
      const louvres = new Geom();
      const pitch = 0.062;
      const n = Math.max(2, Math.floor((h - 0.2) / pitch));
      const tilt = 8 + drawn * 62;
      const inner = w / 2 - stile - 0.014;
      for (let k = 0; k < n; k++) {
        const y = 0.1 + pitch * (k + 0.5);
        louvres.merge(box(0.014, -0.0075, -0.026, inner, 0.0075, 0.026).rotateX(-tilt).translate(0, y, 0.025));
        louvres.merge(box(-inner, -0.0075, -0.026, -0.014, 0.0075, 0.026).rotateX(-tilt).translate(0, y, 0.025));
      }
      set.add(frame, mat('paint', col));
      set.add(louvres, mat('paint', col));
    } else {
      set.add(box(-w / 2, h - 0.05, 0.0, w / 2, h, 0.06), mat('paint', '#f1eee8'));
      const slats = new Geom();
      const sw = 0.09;
      const n = Math.max(2, Math.floor(w / (sw - 0.004)));
      const step = (w - 0.02 - sw) / Math.max(1, n - 1);
      for (let k = 0; k < n; k++) slats.merge(box(-sw / 2, -0.001, 0, sw / 2, lowered, 0.002).translate(0, h - 0.05 - lowered, 0).rotateY((k % 2 === 0 ? 1 : -1) * 14).translate(-w / 2 + 0.01 + sw / 2 + k * step, 0, 0.035));
      set.add(slats, mat('fabric', col));
    }
    return set.build();
  },
};


export const PELMET: FurnitureDef = {
  id: 'furn-pelmet',
  kind: 'pelmet',
  description: 'Pelmet, valance or swags spanning a whole window dressing (both curtain panels), top edge at `height`. place_items curtain with a pelmet param adds it for you.',
  params: {
    width: num(2.4, 0.4, 8, 'width across both panels (m)'),
    height: num(0.3, 0.15, 0.6, 'height of the piece (m)'),
    color: color('#e6dfd2', 'fabric colour'),
    style: choice(['box', 'valance', 'swag'], 'box', 'boxed pelmet, gathered valance or draped swags'),
  },
  mount: 'wall',
  againstWall: true,
  frontClearance: 0,
  size: (p) => [p.num('width'), p.num('height'), 0.2],
  build(p) {
    const set = new PartSet();
    addPelmet(set, p.str('style'), p.num('width') - 0.1, p.num('height'), p.color('color'));
    return set.build();
  },
};

/** Soft furnishings of the catalogue. */
export const SOFT: readonly FurnitureDef[] = [CURTAIN, BLIND, PELMET];
