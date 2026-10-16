/**
 * Signed-distance sculpting for organic models (dev-only, no dependencies): bodies are built as smooth unions of
 * spheres, ellipsoids and tapered capsules, polygonised with surface nets (smooth quads, no stair-stepping), and every
 * vertex learns how much each bone owns it from the distance to that bone's primitives, so joints bend like skin.
 *
 * Authoring frame: +X forward, +Y up, +Z to the right (see `vehicle-geo.ts`); `toLibraryFrame` of that module turns
 * a finished mesh to face -Z.
 */
import type { V3 } from './vehicle-geo';

/** A distance primitive owned by one bone. */
export interface Prim {
  /** Name of the bone that moves it. */
  bone: string;
  /** Signed distance to the primitive's surface (negative inside). */
  d(x: number, y: number, z: number): number;
  /** Axis-aligned box (min x,y,z, max x,y,z) outside of which the primitive is farther than its margin. */
  box: readonly [number, number, number, number, number, number];
  /** Smooth-union radius (m) when this primitive joins the others (default: the sculpt's). */
  k?: number;
  /** Removes material instead of adding it (nostrils, mouth line, eye sockets). */
  carve?: boolean;
}

const sq = (v: number): number => v * v;

/** A sphere. */
export function sphere(bone: string, c: V3, r: number, extra: Partial<Pick<Prim, 'k' | 'carve'>> = {}): Prim {
  return {
    bone,
    d: (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r,
    box: [c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r],
    ...extra,
  };
}

/** An ellipsoid with semi-axes `r` (x, y, z), optionally tilted about Z (pitch, positive lifts +X) and about Y (yaw). */
export function ellipsoid(bone: string, c: V3, r: V3, tiltZ = 0, yaw = 0, extra: Partial<Pick<Prim, 'k' | 'carve'>> = {}): Prim {
  const cz = Math.cos(tiltZ);
  const sz = Math.sin(tiltZ);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const R = Math.max(r[0], r[1], r[2]);
  return {
    bone,
    d: (x, y, z) => {
      let px = x - c[0];
      let py = y - c[1];
      let pz = z - c[2];
      // Into the ellipsoid's frame: undo yaw about Y, then tilt about Z.
      const ux = px * cy + pz * sy;
      const uz = -px * sy + pz * cy;
      px = ux * cz + py * sz;
      py = -ux * sz + py * cz;
      pz = uz;
      const k0 = Math.hypot(px / r[0], py / r[1], pz / r[2]);
      const k1 = Math.hypot(px / sq(r[0]), py / sq(r[1]), pz / sq(r[2]));
      return k1 < 1e-9 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
    },
    box: [c[0] - R, c[1] - R, c[2] - R, c[0] + R, c[1] + R, c[2] + R],
    ...extra,
  };
}

/** A tapered capsule (round cone) from `a` (radius `ra`) to `b` (radius `rb`). */
export function cone(bone: string, a: V3, b: V3, ra: number, rb: number, extra: Partial<Pick<Prim, 'k' | 'carve'>> = {}): Prim {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const rM = Math.max(ra, rb);
  return {
    bone,
    d: (x, y, z) => {
      const pax = x - a[0];
      const pay = y - a[1];
      const paz = z - a[2];
      const yy = pax * bax + pay * bay + paz * baz;
      const zz = yy - l2;
      const qx = pax * l2 - bax * yy;
      const qy = pay * l2 - bay * yy;
      const qz = paz * l2 - baz * yy;
      const x2 = qx * qx + qy * qy + qz * qz;
      const y2 = yy * yy * l2;
      const z2 = zz * zz * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
      if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
      return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
    },
    box: [Math.min(a[0], b[0]) - rM, Math.min(a[1], b[1]) - rM, Math.min(a[2], b[2]) - rM, Math.max(a[0], b[0]) + rM, Math.max(a[1], b[1]) + rM, Math.max(a[2], b[2]) + rM],
    ...extra,
  };
}

/** Mirror a primitive factory across the XY plane (z -> -z): returns the pair `[right, left]` by calling `make(sign)`. */
export function pair<T>(make: (side: 1 | -1) => T): [T, T] {
  return [make(1), make(-1)];
}

function smin(a: number, b: number, k: number): number {
  if (k <= 1e-9) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Sculpt options. */
export interface SculptOptions {
  /** Voxel edge (m). */
  voxel: number;
  /** Default smooth-union radius (m). */
  k: number;
  /** Margin (m) added around the primitives' boxes. */
  pad?: number;
}

/** The sculpted field: evaluate it, polygonise it, ask each bone's distance. */
export class Sculpt {
  readonly adds: Prim[];
  readonly carves: Prim[];
  readonly min: V3;
  readonly max: V3;

  constructor(
    readonly prims: readonly Prim[],
    readonly opts: SculptOptions,
  ) {
    this.adds = prims.filter((p) => !p.carve);
    this.carves = prims.filter((p) => p.carve);
    const pad = (opts.pad ?? 0.05) + opts.k + opts.voxel * 2;
    const lo: V3 = [Infinity, Infinity, Infinity];
    const hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of this.adds) {
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i] as number, (p.box[i] as number) - pad);
        hi[i] = Math.max(hi[i] as number, (p.box[i + 3] as number) + pad);
      }
    }
    this.min = lo;
    this.max = hi;
  }

  /** The union's signed distance at a point. */
  d(x: number, y: number, z: number): number {
    const kk = this.opts.k;
    let v = 1e9;
    for (const p of this.adds) {
      const b = p.box;
      const m = (p.k ?? kk) + 0.002;
      // Cheap reject: far outside this primitive's box (its distance cannot matter to the smooth union).
      const dx = Math.max((b[0] as number) - x, 0, x - (b[3] as number));
      const dy = Math.max((b[1] as number) - y, 0, y - (b[4] as number));
      const dz = Math.max((b[2] as number) - z, 0, z - (b[5] as number));
      const bd = Math.hypot(dx, dy, dz);
      if (bd > m + Math.abs(v) && v < 1e8) continue;
      v = v >= 1e8 ? p.d(x, y, z) : smin(v, p.d(x, y, z), p.k ?? kk);
    }
    for (const p of this.carves) {
      const c = p.d(x, y, z);
      // Smooth subtraction.
      const k = p.k ?? 0.006;
      const h = Math.max(k - Math.abs(-c - v), 0) / k;
      v = Math.max(v, -c) + h * h * k * 0.25;
    }
    return v;
  }

  /** Unit normal of the field at a point (central differences). */
  normal(x: number, y: number, z: number, out: V3 = [0, 0, 0]): V3 {
    const e = this.opts.voxel * 0.5;
    const nx = this.d(x + e, y, z) - this.d(x - e, y, z);
    const ny = this.d(x, y + e, z) - this.d(x, y - e, z);
    const nz = this.d(x, y, z + e) - this.d(x, y, z - e);
    const l = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / l;
    out[1] = ny / l;
    out[2] = nz / l;
    return out;
  }

  /**
   * Surface-nets polygonisation: returns welded positions and triangle indices (counter-clockwise from outside).
   */
  polygonise(): { positions: number[]; indices: number[] } {
    const h = this.opts.voxel;
    const nx = Math.ceil(((this.max[0] as number) - (this.min[0] as number)) / h) + 1;
    const ny = Math.ceil(((this.max[1] as number) - (this.min[1] as number)) / h) + 1;
    const nz = Math.ceil(((this.max[2] as number) - (this.min[2] as number)) / h) + 1;
    const field = new Float32Array(nx * ny * nz);
    const at = (i: number, j: number, k: number): number => i + nx * (j + ny * k);
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) field[at(i, j, k)] = this.d((this.min[0] as number) + i * h, (this.min[1] as number) + j * h, (this.min[2] as number) + k * h);
      }
    }
    const vid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
    const cell = (i: number, j: number, k: number): number => i + (nx - 1) * (j + (ny - 1) * k);
    const positions: number[] = [];
    const indices: number[] = [];
    const corner = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ] as const;
    const edges: ReadonlyArray<readonly [number, number]> = [
      [0, 1], [2, 3], [4, 5], [6, 7],
      [0, 2], [1, 3], [4, 6], [5, 7],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    const val = new Float32Array(8);
    for (let k = 0; k < nz - 1; k++) {
      for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          let mask = 0;
          for (let c = 0; c < 8; c++) {
            const o = corner[c] as readonly [number, number, number];
            const v = field[at(i + o[0], j + o[1], k + o[2])] as number;
            val[c] = v;
            if (v < 0) mask |= 1 << c;
          }
          if (mask === 0 || mask === 255) continue;
          let sx = 0;
          let sy = 0;
          let sz = 0;
          let n = 0;
          for (const [a, b] of edges) {
            const va = val[a] as number;
            const vb = val[b] as number;
            if (va < 0 === vb < 0) continue;
            const t = va / (va - vb);
            const oa = corner[a] as readonly [number, number, number];
            const ob = corner[b] as readonly [number, number, number];
            sx += oa[0] + (ob[0] - oa[0]) * t;
            sy += oa[1] + (ob[1] - oa[1]) * t;
            sz += oa[2] + (ob[2] - oa[2]) * t;
            n++;
          }
          vid[cell(i, j, k)] = positions.length / 3;
          positions.push((this.min[0] as number) + (i + sx / n) * h, (this.min[1] as number) + (j + sy / n) * h, (this.min[2] as number) + (k + sz / n) * h);
        }
      }
    }
    // One quad per sign-changing grid edge, over the four cells that share it.
    const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      if (flip) indices.push(a, c, b, a, d, c);
      else indices.push(a, b, c, a, c, d);
    };
    for (let k = 1; k < nz - 1; k++) {
      for (let j = 1; j < ny - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          const v0 = field[at(i, j, k)] as number;
          const inside = v0 < 0;
          // Edge along +X.
          if (inside !== (field[at(i + 1, j, k)] as number) < 0) quad(vid[cell(i, j - 1, k - 1)] as number, vid[cell(i, j, k - 1)] as number, vid[cell(i, j, k)] as number, vid[cell(i, j - 1, k)] as number, !inside);
          // Edge along +Y.
          if (inside !== (field[at(i, j + 1, k)] as number) < 0) quad(vid[cell(i - 1, j, k - 1)] as number, vid[cell(i - 1, j, k)] as number, vid[cell(i, j, k)] as number, vid[cell(i, j, k - 1)] as number, !inside);
          // Edge along +Z.
          if (inside !== (field[at(i, j, k + 1)] as number) < 0) quad(vid[cell(i - 1, j - 1, k)] as number, vid[cell(i, j - 1, k)] as number, vid[cell(i, j, k)] as number, vid[cell(i - 1, j, k)] as number, !inside);
        }
      }
    }
    return { positions, indices };
  }

  /**
   * Bone weights of a point: each bone's weight falls off with the distance to that bone's nearest primitive
   * (`sigma` metres), so a vertex belongs to the bone whose flesh it is on and shares with neighbours at the joints.
   * Returns up to four `[bone index, weight]` pairs, normalised.
   */
  weights(x: number, y: number, z: number, boneIndex: ReadonlyMap<string, number>, sigma: number): Array<[number, number]> {
    const best = new Map<number, number>();
    for (const p of this.adds) {
      const bi = boneIndex.get(p.bone);
      if (bi === undefined) continue;
      const dist = Math.max(0, p.d(x, y, z));
      const prev = best.get(bi);
      if (prev === undefined || dist < prev) best.set(bi, dist);
    }
    const list: Array<[number, number]> = [];
    let dmin = Infinity;
    for (const v of best.values()) dmin = Math.min(dmin, v);
    for (const [bi, dist] of best) list.push([bi, Math.exp(-(dist - dmin) / sigma)]);
    list.sort((a, b) => b[1] - a[1]);
    const top = list.slice(0, 4).filter((e) => e[1] > 0.02);
    const sum = top.reduce((s, e) => s + e[1], 0) || 1;
    return top.map(([bi, w]) => [bi, w / sum]);
  }
}
