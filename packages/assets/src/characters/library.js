/**
 * The character library: the cast of people and the motion sets, as built by
 * `scripts/characters/build.ts` (see `generated.ts`) plus the hand-written
 * traits (age, wardrobe, skin) the resolver and the planner use to pick someone.
 *
 * Pure data and lookups, no three.js: usable from the planner (Node), the
 * renderer and tests.
 */
import { GENERATED_LIBRARY } from './generated';
/** Traits by cast id (the visible outfit decides the wardrobes). */
export const CAST_TRAITS = {
    marcus: { age: 'old', skin: 'light', wardrobes: ['elder', 'formal', 'merchant', 'villager'], words: ['grey', 'gray', 'white-haired', 'grandfather', 'old'] },
    dario: { age: 'young', skin: 'dark', wardrobes: ['bandit', 'casual', 'worker', 'traveller'], words: ['curly', 'hoodie'] },
    tomas: { age: 'adult', skin: 'light', wardrobes: ['guard', 'traveller', 'worker', 'villager'], words: ['vest', 'jacket'] },
    felix: { age: 'young', skin: 'light', wardrobes: ['casual', 'villager', 'traveller'], words: ['red', 'sweater'] },
    kofi: { age: 'adult', skin: 'dark', wardrobes: ['guard', 'casual', 'worker', 'bandit'], words: ['denim'] },
    walter: { age: 'adult', skin: 'light', wardrobes: ['merchant', 'villager', 'worker', 'formal'], words: ['balding', 'bald'] },
    sophie: { age: 'young', skin: 'light', wardrobes: ['formal', 'merchant', 'casual'], words: ['blouse', 'skirt'] },
    edith: { age: 'old', skin: 'light', wardrobes: ['elder', 'villager', 'traveller', 'merchant'], words: ['grandmother', 'granny'] },
    rosa: { age: 'adult', skin: 'tan', wardrobes: ['villager', 'merchant', 'formal'], words: ['dress'] },
    juno: { age: 'young', skin: 'light', wardrobes: ['casual', 'traveller', 'worker'], words: ['blonde', 'blond'] },
};
const FALLBACK_TRAITS = { age: 'adult', skin: 'light', wardrobes: ['casual'], words: [] };
/** Every body of the library. */
export const CAST = GENERATED_LIBRARY.cast.map((c) => ({ ...c, traits: CAST_TRAITS[c.id] ?? FALLBACK_TRAITS }));
/** A body by id. */
export function castById(id) {
    return CAST.find((c) => c.id === id);
}
/** The motion set of a gender. */
export function motionSet(gender) {
    return GENERATED_LIBRARY.motions.find((m) => m.gender === gender);
}
/** Clip table of a gender, by name. */
export function clipTable(gender) {
    return new Map((motionSet(gender)?.clips ?? []).map((c) => [c.name, c]));
}
/** Public URL of a library file under `base` (the catalog base, `/assets/lib/` by default). */
export function characterUrl(file, base = '/assets/lib/') {
    return `${base}${file}`;
}
