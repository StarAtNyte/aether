/**
 * Prop generators: lamp-post, bench, table, chair, crate, barrel, campfire,
 * tent, dock, statue. Built from the physically based finishes (cast iron,
 * oak, canvas, limestone, bronze), parts of one finish merged into one draw;
 * small objects stay well under 3k triangles and get compound primitive
 * colliders.
 */
import type { Vec3 } from '@aether/core';
import type { InternalApi } from '../api';
import type { Mesh } from '../kernel/mesh';
import { boxCollider, cylinderCollider } from '../colliders';
import { mixLinear } from '../color';
import {
  addFinish, boxUvs, defineGenerator, paintNoise, finishMat, glow, hullOf, lin, paintGradientY, pBool, pColor, pNum, pVariant, roundUvs, shade,
} from './kit';
import { flatQuads, rustPaint, solid, stencilRects, stencilWidth, weathered } from './outpost';

/** An empty seed mesh to merge parts into (a 1 cm cube hidden inside the object at `y`). */
function seed(api: InternalApi, y: number): Mesh {
  return api.box(0.01, 0.01, 0.01).translate(0, y, 0);
}

/** Lathe or cylinder UVs with the boards running up the side (barrel staves), not round it. */
function staveUvs(m: Mesh, radius: number): Mesh {
  roundUvs(m, radius);
  const uv = m.uvs;
  for (let k = 0; k < uv.length; k += 2) {
    const u = uv[k] as number;
    uv[k] = uv[k + 1] as number;
    uv[k + 1] = u;
  }
  return m;
}

const lampPost = defineGenerator({
  id: 'lamp-post',
  description: 'Street lamp: ornate cast base, slim pole and a glowing lantern (classic), curved arm (modern), twin lanterns, or an industrial floodlight pole with two lamp heads on a crossarm (yards, outposts, car parks).',
  category: 'props',
  params: {
    height: pNum(3.5, 1.5, 10, 'height in meters'),
    color: pColor('#2d2d33', 'metal color'),
    lightColor: pColor('#ffd27a', 'light color'),
    variant: pVariant(3, '0 classic lantern, 1 modern arm, 2 twin lanterns, 3 industrial floodlight pole (galvanized, two lamp heads)'),
  },
  run(p, api) {
    const H = p.num('height');
    const c = p.color('color');
    const light = p.color('lightColor');
    const variant = p.int('variant');
    if (variant === 3) return floodPole(api, H, c === '#2d2d33' ? '#9a9fa2' : c, light);
    const k = H / 3.5;
    const iron = api.lathe([[0, 0], [0.24 * k, 0], [0.24 * k, 0.08 * k], [0.2 * k, 0.12 * k], [0.15 * k, 0.26 * k], [0.1 * k, 0.4 * k], [0.08 * k, 0.5 * k], [0, 0.5 * k]], 16);
    const poleTop = variant === 1 ? H : H * 0.86;
    iron.merge(api.cylinder(0.042 * k, 0.06 * k, poleTop - 0.45 * k, 12).translate(0, 0.45 * k + (poleTop - 0.45 * k) / 2, 0));
    for (const f of [0.45, 0.8]) iron.merge(api.torus(0.065 * k, 0.02 * k, 6, 16).rotate(90, 0, 0).translate(0, H * f, 0));
    const glass: Mesh[] = [];
    const lantern = (x: number, y: number): void => {
      const s = 0.2 * k;
      glass.push(api.box(s * 1.3, s * 1.7, s * 1.3).translate(x, y, 0));
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) iron.merge(api.box(0.022 * k, s * 1.85, 0.022 * k).translate(x + dx * s * 0.68, y, dz * s * 0.68));
      iron.merge(api.box(s * 1.5, 0.03 * k, s * 1.5).translate(x, y + s * 0.9, 0));
      iron.merge(api.cone(s * 1.15, s * 0.75, 4).rotate(0, 45, 0).translate(x, y + s * 1.3, 0));
      iron.merge(api.box(s * 1.5, 0.04 * k, s * 1.5).translate(x, y - s * 0.92, 0));
      iron.merge(api.cone(s * 0.5, s * 0.4, 8).rotate(180, 0, 0).translate(x, y - s * 1.12, 0));
      iron.merge(api.sphere(0.035 * k, 1).translate(x, y + s * 1.75, 0));
    };
    if (variant === 0) lantern(0, H * 0.86 + 0.22 * k);
    else if (variant === 2) {
      iron.merge(api.box(1.1 * k, 0.045 * k, 0.045 * k).translate(0, H * 0.86, 0));
      for (const sx of [-1, 1]) {
        const curl: Vec3[] = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          curl.push([sx * (0.1 + t * 0.4) * k, H * 0.86 - Math.sin(t * Math.PI) * 0.18 * k, 0]);
        }
        iron.merge(api.tube(curl, 0.015 * k, 6));
      }
      lantern(-0.5 * k, H * 0.86 - 0.25 * k);
      lantern(0.5 * k, H * 0.86 - 0.25 * k);
      iron.merge(api.sphere(0.06 * k, 1).translate(0, H * 0.86 + 0.08 * k, 0));
    } else {
      const arm: Vec3[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        arm.push([Math.sin(t * Math.PI * 0.5) * 0.7 * k, H - 0.02 * k + Math.sin(t * Math.PI) * 0.18 * k - t * 0.1 * k, 0]);
      }
      iron.merge(api.tube(arm, 0.032 * k, 8));
      iron.merge(api.cylinder(0.09 * k, 0.2 * k, 0.12 * k, 16).translate(0.7 * k, H - 0.15 * k, 0));
      glass.push(api.cylinder(0.17 * k, 0.17 * k, 0.02 * k, 16).translate(0.7 * k, H - 0.22 * k, 0));
    }
    addFinish(api, iron, 'black-metal', c, { variation: 0.04 });
    for (const g of glass) api.add(g, glow(light, variant === 1 ? 3 : 2.5));
    api.collider(cylinderCollider(0, 0.225 * k, 0, 0.26 * k, 0.45 * k));
    api.collider(cylinderCollider(0, H / 2, 0, 0.07 * k, H));
    return api.build();
  },
});

/**
 * Industrial floodlight pole: a concrete footing, a bolted base plate, a tapered galvanized pole with a hand-hole and a
 * junction box, and a crossarm carrying two finned lamp heads tilted down on yokes.
 */
