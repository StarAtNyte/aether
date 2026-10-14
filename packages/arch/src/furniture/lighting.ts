/**
 * Light fittings. The geometry carries an emissive diffuser / bulb part (it
 * glows and blooms); the actual light source is the entity's `light` spec,
 * which the building compiler sets (warm 2700–3000 K colours, real-world
 * ranges). Ceiling fittings hang DOWN from their origin (the ceiling);
 * floor / table lamps stand on theirs; sconces have their back at z = 0.
 */
import type { MaterialSpec } from '@aether/core';
import { Geom, box, cylinder, lathe, roundedBox, sphere, tube } from '../mesh';
import { PartSet } from '../parts';
import { choice, color, mat, num, type FurnitureDef } from './kit';

/** Emissive diffuser material (warm white). */
export function glowMaterial(intensity = 3, tint = '#ffe7c4'): MaterialSpec {
  return { preset: 'emissive', color: tint, emissive: tint, emissiveIntensity: intensity, roughness: 0.4 };
}

export const PENDANT: FurnitureDef = {
  id: 'furn-pendant',
  kind: 'pendant',
  description: 'Pendant light hanging from the ceiling (origin at the ceiling): globe, dome or cone shade on a cord.',
  params: {
    style: choice(['globe', 'dome', 'cone', 'linear'], 'dome', 'shade style'),
    drop: num(0.8, 0.2, 2.5, 'cord length (m)'),
    size: num(0.38, 0.15, 1.2, 'shade diameter (m; length for linear)'),
    finish: choice(['black-metal', 'brass', 'paint', 'frosted-glass'], 'black-metal', 'shade finish'),
    color: color('#2d2e30', 'paint colour'),
  },
  mount: 'ceiling',
  againstWall: false,
  frontClearance: 0,
  size: (p) => [p.num('size'), p.num('drop') + 0.3, p.num('size')],
  build(p) {
    const set = new PartSet();
    const drop = p.num('drop');
    const r = p.num('size') / 2;
    const style = p.str('style');
    const shadeMat = p.str('finish') === 'paint' ? mat('paint', p.color('color')) : mat(p.str('finish'));
    const fittings = new Geom();
    fittings.merge(cylinder(0.06, 0.06, 0.02, 20).translate(0, -0.02, 0));
    if (style === 'linear') {
      for (const x of [-r * 0.8, r * 0.8]) fittings.merge(cylinder(0.002, 0.002, drop, 6).translate(x, -drop, 0));
      set.add(roundedBox(r * 2, 0.05, 0.08, 0.02, 2).translate(0, -drop - 0.025, 0), shadeMat);
      set.add(box(-r + 0.02, -drop - 0.052, -0.03, r - 0.02, -drop - 0.05, 0.03), glowMaterial(4));
    } else {
      fittings.merge(cylinder(0.003, 0.003, drop, 6).translate(0, -drop, 0));
      if (style === 'globe') set.add(sphere(r, 24).translate(0, -drop - r, 0), { finish: 'frosted-glass', color: '#fff6e8', opacity: 0.92, emissive: '#ffe2b8', emissiveIntensity: 2.2 });
      else {
        const h = style === 'cone' ? r * 1.3 : r * 0.75;
        const prof: Array<[number, number]> =
          style === 'cone'
            ? [
                [r, -h],
                [0.03, 0],
              ]
            : [
                [r, -h],
                [r * 0.96, -h * 0.55],
                [r * 0.72, -h * 0.18],
                [0.04, 0],
              ];
        const outer = lathe(prof, 40);
        const inner = lathe(prof.map((q): [number, number] => [q[0] * 0.97, q[1] + 0.004]), 40).flip();
        for (let k = 0; k < inner.n.length; k++) inner.n[k] = -(inner.n[k] as number);
        set.add(outer.merge(inner).translate(0, -drop, 0), shadeMat);
        set.add(sphere(0.05, 14).translate(0, -drop - h * 0.55, 0), glowMaterial(6));
      }
    }
    set.add(fittings, mat('black-metal'));
    return set.build();
  },
};

