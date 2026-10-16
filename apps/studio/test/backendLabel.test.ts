import { describe, expect, it } from 'vitest';
import type { BackendReport } from '@aether/render';
import { backendHeadline, backendWhy } from '../src/lib/backendLabel';

const base: BackendReport = { requested: 'auto', active: 'webgpu', reason: 'webgpu', adapterAttempts: 1, softwareAdapter: false, deviceLevel: 'raised', events: [] };

describe('backend label', () => {
  it('names the backend and flags a software adapter', () => {
    expect(backendHeadline(base)).toBe('WebGPU');
    expect(backendHeadline({ ...base, active: 'webgl2' })).toBe('WebGL2');
    expect(backendHeadline({ ...base, softwareAdapter: true })).toBe('WebGPU (software adapter)');
  });

  it('says nothing when WebGPU runs at once, and why otherwise', () => {
    expect(backendWhy(base)).toBe('');
    expect(backendWhy({ ...base, adapterAttempts: 3 })).toContain('request 3');
    const gl = { ...base, active: 'webgl2' as const };
    expect(backendWhy({ ...gl, reason: 'no-adapter', adapterAttempts: 9 })).toContain('9 requests');
    for (const reason of ['requested', 'no-webgpu', 'blocked-after-crash', 'firefox-policy', 'no-device', 'init-failed', 'device-lost'] as const) {
      expect(backendWhy({ ...gl, reason }).length).toBeGreaterThan(10);
    }
  });
});