function floodPole(api: InternalApi, H: number, steel: string, light: string) {
  addFinish(api, api.cylinder(0.26, 0.3, 0.3, 14).translate(0, 0.15, 0), 'concrete', '#a6a29a', { variation: 0.06 });
  const m = api.box(0.34, 0.025, 0.34).translate(0, 0.3125, 0);
  for (const [bx, bz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) m.merge(api.cylinder(0.014, 0.014, 0.05, 6).translate(bx * 0.13, 0.33, bz * 0.13));
  m.merge(api.cylinder(0.055, 0.09, H - 0.32, 12).translate(0, 0.32 + (H - 0.32) / 2, 0));
  m.merge(api.box(0.07, 0.2, 0.02).translate(0, 0.8, 0.085));
  m.merge(api.box(0.24, 0.32, 0.13).translate(0, 1.5, 0.14));
  m.merge(api.cylinder(0.014, 0.014, H - 1.8, 6).translate(0.07, 1.66 + (H - 1.8) / 2, 0.07));
  const top = H - 0.12;
  m.merge(api.box(1.1, 0.06, 0.08).translate(0, top, 0));
  m.merge(api.limb([0, top - 0.45, 0], [0.38, top - 0.03, 0], 0.016, 0.016, 6)).merge(api.limb([0, top - 0.45, 0], [-0.38, top - 0.03, 0], 0.016, 0.016, 6));
  const heads: Mesh[] = [];
  const glass: Mesh[] = [];
  for (const sx of [-1, 1]) {
    // A head built facing +Z, tilted 35 degrees down, hung under the arm on a yoke.
    const h = api.box(0.44, 0.32, 0.12);
    for (let f = 0; f < 6; f++) h.merge(api.box(0.012, 0.28, 0.06).translate(-0.18 + f * 0.072, 0, -0.08));
    h.merge(api.box(0.46, 0.03, 0.14).translate(0, 0.165, 0.01));
    const yoke = api.box(0.02, 0.26, 0.04).translate(-0.24, 0.1, 0).merge(api.box(0.02, 0.26, 0.04).translate(0.24, 0.1, 0)).merge(api.box(0.5, 0.025, 0.04).translate(0, 0.23, 0));
    const place = (mesh: Mesh): Mesh => mesh.rotate(35, 0, 0).translate(sx * 0.38, top - 0.3, 0.12);
    heads.push(place(h.merge(yoke)));
    glass.push(place(api.box(0.38, 0.26, 0.01).translate(0, 0, 0.062)));
  }
  for (const h of heads) m.merge(h);
  addFinish(api, m, 'brushed-metal', steel, { variation: 0.05 });
  for (const g of glass) api.add(g, glow(light, 3));
  api.collider(cylinderCollider(0, 0.15, 0, 0.3, 0.3));
  api.collider(cylinderCollider(0, H / 2, 0, 0.09, H));
  return api.build();
}

const bench = defineGenerator({
  id: 'bench',
  description: 'Park bench with wooden slats on cast-iron side frames, or a rustic log bench.',
  category: 'props',
  params: {
    length: pNum(1.8, 0.8, 5, 'length (x) in meters'),
    color: pColor('#a0703c', 'wood color'),
    frameColor: pColor('#3a3a3a', 'frame color'),
    variant: pVariant(1, '0 park bench, 1 rustic log bench'),
  },
  run(p, api) {
    const L = p.num('length');
    const wood = p.color('color');
    const frame = p.color('frameColor');
    if (p.int('variant') === 1) {
      const seat = staveUvs(api.cylinder(0.22, 0.22, L, 14), 0.22).rotate(0, 0, 90).scale(1, 0.55, 1).translate(0, 0.42, 0);
      addFinish(api, seat, 'bark', wood, { uv: 'keep', variation: 0.1, freq: 2 });
      addFinish(api, api.box(L - 0.04, 0.02, 0.36).translate(0, 0.53, 0), 'oak', shade(wood, 0.2), { variation: 0.08 });
      const stumps = seed(api, 0.2);
      for (const sx of [-1, 1]) stumps.merge(roundUvs(api.cylinder(0.17, 0.2, 0.36, 12), 0.2).translate(sx * L * 0.33, 0.18, 0));
      addFinish(api, stumps, 'bark', shade(wood, -0.15), { uv: 'keep', variation: 0.1, freq: 3 });
      api.collider(boxCollider(0, 0.27, 0, L, 0.54, 0.44));
      return api.build();
    }
    const seatY = 0.45;
    const slats = seed(api, seatY);
    for (let i = 0; i < 4; i++) slats.merge(api.box(L, 0.035, 0.09).translate(0, seatY, -0.17 + i * 0.115));
    for (let i = 0; i < 3; i++) slats.merge(api.box(L, 0.09, 0.03).translate(0, 0.16 + i * 0.13, 0).rotate(-14, 0, 0).translate(0, seatY + 0.07, -0.25));
    addFinish(api, slats, 'oak', wood, { variation: 0.1, freq: 2 });
    const iron = seed(api, seatY);
    const supports = L > 2.4 ? [-L / 2 + 0.12, 0, L / 2 - 0.12] : [-L / 2 + 0.12, L / 2 - 0.12];
    for (const x of supports) {
      iron.merge(api.box(0.045, seatY, 0.045).translate(x, seatY / 2, 0.17));
      iron.merge(api.box(0.045, 0.9, 0.045).rotate(-12, 0, 0).translate(x, 0.45, -0.21));
      iron.merge(api.box(0.045, 0.045, 0.48).translate(x, seatY - 0.04, -0.02));
      // A scrolled armrest.
      const arm: Vec3[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        arm.push([x, 0.66 + Math.sin(t * Math.PI) * 0.03, -0.2 + t * 0.4]);
      }
      arm.push([x, 0.6, 0.24]);
      iron.merge(api.tube(arm, 0.022, 6));
      iron.merge(api.box(0.045, 0.22, 0.04).translate(x, 0.56, 0.17));
      iron.merge(api.box(0.12, 0.02, 0.1).translate(x, 0.01, 0.17)).merge(api.box(0.12, 0.02, 0.1).translate(x, 0.01, -0.28));
    }
    addFinish(api, iron, 'black-metal', frame, { variation: 0.03 });
    api.collider(boxCollider(0, seatY / 2 + 0.01, 0, L, seatY + 0.02, 0.5));
    api.collider({ kind: 'box', halfExtents: [L / 2, 0.22, 0.03], offset: [0, seatY + 0.28, -0.3], rotation: [-14, 0, 0] });
    return api.build();
  },
});

const table = defineGenerator({
  id: 'table',
  description: 'Wooden table: four-legged dining table, round pedestal table, or picnic table with attached benches.',
  category: 'props',
  params: {
    width: pNum(1.6, 0.5, 5, 'width (x) in meters (diameter for round)'),
    depth: pNum(0.9, 0.4, 3, 'depth (z) in meters'),
    height: pNum(0.75, 0.3, 1.5, 'height in meters'),
    color: pColor('#9a6a3c', 'wood color'),
    variant: pVariant(2, '0 four legs, 1 round pedestal, 2 picnic table'),
  },
  run(p, api) {
    const W = p.num('width');
    const D = p.num('depth');
    const H = p.num('height');
    const c = p.color('color');
    const variant = p.int('variant');
    const t = 0.05;
    if (variant === 1) {
      addFinish(api, api.cylinder(W / 2, W / 2, t, 32).translate(0, H - t / 2, 0), 'oak', c, { variation: 0.06 });
      const foot = Math.max(0.14, W * 0.22);
      const leg = api.cylinder(foot * 0.9, foot, 0.05, 20).translate(0, 0.025, 0);
      leg.merge(api.cylinder(0.05, 0.065, H - t - 0.11, 16).translate(0, 0.05 + (H - t - 0.11) / 2, 0));
      leg.merge(api.cylinder(0.11, 0.07, 0.06, 16).translate(0, H - t - 0.03, 0));
      addFinish(api, leg, 'oak', shade(c, -0.2), { uv: 'round', radius: 0.08, variation: 0.05 });
      api.collider(cylinderCollider(0, H - t / 2, 0, W / 2, t));
      api.collider(cylinderCollider(0, (H - t) / 2, 0, 0.08, H - t));
      return api.build();
    }
    if (variant === 2) {
      const top = seed(api, H - t);
      const planks = 5;
      for (let i = 0; i < planks; i++) top.merge(api.box(W, t, D / planks - 0.015).translate(0, H - t / 2, -D / 2 + (D / planks) * (i + 0.5)));
      for (const sz of [-1, 1]) {
        top.merge(api.box(W, t, 0.13).translate(0, H * 0.58, sz * (D / 2 + 0.23))).merge(api.box(W, t, 0.13).translate(0, H * 0.58, sz * (D / 2 + 0.37)));
        api.collider(boxCollider(0, H * 0.58, sz * (D / 2 + 0.3), W, t, 0.28));
      }
      addFinish(api, top, 'oak', c, { variation: 0.12, freq: 1.5 });
      const legs = seed(api, H / 2);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) legs.merge(api.limb([sx * (W / 2 - 0.15), 0, sz * (D / 2 + 0.45)], [sx * (W / 2 - 0.15), H - t, 0], 0.045, 0.045, 6));
        legs.merge(api.box(0.08, 0.08, D + 1.0).translate(sx * (W / 2 - 0.15), H * 0.58 - t, 0));
      }
      addFinish(api, legs, 'oak', shade(c, -0.15), { variation: 0.06 });
      api.collider(boxCollider(0, H - t / 2, 0, W, t, D));
      api.collider(boxCollider(0, (H - t) / 2, 0, W - 0.2, H - t, 0.1));
      return api.build();
    }
    addFinish(api, api.box(W, t, D).translate(0, H - t / 2, 0), 'oak', c, { variation: 0.06 });
    const frame = api.box(W - 0.12, 0.09, 0.025).translate(0, H - t - 0.045, D / 2 - 0.07).merge(api.box(W - 0.12, 0.09, 0.025).translate(0, H - t - 0.045, -D / 2 + 0.07));
    frame.merge(api.box(0.025, 0.09, D - 0.12).translate(W / 2 - 0.07, H - t - 0.045, 0)).merge(api.box(0.025, 0.09, D - 0.12).translate(-W / 2 + 0.07, H - t - 0.045, 0));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * (W / 2 - 0.08);
        const z = sz * (D / 2 - 0.08);
        frame.merge(api.cylinder(0.032, 0.022, H - t, 10).translate(x, (H - t) / 2, z));
        api.collider(boxCollider(x, (H - t) / 2, z, 0.07, H - t, 0.07));
      }
    }
    addFinish(api, frame, 'oak', shade(c, -0.1), { variation: 0.05 });
    api.collider(boxCollider(0, H - t / 2, 0, W, t, D));
    return api.build();
  },
});

