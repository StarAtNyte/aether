import { describe, expect, it } from 'vitest';
import { INTEGRATED_INTERIOR_REACH, interiorDrawDistance as idd, capTier, cutsAt, forwardLightBudget, GOVERNOR_DEFAULTS, LOW_TIER_LIGHTS, hardwareTierCap, interiorContent, interiorDrawDistance, HEAVY_WORLD, lodHeightScale, PERFORMANCE_STEPS, PerformanceGovernor, readHardware, startLevel, sunMapSoftRefreshFrames, weakHardware } from '../src/gpu/performance';

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
  it('never goes past the last step, and does not climb while the resolution is still lowered', () => {
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

  describe('climbing back', () => {
    it('starts at a level and climbs one step after fast frames at full scale, not before the settle time', () => {
      const g = new PerformanceGovernor();
      g.start(4);
      expect(g.level).toBe(4);
      expect(feed(g, 15, 1 / 60, 1)).toBe(0);
      expect(g.level).toBe(4);
      expect(feed(g, 10, 1 / 60, 1)).toBe(1);
      expect(g.level).toBe(3);
      expect(g.lastMove).toBe(-1);
    });
    it('climbs every settle period down to 0 and then stays', () => {
      const g = new PerformanceGovernor();
      g.start(3);
      let moves = 0;
      for (let t = 0; t < 400; t += 1 / 60) if (g.record(1 / 60, true, 0)) moves++;
      expect(moves).toBe(3);
      expect(g.level).toBe(0);
    });
    it('does not climb on moderate frame rates (hysteresis band between the down and up thresholds)', () => {
      const g = new PerformanceGovernor();
      g.start(2);
      expect(feed(g, 120, 1 / 35, 1)).toBe(0);
      expect(g.level).toBe(2);
    });
    it('does not climb while adaptive resolution is below full scale', () => {
      const g = new PerformanceGovernor();
      g.start(2);
      expect(feed(g, 120, 1 / 60, 0.8)).toBe(0);
    });
    it('backs off after a failed climb, then retries after sustained new headroom', () => {
      const g = new PerformanceGovernor();
      g.start(2);
      feed(g, 25, 1 / 60, 1);
      expect(g.level).toBe(1);
      // The step up made frames slow: down again within the retreat window.
      expect(feed(g, 3.2, 1 / 6, 1)).toBe(1);
      expect(g.lastMove).toBe(1);
      expect(g.level).toBe(2);
      expect(g.floor).toBe(2);
      feed(g, 60, 1 / 60, 1);
      expect(g.level).toBe(2);
      expect(g.floor).toBe(2);
      feed(g, 100, 1 / 60, 1);
      expect(g.level).toBe(1);
      expect(g.floor).toBe(1);
      feed(g, 140, 1 / 60, 1);
      expect(g.level).toBe(0);
      expect(g.floor).toBe(0);
    });
    it('requires uninterrupted full-resolution headroom to retry and backs off repeated failures', () => {
      const g = new PerformanceGovernor();
      g.start(1);
      feed(g, 25, 1 / 60, 1);
      expect(g.level).toBe(0);
      feed(g, 3.2, 1 / 6, 1);
      expect(g.level).toBe(1);
      expect(g.floor).toBe(1);
      feed(g, 110, 1 / 60, 1);
      g.record(1 / 60, false, 1);
      feed(g, 110, 1 / 60, 1);
      expect(g.level).toBe(1);
      feed(g, 60, 1 / 60, 0.8);
      expect(g.level).toBe(1);
      feed(g, 140, 1 / 60, 1);
      expect(g.level).toBe(0);
      // A second failed experiment now waits 240 seconds of new headroom.
      feed(g, 3.2, 1 / 6, 1);
      expect(g.level).toBe(1);
      feed(g, 200, 1 / 60, 1);
      expect(g.level).toBe(1);
      feed(g, 70, 1 / 60, 1);
      expect(g.level).toBe(0);
    });

    it('is idle when disabled and ignores hidden-tab stalls', () => {
      const g = new PerformanceGovernor();
      g.start(4);
      g.enabled = false;
      expect(feed(g, 100, 1 / 60, 1)).toBe(0);
      g.enabled = true;
      for (let i = 0; i < 200; i++) g.record(2, true, 1);
      expect(g.level).toBe(4);
    });
    it('keeps the up threshold well above the down threshold', () => {
      expect(GOVERNOR_DEFAULTS.upFps).toBeGreaterThan(GOVERNOR_DEFAULTS.lowFps * 2);
    });
  });
});

