/**
 * FX / fantasy generators: crystal clusters, clouds and portals. Emissive
 * materials make them glow under the renderer's bloom pass.
 */
import type { MaterialSpec } from '@aether/core';
import type { InternalApi } from '../api';
import type { Mesh } from '../kernel/mesh';
import { boxCollider } from '../colliders';
import { mixHex } from '../color';
import { defineGenerator, glow, hullOf, jitter, lin, MAT, paintGradientY, paintNoise, pColor, pInt, pNum, pVariant, shade } from './kit';

const DEG = 180 / Math.PI;

function crystalMaterial(color: string, intensity: number): MaterialSpec {
  return { preset: 'crystal', vertexColors: true, flatShading: true, roughness: 0.12, metalness: 0.1, emissive: color, emissiveIntensity: intensity };
}

/** Hexagonal prism with a pointed tip, base at the origin, pointing +Y. */
function shard(api: InternalApi, r: number, h: number): Mesh {
  return api.lathe([[0, 0], [r * 0.85, 0], [r, h * 0.08], [r * 0.92, h * 0.72], [0, h]], 6);
}

const crystal = defineGenerator({
  id: 'crystal',
  description: 'Glowing crystal formation: cluster of faceted emissive prisms on a dark rock base, a single tall crystal, or a floating shard ring.',
  category: 'fx',
  params: {
    size: pNum(1.5, 0.3, 10, 'height of the tallest crystal in meters'),
    color: pColor('#7fd4ff', 'crystal color'),
    glow: pNum(1.5, 0, 6, 'emissive intensity'),
    count: pInt(7, 1, 15, 'number of crystals'),
    variant: pVariant(2, '0 cluster, 1 single monolith, 2 floating ring'),
  },
  run(p, api) {
    const S = p.num('size');
    const c = p.color('color');
    const variant = p.int('variant');
    const mat = crystalMaterial(c, p.num('glow'));
    const base = api.icosphereRock(S * 0.35, 0.5, 1).scale(1.2, 0.45, 1.1);
    paintNoise(base, api, '#2b2d33', '#4a4d55', 3);
    api.add(base, MAT.stone);
    api.collider(hullOf(base));
    const bb = base.bounds();
    const top = bb.max[1] * 0.6;
    let all: Mesh | null = null;
    const add = (m: Mesh): void => {
      const b = m.bounds();
      paintGradientY(m, api, shade(c, -0.35), mixHex(c, '#ffffff', 0.55), b.min[1], b.max[1], 0.08);
      all = all ? all.merge(m) : m;
    };
    if (variant === 1) {
      add(shard(api, S * 0.16, S).rotate(api.range(-5, 5), api.rng() * 60, api.range(-5, 5)).translate(0, top - S * 0.05, 0));
      for (let k = 0; k < Math.min(4, p.int('count')); k++) {
        const a = (k / 4) * 360 + api.rng() * 40;
        add(shard(api, S * 0.06, S * api.range(0.25, 0.4)).rotate(0, 0, 35).rotate(0, a, 0).translate(Math.cos(-a / DEG) * S * 0.12, top - S * 0.05, Math.sin(-a / DEG) * S * 0.12));
      }
    } else if (variant === 2) {
      const n = p.int('count');
      add(shard(api, S * 0.1, S * 0.5).translate(0, top, 0));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const h = S * api.range(0.18, 0.3);
        const s = shard(api, S * 0.045, h);
        s.translate(0, -h / 2, 0).rotate(api.range(-30, 30), 0, api.range(-30, 30));
        s.translate(Math.cos(a) * S * 0.5, top + S * 0.55 + Math.sin(a * 3) * S * 0.08, Math.sin(a) * S * 0.5);
        add(s);
      }
    } else {
      const n = p.int('count');
      add(shard(api, S * 0.12, S).rotate(api.range(-6, 6), api.rng() * 60, api.range(-6, 6)).translate(0, top - S * 0.08, 0));
      for (let k = 1; k < n; k++) {
        const a = (k / n) * 360 + api.range(-15, 15);
        const h = S * api.range(0.35, 0.75);
        const tilt = api.range(18, 42);
        const s = shard(api, S * api.range(0.06, 0.1), h).rotate(0, 0, tilt).rotate(0, a, 0);
        const r = S * api.range(0.05, 0.15);
        s.translate(Math.cos(-a / DEG) * r, top - S * 0.08, Math.sin(-a / DEG) * r);
        add(s);
      }
    }
    if (all) {
      api.add(all, mat);
      api.collider(hullOf(all));
    }
    return api.build();
  },
});

