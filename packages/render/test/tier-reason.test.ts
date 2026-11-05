import { describe, expect, it } from 'vitest';
import { autoTierReason, type TierReasonInput } from '../src/gpu/tier-reason';

const base: TierReasonInput = { gpu: 'discrete', tier: 'high', base: 'high', lowMemory: false, hardware: { cores: 12, memoryGB: 8 }, start: null, level: 0, stepFps: 0, probed: false };

describe('reason of the automatic tier', () => {
  it('names the GPU class when nothing else lowered it', () => {
    expect(autoTierReason(base)).toBe('discrete GPU');
    expect(autoTierReason({ ...base, gpu: 'unknown', tier: 'medium', base: 'medium' })).toBe('unrecognised GPU');
    expect(autoTierReason({ ...base, gpu: 'integrated', tier: 'medium', base: 'medium' })).toMatch(/^integrated GPU/);
  });

  it('names a cautious start and a step down with its frame rate', () => {
    expect(autoTierReason({ ...base, tier: 'medium', start: 'gecko', level: 3 })).toBe('Firefox cautious start, climbs while frames are fast');
    expect(autoTierReason({ ...base, gpu: 'integrated', tier: 'low', base: 'medium', start: 'heavy', level: 4 })).toBe('heavy world on an integrated GPU, climbs while frames are fast');
    expect(autoTierReason({ ...base, tier: 'low', level: 4, stepFps: 17.6 })).toBe('stepped down: 18 fps');
    // Climbed all the way back: the start no longer explains anything.
    expect(autoTierReason({ ...base, start: 'gecko', level: 0 })).toBe('discrete GPU');
  });

  it('names the hardware cap, low memory, software and a measured probe', () => {
    expect(autoTierReason({ ...base, tier: 'medium', hardware: { cores: 4 } })).toBe('4-core CPU');
    expect(autoTierReason({ ...base, gpu: 'integrated', tier: 'low', base: 'medium', hardware: { cores: 8, memoryGB: 4 } })).toBe('4 GB memory');
    expect(autoTierReason({ ...base, tier: 'low', base: 'low', lowMemory: true })).toBe('low memory mode');
    expect(autoTierReason({ ...base, gpu: 'software', tier: 'low', base: 'low' })).toBe('software renderer');
    expect(autoTierReason({ ...base, gpu: 'unknown', tier: 'high', base: 'medium', probed: true })).toBe('measured: frames are fast');
  });
});
