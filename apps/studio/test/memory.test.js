import { afterEach, describe, expect, it, vi } from 'vitest';
import { decideLowMemory, HEAP_PRESSURE_BYTES, heapUnderPressure, readMemorySignals, RecoveryLimiter } from '../src/lib/memory';
describe('decideLowMemory', () => {
    it('follows an explicit setting regardless of signals', () => {
        expect(decideLowMemory('on', {})).toMatchObject({ on: true, automatic: false });
        expect(decideLowMemory('off', { deviceMemoryGB: 1, contextLosses: 3 })).toMatchObject({ on: false, reason: null });
    });
    it('turns on automatically for devices with 4 GB or less', () => {
        expect(decideLowMemory('auto', { deviceMemoryGB: 4 })).toMatchObject({ on: true, automatic: true, reason: 'This device reports 4 GB of memory' });
        expect(decideLowMemory('auto', { deviceMemoryGB: 0.5 }).on).toBe(true);
        expect(decideLowMemory('auto', { deviceMemoryGB: 8 }).on).toBe(false);
    });
    it('turns on under heap pressure or after a lost context', () => {
        expect(decideLowMemory('auto', { heapUsedBytes: 800e6, heapLimitBytes: 1000e6 })).toMatchObject({ on: true, reason: 'Memory pressure detected' });
        expect(decideLowMemory('auto', { contextLosses: 1 })).toMatchObject({ on: true, reason: 'The graphics context was lost' });
        expect(decideLowMemory('auto', { heapUsedBytes: 80e6, heapLimitBytes: 4000e6, deviceMemoryGB: 16 }).on).toBe(false);
    });
    it('ignores invalid signals', () => {
        expect(decideLowMemory('auto', { deviceMemoryGB: Number.NaN, heapUsedBytes: -1, heapLimitBytes: 0 }).on).toBe(false);
        expect(decideLowMemory('auto', { deviceMemoryGB: 0 }).on).toBe(false);
    });
});
describe('heapUnderPressure', () => {
    it('uses the ratio when the limit is known and an absolute cap otherwise', () => {
        expect(heapUnderPressure({ heapUsedBytes: 700, heapLimitBytes: 1000 })).toBe(true);
        expect(heapUnderPressure({ heapUsedBytes: 600, heapLimitBytes: 1000 })).toBe(false);
        expect(heapUnderPressure({ heapUsedBytes: HEAP_PRESSURE_BYTES })).toBe(true);
        expect(heapUnderPressure({})).toBe(false);
    });
});
describe('readMemorySignals', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('reads Chromium-only APIs when present and omits them otherwise', () => {
        vi.stubGlobal('navigator', { deviceMemory: 2 });
        vi.stubGlobal('performance', { now: () => 0, memory: { usedJSHeapSize: 10, jsHeapSizeLimit: 100 } });
        expect(readMemorySignals()).toEqual({ deviceMemoryGB: 2, heapUsedBytes: 10, heapLimitBytes: 100 });
        vi.stubGlobal('navigator', { deviceMemory: 'lots' });
        vi.stubGlobal('performance', { now: () => 0 });
        expect(readMemorySignals()).toEqual({});
    });
});
describe('RecoveryLimiter', () => {
    it('allows a bounded number of recoveries per window', () => {
        const l = new RecoveryLimiter(3, 1000);
        expect(l.tryAcquire(0)).toBe(true);
        expect(l.tryAcquire(10)).toBe(true);
        expect(l.tryAcquire(20)).toBe(true);
        expect(l.tryAcquire(30)).toBe(false);
        expect(l.tryAcquire(1005)).toBe(true);
    });
});
