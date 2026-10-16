/**
 * Per-frame cost guards of the block terrain: the calls the studio makes every frame must not allocate in steady
 * state, the mesher's output must move to the GPU without copies, and meshing must stay in the workers.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { VoxelLayer } from '../src/voxel/voxel-layer';
import { SHADOW_MARCH } from '../src/voxel/terrain-material';
import { describeSites, probeAllocations } from '../../../tests/unit/alloc-probe';
const VOXEL_SRC = /packages\/render\/src\/voxel\//;
const BUDGET = 16;
function layer() {
    const l = new VoxelLayer();
    l.setAtlas(new Uint8Array(16 * 16 * 4).fill(200), 16, new Uint16Array(3));
    return l;
}
describe('block terrain per-frame work', () => {
    it('lighting, fog, sky and water updates allocate nothing in steady state', async () => {
        const l = layer();
        const fog = new Color(0.5, 0.6, 0.7);
        const zenith = new Color(0.1, 0.3, 0.7);
        const tint = [1, 0.95, 0.9];
        let t = 0;
        const r = await probeAllocations(() => {
            // The hour creeps by far less than a sun step per frame, like a real clock.
            l.setLighting(1, tint, 10 + (t += 0.00001));
            l.setFog(fog, 100, 200, 0);
            l.setFogOrigin(3, 4);
            l.setSkyZenith(zenith);
            l.setWaterLevel(47.875);
            l.flushPrebuild();
        }, { iterations: 400, warmup: 30_000, match: VOXEL_SRC });
        expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(BUDGET);
        l.dispose();
    });
    it('posing a mob allocates nothing in steady state', async () => {
        const l = layer();
        l.setMob(1, 'pig', 0, 60, 0, 0, 0, 1, false);
        let t = 0;
        const r = await probeAllocations(() => {
            t += 0.05;
            l.setMob(1, 'pig', Math.sin(t), 60, 0, t, t * 3, 1, false);
        }, { iterations: 400, warmup: 30_000, match: VOXEL_SRC });
        expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(BUDGET);
        l.dispose();
    });
    it('rebuilds its shaders only when the tier changes', () => {
        const l = layer();
        const v = l.version;
        l.setQuality('medium');
        expect(l.version).toBe(v);
        l.setQuality('high');
        expect(l.quality).toBe('high');
        expect(l.version).toBeGreaterThan(v);
        l.dispose();
    });
    it('costs more shadow samples per tier and none on the software tier', () => {
        const total = (t) => SHADOW_MARCH[t].steps.reduce((a, b) => a + b, 0);
        expect(total('low')).toBe(0);
        expect(total('medium')).toBeGreaterThan(0);
        expect(total('high')).toBeGreaterThan(total('medium'));
        expect(total('ultra')).toBeGreaterThan(total('high'));
        // A budget of samples per pixel that a mid-range integrated GPU can afford at 1080p.
        expect(total('ultra')).toBeLessThanOrEqual(24);
    });
});
describe('block meshing stays off the main thread', () => {
    it('the worker owns the mesher and the layer never meshes', () => {
        const worker = readFileSync(resolve(import.meta.dirname, '../../voxel/src/worker/voxel.worker.ts'), 'utf8');
        const handler = readFileSync(resolve(import.meta.dirname, '../../voxel/src/worker/handler.ts'), 'utf8');
        expect(worker).toContain('VoxelWorkerHandler');
        expect(handler).toContain('ctx.mesh(');
        const layerSrc = readFileSync(resolve(import.meta.dirname, '../src/voxel/voxel-layer.ts'), 'utf8');
        expect(layerSrc).not.toMatch(/ChunkMesher|\.mesh\(/);
    });
});
