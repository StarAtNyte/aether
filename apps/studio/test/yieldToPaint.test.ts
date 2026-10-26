import { afterEach, describe, expect, it, vi } from 'vitest';
import { yieldToPaint } from '../src/lib/yieldToPaint';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('processing feedback paint boundary', () => {
  it('waits through two frame opportunities before work continues', async () => {
    vi.useFakeTimers();
    const frames = new Map<number, FrameRequestCallback>(); let id = 0;
    vi.stubGlobal('document', { visibilityState: 'visible' });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++id, fn); return id; });
    vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
    const paint = yieldToPaint(); let started = false; void paint.then(() => { started = true; });
    frames.get(1)!(0); await Promise.resolve(); expect(started).toBe(false);
    frames.get(2)!(16); await paint; expect(started).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not wait for animation frames in a background tab', async () => {
    vi.useFakeTimers(); const raf = vi.fn();
    vi.stubGlobal('document', { visibilityState: 'hidden' }); vi.stubGlobal('requestAnimationFrame', raf);
    const paint = yieldToPaint(); await vi.advanceTimersByTimeAsync(0); await paint; expect(raf).not.toHaveBeenCalled();
  });
  it('finishes and cancels outstanding frames if the tab stops painting mid-wait', async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    vi.stubGlobal('document', { visibilityState: 'visible' }); vi.stubGlobal('requestAnimationFrame', () => 4); vi.stubGlobal('cancelAnimationFrame', cancel);
    const paint = yieldToPaint(); await vi.advanceTimersByTimeAsync(100); await paint; expect(cancel).toHaveBeenCalledWith(4); expect(vi.getTimerCount()).toBe(0);
  });
});
