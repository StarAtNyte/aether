/**
 * The living models (code-authored, MIT): sculpted with signed distances, skinned to a skeleton and animated with
 * clips. The sculpting kit is checked on shapes with known answers; each shipped model is checked for what makes it an
 * animal and not a toy: real size, a skin with joints, vertex colours, clips for its gaits, a licence.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Catalog } from '../src/schema';
import { cone, ellipsoid, Sculpt, sphere } from '../../../scripts/assets/sdf';
const ROOT = new URL('../../../assets/', import.meta.url);
const catalog = Catalog.parse(JSON.parse(readFileSync(new URL('catalog.json', ROOT), 'utf8')));
function glbJson(file) {
    const buf = readFileSync(new URL(`lib/${file}`, ROOT));
    const len = buf.readUInt32LE(12);
    return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}
describe('sdf sculpting', () => {
    it('polygonises a sphere to its volume with outward normals', () => {
        const r = 0.5;
        const s = new Sculpt([sphere('b', [0, 0, 0], r)], { voxel: 0.04, k: 0 });
        const { positions, indices } = s.polygonise();
        expect(indices.length).toBeGreaterThan(300);
        let volume = 0;
        for (let t = 0; t < indices.length; t += 3) {
            const a = indices[t] * 3;
            const b = indices[t + 1] * 3;
            const c = indices[t + 2] * 3;
            const [ax, ay, az] = [positions[a], positions[a + 1], positions[a + 2]];
            const [bx, by, bz] = [positions[b], positions[b + 1], positions[b + 2]];
            const [cx, cy, cz] = [positions[c], positions[c + 1], positions[c + 2]];
            // Signed volume of the tetrahedron with the origin: positive when the triangle faces outward.
            volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
        }
        expect(volume).toBeGreaterThan(0);
        expect(volume).toBeCloseTo((4 / 3) * Math.PI * r ** 3, 1);
        // Every vertex sits on the surface within a voxel.
        for (let v = 0; v < positions.length; v += 3)
            expect(Math.abs(Math.hypot(positions[v], positions[v + 1], positions[v + 2]) - r)).toBeLessThan(0.04);
    });
    it('merges primitives smoothly and carves material away', () => {
        const joined = new Sculpt([sphere('a', [-0.2, 0, 0], 0.2), sphere('b', [0.2, 0, 0], 0.2)], { voxel: 0.02, k: 0.1 });
        // Midway between the two balls the smooth union is solid, a hard union would be empty there.
        expect(joined.d(0, 0, 0)).toBeLessThan(0);
        const hard = new Sculpt([sphere('a', [-0.2, 0, 0], 0.2), sphere('b', [0.2, 0, 0], 0.2)], { voxel: 0.02, k: 0 });
        expect(hard.d(0, 0, 0)).toBeGreaterThanOrEqual(0);
        const carved = new Sculpt([sphere('a', [0, 0, 0], 0.3), { ...sphere('hole', [0.3, 0, 0], 0.12), carve: true }], { voxel: 0.02, k: 0.02 });
        expect(carved.d(0.28, 0, 0)).toBeGreaterThan(0);
    });
    it('measures tapered capsules and ellipsoids correctly on their axes', () => {
        const c = cone('b', [0, 0, 0], [1, 0, 0], 0.2, 0.1);
        expect(c.d(0.5, 0.15, 0)).toBeLessThan(0);
        expect(c.d(0.5, 0.3, 0)).toBeGreaterThan(0);
        expect(c.d(-0.3, 0, 0)).toBeCloseTo(0.1, 5);
        const e = ellipsoid('b', [0, 0, 0], [0.5, 0.2, 0.2]);
        expect(e.d(0.45, 0, 0)).toBeLessThan(0);
        expect(e.d(0.55, 0, 0)).toBeGreaterThan(0);
        expect(e.d(0, 0.25, 0)).toBeGreaterThan(0);
    });
    it('weights vertices to the bone whose flesh they are on, summing to one', () => {
        const s = new Sculpt([cone('upper', [0, 0, 0], [0, -0.5, 0], 0.1, 0.08), cone('lower', [0, -0.5, 0], [0, -1, 0], 0.08, 0.05)], { voxel: 0.03, k: 0.03 });
        const index = new Map([['upper', 0], ['lower', 1]]);
        const high = s.weights(0.09, -0.1, 0, index, 0.02);
        const low = s.weights(0.05, -0.9, 0, index, 0.02);
        const sum = (w) => w.reduce((a, e) => a + e[1], 0);
        expect(sum(high)).toBeCloseTo(1, 6);
        expect(high[0]?.[0]).toBe(0);
        expect(low[0]?.[0]).toBe(1);
        // At the joint both bones share.
        const joint = s.weights(0.08, -0.5, 0, index, 0.02);
        expect(joint.length).toBe(2);
    });
});
const EXPECT = {
    deer: { clips: ['idle', 'walk', 'run', 'graze'], size: [[0.25, 0.8], [1.2, 2.2], [1.1, 2.2]] },
    doe: { clips: ['idle', 'walk', 'run'], size: [[0.25, 0.8], [1.0, 1.6], [1.0, 2.0]] },
    cat: { clips: ['idle', 'walk', 'run'], size: [[0.15, 0.45], [0.25, 0.6], [0.45, 0.95]] },
    bird: { clips: ['perch', 'flap', 'fly', 'glide'], size: [[0.15, 0.45], [0.08, 0.3], [0.15, 0.45]] },
    crow: { clips: ['perch', 'flap', 'fly', 'glide'], size: [[0.6, 1.1], [0.15, 0.4], [0.35, 0.9]] },
    seagull: { clips: ['perch', 'flap', 'fly', 'glide'], size: [[0.8, 1.4], [0.15, 0.4], [0.4, 0.9]] },
    hawk: { clips: ['perch', 'flap', 'fly', 'glide'], size: [[0.9, 1.6], [0.2, 0.5], [0.5, 1.0]] },
    duck: { clips: ['perch', 'flap', 'fly', 'glide'], size: [[0.6, 1.2], [0.15, 0.4], [0.35, 0.8]] },
    parrot: { clips: ['perch', 'flap', 'fly', 'glide'], size: [[0.6, 1.2], [0.15, 0.4], [0.5, 1.0]] },
    fish: { clips: ['idle', 'swim', 'dash'], size: [[0.05, 0.25], [0.08, 0.3], [0.3, 0.6]] },
    koi: { clips: ['idle', 'swim', 'dash'], size: [[0.08, 0.3], [0.1, 0.35], [0.4, 0.8]] },
    butterfly: { clips: ['idle', 'walk', 'run'], size: [[0.07, 0.16], [0.02, 0.08], [0.04, 0.12]] },
};
describe('living models in the catalog', () => {
    for (const [id, want] of Object.entries(EXPECT)) {
        it(`${id}: real size, a skeleton, vertex colours, clips for its gaits, MIT`, () => {
            const e = catalog.entries.find((x) => x.id === id);
            expect(e, id).toBeDefined();
            expect(e.pack).toBe('aether-creatures');
            expect(e.category).toBe('animals');
            expect(e.facing).toBe('-z');
            expect(catalog.packs.find((p) => p.id === 'aether-creatures')?.licence).toBe('MIT');
            expect(e.tris).toBeLessThan(16_000);
            for (let i = 0; i < 3; i++) {
                const [lo, hi] = want.size[i];
                expect(e.size[i], `${id} size[${i}]`).toBeGreaterThan(lo);
                expect(e.size[i], `${id} size[${i}]`).toBeLessThan(hi);
            }
            const j = glbJson(e.file);
            expect(j.skins?.length).toBe(1);
            expect(j.skins?.[0]?.joints.length).toBeGreaterThanOrEqual(5);
            const names = (j.animations ?? []).map((a) => a.name);
            for (const c of want.clips)
                expect(names, `${id} clip ${c}`).toContain(c);
            for (const a of j.animations ?? [])
                expect(a.channels.length).toBeGreaterThanOrEqual(2);
            // The body is skinned and painted per vertex.
            const body = j.meshes[0]?.primitives[0]?.attributes ?? {};
            expect(body['JOINTS_0']).toBeDefined();
            expect(body['WEIGHTS_0']).toBeDefined();
            expect(body['COLOR_0']).toBeDefined();
            // The role clips the animator plays exist.
            for (const role of [e.anims?.idle, e.anims?.walk, e.anims?.run])
                expect(names).toContain(role);
        });
    }
    it('no longer lists the replaced cube pets', () => {
        for (const id of ['cat', 'deer', 'fish', 'parrot'])
            expect(catalog.entries.find((x) => x.id === id)?.pack).toBe('aether-creatures');
    });
});
