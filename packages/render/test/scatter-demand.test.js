/**
 * Regression for QA defect D10 (Canyon of Colossi showed bare ground: "scatter field limited to 0 of 60000
 * instances"): when several field-sized scatter layers together ask for more than the field budget, none
 * may starve the others.
 */
import { describe, expect, it } from 'vitest';
import { makeSync, tick, world } from './helpers';
const layer = (id, count) => ({
    id,
    shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, count, area: [200, 200], seed: 5 },
});
describe('SceneSync scatter fields under demand (QA D10)', () => {
    it('no huge forest starves the ground cover: both layers keep a share of a small field budget', async () => {
        const { sync } = makeSync({ fields: { maxInstances: 6000, triangles: 400_000 } });
        // A canopy that alone would swallow the whole budget, then a field of grass behind it.
        await sync.setWorld(world([layer('canopy', 50_000), layer('grass', 20_000)]));
        await tick();
        const stats = sync.fieldStats();
        expect(stats.fields).toBe(2);
        expect(stats.instances).toBeLessThanOrEqual(6000);
        expect(stats.instances).toBeGreaterThan(0);
        const warnings = [...sync.getWarnings().entries()];
        for (const id of ['canopy', 'grass'])
            expect(warnings.some(([key, w]) => key === id && /limited to 0 of/.test(w))).toBe(false);
    });
    it('a lone field may use the whole budget', async () => {
        const { sync } = makeSync({ fields: { maxInstances: 6000, triangles: 400_000 } });
        await sync.setWorld(world([layer('canopy', 50_000)]));
        await tick();
        expect(sync.fieldStats().instances).toBe(6000);
    });
});
