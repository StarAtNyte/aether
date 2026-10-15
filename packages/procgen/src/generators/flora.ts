/**
 * Realistic vegetation: broadleaf trees, spruce, birch, shrubs, meadow grass, ferns and boulders.
 *
 * Where the stylised nature generators (`tree-oak`, `tree-pine` …) read as toys on purpose, these
 * build what a camera would see: tapered, buttressed trunks that carry a photographed bark finish,
 * forking limbs, and foliage made of alpha-tested cards: each quad shows a cut-out cluster of leaves
 * (or a needle spray, a tuft of blades, a fern frond), so a crown is a few hundred quads that read as
 * thousands of leaves and cast real leaf shadows. The cards carry *soft normals* (they point away from
 * the crown's centre, not along the card), so a crown shades as one volume and glows at its sunlit edge;
 * vertex colours darken toward the inside of the crown and vary card by card.
 *
 * Budgets: a tree is 1-3 k triangles, grass tufts a dozen. Both faces of a card are in the geometry with
 * the same soft normal, so the material stays single-sided and no card turns dark from behind.
 * Everything is deterministic for a seed.
 */
import type { Vec3 } from '@aether/core';
import type { InternalApi } from '../api';
import { MeshBuilder, type Mesh } from '../kernel/mesh';
import { boxCollider, cylinderCollider } from '../colliders';
import { mixLinear, type RGB } from '../color';
import { defineGenerator, hullOf, lin, pColor, pInt, pNum, pVariant, shade } from './kit';

/** Bark: the photographed bark surface, tinted per vertex. */
const BARK = { finish: 'bark', vertexColors: true } as const;
/** Rock: the photographed rock surface, tinted per vertex. */
const ROCK = { finish: 'rock', vertexColors: true } as const;
/** Foliage cards (the renderer cuts the leaves out of each quad). */
const foliage = (kind: 'broadleaf' | 'shrub' | 'needles' | 'grass' | 'fern') => ({ foliage: kind, vertexColors: true, roughness: 0.8, metalness: 0 }) as const;

/** Unit vector of `v`. */
function unit(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Accumulates foliage cards: quads with 0..1 UVs, a soft normal and one tint per vertex. Both faces are
 * written (the renderer draws the material single-sided).
 */
class Sheets {
  private readonly b: MeshBuilder;
  private readonly colors: number[] = [];
  count = 0;

  constructor(expected: number) {
    this.b = new MeshBuilder(Math.max(8, expected * 4), Math.max(24, expected * 12));
  }

  /**
   * A card anchored at `o`. `u` runs along the card's width, `v` along its height ("up" in the picture:
   * leaf tips, blade tips). `anchor` 'bottom': `o` is the middle of the bottom edge; 'left': the middle of
   * the left edge (needle sprays and fronds grow along `u` from their base).
   */
  add(o: Vec3, u: Vec3, v: Vec3, w: number, h: number, anchor: 'bottom' | 'left', n: Vec3, base: RGB, top: RGB): void {
    const ox = anchor === 'bottom' ? -w / 2 : 0;
    const oy = anchor === 'bottom' ? 0 : -h / 2;
    const corner = (cu: number, cv: number): Vec3 => [o[0] + u[0] * (ox + cu * w) + v[0] * (oy + cv * h), o[1] + u[1] * (ox + cu * w) + v[1] * (oy + cv * h), o[2] + u[2] * (ox + cu * w) + v[2] * (oy + cv * h)];
    const c: Array<[Vec3, number, number]> = [
      [corner(0, 0), 0, 1],
      [corner(1, 0), 1, 1],
      [corner(1, 1), 1, 0],
      [corner(0, 1), 0, 0],
    ];
    const ids = c.map(([p, tu, tv]) => this.b.vertex(p[0], p[1], p[2], n[0], n[1], n[2], tu, tv));
    this.b.tri(ids[0] as number, ids[1] as number, ids[2] as number);
    this.b.tri(ids[0] as number, ids[2] as number, ids[3] as number);
    this.b.tri(ids[0] as number, ids[2] as number, ids[1] as number);
    this.b.tri(ids[0] as number, ids[3] as number, ids[2] as number);
    this.colors.push(base[0], base[1], base[2], base[0], base[1], base[2], top[0], top[1], top[2], top[0], top[1], top[2]);
    this.count++;
  }

  /** The finished mesh (null when no card was added). */
  build(api: InternalApi): Mesh | null {
    if (this.count === 0) return null;
    const m = api.fromBuilder(this.b);
    m.colors = Float32Array.from(this.colors);
    return m;
  }
}

/** Seeded point in a unit ball with a bias toward the surface (leaves sit on the outside of a crown). */
function inBall(api: InternalApi, surfaceBias: number): Vec3 {
  for (let k = 0; k < 12; k++) {
    const x = api.rng() * 2 - 1;
    const y = api.rng() * 2 - 1;
    const z = api.rng() * 2 - 1;
    const d = Math.hypot(x, y, z);
    if (d > 1 || d < 1e-3) continue;
    const s = Math.pow(d, 1 - surfaceBias) / d;
    return [x * s, y * s, z * s];
  }
  return [0, 1, 0];
}

/** Cylindrical metre UVs for bark (the bark photograph repeats every metre). */
function barkUvs(mesh: Mesh, axisX: number, axisZ: number): void {
  const p = mesh.positions;
  const n = p.length / 3;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = (p[i * 3] as number) - axisX;
    const z = (p[i * 3 + 2] as number) - axisZ;
    const r = Math.max(0.05, Math.hypot(x, z));
    uv[i * 2] = Math.atan2(z, x) * Math.min(r, 0.6);
    uv[i * 2 + 1] = p[i * 3 + 1] as number;
  }
  mesh.uvs = uv;
}

