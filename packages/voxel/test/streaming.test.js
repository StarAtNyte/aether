import { describe, expect, it } from 'vitest';
import { BlockRegistry } from '../src/blocks';
import { ChunkData } from '../src/chunk';
import { cellIndex, chunkKey } from '../src/constants';
import { terrainIdentity } from '../src/jobs';
import { VoxelJobPool } from '../src/pool';
import { ChunkStreamer } from '../src/streamer';
import { VoxelWorkerHandler } from '../src/worker/handler';
import { VoxelWorld } from '../src/world';
import { terrain } from './helpers';
async function settle(s, maxMs = 20000) {
    const end = Date.now() + maxMs;
    while (!s.settled) {
        if (Date.now() > end)
            throw new Error('streamer did not settle');
        s.update();
        await new Promise((r) => setTimeout(r, 1));
    }
}
function setup(identity, viewDistance = 2, pool = new VoxelJobPool({ createWorker: null })) {
    const reg = new BlockRegistry(identity.blocks);
    const world = new VoxelWorld(reg);
    pool.configure(identity, reg.size - 1);
    const meshes = new Map();
    const log = [];
    const streamer = new ChunkStreamer(world, pool, {
        onMesh: (key, _cx, _cz, mesh) => {
            if (mesh)
                meshes.set(key, mesh);
            log.push(`mesh ${key}`);
        },
        onUnload: (key) => {
            meshes.delete(key);
            log.push(`unload ${key}`);
        },
    }, { viewDistance });
    return { reg, world, pool, streamer, meshes, log };
}
describe('chunk streaming', () => {
    it('generates and meshes the view area nearest first, then settles', async () => {
        const { streamer, meshes, world, log } = setup(terrainIdentity(terrain({ preset: 'flat' }), 1), 2);
        streamer.setCenter(8, 8);
        await settle(streamer);
        expect(meshes.size).toBe(25);
        // Generated ring of view + 1 for light/AO borders.
        expect(world.chunks.size).toBe(49);
        expect(log[0]).toBe(`mesh ${chunkKey(0, 0)}`);
    });
    it('remeshes only the edited chunk (and border neighbours) after an edit', async () => {
        const { streamer, world, log, reg } = setup(terrainIdentity(terrain({ preset: 'flat' }), 1), 2);
        streamer.setCenter(8, 8);
        await settle(streamer);
        log.length = 0;
        // Interior edit that keeps light the same (opaque → opaque): just this chunk.
        world.set(8, 50, 8, reg.idOr('stone'));
        await settle(streamer);
        expect(log).toEqual([`mesh ${chunkKey(0, 0)}`]);
        log.length = 0;
        // Same on the x = 15 border: the east neighbour too (its AO and faces read our border).
        world.set(15, 50, 8, reg.idOr('stone'));
        await settle(streamer);
        expect(new Set(log)).toEqual(new Set([`mesh ${chunkKey(0, 0)}`, `mesh ${chunkKey(1, 0)}`]));
        log.length = 0;
        // A block that changes light (a torch) remeshes the whole ring, edited chunk first.
        world.set(8, 52, 8, reg.idOr('torch'));
        await settle(streamer);
        expect(log[0]).toBe(`mesh ${chunkKey(0, 0)}`);
        expect(new Set(log).size).toBe(9);
    });
    it('unloads far chunks when the centre moves (bounded memory)', async () => {
        const { streamer, world, meshes } = setup(terrainIdentity(terrain({ preset: 'flat' }), 1), 2);
        streamer.setCenter(0, 0);
        await settle(streamer);
        let peak = 0;
        for (let step = 1; step <= 6; step++) {
            streamer.setCenter(step * 16 * 4, 0);
            await settle(streamer);
            peak = Math.max(peak, world.chunks.size);
        }
        expect(peak).toBeLessThanOrEqual(81);
        expect(meshes.size).toBe(25);
    });
    it('never installs a mesh that finished after its chunk left the view (regression)', async () => {
        const { streamer, pool, meshes } = setup(terrainIdentity(terrain({ preset: 'flat' }), 1), 2);
        streamer.setCenter(8, 8);
        await settle(streamer);
        // Hold mesh results back so they finish only after the player has turned around.
        const held = [];
        const mesh = pool.mesh.bind(pool);
        pool.mesh = (...args) => {
            const p = mesh(...args);
            return new Promise((resolve) => held.push(() => void p.then(resolve)));
        };
        streamer.setCenter(8 + 16 * 2, 8);
        for (let i = 0; i < 2000 && held.length === 0; i++) {
            streamer.update();
            await new Promise((r) => setTimeout(r, 1));
        }
        expect(held.length).toBeGreaterThan(0);
        // Back home before those meshes arrive: the east columns are now outside the view (but still loaded).
        streamer.setCenter(8, 8);
        streamer.update();
        pool.mesh = mesh;
        for (const release of held.splice(0))
            release();
        await settle(streamer);
        for (let i = 0; i < 20; i++) {
            streamer.update();
            await new Promise((r) => setTimeout(r, 2));
        }
        const inView = new Set();
        for (let cz = -2; cz <= 2; cz++)
            for (let cx = -2; cx <= 2; cx++)
                inView.add(chunkKey(cx, cz));
        const outside = [...meshes.keys()].filter((k) => !inView.has(k));
        expect(outside).toEqual([]);
        expect(meshes.size).toBe(25);
        expect(streamer.settled).toBe(true);
    });
    it('drops results computed for an outdated configuration', async () => {
        const pool = new VoxelJobPool({ createWorker: null });
        const reg = new BlockRegistry();
        pool.configure(terrainIdentity(terrain({ preset: 'flat' }), 1), reg.size - 1);
        const p = pool.generate(0, 0);
        pool.configure(terrainIdentity(terrain({ preset: 'void' }), 1), reg.size - 1);
        expect(await p).toBeNull();
        const g = await pool.generate(0, 0);
        expect(g?.top).toBe(-1);
        pool.dispose();
    });
    it('runs jobs through workers and validates their replies', async () => {
        // A fake worker that runs the real handler asynchronously, plus one that replies garbage.
        const good = () => {
            const h = new VoxelWorkerHandler();
            const w = {
                onmessage: null,
                onerror: null,
                postMessage(m) {
                    setTimeout(() => {
                        const r = h.handle(m);
                        if (r)
                            w.onmessage?.({ data: r.message });
                    }, 0);
                },
                terminate() { },
            };
            return w;
        };
        const pool = new VoxelJobPool({ createWorker: good, workers: 2 });
        const reg = new BlockRegistry();
        pool.configure(terrainIdentity(terrain({ preset: 'survival' }), 3), reg.size - 1);
        const g = await pool.generate(1, 1);
        expect(g?.chunk.topY()).toBe(g?.top);
        expect(pool.stats.generated).toBe(1);
        pool.dispose();
        let created = 0;
        const evil = () => {
            created++;
            const w = {
                onmessage: null,
                onerror: null,
                postMessage(m) {
                    const id = m.id;
                    if (typeof id !== 'number')
                        return;
                    setTimeout(() => w.onmessage?.({ data: { type: 'meshed', id, key: pool2.key, mesh: { opaque: { quads: 1, positions: new Float32Array(12), uvs: new Float32Array(8), data: new Uint8Array(16), indices: new Uint16Array([0, 1, 9, 0, 1, 2]) }, cutout: null, liquid: null, minY: 0, maxY: 1 }, ms: 1 } }), 0);
                },
                terminate() { },
            };
            return w;
        };
        const pool2 = new VoxelJobPool({ createWorker: evil, workers: 1 });
        pool2.configure(terrainIdentity(terrain({ preset: 'flat' }), 3), reg.size - 1);
        await expect(pool2.mesh(0, 0, [null, null, null, null, null, null, null, null, null], [-1, -1, -1, -1, -1, -1, -1, -1, -1])).rejects.toThrow(/malformed/);
        expect(created).toBe(1);
        pool2.dispose();
    });
    it('falls back to inline jobs when workers cannot start', async () => {
        const pool = new VoxelJobPool({
            createWorker: () => {
                throw new Error('no workers here');
            },
        });
        const reg = new BlockRegistry();
        pool.configure(terrainIdentity(terrain({ preset: 'flat' }), 1), reg.size - 1);
        const g = await pool.generate(0, 0);
        expect(g?.top).toBeGreaterThan(40);
        expect(pool.inlineMode).toBe(true);
        pool.dispose();
    });
});
describe('chunk streaming throughput', () => {
    it('keeps the workers busy between frames: one update() streams the whole view', async () => {
        const { streamer } = setup(terrainIdentity(terrain({ preset: 'flat' }), 1), 2);
        streamer.setCenter(8, 8);
        // A single "frame": finished jobs schedule the next ones themselves.
        streamer.update();
        const end = Date.now() + 20_000;
        while (!streamer.settled && Date.now() < end)
            await new Promise((r) => setTimeout(r, 5));
        expect(streamer.settled).toBe(true);
        expect(streamer.meshedCount).toBe(25);
        expect(streamer.maxUpdateMs).toBeGreaterThanOrEqual(0);
    });
});
describe('chunk streaming and saves', () => {
    it('a chunk generated from the seed while the save index loaded is replaced by its saved copy', async () => {
        const identity = terrainIdentity(terrain({ preset: 'flat' }), 1);
        const reg = new BlockRegistry(identity.blocks);
        const world = new VoxelWorld(reg);
        const pool = new VoxelJobPool({ createWorker: null });
        pool.configure(identity, reg.size - 1);
        // The saved copy of chunk (0, 0): solid gold up to y = 3.
        const gold = reg.idOr('gold_block');
        const dense = new Uint16Array(16 * 16 * 128);
        for (let y = 0; y < 4; y++)
            for (let z = 0; z < 16; z++)
                for (let x = 0; x < 16; x++)
                    dense[cellIndex(x, y, z)] = gold;
        const saved = ChunkData.fromDense(dense);
        let indexKnown = false;
        const streamer = new ChunkStreamer(world, pool, { onMesh: () => undefined, onUnload: () => undefined }, {
            viewDistance: 2,
            saved: (cx, cz) => (indexKnown && cx === 0 && cz === 0 ? Promise.resolve({ chunk: saved, top: 3 }) : null),
            isSaved: (cx, cz) => indexKnown && cx === 0 && cz === 0,
        });
        streamer.setCenter(8, 8);
        streamer.update(); // (0, 0) starts generating from the seed …
        indexKnown = true; // … and the save index arrives meanwhile.
        await settle(streamer);
        expect(world.get(5, 1, 5)).toBe(gold);
        expect(world.slot(0, 0)?.modified).toBe(true);
    });
});
describe('mesh job packing', () => {
    it('packs the neighbourhood when the job is posted, copies by structured clone (no transfer) and drops the references', async () => {
        const posted = [];
        const h = new VoxelWorkerHandler();
        let w = null;
        const pool = new VoxelJobPool({
            workers: 1,
            createWorker: () => {
                const worker = {
                    onmessage: null,
                    onerror: null,
                    postMessage(m, transfer) {
                        // A real postMessage clones synchronously: snapshot the message now.
                        const message = structuredClone(m);
                        posted.push({ message, transfer });
                        setTimeout(() => {
                            const r = h.handle(message);
                            if (r)
                                worker.onmessage?.({ data: r.message });
                        }, 0);
                    },
                    terminate() { },
                };
                w = worker;
                return worker;
            },
        });
        const reg = new BlockRegistry();
        pool.configure(terrainIdentity(terrain({ preset: 'flat' }), 1), reg.size - 1);
        const stone = reg.id('stone');
        const glass = reg.id('glass');
        const centre = ChunkData.filled(stone);
        const chunks = [null, null, null, null, centre, null, null, null, null];
        // Fill the lane (IN_FLIGHT generate jobs) so the mesh job waits in the queue.
        const gens = [pool.generate(5, 5), pool.generate(6, 6)];
        const meshed = pool.mesh(0, 0, chunks, [-1, -1, -1, -1, 127, -1, -1, -1, -1]);
        chunks[4] = null; // the caller reuses its array: the pool keeps its own copy
        // Changed while queued: the job sends the chunk as it is when posted.
        centre.set(cellIndex(3, 127, 3), glass);
        await Promise.all(gens);
        const mesh = await meshed;
        expect(mesh).not.toBeNull();
        const sent = posted.map((p) => p.message).find((m) => m.type === 'mesh');
        expect(sent?.chunks?.[4]?.palette).toContain(glass);
        // Nothing was transferred: the main thread's chunk is intact.
        expect(posted.filter((p) => p.message.type === 'mesh').every((p) => p.transfer === undefined || (Array.isArray(p.transfer) && p.transfer.length === 0))).toBe(true);
        expect(centre.get(cellIndex(0, 0, 0))).toBe(stone);
        expect(centre.get(cellIndex(3, 127, 3))).toBe(glass);
        expect(w).not.toBeNull();
        pool.dispose();
    });
});
