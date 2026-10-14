/**
 * Seating: sofas, armchairs, dining chairs, office chairs and bar stools.
 * Proportions follow common catalogue dimensions (seat height 44–47 cm,
 * sofa depth ~95 cm, arm height ~62 cm, bar stools 75 cm for a 90–105 cm
 * counter).
 */
import { Geom, cylinder, roundedBox, sphere, tube } from '../mesh';
import { PartSet } from '../parts';
import { UPHOLSTERY, WOODS, choice, color, cushion, int, leg, mat, num, type FurnitureDef } from './kit';

const legOptions = ['oak', 'walnut', 'black-metal', 'brass'];

export const SOFA: FurnitureDef = {
  id: 'furn-sofa',
  kind: 'sofa',
  description: 'Upholstered sofa with seat and back cushions, track arms, tapered legs and two throw pillows. Front faces +Z.',
  params: {
    width: num(2.2, 1.4, 3.6, 'overall width (m)'),
    depth: num(0.95, 0.8, 1.15, 'overall depth (m)'),
    seats: int(0, 0, 4, 'seat cushions (0 = from width)'),
    upholstery: choice(UPHOLSTERY, 'fabric', 'cover material'),
    color: color('#a29d94', 'cover colour'),
    accent: color('#c98a5a', 'pillow colour'),
    legs: choice(legOptions, 'walnut', 'leg finish'),
  },
  mount: 'floor',
  againstWall: true,
  frontClearance: 0.6,
  size: (p) => [p.num('width'), 0.8, p.num('depth')],
  build(p) {
    const set = new PartSet();
    const w = p.num('width');
    const d = p.num('depth');
    const cover = mat(p.str('upholstery'), p.color('color'));
    const legH = 0.12;
    const armW = 0.17;
    const backD = 0.2;
    const body = new Geom();
    body.merge(roundedBox(w, 0.2, d, 0.04, 2).translate(0, legH + 0.1, 0));
    body.merge(roundedBox(w, 0.44, backD, 0.05, 3).translate(0, legH + 0.2 + 0.22, -d / 2 + backD / 2));
    for (const s of [-1, 1] as const) body.merge(roundedBox(armW, 0.5, d, 0.06, 3).translate(s * (w / 2 - armW / 2), legH + 0.25, 0));
    const cushions = new Geom();
    const inner = w - 2 * armW;
    const n = p.int('seats') > 0 ? p.int('seats') : Math.max(1, Math.min(4, Math.round(inner / 0.72)));
    const cw = inner / n;
    const seatD = d - backD - 0.02;
    for (let k = 0; k < n; k++) {
      const x = -inner / 2 + cw * (k + 0.5);
      cushions.merge(cushion(cw - 0.012, 0.13, seatD, legH + 0.2, 0.012).translate(x, 0, -d / 2 + backD + seatD / 2 + 0.01));
      const back = cushion(cw - 0.02, 0.4, 0.17, 0, 0.02).rotateX(-9).translate(x, legH + 0.32, -d / 2 + backD + 0.04);
      cushions.merge(back);
    }
    set.add(body, cover).add(cushions, cover);
    const pillows = new Geom();
    for (const s of [-1, 1] as const) {
      pillows.merge(cushion(0.42, 0.13, 0.42, -0.065, 0.03).rotateX(-72).rotateY(s * -14).translate(s * (inner / 2 - 0.26), legH + 0.55, -d / 2 + backD + 0.18));
    }
    set.add(pillows, mat('velvet', p.color('accent')));
    const legs = new Geom();
    for (const sx of [-1, 1] as const) for (const sz of [-1, 1] as const) legs.merge(leg(sx * (w / 2 - 0.08), sz * (d / 2 - 0.08), legH, 0.02));
    set.add(legs, mat(p.str('legs')));
    set.boxMinMax(-w / 2, 0, -d / 2, w / 2, legH + 0.32, d / 2);
    set.boxMinMax(-w / 2, legH + 0.32, -d / 2, w / 2, 0.8, -d / 2 + backD);
    return set.build();
  },
};

