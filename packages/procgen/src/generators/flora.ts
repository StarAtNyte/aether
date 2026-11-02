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
import { mixHex, mixLinear, type RGB } from '../color';
import { defineGenerator, hullOf, lin, pColor, pInt, pNum, pVariant, ROOTED, shade, triBoxUvs } from './kit';
import { foliageCellUv, FOLIAGE_CELLS } from '../foliage-pixels';

/** Bark: the photographed bark surface, tinted per vertex. */
const BARK = { finish: 'bark', vertexColors: true } as const;
/** Rock: the photographed rock surface, tinted per vertex. */
const ROCK = { finish: 'rock', vertexColors: true } as const;
/** Foliage cards (the renderer cuts the leaves out of each quad). */
const foliage = (kind: 'broadleaf' | 'shrub' | 'needles' | 'grass' | 'fern' | 'blossom' | 'flower') => ({ foliage: kind, vertexColors: true, roughness: 0.8, metalness: 0 }) as const;

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
  add(o: Vec3, u: Vec3, v: Vec3, w: number, h: number, anchor: 'bottom' | 'left', n: Vec3, base: RGB, top: RGB, cell = 0): void {
    const ox = anchor === 'bottom' ? -w / 2 : 0;
    const oy = anchor === 'bottom' ? 0 : -h / 2;
    const corner = (cu: number, cv: number): Vec3 => [o[0] + u[0] * (ox + cu * w) + v[0] * (oy + cv * h), o[1] + u[1] * (ox + cu * w) + v[1] * (oy + cv * h), o[2] + u[2] * (ox + cu * w) + v[2] * (oy + cv * h)];
    // The card shows one of the atlas's variants (see `foliageCellUv`): tips at the cell's top edge, base at its bottom.
    const [u0, v0, u1, v1] = foliageCellUv(cell);
    const c: Array<[Vec3, number, number]> = [
      [corner(0, 0), u0, v1],
      [corner(1, 0), u1, v1],
      [corner(1, 1), u1, v0],
      [corner(0, 1), u0, v0],
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

/**
 * Card size and count for a crown: leaves have a real size, so a card (a cluster of leaves) has one too, whatever the
 * plant's size. `scaled` is the old size-proportional card and `count` its count; the card shrinks toward `real`
 * metres and the count grows to keep the same leaf cover, up to `maxCount` (past it, cards stay a little larger).
 */
export function cardBudget(count: number, scaled: number, real: number, maxCount: number): { count: number; size: number } {
  if (!(count > 0) || !(scaled > 0)) return { count: Math.max(0, Math.round(count)), size: Math.max(0.01, scaled) };
  const size = Math.min(scaled, Math.max(0.05, real));
  const want = count * (scaled / size) ** 2;
  if (want <= maxCount) return { count: Math.round(want), size };
  const n = Math.max(count, maxCount);
  return { count: Math.round(n), size: scaled * Math.sqrt(count / n) };
}

/** A seeded atlas cell for the next card (every card picks one of the atlas's variants). */
function cellOf(api: InternalApi): number {
  return Math.min(FOLIAGE_CELLS * FOLIAGE_CELLS - 1, Math.floor(api.rng() * FOLIAGE_CELLS * FOLIAGE_CELLS));
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

/**
 * Plants are anchored at their root point (see `ROOTED`): move a trunk's path so it starts at the origin, whatever
 * sway the generator gave its base.
 */
function rootPath(path: Vec3[]): Vec3[] {
  const [x0, , z0] = path[0] ?? [0, 0, 0];
  for (const q of path) {
    q[0] -= x0;
    q[2] -= z0;
  }
  return path;
}

/** Flatten whatever of a trunk's flared base reaches below the ground onto it (a tilted first ring dips a little). */
function flatBase(mesh: Mesh): Mesh {
  const pos = mesh.positions;
  for (let i = 1; i < pos.length; i += 3) if ((pos[i] as number) < 0) pos[i] = 0;
  return mesh;
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

/** Blossom tones of a crown: the shaded inside stays a warm rose (never purple), the lit outside the blossom colour, with white highlights. */
function blossomTones(base: string): { deep: RGB; mid: RGB; sun: RGB; warm: RGB } {
  return { deep: lin(shade('#d07f94', -0.08)), mid: lin(shade(base, 0.12)), sun: lin(shade(base, 0.3)), warm: lin('#fff6f8') };
}

/**
 * Leaf tones of a crown from one base colour (linear): deep shade, mid, sunlit, and a yellowing accent. Sunlit
 * leaves are the same green made brighter and a little yellower, never mixed toward white: a white mix reads as
 * pale, papery foliage. The deep tone leans slightly blue, as shade under a crown does.
 */
function leafTones(base: string): { deep: RGB; mid: RGB; sun: RGB; warm: RGB } {
  const b = lin(base);
  // Photographed foliage is darker and more saturated than a painted green: the shade inside a crown is nearly
  // black-green, the mid tone keeps the base's saturation (red and blue held back), sunlit leaves turn only a little
  // yellower (a strong yellow mix read as pale lime paper up close).
  const deep: RGB = [b[0] * 0.2, b[1] * 0.27, b[2] * 0.3];
  const sunny = lin(mixHex(base, '#93b23a', 0.18));
  const sun: RGB = [sunny[0] * 1.3, sunny[1] * 1.42, sunny[2] * 1.1];
  return { deep, mid: [b[0] * 0.98, b[1] * 1.1, b[2] * 0.92], sun, warm: lin(shade('#9aae3a', -0.05)) };
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
  /** When set, no card reaches below this height (a shrub sits on the ground at its root; its low cards stay above it). */
  floor?: number,
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
      if (floor !== undefined) {
        const low = p[1] + Math.min(0, v[1] * card.h * s) - Math.abs(u[1]) * card.w * s * 0.5;
        if (low < floor) p[1] += floor - low;
      }
      sheets.add(p, u, v, card.w * s, card.h * s, 'bottom', n, base, [tmp[0] + (top[0] - tmp[0]), tmp[1] + (top[1] - tmp[1]), tmp[2] + (top[2] - tmp[2])], cellOf(api));
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
    blossom: pNum(0, 0, 1, 'above 0.5: blossoms, not leaves'),
    leaf: pNum(1, 0, 1, 'share of the crown that carries leaves: 0 is a bare winter tree with fine twigs, 1 is full summer foliage'),
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
    rootPath(path);
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
    const leafShare = p.num('leaf');
    if (leafShare < 0.5) {
      // Winter: the crown is a net of fine twigs forking off every limb tip.
      const nTwigs = leafShare < 0.1 ? 7 : 4;
      for (const cl of clusters) {
        for (let f = 0; f < nTwigs; f++) {
          const a = api.rng() * Math.PI * 2;
          const up = 0.25 + api.rng() * 0.7;
          const len = cl.r * api.range(0.75, 1.25);
          const tip: Vec3 = [cl.c[0] + Math.cos(a) * len * (1 - up * 0.4), cl.c[1] + up * len, cl.c[2] + Math.sin(a) * len * (1 - up * 0.4)];
          wood = limb(api, wood, cl.c, tip, trunkR * 0.1, trunkR * 0.025, [0, 0, 0], true);
          const fork: Vec3 = [(cl.c[0] + tip[0]) / 2, (cl.c[1] + tip[1]) / 2, (cl.c[2] + tip[2]) / 2];
          const a2 = a + (api.rng() < 0.5 ? 0.9 : -0.9);
          wood = limb(api, wood, fork, [fork[0] + Math.cos(a2) * len * 0.45, fork[1] + len * 0.3, fork[2] + Math.sin(a2) * len * 0.45], trunkR * 0.05, trunkR * 0.015, [0, 0, 0], true);
        }
      }
    }
    flatBase(wood);
    paintBark(api, wood, p.color('trunkColor'));
    barkUvs(wood, top[0] * 0.5, top[2] * 0.5);
    api.add(wood, BARK);

    const blossoming = p.num('blossom') > 0.5;
    const budget = cardBudget((blossoming ? 440 : 520) * detail * leafShare, H * 0.1, Math.min(0.85, Math.max(0.45, 0.4 + H * 0.04)), 1000 * Math.max(0.3, detail));
    const count = budget.count;
    if (count < 8) {
      api.collider(cylinderCollider(0, trunkH / 2, 0, trunkR * 1.1, trunkH));
      return api.build(ROOTED);
    }
    const sheets = new Sheets(count + clusters.length);
    crownCards(api, sheets, clusters, { c: crownC, r: [crownR, crownR * crownSy, crownR] }, count, { w: budget.size, h: budget.size }, blossoming ? blossomTones(p.color('color')) : leafTones(p.color('color')), blossoming ? 0.12 : 0.1);
    const leaves = sheets.build(api);
    if (leaves) {
      api.add(leaves, foliage(blossoming ? 'blossom' : 'broadleaf'));
      api.collider(cylinderCollider(0, trunkH / 2, 0, trunkR * 1.1, trunkH));
    }
    return api.build(ROOTED);
  },
});

// ---------------------------------------------------------------------------
// Umbrella pine (stone pine)
// ---------------------------------------------------------------------------

const treeUmbrellaPine = defineGenerator({
  id: 'tree-umbrella-pine',
  description: 'Umbrella pine: tall bare leaning trunk, flat wide needle canopy.',
  category: 'nature',
  params: {
    height: pNum(13, 5, 30, 'total height in meters'),
    color: pColor('#4f6a2c', 'needle color'),
    trunkColor: pColor('#7a5a44', 'bark tint (reddish, plated)'),
    spread: pNum(1, 0.6, 1.6, 'canopy width relative to height'),
    detail: pNum(1, 0.3, 2, 'card count multiplier (lower for distant groves)'),
    variant: pVariant(1, '0 young, 1 old and wide'),
  },
  run(p, api) {
    const H = p.num('height');
    const detail = p.num('detail');
    const old = p.int('variant') === 1;
    const trunkH = H * api.range(0.62, 0.72);
    const trunkR = H * 0.028;
    // Stone pines lean and bend: the trunk curves once, away from a random side.
    const la = api.rng() * Math.PI * 2;
    const lean = H * api.range(0.04, 0.12);
    const path: Vec3[] = [];
    for (let i = 0; i <= 7; i++) {
      const t = i / 7;
      const off = lean * Math.sin(t * Math.PI * 0.7);
      path.push([Math.cos(la) * off, trunkH * t, Math.sin(la) * off]);
    }
    rootPath(path);
    const top = path[path.length - 1] as Vec3;
    let wood: Mesh = api.tube(path, trunkR, 9, (t) => (t < 0.08 ? 1.4 - t * 5 : 1) * (1 - 0.45 * t));
    const crownR = H * (old ? 0.42 : 0.3) * p.num('spread');
    const crownV = (H - trunkH) * 0.55;
    const crownY = top[1] + (H - trunkH) * 0.55;
    const clusters: Array<{ c: Vec3; r: number }> = [];
    const limbs = 5 + Math.floor(api.rng() * 3);
    for (let k = 0; k < limbs; k++) {
      const a = k * 2.399 + api.rng() * 0.6;
      const from = path[Math.max(4, path.length - 2 - (k % 3))] as Vec3;
      const reach = crownR * api.range(0.45, 0.8);
      const end: Vec3 = [top[0] + Math.cos(a) * reach, crownY - crownV * api.range(0.2, 0.6), top[2] + Math.sin(a) * reach];
      const r0 = trunkR * 0.6;
      wood = limb(api, wood, from, end, r0, r0 * 0.3, [0, (end[1] - from[1]) * 0.25, 0]);
      clusters.push({ c: [end[0], end[1] + crownV * 0.35, end[2]], r: crownR * api.range(0.38, 0.5) });
      const a2 = a + (api.rng() < 0.5 ? 0.7 : -0.7);
      const mid: Vec3 = [(from[0] + end[0]) / 2, (from[1] + end[1]) / 2, (from[2] + end[2]) / 2];
      const tw: Vec3 = [mid[0] + Math.cos(a2) * reach * 0.45, end[1] + crownV * 0.1, mid[2] + Math.sin(a2) * reach * 0.45];
      wood = limb(api, wood, mid, tw, r0 * 0.45, r0 * 0.12, [0, 0, 0]);
      clusters.push({ c: [tw[0], tw[1] + crownV * 0.3, tw[2]], r: crownR * api.range(0.3, 0.4) });
    }
    clusters.push({ c: [top[0], crownY, top[2]], r: crownR * 0.55 });
    flatBase(wood);
    paintBark(api, wood, p.color('trunkColor'));
    barkUvs(wood, top[0] * 0.5, top[2] * 0.5);
    api.add(wood, BARK);
    const budget = cardBudget(560 * detail, H * 0.09, Math.min(0.85, Math.max(0.45, 0.4 + H * 0.035)), 1100 * Math.max(0.3, detail));
    if (budget.count < 8) {
      api.collider(cylinderCollider(0, trunkH / 2, 0, trunkR * 1.1, trunkH));
      return api.build(ROOTED);
    }
    const sheets = new Sheets(budget.count + clusters.length);
    // A flat dome: wide, shallow, its underside nearly level (the umbrella).
    crownCards(api, sheets, clusters, { c: [top[0], crownY, top[2]], r: [crownR, crownV, crownR] }, budget.count, { w: budget.size, h: budget.size }, leafTones(p.color('color')), 0.08);
    const leaves = sheets.build(api);
    if (leaves) api.add(leaves, foliage('needles'));
    api.collider(cylinderCollider(0, trunkH / 2, 0, trunkR * 1.1, trunkH));
    return api.build(ROOTED);
  },
});

// ---------------------------------------------------------------------------
// Italian cypress and olive (Mediterranean)
// ---------------------------------------------------------------------------

const treeCypress = defineGenerator({
  id: 'tree-cypress',
  description: 'Italian cypress: tall narrow dark-green flame-shaped column, short hidden trunk; plant in rows and clusters.',
  category: 'nature',
  params: {
    height: pNum(14, 4, 30, 'total height in meters'),
    color: pColor('#2c4426', 'needle color (dark green)'),
    trunkColor: pColor('#6b5240', 'bark tint'),
    slenderness: pNum(1, 0.6, 1.6, 'narrower (higher) or fuller (lower)'),
    detail: pNum(1, 0.3, 2, 'card count multiplier (lower for distant rows)'),
    variant: pVariant(1, '0 pencil-straight, 1 slightly leaning and tufted'),
  },
  run(p, api) {
    const H = p.num('height');
    const detail = p.num('detail');
    const R = (H * 0.075) / p.num('slenderness');
    const lean = p.int('variant') === 1 ? H * api.range(0.01, 0.03) : 0;
    const la = api.rng() * Math.PI * 2;
    const path: Vec3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      path.push([Math.cos(la) * lean * t * t, H * 0.7 * t, Math.sin(la) * lean * t * t]);
    }
    rootPath(path);
    const trunkR = H * 0.012;
    const wood: Mesh = api.tube(path, trunkR, 7, (t) => (t < 0.08 ? 1.3 - t * 4 : 1) * (1 - 0.8 * t));
    flatBase(wood);
    paintBark(api, wood, p.color('trunkColor'));
    barkUvs(wood, 0, 0);
    api.add(wood, BARK);
    // A spindle: widest a third of the way up, closing to a pointed tip; clusters stacked up the axis.
    const clusters: Array<{ c: Vec3; r: number }> = [];
    const n = 12;
    for (let k = 0; k < n; k++) {
      const t = 0.03 + (k / (n - 1)) * 0.93;
      const w = R * (0.55 + 0.45 * Math.sin(Math.min(1, t / 0.3) * Math.PI * 0.5)) * (1 - Math.pow(Math.max(0, (t - 0.35) / 0.65), 1.6) * 0.85);
      const at = path[Math.min(path.length - 1, Math.round(t * 6))] as Vec3;
      clusters.push({ c: [at[0] + api.range(-0.1, 0.1) * R, H * t, at[2] + api.range(-0.1, 0.1) * R], r: Math.max(R * 0.25, w) });
    }
    const budget = cardBudget(900 * detail, H * 0.06, Math.min(0.75, Math.max(0.4, 0.32 + H * 0.025)), 1500 * Math.max(0.3, detail));
    if (budget.count >= 8) {
      const sheets = new Sheets(budget.count + clusters.length);
      crownCards(api, sheets, clusters, { c: [path[3]![0], H * 0.5, path[3]![2]], r: [R, H * 0.48, R] }, budget.count, { w: budget.size, h: budget.size }, leafTones(p.color('color')), 0.04, H * 0.04);
      const leaves = sheets.build(api);
      if (leaves) api.add(leaves, foliage('needles'));
    }
    api.collider(cylinderCollider(0, H / 2, 0, Math.max(trunkR * 1.2, R * 0.6), H));
    return api.build(ROOTED);
  },
});

const treeOlive = defineGenerator({
  id: 'tree-olive',
  description: 'Olive tree: gnarled twisting split trunk, low spreading limbs, airy silver-green crown; groves and courtyards.',
  category: 'nature',
  params: {
    height: pNum(6, 2.5, 12, 'total height in meters'),
    color: pColor('#7f8f5c', 'leaf color (grey-green)'),
    trunkColor: pColor('#857864', 'bark tint (grey, fissured)'),
    detail: pNum(1, 0.3, 2, 'card count multiplier'),
    variant: pVariant(1, '0 young single trunk, 1 ancient split trunk'),
  },
  run(p, api) {
    const H = p.num('height');
    const detail = p.num('detail');
    const old = p.int('variant') === 1;
    const trunkH = H * api.range(0.32, 0.42);
    const trunkR = H * (old ? 0.06 : 0.035);
    const stems = old ? 3 : 1;
    let wood: Mesh | null = null;
    const clusters: Array<{ c: Vec3; r: number }> = [];
    const crownR = H * 0.45;
    for (let s = 0; s < stems; s++) {
      const a = (s / stems) * Math.PI * 2 + api.rng();
      const spread = old ? H * 0.12 : H * 0.04;
      const path: Vec3[] = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        // Twisting: the stem winds around its own axis as it leans out.
        const tw = a + t * 1.8;
        path.push([Math.cos(a) * spread * t + Math.cos(tw) * trunkR * 0.6 * Math.sin(t * Math.PI), trunkH * t, Math.sin(a) * spread * t + Math.sin(tw) * trunkR * 0.6 * Math.sin(t * Math.PI)]);
      }
      if (s === 0) rootPath(path);
      const r = trunkR / Math.sqrt(stems);
      const stem = api.tube(path, r, 8, (t) => (t < 0.1 ? 1.5 - t * 5 : 1) * (1 - 0.35 * t));
      wood = wood ? wood.merge(stem) : stem;
      const top = path[path.length - 1] as Vec3;
      const limbs = old ? 2 : 4;
      for (let k = 0; k < limbs; k++) {
        const b = a + (k / limbs) * Math.PI * 2 + api.rng() * 0.8;
        const reach = crownR * api.range(0.5, 0.85);
        const end: Vec3 = [top[0] + Math.cos(b) * reach, H * api.range(0.62, 0.8), top[2] + Math.sin(b) * reach];
        wood = limb(api, wood, top, end, r * 0.55, r * 0.15, [0, (end[1] - top[1]) * 0.4, 0]);
        clusters.push({ c: [end[0], end[1] + H * 0.08, end[2]], r: crownR * api.range(0.35, 0.5) });
      }
      clusters.push({ c: [top[0], H * 0.8, top[2]], r: crownR * 0.45 });
    }
    flatBase(wood as Mesh);
    paintBark(api, wood as Mesh, p.color('trunkColor'));
    barkUvs(wood as Mesh, 0, 0);
    api.add(wood as Mesh, BARK);
    const budget = cardBudget(480 * detail, H * 0.12, Math.min(0.75, Math.max(0.4, 0.35 + H * 0.04)), 1000 * Math.max(0.3, detail));
    if (budget.count >= 8) {
      const sheets = new Sheets(budget.count + clusters.length);
      crownCards(api, sheets, clusters, { c: [0, H * 0.72, 0], r: [crownR, H * 0.24, crownR] }, budget.count, { w: budget.size, h: budget.size }, leafTones(p.color('color')), 0.12);
      const leaves = sheets.build(api);
      if (leaves) api.add(leaves, foliage('broadleaf'));
    }
    api.collider(cylinderCollider(0, trunkH / 2, 0, trunkR * 1.2, trunkH));
    return api.build(ROOTED);
  },
});

