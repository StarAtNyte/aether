import { describe, expect, it } from 'vitest';
import { ChunkData } from '../src/chunk';
import { CHUNK_VOLUME, cellIndex } from '../src/constants';
import { LightVolume, REGION, regionIndex } from '../src/light';
import { ChunkMesher, HEIGHTS_LENGTH, LIQUID_SURFACE } from '../src/mesher';
import { VoxelJobContext, terrainIdentity } from '../src/jobs';
import { checkMesh } from '../src/protocol';
import { id, reg, terrain } from './helpers';
/** Region with a stone floor at y = 0 (whole 48 × 48) plus `extra` cells in centre-chunk local coords. */
function region(extra, floor = true) {
    const v = new LightVolume();
    v.blocks.fill(0);
    if (floor)
        for (let z = 0; z < REGION; z++)
            for (let x = 0; x < REGION; x++)
                v.blocks[regionIndex(x, 0, z)] = id('stone');
    let top = floor ? 0 : -1;
    for (const [x, y, z, name] of extra) {
        v.blocks[regionIndex(x + 16, y, z + 16)] = id(name);
        top = Math.max(top, y);
    }
    v.top = top;
    v.compute(reg, true);
    return v;
}
function quads(m) {
    return (m.opaque?.quads ?? 0) + (m.cutout?.quads ?? 0) + (m.liquid?.quads ?? 0);
}
function aoOf(p) {
    const out = [];
    for (let v = 0; v < p.quads * 4; v++)
        out.push(p.data[v * 4 + 1] / 85);
    return out;
}
describe('light propagation', () => {
    it('fills open air with full sky light and darkens under a roof', () => {
        const v = region([]);
        expect(v.sky[regionIndex(20, 5, 20)]).toBe(15);
        // A 5×5 stone roof at y = 6 over a sealed room: dark inside.
        const cells = [];
        for (let z = 0; z < 7; z++)
            for (let x = 0; x < 7; x++)
                cells.push([x, 6, z, 'stone']);
        for (let y = 1; y < 6; y++)
            for (let k = 0; k < 7; k++)
                cells.push([k, y, 0, 'stone'], [k, y, 6, 'stone'], [0, y, k, 'stone'], [6, y, k, 'stone']);
        const room = region(cells);
        expect(room.sky[regionIndex(16 + 3, 2, 16 + 3)]).toBe(0);
        // Open the room on one side: light flows in and falls off by one per block.
        const open = region(cells.filter(([x, y, z]) => !(x === 6 && z === 3 && y >= 1 && y <= 2)));
        const inside = open.sky[regionIndex(16 + 5, 1, 16 + 3)];
        const deeper = open.sky[regionIndex(16 + 3, 1, 16 + 3)];
        expect(inside).toBeGreaterThan(deeper);
        expect(inside - deeper).toBe(2);
    });
    it('spreads block light from emitters, losing one level per block', () => {
        const v = region([[8, 3, 8, 'torch']]);
        expect(v.block[regionIndex(24, 3, 24)]).toBe(14);
        expect(v.block[regionIndex(25, 3, 24)]).toBe(13);
        expect(v.block[regionIndex(24 + 5, 3, 24)]).toBe(9);
        expect(v.block[regionIndex(24 + 14, 3, 24)]).toBe(0);
    });
    it('filters sky light through leaves and water', () => {
        const v = region([[4, 10, 4, 'oak_leaves'], [10, 1, 10, 'water'], [10, 2, 10, 'water']]);
        expect(v.sky[regionIndex(20, 9, 20)]).toBe(14);
        expect(v.sky[regionIndex(26, 1, 26)]).toBeLessThan(15);
    });
});
describe('greedy mesher', () => {
    const mesher = new ChunkMesher(reg);
    it('meshes a lone block as six quads with in-range indices', () => {
        const m = mesher.mesh(region([[5, 5, 5, 'stone']], false));
        expect(m.opaque?.quads).toBe(6);
        expect(checkMesh(m)).not.toBeNull();
        const p = m.opaque;
        for (let i = 0; i < p.indices.length; i++)
            expect(p.indices[i]).toBeLessThan(p.quads * 4);
    });
    it('merges coplanar faces with identical shading', () => {
        // A 4 × 1 × 1 bar in mid-air: still 6 quads after merging.
        const m = mesher.mesh(region([[2, 8, 2, 'stone'], [3, 8, 2, 'stone'], [4, 8, 2, 'stone'], [5, 8, 2, 'stone']], false));
        expect(m.opaque?.quads).toBe(6);
    });
    it('culls hidden faces between opaque blocks', () => {
        const m = mesher.mesh(region([[2, 8, 2, 'stone'], [2, 9, 2, 'stone']], false));
        expect(m.opaque?.quads).toBe(6);
    });
    it('darkens corners next to walls (ambient occlusion)', () => {
        // Floor + one block: the floor quads touching the block get AO < 3 at shared corners.
        const m = mesher.mesh(region([[5, 1, 5, 'stone']]));
        const ao = aoOf(m.opaque);
        expect(Math.min(...ao)).toBeLessThan(3);
        expect(Math.max(...ao)).toBe(3);
        // Without the block every vertex is unoccluded.
        const flat = mesher.mesh(region([]));
        expect(Math.min(...aoOf(flat.opaque))).toBe(3);
    });
    it('puts liquids in their own pass with a lowered surface', () => {
        const m = mesher.mesh(region([[3, 1, 3, 'water']]));
        const p = m.liquid;
        expect(p).toBeTruthy();
        let maxY = 0;
        for (let i = 1; i < p.positions.length; i += 3)
            maxY = Math.max(maxY, p.positions[i]);
        expect(maxY).toBeCloseTo(1 + LIQUID_SURFACE, 5);
    });
    it('draws plants as two crossed quads in the cutout pass', () => {
        const m = mesher.mesh(region([[3, 1, 3, 'poppy']]));
        expect(m.cutout?.quads).toBe(2);
    });
    it('records column tops for sun shadows: solid tops and foliage tops', () => {
        const v = region([[3, 1, 4, 'stone'], [3, 2, 4, 'stone'], [5, 3, 6, 'oak_leaves'], [5, 1, 6, 'oak_log'], [7, 2, 7, 'glass']]);
        const h = new ChunkMesher(reg).mesh(v).heights;
        expect(h.length).toBe(HEIGHTS_LENGTH);
        expect(h[0]).toBe(1); // the floor
        expect(h[3 + 4 * 16]).toBe(3); // stone stack to y = 2
        expect(h[5 + 6 * 16]).toBe(2); // log at y = 1; leaves above are foliage, not solid
        expect(h[256 + 5 + 6 * 16]).toBe(4); // leaves at y = 3
        expect(h[256 + 3 + 4 * 16]).toBe(0);
        expect(h[256 + 7 + 7 * 16]).toBe(0); // glass casts no foliage shadow
    });
    it('rejects meshes without valid column tops', () => {
        const v = region([[3, 1, 4, 'stone']]);
        const m = new ChunkMesher(reg).mesh(v);
        expect(checkMesh({ ...m })).not.toBeNull();
        expect(checkMesh({ ...m, heights: new Uint8Array(10) })).toBeNull();
        expect(checkMesh({ ...m, heights: undefined })).toBeNull();
    });
    it('meshes real terrain into valid buffers through a job context', () => {
        const ctx = new VoxelJobContext(terrainIdentity(terrain({ preset: 'survival' }), 11));
        const chunks = [];
        const tops = [];
        for (let dz = -1; dz <= 1; dz++)
            for (let dx = -1; dx <= 1; dx++) {
                const g = ctx.generate(dx, dz);
                chunks.push(g.chunk);
                tops.push(g.top);
            }
        const m = ctx.mesh(chunks, tops);
        expect(checkMesh(m)).not.toBeNull();
        expect(quads(m)).toBeGreaterThan(100);
        // Same result without the known tops.
        const m2 = ctx.mesh(chunks);
        expect(m2.opaque?.positions).toEqual(m.opaque?.positions);
        expect(CHUNK_VOLUME).toBe(32768);
        expect(cellIndex(1, 0, 0)).toBe(1);
    });
});
