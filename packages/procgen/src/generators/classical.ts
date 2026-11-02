/**
 * Classical and Mediterranean pieces: columns in the orders, temples and a round tholos, balustrades, an aqueduct arcade,
 * a cliff face, a bronze brazier, amphorae, banners and awnings. Surfaces use the photographed finishes (marble, stone,
 * roof tile, rock, brass, ceramic, fabric) tinted by the colour params, not flat vertex colours.
 */
import type { MaterialSpec, Vec3 } from '@aether/core';
import type { InternalApi } from '../api';
import type { Mesh } from '../kernel/mesh';
import type { SdfNode } from '../types';
import type { RGB } from '../color';
import { boxCollider, cylinderCollider } from '../colliders';
import { buildCliff } from './cliff';
import { buildTemple } from './temple';
import { defineGenerator, glow, pBool, pColor, pInt, pNum, pVariant } from './kit';

// Weathered marble reads as a pale, finely textured stone at building scale (the polished-marble finish is too veiny).
const marble = (color: string): MaterialSpec => ({ finish: 'plaster', color, roughness: 0.6 });
const stone = (color: string): MaterialSpec => ({ finish: 'stone', color, roughness: 0.85 });
const roofTile = (color: string): MaterialSpec => ({ finish: 'roof-tile', color, roughness: 0.8 });
const BRONZE: MaterialSpec = { finish: 'brass', color: '#8a5a2e', roughness: 0.5, metalness: 0.9 };
const IRON: MaterialSpec = { finish: 'black-metal', color: '#2a2a2c', roughness: 0.55, metalness: 0.8 };

type Order = 'doric' | 'ionic' | 'tuscan';

/** One column standing on y = 0: optional base, an entasis shaft (fluted unless tuscan), the order's capital. */
function column(api: InternalApi, h: number, r: number, order: Order, segs: number, broken = 1): Mesh {
  const top = h * broken;
  const shaftTop = Math.min(top, h * 0.9);
  const base0 = order === 'doric' ? 0 : h * 0.05;
  const shaft = api.lathe([[r, base0], [r * 0.985, base0 + (shaftTop - base0) * 0.33], [r * 0.84, shaftTop], [0, shaftTop]], segs);
  if (order !== 'tuscan') {
    const flutes = segs / 2;
    shaft.displace((x, y, z) => (y > base0 + 0.05 && y < shaftTop - 0.02 ? -r * 0.055 * (0.5 + 0.5 * Math.cos(Math.atan2(z, x) * flutes)) : 0));
  }
  let m: Mesh = shaft;
  if (order !== 'doric') m = m.merge(api.lathe([[r * 1.32, 0], [r * 1.32, h * 0.015], [r * 1.18, h * 0.03], [r * 1.05, h * 0.05], [0, h * 0.05]], segs));
  if (broken < 1) return m;
  if (order === 'ionic') {
    m = m.merge(api.box(r * 2.4, h * 0.035, r * 2.0).translate(0, h * 0.94, 0));
    for (const s of [-1, 1]) m = m.merge(api.cylinder(r * 0.3, r * 0.3, r * 2.0, 10).rotate(90, 0, 0).translate(s * r * 1.05, h * 0.9, 0));
    m = m.merge(api.lathe([[r * 0.84, h * 0.9], [r * 1.05, h * 0.92], [0, h * 0.92]], segs));
  } else {
    m = m.merge(api.lathe([[r * 0.84, h * 0.9], [r * 1.12, h * 0.945], [r * 1.18, h * 0.96], [0, h * 0.96]], segs));
    m = m.merge(api.box(r * 2.5, h * 0.04, r * 2.5).translate(0, h * 0.98, 0));
  }
  return m;
}

const ORDERS: readonly Order[] = ['doric', 'ionic', 'tuscan'];

const columnGen = defineGenerator({
  id: 'column',
  description: 'Classical column: fluted shaft with entasis and the capital of its order (doric, ionic, tuscan) or a broken ruin.',
  category: 'architecture',
  params: {
    height: pNum(7, 1.5, 20, 'column height in meters'),
    radius: pNum(0, 0, 1.5, 'shaft radius in meters (0 = classical proportion, height / 11)'),
    color: pColor('#ece5d8', 'marble colour'),
    pedestal: pBool(false, 'stand on a square pedestal'),
    variant: pVariant(3, '0 doric, 1 ionic, 2 tuscan (plain), 3 broken ruin'),
  },
  run(p, api) {
    const h = p.num('height');
    const r = p.num('radius') > 0 ? p.num('radius') : h / 11;
    const v = p.int('variant');
    const ped = p.bool('pedestal') ? h * 0.18 : 0;
    const m = column(api, h, r, v === 3 ? 'doric' : (ORDERS[v] as Order), 20, v === 3 ? api.range(0.35, 0.7) : 1).translate(0, ped, 0);
    if (ped > 0) m.merge(api.box(r * 2.8, ped, r * 2.8).translate(0, ped / 2, 0));
    api.add(m, marble(p.color('color')));
    api.collider(cylinderCollider(0, (h + ped) / 2, 0, r * 1.1, h + ped));
    return api.build();
  },
});

