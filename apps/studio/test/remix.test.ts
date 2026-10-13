import { describe, expect, it } from 'vitest';
import { Environment } from '@aether/core';
import { MAX_REMIXES, remixSuggestions } from '../src/lib/remix';

const env = (input: Record<string, unknown>): Environment => Environment.parse(input);

describe('remixSuggestions', () => {
  it('never suggests the sky the world already has', () => {
    for (const sky of ['day', 'dawn', 'sunset', 'night', 'overcast', 'space', 'studio'] as const) {
      const out = remixSuggestions(env({ sky }));
      expect(out.length).toBeGreaterThan(0);
      expect(out.length).toBeLessThanOrEqual(MAX_REMIXES);
      expect(out[0]?.sky).not.toBe(sky);
    }
  });
  it('offers sunrise at night and night at sunset', () => {
    expect(remixSuggestions(env({ sky: 'night' }))[0]?.prompt).toBe('Make it sunrise');
    expect(remixSuggestions(env({ sky: 'sunset' })).map((r) => r.prompt)).toContain('Make it night');
    expect(remixSuggestions(env({ sky: 'sunset' })).map((r) => r.prompt)).not.toContain('Make it sunset');
  });
  it('skips weather and gravity that already apply', () => {
    const out = remixSuggestions(env({ sky: 'day', weather: 'snow', gravity: [0, -1.6, 0] })).map((r) => r.prompt);
    expect(out).not.toContain('Make it snow');
    expect(out).not.toContain('Low gravity');
  });
});