const chair = defineGenerator({
  id: 'chair',
  description: 'Chair: wooden dining chair with slatted back, upholstered armchair, or a bar stool.',
  category: 'props',
  params: {
    height: pNum(0.9, 0.5, 1.5, 'total height in meters'),
    color: pColor('#8b5a2b', 'wood / frame color'),
    fabricColor: pColor('#3f6e8c', 'cushion color'),
    variant: pVariant(2, '0 dining chair, 1 armchair, 2 stool'),
  },
  run(p, api) {
    const H = p.num('height');
    const c = p.color('color');
    const fabric = p.color('fabricColor');
    const variant = p.int('variant');
    const seatH = H * (variant === 2 ? 0.75 : 0.5);
    const S = variant === 1 ? 0.75 : 0.45;
    if (variant === 2) {
      addFinish(api, api.cylinder(0.2, 0.19, 0.06, 20).translate(0, seatH, 0), 'leather', fabric, { variation: 0.05 });
      const steel = seed(api, seatH / 2);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        steel.merge(api.limb([Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22], [Math.cos(a) * 0.12, seatH - 0.03, Math.sin(a) * 0.12], 0.016, 0.014, 6));
      }
      steel.merge(api.torus(0.17, 0.01, 6, 20).rotate(90, 0, 0).translate(0, seatH * 0.35, 0));
      addFinish(api, steel, 'black-metal', c === '#8b5a2b' ? '#ffffff' : c, { variation: 0 });
      api.collider(cylinderCollider(0, seatH / 2, 0, 0.22, seatH + 0.03));
      return api.build();
    }
    if (variant === 1) {
      const up = api.box(S, seatH * 0.6, S).translate(0, seatH * 0.3 + 0.08, 0);
      up.merge(api.box(S, H - seatH * 0.6, 0.16).rotate(-8, 0, 0).translate(0, seatH * 0.6 + (H - seatH * 0.6) / 2, -S / 2 + 0.08));
      for (const sx of [-1, 1]) up.merge(api.box(0.12, seatH * 0.5, S).translate(sx * (S / 2 - 0.06), seatH * 0.85, 0));
      addFinish(api, up, 'fabric', fabric, { variation: 0.05 });
      addFinish(api, api.box(S - 0.1, 0.12, S - 0.12).translate(0, seatH + 0.02, 0.04), 'fabric', shade(fabric, 0.08), { variation: 0.04 });
      const feet = seed(api, 0.04);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) feet.merge(api.cylinder(0.022, 0.016, 0.1, 8).translate(sx * (S / 2 - 0.06), 0.05, sz * (S / 2 - 0.06)));
      addFinish(api, feet, 'walnut', '#ffffff', { variation: 0 });
      api.collider(boxCollider(0, seatH / 2 + 0.04, 0, S, seatH + 0.08, S));
      api.collider(boxCollider(0, (seatH + H) / 2, -S / 2 + 0.08, S, H - seatH, 0.16));
      return api.build();
    }
    const wood = api.box(S, 0.04, S).translate(0, seatH, 0);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const top = sz < 0 ? H : seatH;
        wood.merge(api.box(0.04, top, 0.04).translate(sx * (S / 2 - 0.03), top / 2, sz * (S / 2 - 0.03)));
      }
    }
    for (let i = 0; i < 3; i++) wood.merge(api.box(S - 0.06, 0.05, 0.022).translate(0, seatH + 0.15 + i * ((H - seatH - 0.2) / 2.2), -S / 2 + 0.03));
    addFinish(api, wood, 'oak', c, { variation: 0.06 });
    addFinish(api, api.box(S - 0.06, 0.03, S - 0.08).translate(0, seatH + 0.035, 0.01), 'fabric', fabric, { variation: 0.04 });
    api.collider(boxCollider(0, seatH / 2, 0, S, seatH + 0.02, S));
    api.collider(boxCollider(0, (seatH + H) / 2, -S / 2 + 0.03, S, H - seatH, 0.05));
    return api.build();
  },
});