const temple = defineGenerator({
  id: 'classical-temple',
  description: 'Greek temple in white-gold marble: a three-step crepidoma, fluted Doric or Ionic columns with entasis, a full entablature (triglyphs and metopes with gilded shields, or a sculpted Ionic frieze; cornice with mutules or dentils), pediments with a relief sculpture group, gilded acroteria, a tiled roof with antefixes, a cella with porches; tholos and ruin variants.',
  category: 'architecture',
  params: {
    width: pNum(16, 6, 40, 'front width in meters (tholos: diameter)'),
    length: pNum(30, 8, 70, 'depth front to back in meters'),
    height: pNum(8, 3, 16, 'column height in meters'),
    columns: pInt(6, 4, 10, 'columns across the front'),
    color: pColor('#ece4d6', 'marble colour'),
    roofColor: pColor('#a8553a', 'roof tile colour'),
    accentColor: pColor('#c9a24a', 'gilding on the acroteria, frieze shields and pediment figures'),
    variant: pVariant(3, '0 doric, 1 ionic, 2 round tholos, 3 ruined doric (broken columns, no roof)'),
  },
  run(p, api) {
    buildTemple(api, {
      variant: p.int('variant'),
      width: p.num('width'),
      length: p.num('length'),
      height: p.num('height'),
      columns: p.int('columns'),
      color: p.color('color'),
      roofColor: p.color('roofColor'),
      accentColor: p.color('accentColor'),
    });
    return api.build();
  },
});

const balustrade = defineGenerator({
  id: 'balustrade',
  description: 'Balustrade or railing along an edge: stone balusters under a rail, wrought iron bars, or a solid parapet with coping.',
  category: 'architecture',
  params: {
    length: pNum(6, 0.6, 30, 'length in meters (runs along X)'),
    height: pNum(1, 0.5, 1.6, 'height in meters'),
    color: pColor('#e3dccd', 'stone colour (iron variant: metal colour)'),
    variant: pVariant(2, '0 stone balusters, 1 wrought iron railing, 2 solid parapet'),
  },
  run(p, api) {
    const Lg = p.num('length');
    const h = p.num('height');
    const v = p.int('variant');
    if (v === 1) {
      const iron: MaterialSpec = { ...IRON, color: p.color('color') === '#e3dccd' ? '#262628' : p.color('color') };
      api.add(api.box(Lg, 0.05, 0.06).translate(0, h - 0.025, 0), iron);
      api.add(api.box(Lg, 0.03, 0.04).translate(0, 0.1, 0), iron);
      const n = Math.min(120, Math.round(Lg / 0.12));
      for (let i = 0; i <= n; i++) api.add(api.box(0.018, h - 0.12, 0.018).translate(-Lg / 2 + (i / n) * Lg, h / 2, 0), iron);
      for (let x = -Lg / 2; x <= Lg / 2 + 1e-6; x += Math.max(1.2, Lg / Math.ceil(Lg / 2))) api.add(api.box(0.05, h, 0.05).translate(x, h / 2, 0), iron);
    } else {
      const mat = stone(p.color('color'));
      api.add(api.box(Lg, h * 0.14, 0.32).translate(0, h * 0.07, 0), mat);
      api.add(api.box(Lg + 0.06, h * 0.12, 0.36).translate(0, h - h * 0.06, 0), mat);
      if (v === 2) api.add(api.box(Lg - 0.02, h * 0.76, 0.26).translate(0, h * 0.52, 0), mat);
      else {
        const n = Math.min(36, Math.max(2, Math.round(Lg / 0.3)));
        const bh = h * 0.74;
        const vase: Array<[number, number]> = [[0.06, 0], [0.06, bh * 0.08], [0.1, bh * 0.35], [0.06, bh * 0.62], [0.045, bh * 0.8], [0.065, bh * 0.92], [0.065, bh], [0, bh]];
        for (let i = 0; i < n; i++) api.add(api.lathe(vase, 8).translate(-Lg / 2 + (i + 0.5) * (Lg / n), h * 0.14, 0), mat);
      }
    }
    api.collider(boxCollider(0, h / 2, 0, Lg, h, 0.3));
    return api.build();
  },
});

