/**
 * The building usability check climbs a stair only where its top step lands on open floor of the level above, the
 * way a person (and the walkthrough bot) would: a flight that runs into an exterior wall, or an upper floor with no
 * stair at all, leaves those rooms unreachable instead of being waved through.
 */
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { applyArchOps, checkBuilding } from '../src/index';

function house(stairs: Array<{ at: [number, number]; heading: 'north' | 'south' | 'east' | 'west'; width: number }>) {
  const plan = {
    id: 'house',
    name: 'Stair test',
    style: 'modern',
    levels: [
      {
        name: 'Ground floor',
        height: 3,
        rooms: [
          { id: 'living', type: 'living', rect: [0, 0, 8, 6] },
          { id: 'hall', type: 'hall', rect: [8, 0, 12, 6] },
        ],
        doors: [{ between: ['hall', 'outside'], side: 'south', main: true }, { between: ['living', 'hall'], kind: 'opening', width: 1.6 }],
        stairs,
      },
      {
        name: 'Upper floor',
        height: 2.9,
        rooms: [
          { id: 'bed', type: 'bedroom', rect: [0, 0, 8, 6] },
          { id: 'landing', type: 'hall', rect: [8, 0, 12, 6] },
        ],
        doors: [{ between: ['bed', 'landing'] }],
      },
    ],
  };
  const base = createWorld();
  // Built exactly as drawn: the check is what is measured here (create_building would move a stair that does not work).
  const res = applyArchOps(base, [{ op: 'create_building', plan, exactStairs: true }]);
  return applyPatches(base, res.patches).world;
}

describe('stair arrival', () => {
  it('climbs a stair whose top step lands on the landing', () => {
    // Up the hall from the south: 4.6 m of flight ends 1.2 m short of the north wall.
    const report = checkBuilding(house([{ at: [11, 5.8], heading: 'north', width: 1 }]), 'house');
    expect(report.issues.filter((i) => i.code === 'unreachable_room'), report.issues.map((i) => i.message).join('\n')).toHaveLength(0);
    expect(report.reachable).toBe(report.rooms);
  });

  it('does not climb a stair that runs into the exterior wall', () => {
    // Starting at z = 4.9 heading north, the top step lands against the wall at z = 0.
    const report = checkBuilding(house([{ at: [11, 4.9], heading: 'north', width: 1 }]), 'house');
    expect(report.reachable).toBeLessThan(report.rooms);
    expect(report.issues.some((i) => i.code === 'unreachable_room' && /top step/.test(i.message))).toBe(true);
  });

  it('does not reach an upper floor that has no stair', () => {
    const report = checkBuilding(house([]), 'house');
    expect(report.reachable).toBe(2);
  });
});
