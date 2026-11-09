/**
 * Registry of built-in procedural generators (fixed id list shared with the
 * agent catalog).
 */
import type { BuiltinGenerator, CatalogEntry } from '../types';
import { NATURE_GENERATORS } from './nature';
import { FLORA_GENERATORS } from './flora';
import { TERRAIN_GENERATORS } from './terrain';
import { ARCHITECTURE_GENERATORS } from './architecture';
import { SKYLINE_GENERATORS } from './skyline';
import { PROP_GENERATORS } from './props';
import { OUTPOST_GENERATORS } from './outpost';
import { VEHICLE_GENERATORS } from './vehicles';
import { FX_GENERATORS } from './fx';
import { WATER_GENERATORS } from './water';
import { CLASSICAL_GENERATORS } from './classical';
import { SCULPTURE_GENERATORS } from './sculpture';
import { ARCH_FURNITURE_GENERATORS, ARCH_STRUCTURE_GENERATORS, FURN_PART_GENERATOR } from './arch';

const ALL: readonly BuiltinGenerator[] = [
  ...TERRAIN_GENERATORS,
  ...NATURE_GENERATORS,
  ...FLORA_GENERATORS,
  ...ARCHITECTURE_GENERATORS,
  ...SKYLINE_GENERATORS,
  ...PROP_GENERATORS,
  ...OUTPOST_GENERATORS,
  ...SCULPTURE_GENERATORS,
  ...VEHICLE_GENERATORS,
  ...FX_GENERATORS,
  ...WATER_GENERATORS,
  ...CLASSICAL_GENERATORS,
];
/**
 * Parametric architecture generators (`./arch`: `arch-*` structure, `furn-*`
 * furniture). They are registered for lookup (render, physics, workers) but
 * kept out of {@link catalog}: the planner reaches them through the
 * `build_architecture` tool (building plans compiled by @aether/arch), not
 * as free-form shapes, and listing them would add ~2k tokens to every
 * system prompt. Their geometry is in the entity frame (not recentred).
 */
const ARCH: readonly BuiltinGenerator[] = [...ARCH_STRUCTURE_GENERATORS, ...ARCH_FURNITURE_GENERATORS, FURN_PART_GENERATOR];

/** Ids of the architecture generators (reserved: custom generators may not shadow them). */
export const ARCH_GENERATOR_IDS: ReadonlySet<string> = new Set(ARCH.map((g) => g.id));

/**
 * All built-in generators keyed by id. Null-prototype record, frozen, so a
 * lookup with an untrusted id ("__proto__", "constructor") never hits
 * inherited properties.
 */
export const BUILTIN_GENERATORS: Readonly<Record<string, BuiltinGenerator>> = Object.freeze(
  [...ALL, ...ARCH].reduce<Record<string, BuiltinGenerator>>((acc, g) => {
    acc[g.id] = g;
    return acc;
  }, Object.create(null) as Record<string, BuiltinGenerator>),
);

/** Look up a built-in generator by id (own keys only). */
export function getBuiltinGenerator(id: string): BuiltinGenerator | undefined {
  return Object.hasOwn(BUILTIN_GENERATORS, id) ? BUILTIN_GENERATORS[id] : undefined;
}

/** Catalog for the agent prompt: id, description, category and param specs, in a stable order. */
export function catalog(): CatalogEntry[] {
  return ALL.map((g) => ({
    id: g.id,
    description: g.description,
    category: g.category,
    params: structuredClone(g.params),
  }));
}
