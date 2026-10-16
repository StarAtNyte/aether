import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { exportFileName, exportWorld, parseWorldImport, utf8Length, validateImportedValue } from '../src/lib/worldIO';
describe('world import/export', () => {
    const world = createWorld({ name: 'Cozy Camp!', entities: { box: { id: 'box', shape: { kind: 'primitive', primitive: 'box' } } } });
    it('round-trips through the export envelope', () => {
        const r = parseWorldImport(exportWorld(world));
        expect(r.ok).toBe(true);
        if (r.ok)
            expect(r.world).toEqual(world);
    });
    it('accepts a bare world document', () => {
        const r = parseWorldImport(JSON.stringify({ name: 'Bare' }));
        expect(r.ok && r.world.name).toBe('Bare');
    });
    it('rejects empty, invalid JSON and non-objects', () => {
        expect(parseWorldImport('').ok).toBe(false);
        expect(parseWorldImport('{nope').ok).toBe(false);
        const arr = parseWorldImport('[1,2]');
        expect(arr.ok).toBe(false);
        expect(parseWorldImport('"str"').ok).toBe(false);
    });
    it('rejects schema violations with readable issues', () => {
        const r = parseWorldImport(JSON.stringify({ entities: { 'Bad Id': { id: 'Bad Id' } } }));
        expect(r.ok).toBe(false);
        if (!r.ok)
            expect(r.error).toMatch(/Invalid world/);
    });
    it('rejects prototype pollution keys', () => {
        const r = parseWorldImport('{"name":"x","__proto__":{"polluted":true}}');
        expect(r.ok).toBe(false);
        expect({}['polluted']).toBeUndefined();
        const nested = parseWorldImport('{"format":"aether-world","world":{"state":{"constructor":{"prototype":{"x":1}}}}}');
        expect(nested.ok).toBe(false);
    });
    it('enforces the size limit before parsing', () => {
        const big = JSON.stringify({ name: 'x'.repeat(2000) });
        const r = parseWorldImport(big, 1000);
        expect(r.ok).toBe(false);
        if (!r.ok)
            expect(r.error).toMatch(/too large/);
    });
    it('counts UTF-8 bytes correctly', () => {
        expect(utf8Length('abc')).toBe(3);
        expect(utf8Length('é')).toBe(2);
        expect(utf8Length('€')).toBe(3);
        expect(utf8Length('😀')).toBe(4);
    });
    it('builds safe file names', () => {
        expect(exportFileName(world)).toBe('cozy-camp.aether.json');
        expect(exportFileName({ ...world, name: '../../etc/passwd' })).toBe('etc-passwd.aether.json');
        expect(exportFileName({ ...world, name: '***' })).toBe('world.aether.json');
    });
    it('validates already-parsed values', () => {
        expect(validateImportedValue(null).ok).toBe(false);
        expect(validateImportedValue({ format: 'aether-world', world: { name: 'ok' } }).ok).toBe(true);
    });
});
describe('import rejects non-world JSON', () => {
    it('refuses an object with no world fields instead of making an empty world', () => {
        expect(parseWorldImport('{"hello":"world"}').ok).toBe(false);
        expect(parseWorldImport('{}').ok).toBe(false);
    });
    it('still accepts a bare world and a minimal one with entities', () => {
        expect(parseWorldImport('{"entities":{}}').ok).toBe(true);
    });
});