/** Box-projected metre UVs (rock): the dominant axis of each vertex normal picks the plane. */
function boxUvs(mesh: Mesh): void {
  const p = mesh.positions;
  const nr = mesh.normals;
  const n = p.length / 3;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const ax = Math.abs(nr[i * 3] as number);
    const ay = Math.abs(nr[i * 3 + 1] as number);
    const az = Math.abs(nr[i * 3 + 2] as number);
    if (ay >= ax && ay >= az) {
      uv[i * 2] = p[i * 3] as number;
      uv[i * 2 + 1] = p[i * 3 + 2] as number;
    } else if (ax >= az) {
      uv[i * 2] = p[i * 3 + 2] as number;
      uv[i * 2 + 1] = p[i * 3 + 1] as number;
    } else {
      uv[i * 2] = p[i * 3] as number;
      uv[i * 2 + 1] = p[i * 3 + 1] as number;
    }
  }
  mesh.uvs = uv;
}

/** Paint a mesh with bark: dark in the fissures (noise), a little lighter in patches. */
function paintBark(api: InternalApi, mesh: Mesh, base: string): void {
  const dark = lin(shade(base, -0.38));
  const light = lin(shade(base, 0.12));
  const n = api.noise;
  mesh.paintFn((x, y, z, _nx, ny, _nz, out) => {
    const fissure = 0.5 + 0.5 * n.noise3(x * 9, y * 1.6, z * 9);
    const patch = 0.5 + 0.5 * n.noise3(x * 1.7, y * 0.8, z * 1.7);
    mixLinear(dark, light, Math.min(1, fissure * 0.7 + patch * 0.35) + ny * 0.06, out);
  });
}

/** Leaf tones of a crown from one base colour (linear): deep shade, mid, sunlit, and a yellowing accent. */
function leafTones(base: string): { deep: RGB; mid: RGB; sun: RGB; warm: RGB } {
  return { deep: lin(shade(base, -0.5)), mid: lin(shade(base, 0.06)), sun: lin(shade(base, 0.32)), warm: lin(shade('#a9b83a', 0.05)) };
}

const SUN: Vec3 = unit([0.35, 0.8, 0.3]);

/**
 * Crown: place `count` leaf-cluster cards around `clusters` (limb ends with radii), each standing out of the
 * crown with a soft normal pointing away from its centre; tint from exposure (toward the sun and the
 * crown's surface is bright, the inside is deep shade) with the odd yellowing card.
 */