const aqueduct = defineGenerator({
  id: 'aqueduct',
  description: 'Roman aqueduct: tiers of stone arches on piers carrying a water channel along the top; spans gorges and valleys.',
  category: 'architecture',
  params: {
    length: pNum(60, 10, 200, 'length in meters (runs along X)'),
    height: pNum(24, 6, 60, 'height in meters'),
    color: pColor('#cdbb9c', 'stone colour'),
    water: pBool(true, 'flowing water in the channel on top'),
    variant: pVariant(2, '0 one tier, 1 two tiers, 2 three tiers (lower tiers wider)'),
  },
  run(p, api) {
    const Lg = p.num('length');
    const H = p.num('height');
    const tiers = p.int('variant') + 1;
    const mat = stone(p.color('color'));
    const channel = 1.6;
    const tierH = (H - channel) / tiers;
    let y = 0;
    for (let t = 0; t < tiers; t++) {
      const th = tierH * (t === 0 && tiers > 1 ? 1.25 : tiers > 1 ? 0.88 : 1);
      const span = Math.min(th * 0.62, 18);
      const bays = Math.max(2, Math.round(Lg / span));
      const bw = Lg / bays;
      const pier = bw * 0.24;
      const depth = Math.max(2.2, 3.4 - t * 0.6);
      const rA = (bw - pier) / 2;
      const spring = y + th - rA - th * 0.12;
      for (let b = 0; b < bays; b++) {
        const x0 = -Lg / 2 + b * bw;
        // A bay: the pier on its left up to the springing line, then the arch spandrel as one extruded outline.
        const shape: Array<[number, number]> = [[x0, spring - y]];
        const cx = x0 + bw / 2;
        for (let k = 0; k <= 10; k++) {
          const a = Math.PI - (k / 10) * Math.PI;
          shape.push([cx + Math.cos(a) * rA, spring - y + Math.sin(a) * rA]);
        }
        shape.push([x0 + bw, spring - y], [x0 + bw, th], [x0, th]);
        api.add(api.extrude(shape, depth).translate(0, y, 0), mat);
        api.add(api.box(pier, spring - y, depth).translate(x0, y + (spring - y) / 2, 0), mat);
      }
      api.add(api.box(pier, spring - y, depth).translate(Lg / 2, y + (spring - y) / 2, 0), mat);
      y += th;
    }
    // The channel: a floor and two side walls, with water in it.
    api.add(api.box(Lg, 0.5, 2.4).translate(0, y + 0.25, 0), mat);
    for (const s of [-1, 1]) api.add(api.box(Lg, channel - 0.5, 0.35).translate(0, y + 0.5 + (channel - 0.5) / 2, s * 1.02), mat);
    if (p.bool('water')) api.add(api.box(Lg - 0.1, 0.06, 1.65).translate(0, y + 0.9, 0), { preset: 'water', color: '#4f9aa0', waterKind: 'stream', waterFlow: [1.2, 0] });
    api.collider(boxCollider(0, y / 2, 0, Lg, y, 2.4));
    return api.build();
  },
});

const cliffFace = defineGenerator({
  id: 'cliff-face',
  description: 'Cliff face: a sheer pale limestone wall in strata of varying thickness, with ledges, overhangs, gullies and joints, an uneven top and water-stained streaks (thin-bedded, massive or overhanging); backs plateaus, gorges and coasts. Faces +Z.',
  category: 'terrain',
  params: {
    width: pNum(30, 4, 120, 'width in meters'),
    height: pNum(30, 4, 120, 'height in meters'),
    depth: pNum(8, 2, 40, 'solid thickness behind the face in meters'),
    color: pColor('#cfc4ad', 'rock colour (pale limestone by default; beds and streaks vary around it)'),
    variant: pVariant(2, '0 thin-bedded limestone with many ledges, 1 massive jointed limestone with deep gullies, 2 overhanging'),
  },
  run(p, api) {
    const W = p.num('width');
    const H = p.num('height');
    const D = p.num('depth');
    buildCliff(api, { width: W, height: H, depth: D, color: p.color('color'), variant: p.int('variant') });
    api.collider(boxCollider(0, H / 2, -D / 2, W, H, D));
    return api.build();
  },
});

