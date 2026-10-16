import { describe, expect, it } from 'vitest';
import { createBody, moveBody, overlapsSolid, resolvePenetration, SKIN } from '../src/collide';
import { createHit, raycastVoxels } from '../src/raycast';
import { flatWorld, id } from './helpers';
describe('DDA ray casting', () => {
    const solid = new Set(['3,4,5', '0,0,0', '-2,1,0']);
    const get = (x, y, z) => (solid.has(`${x},${y},${z}`) ? 1 : 0);
    const hits = (b) => b !== 0;
    it('finds the first cell along the ray with the entered face normal', () => {
        const h = createHit();
        expect(raycastVoxels(get, 3.5, 4.5, 0.5, 0, 0, 1, 10, hits, h)).toBe(true);
        expect([h.x, h.y, h.z]).toEqual([3, 4, 5]);
        expect([h.nx, h.ny, h.nz]).toEqual([0, 0, -1]);
        expect(h.distance).toBeCloseTo(4.5, 6);
    });
    it('respects the range and handles negative directions and diagonals', () => {
        const h = createHit();
        expect(raycastVoxels(get, 3.5, 4.5, 0.5, 0, 0, 1, 4, hits, h)).toBe(false);
        expect(raycastVoxels(get, 1.5, 1.5, 0.5, -1, 0, 0, 10, hits, h)).toBe(true);
        expect([h.x, h.nx]).toEqual([-2, 1]);
        expect(raycastVoxels(get, 2.2, 2.2, 0.5, -1, -1, 0, 10, hits, h)).toBe(true);
        expect([h.x, h.y, h.z]).toEqual([0, 0, 0]);
        // Degenerate input never loops.
        expect(raycastVoxels(get, 0.5, 5.5, 0.5, 0, 0, 0, 10, hits, h)).toBe(false);
        expect(raycastVoxels(get, Number.NaN, 0, 0, 1, 0, 0, 10, hits, h)).toBe(false);
    });
    it('visits every cell (no skipped corners on exact diagonals)', () => {
        const seen = [];
        raycastVoxels((x, y, z) => {
            seen.push(`${x},${y},${z}`);
            return 0;
        }, 0.5, 0.5, 0.5, 1, 1, 0, 3, () => false, createHit());
        // Each step moves along exactly one axis.
        for (let i = 1; i < seen.length; i++) {
            const a = seen[i - 1].split(',').map(Number);
            const b = seen[i].split(',').map(Number);
            expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])).toBe(1);
        }
    });
});
describe('voxel collision sweep', () => {
    const w = flatWorld(1, 9);
    it('falls under gravity and lands exactly on the ground', () => {
        const b = createBody(0.5, 15, 0.5, 0.3, 1.8);
        for (let i = 0; i < 120; i++) {
            b.vy -= 28 / 60;
            moveBody(w, b, 1 / 60);
        }
        expect(b.onGround).toBe(true);
        expect(b.y).toBeGreaterThanOrEqual(10);
        expect(b.y).toBeLessThan(10 + 2 * SKIN);
        expect(b.vy).toBe(0);
    });
    it('never tunnels, even at absurd speed', () => {
        const b = createBody(0.5, 40, 0.5, 0.3, 1.8);
        b.vy = -5000;
        moveBody(w, b, 1 / 60);
        expect(b.y).toBeGreaterThanOrEqual(10);
        expect(b.onGround).toBe(true);
        // Sideways into a one-block-thick wall.
        const wall = flatWorld(1, 9);
        for (let y = 10; y < 14; y++)
            for (let z = -3; z < 4; z++)
                wall.set(5, y, z, id('stone'));
        const s = createBody(0.5, 10.0001, 0.5, 0.3, 1.8);
        s.vx = 3000;
        moveBody(wall, s, 1 / 60);
        expect(s.x + s.halfWidth).toBeLessThanOrEqual(5);
        expect(s.hitX).toBe(true);
        expect(s.vx).toBe(0);
    });
    it('auto-steps one block but not two', () => {
        const ww = flatWorld(1, 9);
        ww.set(2, 10, 0, id('stone'));
        const b = createBody(0.5, 10.0001, 0.5, 0.3, 1.8);
        b.onGround = true;
        for (let i = 0; i < 40; i++) {
            b.vx = 4;
            b.vy -= 28 / 60;
            moveBody(ww, b, 1 / 60, true);
        }
        expect(b.x).toBeGreaterThan(2.3);
        expect(b.y).toBeGreaterThanOrEqual(11);
        const tall = flatWorld(1, 9);
        tall.set(2, 10, 0, id('stone'));
        tall.set(2, 11, 0, id('stone'));
        const c = createBody(0.5, 10.0001, 0.5, 0.3, 1.8);
        c.onGround = true;
        for (let i = 0; i < 40; i++) {
            c.vx = 4;
            c.vy -= 28 / 60;
            moveBody(tall, c, 1 / 60, true);
        }
        expect(c.x + c.halfWidth).toBeLessThanOrEqual(2);
        expect(c.y).toBeLessThan(10.01);
    });
    it('reports liquid immersion and treats unloaded chunks as solid', () => {
        const ww = flatWorld(1, 9);
        for (let y = 10; y < 13; y++)
            ww.set(0, y, 0, id('water'));
        const b = createBody(0.5, 10.2, 0.5, 0.3, 1.8);
        moveBody(ww, b, 1 / 60);
        expect(b.liquid).toBe(1);
        expect(b.submerged).toBe(true);
        // Far outside the loaded chunks: solid (players wait instead of falling).
        expect(ww.isSolid(1000, 50, 1000)).toBe(true);
    });
    it('pushes a body out of blocks it is stuck in', () => {
        const q = { isSolid: (_x, y) => y < 12, isLiquid: () => false };
        const b = createBody(0.5, 10.5, 0.5, 0.3, 1.8);
        expect(overlapsSolid(q, b.x, b.y, b.z, b.halfWidth, b.height)).toBe(true);
        expect(resolvePenetration(q, b)).toBe(true);
        expect(b.y).toBeGreaterThanOrEqual(12);
    });
});
