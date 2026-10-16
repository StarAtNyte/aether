import { createWorld } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { snapshotForReview } from '../src/review';
describe('review reports people without a character', () => {
    it('adds a person-without-character warning naming the entities, and none once they have one', () => {
        const bare = createWorld({
            entities: { 'guard-1': { id: 'guard-1', shape: { kind: 'primitive', primitive: 'capsule', size: [0.5, 1.75, 0.5] } } },
        });
        const snap = snapshotForReview(bare, null, { maxViews: 1, withViews: false });
        const f = snap.findings.find((x) => x.code === 'person-without-character');
        expect(f?.severity).toBe('warning');
        expect(f?.entities).toEqual(['guard-1']);
        const dressed = createWorld({
            entities: { 'guard-1': { id: 'guard-1', shape: { kind: 'primitive', primitive: 'capsule', size: [0.5, 1.75, 0.5] }, character: { wardrobe: 'guard', scale: 1 } } },
        });
        expect(snapshotForReview(dressed, null, { maxViews: 1, withViews: false }).findings.some((x) => x.code === 'person-without-character')).toBe(false);
    });
});
