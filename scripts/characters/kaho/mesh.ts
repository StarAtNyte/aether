/**
 * Geometry helpers for the procedural toon body: a skinned mesh builder,
 * envelope skin weights, lofts (generalised cylinders with any cross-section)
 * and thin shells, smooth normals.
 */
import { Vector3 } from 'three';

/** Bone influences of a vertex: `[bone index, weight]`. */
export type Skin = ReadonlyArray<readonly [number, number]>;

/** Per-vertex toon data: outline width scale, shade bias (lifts the lit band), rim strength, spare. */
export type Toon = readonly [number, number, number, number];

/** One part of the body under construction. */
export class Part {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly skin: Skin[] = [];
  readonly toon: Toon[] = [];
  readonly idx: number[] = [];
  /** Vertices whose normal is set by hand (not recomputed). */
  readonly fixedNormal: boolean[] = [];

  /** Normals were computed (merge computes them when not). */
  normalsDone = false;

  constructor(readonly name: string) {}

  get count(): number {
    return this.pos.length / 3;
  }

  vertex(p: Vector3, uv: readonly [number, number], skin: Skin, toon: Toon, n?: Vector3): number {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n?.x ?? 0, n?.y ?? 0, n?.z ?? 0);
    this.fixedNormal.push(n !== undefined);
    this.uv.push(uv[0], uv[1]);
    this.skin.push(skin);
    this.toon.push(toon);
    return this.count - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    // a-b-c-d counter-clockwise seen from outside.
    this.idx.push(a, b, c, a, c, d);
  }

  p(i: number): Vector3 {
    return new Vector3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
  }

  /** Smooth area-weighted normals; vertices at the same place (seams) share one normal. */
  smoothNormals(): void {
    this.normalsDone = true;
    const n = this.count;
    const acc = new Float64Array(n * 3);
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let k = 0; k < this.idx.length; k += 3) {
      const i0 = this.idx[k] as number;
      const i1 = this.idx[k + 1] as number;
      const i2 = this.idx[k + 2] as number;
      a.set(this.pos[i0 * 3] as number, this.pos[i0 * 3 + 1] as number, this.pos[i0 * 3 + 2] as number);
      b.set(this.pos[i1 * 3] as number, this.pos[i1 * 3 + 1] as number, this.pos[i1 * 3 + 2] as number);
      c.set(this.pos[i2 * 3] as number, this.pos[i2 * 3 + 1] as number, this.pos[i2 * 3 + 2] as number);
      const f = b.clone().sub(a).cross(c.clone().sub(a));
      for (const i of [i0, i1, i2]) {
        acc[i * 3] = (acc[i * 3] as number) + f.x;
        acc[i * 3 + 1] = (acc[i * 3 + 1] as number) + f.y;
        acc[i * 3 + 2] = (acc[i * 3 + 2] as number) + f.z;
      }
    }
    // Weld by position.
    const key = (i: number): string => `${Math.round((this.pos[i * 3] as number) * 1e5)},${Math.round((this.pos[i * 3 + 1] as number) * 1e5)},${Math.round((this.pos[i * 3 + 2] as number) * 1e5)}`;
    const groups = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const k = key(i);
      const g = groups.get(k);
      if (g) g.push(i);
      else groups.set(k, [i]);
    }
    for (const g of groups.values()) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (const i of g) {
        x += acc[i * 3] as number;
        y += acc[i * 3 + 1] as number;
        z += acc[i * 3 + 2] as number;
      }
      const l = Math.hypot(x, y, z) || 1;
      for (const i of g) {
        if (this.fixedNormal[i]) continue;
        this.nrm[i * 3] = x / l;
        this.nrm[i * 3 + 1] = y / l;
        this.nrm[i * 3 + 2] = z / l;
      }
    }
  }

  /** Blend every normal toward the direction from `centre` (cleaner shadow shapes on a face or hair mass). */
  sphereNormals(centre: Vector3, amount: number, scale: Vector3 = new Vector3(1, 1, 1), where?: (p: Vector3) => number): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.p(i);
      const w = amount * (where ? where(p) : 1);
      if (w <= 0) continue;
      const s = p.clone().sub(centre).divide(scale).divide(scale).normalize();
      const n = new Vector3(this.nrm[i * 3], this.nrm[i * 3 + 1], this.nrm[i * 3 + 2]);
      n.lerp(s, w).normalize();
      this.nrm[i * 3] = n.x;
      this.nrm[i * 3 + 1] = n.y;
      this.nrm[i * 3 + 2] = n.z;
    }
  }

  /** Append another part. */
  merge(o: Part): void {
    if (!o.normalsDone) o.smoothNormals();
    if (process.env['KAHO_PARTS']) process.stdout.write(`${o.name} ${o.idx.length / 3}\n`);
    const base = this.count;
    this.pos.push(...o.pos);
    this.nrm.push(...o.nrm);
    this.uv.push(...o.uv);
    this.skin.push(...o.skin);
    this.toon.push(...o.toon);
    this.fixedNormal.push(...o.fixedNormal);
    for (const i of o.idx) this.idx.push(i + base);
  }
}

