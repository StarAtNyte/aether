/**
 * VoxelSession against a fake renderer / voxel layer and a fake save store
 * (Node has no WebGL or IndexedDB; the worker pool runs its jobs inline).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { cellIndex, encodeChunk, VoxelJobContext, terrainIdentity, CHUNK } from '@aether/voxel';
import { MemoryVoxelStore } from '../src/voxel/saveStore';
let store;
vi.mock('../src/voxel/saveStore', async (importOriginal) => {
    const mod = await importOriginal();
    return { ...mod, voxelSaveStore: () => Promise.resolve(store) };
});
// Imported after the mock is declared (vi.mock is hoisted).
const { VoxelSession } = await import('../src/voxel/session');
/** A store whose chunk index arrives late (a slow IndexedDB open). */
class SlowStore extends MemoryVoxelStore {
    listDelayMs = 0;
    async listChunks(save) {
        await new Promise((r) => setTimeout(r, this.listDelayMs));
        return super.listChunks(save);
    }
}
function fakeRenderer(cap = 8) {
    const chunks = new Map();
    const installs = [];
    const layer = {
        chunks,
        installs,
        compiling: false,
        setAtlas: () => undefined,
        setWaterLevel: () => undefined,
        setBlockMaterials: () => undefined,
        setCompiler: () => undefined,
        setChunk: (key, _cx, _cz, mesh) => {
            if (mesh) {
                chunks.set(key, mesh);
                installs.push(key);
            }
            else
                chunks.delete(key);
        },
        hasChunk: (key) => chunks.has(key),
        removeChunk: (key) => chunks.delete(key),
        clearChunks: () => chunks.clear(),
        setLighting: () => undefined,
        setFogOrigin: () => undefined,
        clearActors: () => undefined,
        stats: () => ({ chunks: chunks.size, triangles: 0, mobs: 0, drops: 0 }),
    };
    const fog = [];
    // Anything else the play session calls on the renderer or the layer is a no-op.
    const loose = (o) => new Proxy(o, { get: (t, k) => (k in t ? t[k] : k === 'then' ? undefined : () => undefined) });
    const renderer = {
        camera: { matrixWorld: { elements: new Array(16).fill(0) } },
        voxel: () => Promise.resolve(loose(layer)),
        voxelViewDistanceCap: cap,
        setFogDistance: (m) => fog.push(m ?? -1),
        orbitTarget: (out) => {
            out[0] = 8;
            out[1] = 0;
            out[2] = 8;
            return out;
        },
        releaseVoxel: () => undefined,
    };
    return { renderer: loose(renderer), layer, fog };
}
const host = { onHud: () => undefined, sound: () => undefined, error: () => undefined, saveBase: 'test-project' };
function voxelWorld(viewDistance = 2) {
    const r = applyPatches(createWorld({ seed: 11 }), [{ op: 'setVoxel', set: { preset: 'flat', viewDistance } }]);
    if (r.errors.length > 0 || !r.world.voxel)
        throw new Error(`voxel world: ${JSON.stringify(r.errors)}`);
    return r.world;
}
/** Run frames until the session settles. */
async function settle(s, maxMs = 20_000) {
    const end = Date.now() + maxMs;
    while (!s.settled || s.status().meshed === 0) {
        if (Date.now() > end)
            throw new Error(`did not settle: ${JSON.stringify(s.status())}`);
        s.frame(1 / 60);
        await new Promise((r) => setTimeout(r, 2));
    }
}
beforeEach(() => {
    store = new SlowStore();
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(performance.now()), 4));
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
describe('VoxelSession', () => {
    it('loads saved chunks even when the save index arrives after streaming could start', async () => {
        const doc = voxelWorld(2);
        const t = doc.voxel;
        if (!t)
            throw new Error('no terrain');
        // The player's save: chunk (0, 0) with a gold block at (3, 40, 3).
        const ctx = new VoxelJobContext(terrainIdentity(t, doc.seed));
        const gen = ctx.generate(0, 0);
        const gold = ctx.reg.id('gold_block');
        gen.chunk.set(cellIndex(3, 40, 3), gold);
        const saveKey = `test-project::${t.preset}:${t.seed ?? doc.seed}:${t.border}`;
        await store.putChunks(saveKey, [{ cx: 0, cz: 0, bytes: await encodeChunk({ cx: 0, cz: 0, top: 64, data: gen.chunk }) }]);
        store.listDelayMs = 150;
        const { renderer } = fakeRenderer();
        const s = new VoxelSession(renderer, host);
        const syncing = s.sync(doc);
        // Frames keep coming while the index loads: nothing may be generated from the seed yet.
        for (let i = 0; i < 20; i++) {
            s.frame(1 / 60);
            await new Promise((r) => setTimeout(r, 5));
        }
        await syncing;
        await settle(s);
        expect(s.blockAt(3, 40, 3)).toBe('gold_block');
        expect(s.status().changed).toBeGreaterThan(0);
        s.dispose();
    });
    it('finishes loading the play session while the game is held back by a start card', async () => {
        const doc = voxelWorld(2);
        const { renderer } = fakeRenderer();
        const s = new VoxelSession(renderer, host);
        await s.sync(doc);
        const target = { addEventListener: () => undefined, removeEventListener: () => undefined, requestPointerLock: () => undefined, focus: () => undefined };
        vi.stubGlobal('HTMLElement', class {
        });
        vi.stubGlobal('HTMLInputElement', class {
        });
        vi.stubGlobal('window', target);
        vi.stubGlobal('document', { ...target, pointerLockElement: null, exitPointerLock: () => undefined });
        const play = await s.startPlay(doc, target);
        expect(play).not.toBeNull();
        expect(s.loadingPlay).toBe(true);
        // Only frames run (the fixed step is paused behind the card): the terrain around the spawn still completes the load.
        const end = Date.now() + 20_000;
        while (s.loadingPlay) {
            if (Date.now() > end)
                throw new Error(`still loading: ${JSON.stringify(s.status())}`);
            s.frame(1 / 60);
            await new Promise((r) => setTimeout(r, 2));
        }
        expect(s.loadingPlay).toBe(false);
        s.dispose();
    });
    it('caps the view distance by the device budget and sets fog before the terrain streams', async () => {
        const doc = voxelWorld(12);
        const { renderer, fog } = fakeRenderer(4);
        const s = new VoxelSession(renderer, host);
        await s.sync(doc);
        expect(s.status().view).toBe(4);
        expect(fog[0]).toBe(4 * CHUNK);
        s.dispose();
    });
    it('hands newly streamed chunk meshes to the GPU a few per frame, edits at once', async () => {
        const doc = voxelWorld(3);
        const { renderer, layer } = fakeRenderer();
        const s = new VoxelSession(renderer, host);
        await s.sync(doc);
        let maxPerFrame = 0;
        const end = Date.now() + 20_000;
        while (!s.settled || layer.chunks.size === 0) {
            if (Date.now() > end)
                throw new Error('did not settle');
            const before = layer.installs.length;
            s.frame(1 / 60);
            maxPerFrame = Math.max(maxPerFrame, layer.installs.length - before);
            await new Promise((r) => setTimeout(r, 2));
        }
        expect(layer.chunks.size).toBe(49);
        expect(maxPerFrame).toBeLessThanOrEqual(4);
        // An edit replaces an installed mesh without waiting for a frame's upload slot.
        const r = await s.measureEdit(4, 30, 4, 'stone');
        expect(r.mesh).toBeGreaterThanOrEqual(0);
        s.dispose();
    });
});