const cloud = defineGenerator({
  id: 'cloud',
  description: 'Billowing cloud made of many overlapping smooth puffs with cauliflower relief and a soft blue-grey underside (cumulus, flat stratus, or dark storm cloud). Place it high in the sky.',
  category: 'fx',
  params: {
    size: pNum(4, 1, 40, 'length in meters'),
    color: pColor('#ffffff', 'top color'),
    variant: pVariant(2, '0 cumulus, 1 stratus (flat), 2 storm'),
  },
  run(p, api) {
    const S = p.num('size');
    const variant = p.int('variant');
    const top = variant === 2 && p.color('color') === '#ffffff' ? '#8d939e' : p.color('color');
    const bottom = variant === 2 ? '#4a4f5a' : shade(mixHex(top, '#b8c6d9', 0.6), -0.05);
    const flat = variant === 1 ? 0.42 : 0.72;
    // Billowing cloud: many overlapping smooth puffs, a rounded (not cut) belly, cauliflower relief from layered noise and a soft
    // gradient from a sunlit crown to a blue-grey underside. Smooth normals and vertex colours: no facets, no flat base.
    const big = S > 22;
    const n = (big ? 7 : variant === 1 ? 10 : 13) + Math.floor(api.rng() * (big ? 3 : 4));
    const detail = big ? 3 : 2;
    let body: Mesh | null = null;
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0.5 : k / (n - 1);
      const x = (t - 0.5) * S * 0.78 + api.range(-0.05, 0.05) * S;
      const r = S * (0.1 + 0.15 * Math.sin(t * Math.PI)) * api.range(0.75, 1.2);
      const z = api.range(-0.14, 0.14) * S;
      const lift = variant === 1 ? 0 : api.range(0, 0.1) * S * Math.sin(t * Math.PI);
      const blob = api.icosphere(r, detail).scale(1, flat, 0.85).translate(x, r * flat * 0.5 + lift, z);
      body = body ? body.merge(blob) : blob;
    }
    if (body) {
      const pos = body.positions;
      const nz = api.noise;
      const relief = S * 0.035;
      for (let i = 0; i < pos.length; i += 3) {
        const px = pos[i] as number;
        const py = pos[i + 1] as number;
        const pz = pos[i + 2] as number;
        const k = 3 / S;
        const w = 0.6 * nz.noise3(px * k * 3, py * k * 3, pz * k * 3) + 0.4 * nz.noise3(px * k * 8, py * k * 8, pz * k * 8);
        pos[i + 1] = py < 0 ? py * 0.35 : py;
        pos[i] = px + (body.normals[i] as number) * w * relief;
        pos[i + 1] = (pos[i + 1] as number) + (body.normals[i + 1] as number) * w * relief;
        pos[i + 2] = pz + (body.normals[i + 2] as number) * w * relief;
      }
      body.recomputeNormals();
      const b = body.bounds();
      const lo = lin(bottom);
      const hi = lin(top);
      body.paintFn((x, y, z, _nx, ny, _nz, out) => {
        const h = Math.max(0, Math.min(1, (y - b.min[1]) / Math.max(1e-6, (b.max[1] - b.min[1]) * 0.85)));
        const wob = 0.12 * nz.noise3(x * 0.5 / S * 6, y * 0.5 / S * 6, z * 0.5 / S * 6);
        const m = Math.max(0, Math.min(1, h * 0.75 + ny * 0.25 + 0.1 + wob));
        out[0] = lo[0] + (hi[0] - lo[0]) * m;
        out[1] = lo[1] + (hi[1] - lo[1]) * m;
        out[2] = lo[2] + (hi[2] - lo[2]) * m;
      });
      api.add(body, { vertexColors: true, roughness: 1, flatShading: false, opacity: variant === 1 ? 0.9 : 1 });
      api.collider(boxCollider((b.min[0] + b.max[0]) / 2, b.max[1] * 0.4, (b.min[2] + b.max[2]) / 2, (b.max[0] - b.min[0]) * 0.8, b.max[1] * 0.8, (b.max[2] - b.min[2]) * 0.7));
    }
    return api.build();
  },
});