/** A bone segment for envelope weights. */
export interface Seg {
  bone: number;
  a: Vector3;
  b: Vector3;
  /** Larger = this bone reaches farther (multiplies the distance down). */
  reach?: number;
}

/** Distance from `p` to segment a-b. */
export function segDist(p: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.clone().sub(a);
  const l2 = ab.lengthSq();
  const t = l2 > 0 ? Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / l2)) : 0;
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/** Envelope skin weights: inverse distance to each candidate bone segment to a power, top 4, normalised. */
export function envelope(p: Vector3, segs: readonly Seg[], power = 4): Skin {
  const w: Array<[number, number]> = [];
  for (const s of segs) {
    const d = segDist(p, s.a, s.b) / (s.reach ?? 1);
    w.push([s.bone, 1 / (Math.pow(d + 0.004, power))]);
  }
  return normaliseSkin(w);
}

/** Merge duplicate bones, keep the 4 largest, normalise, drop tiny weights. */
export function normaliseSkin(w: ReadonlyArray<readonly [number, number]>): Skin {
  const m = new Map<number, number>();
  for (const [b, x] of w) if (x > 0) m.set(b, (m.get(b) ?? 0) + x);
  let list = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  let s = list.reduce((acc, [, x]) => acc + x, 0);
  list = list.map(([b, x]) => [b, x / s] as [number, number]).filter(([, x]) => x > 0.01);
  s = list.reduce((acc, [, x]) => acc + x, 0);
  return list.map(([b, x]) => [b, x / s] as const);
}

/** Mix two skins. */
export function mixSkin(a: Skin, b: Skin, t: number): Skin {
  const w: Array<[number, number]> = [];
  for (const [i, x] of a) w.push([i, x * (1 - t)]);
  for (const [i, x] of b) w.push([i, x * t]);
  return normaliseSkin(w);
}

/** One ring of a loft: centre and cross-section axes (`x` sideways, `y` the other axis) and a 2D outline. */
export interface Ring {
  c: Vector3;
  x: Vector3;
  y: Vector3;
  /** Cross-section point at angle 0..2π (2D, in the ring's axes). */
  shape: (a: number) => [number, number];
}

/** Superellipse cross-section with separate front/back depth (`y` positive = front half). */
export function section(halfW: number, front: number, back: number, exp = 2.2): (a: number) => [number, number] {
  return (a) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const e = 2 / exp;
    const x = Math.sign(c) * Math.pow(Math.abs(c), e) * halfW;
    const y = Math.sign(s) * Math.pow(Math.abs(s), e) * (s >= 0 ? front : back);
    return [x, y];
  };
}

/** Options of {@link loft}. */
export interface LoftOptions {
  /** Points around a ring. */
  seg: number;
  /** Close the ends with a pole vertex (an end of a limb, a fingertip). */
  capStart?: number | false;
  capEnd?: number | false;
  /** UV of a vertex: ring parameter 0..1, angle parameter 0..1, position. */
  uv: (t: number, s: number, p: Vector3) => readonly [number, number];
  skin: (p: Vector3, t: number, s: number) => Skin;
  toon: (p: Vector3, t: number, s: number) => Toon;
  /** Flip the winding (inside surfaces). */
  inside?: boolean;
  /** Angle offset (radians) of the first point. */
  phase?: number;
}

