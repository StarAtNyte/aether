/**
 * Small pieces that make a venue read as the real place and that a model otherwise leaves out because no part exists for
 * them: statues and busts on plinths, stanchions with a velvet rope, wall labels, table settings, candles, columns and
 * pilasters, hanging acoustic baffles, planters. One mesh per material, each far under 3k triangles, so a hundred of them
 * instance as a handful of draw calls (`shape_land` wall, along, around, grid, perimeter).
 */
import { Geom, box, cylinder, lathe, roundedBox, sphere, tube } from '../mesh';
import { PartSet } from '../parts';
import type { P2 } from '../math2';
import { choice, color, flag, mat, num, seeded, type FurnitureDef } from './kit';
import { bevelSlab } from './venue-kit';
import { buildStyledColumn } from '../column-styles';

const paint = (c: string, roughness = 0.7) => ({ finish: 'paint' as const, color: c, roughness });
const EMISSIVE = (c: string, k: number) => ({ preset: 'emissive' as const, color: c, emissive: c, emissiveIntensity: k });
const GLASS = { finish: 'glass' as const, color: '#e4eef2', opacity: 0.22, roughness: 0.05 };

// ---------------------------------------------------------------------------
// Statue and bust on a plinth
// ---------------------------------------------------------------------------

/** A robed standing figure of height `F` (feet at y = 0), one raised arm; low-poly but readable as a person at 3 m. */
function figure(F: number, pose: number): Geom {
  const g = new Geom();
  const prof: P2[] = [[0.001, 0], [0.17, 0], [0.18, 0.04], [0.15, 0.2], [0.12, 0.45], [0.105, 0.62], [0.135, 0.72], [0.14, 0.78], [0.075, 0.8], [0.04, 0.82], [0.001, 0.82]].map(([r, y]) => [(r as number) * F, (y as number) * F] as P2);
  g.merge(lathe(prof, 18));
  g.merge(sphere(0.07 * F, 14).scale(0.92, 1.12, 1).translate(0, 0.895 * F, 0));
  g.merge(cylinder(0.03 * F, 0.036 * F, 0.05 * F, 8).translate(0, 0.81 * F, 0));
  // Arms: one hangs, one is raised (pose 0) or both hang (pose 1).
  const arm = (side: number, up: boolean): Geom => {
    const shoulder: [number, number, number] = [side * 0.14 * F, 0.75 * F, 0];
    const elbow: [number, number, number] = [side * 0.19 * F, up ? 0.82 * F : 0.6 * F, 0.05 * F];
    const hand: [number, number, number] = [side * (up ? 0.17 : 0.2) * F, up ? 0.97 * F : 0.46 * F, up ? 0.1 * F : 0.07 * F];
    return tube([shoulder, elbow, hand], 0.025 * F, 6);
  };
  g.merge(arm(-1, false));
  g.merge(arm(1, pose === 0));
  return g;
}

/** A head and shoulders on a socle, `H` tall. */
function bustShape(H: number): Geom {
  const g = new Geom();
  g.merge(lathe([[0.001, 0], [0.2, 0], [0.22, 0.04], [0.2, 0.1], [0.001, 0.1]].map(([r, y]) => [(r as number) * H, (y as number) * H] as P2), 16));
  g.merge(roundedBox(0.52 * H, 0.2 * H, 0.26 * H, 0.07 * H, 2).translate(0, 0.19 * H, 0));
  g.merge(cylinder(0.065 * H, 0.09 * H, 0.26 * H, 10).translate(0, 0.25 * H, 0));
  g.merge(sphere(0.17 * H, 16).scale(0.88, 1.2, 1.0).translate(0, 0.6 * H, 0));
  return g;
}

/** A twisted stack of slabs with a ball on top. */
function abstractShape(H: number, rnd: () => number): Geom {
  const g = new Geom();
  const n = 6;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const w = (0.34 - 0.18 * t) * H * 0.5;
    g.merge(roundedBox(w * 2, (H * 0.8) / n, w * 1.4, 0.01 * H, 1).rotateY(k * 17 + rnd() * 6).translate(0, ((k + 0.5) * H * 0.8) / n, 0));
  }
  g.merge(sphere(0.1 * H, 14).translate(0.04 * H, 0.9 * H, 0));
  return g;
}

