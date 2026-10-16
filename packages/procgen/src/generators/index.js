import { NATURE_GENERATORS } from './nature';
import { FLORA_GENERATORS } from './flora';
import { TERRAIN_GENERATORS } from './terrain';
import { ARCHITECTURE_GENERATORS } from './architecture';
import { PROP_GENERATORS } from './props';
import { VEHICLE_GENERATORS } from './vehicles';
import { FX_GENERATORS } from './fx';
import { SCULPTURE_GENERATORS } from './sculpture';
import { ARCH_FURNITURE_GENERATORS, ARCH_STRUCTURE_GENERATORS, FURN_PART_GENERATOR } from './arch';
const ALL = [
    ...TERRAIN_GENERATORS,
    ...NATURE_GENERATORS,
    ...FLORA_GENERATORS,
    ...ARCHITECTURE_GENERATORS,
    ...PROP_GENERATORS,
    ...SCULPTURE_GENERATORS,
    ...VEHICLE_GENERATORS,
    ...FX_GENERATORS,
];
/**
 * Parametric architecture generators (`./arch`: `arch-*` structure, `furn-*`
 * furniture). They are registered for lookup (render, physics, workers) but
 * kept out of {@link catalog}: the planner reaches them through the
 * `build_architecture` tool (building plans compiled by @aether/arch), not
 * as free-form shapes, and listing them would add ~2k tokens to every
 * system prompt. Their geometry is in the entity frame (not recentred).
 */
const ARCH = [...ARCH_STRUCTURE_GENERATORS, ...ARCH_FURNITURE_GENERATORS, FURN_PART_GENERATOR];
/** Ids of the architecture generators (reserved: custom generators may not shadow them). */
export const ARCH_GENERATOR_IDS = new Set(ARCH.map((g) => g.id));
/**
 * All built-in generators keyed by id. Null-prototype record, frozen, so a
 * lookup with an untrusted id ("__proto__", "constructor") never hits
 * inherited properties.
 */
export const BUILTIN_GENERATORS = Object.freeze([...ALL, ...ARCH].reduce((acc, g) => {
    acc[g.id] = g;
    return acc;
}, Object.create(null)));
/** Look up a built-in generator by id (own keys only). */
export function getBuiltinGenerator(id) {
    return Object.hasOwn(BUILTIN_GENERATORS, id) ? BUILTIN_GENERATORS[id] : undefined;
}
/** Catalog for the agent prompt: id, description, category and param specs, in a stable order. */
export function catalog() {
    return ALL.map((g) => ({
        id: g.id,
        description: g.description,
        category: g.category,
        params: structuredClone(g.params),
    }));
}
