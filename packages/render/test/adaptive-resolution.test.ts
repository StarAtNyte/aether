import { describe, expect, it } from 'vitest';
import { AdaptiveResolution, ADAPTIVE_DEFAULTS, MOTION_PROFILES } from '../src/view/adaptive-resolution';

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

  it('scales down after sustained frames under 50 fps, by the step the frame time asks for, down to the floor', () => {
    const a = new AdaptiveResolution();
    expect(feed(a, 30, 0.5)).toBe(0);
    expect(feed(a, 30, 1)).toBe(1);
    // Pixels follow the frame time: 30 fps aiming at 58 takes sqrt(30 / 58) of the scale.
    expect(a.scale).toBe(Math.round(Math.sqrt(30 / ADAPTIVE_DEFAULTS.targetFps) * 100) / 100);
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
    /** Seconds of 60 fps until the scale rises (null: not within `max`). */
    const secondsToUp = (a: AdaptiveResolution, max = 60): number | null => {
      const from = a.scale;
      for (let t = 0; t < max; t++) {
        feed(a, 60, 1);
        if (a.scale > from) return t + 1;
      }
      return null;
    };
    const a = new AdaptiveResolution();
    feed(a, 30, 1.2);
    expect(a.scale).toBeLessThan(1);
    const first = secondsToUp(a) as number;
    expect(first).toBeGreaterThan(ADAPTIVE_DEFAULTS.upAfter - 1);
    while (a.scale < 1) expect(secondsToUp(a)).not.toBeNull();
    // Too slow again right away: the next upscale waits longer than the first did.
    feed(a, 30, 1.6);
    expect(a.scale).toBeLessThan(1);
    expect(secondsToUp(a) as number).toBeGreaterThan(first);
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

describe('AdaptiveResolution floor', () => {
  it('goes below the default floor once it was lowered, and back up to the default when it is restored', () => {
    const a = new AdaptiveResolution();
    a.setFloor(0.3);
    for (let i = 0; i < 4000; i++) a.record(0.1, true);
    expect(a.scale).toBe(0.3);
    expect(a.setFloor()).toBe(true);
    expect(a.scale).toBe(ADAPTIVE_DEFAULTS.minScale);
  });

  it('keeps a scale above the restored floor as it is', () => {
    const a = new AdaptiveResolution();
    a.setFloor(0.3);
    expect(a.setFloor()).toBe(false);
    expect(a.scale).toBe(1);
  });
});

describe('sharp motion profile', () => {
  const sharp = (): AdaptiveResolution => new AdaptiveResolution(MOTION_PROFILES.sharp.opts);

  it('keeps full resolution at 40 fps and at 30 fps', () => {
    const a = sharp();
    expect(feed(a, 40, 60)).toBe(0);
    expect(feed(a, 30, 60)).toBe(0);
    expect(a.scale).toBe(1);
  });

  it('only falls clearly below 30 fps and stops at 0.75 above the emergency rate', () => {
    const a = sharp();
    expect(a.atFloor).toBe(false);
    feed(a, 20, 60);
    expect(a.scale).toBe(0.75);
    // As low as it goes: the performance ladder takes over from here.
    expect(a.atFloor).toBe(true);
    a.enabled = false;
    expect(a.atFloor).toBe(false);
  });

  it('opens the emergency floor only when the machine is unusable, and closes it when it recovers', () => {
    const a = sharp();
    feed(a, 10, 60);
    expect(a.scale).toBeLessThan(0.75);
    expect(a.scale).toBeGreaterThanOrEqual(0.4);
    feed(a, 60, 120);
    expect(a.scale).toBe(1);
  });

  it('smooth keeps the old policy', () => {
    const a = new AdaptiveResolution(MOTION_PROFILES.smooth.opts);
    feed(a, 45, 20);
    expect(a.scale).toBeLessThan(0.75);
  });
  it('scales down when every frame is very slow (270-300 ms), not only on moderately slow frames', () => {
    const a = new AdaptiveResolution();
    for (let i = 0; i < 40; i++) a.record(0.28, true);
    expect(a.scale).toBeLessThan(1);
  });

  it('still ignores a single long stall between fast frames', () => {
    const a = new AdaptiveResolution();
    for (let i = 0; i < 30; i++) a.record(1 / 60, true);
    a.record(0.6, true);
    for (let i = 0; i < 30; i++) a.record(1 / 60, true);
    expect(a.scale).toBe(1);
  });
});