const brazier = defineGenerator({
  id: 'brazier',
  description: 'Bronze brazier: a tripod or pedestal bowl of glowing coals; give the entity vfx fire for the flame.',
  category: 'props',
  params: {
    height: pNum(1.2, 0.5, 3, 'height in meters'),
    color: pColor('#8a5a2e', 'bronze colour'),
    lit: pBool(true, 'glowing coals in the bowl'),
    variant: pVariant(1, '0 tripod legs, 1 stone pedestal'),
  },
  run(p, api) {
    const h = p.num('height');
    const bronze: MaterialSpec = { ...BRONZE, color: p.color('color') };
    const R = h * 0.32;
    const bowl = api.lathe([[0, h * 0.78], [R * 0.6, h * 0.8], [R, h * 0.92], [R * 1.05, h], [R * 0.95, h], [0, h * 0.95]], 20);
    api.add(bowl, bronze);
    if (p.int('variant') === 0) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const path: Vec3[] = [[Math.cos(a) * R * 0.9, 0, Math.sin(a) * R * 0.9], [Math.cos(a) * R * 0.5, h * 0.45, Math.sin(a) * R * 0.5], [Math.cos(a) * R * 0.55, h * 0.82, Math.sin(a) * R * 0.55]];
        api.add(api.tube(path, h * 0.022, 6), bronze);
      }
    } else {
      api.add(api.lathe([[R * 0.7, 0], [R * 0.7, h * 0.08], [R * 0.32, h * 0.16], [R * 0.25, h * 0.6], [R * 0.45, h * 0.78], [0, h * 0.78]], 16), { finish: 'stone', color: '#d9d2c4', roughness: 0.8 });
    }
    if (p.bool('lit')) api.add(api.cylinder(R * 0.85, R * 0.85, 0.04, 16).translate(0, h * 0.96, 0), glow('#ff6a1a', 3));
    api.collider(cylinderCollider(0, h / 2, 0, R, h));
    return api.build();
  },
});

const amphora = defineGenerator({
  id: 'amphora',
  description: 'Terracotta vessel: a two-handled amphora, a wide krater urn or a big pithos storage jar; groups in storerooms, gardens, quays.',
  category: 'props',
  params: {
    height: pNum(0.9, 0.2, 2.5, 'height in meters'),
    color: pColor('#b5683e', 'clay colour'),
    variant: pVariant(2, '0 amphora (pointed foot, two handles), 1 krater urn, 2 pithos jar'),
  },
  run(p, api) {
    const h = p.num('height');
    const v = p.int('variant');
    const mat: MaterialSpec = { finish: 'ceramic', color: p.color('color'), roughness: 0.7 };
    const prof: Array<[number, number]> =
      v === 0 ? [[0, 0], [0.04, 0.02], [0.16, 0.25], [0.21, 0.5], [0.17, 0.72], [0.07, 0.82], [0.065, 0.97], [0.085, 1], [0, 1]]
        : v === 1 ? [[0, 0], [0.16, 0], [0.12, 0.08], [0.18, 0.3], [0.32, 0.72], [0.36, 0.9], [0.4, 1], [0, 1]]
          : [[0, 0], [0.18, 0], [0.32, 0.25], [0.35, 0.55], [0.28, 0.85], [0.16, 0.95], [0.18, 1], [0, 1]];
    api.add(api.lathe(prof.map(([r, y]) => [r * h, y * h] as [number, number]), 22), mat);
    if (v === 0 || v === 1) {
      for (const s of [-1, 1]) {
        const y0 = v === 0 ? 0.68 : 0.75, y1 = v === 0 ? 0.92 : 0.95, out = v === 0 ? 0.2 : 0.42;
        api.add(api.tube([[s * 0.07 * h, y1 * h, 0], [s * out * h, (y1 + 0.02) * h, 0], [s * (out - 0.02) * h, y0 * h, 0]], h * 0.018, 6), mat);
      }
    }
    api.collider(cylinderCollider(0, h / 2, 0, h * (v === 0 ? 0.2 : 0.34), h));
    return api.build();
  },
});