function crownCards(
  api: InternalApi,
  sheets: Sheets,
  clusters: ReadonlyArray<{ c: Vec3; r: number }>,
  crown: { c: Vec3; r: Vec3 },
  count: number,
  card: { w: number; h: number },
  tones: { deep: RGB; mid: RGB; sun: RGB; warm: RGB },
  warmShare: number,
): void {
  const per = Math.max(1, Math.round(count / clusters.length));
  const tmp: RGB = [0, 0, 0];
  const top: RGB = [0, 0, 0];
  const base: RGB = [0, 0, 0];
  for (const cl of clusters) {
    for (let k = 0; k < per; k++) {
      const o = inBall(api, 0.6);
      const p: Vec3 = [cl.c[0] + o[0] * cl.r, cl.c[1] + o[1] * cl.r * 0.85, cl.c[2] + o[2] * cl.r];
      const away = unit([(p[0] - crown.c[0]) / crown.r[0], (p[1] - crown.c[1]) / crown.r[1] + 0.12, (p[2] - crown.c[2]) / crown.r[2]]);
      const n = unit([away[0] * 0.8 + o[0] * 0.25, away[1] * 0.8 + o[1] * 0.25 + 0.1, away[2] * 0.8 + o[2] * 0.25]);
      // The card's "up" (leaf tips) points outward and a little up; its width runs across that.
      const v = unit([n[0] + (api.rng() - 0.5) * 0.9, n[1] + (api.rng() - 0.5) * 0.9 + 0.1, n[2] + (api.rng() - 0.5) * 0.9]);
      const u = unit(cross(v, [api.rng() - 0.5, api.rng() - 0.5 + 0.3, api.rng() - 0.5]));
      const depth = Math.min(1, Math.hypot((p[0] - crown.c[0]) / crown.r[0], (p[1] - crown.c[1]) / crown.r[1], (p[2] - crown.c[2]) / crown.r[2]));
      const facing = Math.max(0, n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]);
      const light = Math.min(1, depth * 0.55 + facing * 0.55 + (api.rng() - 0.5) * 0.25);
      mixLinear(tones.deep, tones.mid, Math.min(1, light * 1.4), tmp);
      mixLinear(tmp, tones.sun, Math.max(0, light - 0.55) * 1.6, tmp);
      if (api.rng() < warmShare) mixLinear(tmp, tones.warm, 0.3 + api.rng() * 0.3, tmp);
      mixLinear(tones.deep, tmp, 0.7, base);
      mixLinear(tmp, tones.sun, 0.1, top);
      const s = 0.8 + api.rng() * 0.5;
      sheets.add(p, u, v, card.w * s, card.h * s, 'bottom', n, base, [tmp[0] + (top[0] - tmp[0]), tmp[1] + (top[1] - tmp[1]), tmp[2] + (top[2] - tmp[2])]);
    }
  }
}

/** A limb from a to b as a slightly bent, tapered tube merged into `into`. */
function limb(api: InternalApi, into: Mesh | null, from: Vec3, to: Vec3, r0: number, r1: number, bend: Vec3, simple = false): Mesh {
  const mid: Vec3 = [(from[0] + to[0]) / 2 + bend[0], (from[1] + to[1]) / 2 + bend[1], (from[2] + to[2]) / 2 + bend[2]];
  const path: Vec3[] = simple ? [from, mid, to] : [from, [(from[0] + mid[0]) / 2, (from[1] + mid[1]) / 2, (from[2] + mid[2]) / 2], mid, [(mid[0] + to[0]) / 2, (mid[1] + to[1]) / 2, (mid[2] + to[2]) / 2], to];
  const t = api.tube(path, Math.max(0.006, r0), simple ? 4 : 5, (u) => Math.max(0.15, 1 - (1 - r1 / Math.max(1e-4, r0)) * u));
  return into ? into.merge(t) : t;
}

// ---------------------------------------------------------------------------
// Broadleaf tree
// ---------------------------------------------------------------------------

