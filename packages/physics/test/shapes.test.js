import { describe, expect, it } from 'vitest';
import { fromColliderDesc, scaleCollider, placeCollider, collidersBounds, sanitizePoints, SHAPE_LIMITS } from '../src/shapes';
import { primitiveColliders } from '../src/source';
import { scatterInstances } from '../src/scatter';
import { decodeSnapshot, encodeSnapshot } from '../src/snapshot';
import { summarizeReport } from '../src/report';
import { tiltDegrees } from '../src/vec';
const META = { v: 1, fixedDt: 1 / 60, steps: 3, accumulator: 0, ground: null, bodies: [], externals: [], contacts: [] };
describe('collider descriptors', () => {
    it('converts procgen descs and rejects malformed ones', () => {
        expect(fromColliderDesc({ kind: 'box', halfExtents: [1, 2, 3], offset: [0, 1, 0], rotation: [0, 90, 0] })?.shape).toEqual({ kind: 'box', half: [1, 2, 3] });
        expect(fromColliderDesc({ kind: 'box', halfExtents: [Number.NaN, 1, 1], offset: [0, 0, 0] })).toBeNull();
        expect(fromColliderDesc({ kind: 'sphere', radius: Infinity, offset: [0, 0, 0] })).toBeNull();
        expect(fromColliderDesc({ kind: 'hull', points: new Float32Array([0, 0, 0]), offset: [0, 0, 0] })).toBeNull();
        expect(fromColliderDesc({ kind: 'trimesh', positions: new Float32Array(9), indices: new Uint32Array([0, 1, 7]) })).toBeNull();
        expect(fromColliderDesc({ kind: 'heightfield', rows: 2, cols: 2, heights: new Float32Array(8), size: [1, 1, 1] })).toBeNull();
        expect(fromColliderDesc({ kind: 'heightfield', rows: 5000, cols: 2, heights: new Float32Array(5001 * 3), size: [1, 1, 1] })).toBeNull();
        expect(fromColliderDesc({ kind: 'nope' })).toBeNull();
        expect(fromColliderDesc(null)).toBeNull();
    });
    it('subsamples oversized hull point clouds', () => {
        const n = SHAPE_LIMITS.MAX_HULL_POINTS * 3;
        const pts = new Float32Array(n * 3).map((_, i) => (i % 7) - 3);
        const out = sanitizePoints(pts);
        expect(out).not.toBeNull();
        expect(out.length / 3).toBeLessThanOrEqual(SHAPE_LIMITS.MAX_HULL_POINTS);
        const bad = new Float32Array(12);
        bad[5] = Number.NaN;
        expect(sanitizePoints(bad)).toBeNull();
    });
    it('scales primitives exactly and degrades to hulls when it must', () => {
        const boxC = { shape: { kind: 'box', half: [0.5, 0.5, 0.5] }, position: [1, 0, 0], rotation: [0, 0, 0, 1] };
        expect(scaleCollider(boxC, [2, 3, 4])).toEqual({ shape: { kind: 'box', half: [1, 1.5, 2] }, position: [2, 0, 0], rotation: [0, 0, 0, 1] });
        const s = Math.SQRT1_2;
        const rotated = { ...boxC, rotation: [0, s, 0, s] };
        const hull = scaleCollider(rotated, [2, 1, 1]);
        expect(hull.shape.kind).toBe('hull');
        const b = collidersBounds([hull]);
        // 90° yaw swaps x/z before the x-scale: extents become x: (1 + 0.5) * 2 … etc.
        expect(b?.max[0]).toBeCloseTo(3, 5);
        expect(b?.max[2]).toBeCloseTo(0.5, 5);
        const ballC = { shape: { kind: 'ball', radius: 1 }, position: [0, 0, 0], rotation: [0, 0, 0, 1] };
        expect(scaleCollider(ballC, [2, 2, 2]).shape).toEqual({ kind: 'ball', radius: 2 });
        expect(scaleCollider(ballC, [1, 2, 1]).shape.kind).toBe('hull');
        const cap = { shape: { kind: 'capsule', halfHeight: 0.5, radius: 0.5 }, position: [0, 0, 0], rotation: [0, 0, 0, 1] };
        expect(scaleCollider(cap, [1, 2, 1]).shape).toEqual({ kind: 'capsule', halfHeight: 1.5, radius: 0.5 });
    });
    it('places colliders rigidly in a parent frame', () => {
        const c = { shape: { kind: 'ball', radius: 1 }, position: [1, 0, 0], rotation: [0, 0, 0, 1] };
        const half = Math.PI / 4;
        const p = placeCollider(c, [0, 5, 0], [0, Math.sin(half), 0, Math.cos(half)]);
        expect(p.position[0]).toBeCloseTo(0, 6);
        expect(p.position[1]).toBeCloseTo(5, 6);
        expect(p.position[2]).toBeCloseTo(-1, 6);
    });
    it('maps primitive size semantics', () => {
        expect(primitiveColliders({ kind: 'primitive', primitive: 'sphere', size: [3, 9, 9] })[0]?.shape).toEqual({ kind: 'ball', radius: 1.5 });
        expect(primitiveColliders({ kind: 'primitive', primitive: 'cylinder', size: [2, 4, 9] })[0]?.shape).toEqual({ kind: 'cylinder', halfHeight: 2, radius: 1 });
        expect(primitiveColliders({ kind: 'primitive', primitive: 'capsule', size: [1, 3, 1] })[0]?.shape).toEqual({ kind: 'capsule', halfHeight: 1, radius: 0.5 });
        expect(primitiveColliders({ kind: 'primitive', primitive: 'plane', size: [4, 1, 6] })[0]?.shape).toEqual({ kind: 'box', half: [2, 0.01, 3] });
        const torus = primitiveColliders({ kind: 'primitive', primitive: 'torus', size: [2, 0.4, 2] });
        expect(torus.length).toBe(12);
        const b = collidersBounds(torus);
        expect(b?.max[0]).toBeGreaterThan(0.9);
        expect(b?.max[2]).toBeCloseTo(0.2, 3);
        // Non-positive / NaN sizes fall back to 1m.
        expect(primitiveColliders({ kind: 'primitive', primitive: 'box', size: [Number.NaN, -1, 0] })[0]?.shape).toEqual({ kind: 'box', half: [0.5, 0.5, 0.5] });
    });
});
describe('scatterInstances', () => {
    const shape = { count: 200, area: [20, 10], seed: 7, scaleRange: [0.5, 1.5], randomYaw: true };
    it('is deterministic and stays in the area', () => {
        const a = scatterInstances(shape);
        const b = scatterInstances(shape);
        expect(a).toEqual(b);
        expect(a).toHaveLength(200);
        for (const i of a) {
            expect(Math.abs(i.position[0])).toBeLessThanOrEqual(10);
            expect(Math.abs(i.position[2])).toBeLessThanOrEqual(5);
            expect(i.scale).toBeGreaterThanOrEqual(0.5);
            expect(i.scale).toBeLessThanOrEqual(1.5);
        }
        expect(scatterInstances({ ...shape, seed: 8 })).not.toEqual(a);
    });
    it('honors minSpacing best-effort and caps counts', () => {
        const violations = (minSpacing) => {
            const pts = scatterInstances({ ...shape, count: 50, ...(minSpacing ? { minSpacing } : {}) });
            let n = 0;
            for (let i = 0; i < pts.length; i++)
                for (let j = i + 1; j < pts.length; j++) {
                    const a = pts[i];
                    const b = pts[j];
                    if (Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]) < 1.5)
                        n++;
                }
            return n;
        };
        expect(violations(1.5)).toBeLessThan(violations() / 3);
        expect(scatterInstances({ ...shape, count: 100 }, 10)).toHaveLength(10);
        expect(scatterInstances({ ...shape, randomYaw: false }).every((i) => i.yawDeg === 0)).toBe(true);
    });
});
describe('snapshot codec', () => {
    it('round-trips meta and payload', () => {
        const bytes = encodeSnapshot(META, new Uint8Array([1, 2, 3]));
        const out = decodeSnapshot(bytes);
        expect(out.meta).toEqual(META);
        expect([...out.rapierBytes]).toEqual([1, 2, 3]);
    });
    it('rejects garbage, truncation and prototype pollution', () => {
        expect(() => decodeSnapshot(new Uint8Array(4))).toThrow(/too short/);
        expect(() => decodeSnapshot(new Uint8Array(64))).toThrow(/magic/);
        const good = encodeSnapshot(META, new Uint8Array([9]));
        expect(() => decodeSnapshot(good.slice(0, 20))).toThrow();
        const evil = new TextEncoder().encode('{"v":1,"__proto__":{"polluted":true},"fixedDt":0.016,"steps":0,"accumulator":0,"ground":null,"bodies":[],"externals":[],"contacts":[]}');
        const buf = new Uint8Array(12 + evil.length + 1);
        buf.set(good.subarray(0, 8), 0);
        new DataView(buf.buffer).setUint32(8, evil.length, true);
        buf.set(evil, 12);
        buf[buf.length - 1] = 1;
        expect(() => decodeSnapshot(buf)).toThrow(/invalid physics snapshot/);
        expect({}.polluted).toBeUndefined();
        const huge = new Uint8Array(16);
        huge.set(good.subarray(0, 8), 0);
        new DataView(huge.buffer).setUint32(8, 0xffffffff, true);
        expect(() => decodeSnapshot(huge)).toThrow(/meta length/);
    });
});
describe('misc helpers', () => {
    it('measures tilt but ignores yaw', () => {
        const yaw90 = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
        expect(tiltDegrees([0, 0, 0, 1], yaw90)).toBeCloseTo(0, 4);
        const roll90 = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
        expect(tiltDegrees([0, 0, 0, 1], roll90)).toBeCloseTo(90, 4);
    });
    it('summarizes reports compactly with failures first', () => {
        const text = summarizeReport({
            passed: false,
            simulatedSeconds: 3.25,
            ms: 120.4,
            results: [
                { id: 'a', kind: 'stable', passed: true, message: 'fine' },
                { id: 'b', kind: 'topples', passed: false, message: '3/30 toppled' },
            ],
            diagnostics: [
                { severity: 'warning', code: 'floating', entities: ['x'], message: 'x floats', suggestion: 'lower x to y=1' },
                { severity: 'error', code: 'overlap', entities: ['y', 'z'], message: 'y overlaps z by 0.2m', suggestion: 'move y up to y=2' },
            ],
        });
        const lines = text.split('\n');
        expect(lines[0]).toContain('FAIL');
        expect(lines[0]).toContain('1/2 tests passed');
        expect(lines[1]).toMatch(/^FAIL b \(topples\)/);
        expect(lines[2]).toMatch(/^ok {3}a/);
        expect(lines[4]).toContain('error overlap');
        expect(text).toContain('-> fix: move y up to y=2');
        const long = summarizeReport({ passed: true, simulatedSeconds: 0, ms: 0, results: [{ id: 't', kind: 'stable', passed: true, message: 'x'.repeat(5000) }], diagnostics: [] });
        expect(long.length).toBeLessThan(600);
    });
});