const crate = defineGenerator({
  id: 'crate',
  description: 'Shipping crate: framed wooden crate with diagonal brace, slatted crate, sci-fi metal cargo box with glowing strips, or an olive-drab military ammunition / supply crate (size long, half as deep, lid, rope handles, latches, stencilled lot markings).',
  category: 'props',
  params: {
    size: pNum(1, 0.3, 4, 'edge length in meters'),
    color: pColor('#b07d45', 'main color'),
    variant: pVariant(3, '0 framed wood, 1 slatted wood, 2 sci-fi metal, 3 military ammo / supply crate'),
  },
  run(p, api) {
    const S = p.num('size');
    const c = p.color('color');
    const variant = p.int('variant');
    const e = S * 0.09;
    if (variant === 3) return militaryCrate(api, S, c === '#b07d45' ? '#4d5434' : c);
    if (variant === 2) {
      const metal = c === '#b07d45' ? '#7c858d' : c;
      addFinish(api, api.box(S * 0.96, S * 0.96, S * 0.96).translate(0, S / 2, 0), 'brushed-metal', metal, { variation: 0.04 });
      const ribs = seed(api, S / 2);
      for (const sy of [0.04, 0.96]) ribs.merge(api.box(S, S * 0.08, S).translate(0, S * sy, 0));
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) ribs.merge(api.box(S * 0.1, S, S * 0.1).translate((x * S) / 2 - x * S * 0.05, S / 2, (z * S) / 2 - z * S * 0.05));
      addFinish(api, ribs, 'black-metal', '#ffffff', { variation: 0 });
      api.add(api.box(S * 0.6, S * 0.04, S * 0.02).translate(0, S * 0.5, S * 0.485), glow('#38e1ff', 3));
      api.add(api.box(S * 0.02, S * 0.04, S * 0.6).translate(S * 0.485, S * 0.5, 0), glow('#38e1ff', 3));
      api.collider(boxCollider(0, S / 2, 0, S, S, S));
      return api.build();
    }
    if (variant === 1) {
      paintSolidDark(api, api.box(S - e * 0.6, S - e * 0.6, S - e * 0.6).translate(0, S / 2, 0), shade(c, -0.6));
      const slats = seed(api, S / 2);
      for (let i = 0; i < 4; i++) {
        const y = S * (0.12 + i * 0.25);
        slats.merge(api.box(S, S * 0.17, S * 0.98).translate(0, y, 0)).merge(api.box(S * 0.98, S * 0.17, S).translate(0, y, 0));
      }
      addFinish(api, slats, 'oak', c, { variation: 0.12, freq: 2 });
    } else {
      addFinish(api, api.box(S - e * 0.6, S - e * 0.6, S - e * 0.6).translate(0, S / 2, 0), 'cladding', c, { variation: 0.06 });
    }
    const frame = seed(api, S / 2);
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        frame.merge(api.box(S, e, e).translate(0, S / 2 + (sy * (S - e)) / 2, (sz * (S - e)) / 2));
        frame.merge(api.box(e, e, S - 2 * e).translate((sy * (S - e)) / 2, S / 2 + (sz * (S - e)) / 2, 0));
        frame.merge(api.box(e, S - 2 * e, e).translate((sy * (S - e)) / 2, S / 2, (sz * (S - e)) / 2));
      }
    }
    if (variant === 0) {
      const diag = Math.SQRT2 * (S - 2 * e);
      for (const sz of [-1, 1]) frame.merge(api.box(e * 0.8, diag, e * 0.5).rotate(0, 0, 45 * sz).translate(0, S / 2, (sz * S) / 2));
      for (const sx of [-1, 1]) frame.merge(api.box(e * 0.5, diag, e * 0.8).rotate(45 * sx, 0, 0).translate((sx * S) / 2, S / 2, 0));
    }
    addFinish(api, frame, 'oak', shade(c, -0.25), { variation: 0.08, freq: 2 });
    api.collider(boxCollider(0, S / 2, 0, S, S, S));
    return api.build();
  },
});

const LOTS = ['CTG 7.62MM', 'CTG 5.56MM', 'CAL .50 M33', 'GRENADE M67', 'RATIONS MRE', 'MEDICAL KIT'];

/**
 * Military ammunition / supply crate, `S` long: a painted plywood box on two skids with end cleats, a lid with a shadow
 * seam, rope handles, steel latches, hinges and corner caps, and a stencilled lot in yellow. Paint wears off the rounded
 * edges (surface layers). Three draws.
 */
function militaryCrate(api: InternalApi, S: number, olive: string) {
  const L = S;
  const D = S * 0.5;
  const H = S * 0.42;
  const skid = S * 0.05;
  const r = Math.min(0.012, S * 0.012);
  const paint = solid(api.roundedBox(L * 0.94, H * 0.78, D * 0.94, r, 1).translate(0, skid + H * 0.39, 0), olive);
  paint.merge(solid(api.roundedBox(L * 0.955, H * 0.2, D * 0.955, r, 1).translate(0, skid + H * 0.78 + H * 0.1 + 0.004, 0), shade(olive, 0.04)));
  paint.merge(solid(api.box(L * 0.935, 0.006, D * 0.935).translate(0, skid + H * 0.78 + 0.002, 0), shade(olive, -0.6)));
  const wood = shade(olive, -0.12);
  for (const sz of [-1, 1]) paint.merge(solid(api.box(L * 0.97, skid, S * 0.07).translate(0, skid / 2, sz * D * 0.3), wood));
  for (const sx of [-1, 1]) {
    const x = sx * (L * 0.47 + S * 0.015);
    for (const sz of [-1, 1]) paint.merge(solid(api.box(S * 0.03, H * 0.92, S * 0.06).translate(x, skid + H * 0.46, sz * (D * 0.47 - S * 0.03)), wood));
    paint.merge(solid(api.box(S * 0.03, S * 0.05, D * 0.8).translate(x, skid + H * 0.25, 0), wood));
  }
  // The stencilled lot on the front and the end.
  const yellow = '#d9c45a';
  const lot = LOTS[Math.floor(api.rng() * LOTS.length) % LOTS.length] as string;
  const h1 = S * 0.05;
  const w1 = stencilWidth(lot, h1);
  const rects = stencilRects(lot, -w1 / 2, skid + H * 0.5, h1);
  const line2 = `LOT ${String(10 + Math.floor(api.rng() * 89))}-${String(100 + Math.floor(api.rng() * 899))}`;
  const w2 = stencilWidth(line2, h1 * 0.6);
  rects.push(...stencilRects(line2, -w2 / 2, skid + H * 0.5 - h1 * 1.2, h1 * 0.6));
  paint.merge(solid(flatQuads(api, rects, D * 0.47 + 0.002), yellow));
  paint.merge(solid(flatQuads(api, stencilRects(line2, -w2 / 2, skid + H * 0.45, h1 * 0.6), L * 0.47 + 0.002), yellow).rotate(0, 90, 0));
  api.add(paint, weathered('paint', 0.72, [{ kind: 'edgeWear', amount: 0.7, color: '#8a8064' }, { kind: 'grime', amount: 0.3 }]));
  // Steel: latches on the front, hinges on the back, corner caps.
  const steel = seed(api, skid + H * 0.8);
  for (const sx of [-1, 1]) {
    const x = sx * L * 0.3;
    steel.merge(api.box(S * 0.07, H * 0.22, 0.008).translate(x, skid + H * 0.76, D * 0.47 + 0.004));
    steel.merge(api.box(S * 0.05, S * 0.025, 0.02).translate(x, skid + H * 0.7, D * 0.47 + 0.01));
    steel.merge(api.box(S * 0.08, H * 0.16, 0.008).translate(x, skid + H * 0.8, -(D * 0.47 + 0.004)));
    for (const sz of [-1, 1]) {
      for (const y of [skid + 0.02 * S, skid + H - 0.02 * S]) {
        steel.merge(api.box(S * 0.05, S * 0.04, 0.004).translate(sx * (L * 0.47 - S * 0.025), y, sz * (D * 0.47 + 0.002)));
        steel.merge(api.box(0.004, S * 0.04, S * 0.05).translate(sx * (L * 0.47 + 0.002), y, sz * (D * 0.47 - S * 0.025)));
      }
    }
  }
  addFinish(api, steel, 'black-metal', '#3a3c38', { variation: 0.03 });
  // Rope handles through the end cleats.
  const rope = seed(api, skid + H * 0.6);
  for (const sx of [-1, 1]) {
    const path: Vec3[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI;
      path.push([sx * (L * 0.47 + S * 0.03 + Math.sin(a) * S * 0.06), skid + H * 0.62 - Math.sin(a) * S * 0.035, Math.cos(a) * D * 0.3]);
    }
    rope.merge(api.tube(path, S * 0.011, 6));
  }
  addFinish(api, rope, 'fabric', '#a99a74', { variation: 0.05 });
  api.collider(boxCollider(0, (skid + H) / 2, 0, L, skid + H, D));
  return api.build();
}

