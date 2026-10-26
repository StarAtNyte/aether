/**
 * Venue pieces: the things that make an auditorium, theatre or hall read as one. Cinema seat (flip-up padded seat, high back,
 * armrests with cup holder), stepped tier floor, cinema screen with masking and a projected frame, stage with trim and
 * curtains, speakers, acoustic wall panels, a projection booth window, aisle step lights and a lectern.
 *
 * Every piece is one mesh per material with shared geometry across copies, so a block of 120 seats placed as a scatter is one
 * instanced draw per material, and each piece stays under ~3k triangles.
 */
import { Geom, box, cylinder, roundedBox } from '../mesh';
import { PartSet } from '../parts';
import type { P2 } from '../math2';
import { UPHOLSTERY, choice, color, flag, int, mat, num, type FurnitureDef } from './kit';
import { bevelSlab, mixColor, pleatedCloth, prismX, ring, rotateXAbout } from './venue-kit';

const plastic = (c = '#16161a', roughness = 0.45) => ({ finish: 'paint' as const, color: c, roughness });
const EMISSIVE = (c: string, k: number) => ({ preset: 'emissive' as const, color: c, emissive: c, emissiveIntensity: k });

// ---------------------------------------------------------------------------
// Cinema / theatre seat
// ---------------------------------------------------------------------------