const portal = defineGenerator({
  id: 'portal',
  description: 'Magic portal: ring of carved stone blocks with glowing runes around a luminous swirling disc on a stepped platform (or a sci-fi metal gate).',
  category: 'fx',
  params: {
    size: pNum(3, 1, 20, 'inner diameter of the ring in meters'),
    color: pColor('#6b6b7a', 'frame color'),
    glowColor: pColor('#8a5cff', 'portal glow color'),
    variant: pVariant(1, '0 ancient stone, 1 sci-fi metal'),
  },
  run(p, api) {
    const S = p.num('size');
    const R = S / 2;
    const c = p.color('color');
    const g = p.color('glowColor');
    const scifi = p.int('variant') === 1;
    const frameW = Math.max(0.25, S * 0.12);
    const depth = Math.max(0.3, S * 0.16);
    const baseH = S * 0.12;
    const cy = baseH + frameW + R;
    // platform
    piece(api, api.box(S * 1.5, baseH * 0.5, depth * 3).translate(0, baseH * 0.25, 0), shade(c, -0.15), scifi ? MAT.metal : MAT.stone);
    piece(api, api.box(S * 1.25, baseH * 0.5, depth * 2.2).translate(0, baseH * 0.75, 0), c, scifi ? MAT.metal : MAT.stone);
    api.collider(boxCollider(0, baseH / 2, 0, S * 1.5, baseH, depth * 3));
    const n = scifi ? 16 : 12;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2 + 0.012;
      const a1 = ((k + 1) / n) * Math.PI * 2 - 0.012;
      const r0 = R;
      const r1 = R + frameW;
      const block = api.extrude([
        [Math.cos(a0) * r0, Math.sin(a0) * r0], [Math.cos(a0) * r1, Math.sin(a0) * r1],
        [Math.cos(a1) * r1, Math.sin(a1) * r1], [Math.cos(a1) * r0, Math.sin(a1) * r0],
      ], depth * (scifi ? 1 : api.range(0.95, 1.08))).translate(0, cy, 0);
      piece(api, block, scifi ? (k % 2 ? shade(c, -0.15) : c) : jitter(api, c, 0.12), scifi ? MAT.metal : MAT.stone);
      const am = (a0 + a1) / 2;
      const rm = R + frameW / 2;
      api.collider({ kind: 'box', halfExtents: [frameW / 2, (rm * (a1 - a0)) / 2 + 0.01, depth / 2], offset: [Math.cos(am) * rm, cy + Math.sin(am) * rm, 0], rotation: [0, 0, am * DEG] });
      if (k % (scifi ? 2 : 3) === 0) {
        const rune = api.box(frameW * 0.35, frameW * 0.35, 0.04).rotate(0, 0, am * DEG + 45).translate(Math.cos(am) * rm, cy + Math.sin(am) * rm, depth / 2 + 0.02);
        api.add(rune, glow(g, 3));
        api.add(rune.clone().translate(0, 0, -depth - 0.04), glow(g, 3));
      }
    }
    const disc = api.cylinder(R * 0.99, R * 0.99, depth * 0.08, 32).rotate(90, 0, 0).translate(0, cy, 0);
    api.add(disc, glow(g, 0.9));
    const inner = mixHex(g, '#ffffff', 0.45);
    for (const sz of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const rr = R * (0.75 - k * 0.22);
        const ring = api.torus(rr, R * 0.025, 4, 24).rotate(0, 0, k * 20).translate(0, cy, sz * depth * (0.06 + k * 0.012));
        api.add(ring, glow(inner, 1.6 + k * 0.5));
      }
    }
    // floating motes
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + api.rng();
      const r = R + frameW + S * 0.12;
      const mote = api.cone(S * 0.03, S * 0.07, 4).merge(api.cone(S * 0.03, S * 0.07, 4).rotate(180, 0, 0).translate(0, -S * 0.07, 0));
      mote.translate(Math.cos(a) * r, cy + Math.sin(a) * r, api.range(-0.3, 0.3) * depth);
      api.add(mote, glow(inner, 2.5));
    }
    return api.build();
  },
});

function piece(api: InternalApi, mesh: Mesh, color: string, material: MaterialSpec): void {
  paintNoise(mesh, api, shade(color, -0.12), shade(color, 0.1), 2.5);
  api.add(mesh, material);
}

/** FX generators in catalog order. */
export const FX_GENERATORS = [crystal, cloud, portal];
