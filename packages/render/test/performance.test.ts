import { describe, expect, it } from 'vitest';
import { capTier, cutsAt, GOVERNOR_DEFAULTS, hardwareTierCap, PERFORMANCE_STEPS, PerformanceGovernor, readHardware, weakHardware } from '../src/gpu/performance';

describe('hardware hints', () => {
  it('reads what the browser tells and ignores the rest', () => {
    expect(readHardware({ hardwareConcurrency: 8.7, deviceMemory: 8 })).toEqual({ cores: 8, memoryGB: 8 });
    expect(readHardware({ hardwareConcurrency: 0, deviceMemory: Number.NaN })).toEqual({});
    expect(readHardware(null)).toEqual({});
  });
  it('calls few cores or little memory weak', () => {
    expect(weakHardware({ cores: 4 })).toBe(true);
    expect(weakHardware({ memoryGB: 4 })).toBe(true);
    expect(weakHardware({ cores: 8, memoryGB: 8 })).toBe(false);
    expect(weakHardware({})).toBe(false);
  });
  it('caps the automatic tier', () => {
    expect(hardwareTierCap({ cores: 2 }, 'discrete')).toBe('low');
    expect(hardwareTierCap({ memoryGB: 2 }, 'discrete')).toBe('low');
    expect(hardwareTierCap({ cores: 4 }, 'integrated')).toBe('low');
    expect(hardwareTierCap({ cores: 4 }, 'discrete')).toBe('medium');
    expect(hardwareTierCap({ cores: 16, memoryGB: 8 }, 'integrated')).toBeNull();
    expect(hardwareTierCap({}, 'unknown')).toBeNull();
  });
  it('takes the cheaper tier', () => {
    expect(capTier('ultra', 'medium')).toBe('medium');
    expect(capTier('low', 'high')).toBe('low');
    expect(capTier('high', null)).toBe('high');
  });
});

describe('ladder', () => {
  it('is cumulative, cheapest loss of looks first', () => {
    expect(cutsAt(0)).toEqual({ lightVolume: true, cascades: true, tierCap: null, effects: 1 });
    expect(cutsAt(1).lightVolume).toBe(false);
    expect(cutsAt(1).cascades).toBe(true);
    expect(cutsAt(2).cascades).toBe(false);
    expect(cutsAt(3).tierCap).toBe('medium');
    expect(cutsAt(4).tierCap).toBe('low');
    expect(cutsAt(5).effects).toBe(0.25);
    expect(cutsAt(99)).toEqual(cutsAt(PERFORMANCE_STEPS.length));
    expect(cutsAt(-3)).toEqual(cutsAt(0));
  });
});

function feed(g: PerformanceGovernor, seconds: number, dt: number, scale = 0.6): number {
  let steps = 0;
  for (let t = 0; t < seconds; t += dt) if (g.record(dt, true, scale)) steps++;
  return steps;
}

describe('PerformanceGovernor', () => {
  it('stays put at a good frame rate', () => {
    const g = new PerformanceGovernor();
    expect(feed(g, 30, 1 / 60)).toBe(0);
    expect(g.level).toBe(0);
  });
  it('waits for adaptive resolution before it steps on a merely slow frame rate', () => {
    const g = new PerformanceGovernor();
    expect(feed(g, 20, 1 / 20, 1)).toBe(0);
    expect(feed(g, 20, 1 / 20, 0.6)).toBeGreaterThan(0);
  });
  it('steps quickly on a terrible frame rate, whatever the scale', () => {
    const g = new PerformanceGovernor();
    expect(feed(g, 3, 1 / 8, 1)).toBeGreaterThanOrEqual(1);
  });
  it('never goes past the last step and never back', () => {
    const g = new PerformanceGovernor();
    feed(g, 120, 1 / 5);
    expect(g.level).toBe(PERFORMANCE_STEPS.length);
    feed(g, 60, 1 / 60);
    expect(g.level).toBe(PERFORMANCE_STEPS.length);
  });
  it('ignores stalls and idle frames', () => {
    const g = new PerformanceGovernor();
    for (let i = 0; i < 50; i++) {
      g.record(1.2, true, 0.5);
      g.record(0.5, false, 0.5);
    }
    expect(g.level).toBe(0);
  });
  it('is off when disabled', () => {
    const g = new PerformanceGovernor();
    g.enabled = false;
    expect(feed(g, 30, 1 / 5)).toBe(0);
  });
  it('has sane defaults', () => {
    expect(GOVERNOR_DEFAULTS.badFps).toBeLessThan(GOVERNOR_DEFAULTS.lowFps);
  });
});
