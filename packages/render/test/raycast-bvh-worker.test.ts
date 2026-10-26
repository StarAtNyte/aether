import { afterEach, describe, expect, it, vi } from 'vitest';
import { BufferAttribute, PlaneGeometry } from 'three';
import { buildTriangleBvh } from '../src/geometry/raycast-bvh-build';
import { BvhBuildClient, type BvhWorker } from '../src/geometry/raycast-bvh-client';
import { accelerateRaycast, triangleBvh, warmTriangleBvh } from '../src/geometry/raycast-bvh';
import { Mesh, MeshBasicMaterial } from 'three';

function fixture() {
  const messages: Array<{ id: number; positions: Float32Array; index: Uint16Array | Uint32Array | null; triangles: number }> = [];
  const worker: BvhWorker = { onmessage: null, onerror: null, onmessageerror: null, terminate: vi.fn(),
    postMessage(message) { messages.push(structuredClone(message) as typeof messages[number]); } };
  const client = new BvhBuildClient(() => worker, 100, 50);
  function reply(at = 0) {
    const message = messages[at]!;
    const tree = buildTriangleBvh(message.positions, message.index, message.triangles, 0, 0);
    const result = { boxes: tree.boxes, nodes: tree.nodes, tris: tree.tris, nodeCount: tree.nodeCount, triangleCount: tree.triangleCount };
    worker.onmessage?.({ data: { id: message.id, result } } as MessageEvent);
    return result;
  }
  return { client, worker, messages, reply };
}
afterEach(() => { vi.useRealTimers(); });
describe('worker BVH warmup', () => {
  it('installs byte-identical trees with original live buffers and deduplicates shared geometry', async () => {
    const f = fixture(), g = new PlaneGeometry(10, 10, 32, 32);
    const p = g.getAttribute('position') as BufferAttribute;
    const pending = warmTriangleBvh(g, f.client);
    expect(warmTriangleBvh(g, f.client)).toBe(pending);
    expect(f.messages).toHaveLength(1);
    expect(f.messages[0]!.positions).not.toBe(p.array);
    const result = f.reply(); await pending;
    const tree = triangleBvh(g)!;
    expect(tree.boxes).toBe(result.boxes);
    expect(tree.positions).toBe(p.array);
    expect(tree.index).toBe(g.index!.array);
    expect(p.array.byteLength).toBeGreaterThan(0);
    const reference = buildTriangleBvh(tree.positions, tree.index, tree.triangleCount, 0, 0);
    expect(tree.boxes).toEqual(reference.boxes); expect(tree.nodes).toEqual(reference.nodes); expect(tree.tris).toEqual(reference.tris);
    f.client.dispose(); g.dispose();
  });
  it('ignores edits, replaced attributes and disposed geometries while preserving synchronous picks', async () => {
    for (const change of ['edit', 'replace', 'dispose', 'pick']) {
      const f = fixture(), g = new PlaneGeometry(10, 10, 32, 32);
      const pending = warmTriangleBvh(g, f.client);
      const p = g.getAttribute('position') as BufferAttribute;
      if (change === 'edit') { p.setZ(0, 20); p.needsUpdate = true; }
      if (change === 'replace') g.setAttribute('position', p.clone());
      if (change === 'dispose') g.dispose();
      const picked = change === 'pick' ? triangleBvh(g) : null;
      const result = f.reply(); await pending;
      const tree = triangleBvh(g)!;
      expect(tree.boxes).not.toBe(result.boxes);
      if (picked) expect(tree).toBe(picked);
      if (change === 'edit') expect(Math.max(...tree.boxes)).toBe(20);
      f.client.dispose(); g.dispose();
    }
  });
  it('copies only one queued input at a time and releases an idle worker', async () => {
    vi.useFakeTimers(); const f = fixture();
    const g = new PlaneGeometry(10, 10, 32, 32), p = g.getAttribute('position').array as Float32Array, index = g.index!.array as Uint16Array;
    const a = f.client.build(p, index, index.length / 3), b = f.client.build(p, index, index.length / 3);
    expect(f.messages).toHaveLength(1); f.reply(); await a;
    expect(f.messages).toHaveLength(2); f.reply(1); await b;
    await vi.advanceTimersByTimeAsync(50); expect(f.worker.terminate).toHaveBeenCalledOnce();
    f.client.dispose(); g.dispose();
  });
  it('settles all requests on malformed replies, timeout or shutdown', async () => {
    vi.useFakeTimers();
    for (const failure of ['malformed', 'timeout', 'dispose']) {
      const f = fixture(), p = new Float32Array(9), index = new Uint16Array([0, 1, 2]);
      const a = f.client.build(p, index, 1), b = f.client.build(p, index, 1);
      if (failure === 'malformed') f.worker.onmessage?.({ data: { id: f.messages[0]!.id, result: {} } } as MessageEvent);
      if (failure === 'timeout') await vi.advanceTimersByTimeAsync(100);
      if (failure === 'dispose') f.client.dispose();
      expect(await a).toBeNull(); expect(await b).toBeNull(); expect(f.worker.terminate).toHaveBeenCalledOnce(); f.client.dispose();
    }
  });
  it('does not start idle construction after geometry disposal', () => {
    const g = new PlaneGeometry(10, 10, 32, 32), mesh = new Mesh(g, new MeshBasicMaterial());
    let idle!: () => void;
    expect(accelerateRaycast(mesh, callback => { idle = callback; })).toBe(true);
    g.dispose();
    const position = vi.spyOn(g, 'getAttribute'); idle(); expect(position).not.toHaveBeenCalled();
    mesh.material.dispose();
  });
  it('retains idle construction when workers fail instead of losing picking acceleration', async () => {
    vi.useFakeTimers(); const f = fixture(), g = new PlaneGeometry(10, 10, 32, 32);
    const pending = warmTriangleBvh(g, f.client);
    f.client.dispose(); await vi.runAllTimersAsync(); await pending;
    const tree = triangleBvh(g)!;
    expect(tree.triangleCount).toBe(2048); expect(tree.positions).toBe(g.getAttribute('position').array);
    g.dispose();
  });
});