export const CEILING_LIGHT: FurnitureDef = {
  id: 'furn-ceiling-light',
  kind: 'ceiling-light',
  description: 'Flush ceiling light (round opal diffuser); origin at the ceiling.',
  params: {
    size: num(0.4, 0.15, 1, 'diameter (m)'),
  },
  mount: 'ceiling',
  againstWall: false,
  frontClearance: 0,
  size: (p) => [p.num('size'), 0.08, p.num('size')],
  build(p) {
    const set = new PartSet();
    const r = p.num('size') / 2;
    set.add(cylinder(r, r, 0.03, 40).translate(0, -0.03, 0), mat('paint', '#f1efeb'));
    set.add(lathe([[0.001, -0.07], [r * 0.85, -0.06], [r * 0.92, -0.03]], 40), glowMaterial(2.6, '#fff1dc'));
    return set.build();
  },
};

export const FLOOR_LAMP: FurnitureDef = {
  id: 'furn-floor-lamp',
  kind: 'floor-lamp',
  description: 'Floor lamp: arc lamp with a dome shade, or a tripod with a linen drum shade.',
  params: {
    style: choice(['arc', 'tripod'], 'tripod', 'style'),
    finish: choice(['brass', 'black-metal', 'oak', 'chrome'], 'brass', 'stand finish'),
    shade: color('#efe6d6', 'shade colour'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0,
  size: (p) => (p.str('style') === 'arc' ? [1.6, 2.0, 0.4] : [0.5, 1.6, 0.5]),
  build(p) {
    const set = new PartSet();
    const stand = new Geom();
    if (p.str('style') === 'arc') {
      stand.merge(roundedBox(0.3, 0.06, 0.3, 0.02, 2).translate(-0.6, 0.03, 0));
      const path: Array<readonly [number, number, number]> = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        path.push([-0.6 + 1.2 * t, 0.06 + 1.95 * Math.sin(Math.PI * Math.min(1, t * 0.62 + 0.0)) * (1 - 0.15 * t), 0]);
      }
      stand.merge(tube(path, 0.012, 8));
      const end = path[path.length - 1] as readonly [number, number, number];
      const shade = lathe(
        [
          [0.22, -0.18],
          [0.2, -0.08],
          [0.04, 0],
        ],
        32,
      ).translate(end[0], end[1], 0);
      set.add(shade, mat('black-metal'));
      set.add(sphere(0.05, 12).translate(end[0], end[1] - 0.1, 0), glowMaterial(6));
    } else {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        stand.merge(tube([[Math.cos(a) * 0.24, 0.012, Math.sin(a) * 0.24], [0, 1.25, 0]], 0.011, 8));
      }
      stand.merge(cylinder(0.008, 0.008, 0.2, 8).translate(0, 1.2, 0));
      const drum = cylinder(0.22, 0.2, 0.3, 40, { top: false, bottom: false }).translate(0, 1.25, 0);
      const back = drum.clone().flip();
      for (let k = 0; k < back.n.length; k++) back.n[k] = -(back.n[k] as number);
      set.add(drum.merge(back), { finish: 'fabric', color: p.color('shade'), emissive: '#ffd9a6', emissiveIntensity: 1.6 });
      set.add(sphere(0.045, 12).translate(0, 1.38, 0), glowMaterial(5));
    }
    set.add(stand, mat(p.str('finish')));
    set.boxMinMax(-0.25, 0, -0.25, 0.25, 1.5, 0.25);
    return set.build();
  },
};

