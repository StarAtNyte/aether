import { describe, expect, it } from 'vitest';
import { isFlat } from '../src/world-renderer';
function image(w, h, pixel) {
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const [r, g, b] = pixel(x, y);
            out.set([r, g, b, 255], (y * w + x) * 4);
        }
    }
    return out;
}
describe('flat still detection', () => {
    it('flags one colour, with or without a little grain', () => {
        expect(isFlat(image(64, 36, () => [160, 165, 175]))).toBe(true);
        expect(isFlat(image(64, 36, (x, y) => [160 + ((x + y) % 2), 165, 175 - ((x * y) % 2)]))).toBe(true);
    });
    it('does not flag a picture, even a dark one with a bright detail in one channel', () => {
        expect(isFlat(image(64, 36, (x) => [x * 3, 90, 90]))).toBe(false);
        expect(isFlat(image(64, 36, (x, y) => [20, 20, x === 10 && y === 0 ? 200 : 20]))).toBe(false);
    });
});
