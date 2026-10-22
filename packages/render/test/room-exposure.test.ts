import { describe, expect, it } from 'vitest';
import { ROOM_MAX_EV, ROOM_MIN_EV, RoomSelector, roomLight, roomSamplePoints, roomWeight, type PointLight, type RoomBox } from '../src/view/room-exposure';
import { toneExposure } from '../src/view/eye-adapt';

const outdoor = { ambient: 1, sun: 3 };
const room: RoomBox = { id: 'a', minX: 0, maxX: 5, minZ: 0, maxZ: 4, floorY: 0, ceilY: 2.6 };
const hall: RoomBox = { id: 'b', minX: 5, maxX: 9, minZ: 0, maxZ: 4, floorY: 0, ceilY: 2.6 };

const dim = (vis: number, bounce = 0.02): PointLight => ({ vis, bounce, lamps: 0, r: 0.02, b: 0.02 });

/** A volume that depends on the position: a window wall on the west side of room `a`. */
function windowSample(x: number): PointLight {
  return dim(Math.max(0.02, 0.5 - x * 0.12), 0.02 + Math.max(0, 0.06 - x * 0.02));
}

function measure(r: RoomBox, sample: (x: number) => PointLight) {
  return roomLight(roomSamplePoints(r).map((p) => sample(p[0])), outdoor);
}

