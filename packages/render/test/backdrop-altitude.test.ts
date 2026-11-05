import { describe, expect, it } from 'vitest';
import { altitudeShare } from '../src/environment/mountain-range';

describe('backdrop altitude', () => {
  it('leaves the ground view alone and gives the drone view to the air', () => {
    // A cliff town of radius 140: its streets stand 50 m up.
    expect(altitudeShare(50, 140)).toBeLessThan(0.01);
    expect(altitudeShare(2, 30)).toBe(0);
    expect(altitudeShare(400, 140)).toBe(1);
    const mid = altitudeShare(110, 140);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // Rising never thins the air.
    let last = 0;
    for (let y = 0; y < 300; y += 5) {
      const a = altitudeShare(y, 140);
      expect(a).toBeGreaterThanOrEqual(last);
      last = a;
    }
    expect(altitudeShare(Number.NaN, 140)).toBe(0);
  });
});