const ivy = defineGenerator({
  id: 'ivy',
  description: 'Ivy or climbing vine: a leafy mat draped over a wall face (spills from the top, thins toward the ground); place against walls, facing +Z.',
  category: 'nature',
  params: {
    width: pNum(4, 0.5, 20, 'width of the covered patch in meters'),
    height: pNum(3, 0.5, 15, 'height of the covered patch in meters'),
    color: pColor('#3f5f2a', 'leaf color'),
    cover: pNum(0.7, 0.2, 1, 'how much of the patch the leaves cover'),
    detail: pNum(1, 0.3, 2, 'card count multiplier'),
    variant: pVariant(2, '0 ivy (dark, dense), 1 vine with flowers (bougainvillea-like), 2 wisteria (hanging lilac)'),
  },
  run(p, api) {
    const W = p.num('width');
    const H = p.num('height');
    const v = p.int('variant');
    const cover = p.num('cover');
    const count = Math.min(1400, Math.round(W * H * 26 * cover * p.num('detail')));
    const sheets = new Sheets(count);
    const tones = leafTones(p.color('color'));
    const bloom: RGB = v === 1 ? [0.75, 0.08, 0.38] : v === 2 ? [0.62, 0.5, 0.86] : tones.sun;
    const tmp: RGB = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      const x = api.range(-W / 2, W / 2);
      // Denser at the top (it grows over the wall head and hangs down), ragged at the lower edge.
      const y = H * (1 - Math.pow(api.rng(), 0.7));
      const edge = 0.35 + 0.65 * api.noise2(x * 0.7 + 3, y * 0.5);
      if (api.rng() > cover * (0.4 + 0.6 * edge) * (0.5 + 0.5 * (y / H))) continue;
      const a = api.range(-Math.PI, Math.PI);
      const size = api.range(0.22, 0.38);
      const flower = v > 0 && api.rng() < (v === 2 ? 0.55 : 0.4);
      const hang = v === 2 ? -1 : 1;
      const u: Vec3 = [Math.cos(a), Math.sin(a) * 0.4, 0];
      const up: Vec3 = [-Math.sin(a) * 0.4, hang * Math.abs(Math.cos(a)), api.range(0.25, 0.6)];
      const l = Math.hypot(up[0], up[1], up[2]);
      const o: Vec3 = [x, y, api.range(0.02, 0.14)];
      const base = flower ? bloom : api.rng() < 0.5 ? tones.deep : tones.mid;
      const hi = flower ? bloom : tones.sun;
      for (let c = 0; c < 3; c++) tmp[c] = (base[c] as number) * 0.5 + (hi[c] as number) * 0.5;
      sheets.add(o, u, [up[0] / l, up[1] / l, up[2] / l], size, size, 'bottom', [0, 0.3, 0.95], base, [tmp[0], tmp[1], tmp[2]], flower ? 2 : 0);
    }
    const leaves = sheets.build(api);
    if (leaves) api.add(leaves, foliage(v === 0 ? 'broadleaf' : 'blossom'));
    else api.add(api.box(W, 0.02, 0.02), foliage('broadleaf'));
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
    rootPath(path);
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
    flatBase(wood);
    wood.paintFn((x, y, z, _nx, _ny, _nz, out) => {
      const band = n.noise3(x * 2.5, y * 16, z * 2.5);
      mixLinear(white, grey, 0.5 + 0.5 * n.noise3(x * 5, y * 3, z * 5), out);
      if (band > 0.35) mixLinear(out, black, Math.min(1, (band - 0.35) * 3), out);
      if (y > trunkH * 0.85) mixLinear(out, lin('#6b5a4a'), Math.min(1, (y - trunkH * 0.85) / (trunkH * 0.15)), out);
    });
    barkUvs(wood, top[0] * 0.5, top[2] * 0.5);
    api.add(wood, { ...BARK, color: '#ffffff' });
    const budget = cardBudget(430 * detail, H * 0.08, Math.min(0.6, Math.max(0.35, 0.3 + H * 0.03)), 950 * Math.max(0.3, detail));
    const count = budget.count;
    const sheets = new Sheets(count + clusters.length);
    crownCards(api, sheets, clusters, { c: crownC, r: [crownR, crownV, crownR] }, count, { w: budget.size, h: budget.size }, leafTones(p.color('color')), 0.18);
    const leaves = sheets.build(api);
    if (leaves) {
      api.add(leaves, foliage('shrub'));
      api.collider(cylinderCollider(0, trunkH / 2, 0, trunkR * 1.2, trunkH));
    }
    return api.build(ROOTED);
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
          // A low spray of a tall tree would reach into the ground (the tree stands on its root): shorten it to end above it.
          const oy = y - droop * 0.1 * layer;
          const drop = -Math.min(0, along[1] * len) + Math.abs(across[1]) * wid * 0.5;
          const fit = drop > oy - 0.05 ? Math.max(0.2, (oy - 0.05) / drop) : 1;
          sheets.add([0, oy, 0], along, across, len * fit, wid * fit, 'left', n, baseC, top, cellOf(api));
        }
      }
    }
    // The leader: a tuft of upright needles.
    for (const turn of [0, Math.PI / 2]) {
      const u: Vec3 = [Math.cos(turn), 0, Math.sin(turn)];
      sheets.add([0, H * 0.9, 0], [0, 1, 0], u, H * 0.13, H * 0.12, 'left', [0, 1, 0], tones.mid, tones.sun, cellOf(api));
    }
    flatBase(wood);
    paintBark(api, wood, p.color('trunkColor'));
    barkUvs(wood, 0, 0);
    api.add(wood, BARK);
    const leaves = sheets.build(api);
    if (leaves) {
      api.add(leaves, foliage('needles'));
      api.collider(cylinderCollider(0, H * 0.25, 0, trunkR * 1.2, H * 0.5));
    }
    return api.build(ROOTED);
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
      flatBase(stems);
      paintBark(api, stems, '#6a5442');
      barkUvs(stems, 0, 0);
      api.add(stems, BARK);
    }
    // Leaf clusters about a hand across (a shrub seen from a garden path shows single leaves, not paper fans).
    const budget = cardBudget(130 * detail, S * 0.3, Math.min(0.3, Math.max(0.23, 0.14 + S * 0.06)), 420 * Math.max(0.3, detail));
    const count = budget.count;
    const sheets = new Sheets(count + clusters.length);
    crownCards(api, sheets, clusters, { c: [0, R * 0.6, 0], r: [R, R * 0.8, R] }, count, { w: budget.size, h: budget.size }, leafTones(p.color('color')), 0.08, 0);
    const leaves = sheets.build(api);
    if (leaves) {
      api.add(leaves, foliage('shrub'));
      api.collider(cylinderCollider(0, R * 0.4, 0, R * 0.5, R * 0.8));
    }
    return api.build(ROOTED);
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
      const cell = cellOf(api);
      sheets.add([0, 0.02, 0], first, side, Math.hypot(...mid), len * 0.62, 'left', n, baseC, top, cell);
      sheets.add(mid, second, side, Math.hypot(end[0] - mid[0], end[1] - mid[1], end[2] - mid[2]), len * 0.55, 'left', n, tmp.slice() as unknown as RGB, top, cell);
    }
    const m = sheets.build(api);
    if (m) api.add(m, foliage('fern'));
    api.collider(boxCollider(0, 0.05, 0, S, 0.1, S));
    return api.build(ROOTED);
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
      sheets.add([(api.rng() - 0.5) * S * 0.12, 0, (api.rng() - 0.5) * S * 0.12], u, v, S * api.range(0.9, 1.2), S * api.range(0.85, 1.15), 'bottom', n, root, tint, cellOf(api));
    }
    const m = sheets.build(api);
    if (m) api.add(m, foliage('grass'));
    api.collider(boxCollider(0, 0.01, 0, S * 0.8, 0.02, S * 0.8));
    return api.build(ROOTED);
  },
});

