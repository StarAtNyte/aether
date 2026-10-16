import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createWorld, Environment } from '../src/index';
import { ZOD_JITLESS } from '../src/zod-config';
describe('zod configuration', () => {
    it('runs jitless (no Function/eval probe under a strict CSP) before any schema parses', () => {
        expect(ZOD_JITLESS).toBe(true);
        expect(z.config().jitless).toBe(true);
    });
    it('never calls the Function constructor while parsing worlds', () => {
        const original = globalThis.Function;
        let calls = 0;
        const spy = new Proxy(original, {
            construct(target, args) {
                calls++;
                return Reflect.construct(target, args);
            },
            apply(target, self, args) {
                calls++;
                return Reflect.apply(target, self, args);
            },
        });
        globalThis.Function = spy;
        try {
            const w = createWorld({ entities: { a: { id: 'a', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] } } } });
            expect(Object.keys(w.entities)).toEqual(['a']);
            expect(Environment.parse({ sky: 'sunset' }).sky).toBe('sunset');
        }
        finally {
            globalThis.Function = original;
        }
        expect(calls).toBe(0);
    });
});
