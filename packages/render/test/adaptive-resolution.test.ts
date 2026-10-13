import { describe, expect, it } from 'vitest';
import { AdaptiveResolution, ADAPTIVE_DEFAULTS } from '../src/view/adaptive-resolution';

/** Feed `seconds` of continuous frames at `fps`; returns the number of scale changes. */
function feed(a: AdaptiveResolution, fps: number, seconds: number): number {
  let changes = 0;
  for (let t = 0; t < seconds; t += 1 / fps) if (a.record(1 / fps, true)) changes++;
  return changes;
}

describe('AdaptiveResolution', () => {
  it('keeps full resolution at 60 fps', () => {
    const a = new AdaptiveResolution();
    expect(feed(a, 60, 30)).toBe(0);
    expect(a.scale).toBe(1);
  });

  it('scales down after sustained frames under 40 fps, one step at a time, down to the floor', () => {
    const a = new AdaptiveResolution();
    expect(feed(a, 30, 1)).toBe(0);
    expect(feed(a, 30, 1)).toBe(1);
    expect(a.scale).toBe(ADAPTIVE_DEFAULTS.step);
    feed(a, 20, 60);
    expect(a.scale).toBe(ADAPTIVE_DEFAULTS.minScale);
  });

  it('ignores non-continuous frames (on-demand editor, hidden tab)', () => {
    const a = new AdaptiveResolution();
    for (let i = 0; i < 500; i++) a.record(1 / 10, false);
    for (let i = 0; i < 50; i++) a.record(2, true);
    expect(a.scale).toBe(1);
    expect(a.changeCount).toBe(0);
  });

  it('scales back up with headroom, and backs off when an upscale has to be undone', () => {
    const a = new AdaptiveResolution();
    feed(a, 30, 2);
    expect(a.scale).toBeLessThan(1);
    // +1 s: the p90 window (48 frames) first has to flush the slow frames.
    feed(a, 60, ADAPTIVE_DEFAULTS.upAfter + 1);
    expect(a.scale).toBe(1);
    // Too slow again right away: the next upscale waits twice as long.
    feed(a, 30, 2);
    expect(a.scale).toBeLessThan(1);
    expect(feed(a, 60, ADAPTIVE_DEFAULTS.upAfter + 1)).toBe(0);
    expect(feed(a, 60, ADAPTIVE_DEFAULTS.upAfter + 1)).toBe(1);
    expect(a.scale).toBe(1);
  });

  it('does nothing while disabled and reset() restores full scale', () => {
    const a = new AdaptiveResolution();
    a.enabled = false;
    expect(feed(a, 10, 10)).toBe(0);
    a.enabled = true;
    feed(a, 10, 10);
    expect(a.scale).toBeLessThan(1);
    a.reset();
    expect(a.scale).toBe(1);
  });
});

describe('AdaptiveResolution p90 governor', () => {
  it('scales down for periodic stutter even when the mean frame rate looks fine', () => {
    const a = new AdaptiveResolution();
    // 6 of every 48 frames take 45 ms, the rest 14 ms: mean ≈ 57 fps, p90 ≈ 22 fps.
    let changed = false;
    for (let i = 0; i < 48 * 4 && !changed; i++) changed = a.record(i % 8 === 0 ? 0.045 : 0.014, true);
    expect(changed).toBe(true);
    expect(a.scale).toBeLessThan(1);
  });

  it('keeps full resolution with rare isolated spikes', () => {
    const a = new AdaptiveResolution();
    for (let i = 0; i < 600; i++) a.record(i % 60 === 0 ? 0.05 : 0.016, true);
    expect(a.scale).toBe(1);
  });
});
