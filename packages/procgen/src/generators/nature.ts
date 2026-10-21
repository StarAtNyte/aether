/**
 * Nature generators: trees, bushes, rocks, grass, flowers, mushrooms.
 * Stylized low-poly with vertex-color variation; trees stay under 2k triangles.
 */
import type { Vec3 } from '@aether/core';
import type { InternalApi } from '../api';
import { MeshBuilder, type Mesh } from '../kernel/mesh';
import { cylinderCollider, boxCollider } from '../colliders';
import { mixHex, mixLinear } from '../color';
import {
  defineGenerator, doubleSided, hullOf, jitter, lin, MAT, paintGradientY, paintNoise, pBool, pColor, pInt, pNum, pVariant, ROOTED, segmentBox, shade,
} from './kit';

/** A curved, tapered, V-folded leaf/blade strip (single-sided; caller may double it). */
function ribbon(api: InternalApi, points: Vec3[], widths: number[], side: Vec3, fold: number): Mesh {
  const b = new MeshBuilder(points.length * 3, (points.length - 1) * 12);
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Vec3;
    const w = widths[i] as number;
    const v = i / (points.length - 1);
    b.vertex(p[0] - side[0] * w, p[1] - side[1] * w - fold * w, p[2] - side[2] * w, 0, 1, 0, 0, v);
    b.vertex(p[0], p[1], p[2], 0, 1, 0, 0.5, v);
    b.vertex(p[0] + side[0] * w, p[1] + side[1] * w - fold * w, p[2] + side[2] * w, 0, 1, 0, 1, v);
  }
  for (let i = 0; i + 1 < points.length; i++) {
    const a = i * 3;
    const c = a + 3;
    b.quad(a, a + 1, c + 1, c);
    b.quad(a + 1, a + 2, c + 2, c + 1);
  }
  const mesh = api.fromBuilder(b).recomputeNormals();
  // make normals face up-ish consistently
  const n = mesh.normals;
  let up = 0;
  for (let i = 1; i < n.length; i += 3) up += n[i] as number;
  if (up < 0) {
    mesh.flipWinding();
    for (let i = 0; i < n.length; i++) n[i] = -(n[i] as number);
  }
  return mesh;
}

const treePine = defineGenerator({
  id: 'tree-pine',
  description: 'Stylized low-poly conifer: stacked, slightly jittered cone tiers on a short trunk. Optional snow.',
  category: 'nature',
  params: {
    height: pNum(6, 1.5, 25, 'total height in meters'),
    color: pColor('#2f6b3a', 'needle color'),
    trunkColor: pColor('#5b3a24', 'trunk color'),
    tiers: pInt(4, 2, 8, 'number of foliage tiers'),
    snow: pBool(false, 'snow on the branches'),
    variant: pVariant(3, '0 classic, 1 slender, 2 wide, 3 sparse'),
  },
  run(p, api) {
    const H = p.num('height');
    const variant = p.int('variant');
    const tiers = p.int('tiers');
    const width = [0.3, 0.2, 0.38, 0.27][variant] ?? 0.3;
    const trunkR = H * 0.045;
    const trunkH = H * 0.3;
    const trunk = api.cylinder(trunkR * 0.65, trunkR, trunkH, 7).translate(0, trunkH / 2, 0);
    paintNoise(trunk, api, shade(p.color('trunkColor'), -0.25), p.color('trunkColor'), 3);
    api.add(trunk, MAT.bark);

    const baseY = trunkH * 0.6;
    const canopyH = H - baseY;
    const needle = p.color('color');
    const dark = lin(shade(needle, -0.35));
    const light = lin(shade(needle, variant === 3 ? 0.05 : 0.18));
    const snow = lin('#f3f6fa');
    const snowy = p.bool('snow');
    const canopy: Mesh[] = [];
    const tierH = (canopyH / tiers) * (variant === 3 ? 1.35 : 1.7);
    for (let i = 0; i < tiers; i++) {
      const t = tiers > 1 ? i / (tiers - 1) : 0;
      const bottom = baseY + (canopyH - tierH) * t;
      const top = bottom + tierH;
      const r = H * width * (1 - 0.68 * t) * (0.9 + api.rng() * 0.2);
      const segs = 7 + (i % 2);
      const tier = api.lathe(
        [[0, bottom + tierH * 0.08], [r * 0.72, bottom], [r, bottom + tierH * 0.1], [r * 0.35, bottom + tierH * 0.62], [0, top]],
        segs,
      );
      tier.rotate((api.rng() - 0.5) * 6, api.rng() * 360, (api.rng() - 0.5) * 6);
      tier.paintFn((x, y, z, _nx, ny, _nz, out) => {
        const k = (y - bottom) / tierH;
        mixLinear(dark, light, k * 0.9 + 0.25 * api.noise.noise3(x * 2, y * 2, z * 2), out);
        if (snowy && ny > 0.35) mixLinear(out, snow, Math.min(1, (ny - 0.35) * 2.2) * (0.6 + 0.4 * k), out);
      });
      canopy.push(tier);
    }
    const crown = canopy.reduce((acc, m) => acc.merge(m));
    api.add(crown, MAT.leaf);
    api.collider(cylinderCollider(0, trunkH / 2, 0, trunkR, trunkH));
    api.collider(hullOf(crown));
    return api.build(ROOTED);
  },
});

