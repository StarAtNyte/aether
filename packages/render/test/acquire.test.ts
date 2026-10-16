/**
 * Adapter and device acquisition: retries over a null adapter, per-request time limit, the software adapter only on
 * request, and a device request that falls back from raised limits to defaults.
 */
import { describe, expect, it } from 'vitest';
import { ADAPTER_REQUESTS, acquireAdapter, acquireDevice, deviceRequest, type AdapterLike, type GpuLike } from '../src/gpu/acquire';
import { policyReason } from '../src/gpu/backend';

const noSleep = (): Promise<void> => Promise.resolve();

function adapter(extra: Partial<AdapterLike> = {}): AdapterLike {
  return { features: new Set(['timestamp-query', 'chromium-experimental-foo']), limits: { maxTextureArrayLayers: 2048, maxSamplersPerShaderStage: 16, maxBogus: 5, maxBufferSize: 0 }, requestDevice: async () => ({}), ...extra };
}

describe('acquireAdapter', () => {
  it('asks again after a null adapter and reports what happened', async () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    const a = adapter();
    let calls = 0;
    const gpu: GpuLike = {
      requestAdapter: async (o) => {
        seen.push(o);
        return ++calls < 4 ? null : a;
      },
    };
    const r = await acquireAdapter(gpu, { sleep: noSleep });
    expect(r.adapter).toBe(a);
    expect(r.attempts).toBe(4);
    // Round one tries every option set, round two starts again from the discrete GPU.
    expect(seen.slice(0, 4)).toEqual([...ADAPTER_REQUESTS, ADAPTER_REQUESTS[0]]);
    expect(r.events.filter((e) => e.endsWith('none'))).toHaveLength(3);
    expect(r.events.at(-1)).toContain('ok');
  });

  it('gives up after the rounds, without the software adapter unless it is allowed', async () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    const gpu: GpuLike = { requestAdapter: async (o) => (seen.push(o), null) };
    const r = await acquireAdapter(gpu, { sleep: noSleep, rounds: 2 });
    expect(r.adapter).toBeNull();
    expect(r.attempts).toBe(2 * ADAPTER_REQUESTS.length);
    expect(seen.some((o) => o?.['forceFallbackAdapter'] === true)).toBe(false);
    const soft = adapter({ isFallbackAdapter: true });
    const gpu2: GpuLike = { requestAdapter: async (o) => (o?.['forceFallbackAdapter'] === true ? soft : null) };
    const r2 = await acquireAdapter(gpu2, { sleep: noSleep, rounds: 1, allowSoftwareAdapter: true });
    expect(r2.adapter).toBe(soft);
    expect(r2.options).toEqual({ forceFallbackAdapter: true });
  });

  it('survives a request that throws or never answers', async () => {
    const a = adapter();
    let calls = 0;
    const gpu: GpuLike = {
      requestAdapter: () => {
        calls++;
        if (calls === 1) return Promise.reject(new Error('driver busy'));
        if (calls === 2) return new Promise(() => undefined);
        return Promise.resolve(a);
      },
    };
    const r = await acquireAdapter(gpu, { sleep: noSleep, requestTimeoutMs: 100 });
    expect(r.adapter).toBe(a);
    expect(r.events[0]).toContain('driver busy');
    expect(r.events[1]).toContain('timed out');
  });

  it('waits between rounds with the given back-off', async () => {
    const waits: number[] = [];
    const gpu: GpuLike = { requestAdapter: async () => null };
    await acquireAdapter(gpu, { sleep: async (ms) => void waits.push(ms), rounds: 3, delaysMs: [10, 20] });
    expect(waits).toEqual([10, 20]);
  });
});

describe('acquireDevice', () => {
  it('requests the usable features and the adapter limits', () => {
    const req = deviceRequest(adapter());
    expect(req.requiredFeatures).toEqual(['timestamp-query']);
    expect(req.requiredLimits).toEqual({ maxTextureArrayLayers: 2048, maxSamplersPerShaderStage: 16 });
  });

  it('falls back from raised limits to features only to defaults', async () => {
    const asked: unknown[] = [];
    const a = adapter({
      requestDevice: async (d) => {
        asked.push(d);
        if (d?.requiredLimits || d?.requiredFeatures) throw new Error('refused');
        return { features: new Set<string>() };
      },
    });
    const r = await acquireDevice(a);
    expect(r.level).toBe('default');
    expect(r.device).not.toBeNull();
    expect(asked).toHaveLength(3);
    expect(r.events).toHaveLength(3);
  });

  it('returns no device when every request is refused', async () => {
    const r = await acquireDevice(adapter({ requestDevice: async () => Promise.reject(new Error('lost')) }));
    expect(r.device).toBeNull();
    expect(r.level).toBe('none');
  });
});

describe('policyReason', () => {
  const env = { webgpuAvailable: true, webgpuBlocked: false, firefox: false, linux: false };
  it('names why WebGL2 was picked', () => {
    expect(policyReason('webgl2', env, 'webgl2')).toBe('requested');
    expect(policyReason('webgl2', env, 'webgl2', 'device-lost')).toBe('device-lost');
    expect(policyReason('auto', { ...env, webgpuAvailable: false }, 'webgl2')).toBe('no-webgpu');
    expect(policyReason('auto', { ...env, webgpuBlocked: true }, 'webgl2')).toBe('blocked-after-crash');
    expect(policyReason('auto', { ...env, firefox: true, linux: true }, 'webgl2')).toBe('firefox-policy');
    expect(policyReason('auto', env, 'webgpu')).toBe('webgpu');
  });
});
