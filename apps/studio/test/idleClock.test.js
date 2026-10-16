import { describe, expect, it } from 'vitest';
import { IdleClock } from '../src/engine/IdleClock';
describe('IdleClock', () => {
    it('becomes idle after the threshold and wakes on activity', () => {
        const c = new IdleClock(1000);
        c.touch(0);
        expect(c.idle(500)).toBe(false);
        expect(c.idle(1001)).toBe(true);
        c.touch(1200);
        expect(c.idle(1500)).toBe(false);
        expect(c.idle(2300)).toBe(true);
    });
    it('is never idle before the first activity and ignores time going backwards', () => {
        const c = new IdleClock(1000);
        expect(c.idle(1e9)).toBe(false);
        c.touch(5000);
        c.touch(10);
        c.touch(Number.NaN);
        expect(c.idle(5500)).toBe(false);
        expect(c.idle(6001)).toBe(true);
    });
});
