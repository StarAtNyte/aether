import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, CanvasTexture, Group, Mesh, MeshStandardMaterial } from 'three';
import { CAST } from '@aether/assets';
import type { ModelCache } from '../src/geometry/model-loader';
import { TintBakeClient, type TintBakeWorker } from '../src/characters/tint-bake-client';
import { CharacterSystem } from '../src/characters/system';
import * as tint from '../src/characters/tint';

function fixture() {
  const messages: Array<{ id: number }> = [];
  const worker: TintBakeWorker = { onmessage: null, onerror: null, onmessageerror: null, terminate: vi.fn(), postMessage(message) { messages.push(message as { id: number }); } };
  const client = new TintBakeClient(() => worker, 100, 50);
  const image = { width: 2, height: 2 } as ImageBitmap;
  function reply(at = 0) { const result = { width: 2, height: 2, pixels: new Uint8ClampedArray(16) }; worker.onmessage?.({ data: { id: messages[at]!.id, result } } as MessageEvent); return result; }
  return { client, worker, image, messages, reply };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('bounded tint baking', () => {
  it('yields before synchronous fallback so failed variants cannot form one long microtask chain', async () => {
    vi.useFakeTimers(); const source = new MeshStandardMaterial();
    const clone = vi.spyOn(source, 'clone');
    const pending = tint.tintedMaterialAsync(source, 'hair', { hair: '#234567' }, tint.DEFAULT_REFS, null);
    await Promise.resolve(); expect(clone).not.toHaveBeenCalled();
    await vi.runAllTimersAsync(); const result = await pending;
    expect(clone).toHaveBeenCalledOnce(); expect(result.texture).toBeNull(); expect(result.material).not.toBe(source);
    result.material.dispose(); source.dispose();
  });
  it('submits one bitmap at a time, returns validated pixels and terminates when idle', async () => {
    vi.useFakeTimers(); const f = fixture();
    const a = f.client.bake(f.image, null, []), b = f.client.bake(f.image, null, []);
    expect(f.messages).toHaveLength(1); const x = f.reply(); expect(await a).toBe(x);
    expect(f.messages).toHaveLength(2); f.reply(1); await b;
    await vi.advanceTimersByTimeAsync(50); expect(f.worker.terminate).toHaveBeenCalledOnce(); f.client.dispose();
  });
  it('settles queued jobs on timeout, malformed replies, crashes and shutdown', async () => {
    vi.useFakeTimers();
    for (const failure of ['timeout', 'malformed', 'error', 'dispose']) {
      const f = fixture(), a = f.client.bake(f.image, null, []), b = f.client.bake(f.image, null, []);
      if (failure === 'timeout') await vi.advanceTimersByTimeAsync(100);
      if (failure === 'malformed') f.worker.onmessage?.({ data: { id: f.messages[0]!.id, result: { width: 2, height: 2, pixels: new Uint8ClampedArray(4) } } } as MessageEvent);
      if (failure === 'error') f.worker.onerror?.({} as ErrorEvent);
      if (failure === 'dispose') f.client.dispose();
      expect(await a).toBeNull(); expect(await b).toBeNull(); expect(f.client.available).toBe(false);
      expect(f.worker.terminate).toHaveBeenCalledOnce(); f.client.dispose();
    }
  });
  it('falls back when workers are unavailable or bitmap cloning fails', async () => {
    const absent = new TintBakeClient(null); expect(await absent.bake({} as ImageBitmap, null, [])).toBeNull(); absent.dispose();
    const f = fixture(); f.worker.postMessage = () => { throw new Error('DataCloneError'); };
    expect(await f.client.bake(f.image, null, [])).toBeNull(); expect(f.worker.terminate).toHaveBeenCalledOnce(); f.client.dispose();
  });
});

it('disposes a tint that finishes after its variant was released', async () => {
  const system = new CharacterSystem({ models: {} as ModelCache });
  const internal = system as unknown as { acquireTint(key: string, body: typeof CAST[number], root: Group, value: tint.Tint, base: undefined): { ready: Promise<void> }; releaseTintKey(key: string): void };
  const { masks: _masks, ...body } = CAST[0]!;
  const source = new MeshStandardMaterial(), geometry = new BoxGeometry(), root = new Group(); root.add(new Mesh(geometry, source));
  const material = source.clone(), texture = new CanvasTexture({ width: 1, height: 1 } as HTMLCanvasElement);
  const disposeMaterial = vi.spyOn(material, 'dispose'), disposeTexture = vi.spyOn(texture, 'dispose');
  let finish!: (value: Awaited<ReturnType<typeof tint.tintedMaterialAsync>>) => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  vi.spyOn(tint, 'tintedMaterialAsync').mockImplementation(() => { started(); return new Promise(resolve => { finish = resolve; }); });
  const set = internal.acquireTint('variant', body, root, { top: '#ff0000' }, undefined);
  await entered; internal.releaseTintKey('variant'); finish({ material, texture }); await set.ready;
  expect(disposeMaterial).toHaveBeenCalledOnce(); expect(disposeTexture).toHaveBeenCalledOnce();
  system.dispose(); geometry.dispose(); source.dispose();
});
