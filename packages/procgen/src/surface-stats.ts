import type { Entity, MaterialSpec, WorldDoc } from '@aether/core';
import { generate } from './generate';
import type { GeneratorCache } from './cache';
import type { MeshPart, SandboxRunner } from './types';

/** Most custom-generator entities measured (the rest are left out of the totals). */
const MAX_ENTITIES = 400;

/** How one surface is drawn: with real maps (`finished`) or as a plain colour (`flat`). */
export type SurfaceKind = 'finished' | 'flat';

/**
 * Whether a material gives the renderer real surface detail: a PBR finish, a texture set, a stylised preset (stone, wood, grass, ...
 * which the renderer draws with maps), terrain layering, foliage cards, or an emissive/glass look that is not meant to be textured.
 * A plain `color` (with or without vertex colours and roughness) is flat: the Roblox look.
 */
export function surfaceKindOf(material: Readonly<MaterialSpec> | undefined, entityMaterial?: Readonly<MaterialSpec>): SurfaceKind {
  for (const m of [material, entityMaterial]) {
    if (!m) continue;
    if (m.finish || m.texture || m.foliage || m.splat) return 'finished';
    if (m.preset && m.preset !== 'plastic') return 'finished';
    if (m.emissive !== undefined && (m.emissiveIntensity ?? 0) > 0) return 'finished';
    if (m.opacity !== undefined && m.opacity < 0.95) return 'finished';
  }
  return 'flat';
}

/** Surface area of a part (m²), the weight of its look. */
function partArea(p: Pick<MeshPart, 'positions' | 'indices'>): number {
  const pos = p.positions;
  const idx = p.indices;
  let area = 0;
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = (idx[i] as number) * 3;
    const b = (idx[i + 1] as number) * 3;
    const c = (idx[i + 2] as number) * 3;
    const ux = (pos[b] as number) - (pos[a] as number);
    const uy = (pos[b + 1] as number) - (pos[a + 1] as number);
    const uz = (pos[b + 2] as number) - (pos[a + 2] as number);
    const vx = (pos[c] as number) - (pos[a] as number);
    const vy = (pos[c + 1] as number) - (pos[a + 1] as number);
    const vz = (pos[c + 2] as number) - (pos[a + 2] as number);
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    area += 0.5 * Math.hypot(cx, cy, cz);
  }
  return area;
}

/** The flat share of one entity's generated surface. */
export interface EntitySurface {
  id: string;
  name: string;
  generator: string;
  /** Surface area (m²) drawn flat / in all. */
  flatArea: number;
  area: number;
}

/** What a world's custom generators draw with real maps and what they draw as plain colour (by surface area, instances counted). */
export interface SurfaceStats {
  area: number;
  flatArea: number;
  /** `flatArea / area` (0 when nothing was measured). */
  flatShare: number;
  /** The worst entities first: most flat area. */
  offenders: EntitySurface[];
  /** Generators whose parts are plain colour, with the entities that use them. */
  generators: Array<{ generator: string; flatArea: number; area: number; entities: string[] }>;
  /** Geometric detail per generator: triangles per m2 of its surface (a bare box is about 0.5 to 2; bevels, trim and relief raise it). */
  detail: Array<{ generator: string; tris: number; area: number; parts: number; trisPerM2: number; materials: number; entities: string[] }>;
  /** Groups of entities that are the same piece repeated unchanged (same generator, params and size). */
  repeats: Array<{ generator: string; count: number; entities: string[] }>;
}

/**
 * Measure how the world's custom-generator shapes are drawn, by running their generators in `sandbox`. The agent's surface gate
 * reads this: a town of plain-colour boxes reads as a toy, so the finish of each piece (plaster, roof-tile, cobble, asphalt, limestone,
 * ...) is part of the work, not an extra. Library generators (the crafted `furn-*` pieces) and imported models carry their own
 * maps and are not counted.
 */
export async function worldSurfaceStats(world: WorldDoc, sandbox: SandboxRunner, cache?: GeneratorCache): Promise<SurfaceStats> {
  const per = new Map<string, { area: number; flat: number; tris: number; parts: number; looks: Set<string> }>();
  const same = new Map<string, string[]>();
  const entities: EntitySurface[] = [];
  const byGen = new Map<string, { flatArea: number; area: number; entities: string[] }>();
  let n = 0;
  let area = 0;
  let flatArea = 0;
  for (const id of Object.keys(world.entities)) {
    const e = world.entities[id] as Entity;
    if (e.template || e.shape.kind !== 'procedural' || !Object.hasOwn(world.generators, e.shape.generator)) continue;
    if (++n > MAX_ENTITIES) break;
    const gen = e.shape.generator;
    let m = per.get(gen);
    if (!m) {
      m = { area: 0, flat: 0, tris: 0, parts: 0, looks: new Set<string>() };
      try {
        const out = await generate(e.shape, world, { sandbox, ...(cache ? { cache } : {}) });
        for (const p of out.parts) {
          const a = partArea(p);
          m.area += a;
          m.tris += p.indices.length / 3;
          m.parts++;
          // A distinct look: finish or preset with its colour (trim is a second finish or a contrasting colour).
          m.looks.add(`${p.material.finish ?? p.material.preset ?? ''}|${p.material.texture?.id ?? ''}|${p.material.color ?? ''}`);
          if (surfaceKindOf(p.material, e.material) === 'flat') m.flat += a;
        }
      } catch {
        /* a generator that fails is the verifier's finding, not this one's */
      }
      per.set(gen, m);
    }
    const scale = Math.abs(e.transform.scale[0] * e.transform.scale[1] * e.transform.scale[2]) ** (2 / 3);
    const a = m.area * scale;
    const f = m.flat * scale;
    area += a;
    flatArea += f;
    entities.push({ id, name: e.name || id, generator: gen, flatArea: f, area: a });
    const sig = `${gen}|${JSON.stringify(e.shape.params ?? {})}|${e.transform.scale.map((v) => Math.round(v * 20) / 20).join(',')}`;
    same.set(sig, [...(same.get(sig) ?? []), id]);
    const g = byGen.get(gen) ?? { flatArea: 0, area: 0, entities: [] };
    g.flatArea += f;
    g.area += a;
    g.entities.push(id);
    byGen.set(gen, g);
  }
  entities.sort((x, y) => y.flatArea - x.flatArea);
  const generators = [...byGen.entries()].map(([generator, g]) => ({ generator, ...g })).sort((x, y) => y.flatArea - x.flatArea);
  const detail = [...per.entries()]
    .map(([generator, m]) => ({ generator, tris: m.tris, area: m.area, parts: m.parts, trisPerM2: m.area > 0 ? m.tris / m.area : 0, materials: m.looks.size, entities: byGen.get(generator)?.entities ?? [] }))
    .filter((d) => d.entities.length > 0)
    .sort((x, y) => y.area * y.entities.length - x.area * x.entities.length);
  const repeats = [...same.entries()].map(([sig, ids]) => ({ generator: sig.split('|')[0] as string, count: ids.length, entities: ids })).filter((r) => r.count >= 2).sort((x, y) => y.count - x.count);
  return { area, flatArea, flatShare: area > 0 ? flatArea / area : 0, offenders: entities.slice(0, 12), generators, detail, repeats };
}
