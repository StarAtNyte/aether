import { describe, expect, it } from 'vitest';
import { layoutMarks, MAX_DRAWN_MARKS } from '../src/ai/marks';
describe('review mark layout', () => {
    it('places outlines and keeps badges inside the image', () => {
        const placed = layoutMarks([{ n: 3, x: 0.02, y: 0.02, w: 0.05, h: 0.05 }, { n: 12, x: 0.99, y: 0.99, w: 0.05, h: 0.05 }], 768, 512);
        expect(placed).toHaveLength(2);
        for (const p of placed) {
            expect(p.bx).toBeGreaterThanOrEqual(0);
            expect(p.by).toBeGreaterThanOrEqual(0);
            expect(p.bx + p.bw).toBeLessThanOrEqual(768);
            expect(p.by + p.bh).toBeLessThanOrEqual(512);
            expect(p.x + p.w).toBeLessThanOrEqual(768 + 1e-6);
            expect(p.y + p.h).toBeLessThanOrEqual(512 + 1e-6);
        }
    });
    it('does not stack badges of marks that start at the same corner', () => {
        const placed = layoutMarks([{ n: 1, x: 0.3, y: 0.3, w: 0.1, h: 0.1 }, { n: 2, x: 0.3, y: 0.3, w: 0.1, h: 0.1 }], 768, 512);
        const [a, b] = placed;
        const overlap = a.bx < b.bx + b.bw && a.bx + a.bw > b.bx && a.by < b.by + b.bh && a.by + a.bh > b.by;
        expect(overlap).toBe(false);
    });
    it('drops hostile values and caps the count, keeping the biggest', () => {
        const many = Array.from({ length: 200 }, (_, i) => ({ n: i + 1, x: 0.5, y: 0.5, w: 0.001 + i * 0.002, h: 0.001 + i * 0.002 }));
        const placed = layoutMarks([...many, { n: 500, x: Number.NaN, y: 0, w: 1, h: 1 }, { n: -1, x: 0.5, y: 0.5, w: 0.1, h: 0.1 }], 640, 640);
        expect(placed).toHaveLength(MAX_DRAWN_MARKS);
        expect(placed.some((p) => p.n === 500 || p.n === -1)).toBe(false);
        expect(placed.some((p) => p.n === 200)).toBe(true);
        expect(placed.some((p) => p.n === 1)).toBe(false);
    });
});