export const ARMCHAIR: FurnitureDef = {
  id: 'furn-armchair',
  kind: 'armchair',
  description: 'Lounge armchair with a soft seat, angled back cushion and tapered legs. Front faces +Z.',
  params: {
    width: num(0.82, 0.6, 1.1, 'width (m)'),
    upholstery: choice(UPHOLSTERY, 'fabric', 'cover material'),
    color: color('#c7b9a5', 'cover colour'),
    legs: choice(legOptions, 'oak', 'leg finish'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.5,
  size: (p) => [p.num('width'), 0.82, 0.84],
  build(p) {
    const set = new PartSet();
    const w = p.num('width');
    const d = 0.84;
    const cover = mat(p.str('upholstery'), p.color('color'));
    const legH = 0.16;
    const g = new Geom();
    g.merge(roundedBox(w, 0.16, d, 0.04, 2).translate(0, legH + 0.08, 0));
    g.merge(roundedBox(w, 0.5, 0.16, 0.05, 3).rotateX(-10).translate(0, legH + 0.4, -d / 2 + 0.1));
    for (const s of [-1, 1] as const) g.merge(roundedBox(0.12, 0.42, d - 0.04, 0.05, 3).translate(s * (w / 2 - 0.06), legH + 0.21, 0));
    g.merge(cushion(w - 0.26, 0.12, d - 0.2, legH + 0.15, 0.015).translate(0, 0, 0.07));
    set.add(g, cover);
    const legs = new Geom();
    for (const sx of [-1, 1] as const) for (const sz of [-1, 1] as const) legs.merge(leg(sx * (w / 2 - 0.07), sz * (d / 2 - 0.07), legH, 0.019));
    set.add(legs, mat(p.str('legs')));
    set.boxMinMax(-w / 2, 0, -d / 2, w / 2, 0.82, d / 2);
    return set.build();
  },
};

export const CHAIR: FurnitureDef = {
  id: 'furn-chair',
  kind: 'chair',
  description: 'Dining chair: solid-wood frame, slightly splayed legs, upholstered or wooden seat, curved back rail. Front faces +Z.',
  params: {
    wood: choice(WOODS, 'oak', 'frame finish'),
    seat: choice(['wood', 'fabric', 'leather'], 'fabric', 'seat material'),
    color: color('#8f8678', 'seat colour (fabric / leather)'),
    style: choice(['slat', 'panel', 'spindle'], 'slat', 'back style'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.45,
  size: () => [0.46, 0.82, 0.5],
  build(p) {
    const set = new PartSet();
    const wood = mat(p.str('wood'));
    const frame = new Geom();
    const sh = 0.45;
    // Legs (back legs continue up into the back posts).
    for (const sx of [-1, 1] as const) {
      frame.merge(leg(sx * 0.19, 0.2, sh - 0.03, 0.017, 0.75));
      frame.merge(tube([[sx * 0.19, 0, -0.2], [sx * 0.2, sh, -0.21], [sx * 0.2, 0.82, -0.25]], 0.016, 8));
    }
    frame.merge(roundedBox(0.44, 0.03, 0.45, 0.01, 2).translate(0, sh - 0.045, 0));
    // Back.
    const style = p.str('style');
    frame.merge(roundedBox(0.4, 0.07, 0.025, 0.01, 2).translate(0, 0.76, -0.245));
    if (style === 'slat') for (const x of [-0.1, 0, 0.1]) frame.merge(roundedBox(0.035, 0.25, 0.018, 0.006, 1).translate(x, 0.6, -0.235));
    else if (style === 'spindle') for (let k = -3; k <= 3; k++) frame.merge(cylinder(0.008, 0.008, 0.26, 8).translate(k * 0.05, 0.47, -0.232));
    else frame.merge(roundedBox(0.38, 0.22, 0.025, 0.01, 2).translate(0, 0.6, -0.235));
    set.add(frame, wood);
    const seatMat = p.str('seat') === 'wood' ? wood : mat(p.str('seat'), p.color('color'));
    set.add(cushion(0.44, 0.05, 0.44, sh - 0.03, 0.008).translate(0, 0, 0.005), seatMat);
    set.boxMinMax(-0.22, 0, -0.25, 0.22, sh + 0.02, 0.23);
    set.boxMinMax(-0.22, sh, -0.27, 0.22, 0.82, -0.2);
    return set.build();
  },
};

export const OFFICE_CHAIR: FurnitureDef = {
  id: 'furn-office-chair',
  kind: 'office-chair',
  description: 'Ergonomic office chair: five-star base with casters, gas lift, padded seat, mesh back and armrests. Front faces +Z.',
  params: {
    color: color('#2b2d31', 'upholstery colour'),
    base: choice(['black-metal', 'chrome', 'brushed-metal'], 'chrome', 'base finish'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.4,
  size: () => [0.64, 1.08, 0.64],
  build(p) {
    const set = new PartSet();
    const metal = mat(p.str('base'));
    const base = new Geom();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const x = Math.cos(a) * 0.3;
      const z = Math.sin(a) * 0.3;
      base.merge(tube([[0, 0.1, 0], [x, 0.07, z]], 0.018, 8));
      base.merge(sphere(0.028, 10).translate(x, 0.03, z));
    }
    base.merge(cylinder(0.025, 0.025, 0.32, 14).translate(0, 0.1, 0));
    set.add(base, metal);
    const pad = mat('fabric', p.color('color'));
    const seat = cushion(0.5, 0.08, 0.48, 0.42, 0.01);
    const back = cushion(0.46, 0.5, 0.06, 0, 0.02).rotateX(-12).translate(0, 0.56, -0.24);
    set.add(seat.merge(back), pad);
    const arms = new Geom();
    for (const s of [-1, 1] as const) {
      arms.merge(tube([[s * 0.24, 0.45, -0.05], [s * 0.26, 0.64, -0.03]], 0.012, 8));
      arms.merge(roundedBox(0.06, 0.03, 0.26, 0.012, 2).translate(s * 0.26, 0.65, 0.0));
    }
    set.add(arms, mat('black-metal'));
    set.boxMinMax(-0.3, 0, -0.3, 0.3, 0.5, 0.3);
    return set.build();
  },
};

export const BAR_STOOL: FurnitureDef = {
  id: 'furn-bar-stool',
  kind: 'bar-stool',
  description: 'Counter / bar stool: round padded seat, four splayed metal legs and a footrest ring.',
  params: {
    height: num(0.75, 0.6, 0.82, 'seat height (m)'),
    seat: choice(['leather', 'oak', 'walnut', 'fabric'], 'leather', 'seat finish'),
    color: color('#6e4128', 'seat colour (leather / fabric)'),
    legs: choice(['black-metal', 'brass', 'chrome'], 'black-metal', 'leg finish'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.3,
  size: (p) => [0.42, p.num('height'), 0.42],
  build(p) {
    const set = new PartSet();
    const h = p.num('height');
    const frame = new Geom();
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      frame.merge(tube([[Math.cos(a) * 0.21, 0, Math.sin(a) * 0.21], [Math.cos(a) * 0.14, h - 0.04, Math.sin(a) * 0.14]], 0.011, 8));
    }
    const ring: Array<readonly [number, number, number]> = [];
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      ring.push([Math.cos(a) * 0.185, 0.28, Math.sin(a) * 0.185]);
    }
    frame.merge(tube(ring, 0.009, 6));
    set.add(frame, mat(p.str('legs')));
    const seatFinish = p.str('seat');
    const seatMat = seatFinish === 'leather' || seatFinish === 'fabric' ? mat(seatFinish, p.color('color')) : mat(seatFinish);
    set.add(cylinder(0.19, 0.2, 0.05, 32).translate(0, h - 0.05, 0).merge(cushion(0.36, 0.03, 0.36, h - 0.01, 0.006)), seatMat);
    set.boxMinMax(-0.2, 0, -0.2, 0.2, h, 0.2);
    return set.build();
  },
};

/** Seating definitions. */
export const SEATING: readonly FurnitureDef[] = [SOFA, ARMCHAIR, CHAIR, OFFICE_CHAIR, BAR_STOOL];
