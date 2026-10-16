import { describe, expect, it } from 'vitest';
import { FINISHES } from '@aether/arch';
import { finishPixels } from '../src/finish-pixels';
const WALL_FINISHES = ['wallpaper', 'wallpaper-stripe', 'wallpaper-floral', 'wallpaper-damask', 'wallpaper-geometric', 'panelling', 'wood-slats', 'foliage'];
describe('wall covering finishes', () => {
    for (const id of WALL_FINISHES) {
        it(`${id} is in the library and synthesises a deterministic textured map`, () => {
            expect(FINISHES[id]).toBeDefined();
            const px = finishPixels(id, 64);
            expect(px.size).toBe(64);
            const seen = new Set();
            for (let i = 0; i < px.albedo.length; i += 4)
                seen.add(px.albedo[i]);
            expect(seen.size).toBeGreaterThan(6);
            expect(Buffer.from(finishPixels(id, 64).albedo).equals(Buffer.from(px.albedo))).toBe(true);
        });
    }
    it('patterned papers carry two clearly different tones (ground and motif)', () => {
        for (const id of ['wallpaper-stripe', 'wallpaper-floral', 'wallpaper-damask', 'wallpaper-geometric']) {
            const px = finishPixels(id, 128);
            let lo = 255;
            let hi = 0;
            for (let i = 0; i < px.albedo.length; i += 4) {
                const v = px.albedo[i];
                lo = Math.min(lo, v);
                hi = Math.max(hi, v);
            }
            expect(hi - lo).toBeGreaterThan(20);
        }
    });
});