export const TABLE_LAMP: FurnitureDef = {
  id: 'furn-table-lamp',
  kind: 'table-lamp',
  description: 'Table lamp with a ceramic base and a linen shade; stands on a surface (origin at its base).',
  params: {
    base: color('#d8cbb7', 'base colour'),
    shade: color('#f1ebe0', 'shade colour'),
  },
  mount: 'surface',
  againstWall: false,
  frontClearance: 0,
  size: () => [0.32, 0.5, 0.32],
  build(p) {
    const set = new PartSet();
    const base = lathe(
      [
        [0.001, 0],
        [0.07, 0],
        [0.1, 0.06],
        [0.11, 0.16],
        [0.08, 0.24],
        [0.025, 0.28],
        [0.001, 0.28],
      ],
      28,
    );
    set.add(base, mat('ceramic', p.color('base')));
    const shade = cylinder(0.16, 0.12, 0.2, 32, { top: false, bottom: false }).translate(0, 0.3, 0);
    const back = shade.clone().flip();
    for (let k = 0; k < back.n.length; k++) back.n[k] = -(back.n[k] as number);
    set.add(shade.merge(back), { finish: 'fabric', color: p.color('shade'), emissive: '#ffdcae', emissiveIntensity: 1.8 });
    set.add(sphere(0.035, 10).translate(0, 0.36, 0), glowMaterial(5));
    return set.build();
  },
};

export const SCONCE: FurnitureDef = {
  id: 'furn-sconce',
  kind: 'sconce',
  description: 'Wall sconce (up/down light) with its back at z = 0; origin at its centre height.',
  params: {
    finish: choice(['brass', 'black-metal', 'paint'], 'brass', 'finish'),
  },
  mount: 'wall',
  againstWall: true,
  frontClearance: 0,
  size: () => [0.12, 0.25, 0.12],
  build(p) {
    const set = new PartSet();
    set.add(roundedBox(0.08, 0.16, 0.02, 0.008, 2).translate(0, 0, 0.01).merge(cylinder(0.05, 0.05, 0.22, 24, { top: false, bottom: false }).translate(0, -0.11, 0.08)), mat(p.str('finish') === 'paint' ? 'paint' : p.str('finish')));
    set.add(cylinder(0.046, 0.046, 0.005, 20).translate(0, 0.105, 0.08).merge(cylinder(0.046, 0.046, 0.005, 20).translate(0, -0.11, 0.08)), glowMaterial(4));
    return set.build();
  },
};

export const SWITCH: FurnitureDef = {
  id: 'furn-switch',
  kind: 'switch',
  description: 'Light switch plate on a wall (back at z = 0, centre 1.1 m above the floor when placed by the compiler).',
  params: {
    finish: choice(['paint', 'brass', 'black-metal'], 'paint', 'plate finish'),
  },
  mount: 'wall',
  againstWall: true,
  frontClearance: 0,
  size: () => [0.086, 0.086, 0.012],
  build(p) {
    const set = new PartSet();
    set.add(roundedBox(0.086, 0.086, 0.01, 0.004, 2).translate(0, 0, 0.005), p.str('finish') === 'paint' ? mat('paint', '#f4f2ee') : mat(p.str('finish')));
    set.add(roundedBox(0.03, 0.05, 0.008, 0.003, 1).translate(0, 0, 0.012), mat('paint', '#e9e6e0'));
    return set.build();
  },
};

/** Lighting definitions. */
/**
 * Give a fitting a `lit` switch: switched off, its diffusers / bulbs stop
 * glowing (the light source itself is the entity's `light`, toggled by the
 * walkthrough's light switches).
 */
function switchable(def: FurnitureDef): FurnitureDef {
  return {
    ...def,
    params: { ...def.params, lit: { type: 'boolean', default: true, description: 'switched on (diffuser glows)' } },
    build(p, seed) {
      const out = def.build(p, seed);
      if (p.bool('lit')) return out;
      for (const part of out.parts) {
        if (part.material.emissiveIntensity !== undefined && part.material.emissiveIntensity > 0) part.material = { ...part.material, emissiveIntensity: 0, ...(part.material.preset === 'emissive' ? { preset: 'plastic' as const } : {}) };
      }
      return out;
    },
  };
}

export const LIGHTING: readonly FurnitureDef[] = [PENDANT, CEILING_LIGHT, FLOOR_LAMP, TABLE_LAMP, SCONCE].map(switchable).concat([SWITCH]);
