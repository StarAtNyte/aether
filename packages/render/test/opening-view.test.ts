import { describe, expect, it } from 'vitest';
import { boxSightTest, type FramingItem } from '../src/view/framing';
import { ARCH_COVER_ZONE, chooseOpeningView, horizonPitch, NEAR_ZONE, nearestInView, OPENING_HEIGHT, openingLandmark, vistaMeasure, vistaPoints, type OpeningProbe } from '../src/view/opening-view';

const boxAt = (cx: number, cz: number, half: number, height: number, extra: Partial<FramingItem> = {}): FramingItem => ({ min: [cx - half, 0, cz - half], max: [cx + half, height, cz + half], ...extra });

/** A square town: a tower (the landmark) in the middle, a ring of houses, a lake to the east. */
function town(): { items: FramingItem[]; probe: OpeningProbe } {
  const tower = boxAt(0, 0, 3, 24, { focus: true });
  const houses: FramingItem[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    houses.push(boxAt(Math.cos(a) * 22, Math.sin(a) * 22, 4, 7));
  }
  const solid = [tower, ...houses];
  const probe: OpeningProbe = {
    surface(x, z) {
      if (x > 40) return { y: -0.5, kind: 'water' };
      for (const b of solid) if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]) return { y: b.max[1], kind: 'blocked' };
      return { y: 0, kind: 'ground' };
    },
    sight: boxSightTest(solid),
  };
  return { items: solid, probe };
}

