import { describe, expect, it } from 'vitest';
import { AdaptiveTier, TIER_PROBE } from '../src/gpu/adaptive-tier';
import type { RenderTier } from '../src/gpu/finishing';

function feed(p: AdaptiveTier, seconds: number, fps: number, scale = 1, base: RenderTier = 'medium', allowed = true): number {
  let changes = 0;
  for (let t = 0; t < seconds; t += 1 / fps) if (p.record(1 / fps, true, scale, base, allowed)) changes++;
  return changes;
}

describe('measured automatic render tier', () => {
  it('starts at the hardware hint and spends sustained full-resolution headroom on quality', () => {
    const p = new AdaptiveTier();
    expect(p.resolve('medium')).toBe('medium');
    expect(feed(p, 10, 60)).toBe(0);
    expect(feed(p, 12, 60)).toBe(1);
    expect(p.resolve('medium')).toBe('high');
    expect(feed(p, 120, 60)).toBe(0);
    expect(p.resolve('medium')).toBe('high');
  });
  it('raises weak hardware a tier at a time and never automatically enables ultra', () => {
    const p = new AdaptiveTier();
    expect(feed(p, 22, 60, 1, 'low')).toBe(1);
    expect(p.resolve('low')).toBe('medium');
    expect(feed(p, 22, 60, 1, 'low')).toBe(1);
    expect(p.resolve('low')).toBe('high');
    expect(feed(p, 120, 60, 1, 'low')).toBe(0);
  });
  it('does not trade reduced resolution for more effects', () => {
    const p = new AdaptiveTier();
    expect(feed(p, 120, 60, 0.8)).toBe(0);
    expect(feed(p, 120, 52)).toBe(0);
    expect(p.resolve('medium')).toBe('medium');
  });
  it('retreats quickly and retries after later optimizations create sustained capacity', () => {
    const p = new AdaptiveTier();
    feed(p, 22, 60);
    expect(feed(p, 3, 40)).toBe(1);
    expect(p.resolve('medium')).toBe('medium');
    expect(feed(p, TIER_PROBE.retryAfter - 5, 60)).toBe(0);
    expect(feed(p, 30, 60)).toBe(1);
    expect(p.resolve('medium')).toBe('high');
    feed(p, 3, 40);
    expect(feed(p, TIER_PROBE.retryAfter + 30, 60)).toBe(0);
    expect(p.resolve('medium')).toBe('medium');
  });
  it('retreats if adaptive resolution had to drop after a probe', () => {
    const p = new AdaptiveTier();
    feed(p, 22, 60);
    expect(feed(p, 3, 60, 0.9)).toBe(1);
    expect(p.resolve('medium')).toBe('medium');
  });
  it('forgets interrupted evidence and never learns from idle or loading intervals', () => {
    const p = new AdaptiveTier();
    feed(p, 19, 60);
    p.record(1 / 60, false, 1, 'medium', true);
    expect(feed(p, 10, 60)).toBe(0);
    p.record(2, true, 1, 'medium', true);
    expect(feed(p, 10, 60)).toBe(0);
    expect(p.resolve('medium')).toBe('medium');
  });
  it('honors memory, manual-tier and safety exclusions immediately', () => {
    const p = new AdaptiveTier();
    feed(p, 22, 60);
    expect(p.record(1 / 60, true, 1, 'medium', false)).toBe(true);
    expect(p.resolve('medium')).toBe('medium');
    expect(feed(p, 120, 60, 1, 'medium', false)).toBe(0);
    p.reset();
    expect(p.resolve('low')).toBe('low');
  });
});
