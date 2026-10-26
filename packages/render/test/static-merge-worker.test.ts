import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, BufferAttribute, BufferGeometry, DataUtils, Float16BufferAttribute, Group, InterleavedBuffer, InterleavedBufferAttribute, Matrix4, Mesh, MeshBasicMaterial } from 'three';
import { StaticMerges, mergeGeometries } from '../src/sync/static-merges';
import { MergeBuildClient, type MergeWorker } from '../src/sync/merge-client';
import { mergeRequest, readMergeOutput, writeMergeOutput, type MergeRequest } from '../src/sync/merge-wire';
import { runMergeRequest } from '../src/sync/merge-work';
import { expandWithLightmap } from '../src/sync/lightmap-uv';
import { createEntityNode } from '../src/sync/entity-node';
import { BATCHED_LAYER } from '../src/sync/static-batches';
import { world } from './helpers';

function fakeBuilder() {
  const messages: Array<{ id: number; request: MergeRequest; receive: (event: MessageEvent) => void }> = [], workers: MergeWorker[] = [];
  const client = new MergeBuildClient(() => {
    const worker: MergeWorker = { onmessage: null, onerror: null, onmessageerror: null, terminate: vi.fn(), postMessage(message) {
      const data = structuredClone(message) as { id: number; request: MergeRequest }; messages.push({ ...data, receive: worker.onmessage! });
    } }; workers.push(worker); return worker;
  }, 100, 50);
  const reply = (at: number): void => { const m = messages[at]!; m.receive({ data: { id: m.id, output: runMergeRequest(m.request) } } as MessageEvent); };
  return { client, messages, workers, reply };
}
function scene(count = 4) {
  const worker = fakeBuilder(), geometry = new BoxGeometry(), material = new MeshBasicMaterial(), parent = new Group(), changed = vi.fn();
  const w = world(Array.from({ length: count }, (_, i) => ({ id: `worker-part-${i}`, shape: { kind: 'procedural', generator: 'test' } })));
  const nodes = Object.values(w.entities).map((entity, i) => {
    const node = createEntityNode(entity, false); node.object.position.x = i; node.object.updateMatrix();
    const mesh = new Mesh(geometry, material); node.content.add(mesh);
    node.bindings.push({ mesh, partMaterial: {}, hasColors: false, doubleSided: false, materialKey: 'shared', seeThrough: false, ownedMaterial: null });
    node.geometryKeys.push('shared'); parent.add(node.object); return node;
  }); parent.updateMatrixWorld(true);
  const merges = new StaticMerges({ client: worker.client, changed });
  const drawn = (): Mesh => parent.children.find(o => o.name === 'aether:merged') as Mesh;
  return { ...worker, geometry, material, parent, nodes, merges, changed, drawn, dispose() { merges.dispose(); geometry.dispose(); material.dispose(); } };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('worker merge lifecycle', () => {
  it('keeps counters exact when publication interleaves with removals in another group', async () => {
    const f = scene(8); for (const node of f.nodes.slice(4)) node.bindings[0]!.materialKey = 'second';
    f.merges.rebuild(f.nodes); expect(f.merges.pending).toBe(2);
    f.reply(0); await Promise.resolve(); expect(f.merges.count).toBe(1); expect(f.merges.drawCallsSaved).toBe(3);
    f.nodes[0]!.object.visible = false; f.merges.update(); expect(f.merges.count).toBe(0);
    f.reply(1); await Promise.resolve(); expect(f.merges.count).toBe(1); expect(f.merges.drawCallsSaved).toBe(3);
    f.reply(2); await f.merges.idle(); expect(f.merges.count).toBe(2); expect(f.merges.drawCallsSaved).toBe(5);
    f.merges.rebuild(f.nodes.slice(4)); expect(f.merges.count).toBe(1); expect(f.merges.drawCallsSaved).toBe(3);
    f.merges.clear(); expect(f.merges.count).toBe(0); expect(f.merges.drawCallsSaved).toBe(0); f.dispose();
  });
  it('retains matching in-flight groups and publishes exact geometry without detaching sources', async () => {
    const f = scene(); f.merges.rebuild(f.nodes);
    expect(f.merges.pending).toBe(1); expect(f.merges.count).toBe(0); expect(f.drawn().geometry.getAttribute('position')).toBeUndefined();
    expect(f.merges.rebuild(f.nodes)).toBe(false); expect(f.messages).toHaveLength(1);
    expect(f.nodes.every(n => n.bindings[0]!.mesh.layers.isEnabled(BATCHED_LAYER))).toBe(true);
    const input = f.messages[0]!.request; expect(input.geometries).toHaveLength(1);
    f.reply(0); await f.merges.idle();
    expect(f.merges.count).toBe(1); expect(f.merges.drawCallsSaved).toBe(3); expect(f.merges.pending).toBe(0);
    const reference = mergeGeometries(f.nodes.map(n => ({ geometry: n.bindings[0]!.mesh.geometry, rel: Float64Array.from(n.bindings[0]!.mesh.matrixWorld.elements) })));
    expect(writeMergeOutput(f.drawn().geometry)).toEqual(writeMergeOutput(reference));
    expect(f.geometry.getAttribute('position').array.byteLength).toBeGreaterThan(0); expect(f.changed).toHaveBeenCalled();
    reference.dispose(); f.dispose();
  });
  it('cancels cleared jobs and ignores old replies after a new group takes ownership', async () => {
    const f = scene(); f.merges.rebuild(f.nodes); f.merges.clear();
    expect(f.merges.pending).toBe(0); expect(f.nodes.every(n => n.bindings[0]!.mesh.layers.isEnabled(0))).toBe(true);
    f.merges.rebuild(f.nodes); f.reply(0); await Promise.resolve();
    expect(f.merges.count).toBe(0); expect(f.merges.pending).toBe(1);
    f.reply(1); await f.merges.idle(); expect(f.merges.count).toBe(1);
    expect(f.parent.children.filter(o => o.name === 'aether:merged')).toHaveLength(1); f.dispose();
  });
  it('evicts moved members while pending and rebuilds only the unchanged remainder', async () => {
    const f = scene(); f.merges.rebuild(f.nodes);
    f.nodes[0]!.object.position.x += 2; f.nodes[0]!.object.updateMatrix(); f.parent.updateMatrixWorld(true); f.merges.update();
    expect(f.nodes[0]!.bindings[0]!.mesh.layers.isEnabled(0)).toBe(true);
    f.reply(0); await Promise.resolve(); expect(f.messages).toHaveLength(2);
    f.reply(1); await f.merges.idle(); expect(f.merges.drawCallsSaved).toBe(2); f.dispose();
  });
  it('rejects changed attribute versions and rebuilds from the current data', async () => {
    const f = scene(); f.merges.rebuild(f.nodes);
    const p = f.geometry.getAttribute('position') as BufferAttribute; p.setX(0, 100); p.needsUpdate = true;
    f.reply(0); await Promise.resolve(); f.merges.update();
    expect(f.merges.pending).toBe(1); expect(f.messages).toHaveLength(2);
    f.reply(1); await f.merges.idle(); expect(f.drawn().geometry.boundingBox!.max.x).toBe(103); f.dispose();
  });
  it('expands baked lightmap UVs off-thread and cancels superseded lightmap work', async () => {
    const f = scene(); f.merges.rebuild(f.nodes); f.reply(0); await f.merges.idle();
    const original = f.drawn().geometry, uv = new Map(f.nodes.map((n, i) => [n.bindings[0]!.mesh, new Float32Array(f.geometry.index!.count * 2).fill(i / 4)]));
    const source = { uv: (mesh: Mesh) => uv.get(mesh) ?? null, standalone: vi.fn() };
    f.merges.setLightmap(source); expect(f.drawn().geometry).toBe(original); expect(source.standalone).not.toHaveBeenCalled();
    f.reply(1); await f.merges.idle();
    expect(f.merges.count).toBe(1); expect(f.merges.drawCallsSaved).toBe(3);
    const expected = expandWithLightmap(original, Float32Array.from([...uv.values()].flatMap(a => Array.from(a))));
    expect(writeMergeOutput(f.drawn().geometry)).toEqual(writeMergeOutput(expected));
    f.merges.setLightmap(source); f.merges.setLightmap(null); f.reply(2); await Promise.resolve(); f.reply(3); await f.merges.idle();
    expect(f.drawn().geometry.index).not.toBeNull(); expect(f.drawn().geometry.getAttribute('aetherLM')).toBeUndefined();
    expect(f.merges.count).toBe(1); expect(f.merges.drawCallsSaved).toBe(3);
    expected.dispose(); f.dispose();
  });
  it('finishes captures atomically and ignores the canceled worker result', async () => {
    const f = scene(); f.merges.rebuild(f.nodes);
    f.merges.synchronous(() => f.merges.update()); const geometry = f.drawn().geometry;
    expect(f.merges.pending).toBe(0); expect(f.merges.count).toBe(1);
    f.reply(0); await Promise.resolve(); expect(f.drawn().geometry).toBe(geometry); f.dispose();
  });
  it('yields to the original merge path after a worker timeout', async () => {
    vi.useFakeTimers(); const f = scene(); f.merges.rebuild(f.nodes);
    await vi.advanceTimersByTimeAsync(100); await vi.runAllTimersAsync(); await f.merges.idle();
    expect(f.merges.count).toBe(1); expect(f.merges.pending).toBe(0); expect(f.client.available).toBe(false); f.dispose();
  });
});

describe('merge attribute wire format', () => {
  it('preserves normalized, interleaved and half-float getter semantics byte for byte', () => {
    for (const half of [false, true]) {
      const g = new BufferGeometry(), data = new Float32Array([1, 2, 3, 99, 4, 5, 6, 99, 7, 8, 9, 99]);
      g.setAttribute('position', half ? new Float16BufferAttribute(Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9], DataUtils.toHalfFloat), 3)
        : new InterleavedBufferAttribute(new InterleavedBuffer(data, 4), 3, 0));
      g.setAttribute('normal', new BufferAttribute(new Int8Array([0, 0, 127, 0, 127, 0, 127, 0, 0]), 3, true));
      g.setAttribute('uv', new BufferAttribute(new Uint16Array([0, 65535, 32767, 1, 123, 321]), 2, true));
      g.setAttribute('color', new BufferAttribute(new Uint8Array([255, 127, 0, 12, 13, 14, 2, 3, 4]), 3, true)); g.setIndex([0, 1, 2]);
      const members = [{ geometry: g, rel: Float64Array.from(new Matrix4().makeShear(.3, .1, 0, .2, 0, .1).elements) }];
      const request = mergeRequest(members, null)!; expect(request).not.toBeNull();
      const output = readMergeOutput(runMergeRequest(structuredClone(request)), request)!;
      const reference = mergeGeometries(members); expect(writeMergeOutput(output)).toEqual(writeMergeOutput(reference));
      output.dispose(); reference.dispose(); g.dispose();
    }
  });
  it('retains custom accessors on the original path and rejects malformed outputs', () => {
    const g = new BoxGeometry(), members = [{ geometry: g, rel: Float64Array.from(new Matrix4().elements) }], request = mergeRequest(members, null)!;
    expect(readMergeOutput({}, request)).toBeNull();
    const p = g.getAttribute('position'); p.getX = () => 123; expect(mergeRequest(members, null)).toBeNull(); g.dispose();
  });
  it('drops canceled queued input before it can be copied into the worker', async () => {
    const f = fakeBuilder(), g = new BoxGeometry(), request = mergeRequest([{ geometry: g, rel: Float64Array.from(new Matrix4().elements) }], null)!;
    const a = f.client.build(request), b = f.client.build(request); b.cancel(); expect(await b.promise).toBeNull();
    expect(f.messages).toHaveLength(1); f.reply(0); const result = await a.promise; expect(result).not.toBeNull();
    expect(f.messages).toHaveLength(1); result!.dispose(); f.client.dispose(); g.dispose();
  });
});