const treeOak = defineGenerator({
  id: 'tree-oak',
  description: 'Broadleaf deciduous tree: curved tapered trunk with branches and a lumpy clustered canopy.',
  category: 'nature',
  params: {
    height: pNum(5, 2, 15, 'total height in meters'),
    color: pColor('#4f8a3b', 'foliage color (try #d9822b for autumn)'),
    trunkColor: pColor('#6b4a2f', 'trunk color'),
    density: pInt(6, 3, 10, 'number of foliage clusters'),
    variant: pVariant(2, '0 round, 1 tall, 2 wide'),
  },
  run(p, api) {
    const H = p.num('height');
    const variant = p.int('variant');
    const trunkH = H * 0.45;
    const trunkR = H * 0.055;
    const lean = (api.rng() - 0.5) * H * 0.08;
    const path: Vec3[] = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      path.push([lean * t * t + Math.sin(t * 3) * H * 0.015, trunkH * t, lean * 0.5 * t]);
    }
    const top = path[path.length - 1] as Vec3;
    const trunk = api.tube(path, trunkR, 7, (t) => 1.25 - 0.55 * t + (t < 0.12 ? (0.12 - t) * 3 : 0));
    const bark = p.color('trunkColor');
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + api.rng();
      const from = path[3] as Vec3;
      const to: Vec3 = [from[0] + Math.cos(a) * H * 0.2, from[1] + H * 0.17, from[2] + Math.sin(a) * H * 0.2];
      trunk.merge(api.limb(from, to, trunkR * 0.5, trunkR * 0.25, 5));
    }
    paintNoise(trunk, api, shade(bark, -0.3), shade(bark, 0.1), 4);
    api.add(trunk, MAT.bark);

    const R = H * ([0.32, 0.26, 0.4][variant] ?? 0.32);
    const sy = [0.85, 1.2, 0.7][variant] ?? 0.85;
    const cy = top[1] + R * 0.55 * sy;
    const leaf = p.color('color');
    const n = p.int('density');
    let canopy = api.icosphereRock(R * 0.75, 0.5, 1).scale(1, sy, 1).translate(top[0], cy, top[2]);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + api.rng() * 0.6;
      const elev = api.range(-0.35, 0.75);
      const d = R * api.range(0.5, 0.75);
      const r = R * api.range(0.42, 0.62);
      const blob = api.icosphereRock(r, 0.55, 1).scale(1, sy, 1);
      blob.translate(top[0] + Math.cos(a) * d * Math.cos(elev), cy + Math.sin(elev) * d * sy, top[2] + Math.sin(a) * d * Math.cos(elev));
      canopy = canopy.merge(blob);
    }
    const b = canopy.bounds();
    const dark = shade(leaf, -0.4);
    const bright = shade(leaf, 0.2);
    paintGradientY(canopy, api, dark, bright, b.min[1], b.max[1], 0.18);
    api.add(canopy, MAT.leaf);
    api.collider(segmentBox(path[0] as Vec3, top, trunkR));
    api.collider(hullOf(canopy));
    return api.build(ROOTED);
  },
});