const treeBroadleaf = defineGenerator({
  id: 'tree-broadleaf',
  description: 'Realistic broadleaf tree (oak, maple, beech): buttressed trunk with a photographed bark surface, forking limbs and a crown of leaf-cluster cards with soft volumetric shading and real leaf shadows. About 2k triangles; use tree-oak for the stylised one.',
  category: 'nature',
  params: {
    height: pNum(9, 3, 30, 'total height in meters'),
    color: pColor('#4a7a2e', 'leaf color (try #b8662b for autumn)'),
    trunkColor: pColor('#6b5a48', 'bark tint'),
    detail: pNum(1, 0.3, 2, 'card count multiplier (lower for distant forests)'),
    variant: pVariant(2, '0 round, 1 tall oval, 2 wide spreading'),
  },
  run(p, api) {
    const H = p.num('height');
    const crownKind = p.int('variant');
    const detail = p.num('detail');
    const trunkH = H * ([0.38, 0.45, 0.32][crownKind] ?? 0.38);
    const trunkR = H * 0.032;
    const lean = (api.rng() - 0.5) * H * 0.06;
    const path: Vec3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      path.push([lean * t * t + Math.sin(t * 2.4 + api.rng() * 0.2) * H * 0.012, trunkH * t, lean * 0.4 * t + Math.cos(t * 2) * H * 0.008]);
    }
    const top = path[path.length - 1] as Vec3;
    let wood: Mesh = api.tube(path, trunkR, 9, (t) => (t < 0.1 ? 1.5 - t * 5 : 1) * (1 - 0.6 * t));
    // The crown's vertical radius fills the space from the trunk top to the tree's height.
    const crownV = (H - trunkH) / 1.35;
    const crownR = crownV * ([0.9, 0.66, 1.2][crownKind] ?? 0.9);
    const crownSy = crownV / crownR;
    const crownC: Vec3 = [top[0], top[1] + crownV * 0.55, top[2]];
    const clusters: Array<{ c: Vec3; r: number }> = [];
    const limbs = 6 + (crownKind === 2 ? 2 : 0);
    for (let k = 0; k < limbs; k++) {
      const t = 0.45 + 0.5 * (k / limbs);
      const from = path[Math.min(path.length - 1, Math.round(t * (path.length - 1)))] as Vec3;
      const a = k * 2.399 + api.rng() * 0.5;
      const reach = crownR * api.range(0.4, 0.72) * (crownKind === 1 ? 0.8 : 1);
      const rise = crownV * api.range(0.45, 0.95);
      const end: Vec3 = [from[0] + Math.cos(a) * reach, from[1] + rise, from[2] + Math.sin(a) * reach];
      const r0 = trunkR * 0.55 * (1 - t * 0.3);
      wood = limb(api, wood, from, end, r0, r0 * 0.3, [0, -reach * 0.1, 0]);
      clusters.push({ c: end, r: crownR * api.range(0.36, 0.5) });
      for (let f = 0; f < 2; f++) {
        const s = 0.55 + f * 0.25;
        const o: Vec3 = [from[0] + (end[0] - from[0]) * s, from[1] + (end[1] - from[1]) * s, from[2] + (end[2] - from[2]) * s];
        const a2 = a + (f === 0 ? 0.9 : -0.9);
        const tw: Vec3 = [o[0] + Math.cos(a2) * reach * 0.35, o[1] + rise * 0.35, o[2] + Math.sin(a2) * reach * 0.35];
        wood = limb(api, wood, o, tw, r0 * 0.4, r0 * 0.12, [0, 0, 0]);
        clusters.push({ c: tw, r: crownR * api.range(0.28, 0.38) });
      }
    }
    clusters.push({ c: crownC, r: crownR * 0.62 });
    paintBark(api, wood, p.color('trunkColor'));
    barkUvs(wood, top[0] * 0.5, top[2] * 0.5);
    api.add(wood, BARK);

    const count = Math.round(520 * detail);
    const sheets = new Sheets(count + clusters.length);
    crownCards(api, sheets, clusters, { c: crownC, r: [crownR, crownR * crownSy, crownR] }, count, { w: H * 0.1, h: H * 0.1 }, leafTones(p.color('color')), 0.1);
    const leaves = sheets.build(api);
    if (leaves) {
      api.add(leaves, foliage('broadleaf'));
      api.collider(cylinderCollider(0, trunkH / 2, 0, trunkR * 1.1, trunkH));
    }
    return api.build();
  },
});

// ---------------------------------------------------------------------------
// Birch
// ---------------------------------------------------------------------------