export const CINEMA_SEAT: FurnitureDef = {
  id: 'furn-cinema-seat',
  kind: 'cinema-seat',
  description:
    'Cinema / theatre / auditorium seat: flip-up padded seat on a hinge, high padded back with head roll, cast steel end standards, armrests with a cup holder. Front faces +Z (the screen is at +Z); one seat is 0.56 m wide, so a row is one scatter. Place rows with shape_land {op:"tier"}.',
  params: {
    width: num(0.56, 0.45, 0.8, 'seat pitch (m)'),
    upholstery: choice(UPHOLSTERY, 'velvet', 'seat and back material'),
    color: color('#a31f30', 'upholstery colour (cinema red by default)'),
    seatUp: flag(false, 'flip the seat up (an empty seat in a theatre)'),
    cupholder: flag(true, 'cup holder in the right armrest'),
    frame: choice(['black-metal', 'chrome', 'brushed-metal'], 'black-metal', 'standards and hinge finish'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.4,
  size: (p) => [p.num('width'), 1.12, 0.72],
  build(p) {
    const set = new PartSet();
    const w = p.num('width');
    const cover = mat(p.str('upholstery'), p.color('color'));
    const steel = mat(p.str('frame'));
    const hx = w / 2;
    // End standards (cast legs) and a rear cross tube.
    const frame = new Geom();
    for (const s of [-1, 1] as const) {
      const prof: P2[] = [[-0.26, 0], [0.14, 0], [0.14, 0.04], [0.03, 0.4], [-0.22, 0.58], [-0.26, 0.58]];
      frame.merge(prismX(prof, s * (hx - 0.03) - 0.015, s * (hx - 0.03) + 0.015));
    }
    frame.merge(cylinder(0.014, 0.014, w - 0.06, 8).rotateZ(90).translate(0, 0.27, -0.24));
    frame.merge(cylinder(0.011, 0.011, w - 0.08, 8).rotateZ(90).translate(0, 0.462, -0.165));
    set.add(frame, steel);
    // Armrests: padded black cap on a steel post; cup holder on the right.
    const arms = new Geom();
    for (const s of [-1, 1] as const) {
      const ax = s * (hx - 0.03);
      arms.merge(box(ax - 0.012, 0.42, -0.2, ax + 0.012, 0.6, -0.14));
      arms.merge(roundedBox(0.06, 0.05, 0.5, 0.02, 2).translate(ax, 0.625, -0.01));
    }
    set.add(arms, plastic('#1b1b1f', 0.5));
    if (p.bool('cupholder')) {
      const cx = hx - 0.03;
      const cz = 0.1;
      set.add(ring(0.031, 0.042, 0.648, 0.662, 18).translate(cx, 0, cz), mat('chrome'));
      set.add(cylinder(0.031, 0.031, 0.004, 18).translate(cx, 0.644, cz), plastic('#050506', 0.3));
    }
    // Seat: a padded cushion with a front lip, hinged at the back, optionally flipped up.
    const seat = new Geom();
    seat.merge(roundedBox(w - 0.11, 0.1, 0.5, 0.04, 3).translate(0, 0.5, 0.045));
    seat.merge(roundedBox(w - 0.14, 0.04, 0.12, 0.018, 2).translate(0, 0.46, 0.27));
    seat.merge(roundedBox(w - 0.13, 0.05, 0.48, 0.02, 2).rotateX(1.5).translate(0, 0.435, 0.03));
    if (p.bool('seatUp')) rotateXAbout(seat, -80, 0.46, -0.165);
    set.add(seat, cover);
    // Back: padded panel leaning 10 degrees, a head roll, a black rear shell and a lumbar seam.
    const back = new Geom();
    back.merge(roundedBox(w - 0.1, 0.6, 0.1, 0.045, 3).translate(0, 0, 0));
    back.merge(roundedBox(w - 0.13, 0.17, 0.135, 0.06, 3).translate(0, 0.325, 0.005));
    back.rotateX(-10).translate(0, 0.84, -0.3);
    set.add(back, cover);
    const shell = roundedBox(w - 0.115, 0.7, 0.014, 0.006, 1).rotateX(-10).translate(0, 0.84, -0.3 - 0.062);
    set.add(shell, plastic('#101013', 0.4));
    const seam = new Geom();
    for (const dy of [-0.16, 0.1]) seam.merge(box(-(w - 0.18) / 2, dy - 0.003, 0.049, (w - 0.18) / 2, dy + 0.003, 0.052).rotateX(-10).translate(0, 0.84, -0.3));
    set.add(seam, plastic('#2b0a10', 0.7));
    // Row number plate.
    set.add(box(-0.025, 0.93, -0.352, 0.025, 0.955, -0.346), mat('brass'));
    set.boxMinMax(-hx, 0, -0.34, hx, 0.6, 0.3);
    set.boxMinMax(-hx + 0.03, 0.6, -0.36, hx - 0.03, 1.12, -0.24);
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Tier floor (stepped auditorium floor)
// ---------------------------------------------------------------------------

/** Height of the floor under the front row (m): the tier's base slab. */
export const TIER_BASE = 0.04;

export const TIER_STEPS: FurnitureDef = {
  id: 'furn-tier-steps',
  kind: 'tier-steps',
  description:
    'Stepped (tiered, raked) floor of an auditorium or lecture hall: `rows` treads of depth `depth`, each `riser` higher than the one in front, carpet treads and dark risers, full width. Centred on its footprint; the lowest row is at +Z (towards the screen) and the room rises towards -Z. Tread k is at height 0.04 + k * riser. Seats stand on it: use shape_land {op:"tier"} to lay both.',
  params: {
    rows: int(8, 1, 40, 'number of rows (treads)'),
    width: num(8, 1, 40, 'width of the tier (m)'),
    depth: num(1.05, 0.6, 2.5, 'tread depth = row pitch (m)'),
    riser: num(0.18, 0.04, 0.5, 'height difference between rows (m)'),
    finish: choice(['carpet', 'concrete', 'oak', 'tile'], 'carpet', 'tread finish'),
    color: color('#6e3441', 'tread colour'),
    riserColor: color('#2b1a20', 'riser and side colour'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 1,
  size: (p) => [p.num('width'), TIER_BASE + (p.int('rows') - 1) * p.num('riser'), p.int('rows') * p.num('depth')],
  build(p) {
    const set = new PartSet();
    const rows = p.int('rows');
    const w = p.num('width');
    const d = p.num('depth');
    const r = p.num('riser');
    const D = rows * d;
    const treads = new Geom();
    const risers = new Geom();
    const sides = new Geom();
    for (let k = 0; k < rows; k++) {
      const zc = D / 2 - d / 2 - k * d;
      const z0 = zc - d / 2;
      const z1 = zc + d / 2;
      const top = TIER_BASE + k * r;
      treads.quadAuto([-w / 2, top, z1], [w / 2, top, z1], [w / 2, top, z0], [-w / 2, top, z0], -w / 2, -z1);
      const below = k === 0 ? 0 : TIER_BASE + (k - 1) * r;
      if (top - below > 1e-4) risers.quadAuto([-w / 2, below, z1], [w / 2, below, z1], [w / 2, top, z1], [-w / 2, top, z1], -w / 2, below);
      for (const s of [-1, 1] as const) {
        const x = s * (w / 2);
        // Side faces: the step's profile down to the floor.
        if (s > 0) sides.quadAuto([x, 0, z1], [x, 0, z0], [x, top, z0], [x, top, z1], -z1, 0);
        else sides.quadAuto([x, 0, z0], [x, 0, z1], [x, top, z1], [x, top, z0], z0, 0);
      }
      set.boxMinMax(-w / 2, 0, z0, w / 2, top, z1);
    }
    // Back wall of the last step.
    const zBack = -D / 2;
    const topBack = TIER_BASE + (rows - 1) * r;
    sides.quadAuto([w / 2, 0, zBack], [-w / 2, 0, zBack], [-w / 2, topBack, zBack], [w / 2, topBack, zBack], -w / 2, 0);
    const finish = p.str('finish');
    set.add(treads, { finish: finish as 'carpet', color: p.color('color') });
    set.add(risers, { finish: 'paint', color: p.color('riserColor'), roughness: 0.8 });
    set.add(sides, { finish: 'paint', color: mixColor(p.color('riserColor'), '#000000', 0.2), roughness: 0.85 });
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Cinema screen
// ---------------------------------------------------------------------------

const FORMATS: Record<string, number> = { scope: 2.39, flat: 1.85, wide: 1.78 };

/** A curved strip between a lower and an upper edge function of u in 0..1 (x across the width, curving towards +Z at the ends). */
function screenStrip(w: number, z0: number, sag: number, yLow: (u: number) => number, yHigh: (u: number) => number, cols = 32): Geom {
  const g = new Geom();
  for (let c = 0; c <= cols; c++) {
    const u = c / cols;
    const x = -w / 2 + w * u;
    const e = (2 * x) / w;
    const z = z0 + sag * e * e;
    const dz = (2 * sag * 2 * e) / w;
    const l = Math.hypot(dz, 1);
    g.vertex(x, yLow(u), z, -dz / l, 0, 1 / l, x, yLow(u));
    g.vertex(x, yHigh(u), z, -dz / l, 0, 1 / l, x, yHigh(u));
  }
  for (let c = 0; c < cols; c++) {
    const a = c * 2;
    g.tri(a, a + 2, a + 3).tri(a, a + 3, a + 1);
  }
  return g;
}

export const CINEMA_SCREEN: FurnitureDef = {
  id: 'furn-cinema-screen',
  kind: 'cinema-screen',
  description:
    'Cinema screen on a wall: black steel frame, black velvet masking on the top and sides, a slightly curved projection surface that glows (a projected film frame by default) so the hall is lit from the front. Origin at the bottom centre, back on the wall (z = 0), the picture faces +Z. Bottom edge about 0.9 m above the stage or floor: set y.',
  params: {
    width: num(10, 2, 24, 'picture width (m)'),
    format: choice(['scope', 'flat', 'wide'], 'scope', 'aspect: scope 2.39:1, flat 1.85:1, wide 16:9'),
    curve: num(0.12, 0, 0.5, 'sag of the ends towards the audience (m)'),
    masking: flag(true, 'black masking border'),
    content: choice(['film', 'white', 'off'], 'film', 'a projected landscape frame, a white field, or a dark screen'),
    glow: num(1.3, 0, 4, 'how bright the picture is (emissive strength)'),
  },
  mount: 'wall',
  againstWall: true,
  frontClearance: 3,
  size: (p) => [p.num('width') + (p.bool('masking') ? 0.8 : 0.3), p.num('width') / (FORMATS[p.str('format')] ?? 2.39) + (p.bool('masking') ? 0.5 : 0.2), 0.3],
  build(p) {
    const out = new PartSet();
    const set = { add: (g: Geom, m: Parameters<PartSet['add']>[1]): PartSet => out.add(g.translate(0, 0.07, 0), m) };
    const w = p.num('width');
    const h = w / (FORMATS[p.str('format')] ?? 2.39);
    const sag = p.num('curve');
    const glow = p.num('glow');
    const z0 = 0.1;
    const fr = 0.07;
    const steel = new Geom();
    steel.merge(box(-w / 2 - fr, -fr, 0, w / 2 + fr, 0, 0.14));
    steel.merge(box(-w / 2 - fr, h, 0, w / 2 + fr, h + fr, 0.14));
    steel.merge(box(-w / 2 - fr, 0, 0, -w / 2, h, 0.14));
    steel.merge(box(w / 2, 0, 0, w / 2 + fr, h, 0.14));
    set.add(steel, plastic('#0d0d10', 0.5));
    // Backing so the wall never shows through the picture.
    set.add(box(-w / 2, 0, 0.0, w / 2, h, 0.04), plastic('#050506', 0.9));
    const content = p.str('content');
    if (content === 'off') {
      set.add(screenStrip(w, z0, sag, () => 0, () => h), { finish: 'paint', color: '#17181c', roughness: 0.35 });
    } else if (content === 'white') {
      set.add(screenStrip(w, z0, sag, () => 0, () => h), EMISSIVE('#dfe4ee', glow * 0.7));
    } else {
      // A projected landscape: sky, a warm horizon band, two ranges of hills and a dark foreground.
      const wave = (a: number, f: number, ph: number) => (u: number): number => h * (a + 0.035 * Math.sin(u * f + ph) + 0.02 * Math.sin(u * f * 2.3 + ph * 2));
      const horizon = h * 0.46;
      // Sky as a soft gradient of bands, a warm band at the horizon, then three layers of land.
      const skyTop = '#4d6f9c';
      const skyLow = '#a9bfd6';
      const bands = 7;
      for (let k = 0; k < bands; k++) {
        const y0 = horizon + ((h - horizon) * k) / bands;
        const y1 = horizon + ((h - horizon) * (k + 1)) / bands + 0.002;
        set.add(screenStrip(w, z0 + k * 0.0001, sag, () => y0, () => y1), EMISSIVE(mixColor(skyLow, skyTop, k / (bands - 1)), glow * 0.62));
      }
      set.add(screenStrip(w, z0 + 0.0008, sag, () => horizon, () => h * 0.55), EMISSIVE('#e8c9a0', glow * 0.7));
      set.add(screenStrip(w, z0 + 0.0016, sag, () => h * 0.2, wave(0.4, 9, 1)), EMISSIVE('#7f93a3', glow * 0.55));
      set.add(screenStrip(w, z0 + 0.0024, sag, () => h * 0.08, wave(0.27, 6, 3)), EMISSIVE('#56705a', glow * 0.5));
      set.add(screenStrip(w, z0 + 0.0032, sag, () => 0, wave(0.12, 11, 0.4)), EMISSIVE('#27342a', glow * 0.4));
      // A low sun.
      const sun = new Geom();
      const r = h * 0.07;
      const cx = w * 0.18;
      const n = 24;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2;
        const a1 = ((k + 1) / n) * Math.PI * 2;
        const zc = z0 + 0.0045 + sag * ((2 * cx) / w) ** 2;
        const c = sun.vertexCount;
        sun.vertex(cx, horizon + h * 0.12, zc, 0, 0, 1, 0, 0);
        sun.vertex(cx + Math.cos(a0) * r, horizon + h * 0.12 + Math.sin(a0) * r, zc, 0, 0, 1, 1, 0);
        sun.vertex(cx + Math.cos(a1) * r, horizon + h * 0.12 + Math.sin(a1) * r, zc, 0, 0, 1, 1, 1);
        sun.tri(c, c + 1, c + 2);
      }
      set.add(sun, EMISSIVE('#fff1d2', glow * 1.1));
    }
    if (p.bool('masking')) {
      const m = 0.4;
      const vel = { finish: 'velvet' as const, color: '#09090b' };
      const top = box(-w / 2 - m, h, 0.02, w / 2 + m, h + m * 0.8, 0.16);
      const left = box(-w / 2 - m, -0.05, 0.02, -w / 2, h, 0.16);
      const right = box(w / 2, -0.05, 0.02, w / 2 + m, h, 0.16);
      set.add(top.merge(left).merge(right), vel);
      // Masking is a fabric border: add a gather (pleats) on the top for texture.
      set.add(pleatedCloth(-w / 2 - m, w / 2 + m, h + 0.02, h + m * 0.8, 0.17, Math.max(8, Math.round(w * 2)), 0.012, { rows: 1 }), vel);
    }
    out.boxMinMax(-w / 2, 0.07, 0, w / 2, h + 0.07, 0.14);
    return out.build();
  },
};

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export const STAGE: FurnitureDef = {
  id: 'furn-stage',
  kind: 'stage',
  description:
    'Raised stage with a wooden deck, a black fascia with a brass trim line, front-corner steps and optional pleated velvet curtains (open to the sides or closed), a gathered valance and a black backdrop. Back at -Z, the audience on +Z. Footprint centred on the origin.',
  params: {
    width: num(10, 2, 30, 'width (m)'),
    depth: num(4.5, 1.5, 14, 'depth (m)'),
    height: num(0.95, 0.2, 1.5, 'deck height above the floor (m)'),
    curtains: choice(['open', 'closed', 'none'], 'open', 'main curtains drawn open to the sides, closed, or none'),
    curtainColor: color('#8d1b2f', 'curtain colour'),
    curtainHeight: num(4.8, 2.4, 9, 'curtain height above the deck (m)'),
    deck: choice(['oak', 'walnut', 'ash'], 'oak', 'deck finish'),
    steps: flag(true, 'steps at the front right corner'),
    backdrop: flag(true, 'black backdrop curtain'),
  },
  mount: 'floor',
  againstWall: true,
  frontClearance: 2,
  size: (p) => [p.num('width'), p.num('height') + (p.str('curtains') === 'none' && !p.bool('backdrop') ? 0 : p.num('curtainHeight')), p.num('depth') + (p.bool('steps') ? 0.3 * Math.max(1, Math.round(p.num('height') / 0.17)) : 0)],
  build(p) {
    const set = new PartSet();
    const w = p.num('width');
    const d = p.num('depth');
    const h = p.num('height');
    set.add(box(-w / 2, 0, -d / 2, w / 2, h - 0.06, d / 2 - 0.04), { finish: 'paint', color: '#121215', roughness: 0.7 });
    set.add(bevelSlab(-w / 2, h - 0.06, -d / 2, w / 2, h, d / 2, 0.015), mat(p.str('deck')));
    set.add(box(-w / 2, h - 0.12, d / 2 - 0.05, w / 2, h - 0.1, d / 2 - 0.035), mat('brass'));
    set.add(box(-w / 2, 0.0, d / 2 - 0.045, w / 2, 0.1, d / 2 - 0.035), plastic('#08080a', 0.6));
    set.boxMinMax(-w / 2, 0, -d / 2, w / 2, h, d / 2);
    if (p.bool('steps')) {
      const n = Math.max(1, Math.round(h / 0.17));
      const tread = 0.3;
      const steps = new Geom();
      for (let k = 0; k < n; k++) {
        const top = (h * (k + 1)) / (n + 1);
        const z1 = d / 2 + tread * (n - k);
        steps.merge(box(w / 2 - 1.25, 0, d / 2 - 0.04, w / 2 - 0.2, top, z1));
        set.boxMinMax(w / 2 - 1.25, 0, d / 2 - 0.04, w / 2 - 0.2, top, z1);
      }
      set.add(steps, mat(p.str('deck')));
    }
    const ch = p.num('curtainHeight');
    const velvet = { finish: 'velvet' as const, color: p.color('curtainColor') };
    const dark = { finish: 'velvet' as const, color: mixColor(p.color('curtainColor'), '#000000', 0.82) };
    const zc = -d / 2 + 0.35;
    if (p.bool('backdrop')) set.add(pleatedCloth(-w / 2, w / 2, h, h + ch, -d / 2 + 0.08, Math.round(w / 0.3), 0.04, { rows: 2 }), dark);
    const mode = p.str('curtains');
    if (mode !== 'none') {
      const cover = mode === 'closed' ? w / 2 : Math.min(w * 0.22, 2.6);
      for (const s of [-1, 1] as const) {
        const xa = s * (w / 2);
        const xb = s * (w / 2 - cover);
        const x0 = Math.min(xa, xb);
        const x1 = Math.max(xa, xb);
        const folds = Math.max(4, Math.round((x1 - x0) / 0.26));
        set.add(pleatedCloth(x0, x1, h, h + ch - 0.55, zc, folds, 0.07, { rows: 3, hemWave: 0 }), velvet);
      }
      // Valance: a short gathered band with a wavy hem across the top.
      set.add(pleatedCloth(-w / 2, w / 2, h + ch - 0.8, h + ch, zc + 0.08, Math.round(w / 0.35), 0.06, { rows: 2, hemWave: 0.11 }), velvet);
      // Pelmet board and brass tassel line.
      set.add(box(-w / 2, h + ch - 0.04, zc - 0.12, w / 2, h + ch, zc + 0.2), plastic('#0c0c0e', 0.6));
    }
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Speaker
// ---------------------------------------------------------------------------

export const SPEAKER: FurnitureDef = {
  id: 'furn-speaker',
  kind: 'speaker',
  description:
    'Loudspeaker: `variant` cabinet (PA cabinet with a grille, woofer rings and a horn tweeter, 0.45 x 0.75 m), surround (small wall or stand speaker 0.25 x 0.4 m, bracket), column (tall line-array bar 0.12 x 1.4 m) or monitor (stage wedge). Origin on the floor, the front faces +Z; for a wall speaker set y.',
  params: {
    variant: choice(['cabinet', 'surround', 'column', 'monitor'], 'cabinet', 'PA cabinet, small surround, tall column or stage wedge'),
    color: color('#141417', 'cabinet colour'),
    scale: num(1, 0.5, 2, 'overall size multiplier'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.3,
  size: (p) => {
    const s = p.num('scale');
    const v = p.str('variant');
    return v === 'column' ? [0.14 * s, 1.4 * s, 0.14 * s] : v === 'surround' ? [0.26 * s, 0.4 * s, 0.22 * s] : v === 'monitor' ? [0.6 * s, 0.38 * s, 0.4 * s] : [0.46 * s, 0.78 * s, 0.42 * s];
  },
  build(p) {
    const set = new PartSet();
    const s = p.num('scale');
    const v = p.str('variant');
    const body = plastic(p.color('color'), 0.7);
    const grille = { finish: 'brushed-metal' as const, color: '#2b2c30', roughness: 0.6 };
    const cone = plastic('#0a0a0b', 0.5);
    if (v === 'column') {
      const [w, h, d] = [0.14 * s, 1.4 * s, 0.14 * s];
      set.add(roundedBox(w, h, d, 0.012, 2).translate(0, h / 2, 0), body);
      const drivers = new Geom();
      for (let k = 0; k < 8; k++) drivers.merge(cylinder(0.035 * s, 0.035 * s, 0.004, 16).rotateX(90).translate(0, 0.14 * s + k * 0.15 * s, d / 2 + 0.001));
      set.add(drivers, cone);
      set.add(box(-w / 2 + 0.01, 0, -d / 2 + 0.01, w / 2 - 0.01, 0.03, d / 2 - 0.01), plastic('#2a2a2e', 0.5));
      set.boxMinMax(-w / 2, 0, -d / 2, w / 2, h, d / 2);
      return set.build();
    }
    if (v === 'surround') {
      const [w, h, d] = [0.26 * s, 0.4 * s, 0.22 * s];
      set.add(roundedBox(w, h, d, 0.02, 2).translate(0, h / 2, 0), body);
      set.add(new Geom().quadAuto([-w / 2 + 0.02, 0.03, d / 2 + 0.002], [w / 2 - 0.02, 0.03, d / 2 + 0.002], [w / 2 - 0.02, h - 0.03, d / 2 + 0.002], [-w / 2 + 0.02, h - 0.03, d / 2 + 0.002]), grille);
      const dr = new Geom();
      dr.merge(cylinder(0.075 * s, 0.075 * s, 0.006, 24).rotateX(90).translate(0, h * 0.3, d / 2 + 0.006));
      dr.merge(cylinder(0.03 * s, 0.03 * s, 0.006, 20).rotateX(90).translate(0, h * 0.74, d / 2 + 0.006));
      set.add(dr, cone);
      set.add(box(-0.02, h, -0.03, 0.02, h + 0.04, 0.03), plastic('#555559', 0.4));
      set.boxMinMax(-w / 2, 0, -d / 2, w / 2, h, d / 2);
      return set.build();
    }
    if (v === 'monitor') {
      const [w, d] = [0.6 * s, 0.4 * s];
      const wedge = new Geom();
      wedge.merge(prismX([[-d / 2, 0], [d / 2, 0], [d / 2, 0.12 * s], [-d / 2 + 0.05, 0.38 * s], [-d / 2, 0.38 * s]], -w / 2, w / 2));
      set.add(wedge, body);
      const topFace = new Geom().quadAuto([-w / 2 + 0.03, 0.12 * s + 0.002, d / 2 - 0.004], [w / 2 - 0.03, 0.12 * s + 0.002, d / 2 - 0.004], [w / 2 - 0.03, 0.38 * s - 0.03, -d / 2 + 0.06], [-w / 2 + 0.03, 0.38 * s - 0.03, -d / 2 + 0.06]);
      set.add(topFace, grille);
      set.add(cylinder(0.06 * s, 0.06 * s, 0.006, 24).rotateX(64).translate(0, 0.25 * s, 0.05 * s), cone);
      set.boxMinMax(-w / 2, 0, -d / 2, w / 2, 0.38 * s, d / 2);
      return set.build();
    }
    const [w, h, d] = [0.46 * s, 0.78 * s, 0.42 * s];
    set.add(roundedBox(w, h, d, 0.025, 2).translate(0, h / 2, 0), body);
    set.add(new Geom().quadAuto([-w / 2 + 0.025, 0.04, d / 2 + 0.002], [w / 2 - 0.025, 0.04, d / 2 + 0.002], [w / 2 - 0.025, h - 0.04, d / 2 + 0.002], [-w / 2 + 0.025, h - 0.04, d / 2 + 0.002]), grille);
    const dr = new Geom();
    dr.merge(cylinder(0.17 * s, 0.17 * s, 0.01, 28).rotateX(90).translate(0, h * 0.35, d / 2 + 0.008));
    dr.merge(cylinder(0.05 * s, 0.075 * s, 0.03, 20).rotateX(90).translate(0, h * 0.78, d / 2 + 0.014));
    set.add(dr, cone);
    const rings = new Geom();
    rings.merge(ring(0.17 * s, 0.183 * s, 0, 0.012, 28).rotateX(90).translate(0, h * 0.35, d / 2 + 0.014));
    set.add(rings, mat('chrome'));
    for (const sx of [-1, 1] as const) {
      set.add(roundedBox(0.03, 0.06, 0.09, 0.01, 1).translate(sx * (w / 2), h * 0.88, 0), plastic('#202024', 0.5));
    }
    set.boxMinMax(-w / 2, 0, -d / 2, w / 2, h, d / 2);
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Acoustic panels
// ---------------------------------------------------------------------------

export const ACOUSTIC_PANEL: FurnitureDef = {
  id: 'furn-acoustic-panel',
  kind: 'acoustic-panel',
  description:
    'Acoustic wall panel (back on the wall, z = 0, origin at the bottom centre): `variant` fabric (wrapped panel in a bevelled frame, optionally with vertical ribs), slat (timber slats over dark felt) or diffuser (a quadratic-residue diffuser of wells of different depth). Hang rows of them along an auditorium, studio or restaurant wall.',
  params: {
    variant: choice(['fabric', 'slat', 'diffuser'], 'fabric', 'wrapped fabric panel, timber slats or a diffuser'),
    width: num(1.2, 0.3, 4, 'width (m)'),
    height: num(2.4, 0.3, 6, 'height (m)'),
    color: color('#4a2a35', 'fabric colour'),
    wood: choice(['oak', 'walnut', 'ash'], 'walnut', 'slat and frame wood'),
    ribs: flag(true, 'fabric: vertical ribs'),
  },
  mount: 'wall',
  againstWall: true,
  frontClearance: 0,
  size: (p) => [p.num('width'), p.num('height'), 0.09],
  build(p, seed) {
    const set = new PartSet();
    const w = p.num('width');
    const h = p.num('height');
    const v = p.str('variant');
    if (v === 'slat') {
      set.add(box(-w / 2, 0, 0, w / 2, h, 0.025), plastic('#16161a', 0.95));
      const slats = new Geom();
      const pitch = 0.05;
      const n = Math.max(2, Math.floor(w / pitch));
      for (let k = 0; k < n; k++) {
        const x = -w / 2 + pitch * (k + 0.5) - (n * pitch - w) / 2;
        slats.merge(box(x - 0.018, 0.0, 0.025, x + 0.018, h, 0.07));
      }
      set.add(slats, mat(p.str('wood')));
      set.boxMinMax(-w / 2, 0, 0, w / 2, h, 0.07);
      return set.build();
    }
    if (v === 'diffuser') {
      const wood = mat(p.str('wood'));
      const frame = new Geom();
      frame.merge(box(-w / 2, 0, 0, w / 2, 0.025, 0.09));
      frame.merge(box(-w / 2, h - 0.025, 0, w / 2, h, 0.09));
      frame.merge(box(-w / 2, 0.025, 0, -w / 2 + 0.025, h - 0.025, 0.09));
      frame.merge(box(w / 2 - 0.025, 0.025, 0, w / 2, h - 0.025, 0.09));
      set.add(frame, wood);
      // Wells follow a quadratic residue sequence; the fins are the divider walls.
      const cols = Math.max(3, Math.round(w / 0.08));
      const rowsN = Math.max(1, Math.round(h / (w / cols)));
      const cw = (w - 0.05) / cols;
      const ch = (h - 0.05) / rowsN;
      const prime = 7;
      const blocks = new Geom();
      for (let r = 0; r < rowsN; r++) {
        for (let c = 0; c < cols; c++) {
          const depth = 0.015 + (((c + r * 2 + (seed % 3)) ** 2) % prime) * 0.0105;
          blocks.merge(box(-w / 2 + 0.025 + c * cw + 0.004, 0.025 + r * ch + 0.004, 0.0, -w / 2 + 0.025 + (c + 1) * cw - 0.004, 0.025 + (r + 1) * ch - 0.004, depth));
        }
      }
      set.add(blocks, mat(p.str('wood')));
      set.add(box(-w / 2 + 0.025, 0.025, 0, w / 2 - 0.025, h - 0.025, 0.012), plastic('#0f0f12', 0.8));
      set.boxMinMax(-w / 2, 0, 0, w / 2, h, 0.09);
      return set.build();
    }
    // Fabric panel: a bevelled wooden frame behind a fabric face, with ribs.
    set.add(bevelSlab(-w / 2, 0, 0, w / 2, h, 0.06, 0.012), plastic('#18181b', 0.8));
    const face = new Geom();
    face.merge(roundedBox(w - 0.06, h - 0.06, 0.05, 0.018, 2).translate(0, h / 2, 0.055));
    set.add(face, { finish: 'fabric', color: p.color('color') });
    if (p.bool('ribs')) {
      const ribs = new Geom();
      const n = Math.max(2, Math.round(w / 0.15));
      for (let k = 1; k < n; k++) ribs.merge(box(-w / 2 + (w * k) / n - 0.004, 0.05, 0.078, -w / 2 + (w * k) / n + 0.004, h - 0.05, 0.088));
      set.add(ribs, { finish: 'fabric', color: mixColor(p.color('color'), '#000000', 0.35) });
    }
    set.boxMinMax(-w / 2, 0, 0, w / 2, h, 0.085);
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Projection booth window
// ---------------------------------------------------------------------------

export const BOOTH_WINDOW: FurnitureDef = {
  id: 'furn-booth-window',
  kind: 'booth-window',
  description:
    'Projection booth window for the back wall of an auditorium (back at z = 0 on the wall, origin at the bottom centre, mount about 3 m up): a black steel frame with `ports` small glazed apertures; a lit port glows from behind (the projector). Pair with a light beam or a spotlight aimed at the screen.',
  params: {
    ports: int(2, 1, 4, 'number of apertures'),
    lit: flag(true, 'the projector is on: warm light shows in the first port'),
  },
  mount: 'wall',
  againstWall: true,
  frontClearance: 0,
  size: (p) => [0.25 + 0.5 * p.int('ports'), 0.6, 0.08],
  build(p) {
    const set = new PartSet();
    const n = p.int('ports');
    const w = 0.25 + 0.5 * n;
    const h = 0.6;
    const frame = new Geom();
    frame.merge(box(-w / 2, 0, 0, w / 2, 0.08, 0.07));
    frame.merge(box(-w / 2, h - 0.08, 0, w / 2, h, 0.07));
    frame.merge(box(-w / 2, 0.08, 0, -w / 2 + 0.08, h - 0.08, 0.07));
    frame.merge(box(w / 2 - 0.08, 0.08, 0, w / 2, h - 0.08, 0.07));
    const glass = new Geom();
    const lit = new Geom();
    const pw = 0.4;
    for (let k = 0; k < n; k++) {
      const cx = -w / 2 + 0.125 + 0.25 + k * 0.5 - 0.0;
      const x0 = cx - pw / 2 + 0.05;
      const x1 = cx + pw / 2 - 0.05;
      if (k > 0) frame.merge(box(cx - pw / 2 - 0.045, 0.08, 0, cx - pw / 2 + 0.005, h - 0.08, 0.07));
      const q = new Geom().quadAuto([x0, 0.13, 0.04], [x1, 0.13, 0.04], [x1, h - 0.13, 0.04], [x0, h - 0.13, 0.04]);
      (k === 0 && p.bool('lit') ? lit : glass).merge(q);
    }
    set.add(frame, plastic('#0c0c0e', 0.5));
    set.add(glass, { finish: 'glass', color: '#1b222b', opacity: 0.55 });
    set.add(lit, EMISSIVE('#fff0cf', 3.2));
    set.boxMinMax(-w / 2, 0, 0, w / 2, h, 0.07);
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Step light
// ---------------------------------------------------------------------------

export const STEP_LIGHT: FurnitureDef = {
  id: 'furn-step-light',
  kind: 'step-light',
  description:
    'Aisle step light: a small recessed LED marker with a metal plate and a warm glowing slot, set in a riser or the side of a seat standard; `variant` wall (flat plate, 0.14 x 0.05 m, back at z = 0) or bollard (low post 0.3 m). Cheap: place dozens as one scatter along an aisle.',
  params: {
    variant: choice(['wall', 'bollard'], 'wall', 'flat marker on a riser or wall, or a low post'),
    color: color('#ffb15e', 'light colour'),
    glow: num(4, 0.5, 10, 'emissive strength'),
  },
  mount: 'wall',
  againstWall: true,
  frontClearance: 0,
  size: (p) => (p.str('variant') === 'bollard' ? [0.1, 0.3, 0.1] : [0.14, 0.05, 0.02]),
  build(p) {
    const set = new PartSet();
    const c = p.color('color');
    if (p.str('variant') === 'bollard') {
      set.add(cylinder(0.045, 0.05, 0.28, 12).translate(0, 0, 0), mat('black-metal'));
      set.add(cylinder(0.04, 0.04, 0.03, 12).translate(0, 0.27, 0), EMISSIVE(c, p.num('glow')));
      set.add(cylinder(0.05, 0.05, 0.012, 12).translate(0, 0.298, 0), mat('black-metal'));
      set.boxMinMax(-0.05, 0, -0.05, 0.05, 0.3, 0.05);
      return set.build();
    }
    set.add(box(-0.07, 0, 0, 0.07, 0.05, 0.012), mat('brushed-metal'));
    set.add(box(-0.052, 0.015, 0.011, 0.052, 0.035, 0.016), EMISSIVE(c, p.num('glow')));
    set.boxMinMax(-0.07, 0, 0, 0.07, 0.05, 0.016);
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Lectern
// ---------------------------------------------------------------------------

export const LECTERN: FurnitureDef = {
  id: 'furn-lectern',
  kind: 'lectern',
  description:
    'Lectern / podium / pulpit: `variant` lectern (tapered timber stand with a sloped reading desk, lip, panel inlay and a gooseneck microphone), podium (lower speaker block with a front panel) or pulpit (church: raised octagonal pulpit with a book ledge and a bible). Front (the speaker faces the audience) toward +Z.',
  params: {
    variant: choice(['lectern', 'podium', 'pulpit'], 'lectern', 'speaker stand, low podium or church pulpit'),
    wood: choice(['oak', 'walnut', 'ash'], 'walnut', 'timber'),
    mic: flag(true, 'gooseneck microphone'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 1,
  size: (p) => (p.str('variant') === 'pulpit' ? [0.9, 1.5, 0.9] : p.str('variant') === 'podium' ? [0.7, 1.05, 0.55] : [0.62, 1.25, 0.5]),
  build(p) {
    const set = new PartSet();
    const v = p.str('variant');
    const wood = mat(p.str('wood'));
    if (v === 'pulpit') {
      // Octagonal drum on a plinth, a book ledge and a bible.
      const r = 0.42;
      const oct: P2[] = Array.from({ length: 8 }, (_, k): P2 => [Math.cos(((k + 0.5) / 8) * Math.PI * 2) * r, Math.sin(((k + 0.5) / 8) * Math.PI * 2) * r]);
      const drum = new Geom();
      drum.merge(cylinder(r * 0.92, r * 0.92, 0.12, 8).translate(0, 0, 0));
      drum.merge(cylinder(r * 0.78, r * 0.95, 1.0, 8).translate(0, 0.12, 0));
      drum.merge(cylinder(r * 1.04, r * 1.04, 0.07, 8).translate(0, 1.12, 0));
      set.add(drum, wood);
      const panels = new Geom();
      for (let k = 0; k < 8; k++) {
        const a = ((k + 0.5) / 8) * Math.PI * 2 + Math.PI / 8;
        panels.merge(box(-0.14, 0.38, 0.0, 0.14, 0.95, 0.012).translate(0, 0, r * 0.88).rotateY((-a * 180) / Math.PI + 90 + 22.5));
      }
      set.add(panels, mat(p.str('wood') === 'oak' ? 'walnut' : 'oak'));
      set.add(roundedBox(0.54, 0.03, 0.36, 0.01, 1).rotateX(-14).translate(0, 1.27, 0.18), wood);
      set.add(box(-0.3, 1.2, 0.0, 0.3, 1.26, 0.05).translate(0, 0, 0.0), wood);
      set.add(roundedBox(0.3, 0.05, 0.22, 0.008, 1).rotateX(-14).translate(0, 1.31, 0.17), { finish: 'leather', color: '#2a1612' });
      set.boxMinMax(-r, 0, -r, r, 1.15, r);
      return set.build();
    }
    const [w, d, h] = v === 'podium' ? [0.7, 0.55, 1.05] : [0.62, 0.5, 1.15];
    const body = new Geom();
    // Tapered stand whose top slopes down towards the speaker (-Z), with a plinth.
    body.merge(prismX([[-d / 2 + 0.02, 0.05], [d / 2 - 0.03, 0.05], [d / 2 - 0.02, h - 0.02], [-d / 2 + 0.03, h - 0.16]], -w / 2 + 0.02, w / 2 - 0.02));
    body.merge(box(-w / 2, 0, -d / 2, w / 2, 0.06, d / 2));
    set.add(body, wood);
    const desk = new Geom();
    desk.merge(prismX([[-d / 2 - 0.02, h - 0.17], [d / 2 + 0.03, h - 0.03], [d / 2 + 0.03, h + 0.01], [-d / 2 - 0.02, h - 0.13]], -w / 2, w / 2));
    // Lip on the speaker's side keeps the papers from sliding off.
    desk.merge(box(-w / 2 + 0.03, h - 0.14, -d / 2 - 0.045, w / 2 - 0.03, h - 0.1, -d / 2 - 0.02));
    set.add(desk, mat(p.str('wood') === 'oak' ? 'walnut' : p.str('wood') === 'walnut' ? 'oak' : 'walnut'));
    // Front panel inlay.
    set.add(box(-w / 2 + 0.1, 0.18, d / 2 - 0.062, w / 2 - 0.1, h - 0.34, d / 2 - 0.05), mat(p.str('wood') === 'oak' ? 'walnut' : 'oak'));
    if (p.bool('mic') && v !== 'pulpit') {
      const g = new Geom();
      g.merge(cylinder(0.03, 0.03, 0.012, 16).translate(w * 0.2, h - 0.08, -0.04));
      g.merge(cylinder(0.005, 0.005, 0.2, 8).translate(w * 0.2, h - 0.07, -0.04));
      g.merge(roundedBox(0.03, 0.08, 0.03, 0.012, 2).rotateX(55).translate(w * 0.2, h + 0.15, -0.09));
      set.add(g, mat('chrome'));
    }
    set.boxMinMax(-w / 2, 0, -d / 2, w / 2, h, d / 2);
    return set.build();
  },
};

/** Venue pieces for auditoriums, theatres and halls. */
export const VENUE: readonly FurnitureDef[] = [CINEMA_SEAT, TIER_STEPS, CINEMA_SCREEN, STAGE, SPEAKER, ACOUSTIC_PANEL, BOOTH_WINDOW, STEP_LIGHT, LECTERN];