describe('opening view', () => {
  it('stands on open ground inside the world at eye height, facing the landmark', () => {
    const { items, probe } = town();
    const v = chooseOpeningView({ framing: { center: [0, 4, 0], radius: 30 }, items, fovDeg: 50, aspect: 16 / 9 }, probe);
    expect(v).not.toBeNull();
    const p = v!.position;
    expect(p[1]).toBeGreaterThanOrEqual(OPENING_HEIGHT[0]);
    expect(p[1]).toBeLessThanOrEqual(OPENING_HEIGHT[1]);
    // Inside the world (not out on an overview), dry and not in a house.
    expect(Math.hypot(p[0], p[2])).toBeLessThan(40);
    expect(probe.surface(p[0], p[2])?.kind).toBe('ground');
    expect(p[0]).toBeLessThan(40);
    // Faces the tower and sees it.
    const look = Math.atan2(v!.target[0] - p[0], v!.target[2] - p[2]);
    const toMark = Math.atan2(-p[0], -p[2]);
    expect(Math.abs(Math.atan2(Math.sin(look - toMark), Math.cos(look - toMark)))).toBeLessThan(0.05);
    expect(probe.sight(p, [0, 12, 0])).toBeGreaterThan(Math.hypot(p[0], p[1] - 12, p[2]) * 0.85);
    // Clear of the houses by a few metres.
    for (const b of items.slice(1)) {
      const dx = Math.max(b.min[0] - p[0], 0, p[0] - b.max[0]);
      const dz = Math.max(b.min[2] - p[2], 0, p[2] - b.max[2]);
      expect(Math.hypot(dx, dz)).toBeGreaterThan(2);
    }
  });

  it('is deterministic', () => {
    const a = town();
    const b = town();
    const input = { framing: { center: [0, 4, 0] as [number, number, number], radius: 30 }, fovDeg: 50, aspect: 16 / 9 };
    expect(chooseOpeningView({ ...input, items: a.items }, a.probe)).toEqual(chooseOpeningView({ ...input, items: b.items }, b.probe));
  });

  it('looks slightly down so a level horizon sits in the upper third', () => {
    // A low landmark (a fountain): nothing pulls the view up.
    const items = [boxAt(0, 0, 3, 2, { focus: true }), boxAt(20, 20, 3, 2), boxAt(-20, 15, 3, 2)];
    const probe: OpeningProbe = { surface: () => ({ y: 0, kind: 'ground' }), sight: boxSightTest(items) };
    const v = chooseOpeningView({ framing: { center: [0, 1, 0], radius: 25 }, items, fovDeg: 50, aspect: 16 / 9 }, probe)!;
    const flat = Math.hypot(v.target[0] - v.position[0], v.target[2] - v.position[2]);
    const pitch = Math.atan2(v.target[1] - v.position[1], flat);
    // Never up into the sky, never down at the feet.
    expect(pitch).toBeLessThanOrEqual(horizonPitch(50) + 1e-6);
    expect(pitch).toBeGreaterThan(-(25 * Math.PI) / 180);
  });

  it('gives up where there is nowhere to stand', () => {
    const { items } = town();
    const probe: OpeningProbe = { surface: () => ({ y: 0, kind: 'water' }), sight: () => Number.POSITIVE_INFINITY };
    expect(chooseOpeningView({ framing: { center: [0, 4, 0], radius: 30 }, items, fovDeg: 50, aspect: 1.7 }, probe)).toBeNull();
  });

  it('takes a focus item as the landmark over taller unfocused content', () => {
    const mark = openingLandmark({ center: [0, 0, 0], radius: 30 }, [boxAt(10, 0, 2, 40), boxAt(-5, 0, 2, 6, { focus: true })]);
    expect(mark?.center[0]).toBe(-5);
  });

  it('turns down a view with something in the near zone of the lens, or an eye under water', () => {
    const { items, probe } = town();
    const input = { framing: { center: [0, 4, 0] as [number, number, number], radius: 30 }, items, fovDeg: 50, aspect: 16 / 9 };
    const free = chooseOpeningView(input, probe)!;
    // A bush a metre in front of the lens, low in the frame.
    const p = free.position;
    const dx = free.target[0] - p[0];
    const dz = free.target[2] - p[2];
    const l = Math.hypot(dx, dz);
    const bush = boxAt(p[0] + (dx / l) * 1.2, p[2] + (dz / l) * 1.2, 0.4, p[1] - 0.6);
    expect(nearestInView(boxSightTest([bush]), p, free.target, 50, 16 / 9)).toBeLessThan(NEAR_ZONE);
    const withBush: OpeningProbe = { ...probe, sight: boxSightTest([...items, bush]) };
    const moved = chooseOpeningView(input, withBush)!;
    expect(moved.position).not.toEqual(p);
    expect(nearestInView(boxSightTest([...items, bush]), moved.position, moved.target, 50, 16 / 9)).toBeGreaterThanOrEqual(NEAR_ZONE);
    // Every eye under water: nothing qualifies.
    expect(chooseOpeningView(input, { ...probe, underWater: () => true })).toBeNull();
  });

  it('frames a building over its garden, not through tall grass at the lens', () => {
    // A house in a meadow of grass a metre tall, with a mown lawn to the south (z < -6).
    const house = boxAt(0, 0, 6, 4, { focus: true });
    const meadow: FramingItem[] = [{ min: [-60, 0, -6], max: [60, 1, 60] }];
    const probe: OpeningProbe = {
      surface: (x, z) => (Math.abs(x) <= 6 && Math.abs(z) <= 6 ? { y: 4, kind: 'blocked' } : { y: 0, kind: 'ground' }),
      sight: boxSightTest([]),
      cover: boxSightTest([house, ...meadow]),
    };
    const input = { framing: { center: [0, 2, 0] as [number, number, number], radius: 14 }, items: [house], fovDeg: 50, aspect: 16 / 9, arch: true };
    const v = chooseOpeningView(input, probe);
    expect(v).not.toBeNull();
    expect(nearestInView(probe.cover!, v!.position, v!.target, 50, 16 / 9, ARCH_COVER_ZONE)).toBeGreaterThanOrEqual(ARCH_COVER_ZONE);
    expect(v!.sees).toBe(true);
    // Without the ground cover counted the same search stands in the grass.
    const blind = chooseOpeningView(input, { ...probe, cover: undefined });
    expect(nearestInView(probe.cover!, blind!.position, blind!.target, 50, 16 / 9, ARCH_COVER_ZONE)).toBeLessThan(ARCH_COVER_ZONE);
  });
});

describe('grand view of a scene', () => {
  it('scores an open, lit view of the sights over a cramped, dark spot', () => {
    const temple: FramingItem = { min: [-10, 0, 60], max: [10, 12, 80], landmark: true };
    const falls: FramingItem = { min: [30, 0, 90], max: [36, 30, 91], landmark: true };
    const overhang: FramingItem = { min: [-20, 6, -6], max: [20, 8, 4] };
    const rock: FramingItem = { min: [-20, 0, 4], max: [20, 5, 6] };
    const items = [temple, falls];
    const vHalf = (50 * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * (16 / 9));
    const open = vistaMeasure([0, 3, 20], 0.15, -0.05, boxSightTest([temple, falls, overhang]), items, vHalf, hHalf, 60);
    const dark = vistaMeasure([0, 3, 0], 0.15, -0.05, boxSightTest([temple, falls, overhang, rock]), items, vHalf, hHalf, 60);
    expect(open.sights).toBe(2);
    expect(open.enclosed).toBe(0);
    expect(dark.enclosed).toBeGreaterThan(0.5);
    expect(dark.cramped).toBeGreaterThan(0.2);
    expect(vistaPoints(open)).toBeGreaterThan(vistaPoints(dark) + 3);
  });
});
