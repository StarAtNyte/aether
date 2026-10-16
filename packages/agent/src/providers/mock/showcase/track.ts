/**
 * Railway track for the showcase worlds: the ballast bed with its sleepers, and the two steel rails, each one mesh along a closed
 * loop, draped over a ground function. Replaces rows of boxes (visible seams, a flat toy section) with real profiles.
 */
import { encodeMesh, type MeshData } from '@aether/core';
import type { Builder } from '../builder';

type P3 = readonly [number, number, number];

/** Mesh buffers under construction (positions, linear colours, UVs, triangles). */
class MeshAcc {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  readonly uvs: number[] = [];
  readonly indices: number[] = [];

  vertex(p: P3, rgb: P3, u = 0, v = 0): number {
    this.positions.push(p[0], p[1], p[2]);
    this.colors.push(rgb[0], rgb[1], rgb[2]);
    this.uvs.push(u, v);
    return this.positions.length / 3 - 1;
  }

  /** A quad a-b-c-d (a loop), wound so that its normal points along `outward` (a direction). */
  quad(a: number, b: number, c: number, d: number, outward: P3): void {
    const p = this.positions;
    const at = (i: number, k: number): number => p[i * 3 + k] as number;
    const e1: P3 = [at(b, 0) - at(a, 0), at(b, 1) - at(a, 1), at(b, 2) - at(a, 2)];
    const e2: P3 = [at(c, 0) - at(a, 0), at(c, 1) - at(a, 1), at(c, 2) - at(a, 2)];
    const nx = e1[1] * e2[2] - e1[2] * e2[1];
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    if (nx * outward[0] + ny * outward[1] + nz * outward[2] >= 0) this.indices.push(a, b, c, a, c, d);
    else this.indices.push(a, c, b, a, d, c);
  }

  data(): MeshData {
    return { positions: new Float32Array(this.positions), indices: new Uint32Array(this.indices), colors: new Float32Array(this.colors), uvs: null, faceMaterials: null };
  }
}

/** sRGB "#rrggbb" to linear rgb. */
function lin(hex: string): P3 {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const f = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [f(((n >> 16) & 255) / 255), f(((n >> 8) & 255) / 255), f((n & 255) / 255)];
}

const scale = (c: P3, k: number): P3 => [c[0] * k, c[1] * k, c[2] * k];

/** Closed Chaikin smoothing of a loop of (x, z) points. */
function chaikinLoop(pts: ReadonlyArray<readonly [number, number]>, rounds: number): Array<[number, number]> {
  let cur: Array<[number, number]> = pts.map((p) => [p[0], p[1]]);
  for (let r = 0; r < rounds; r++) {
    const next: Array<[number, number]> = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i] as [number, number];
      const c = cur[(i + 1) % cur.length] as [number, number];
      next.push([a[0] * 0.75 + c[0] * 0.25, a[1] * 0.75 + c[1] * 0.25], [a[0] * 0.25 + c[0] * 0.75, a[1] * 0.25 + c[1] * 0.75]);
    }
    cur = next;
  }
  return cur;
}

/** A point of the smoothed centre line with its unit tangent. */
interface Sample {
  x: number;
  z: number;
  tx: number;
  tz: number;
}

/** Distance between the cross-sections of the track meshes (metres). */
export const TRACK_STEP = 0.35;

/** Resample a closed loop at an even step; the loop is smoothed first so corners are curves. */
export function trackSamples(loop: ReadonlyArray<readonly [number, number]>, step = TRACK_STEP): Sample[] {
  const line = chaikinLoop(loop, 3);
  const out: Sample[] = [];
  let carry = 0;
  for (let i = 0; i < line.length; i++) {
    const a = line[i] as [number, number];
    const c = line[(i + 1) % line.length] as [number, number];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 1e-6) continue;
    const dx = (c[0] - a[0]) / len;
    const dz = (c[1] - a[1]) / len;
    for (let t = carry; t < len; t += step) out.push({ x: a[0] + dx * t, z: a[1] + dz * t, tx: dx, tz: dz });
    carry = carry + Math.ceil((len - carry) / step) * step - len;
  }
  return out;
}

/** Options of {@link railTrack}. */
export interface RailTrackOptions {
  id: string;
  /** The line's centre as a closed loop of (x, z) points. */
  loop: ReadonlyArray<readonly [number, number]>;
  /** Ground height under (x, z); default flat 0. */
  height?: (x: number, z: number) => number;
  /** Distance between the rails' centres (default 1.435 m, standard gauge). */
  gauge?: number;
}