const treePalm = defineGenerator({
  id: 'tree-palm',
  description: 'Tropical palm: curved, ring-segmented trunk with arching V-folded fronds and coconuts.',
  category: 'nature',
  params: {
    height: pNum(7, 3, 16, 'total height in meters'),
    color: pColor('#3f9a3a', 'frond color'),
    trunkColor: pColor('#9c7a4f', 'trunk color'),
    fronds: pInt(8, 4, 12, 'number of fronds'),
    coconuts: pBool(true, 'show coconuts'),
    variant: pVariant(2, 'curvature: 0 gentle, 1 strong, 2 straight'),
  },
  run(p, api) {
    const H = p.num('height');
    const variant = p.int('variant');
    const bend = ([0.18, 0.35, 0.03][variant] ?? 0.18) * H;
    const yaw = api.rng() * Math.PI * 2;
    const dirX = Math.cos(yaw), dirZ = Math.sin(yaw);
    const segs = 8;
    const r0 = H * 0.035;
    const pts: Vec3[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      pts.push([dirX * bend * t * t, H * 0.92 * t, dirZ * bend * t * t]);
    }
    const trunkColor = p.color('trunkColor');
    let trunk: Mesh | null = null;
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const r = r0 * (1.15 - 0.4 * t);
      const piece = api.limb(pts[i] as Vec3, pts[i + 1] as Vec3, r * 1.08, r * 0.88, 7);
      paintNoise(piece, api, shade(trunkColor, i % 2 ? -0.18 : -0.05), shade(trunkColor, i % 2 ? 0.02 : 0.12), 5);
      trunk = trunk ? trunk.merge(piece) : piece;
    }
    if (trunk) api.add(trunk, MAT.bark);
    for (let k = 0; k < 3; k++) {
      const a = pts[k * 3] as Vec3;
      const b = pts[Math.min(segs, k * 3 + 3)] as Vec3;
      api.collider(segmentBox(a, b, r0 * (1.05 - 0.25 * k)));
    }

    const crown = pts[segs] as Vec3;
    const frondColor = p.color('color');
    const nFronds = p.int('fronds');
    const L = H * 0.45;
    let fronds: Mesh | null = null;
    for (let k = 0; k < nFronds; k++) {
      const a = (k / nFronds) * Math.PI * 2 + api.rng() * 0.4;
      const dx = Math.cos(a), dz = Math.sin(a);
      const lift = api.range(0.25, 0.65);
      const droop = api.range(0.75, 1.1);
      const path: Vec3[] = [];
      const widths: number[] = [];
      const n = 7;
      for (let i = 0; i < n; i++) {
        const s = i / (n - 1);
        path.push([crown[0] + dx * L * s, crown[1] + L * (lift * s - droop * s * s), crown[2] + dz * L * s]);
        widths.push(L * 0.13 * Math.pow(Math.sin(Math.PI * Math.min(0.97, s * 0.92 + 0.06)), 0.7));
      }
      const frond = ribbon(api, path, widths, [-dz, 0, dx], 0.45);
      const c0 = lin(shade(frondColor, -0.3));
      const c1 = lin(shade(frondColor, 0.15));
      frond.paintFn((x, _y, z, _nx, _ny, _nz, out) => {
        const d = Math.hypot(x - crown[0], z - crown[2]) / L;
        mixLinear(c0, c1, d + 0.15 * api.noise.noise2(x * 3, z * 3), out);
      });
      doubleSided(frond);
      fronds = fronds ? fronds.merge(frond) : frond;
    }
    if (fronds) api.add(fronds, MAT.leaf);
    if (p.bool('coconuts')) {
      let nuts: Mesh | null = null;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.5;
        const nut = api.sphere(H * 0.028, 0).translate(crown[0] + Math.cos(a) * r0 * 1.3, crown[1] - H * 0.03, crown[2] + Math.sin(a) * r0 * 1.3);
        paintNoise(nut, api, '#4a3018', '#6e4a26', 9);
        nuts = nuts ? nuts.merge(nut) : nut;
      }
      if (nuts) api.add(nuts, MAT.wood);
    }
    return api.build(ROOTED);
  },
});

