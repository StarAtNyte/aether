/**
 * Registry of built-in procedural generators (fixed id list shared with the
 * agent catalog).
 */
import type { BuiltinGenerator, CatalogEntry } from '../types';
import { NATURE_GENERATORS } from './nature';
import { TERRAIN_GENERATORS } from './terrain';
import { ARCHITECTURE_GENERATORS } from './architecture';
import { PROP_GENERATORS } from './props';
import { VEHICLE_GENERATORS } from './vehicles';
import { FX_GENERATORS } from './fx';
import { SCULPTURE_GENERATORS } from './sculpture';
import { ARCH_FURNITURE_GENERATORS, ARCH_STRUCTURE_GENERATORS } from './arch';

const ALL: readonly BuiltinGenerator[] = [
  ...TERRAIN_GENERATORS,
  ...NATURE_GENERATORS,
  ...ARCHITECTURE_GENERATORS,
  ...PROP_GENERATORS,
  ...SCULPTURE_GENERATORS,
  ...VEHICLE_GENERATORS,
  ...FX_GENERATORS,
  ...ARCH_STRUCTURE_GENERATORS,
  ...ARCH_FURNITURE_GENERATORS,
];

/**
 * All built-in generators keyed by id. Null-prototype record, frozen, so a
 * lookup with an untrusted id ("__proto__", "constructor") never hits
 * inherited properties.
 */
export const BUILTIN_GENERATORS: Readonly<Record<string, BuiltinGenerator>> = Object.freeze(
  ALL.reduce<Record<string, BuiltinGenerator>>((acc, g) => {
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