describe('sun shadow map refresh while casters animate', () => {
  it('keeps every other frame on a fast GPU and stretches on a slow one', () => {
    expect(sunMapSoftRefreshFrames(60)).toBe(2);
    expect(sunMapSoftRefreshFrames(40)).toBe(2);
    expect(sunMapSoftRefreshFrames(30)).toBe(4);
    expect(sunMapSoftRefreshFrames(27)).toBe(8);
    expect(sunMapSoftRefreshFrames(12)).toBe(8);
    expect(sunMapSoftRefreshFrames(0)).toBe(2);
    expect(sunMapSoftRefreshFrames(Number.NaN)).toBe(2);
    // Many casters: the animated redraws thin out whatever the rate.
    expect(sunMapSoftRefreshFrames(60, 300)).toBe(2);
    expect(sunMapSoftRefreshFrames(60, 600)).toBe(4);
    expect(sunMapSoftRefreshFrames(60, 2000)).toBe(6);
    expect(sunMapSoftRefreshFrames(20, 2000)).toBe(8);
  });
});

describe('room contents far from the eye', () => {
  it('only room contents qualify; the facade and the building stay', () => {
    expect(interiorContent({ role: 'furniture', room: 'h1-l0-living' })).toBe(true);
    expect(interiorContent({ role: 'part', room: 'h1-l0-kitchen' })).toBe(true);
    expect(interiorContent({ role: 'door', room: 'h1-l0-hall' })).toBe(false);
    expect(interiorContent({ role: 'window', room: 'h1-l0-hall' })).toBe(false);
    expect(interiorContent({ role: 'furniture' })).toBe(false);
    expect(interiorContent(undefined)).toBe(false);
  });

  it('draws everything in stills; within a reach in the realtime view, nearer on the cheaper tiers', () => {
    expect(interiorDrawDistance('high', false)).toBe(60);
    expect(interiorDrawDistance('ultra', false)).toBe(60);
    expect(interiorDrawDistance('low', true)).toBe(Number.POSITIVE_INFINITY);
    expect(interiorDrawDistance('low', false)).toBeLessThan(interiorDrawDistance('medium', false));
    expect(Number.isFinite(interiorDrawDistance('medium', false))).toBe(true);
  });
});

describe('level of detail of the cheaper tiers', () => {
  it('plans full detail on high, ultra and stills, coarser on medium and low', () => {
    expect(lodHeightScale('high', false)).toBe(1);
    expect(lodHeightScale('ultra', false)).toBe(1);
    expect(lodHeightScale('low', true)).toBe(1);
    expect(lodHeightScale('medium', false)).toBeLessThan(1);
    expect(lodHeightScale('low', false)).toBeLessThan(lodHeightScale('medium', false));
    // Integrated GPUs plan a coarser cut at every tier; stills stay full.
    expect(lodHeightScale('ultra', false, 'integrated')).toBe(0.5);
    expect(lodHeightScale('ultra', false, 'discrete')).toBe(1);
    expect(lodHeightScale('ultra', true, 'integrated')).toBe(1);
    // Room contents: finite reach at every tier, farther on discrete GPUs.
    expect(idd('ultra', false, 'integrated')).toBe(INTEGRATED_INTERIOR_REACH);
    expect(idd('ultra', false, 'discrete')).toBe(60);
    expect(idd('ultra', true, 'integrated')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('forward light budget', () => {
  it('keeps fewer local lights on the low tier of the realtime view only', () => {
    expect(forwardLightBudget(8, 'low', false)).toBe(LOW_TIER_LIGHTS);
    expect(forwardLightBudget(2, 'low', false)).toBe(2);
    expect(forwardLightBudget(8, 'low', true)).toBe(8);
    for (const tier of ['medium', 'high', 'ultra'] as const) expect(forwardLightBudget(64, tier, false)).toBe(64);
  });
});

describe('start level of a world', () => {
  it('starts heavy worlds at the low tier on weak GPUs only', () => {
    const heavy = { entities: HEAVY_WORLD.entities, triangles: 0 };
    const dense = { entities: 10, triangles: HEAVY_WORLD.triangles };
    const valley = { entities: 229, triangles: 3_000_000 };
    const small = { entities: 40, triangles: 200_000 };
    expect(startLevel('discrete', heavy)).toBe(0);
    for (const gpu of ['integrated', 'unknown', 'software'] as const) {
      expect(startLevel(gpu, heavy)).toBe(4);
      expect(startLevel(gpu, dense)).toBe(4);
      expect(startLevel(gpu, small)).toBe(0);
      expect(startLevel(gpu, valley)).toBe(0);
    }
    expect(cutsAt(4).tierCap).toBe('low');
  });
});