/** A plain dark part (the shadowed core between crate slats). */
function paintSolidDark(api: InternalApi, m: Mesh, color: string): void {
  boxUvs(m);
  m.paint(lin(color));
  api.add(m, { color: '#ffffff', vertexColors: true, roughness: 0.95 });
}

/** Steel drum paint: grime at the foot and paint worn off the rolled hoops and chimes (rust is painted per vertex). */
const DRUM_PAINT = weathered('paint', 0.45, [{ kind: 'grime', amount: 0.4 }, { kind: 'edgeWear', amount: 0.6 }]);

const barrel = defineGenerator({
  id: 'barrel',
  description: 'Barrel: bulging wooden cask with metal hoops, dented and weathered steel oil drum with rolling hoops and bungs, or red explosive barrel with hazard band.',
  category: 'props',
  params: {
    height: pNum(1.1, 0.4, 3, 'height in meters'),
    color: pColor('#8a5a2e', 'body color'),
    hoopColor: pColor('#55585e', 'hoop color'),
    variant: pVariant(2, '0 wooden cask, 1 steel drum, 2 explosive'),
  },
  run(p, api) {
    const H = p.num('height');
    const variant = p.int('variant');
    const R = H * 0.34;
    const hoop = p.color('hoopColor');
    if (variant === 0) {
      const body = staveUvs(api.lathe([[0, 0], [R * 0.84, 0], [R * 0.95, H * 0.2], [R, H * 0.5], [R * 0.95, H * 0.8], [R * 0.84, H], [0, H]], 24), R);
      addFinish(api, body, 'oak', p.color('color'), { uv: 'keep', variation: 0.08, freq: 2 });
      const hoops = seed(api, H / 2);
      for (const [f, rr] of [[0.1, 0.9], [0.3, 0.985], [0.7, 0.985], [0.9, 0.9]] as const) hoops.merge(api.cylinder(R * rr + 0.012, R * rr + 0.012, H * 0.045, 24).translate(0, H * f, 0));
      addFinish(api, hoops, 'black-metal', hoop, { variation: 0.03 });
    } else {
      const c = variant === 2 ? '#b42b2b' : p.color('color') === '#8a5a2e' ? '#3d6e8f' : p.color('color');
      // A steel drum: a recessed lid inside the rolled chime, swedged sides with a few dents of hard use, rust, grime at
      // the foot and paint worn off the hoops (surface layers).
      const rb = R * 0.92;
      const prof: Array<[number, number]> = [[0, H * 0.985], [rb * 0.97, H * 0.985], [rb * 0.97, H * 0.985], [rb, H * 0.975], [rb, H * 0.975]];
      for (let i = 9; i >= 1; i--) prof.push([rb, H * (0.02 + (0.95 * i) / 10)]);
      prof.push([rb, H * 0.02], [rb, H * 0.02], [rb * 0.97, H * 0.012], [rb * 0.97, H * 0.012], [0, H * 0.012]);
      const body = api.lathe(prof, 24);
      const dents = 1 + Math.floor(api.rng() * 3);
      const spots: Vec3[] = [];
      for (let k = 0; k < dents; k++) {
        const a = api.rng() * Math.PI * 2;
        spots.push([Math.sin(a) * rb, H * api.range(0.12, 0.88), Math.cos(a) * rb]);
      }
      const n = api.noise;
      body.displace((x, y, z) => {
        if (Math.hypot(x, z) < rb * 0.99 || y < H * 0.03 || y > H * 0.96) return 0;
        let d = 0.004 * R * n.noise3(x * 6, y * 6, z * 6);
        for (const s of spots) {
          const q = Math.hypot(x - s[0], (y - s[1]) * 0.8, z - s[2]) / (R * 0.45);
          if (q < 1) d -= R * 0.07 * (1 - q * q) * (1 - q * q);
        }
        return d;
      });
      roundUvs(body, R);
      paintNoise(body, api, shade(c, -0.07), shade(c, 0.05), 1.6);
      api.add(rustPaint(body, api, 0.45, H), DRUM_PAINT);
      if (variant === 2) {
        const panels = 16;
        const pw = 2 * R * 0.93 * Math.sin(Math.PI / panels) * 1.02;
        const yellow = seed(api, H / 2);
        const black = seed(api, H / 2);
        for (let k = 0; k < panels; k++) (k % 2 ? black : yellow).merge(api.box(pw, H * 0.16, 0.012).translate(0, H * 0.5, R * 0.925).rotate(0, (k / panels) * 360, 0));
        addFinish(api, yellow, 'paint', '#e2b52c', { variation: 0.04 });
        addFinish(api, black, 'paint', '#1f1f22', { variation: 0.02 });
      }
      const rims = seed(api, H / 2);
      for (const f of [0.02, 0.33, 0.66, 0.98]) rims.merge(api.torus(R * 0.93, H * 0.016, 6, 24).rotate(90, 0, 0).translate(0, H * f, 0));
      rims.merge(api.cylinder(R * 0.12, R * 0.12, H * 0.025, 10).translate(R * 0.5, H * 0.995, 0));
      rims.merge(api.cylinder(R * 0.07, R * 0.07, H * 0.02, 8).translate(-R * 0.55, H * 0.993, R * 0.1));
      boxUvs(rims);
      paintNoise(rims, api, shade(c, -0.3), shade(c, -0.18), 2);
      api.add(rustPaint(rims, api, 0.6, H), DRUM_PAINT);
    }
    api.collider(cylinderCollider(0, H / 2, 0, R * 0.95, H));
    return api.build();
  },
});

