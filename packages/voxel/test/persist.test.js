import { describe, expect, it } from 'vitest';
import { ChunkData } from '../src/chunk';
import { CHUNK_VOLUME, cellIndex } from '../src/constants';
import { decodeChunk, decodeSave, decodeSaveRaw, encodeChunk, encodeSave, encodeSaveRaw, SaveFormatError } from '../src/persist';
import { id, reg } from './helpers';
function sample() {
    const dense = new Uint16Array(CHUNK_VOLUME).fill(id('stone'), 0, 40 * 256);
    const a = ChunkData.fromDense(dense);
    a.set(cellIndex(3, 41, 3), id('torch'));
    const b = ChunkData.filled(0);
    b.set(cellIndex(0, 0, 0), id('glass'));
    return {
        meta: {
            terrain: 'survival:1:0', savedAt: 1700000000000,
            player: { position: [1, 60, 2], yaw: 0.5, pitch: -0.2, health: 17, hunger: 12, slots: [{ item: 'stone', count: 5 }, null], selected: 0, hour: 13.5, day: 2, spawn: [0, 60, 0] },
        },
        chunks: [{ cx: 0, cz: 0, top: 41, data: a }, { cx: -5, cz: 9, top: 0, data: b }],
    };
}
describe('voxel saves', () => {
    it('round-trips chunks and player state (compressed)', async () => {
        const s = sample();
        const bytes = await encodeSave(s);
        const back = await decodeSave(bytes, reg.size - 1);
        expect(back.meta).toEqual(s.meta);
        expect(back.chunks.map((c) => [c.cx, c.cz, c.top])).toEqual([[0, 0, 41], [-5, 9, 0]]);
        expect(back.chunks[0]?.data.get(cellIndex(3, 41, 3))).toBe(id('torch'));
        // Compression pays off for terrain.
        expect(bytes.length).toBeLessThan(encodeSaveRaw(s).length / 4);
    });
    it('round-trips single chunk records', async () => {
        const c = sample().chunks[0];
        if (!c)
            throw new Error('no chunk');
        const back = await decodeChunk(await encodeChunk(c), reg.size - 1);
        expect(back.data.toDense(new Uint16Array(CHUNK_VOLUME))).toEqual(c.data.toDense(new Uint16Array(CHUNK_VOLUME)));
    });
    it('rejects malformed, truncated and hostile input', async () => {
        const raw = encodeSaveRaw(sample());
        expect(() => decodeSaveRaw(raw.slice(0, raw.length - 3), reg.size - 1)).toThrow(SaveFormatError);
        expect(() => decodeSaveRaw(new Uint8Array([1, 2, 3, 4, 5, 6]), reg.size - 1)).toThrow(SaveFormatError);
        // Block ids beyond the registry.
        expect(() => decodeSaveRaw(raw, 2)).toThrow(SaveFormatError);
        // Chunk count claims far more than allowed.
        const bad = raw.slice();
        const view = new DataView(bad.buffer);
        const metaLen = view.getUint32(6, true);
        view.setUint32(10 + metaLen, 1e9, true);
        expect(() => decodeSaveRaw(bad, reg.size - 1)).toThrow(/too many chunks/);
        // Corrupt deflate stream.
        await expect(decodeSave(new Uint8Array([1, 9, 9, 9, 9, 9, 9]), reg.size - 1)).rejects.toThrow(SaveFormatError);
        await expect(decodeSave(new Uint8Array([7, 0]), reg.size - 1)).rejects.toThrow(SaveFormatError);
    });
    it('caps decompressed size (zip bombs)', async () => {
        // 200 MB of zeros deflates to ~200 KB.
        const zeros = new Uint8Array(1024 * 1024);
        const cs = new CompressionStream('deflate-raw');
        const writer = cs.writable.getWriter();
        void (async () => {
            for (let i = 0; i < 200; i++)
                await writer.write(zeros);
            await writer.close();
        })();
        const parts = [];
        const reader = cs.readable.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            parts.push(value);
        }
        const total = parts.reduce((n, p) => n + p.length, 0);
        const bomb = new Uint8Array(total + 1);
        bomb[0] = 1;
        let o = 1;
        for (const p of parts) {
            bomb.set(p, o);
            o += p.length;
        }
        await expect(decodeSave(bomb, reg.size - 1)).rejects.toThrow(/too large/);
    }, 30000);
});
