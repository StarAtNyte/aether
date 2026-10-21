/**
 * Bedroom and storage: beds (single to king), wardrobes and bookshelves
 * with seeded books. Mattress tops at ~55 cm, wardrobes 60 cm deep.
 */
import { Geom, box, boxC, roundedBox } from '../mesh';
import { PartSet } from '../parts';
import { choice, color, cushion, emitFront, flag, int, mat, num, seeded, squareLeg, type FurnitureDef } from './kit';

const BED_WIDTHS: Record<string, number> = { single: 0.9, double: 1.4, queen: 1.6, king: 1.8 };

export const BED: FurnitureDef = {
  id: 'furn-bed',
  kind: 'bed',
  description: 'Bed with upholstered headboard, platform frame, mattress, soft duvet with a folded throw, and pillows. Headboard at −Z (against the wall), foot toward +Z.',
  params: {
    size: choice(['single', 'double', 'queen', 'king'], 'queen', 'mattress size'),
    frame: choice(['oak', 'walnut', 'ash', 'fabric'], 'oak', 'frame finish'),
    headboard: color('#b8ab98', 'headboard colour'),
    linen: color('#f1eee8', 'duvet colour'),
    throw: color('#9a7b5f', 'throw blanket colour'),
    headboardHeight: num(1.05, 0.7, 1.7, 'height of the headboard above the floor (m)'),
    accents: int(0, 0, 4, 'accent cushions leaning on the pillows (0 = none)'),
    accent: color('#6b2f73', 'accent cushion colour'),
    headboardStyle: choice(['slab', 'panel', 'tufted', 'slats'], 'slab', 'slab = upholstered slab to the floor; panel = tall floating panel on the wall side; tufted = diamond-quilted panel; slats = timber slats'),
    pattern: choice(['plain', 'floral', 'stripe', 'damask'], 'plain', 'pattern printed on the duvet cover (the linen colour tints it)'),
    canopy: flag(false, 'four-poster: corner posts with a top frame (posts are slim; set canopyHeight)'),
    canopyHeight: num(2.1, 1.6, 3, 'height of the four-poster posts (m)'),
  },
  mount: 'floor',
  againstWall: true,
  frontClearance: 0.6,
  size: (p) => [(BED_WIDTHS[p.str('size')] ?? 1.6) + 0.12, p.bool('canopy') ? Math.max(p.num('headboardHeight'), p.num('canopyHeight')) : p.num('headboardHeight'), 2.12],
  build(p) {
    const set = new PartSet();
    const mw = BED_WIDTHS[p.str('size')] ?? 1.6;
    const w = mw + 0.12;
    const L = 2.12;
    const frameMat = p.str('frame') === 'fabric' ? mat('fabric', p.color('headboard')) : mat(p.str('frame'));
    const frame = new Geom();
    frame.merge(roundedBox(w, 0.22, L - 0.08, 0.02, 2).translate(0, 0.14, 0.04));
    for (const sx of [-1, 1] as const) for (const sz of [-1, 1] as const) frame.merge(squareLeg(sx * (w / 2 - 0.06), sz * (L / 2 - 0.08) + 0.04, 0.05, 0.05));
    set.add(frame, frameMat);
    const hh = p.num('headboardHeight');
    const style = p.str('headboardStyle');
    const hbMat = style === 'slats' ? mat(p.str('frame') === 'fabric' ? 'oak' : p.str('frame')) : mat('fabric', p.color('headboard'));
    if (style === 'panel') {
      // A tall panel a little wider than the mattress, standing clear of the frame (the common hotel and modern look).
      set.add(cushion(w + 0.04, hh - 0.32, 0.08, 0.3, 0.012).translate(0, 0, -L / 2 + 0.04), hbMat);
    } else if (style === 'tufted') {
      set.add(cushion(w, hh - 0.05, 0.1, 0.05, 0.02).translate(0, 0, -L / 2 + 0.05), hbMat);
      // Diamond quilting: buttons on a staggered grid and thin ridges between them.
      const studs = new Geom();
      const dx = 0.16;
      const dy = 0.16;
      const ridge = new Geom();
      for (let row = 0, y = 0.42; y < hh - 0.12; row++, y += dy) {
        for (let x = -w / 2 + 0.1 + (row % 2) * (dx / 2); x < w / 2 - 0.06; x += dx) studs.merge(boxC(x, y, -L / 2 + 0.12, 0.022, 0.022, 0.02));
        ridge.merge(boxC(0, y, -L / 2 + 0.108, w - 0.08, 0.006, 0.008));
      }
      set.add(studs, mat('black-metal'));
      set.add(ridge, mat('fabric', p.color('headboard')));
    } else if (style === 'slats') {
      const sl = new Geom();
      for (let x = -w / 2 + 0.05; x <= w / 2 - 0.04; x += 0.11) sl.merge(box(x - 0.03, 0.12, -L / 2, x + 0.03, hh, -L / 2 + 0.05));
      set.add(sl, hbMat);
    } else {
      set.add(cushion(w, hh - 0.05, 0.1, 0.05, 0.02).translate(0, 0, -L / 2 + 0.05), hbMat);
    }
    if (p.bool('canopy')) {
      const top = p.num('canopyHeight');
      const posts = new Geom();
      const rails = new Geom();
      for (const sx of [-1, 1] as const) {
        for (const sz of [-1, 1] as const) posts.merge(box(sx * (w / 2 - 0.03) - 0.025, 0, sz * (L / 2 - 0.04) - 0.025, sx * (w / 2 - 0.03) + 0.025, top, sz * (L / 2 - 0.04) + 0.025));
        rails.merge(box(sx * (w / 2 - 0.03) - 0.02, top - 0.04, -L / 2 + 0.015, sx * (w / 2 - 0.03) + 0.02, top, L / 2 - 0.015));
      }
      for (const sz of [-1, 1] as const) rails.merge(box(-w / 2 + 0.01, top - 0.04, sz * (L / 2 - 0.04) - 0.02, w / 2 - 0.01, top, sz * (L / 2 - 0.04) + 0.02));
      set.add(posts, mat(p.str('frame') === 'fabric' ? 'paint' : p.str('frame'), p.str('frame') === 'fabric' ? p.color('linen') : undefined));
      set.add(rails, mat(p.str('frame') === 'fabric' ? 'paint' : p.str('frame'), p.str('frame') === 'fabric' ? p.color('linen') : undefined));
    }
    // Mattress and bedding.
    const linen = mat('fabric', p.color('linen'));
    const printed = { plain: 'fabric', floral: 'wallpaper-floral', stripe: 'wallpaper-stripe', damask: 'wallpaper-damask' }[p.str('pattern')] ?? 'fabric';
    const duvetMat = printed === 'fabric' ? linen : mat(printed, p.color('linen'));
    set.add(roundedBox(mw, 0.24, 2.0, 0.05, 3).translate(0, 0.25 + 0.12, 0.05), mat('fabric', '#f4f2ee'));
    const duvet = cushion(mw + 0.08, 0.07, 1.45, 0.47, 0.02).translate(0, 0, 0.32);
    // Duvet overhangs the sides.
    for (const s of [-1, 1] as const) duvet.merge(roundedBox(0.04, 0.3, 1.45, 0.02, 2).translate(s * (mw / 2 + 0.03), 0.4, 0.32));
    set.add(duvet, duvetMat);
    set.add(cushion(mw + 0.1, 0.04, 0.45, 0.535, 0.01).translate(0, 0, 0.72), mat('fabric', p.color('throw')));
    const pillows = new Geom();
    const n = mw > 1.1 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const x = n === 1 ? 0 : (k - 0.5) * (mw / 2);
      pillows.merge(cushion(Math.min(0.66, mw / n - 0.06), 0.14, 0.42, -0.07, 0.04).rotateX(-62).translate(x, 0.66, -L / 2 + 0.3));
    }
    set.add(pillows, linen);
    const accents = p.int('accents');
    if (accents > 0) {
      // Square accent cushions leaning against the headboard in front of the pillows, spread across the bed.
      const cush = new Geom();
      for (let k = 0; k < accents; k++) {
        const x = accents === 1 ? 0 : ((k + 0.5) / accents - 0.5) * (mw - 0.5);
        cush.merge(cushion(0.42, 0.12, 0.4, -0.06, 0.03).rotateX(-58).rotateY(k % 2 === 0 ? -8 : 10).translate(x, 0.74, -L / 2 + 0.52));
      }
      set.add(cush, mat('velvet', p.color('accent')));
    }
    set.boxMinMax(-w / 2, 0, -L / 2 + 0.1, w / 2, 0.55, L / 2);
    set.boxMinMax(-w / 2, 0, -L / 2, w / 2, p.num('headboardHeight'), -L / 2 + 0.1);
    return set.build();
  },
};