describe('room exposure', () => {
  it('samples a grid inside the room at eye height', () => {
    const pts = roomSamplePoints(room);
    expect(pts).toHaveLength(25);
    for (const p of pts) {
      expect(p[0]).toBeGreaterThan(room.minX);
      expect(p[0]).toBeLessThan(room.maxX);
      expect(p[1]).toBeCloseTo(1.5, 5);
    }
  });

  it('opens more for a darker room', () => {
    const bright = roomLight(Array.from({ length: 25 }, () => dim(0.3, 0.1)), outdoor);
    const dark = roomLight(Array.from({ length: 25 }, () => dim(0.03, 0.01)), outdoor);
    expect(bright).not.toBeNull();
    expect(dark!.ev).toBeGreaterThan(bright!.ev);
  });

  it('holds a closed box to the believable range', () => {
    const box = roomLight(Array.from({ length: 25 }, () => dim(0.0005, 0.0005)), outdoor)!;
    expect(box.ev).toBe(ROOM_MAX_EV);
    const lamps = roomLight(Array.from({ length: 25 }, () => ({ vis: 0.5, bounce: 0.5, lamps: 400, r: 1, b: 1 })), outdoor)!;
    expect(lamps.ev).toBe(ROOM_MIN_EV);
  });

  it('is not closed down by a bright window', () => {
    const wall = Array.from({ length: 25 }, () => dim(0.04, 0.02));
    const base = roomLight(wall, outdoor)!;
    // The same room with a third of its points at the window (open sky).
    const withWindow = roomLight([...wall.slice(0, 17), ...Array.from({ length: 8 }, () => dim(1, 0.5))], outdoor)!;
    expect(withWindow.trimmed).toBeGreaterThan(0);
    expect(Math.abs(withWindow.ev - base.ev)).toBeLessThan(0.3);
  });

  it('returns nothing when too few points were readable or the outdoor reference is empty', () => {
    expect(roomLight([dim(0.1)], outdoor)).toBeNull();
    expect(roomLight(Array.from({ length: 25 }, () => dim(0.1)), { ambient: 0, sun: 0 })).toBeNull();
  });

  it('keeps the same value for every eye position in the room (one number per room)', () => {
    const light = measure(room, windowSample)!;
    const sel = new RoomSelector();
    const rooms = [room, hall];
    const evs: number[] = [];
    // Positions across the room, some beside the window, some far from it, standing and a sitting eye.
    for (const [x, y, z] of [[0.45, 1.6, 1], [1.5, 1.6, 2], [2.5, 1.2, 3], [3.4, 1.6, 0.8], [4.5, 1.6, 3.2]] as const) {
      const pick = sel.select(rooms, x, y, z, null, false);
      expect(pick.shares[0]?.room.id).toBe('a');
      evs.push(light.ev * pick.shares.reduce((a, s) => a + s.weight, 0));
    }
    expect(Math.max(...evs) - Math.min(...evs)).toBeLessThan(0.3);
    // Reading the volume at the eye instead is far from stable for the same positions.
    const point = [0.45, 1.5, 2.5, 3.4, 4.5].map((x) => roomLight(Array.from({ length: 25 }, () => windowSample(x)), outdoor)!.ev);
    expect(Math.max(...point) - Math.min(...point)).toBeGreaterThan(0.3);
  });

  it('weights a room 0 on another storey and ramps at its edge', () => {
    expect(roomWeight(room, 2, 4.2, 2)).toBe(0);
    expect(roomWeight(room, 2, 1.6, 2)).toBe(1);
    const edge = roomWeight(room, 0.0, 1.6, 2);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
    expect(roomWeight(room, Number.NaN, 1.6, 2)).toBe(0);
  });

  it('shares an eye in a doorway between the rooms and holds the room it was in', () => {
    const sel = new RoomSelector();
    expect(sel.select([room, hall], 4.0, 1.6, 2, null, false).shares.map((s) => s.room.id)).toEqual(['a']);
    // At the wall line both rooms count, and their shares never add to more than one.
    const edge = sel.select([room, hall], 5.0, 1.6, 2, null, false);
    expect(edge.shares).toHaveLength(2);
    expect(edge.shares.reduce((a, s) => a + s.weight, 0)).toBeLessThanOrEqual(1 + 1e-9);
    // Room a was current: it keeps the larger share a little past the wall.
    expect(edge.shares[0]?.room.id).toBe('a');
    expect(sel.select([room, hall], 5.05, 1.6, 2, null, false).shares[0]?.room.id).toBe('a');
    expect(sel.select([room, hall], 5.6, 1.6, 2, null, false).shares[0]?.room.id).toBe('b');
    // Coming back, room b holds in turn: no flip at the same spot.
    expect(sel.select([room, hall], 4.9, 1.6, 2, null, false).shares[0]?.room.id).toBe('b');
    expect(sel.current).toBe('b');
  });

  it('reads the room a camera outside looks at through a cutaway, and not when it is far or looks away', () => {
    const sel = new RoomSelector();
    const dirTo = (from: [number, number, number]): [number, number, number] => {
      const t = [2.5, 1.3, 2];
      const d = [t[0]! - from[0], t[1]! - from[1], t[2]! - from[2]];
      const n = Math.hypot(d[0]!, d[1]!, d[2]!);
      return [d[0]! / n, d[1]! / n, d[2]! / n];
    };
    const near: [number, number, number] = [-6, 4, 2];
    const pick = sel.select([room], near[0], near[1], near[2], dirTo(near), true);
    expect(pick.shares[0]?.room.id).toBe('a');
    expect(pick.subject).toBe(true);
    expect(pick.shares[0]?.weight).toBe(1);
    // With the walls up the view is not into the room.
    expect(new RoomSelector().select([room], near[0], near[1], near[2], dirTo(near), false).shares).toHaveLength(0);
    // Looking away.
    expect(new RoomSelector().select([room], near[0], near[1], near[2], [-1, 0, 0], true).shares).toHaveLength(0);
    // A far camera (a whole-city view) does not set the exposure.
    const far: [number, number, number] = [-80, 30, 2];
    expect(new RoomSelector().select([room], far[0], far[1], far[2], dirTo(far), true).shares).toHaveLength(0);
  });
});

describe('exposure and the look', () => {
  it('the look exposure is a bias on the room exposure', () => {
    expect(toneExposure(1, 0)).toBe(1);
    expect(toneExposure(1, 2)).toBeCloseTo(4, 6);
    expect(toneExposure(1.4, 2) / toneExposure(1, 2)).toBeCloseTo(1.4, 6);
    expect(toneExposure(Number.NaN, Number.NaN)).toBe(1);
  });
});