const wildflowers = defineGenerator({
  id: 'wildflowers',
  description: 'Realistic wild flowers (card patch). Scatter in drifts.',
  category: 'nature',
  params: {
    size: pNum(0.45, 0.1, 2, 'stem height in meters'),
    color: pColor('#f4f1e8', 'flower colour'),
    cards: pInt(3, 1, 6, 'cards'),
    variant: pVariant(0, '0 one colour, 1 mixed meadow'),
  },
  run(p, api) {
    const S = p.num('size');
    const nC = p.int('cards');
    const palette = p.int('variant') === 1 ? ['#f4f1e8', '#f2c230', '#b06ad8', '#e8484a', '#e98ac1'] : [p.color('color')];
    const stem: RGB = lin('#4d7a2f');
    const sheets = new Sheets(nC);
    for (let k = 0; k < nC; k++) {
      const a = (k / nC) * Math.PI + api.rng() * 0.5;
      const u: Vec3 = [Math.cos(a), 0, Math.sin(a)];
      const lean = (api.rng() - 0.5) * 0.2;
      const v = unit([lean * Math.cos(a + 1.57), 1, lean * Math.sin(a + 1.57)]);
      const n = unit([(api.rng() - 0.5) * 0.3, 1, (api.rng() - 0.5) * 0.3]);
      const bloom = lin(shade(palette[Math.floor(api.rng() * palette.length)] as string, (api.rng() - 0.5) * 0.18));
      // The vertex colour ramps from leaf green to the flower colour at about two thirds of the card's height.
      sheets.add([(api.rng() - 0.5) * S * 0.2, 0, (api.rng() - 0.5) * S * 0.2], u, v, S * api.range(0.9, 1.25), S * api.range(0.85, 1.15), 'bottom', n, stem, bloom, cellOf(api));
    }
    const m = sheets.build(api);
    if (m) api.add(m, foliage('flower'));
    api.collider(boxCollider(0, 0.01, 0, S * 0.8, 0.02, S * 0.8));
    return api.build(ROOTED);
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
    triBoxUvs(m);
    api.add(m, ROCK);
    api.collider(hullOf(m));
    return api.build();
  },
});