/** Point of ring `r` at angle `a`. */
export function ringPoint(r: Ring, a: number): Vector3 {
  const [u, v] = r.shape(a);
  return r.c.clone().addScaledVector(r.x, u).addScaledVector(r.y, v);
}

/**
 * A closed loft through `rings` (angles run from +x toward +y); the surface faces outward whatever the
 * handedness of the ring axes, inward with `inside`. Returns the vertex grid.
 */
export function loft(part: Part, rings: readonly Ring[], o: LoftOptions): number[][] {
  const grid: number[][] = [];
  const n = rings.length;
  // Winding follows the handedness of (x, y, path direction), so the surface always faces out unless `inside`.
  let handed = true;
  if (n > 1) {
    const r0 = rings[0] as Ring;
    handed = r0.x.clone().cross(r0.y).dot((rings[1] as Ring).c.clone().sub(r0.c)) >= 0;
  }
  const inside = Boolean(o.inside) !== !handed;
  for (let i = 0; i < n; i++) {
    const r = rings[i] as Ring;
    const row: number[] = [];
    const t = n > 1 ? i / (n - 1) : 0;
    for (let j = 0; j < o.seg; j++) {
      const s = j / o.seg;
      const a = (o.phase ?? 0) + s * Math.PI * 2;
      const p = ringPoint(r, a);
      row.push(part.vertex(p, o.uv(t, s, p), o.skin(p, t, s), o.toon(p, t, s)));
    }
    grid.push(row);
  }
  for (let i = 0; i + 1 < n; i++) {
    const r0 = grid[i] as number[];
    const r1 = grid[i + 1] as number[];
    for (let j = 0; j < o.seg; j++) {
      const j1 = (j + 1) % o.seg;
      if (inside) part.quad(r0[j] as number, r1[j] as number, r1[j1] as number, r0[j1] as number);
      else part.quad(r0[j] as number, r0[j1] as number, r1[j1] as number, r1[j] as number);
    }
  }
  const cap = (row: number[], ring: Ring, dir: Vector3, push: number, start: boolean): void => {
    const p = ring.c.clone().addScaledVector(dir, push);
    const t = start ? 0 : 1;
    const c = part.vertex(p, o.uv(t, 0, p), o.skin(p, t, 0), o.toon(p, t, 0));
    for (let j = 0; j < o.seg; j++) {
      const j1 = (j + 1) % o.seg;
      const flip = start !== inside;
      if (flip) part.tri(c, row[j1] as number, row[j] as number);
      else part.tri(c, row[j] as number, row[j1] as number);
    }
  };
  if (o.capStart !== undefined && o.capStart !== false && n > 1) {
    const r0 = rings[0] as Ring;
    const d = r0.c.clone().sub((rings[1] as Ring).c).normalize();
    cap(grid[0] as number[], r0, d, o.capStart, true);
  }
  if (o.capEnd !== undefined && o.capEnd !== false && n > 1) {
    const r1 = rings[n - 1] as Ring;
    const d = r1.c.clone().sub((rings[n - 2] as Ring).c).normalize();
    cap(grid[n - 1] as number[], r1, d, o.capEnd, false);
  }
  return grid;
}

/** Orthonormal axes for a path tangent: `x` near `side`, `y` = tangent × x... returns {x, y} perpendicular to `t`. */
export function frame(t: Vector3, side: Vector3): { x: Vector3; y: Vector3 } {
  const tt = t.clone().normalize();
  const x = side.clone().addScaledVector(tt, -side.dot(tt)).normalize();
  const y = tt.clone().cross(x).normalize();
  return { x, y };
}

/** Catmull-Rom point on a polyline at 0..1 (uniform in segments). */
export function spline(pts: readonly Vector3[], t: number): Vector3 {
  const n = pts.length - 1;
  const f = Math.max(0, Math.min(0.99999, t)) * n;
  const i = Math.floor(f);
  const u = f - i;
  const p0 = pts[Math.max(0, i - 1)] as Vector3;
  const p1 = pts[i] as Vector3;
  const p2 = pts[Math.min(n, i + 1)] as Vector3;
  const p3 = pts[Math.min(n, i + 2)] as Vector3;
  const u2 = u * u;
  const u3 = u2 * u;
  const out = new Vector3();
  for (const k of ['x', 'y', 'z'] as const) {
    out[k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3);
  }
  return out;
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));
