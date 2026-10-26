import { describe, expect, it } from 'vitest';
import { PassVisibility } from '../src/gpu/pass-visibility';
import { describeSites, probeAllocations } from '../../../tests/unit/alloc-probe';

describe('auxiliary pass visibility', () => {
  it('snapshots duplicates and restores mixed states after nested draws and input changes', () => {
    const visibility = new PassVisibility();
    const a = { visible: true }, b = { visible: false }, c = { visible: true };
    const input = [a, b, a];
    visibility.hide(input);
    expect([a.visible, b.visible]).toEqual([false, false]);
    visibility.hide([a, c]);
    expect(c.visible).toBe(false);
    visibility.restore();
    expect([a.visible, b.visible, c.visible]).toEqual([false, false, true]);
    input.splice(0, input.length, c);
    visibility.restore();
    expect([a.visible, b.visible, c.visible]).toEqual([true, false, true]);
    visibility.restore();
    visibility.hide([b]);
    visibility.restore();
    expect(b.visible).toBe(false);
  });

  it('reuses scratch storage without allocating per pass', async () => {
    const visibility = new PassVisibility();
    const objects = Array.from({ length: 32 }, (_, i) => ({ visible: i % 2 === 0 }));
    const result = await probeAllocations(() => {
      visibility.hide(objects);
      visibility.restore();
    }, { iterations: 400, warmup: 3000, match: /packages\/render\/src\/gpu\/pass-visibility/ });
    expect(result.bytesPerIteration, describeSites(result)).toBeLessThan(16);
  });
});