const banner = defineGenerator({
  id: 'banner',
  description: 'Cloth banner with a border and round emblem: hung from a crossbar, flown from a pole, or draped down a wall. Faces +Z.',
  category: 'props',
  params: {
    width: pNum(1.4, 0.3, 8, 'cloth width in meters'),
    height: pNum(3.5, 0.5, 16, 'cloth height in meters'),
    color: pColor('#1d3463', 'cloth colour'),
    trimColor: pColor('#d4a93a', 'border and emblem colour'),
    variant: pVariant(2, '0 hanging from a crossbar, 1 flag on a pole, 2 wall drape (no bar)'),
  },
  run(p, api) {
    const w = p.num('width');
    const h = p.num('height');
    const v = p.int('variant');
    const cloth = p.color('color');
    const trim = p.color('trimColor');
    const pole = v === 1 ? Math.max(3, h * 1.6) : 0;
    const flag = v === 1;
    const cw = flag ? h : w, ch = flag ? w : h;
    const sheet = api.plane(cw, ch, 8, 12).rotate(90, 0, 0);
    // Soft vertical folds, deeper toward the free edge; a flag ripples along its length.
    sheet.warp((x, y, z) => {
      const along = flag ? (x + cw / 2) / cw : (ch / 2 - y) / ch;
      return [x, y, z + Math.sin((flag ? x : x) * (flag ? 2.2 : 5.5) / Math.max(0.6, cw * 0.4)) * 0.06 * (0.3 + along) * Math.min(1.5, cw)];
    });
    sheet.vertexColor((x, y) => {
      const ex = Math.min(x + cw / 2, cw / 2 - x), ey = Math.min(y + ch / 2, ch / 2 - y);
      const emblem = Math.hypot(x, y - (flag ? 0 : ch * 0.12)) < Math.min(cw, ch) * 0.22;
      return ex < cw * 0.07 || ey < ch * 0.035 || emblem ? trim : cloth;
    });
    const top = flag ? pole - ch / 2 : ch / 2 + (v === 0 ? 0.1 : 0);
    sheet.translate(flag ? cw / 2 + 0.05 : 0, top, 0.02);
    api.add(sheet, { finish: 'fabric', color: '#ffffff', vertexColors: true, doubleSided: true, roughness: 0.95 });
    if (v === 0) api.add(api.cylinder(0.035, 0.035, w + 0.3, 8).rotate(0, 0, 90).translate(0, ch + 0.1, 0.02), { ...BRONZE, color: trim });
    if (flag) {
      api.add(api.cylinder(0.05, 0.065, pole, 10).translate(0, pole / 2, 0), { finish: 'oak', color: '#6b5440', roughness: 0.7 });
      api.add(api.sphere(0.09).translate(0, pole + 0.08, 0), { ...BRONZE, color: trim });
      api.collider(cylinderCollider(0, pole / 2, 0, 0.07, pole));
    }
    return api.build();
  },
});

const awning = defineGenerator({
  id: 'awning',
  description: 'Shop or café awning: striped fabric sloping out from a wall over a door or window, scalloped valance, iron arms. Wall at -Z.',
  category: 'props',
  params: {
    width: pNum(3, 1, 12, 'width in meters'),
    depth: pNum(1.6, 0.6, 4, 'how far it projects from the wall in meters'),
    color: pColor('#b8312f', 'main stripe colour'),
    stripeColor: pColor('#f1ebdd', 'second stripe colour'),
    variant: pVariant(2, '0 striped, 1 plain, 2 flat canvas sail (no slope)'),
  },
  run(p, api) {
    const W = p.num('width');
    const D = p.num('depth');
    const v = p.int('variant');
    const drop = v === 2 ? 0.05 : D * 0.45;
    const a = p.color('color'), b = p.color('stripeColor');
    const stripes = Math.max(3, Math.round(W / 0.32));
    const canopy = api.plane(W, D, stripes * 2, 4).translate(0, 0, D / 2);
    canopy.warp((x, y, z) => [x, -drop * (z / D) + Math.sin((z / D) * Math.PI) * 0.04, z]);
    const paint = (x: number): string => (v === 1 ? a : Math.floor(((x + W / 2) / W) * stripes) % 2 === 0 ? a : b);
    canopy.vertexColor((x) => paint(x - 1e-4));
    const fab: MaterialSpec = { finish: 'fabric', color: '#ffffff', vertexColors: true, doubleSided: true, roughness: 0.95 };
    api.add(canopy, fab);
    if (v !== 2) {
      const val = api.plane(W, 0.24, stripes * 2, 1).rotate(90, 0, 0).translate(0, -drop - 0.12, D);
      val.vertexColor((x) => paint(x - 1e-4));
      val.warp((x, y, z) => [x, y < -drop - 0.15 ? y + 0.06 * (1 - Math.abs(Math.cos(((x + W / 2) / (W / stripes)) * Math.PI))) : y, z]);
      api.add(val, fab);
      for (const s of [-1, 1]) api.add(api.tube([[s * (W / 2 - 0.05), -drop - 0.6, 0], [s * (W / 2 - 0.05), -drop, D]], 0.02, 6), IRON);
    }
    api.add(api.box(W + 0.1, 0.12, 0.1).translate(0, 0, 0.05), IRON);
    return api.build();
  },
});