const bush = defineGenerator({
  id: 'bush',
  description: 'Rounded leafy shrub made of lumpy clusters, optionally with berries.',
  category: 'nature',
  params: {
    size: pNum(1.2, 0.3, 5, 'diameter in meters'),
    color: pColor('#4a8c3a', 'leaf color'),
    berries: pBool(false, 'add berries'),
    berryColor: pColor('#c0392b', 'berry color'),
    variant: pVariant(2, '0 round, 1 low and wide, 2 tall'),
  },
  run(p, api) {
    const S = p.num('size') / 2;
    const variant = p.int('variant');
    const sy = [0.8, 0.55, 1.15][variant] ?? 0.8;
    const count = 3 + Math.floor(api.rng() * 3);
    let body = api.icosphereRock(S * 0.62, 0.5, 1).scale(1, sy, 1).translate(0, S * 0.5 * sy, 0);
    const centers: Vec3[] = [[0, S * 0.5 * sy, 0]];
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + api.rng() * 0.8;
      const d = S * api.range(0.35, 0.5);
      const r = S * api.range(0.4, 0.55);
      const c: Vec3 = [Math.cos(a) * d, r * sy * 0.85, Math.sin(a) * d];
      centers.push(c);
      body = body.merge(api.icosphereRock(r, 0.5, 1).scale(1, sy, 1).translate(c[0], c[1], c[2]));
    }
    const bb = body.bounds();
    const leaf = p.color('color');
    paintGradientY(body, api, shade(leaf, -0.4), shade(leaf, 0.18), bb.min[1], bb.max[1], 0.2);
    api.add(body, MAT.leaf);
    if (p.bool('berries')) {
      let berries: Mesh | null = null;
      for (let k = 0; k < 9; k++) {
        const c = centers[k % centers.length] as Vec3;
        const a = api.rng() * Math.PI * 2;
        const e = api.range(0.1, 1.1);
        const r = S * 0.5;
        const b = api.icosphere(S * 0.05, 0).translate(c[0] + Math.cos(a) * Math.cos(e) * r, c[1] + Math.sin(e) * r * sy, c[2] + Math.sin(a) * Math.cos(e) * r);
        berries = berries ? berries.merge(b) : b;
      }
      if (berries) {
        paintNoise(berries, api, shade(p.color('berryColor'), -0.15), shade(p.color('berryColor'), 0.15), 12);
        api.add(berries, { preset: 'plastic', vertexColors: true, roughness: 0.35 });
      }
    }
    api.collider(hullOf(body));
    return api.build();
  },
});