/** Fluted column of a cactus standing at (cx, y0, cz): a lathe with `ribs` vertical ribs, a rounded crown, painted grooves and spine areoles. */
const CACTUS_SCAR: RGB = lin('#9c8a6a');
const CACTUS_BLOOM: RGB = lin('#a3a891');

function cactusColumn(api: InternalApi, cx: number, y0: number, cz: number, r: number, h: number, ribs: number, base: RGB, groove: RGB, crest: RGB, areole: RGB): Mesh {
  const scar = CACTUS_SCAR;
  const bloom = CACTUS_BLOOM;
  const prof: Array<[number, number]> = [[0, 0], [r * 0.92, 0], [r, h * 0.06], [r * 1.02, h * 0.5], [r * 0.97, h * 0.86], [r * 0.82, h * 0.94], [r * 0.5, h * 0.985], [0, h]];
  const m = api.lathe(prof, Math.max(24, ribs * 3)).translate(cx, y0, cz);
  const angle = (x: number, z: number): number => Math.atan2(z - cz, x - cx);
  m.displace((x, y, z) => {
    const t = (y - y0) / h;
    const fade = t > 0.9 ? Math.max(0, (0.985 - t) / 0.085) : 1;
    return r * 0.085 * Math.cos(ribs * angle(x, z)) * fade;
  });
  const n = api.noise;
  m.paintFn((x, y, z, _nx, _ny, _nz, out) => {
    const c = Math.cos(ribs * angle(x, z));
    mixLinear(groove, base, 0.5 + 0.5 * c, out);
    if (c > 0.82) mixLinear(out, crest, (c - 0.82) * 3.5, out);
    // Areoles: pale spine clusters in a column on every rib crest, every few centimetres.
    if (c > 0.9 && Math.abs(Math.sin((y - y0) * 26 + Math.floor(angle(x, z) * ribs) * 1.7)) > 0.93) mixLinear(out, areole, 0.75, out);
    const k = 1 + 0.08 * n.noise3(x * 3, y * 1.2, z * 3);
    out[0] *= k;
    out[1] *= k;
    out[2] *= k;
    // Dust and woody scarring at the foot of the column, a waxy grey bloom over the green.
    const foot = Math.max(0, 1 - (y - y0) / Math.min(0.9, h * 0.18));
    if (foot > 0) mixLinear(out, scar, foot * (0.55 + 0.25 * n.noise3(x * 6, y * 6, z * 6)), out);
    mixLinear(out, bloom, 0.16 + 0.1 * n.noise3(x * 0.8, y * 0.5, z * 0.8), out);
  });
  return m;
}

