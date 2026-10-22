import { describe, expect, it } from 'vitest';
import { hourForWall, sunBearingDegrees } from '@aether/arch/photo';
import { sunPosition } from '../src/environment/sky-state';

/** Compass bearing (clockwise from north) of a light direction in the world frame (x east, z south). */
const compass = (d: readonly [number, number, number]): number => ((Math.atan2(d[0], -d[2]) * 180) / Math.PI + 360) % 360;

describe('the sun a photo room is lit by', () => {
  it('follows the renderer: the arch bearing of an hour is the compass of the sky model\'s sun', () => {
    for (const h of [7, 9, 11, 12, 14, 16, 17.5]) {
      const d = sunPosition(h).direction;
      const diff = Math.abs(((compass(d) - sunBearingDegrees(h) + 540) % 360) - 180);
      expect(diff, `hour ${h}`).toBeLessThan(1.5);
    }
  });

  it('puts the sun outside the window wall when a daytime sun can be there', () => {
    expect(hourForWall('east')?.hour).toBeLessThan(10);
    expect((hourForWall('west')?.hour ?? 0)).toBeGreaterThan(15);
    const south = hourForWall('south');
    expect(south).not.toBeNull();
    expect(hourForWall('north')).toBeNull();
  });
});