const rock = defineGenerator({
  id: 'rock',
  description: 'Faceted low-poly boulder with color variation and optional moss on top surfaces.',
  category: 'nature',
  params: {
    size: pNum(1.5, 0.2, 20, 'approximate diameter in meters'),
    color: pColor('#8a8a85', 'stone color'),
    mossy: pBool(false, 'moss on upward-facing facets'),
    mossColor: pColor('#5d7f3a', 'moss color'),
    variant: pVariant(3, '0 boulder, 1 flat slab, 2 tall spire, 3 round pebble'),
  },
  run(p, api) {
    const S = p.num('size') / 2;
    const variant = p.int('variant');
    const scales: Vec3[] = [[1, 0.72, 0.88], [1.25, 0.38, 1], [0.7, 1.45, 0.75], [1, 0.8, 1]];
    const sc = scales[variant] ?? [1, 0.72, 0.88];
    const roughness = variant === 3 ? 0.25 : 0.62;
    const r = api.icosphereRock(S, roughness, variant === 3 ? 1 : 2);
    r.scale(sc[0], sc[1], sc[2]).rotate(0, api.rng() * 360, (api.rng() - 0.5) * 10);
    // flatten the base so it sits stably on the ground
    const b0 = r.bounds();
    const cut = b0.min[1] + (b0.max[1] - b0.min[1]) * 0.12;
    const pos = r.positions;
    for (let i = 1; i < pos.length; i += 3) if ((pos[i] as number) < cut) pos[i] = cut;
    r.toFlat();
    const base = p.color('color');
    const c0 = lin(shade(base, -0.28));
    const c1 = lin(shade(base, 0.14));
    const moss = lin(p.color('mossColor'));
    const mossy = p.bool('mossy');
    const n = api.noise;
    r.paintFn((x, y, z, _nx, ny, _nz, out) => {
      mixLinear(c0, c1, 0.5 + 0.5 * n.noise3(x * 1.7, y * 1.7, z * 1.7) + (y - cut) * 0.05, out);
      if (mossy && ny > 0.5) mixLinear(out, moss, Math.min(1, (ny - 0.5) * 2.5 + 0.3 * n.noise3(x * 4, y * 4, z * 4)), out);
    });
    api.add(r, MAT.stone);
    api.collider(hullOf(r));
    return api.build();
  },
});

const grassTuft = defineGenerator({
  id: 'grass-tuft',
  description: 'Small clump of curved grass blades (decorative; scatter it in large numbers).',
  category: 'nature',
  params: {
    size: pNum(0.5, 0.1, 3, 'blade height in meters'),
    color: pColor('#6aa84f', 'grass color'),
    blades: pInt(9, 3, 24, 'number of blades'),
    variant: pVariant(1, '0 upright, 1 windswept'),
  },
  run(p, api) {
    const S = p.num('size');
    const n = p.int('blades');
    const windswept = p.int('variant') === 1;
    const base = p.color('color');
    const c0 = lin(shade(base, -0.25));
    const c1 = lin(shade(mixHex(base, '#e8e07a', 0.35), 0.12));
    let all: Mesh | null = null;
    for (let k = 0; k < n; k++) {
      const a = api.rng() * Math.PI * 2;
      const r = api.range(0, S * 0.18);
      const h = S * api.range(0.55, 1);
      const lean = windswept ? 0.45 : api.range(0.1, 0.35);
      const dir = windswept ? 0.6 : a;
      const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
      const dx = Math.cos(dir), dz = Math.sin(dir);
      const path: Vec3[] = [];
      const widths: number[] = [];
      for (let i = 0; i < 4; i++) {
        const s = i / 3;
        path.push([bx + dx * lean * h * s * s, h * s, bz + dz * lean * h * s * s]);
        widths.push(S * 0.055 * (1 - s * 0.92));
      }
      const blade = ribbon(api, path, widths, [-dz, 0, dx], 0.2);
      blade.paintFn((_x, y, _z, _nx, _ny, _nz, out) => mixLinear(c0, c1, y / S, out));
      doubleSided(blade);
      all = all ? all.merge(blade) : blade;
    }
    if (all) api.add(all, { ...MAT.leaf, flatShading: false });
    api.collider(boxCollider(0, 0.01, 0, S * 0.4, 0.02, S * 0.4));
    return api.build(ROOTED);
  },
});

