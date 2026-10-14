import { describe, expect, it, vi } from 'vitest';
import { settleWithin } from '../src/lib/deadline';

// Regression: leaving the editor waited for a thumbnail capture of a heavy world for 20 s and more.
describe('settleWithin', () => {
  it('resolves true when the task settles in time (fulfilled or rejected)', async () => {
    await expect(settleWithin(Promise.resolve(1), 100)).resolves.toBe(true);
    await expect(settleWithin(Promise.reject(new Error('x')), 100)).resolves.toBe(true);
  });

  it('resolves false at the deadline while the task keeps running', async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const task = new Promise<void>((r) => {
        setTimeout(() => {
          done = true;
          r();
        }, 10_000);
      });
      const p = settleWithin(task, 2500);
      await vi.advanceTimersByTimeAsync(2501);
      await expect(p).resolves.toBe(false);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(8000);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
