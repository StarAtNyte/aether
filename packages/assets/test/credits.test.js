import { beforeEach, describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { creditsFor, creditsText, worldAssetIds } from '../src/credits';
import { registerUserAsset, unregisterUserAsset } from '../src/info';
import { setCatalog } from '../src/registry';
import { TEST_CATALOG } from './fixtures';
const world = createWorld({
    name: 'Test',
    environment: { hdri: 'sky-venice-sunset' },
    entities: {
        a: { id: 'a', shape: { kind: 'asset', id: 'sofa', variant: 'sofa-long' } },
        b: { id: 'b', shape: { kind: 'asset', id: 'armchair-classic' } },
        c: { id: 'c', shape: { kind: 'asset', id: 'police-car' } },
        d: { id: 'd', shape: { kind: 'asset', id: 'user-0123456789ab' } },
        e: { id: 'e', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] } },
    },
});
describe('credits', () => {
    beforeEach(() => {
        setCatalog(TEST_CATALOG);
        registerUserAsset({ meta: { id: 'user-0123456789ab', kind: 'image', name: 'Holiday photo', mime: 'image/png', bytes: 10, width: 10, height: 10, createdAt: 1 }, url: 'blob:x' });
    });
    it('collects every referenced asset id (variants, HDRI, imports)', () => {
        expect(worldAssetIds(world)).toEqual(['armchair-classic', 'police-car', 'sky-venice-sunset', 'sofa', 'sofa-long', 'user-0123456789ab']);
    });
    it('groups by pack and author, CC-BY attribution included, imports last', () => {
        const credits = creditsFor(world);
        const sources = credits.map((c) => c.source);
        expect(sources.at(-1)).toBe('Your imports');
        const by = credits.find((c) => c.licence === 'CC-BY-4.0');
        expect(by).toMatchObject({ source: 'Attributed Pack', author: 'Some Artist', url: 'https://example.org/pack', assets: ['Police car'] });
        const kenney = credits.find((c) => c.source === 'Kenney Furniture Kit');
        expect(kenney.assets).toEqual(['Long sofa', 'Sofa']);
        const ph = credits.filter((c) => c.source === 'Poly Haven').map((c) => c.author).sort();
        expect(ph).toEqual(['Greg Zaal', 'Kirill Sannikov']);
        unregisterUserAsset('user-0123456789ab');
    });
    it('renders CREDITS.txt', () => {
        const text = creditsText('Test', creditsFor(world));
        expect(text).toContain('Attributed Pack by Some Artist');
        expect(text).toContain('Licence: CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/)');
        expect(text).toContain('Used: Police car');
        expect(creditsText('Empty', [])).toContain('no third-party assets');
    });
});