/** Cell size of the carved figure in metres of its nominal 2 m frame: ≈ 12k triangles for small statues, ≈ 25k for a colossus. */
const FIGURE_CELL_SMALL = 0.032;
const FIGURE_CELL_LARGE = 0.022;
/** Skull centre and crown height of the figures below (nominal 2 m frame, head turned straight ahead). */
const SKULL: Vec3 = [-0.03, 1.86, -0.03];
const CROWN_Y = 1.965;

/**
 * Pose of the carved figure in its nominal 2 m frame (sole y = 0, facing +Z, its right side -X; angles in degrees).
 * Variant 0 is the Athena type: weight on the right leg, the right fist raised round a tall spear, the left hand
 * resting on the rim of a great shield standing at her side, a belted peplos with an overfold falling in deep vertical
 * folds, and a crested Attic helmet carved with the head. Variant 1 is a robed figure with both arms raised.
 */
function figureStatuePose(variant: number, seed: number): SdfNode {
  if (variant === 0) {
    const [hx, hy, hz] = SKULL;
    const helmet: SdfNode = {
      op: 'union', k: 0.012,
      items: [
        // the bowl, cut level just above the brow
        { op: 'intersect', items: [
          { shape: 'ellipsoid', r: [0.13, 0.13, 0.15], at: [hx, hy + 0.01, hz - 0.006] },
          { shape: 'box', size: [0.4, 0.2, 0.4], at: [hx, hy + 0.11, hz] },
        ] },
        // the brow band and the peak over the forehead
        { shape: 'ellipsoid', r: [0.118, 0.02, 0.07], at: [hx, hy + 0.018, hz + 0.09], rot: [-14, 0, 0] },
        // the neck guard flaring at the back, the cheek-piece hinges at the temples
        { shape: 'ellipsoid', r: [0.115, 0.055, 0.04], at: [hx, hy - 0.015, hz - 0.115], rot: [22, 0, 0] },
        { shape: 'ellipsoid', r: [0.02, 0.05, 0.04], at: [hx - 0.112, hy - 0.005, hz + 0.02] },
        { shape: 'ellipsoid', r: [0.02, 0.05, 0.04], at: [hx + 0.112, hy - 0.005, hz + 0.02] },
        // the crest holder along the ridge
        { shape: 'box', size: [0.036, 0.05, 0.22], round: 0.012, at: [hx, CROWN_Y + 0.045, hz - 0.01] },
      ],
    };
    const figure: SdfNode = {
      shape: 'figure', sex: 'f', seed, garment: 'peplos', weight: 'R', hair: 'wavy',
      hip: { roll: 2.9 }, head: { yaw: 0, pitch: 5 },
      armR: { wrist: [-0.38, 1.47, 0.08], pole: [-0.5, -1, -0.45], fingers: [0.1, 0.05, 1], dorsal: [-1, 0, 0.1], curl: [72, 77, 52], thumbCurl: 0.9, spread: 0 },
      armL: { wrist: [0.42, 1.08, 0.04], pole: [0.6, -0.2, -1], fingers: [0.1, -1, 0.1], dorsal: [1, 0, 0], curl: [30, 35, 25] },
      drape: { mantle: false, belt: true, overfold: true, folds: 18, foldAmp: 0.05, fine: 0.12, wide: 0.02, overAmp: 1.4 },
    };
    return { op: 'union', items: [figure, helmet] };
  }
  return {
    shape: 'figure', sex: 'f', seed, garment: 'chiton', weight: 'L', hair: 'wavy',
    hip: { roll: -2.9 }, head: { yaw: 0, pitch: 0 },
    armR: { wrist: [-0.3, 2.0, 0.16], pole: [-1, 0, -0.3], fingers: [0, 1, 0.1] },
    armL: { wrist: [0.3, 2.0, 0.16], pole: [1, 0, -0.3], fingers: [0, 1, 0.1] },
    drape: { mantle: false, folds: 24, foldAmp: 0.03, wide: 0.015 },
  };
}