/** The track as two buffers (bed and rails) before they are encoded; exported for tests. */
export function trackMeshes(o: RailTrackOptions): { bed: MeshData; rails: MeshData } {
  const gauge = o.gauge ?? 1.435;
  const h = o.height ?? ((): number => 0);
  const samples = trackSamples(o.loop);
  const n = samples.length;
  const bed = new MeshAcc();
  const rail = new MeshAcc();
  const stone = lin('#7d776e');
  const stoneDark = lin('#5d5851');
  const wood = lin('#4a3626');
  const steel = lin('#8d9298');
  const steelTop = lin('#bcc1c7');
  const at = (s: Sample, off: number, dy: number): P3 => {
    const px = s.x - s.tz * off;
    const pz = s.z + s.tx * off;
    return [px, h(px, pz) + dy, pz];
  };

  // Ballast: a trapezoid, bottom edge / shoulder / shoulder / bottom edge, one closed strip.
  const profile: ReadonlyArray<readonly [number, number]> = [[-1.65, 0], [-1.15, 0.17], [1.15, 0.17], [1.65, 0]];
  const rings: number[][] = samples.map((s, i) => {
    const grain = 0.85 + 0.25 * (0.5 + 0.5 * Math.sin(i * 1.9 + Math.sin(i * 0.37) * 3));
    return profile.map(([off, dy], k) => bed.vertex(at(s, off, dy - 0.02), scale(k === 1 || k === 2 ? stone : stoneDark, grain), k, i * TRACK_STEP));
  });
  for (let i = 0; i < n; i++) {
    const s = samples[i] as Sample;
    const lx = -s.tz;
    const lz = s.tx;
    const r0 = rings[i] as number[];
    const r1 = rings[(i + 1) % n] as number[];
    bed.quad(r0[0] as number, r1[0] as number, r1[1] as number, r0[1] as number, [-lx, 0.5, -lz]);
    bed.quad(r0[1] as number, r1[1] as number, r1[2] as number, r0[2] as number, [0, 1, 0]);
    bed.quad(r0[2] as number, r1[2] as number, r1[3] as number, r0[3] as number, [lx, 0.5, lz]);
  }

  // Sleepers every 0.7 m: 2.4 m across, 0.22 m along, a hand above the ballast.
  for (let i = 0; i < n; i += 2) {
    const s = samples[i] as Sample;
    const lx = -s.tz;
    const lz = s.tx;
    const base = h(s.x, s.z);
    const corner = (side: number, along: number, y: number): P3 => [s.x + lx * 1.2 * side + s.tx * 0.11 * along, base + y, s.z + lz * 1.2 * side + s.tz * 0.11 * along];
    const col = scale(wood, 0.8 + 0.4 * Math.abs(Math.sin(i * 12.9)));
    const v: number[] = [];
    for (const y of [0.16, 0.26]) for (const [side, along] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) v.push(bed.vertex(corner(side, along, y), col));
    bed.quad(v[4] as number, v[5] as number, v[6] as number, v[7] as number, [0, 1, 0]);
    bed.quad(v[0] as number, v[1] as number, v[5] as number, v[4] as number, [-s.tx, 0, -s.tz]);
    bed.quad(v[2] as number, v[3] as number, v[7] as number, v[6] as number, [s.tx, 0, s.tz]);
    bed.quad(v[1] as number, v[2] as number, v[6] as number, v[5] as number, [lx, 0, lz]);
    bed.quad(v[3] as number, v[0] as number, v[4] as number, v[7] as number, [-lx, 0, -lz]);
  }

  // Rails: a rectangular bar 0.09 wide and 0.13 tall on the sleepers; the running surface a lighter steel.
  for (const side of [-1, 1]) {
    const off = (gauge / 2) * side;
    const ringsR: number[][] = samples.map((s, i) => [
      rail.vertex(at(s, off - 0.045, 0.26), steel, 0, i * TRACK_STEP),
      rail.vertex(at(s, off + 0.045, 0.26), steel, 1, i * TRACK_STEP),
      rail.vertex(at(s, off + 0.045, 0.39), steelTop, 1, i * TRACK_STEP),
      rail.vertex(at(s, off - 0.045, 0.39), steelTop, 0, i * TRACK_STEP),
    ]);
    for (let i = 0; i < n; i++) {
      const s = samples[i] as Sample;
      const lx = -s.tz;
      const lz = s.tx;
      const r0 = ringsR[i] as number[];
      const r1 = ringsR[(i + 1) % n] as number[];
      rail.quad(r0[3] as number, r1[3] as number, r1[2] as number, r0[2] as number, [0, 1, 0]);
      rail.quad(r0[0] as number, r1[0] as number, r1[3] as number, r0[3] as number, [-lx, 0, -lz]);
      rail.quad(r0[1] as number, r1[1] as number, r1[2] as number, r0[2] as number, [lx, 0, lz]);
    }
  }
  return { bed: bed.data(), rails: rail.data() };
}

/**
 * Lay a railway on the builder as two mesh entities (`<id>-bed`: ballast and sleepers, `<id>-rails`: steel). The rail top stands
 * 0.39 m above the ground. No colliders: the ground carries whoever walks across. Returns the entity ids.
 */
export function railTrack(b: Builder, o: RailTrackOptions): { bed: string; rails: string } {
  const { bed, rails } = trackMeshes(o);
  const bedId = `${o.id}-bed`;
  const railId = `${o.id}-rails`;
  b.mesh(encodeMesh(`${bedId}-mesh`, bed, { materials: [{ preset: 'stone', roughness: 1 }] }));
  b.mesh(encodeMesh(`${railId}-mesh`, rails, { materials: [{ preset: 'metal', roughness: 0.35, metalness: 0.85 }] }));
  b.add({ id: bedId, name: 'Railway bed', shape: { kind: 'mesh', mesh: `${bedId}-mesh` }, transform: { position: [0, 0, 0] }, castShadow: false, tags: ['track'] });
  b.add({ id: railId, name: 'Rails', shape: { kind: 'mesh', mesh: `${railId}-mesh` }, transform: { position: [0, 0, 0] }, castShadow: true, tags: ['track'] });
  return { bed: bedId, rails: railId };
}
