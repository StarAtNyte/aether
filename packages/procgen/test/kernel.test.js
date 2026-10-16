import { describe, expect, it } from 'vitest';
import { VertexBudget, Mesh } from '../src/kernel/mesh';
import * as prim from '../src/kernel/primitives';
import { triangulate, signedArea2 } from '../src/kernel/triangulate';
import { mat3AlignY, mat3Apply, mat3FromEulerDeg, mat3ToEulerDeg } from '../src/kernel/math3';
import { Noise } from '../src/noise';
import { rng } from '@aether/core';
import { expectUnitNormals, signedVolume, windingMismatch } from './helpers';
const budget = () => new VertexBudget(4_000_000);
describe('primitives', () => {
    const b = budget();
    const shapes = {
        box: prim.box(b, 1, 2, 3),
        sphere: prim.sphere(b, 1, 3),
        cylinder: prim.cylinder(b, 0.5, 1, 2, 12),
        cone: prim.cone(b, 1, 2, 10),
        torus: prim.torus(b, 1, 0.3),
        capsule: prim.capsule(b, 0.5, 2),
        plane: prim.plane(b, 2, 3, 4, 5),
        lathe: prim.lathe(b, [[0, 0], [1, 0], [1, 1], [0.5, 1.5], [0, 1.5]], 10),
        extrude: prim.extrude(b, [[0, 0], [2, 0], [2, 2], [1, 0.7], [0, 2]], 1),
        tube: prim.tube(b, [[0, 0, 0], [0, 1, 0], [1, 2, 0], [2, 2, 1]], 0.2, 8),
        heightfield: prim.heightfield(b, 8, 6, 4, 3, (x, z) => Math.sin(x) * z * 0.3),
        icosphere: prim.icosphere(b, 1, 2),
        rock: prim.icosphereRock(b, new Noise(rng(1)), rng(2), 1, 0.5),
    };
    for (const [name, mesh] of Object.entries(shapes)) {
        it(`${name}: unit normals, consistent winding, valid indices`, () => {
            expectUnitNormals(mesh.normals);
            expect(windingMismatch(mesh.positions, mesh.normals, mesh.indices)).toBe(0);
            expect(mesh.uvs.length).toBe((mesh.positions.length / 3) * 2);
            for (const i of mesh.indices)
                expect(i).toBeLessThan(mesh.vertexCount);
        });
    }
    it('closed solids have positive volume close to the analytic value', () => {
        expect(signedVolume(shapes.box)).toBeCloseTo(6, 5);
        expect(signedVolume(shapes.sphere)).toBeGreaterThan(0.95 * (4 / 3) * Math.PI * 0.97);
        expect(signedVolume(shapes.sphere)).toBeLessThan((4 / 3) * Math.PI);
        const cyl = prim.cylinder(budget(), 1, 1, 2, 64);
        expect(signedVolume(cyl)).toBeCloseTo(2 * Math.PI, 1);
        expect(signedVolume(shapes.extrude)).toBeGreaterThan(0);
        expect(signedVolume(shapes.icosphere)).toBeGreaterThan(0);
        expect(signedVolume(shapes.rock)).toBeGreaterThan(0);
        expect(signedVolume(shapes.capsule)).toBeGreaterThan(0);
        const torusVolume = 2 * Math.PI * Math.PI * 1 * 0.09;
        expect(signedVolume(shapes.torus)).toBeGreaterThan(torusVolume * 0.9);
        expect(signedVolume(shapes.torus)).toBeLessThan(torusVolume);
    });
    it('box has exact extents and is centered', () => {
        const bb = shapes.box.bounds();
        expect(bb.min).toEqual([-0.5, -1, -1.5]);
        expect(bb.max).toEqual([0.5, 1, 1.5]);
    });
    it('sphere radius and cylinder/cone/capsule extents follow the documented conventions', () => {
        const s = shapes.sphere.bounds();
        expect(s.max[1]).toBeCloseTo(1, 6);
        expect(s.min[1]).toBeCloseTo(-1, 6);
        const c = shapes.cone.bounds();
        expect(c.max[1]).toBeCloseTo(1, 6);
        expect(c.min[1]).toBeCloseTo(-1, 6);
        const cap = shapes.capsule.bounds();
        expect(cap.max[1]).toBeCloseTo(1, 6);
        expect(cap.max[0]).toBeCloseTo(0.5, 2);
        const t = shapes.torus.bounds();
        expect(t.max[0]).toBeCloseTo(1.3, 5);
        expect(t.max[2]).toBeGreaterThan(0.28);
        expect(t.max[2]).toBeLessThanOrEqual(0.3);
        const p = shapes.plane.bounds();
        expect(p.min).toEqual([-1, 0, -1.5]);
        for (let i = 1; i < shapes.plane.normals.length; i += 3)
            expect(shapes.plane.normals[i]).toBe(1);
    });
    it('clamps hostile arguments instead of allocating unbounded memory', () => {
        const big = prim.plane(budget(), 1, 1, 1e9, 1e9);
        expect(big.vertexCount).toBe((prim.KERNEL_LIMITS.MAX_GRID + 1) ** 2);
        const tiny = prim.box(budget(), -5, 0, Number.MIN_VALUE);
        expect(tiny.bounds().max[0]).toBeGreaterThan(0);
        expect(() => prim.box(budget(), Number.NaN, 1, 1)).toThrow(TypeError);
        expect(() => prim.sphere(budget(), Infinity)).toThrow(TypeError);
        expect(() => prim.lathe(budget(), 'nope', 8)).toThrow(TypeError);
        expect(() => prim.lathe(budget(), [[1, 0]], 8)).toThrow(RangeError);
        expect(() => prim.extrude(budget(), [[0, 0], [1, 1], [2, 2]], 1)).toThrow(/zero area/);
        expect(() => prim.extrude(budget(), new Array(prim.KERNEL_LIMITS.MAX_SHAPE_POINTS + 1).fill([0, 0]), 1)).toThrow(RangeError);
        expect(() => prim.tube(budget(), [[0, 0, 0], [0, 0, 0]], 1)).toThrow(/2 distinct/);
        expect(() => prim.heightfield(budget(), 4, 4, 1, 1, () => Number.NaN)).toThrow(TypeError);
    });
    it('enforces the vertex budget', () => {
        const small = new VertexBudget(100);
        expect(() => prim.sphere(small, 1, 6)).toThrow(/budget/);
        const b2 = new VertexBudget(60);
        const box = prim.box(b2, 1, 1, 1);
        expect(b2.used).toBe(24);
        box.clone();
        expect(() => box.clone()).toThrow(RangeError);
    });
    it('lathe reverses descending profiles so faces point outward', () => {
        const up = prim.lathe(budget(), [[0, 0], [1, 0], [1, 1], [0, 1]], 16);
        const down = prim.lathe(budget(), [[0, 1], [1, 1], [1, 0], [0, 0]], 16);
        expect(signedVolume(up)).toBeGreaterThan(0);
        expect(signedVolume(down)).toBeGreaterThan(0);
    });
    it('lathe with a duplicated point produces a sharp crease', () => {
        const m = prim.lathe(budget(), [[0, 0], [1, 0], [1, 0], [1, 1], [1, 1], [0, 1]], 8);
        // the side vertices (i=0, j=2) must have a horizontal normal, the bottom ring (j=1) a downward one
        expect(m.normals[1 * 3 + 1]).toBeCloseTo(-1, 6);
        expect(m.normals[2 * 3 + 1]).toBeCloseTo(0, 6);
    });
});
describe('triangulation', () => {
    it('triangulates a concave polygon with total area preserved', () => {
        // "C" shape (concave), CCW
        const pts = [[0, 0], [3, 0], [3, 1], [1, 1], [1, 2], [3, 2], [3, 3], [0, 3]];
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const tris = triangulate(xs, ys);
        expect(tris.length).toBe((pts.length - 2) * 3);
        let area = 0;
        for (let t = 0; t < tris.length; t += 3) {
            const a = pts[tris[t]];
            const b = pts[tris[t + 1]];
            const c = pts[tris[t + 2]];
            const ar = ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
            expect(ar).toBeGreaterThan(0);
            area += ar;
        }
        expect(area).toBeCloseTo(signedArea2(xs, ys) / 2, 9);
        expect(area).toBeCloseTo(7, 9);
    });
    it('terminates on degenerate input', () => {
        const xs = [0, 1, 2, 3, 2, 1];
        const ys = [0, 0, 0, 0, 0, 0];
        expect(triangulate(xs, ys).length).toBe(12);
    });
    it('extrude of a clockwise concave shape still yields outward faces', () => {
        const cw = [[0, 3], [3, 3], [3, 2], [1, 2], [1, 1], [3, 1], [3, 0], [0, 0]];
        const m = prim.extrude(budget(), cw, 2);
        expect(signedVolume(m)).toBeCloseTo(7 * 2, 6);
        expect(windingMismatch(m.positions, m.normals, m.indices)).toBe(0);
    });
});
describe('tube frames', () => {
    it('produces orthonormal parallel-transport frames without twist on a planar curve', () => {
        const path = [];
        for (let i = 0; i <= 32; i++) {
            const a = (i / 32) * Math.PI;
            path.push([Math.cos(a) * 3, Math.sin(a) * 3, 0]);
        }
        const f = prim.transportFrames(path);
        for (let i = 0; i < path.length; i++) {
            const o = i * 9;
            const t = [f[o], f[o + 1], f[o + 2]];
            const n = [f[o + 3], f[o + 4], f[o + 5]];
            const bn = [f[o + 6], f[o + 7], f[o + 8]];
            const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
            expect(dot(t, t)).toBeCloseTo(1, 6);
            expect(dot(n, n)).toBeCloseTo(1, 6);
            expect(dot(bn, bn)).toBeCloseTo(1, 6);
            expect(dot(t, n)).toBeCloseTo(0, 6);
            expect(dot(t, bn)).toBeCloseTo(0, 6);
            // planar curve in XY: the binormal or normal stays along ±Z the whole way (no twist)
            expect(Math.max(Math.abs(n[2]), Math.abs(bn[2]))).toBeCloseTo(1, 6);
        }
    });
    it('tube radius tapers via radiusAt', () => {
        const m = prim.tube(budget(), [[0, 0, 0], [0, 4, 0]], 1, 8, (t) => 1 - 0.5 * t);
        const top = m.positions.filter((_v, i) => i % 3 === 1 && Math.abs(m.positions[i]) < 1e-6);
        expect(top.length).toBeGreaterThan(0);
        const b = m.bounds();
        expect(b.max[0]).toBeCloseTo(1, 5);
    });
});
describe('Mesh transforms', () => {
    it('translate/rotate follow three.js XYZ Euler conventions', () => {
        const m = prim.box(budget(), 2, 1, 1).rotate(0, 0, 90);
        const bb = m.bounds();
        expect(bb.max[0]).toBeCloseTo(0.5, 6);
        expect(bb.max[1]).toBeCloseTo(1, 6);
        const r = mat3FromEulerDeg(30, 45, 60);
        const e = mat3ToEulerDeg(r);
        expect(e[0]).toBeCloseTo(30, 6);
        expect(e[1]).toBeCloseTo(45, 6);
        expect(e[2]).toBeCloseTo(60, 6);
        const [x, y, z] = mat3Apply(mat3AlignY(1, 1, 0), 0, 1, 0);
        expect(x).toBeCloseTo(Math.SQRT1_2, 9);
        expect(y).toBeCloseTo(Math.SQRT1_2, 9);
        expect(z).toBeCloseTo(0, 9);
        const down = mat3Apply(mat3AlignY(0, -1, 0), 0, 1, 0);
        expect(down[1]).toBeCloseTo(-1, 9);
    });
    it('non-uniform scale keeps normals correct (inverse-transpose)', () => {
        const s = prim.sphere(budget(), 1, 4).scale(3, 1, 1);
        expectUnitNormals(s.normals);
        // ellipsoid x²/9 + y² + z² = 1 → gradient ∝ (x/9, y, z)
        const p = s.positions;
        const n = s.normals;
        for (let i = 0; i < p.length; i += 3) {
            const gx = p[i] / 9, gy = p[i + 1], gz = p[i + 2];
            const gl = Math.hypot(gx, gy, gz);
            if (gl < 1e-6)
                continue;
            const d = (gx * n[i] + gy * n[i + 1] + gz * n[i + 2]) / gl;
            expect(d).toBeGreaterThan(0.99);
        }
    });
    it('negative scale mirrors and flips winding so faces stay outward', () => {
        const m = prim.box(budget(), 1, 2, 3).scale(-1, 1, 1);
        expect(signedVolume(m)).toBeCloseTo(6, 5);
        expect(windingMismatch(m.positions, m.normals, m.indices)).toBe(0);
    });
    it('merge appends geometry and fills missing colors with white; clone is independent', () => {
        const a = prim.box(budget(), 1, 1, 1).vertexColor(() => '#ff0000');
        const b = prim.box(budget(), 1, 1, 1).translate(2, 0, 0);
        const c = a.clone();
        a.merge(b);
        expect(a.vertexCount).toBe(48);
        expect(a.indices.length).toBe(72);
        expect(Math.max(...a.indices)).toBe(47);
        expect(a.colors?.[0]).toBeCloseTo(1, 6);
        expect(a.colors?.[1]).toBeCloseTo(0, 6);
        expect(a.colors?.[24 * 3 + 1]).toBe(1);
        expect(c.vertexCount).toBe(24);
        expect(a.bounds().max[0]).toBeCloseTo(2.5, 6);
        expect(() => a.merge({})).toThrow(TypeError);
    });
    it('vertexColor stores linear colors', () => {
        const m = prim.box(budget(), 1, 1, 1).vertexColor(() => '#808080');
        expect(m.colors?.[0]).toBeCloseTo(0.2158605, 5);
        expect(() => prim.box(budget(), 1, 1, 1).vertexColor(() => 'not-a-color')).toThrow(TypeError);
    });
    it('displace moves along normals and recomputes normals (seams stay smooth)', () => {
        const s = prim.sphere(budget(), 1, 3).displace(() => 0.5);
        const bb = s.bounds();
        expect(bb.max[1]).toBeCloseTo(1.5, 5);
        expectUnitNormals(s.normals);
        // radial normals after uniform displacement (including the UV seam)
        const p = s.positions;
        const n = s.normals;
        for (let i = 0; i < p.length; i += 3) {
            const l = Math.hypot(p[i], p[i + 1], p[i + 2]);
            const d = (p[i] * n[i] + p[i + 1] * n[i + 1] + p[i + 2] * n[i + 2]) / l;
            expect(d).toBeGreaterThan(0.97);
        }
        // hard edges of a box stay hard after displacement
        const bx = prim.box(budget(), 1, 1, 1).displace(() => 0);
        for (let i = 0; i < bx.normals.length; i += 3) {
            const ax = Math.max(Math.abs(bx.normals[i]), Math.abs(bx.normals[i + 1]), Math.abs(bx.normals[i + 2]));
            expect(ax).toBeCloseTo(1, 6);
        }
        expect(() => prim.box(budget(), 1, 1, 1).displace(() => Number.NaN)).toThrow(TypeError);
    });
    it('icosphereRock is flat shaded (every triangle has its own vertices and face normal)', () => {
        const r = prim.icosphereRock(budget(), new Noise(rng(4)), rng(5), 1, 0.6);
        expect(r.vertexCount).toBe(r.indices.length);
        for (let t = 0; t < r.indices.length; t += 3) {
            const a = t * 3;
            expect(r.normals[a]).toBe(r.normals[a + 3]);
            expect(r.normals[a + 1]).toBe(r.normals[a + 7]);
        }
    });
    it('transform performance: 100k-vertex rotate+scale in well under 50 ms', () => {
        const m = prim.plane(budget(), 10, 10, 300, 300);
        const t0 = performance.now();
        for (let i = 0; i < 5; i++)
            m.rotate(10, 20, 30).scale(1.01, 0.99, 1);
        expect((performance.now() - t0) / 5).toBeLessThan(50);
    });
});
