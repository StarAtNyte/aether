import { describe, expect, it } from 'vitest';
import { createScriptRunner, isScriptingReady } from '../src';
describe('script runner before initScripting()', () => {
    it('throws a clear error', () => {
        expect(isScriptingReady()).toBe(false);
        expect(() => createScriptRunner()).toThrow(/await initScripting\(\)/);
    });
});
