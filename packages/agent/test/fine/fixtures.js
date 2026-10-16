/**
 * The bundled default projects the small-edit eval runs against.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateWorld } from '@aether/core';
/** Fixture name → bundled world file. */
export const FIXTURES = {
    apartment: 'apartment',
    penthouse: 'skyline-penthouse',
    living: 'scandinavian-living',
    lantern: 'lantern-isles',
    coins: 'coin-island',
    kart: 'kart-canyon',
    camp: 'lakeside-camp',
    meadow: 'painterly-meadow',
    blocks: 'blockfall',
};
const DIR = fileURLToPath(new URL('../../../../apps/studio/public/templates/worlds/', import.meta.url));
const cache = new Map();
/** Load (and cache) a fixture world. */
export function loadFixture(name) {
    const hit = cache.get(name);
    if (hit)
        return hit;
    const raw = JSON.parse(readFileSync(`${DIR}${FIXTURES[name]}.json`, 'utf8'));
    const r = validateWorld(raw.world ?? raw);
    if (!r.ok)
        throw new Error(`fixture ${name}: ${r.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join('; ')}`);
    cache.set(name, r.world);
    return r.world;
}
