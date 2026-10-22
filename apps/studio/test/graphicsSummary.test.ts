import { describe, expect, it } from 'vitest';
import { graphicsSummary } from '../src/engine/graphicsSummary';

describe('graphics summary', () => {
  it('says nothing before the renderer reports', () => {
    expect(graphicsSummary(null, 'auto')).toBeNull();
    expect(graphicsSummary(undefined, 'auto')).toBeNull();
  });

  it('names the tier and whether it is automatic', () => {
    expect(graphicsSummary({ tier: 'high', auto: 'high', ladder: 0 }, 'auto')).toBe('Graphics: High (automatic)');
    expect(graphicsSummary({ tier: 'medium', auto: 'high' }, 'medium')).toBe('Graphics: Medium (set in Settings)');
  });

  it('says when the ladder is holding the tier down and that it climbs', () => {
    expect(graphicsSummary({ tier: 'low', auto: 'high', ladder: 4 }, 'auto')).toMatch(/Low \(automatic, saving frames; climbs when smooth\)/);
  });
});