const flowers = defineGenerator({
  id: 'flowers',
  description: 'Small patch of flowers on curved stems with leaves (daisies or tulips).',
  category: 'nature',
  params: {
    size: pNum(0.6, 0.15, 3, 'patch diameter in meters (flower height ≈ size)'),
    color: pColor('#e84a8a', 'petal color'),
    centerColor: pColor('#ffd23f', 'flower center color'),
    count: pInt(5, 1, 12, 'number of flowers'),
    variant: pVariant(1, '0 daisy, 1 tulip'),
  },
  run(p, api) {
    const S = p.num('size');
    const n = p.int('count');
    const tulip = p.int('variant') === 1;
    const petal = p.color('color');
    let stems: Mesh | null = null;
    let heads: Mesh | null = null;
    let centers: Mesh | null = null;
    const pushTo = (acc: Mesh | null, m: Mesh): Mesh => (acc ? acc.merge(m) : m);
    for (let k = 0; k < n; k++) {
      const a = api.rng() * Math.PI * 2;
      const r = n === 1 ? 0 : api.range(0.1, 0.45) * S;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = S * api.range(0.6, 1);
      const tilt = api.range(-0.12, 0.12) * S;
      const top: Vec3 = [x + tilt, h, z - tilt * 0.5];
      const stem = api.tube([[x, 0, z], [x + tilt * 0.3, h * 0.5, z], top], S * 0.012, 5);
      const leafPath: Vec3[] = [[x, h * 0.2, z], [x + S * 0.08, h * 0.32, z + S * 0.02], [x + S * 0.16, h * 0.36, z + S * 0.04]];
      const leaf = doubleSided(ribbon(api, leafPath, [S * 0.005, S * 0.03, S * 0.002], [0, 0, 1], 0.3));
      stem.merge(leaf);
      paintGradientY(stem, api, '#2e5d1f', '#5c9a3a', 0, h);
      stems = pushTo(stems, stem);
      const hc = jitter(api, petal, 0.12);
      if (tulip) {
        const R = S * 0.07;
        const cup = api.lathe([[0, 0], [R * 0.75, R * 0.35], [R, R * 1.1], [R * 0.8, R * 1.7], [0, R * 1.45]], 6);
        cup.translate(top[0], top[1] - R * 0.2, top[2]);
        paintGradientY(cup, api, shade(hc, -0.25), shade(hc, 0.15), top[1], top[1] + R * 1.6);
        heads = pushTo(heads, cup);
      } else {
        const petals = 6;
        for (let i = 0; i < petals; i++) {
          const pa = (i / petals) * Math.PI * 2 + a;
          const pl = S * 0.06;
          const pe = api.icosphere(1, 0).scale(pl, S * 0.008, pl * 0.4);
          pe.rotate(0, (-pa * 180) / Math.PI, 0).translate(top[0] + Math.cos(pa) * pl * 0.9, top[1], top[2] + Math.sin(pa) * pl * 0.9);
          paintNoise(pe, api, shade(hc, -0.12), shade(hc, 0.12), 20);
          heads = pushTo(heads, pe);
        }
        const c = api.icosphere(S * 0.028, 0).scale(1, 0.55, 1).translate(top[0], top[1] + S * 0.008, top[2]);
        paintNoise(c, api, shade(p.color('centerColor'), -0.2), p.color('centerColor'), 30);
        centers = pushTo(centers, c);
      }
    }
    if (stems) api.add(stems, { ...MAT.leaf, flatShading: false });
    if (heads) api.add(heads, { preset: 'fabric', vertexColors: true, roughness: 0.7 });
    if (centers) api.add(centers, { preset: 'plastic', vertexColors: true, roughness: 0.8 });
    api.collider(boxCollider(0, 0.01, 0, S * 0.6, 0.02, S * 0.6));
    return api.build(ROOTED);
  },
});

