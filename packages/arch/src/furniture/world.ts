/**
 * Pieces of gyms, clinics and streets: treadmill, weight bench and rack, dumbbell rack, hospital bed, bus shelter and market
 * stall. One mesh per material, instancing-friendly, each a few thousand triangles at most.
 */
import { Geom, box, cylinder, roundedBox, sphere } from '../mesh';
import { PartSet } from '../parts';
import { choice, color, flag, mat, num, seeded, type FurnitureDef } from './kit';
import { bevelSlab, prismX } from './venue-kit';

const paint = (c: string, roughness = 0.6) => ({ finish: 'paint' as const, color: c, roughness });
const EMISSIVE = (c: string, k: number) => ({ preset: 'emissive' as const, color: c, emissive: c, emissiveIntensity: k });

// ---------------------------------------------------------------------------
// Gym
// ---------------------------------------------------------------------------

export const TREADMILL: FurnitureDef = {
  id: 'furn-treadmill',
  kind: 'treadmill',
  description: 'Gym treadmill: motor housing, a ribbed running belt on side rails, two handrails and an upright console with a lit display. The runner faces +Z (towards the console). 0.9 x 1.5 x 1.9 m.',
  aliases: ['treadmill', 'running machine', 'cardio machine', 'gym treadmill'],
  params: {
    body: color('#2a2d33', 'frame colour'),
    accent: color('#e0462e', 'trim colour'),
    display: flag(true, 'console display lit'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.8,
  size: () => [0.9, 1.5, 1.9],
  build(p) {
    const set = new PartSet();
    const body = paint(p.color('body'), 0.5);
    const z0 = -0.95;
    const z1 = 0.95;
    // Base frame and belt.
    set.add(box(-0.37, 0.12, z0, 0.37, 0.24, z1 - 0.15), body);
    for (const s of [-1, 1] as const) set.add(roundedBox(0.09, 0.14, 1.85, 0.03, 2).translate(s * 0.33, 0.2, 0), paint('#1b1c20', 0.6));
    const belt = new Geom().quadAuto([-0.26, 0.255, z0 + 0.05], [0.26, 0.255, z0 + 0.05], [0.26, 0.255, z1 - 0.2], [-0.26, 0.255, z1 - 0.2]);
    set.add(belt, paint('#16171a', 0.9));
    const ribs = new Geom();
    for (let z = z0 + 0.1; z < z1 - 0.25; z += 0.06) ribs.merge(box(-0.25, 0.255, z, 0.25, 0.262, z + 0.012));
    set.add(ribs, paint('#2e3036', 0.85));
    set.add(roundedBox(0.72, 0.26, 0.4, 0.05, 2).translate(0, 0.2, z1 - 0.1), paint(p.color('accent'), 0.45));
    // Feet.
    for (const sx of [-1, 1] as const) for (const sz of [z0 + 0.1, z1 - 0.2]) set.add(cylinder(0.035, 0.04, 0.12, 8).translate(sx * 0.33, 0, sz), paint('#0d0d0f'));
    // Uprights, handrails, console.
    const uprights = new Geom();
    for (const s of [-1, 1] as const) {
      uprights.merge(cylinder(0.025, 0.025, 1.0, 10).rotateX(-12).translate(s * 0.36, 0.2, z1 - 0.2));
      uprights.merge(cylinder(0.022, 0.022, 0.78, 10).rotateX(88).translate(s * 0.36, 1.12, z1 - 0.28 - 0.78));
    }
    set.add(uprights, mat('chrome'));
    set.add(roundedBox(0.7, 0.3, 0.14, 0.04, 2).rotateX(-28).translate(0, 1.22, z1 - 0.32), body);
    if (p.bool('display')) set.add(new Geom().quadAuto([-0.26, 1.15, z1 - 0.255], [0.26, 1.15, z1 - 0.255], [0.26, 1.33, z1 - 0.33], [-0.26, 1.33, z1 - 0.33]).translate(0, 0, 0.012), EMISSIVE('#6cd4ff', 1.6));
    set.add(cylinder(0.012, 0.012, 0.2, 8).rotateZ(90).translate(0.1, 1.05, z1 - 0.3), paint(p.color('accent')));
    set.boxMinMax(-0.4, 0, z0, 0.4, 0.3, z1);
    set.boxMinMax(-0.4, 0.3, z1 - 0.4, 0.4, 1.4, z1);
    return set.build();
  },
};

export const WEIGHT_BENCH: FurnitureDef = {
  id: 'furn-weight-bench',
  kind: 'weight-bench',
  description: 'Weight training: `variant` flat (padded bench on a steel frame), incline (adjustable back at 40 degrees) or rack (power rack with a loaded barbell and a flat bench). Head at -Z for the bench, the lifter faces +Z at the rack.',
  aliases: ['weight bench', 'gym bench', 'bench press', 'squat rack', 'power rack', 'barbell rack', 'weight rack'],
  params: {
    variant: choice(['flat', 'incline', 'rack'], 'flat', 'flat bench, incline bench or power rack with barbell'),
    pad: color('#1f2226', 'pad colour'),
    frame: color('#c0392b', 'frame colour'),
    plates: choice(['2', '4', '6'], '4', 'plates on each end of the barbell (rack)'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 1,
  size: (p) => (p.str('variant') === 'rack' ? [2.2, 2.2, 1.9] : [0.55, 0.5, 1.35]),
  build(p) {
    const set = new PartSet();
    const frame = paint(p.color('frame'), 0.4);
    const pad = paint(p.color('pad'), 0.55);
    const v = p.str('variant');
    const bench = (z: number): void => {
      const fr = new Geom();
      fr.merge(box(-0.03, 0.18, z - 0.55, 0.03, 0.23, z + 0.5));
      for (const dz of [-0.5, 0.42]) fr.merge(box(-0.28, 0.0, z + dz - 0.04, 0.28, 0.04, z + dz + 0.04));
      for (const dz of [-0.5, 0.42]) for (const sx of [-1, 1] as const) fr.merge(box(sx * 0.12 - 0.02, 0.04, z + dz - 0.02, sx * 0.12 + 0.02, 0.2, z + dz + 0.02));
      set.add(fr, frame);
      const inclined = v === 'incline';
      set.add(roundedBox(0.28, 0.07, 0.55, 0.025, 2).translate(0, 0.46, z + 0.2), pad);
      const back = roundedBox(0.28, 0.07, 0.62, 0.025, 2);
      if (inclined) back.rotateX(40).translate(0, 0.62, z - 0.28);
      else back.translate(0, 0.46, z - 0.4);
      set.add(back, pad);
      set.box([0, 0.25, z], [0.3, 0.25, 0.6]);
    };
    if (v !== 'rack') {
      bench(0);
      return set.build();
    }
    // Power rack: four uprights, J-hooks, a barbell with plates, safety bars and a bench in front.
    const W = 1.5;
    const D = 1.2;
    const up = new Geom();
    for (const sx of [-1, 1] as const) for (const sz of [-1, 1] as const) up.merge(box(sx * W / 2 - 0.04, 0, sz * D / 2 - 0.04, sx * W / 2 + 0.04, 2.2, sz * D / 2 + 0.04));
    for (const sx of [-1, 1] as const) {
      up.merge(box(sx * W / 2 - 0.04, 0, -D / 2, sx * W / 2 + 0.04, 0.08, D / 2));
      up.merge(box(sx * W / 2 - 0.04, 2.14, -D / 2, sx * W / 2 + 0.04, 2.2, D / 2));
    }
    up.merge(box(-W / 2, 2.14, -D / 2 - 0.04, W / 2, 2.2, -D / 2 + 0.04));
    up.merge(box(-W / 2, 2.14, D / 2 - 0.04, W / 2, 2.2, D / 2 + 0.04));
    set.add(up, frame);
    const steel = new Geom();
    const barY = 1.4;
    const barZ = -D / 2 + 0.18;
    steel.merge(cylinder(0.014, 0.014, 2.2, 10).rotateZ(90).translate(1.1, barY, barZ));
    for (const sx of [-1, 1] as const) {
      steel.merge(box(sx * W / 2 - 0.045, barY - 0.1, barZ - 0.06, sx * W / 2 + 0.045, barY - 0.02, barZ + 0.06));
      steel.merge(box(sx * W / 2 - 0.045, 0.5, D / 2 - 0.1, sx * W / 2 + 0.045, 0.56, D / 2 + 0.2 - 0.04));
    }
    set.add(steel, mat('chrome'));
    const plates = new Geom();
    const n = Number(p.str('plates'));
    for (const sx of [-1, 1] as const) {
      for (let k = 0; k < n / 2; k++) {
        const r = 0.225 - k * 0.012;
        plates.merge(cylinder(r, r, 0.03, 20).rotateZ(90).translate(sx * (0.62 + k * 0.035) + (sx > 0 ? 0.03 : 0), barY, barZ));
      }
    }
    set.add(plates, paint('#1a1a1c', 0.35));
    bench(D / 2 + 0.55);
    set.boxMinMax(-W / 2 - 0.05, 0, -D / 2 - 0.05, W / 2 + 0.05, 2.2, D / 2 + 0.05);
    return set.build();
  },
};

export const DUMBBELL_RACK: FurnitureDef = {
  id: 'furn-dumbbell-rack',
  kind: 'dumbbell-rack',
  description: 'Two-tier steel dumbbell rack with ten pairs of hexagonal rubber dumbbells in graded sizes; front +Z. 1.8 x 0.85 x 0.5 m.',
  aliases: ['dumbbell rack', 'dumbbells', 'weights rack', 'free weights'],
  params: { frame: color('#25272b', 'frame colour') },
  mount: 'floor',
  againstWall: true,
  frontClearance: 0.9,
  size: () => [1.8, 0.85, 0.5],
  build(p) {
    const set = new PartSet();
    const fr = new Geom();
    for (const sx of [-1, 1] as const) for (const sz of [-1, 1] as const) fr.merge(box(sx * 0.88 - 0.025, 0, sz * 0.2 - 0.025, sx * 0.88 + 0.025, 0.78, sz * 0.2 + 0.025));
    for (const y of [0.45, 0.78]) {
      fr.merge(box(-0.9, y - 0.03, -0.22, 0.9, y, 0.22));
      fr.merge(box(-0.9, y, -0.22, 0.9, y + 0.06, -0.2));
    }
    set.add(fr, paint(p.color('frame'), 0.45));
    const heads = new Geom();
    const handles = new Geom();
    for (let k = 0; k < 10; k++) {
      const y = k < 5 ? 0.78 : 0.45;
      const r = 0.05 + (k % 5) * 0.008;
      const hl = 0.13 + (k % 5) * 0.012;
      const x = -0.7 + (k % 5) * 0.35 + 0.05;
      handles.merge(cylinder(0.0155, 0.0155, 0.17, 8).rotateZ(90).translate(x + 0.085, y + r + 0.0, 0.02 - 0.0));
      for (const side of [0, 1]) heads.merge(cylinder(r, r, hl * 0.5, 6).rotateZ(90).translate(x - (side ? 0 : hl * 0.5) + (side ? 0.17 : 0), y + r + 0.0, 0.02));
    }
    set.add(heads, paint('#17181a', 0.7));
    set.add(handles, mat('chrome'));
    set.boxMinMax(-0.9, 0, -0.22, 0.9, 0.78, 0.22);
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Hospital bed
// ---------------------------------------------------------------------------

export const HOSPITAL_BED: FurnitureDef = {
  id: 'furn-hospital-bed',
  kind: 'hospital-bed',
  description: 'Hospital bed on casters: steel frame, a mattress with a raised back section, fold-up side rails, head and foot boards, a sheet and a blanket, with an optional IV pole. Head at -Z, 0.95 x 1.1 x 2.1 m.',
  aliases: ['hospital bed', 'medical bed', 'patient bed', 'clinic bed', 'care bed', 'sickbed'],
  params: {
    back: num(30, 0, 70, 'angle of the raised back section (degrees)'),
    linen: color('#e6eef2', 'sheet colour'),
    blanket: color('#6c9bb0', 'blanket colour'),
    ivPole: flag(false, 'IV pole at the head'),
  },
  mount: 'floor',
  againstWall: true,
  frontClearance: 1,
  size: (p) => [0.95, p.bool('ivPole') ? 2.0 : 1.1, 2.1],
  build(p) {
    const set = new PartSet();
    const steel = mat('brushed-metal');
    const white = paint('#dfe3e6', 0.5);
    const fr = new Geom();
    fr.merge(box(-0.4, 0.3, -1.0, 0.4, 0.34, 1.0));
    for (const sx of [-1, 1] as const) fr.merge(box(sx * 0.4 - 0.02, 0.28, -1.0, sx * 0.4 + 0.02, 0.36, 1.0));
    fr.merge(box(-0.35, 0.18, -0.7, 0.35, 0.3, 0.7));
    set.add(fr, steel);
    // Casters.
    const wheels = new Geom();
    for (const sx of [-1, 1] as const) for (const sz of [-0.8, 0.8]) {
      wheels.merge(box(sx * 0.33 - 0.015, 0.1, sz - 0.015, sx * 0.33 + 0.015, 0.2, sz + 0.015));
      wheels.merge(cylinder(0.055, 0.055, 0.04, 14).rotateZ(90).translate(sx * 0.33 + 0.02, 0.055, sz));
    }
    set.add(wheels, paint('#222428', 0.7));
    // Mattress: a flat part and a raised back section hinged at the hips.
    const hipZ = -0.2;
    const back = p.num('back');
    const matt = new Geom();
    matt.merge(roundedBox(0.84, 0.14, 1.3, 0.04, 2).translate(0, 0.43, hipZ + 0.65 + 0.0 - 0.0));
    const raised = roundedBox(0.84, 0.12, 0.8, 0.04, 2).translate(0, 0.0, -0.4).rotateX(back).translate(0, 0.5, hipZ);
    matt.merge(raised);
    set.add(matt, { finish: 'fabric', color: '#5d7f93' });
    // Linen over the lower part and a folded blanket.
    set.add(roundedBox(0.88, 0.05, 1.05, 0.02, 2).translate(0, 0.52, hipZ + 0.75), { finish: 'fabric', color: p.color('blanket') });
    set.add(roundedBox(0.86, 0.03, 0.8, 0.015, 2).translate(0, 0.0, -0.4).rotateX(back).translate(0, 0.55, hipZ), { finish: 'fabric', color: p.color('linen') });
    set.add(roundedBox(0.46, 0.09, 0.3, 0.035, 2).translate(0, 0.1, -0.62).rotateX(back).translate(0, 0.5, hipZ), { finish: 'fabric', color: '#f4f6f7' });
    // Head and foot boards.
    const boards = new Geom();
    boards.merge(roundedBox(0.92, 0.5, 0.05, 0.02, 2).translate(0, 0.62, -1.05));
    boards.merge(roundedBox(0.92, 0.42, 0.05, 0.02, 2).translate(0, 0.58, 1.03));
    set.add(boards, mat('walnut'));
    // Side rails (up).
    const rails = new Geom();
    for (const sx of [-1, 1] as const) {
      for (const y of [0.72, 0.84]) rails.merge(cylinder(0.012, 0.012, 1.0, 8).rotateX(90).translate(sx * 0.46, y, -0.5));
      for (const z of [-0.5, -0.1, 0.4]) rails.merge(cylinder(0.011, 0.011, 0.14, 8).translate(sx * 0.46, 0.72, z - 0.0));
    }
    set.add(rails, mat('chrome'));
    if (p.bool('ivPole')) {
      const iv = new Geom();
      iv.merge(cylinder(0.012, 0.012, 1.9, 8).translate(0.55, 0.0, -0.95));
      iv.merge(cylinder(0.25, 0.25, 0.02, 5).translate(0.55, 0.0, -0.95));
      iv.merge(cylinder(0.01, 0.01, 0.5, 6).rotateZ(90).translate(0.3, 1.9, -0.95));
      set.add(iv, mat('chrome'));
      set.add(sphere(0.06, 10).scale(1, 1.6, 1).translate(0.42, 1.74, -0.95), { finish: 'glass', color: '#d8ecf2', opacity: 0.5 });
    }
    set.boxMinMax(-0.48, 0.1, -1.08, 0.48, 0.9, 1.06);
    return set.build();
  },
};

// ---------------------------------------------------------------------------
// Street: bus shelter and market stall
// ---------------------------------------------------------------------------

export const BUS_STOP: FurnitureDef = {
  id: 'furn-bus-stop',
  kind: 'bus-stop',
  description: 'Bus shelter: a steel frame with a curved roof, glazed back and one glazed end, a slat bench, a lit advertising panel and a stop pole with a sign. Open to +Z (the road is at +Z). 4.0 x 2.7 x 1.7 m with the pole.',
  aliases: ['bus stop', 'bus shelter', 'tram stop', 'transit shelter', 'bus station'],
  params: {
    frame: color('#2c3138', 'frame colour'),
    ad: flag(true, 'a lit advertising panel on the end'),
    sign: color('#f2b01e', 'stop sign colour'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 1.5,
  size: () => [4.0, 2.7, 1.7],
  build(p) {
    const set = new PartSet();
    const W = 3.0;
    const D = 1.3;
    const H = 2.4;
    const frame = paint(p.color('frame'), 0.45);
    const fr = new Geom();
    for (const sx of [-1, 1] as const) for (const sz of [-1, 1] as const) fr.merge(box(sx * W / 2 - 0.04, 0, sz * D / 2 - 0.04, sx * W / 2 + 0.04, H, sz * D / 2 + 0.04));
    fr.merge(box(-W / 2, 0.0, -D / 2, W / 2, 0.1, -D / 2 + 0.06));
    fr.merge(box(-W / 2, H - 0.06, -D / 2, W / 2, H, D / 2));
    fr.merge(box(-W / 2 + 0.0, 1.05, -D / 2, W / 2, 1.09, -D / 2 + 0.05));
    set.add(fr, frame);
    // Roof: a shallow shed profile with an overhang.
    set.add(prismX([[-D / 2 - 0.15, H], [D / 2 + 0.3, H], [D / 2 + 0.3, H + 0.06], [-D / 2 - 0.15, H + 0.16]], -W / 2 - 0.15, W / 2 + 0.15), paint('#cfd3d6', 0.6));
    // Glazing: back and one end.
    const glass = { finish: 'glass' as const, color: '#cfe3e8', opacity: 0.22 };
    set.add(box(-W / 2 + 0.04, 0.1, -D / 2 + 0.01, W / 2 - 0.04, H - 0.06, -D / 2 + 0.03), glass);
    set.add(box(W / 2 - 0.03, 0.1, -D / 2 + 0.06, W / 2 - 0.02, H - 0.06, D / 2 - 0.04), glass);
    // Bench: slats on two bars.
    const bench = new Geom();
    for (let k = 0; k < 4; k++) bench.merge(box(-W / 2 + 0.4, 0.44, -D / 2 + 0.12 + k * 0.1, W / 2 - 1.0, 0.47, -D / 2 + 0.19 + k * 0.1));
    set.add(bench, mat('oak'));
    const legs = new Geom();
    for (const x of [-W / 2 + 0.5, W / 2 - 1.1]) legs.merge(box(x - 0.02, 0.0, -D / 2 + 0.1, x + 0.02, 0.44, -D / 2 + 0.5));
    set.add(legs, frame);
    // Advertising panel on the end (lit).
    if (p.bool('ad')) {
      set.add(box(W / 2 + 0.04, 0.6, -0.4, W / 2 + 0.1, 2.0, 0.4), frame);
      set.add(box(W / 2 + 0.1, 0.65, -0.35, W / 2 + 0.108, 1.95, 0.35), EMISSIVE('#e9efff', 1.4));
      set.add(box(W / 2 + 0.108, 1.3, -0.3, W / 2 + 0.112, 1.9, 0.3), paint('#c0392b', 0.5));
      set.add(box(W / 2 + 0.108, 0.7, -0.3, W / 2 + 0.112, 1.2, 0.3), paint('#2a5d8a', 0.5));
    }
    // Stop pole and sign.
    const pole = new Geom();
    pole.merge(cylinder(0.035, 0.035, 2.7, 10).translate(-W / 2 - 0.5, 0, D / 2));
    set.add(pole, mat('brushed-metal'));
    set.add(cylinder(0.24, 0.24, 0.025, 20).rotateX(90).translate(-W / 2 - 0.5, 2.45, D / 2 + 0.04), paint(p.color('sign'), 0.4));
    set.add(box(-W / 2 - 0.62, 1.7, D / 2 + 0.035, -W / 2 - 0.38, 2.0, D / 2 + 0.05), paint('#1a1a1c', 0.5));
    set.boxMinMax(-W / 2, 0, -D / 2, W / 2, 0.5, D / 2 - 0.5);
    set.boxMinMax(-W / 2, 0, -D / 2, W / 2, H, -D / 2 + 0.06);
    set.boxMinMax(-W / 2 - 0.55, 0, D / 2 - 0.05, -W / 2 - 0.45, 2.7, D / 2 + 0.05);
    return set.build();
  },
};

export const MARKET_STALL: FurnitureDef = {
  id: 'furn-market-stall',
  kind: 'market-stall',
  description: 'Market stall: four timber posts, a striped canvas awning with a scalloped valance, a counter table and tilted crates of produce (fruit, vegetables or flowers) with a hanging scale. Customers on +Z. 2.6 x 2.6 x 2.0 m.',
  aliases: ['market stall', 'market stand', 'vendor stall', 'fruit stand', 'street stall', 'bazaar stall', 'fair stall', 'stall'],
  params: {
    stripe: color('#c0392b', 'awning stripe colour'),
    goods: choice(['fruit', 'vegetables', 'flowers', 'bread'], 'fruit', 'what is on sale'),
    wood: choice(['oak', 'walnut', 'ash'], 'oak', 'timber'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 1.2,
  size: () => [2.6, 2.6, 2.0],
  build(p, seed) {
    const set = new PartSet();
    const W = 2.4;
    const D = 1.6;
    const wood = mat(p.str('wood'));
    const posts = new Geom();
    const hs = [2.5, 2.5, 2.2, 2.2];
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], k) => posts.merge(box(sx! * W / 2 - 0.035, 0, sz! * D / 2 - 0.035, sx! * W / 2 + 0.035, hs[k]!, sz! * D / 2 + 0.035)));
    set.add(posts, wood);
    // Counter with a front panel and a cloth.
    const counter = new Geom();
    counter.merge(box(-W / 2 + 0.05, 0.0, 0.1, W / 2 - 0.05, 0.84, D / 2 - 0.1));
    set.add(counter, wood);
    set.add(bevelSlab(-W / 2, 0.84, 0.05, W / 2, 0.9, D / 2, 0.01), mat(p.str('wood') === 'oak' ? 'walnut' : 'oak'));
    // Awning: sloping stripes (alternating colour and cream), double sided; valance below the front edge.
    const sx0 = -W / 2 - 0.15;
    const sx1 = W / 2 + 0.15;
    const n = 10;
    const stripeA = new Geom();
    const stripeB = new Geom();
    for (let k = 0; k < n; k++) {
      const x0 = sx0 + ((sx1 - sx0) * k) / n;
      const x1 = sx0 + ((sx1 - sx0) * (k + 1)) / n;
      const g = new Geom();
      const yb = 2.5;
      const yf = 2.28;
      const zb = -D / 2 - 0.12;
      const zf = D / 2 + 0.4;
      g.quadAuto([x0, yf, zf], [x1, yf, zf], [x1, yb, zb], [x0, yb, zb]);
      const back = g.clone().flip();
      for (let i = 0; i < back.n.length; i++) back.n[i] = -(back.n[i] as number);
      g.merge(back);
      (k % 2 === 0 ? stripeA : stripeB).merge(g);
      // Scalloped valance: a small half-disc hanging below the front edge of each stripe.
      const vg = new Geom();
      const cx = (x0 + x1) / 2;
      const r = (x1 - x0) / 2;
      const seg = 6;
      for (let s = 0; s < seg; s++) {
        const a0 = Math.PI * (s / seg);
        const a1 = Math.PI * ((s + 1) / seg);
        const c = vg.vertexCount;
        vg.vertex(cx, yf, zf, 0, 0, 1, 0, 0);
        vg.vertex(cx + Math.cos(a0) * r, yf - Math.sin(a0) * r * 1.1, zf, 0, 0, 1, 1, 0);
        vg.vertex(cx + Math.cos(a1) * r, yf - Math.sin(a1) * r * 1.1, zf, 0, 0, 1, 1, 1);
        vg.tri(c, c + 2, c + 1);
        const c2 = vg.vertexCount;
        vg.vertex(cx, yf, zf, 0, 0, -1, 0, 0);
        vg.vertex(cx + Math.cos(a0) * r, yf - Math.sin(a0) * r * 1.1, zf, 0, 0, -1, 1, 0);
        vg.vertex(cx + Math.cos(a1) * r, yf - Math.sin(a1) * r * 1.1, zf, 0, 0, -1, 1, 1);
        vg.tri(c2, c2 + 1, c2 + 2);
      }
      (k % 2 === 0 ? stripeA : stripeB).merge(vg);
    }
    set.add(stripeA, { finish: 'fabric', color: p.color('stripe') });
    set.add(stripeB, { finish: 'fabric', color: '#efe7d3' });
    // Produce: crates with mounds of goods, in two colours of fruit/veg.
    const rnd = seeded(seed * 7919 + 3);
    const goods = p.str('goods');
    const palette: Record<string, string[]> = {
      fruit: ['#c8372d', '#e9a02a', '#7cae3a'],
      vegetables: ['#4f8f3a', '#d9582b', '#7a3f8f'],
      flowers: ['#e2557a', '#f0c24a', '#8a6fd1'],
      bread: ['#b9772e', '#d6a35c', '#8a5a2b'],
    };
    const cols = palette[goods] as string[];
    const piles = cols.map(() => new Geom());
    const crates = new Geom();
    for (let c = 0; c < 3; c++) {
      const cx = -W / 2 + 0.45 + c * 0.75;
      crates.merge(roundedBox(0.6, 0.13, 0.42, 0.012, 1).rotateX(-10).translate(cx, 0.97, 0.55));
      const count = goods === 'bread' ? 6 : 26;
      for (let k = 0; k < count; k++) {
        const r = goods === 'flowers' ? 0.035 : goods === 'bread' ? 0.07 : 0.045;
        const px = cx + (rnd() - 0.5) * 0.5;
        const pz = 0.55 + (rnd() - 0.5) * 0.3;
        const py = 1.05 + rnd() * 0.07 + (goods === 'bread' ? 0.02 : 0);
        const g = goods === 'bread' ? sphere(r, 8).scale(1.4, 0.7, 1) : sphere(r, 8);
        (piles[c] as Geom).merge(g.translate(px, py, pz));
      }
    }
    set.add(crates, mat('oak'));
    piles.forEach((g, i) => set.add(g, paint(cols[i] as string, 0.6)));
    // Scale and a chalk price board.
    set.add(box(W / 2 - 0.55, 0.9, 0.05, W / 2 - 0.1, 1.28, 0.07), paint('#23272a', 0.9));
    set.add(box(W / 2 - 0.5, 0.95, 0.07, W / 2 - 0.15, 1.23, 0.075), paint('#e6e3da', 0.9));
    const hang = new Geom();
    hang.merge(cylinder(0.005, 0.005, 0.5, 6).translate(0, 1.85, 0.0));
    hang.merge(cylinder(0.12, 0.1, 0.02, 14).translate(0, 1.4, 0.0));
    set.add(hang.translate(-0.3, 0, 0.2), mat('brass'));
    set.boxMinMax(-W / 2, 0, 0.1, W / 2, 0.9, D / 2);
    return set.build();
  },
};


/** Gym, clinic and street pieces. */
export const WORLD_PIECES: readonly FurnitureDef[] = [TREADMILL, WEIGHT_BENCH, DUMBBELL_RACK, HOSPITAL_BED, BUS_STOP, MARKET_STALL];