const campfire = defineGenerator({
  id: 'campfire',
  description: 'Campfire: ring of stones, crossed logs and layered glowing flame cones with embers (or just embers).',
  category: 'props',
  params: {
    size: pNum(1.2, 0.4, 5, 'diameter in meters'),
    flameColor: pColor('#ff7a1a', 'outer flame color'),
    lit: pBool(true, 'show flames'),
    variant: pVariant(1, '0 teepee logs, 1 log cabin stack'),
  },
  run(p, api) {
    const S = p.num('size');
    const ringR = S * 0.42;
    const stones = seed(api, S * 0.04);
    const n = 12;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + api.rng() * 0.2;
      stones.merge(api.icosphereRock(S * api.range(0.075, 0.105), 0.55, 1).scale(1, 0.65, 1).rotate(0, api.rng() * 360, 0).translate(Math.cos(a) * ringR, S * 0.03, Math.sin(a) * ringR));
    }
    addFinish(api, stones, 'rock', '#8a857d', { variation: 0.14, freq: 4 });
    // The ash bed and scorched earth.
    const ash = api.cylinder(ringR * 0.95, ringR, S * 0.02, 20).translate(0, S * 0.01, 0);
    boxUvs(ash);
    const ashIn = lin('#3a3632');
    const ashOut = lin('#5f564b');
    ash.paintFn((x, _y, z, _nx, _ny, _nz, out) => mixLinear(ashIn, ashOut, Math.min(1, Math.hypot(x, z) / ringR) + 0.15 * api.noise.noise2(x * 9, z * 9), out));
    api.add(ash, finishMat('soil'));
    const logR = S * 0.055;
    const logL = S * 0.62;
    const char = lin('#1b1411');
    const wood = lin('#6e4a2c');
    const logs = seed(api, S * 0.1);
    const addLog = (log: Mesh): void => {
      logs.merge(log);
    };
    if (p.int('variant') === 1) {
      for (let layer = 0; layer < 3; layer++) {
        for (const s of [-1, 1]) {
          const log = roundUvs(api.cylinder(logR, logR, logL * 0.8, 10), logR).rotate(0, 0, 90);
          if (layer % 2) log.rotate(0, 90, 0);
          const off = s * S * 0.13;
          addLog(log.translate(layer % 2 ? off : 0, logR + layer * logR * 1.8, layer % 2 ? 0 : off));
        }
      }
    } else {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * 360 + api.rng() * 20;
        addLog(roundUvs(api.cylinder(logR * 0.9, logR * 1.1, logL, 10), logR).translate(0, logL / 2, 0).rotate(0, 0, 56).translate(S * 0.3, 0, 0).rotate(0, a, 0));
      }
    }
    // Charred towards the heart of the fire.
    logs.paintFn((x, y, z, _nx, _ny, _nz, out) => mixLinear(wood, char, Math.min(1, Math.max(0, (S * 0.36 - Math.hypot(x, z)) / (S * 0.28)) + 0.25 * api.noise.noise3(x * 9, y * 9, z * 9)), out));
    api.add(logs, finishMat('bark'));
    const flame = p.color('flameColor');
    api.add(api.cylinder(S * 0.2, S * 0.24, S * 0.03, 12).translate(0, S * 0.02, 0), glow('#ff3b12', 2.2));
    if (p.bool('lit')) {
      // Licks of flame: tall thin cones leaning in, a hot core.
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + api.rng();
        const h = S * api.range(0.32, 0.62);
        const r = S * api.range(0.05, 0.09);
        const d = S * api.range(0.02, 0.11);
        api.add(api.cone(r, h, 8).rotate(Math.sin(a) * 10, api.rng() * 360, -Math.cos(a) * 10).translate(Math.cos(a) * d, h / 2 + S * 0.05, Math.sin(a) * d), glow(flame, 3));
      }
      api.add(api.cone(S * 0.1, S * 0.4, 8).translate(0, S * 0.25, 0), glow('#ffd23f', 4));
    }
    for (let k = 0; k < 10; k++) {
      const a = api.rng() * Math.PI * 2;
      const r = api.range(0.05, 0.28) * S;
      api.add(api.box(S * 0.025, S * 0.015, S * 0.025).rotate(0, api.rng() * 90, 0).translate(Math.cos(a) * r, S * 0.03, Math.sin(a) * r), glow('#ff5a1f', 2.5));
    }
    api.collider(cylinderCollider(0, S * 0.07, 0, ringR + S * 0.1, S * 0.14));
    return api.build();
  },
});