/** Raised shaker moulding (a frame of four thin strips) on the front of a door leaf; the door as it was when `on` is false. */
function shaker(door: Geom, on: boolean, x: number, y0: number, y1: number, dw: number, zFace: number): Geom {
  if (!on) return door;
  const m = 0.075;
  const t = 0.008;
  const z = zFace - 0.0;
  const ya = y0 + 0.07;
  const yb = y1 - 0.07;
  const xa = x - dw / 2 + m;
  const xb = x + dw / 2 - m;
  door.merge(box(xa, ya, z, xb, ya + 0.025, z + t));
  door.merge(box(xa, yb - 0.025, z, xb, yb, z + t));
  door.merge(box(xa, ya, z, xa + 0.025, yb, z + t));
  door.merge(box(xb - 0.025, ya, z, xb, yb, z + t));
  return door;
}

export const WARDROBE: FurnitureDef = {
  id: 'furn-wardrobe',
  kind: 'wardrobe',
  description: 'Built-in style wardrobe with full-height doors and long pulls; back against a wall.',
  params: {
    width: num(1.8, 0.8, 4, 'width (m)'),
    height: num(2.3, 1.8, 3.2, 'height (m)'),
    finish: choice(['paint', 'oak', 'walnut', 'ash'], 'paint', 'door finish'),
    builtin: flag(false, 'built-in: runs to the ceiling flush to the wall, with a face frame, panelled doors, crown strip and skirting-height toe-kick (set height to the ceiling height)'),
    color: color('#e8e4dd', 'paint colour'),
    interactive: flag(false, 'the doors are separate parts that open'),
  },
  interactive: true,
  mount: 'floor',
  againstWall: true,
  frontClearance: 0.9,
  size: (p) => [p.num('width'), p.num('height'), 0.6],
  build(p, _seed, sink) {
    const set = new PartSet();
    const w = p.num('width');
    const h = p.num('height');
    const d = 0.6;
    const builtin = p.bool('builtin');
    const face = p.str('finish') === 'paint' ? mat('paint', p.color('color')) : mat(p.str('finish'));
    const base = builtin ? 0.1 : 0.08;
    set.add(box(-w / 2, base, -d / 2, w / 2, h, d / 2 - 0.02), face);
    if (builtin) {
      // Toe-kick recessed like a skirting board, a face frame round the doors and a crown strip along the top.
      set.add(box(-w / 2, 0, -d / 2, w / 2, base, d / 2 - 0.035), mat('paint', '#f2f0eb'));
      const frameG = new Geom();
      frameG.merge(box(-w / 2, base, d / 2 - 0.022, -w / 2 + 0.045, h - 0.08, d / 2 + 0.004));
      frameG.merge(box(w / 2 - 0.045, base, d / 2 - 0.022, w / 2, h - 0.08, d / 2 + 0.004));
      frameG.merge(box(-w / 2, h - 0.15, d / 2 - 0.022, w / 2, h - 0.08, d / 2 + 0.004));
      frameG.merge(box(-w / 2, base, d / 2 - 0.022, w / 2, base + 0.03, d / 2 + 0.004));
      frameG.merge(box(-w / 2 - 0.01, h - 0.08, -d / 2, w / 2 + 0.01, h - 0.045, d / 2 + 0.03));
      frameG.merge(box(-w / 2 - 0.02, h - 0.045, -d / 2, w / 2 + 0.02, h, d / 2 + 0.045));
      set.add(frameG, face);
    } else set.add(box(-w / 2 + 0.01, 0, -d / 2 + 0.05, w / 2 - 0.01, 0.08, d / 2 - 0.06), mat('paint', '#3a3a3a'));
    const doors = new Geom();
    const pulls = new Geom();
    const bw = builtin ? w - 0.09 : w;
    const bTop = builtin ? h - 0.15 : h;
    const n = Math.max(2, Math.round(bw / 0.5));
    const dw = bw / n;
    for (let k = 0; k < n; k++) {
      const x = -bw / 2 + dw * (k + 0.5);
      const px = x + (k % 2 === 0 ? 1 : -1) * (dw / 2 - 0.045);
      const hinge = k < n / 2 ? 'left' : 'right';
      emitFront(sink, { front: doors, handle: pulls }, {
        id: `door-${k}`, name: 'Wardrobe door', kind: 'door', center: [x, base + (bTop - base) / 2, d / 2 - 0.01], size: [dw - 0.004, bTop - base - 0.005, 0.02], motion: { type: 'swing', hinge, angle: hinge === 'left' ? -105 : 105 },
        front: shaker(roundedBox(dw - 0.004, bTop - base - 0.005, 0.02, 0.003, 1).translate(x, base + (bTop - base) / 2, d / 2 - 0.01), builtin, x, base, bTop, dw, d / 2),
        handle: roundedBox(0.014, 0.42, 0.024, 0.006, 2).translate(px, 1.05, d / 2 + 0.014),
        frontMaterial: face, handleMaterial: mat('brass'),
      });
    }
    set.add(doors, face).add(pulls, mat('brass'));
    set.boxMinMax(-w / 2, 0, -d / 2, w / 2, h, d / 2);
    return set.build();
  },
};

