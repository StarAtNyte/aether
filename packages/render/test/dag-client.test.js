import { describe, expect, it } from 'vitest';
import { buildClusterDag } from '../src/virtual/cluster-dag';
import { DagClient, dagBytes } from '../src/virtual/dag-client';
import { parseDagRequest, validateDag } from '../src/virtual/dag-protocol';
/** A small closed mesh: an octahedron subdivided once by hand (32 triangles). */
function mesh() {
    const positions = new Float32Array([1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]);
    const indices = Uint32Array.from([0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5]);
    return { positions, indices };
}
/** Fake worker that answers with `reply(request)` on the next tick. */
function fakeWorker(reply) {
    return () => {
        const w = {
            onmessage: null,
            onerror: null,
            terminate: () => undefined,
            postMessage(msg) {
                const req = msg;
                setTimeout(() => w.onmessage?.({ data: reply(req) }), 0);
            },
        };
        return w;
    };
}
describe('DAG protocol', () => {
    it('accepts well-formed requests and rejects out-of-range indices, NaN and wrong types', () => {
        const m = mesh();
        expect(parseDagRequest({ type: 'dag', id: 1, ...m })).not.toBeNull();
        expect(parseDagRequest({ type: 'dag', id: 1, positions: m.positions, indices: Uint32Array.from([0, 1, 99]) })).toBeNull();
        expect(parseDagRequest({ type: 'dag', id: 1, positions: Float32Array.from([0, 0, Number.NaN]), indices: Uint32Array.from([0, 0, 0]) })).toBeNull();
        expect(parseDagRequest({ type: 'dag', id: 1, positions: [0, 0, 0], indices: m.indices })).toBeNull();
        expect(parseDagRequest({ type: 'other', id: 1, ...m })).toBeNull();
    });
    it('validates hierarchies structurally', () => {
        const m = mesh();
        const dag = buildClusterDag(m.positions, m.indices);
        expect(validateDag(dag, 6)).toBe(dag);
        expect(validateDag(dag, 5)).toBeNull();
        expect(validateDag({ ...dag, indices: Uint32Array.from([0, 1, 1000]) }, 6)).toBeNull();
        expect(validateDag({ ...dag, roots: Uint32Array.from([dag.count + 3]) }, 6)).toBeNull();
        expect(validateDag({ ...dag, offsets: new Uint32Array(1) }, 6)).toBeNull();
        expect(validateDag(null, 6)).toBeNull();
    });
});
describe('DagClient', () => {
    it('builds inline without workers, caches by key and shares concurrent builds', async () => {
        const client = new DagClient({ createWorker: null });
        const m = mesh();
        const [a, b] = await Promise.all([client.build('k', m.positions, m.indices), client.build('k', m.positions, m.indices)]);
        expect(a).toBe(b);
        expect(client.peek('k')).toBe(a);
        expect(await client.build('k', m.positions, m.indices)).toBe(a);
        expect(dagBytes(a)).toBeGreaterThan(0);
        client.dispose();
        await expect(client.build('other', m.positions, m.indices)).rejects.toThrow(/disposed/);
    });
    it('uses the worker reply after validation and rejects corrupted replies', async () => {
        const m = mesh();
        const good = new DagClient({ createWorker: fakeWorker((req) => ({ type: 'dag', id: req.id, ok: true, dag: buildClusterDag(m.positions, m.indices) })) });
        const dag = await good.build('k', m.positions, m.indices);
        expect(dag.count).toBeGreaterThan(0);
        const bad = new DagClient({ createWorker: fakeWorker((req) => ({ type: 'dag', id: req.id, ok: true, dag: { ...buildClusterDag(m.positions, m.indices), indices: Uint32Array.from([0, 0, 999]) } })) });
        await expect(bad.build('k', m.positions, m.indices)).rejects.toThrow(/invalid/);
        const failing = new DagClient({ createWorker: fakeWorker((req) => ({ type: 'dag', id: req.id, ok: false, error: 'boom' })) });
        await expect(failing.build('k', m.positions, m.indices)).rejects.toThrow(/boom/);
    });
    it('times out a stuck worker and refuses oversized meshes', async () => {
        const silent = new DagClient({ createWorker: fakeWorker(() => null), timeoutMs: 100 });
        const m = mesh();
        await expect(silent.build('k', m.positions, m.indices)).rejects.toThrow(/longer than/);
        await expect(silent.build('big', new Float32Array(3 * 2_000_001), new Uint32Array(3))).rejects.toThrow(/too large/);
        silent.dispose();
    });
});