const tent = defineGenerator({
  id: 'tent',
  description: 'Camping tent: A-frame canvas tent with poles and guy ropes, dome tent, or tipi.',
  category: 'props',
  params: {
    size: pNum(2.5, 1, 10, 'length in meters'),
    color: pColor('#c8553d', 'canvas color'),
    variant: pVariant(2, '0 A-frame, 1 dome, 2 tipi'),
  },
  run(p, api) {
    const S = p.num('size');
    const c = p.color('color');
    const variant = p.int('variant');
    const pole = '#6b4a2f';
    const canvas = (mesh: Mesh): void => {
      boxUvs(mesh);
      paintGradientY(mesh, api, shade(c, -0.18), shade(c, 0.08), 0, S * 0.8, 0.1);
      api.add(mesh, finishMat('fabric'));
    };
    const dark = (mesh: Mesh): void => {
      boxUvs(mesh);
      mesh.paint(lin(shade(c, -0.65)));
      api.add(mesh, finishMat('fabric'));
    };
    let body: Mesh;
    if (variant === 1) {
      const R = S * 0.5;
      const prof: Array<[number, number]> = [];
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * (Math.PI / 2);
        prof.push([i === 8 ? 0 : R * Math.cos(a), R * 0.75 * Math.sin(a)]);
      }
      body = api.lathe([[0, 0], ...prof], 16);
      canvas(body);
      const poles = seed(api, R * 0.3);
      for (const yaw of [45, 135]) {
        const arc: Vec3[] = [];
        for (let i = 0; i <= 16; i++) {
          const a = (i / 16) * Math.PI;
          arc.push([Math.cos(a) * R * 1.01, Math.sin(a) * R * 0.76, 0]);
        }
        poles.merge(api.tube(arc, S * 0.01, 6).rotate(0, yaw, 0));
      }
      addFinish(api, poles, 'black-metal', '#ffffff', { variation: 0 });
      dark(api.extrude([[-R * 0.3, 0], [R * 0.3, 0], [0, R * 0.55]], 0.03).translate(0, 0.01, R * 0.9));
    } else if (variant === 2) {
      const R = S * 0.45;
      body = api.cone(R, S * 1.1, 16).translate(0, S * 0.55, 0);
      boxUvs(body);
      const stripe0 = lin(shade(c, -0.15));
      const stripe1 = lin('#e6dcc6');
      body.paintFn((x, y, z, _nx, _ny, _nz, out) => mixLinear(stripe0, stripe1, ((Math.floor((y * 3) / S * 2) % 3 === 1 ? 0.9 : 0.1) + 0.06 * api.noise.noise3(x * 3, y * 3, z * 3)), out));
      api.add(body, finishMat('fabric'));
      const poles = seed(api, S);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        poles.merge(api.limb([Math.cos(a) * R * 0.25, S * 0.85, Math.sin(a) * R * 0.25], [-Math.cos(a) * R * 0.08, S * 1.3, -Math.sin(a) * R * 0.08], S * 0.014, S * 0.011, 6));
      }
      addFinish(api, poles, 'oak', pole, { variation: 0.05 });
      dark(api.extrude([[-R * 0.25, 0], [R * 0.25, 0], [0, S * 0.45]], 0.03).translate(0, 0.01, R * 0.62).rotate(-21, 0, 0));
    } else {
      const W = S * 0.7;
      const H = S * 0.55;
      // The canvas sags a little between the poles and flares at the hem.
      body = api.extrude([[-W / 2 - 0.04, 0], [W / 2 + 0.04, 0], [W * 0.06, H * 0.98], [0, H], [-W * 0.06, H * 0.98]], S);
      canvas(body);
      // An open door flap folded back, the dark interior behind it, and a groundsheet.
      dark(api.extrude([[-W * 0.26, 0], [W * 0.26, 0], [0, H * 0.8]], 0.02).translate(0, 0.005, S / 2 + 0.01));
      const flap = api.extrude([[0, 0], [W * 0.26, 0], [0, H * 0.8]], 0.015).rotate(0, -60, 0).translate(W * 0.02, 0.005, S / 2 + 0.02);
      canvas(flap);
      addFinish(api, api.box(W + 0.3, 0.01, S + 0.3).translate(0, 0.005, 0), 'fabric', '#4a5340', { variation: 0.05 });
      const wood = seed(api, H / 2);
      for (const sz of [-1, 1]) wood.merge(api.cylinder(0.022, 0.022, H + 0.15, 8).translate(0, (H + 0.15) / 2, sz * (S / 2 + 0.04)));
      wood.merge(api.cylinder(0.018, 0.018, S + 0.12, 8).rotate(90, 0, 0).translate(0, H + 0.02, 0));
      addFinish(api, wood, 'oak', pole, { variation: 0.05 });
      const ropes = seed(api, H / 2);
      const pegs = seed(api, 0.05);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const peg: Vec3 = [sx * (W / 2 + 0.45), 0.02, sz * (S / 2 + 0.3)];
          ropes.merge(api.limb([0, H + 0.1, sz * (S / 2 + 0.04)], peg, 0.005, 0.005, 4));
          pegs.merge(api.box(0.025, 0.12, 0.025).translate(peg[0], 0.05, peg[2]));
        }
        // Hem pegs along the sides.
        for (const fz of [-0.35, 0, 0.35]) pegs.merge(api.box(0.02, 0.08, 0.02).translate(sx * (W / 2 + 0.08), 0.03, S * fz));
      }
      addFinish(api, ropes, 'fabric', '#d8cfbd', { variation: 0.02 });
      addFinish(api, pegs, 'brushed-metal', '#9a9ea3', { variation: 0 });
    }
    api.collider(hullOf(body));
    return api.build();
  },
});

const dock = defineGenerator({
  id: 'dock',
  description: 'Wooden pier/jetty along X: plank deck on posts with stringers, bollards, rope and an optional lantern post.',
  category: 'props',
  params: {
    length: pNum(8, 2, 40, 'length (x) in meters'),
    width: pNum(3, 1, 10, 'width (z) in meters'),
    height: pNum(1.2, 0.3, 5, 'deck height above ground/water in meters'),
    color: pColor('#8b5a2b', 'wood color'),
    variant: pVariant(1, '0 plain, 1 with lantern and rope rails'),
  },
  run(p, api) {
    const L = p.num('length');
    const W = p.num('width');
    const H = p.num('height');
    const c = p.color('color');
    const planks = Math.max(4, Math.min(100, Math.round(L / 0.3)));
    const pw = L / planks;
    const deck = seed(api, H - 0.1);
    for (let i = 0; i < planks; i++) {
      const x = -L / 2 + pw * (i + 0.5);
      deck.merge(api.box(pw * 0.88, 0.07, W * api.range(0.97, 1.03)).translate(x, H - 0.035, api.range(-0.03, 0.03)));
    }
    addFinish(api, deck, 'oak', c, { variation: 0.14, freq: 1.4 });
    const frame = seed(api, H - 0.2);
    for (const sz of [-1, 1]) frame.merge(api.box(L, 0.18, 0.14).translate(0, H - 0.16, sz * (W / 2 - 0.2)));
    const posts = Math.max(2, Math.min(9, Math.round(L / 2.2) + 1));
    const piles = seed(api, H / 2);
    for (let i = 0; i < posts; i++) {
      const x = -L / 2 + 0.15 + (i * (L - 0.3)) / (posts - 1);
      for (const sz of [-1, 1]) {
        const ph = H + (i === posts - 1 || i === 0 ? 0.4 : 0.05);
        piles.merge(roundUvs(api.cylinder(0.11, 0.13, ph, 12), 0.12).translate(x, ph / 2, sz * (W / 2 - 0.05)));
        api.collider(cylinderCollider(x, ph / 2, sz * (W / 2 - 0.05), 0.12, ph));
      }
    }
    addFinish(api, frame, 'oak', shade(c, -0.3), { variation: 0.06 });
    addFinish(api, piles, 'oak', shade(c, -0.35), { uv: 'keep', variation: 0.12, freq: 2 });
    addFinish(api, api.lathe([[0, 0], [0.13, 0], [0.12, 0.2], [0.17, 0.27], [0, 0.3]], 16).translate(L / 2 - 0.5, H, W / 2 - 0.35), 'black-metal', '#ffffff', { variation: 0 });
    if (p.int('variant') === 1) {
      const rope = seed(api, H + 0.3);
      for (const sz of [-1, 1]) {
        const pts: Vec3[] = [];
        for (let i = 0; i <= 24; i++) {
          const x = -L / 2 + 0.15 + (i / 24) * (L - 0.3);
          const t = ((i / 24) * (posts - 1)) % 1;
          pts.push([x, H + 0.35 - Math.sin(t * Math.PI) * 0.15, sz * (W / 2 - 0.05)]);
        }
        rope.merge(api.tube(pts, 0.02, 6));
      }
      addFinish(api, rope, 'fabric', '#cdb891', { variation: 0.04 });
      const lx = L / 2 - 0.15;
      const post = api.box(0.1, 1.4, 0.1).translate(lx, H + 0.7, -W / 2 + 0.05).merge(api.box(0.4, 0.06, 0.06).translate(lx - 0.15, H + 1.35, -W / 2 + 0.05));
      addFinish(api, post, 'oak', shade(c, -0.3), { variation: 0.05 });
      addFinish(api, api.box(0.2, 0.03, 0.2).translate(lx - 0.3, H + 1.31, -W / 2 + 0.05).merge(api.box(0.2, 0.03, 0.2).translate(lx - 0.3, H + 1.05, -W / 2 + 0.05)), 'black-metal', '#ffffff', { variation: 0 });
      api.add(api.box(0.15, 0.22, 0.15).translate(lx - 0.3, H + 1.18, -W / 2 + 0.05), glow('#ffcf70', 2.5));
    }
    api.collider(boxCollider(0, H - 0.07, 0, L, 0.14, W));
    return api.build();
  },
});