const treeBirch = defineGenerator({
  id: 'tree-birch',
  description: 'Realistic birch: slender white trunk with dark bands, drooping twigs and a light, airy crown of small-leaf cards.',
  category: 'nature',
  params: {
    height: pNum(8, 3, 22, 'total height in meters'),
    color: pColor('#7fa03a', 'leaf color'),
    detail: pNum(1, 0.3, 2, 'card count multiplier'),
    variant: pVariant(1, '0 slender, 1 full'),
  },
  run(p, api) {
    const H = p.num('height');
    const detail = p.num('detail');
    const full = p.int('variant') === 1;
    const trunkH = H * 0.62;
    const trunkR = H * 0.017;
    const path: Vec3[] = [];
    const lean = (api.rng() - 0.5) * H * 0.08;
    for (let i = 0; i <= 7; i++) {
      const t = i / 7;
      path.push([lean * t * t + Math.sin(t * 3.1) * H * 0.02, trunkH * t, Math.cos(t * 2.3) * H * 0.012]);
    }
    const top = path[path.length - 1] as Vec3;
    let wood: Mesh = api.tube(path, trunkR, 8, (t) => (t < 0.08 ? 1.35 - t * 4 : 1) * (1 - 0.7 * t));
    const crownV = (H - trunkH) / 1.2 + H * 0.06;
    const crownR = H * (full ? 0.27 : 0.2);
    const crownC: Vec3 = [top[0], top[1] + crownV * 0.6, top[2]];
    const clusters: Array<{ c: Vec3; r: number }> = [];
    for (let k = 0; k < 7; k++) {
      const t = 0.5 + 0.5 * (k / 7);
      const from = path[Math.min(path.length - 1, Math.round(t * (path.length - 1)))] as Vec3;
      const a = k * 2.399 + api.rng();
      const reach = crownR * api.range(0.5, 1) * (1.15 - t * 0.5);
      const end: Vec3 = [from[0] + Math.cos(a) * reach, from[1] + crownV * api.range(0.3, 0.8), from[2] + Math.sin(a) * reach];
      const r0 = trunkR * 0.4;
      wood = limb(api, wood, from, end, r0, r0 * 0.3, [0, reach * 0.12, 0]);
      clusters.push({ c: [end[0], end[1] - crownR * 0.12, end[2]], r: crownR * api.range(0.38, 0.5) });
    }
    clusters.push({ c: crownC, r: crownR * 0.5 });
    const white = lin('#e7e3da');
    const grey = lin('#a9a39a');
    const black = lin('#25221f');
    const n = api.noise;
    wood.paintFn((x, y, z, _nx, _ny, _nz, out) => {
      const band = n.noise3(x * 2.5, y * 16, z * 2.5);
      mixLinear(white, grey, 0.5 + 0.5 * n.noise3(x * 5, y * 3, z * 5), out);
      if (band > 0.35) mixLinear(out, black, Math.min(1, (band - 0.35) * 3), out);
      if (y > trunkH * 0.85) mixLinear(out, lin('#6b5a4a'), Math.min(1, (y - trunkH * 0.85) / (trunkH * 0.15)), out);
    });
    barkUvs(wood, top[0] * 0.5, top[2] * 0.5);
    api.add(wood, { ...BARK, color: '#ffffff' });
    const count = Math.round(430 * detail);
    const sheets = new Sheets(count + clusters.length);
    crownCards(api, sheets, clusters, { c: crownC, r: [crownR, crownV, crownR] }, count, { w: H * 0.08, h: H * 0.08 }, leafTones(p.color('color')), 0.18);
    const leaves = sheets.build(api);
    if (leaves) {
      api.add(leaves, foliage('shrub'));
      api.collider(cylinderCollider(0, trunkH / 2, 0, trunkR * 1.2, trunkH));
    }
    return api.build();
  },
});

// ---------------------------------------------------------------------------
// Spruce
// ---------------------------------------------------------------------------

