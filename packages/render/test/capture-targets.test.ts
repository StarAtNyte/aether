import { describe, expect, it, vi } from 'vitest';
import { CaptureTargets } from '../src/gpu/capture-targets';

describe('capture target cache', () => {
  it('evicts least recently used targets to respect the byte budget', () => {
    const cache = new CaptureTargets(2 * 8 * 100, 2);
    const first = cache.get(10, 10);
    const second = cache.get(5, 10);
    const dispose = vi.spyOn(second, 'dispose');
    expect(cache.get(10, 10)).toBe(first);
    cache.get(8, 10);
    expect(dispose).toHaveBeenCalledOnce();
    expect(cache.bytes).toBeLessThanOrEqual(1600);
    cache.dispose();
  });

  it('keeps in-flight targets until all readbacks settle, then releases oversized targets', () => {
    const cache = new CaptureTargets(100, 2);
    const target = cache.get(10, 10);
    const dispose = vi.spyOn(target, 'dispose');
    const release1 = cache.retain(target);
    const release2 = cache.retain(target);
    cache.get(2, 2);
    release1();
    expect(dispose).not.toHaveBeenCalled();
    release2();
    release2();
    expect(dispose).toHaveBeenCalledOnce();
    expect(cache.bytes).toBeLessThanOrEqual(100);
    cache.dispose();
  });
});
