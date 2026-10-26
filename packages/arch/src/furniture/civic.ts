/**
 * Public-space pieces: church pew and altar, library stack, museum vitrine and plinth, reception / concession / bar counters,
 * school desk and blackboard. Like the venue pieces they are one mesh per material with real moulding, kept under a few
 * thousand triangles so rows of them instance cheaply.
 */
import { Geom, box, cylinder, lathe, roundedBox, sphere } from '../mesh';
import { PartSet } from '../parts';
import type { P2 } from '../math2';
import { WOODS, choice, color, flag, int, mat, num, seeded, type FurnitureDef } from './kit';
import { bevelSlab, mixColor, pleatedCloth, prismX, shifted } from './venue-kit';

const paint = (c: string, roughness = 0.7) => ({ finish: 'paint' as const, color: c, roughness });
const EMISSIVE = (c: string, k: number) => ({ preset: 'emissive' as const, color: c, emissive: c, emissiveIntensity: k });
const TIMBER = ['oak', 'walnut', 'ash'];

// ---------------------------------------------------------------------------
// Pew
// ---------------------------------------------------------------------------

export const PEW: FurnitureDef = {
  id: 'furn-pew',
  kind: 'pew',
  description:
    'Church pew / chapel bench: carved end panels, a raked back with a rounded top rail, solid front panel, seat board, a hymn-book shelf on the back and a hinged kneeler with a cushion. The sitter faces +Z. A nave is a grid of these: shape_land {op:"grid", of:"furn-pew"} with a centre aisle.',
  params: {
    length: num(2.6, 1.2, 6, 'length along X (m)'),
    wood: choice(TIMBER, 'oak', 'timber'),
    cushion: color('#6b1a24', 'kneeler and seat pad colour'),
    kneeler: flag(true, 'a hinged kneeler cushion at the front'),
    pad: flag(false, 'a long seat cushion'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.5,
  size: (p) => [p.num('length'), 1.0, 0.95],
  build(p) {
    const set = new PartSet();
    const L = p.num('length');
    const wood = mat(p.str('wood'));
    const dark = mat(p.str('wood') === 'oak' ? 'walnut' : 'oak');
    const body = new Geom();
    // End panels: a profile with a stepped front, a curled arm and a raked back top.
    const prof: P2[] = [[-0.42, 0], [0.4, 0], [0.4, 0.1], [0.42, 0.12], [0.42, 0.47], [0.2, 0.5], [0.05, 0.52], [-0.14, 0.99], [-0.26, 1.02], [-0.38, 0.99], [-0.42, 0.9]];
    for (const s of [-1, 1] as const) {
      const x = s * (L / 2 - 0.03);
      body.merge(prismX(prof, x - 0.03, x + 0.03));
      // A raised moulding on the outside of each end.
      body.merge(box(x + (s > 0 ? 0.03 : -0.04), 0.14, -0.3, x + (s > 0 ? 0.04 : -0.03), 0.4, 0.3));
      body.merge(box(x + (s > 0 ? 0.03 : -0.04), 0.55, -0.34, x + (s > 0 ? 0.04 : -0.03), 0.9, -0.14));
    }
    const x0 = -L / 2 + 0.06;
    const x1 = L / 2 - 0.06;
    body.merge(box(x0, 0.1, 0.36, x1, 0.45, 0.4)); // front panel
    body.merge(box(x0, 0.04, 0.34, x1, 0.1, 0.4)); // plinth
    set.add(body, wood);
    const seat = bevelSlab(x0, 0.44, -0.18, x1, 0.475, 0.4, 0.008);
    // Rake: the back boards lean.
    const back = new Geom();
    back.merge(box(x0, 0.5, -0.025, x1, 0.74, 0.025).rotateX(-11).translate(0, 0, -0.2));
    back.merge(box(x0, 0.78, -0.02, x1, 0.86, 0.02).rotateX(-11).translate(0, 0, -0.2));
    const topRail = roundedBox(x1 - x0, 0.07, 0.06, 0.028, 2).rotateX(-11).translate((x0 + x1) / 2, 0.97, -0.285);
    set.add(seat.merge(back), dark);
    set.add(topRail, wood);
    // Hymn-book shelf on the back of the pew (for the row behind) and a few books.
    const shelf = new Geom();
    shelf.merge(box(x0 + 0.1, 0.62, -0.46, x1 - 0.1, 0.65, -0.31));
    shelf.merge(box(x0 + 0.1, 0.65, -0.47, x1 - 0.1, 0.72, -0.455));
    set.add(shelf, wood);
    const rnd = seeded(7);
    const books = new Geom();
    for (let k = 0; k < Math.floor((x1 - x0) / 0.5); k++) books.merge(roundedBox(0.14, 0.02, 0.2, 0.004, 1).translate(x0 + 0.35 + k * 0.5 + rnd() * 0.08, 0.66, -0.38));
    set.add(books, paint('#24302a', 0.5));
    if (p.bool('kneeler')) {
      const k = new Geom();
      k.merge(roundedBox(L - 0.3, 0.07, 0.17, 0.03, 2).translate(0, 0.13, 0.5));
      set.add(k, { finish: 'velvet', color: p.color('cushion') });
      const hang = new Geom();
      hang.merge(box(-L / 2 + 0.2, 0.06, 0.4, -L / 2 + 0.23, 0.15, 0.46));
      hang.merge(box(L / 2 - 0.23, 0.06, 0.4, L / 2 - 0.2, 0.15, 0.46));
      set.add(hang, wood);
    }
    if (p.bool('pad')) set.add(roundedBox(L - 0.3, 0.04, 0.4, 0.018, 2).translate(0, 0.495, 0.1), { finish: 'velvet', color: p.color('cushion') });
    set.boxMinMax(-L / 2, 0, -0.42, L / 2, 0.5, 0.42);
    set.boxMinMax(-L / 2, 0.5, -0.46, L / 2, 1.02, -0.2);
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Altar
// ---------------------------------------------------------------------------

/** A candlestick: lathe-turned stem and drip pan, a candle and an emissive flame. */
function candlestick(set: PartSet, x: number, y: number, z: number, h: number): void {
  const stem: P2[] = [[0, 0], [0.05, 0], [0.05, 0.01], [0.03, 0.03], [0.012, 0.06], [0.014, 0.1], [0.026, 0.12], [0.012, 0.14], [0.012, h * 0.55], [0.03, h * 0.58], [0.03, h * 0.6], [0.012, h * 0.62], [0.012, h * 0.82], [0.032, h * 0.84], [0.032, h * 0.86], [0.0, h * 0.86]];
  set.add(lathe(stem, 14).translate(x, y, z), mat('brass'));
  set.add(cylinder(0.014, 0.014, 0.12, 10).translate(x, y + h * 0.86, z), paint('#f2eee0', 0.5));
  set.add(sphere(0.011, 8).scale(1, 1.8, 1).translate(x, y + h * 0.86 + 0.14, z), EMISSIVE('#ffd089', 6));
}

export const ALTAR: FurnitureDef = {
  id: 'furn-altar',
  kind: 'altar',
  description:
    'Altar / communion table: panelled front in timber or carved stone, a mensa top, a white linen cloth with a gold fringe, and (with `objects`) a brass cross between two candlesticks with lit candles. Faces +Z (the priest stands behind, at -Z, or the congregation at +Z).',
  params: {
    variant: choice(['wood', 'stone'], 'wood', 'timber table or stone block'),
    width: num(1.8, 1, 3.5, 'width (m)'),
    cloth: color('#f1ede2', 'linen colour'),
    objects: flag(true, 'cross and two candlesticks'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 1.5,
  size: (p) => [p.num('width'), p.bool('objects') ? 1.65 : 1.0, 0.8],
  build(p) {
    const set = new PartSet();
    const w = p.num('width');
    const d = 0.8;
    const stone = p.str('variant') === 'stone';
    const base = stone ? mat('stone') : mat('walnut');
    const trim = stone ? mat('marble') : mat('oak');
    const body = new Geom();
    body.merge(box(-w / 2 + 0.05, 0.08, -d / 2 + 0.05, w / 2 - 0.05, 0.92, d / 2 - 0.05));
    body.merge(box(-w / 2, 0, -d / 2, w / 2, 0.08, d / 2));
    set.add(body, base);
    const panels = new Geom();
    const n = Math.max(3, Math.round(w / 0.55));
    const pw = (w - 0.2) / n;
    for (let k = 0; k < n; k++) {
      const x = -w / 2 + 0.1 + k * pw + 0.04;
      panels.merge(box(x, 0.2, d / 2 - 0.05, x + pw - 0.08, 0.8, d / 2 - 0.03));
    }
    set.add(panels, trim);
    set.add(bevelSlab(-w / 2 - 0.04, 0.92, -d / 2 - 0.04, w / 2 + 0.04, 1.0, d / 2 + 0.04, 0.012), trim);
    // Linen: a runner over the top with a front hang, fringe at the hem.
    const cl = { finish: 'fabric' as const, color: p.color('cloth') };
    const runX0 = -w * 0.38;
    const runX1 = w * 0.38;
    set.add(box(runX0, 1.0, -d / 2 - 0.02, runX1, 1.006, d / 2 + 0.02), cl);
    set.add(pleatedCloth(runX0, runX1, 0.6, 1.0, d / 2 + 0.045, Math.round(w * 4), 0.012, { rows: 2 }), cl);
    set.add(box(runX0, 0.585, d / 2 + 0.03, runX1, 0.62, d / 2 + 0.06), mat('brass'));
    if (p.bool('objects')) {
      const y = 1.006;
      // Cross on a stepped foot.
      const cross = new Geom();
      cross.merge(lathe([[0, 0], [0.09, 0], [0.09, 0.02], [0.05, 0.05], [0.025, 0.1], [0.02, 0.2], [0.0, 0.2]], 14));
      cross.merge(roundedBox(0.035, 0.46, 0.035, 0.008, 1).translate(0, 0.43, 0));
      cross.merge(roundedBox(0.2, 0.035, 0.035, 0.008, 1).translate(0, 0.54, 0));
      set.add(cross.translate(0, y, 0), mat('brass'));
      candlestick(set, -0.4, y, 0.0, 0.42);
      candlestick(set, 0.4, y, 0.0, 0.42);
    }
    set.boxMinMax(-w / 2, 0, -d / 2, w / 2, 1.0, d / 2);
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Library stack
// ---------------------------------------------------------------------------

const SPINES = ['#7a3b2e', '#2f4858', '#d9c7a3', '#556b4f', '#a23f3f', '#3c3a45'];

export const LIBRARY_STACK: FurnitureDef = {
  id: 'furn-library-stack',
  kind: 'library-stack',
  description:
    'Library stack: a freestanding double-sided bookcase of full shelves of books on both faces, thick end panels with label holders, a top cap and a plinth. 0.5 m deep, 2.0 m tall by default. Rows of stacks: shape_land {op:"grid", of:"furn-library-stack"} with 1.6-2 m between rows.',
  params: {
    width: num(1.0, 0.6, 2, 'length of the stack (m)'),
    height: num(2.0, 0.9, 2.6, 'height (m)'),
    shelves: int(6, 3, 9, 'shelves per side'),
    wood: choice(TIMBER, 'oak', 'timber'),
    fill: num(0.92, 0.3, 1, 'how full the shelves are'),
    sided: choice(['double', 'single'], 'double', 'books on both faces, or one (against a wall)'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.9,
  size: (p) => [p.num('width'), p.num('height'), p.str('sided') === 'single' ? 0.32 : 0.5],
  build(p, seed) {
    const set = new PartSet();
    const w = p.num('width');
    const h = p.num('height');
    const n = p.int('shelves');
    const double = p.str('sided') === 'double';
    const d = double ? 0.5 : 0.32;
    const t = 0.02;
    const wood = mat(p.str('wood'));
    const frame = new Geom();
    for (const s of [-1, 1] as const) frame.merge(box(s * (w / 2) - (s > 0 ? 0.035 : 0), 0, -d / 2, s * (w / 2) + (s > 0 ? 0 : 0.035), h, d / 2));
    const kick = 0.1;
    const top = h - 0.05;
    const pitch = (top - kick) / n;
    for (let k = 0; k <= n; k++) frame.merge(box(-w / 2 + 0.035, kick + k * pitch - t / 2, -d / 2 + 0.01, w / 2 - 0.035, kick + k * pitch + t / 2, d / 2 - 0.01));
    frame.merge(box(-w / 2 + 0.035, 0, -d / 2 + 0.03, w / 2 - 0.035, kick, d / 2 - 0.03));
    frame.merge(box(-w / 2 - 0.015, h - 0.05, -d / 2 - 0.02, w / 2 + 0.015, h, d / 2 + 0.02));
    if (double) frame.merge(box(-w / 2 + 0.035, kick, -0.006, w / 2 - 0.035, top, 0.006));
    else frame.merge(box(-w / 2 + 0.035, kick, -d / 2, w / 2 - 0.035, top, -d / 2 + 0.01));
    set.add(frame, wood);
    // Label holders on each end panel, one per shelf.
    const labels = new Geom();
    for (let k = 0; k < n; k++) for (const s of [-1, 1] as const) {
      const y = kick + k * pitch + pitch * 0.5;
      labels.merge(box(s * (w / 2) + (s > 0 ? 0 : -0.002), y - 0.02, -0.04, s * (w / 2) + (s > 0 ? 0.002 : 0), y + 0.02, 0.04));
    }
    set.add(labels, mat('brass'));
    const rnd = seeded(seed * 2654435761 + 91);
    const byColor = SPINES.map(() => new Geom());
    const sides = double ? [-1, 1] : [1];
    for (const side of sides) {
      const zFront = double ? side * 0.01 : -d / 2 + 0.012;
      for (let k = 0; k < n; k++) {
        const y0 = kick + k * pitch + t / 2;
        let x = -w / 2 + 0.045;
        const xEnd = w / 2 - 0.045;
        while (x < xEnd - 0.02) {
          if (rnd() > p.num('fill')) {
            x += 0.05 + rnd() * 0.12;
            continue;
          }
          const bw = 0.02 + rnd() * 0.03;
          const bh = Math.min(pitch - t - 0.03, 0.2 + rnd() * 0.1);
          const bd = Math.min(0.2, (double ? d / 2 : d) - 0.05) - rnd() * 0.02;
          const ci = Math.floor(rnd() * SPINES.length);
          const zc = double ? side * (0.012 + bd / 2) : zFront + bd / 2;
          const lean = rnd() < 0.04 ? 0 : 0;
          void lean;
          byColor[ci]!.merge(box(x, y0, zc - bd / 2, x + bw, y0 + bh, zc + bd / 2));
          x += bw + 0.002;
        }
      }
    }
    byColor.forEach((g, i) => set.add(g, paint(SPINES[i] as string, 0.7)));
    set.boxMinMax(-w / 2, 0, -d / 2, w / 2, h, d / 2);
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Vitrine / plinth
// ---------------------------------------------------------------------------

function exhibit(kind: string, h: number): Geom {
  if (kind === 'vase') return lathe([[0, 0], [0.07, 0], [0.09, 0.03], [0.14, 0.14], [0.15, 0.22], [0.1, 0.32], [0.05, 0.38], [0.055, 0.44], [0.08, 0.5], [0.0, 0.5]].map(([r, y]) => [(r as number) * (h / 0.5), (y as number) * (h / 0.5)] as P2), 20);
  if (kind === 'bowl') return lathe([[0, 0], [0.06, 0], [0.1, 0.02], [0.2, 0.08], [0.24, 0.13], [0.23, 0.135], [0.18, 0.1], [0.08, 0.04], [0.0, 0.03]].map(([r, y]) => [(r as number) * (h / 0.25), (y as number) * (h / 0.25)] as P2), 22);
  if (kind === 'bust') {
    const g = new Geom();
    g.merge(lathe([[0, 0], [0.11, 0], [0.11, 0.03], [0.08, 0.05], [0.0, 0.05]], 16));
    g.merge(sphere(0.12, 18).scale(1, 1.25, 1.1).translate(0, 0.34, 0));
    g.merge(cylinder(0.05, 0.06, 0.12, 12).translate(0, 0.14, 0));
    g.merge(roundedBox(0.3, 0.14, 0.17, 0.05, 2).translate(0, 0.08, 0));
    return g.scale(h / 0.5);
  }
  if (kind === 'urn') return lathe([[0, 0], [0.06, 0], [0.08, 0.04], [0.16, 0.16], [0.17, 0.26], [0.12, 0.38], [0.07, 0.42], [0.1, 0.46], [0.11, 0.5], [0.0, 0.5]].map(([r, y]) => [(r as number) * (h / 0.5), (y as number) * (h / 0.5)] as P2), 20);
  return new Geom();
}

export const VITRINE: FurnitureDef = {
  id: 'furn-vitrine',
  kind: 'vitrine',
  description:
    'Museum display: `variant` case (glass vitrine on a plinth with a steel frame and a warm LED strip), plinth (a bare white pedestal with a cap) or table (low flat display table with a glass top). `object` is the exhibit on show: vase, bowl, bust, urn or none. Footprint 0.9 x 0.6 m by default.',
  params: {
    variant: choice(['case', 'plinth', 'table'], 'case', 'glass case on a base, bare pedestal, or table case'),
    object: choice(['vase', 'bowl', 'bust', 'urn', 'none'], 'vase', 'what is displayed'),
    width: num(0.9, 0.3, 3, 'width (m)'),
    depth: num(0.6, 0.3, 1.5, 'depth (m)'),
    height: num(1.55, 0.4, 2.4, 'overall height (m; a table case is about 0.95)'),
    base: color('#e9e6df', 'base / plinth colour'),
    frame: choice(['brushed-metal', 'black-metal', 'brass', 'chrome'], 'brushed-metal', 'case frame'),
    lit: flag(true, 'LED strip inside the case'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.8,
  size: (p) => [p.num('width'), p.str('variant') === 'table' ? Math.min(1.1, p.num('height')) : p.num('height'), p.num('depth')],
  build(p) {
    const set = new PartSet();
    const w = p.num('width');
    const d = p.num('depth');
    const v = p.str('variant');
    const H = v === 'table' ? Math.min(1.1, p.num('height')) : p.num('height');
    const baseCol = paint(p.color('base'), 0.55);
    const steel = mat(p.str('frame'));
    const obj = p.str('object');
    const glass = { finish: 'glass' as const, color: '#dfeaf0', opacity: 0.16, roughness: 0.04 };
    if (v === 'plinth') {
      set.add(box(-w / 2, 0, -d / 2, w / 2, 0.06, d / 2), baseCol);
      set.add(box(-w / 2 + 0.03, 0.06, -d / 2 + 0.03, w / 2 - 0.03, H - 0.05, d / 2 - 0.03), baseCol);
      set.add(bevelSlab(-w / 2 - 0.01, H - 0.05, -d / 2 - 0.01, w / 2 + 0.01, H, d / 2 + 0.01, 0.01), baseCol);
      set.add(box(-w / 2 + 0.03, 0.06, d / 2 - 0.032, w / 2 - 0.03, 0.062, d / 2 - 0.03), paint('#2b2b2b'));
      if (obj !== 'none') set.add(exhibit(obj, Math.min(0.5, w * 0.8)).translate(0, H, 0), mat('ceramic', '#d8c8a8'));
      set.boxMinMax(-w / 2, 0, -d / 2, w / 2, H, d / 2);
      return set.build();
    }
    const baseH = v === 'table' ? H - 0.28 : Math.max(0.45, H * 0.45);
    set.add(box(-w / 2, 0, -d / 2, w / 2, 0.05, d / 2), paint('#1a1a1c'));
    set.add(box(-w / 2 + 0.02, 0.05, -d / 2 + 0.02, w / 2 - 0.02, baseH, d / 2 - 0.02), baseCol);
    set.add(bevelSlab(-w / 2, baseH, -d / 2, w / 2, baseH + 0.04, d / 2, 0.008), baseCol);
    const gy0 = baseH + 0.04;
    const gy1 = H;
    const fr = 0.022;
    const frame = new Geom();
    frame.merge(box(-w / 2, gy0, -d / 2, w / 2, gy0 + fr, d / 2));
    frame.merge(box(-w / 2, gy1 - fr, -d / 2, w / 2, gy1, d / 2));
    for (const sx of [-1, 1] as const) for (const sz of [-1, 1] as const) frame.merge(box(sx * (w / 2 - fr / 2) - fr / 2, gy0, sz * (d / 2 - fr / 2) - fr / 2, sx * (w / 2 - fr / 2) + fr / 2, gy1, sz * (d / 2 - fr / 2) + fr / 2));
    set.add(frame, steel);
    set.add(box(-w / 2 + fr, gy0 + fr, -d / 2 + fr, w / 2 - fr, gy1 - fr, d / 2 - fr), glass);
    if (p.bool('lit')) set.add(box(-w / 2 + 0.05, gy1 - fr - 0.012, -d / 2 + 0.05, w / 2 - 0.05, gy1 - fr, -d / 2 + 0.065), EMISSIVE('#ffe4b8', 3));
    // Interior: a velvet bed and the exhibit on a small stand.
    set.add(box(-w / 2 + fr, gy0 + fr, -d / 2 + fr, w / 2 - fr, gy0 + fr + 0.012, d / 2 - fr), { finish: 'velvet', color: '#1f2a36' });
    if (obj !== 'none') set.add(exhibit(obj, Math.min(0.5, (gy1 - gy0) * 0.6, w * 0.75)).translate(0, gy0 + fr + 0.012, 0), mat('ceramic', '#d9c9a6'));
    // A small label plate on the base front.
    set.add(box(-0.08, baseH * 0.55, d / 2 - 0.018, 0.08, baseH * 0.55 + 0.05, d / 2 - 0.012), mat('brass'));
    set.boxMinMax(-w / 2, 0, -d / 2, w / 2, H, d / 2);
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Counters: reception, concession, bar
// ---------------------------------------------------------------------------

export const RECEPTION_DESK: FurnitureDef = {
  id: 'furn-reception-desk',
  kind: 'reception-desk',
  description:
    'Service counter: `variant` reception (panelled front, a raised guest ledge at 1.1 m and a working top at 0.75 m, warm under-light), concession (cinema or kiosk counter: glass display case of snacks, a popcorn machine and a lit menu band), bar (panelled bar with a brass foot rail and a back bar of shelves, bottles and a mirror). Customers on +Z, staff behind at -Z. Use `length`. Stools: bar-stool or cane-chair.',
  params: {
    variant: choice(['reception', 'concession', 'bar'], 'reception', 'reception / ticket desk, concession counter or bar'),
    length: num(3.0, 1.2, 8, 'length (m)'),
    front: choice(['oak', 'walnut', 'paint', 'terrazzo'], 'walnut', 'front panelling'),
    top: choice(['marble', 'terrazzo', 'concrete', 'oak', 'walnut'], 'marble', 'top finish'),
    accent: color('#c0392b', 'accent colour (popcorn stripes, menu band)'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 1.2,
  size: (p) => (p.str('variant') === 'bar' ? [p.num('length'), 2.4, 1.6] : p.str('variant') === 'concession' ? [p.num('length'), 2.4, 0.9] : [p.num('length'), 1.6, 1.2]),
  build(p) {
    const raw = new PartSet();
    const L = p.num('length');
    const v = p.str('variant');
    // Centre the footprint: the staff side (back bar, working top, menu board) extends behind the counter.
    const set = shifted(raw, 0, 0, v === 'bar' ? 0.38 : v === 'concession' ? 0.075 : 0.225);
    const front = p.str('front') === 'paint' ? mat('paint', '#d9cbb6') : mat(p.str('front'));
    const top = mat(p.str('top'));
    const body = paint('#17171a', 0.7);
    const h = v === 'reception' ? 1.1 : 1.05;
    const d = v === 'bar' ? 0.6 : 0.62;
    // Carcass and panelled front.
    set.add(box(-L / 2, 0, -d / 2, L / 2, h - 0.05, d / 2 - 0.04), body);
    const panels = new Geom();
    const n = Math.max(3, Math.round(L / 0.6));
    const pw = L / n;
    for (let k = 0; k < n; k++) {
      panels.merge(box(-L / 2 + k * pw + 0.03, 0.1, d / 2 - 0.04, -L / 2 + (k + 1) * pw - 0.03, h - 0.12, d / 2 - 0.015));
      panels.merge(box(-L / 2 + k * pw + 0.07, 0.15, d / 2 - 0.015, -L / 2 + (k + 1) * pw - 0.07, h - 0.17, d / 2 - 0.005));
    }
    set.add(panels, front);
    set.add(bevelSlab(-L / 2 - 0.03, h - 0.05, -d / 2, L / 2 + 0.03, h, d / 2 + 0.05, 0.012), top);
    set.add(box(-L / 2, 0, d / 2 - 0.04, L / 2, 0.09, d / 2 + 0.01), paint('#0d0d0f'));
    if (v === 'reception') {
      // Raised guest ledge (front) and a lower working surface behind; warm LED under the ledge.
      set.add(bevelSlab(-L / 2, h - 0.2 + 0.0, d / 2 - 0.34, L / 2, h + 0.0, d / 2 + 0.05, 0.01).translate(0, 0.0, 0), top);
      set.add(box(-L / 2 + 0.1, h - 0.22, d / 2 - 0.02, L / 2 - 0.1, h - 0.21, d / 2 - 0.0), EMISSIVE('#ffd9a0', 3));
      set.add(box(-L / 2, 0.74, -d / 2 - 0.5, L / 2, 0.78, -d / 2), top);
      const screens = new Geom();
      for (const x of [-L * 0.22, L * 0.22]) {
        screens.merge(roundedBox(0.5, 0.32, 0.025, 0.006, 1).translate(x, h + 0.34, -0.12));
        screens.merge(cylinder(0.012, 0.012, 0.16, 8).translate(x, h + 0.04, -0.12));
        screens.merge(cylinder(0.08, 0.08, 0.01, 14).translate(x, h + 0.0, -0.12));
      }
      set.add(screens, paint('#0c0c0e', 0.35));
      set.add(box(-L * 0.26 - 0.22, h + 0.2, -0.108, -L * 0.22 + 0.22, h + 0.5, -0.104), EMISSIVE('#9bb8e6', 0.9));
      set.boxMinMax(-L / 2, 0, -d / 2, L / 2, h, d / 2 + 0.05);
      return raw.build();
    }
    if (v === 'concession') {
      // Glass snack case on the left, a popcorn machine on the right, a lit menu band above the back.
      const cx1 = -L / 2 + Math.min(1.6, L * 0.45);
      set.add(box(-L / 2 + 0.06, h, -d / 2 + 0.12, cx1, h + 0.5, d / 2 - 0.06), { finish: 'glass', color: '#dfeaf0', opacity: 0.18 });
      set.add(box(-L / 2 + 0.06, h + 0.5, -d / 2 + 0.12, cx1, h + 0.525, d / 2 - 0.06), mat('brushed-metal'));
      set.add(box(-L / 2 + 0.1, h + 0.46, -d / 2 + 0.16, cx1 - 0.04, h + 0.47, d / 2 - 0.12), EMISSIVE('#fff0d6', 2.2));
      const snacks = new Geom();
      for (let k = 0; k < 10; k++) snacks.merge(roundedBox(0.12, 0.05, 0.08, 0.012, 1).translate(-L / 2 + 0.18 + k * ((cx1 + L / 2 - 0.36) / 9), h + 0.03, 0.02 + (k % 2) * 0.1));
      set.add(snacks, paint('#d19a3a', 0.6));
      const mx = L / 2 - 0.55;
      set.add(box(mx - 0.4, h, -0.22, mx + 0.4, h + 0.28, 0.22), paint(p.color('accent'), 0.4));
      set.add(box(mx - 0.37, h + 0.28, -0.2, mx + 0.37, h + 0.78, 0.2), { finish: 'glass', color: '#f3efe2', opacity: 0.25 });
      set.add(box(mx - 0.38, h + 0.78, -0.21, mx + 0.38, h + 0.9, 0.21), paint(p.color('accent'), 0.4));
      const pop = new Geom();
      for (let k = 0; k < 90; k++) pop.merge(sphere(0.026, 6).translate(mx - 0.3 + ((k * 37) % 60) / 100, h + 0.3 + ((k * 53) % 40) / 100, -0.16 + ((k * 29) % 32) / 100));
      set.add(pop, paint('#f6e7a8', 0.9));
      const stripes = new Geom();
      for (let k = 0; k < 6; k++) stripes.merge(box(mx - 0.38 + k * 0.126 + 0.0, h + 0.28, 0.218, mx - 0.38 + k * 0.126 + 0.063, h + 0.78, 0.222));
      set.add(stripes, paint('#fbfaf2', 0.5));
      set.add(box(-L / 2, h + 1.05, -d / 2 - 0.2, L / 2, h + 1.55, -d / 2 - 0.15), paint('#101012'));
      set.add(box(-L / 2 + 0.1, h + 1.1, -d / 2 - 0.148, L / 2 - 0.1, h + 1.5, -d / 2 - 0.144), EMISSIVE('#ffe2b0', 1.6));
      const bands = new Geom();
      for (let k = 0; k < 5; k++) bands.merge(box(-L / 2 + 0.2 + k * ((L - 0.4) / 5), h + 1.22, -d / 2 - 0.143, -L / 2 + 0.2 + k * ((L - 0.4) / 5) + (L - 0.4) / 5 - 0.08, h + 1.4, -d / 2 - 0.139));
      set.add(bands, paint(p.color('accent'), 0.5));
      set.boxMinMax(-L / 2, 0, -d / 2, L / 2, h, d / 2 + 0.05);
      set.boxMinMax(-L / 2, h, -0.3, L / 2, h + 0.9, 0.25);
      return raw.build();
    }
    // Bar: foot rail, shelves of bottles and a mirror on the back bar.
    const rail = new Geom();
    rail.merge(cylinder(0.025, 0.025, L - 0.1, 12).rotateZ(90).translate((L - 0.1) / 2, 0.18, d / 2 + 0.16));
    for (const sx of [-1, 1] as const) rail.merge(cylinder(0.015, 0.015, 0.16, 8).translate(sx * (L / 2 - 0.2), 0.02, d / 2 + 0.16 + 0.0));
    set.add(rail, mat('brass'));
    set.add(box(-L / 2, h - 0.16, d / 2 + 0.05, L / 2, h - 0.12, d / 2 + 0.12), mat('leather'));
    const bz = -d / 2 - 0.55;
    set.add(box(-L / 2, 0, bz - 0.2, L / 2, 0.9, bz + 0.2), body);
    set.add(box(-L / 2, 0.9, bz - 0.22, L / 2, 0.94, bz + 0.22), top);
    set.add(box(-L / 2, 0.94, bz - 0.22, L / 2, 2.3, bz - 0.2), paint('#1a1512'));
    set.add(new Geom().quadAuto([-L / 2 + 0.1, 1.0, bz - 0.19], [L / 2 - 0.1, 1.0, bz - 0.19], [L / 2 - 0.1, 2.2, bz - 0.19], [-L / 2 + 0.1, 2.2, bz - 0.19]), { finish: 'mirror', color: '#c9b79b', opacity: 0.9 });
    const shelves = new Geom();
    const bottles = [new Geom(), new Geom(), new Geom()];
    const rnd = seeded(5);
    for (const y of [1.35, 1.75]) {
      shelves.merge(box(-L / 2 + 0.1, y, bz - 0.19, L / 2 - 0.1, y + 0.025, bz - 0.0));
      for (let x = -L / 2 + 0.2; x < L / 2 - 0.2; x += 0.11 + rnd() * 0.04) {
        const g = bottles[Math.floor(rnd() * 3)] as Geom;
        const bh = 0.24 + rnd() * 0.08;
        g.merge(lathe([[0, 0], [0.036, 0], [0.038, 0.02], [0.038, bh * 0.6], [0.02, bh * 0.78], [0.012, bh * 0.82], [0.012, bh], [0, bh]], 10).translate(x, y + 0.025, bz - 0.1));
      }
    }
    set.add(shelves, mat('brass'));
    set.add(bottles[0] as Geom, { finish: 'glass', color: '#3a6a3d', opacity: 0.85 });
    set.add(bottles[1] as Geom, { finish: 'glass', color: '#8a5a22', opacity: 0.85 });
    set.add(bottles[2] as Geom, { finish: 'glass', color: '#c9d6dc', opacity: 0.6 });
    set.add(box(-L / 2 + 0.1, 2.05, bz - 0.19, L / 2 - 0.1, 2.08, bz - 0.17), EMISSIVE('#ffd9a0', 2.2));
    set.boxMinMax(-L / 2, 0, -d / 2, L / 2, h, d / 2 + 0.05);
    set.boxMinMax(-L / 2, 0, bz - 0.22, L / 2, 0.94, bz + 0.22);
    return raw.build();
  },
};

// ---------------------------------------------------------------------------
// School desk and blackboard
// ---------------------------------------------------------------------------

export const SCHOOL_DESK: FurnitureDef = {
  id: 'furn-school-desk',
  kind: 'school-desk',
  description:
    'Classroom desk with a chair: a laminate top with a rounded front, a book rack under it on a tube steel frame, and a moulded seat and back on its own frame (`chair` false for a bare desk). The student faces -Z (towards the board), so a classroom is a grid of these with yaw 180, or place the grid rotated.',
  params: {
    chair: flag(true, 'with a chair'),
    top: color('#d9b98a', 'desktop colour'),
    seat: color('#3d6fa5', 'chair colour'),
    frame: choice(['black-metal', 'chrome', 'brushed-metal'], 'black-metal', 'tube frame'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.6,
  size: (p) => [0.62, 0.86, p.bool('chair') ? 1.0 : 0.46],
  build(p) {
    const set = new PartSet();
    const steel = mat(p.str('frame'));
    const withChair = p.bool('chair');
    const dz = withChair ? -0.27 : 0;
    // The desk faces +Z in its own frame; the chair sits at +Z (behind the student's desk in the room frame -Z).
    const topG = roundedBox(0.62, 0.03, 0.46, 0.012, 2).translate(0, 0.745, dz);
    set.add(topG, paint(p.color('top'), 0.55));
    set.add(box(-0.3, 0.72, dz - 0.21, 0.3, 0.745, dz - 0.19), paint('#8a6a42'));
    const frame = new Geom();
    for (const sx of [-1, 1] as const) for (const sz of [-1, 1] as const) frame.merge(cylinder(0.011, 0.011, 0.73, 8).translate(sx * 0.27, 0, dz + sz * 0.18));
    for (const sx of [-1, 1] as const) {
      frame.merge(cylinder(0.01, 0.01, 0.36, 8).rotateX(90).translate(sx * 0.27, 0.06, dz - 0.18));
      frame.merge(cylinder(0.01, 0.01, 0.36, 8).rotateX(90).translate(sx * 0.27, 0.72, dz - 0.18));
    }
    frame.merge(cylinder(0.01, 0.01, 0.54, 8).rotateZ(90).translate(0.27, 0.06, dz - 0.18));
    frame.merge(cylinder(0.01, 0.01, 0.54, 8).rotateZ(90).translate(0.27, 0.06, dz + 0.18));
    set.add(frame, steel);
    set.add(box(-0.27, 0.46, dz - 0.17, 0.27, 0.475, dz + 0.17), paint('#6b7a8a', 0.5));
    if (withChair) {
      const cz = 0.28;
      const seat = paint(p.color('seat'), 0.5);
      set.add(roundedBox(0.4, 0.035, 0.4, 0.02, 2).translate(0, 0.44, cz), seat);
      set.add(roundedBox(0.38, 0.2, 0.025, 0.012, 2).rotateX(-8).translate(0, 0.66, cz + 0.2), seat);
      const cf = new Geom();
      for (const sx of [-1, 1] as const) {
        for (const sz of [-1, 1] as const) cf.merge(cylinder(0.01, 0.01, 0.43, 8).translate(sx * 0.17, 0, cz + sz * 0.17));
        cf.merge(cylinder(0.01, 0.01, 0.3, 8).translate(sx * 0.17, 0.43, cz + 0.2));
        cf.merge(cylinder(0.01, 0.01, 0.34, 8).rotateX(90).translate(sx * 0.17, 0.18, cz - 0.17));
      }
      set.add(cf, steel);
      set.boxMinMax(-0.2, 0, cz - 0.2, 0.2, 0.46, cz + 0.2);
    }
    set.boxMinMax(-0.31, 0, dz - 0.23, 0.31, 0.76, dz + 0.23);
    return set.build();
  },
};

export const BLACKBOARD: FurnitureDef = {
  id: 'furn-blackboard',
  kind: 'blackboard',
  description: 'Wall-mounted classroom blackboard (or greenboard) in a timber frame with a chalk ledge, chalk and an eraser, with faint chalk dust; back at z = 0, origin at the bottom centre (hang at about 0.9 m).',
  params: {
    width: num(3.6, 1, 8, 'width (m)'),
    height: num(1.2, 0.6, 1.8, 'height (m)'),
    board: choice(['black', 'green'], 'green', 'surface colour'),
    wood: choice(TIMBER, 'oak', 'frame timber'),
  },
  mount: 'wall',
  againstWall: true,
  frontClearance: 0,
  size: (p) => [p.num('width') + 0.1, p.num('height') + 0.12, 0.08],
  build(p) {
    const raw = new PartSet();
    const set = shifted(raw, 0, 0.085, 0);
    const w = p.num('width');
    const h = p.num('height');
    const wood = mat(p.str('wood'));
    const f = 0.045;
    const frame = new Geom();
    frame.merge(box(-w / 2 - f, -f, 0, w / 2 + f, 0, 0.035));
    frame.merge(box(-w / 2 - f, h, 0, w / 2 + f, h + f, 0.035));
    frame.merge(box(-w / 2 - f, 0, 0, -w / 2, h, 0.035));
    frame.merge(box(w / 2, 0, 0, w / 2 + f, h, 0.035));
    frame.merge(box(-w / 2 - f, -f - 0.04, 0, w / 2 + f, -f, 0.08));
    set.add(frame, wood);
    const board = p.str('board') === 'green' ? '#2c4a3c' : '#1d2124';
    set.add(box(-w / 2, 0, 0, w / 2, h, 0.025), { finish: 'paint', color: board, roughness: 0.92 });
    const dust = new Geom();
    for (let k = 0; k < 4; k++) dust.merge(new Geom().quadAuto([-w / 2 + w * (0.1 + 0.2 * k), h * 0.2, 0.0262], [-w / 2 + w * (0.2 + 0.2 * k), h * 0.24, 0.0262], [-w / 2 + w * (0.2 + 0.2 * k), h * 0.62, 0.0262], [-w / 2 + w * (0.1 + 0.2 * k), h * 0.7, 0.0262]));
    set.add(dust, { finish: 'paint', color: mixColor(board, '#ffffff', 0.18), roughness: 0.95 });
    const chalk = new Geom();
    for (let k = 0; k < 3; k++) chalk.merge(cylinder(0.006, 0.006, 0.07, 8).rotateZ(90).translate(-w * 0.2 + k * 0.1, -f - 0.04 + 0.0, 0.0).translate(0, 0.012, 0.045));
    set.add(chalk, paint('#f2f0e8', 0.9));
    set.add(roundedBox(0.12, 0.04, 0.05, 0.008, 1).translate(w * 0.3, -f - 0.02, 0.055), paint('#5a4a3a', 0.9));
    set.boxMinMax(-w / 2 - f, -f - 0.04, 0, w / 2 + f, h + f, 0.08);
    return raw.build();
  },
};

void WOODS;
void int;

/** Church, library, museum, counter and classroom pieces. */
export const CIVIC: readonly FurnitureDef[] = [PEW, ALTAR, LIBRARY_STACK, VITRINE, RECEPTION_DESK, SCHOOL_DESK, BLACKBOARD];