const cactus = defineGenerator({
  id: 'cactus',
  description: 'Realistic desert cactus: a fluted saguaro with arms (variant 0), a squat barrel cactus with a crown of flowers (1) or an organ-pipe cluster (2); ribbed, muted sage with spine areoles. Solid.',
  category: 'nature',
  params: {
    height: pNum(5, 0.4, 14, 'height in meters (saguaro and organ pipe; a barrel cactus is a fifth of it)'),
    arms: pInt(2, 0, 5, 'saguaro arms'),
    color: pColor('#6c7a58', 'skin color'),
    flowers: pColor('#e8c547', 'flower color (barrel cactus)'),
    variant: pVariant(2, '0 saguaro, 1 barrel, 2 organ pipe'),
  },
  run(p, api) {
    const variant = p.int('variant');
    const H = p.num('height');
    const skin = p.color('color');
    const base = lin(skin);
    const groove = lin(shade(skin, -0.32));
    const crest = lin(shade(skin, 0.12));
    const areole = lin('#d9d2bd');
    const mat = { vertexColors: true, roughness: 0.82, metalness: 0 } as const;
    if (variant === 1) {
      const h = Math.max(0.3, H * 0.2);
      const r = h * 0.62;
      const prof: Array<[number, number]> = [[0, 0], [r * 0.8, 0], [r * 0.98, h * 0.25], [r, h * 0.55], [r * 0.85, h * 0.85], [r * 0.45, h * 0.99], [0, h * 0.97]];
      const m = api.lathe(prof, 54);
      // Ribs fade out at the root, so the base stays flat on the ground (the cactus is anchored at its root).
      m.displace((x, y, z) => r * 0.09 * Math.cos(18 * Math.atan2(z, x)) * Math.min(1, Math.max(0, y) / (h * 0.06)));
      const spines = lin('#d8b75a');
      m.paintFn((x, y, z, _nx, _ny, _nz, out) => {
        const c = Math.cos(18 * Math.atan2(z, x));
        mixLinear(groove, base, 0.5 + 0.5 * c, out);
        if (c > 0.85 && Math.abs(Math.sin(y * 30 + Math.atan2(z, x) * 7)) > 0.8) mixLinear(out, spines, 0.85, out);
      });
      api.add(m, mat);
      const fl = lin(p.color('flowers'));
      const fm = api.sphere(r * 0.12, 1);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const piece = fm.clone().translate(Math.cos(a) * r * 0.32, h * 0.98, Math.sin(a) * r * 0.32);
        piece.paintFn((_x, _y, _z, _nx, _ny, _nz, out) => mixLinear(fl, fl, 0, out));
        api.add(piece, { vertexColors: true, roughness: 0.6, metalness: 0 });
      }
      api.collider(cylinderCollider(0, h / 2, 0, r, h));
      return api.build(ROOTED);
    }
    if (variant === 2) {
      const r = Math.max(0.06, H * 0.035);
      const stems = 7;
      for (let k = 0; k < stems; k++) {
        const a = (k / stems) * Math.PI * 2 + api.rng() * 0.5;
        const d = k === 0 ? 0 : r * (1.6 + api.rng() * 1.4);
        const h = H * (0.55 + api.rng() * 0.45);
        api.add(cactusColumn(api, Math.cos(a) * d, 0, Math.sin(a) * d, r * (0.85 + api.rng() * 0.3), h, 11, base, groove, crest, areole), mat);
      }
      api.collider(cylinderCollider(0, H / 2, 0, r * 3.5, H));
      return api.build(ROOTED);
    }
    // Saguaro: a trunk about 1/14 as thick as it is tall, arms that leave it, bend and climb parallel to it.
    const R = Math.max(0.12, H * 0.07);
    api.add(cactusColumn(api, 0, 0, 0, R, H, 14, base, groove, crest, areole), mat);
    const arms = p.int('arms');
    const phase = api.rng() * Math.PI * 2;
    for (let k = 0; k < arms; k++) {
      const a = phase + (k / Math.max(1, arms)) * Math.PI * 2 + (api.rng() - 0.5) * 0.9;
      const ar = R * (0.66 + api.rng() * 0.12);
      const y0 = H * (0.32 + api.rng() * 0.25);
      const out = R + ar * (1.6 + api.rng() * 0.8);
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      // The elbow: out of the trunk, then a quarter turn upward.
      const bend = out - R * 0.6;
      const path: Vec3[] = [];
      for (let i = 0; i <= 6; i++) {
        const t = (i / 6) * (Math.PI / 2);
        path.push([dx * (R * 0.6 + Math.sin(t) * bend), y0 + (1 - Math.cos(t)) * bend * 0.9, dz * (R * 0.6 + Math.sin(t) * bend)]);
      }
      const elbow = api.tube(path, ar, 18);
      elbow.paintFn((x, y, z, _nx, _ny, _nz, o) => mixLinear(groove, base, 0.55 + 0.35 * api.noise.noise3(x * 9, y * 9, z * 9), o));
      api.add(elbow, mat);
      const top = path[path.length - 1] as Vec3;
      const climb = Math.max(ar * 3, (H - top[1]) * (0.45 + api.rng() * 0.4));
      api.add(cactusColumn(api, top[0], top[1] - ar * 0.4, top[2], ar, climb, 11, base, groove, crest, areole), mat);
      api.collider(cylinderCollider(top[0], top[1] + climb / 2, top[2], ar, climb));
    }
    api.collider(cylinderCollider(0, H / 2, 0, R, H));
    return api.build(ROOTED);
  },
});