const mushroom = defineGenerator({
  id: 'mushroom',
  description: 'Fairy-tale toadstool with a domed spotted cap and pale stem; can be a small cluster.',
  category: 'nature',
  params: {
    height: pNum(0.6, 0.1, 5, 'height in meters'),
    color: pColor('#c0392b', 'cap color'),
    stemColor: pColor('#f1e6d0', 'stem color'),
    spots: pBool(true, 'white spots on the cap'),
    variant: pVariant(2, '0 toadstool, 1 flat cap, 2 cluster of three'),
  },
  run(p, api) {
    const H = p.num('height');
    const variant = p.int('variant');
    const capColor = p.color('color');
    const stemColor = p.color('stemColor');
    const specs: Array<{ x: number; z: number; h: number }> = variant === 2
      ? [{ x: 0, z: 0, h: H }, { x: H * 0.35, z: H * 0.12, h: H * 0.62 }, { x: -H * 0.2, z: H * 0.3, h: H * 0.45 }]
      : [{ x: 0, z: 0, h: H }];
    let stems: Mesh | null = null;
    let caps: Mesh | null = null;
    let dots: Mesh | null = null;
    for (const s of specs) {
      const h = s.h;
      const r = h * 0.11;
      const stem = api.lathe([[0, 0], [r * 1.25, 0], [r * 1.05, h * 0.25], [r * 0.85, h * 0.62], [r * 0.95, h * 0.72], [0, h * 0.72]], 8);
      stem.translate(s.x, 0, s.z);
      paintGradientY(stem, api, shade(stemColor, -0.18), stemColor, 0, h * 0.7);
      stems = stems ? stems.merge(stem) : stem;
      const R = h * (variant === 1 ? 0.5 : 0.4);
      const ch = h * (variant === 1 ? 0.22 : 0.4);
      const y0 = h * 0.62;
      const cap = api.lathe([[0, y0 + ch * 0.12], [R * 0.95, y0], [R, y0 + ch * 0.12], [R * 0.85, y0 + ch * 0.55], [R * 0.5, y0 + ch * 0.9], [0, y0 + ch]], 10);
      cap.translate(s.x, 0, s.z);
      const top = lin(capColor);
      const under = lin(shade(stemColor, -0.1));
      const rim = lin(shade(capColor, -0.25));
      cap.paintFn((x, y, z, _nx, ny, _nz, out) => {
        if (ny < -0.2) {
          out[0] = under[0]; out[1] = under[1]; out[2] = under[2];
        } else mixLinear(rim, top, (y - y0) / ch + 0.1 * api.noise.noise3(x * 6, y * 6, z * 6), out);
      });
      caps = caps ? caps.merge(cap) : cap;
      if (p.bool('spots')) {
        const count = 6;
        for (let k = 0; k < count; k++) {
          const a = (k / count) * Math.PI * 2 + api.rng() * 0.7;
          const u = k === 0 ? 0 : api.range(0.4, 0.75);
          const rr = R * u * 0.95;
          const yy = y0 + ch * (1 - u * u * 0.75);
          const dot = api.icosphere(R * 0.12 * (k === 0 ? 1.2 : 1), 0).scale(1, 0.35, 1);
          dot.rotate(-Math.cos(a) * u * 50, 0, Math.sin(a) * u * 50);
          dot.translate(s.x + Math.sin(a) * rr, yy, s.z + Math.cos(a) * rr);
          dots = dots ? dots.merge(dot) : dot;
        }
      }
      api.collider(cylinderCollider(s.x, h * 0.31, s.z, r * 1.1, h * 0.62));
      api.collider(cylinderCollider(s.x, y0 + ch * 0.45, s.z, R, ch * 0.9));
    }
    if (stems) api.add(stems, { preset: 'plastic', vertexColors: true, roughness: 0.8 });
    if (caps) api.add(caps, { preset: 'plastic', vertexColors: true, roughness: 0.5 });
    if (dots) {
      paintNoise(dots, api, '#f4efe6', '#ffffff', 10);
      api.add(dots, { preset: 'plastic', vertexColors: true, roughness: 0.6 });
    }
    return api.build(ROOTED);
  },
});

/** Nature generators in catalog order. */
export const NATURE_GENERATORS = [treePine, treeOak, treePalm, bush, rock, grassTuft, flowers, mushroom];
