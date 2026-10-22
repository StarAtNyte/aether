/**
 * A `living` room that is the entrance room (the main door in it, an opening into the next room): sofa, armchairs, coffee
 * table, bookshelf and plants must leave a way from door to door and no pocket of floor cut off from the doors.
 *
 * Before the placement rule, 64 of 1800 combinations of room size, opening position and width, style and main-door wall
 * left the next room unreachable under the building check's 0.8 m walkways (an armchair in front of the main door and a
 * plant in the corner shut a pocket round the spawn; a sofa and two armchairs in a row sealed the opening). The rule
 * is in RoomLayout.fits: a piece is not placed where it would cut the doors from each other or strand a body-sized pocket.
 */
import { createWorld } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { applyArchOps, checkBuilding } from '../src/index';

function plan(w: number, d: number, at: number, width: number, style: string, mainSide: string): Record<string, unknown> {
  return {
    id: 'h',
    style,
    levels: [
      {
        height: 2.8,
        rooms: [
          { id: 'living', type: 'living', rect: [0, 0, w, d] },
          { id: 'kitchen', type: 'kitchen', rect: [w, 0, w + 3.5, d] },
        ],
        doors: [
          { between: ['living', 'outside'], side: mainSide, main: true },
          { between: ['living', 'kitchen'], kind: 'opening', width, at },
        ],
      },
    ],
  };
}

function unreached(w: number, d: number, at: number, width: number, style: string, side: string): string[] {
  const built = applyArchOps(createWorld(), [{ op: 'create_building', plan: plan(w, d, at, width, style, side) }]);
  expect(built.errors).toEqual([]);
  return checkBuilding(built.target, 'h').issues.filter((i) => i.message.includes('cannot be reached')).map((i) => i.message);
}

describe('living entrance room keeps its doors connected', () => {
  it('the pinned layouts that sealed the kitchen are walkable now', () => {
    for (const args of [
      [3.5, 3.8, 0.2, 0.9, 'modern', 'north'],
      [3.5, 3.8, 0.8, 0.9, 'modern', 'south'],
      [3.5, 4.5, 0.2, 0.9, 'scandinavian', 'north'],
      [3.5, 4.5, 0.8, 0.9, 'scandinavian', 'south'],
      [4, 5.5, 0.35, 0.9, 'modern', 'south'],
      [4, 5.5, 0.65, 1.2, 'modern', 'north'],
    ] as const) expect(unreached(...args), args.join(' ')).toEqual([]);
  });

  it('a sweep of sizes, opening positions, widths and main-door walls never leaves a room unreachable', () => {
    const bad: string[] = [];
    let n = 0;
    for (const w of [3.5, 4, 5]) for (const d of [3.2, 3.8, 4.5, 5.5]) for (const at of [0.2, 0.5, 0.8]) for (const width of [0.9, 1.6]) for (const side of ['south', 'north', 'west']) {
      n++;
      const r = unreached(w, d, at, width, 'modern', side);
      if (r.length > 0) bad.push(`${w}x${d} at ${at} width ${width} ${side}: ${r.join('; ')}`);
    }
    expect(n).toBeGreaterThan(100);
    expect(bad, bad.join('\n')).toEqual([]);
  }, 120_000);
});
