/**
 * Classical and Mediterranean pieces: columns in the orders, temples and a round tholos, balustrades, an aqueduct arcade,
 * a cliff face, a bronze brazier, amphorae, banners and awnings. Surfaces use the photographed finishes (marble, stone,
 * roof tile, rock, brass, ceramic, fabric) tinted by the colour params, not flat vertex colours.
 */
import type { MaterialSpec, Vec3 } from '@aether/core';
import type { InternalApi } from '../api';
import type { Mesh } from '../kernel/mesh';
import { boxCollider, cylinderCollider } from '../colliders';
import { defineGenerator, glow, pBool, pColor, pInt, pNum, pVariant } from './kit';

// Weathered marble reads as a pale, finely textured stone at building scale (the polished-marble finish is too veiny).
const marble = (color: string): MaterialSpec => ({ finish: 'plaster', color, roughness: 0.6 });
const stone = (color: string): MaterialSpec => ({ finish: 'stone', color, roughness: 0.85 });
const roofTile = (color: string): MaterialSpec => ({ finish: 'roof-tile', color, roughness: 0.8 });
const rock = (color: string): MaterialSpec => ({ finish: 'rock', color, roughness: 0.92 });
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
  description: 'Greek temple: stepped stylobate, peristyle of columns round a cella, entablature, pediments and tiled roof; tholos and ruin variants.',
  category: 'architecture',
  params: {
    width: pNum(16, 6, 40, 'front width in meters (tholos: diameter)'),
    length: pNum(30, 8, 70, 'depth front to back in meters'),
    height: pNum(8, 3, 16, 'column height in meters'),
    columns: pInt(6, 4, 10, 'columns across the front'),
    color: pColor('#ece4d6', 'marble colour'),
    roofColor: pColor('#a8553a', 'roof tile colour'),
    variant: pVariant(3, '0 doric, 1 ionic, 2 round tholos, 3 ruined doric (broken columns, no roof)'),
  },
  run(p, api) {
    const v = p.int('variant');
    const H = p.num('height');
    const W = p.num('width');
    const L = v === 2 ? W : Math.max(p.num('length'), W);
    const mat = marble(p.color('color'));
    const step = H * 0.06;
    const r = H / 11;
    const order: Order = v === 1 ? 'ionic' : 'doric';
    const body: Mesh[] = [];
    const y0 = step * 3;
    if (v === 2) {
      // Tholos: round steps, a ring of columns, a round cella, a ring entablature and a conical roof.
      const R = W / 2;
      for (let i = 0; i < 3; i++) body.push(api.cylinder(R + (2 - i) * step * 1.4, R + (2 - i) * step * 1.4, step, 40).translate(0, step * (i + 0.5), 0));
      const n = Math.max(8, Math.round((Math.PI * 2 * (R - r * 1.6)) / (r * 5)));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        body.push(column(api, H, r, order, 12).translate(Math.cos(a) * (R - r * 1.6), y0, Math.sin(a) * (R - r * 1.6)));
      }
      body.push(api.cylinder(R * 0.62, R * 0.62, H, 28).translate(0, y0 + H / 2, 0));
      body.push(api.lathe([[R - r * 0.2, y0 + H], [R + r * 0.4, y0 + H + H * 0.1], [R + r * 0.4, y0 + H + H * 0.2], [0, y0 + H + H * 0.2]], 40));
      for (const m of body) api.add(m, mat);
      api.add(api.cone(R + r * 0.8, H * 0.55, 32).translate(0, y0 + H * 1.2, 0), roofTile(p.color('roofColor')));
      api.collider(cylinderCollider(0, y0 / 2, 0, R + step * 2.8, y0));
      api.collider(cylinderCollider(0, y0 + H / 2, 0, R * 0.62, H));
      return api.build();
    }
    for (let i = 0; i < 3; i++) body.push(api.box(W + (2 - i) * step * 2.8, step, L + (2 - i) * step * 2.8).translate(0, step * (i + 0.5), 0));
    const inset = r * 1.6;
    const nF = p.int('columns');
    const nS = Math.max(nF, Math.round(((L - 2 * inset) / (W - 2 * inset)) * (nF - 1)) + 1);
    const at: Array<[number, number]> = [];
    for (let i = 0; i < nF; i++) {
      const x = -W / 2 + inset + (i / (nF - 1)) * (W - 2 * inset);
      at.push([x, -L / 2 + inset], [x, L / 2 - inset]);
    }
    for (let j = 1; j < nS - 1; j++) {
      const z = -L / 2 + inset + (j / (nS - 1)) * (L - 2 * inset);
      at.push([-W / 2 + inset, z], [W / 2 - inset, z]);
    }
    const ruin = v === 3;
    for (const [x, z] of at) {
      const b = ruin ? (api.rng() < 0.45 ? api.range(0.2, 0.75) : api.rng() < 0.2 ? 0 : 1) : 1;
      if (b === 0) continue;
      body.push(column(api, H, r, order, 12, b).translate(x, y0, z));
    }
    // Cella with a dark doorway in its front wall.
    body.push(api.box(W - inset * 4.2, H * (ruin ? 0.5 : 1), L - inset * 5).translate(0, y0 + (H * (ruin ? 0.5 : 1)) / 2, 0));
    const doorH = H * 0.62;
    api.add(api.box(W * 0.16, doorH, 0.1).translate(0, y0 + doorH / 2, -(L - inset * 5) / 2 - 0.05), { finish: 'stone', color: '#2b2622', roughness: 0.9 });
    if (!ruin) {
      const eH = H * 0.24;
      body.push(api.box(W - inset * 0.6, eH * 0.45, L - inset * 0.6).translate(0, y0 + H + eH * 0.225, 0));
      body.push(api.box(W - inset * 0.4, eH * 0.42, L - inset * 0.4).translate(0, y0 + H + eH * 0.66, 0));
      body.push(api.box(W - inset * 0.1, eH * 0.13, L - inset * 0.1).translate(0, y0 + H + eH * 0.935, 0));
      // Triglyphs over each column and between, on the front and back friezes.
      const ty = y0 + H + eH * 0.66;
      for (const z of [-(L - inset * 0.4) / 2 - 0.03, (L - inset * 0.4) / 2 + 0.03]) {
        for (let i = 0; i < nF * 2 - 1; i++) {
          const x = -W / 2 + inset + (i / (nF * 2 - 2)) * (W - 2 * inset);
          body.push(api.box(r * 1.1, eH * 0.42, 0.08).translate(x, ty, z));
        }
      }
      // Pediments and the roof over them.
      const pitch = W * 0.13;
      const gableY = y0 + H + eH;
      const tri: Array<[number, number]> = [[-W / 2 + inset * 0.05, 0], [W / 2 - inset * 0.05, 0], [0, pitch]];
      body.push(api.extrude(tri, L - inset * 0.1).translate(0, gableY, 0));
      const slope = Math.hypot(W / 2, pitch);
      const ang = (Math.atan2(pitch, W / 2) * 180) / Math.PI;
      const roof = roofTile(p.color('roofColor'));
      for (const s of [-1, 1]) {
        api.add(api.box(slope + 0.5, 0.18, L + 0.3).translate(s * slope / 2, 0, 0).rotate(0, 0, s * -ang).translate(0, gableY + pitch + 0.12, 0), roof);
      }
    }
    for (const m of body) api.add(m, mat);
    api.collider(boxCollider(0, y0 / 2, 0, W + step * 5.6, y0, L + step * 5.6));
    api.collider(boxCollider(0, y0 + H / 2, 0, W - inset * 4.2, H, L - inset * 5));
    for (const [x, z] of at.slice(0, 40)) api.collider(cylinderCollider(x, y0 + H / 2, z, r, H));
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
  description: 'Cliff face: a tall rock wall with strata, ledges and cracks (limestone, granite or an overhang); backs plateaus, gorges and coasts. Faces +Z.',
  category: 'terrain',
  params: {
    width: pNum(30, 4, 120, 'width in meters'),
    height: pNum(30, 4, 120, 'height in meters'),
    depth: pNum(8, 2, 40, 'solid thickness behind the face in meters'),
    color: pColor('#cfc4ad', 'rock colour (pale limestone by default)'),
    variant: pVariant(2, '0 stratified limestone with ledges, 1 rough granite, 2 overhanging'),
  },
  run(p, api) {
    const W = p.num('width');
    const H = p.num('height');
    const D = p.num('depth');
    const v = p.int('variant');
    const sx = Math.min(36, Math.ceil(W / 1.5));
    const sy = Math.min(44, Math.ceil(H / 1.5));
    const face = api.plane(W, H, sx, sy).rotate(90, 0, 0).translate(0, H / 2, 0);
    const k = Math.min(1, H / 20);
    face.displace((x, y) => {
      const n = api.fbm2(x * 0.08, y * 0.08) * 2.2 * k + api.noise2(x * 0.5, y * 0.5) * 0.35;
      if (v === 0) {
        // Strata: bands that step in and out, broken by vertical joints.
        const band = Math.floor(y / 2.6 + api.noise2(x * 0.05, 1) * 0.6);
        return n * 0.6 + Math.sin(band * 2.7) * 0.7 * k + (api.noise2(x * 0.3, band) > 0.55 ? -0.6 : 0);
      }
      if (v === 2) return n + Math.max(0, (y / H - 0.55) * 2.4) * D * 0.25;
      return n * 1.3;
    });
    api.add(face, rock(p.color('color')));
    api.add(api.box(W, H, D).translate(0, H / 2, -D / 2 - 0.8), rock(p.color('color')));
    // A few ledges with fallen blocks at the foot.
    for (let i = 0; i < 6; i++) {
      const r = api.range(0.6, 1.8) * Math.min(1.5, H / 15);
      const b = api.icosphereRock(r, 0.5, 1).scale(1.3, 0.7, 1).translate(api.range(-W / 2, W / 2) * 0.9, r * 0.3, api.range(0.6, 2.2));
      api.add(b, rock(p.color('color')));
    }
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

const figureStatue = defineGenerator({
  id: 'figure-statue',
  description: 'Standing classical figure statue at any scale (life size to a 30 m colossus): robed goddess with helmet, spear and round shield, or a robed figure with raised arms.',
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
    const mat = marble(p.color('color'));
    const gold: MaterialSpec = { finish: 'brass', color: p.color('accentColor'), roughness: 0.35, metalness: 0.9 };
    const ped = p.bool('pedestal') ? H * 0.16 : 0;
    // Robe from hem to neck (a peplos): flared hem, cinched waist, full chest, with deep vertical folds that fade upward.
    const robe = api.lathe([[H * 0.115, 0], [H * 0.11, H * 0.04], [H * 0.095, H * 0.3], [H * 0.075, H * 0.55], [H * 0.07, H * 0.6], [H * 0.088, H * 0.7], [H * 0.1, H * 0.79], [H * 0.06, H * 0.84], [H * 0.028, H * 0.86], [0, H * 0.865]], 36);
    robe.displace((x, y, z) => {
      const a = Math.atan2(z, x);
      const fade = Math.max(0, 1 - y / (H * 0.62));
      return H * 0.008 * Math.cos(a * 13) * fade + H * 0.003 * Math.cos(a * 29 + y * 3) * fade;
    });
    robe.scale(1, 1, 0.72);
    // A fold of cloth over one shoulder (the himation) breaks the symmetry.
    const drape = api.tube([[H * 0.085, H * 0.8, H * 0.02], [H * 0.02, H * 0.7, H * 0.075], [-H * 0.07, H * 0.56, H * 0.06], [-H * 0.09, H * 0.42, H * 0.03]], H * 0.022, 8);
    let fig = robe.merge(drape);
    fig = fig.merge(api.cylinder(H * 0.026, H * 0.03, H * 0.06, 12).translate(0, H * 0.88, 0));
    const head = api.sphere(H * 0.058).scale(0.9, 1.08, 1).translate(0, H * 0.935, H * 0.004);
    fig = fig.merge(head);
    const arm = (from: Vec3, mid: Vec3, to: Vec3): Mesh => api.tube([from, mid, to], H * 0.024, 8, (t) => 1 - 0.3 * t);
    if (v === 0) {
      // Helmet with a crest, the spear held high in the right hand, the shield resting at the left side.
      api.add(api.sphere(H * 0.064).scale(0.95, 0.75, 1.05).translate(0, H * 0.965, -H * 0.004), gold);
      api.add(api.box(H * 0.012, H * 0.05, H * 0.13).translate(0, H * 1.02, -H * 0.01), gold);
      fig = fig.merge(arm([H * 0.095, H * 0.8, 0], [H * 0.16, H * 0.86, H * 0.02], [H * 0.17, H * 0.98, H * 0.03]));
      fig = fig.merge(arm([-H * 0.095, H * 0.8, 0], [-H * 0.15, H * 0.68, H * 0.04], [-H * 0.17, H * 0.58, H * 0.08]));
      api.add(api.cylinder(H * 0.009, H * 0.009, H * 1.25, 8).translate(H * 0.17, H * 0.6, H * 0.03), { finish: 'brass', color: '#6d5532', roughness: 0.6, metalness: 0.7 });
      api.add(api.cone(H * 0.022, H * 0.09, 8).translate(H * 0.17, H * 1.27, H * 0.03), gold);
      const shield = api.lathe([[0, H * 0.035], [H * 0.12, H * 0.025], [H * 0.17, H * 0.008], [H * 0.18, 0], [H * 0.18, -H * 0.012], [0, -H * 0.006]], 32).rotate(90, 0, 0).rotate(0, -35, 0).translate(-H * 0.24, H * 0.36, H * 0.12);
      api.add(shield, mat);
      api.add(api.torus(H * 0.175, H * 0.01, 8, 40).rotate(0, -35, 0).translate(-H * 0.24 + Math.sin((-35 * Math.PI) / 180) * H * 0.01, H * 0.36, H * 0.12 + Math.cos((-35 * Math.PI) / 180) * H * 0.01), gold);
    } else {
      fig = fig.merge(arm([H * 0.095, H * 0.8, 0], [H * 0.17, H * 0.92, H * 0.02], [H * 0.2, H * 1.05, H * 0.03]));
      fig = fig.merge(arm([-H * 0.095, H * 0.8, 0], [-H * 0.17, H * 0.92, H * 0.02], [-H * 0.2, H * 1.05, H * 0.03]));
    }
    api.add(fig.translate(0, ped, 0), mat);
    if (ped > 0) {
      const ps = marble('#ddd5c6');
      api.add(api.box(H * 0.42, ped * 0.25, H * 0.42).translate(0, ped * 0.125 - ped, 0).translate(0, ped, 0), ps);
      api.add(api.box(H * 0.34, ped * 0.6, H * 0.34).translate(0, ped * 0.55, 0), ps);
      api.add(api.box(H * 0.38, ped * 0.15, H * 0.38).translate(0, ped * 0.925, 0), ps);
    }
    api.collider(boxCollider(0, (ped + H) / 2, 0, Math.max(H * 0.34, H * 0.25), ped + H, H * 0.34));
    return api.build();
  },
});

export const CLASSICAL_GENERATORS = [figureStatue, columnGen, temple, balustrade, aqueduct, cliffFace, brazier, amphora, banner, awning] as const;