const statue = defineGenerator({
  id: 'statue',
  description: 'Monument on a stepped pedestal: heroic figure raising a sword, abstract spiral sculpture, or a bust on a fluted column.',
  category: 'props',
  params: {
    height: pNum(2.5, 0.5, 20, 'total height in meters'),
    color: pColor('#c9c3b5', 'figure color (try #b08d57 for bronze)'),
    pedestalColor: pColor('#8f8a82', 'pedestal color'),
    variant: pVariant(2, '0 hero, 1 abstract spiral, 2 bust on column'),
  },
  run(p, api) {
    const H = p.num('height');
    const c = p.color('color');
    const ped = p.color('pedestalColor');
    const variant = p.int('variant');
    const pedH = H * (variant === 2 ? 0.55 : 0.3);
    const pw = H * 0.32;
    const bronze = c === '#b08d57';
    const figFinish = bronze ? 'brass' : 'marble';
    const figColor = bronze ? '#8a6a42' : c;
    if (variant === 2) {
      const pedM = api.box(pw * 1.2, pedH * 0.08, pw * 1.2).translate(0, pedH * 0.04, 0).merge(api.box(pw, pedH * 0.08, pw).translate(0, pedH * 0.96, 0));
      addFinish(api, pedM, 'limestone', ped, { variation: 0.06 });
      // Fluted column: a lathe with alternating radii around.
      const col = api.cylinder(pw * 0.32, pw * 0.36, pedH * 0.84, 32).translate(0, pedH * 0.5, 0);
      col.displace((x, y, z) => {
        void y;
        return Math.cos(Math.atan2(x, z) * 16) > 0.6 ? -0.012 * pw : 0;
      });
      addFinish(api, col, 'limestone', shade(ped, 0.1), { uv: 'round', radius: pw * 0.34, variation: 0.04 });
      const bustH = H - pedH;
      const bust = api.lathe([[0, 0], [bustH * 0.32, 0], [bustH * 0.34, bustH * 0.18], [bustH * 0.2, bustH * 0.36], [bustH * 0.08, bustH * 0.42], [0, bustH * 0.42]], 20).scale(1, 1, 0.6).translate(0, pedH, 0);
      bust.merge(api.icosphere(bustH * 0.2, 3).scale(0.85, 1.05, 0.95).translate(0, pedH + bustH * 0.62, 0));
      bust.merge(api.box(bustH * 0.07, bustH * 0.09, bustH * 0.08).translate(0, pedH + bustH * 0.6, bustH * 0.2));
      addFinish(api, bust, figFinish, figColor, { variation: 0.04 });
      api.collider(cylinderCollider(0, pedH / 2, 0, pw * 0.6, pedH));
      api.collider(cylinderCollider(0, pedH + bustH * 0.45, 0, bustH * 0.3, bustH * 0.9));
      return api.build();
    }
    const pedM = api.box(pw * 1.3, pedH * 0.25, pw * 1.3).translate(0, pedH * 0.125, 0);
    pedM.merge(api.box(pw, pedH * 0.6, pw).translate(0, pedH * 0.55, 0));
    pedM.merge(api.box(pw * 1.12, pedH * 0.15, pw * 1.12).translate(0, pedH * 0.925, 0));
    addFinish(api, pedM, 'limestone', ped, { variation: 0.06 });
    api.collider(boxCollider(0, pedH / 2, 0, pw * 1.3, pedH, pw * 1.3));
    const fh = H - pedH;
    if (variant === 1) {
      const path: Vec3[] = [];
      for (let i = 0; i <= 60; i++) {
        const t = i / 60;
        const a = t * Math.PI * 5;
        const r = fh * 0.22 * (1 - t * 0.7);
        path.push([Math.cos(a) * r, pedH + t * fh, Math.sin(a) * r]);
      }
      addFinish(api, api.tube(path, fh * 0.05, 12, (t) => 1.2 - 0.7 * t), 'brass', bronze ? '#8a6a42' : '#7a5c3a', { variation: 0.05 });
      addFinish(api, api.sphere(fh * 0.07, 2).translate(0, pedH + fh * 1.02, 0), 'brass', '#ffffff', { variation: 0 });
      api.collider(cylinderCollider(0, pedH + fh / 2, 0, fh * 0.25, fh));
      return api.build();
    }
    const u = fh / 1.9;
    const y0 = pedH;
    const fig = seed(api, y0 + fh / 2);
    const limb = (a: Vec3, b: Vec3, r0: number, r1: number): void => {
      fig.merge(api.limb([a[0] * u, y0 + a[1] * u, a[2] * u], [b[0] * u, y0 + b[1] * u, b[2] * u], r0 * u, r1 * u, 10));
    };
    limb([-0.12, 0, 0.05], [-0.11, 0.48, 0], 0.07, 0.08);
    limb([-0.11, 0.48, 0], [-0.1, 0.92, 0], 0.08, 0.1);
    limb([0.12, 0, -0.08], [0.11, 0.46, 0.02], 0.07, 0.08);
    limb([0.11, 0.46, 0.02], [0.1, 0.92, 0], 0.08, 0.1);
    fig.merge(api.lathe([[0, 0], [0.17, 0.02], [0.2, 0.3], [0.24, 0.5], [0.12, 0.62], [0, 0.64]], 16).scale(u, u, u * 0.62).translate(0, y0 + 0.88 * u, 0));
    fig.merge(api.icosphere(0.12 * u, 2).scale(0.9, 1.1, 1).translate(0, y0 + 1.66 * u, 0));
    limb([0.22, 1.42, 0], [0.38, 1.7, 0.05], 0.06, 0.05);
    limb([0.38, 1.7, 0.05], [0.42, 1.95, 0.05], 0.05, 0.045);
    limb([-0.22, 1.42, 0], [-0.3, 1.15, 0.1], 0.06, 0.05);
    limb([-0.3, 1.15, 0.1], [-0.28, 0.9, 0.18], 0.05, 0.045);
    fig.merge(api.extrude([[-0.2, 1.5], [0.2, 1.5], [0.3, 0.55], [0, 0.45], [-0.3, 0.55]], 0.03).scale(u, u, u).translate(0, y0, -0.16 * u));
    addFinish(api, fig, figFinish, figColor, { variation: 0.05 });
    addFinish(api, api.box(0.035 * u, 0.75 * u, 0.012 * u).translate(0.42 * u, y0 + 2.3 * u, 0.05 * u), 'brushed-metal', '#d9dde3', { variation: 0 });
    addFinish(api, api.box(0.2 * u, 0.03 * u, 0.04 * u).translate(0.42 * u, y0 + 1.95 * u, 0.05 * u), 'brass', '#ffffff', { variation: 0 });
    api.collider(cylinderCollider(0, y0 + 0.9 * u, 0, 0.3 * u, 1.8 * u));
    return api.build();
  },
});

/** Prop generators in catalog order. */
export const PROP_GENERATORS = [lampPost, bench, table, chair, crate, barrel, campfire, tent, dock, statue];