const treeSpruce = defineGenerator({
  id: 'tree-spruce',
  description: 'Realistic spruce / fir: straight trunk and whorls of drooping branches carrying needle-spray cards, narrowing to the tip; optional snow load.',
  category: 'nature',
  params: {
    height: pNum(12, 3, 40, 'total height in meters'),
    color: pColor('#2c4f2a', 'needle color'),
    trunkColor: pColor('#5a4636', 'bark tint'),
    detail: pNum(1, 0.3, 2, 'branch density multiplier'),
    snow: pNum(0, 0, 1, 'snow load on the branches'),
    variant: pVariant(1, '0 slender, 1 broad'),
  },
  run(p, api) {
    const H = p.num('height');
    const detail = p.num('detail');
    const snow = p.num('snow');
    const broad = p.int('variant') === 1 ? 1.3 : 1;
    const trunkR = H * 0.02;
    const trunk = api.tube(
      [
        [0, 0, 0],
        [H * 0.004, H * 0.3, 0],
        [-H * 0.003, H * 0.7, H * 0.002],
        [0, H, 0],
      ],
      trunkR,
      8,
      (t) => (t < 0.08 ? 1.4 - t * 5 : 1) * Math.max(0.06, 1 - 0.94 * t),
    );
    let wood: Mesh = trunk;
    const tones = leafTones(p.color('color'));
    const white = lin('#eef3f8');
    const sheets = new Sheets(Math.round(640 * detail));
    const whorls = Math.max(8, Math.round(H * 1.15 * Math.min(1.4, 0.6 + detail * 0.5)));
    const tmp: RGB = [0, 0, 0];
    const baseC: RGB = [0, 0, 0];
    for (let w = 0; w < whorls; w++) {
      const t = 0.14 + 0.84 * (w / (whorls - 1));
      const y = H * t;
      const reach = H * 0.2 * broad * Math.pow(1 - t, 0.9) * api.range(0.9, 1.1) + H * 0.014;
      const branches = Math.max(4, Math.round((4.5 + (1 - t) * 3) * Math.min(1.3, 0.6 + detail * 0.5)));
      const phase = api.rng() * Math.PI * 2;
      for (let k = 0; k < branches; k++) {
        const a = phase + (k / branches) * Math.PI * 2 + (api.rng() - 0.5) * 0.4;
        const dirX = Math.cos(a);
        const dirZ = Math.sin(a);
        const droop = H * 0.035 * (1 - t * 0.5);
        const end: Vec3 = [dirX * reach, y - droop + reach * 0.12 * t, dirZ * reach];
        if (reach > H * 0.03 && w % 2 === 0) wood = limb(api, wood, [0, y, 0], end, trunkR * 0.26 * (1 - t * 0.6), trunkR * 0.07, [0, droop * 0.4, 0], true);
        // The spray: a card along the branch, tilted down and out, in two layers (upper and a lower, shorter one).
        for (const layer of [0, 1, 2]) {
          const sd = layer === 1 ? -1 : 1;
          const along = unit([dirX + (layer === 2 ? (api.rng() - 0.5) * 0.5 : 0), -0.18 - layer * 0.22 - api.rng() * 0.1, dirZ + (layer === 2 ? (api.rng() - 0.5) * 0.5 : 0)]);
          const lateral = unit(cross(along, [0, 1, 0]));
          const tilt = layer === 0 ? 0.55 : layer === 1 ? -0.2 : 0.1;
          // The card lies in the plane of `along` and a vector tilted from the lateral toward down.
          const across = unit([lateral[0] * (1 - Math.abs(tilt) * 0.4) * sd, -tilt, lateral[2] * (1 - Math.abs(tilt) * 0.4) * sd]);
          const len = reach * (layer === 0 ? 1.05 : layer === 1 ? 0.8 : 0.9) * api.range(0.9, 1.15) + H * 0.02;
          const wid = len * 0.78;
          const exposure = Math.min(1, 0.3 + t * 0.45 + (layer === 0 ? 0.25 : 0) + (api.rng() - 0.5) * 0.25);
          const n = unit([dirX * 0.45, 0.8 + (1 - t) * 0.1, dirZ * 0.45]);
          mixLinear(tones.deep, tones.mid, exposure, tmp);
          mixLinear(tmp, tones.sun, Math.max(0, exposure - 0.7) * 1.1, tmp);
          mixLinear(tones.deep, tmp, 0.7, baseC);
          const top: RGB = [tmp[0], tmp[1], tmp[2]];
          if (snow > 0.01 && api.rng() < snow) {
            mixLinear(top, white, 0.7, top);
            mixLinear(baseC, white, 0.45, baseC);
          }
          sheets.add([0, y - droop * 0.1 * layer, 0], along, across, len, wid, 'left', n, baseC, top);
        }
      }
    }
    // The leader: a tuft of upright needles.
    for (const turn of [0, Math.PI / 2]) {
      const u: Vec3 = [Math.cos(turn), 0, Math.sin(turn)];
      sheets.add([0, H * 0.9, 0], [0, 1, 0], u, H * 0.13, H * 0.12, 'left', [0, 1, 0], tones.mid, tones.sun);
    }
    paintBark(api, wood, p.color('trunkColor'));
    barkUvs(wood, 0, 0);
    api.add(wood, BARK);
    const leaves = sheets.build(api);
    if (leaves) {
      api.add(leaves, foliage('needles'));
      api.collider(cylinderCollider(0, H * 0.25, 0, trunkR * 1.2, H * 0.5));
    }
    return api.build();
  },
});

// ---------------------------------------------------------------------------
// Shrub, fern, grass, boulder
// ---------------------------------------------------------------------------

