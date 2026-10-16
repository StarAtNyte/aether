import { describe, expect, it } from 'vitest';
import { Environment } from '@aether/core';
import { MAX_REMIXES, followUpChips, remixSuggestions } from '../src/lib/remix';
const env = (input) => Environment.parse(input);
describe('remixSuggestions', () => {
    it('never suggests the sky the world already has', () => {
        for (const sky of ['day', 'dawn', 'sunset', 'night', 'overcast', 'space', 'studio']) {
            const out = remixSuggestions(env({ sky }));
            expect(out.length).toBeGreaterThan(0);
            expect(out.length).toBeLessThanOrEqual(MAX_REMIXES);
            expect(out[0]?.sky).not.toBe(sky);
        }
    });
    it('offers sunrise at night and night at sunset', () => {
        expect(remixSuggestions(env({ sky: 'night' }))[0]?.prompt).toBe('Make it sunrise');
        expect(remixSuggestions(env({ sky: 'sunset' })).map((r) => r.prompt)).toContain('Make it night');
        expect(remixSuggestions(env({ sky: 'sunset' })).map((r) => r.prompt)).not.toContain('Make it sunset');
    });
    it('skips weather and gravity that already apply', () => {
        const out = remixSuggestions(env({ sky: 'day', weather: 'snow', gravity: [0, -1.6, 0] })).map((r) => r.prompt);
        expect(out).not.toContain('Make it snow');
        expect(out).not.toContain('Low gravity');
    });
});
describe('followUpChips', () => {
    const c = (prompt) => ({ prompt });
    it('offers nothing for an empty world and removes duplicate prompts', () => {
        expect(followUpChips([c('Make it night')], 0, 0)).toEqual([]);
        expect(followUpChips([c('Make it night'), c('make it night'), c('Make it sunset'), c('Add rain'), c('Add fog')], 0, 5).map((x) => x.prompt)).toEqual(['Make it night', 'Make it sunset', 'Add rain']);
    });
    it('keeps every chip of a selection', () => {
        expect(followUpChips([c('a'), c('b'), c('c'), c('d')], 1, 5)).toHaveLength(4);
    });
});
