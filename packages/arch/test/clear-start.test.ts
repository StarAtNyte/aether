import { describe, expect, it } from 'vitest';
import { clearStart, compileBuilding } from '../src/compile';
import { APARTMENT } from './fixtures';

type P = [number, number];

describe('a walkthrough start that is not inside furniture', () => {
  const room = { polygon: [[0, 0], [6, 0], [6, 4], [0, 4]] as P[], blockers: [[[2.6, 1.6], [3.4, 1.6], [3.4, 2.4], [2.6, 2.4]] as P[]] };

  it('keeps a start that is clear', () => {
    expect(clearStart([1.5, 2], room, [0, 2])).toEqual([1.5, 2]);
    // Too near the door (its leaf swings there): moved off it.
    expect(clearStart([1, 2], room, [0, 2])).not.toEqual([1, 2]);
  });

  it('moves a start that is inside a chair to the nearest clear spot, off the door and the walls', () => {
    const at: P = [3, 2];
    const free = clearStart(at, room, [6, 2]);
    expect(free).not.toBeNull();
    const [x, z] = free as P;
    // Outside the chair's footprint by 0.5 m, 0.4 m inside the walls, 1.3 m from the door.
    expect(Math.max(2.6 - x, x - 3.4, 1.6 - z, z - 2.4)).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(x).toBeGreaterThanOrEqual(0.4);
    expect(x).toBeLessThanOrEqual(5.6);
    expect(z).toBeGreaterThanOrEqual(0.4);
    expect(z).toBeLessThanOrEqual(3.6);
    expect(Math.hypot(x - 6, z - 2)).toBeGreaterThanOrEqual(1.3);
    expect(Math.hypot(x - at[0], z - at[1])).toBeLessThan(1.6);
  });

  it('gives up (null) when the room has no clear floor at all', () => {
    const tiny = { polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] as P[], blockers: [] };
    expect(clearStart([0.5, 0.5], tiny, [0.5, 0])).toBeNull();
  });

  it('never starts a compiled building inside its own furniture', () => {
    for (const layout of [APARTMENT, { ...APARTMENT, residents: 2 }]) {
      const c = compileBuilding(layout);
      const sp: P = [c.spawn[0], c.spawn[2]];
      for (const e of c.entities) {
        if (e.arch?.role !== 'furniture' || e.shape?.kind !== 'procedural') continue;
        const p = e.transform?.position;
        if (!p || p[1] > 0.3) continue;
        // Furniture standing on the floor is wider than 0.25 m: the start is at least that far from every centre.
        expect(Math.hypot(sp[0] - p[0], sp[1] - p[2]), `${e.id} at ${p.join(',')}`).toBeGreaterThan(0.25);
      }
    }
  });
});