/** Realistic vegetation and rock, registered with the nature category. */
// ---------------------------------------------------------------------------
// Hedge
// ---------------------------------------------------------------------------

/**
 * A clipped hedge (privet, box, beech) built from leaf masses: small leaf-cluster cards over the faces of a rounded
 * block, standing out of it at their own angles and denser at the top, over a dark core that stands for the shade
 * between the leaves. A box with a leaf texture reads as a painted crate from a few metres; this has a broken edge,
 * depth and self-shadowing (deep tones low and inside, sunlit tones on the top and the sun-facing side).
 */
const hedge = defineGenerator({
  id: 'hedge',
  description: 'Clipped hedge of leaf clusters over a dark core; length along x; solid.',
  category: 'nature',
  params: {
    length: pNum(4, 0.6, 30, 'meters along x'),
    height: pNum(1.15, 0.3, 3, 'meters'),
    width: pNum(0.7, 0.3, 2, 'meters'),
    color: pColor('#3a6a2c', 'leaves'),
    detail: pNum(1, 0.3, 2, 'density'),
    variant: pVariant(1, '0 clipped, 1 informal'),
  },
  run(p, api) {
    const L = p.num('length');
    const H = p.num('height');
    const W = p.num('width');
    const detail = p.num('detail');
    const informal = p.int('variant') === 1;
    const tones = leafTones(p.color('color'));
    // The core: the shade between the leaves, a little inside the leaf surface.
    const inset = Math.min(0.09, W * 0.15);
    const core = api.box(Math.max(0.1, L - inset * 2), Math.max(0.1, H - inset), Math.max(0.1, W - inset * 2)).translate(0, (H - inset) / 2, 0);
    const shade: RGB = [tones.deep[0] * 0.6, tones.deep[1] * 0.6, tones.deep[2] * 0.6];
    const coreTop: RGB = [tones.deep[0] * 0.9, tones.deep[1] * 0.9, tones.deep[2] * 0.9];
    core.paintFn((_x, y, _z, _nx, _ny, _nz, out) => mixLinear(shade, coreTop, Math.max(0, Math.min(1, y / H)), out));
    api.add(core, { vertexColors: true, roughness: 0.95, metalness: 0 });
    // Faces of the block: top, the two long sides, the two ends (weighted by area), each card on one.
    const faces: Array<{ n: Vec3; area: number }> = [
      { n: [0, 1, 0], area: L * W * 1.25 },
      { n: [0, 0, 1], area: L * H },
      { n: [0, 0, -1], area: L * H },
      { n: [1, 0, 0], area: W * H },
      { n: [-1, 0, 0], area: W * H },
    ];
    const total = faces.reduce((s, f) => s + f.area, 0);
    const size = Math.max(0.12, Math.min(0.24, 0.12 + H * 0.06));
    // About 2.6 cards over every patch of the surface (leaf clusters overlap), within a triangle budget.
    const count = Math.max(16, Math.min(2900, Math.round(((total * 2.6) / (size * size)) * Math.min(1.4, detail))));
    const sheets = new Sheets(count);
    const tmp: RGB = [0, 0, 0];
    const top: RGB = [0, 0, 0];
    const base: RGB = [0, 0, 0];
    const n3 = api.noise;
    for (let i = 0; i < count; i++) {
      let pick = api.rng() * total;
      let f = faces[0] as { n: Vec3; area: number };
      for (const g of faces) {
        pick -= g.area;
        if (pick <= 0) {
          f = g;
          break;
        }
      }
      const fn = f.n;
      // A point on the face, the block's edges rounded off (a clipped hedge is never a sharp box).
      let x = (api.rng() - 0.5) * L;
      let y = api.rng() * H;
      let z = (api.rng() - 0.5) * W;
      if (fn[1] > 0) y = H;
      else if (fn[2] !== 0) z = (fn[2] * W) / 2;
      else x = (fn[0] * L) / 2;
      // Lumps: the surface swells and dips over half a metre (a lot when informal).
      const lump = n3.noise3(x * 1.7, y * 1.7, z * 1.7) * (informal ? 0.12 : 0.035) + (api.rng() - 0.3) * size * 0.35;
      // Rounded edges: points near an edge are pulled in and their normal turns outward-diagonal.
      const ex = Math.max(0, Math.abs(x) - (L / 2 - 0.12)) / 0.12;
      const ez = Math.max(0, Math.abs(z) - (W / 2 - 0.12)) / 0.12;
      const ey = Math.max(0, y - (H - 0.12)) / 0.12;
      const n: Vec3 = unit([fn[0] + Math.sign(x) * ex * 0.7, fn[1] + ey * 0.7 + 0.08, fn[2] + Math.sign(z) * ez * 0.7]);
      const round = (ex + ez + ey) * 0.05;
      const pp: Vec3 = [x + n[0] * (lump - round), Math.max(0.02, y + n[1] * (lump - round)), z + n[2] * (lump - round)];
      // The card stands out of the surface: tips outward and a little up, turned at random about the normal.
      const v = unit([n[0] + (api.rng() - 0.5) * 1.1, n[1] + (api.rng() - 0.5) * 1.1 + 0.25, n[2] + (api.rng() - 0.5) * 1.1]);
      const u = unit(cross(v, [api.rng() - 0.5, api.rng() - 0.5 + 0.2, api.rng() - 0.5]));
      // Self-shadowing: low on the sides and under the rounded top edge is deep shade; the top and the sun side lit.
      const height01 = Math.max(0, Math.min(1, pp[1] / H));
      const facing = Math.max(0, n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]);
      const light = Math.max(0, Math.min(1, 0.15 + height01 * 0.45 + facing * 0.45 + (fn[1] > 0 ? 0.15 : 0) + (api.rng() - 0.5) * 0.3));
      mixLinear(tones.deep, tones.mid, Math.min(1, light * 1.3), tmp);
      mixLinear(tmp, tones.sun, Math.max(0, light - 0.6) * 1.5, tmp);
      if (api.rng() < 0.05) mixLinear(tmp, tones.warm, 0.25 + api.rng() * 0.25, tmp);
      mixLinear(tones.deep, tmp, 0.6, base);
      mixLinear(tmp, tones.sun, 0.08, top);
      const s = size * (0.75 + api.rng() * 0.5);
      // Sunk a little into the surface so the card's base hides in the hedge.
      const o: Vec3 = [pp[0] - v[0] * s * 0.25, pp[1] - v[1] * s * 0.25, pp[2] - v[2] * s * 0.25];
      // Every card stays inside the hedge's block (the ground below, the clipped faces round it): the hedge is exactly
      // as large as asked, as its collider is, and the walking grids that measure it see the box they planned for.
      const half = [L / 2, H / 2, W / 2];
      const mid = [0, H / 2, 0];
      for (let k = 0; k < 3; k++) {
        const ext = Math.abs(u[k] as number) * s * 0.5;
        const lo = (o[k] as number) + Math.min(0, (v[k] as number) * s) - ext;
        const hi = (o[k] as number) + Math.max(0, (v[k] as number) * s) + ext;
        const lim0 = (mid[k] as number) - (half[k] as number);
        const lim1 = (mid[k] as number) + (half[k] as number);
        if (lo < lim0) o[k] = (o[k] as number) + (lim0 - lo);
        else if (hi > lim1) o[k] = (o[k] as number) - (hi - lim1);
      }
      sheets.add(o, u, v, s, s, 'bottom', n, base, top, cellOf(api));
    }
    const leaves = sheets.build(api);
    if (leaves) api.add(leaves, foliage('shrub'));
    api.collider(boxCollider(0, H / 2, 0, L, H, W));
    return api.build(ROOTED);
  },
});

export const FLORA_GENERATORS = [treeBroadleaf, treeUmbrellaPine, treeCypress, treeOlive, ivy, treeBirch, treeSpruce, shrub, fern, meadowGrass, wildflowers, boulder, cactus, hedge] as const;
