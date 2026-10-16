/**
 * Studio side of the asset pipeline: drop placement (surfaces, walls,
 * ceilings, ground), favourites, the ZIP reader/writer (untrusted archives),
 * the import store, and the asset controller (placement edits, imports,
 * package export → import round trip).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { History, createWorld } from '@aether/core';
import { assetInfo, loadCatalog, setCatalog, unregisterUserAsset, userAssets } from '@aether/assets';
import { groundPoint, placeAsset, yawToward } from '../src/assets/placement';
import { FAVORITES_KEY, MAX_FAVORITES, readFavorites, toggleFavorite } from '../src/assets/favorites';
import { crc32, readZip, safeEntryName, writeZip } from '../src/assets/zip';
import { MAX_USER_ASSETS, MemoryAssetStore, reviveMeta } from '../src/assets/userStore';
import { AssetController } from '../src/engine/assets';
import { createStudioStore } from '../src/state/store';
import { triangleGlb, pngHeader } from '../../../packages/assets/test/fixtures';
class MemStorage {
    map = new Map();
    getItem(k) {
        return this.map.get(k) ?? null;
    }
    setItem(k, v) {
        this.map.set(k, v);
    }
    removeItem(k) {
        this.map.delete(k);
    }
}
const chair = { size: [0.6, 1, 0.6], placement: 'floor', facing: '+z' };
describe('drop placement', () => {
    it('stands floor items on the surface under the cursor, facing the camera', () => {
        const p = placeAsset({ hit: { point: [2, 0.75, -1], normal: [0, 1, 0] }, ray: { origin: [2, 5, 5], direction: [0, -0.7, -0.7] }, camera: [2, 5, 5], asset: chair });
        expect(p).toEqual({ position: [2, 0.75, -1], yaw: 0, snapped: 'surface' });
        // Movers face −Z: turned around to look at the camera.
        expect(placeAsset({ hit: { point: [0, 0, 0], normal: [0, 1, 0] }, ray: { origin: [0, 5, 5], direction: [0, -1, 0] }, camera: [0, 5, 5], asset: { ...chair, facing: '-z' } }).yaw).toBe(180);
    });
    it('pushes floor items against a wall, back to the wall, on the floor below', () => {
        const p = placeAsset({ hit: { point: [3, 1.2, 0], normal: [-1, 0, 0] }, ray: { origin: [0, 1.6, 0], direction: [1, 0, 0] }, camera: [0, 1.6, 0], asset: chair, floorAt: () => 0.1 });
        expect(p.snapped).toBe('wall');
        expect(p.position).toEqual([2.68, 0.1, 0]);
        expect(p.yaw).toBe(-90);
    });
    it('hangs wall items on the wall, centred on the cursor', () => {
        const p = placeAsset({ hit: { point: [0, 2, -4], normal: [0, 0, 1] }, ray: { origin: [0, 1.6, 0], direction: [0, 0, -1] }, camera: [0, 1.6, 0], asset: { size: [0.5, 0.4, 0.1], placement: 'wall', facing: '+z' } });
        expect(p).toEqual({ position: [0, 1.8, -3.93], yaw: 0, snapped: 'wall' });
    });
    it('ceiling items hang under the ceiling; floor items dropped on a ceiling fall to the floor', () => {
        const lamp = placeAsset({ hit: { point: [1, 3, 1], normal: [0, -1, 0] }, ray: { origin: [0, 1, 0], direction: [0, 1, 0] }, camera: [0, 1, 0], asset: { size: [0.4, 0.9, 0.4], placement: 'ceiling', facing: '+z' } });
        expect(lamp.position).toEqual([1, 2.1, 1]);
        expect(lamp.snapped).toBe('ceiling');
        expect(placeAsset({ hit: { point: [1, 3, 1], normal: [0, -1, 0] }, ray: { origin: [0, 1, 0], direction: [0, 1, 0] }, camera: [0, 1, 0], asset: chair }).position[1]).toBe(0);
    });
    it('falls back to the ground plane (or a point ahead when looking at the sky)', () => {
        expect(groundPoint({ origin: [0, 10, 0], direction: [0, -1, 0] })).toEqual([0, 0, 0]);
        expect(groundPoint({ origin: [0, 10, 0], direction: [1, 0, 0] })).toEqual([10, 0, 0]);
        expect(placeAsset({ hit: null, ray: { origin: [0, 2, 10], direction: [0, -0.2, -1] }, camera: [0, 2, 10], asset: chair }).snapped).toBe('ground');
    });
    it('snaps yaw to 15° steps', () => {
        expect(yawToward(1, 1, '+z')).toBe(45);
        expect(yawToward(0.2, 1, '+z')).toBe(15);
        expect(yawToward(0, 0, '+z')).toBe(0);
    });
});
describe('favourites', () => {
    it('toggles, persists and re-validates on read', () => {
        const s = new MemStorage();
        let fav = toggleFavorite(s, [], 'sofa');
        fav = toggleFavorite(s, fav, 'oak-tree');
        expect(readFavorites(s)).toEqual(['oak-tree', 'sofa']);
        fav = toggleFavorite(s, fav, 'sofa');
        expect(readFavorites(s)).toEqual(['oak-tree']);
        expect(toggleFavorite(s, fav, '__proto__')).toEqual(['oak-tree']);
        s.setItem(FAVORITES_KEY, JSON.stringify(['ok', 5, '<script>', 'ok', ...Array.from({ length: 500 }, (_, i) => `a${i}`)]));
        const read = readFavorites(s);
        expect(read[0]).toBe('ok');
        expect(read.length).toBe(MAX_FAVORITES);
        s.setItem(FAVORITES_KEY, '{bad');
        expect(readFavorites(s)).toEqual([]);
    });
});
describe('zip', () => {
    it('round-trips files (deflate and store) with checksums', async () => {
        const files = [
            { name: 'world.aether.json', data: new TextEncoder().encode('{"a":1}'.repeat(100)) },
            { name: 'assets/lib/m/x.00000000.glb', data: new Uint8Array([1, 2, 3]) },
        ];
        for (const compress of [true, false]) {
            const zip = await writeZip(files, { compress });
            const r = await readZip(zip);
            expect(r.ok).toBe(true);
            if (r.ok)
                expect(r.entries.map((e) => [e.name, [...e.data].length])).toEqual(files.map((f) => [f.name, f.data.length]));
        }
        expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    });
    it('refuses unsafe names, corruption and bombs', async () => {
        expect(safeEntryName('../evil')).toBe(false);
        expect(safeEntryName('/abs')).toBe(false);
        expect(safeEntryName('a\\b')).toBe(false);
        expect(safeEntryName('ok/x.txt')).toBe(true);
        // Windows devices and names Windows would silently alias (trailing dot / space).
        for (const bad of ['aux.json', 'assets/CON', 'nul.txt', 'com1.glb', 'lpt9', 'x/conout$.js', 'game.json.', 'a /b.txt'])
            expect(safeEntryName(bad), bad).toBe(false);
        for (const good of ['.nojekyll', 'console.json', 'auxiliary.txt', 'com10.txt', 'assets/con-x.js'])
            expect(safeEntryName(good), good).toBe(true);
        await expect(writeZip([{ name: '../x', data: new Uint8Array(1) }])).rejects.toThrow();
        const zip = await writeZip([{ name: 'a.txt', data: new TextEncoder().encode('hello hello hello hello') }], { compress: false });
        const corrupt = zip.slice();
        corrupt[35] = (corrupt[35] ?? 0) ^ 0xff;
        expect(await readZip(corrupt)).toMatchObject({ ok: false });
        expect(await readZip(new Uint8Array(100))).toMatchObject({ ok: false, error: 'not a ZIP archive' });
        // A highly compressible 2 MB payload: the declared size is checked before inflating.
        const big = await writeZip([{ name: 'big.bin', data: new Uint8Array(2 * 1024 * 1024) }]);
        expect(big.byteLength).toBeLessThan(64 * 1024);
        expect(await readZip(big, { maxEntryBytes: 1024 * 1024 })).toMatchObject({ ok: false, error: expect.stringContaining('too large') });
        expect(await readZip(big, { maxTotalBytes: 1024 })).toMatchObject({ ok: false });
        const many = await writeZip(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}`, data: new Uint8Array(1) })));
        expect(await readZip(many, { maxEntries: 4 })).toMatchObject({ ok: false, error: expect.stringContaining('too many') });
    });
});
describe('import store', () => {
    it('enforces count and byte budgets; revives only valid metadata', async () => {
        const store = new MemoryAssetStore();
        const meta = (i) => ({ id: `user-${i.toString(16).padStart(12, '0')}`, kind: 'image', name: `i${i}`, mime: 'image/png', bytes: 10, width: 1, height: 1, createdAt: i });
        for (let i = 0; i < MAX_USER_ASSETS; i++)
            await store.put(meta(i), new Uint8Array(10));
        await expect(store.put(meta(MAX_USER_ASSETS), new Uint8Array(10))).rejects.toThrow(/up to/);
        await store.put(meta(3), new Uint8Array(10)); // re-putting an existing id is fine
        expect((await store.list())[0]?.createdAt).toBe(MAX_USER_ASSETS - 1);
        expect(reviveMeta({ ...meta(1), id: '../x' })).toBeNull();
        expect(reviveMeta({ ...meta(1), bytes: -1 })).toBeNull();
        expect(reviveMeta(meta(1))).not.toBeNull();
    });
});
function host() {
    const history = new History(createWorld());
    const store = createStudioStore();
    return {
        store,
        history,
        simulation: null,
        onSimulation: () => () => undefined,
        commitUser: (patches, message) => {
            const r = history.commit(patches, message, 'user');
            return r.errors.length > 0 ? r.errors[0].message : null;
        },
        replaceWorld: (world, message) => {
            history.commit([{ op: 'clear' }, ...Object.values(world.entities).map((entity) => ({ op: 'add', entity })), { op: 'setEnvironment', set: world.environment }], message, 'user');
        },
    };
}
describe('asset controller', () => {
    beforeEach(async () => {
        setCatalog(null);
        await loadCatalog();
    });
    afterEach(() => {
        for (const u of userAssets())
            unregisterUserAsset(u.meta.id);
        vi.unstubAllGlobals();
    });
    it('skies set the environment; unknown ids are refused', async () => {
        const h = host();
        const c = new AssetController(h, { storage: null });
        expect(await c.place('sky-venice-sunset')).toBeNull();
        expect(h.history.current.environment.hdri).toBe('sky-venice-sunset');
        expect(await c.place('no-such-asset')).toBeNull();
        c.dispose();
    });
    it('imports files (validated, stored, registered) and refuses junk', async () => {
        const h = host();
        const c = new AssetController(h, { storage: null });
        const glb = new File([triangleGlb()], 'Chair.glb');
        const png = new File([pngHeader(64, 32)], 'poster.png');
        const junk = new File([new Uint8Array([1, 2, 3])], 'evil.exe');
        await c.importFiles([glb, png, junk]);
        const imports = c.state.getState().imports;
        expect(imports.map((m) => m.kind).sort()).toEqual(['image', 'model']);
        for (const m of imports)
            expect(assetInfo(m.id)?.url).toMatch(/^blob:/);
        await c.removeImport(imports[0].id);
        expect(c.state.getState().imports).toHaveLength(1);
        expect(assetInfo(imports[0].id)).toBeNull();
        c.dispose();
    });
    it('exports a package with the world, its files and credits, and imports it back', async () => {
        const h = host();
        h.history.commit([{ op: 'add', entity: { id: 'couch', shape: { kind: 'asset', id: 'sofa' } } }, { op: 'setEnvironment', set: { hdri: 'sky-venice-sunset' } }], 'setup', 'user');
        const fetched = [];
        vi.stubGlobal('fetch', async (url) => {
            fetched.push(url);
            return new Response(new Uint8Array([7, 7, 7]));
        });
        const c = new AssetController(h, { storage: null });
        const pkg = await c.buildPackage();
        expect(pkg.name).toMatch(/\.aether\.zip$/);
        const zip = await readZip(pkg.bytes);
        expect(zip.ok).toBe(true);
        if (!zip.ok)
            return;
        const names = zip.entries.map((e) => e.name);
        expect(names).toContain('world.aether.json');
        expect(names).toContain('CREDITS.txt');
        expect(names.some((n) => /^assets\/lib\/m\/sofa\.[0-9a-f]{8}\.glb$/.test(n))).toBe(true);
        expect(names.some((n) => /^assets\/lib\/h\/sky-venice-sunset\./.test(n))).toBe(true);
        const credits = new TextDecoder().decode(zip.entries.find((e) => e.name === 'CREDITS.txt').data);
        expect(credits).toContain('Kenney');
        expect(credits).toContain('Poly Haven');
        expect(fetched.every((u) => u.startsWith('/assets/lib/'))).toBe(true);
        const h2 = host();
        const c2 = new AssetController(h2, { storage: null });
        const err = await c2.importPackage(new File([pkg.bytes], pkg.name));
        expect(err).toBeNull();
        expect(h2.history.current.entities['couch']?.shape).toMatchObject({ kind: 'asset', id: 'sofa' });
        expect(await c2.importPackage(new File([new Uint8Array(10)], 'x.zip'))).toContain('rejected');
        c.dispose();
        c2.dispose();
    });
});
