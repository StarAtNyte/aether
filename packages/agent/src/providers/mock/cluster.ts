/**
 * Clustered scatter layouts for natural ground cover. Real undergrowth is not uniform: grass thickens into
 * tussocks, ferns and shrubs gather under trees and along streams, flowers drift in patches, boulders lie
 * in loose groups. A Thomas cluster process (parent points, Gaussian offspring) plus a thin background
 * of lone plants reproduces that, deterministically, as hand-placed scatter `points` (so physics and
 * render, which both honour `points`, need no new contract).
 */
import { rng } from '@aether/core';

/** Generators whose scatters read better in clumps than spread evenly. */
export const CLUSTERED_GENERATORS: ReadonlySet<string> = new Set(['meadow-grass', 'grass-tuft', 'shrub', 'bush', 'fern', 'flowers', 'boulder', 'rock']);

/** Options of {@link clusterPoints}. */
export interface ClusterOptions {
  /** Share of points (0..1) that stay isolated (uniform background). Default 0.22. */
  background?: number;
  /** Mean points per clump. Default 14. */
  perClump?: number;
  /** Clump standard deviation in metres (default: scaled to the area and clump count, 0.5..4). */
  sigma?: number;
  /** Minimum spacing between points in metres (best effort, like `minSpacing`). */
  minSpacing?: number;
}

/**
 * `count` points in a `width`×`depth` box centred on the origin (y = 0), clustered. Same seed gives the
 * same layout. Points stay inside the box; with `minSpacing`, a candidate nearer than that to an accepted
 * point is retried a few times before it is dropped, so the result may hold slightly fewer than `count`.
 */
export function clusterPoints(count: number, width: number, depth: number, seed: number, o: ClusterOptions = {}): Array<[number, number, number]> {
  const n = Number.isFinite(count) ? Math.max(0, Math.min(20_000, Math.floor(count))) : 0;
  const w = Number.isFinite(width) ? Math.abs(width) : 0;
  const d = Number.isFinite(depth) ? Math.abs(depth) : 0;
  if (n === 0 || w === 0 || d === 0) return [];
  const random = rng(seed >>> 0);
  const background = Math.min(1, Math.max(0, o.background ?? 0.22));
  const perClump = Math.max(2, o.perClump ?? 14);
  const clumps = Math.max(1, Math.round((n * (1 - background)) / perClump));
  const sigma = o.sigma ?? Math.min(4, Math.max(0.5, Math.sqrt((w * d) / clumps) * 0.11));
  const centres: Array<[number, number, number]> = [];
  for (let i = 0; i < clumps; i++) centres.push([(random() - 0.5) * w, (random() - 0.5) * d, 0.6 + random() * 0.8]);
  const spacing = o.minSpacing && o.minSpacing > 0 ? o.minSpacing : 0;
  const cell = spacing > 0 ? spacing : 1;
  const grid = new Map<string, Array<[number, number]>>();
  const free = (x: number, z: number): boolean => {
    if (spacing === 0) return true;
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const [px, pz] of grid.get(`${cx + i},${cz + j}`) ?? []) if ((px - x) ** 2 + (pz - z) ** 2 < spacing * spacing) return false;
      }
    }
    return true;
  };
  const gauss = (): number => {
    const u = Math.max(1e-9, random());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    for (let attempt = 0; attempt < 6; attempt++) {
      let x: number;
      let z: number;
      if (random() < background) {
        x = (random() - 0.5) * w;
        z = (random() - 0.5) * d;
      } else {
        const c = centres[Math.floor(random() * centres.length)] as [number, number, number];
        x = c[0] + gauss() * sigma * c[2];
        z = c[1] + gauss() * sigma * c[2];
      }
      if (Math.abs(x) > w / 2 || Math.abs(z) > d / 2 || !free(x, z)) continue;
      if (spacing > 0) {
        const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push([x, z]);
        else grid.set(key, [[x, z]]);
      }
      out.push([Math.round(x * 100) / 100, 0, Math.round(z * 100) / 100]);
      break;
    }
  }
  return out;
}
