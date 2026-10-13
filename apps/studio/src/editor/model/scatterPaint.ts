/**
 * Scatter painting: add instances under a brush (seeded, density-controlled,
 * never closer than a minimum spacing to existing ones) or erase them.
 * Points are in the scatter entity's local space. Pure.
 */
import { rng, type EntityId, type EntityInput, type Vec3 } from '@aether/core';

/** Most painted points per scatter entity (schema cap). */
export const MAX_PAINTED_POINTS = 20_000;
/** Generators offered by the scatter brush, in menu order. */
export const SCATTER_ITEMS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'grass-tuft', label: 'Grass' },
  { id: 'flowers', label: 'Flowers' },
  { id: 'bush', label: 'Bushes' },
  { id: 'tree-pine', label: 'Pine trees' },
  { id: 'tree-oak', label: 'Oak trees' },
  { id: 'tree-palm', label: 'Palm trees' },
  { id: 'rock', label: 'Rocks' },
  { id: 'mushroom', label: 'Mushrooms' },
  { id: 'crystal', label: 'Crystals' },
];

/** Minimum spacing between painted instances for a density (instances per m²). */
export function spacingFor(density: number): number {
  return 0.8 / Math.sqrt(Math.max(0.01, density));
}

/** Candidate positions (x, z) for one dab: uniformly in the brush disk around (cx, cz). */
export function dabCandidates(cx: number, cz: number, radius: number, density: number, seed: number): Array<[number, number]> {
  const random = rng(seed);
  const area = Math.PI * radius * radius;
  const n = Math.min(400, Math.max(1, Math.round(area * density * 0.35)));
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(random()) * radius;
    const a = random() * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return out;
}

/** Spatial hash of existing points (x/z) for spacing checks. */
export class PointGrid {
  private readonly cells = new Map<string, Array<[number, number]>>();
  constructor(private readonly cell: number) {}
  private key(x: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }
  add(x: number, z: number): void {
    const k = this.key(x, z);
    const list = this.cells.get(k);
    if (list) list.push([x, z]);
    else this.cells.set(k, [[x, z]]);
  }
  /** True when a stored point is closer than `d` to (x, z). */
  near(x: number, z: number, d: number): boolean {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    const d2 = d * d;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const [px, pz] of this.cells.get(`${cx + i},${cz + j}`) ?? []) if ((px - x) ** 2 + (pz - z) ** 2 < d2) return true;
      }
    }
    return false;
  }
}

/** Remove points within `radius` (x/z distance) of the centre. Returns the kept points and how many were removed. */
export function erasePoints(points: readonly Vec3[], cx: number, cz: number, radius: number): { points: Vec3[]; removed: number } {
  const r2 = radius * radius;
  const kept = points.filter((p) => (p[0] - cx) ** 2 + (p[2] - cz) ** 2 > r2);
  return { points: kept, removed: points.length - kept.length };
}

/** A new, empty painted scatter entity for a generator (at the origin, so local = world). */
export function scatterEntity(id: EntityId, generator: string, label: string, onSurface?: EntityId): EntityInput {
  return {
    id,
    name: `${label} (painted)`,
    tags: ['painted'],
    transform: { position: [0, 0, 0] },
    shape: {
      kind: 'scatter',
      of: { kind: 'procedural', generator, params: {} },
      count: 1,
      area: [1, 1],
      seed: 1,
      scaleRange: [0.8, 1.25],
      randomYaw: true,
      points: [],
      ...(onSurface ? { onSurface } : {}),
    },
  };
}
