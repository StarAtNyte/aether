/**
 * Architecture and interior generators backed by @aether/arch: structural
 * elements (`arch-wall`, `arch-slab`, `arch-roof`, …) whose params are
 * nested JSON validated by zod (polylines, openings, finishes), and the
 * furniture catalogue (`furn-*`) with ordinary scalar params.
 *
 * Arch geometry is already in the entity frame (walls start at the origin,
 * slabs use plan coordinates), so outputs are NOT recentred.
 */
import type { Json, ParamSpec } from '@aether/core';
import { FURNITURE, STRUCTURE_DESCRIPTIONS, STRUCTURE_IDS, buildFurniture, buildStructure, parseStructureParams, type ArchOutput, type StructureId } from '@aether/arch';
import type { Bounds, BuiltinGenerator, ColliderDesc, GeneratorOutput, MeshPart } from '../types';

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

/** Convert arch output to a generator output (bounds + triangle count computed). */
export function archToOutput(out: ArchOutput, ms: number): GeneratorOutput {
  const parts: MeshPart[] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  for (const p of out.parts) {
    if (p.indices.length === 0) continue;
    parts.push({ positions: p.positions, normals: p.normals, indices: p.indices, uvs: p.uvs, material: p.material });
    triangles += p.indices.length / 3;
    for (let k = 0; k < p.positions.length; k += 3) {
      for (let a = 0; a < 3; a++) {
        const v = p.positions[k + a] as number;
        if (v < (min[a] as number)) min[a] = v;
        if (v > (max[a] as number)) max[a] = v;
      }
    }
  }
  const bounds: Bounds = parts.length > 0 ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] };
  const colliders: ColliderDesc[] = out.colliders.map((c) => {
    if (c.kind === 'box') return c.rotation ? { kind: 'box', halfExtents: c.halfExtents, offset: c.offset, rotation: c.rotation } : { kind: 'box', halfExtents: c.halfExtents, offset: c.offset };
    if (c.kind === 'hull') return { kind: 'hull', points: c.points, offset: c.offset };
    return { kind: 'trimesh', positions: c.positions, indices: c.indices };
  });
  return { parts, colliders, bounds, stats: { triangles, ms } };
}

/** Catalogue param hints for structural generators (the full schema is zod-validated). */
const STRUCTURE_HINTS: Record<StructureId, Record<string, ParamSpec>> = {
  'arch-wall': { length: { type: 'number', default: 4, min: 0.05, max: 80, description: 'length along +X (m); also openings[], finishA/finishB, thickness, height' } },
  'arch-slab': { thickness: { type: 'number', default: 0.2, min: 0.01, max: 5, description: 'polygon [[x,z]…] required; holes, finish' } },
  'arch-ceiling': { cove: { type: 'number', default: 0, min: 0, max: 0.4, description: 'polygon [[x,z]…] required' } },
  'arch-roof': { width: { type: 'number', default: 10, min: 0.5, max: 200, description: 'footprint X' }, depth: { type: 'number', default: 8, min: 0.5, max: 200, description: 'footprint Z' }, shape: { type: 'enum', default: 'gable', options: ['flat', 'gable', 'hip', 'shed'], description: 'roof form' } },
  'arch-stair': { rise: { type: 'number', default: 3, min: 0.2, max: 30, description: 'floor-to-floor height' }, shape: { type: 'enum', default: 'straight', options: ['straight', 'l', 'u'], description: 'layout' } },
  'arch-door': { width: { type: 'number', default: 0.9, min: 0.4, max: 3, description: 'leaf width' }, style: { type: 'enum', default: 'panel', options: ['panel', 'flush', 'glass', 'slab'], description: 'leaf style' } },
  'arch-frame': { width: { type: 'number', default: 0.9, min: 0.4, max: 12, description: 'opening width' }, height: { type: 'number', default: 2.1, min: 0.4, max: 30, description: 'opening height' } },
  'arch-window': { width: { type: 'number', default: 1.2, min: 0.3, max: 12, description: 'width' }, height: { type: 'number', default: 1.4, min: 0.3, max: 10, description: 'height' } },
  'arch-railing': { height: { type: 'number', default: 1.05, min: 0.3, max: 2, description: 'points [[x,z]…] required' } },
  'arch-column': { size: { type: 'number', default: 0.3, min: 0.05, max: 3, description: 'diameter / side' }, height: { type: 'number', default: 2.8, min: 0.2, max: 30, description: 'height' } },
  'arch-basin': { width: { type: 'number', default: 8, min: 0.5, max: 60, description: 'pool X' }, length: { type: 'number', default: 4, min: 0.5, max: 60, description: 'pool Z' } },
};

function structural(id: StructureId): BuiltinGenerator {
  return {
    id,
    description: STRUCTURE_DESCRIPTIONS[id],
    category: 'architecture',
    params: STRUCTURE_HINTS[id],
    resolve: (params) => parseStructureParams(id, params),
    generate(params) {
      const t0 = now();
      return archToOutput(buildStructure(id, params), now() - t0);
    },
  };
}

/** Structural generators. */
export const ARCH_STRUCTURE_GENERATORS: readonly BuiltinGenerator[] = STRUCTURE_IDS.map(structural);

/** Furniture generators. */
export const ARCH_FURNITURE_GENERATORS: readonly BuiltinGenerator[] = FURNITURE.map((def) => ({
  id: def.id,
  description: def.description,
  category: 'interior' as const,
  params: def.params,
  generate(params: Record<string, Json>, api) {
    const t0 = now();
    return archToOutput(buildFurniture(def, params, api.seed), now() - t0);
  },
}));
