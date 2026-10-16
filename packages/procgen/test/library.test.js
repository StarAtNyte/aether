import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createNodeSandbox } from '../src/node';
import { GENERATOR_EXAMPLES, GENERATOR_LIBRARY, catalog, checkSilhouette, isLibraryGenerator, loadLibraryGenerator, matchLibrary, silhouette } from '../src/index';
import { LIBRARY_SPECS } from '../src/library-specs';
import { LibraryFileSchema, acceptLibraryGenerator, renderLibraryIndex, serializeLibraryFile } from '../src/library-tools';
const LIBRARY_DIR = fileURLToPath(new URL('../library/', import.meta.url));
const def = (source, id = 'test-gen') => ({ id, description: 'test', params: {}, source });
const sandbox = createNodeSandbox();
describe('library specs', () => {
    it('have unique ids that never shadow a built-in generator or each other', () => {
        const builtin = new Set(catalog().map((g) => g.id));
        const ids = LIBRARY_SPECS.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids)
            expect(builtin.has(id), id).toBe(false);
    });
    it('use lower-case whole-word keywords without ambiguous everyday words', () => {
        for (const s of LIBRARY_SPECS) {
            for (const k of s.keywords)
                expect(k, s.id).toMatch(/^[a-z]+( [a-z]+){0,2}$/);
            for (const banned of ['well', 'slide', 'swing', 'falls', 'tank', 'cone'])
                expect(s.keywords, s.id).not.toContain(banned);
        }
    });
});
describe('acceptLibraryGenerator', () => {
    it('accepts every reviewed example and measures its size', async () => {
        for (const ex of GENERATOR_EXAMPLES) {
            const r = await acceptLibraryGenerator(ex.def, sandbox);
            expect(r.ok, ex.def.id).toBe(true);
            if (r.ok) {
                expect(r.size.every((v) => v > 0)).toBe(true);
                expect(r.colliders).toBeGreaterThan(0);
            }
        }
    });
    it('rejects forbidden source before running it', async () => {
        const r = await acceptLibraryGenerator(def('fetch("/x"); return api.build();'), sandbox);
        expect(r).toMatchObject({ ok: false });
        if (!r.ok)
            expect(r.error).toMatch(/source rejected/);
    });
    it('rejects a lone box and absurd sizes with repair-ready messages, accepts a simple composite (colliders added by default)', async () => {
        const box = await acceptLibraryGenerator(def("api.add(api.box(1, 1, 1).translate(0, 0.5, 0), { color: '#888888' }); api.autoColliders('box'); return api.build();"), sandbox);
        expect(box.ok).toBe(false);
        if (!box.ok)
            expect(box.error).toMatch(/single box/);
        const huge = await acceptLibraryGenerator(def("api.add(api.sphere(200, 12).translate(0, 200, 0), { color: '#888888' }); api.autoColliders('box'); return api.build();"), sandbox);
        expect(huge.ok).toBe(false);
        if (!huge.ok)
            expect(huge.error).toMatch(/implausible size/);
        const ok = await acceptLibraryGenerator(def("api.add(api.sphere(1, 12).translate(0, 1, 0), { color: '#888888' }); api.add(api.cone(0.5, 1, 8).translate(0, 2.4, 0), { color: '#335533' }); return api.build();"), sandbox);
        expect(ok.ok).toBe(true);
        if (ok.ok)
            expect(ok.colliders).toBeGreaterThan(0);
    });
    it('reports runtime errors with the failing seed', async () => {
        const r = await acceptLibraryGenerator(def('if (params) throw new Error("boom"); return api.build();'), sandbox);
        expect(r.ok).toBe(false);
        if (!r.ok)
            expect(r.error).toMatch(/run failed \(seed 1\).*boom/);
    });
});
describe('silhouette', () => {
    it('fills more of the front view for a tall tower than of the top view', async () => {
        const ex = GENERATOR_EXAMPLES.find((e) => e.def.id === 'lighthouse');
        const out = await sandbox.run(ex.def, {}, 1);
        const front = silhouette(out, 'front');
        const top = silhouette(out, 'top');
        expect(front.aspect).toBeGreaterThan(2);
        expect(front.coverage).toBeGreaterThan(0.05);
        expect(top.coverage).toBeGreaterThan(0.02);
        expect(checkSilhouette(out).ok).toBe(true);
    });
});
describe('library index and files', () => {
    it('renders a sorted, lazy index and refuses duplicates', () => {
        const entry = { id: 'b-thing', description: 'b', category: 'props', keywords: ['thing'], params: {}, size: [1, 1, 1] };
        const src = renderLibraryIndex([entry, { ...entry, id: 'a-thing' }]);
        expect(src.indexOf("'a-thing'")).toBeLessThan(src.indexOf("'b-thing'"));
        expect(src).toContain("import('../library/a-thing.json')");
        expect(() => renderLibraryIndex([entry, entry])).toThrow(/duplicate/);
        expect(() => renderLibraryIndex([{ ...entry, id: "x'); evil('" }])).toThrow();
    });
    it('ships only valid files whose catalog entry matches the generated index', () => {
        const files = readdirSync(LIBRARY_DIR).filter((n) => n.endsWith('.json'));
        expect(files.length).toBe(GENERATOR_LIBRARY.length);
        const builtin = new Set(catalog().map((g) => g.id));
        for (const name of files) {
            const parsed = LibraryFileSchema.safeParse(JSON.parse(readFileSync(`${LIBRARY_DIR}${name}`, 'utf8')));
            expect(parsed.success, name).toBe(true);
            const file = parsed.data;
            expect(`${file.entry.id}.json`).toBe(name);
            expect(file.def.id).toBe(file.entry.id);
            expect(builtin.has(file.entry.id)).toBe(false);
            expect(GENERATOR_LIBRARY.find((e) => e.id === file.entry.id)).toEqual(file.entry);
            expect(serializeLibraryFile(file)).toBe(readFileSync(`${LIBRARY_DIR}${name}`, 'utf8'));
        }
    });
    it('every shipped generator still passes the acceptance check', async () => {
        for (const entry of GENERATOR_LIBRARY) {
            const loaded = await loadLibraryGenerator(entry.id);
            expect(loaded, entry.id).not.toBeNull();
            const r = await acceptLibraryGenerator(loaded, sandbox);
            expect(r.ok, `${entry.id}: ${r.ok ? '' : r.error}`).toBe(true);
        }
    }, 120_000);
});
describe('library lookup', () => {
    it('matches keywords as whole words, plural-insensitive, and loads lazily', async () => {
        expect(matchLibrary('three tall lighthouses on a cliff').map((e) => e.id)).toEqual(['lighthouse']);
        expect(matchLibrary('a lighthousekeeper')).toEqual([]);
        expect(matchLibrary('a fountain, a rocket and a bookcase', 2).map((e) => e.id)).toEqual(['fountain', 'rocket']);
        expect(isLibraryGenerator('rocket')).toBe(true);
        expect(isLibraryGenerator('__proto__')).toBe(false);
        expect(await loadLibraryGenerator('__proto__')).toBeNull();
        expect(await loadLibraryGenerator('constructor')).toBeNull();
        const rocket = await loadLibraryGenerator('rocket');
        expect(rocket?.id).toBe('rocket');
        expect(await loadLibraryGenerator('rocket')).toBe(rocket);
    });
});
