/**
 * Garden trees for courtyards and plots: a gnarled olive with a silvery
 * crown, a dark columnar cypress and an umbrella pine. Each is a barked,
 * tapering trunk with limbs and a crown of noise-displaced foliage masses
 * (puffy normals with leaf-scale breakup), a few hundred triangles per mass:
 * far from the toy-like cone-and-sphere trees, cheap enough for a grove.
 * Origin at the foot of the trunk on the ground; a trunk-sized box collider.
 */
import { Geom, lathe, sphere, tube } from '../mesh';
import { PartSet } from '../parts';
import { choice, color, mat, num, seeded, type FurnitureDef } from './kit';

/** Hash-based value noise in [0, 1) at a 3D point (smoothly interpolated). */
function noise3(seed: number, x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const h = (a: number, b: number, c: number): number => {
    let n = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2147483647) + Math.imul(seed, 1274126177)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (((n ^ (n >>> 16)) >>> 0) % 100000) / 100000;
  };
  const f = (t: number): number => t * t * (3 - 2 * t);
  const fx = f(x - xi);
  const fy = f(y - yi);
  const fz = f(z - zi);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number): number => h(xi + dx, yi + dy, zi + dz);
  return lerp(lerp(lerp(c(0, 0, 0), c(1, 0, 0), fx), lerp(c(0, 1, 0), c(1, 1, 0), fx), fy), lerp(lerp(c(0, 0, 1), c(1, 0, 1), fx), lerp(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}

/**
 * A mass of foliage: an ellipsoid centred at (cx, cy, cz) with semi-axes
 * (rx, ry, rz), its surface displaced by layered noise so it reads as clumps
 * of leaves, and normals pushed around by finer noise so light breaks up.
 */
export function foliageMass(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, seed: number, seg = 12): Geom {
  const g = sphere(1, seg + 4);
  const reach = Math.max(rx, ry, rz);
  for (let k = 0; k < g.p.length; k += 3) {
    const dx = g.p[k] as number;
    const dy = g.p[k + 1] as number;
    const dz = g.p[k + 2] as number;
    const l = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / l;
    const uy = dy / l;
    const uz = dz / l;
    const big = noise3(seed, ux * 1.7 + 11, uy * 1.7 + 5, uz * 1.7 + 3);
    const mid = noise3(seed + 7, ux * 4.3, uy * 4.3, uz * 4.3);
    const fine = noise3(seed + 13, ux * 9.1, uy * 9.1, uz * 9.1);
    const f = 0.66 + 0.46 * big + 0.2 * mid + 0.11 * fine;
    g.p[k] = cx + ux * rx * f;
    g.p[k + 1] = Math.max(0.02, cy + uy * ry * f);
    g.p[k + 2] = cz + uz * rz * f;
    // Leafy normals: radial, tilted by the fine noise and flattened a little toward up (sky light).
    const nx = ux + (fine - 0.5) * 0.9;
    const ny = uy + 0.2 + (mid - 0.5) * 0.6;
    const nz = uz + (noise3(seed + 29, ux * 9.1, uy * 9.1, uz * 9.1) - 0.5) * 0.9;
    const nl = Math.hypot(nx, ny, nz) || 1;
    g.n[k] = nx / nl;
    g.n[k + 1] = ny / nl;
    g.n[k + 2] = nz / nl;
    // Leaf-scale UVs in metres.
    g.uv[(k / 3) * 2] = ((g.p[k] as number) + (g.p[k + 2] as number) * 0.7) * 2.6 + reach;
    g.uv[(k / 3) * 2 + 1] = ((g.p[k + 1] as number) + ((g.p[k] as number) - (g.p[k + 2] as number)) * 0.5) * 2.6;
  }
  return g;
}

/** Area-weighted smooth vertex normals from the triangles (after displacing a mesh). */
function smoothNormals(g: Geom): void {
  const acc = new Float32Array(g.p.length);
  for (let t = 0; t < g.i.length; t += 3) {
    const a = (g.i[t] as number) * 3;
    const b = (g.i[t + 1] as number) * 3;
    const c = (g.i[t + 2] as number) * 3;
    const ux = (g.p[b] as number) - (g.p[a] as number);
    const uy = (g.p[b + 1] as number) - (g.p[a + 1] as number);
    const uz = (g.p[b + 2] as number) - (g.p[a + 2] as number);
    const vx = (g.p[c] as number) - (g.p[a] as number);
    const vy = (g.p[c + 1] as number) - (g.p[a + 1] as number);
    const vz = (g.p[c + 2] as number) - (g.p[a + 2] as number);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      acc[k] = (acc[k] as number) + nx;
      acc[k + 1] = (acc[k + 1] as number) + ny;
      acc[k + 2] = (acc[k + 2] as number) + nz;
    }
  }
  for (let k = 0; k < acc.length; k += 3) {
    const l = Math.hypot(acc[k] as number, acc[k + 1] as number, acc[k + 2] as number) || 1;
    g.n[k] = (acc[k] as number) / l;
    g.n[k + 1] = (acc[k + 1] as number) / l;
    g.n[k + 2] = (acc[k + 2] as number) / l;
  }
}

/**
 * A cypress crown: a tall, pointed spindle whose surface is fluted and broken up by noise
 * (flame-shaped, matte, like clipped flat sprays of foliage), `lean` metres off-axis at the tip.
 */
function cypressCrown(H: number, seed: number, lean: number): Geom {
  const rings = 44;
  const profile: Array<[number, number]> = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const r = H * 0.082 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.85) + 0.004;
    profile.push([r, H * (0.07 + 0.93 * t)]);
  }
  const g = lathe(profile, 28);
  for (let k = 0; k < g.p.length; k += 3) {
    const x = g.p[k] as number;
    const y = g.p[k + 1] as number;
    const z = g.p[k + 2] as number;
    const r = Math.hypot(x, z) || 1;
    const a = Math.atan2(z, x);
    const flute = 1 + 0.06 * Math.cos(a * 9 + y * 2.2) + 0.1 * (noise3(seed, Math.cos(a) * 2.4, y * 1.1, Math.sin(a) * 2.4) - 0.5) + 0.07 * (noise3(seed + 5, Math.cos(a) * 6, y * 3.4, Math.sin(a) * 6) - 0.5);
    const t = (y - H * 0.07) / (H * 0.93);
    g.p[k] = x * flute + lean * t * t;
    g.p[k + 2] = z * flute;
    g.uv[(k / 3) * 2] = a * r * 1.6;
    g.uv[(k / 3) * 2 + 1] = y * 2.4;
  }
  smoothNormals(g);
  return g;
}

