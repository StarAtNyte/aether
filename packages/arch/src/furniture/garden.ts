/**
 * The lot round a dwelling: fences and walls of eight kinds (picket, post and rail, dry stone, brick, hedge, wattle,
 * bamboo, iron railing, each with an optional gate), kitchen gardens, flower borders and working yards, and a street
 * lamp. One mesh per material, instancing friendly: a lane of them is a handful of draw calls.
 */
import { Geom, box, cylinder, sphere, roundedBox } from '../mesh';
import { PartSet } from '../parts';
import { choice, color, flag, num, seeded, type FurnitureDef } from './kit';
import { cylX } from './dwelling-kit';

const paint = (c: string, roughness = 0.7) => ({ finish: 'paint' as const, color: c, roughness });
const GLOW = (k: number) => ({ preset: 'emissive' as const, color: '#ffd9a0', emissive: '#ffd9a0', emissiveIntensity: k });

const FENCE_KINDS = ['picket', 'rail', 'stone-wall', 'brick-wall', 'hedge', 'wattle', 'bamboo', 'iron'];

export const FENCE: FurnitureDef = {
  id: 'furn-fence',
  kind: 'fence',
  aliases: ['fence', 'garden fence', 'picket fence', 'post and rail fence', 'rail fence', 'stone wall', 'dry stone wall', 'drystone wall', 'field wall', 'garden wall', 'brick wall', 'hedge', 'hedgerow', 'wattle fence', 'hurdle', 'bamboo fence', 'iron railing', 'railings', 'gate', 'garden gate', 'paddock fence'],
  description:
    'A run of boundary one span long, along X (stand pieces end to end at the pitch; `shape_land along` sets `span` to the pitch by itself): `variant` picket (painted pales between posts), rail (round posts and two or three rails: a paddock or farm), stone-wall (dry-stone courses with cap stones), brick-wall (garden wall with coping), hedge (clipped, with a few lumps), wattle (woven hurdle), bamboo (canes and ties), iron (railings with finials). `gate: true` leaves a gap with a hinged gate in the middle third. `height` 0 = the variant\'s own. Colour tints the paint or timber.',
  params: {
    variant: choice(FENCE_KINDS, 'picket', 'kind of boundary'),
    span: num(2.4, 0.6, 8, 'length of this piece in metres (the pitch of a run)'),
    height: num(0, 0, 2.6, 'height in metres; 0 = the variant\'s own'),
    color: color('#efece4', 'paint or timber colour'),
    gate: flag(false, 'a gate in the middle'),
    seed: num(1, 0, 999, 'varies the stones, canes and lumps'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.2,
  size: (p) => {
    const v = p.str('variant');
    const H = p.num('height') > 0 ? p.num('height') : v === 'stone-wall' ? 0.95 : v === 'brick-wall' ? 0.95 : v === 'hedge' ? 1.15 : v === 'iron' ? 1.2 : v === 'bamboo' ? 1.5 : v === 'rail' ? 1.1 : 0.95;
    const d = v === 'stone-wall' ? 0.55 : v === 'hedge' ? 0.8 : v === 'brick-wall' ? 0.3 : 0.14;
    return [p.num('span') + 0.1, H, d];
  },
  build(p) {
    const set = new PartSet();
    const v = p.str('variant');
    const span = p.num('span');
    const rnd = seeded(Math.round(p.num('seed')) * 977 + 5);
    const H = p.num('height') > 0 ? p.num('height') : v === 'stone-wall' ? 0.95 : v === 'brick-wall' ? 0.95 : v === 'hedge' ? 1.15 : v === 'iron' ? 1.2 : v === 'bamboo' ? 1.5 : v === 'rail' ? 1.1 : 0.95;
    const hx = span / 2;
    const gateW = p.bool('gate') ? Math.min(1.1, span * 0.4) : 0;
    const inGate = (x: number): boolean => gateW > 0 && Math.abs(x) < gateW / 2 + 0.02;
    const col = p.color('color');
    if (v === 'picket' || v === 'iron' || v === 'bamboo' || v === 'wattle' || v === 'rail') {
      const posts = new Geom();
      const rails = new Geom();
      const pales = new Geom();
      const postXs = gateW > 0 ? [-hx, -gateW / 2, gateW / 2, hx] : [-hx, hx];
      for (const x of postXs) {
        if (v === 'rail' || v === 'bamboo') posts.merge(cylinder(0.065, 0.075, H + 0.1, 9).translate(x, 0, 0));
        else if (v === 'iron') posts.merge(box(x - 0.035, 0, -0.035, x + 0.035, H + 0.08, 0.035));
        else {
          posts.merge(box(x - 0.05, 0, -0.05, x + 0.05, H + 0.05, 0.05));
          posts.merge(box(x - 0.065, H + 0.05, -0.065, x + 0.065, H + 0.09, 0.065));
        }
      }
      const segs: Array<[number, number]> = gateW > 0 ? [[-hx, -gateW / 2], [gateW / 2, hx]] : [[-hx, hx]];
      for (const [a, b] of segs) {
        if (v === 'picket') {
          for (const y of [0.22, H - 0.22]) rails.merge(box(a, y - 0.04, 0.02, b, y + 0.04, 0.07));
          const n = Math.max(1, Math.floor((b - a) / 0.13));
          const pw = 0.07;
          for (let i = 0; i < n; i++) {
            const x = a + 0.08 + ((i + 0.5) * (b - a - 0.16)) / n;
            pales.merge(box(x - pw / 2, 0.05, -0.012, x + pw / 2, H - 0.06, 0.02));
            pales.merge(box(x - pw / 2 + 0.01, H - 0.06, -0.012, x + pw / 2 - 0.01, H - 0.025, 0.02));
          }
        } else if (v === 'rail') {
          for (const y of [H * 0.45, H * 0.92]) rails.merge(box(a, y - 0.04, -0.03, b, y + 0.04, 0.03));
        } else if (v === 'iron') {
          for (const y of [0.18, H - 0.1]) rails.merge(box(a, y - 0.02, -0.015, b, y + 0.02, 0.015));
          const n = Math.max(1, Math.floor((b - a) / 0.12));
          for (let i = 0; i < n; i++) {
            const x = a + ((i + 0.5) * (b - a)) / n;
            pales.merge(box(x - 0.011, 0.05, -0.011, x + 0.011, H - 0.02, 0.011));
            pales.merge(box(x - 0.022, H - 0.02, -0.022, x + 0.022, H + 0.07, 0.022));
          }
        } else if (v === 'bamboo') {
          const n = Math.max(1, Math.floor((b - a) / 0.07));
          for (let i = 0; i < n; i++) {
            const x = a + ((i + 0.5) * (b - a)) / n;
            pales.merge(cylinder(0.021, 0.021, H - 0.05 + rnd() * 0.12, 6).translate(x, 0, rnd() * 0.012));
          }
          for (const y of [0.35, H * 0.62, H - 0.15]) rails.merge(box(a, y - 0.02, 0.03, b, y + 0.02, 0.06));
        } else {
          // Wattle: uprights and woven withies alternating in front of and behind them.
          const n = Math.max(2, Math.floor((b - a) / 0.2));
          for (let i = 0; i < n; i++) {
            const x = a + ((i + 0.5) * (b - a)) / n;
            pales.merge(cylinder(0.022, 0.022, H, 6).translate(x, 0, 0));
          }
          const rowsN = Math.floor(H / 0.07);
          for (let r = 0; r < rowsN; r++) {
            const y = 0.06 + r * 0.07;
            const nn = Math.floor((b - a) / 0.2);
            for (let i = 0; i < nn; i++) {
              const x = a + ((i + 0.5) * (b - a)) / nn;
              const side = (i + r) % 2 === 0 ? 1 : -1;
              rails.merge(box(x - 0.1, y - 0.016, side * 0.026 - 0.014, x + 0.1, y + 0.016, side * 0.026 + 0.014));
            }
          }
        }
      }
      const timberFinish = v === 'bamboo' ? ({ finish: 'oak' as const, color: '#b9a35a' }) : v === 'wattle' || v === 'rail' ? ({ finish: 'bark' as const, color: v === 'rail' ? '#7a6a52' : '#6a5440' }) : v === 'iron' ? ({ finish: 'black-metal' as const, color: '#222326' }) : paint(col, 0.65);
      set.add(posts, v === 'picket' ? paint(col, 0.65) : timberFinish);
      set.add(rails, v === 'picket' ? paint(col, 0.65) : v === 'wattle' ? { finish: 'oak' as const, color: '#8a6a44' } : timberFinish);
      set.add(pales, v === 'picket' ? paint(col, 0.65) : v === 'wattle' ? { finish: 'bark' as const, color: '#6a5440' } : timberFinish);
      if (gateW > 0) {
        const gate = new Geom();
        const g0 = -gateW / 2 + 0.05;
        const g1 = gateW / 2 - 0.05;
        const lo = 0.14;
        const hi = H - 0.12;
        gate.merge(box(g0, lo - 0.04, 0.0, g1, lo + 0.04, 0.05));
        gate.merge(box(g0, hi - 0.04, 0.0, g1, hi + 0.04, 0.05));
        gate.merge(box(g0, lo, 0.0, g0 + 0.07, hi, 0.05));
        gate.merge(box(g1 - 0.07, lo, 0.0, g1, hi, 0.05));
        const diag = Math.hypot(g1 - g0, hi - lo);
        gate.merge(box(-0.025, -diag / 2, 0.0, 0.025, diag / 2, 0.04).rotateZ((Math.atan2(g1 - g0, hi - lo) * 180) / Math.PI).translate((g0 + g1) / 2, (lo + hi) / 2, 0.01));
        for (let i = 0; i < 4; i++) gate.merge(box(g0 + 0.07 + ((i + 0.5) * (g1 - g0 - 0.14)) / 4 - 0.025, lo + 0.04, 0.0, g0 + 0.07 + ((i + 0.5) * (g1 - g0 - 0.14)) / 4 + 0.025, hi - 0.04, 0.03));
        set.add(gate, v === 'iron' ? timberFinish : v === 'picket' ? paint(col, 0.65) : { finish: 'oak' as const, color: '#7a6248' });
      }
      const th = v === 'wattle' ? 0.1 : 0.14;
      if (gateW > 0) {
        set.boxMinMax(-hx, 0, -th / 2, -gateW / 2, H, th / 2);
        set.boxMinMax(gateW / 2, 0, -th / 2, hx, H, th / 2);
      } else set.boxMinMax(-hx, 0, -th / 2, hx, H, th / 2);
    } else if (v === 'stone-wall') {
      const stones = new Geom();
      const caps = new Geom();
      const courses = Math.max(3, Math.round(H / 0.17));
      const ch = H / courses;
      for (let c = 0; c < courses; c++) {
        let x = -hx;
        while (x < hx - 0.05) {
          const len = Math.min(hx - x, 0.3 + rnd() * 0.32);
          const inset = c * 0.012;
          const thick = 0.5 - inset * 0.9 + (rnd() - 0.5) * 0.04;
          if (!(gateW > 0 && x + len > -gateW / 2 && x < gateW / 2)) stones.merge(roundedBox(len - 0.012, ch - 0.012, thick, 0.03, 1).translate(x + len / 2, c * ch + ch / 2, (rnd() - 0.5) * 0.03));
          x += len;
        }
      }
      let x = -hx;
      while (x < hx - 0.05) {
        const len = Math.min(hx - x, 0.36 + rnd() * 0.3);
        if (!(gateW > 0 && x + len > -gateW / 2 && x < gateW / 2)) caps.merge(roundedBox(len - 0.01, 0.12, 0.42, 0.045, 2).translate(x + len / 2, H + 0.05, 0));
        x += len;
      }
      set.add(stones, { finish: 'limestone' as const, color: p.color('color') === '#efece4' ? '#a59d8c' : p.color('color') });
      set.add(caps, { finish: 'limestone' as const, color: '#b3aa97' });
      if (gateW > 0) {
        set.boxMinMax(-hx, 0, -0.27, -gateW / 2, H, 0.27);
        set.boxMinMax(gateW / 2, 0, -0.27, hx, H, 0.27);
      } else set.boxMinMax(-hx, 0, -0.27, hx, H, 0.27);
    } else if (v === 'brick-wall') {
      const wall = new Geom();
      const cap = new Geom();
      const piers = new Geom();
      const runs: Array<[number, number]> = gateW > 0 ? [[-hx, -gateW / 2], [gateW / 2, hx]] : [[-hx, hx]];
      for (const [a, b] of runs) {
        wall.merge(box(a, 0, -0.11, b, H, 0.11));
        cap.merge(box(a - 0.02, H, -0.15, b + 0.02, H + 0.07, 0.15));
      }
      for (const x of gateW > 0 ? [-hx, -gateW / 2, gateW / 2, hx] : [-hx, hx]) piers.merge(box(x - 0.2, 0, -0.2, x + 0.2, H + 0.1, 0.2));
      set.add(wall, { finish: 'brick' as const, color: p.color('color') === '#efece4' ? '#9a5a44' : p.color('color') });
      set.add(piers, { finish: 'brick' as const, color: '#8d5340' });
      set.add(cap, { finish: 'limestone' as const, color: '#b9b2a3' });
      for (const [a, b] of runs) set.boxMinMax(a, 0, -0.15, b, H, 0.15);
    } else {
      // Clipped hedge: a rounded body and lumps that break the line; a gate leaves a gap in the middle.
      const body = new Geom();
      const runs: Array<[number, number]> = gateW > 0 ? [[-hx, -gateW / 2], [gateW / 2, hx]] : [[-hx, hx]];
      for (const [a, b] of runs) {
        body.merge(roundedBox(b - a, H, 0.7, 0.16, 3).translate((a + b) / 2, H / 2, 0));
        const n = Math.max(2, Math.round((b - a) / 0.35));
        for (let i = 0; i < n; i++) {
          const x = a + 0.15 + ((i + rnd() * 0.4) * (b - a - 0.3)) / n;
          body.merge(sphere(0.2 + rnd() * 0.1, 6).translate(x, H - 0.05 + rnd() * 0.1, (rnd() - 0.5) * 0.4));
        }
        set.boxMinMax(a, 0, -0.35, b, H, 0.35);
      }
      set.add(body, { finish: 'foliage' as const, color: p.color('color') === '#efece4' ? '#4f7340' : p.color('color') });
    }
    return set.build();
  },
};

export const GARDEN: FurnitureDef = {
  id: 'furn-garden',
  kind: 'garden',
  aliases: ['garden', 'kitchen garden', 'vegetable garden', 'vegetable patch', 'allotment', 'flower bed', 'flower border', 'herb garden', 'yard', 'farmyard', 'woodpile', 'garden plot', 'raised beds'],
  description:
    'A garden plot lying on the ground: `variant` kitchen-garden (raised timber beds of cabbages, leeks and beans on poles, a path between), flowers (borders of clumped perennials in two or three colours, a bench), yard (woodpile, chopping block with an axe, a water barrel, a handcart). `width` x `depth` metres. Origin at the centre, y = 0.',
  params: {
    variant: choice(['kitchen-garden', 'flowers', 'yard'], 'kitchen-garden', 'kind of plot'),
    width: num(5, 1.5, 20, 'width along X'),
    depth: num(4, 1.5, 20, 'depth along Z'),
    seed: num(1, 0, 999, 'varies the planting'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0,
  size: (p) => [p.num('width'), 1.5, p.num('depth')],
  build(p) {
    const set = new PartSet();
    const v = p.str('variant');
    const W = p.num('width');
    const D = p.num('depth');
    const rnd = seeded(Math.round(p.num('seed')) * 613 + 9);
    const hx = W / 2;
    const hz = D / 2;
    const soil = new Geom();
    const leaves = new Geom();
    const leaves2 = new Geom();
    const wood = new Geom();
    const bloomA = new Geom();
    const bloomB = new Geom();
    const bloomC = new Geom();
    const grass = new Geom();
    if (v === 'kitchen-garden') {
      const beds = Math.max(2, Math.min(5, Math.floor(W / 1.5)));
      const bw = (W - 0.4 - (beds - 1) * 0.5) / beds;
      for (let b = 0; b < beds; b++) {
        const x0 = -hx + 0.2 + b * (bw + 0.5);
        const x1 = x0 + bw;
        const z0 = -hz + 0.2;
        const z1 = hz - 0.2;
        wood.merge(box(x0 - 0.04, 0, z0 - 0.04, x1 + 0.04, 0.22, z0));
        wood.merge(box(x0 - 0.04, 0, z1, x1 + 0.04, 0.22, z1 + 0.04));
        wood.merge(box(x0 - 0.04, 0, z0, x0, 0.22, z1));
        wood.merge(box(x1, 0, z0, x1 + 0.04, 0.22, z1));
        soil.merge(box(x0, 0, z0, x1, 0.18, z1));
        const kind = (b + Math.floor(rnd() * 3)) % 3;
        const nz = Math.max(2, Math.floor((z1 - z0) / 0.42));
        const nx = Math.max(1, Math.floor(bw / 0.4));
        for (let i = 0; i < nz; i++) {
          for (let j = 0; j < nx; j++) {
            const x = x0 + ((j + 0.5) * bw) / nx;
            const z = z0 + ((i + 0.5) * (z1 - z0)) / nz;
            if (kind === 0) leaves.merge(sphere(0.15 + rnd() * 0.04, 6).scale(1, 0.7, 1).translate(x, 0.24, z));
            else if (kind === 1) leaves2.merge(cylinder(0.03, 0.07, 0.34 + rnd() * 0.12, 6).translate(x, 0.18, z));
            else {
              if (i % 3 === 0) {
                wood.merge(cylinder(0.014, 0.014, 1.3, 5).translate(x, 0.18, z));
                leaves.merge(cylinder(0.05, 0.02, 1.0, 5).translate(x, 0.3, z));
              }
            }
          }
        }
      }
      set.boxMinMax(-hx, 0, -hz, hx, 0.25, hz);
    } else if (v === 'flowers') {
      const bordW = Math.min(1.1, D * 0.3);
      for (const [x0, x1, z0, z1] of [[-hx, hx, -hz, -hz + bordW], [-hx, hx, hz - bordW, hz], [-hx, -hx + bordW, -hz + bordW, hz - bordW], [hx - bordW, hx, -hz + bordW, hz - bordW]] as const) {
        soil.merge(box(x0, 0, z0, x1, 0.08, z1));
        const n = Math.max(3, Math.round(((x1 - x0) * (z1 - z0)) / 0.28));
        for (let i = 0; i < n; i++) {
          const x = x0 + 0.1 + rnd() * (x1 - x0 - 0.2);
          const z = z0 + 0.1 + rnd() * (z1 - z0 - 0.2);
          const h = 0.18 + rnd() * 0.3;
          leaves.merge(sphere(0.13 + rnd() * 0.06, 4).scale(1, h / 0.2, 1).translate(x, 0.08 + h * 0.4, z));
          const c = rnd();
          (c < 0.4 ? bloomA : c < 0.75 ? bloomB : bloomC).merge(sphere(0.055 + rnd() * 0.03, 4).translate(x + (rnd() - 0.5) * 0.08, 0.1 + h * 0.9, z + (rnd() - 0.5) * 0.08));
        }
      }
      grass.merge(box(-hx + bordW, 0, -hz + bordW, hx - bordW, 0.02, hz - bordW));
      set.boxMinMax(-hx, 0, -hz, hx, 0.3, hz);
    } else {
      // Yard: a woodpile, a block, a barrel, a cart.
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 8 - r; c++) wood.merge(cylX(0.07, 0.07, 1.1, 8).translate(-hx + 0.9, 0.07 + r * 0.125, -hz + 0.5 + c * 0.15 + r * 0.075));
      }
      soil.merge(cylinder(0.22, 0.2, 0.42, 10).translate(hx - 1.0, 0, -hz + 0.6));
      wood.merge(cylinder(0.24, 0.24, 0.9, 12).translate(hx - 0.5, 0, hz - 0.8));
      wood.merge(box(hx - 1.7, 0.28, hz - 1.4, hx - 0.9, 0.34, hz - 0.5));
      for (const sx of [-1, 1]) wood.merge(cylX(0.3, 0.3, 0.05, 12).translate(hx - 1.3 + sx * 0.45, 0.3, hz - 0.95));
      set.boxMinMax(-hx + 0.3, 0, -hz + 0.3, -hx + 1.6, 0.6, hz - 0.3);
    }
    set.add(soil, { finish: 'soil' as const, color: v === 'yard' ? '#7a6248' : '#4d3a28' });
    set.add(grass, { finish: 'grass' as const, color: '#5f8a3c' });
    set.add(wood, { finish: 'oak' as const, color: v === 'yard' ? '#8a6a48' : '#7a6248' });
    set.add(leaves, { finish: 'foliage' as const, color: '#5f7d45' });
    set.add(leaves2, { finish: 'foliage' as const, color: '#7d9a52' });
    set.add(bloomA, paint('#c43d3d', 0.8));
    set.add(bloomB, paint('#e0b23a', 0.8));
    set.add(bloomC, paint('#d9d4e8', 0.8));
    return set.build();
  },
};

export const STREET_LAMP: FurnitureDef = {
  id: 'furn-street-lamp',
  kind: 'street-lamp',
  aliases: ['street lamp', 'street light', 'streetlamp', 'streetlight', 'lamp post', 'lamppost', 'gas lamp', 'village lamp', 'lantern post', 'road lamp', 'iron lamp post', 'wall lantern', 'street lantern'],
  description:
    'A street lamp: `variant` post (cast-iron column on a fluted base with a glass lantern, 3.4 m), bracket (a wall lantern on a scrolled arm), hanging (a lantern on a bracket arm hung over a lane). The pane glows warmly (`glow` = emissive strength); an instanced lamp lights nothing by itself, so set `light` on the shape_land along call to give every Nth one a real light. Origin at the foot.',
  params: {
    variant: choice(['post', 'bracket', 'hanging'], 'post', 'kind of lamp'),
    height: num(0, 0, 6, 'height in metres; 0 = the variant\'s own'),
    iron: color('#2a2c2e', 'iron colour'),
    glow: num(0.8, 0, 3, 'glass glow strength'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.3,
  size: (p) => {
    const v = p.str('variant');
    const H = p.num('height') > 0 ? p.num('height') : v === 'post' ? 3.4 : 2.4;
    return v === 'post' ? [0.5, H, 0.5] : [0.9, H, 0.5];
  },
  build(p) {
    const set = new PartSet();
    const v = p.str('variant');
    const H = p.num('height') > 0 ? p.num('height') : v === 'post' ? 3.4 : 2.4;
    const iron = { finish: 'black-metal' as const, color: p.color('iron'), roughness: 0.5 };
    const g = new Geom();
    const glass = new Geom();
    const lantern = (x: number, y: number, z: number, s: number): void => {
      g.merge(cylinder(0.11 * s, 0.07 * s, 0.05 * s, 8).translate(x, y, z));
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        g.merge(cylinder(0.011 * s, 0.011 * s, 0.34 * s, 5).translate(x + Math.cos(a) * 0.1 * s, y + 0.05 * s, z + Math.sin(a) * 0.1 * s));
      }
      glass.merge(cylinder(0.09 * s, 0.1 * s, 0.32 * s, 8).translate(x, y + 0.06 * s, z));
      g.merge(cylinder(0.0, 0.17 * s, 0.14 * s, 8).translate(x, y + 0.4 * s, z));
      g.merge(sphere(0.03 * s, 5).translate(x, y + 0.56 * s, z));
    };
    if (v === 'post') {
      g.merge(cylinder(0.17, 0.12, 0.28, 10).translate(0, 0, 0));
      g.merge(cylinder(0.1, 0.075, H * 0.28, 10).translate(0, 0.28, 0));
      g.merge(cylinder(0.055, 0.045, H - 0.28 - H * 0.28 - 0.5, 9).translate(0, 0.28 + H * 0.28, 0));
      g.merge(cylinder(0.09, 0.09, 0.05, 10).translate(0, 0.28 + H * 0.28, 0));
      g.merge(cylinder(0.08, 0.08, 0.04, 10).translate(0, H - 0.6, 0));
      lantern(0, H - 0.56, 0, 1);
      set.boxMinMax(-0.14, 0, -0.14, 0.14, H, 0.14);
    } else {
      // A scrolled arm out from the wall (the wall is at z = -0.05).
      g.merge(box(-0.04, H - 0.9, -0.08, 0.04, H - 0.5, -0.04));
      g.merge(box(-0.012, H - 0.74, -0.06, 0.012, H - 0.7, 0.42));
      g.merge(cylinder(0.01, 0.01, 0.45, 5).rotateX(-50).translate(0, H - 0.7, 0));
      g.merge(box(-0.012, H - 0.52, -0.06, 0.012, H - 0.48, 0.3));
      if (v === 'hanging') g.merge(cylinder(0.008, 0.008, 0.2, 5).translate(0, H - 0.95, 0.42));
      lantern(0, v === 'hanging' ? H - 1.45 : H - 0.64, 0.42, 0.85);
      set.boxMinMax(-0.1, H - 1.6, -0.08, 0.1, H - 0.4, 0.5);
    }
    set.add(g, iron);
    if (p.num('glow') > 0) set.add(glass, GLOW(p.num('glow')));
    else set.add(glass, { finish: 'glass' as const });
    return set.build();
  },
};

export const GARDEN_PIECES: readonly FurnitureDef[] = [FENCE, GARDEN, STREET_LAMP];