export const STATUE: FurnitureDef = {
  id: 'furn-statue',
  kind: 'statue',
  aliases: ['statue', 'sculpture', 'bust', 'figure sculpture', 'monument', 'statuette', 'marble statue', 'bronze statue', 'sculpture on plinth', 'portrait bust', 'abstract sculpture', 'museum sculpture'],
  description:
    'Statue or bust on a plinth, for museums, gardens, plazas and lobbies: `variant` figure (a robed standing figure with a raised arm), bust (head and shoulders) or abstract (twisted stack of slabs); `material` marble, bronze, stone or patina (green bronze). `height` is the overall height with the plinth, `plinth` the height of the plinth itself. Stands at the origin, front toward +Z. Use this, never a tree or a lamp, where a sculpture is asked for.',
  params: {
    variant: choice(['figure', 'bust', 'abstract'], 'figure', 'standing figure, head and shoulders, or abstract sculpture'),
    material: choice(['marble', 'bronze', 'stone', 'patina'], 'marble', 'what the sculpture is made of'),
    height: num(2.2, 0.8, 5, 'overall height with the plinth (m)'),
    plinth: num(0.9, 0.3, 1.8, 'plinth height (m)'),
    base: color('#e6e2da', 'plinth colour'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.6,
  size: (p) => [Math.max(0.55, p.num('height') * 0.3), p.num('height'), Math.max(0.55, p.num('height') * 0.3)],
  build(p, seed) {
    const set = new PartSet();
    const H = p.num('height');
    const ph = Math.min(p.num('plinth'), H * 0.6);
    const w = Math.max(0.55, H * 0.3);
    const rnd = seeded(seed * 2654435761 + 5);
    const baseCol = paint(p.color('base'), 0.55);
    const m = p.str('material');
    const stuff = m === 'bronze' ? { finish: 'brass' as const, color: '#5e4a2c', roughness: 0.45 } : m === 'patina' ? { finish: 'brass' as const, color: '#4f7a68', roughness: 0.6 } : m === 'stone' ? mat('stone', '#a9a498') : { finish: 'paint' as const, color: '#ebe7df', roughness: 0.32 };
    set.add(box(-w / 2, 0, -w / 2, w / 2, 0.07, w / 2), baseCol);
    set.add(box(-w / 2 + 0.05, 0.07, -w / 2 + 0.05, w / 2 - 0.05, ph - 0.05, w / 2 - 0.05), baseCol);
    set.add(bevelSlab(-w / 2, ph - 0.05, -w / 2, w / 2, ph, w / 2, 0.012), baseCol);
    const F = H - ph;
    const v = p.str('variant');
    const body = v === 'bust' ? bustShape(Math.min(F, 0.8)) : v === 'abstract' ? abstractShape(F, rnd) : figure(F, Math.floor(rnd() * 2));
    set.add(body.translate(0, ph, 0), stuff);
    set.add(box(-0.1, ph * 0.5, w / 2 - 0.045, 0.1, ph * 0.5 + 0.05, w / 2 - 0.035), mat('brass'));
    set.boxMinMax(-w / 2, 0, -w / 2, w / 2, H, w / 2);
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Rope stanchion
// ---------------------------------------------------------------------------

export const ROPE_STANCHION: FurnitureDef = {
  id: 'furn-rope-stanchion',
  kind: 'rope-stanchion',
  aliases: ['rope stanchion', 'stanchion', 'velvet rope', 'rope barrier', 'queue barrier', 'crowd barrier', 'belt barrier', 'museum barrier', 'queue post', 'ropes and posts', 'barrier post'],
  description:
    'Stanchion post (weighted base, polished pole, ball top) with a velvet rope sagging to the post on each side. `span` is the distance to the next post: shape_land {op:"along"} fills it from the spacing, so a line of posts is one continuous rope. Place a line round a plinth, along a queue or in front of a wall of art. 1.0 m tall.',
  params: {
    finish: choice(['brass', 'chrome', 'black-metal'], 'brass', 'post metal'),
    rope: color('#7a1424', 'rope colour'),
    span: num(1.6, 0, 6, 'distance to the next post (m); 0 = no rope'),
    height: num(0.95, 0.6, 1.2, 'post height (m)'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.3,
  size: (p) => [Math.max(0.36, p.num('span')), p.num('height'), 0.36],
  build(p) {
    const set = new PartSet();
    const H = p.num('height');
    const metal = mat(p.str('finish'));
    const post = new Geom();
    post.merge(cylinder(0.17, 0.16, 0.03, 20));
    post.merge(cylinder(0.026, 0.026, H - 0.03, 10).translate(0, 0.03, 0));
    post.merge(cylinder(0.05, 0.05, 0.02, 12).translate(0, 0.03, 0));
    post.merge(sphere(0.045, 12).translate(0, H + 0.02, 0));
    post.merge(cylinder(0.04, 0.04, 0.012, 12).translate(0, H - 0.1, 0));
    set.add(post, metal);
    const span = p.num('span');
    if (span > 0.25) {
      const rope = new Geom();
      const y0 = H - 0.1;
      const sag = Math.min(0.28, 0.05 + span * 0.08);
      for (const side of [-1, 1] as const) {
        const pts: Array<[number, number, number]> = [];
        for (let k = 0; k <= 8; k++) {
          const t = k / 8;
          pts.push([side * (0.03 + (span / 2 - 0.03) * t), y0 - sag * (1 - (1 - t) * (1 - t)), 0]);
        }
        rope.merge(tube(pts, 0.017, 6));
      }
      set.add(rope, { finish: 'velvet', color: p.color('rope') });
    }
    set.boxMinMax(-0.17, 0, -0.17, 0.17, H, 0.17);
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Wall label / plaque
// ---------------------------------------------------------------------------

export const PLAQUE: FurnitureDef = {
  id: 'furn-plaque',
  kind: 'plaque',
  aliases: ['plaque', 'wall label', 'museum label', 'label', 'caption', 'placard', 'info plate', 'name plate', 'nameplate', 'object label', 'artwork label', 'exhibit label'],
  description:
    'Small wall label beside a painting or an exhibit: `variant` card (white card with lines of text in a thin frame), brass (engraved brass plate) or slate. Back at z = 0, 0.2 x 0.14 m by default; hang at y 1.25 beside a frame with shape_land {op:"wall"} using the same count as the pictures.',
  params: {
    variant: choice(['card', 'brass', 'slate'], 'card', 'label type'),
    width: num(0.2, 0.08, 0.8, 'width (m)'),
    height: num(0.14, 0.05, 0.6, 'height (m)'),
  },
  mount: 'wall',
  againstWall: true,
  frontClearance: 0,
  size: (p) => [p.num('width'), p.num('height'), 0.016],
  build(p) {
    const set = new PartSet();
    const w = p.num('width');
    const h = p.num('height');
    const v = p.str('variant');
    const text = v === 'card' ? paint('#2a2a2c', 0.8) : v === 'brass' ? paint('#3b2f14', 0.5) : paint('#e8e6e0', 0.7);
    const plate = v === 'card' ? paint('#f1efe9', 0.8) : v === 'brass' ? mat('brass') : mat('stone', '#2b2d30');
    set.add(roundedBox(w, h, 0.012, 0.004, 1).translate(0, h / 2, 0.006), plate);
    const lines = Math.max(2, Math.min(6, Math.round(h / 0.026)));
    const g = new Geom();
    for (let k = 0; k < lines; k++) {
      const y = h - 0.03 - k * ((h - 0.05) / lines);
      const lw = (k === 0 ? 0.62 : k === lines - 1 ? 0.4 : 0.8) * (w - 0.04);
      g.merge(box(-w / 2 + 0.02, y - 0.004, 0.0115, -w / 2 + 0.02 + lw, y + (k === 0 ? 0.006 : 0.003), 0.0135));
    }
    set.add(g, text);
    set.boxMinMax(-w / 2, 0, 0, w / 2, h, 0.016);
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Place setting and candle (on a table)
// ---------------------------------------------------------------------------

function stemGlass(r: number, h: number, bowl: boolean): Geom {
  const prof: P2[] = bowl
    ? [[0.001, 0], [r * 0.9, 0], [r * 0.9, 0.004], [0.006, 0.01], [0.006, h * 0.45], [r * 0.5, h * 0.5], [r * 0.95, h * 0.72], [r, h], [r * 0.93, h], [r * 0.86, h * 0.72], [0.001, h * 0.52]]
    : [[0.001, 0], [r, 0], [r * 1.05, h], [r, h], [r * 0.9, 0.006], [0.001, 0.006]];
  return lathe(prof, 14);
}

export const PLACE_SETTING: FurnitureDef = {
  id: 'furn-place-setting',
  kind: 'place-setting',
  aliases: ['place setting', 'table setting', 'cover', 'dinner setting', 'tableware', 'dinner plate set', 'table settings', 'cutlery set', 'plate and glass', 'dinnerware', 'plates and glasses'],
  description:
    'One cover on a table: a charger and dinner plate, folded napkin, fork on the left, knife and spoon on the right, a wine glass and a water glass. Origin at the middle of the plate on the table top (place at the table height, 0.75 m); the diner sits at -Z, the glasses are toward +Z. shape_land {op:"perimeter", settings:{of:"furn-place-setting"}} puts one at every seat of every table in the same call; 0.45 x 0.32 m.',
  params: {
    plate: color('#f4f1ea', 'plate colour'),
    rim: color('#2b3a55', 'plate rim colour'),
    napkin: color('#7a1f2b', 'napkin colour'),
    glasses: choice(['both', 'wine', 'water', 'none'], 'both', 'which glasses stand at the cover'),
    cutlery: flag(true, 'fork, knife and spoon'),
  },
  mount: 'surface',
  againstWall: false,
  frontClearance: 0,
  size: () => [0.46, 0.2, 0.34],
  build(p) {
    const set = new PartSet();
    const plate = { finish: 'ceramic' as const, color: p.color('plate'), roughness: 0.25 };
    set.add(cylinder(0.16, 0.15, 0.008, 22), { finish: 'ceramic' as const, color: p.color('rim'), roughness: 0.3 });
    set.add(lathe([[0.001, 0.008], [0.09, 0.008], [0.12, 0.018], [0.125, 0.021], [0.118, 0.021], [0.088, 0.013], [0.001, 0.013]], 22), plate);
    set.add(box(-0.215, 0.0, -0.1, -0.165, 0.014, 0.1), paint(p.color('napkin'), 0.9));
    set.add(box(-0.21, 0.014, -0.05, -0.17, 0.017, 0.1), paint('#ffffff', 0.9));
    if (p.bool('cutlery')) {
      const steel = mat('chrome');
      const c = new Geom();
      c.merge(box(-0.255, 0, -0.1, -0.24, 0.004, 0.1)); // fork
      for (const t of [-0.012, 0, 0.012]) c.merge(box(-0.262 + t * 0.2 - 0.0, 0, 0.1, -0.262 + t * 0.2 + 0.003, 0.004, 0.14));
      c.merge(box(-0.262, 0, 0.1, -0.233, 0.004, 0.105));
      c.merge(box(0.19, 0, -0.1, 0.205, 0.004, 0.12)); // knife
      c.merge(box(0.188, 0, 0.04, 0.2, 0.004, 0.12));
      c.merge(box(0.235, 0, -0.1, 0.248, 0.004, 0.06)); // spoon
      c.merge(cylinder(0.02, 0.02, 0.004, 10).translate(0.2415, 0, 0.08));
      set.add(c, steel);
    }
    const gl = p.str('glasses');
    const glass = new Geom();
    if (gl === 'both' || gl === 'wine') glass.merge(stemGlass(0.04, 0.17, true).translate(0.1, 0, 0.17));
    if (gl === 'both' || gl === 'water') glass.merge(stemGlass(0.038, 0.1, false).translate(0.17, 0, 0.14));
    if (glass.vertexCount > 0) set.add(glass, GLASS);
    set.boxMinMax(-0.27, 0, -0.17, 0.26, 0.17, 0.2);
    return set.build();
  },
};

export const CANDLE: FurnitureDef = {
  id: 'furn-candle',
  kind: 'candle',
  aliases: ['candle', 'candles', 'tea light', 'tealight', 'votive', 'votive candle', 'table candle', 'candle holder', 'candle in glass', 'tapered candle', 'pillar candle'],
  description:
    'A lit candle on a table or shelf: `variant` votive (a candle in a glass holder), taper (a brass candlestick with a tall candle) or pillar (a thick pillar candle on a dish). The flame is a small emissive tip. Origin at its base; 0.07 x 0.07 m footprint. A table centre candle is part of shape_land {op:"perimeter", centre:{of:"furn-candle"}}; a real light still has to be added for it to light anything.',
  params: {
    variant: choice(['votive', 'taper', 'pillar'], 'votive', 'holder and candle type'),
    flame: color('#ffb454', 'flame colour'),
    wax: color('#f1e8d2', 'wax colour'),
  },
  mount: 'surface',
  againstWall: false,
  frontClearance: 0,
  size: (p) => (p.str('variant') === 'taper' ? [0.1, 0.34, 0.1] : p.str('variant') === 'pillar' ? [0.1, 0.2, 0.1] : [0.07, 0.1, 0.07]),
  build(p) {
    const set = new PartSet();
    const v = p.str('variant');
    const wax = { finish: 'paint' as const, color: p.color('wax'), roughness: 0.55 };
    let top = 0;
    if (v === 'taper') {
      set.add(lathe([[0.001, 0], [0.04, 0], [0.04, 0.012], [0.012, 0.03], [0.011, 0.1], [0.02, 0.12], [0.014, 0.13], [0.014, 0.14], [0.001, 0.14]], 14), mat('brass'));
      set.add(cylinder(0.011, 0.011, 0.18, 8).translate(0, 0.14, 0), wax);
      top = 0.32;
    } else if (v === 'pillar') {
      set.add(cylinder(0.055, 0.05, 0.012, 14), mat('brass'));
      set.add(cylinder(0.04, 0.04, 0.15, 14).translate(0, 0.012, 0), wax);
      top = 0.162;
    } else {
      set.add(lathe([[0.001, 0], [0.032, 0], [0.036, 0.04], [0.038, 0.06], [0.034, 0.06], [0.03, 0.04], [0.001, 0.005]], 14), { finish: 'glass' as const, color: '#c9a45a', opacity: 0.6, roughness: 0.1 });
      set.add(cylinder(0.028, 0.028, 0.045, 12).translate(0, 0.004, 0), wax);
      top = 0.052;
    }
    set.add(cylinder(0.0015, 0.0015, 0.012, 4).translate(0, top, 0), paint('#222222'));
    set.add(sphere(0.011, 8).scale(0.8, 1.7, 0.8).translate(0, top + 0.02, 0), EMISSIVE(p.color('flame'), 6));
    set.boxMinMax(-0.04, 0, -0.04, 0.04, top + 0.04, 0.04);
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Column and pilaster
// ---------------------------------------------------------------------------

export const COLUMN: FurnitureDef = {
  id: 'furn-column',
  kind: 'column',
  aliases: ['column', 'pillar', 'pilaster', 'colonnade column', 'classical column', 'fluted column', 'doric column', 'support column', 'architectural column', 'half column'],
  description:
    'Classical column with a plinth base, torus, shaft and capital: `variant` round (smooth), fluted (grooved), square (a square pier with a moulded cap), pilaster (a shallow engaged pier for a wall: back flat at z = -depth/2, 0.14 m proud), classical (plinth, torus base, tapering fluted shaft with entasis and a doric capital) or ionic (the same with scroll volutes). `height` is floor to ceiling (3.2 m by default). Perimeter and colonnade runs: shape_land {op:"around"} for a whole room, {op:"along"} for one line.',
  params: {
    variant: choice(['round', 'fluted', 'square', 'pilaster', 'classical', 'ionic'], 'round', 'column type'),
    height: num(3.2, 0.8, 12, 'floor to top of capital (m)'),
    diameter: num(0.5, 0.2, 1.6, 'shaft diameter or width at the base (m)'),
    finish: choice(['plaster', 'marble', 'stone', 'concrete', 'paint'], 'plaster', 'shaft finish'),
    color: color('#e9e4da', 'tint'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.3,
  size: (p) => [p.num('diameter') * 1.25, p.num('height'), p.str('variant') === 'pilaster' ? 0.2 : p.num('diameter') * 1.25],
  build(p) {
    const set = new PartSet();
    const H = p.num('height');
    const D = p.num('diameter');
    const v = p.str('variant');
    const finish = p.str('finish') === 'paint' ? paint(p.color('color'), 0.6) : mat(p.str('finish'), p.color('color'));
    if (v === 'classical' || v === 'ionic') {
      return buildStyledColumn({ shape: 'round', size: D, height: H, finish, style: 'classical', capital: v === 'ionic' ? 'ionic' : 'doric', flutes: 20 });
    }
    const baseH = Math.min(0.28, H * 0.08);
    const capH = Math.min(0.4, H * 0.1);
    const shaftH = H - baseH - capH;
    const R = D / 2;
    if (v === 'round' || v === 'fluted') {
      const g = new Geom();
      g.merge(box(-R * 1.25, 0, -R * 1.25, R * 1.25, baseH * 0.5, R * 1.25));
      g.merge(cylinder(R * 1.12, R * 1.05, baseH * 0.5, 20).translate(0, baseH * 0.5, 0));
      if (v === 'round') g.merge(cylinder(R, R * 0.86, shaftH, 28).translate(0, baseH, 0));
      else {
        const flutes = 14;
        g.merge(cylinder(R * 0.9, R * 0.78, shaftH, 28).translate(0, baseH, 0));
        for (let k = 0; k < flutes; k++) {
          const a = (k / flutes) * Math.PI * 2;
          g.merge(box(-0.014, 0, -0.012, 0.014, shaftH, 0.012).translate(0, 0, 0).rotateY((a * 180) / Math.PI).translate(Math.sin(a) * R * 0.88, baseH, Math.cos(a) * R * 0.88));
        }
      }
      const y = baseH + shaftH;
      g.merge(cylinder(R * 0.86, R * 1.1, capH * 0.55, 24).translate(0, y, 0));
      g.merge(box(-R * 1.4, y + capH * 0.55, -R * 1.4, R * 1.4, y + capH, R * 1.4));
      set.add(g, finish);
      set.boxMinMax(-R * 1.25, 0, -R * 1.25, R * 1.25, H, R * 1.25);
    } else {
      const d = v === 'pilaster' ? 0.14 : D;
      const z0 = v === 'pilaster' ? -0.1 : -d / 2;
      const z1 = v === 'pilaster' ? 0.04 : d / 2;
      const g = new Geom();
      g.merge(box(-R * 1.18, 0, z0 - 0.02, R * 1.18, baseH, z1 + 0.04));
      g.merge(box(-R, baseH, z0, R, baseH + shaftH, z1));
      g.merge(box(-R * 1.2, baseH + shaftH, z0 - 0.02, R * 1.2, H - capH * 0.4, z1 + 0.05));
      g.merge(box(-R * 1.3, H - capH * 0.4, z0 - 0.03, R * 1.3, H, z1 + 0.07));
      set.add(g, finish);
      set.boxMinMax(-R * 1.3, 0, z0 - 0.03, R * 1.3, H, z1 + 0.07);
    }
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Ceiling baffle / raft / coffer
// ---------------------------------------------------------------------------

export const CEILING_BAFFLE: FurnitureDef = {
  id: 'furn-ceiling-baffle',
  kind: 'ceiling-baffle',
  aliases: ['ceiling baffle', 'acoustic baffle', 'baffle', 'ceiling fin', 'ceiling panel', 'acoustic raft', 'ceiling raft', 'suspended panel', 'hanging baffle', 'ceiling cloud', 'acoustic ceiling', 'coffer', 'ceiling coffer', 'ceiling slat'],
  description:
    'Ceiling piece hung from the slab (origin at the ceiling, the piece hangs below it): `variant` baffle (a vertical felt or timber fin, `length` x `fin` tall, on two cables), raft (a flat acoustic cloud under the ceiling) or coffer (a recessed-look square panel with a bevelled lip and a light strip). Rows of baffles: shape_land {op:"grid", of:"furn-ceiling-baffle", y: ceiling height, facing:"north"|"east"} with cols = baffles across and rows = down the hall; 12 baffles over an auditorium is one call.',
  params: {
    variant: choice(['baffle', 'raft', 'coffer'], 'baffle', 'fin, flat cloud or square coffer'),
    length: num(2.4, 0.4, 6, 'length (m)'),
    fin: num(0.5, 0.15, 1.5, 'height of the fin (m) or width of a raft or coffer'),
    drop: num(0.35, 0.05, 2, 'how far the top of the piece hangs below the ceiling (m)'),
    finish: choice(['felt', 'wood-slats', 'timber', 'paint'], 'felt', 'surface'),
    color: color('#3b3f46', 'felt or paint colour'),
    glow: flag(false, 'a warm light strip along the lower edge'),
  },
  mount: 'ceiling',
  againstWall: false,
  frontClearance: 0,
  size: (p) => [p.num('length'), p.num('drop') + (p.str('variant') === 'baffle' ? p.num('fin') : 0.08), p.str('variant') === 'baffle' ? 0.06 : p.num('fin')],
  build(p) {
    const set = new PartSet();
    const L = p.num('length');
    const F = p.num('fin');
    const drop = p.num('drop');
    const v = p.str('variant');
    const face = p.str('finish') === 'felt' ? { finish: 'fabric' as const, color: p.color('color'), roughness: 0.95 } : p.str('finish') === 'wood-slats' ? mat('wood-slats') : p.str('finish') === 'timber' ? mat('oak') : paint(p.color('color'), 0.7);
    const wire = mat('black-metal');
    if (v === 'baffle') {
      set.add(roundedBox(L, F, 0.045, 0.008, 1).translate(0, -drop - F / 2, 0), face);
      const w = new Geom();
      for (const x of [-L * 0.38, L * 0.38]) w.merge(cylinder(0.003, 0.003, drop, 5).translate(x, -drop, 0));
      set.add(w, wire);
      if (p.bool('glow')) set.add(box(-L / 2 + 0.03, -drop - F - 0.004, -0.015, L / 2 - 0.03, -drop - F, 0.015), EMISSIVE('#ffd8a0', 3));
      set.boxMinMax(-L / 2, -drop - F, -0.03, L / 2, 0, 0.03);
    } else {
      const th = 0.07;
      const W = F;
      set.add(bevelSlab(-L / 2, -drop - th, -W / 2, L / 2, -drop, W / 2, 0.012), face);
      const w = new Geom();
      for (const x of [-L * 0.4, L * 0.4]) for (const z of [-W * 0.4, W * 0.4]) w.merge(cylinder(0.003, 0.003, drop, 5).translate(x, -drop, z));
      if (drop > 0.08) set.add(w, wire);
      if (v === 'coffer' || p.bool('glow')) set.add(box(-L / 2 + 0.06, -drop - th - 0.004, -W / 2 + 0.06, L / 2 - 0.06, -drop - th, W / 2 - 0.06), EMISSIVE('#ffe8c4', p.bool('glow') ? 3 : 1.4));
      set.boxMinMax(-L / 2, -drop - th - 0.004, -W / 2, L / 2, 0, W / 2);
    }
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Planter
// ---------------------------------------------------------------------------

export const PLANTER: FurnitureDef = {
  id: 'furn-planter',
  kind: 'planter',
  aliases: ['planter', 'plant box', 'flower box', 'flower bed box', 'trough planter', 'planter box', 'street planter', 'shrub planter', 'garden planter', 'forecourt planter', 'urn planter', 'flower pot large'],
  description:
    'Planter with plants in it, for forecourts, plazas, lobbies and terraces: `variant` trough (a long concrete or timber box), urn (a tall flared pot) or round (a drum); `plants` shrub (clipped green mounds), flowers (mounds with blooms) or grass (tall tufts). Origin at the base centre; the planter box is `length` x 0.5 m. Rows: shape_land {op:"along"}.',
  params: {
    variant: choice(['trough', 'urn', 'round'], 'trough', 'planter shape'),
    plants: choice(['shrub', 'flowers', 'grass'], 'shrub', 'what grows in it'),
    length: num(1.2, 0.4, 4, 'length of a trough or diameter of a round planter (m)'),
    height: num(0.55, 0.25, 1.2, 'height of the planter body (m)'),
    finish: choice(['concrete', 'oak', 'stone', 'terrazzo'], 'concrete', 'body finish'),
    bloom: color('#e87a9a', 'flower colour'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.2,
  size: (p) => (p.str('variant') === 'trough' ? [p.num('length'), p.num('height') + 0.6, 0.5] : [Math.max(0.5, p.num('length')), p.num('height') + 0.6, Math.max(0.5, p.num('length'))]),
  build(p, seed) {
    const set = new PartSet();
    const H = p.num('height');
    const v = p.str('variant');
    const L = p.num('length');
    const rnd = seeded(seed * 747796405 + 11);
    const body = mat(p.str('finish'));
    const foliage = new Geom();
    const blooms = new Geom();
    const grow = (cx: number, cz: number, rx: number, rz: number): void => {
      const kind = p.str('plants');
      const n = Math.max(2, Math.round((rx * 2) / 0.28));
      for (let k = 0; k < n; k++) {
        const x = cx + (n === 1 ? 0 : -rx + (2 * rx * (k + 0.5)) / n);
        const z = cz + (rnd() - 0.5) * rz;
        const r = 0.17 + rnd() * 0.08;
        if (kind === 'grass') {
          for (let b = 0; b < 5; b++) foliage.merge(box(-0.006, 0, -0.006, 0.006, 0.4 + rnd() * 0.3, 0.006).rotateZ((rnd() - 0.5) * 30).rotateY(rnd() * 180).translate(x + (rnd() - 0.5) * 0.12, H, z + (rnd() - 0.5) * 0.12));
        } else {
          foliage.merge(sphere(r, 9).scale(1, 0.85, 1).translate(x, H + r * 0.7, z));
          if (kind === 'flowers') for (let b = 0; b < 4; b++) blooms.merge(sphere(0.035, 5).translate(x + (rnd() - 0.5) * r * 1.5, H + r * (0.9 + rnd() * 0.5), z + (rnd() - 0.5) * r * 1.5));
        }
      }
    };
    if (v === 'trough') {
      set.add(box(-L / 2, 0, -0.25, L / 2, H, 0.25), body);
      set.add(box(-L / 2 + 0.04, H - 0.02, -0.21, L / 2 - 0.04, H, 0.21), { finish: 'soil', color: '#3b2f25' });
      grow(0, 0, L / 2 - 0.15, 0.2);
      set.boxMinMax(-L / 2, 0, -0.25, L / 2, H + 0.5, 0.25);
    } else {
      const R = Math.max(0.25, L / 2);
      const prof: P2[] = v === 'urn' ? [[0.001, 0], [R * 0.45, 0], [R * 0.5, 0.04 * H], [R * 0.9, H * 0.6], [R, H], [R * 0.9, H], [R * 0.82, H * 0.9], [0.001, H * 0.9]] : [[0.001, 0], [R, 0], [R, H], [R * 0.93, H], [R * 0.93, 0.03], [0.001, 0.03]];
      set.add(lathe(prof, 22), body);
      set.add(cylinder(R * 0.86, R * 0.86, 0.02, 16).translate(0, H * 0.9 - 0.02, 0), { finish: 'soil', color: '#3b2f25' });
      grow(0, 0, R * 0.6, R * 0.6);
      set.boxMinMax(-R, 0, -R, R, H + 0.5, R);
    }
    set.add(foliage, p.str('plants') === 'grass' ? { finish: 'foliage', color: '#b9b783' } : { finish: 'foliage', color: '#3f6f34' });
    if (blooms.vertexCount > 0) set.add(blooms, { finish: 'paint', color: p.color('bloom'), roughness: 0.6 });
    return set.build();
  },
};

/** Statues, stanchions, labels, table settings, candles, columns, ceiling baffles and planters. */
export const DISPLAY: readonly FurnitureDef[] = [STATUE, ROPE_STANCHION, PLAQUE, PLACE_SETTING, CANDLE, COLUMN, CEILING_BAFFLE, PLANTER];