const BOOK_COLORS = ['#7a3b2e', '#2f4858', '#d9c7a3', '#556b4f', '#b5651d', '#1f1f24', '#e3dccf', '#8c6d46', '#3c5a7a', '#a23f3f', '#c2a14d', '#4b4453'];

export const BOOKSHELF: FurnitureDef = {
  id: 'furn-bookshelf',
  kind: 'bookshelf',
  description: 'Open bookshelf with books (seeded colours and sizes), a few objects and plants-free styling; back against a wall.',
  params: {
    width: num(1.0, 0.5, 3, 'width (m)'),
    height: num(2.0, 0.8, 3.2, 'height (m)'),
    shelves: int(5, 2, 8, 'number of shelves'),
    builtin: flag(false, 'built-in: runs to the ceiling flush to the wall, with a face frame, crown strip and skirting-height toe-kick (set height to the ceiling height, shelves to 6-8)'),
    finish: choice(['oak', 'walnut', 'ash', 'black-metal', 'paint'], 'oak', 'frame finish'),
    fill: num(0.7, 0, 1, 'how full the shelves are'),
  },
  mount: 'floor',
  againstWall: true,
  frontClearance: 0.6,
  size: (p) => [p.num('width'), p.num('height'), p.bool('builtin') ? 0.38 : 0.34],
  build(p, seed) {
    const set = new PartSet();
    const w = p.num('width');
    const h = p.num('height');
    const builtin = p.bool('builtin');
    const d = builtin ? 0.38 : 0.34;
    const n = p.int('shelves');
    const t = 0.022;
    const frameMat = p.str('finish') === 'paint' ? mat('paint', '#ebe7e0') : mat(p.str('finish'));
    const frame = new Geom();
    frame.merge(box(-w / 2, 0, -d / 2, -w / 2 + t, h, d / 2));
    frame.merge(box(w / 2 - t, 0, -d / 2, w / 2, h, d / 2));
    frame.merge(box(-w / 2, 0, -d / 2, w / 2, h, -d / 2 + 0.008));
    const kick = builtin ? 0.1 : 0.04;
    const top = builtin ? h - 0.14 : h - 0.02;
    const pitch = (top - kick) / n;
    for (let k = 0; k <= n; k++) frame.merge(box(-w / 2 + t, kick + k * pitch - t / 2, -d / 2, w / 2 - t, kick + k * pitch + t / 2, d / 2));
    if (builtin) {
      // Face frame, a toe-kick set back like a skirting board, and a stepped crown strip.
      frame.merge(box(-w / 2, 0.1, d / 2 - 0.022, -w / 2 + 0.05, h - 0.08, d / 2 + 0.004));
      frame.merge(box(w / 2 - 0.05, 0.1, d / 2 - 0.022, w / 2, h - 0.08, d / 2 + 0.004));
      frame.merge(box(-w / 2, h - 0.14, d / 2 - 0.022, w / 2, h - 0.08, d / 2 + 0.004));
      frame.merge(box(-w / 2 - 0.01, h - 0.08, -d / 2, w / 2 + 0.01, h - 0.045, d / 2 + 0.03));
      frame.merge(box(-w / 2 - 0.02, h - 0.045, -d / 2, w / 2 + 0.02, h, d / 2 + 0.045));
      set.add(box(-w / 2, 0, -d / 2, w / 2, 0.1, d / 2 - 0.035), mat('paint', '#f2f0eb'));
    }
    set.add(frame, frameMat);
    // Books: runs of upright books with occasional leaning / stacked ones.
    const rnd = seeded(seed * 2654435761 + 17);
    const byColor = new Map<string, Geom>();
    const fill = p.num('fill');
    for (let k = 0; k < n; k++) {
      const y0 = kick + k * pitch + t / 2;
      let x = -w / 2 + t + 0.02;
      const xEnd = w / 2 - t - 0.02;
      while (x < xEnd - 0.03) {
        if (rnd() > fill) {
          x += 0.08 + rnd() * 0.18;
          continue;
        }
        const runLen = 3 + Math.floor(rnd() * 9);
        for (let b = 0; b < runLen && x < xEnd - 0.03; b++) {
          const bw = 0.018 + rnd() * 0.03;
          const bh = Math.min(pitch - t - 0.02, 0.17 + rnd() * 0.12);
          const bd = 0.15 + rnd() * 0.08;
          const c = BOOK_COLORS[Math.floor(rnd() * BOOK_COLORS.length)] as string;
          const g = byColor.get(c) ?? new Geom();
          g.merge(roundedBox(bw, bh, bd, 0.002, 1).translate(x + bw / 2, y0 + bh / 2, -d / 2 + 0.02 + bd / 2));
          byColor.set(c, g);
          x += bw + 0.001;
        }
        x += 0.04 + rnd() * 0.12;
      }
    }
    for (const [c, g] of byColor) set.add(g, { finish: 'paint', color: c, roughness: 0.75 });
    set.boxMinMax(-w / 2, 0, -d / 2, w / 2, h, d / 2);
    return set.build();
  },
};

/** Bedroom and storage definitions. */
export const BEDROOM: readonly FurnitureDef[] = [BED, WARDROBE, BOOKSHELF];
