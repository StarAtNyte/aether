import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, decodeBase64Into, decodeMesh, encodeBase64, encodeChunks, decodeChunks, encodeMesh, encodeMeshUpdate, History, invertPatches, patchesBetween, summarizeWorld, userEditMarks, overlappingPaths, validateWorld, } from '../src/index';
/** Unit cube: 8 vertices, 12 triangles (closed, outward winding). */
function cube() {
    const positions = new Float32Array([
        -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5,
        -0.5, 1, -0.5, 0.5, 1, -0.5, 0.5, 1, 0.5, -0.5, 1, 0.5,
    ]);
    const indices = new Uint32Array([
        0, 1, 2, 0, 2, 3, // bottom (-y)
        4, 6, 5, 4, 7, 6, // top (+y)
        0, 4, 5, 0, 5, 1, // back (-z)
        1, 5, 6, 1, 6, 2, // right (+x)
        2, 6, 7, 2, 7, 3, // front (+z)
        3, 7, 4, 3, 4, 0, // left (-x)
    ]);
    return { positions, indices, colors: null, uvs: null, faceMaterials: null };
}
function worldWithMesh() {
    const asset = encodeMesh('m-box', cube(), { materials: [{ preset: 'stone' }] });
    const r = applyPatches(createWorld(), [
        { op: 'setMesh', mesh: asset },
        { op: 'add', entity: { id: 'box', shape: { kind: 'mesh', mesh: 'm-box' } } },
    ]);
    expect(r.errors).toEqual([]);
    return r.world;
}
describe('base64', () => {
    it('round-trips every length and byte value', () => {
        for (let n = 0; n < 70; n++) {
            const bytes = new Uint8Array(n);
            for (let i = 0; i < n; i++)
                bytes[i] = (i * 37 + n) & 255;
            const s = encodeBase64(bytes);
            expect(s.length % 4).toBe(0);
            const out = new Uint8Array(n);
            expect(decodeBase64Into(s, out, 0)).toBe(n);
            expect([...out]).toEqual([...bytes]);
        }
    });
    it('matches the platform encoder', () => {
        const bytes = new Uint8Array([0, 255, 128, 7, 64, 1, 2]);
        expect(encodeBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    });
    it('rejects non-canonical input', () => {
        const out = new Uint8Array(16);
        expect(() => decodeBase64Into('ab$d', out, 0)).toThrow(/character/);
        expect(() => decodeBase64Into('ab=d', out, 0)).toThrow(/padding/);
        expect(() => decodeBase64Into('abc', out, 0)).toThrow(/multiple of 4/);
        expect(() => decodeBase64Into('AA==AAAA', out, 0)).toThrow(/padding/);
    });
    it('chunks large payloads and checks the decoded size', () => {
        const bytes = new Uint8Array(200_000).map((_, i) => i & 255);
        const chunks = encodeChunks(bytes);
        expect(chunks.length).toBe(Math.ceil(200_000 / 49_152));
        for (const c of chunks)
            expect(c.length).toBeLessThanOrEqual(65_536);
        expect([...decodeChunks(chunks, 200_000).subarray(0, 10)]).toEqual([...bytes.subarray(0, 10)]);
        expect(() => decodeChunks(chunks, 199_999)).toThrow(/expected/);
    });
});
describe('mesh codec', () => {
    it('round-trips positions, indices, colors, uvs and face materials', () => {
        const d = cube();
        d.colors = new Float32Array(24).fill(0.5);
        d.uvs = new Float32Array(16).map((_, i) => i / 16);
        d.faceMaterials = new Uint8Array(12).map((_, i) => i % 2);
        const asset = encodeMesh('m', d, { materials: [{ preset: 'wood' }, { preset: 'metal' }] });
        expect(asset.vertexCount).toBe(8);
        expect(asset.triangleCount).toBe(12);
        const back = decodeMesh(asset);
        expect([...back.positions]).toEqual([...d.positions]);
        expect([...back.indices]).toEqual([...d.indices]);
        expect([...back.uvs]).toEqual([...d.uvs]);
        expect([...back.faceMaterials]).toEqual([...d.faceMaterials]);
        // Colors are stored as sRGB bytes: within quantisation error.
        for (const c of back.colors)
            expect(Math.abs(c - 0.5)).toBeLessThan(0.01);
    });
    it('refuses invalid data', () => {
        const d = cube();
        d.indices[0] = 99;
        expect(() => encodeMesh('m', d)).toThrow(/out of range/);
        const nan = cube();
        nan.positions[4] = Number.NaN;
        expect(() => encodeMesh('m', nan)).toThrow(/finite/);
        const slots = cube();
        slots.faceMaterials = new Uint8Array(12).fill(3);
        expect(() => encodeMesh('m', slots, { materials: [{}] })).toThrow(/slot/);
    });
    it('shares unchanged channels with the previous asset', () => {
        const d = cube();
        d.colors = new Float32Array(24).fill(1);
        const a = encodeMesh('m', d);
        const next = { ...d, positions: d.positions.slice() };
        next.positions[1] = 0.25;
        const b = encodeMeshUpdate(a, decodeMesh(a), next);
        expect(b.indices).toBe(a.indices);
        expect(b.colors).toBe(a.colors);
        expect(b.positions).not.toBe(a.positions);
    });
});
describe('mesh patches', () => {
    it('adds a mesh entity and validates the document', () => {
        const w = worldWithMesh();
        expect(Object.keys(w.meshes)).toEqual(['m-box']);
        expect(validateWorld(JSON.parse(JSON.stringify(w))).ok).toBe(true);
    });
    it('requires the mesh to exist and refuses to remove a mesh in use', () => {
        const missing = applyPatches(createWorld(), [{ op: 'add', entity: { id: 'x', shape: { kind: 'mesh', mesh: 'nope' } } }]);
        expect(missing.errors[0].message).toMatch(/mesh 'nope' does not exist/);
        const w = worldWithMesh();
        const r = applyPatches(w, [{ op: 'removeMesh', id: 'm-box' }]);
        expect(r.errors[0].message).toMatch(/still used by 'box'/);
    });
    it('rejects tampered payloads (size mismatch, bad index)', () => {
        const asset = encodeMesh('m', cube());
        const r1 = applyPatches(createWorld(), [{ op: 'setMesh', mesh: { ...asset, vertexCount: 9 } }]);
        expect(r1.errors[0].message).toMatch(/positions size/);
        const bad = cube();
        const idx = new Uint16Array(36).fill(0);
        idx[5] = 500;
        const tampered = { ...encodeMesh('m', bad), indices: encodeChunks(new Uint8Array(idx.buffer)) };
        const r2 = applyPatches(createWorld(), [{ op: 'setMesh', mesh: tampered }]);
        expect(r2.errors[0].message).toMatch(/invalid mesh data: index 500 out of range/);
        const r3 = applyPatches(createWorld(), [{ op: 'setMesh', mesh: { ...asset, positions: ['@@@@'] } }]);
        expect(r3.errors.length).toBe(1);
    });
    it('drops unused mesh assets when their entity is removed, and undo restores them', () => {
        const w = worldWithMesh();
        const removal = [{ op: 'remove', id: 'box' }];
        const r = applyPatches(w, removal);
        expect(r.world.meshes).toEqual({});
        const undo = invertPatches(w, r.applied);
        const back = applyPatches(r.world, undo);
        expect(back.errors).toEqual([]);
        expect(back.world.meshes['m-box']).toEqual(w.meshes['m-box']);
        expect(back.world.entities['box']).toEqual(w.entities['box']);
    });
    it('patchesBetween orders mesh additions before users and removals after', () => {
        const a = createWorld();
        const b = worldWithMesh();
        const forward = patchesBetween(a, b);
        expect(forward[0].op).toBe('setMesh');
        expect(applyPatches(a, forward).world).toEqual(b);
        // Switch the entity to a new mesh and drop the old one.
        const asset2 = encodeMesh('m-two', cube());
        const c = applyPatches(b, [{ op: 'setMesh', mesh: asset2 }, { op: 'update', id: 'box', set: { shape: { mesh: 'm-two' } } }, { op: 'removeMesh', id: 'm-box' }]).world;
        expect(Object.keys(c.meshes)).toEqual(['m-two']);
        const between = patchesBetween(b, c);
        expect(between.at(-1)).toEqual({ op: 'removeMesh', id: 'm-box' });
        expect(applyPatches(b, between, { atomic: true }).world).toEqual(c);
        expect(applyPatches(c, patchesBetween(c, b), { atomic: true }).world).toEqual(b);
    });
    it('clear drops every mesh', () => {
        const r = applyPatches(worldWithMesh(), [{ op: 'clear' }]);
        expect(r.world.meshes).toEqual({});
    });
    it('summaries describe meshes without leaking their data', () => {
        const text = summarizeWorld(worldWithMesh());
        expect(text).toMatch(/mesh 8v\/12t/);
        expect(text).not.toMatch(/AAAA/);
    });
});
describe('scatter points and locks', () => {
    it('counts painted points toward the scatter budget', () => {
        const r = applyPatches(createWorld(), [
            { op: 'add', entity: { id: 'grass', shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'cone' }, count: 1, area: [1, 1], points: [[0, 0, 0], [1, 0, 1]] } } },
        ]);
        expect(r.errors).toEqual([]);
        expect(summarizeWorld(r.world)).toMatch(/scatter 2x cone .*painted/);
    });
    it('marks locked entities in the summary', () => {
        const r = applyPatches(createWorld(), [{ op: 'add', entity: { id: 'tower', locked: true } }]);
        expect(summarizeWorld(r.world)).toMatch(/locked\(by user/);
    });
});
describe('user edit marks', () => {
    it('collects user-edited paths, follows renames and ignores agent edits', () => {
        const h = new History(createWorld());
        h.commit([{ op: 'add', entity: { id: 'tower' } }, { op: 'add', entity: { id: 'house' } }], 'agent build', 'agent');
        h.commit([{ op: 'update', id: 'tower', set: { transform: { position: [3, 0, 0] } } }], 'Move tower', 'user');
        h.commit([{ op: 'update', id: 'house', set: { material: { color: '#ff0000' } } }], 'agent recolor', 'agent');
        h.commit([{ op: 'rename', id: 'tower', newId: 'big-tower' }], 'Rename', 'user');
        const marks = userEditMarks(h.recentCommits(), { exists: (id) => Object.hasOwn(h.current.entities, id) });
        expect([...marks.keys()]).toEqual(['big-tower']);
        expect(marks.get('big-tower').paths).toEqual(['id', 'transform.position']);
        expect(marks.get('big-tower').age).toBe(0);
        const text = summarizeWorld(h.current, { userEdits: marks });
        expect(text).toMatch(/big-tower .*user-edited\(id,transform\.position, just now\)/);
        expect(text).toMatch(/user recently edited by hand \(newest first\): big-tower/);
    });
    it('detects overlapping property paths', () => {
        expect(overlappingPaths(['transform.position', 'material.color'], { transform: { scale: [1, 2, 1] } })).toEqual([]);
        expect(overlappingPaths(['transform.position'], { transform: { position: [0, 1, 0] } })).toEqual(['transform.position']);
        expect(overlappingPaths(['material.color'], { material: null })).toEqual(['material.color']);
    });
});
