import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoliageAtlasClient } from '../src/materials/foliage-atlas-client';
function fixture(timeout = 30000) {
  const messages: Array<{ id: number; size: number; base: string | null }> = [];
  const worker = { onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    onmessageerror: null as ((event: MessageEvent) => void) | null,
    postMessage: (message: unknown) => messages.push(message as typeof messages[number]), terminate: vi.fn() };
  const factory = vi.fn(() => worker);
  const client = new FoliageAtlasClient(factory, timeout);
  const reply = (id: number, data: unknown) => worker.onmessage?.({ data: { id, data } } as MessageEvent);
  return { client, worker, messages, factory, reply };
}
afterEach(() => vi.useRealTimers());
describe('foliage atlas worker client', () => {
  it('starts lazily, matches out-of-order replies and takes ownership of the exact pixel buffer', async () => {
    const f = fixture();
    expect(f.factory).not.toHaveBeenCalled();
    const a = f.client.compose('fern', 32, '/foliage/'), b = f.client.compose('grass', 64, null);
    expect(f.factory).toHaveBeenCalledTimes(1);
    const pa = new Uint8Array(32 * 32 * 4), pb = new Uint8Array(64 * 64 * 4);
    pa[0] = 123; pb[0] = 234;
    f.reply(f.messages[1]!.id, pb.buffer);
    f.reply(f.messages[0]!.id, pa.buffer);
    expect((await a)?.buffer).toBe(pa.buffer);
    expect((await b)?.[0]).toBe(234);
    f.client.dispose();
  });
  it('invalid pixels fail all outstanding requests and disable the broken worker', async () => {
    const f = fixture(), a = f.client.compose('fern', 32, null), b = f.client.compose('grass', 32, null);
    f.reply(f.messages[0]!.id, new ArrayBuffer(1));
    expect(await a).toBeNull(); expect(await b).toBeNull();
    expect(f.worker.terminate).toHaveBeenCalledOnce();
    expect(await f.client.compose('fern', 32, null)).toBeNull();
    expect(f.factory).toHaveBeenCalledTimes(1);
  });
  it('allows unsupported photos to fall back and survives stale replies after reset', async () => {
    const f = fixture(), a = f.client.compose('fern', 32, 'old/');
    const old = f.worker.onmessage!, oldId = f.messages[0]!.id;
    f.client.reset(); expect(await a).toBeNull();
    const b = f.client.compose('fern', 32, 'new/');
    old({ data: { id: oldId, data: new ArrayBuffer(32 * 32 * 4) } } as MessageEvent);
    f.reply(f.messages[1]!.id, null);
    expect(await b).toBeNull();
    f.client.dispose();
  });
  it('uses a progress timeout so short queued jobs do not expire behind each other', async () => {
    vi.useFakeTimers();
    const f = fixture(100), a = f.client.compose('fern', 32, null), b = f.client.compose('grass', 32, null);
    await vi.advanceTimersByTimeAsync(90);
    f.reply(f.messages[0]!.id, new ArrayBuffer(32 * 32 * 4));
    await a;
    await vi.advanceTimersByTimeAsync(90);
    expect(f.worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    expect(await b).toBeNull();
    expect(f.worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('falls back on worker creation/message errors and rejects invalid sizes before allocation', async () => {
    const factory = vi.fn(() => { throw new Error('worker blocked'); });
    const client = new FoliageAtlasClient(factory);
    expect(await client.compose('fern', 32, null)).toBeNull();
    expect(await client.compose('fern', 32, null)).toBeNull();
    expect(factory).toHaveBeenCalledTimes(1);
    const f = fixture();
    for (const size of [0, 33, 2048, NaN, Infinity]) expect(await f.client.compose('fern', size, null)).toBeNull();
    expect(f.factory).not.toHaveBeenCalled();
    const pending = f.client.compose('fern', 32, null);
    f.worker.onmessageerror?.({} as MessageEvent);
    expect(await pending).toBeNull();
    expect(f.worker.terminate).toHaveBeenCalledOnce();
  });
  it('disposal settles outstanding work and never starts another worker', async () => {
    const f = fixture(), pending = f.client.compose('fern', 32, null);
    f.client.dispose(); f.client.dispose();
    expect(await pending).toBeNull();
    expect(await f.client.compose('fern', 32, null)).toBeNull();
    expect(f.worker.terminate).toHaveBeenCalledOnce();
    expect(await new FoliageAtlasClient(null).compose('fern', 32, null)).toBeNull();
  });
});
