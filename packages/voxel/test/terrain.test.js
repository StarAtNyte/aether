import { describe, expect, it } from 'vitest';
import { CHUNK_VOLUME, HEIGHT, LAYER, SEA_LEVEL, cellIndex } from '../src/constants';
import { VoxelJobContext, terrainIdentity } from '../src/jobs';
import { BIOMES, FLAT_HEIGHT, TerrainGenerator } from '../src/terrain';
import { id, reg, terrain } from './helpers';
function gen(seed, preset, cx, cz) {
    const out = new Uint16Array(CHUNK_VOLUME);
    new TerrainGenerator(seed, preset, reg).generate(cx, cz, out);
    return out;
}
describe('terrain generation', () => {
    it('is deterministic per seed and differs between seeds', () => {
        const a = gen(42, 'survival', 3, -2);
        const b = gen(42, 'survival', 3, -2);
        const c = gen(43, 'survival', 3, -2);
        expect(a).toEqual(b);
        expect(a).not.toEqual(c);
    });
    it('is deterministic across independent job contexts (workers)', () => {
        const t = terrain({ preset: 'survival', edits: [{ shape: 'structure', structure: 'house', at: [4, 0, 4] }] });
        const c1 = new VoxelJobContext(terrainIdentity(t, 7));
        const c2 = new VoxelJobContext(terrainIdentity(t, 7));
        for (const [x, z] of [[0, 0], [-1, 0], [0, -1]]) {
            const d1 = c1.generate(x, z).chunk.toDense(new Uint16Array(CHUNK_VOLUME));
            const d2 = c2.generate(x, z).chunk.toDense(new Uint16Array(CHUNK_VOLUME));
            expect(d1).toEqual(d2);
        }
    });
    it('puts bedrock at the bottom, a surface and plausible heights', () => {
        const g = new TerrainGenerator(99, 'survival', reg);
        const out = new Uint16Array(CHUNK_VOLUME);
        g.generate(0, 0, out);
        for (let i = 0; i < LAYER; i++)
            expect(out[i]).toBe(id('bedrock'));
        for (let x = -200; x <= 200; x += 37) {
            const h = g.height(x, x * 3);
            expect(h).toBeGreaterThanOrEqual(4);
            expect(h).toBeLessThan(HEIGHT - 4);
        }
    });
    it('produces several biomes, caves, ores, trees and water over an area', () => {
        const g = new TerrainGenerator(2024, 'survival', reg);
        const biomes = new Set();
        for (let x = -3000; x <= 3000; x += 150)
            for (let z = -3000; z <= 3000; z += 150)
                biomes.add(g.biome(x, z));
        expect(biomes.size).toBeGreaterThanOrEqual(5);
        expect([...biomes].every((b) => BIOMES.includes(b))).toBe(true);
        const counts = new Map();
        let caveAir = 0;
        const out = new Uint16Array(CHUNK_VOLUME);
        for (let cx = -3; cx <= 3; cx++) {
            for (let cz = -3; cz <= 3; cz++) {
                g.generate(cx, cz, out);
                for (let i = 0; i < CHUNK_VOLUME; i++)
                    counts.set(out[i], (counts.get(out[i]) ?? 0) + 1);
                // Air pockets well below the surface are caves.
                for (let lz = 0; lz < 16; lz += 3)
                    for (let lx = 0; lx < 16; lx += 3) {
                        const h = g.height(cx * 16 + lx, cz * 16 + lz);
                        for (let y = 5; y < h - 8; y++)
                            if (out[cellIndex(lx, y, lz)] === 0)
                                caveAir++;
                    }
            }
        }
        expect(caveAir).toBeGreaterThan(0);
        expect(counts.get(id('coal_ore')) ?? 0).toBeGreaterThan(0);
        expect(counts.get(id('iron_ore')) ?? 0).toBeGreaterThan(0);
        const wood = (counts.get(id('oak_log')) ?? 0) + (counts.get(id('birch_log')) ?? 0) + (counts.get(id('spruce_log')) ?? 0) + (counts.get(id('cactus')) ?? 0);
        expect(wood).toBeGreaterThan(0);
    });
    it('builds the flat and void presets', () => {
        const flat = gen(1, 'flat', 5, 5);
        expect(flat[cellIndex(3, FLAT_HEIGHT, 3)]).toBe(id('grass'));
        expect(flat[cellIndex(3, FLAT_HEIGHT - 1, 3)]).toBe(id('dirt'));
        expect(gen(1, 'void', 0, 0).every((v) => v === 0)).toBe(true);
    });
    it('fills oceans to sea level', () => {
        const g = new TerrainGenerator(5, 'islands', reg);
        let found = false;
        for (let x = -2000; x <= 2000 && !found; x += 40) {
            for (let z = -2000; z <= 2000 && !found; z += 40) {
                if (g.height(x, z) < SEA_LEVEL - 3) {
                    const cx = Math.floor(x / 16);
                    const cz = Math.floor(z / 16);
                    const out = new Uint16Array(CHUNK_VOLUME);
                    g.generate(cx, cz, out);
                    const lx = x - cx * 16;
                    const lz = z - cz * 16;
                    const top = out[cellIndex(lx, SEA_LEVEL - 1, lz)];
                    expect([id('water'), id('ice')]).toContain(top);
                    found = true;
                }
            }
        }
        expect(found).toBe(true);
    });
});