const shrub = defineGenerator({
  id: 'shrub',
  description: 'Realistic shrub: a dense mound of leaf-cluster cards on a few thin stems (hazel, laurel, juniper). Scatter it under trees and along paths.',
  category: 'nature',
  params: {
    size: pNum(1.2, 0.3, 5, 'diameter in meters'),
    color: pColor('#47702b', 'leaf color'),
    detail: pNum(1, 0.3, 2, 'card count multiplier'),
    variant: pVariant(1, '0 round, 1 tall'),
  },
  run(p, api) {
    const S = p.num('size');
    const detail = p.num('detail');
    const R = S / 2;
    const tall = p.int('variant') === 1 ? 1.5 : 1;
    let stems: Mesh | null = null;
    const clusters: Array<{ c: Vec3; r: number }> = [];
    for (let k = 0; k < 6; k++) {
      const a = k * 2.399 + api.rng() * 0.4;
      const reach = R * api.range(0.35, 0.8);
      const end: Vec3 = [Math.cos(a) * reach, R * api.range(0.7, 1.15) * tall, Math.sin(a) * reach];
      stems = limb(api, stems, [Math.cos(a) * R * 0.05, 0, Math.sin(a) * R * 0.05], end, R * 0.035, R * 0.015, [0, 0, 0], true);
      clusters.push({ c: end, r: R * api.range(0.45, 0.6) });
    }
    clusters.push({ c: [0, R * 0.55, 0], r: R * 0.6 });
    if (stems) {
      paintBark(api, stems, '#6a5442');
      barkUvs(stems, 0, 0);
      api.add(stems, BARK);
    }
    const count = Math.round(130 * detail);
    const sheets = new Sheets(count + clusters.length);
    crownCards(api, sheets, clusters, { c: [0, R * 0.6, 0], r: [R, R * 0.8, R] }, count, { w: S * 0.3, h: S * 0.3 }, leafTones(p.color('color')), 0.08);
    const leaves = sheets.build(api);
    if (leaves) {
      api.add(leaves, foliage('shrub'));
      api.collider(cylinderCollider(0, R * 0.4, 0, R * 0.5, R * 0.8));
    }
    return api.build();
  },
});

const fern = defineGenerator({
  id: 'fern',
  description: 'Realistic fern: a rosette of arching fronds (cut-out frond cards with paired leaflets). Scatter under conifers and along streams.',
  category: 'nature',
  params: {
    size: pNum(0.9, 0.2, 3, 'radius in meters'),
    color: pColor('#3f7a2e', 'frond color'),
    fronds: pInt(9, 3, 16, 'number of fronds'),
    variant: pVariant(1, '0 arching, 1 upright'),
  },
  run(p, api) {
    const S = p.num('size');
    const nF = p.int('fronds');
    const tones = leafTones(p.color('color'));
    const sheets = new Sheets(nF * 2);
    const tmp: RGB = [0, 0, 0];
    const baseC: RGB = [0, 0, 0];
    for (let f = 0; f < nF; f++) {
      const a = (f / nF) * Math.PI * 2 + api.rng() * 0.4;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const len = S * api.range(0.85, 1.15);
      const rise = S * api.range(0.2, 0.45) * (p.int('variant') === 1 ? 1.8 : 1);
      // Two segments: rising out of the crown, then arching over.
      const mid: Vec3 = [dx * len * 0.5, rise, dz * len * 0.5];
      const end: Vec3 = [dx * len, rise * 0.55, dz * len];
      const e = 0.45 + 0.5 * api.rng();
      mixLinear(tones.deep, tones.mid, e, tmp);
      mixLinear(tones.deep, tmp, 0.7, baseC);
      const side: Vec3 = [-dz, 0, dx];
      const n = unit([dx * 0.15, 1, dz * 0.15]);
      const first = unit([mid[0], mid[1], mid[2]]);
      const second = unit([end[0] - mid[0], end[1] - mid[1], end[2] - mid[2]]);
      const top: RGB = [tmp[0], tmp[1], tmp[2]];
      sheets.add([0, 0.02, 0], first, side, Math.hypot(...mid), len * 0.62, 'left', n, baseC, top);
      sheets.add(mid, second, side, Math.hypot(end[0] - mid[0], end[1] - mid[1], end[2] - mid[2]), len * 0.55, 'left', n, tmp.slice() as unknown as RGB, top);
    }
    const m = sheets.build(api);
    if (m) api.add(m, foliage('fern'));
    api.collider(boxCollider(0, 0.05, 0, S, 0.1, S));
    return api.build();
  },
});