const figureStatue = defineGenerator({
  id: 'figure-statue',
  description: 'Carved classical marble figure at any scale (life size to a 30 m colossus) on a moulded pedestal: a helmeted goddess (Athena type) with a raised spear and a great round shield at her side, or a robed figure with raised arms. Weathered, faintly veined marble with gilded accents.',
  category: 'props',
  params: {
    height: pNum(3, 1, 40, 'figure height in meters (feet to crown)'),
    color: pColor('#ece5d8', 'marble colour (#b08d57 for bronze)'),
    accentColor: pColor('#c9a24a', 'spear tip, shield rim and helmet crest (gilded)'),
    pedestal: pBool(true, 'stand on a stepped pedestal'),
    variant: pVariant(1, '0 goddess with helmet, spear and shield, 1 robed figure with raised arms'),
  },
  run(p, api) {
    const H = p.num('height');
    const v = p.int('variant');
    const s = H / 2; // the figure is carved at a nominal 2 m
    const color = p.color('color');
    // Vertex colours carry the weathering; the plaster finish gives the fine grain of the stone.
    const mat: MaterialSpec = { finish: 'plaster', color, roughness: 0.55, vertexColors: true };
    const gold: MaterialSpec = { finish: 'brass', color: p.color('accentColor'), roughness: 0.32, metalness: 0.95 };
    const ped = p.bool('pedestal') ? H * 0.16 : 0;
    const seed = 100 + Math.floor(api.rng() * 1000);

    const fig = api.sdf(figureStatuePose(v, seed), { cell: H >= 6 ? FIGURE_CELL_LARGE : FIGURE_CELL_SMALL, smooth: 1, project: 1 });
    const y0 = ped - fig.bounds().min[1] * s; // the feet on the pedestal
    const at = (x: number, y: number, z: number): Vec3 => [x * s, y * s + y0, z * s];
    fig.scale(s).translate(0, y0, 0);
    const marbleParts: Mesh[] = [fig];
    const [hx, , hz] = SKULL;

    if (v === 0) {
      // Gilded crest sweeping from the brow over the helmet and down the back as a horsehair tail.
      const crest = api.tube([[0, CROWN_Y + 0.03, 0.12], [0, CROWN_Y + 0.15, 0.05], [0, CROWN_Y + 0.18, -0.07], [0, CROWN_Y + 0.11, -0.19], [0, CROWN_Y - 0.03, -0.25], [0, CROWN_Y - 0.24, -0.24]], 0.06, 10, (t) => 0.5 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.4)) - 0.3 * t);
      crest.scale(0.4, 1, 1).translate(hx, 0, hz - 0.01).scale(s).translate(0, y0, 0);
      api.add(crest, gold);
      // Tall spear through the raised fist: bronze shaft, gilded leaf blade and butt spike.
      const bronze: MaterialSpec = { finish: 'brass', color: '#6d5532', roughness: 0.55, metalness: 0.8 };
      const sx = -0.338, sz = 0.154;
      api.add(api.limb(at(sx, 0.02, sz), at(sx, 2.62, sz), 0.017 * s, 0.015 * s, 10), bronze);
      api.add(api.limb(at(sx, 2.6, sz), at(sx, 2.66, sz), 0.026 * s, 0.026 * s, 10), gold);
      api.add(api.lathe(([[0, 0], [0.03, 0.04], [0.042, 0.11], [0.03, 0.2], [0, 0.3]] as Array<[number, number]>).map(([r, y]) => [r * s, y * s] as [number, number]), 12).scale(1, 1, 0.45).translate(...at(sx, 2.66, sz)), gold);
      api.add(api.limb(at(sx, 0.0, sz), at(sx, 0.09, sz), 0.012 * s, 0.02 * s, 8), gold);
      // A great round shield standing on the pedestal at her left side, its rim under her hand; the face is carved
      // with a raised ring and a gilded boss, the rim gilded.
      const R = 0.5;
      const place = (m: Mesh): Mesh => m.rotate(0, 0, -80).rotate(0, -35, 0).translate(0.52, 0.52, 0.06).scale(s).translate(0, y0, 0);
      const face = api.lathe([[0, 0.075], [0.18, 0.068], [0.3, 0.05], [0.31, 0.058], [0.33, 0.058], [0.34, 0.045], [0.44, 0.022], [R, 0.004], [R, -0.02], [0.45, -0.03], [0, -0.03]], 48);
      marbleParts.push(place(face));
      const rim: Array<[number, number]> = [];
      for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2; rim.push([R + 0.006 + 0.022 * Math.cos(a), 0.0 + 0.022 * Math.sin(a)]); }
      api.add(place(api.lathe(rim, 48)), gold);
      api.add(place(api.lathe([[0, 0.135], [0.03, 0.128], [0.055, 0.105], [0.07, 0.075], [0.07, 0.06], [0, 0.06]], 20)), gold);
    } else {
      // A gilded diadem round the head.
      api.add(api.torus(0.104 * s, 0.013 * s, 8, 28).rotate(90, 0, 0).rotate(-10, 0, 0).translate(...at(0.03, 1.885, -0.028)), gold);
    }

    // Pedestal sized to the whole composition: two steps, a torus base moulding, the die with a raised panel, a cyma
    // cap and an overhanging cornice.
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const m of marbleParts) {
      const b = m.bounds();
      for (let i = 0; i < 3; i++) { box.min[i] = Math.min(box.min[i] as number, b.min[i] as number); box.max[i] = Math.max(box.max[i] as number, b.max[i] as number); }
    }
    if (v === 0) { box.min[0] = Math.min(box.min[0] as number, -0.38 * s); }
    const cx = ((box.min[0] as number) + (box.max[0] as number)) / 2, cz = ((box.min[2] as number) + (box.max[2] as number)) / 2;
    const w = ((box.max[0] as number) - (box.min[0] as number)) * 1.0 + H * 0.02;
    const d = Math.max(((box.max[2] as number) - (box.min[2] as number)) * 1.0 + H * 0.02, w * 0.72);
    if (ped > 0) {
      const tier = (sw: number, y: number, h: number, r: number): Mesh => api.roundedBox(w * sw, h, d * sw, Math.min(r, h * 0.49), 2).translate(cx, y + h / 2, cz);
      marbleParts.push(
        tier(1.16, 0, ped * 0.13, ped * 0.01),
        tier(1.11, ped * 0.13, ped * 0.11, ped * 0.01),
        tier(1.06, ped * 0.24, ped * 0.07, ped * 0.035),
        tier(1.03, ped * 0.31, ped * 0.04, ped * 0.012),
        tier(1, ped * 0.35, ped * 0.43, ped * 0.008),
        api.roundedBox(w * 0.72, ped * 0.26, d * 1.0 + ped * 0.03, ped * 0.01, 2).translate(cx, ped * 0.565, cz),
        api.roundedBox(w * 1.0 + ped * 0.03, ped * 0.26, d * 0.62, ped * 0.01, 2).translate(cx, ped * 0.565, cz),
        tier(1.03, ped * 0.78, ped * 0.04, ped * 0.012),
        tier(1.06, ped * 0.82, ped * 0.06, ped * 0.028),
        tier(1.1, ped * 0.88, ped * 0.12, ped * 0.012),
      );
    }

    // Weathered marble: faint grey veins, rain streaks and grime in the sheltered undersides and near the base.
    const top = ped + H;
    const k = 7 / H;
    const vein: RGB = [0.68, 0.7, 0.74], grime: RGB = [0.72, 0.66, 0.56];
    for (const m of marbleParts) {
      m.paintFn((x, y, z, _nx, ny, _nz, out) => {
        const n = api.noise3(x * k * 0.6 + 13.1, y * k * 0.6, z * k * 0.6) + 0.45 * api.noise3(x * k * 1.7, y * k * 1.7 + 5.3, z * k * 1.7);
        const veinW = Math.exp(-((n * 9) ** 2)) * 0.55 + Math.exp(-((api.noise3(x * k * 2.3 + 3, y * k * 2.3, z * k * 2.3 - 7) * 14) ** 2)) * 0.25;
        const streak = Math.max(0, api.noise3(x * k * 3.5, y * k * 0.35 + 2, z * k * 3.5) - 0.1) * 1.6;
        const low = Math.max(0, 1 - (y - 0) / (top * 0.25));
        const under = Math.max(0, -ny);
        const g = Math.min(0.45, streak * 0.16 * (1 - y / top * 0.5) + low * low * 0.22 + under * 0.14);
        for (let i = 0; i < 3; i++) {
          let c = 1 - veinW * (1 - (vein[i] as number)) * 0.5;
          c *= 1 - g * (1 - (grime[i] as number));
          out[i] = c;
        }
      });
      // The carved figure is its own part: a dense sculpt is drawn as virtual geometry, which suits one continuous
      // surface, while the shield and the pedestal stay a plain mesh.
      api.add(m, m === fig ? mat : { ...mat, roughness: 0.6 });
    }

    const height = top;
    api.collider(boxCollider(cx, height / 2, cz, Math.max(w * (ped > 0 ? 1.16 : 1), H * 0.25), height, Math.max(d * (ped > 0 ? 1.16 : 1), H * 0.2)));
    return api.build();
  },
});

export const CLASSICAL_GENERATORS = [figureStatue, columnGen, temple, balustrade, aqueduct, cliffFace, brazier, amphora, banner, awning] as const;
