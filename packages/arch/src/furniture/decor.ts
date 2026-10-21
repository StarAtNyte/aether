/**
 * Decor and fittings: rugs, curtains, potted plants, framed art, mirrors,
 * TVs, a fireplace, a café counter with an espresso machine and a
 * whiteboard. Wall-mounted pieces have their back at z = 0 (the wall face)
 * and their own `mountHeight` handled by the layout helpers.
 */
import { Geom, box, cylinder, extrude, lathe, roundedBox, sphere, tube } from '../mesh';
import { PartSet } from '../parts';
import { choice, color, flag, int, mat, num, roundedRect, seeded, type FurnitureDef } from './kit';
import type { P2 } from '../math2';
import { BLIND, CURTAIN } from './soft';

export { BLIND, CURTAIN };

export const RUG: FurnitureDef = {
  id: 'furn-rug',
  kind: 'rug',
  description: 'Low-pile rug with a bound edge (rectangular or round).',
  params: {
    width: num(2.4, 0.6, 5, 'width (m)'),
    depth: num(1.7, 0.6, 4, 'depth (m)'),
    shape: choice(['rect', 'round'], 'rect', 'shape'),
    color: color('#c9bfae', 'field colour'),
    border: color('#8a7f70', 'border colour'),
    pattern: choice(['plain', 'zigzag', 'stripes'], 'plain', 'woven pattern across the field: zigzag (chevron bands) or stripes, in the three accent colours and the field colour'),
    accent1: color('#c0473f', 'first accent colour of a pattern'),
    accent2: color('#e0a93b', 'second accent colour of a pattern'),
    accent3: color('#3f7f8f', 'third accent colour of a pattern'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0,
  size: (p) => [p.num('width'), 0.012, p.str('shape') === 'round' ? p.num('width') : p.num('depth')],
  build(p) {
    const set = new PartSet();
    const w = p.num('width');
    const d = p.str('shape') === 'round' ? w : p.num('depth');
    const r = p.str('shape') === 'round' ? w / 2 - 0.001 : 0.02;
    const outline = roundedRect(w, d, r, p.str('shape') === 'round' ? 16 : 2);
    const inner = roundedRect(w - 0.16, d - 0.16, Math.max(0.01, r - 0.08), p.str('shape') === 'round' ? 16 : 2);
    const border = new Geom().flatPolygon(outline, 0.01, true, [inner]);
    const edge = extrude(outline, 0.001, 0.01, { top: false, bottom: false });
    set.add(border.merge(edge), mat('carpet', p.color('border')));
    set.add(new Geom().flatPolygon(inner, 0.011, true), mat('carpet', p.color('color')));
    const pattern = p.str('pattern');
    if (pattern !== 'plain' && p.str('shape') !== 'round') {
      // Bands across the depth of the field, cycling through the accents; zigzag bands have a chevron edge.
      const iw = w - 0.16;
      const id = d - 0.16;
      const cols = [p.color('accent1'), p.color('accent2'), p.color('accent3')];
      const bandH = 0.11;
      const gap = 0.07;
      const amp = pattern === 'zigzag' ? 0.07 : 0;
      const n = Math.max(2, Math.round(iw / 0.22));
      const bands: Geom[] = cols.map(() => new Geom());
      let k = 0;
      for (let y = -id / 2 + amp + 0.04; y + bandH + amp < id / 2 - 0.02; y += bandH + gap, k++) {
        const top: P2[] = [];
        const bottom: P2[] = [];
        for (let i = 0; i <= n; i++) {
          const x = -iw / 2 + (iw * i) / n;
          const z = amp === 0 ? 0 : i % 2 === 0 ? -amp : amp;
          top.push([x, y + z]);
          bottom.push([x, y + bandH + z]);
        }
        (bands[k % cols.length] as Geom).flatPolygon([...top, ...bottom.reverse()], 0.0115, true);
      }
      cols.forEach((c, i) => {
        if ((bands[i] as Geom).i.length > 0) set.add(bands[i] as Geom, mat('carpet', c));
      });
    }
    return set.build();
  },
};

export const PLANT: FurnitureDef = {
  id: 'furn-plant',
  kind: 'plant',
  description: 'Potted indoor plant (fiddle-leaf fig, olive tree or snake plant) in a ceramic or terracotta pot.',
  params: {
    height: num(1.4, 0.3, 2.4, 'overall height (m)'),
    species: choice(['fig', 'olive', 'snake', 'palm'], 'fig', 'plant type (palm = arching feathered fronds, also for a single frond in a vase: use a small height)'),
    pot: choice(['ceramic', 'terracotta', 'concrete'], 'ceramic', 'pot finish'),
    potColor: color('#e9e4dc', 'pot colour'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0,
  size: (p) => [Math.max(0.4, p.num('height') * 0.5), p.num('height'), Math.max(0.4, p.num('height') * 0.5)],
  build(p, seed) {
    const set = new PartSet();
    const H = p.num('height');
    const potH = Math.min(0.45, H * 0.28);
    const potR = Math.min(0.22, H * 0.14);
    const pot = lathe(
      [
        [0.001, 0],
        [potR * 0.78, 0],
        [potR * 0.82, 0.01],
        [potR, potH],
        [potR * 0.93, potH],
        [potR * 0.9, potH - 0.04],
        [0.001, potH - 0.04],
      ],
      28,
    );
    const potMat = p.str('pot') === 'terracotta' ? { finish: 'ceramic' as const, color: '#b5643f', roughness: 0.8 } : p.str('pot') === 'concrete' ? mat('concrete') : mat('ceramic', p.color('potColor'));
    set.add(pot, potMat);
    set.add(new Geom().flatPolygon(roundedRect(potR * 1.7, potR * 1.7, potR * 0.85 - 0.001, 8), potH - 0.035, true), { finish: 'gravel', color: '#5a4636' });
    const rnd = seeded(seed * 747796405 + 3);
    const leaves = new Geom();
    const stems = new Geom();
    const species = p.str('species');
    if (species === 'palm') {
      // Arching fronds from the pot: a curved rib with paired narrow leaflets drooping on both sides.
      const fronds = H < 0.9 ? 4 : 9;
      for (let k = 0; k < fronds; k++) {
        const a = (k / fronds) * Math.PI * 2 + rnd() * 0.5;
        const reach = (H - potH) * (0.55 + rnd() * 0.3);
        const rise = (H - potH) * (0.6 + rnd() * 0.35);
        const rib: Array<[number, number, number]> = [];
        const steps = 8;
        for (let j = 0; j <= steps; j++) {
          const t = j / steps;
          rib.push([Math.cos(a) * reach * t * t * 0.9 + Math.cos(a) * 0.02, potH - 0.04 + rise * Math.sin(t * Math.PI * 0.62) * 0.95, Math.sin(a) * reach * t * t * 0.9 + Math.sin(a) * 0.02]);
        }
        stems.merge(tube(rib, 0.006, 5));
        const len = Math.max(0.1, reach * 0.34);
        for (let j = 2; j <= steps; j++) {
          const at = rib[j] as [number, number, number];
          const prev = rib[j - 1] as [number, number, number];
          const droop = 55 + j * 3;
          const dir = (Math.atan2(at[2] - prev[2], at[0] - prev[0]) * 180) / Math.PI;
          for (const side of [-1, 1] as const) {
            leaves.merge(leaf(0.028, len * (1 - (j / steps) * 0.45), 0.1).rotateZ(side * droop).rotateY(-dir + 90).translate(at[0], at[1], at[2]));
          }
        }
      }
    } else if (species === 'snake') {
      const n = 9 + Math.floor(rnd() * 5);
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2;
        const lh = (H - potH) * (0.6 + rnd() * 0.4);
        leaves.merge(leaf(0.06, lh, rnd() * 0.15).rotateZ((rnd() - 0.5) * 18).rotateY((a * 180) / Math.PI).translate(Math.cos(a) * potR * 0.4, potH - 0.04, Math.sin(a) * potR * 0.4));
      }
    } else {
      const trunkTop = potH + (H - potH) * (species === 'olive' ? 0.45 : 0.25);
      stems.merge(tube([[0, potH - 0.04, 0], [0.02, trunkTop * 0.7, 0.01], [-0.01, trunkTop, 0]], species === 'olive' ? 0.02 : 0.012, 8));
      const n = species === 'olive' ? 160 : 34;
      const crownR = species === 'olive' ? (H - potH) * 0.33 : (H - potH) * 0.28;
      const crownC = species === 'olive' ? trunkTop + crownR * 0.9 : potH + (H - potH) * 0.62;
      for (let k = 0; k < n; k++) {
        const u = rnd() * 2 - 1;
        const th = rnd() * Math.PI * 2;
        const rr = crownR * Math.cbrt(rnd());
        const x = Math.sqrt(1 - u * u) * Math.cos(th) * rr;
        const z = Math.sqrt(1 - u * u) * Math.sin(th) * rr;
        const y = crownC + u * rr * (species === 'fig' ? 1.6 : 0.8);
        const size = species === 'olive' ? 0.08 : 0.24 + rnd() * 0.08;
        const width = species === 'olive' ? 0.018 : size * 0.62;
        leaves.merge(leaf(width, size, 0.2 + rnd() * 0.3).rotateX(-40 - rnd() * 50).rotateY(rnd() * 360).translate(x, y - size * 0.3, z));
        if (species === 'fig') stems.merge(tube([[0, crownC - crownR * 0.8, 0], [x, y - size * 0.3, z]], 0.006, 5));
      }
    }
    set.add(stems, { finish: 'walnut', color: '#6b5440' });
    set.add(leaves, { preset: 'leaf', color: species === 'olive' ? '#7d8b5e' : species === 'snake' ? '#4f6b3a' : species === 'palm' ? '#4a7a35' : '#3f6b2f', roughness: 0.55 });
    set.boxMinMax(-potR, 0, -potR, potR, potH, potR);
    return set.build();
  },
};

/** A double-sided leaf blade (ellipse-ish), base at the origin, pointing +Y, with a cupped midrib. */
function leaf(w: number, h: number, cup: number): Geom {
  const g = new Geom();
  const rows = 6;
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const half = (w / 2) * Math.sin(Math.PI * Math.min(1, t * 1.05)) + 0.002;
    const y = h * t;
    const bend = cup * 0.25 * h * t * t;
    for (const s of [-1, 0, 1] as const) {
      const z = bend + (s === 0 ? 0 : -cup * 0.15 * half);
      g.vertex(s * half, y, z, 0, 0, 1, s * half, y);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < 2; i++) {
      const a = j * 3 + i;
      g.i.push(a, a + 1, a + 4, a, a + 4, a + 3);
    }
  }
  const back = g.clone().flip();
  for (let k = 0; k < back.n.length; k++) back.n[k] = -(back.n[k] as number);
  return g.merge(back);
}

/** Linear mix of two #rrggbb colours (t = 0 gives `a`). */
function mixHex(a: string, b: string, t: number): string {
  const ch = (h: string, i: number): number => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) * (1 - t) + ch(b, i) * t).toString(16).padStart(2, '0')).join('')}`;
}

const ART_PALETTES: readonly (readonly string[])[] = [
  ['#e8dfd0', '#c96f4a', '#2f4858', '#d9a55b'],
  ['#efe9e1', '#9aa58f', '#3a4a3f', '#c8b79e'],
  ['#f1ece4', '#1f2a36', '#b9783f', '#e3c9a0'],
  ['#ebe5dc', '#7d4b5f', '#e0b8a8', '#2d2d2d'],
];

export const FRAME: FurnitureDef = {
  id: 'furn-frame',
  kind: 'art',
  description: 'Framed abstract artwork (seeded composition) with a white mat; hangs on a wall (back at z = 0).',
  params: {
    width: num(0.8, 0.2, 3, 'frame width (m)'),
    height: num(1.0, 0.2, 2.5, 'frame height (m)'),
    frame: choice(['oak', 'walnut', 'black-metal', 'brass'], 'black-metal', 'frame finish'),
    palette: int(0, 0, 3, 'colour palette'),
    subject: choice(['abstract', 'round', 'blank'], 'abstract', 'abstract composition, a round (fisheye-like) photo on a wide white mat, or a blank mat'),
    matColor: color('#f3f1ec', 'mat board colour'),
    ink: color('#2b2833', 'dominant tone of a round photo'),
  },
  mount: 'wall',
  againstWall: true,
  frontClearance: 0,
  size: (p) => [p.num('width'), p.num('height'), 0.035],
  build(p, seed) {
    const set = new PartSet();
    const w = p.num('width');
    const h = p.num('height');
    const fw = 0.025;
    const frame = new Geom();
    frame.merge(box(-w / 2, -h / 2, 0, w / 2, -h / 2 + fw, 0.035));
    frame.merge(box(-w / 2, h / 2 - fw, 0, w / 2, h / 2, 0.035));
    frame.merge(box(-w / 2, -h / 2 + fw, 0, -w / 2 + fw, h / 2 - fw, 0.035));
    frame.merge(box(w / 2 - fw, -h / 2 + fw, 0, w / 2, h / 2 - fw, 0.035));
    set.add(frame.translate(0, h / 2, 0), mat(p.str('frame')));
    const matBoard = new Geom().quadAuto([-w / 2 + fw, fw, 0.02], [w / 2 - fw, fw, 0.02], [w / 2 - fw, h - fw, 0.02], [-w / 2 + fw, h - fw, 0.02]);
    set.add(matBoard, { finish: 'paint', color: p.color('matColor') });
    if (p.str('subject') === 'blank') return set.build();
    if (p.str('subject') === 'round') {
      // A round photograph centred on a wide mat: a dark disc with a lighter lens-like ring and a bright core.
      const r = Math.min(w, h) / 2 - fw - 0.1;
      const ring = (rad: number): P2[] => Array.from({ length: 40 }, (_, k): P2 => [Math.cos((k / 40) * Math.PI * 2) * rad, Math.sin((k / 40) * Math.PI * 2) * rad]);
      const disc = (rad: number, z: number, col: string): void => {
        set.add(new Geom().flatPolygon(ring(rad), 0, true).rotateX(90).translate(0, h / 2, z), { finish: 'paint', color: col });
      };
      disc(r, 0.021, p.color('ink'));
      disc(r * 0.78, 0.0215, mixHex(p.color('ink'), '#ffffff', 0.45));
      disc(r * 0.5, 0.022, mixHex(p.color('ink'), '#ffffff', 0.15));
      return set.build();
    }
    // Composition: a few overlapping blocks and a circle in the palette.
    const pal = ART_PALETTES[p.int('palette') % ART_PALETTES.length] as readonly string[];
    const rnd = seeded(seed * 2246822519 + 11);
    const aw = w - 2 * fw - 0.12;
    const ah = h - 2 * fw - 0.12;
    const x0 = -aw / 2;
    const y0 = fw + 0.06;
    set.add(new Geom().quadAuto([x0, y0, 0.021], [x0 + aw, y0, 0.021], [x0 + aw, y0 + ah, 0.021], [x0, y0 + ah, 0.021]), { finish: 'paint', color: pal[0] as string });
    for (let k = 0; k < 3; k++) {
      const bw = aw * (0.25 + rnd() * 0.45);
      const bh = ah * (0.2 + rnd() * 0.45);
      const bx = x0 + rnd() * (aw - bw);
      const by = y0 + rnd() * (ah - bh);
      const z = 0.0215 + k * 0.0004;
      set.add(new Geom().quadAuto([bx, by, z], [bx + bw, by, z], [bx + bw, by + bh, z], [bx, by + bh, z]), { finish: 'paint', color: pal[1 + (k % 3)] as string });
    }
    const r = Math.min(aw, ah) * (0.12 + rnd() * 0.12);
    const disc: P2[] = [];
    for (let k = 0; k < 32; k++) disc.push([Math.cos((k / 32) * Math.PI * 2) * r, Math.sin((k / 32) * Math.PI * 2) * r]);
    const circle = new Geom().flatPolygon(disc, 0, true).rotateX(90).translate(x0 + aw * (0.2 + rnd() * 0.6), y0 + ah * (0.2 + rnd() * 0.6), 0.0235);
    set.add(circle, { finish: 'paint', color: pal[3] as string });
    return set.build();
  },
};

export const MIRROR: FurnitureDef = {
  id: 'furn-mirror',
  kind: 'mirror',
  description: 'Wall mirror (rectangular, round or arched) with a thin frame; back at z = 0 on the wall.',
  params: {
    width: num(0.7, 0.3, 2.5, 'width (m)'),
    height: num(1.0, 0.3, 2.2, 'height (m)'),
    shape: choice(['rect', 'round', 'arch'], 'round', 'outline'),
    frame: choice(['brass', 'black-metal', 'oak'], 'brass', 'frame finish'),
  },
  mount: 'wall',
  againstWall: true,
  frontClearance: 0,
  size: (p) => [p.num('width'), p.str('shape') === 'round' ? p.num('width') : p.num('height'), 0.03],
  build(p) {
    const set = new PartSet();
    const w = p.num('width');
    const shape = p.str('shape');
    const h = shape === 'round' ? w : p.num('height');
    let outline: P2[];
    if (shape === 'round') outline = roundedRect(w, h, w / 2 - 0.001, 16);
    else if (shape === 'arch') {
      outline = [];
      const r = w / 2;
      outline.push([-r, -h / 2], [r, -h / 2]);
      for (let k = 0; k <= 16; k++) {
        const a = (k / 16) * Math.PI;
        outline.push([Math.cos(a) * r, h / 2 - r + Math.sin(a) * r]);
      }
    } else outline = roundedRect(w, h, 0.01, 2);
    // Outline is in (x, z): stand it up so plan z becomes height and plan y the depth off the wall.
    const toWall = (g: Geom): Geom => g.rotateX(-90).translate(0, h / 2, 0.025);
    const frame = extrude(outline, 0, 0.025);
    set.add(toWall(frame), mat(p.str('frame')));
    const inner = outline.map((q): P2 => [q[0] * (1 - 0.05 / w), q[1] * (1 - 0.05 / h)]);
    set.add(toWall(new Geom().flatPolygon(inner, -0.002, false)), { finish: 'mirror' });
    return set.build();
  },
};

export const TV: FurnitureDef = {
  id: 'furn-tv',
  kind: 'tv',
  description: 'Wall-mounted flat TV (55–85 inch); back at z = 0 on the wall.',
  params: {
    inches: num(65, 32, 100, 'diagonal (inches)'),
  },
  mount: 'wall',
  againstWall: true,
  frontClearance: 0,
  size: (p) => {
    const diag = p.num('inches') * 0.0254;
    return [diag * 0.8716, diag * 0.4903, 0.04];
  },
  build(p) {
    const set = new PartSet();
    const diag = p.num('inches') * 0.0254;
    const w = diag * 0.8716;
    const h = diag * 0.4903;
    set.add(roundedBox(w, h, 0.03, 0.004, 1).translate(0, h / 2, 0.025), mat('black-metal', '#1b1c1f'));
    set.add(new Geom().quadAuto([-w / 2 + 0.006, 0.006, 0.0405], [w / 2 - 0.006, 0.006, 0.0405], [w / 2 - 0.006, h - 0.006, 0.0405], [-w / 2 + 0.006, h - 0.006, 0.0405]), { finish: 'glass', color: '#0b0c0e', opacity: 1, roughness: 0.05 });
    return set.build();
  },
};

export const TV_SET: FurnitureDef = {
  id: 'furn-tv-set',
  kind: 'tv-set',
  description: 'Television standing on a cabinet or table (flat screen on a small foot, with a box set below it); sits on a host piece.',
  params: {
    inches: num(22, 14, 60, 'diagonal (inches)'),
    shell: color('#d9d8d4', 'casing colour'),
  },
  mount: 'surface',
  againstWall: false,
  frontClearance: 0.8,
  size: (p) => {
    const diag = p.num('inches') * 0.0254;
    return [diag * 0.8716 + 0.06, diag * 0.4903 + 0.1, 0.14];
  },
  build(p) {
    const set = new PartSet();
    const diag = p.num('inches') * 0.0254;
    const w = diag * 0.8716 + 0.06;
    const h = diag * 0.4903 + 0.06;
    set.add(cylinder(0.12, 0.14, 0.02, 20).translate(0, 0, 0), mat('black-metal', '#2a2a2c'));
    set.add(roundedBox(w, h, 0.07, 0.008, 1).translate(0, 0.04 + h / 2, 0), { preset: 'plastic', color: p.color('shell') });
    set.add(new Geom().quadAuto([-w / 2 + 0.03, 0.07, 0.0355], [w / 2 - 0.03, 0.07, 0.0355], [w / 2 - 0.03, h + 0.01, 0.0355], [-w / 2 + 0.03, h + 0.01, 0.0355]), { finish: 'glass', color: '#0b0c0e', opacity: 1, roughness: 0.08 });
    set.boxMinMax(-w / 2, 0, -0.07, w / 2, h + 0.06, 0.07);
    return set.build();
  },
};

export const CORNICE: FurnitureDef = {
  id: 'furn-cornice',
  kind: 'cornice',
  description: 'Plaster cornice (crown moulding) along the top of one wall: a stepped, coved profile; place one per wall at the ceiling line.',
  params: {
    width: num(4, 0.5, 14, 'length of the wall run (m)'),
    height: num(0.14, 0.04, 0.4, 'drop on the wall (m)'),
    depth: num(0.12, 0.03, 0.3, 'projection from the wall (m)'),
    color: color('#f3f0ea', 'paint colour'),
  },
  mount: 'wall',
  againstWall: true,
  frontClearance: 0,
  size: (p) => [p.num('width'), p.num('height'), p.num('depth')],
  build(p) {
    const set = new PartSet();
    const w = p.num('width');
    const h = p.num('height');
    const d = p.num('depth');
    const prof = new Geom();
    // Stepped profile from the bottom edge up to the ceiling: fillet, cove, then a bead, as stacked boxes of growing projection.
    const steps: Array<[number, number, number]> = [
      [0, 0.18, 0.28],
      [0.18, 0.5, 0.62],
      [0.5, 0.74, 0.88],
      [0.74, 1, 1],
    ];
    for (const [a, b, k] of steps) prof.merge(box(-w / 2, h * (1 - b), 0, w / 2, h * (1 - a), d * k));
    set.add(prof, { finish: 'paint', color: p.color('color') });
    set.boxMinMax(-w / 2, 0, 0, w / 2, h, d);
    return set.build();
  },
};

export const FIREPLACE: FurnitureDef = {
  id: 'furn-fireplace',
  kind: 'fireplace',
  description: 'Fireplace: surround (classic, victorian cast-iron arch or modern slab), mantel, raised hearth, optional chimney breast to the ceiling and a glowing firebox. Back against a wall.',
  params: {
    width: num(1.6, 1, 3, 'surround width (m)'),
    height: num(2.7, 2, 4, 'chimney breast height (m); without a breast the piece stops at the mantel'),
    stone: choice(['stone', 'marble', 'concrete', 'brick', 'plaster'], 'stone', 'surround finish'),
    style: choice(['classic', 'victorian', 'modern'], 'classic', 'surround design: classic stone, victorian (cast-iron arched insert, tiled slips), modern (plain slab, wide linear opening)'),
    mantel: choice(['none', 'shelf', 'classic'], 'shelf', 'mantel: none, a plain shelf, or a moulded classic mantel with corbels'),
    breast: flag(true, 'chimney breast up to the ceiling'),
    projection: num(0.45, 0.25, 0.6, 'depth of the chimney breast from the wall (m)'),
    lit: flag(true, 'glowing firebox'),
    hearth: flag(true, 'raised hearth slab in front'),
  },
  mount: 'floor',
  againstWall: true,
  frontClearance: 1.0,
  size: (p) => [p.num('width') + 0.3, p.bool('breast') ? p.num('height') : Math.min(p.num('height'), 1.25), p.num('projection') + 0.25],
  build(p) {
    const set = new PartSet();
    const w = p.num('width');
    const H = p.bool('breast') ? p.num('height') : Math.min(p.num('height'), 1.25);
    const d = p.num('projection');
    const D = d + 0.25;
    const z0 = -D / 2;
    const z1 = z0 + d;
    const style = p.str('style');
    const mantel = style === 'modern' && p.str('mantel') === 'classic' ? 'shelf' : p.str('mantel');
    const finishName = p.str('stone');
    const open = style === 'victorian' ? 0.62 : style === 'modern' ? Math.min(1.2, w - 0.4) : 0.8;
    const openTop = style === 'victorian' ? 0.72 : style === 'modern' ? 0.6 : 0.75;
    const mantelY = mantel === 'classic' ? 1.05 : 0.95;
    const surround = new Geom();
    const jamb = (w - open) / 2;
    surround.merge(box(-w / 2, 0, z0, -open / 2, mantelY, z1));
    surround.merge(box(open / 2, 0, z0, w / 2, mantelY, z1));
    surround.merge(box(-open / 2, openTop, z0, open / 2, mantelY, z1));
    if (mantel === 'shelf') surround.merge(box(-w / 2 - 0.05, mantelY, z0, w / 2 + 0.05, mantelY + 0.05, z1 + 0.04));
    if (mantel === 'classic') {
      // A moulded shelf: a cove under a slab, a bead on top, corbels at the ends and plinth blocks at the foot of each jamb.
      surround.merge(box(-w / 2 - 0.04, mantelY, z0, w / 2 + 0.04, mantelY + 0.035, z1 + 0.03));
      surround.merge(box(-w / 2 - 0.08, mantelY + 0.035, z0, w / 2 + 0.08, mantelY + 0.075, z1 + 0.07));
      surround.merge(box(-w / 2 - 0.1, mantelY + 0.075, z0, w / 2 + 0.1, mantelY + 0.1, z1 + 0.09));
      for (const sgn of [-1, 1]) {
        surround.merge(box(sgn * (w / 2 - 0.1) - 0.05, mantelY - 0.2, z1 - 0.01, sgn * (w / 2 - 0.1) + 0.05, mantelY, z1 + 0.05));
        surround.merge(box(sgn * (w / 2 - jamb / 2) - jamb / 2 - 0.02, 0, z1 - 0.005, sgn * (w / 2 - jamb / 2) + jamb / 2 + 0.02, 0.14, z1 + 0.035));
      }
    }
    if (H > mantelY + 0.12) {
      const x = mantel === 'classic' ? 0.12 : 0.1;
      surround.merge(box(-w / 2 + x, mantelY + (mantel === 'classic' ? 0.1 : 0.05), z0, w / 2 - x, H, z1 - 0.08));
    }
    set.add(surround, mat(finishName));
    if (p.bool('hearth')) set.add(box(-w / 2 - 0.15, 0, z0, w / 2 + 0.15, 0.08, z1 + 0.25), mat('stone', '#5f5a54'));
    // The firebox.
    const zf = z1 - 0.15;
    if (style === 'victorian') {
      // A cast-iron insert with a round-headed opening and a row of glazed tile slips either side.
      const arch: P2[] = [[-open / 2, 0.08]];
      const r = open / 2;
      const spring = openTop - r;
      arch.push([-open / 2, spring]);
      for (let k = 1; k < 12; k++) {
        const a = Math.PI - (k / 12) * Math.PI;
        arch.push([Math.cos(a) * r, spring + Math.sin(a) * r]);
      }
      arch.push([open / 2, spring], [open / 2, 0.08]);
      set.add(extrude(arch, 0, zf + 0.05 - (z0 + 0.02)).rotateX(-90).translate(0, 0, zf + 0.05), mat('black-metal', '#141414'));
      const slips = new Geom();
      for (const sgn of [-1, 1]) slips.merge(box(sgn * (open / 2 + 0.005) + (sgn > 0 ? 0 : -0.1), 0.08, z1 - 0.012, sgn * (open / 2 + 0.005) + (sgn > 0 ? 0.1 : 0), openTop + 0.05, z1 + 0.012));
      set.add(slips, mat('ceramic', '#3f6f5c'));
      set.add(box(-open / 2 - 0.1, openTop + 0.05, z1 - 0.012, open / 2 + 0.1, openTop + 0.12, z1 + 0.014), mat('black-metal', '#1c1c1c'));
    } else {
      set.add(box(-open / 2, 0.08, z0, open / 2, openTop, zf), mat('black-metal', '#141414'));
    }
    const gw = open / 2 - (style === 'victorian' ? 0.12 : 0.08);
    const zg = zf + (style === 'victorian' ? 0.06 : 0.01);
    const gTop = style === 'victorian' ? openTop - 0.34 : openTop - 0.3 > 0.25 ? openTop - 0.3 : 0.4;
    if (p.bool('lit')) set.add(new Geom().quadAuto([-gw, 0.12, zg], [gw, 0.12, zg], [gw, gTop, zg], [-gw, gTop, zg]), { preset: 'emissive', color: '#ff8a3c', emissive: '#ff7a2a', emissiveIntensity: 6 });
    const logs = new Geom();
    for (const [x, a] of [
      [-0.12, 10],
      [0.12, -12],
    ] as const) logs.merge(cylinder(0.05, 0.05, Math.min(0.45, open - 0.2), 12).rotateZ(90).rotateY(a).translate(x * (open / 0.8), 0.14, zf - 0.1));
    set.add(logs, mat('walnut', '#3d2a1d'));
    set.boxMinMax(-w / 2, 0, z0, w / 2, H, z1);
    return set.build();
  },
};

export const CAFE_COUNTER: FurnitureDef = {
  id: 'furn-cafe-counter',
  kind: 'cafe-counter',
  description: 'Café service counter: fluted front, stone top, pastry display case with warm light and an espresso machine. Customers on +Z, barista side −Z.',
  params: {
    length: num(3.2, 1.6, 6, 'length (m)'),
    front: choice(['oak', 'walnut', 'paint', 'terrazzo'], 'oak', 'front finish'),
    top: choice(['marble', 'terrazzo', 'concrete'], 'terrazzo', 'top finish'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 1.2,
  size: (p) => [p.num('length'), 1.45, 0.75],
  build(p) {
    const set = new PartSet();
    const L = p.num('length');
    const d = 0.7;
    const h = 1.05;
    const front = p.str('front') === 'paint' ? mat('paint', '#d9cbb6') : mat(p.str('front'));
    set.add(box(-L / 2, 0, -d / 2, L / 2, h - 0.04, d / 2 - 0.03), mat('paint', '#e9e4dc'));
    const flutes = new Geom();
    for (let x = -L / 2 + 0.03; x < L / 2 - 0.02; x += 0.06) flutes.merge(cylinder(0.026, 0.026, h - 0.1, 12, { top: false, bottom: false }).translate(x + 0.026, 0.06, d / 2 - 0.03));
    set.add(flutes, front);
    set.add(box(-L / 2 - 0.02, h - 0.04, -d / 2, L / 2 + 0.02, h, d / 2 + 0.03), mat(p.str('top')));
    // Display case on the left third.
    const cx0 = -L / 2 + 0.1;
    const cx1 = -L / 2 + Math.min(1.3, L * 0.4);
    set.add(box(cx0, h, -0.05, cx1, h + 0.4, d / 2 - 0.02), { finish: 'glass', opacity: 0.22 });
    set.add(box(cx0, h + 0.4, -0.05, cx1, h + 0.42, d / 2 - 0.02), mat('brass'));
    const pastries = new Geom();
    for (let k = 0; k < 8; k++) pastries.merge(sphere(0.045, 10).scale(1.4, 0.55, 1).translate(cx0 + 0.12 + k * ((cx1 - cx0 - 0.24) / 7), h + 0.03, 0.15 + (k % 2) * 0.12));
    set.add(pastries, { finish: 'paint', color: '#c88a4a', roughness: 0.6 });
    set.add(box(cx0 + 0.02, h + 0.38, 0, cx1 - 0.02, h + 0.39, d / 2 - 0.06), { preset: 'emissive', color: '#fff0d6', emissive: '#ffe2b0', emissiveIntensity: 2 });
    // Espresso machine.
    const mx = L / 2 - 0.55;
    const machine = new Geom();
    machine.merge(roundedBox(0.75, 0.42, 0.52, 0.03, 2).translate(mx, h + 0.21, -0.05));
    for (const gx of [-0.18, 0.18]) machine.merge(cylinder(0.035, 0.035, 0.1, 14).translate(mx + gx, h + 0.1, 0.22));
    set.add(machine, mat('chrome'));
    set.add(box(mx - 0.38, h + 0.42, -0.31, mx + 0.38, h + 0.47, 0.2), mat('black-metal'));
    const cups = new Geom();
    for (let k = 0; k < 5; k++) cups.merge(cylinder(0.035, 0.04, 0.07, 14).translate(mx - 0.2 + k * 0.1, h + 0.47, -0.05));
    set.add(cups, mat('ceramic'));
    set.boxMinMax(-L / 2, 0, -d / 2, L / 2, h, d / 2);
    return set.build();
  },
};

export const WHITEBOARD: FurnitureDef = {
  id: 'furn-whiteboard',
  kind: 'whiteboard',
  description: 'Wall-mounted whiteboard with an aluminium frame and marker tray; back at z = 0.',
  params: {
    width: num(1.8, 0.6, 4, 'width (m)'),
  },
  mount: 'wall',
  againstWall: true,
  frontClearance: 0,
  size: (p) => [p.num('width'), 1.2, 0.03],
  build(p) {
    const set = new PartSet();
    const w = p.num('width');
    set.add(box(-w / 2, 0, 0, w / 2, 1.2, 0.018), mat('brushed-metal'));
    set.add(new Geom().quadAuto([-w / 2 + 0.02, 0.02, 0.019], [w / 2 - 0.02, 0.02, 0.019], [w / 2 - 0.02, 1.18, 0.019], [-w / 2 + 0.02, 1.18, 0.019]), { finish: 'ceramic', color: '#f7f7f5' });
    set.add(box(-w / 4, -0.03, 0, w / 4, 0.0, 0.07), mat('brushed-metal'));
    return set.build();
  },
};

export const MUG: FurnitureDef = {
  id: 'furn-mug',
  kind: 'mug',
  description: 'Ceramic mug with a handle and a little coffee; a prop to pick up, carry and throw.',
  params: { color: color('#e9e4da', 'glaze colour') },
  mount: 'surface',
  againstWall: false,
  frontClearance: 0,
  portable: { mass: 0.35 },
  size: () => [0.11, 0.095, 0.08],
  build(p) {
    const set = new PartSet();
    const wall = lathe([[0, 0], [0.038, 0], [0.04, 0.004], [0.04, 0.095], [0.0365, 0.095], [0.0365, 0.01], [0, 0.01]], 28);
    const handle = tube([[0.039, 0.082, 0], [0.062, 0.078, 0], [0.066, 0.05, 0], [0.058, 0.022, 0], [0.039, 0.016, 0]], 0.0065, 8);
    set.add(wall.merge(handle), mat('ceramic', p.color('color')));
    set.add(cylinder(0.0362, 0.0362, 0.002, 24).translate(0, 0.081, 0), { finish: 'paint', color: '#3b2a20', roughness: 0.12 });
    set.boxMinMax(-0.04, 0, -0.04, 0.068, 0.095, 0.04);
    return set.build();
  },
};

export const BOOK: FurnitureDef = {
  id: 'furn-book',
  kind: 'book',
  description: 'Hardback book lying flat; a prop to pick up, carry and throw.',
  params: { color: color('#7a3b2e', 'cover colour') },
  mount: 'surface',
  againstWall: false,
  frontClearance: 0,
  portable: { mass: 0.6 },
  size: () => [0.16, 0.03, 0.23],
  build(p) {
    const set = new PartSet();
    set.add(roundedBox(0.16, 0.006, 0.23, 0.002, 1).translate(0, 0.003, 0).merge(roundedBox(0.16, 0.006, 0.23, 0.002, 1).translate(0, 0.027, 0)).merge(roundedBox(0.016, 0.03, 0.23, 0.004, 1).translate(-0.072, 0.015, 0)), mat('leather', p.color('color')));
    set.add(box(-0.064, 0.006, -0.108, 0.08, 0.024, 0.108), mat('plaster', '#efe9dc'));
    set.boxMinMax(-0.08, 0, -0.115, 0.08, 0.03, 0.115);
    return set.build();
  },
};

/** Decor definitions. */
/**
 * Small styling accessories that make a surface look lived in: a ceramic vase with a few leafy stems, a bowl of fruit,
 * a stack of books, a pair of candles, folded towels. One piece, its look by `style`.
 */
export const ACCENT: FurnitureDef = {
  id: 'furn-accent',
  kind: 'accent',
  description: 'Styling accessory for a table, sideboard, shelf or worktop: vase with stems, bowl of fruit, stack of books, candles or folded towels.',
  params: {
    style: choice(['vase', 'bowl', 'books', 'candles', 'towels'], 'vase', 'what it is'),
    color: color('#d9d2c4', 'main colour (glaze, covers, towels)'),
    accent: color('#6f7d5a', 'second colour (stems, fruit, the other books)'),
  },
  mount: 'surface',
  againstWall: false,
  frontClearance: 0,
  size: (p) => {
    switch (p.str('style')) {
      case 'bowl':
        return [0.3, 0.12, 0.3];
      case 'books':
        return [0.24, 0.12, 0.3];
      case 'candles':
        return [0.2, 0.26, 0.1];
      case 'towels':
        return [0.32, 0.14, 0.24];
      default:
        return [0.16, 0.5, 0.16];
    }
  },
  build(p) {
    const set = new PartSet();
    const style = p.str('style');
    const c = p.color('color');
    const a = p.color('accent');
    if (style === 'bowl') {
      set.add(lathe([[0, 0], [0.06, 0], [0.13, 0.05], [0.15, 0.09], [0.142, 0.09], [0.122, 0.052], [0.055, 0.012], [0, 0.012]], 28), mat('ceramic', c));
      const fruit = new Geom();
      const spots: Array<[number, number, number, number]> = [[0, 0.055, 0, 0.042], [0.05, 0.05, 0.03, 0.038], [-0.045, 0.05, 0.035, 0.04], [0.01, 0.05, -0.055, 0.039], [-0.02, 0.095, 0.01, 0.036]];
      for (const [x, y, z, r] of spots) fruit.merge(sphere(r, 12).translate(x, y, z));
      set.add(fruit, mat('paint', a));
      set.boxMinMax(-0.15, 0, -0.15, 0.15, 0.12, 0.15);
    } else if (style === 'books') {
      const covers = [c, a, '#2f3a4a'];
      const sizes: Array<[number, number, number]> = [[0.24, 0.04, 0.3], [0.21, 0.035, 0.27], [0.19, 0.03, 0.25]];
      let y = 0;
      sizes.forEach(([w, h, d], k) => {
        set.add(roundedBox(w, h, d, 0.004, 1).translate(k * 0.008, y + h / 2, -k * 0.01), mat('leather', covers[k] as string));
        y += h;
      });
      set.boxMinMax(-0.12, 0, -0.15, 0.12, y, 0.15);
    } else if (style === 'candles') {
      const holder = new Geom();
      const wax = new Geom();
      for (const [x, h] of [[-0.05, 0.22], [0.05, 0.16]] as const) {
        holder.merge(lathe([[0, 0], [0.04, 0], [0.042, 0.01], [0.012, 0.03], [0.02, 0.045], [0, 0.045]], 20).translate(x, 0, 0));
        wax.merge(cylinder(0.011, 0.011, h - 0.045, 12).translate(x, 0.045, 0));
      }
      set.add(holder, mat('brass'));
      set.add(wax, mat('paint', '#f3efe6'));
      set.boxMinMax(-0.1, 0, -0.05, 0.1, 0.22, 0.05);
    } else if (style === 'towels') {
      let y = 0;
      for (let k = 0; k < 3; k++) {
        set.add(roundedBox(0.32, 0.045, 0.24, 0.02, 2).translate(0, y + 0.0225, 0), mat('fabric', k === 1 ? a : c));
        y += 0.045;
      }
      set.boxMinMax(-0.16, 0, -0.12, 0.16, y, 0.12);
    } else {
      // Vase: a lathed bottle, three stems with a few leaves each.
      set.add(lathe([[0, 0], [0.05, 0], [0.07, 0.06], [0.072, 0.15], [0.045, 0.24], [0.028, 0.27], [0.032, 0.29], [0.026, 0.29], [0, 0.28]], 28), mat('ceramic', c));
      const stems = new Geom();
      const leaves = new Geom();
      const rnd = seeded(7);
      for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * Math.PI * 2 + 0.4;
        const lean = 0.05 + rnd() * 0.05;
        const top: [number, number, number] = [Math.cos(ang) * lean, 0.48 + rnd() * 0.08, Math.sin(ang) * lean];
        stems.merge(tube([[0, 0.26, 0], [top[0] * 0.5, 0.38, top[2] * 0.5], top], 0.003, 5));
        for (let j = 0; j < 4; j++) {
          const t = 0.45 + j * 0.15;
          leaves.merge(sphere(0.018, 6).scale(1.6, 0.35, 0.9).translate(top[0] * t + (j % 2 ? 0.015 : -0.015), 0.26 + (top[1] - 0.26) * t, top[2] * t));
        }
      }
      set.add(stems, mat('paint', '#5c5a3c'));
      set.add(leaves, mat('paint', a));
      set.boxMinMax(-0.08, 0, -0.08, 0.08, 0.5, 0.08);
    }
    return set.build();
  },
};

export const DECOR: readonly FurnitureDef[] = [RUG, CURTAIN, BLIND, PLANT, FRAME, MIRROR, TV, TV_SET, CORNICE, FIREPLACE, CAFE_COUNTER, WHITEBOARD, MUG, BOOK, ACCENT];