/** A tapering limb along `path` (radius from `r0` down to `r1`), as short tube segments. */
function limb(path: ReadonlyArray<readonly [number, number, number]>, r0: number, r1: number): Geom {
  const g = new Geom();
  for (let i = 0; i + 1 < path.length; i++) {
    const t = i / Math.max(1, path.length - 2);
    g.merge(tube([path[i] as readonly [number, number, number], path[i + 1] as readonly [number, number, number]], r0 + (r1 - r0) * t, 9));
  }
  return g;
}

const SPECIES = ['olive', 'cypress', 'umbrella-pine'];

export const TREE: FurnitureDef = {
  id: 'furn-tree',
  kind: 'tree',
  description: 'Garden tree with a barked trunk and a crown of foliage masses: gnarled olive, columnar cypress or umbrella pine. Origin at the foot of the trunk.',
  params: {
    height: num(4.5, 1.2, 18, 'overall height (m)'),
    species: choice(SPECIES, 'olive', 'tree type'),
    leaf: color('#7f8e62', 'foliage colour (olive: silvery green, cypress: near black green)'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0,
  size: (p) => {
    const h = p.num('height');
    const s = p.str('species');
    const spread = s === 'cypress' ? h * 0.2 : s === 'umbrella-pine' ? h * 0.55 : h * 0.62;
    return [spread * 2, h, spread * 2];
  },
  build(p, seed) {
    const set = new PartSet();
    const H = p.num('height');
    const species = p.str('species');
    const rnd = seeded(seed * 2246822519 + 11);
    const s0 = (seed >>> 0) % 997;
    const trunk = new Geom();
    const foliageA = new Geom();
    const foliageB = new Geom();
    if (species === 'olive') {
      // A short, thick, twisting trunk that splits into three limbs.
      const r0 = Math.max(0.05, H * 0.032);
      const forkY = H * 0.3;
      const base: Array<[number, number, number]> = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const tw = t * 3.2 + rnd() * 0.3;
        base.push([Math.sin(tw) * H * 0.02 * t, forkY * t, Math.cos(tw) * H * 0.02 * t]);
      }
      trunk.merge(limb(base, r0, r0 * 0.72));
      const top = base[base.length - 1] as [number, number, number];
      const limbs = 3 + (rnd() > 0.5 ? 1 : 0);
      const crownR = H * 0.3;
      for (let l = 0; l < limbs; l++) {
        const a = (l / limbs) * Math.PI * 2 + rnd() * 0.8;
        const reach = crownR * (0.8 + rnd() * 0.5);
        const endY = H * (0.55 + rnd() * 0.2);
        const path: Array<[number, number, number]> = [];
        for (let i = 0; i <= 5; i++) {
          const t = i / 5;
          const wob = Math.sin(t * 5 + l) * H * 0.012;
          path.push([top[0] + Math.cos(a) * reach * t * t + wob, top[1] + (endY - top[1]) * Math.pow(t, 0.8), top[2] + Math.sin(a) * reach * t * t - wob]);
        }
        trunk.merge(limb(path, r0 * 0.5, r0 * 0.16));
        const e = path[path.length - 1] as [number, number, number];
        // Foliage masses along the limb's last part.
        for (let m = 0; m < 4; m++) {
          const t = 0.55 + m * 0.15;
          const q = path[Math.min(path.length - 1, Math.round(t * 5))] as [number, number, number];
          const rx = H * (0.13 + rnd() * 0.07);
          const mass = foliageMass(q[0] + (rnd() - 0.5) * rx, q[1] + rx * 0.5, q[2] + (rnd() - 0.5) * rx, rx, rx * 0.62, rx, s0 + l * 17 + m * 3, 12);
          (m % 2 === 0 ? foliageA : foliageB).merge(mass);
        }
        foliageB.merge(foliageMass(e[0], e[1] + H * 0.06, e[2], H * 0.12, H * 0.08, H * 0.12, s0 + l * 31, 12));
      }
      foliageA.merge(foliageMass(top[0], H * 0.55, top[2], crownR * 0.6, crownR * 0.42, crownR * 0.6, s0 + 5, 12));
    } else if (species === 'cypress') {
      const r0 = Math.max(0.04, H * 0.016);
      trunk.merge(limb([[0, 0, 0], [0, H * 0.14, 0]], r0, r0 * 0.8));
      foliageA.merge(cypressCrown(H, s0 + 3, (rnd() - 0.5) * 0.05 * H));
    } else {
      // Umbrella pine: a tall bending trunk and a flat, wide crown of layered masses.
      const r0 = Math.max(0.05, H * 0.024);
      const path: Array<[number, number, number]> = [];
      const sway = (rnd() - 0.5) * H * 0.2;
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        path.push([sway * t * t, H * 0.64 * t, Math.sin(t * 2.4) * H * 0.04]);
      }
      trunk.merge(limb(path, r0, r0 * 0.55));
      const top = path[path.length - 1] as [number, number, number];
      for (let m = 0; m < 9; m++) {
        const a = (m / 9) * Math.PI * 2 + rnd();
        const d = m === 0 ? 0 : H * (0.16 + rnd() * 0.16);
        const rx = H * (0.2 + rnd() * 0.07);
        const mass = foliageMass(top[0] + Math.cos(a) * d, top[1] + H * (0.08 + rnd() * 0.07), top[2] + Math.sin(a) * d, rx, rx * 0.3, rx, s0 + m * 11, 12);
        (m % 2 === 0 ? foliageA : foliageB).merge(mass);
        if (m > 0) trunk.merge(limb([top, [top[0] + Math.cos(a) * d * 0.6, top[1] + H * 0.05, top[2] + Math.sin(a) * d * 0.6]], r0 * 0.4, r0 * 0.2));
      }
    }
    // Tube end caps round off a hair below the ground: stand the trunk exactly on it.
    for (let k = 1; k < trunk.p.length; k += 3) if ((trunk.p[k] as number) < 0) trunk.p[k] = 0;
    set.add(trunk, species === 'cypress' ? mat('bark', '#4a3a2c') : species === 'umbrella-pine' ? mat('bark', '#7a5238') : mat('bark', '#8a8070'));
    const leaf = p.color('leaf');
    set.add(foliageA, { finish: 'foliage', color: leaf });
    set.add(foliageB, { finish: 'foliage', color: shiftColor(leaf, species === 'olive' ? 18 : 10) });
    const tr = Math.max(0.06, H * 0.03);
    set.box([0, H * 0.15, 0], [tr, H * 0.15, tr]);
    return set.build();
  },
};

/** Lighten (positive) or darken a "#rrggbb" colour by `amount` per channel. */
function shiftColor(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = (v: number): string => Math.max(0, Math.min(255, v + amount)).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** Tree definitions. */
export const TREES: readonly FurnitureDef[] = [TREE];
