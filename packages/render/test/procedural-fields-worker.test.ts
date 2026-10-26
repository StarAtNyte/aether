import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
beforeEach(() => vi.resetModules());
afterEach(() => vi.useRealTimers());
async function fixture() {
  const client = await import('../src/gpu/procedural-fields-client');
  const fields = await import('../src/gpu/procedural-fields');
  const worker = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: Event) => void) | null,
    onmessageerror: null as ((e: MessageEvent) => void) | null,
    postMessage: vi.fn(), terminate: vi.fn(),
  };
  const factory = vi.fn(() => worker);
  return { client, fields, worker, factory };
}
describe('procedural noise preparation', () => {
  it('shares concurrent warmups, publishes exact fields, and terminates the worker', async () => {
    const f = await fixture();
    const a = f.client.warmProceduralFields(f.factory), b = f.client.warmProceduralFields(f.factory);
    expect(a).toBe(b); expect(f.factory).toHaveBeenCalledOnce();
    expect(f.worker.postMessage).toHaveBeenCalledWith('prepare');
    const expected = f.fields.createProceduralFields();
    f.worker.onmessage!(new MessageEvent('message', { data: expected }));
    expect(await a).toBe(true);
    expect(f.fields.cloudNoiseField(false)).toBe(expected.cloud);
    expect(f.fields.cloudNoiseField(true)).toBe(expected.cirrus);
    expect(f.fields.materialNoiseField()).toBe(expected.material);
    expect(f.worker.terminate).toHaveBeenCalledOnce();
    expect(f.worker.onmessage).toBeNull();
    expect(await f.client.warmProceduralFields(f.factory)).toBe(true);
    expect(f.factory).toHaveBeenCalledOnce();
  });
  it('keeps already-used fallback fields when an asynchronous result arrives', async () => {
    const f = await fixture();
    const pending = f.client.warmProceduralFields(f.factory);
    const cloud = f.fields.cloudNoiseField(false), material = f.fields.materialNoiseField();
    const expected = f.fields.createProceduralFields();
    expect(cloud).toEqual(expected.cloud); expect(material).toEqual(expected.material);
    f.worker.onmessage!(new MessageEvent('message', { data: expected }));
    expect(await pending).toBe(true);
    expect(f.fields.cloudNoiseField(false)).toBe(cloud);
    expect(f.fields.materialNoiseField()).toBe(material);
  });
  it('rejects malformed data atomically and preserves deterministic synchronous fallback', async () => {
    const f = await fixture(), expected = f.fields.createProceduralFields();
    const pending = f.client.warmProceduralFields(f.factory);
    f.worker.onmessage!(new MessageEvent('message', { data: { ...expected, material: new Uint8Array(4) } }));
    expect(await pending).toBe(false); expect(f.fields.proceduralFieldsReady()).toBe(false);
    expect(f.fields.cloudNoiseField(true)).toEqual(expected.cirrus);
    expect(f.fields.materialNoiseField()).toEqual(expected.material);
    expect(f.worker.terminate).toHaveBeenCalledOnce();
  });
  it('bounds worker waiting and ignores a late reply after timeout', async () => {
    vi.useFakeTimers(); const f = await fixture();
    const pending = f.client.warmProceduralFields(f.factory), reply = f.worker.onmessage!;
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toBe(false); expect(f.worker.terminate).toHaveBeenCalledOnce();
    reply(new MessageEvent('message', { data: f.fields.createProceduralFields() }));
    expect(f.fields.proceduralFieldsReady()).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['error', 'messageerror', 'post', 'constructor'] as const)('falls back after %s failures', async kind => {
    const f = await fixture();
    if (kind === 'post') f.worker.postMessage.mockImplementation(() => { throw new Error('post failed'); });
    const pending = f.client.warmProceduralFields(kind === 'constructor' ? () => { throw new Error('blocked'); } : f.factory);
    if (kind === 'error') f.worker.onerror!(new Event('error'));
    if (kind === 'messageerror') f.worker.onmessageerror!(new MessageEvent('messageerror'));
    expect(await pending).toBe(false); expect(f.fields.proceduralFieldsReady()).toBe(false);
    if (kind !== 'constructor') expect(f.worker.terminate).toHaveBeenCalledOnce();
  });
  it('does not require worker support', async () => {
    const f = await fixture(); expect(await f.client.warmProceduralFields(null)).toBe(false);
    const cloud = f.fields.cloudNoiseField(false);
    expect(f.fields.cloudNoiseField(false)).toBe(cloud);
  });
});