const meadowGrass = defineGenerator({
  id: 'meadow-grass',
  description: 'Realistic tuft of tall grass: three crossed cut-out blade cards, deep green roots to pale tips with some straw. Scatter in tens of thousands (wind sway applies).',
  category: 'nature',
  params: {
    size: pNum(0.55, 0.1, 2, 'blade height in meters'),
    color: pColor('#7aa83f', 'grass tint'),
    cards: pInt(3, 1, 6, 'crossed cards per tuft'),
    variant: pVariant(1, '0 lush, 1 dry straw'),
  },
  run(p, api) {
    const S = p.num('size');
    const nC = p.int('cards');
    const tint = p.int('variant') === 1 ? lin(shade('#b8a96a', 0.05)) : lin(p.color('color'));
    const root: RGB = [tint[0] * 0.45, tint[1] * 0.45, tint[2] * 0.45];
    const sheets = new Sheets(nC);
    for (let k = 0; k < nC; k++) {
      const a = (k / nC) * Math.PI + api.rng() * 0.4;
      const u: Vec3 = [Math.cos(a), 0, Math.sin(a)];
      const lean = (api.rng() - 0.5) * 0.25;
      const v = unit([lean * Math.cos(a + 1.57), 1, lean * Math.sin(a + 1.57)]);
      const n = unit([(api.rng() - 0.5) * 0.3, 1, (api.rng() - 0.5) * 0.3]);
      sheets.add([(api.rng() - 0.5) * S * 0.12, 0, (api.rng() - 0.5) * S * 0.12], u, v, S * api.range(0.9, 1.2), S * api.range(0.85, 1.15), 'bottom', n, root, tint);
    }
    const m = sheets.build(api);
    if (m) api.add(m, foliage('grass'));
    api.collider(boxCollider(0, 0.01, 0, S * 0.8, 0.02, S * 0.8));
    return api.build();
  },
});

const boulder = defineGenerator({
  id: 'boulder',
  description: 'Realistic boulder: a displaced, weathered mass with strata, lichen on the top and the photographed rock surface. Flat base. Use rock for the stylised one.',
  category: 'nature',
  params: {
    size: pNum(1.6, 0.2, 20, 'approximate diameter in meters'),
    color: pColor('#8a857b', 'stone tint'),
    lichen: pNum(0.35, 0, 1, 'lichen / moss cover on upward faces'),
    variant: pVariant(2, '0 rounded, 1 blocky, 2 slab'),
  },
  run(p, api) {
    const variant = p.int('variant');
    const R = p.num('size') / 2;
    const sc: Vec3 = [[1, 0.75, 0.9], [1, 0.9, 1.1], [1.35, 0.45, 1]][variant] as Vec3;
    const n = api.noise;
    const m = api.icosphereRock(R, 0.2, 3);
    m.scale(sc[0], sc[1], sc[2]);
    m.displace((x, y, z) => {
      const big = n.fbm2(x * 0.9 + 3, z * 0.9 + y * 0.6, 3) * 0.22;
      const ridge = variant === 1 ? Math.round(n.noise3(x * 1.4, y * 1.4, z * 1.4) * 3) / 3 * 0.1 : n.ridged2(x * 2.1 + y, z * 2.1, 3) * 0.08;
      return (big + ridge) * R;
    });
    const b0 = m.bounds();
    const cut = b0.min[1] + (b0.max[1] - b0.min[1]) * 0.1;
    const pos = m.positions;
    for (let i = 1; i < pos.length; i += 3) if ((pos[i] as number) < cut) pos[i] = cut;
    m.recomputeNormals();
    const base = p.color('color');
    const dark = lin(shade(base, -0.18));
    const light = lin(shade(base, 0.22));
    const warm = lin('#9a8466');
    const moss = lin('#5f7a35');
    const lichen = p.num('lichen');
    m.paintFn((x, y, z, _nx, ny, _nz, out) => {
      const strata = 0.5 + 0.5 * Math.sin((y + n.noise3(x * 1.5, y, z * 1.5) * 0.4) * (9 / Math.max(0.5, R)));
      mixLinear(dark, light, 0.25 + 0.5 * (0.5 + 0.5 * n.noise3(x * 2.2, y * 2.2, z * 2.2)) + strata * 0.2, out);
      mixLinear(out, warm, 0.18 * strata, out);
      if (lichen > 0 && ny > 0.45) mixLinear(out, moss, Math.min(1, (ny - 0.45) * 2.4 + 0.35 * n.noise3(x * 5, y * 5, z * 5)) * lichen, out);
    });
    boxUvs(m);
    api.add(m, ROCK);
    api.collider(hullOf(m));
    return api.build();
  },
});

/** Realistic vegetation and rock, registered with the nature category. */
export const FLORA_GENERATORS = [treeBroadleaf, treeBirch, treeSpruce, shrub, fern, meadowGrass, boulder] as const;
