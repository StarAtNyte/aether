import { describe, expect, it } from 'vitest';
import { boxSightTest, type FramingItem } from '../src/view/framing';
import { NEAR_ZONE, nearestInView, type OpeningProbe } from '../src/view/opening-view';
import { archStops, MAX_STOPS, MIN_STOPS, MIN_STOP_SPACING, orderStops, quickSceneStops, ROOM_EYE, roomStop, sceneStops, type QuickStopProbe, type RoomArea } from '../src/view/view-stops';
import { parseCookManifest, worldIrHash } from '../src/cook/format';

const box = (min: [number, number, number], max: [number, number, number]): FramingItem => ({ min, max });

/** A room `w` × `d` with walls 0.2 m thick and 2.8 m high round it (origin at its corner), floor at 0. */
function walls(x0: number, z0: number, w: number, d: number): FramingItem[] {
  return [
    box([x0 - 0.2, 0, z0 - 0.2], [x0 + w + 0.2, 2.8, z0]),
    box([x0 - 0.2, 0, z0 + d], [x0 + w + 0.2, 2.8, z0 + d + 0.2]),
    box([x0 - 0.2, 0, z0], [x0, 2.8, z0 + d]),
    box([x0 + w, 0, z0], [x0 + w + 0.2, 2.8, z0 + d]),
    // The ceiling.
    box([x0 - 0.2, 2.8, z0 - 0.2], [x0 + w + 0.2, 3, z0 + d + 0.2]),
  ];
}

const room = (id: string, name: string, x0: number, z0: number, w: number, d: number): RoomArea => ({ id, name, min: [x0, -0.2, z0], max: [x0 + w, 0, z0 + d], floorY: 0 });

describe('room tour stops', () => {
  it('stands at eye height inside the room, out of the furniture, with the frame clear', () => {
    // A bedroom with a bed in the middle: the middle of the room is not a place to stand.
    const solid = [...walls(0, 0, 6, 5), box([2, 0, 1.5], [4, 0.6, 3.5])];
    const sight = boxSightTest(solid);
    const s = roomStop(room('r1', 'Bedroom', 0, 0, 6, 5), { sight }, 70, 16 / 9);
    expect(s).not.toBeNull();
    const p = s!.position;
    expect(p[1]).toBeCloseTo(ROOM_EYE, 5);
    expect(p[0]).toBeGreaterThan(0);
    expect(p[0]).toBeLessThan(6);
    expect(p[2]).toBeGreaterThan(0);
    expect(p[2]).toBeLessThan(5);
    // Not over the bed.
    expect(p[0] > 2 && p[0] < 4 && p[2] > 1.5 && p[2] < 3.5).toBe(false);
    expect(s!.name).toBe('Bedroom');
    expect(s!.room).toBe('r1');
    // Looks across the room, slightly down, with nothing close to the lens.
    expect(s!.target[1]).toBeLessThan(p[1]);
    expect(nearestInView(sight, p, s!.target, 70, 16 / 9)).toBeGreaterThanOrEqual(NEAR_ZONE * 0.5);
  });

  it('skips a room with nowhere to stand', () => {
    const solid = [...walls(0, 0, 3, 3), box([0, 0, 0], [3, 2, 3])];
    expect(roomStop(room('r', 'Store', 0, 0, 3, 3), { sight: boxSightTest(solid) }, 70, 1.6)).toBeNull();
  });

  it('gives a building the hero view and one stop per room, ordered as a walk', () => {
    const rooms = [room('a', 'Living room', 0, 0, 6, 5), room('b', 'Kitchen', 6.2, 0, 4, 5), room('c', 'Bedroom', 0, 5.2, 6, 4), room('d', 'Bath', 6.2, 5.2, 4, 4)];
    const solid = [...walls(0, 0, 6, 5), ...walls(6.2, 0, 4, 5), ...walls(0, 5.2, 6, 4), ...walls(6.2, 5.2, 4, 4)];
    const hero = { position: [-8, 1.7, -8] as [number, number, number], target: [0, 1, 0] as [number, number, number] };
    const stops = archStops(rooms, { sight: boxSightTest(solid) }, 70, 16 / 9, { first: hero });
    expect(stops.length).toBe(5);
    expect(stops.length).toBeGreaterThanOrEqual(MIN_STOPS);
    expect(stops.length).toBeLessThanOrEqual(MAX_STOPS);
    expect(stops[0]!.position).toEqual(hero.position);
    expect(new Set(stops.slice(1).map((s) => s.name))).toEqual(new Set(['Living room', 'Kitchen', 'Bedroom', 'Bath']));
    // Deterministic.
    expect(archStops(rooms, { sight: boxSightTest(solid) }, 70, 16 / 9, { first: hero })).toEqual(stops);
  });

  it('caps the stops and keeps the largest rooms', () => {
    const rooms: RoomArea[] = [];
    const solid: FramingItem[] = [];
    for (let i = 0; i < 12; i++) {
      const w = 3 + (i % 4);
      rooms.push(room(`r${i}`, `Room ${i}`, i * 8, 0, w, 4));
      solid.push(...walls(i * 8, 0, w, 4));
    }
    const stops = archStops(rooms, { sight: boxSightTest(solid) }, 70, 16 / 9);
    expect(stops.length).toBe(MAX_STOPS);
    const names = new Set(stops.map((s) => s.name));
    // The 6 m rooms (i % 4 === 3) are all in.
    for (const i of [3, 7, 11]) expect(names.has(`Room ${i}`)).toBe(true);
  });
});

describe('scene viewpoints', () => {
  /** A town: a tower in the middle, three districts of houses, a lake to the east. */
  function town(): { items: FramingItem[]; probe: OpeningProbe } {
    const items: FramingItem[] = [{ min: [-3, 0, -3], max: [3, 24, 3], focus: true }];
    const centres: Array<[number, number]> = [[-60, 0], [40, 40], [20, -60]];
    for (const [cx, cz] of centres) for (let i = 0; i < 6; i++) items.push(box([cx + (i % 3) * 9 - 9, 0, cz + Math.floor(i / 3) * 12 - 6], [cx + (i % 3) * 9 - 4, 8, cz + Math.floor(i / 3) * 12 - 1]));
    const probe: OpeningProbe = {
      surface(x, z) {
        if (x > 90) return { y: -0.5, kind: 'water' };
        for (const b of items) if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]) return { y: b.max[1], kind: 'blocked' };
        return { y: 0, kind: 'ground' };
      },
      sight: boxSightTest(items),
    };
    return { items, probe };
  }

  it('finds 4 to 8 spread viewpoints on open dry ground, the hero view first', () => {
    const { items, probe } = town();
    const hero = { position: [0, 2, 30] as [number, number, number], target: [0, 8, 0] as [number, number, number] };
    const stops = sceneStops({ framing: { center: [0, 4, 0], radius: 80 }, items, fovDeg: 50, aspect: 16 / 9 }, probe, { first: hero, name: () => 'Spot' });
    expect(stops.length).toBeGreaterThanOrEqual(MIN_STOPS);
    expect(stops.length).toBeLessThanOrEqual(MAX_STOPS);
    expect(stops[0]!.position).toEqual(hero.position);
    for (const s of stops.slice(1)) {
      expect(probe.surface(s.position[0], s.position[2])?.kind).toBe('ground');
      expect(s.name).toBe('Spot');
    }
    for (let i = 0; i < stops.length; i++)
      for (let j = i + 1; j < stops.length; j++) expect(Math.hypot(stops[i]!.position[0] - stops[j]!.position[0], stops[i]!.position[1] - stops[j]!.position[1], stops[i]!.position[2] - stops[j]!.position[2])).toBeGreaterThanOrEqual(MIN_STOP_SPACING);
  });

  it('orders stops as a walk from the first', () => {
    const at = (x: number): { position: [number, number, number] } => ({ position: [x, 0, 0] });
    expect(orderStops([at(0), at(30), at(10), at(20)]).map((s) => s.position[0])).toEqual([0, 10, 20, 30]);
  });
});

describe('quick viewpoints (a viewer on a large live world)', () => {
  // Three districts round a middle; a lake east of x = 90; a wall north of z = -30 hides the north district from the south.
  const water = (x: number): boolean => x > 90;
  const probe: QuickStopProbe = {
    ground: (x) => ({ y: 0, water: water(x) }),
    clear: (a, b) => !((a[2] < -30) !== (b[2] < -30)),
    near: () => 3,
  };
  const sections = [
    { center: [-60, 4, 0] as [number, number, number], size: 12 },
    { center: [80, 4, 0] as [number, number, number], size: 12 },
    { center: [0, 4, -60] as [number, number, number], size: 12 },
  ];

  it('gives each district a dry viewpoint that sees it, after the hero view', () => {
    const hero = { position: [0, 30, 40] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    const stops = quickSceneStops(sections, [0, 0, 0], probe, { first: hero, name: (c) => `D${c[0]}` });
    expect(stops.length).toBe(4);
    expect(stops[0]!.position).toEqual(hero.position);
    for (const s of stops.slice(1)) {
      expect(water(s.position[0])).toBe(false);
      expect(probe.clear(s.position, s.target)).toBe(true);
      expect(s.position[1]).toBeGreaterThanOrEqual(8);
    }
    expect(new Set(stops.map((s) => s.name ?? null))).toEqual(new Set([null, 'D-60', 'D80', 'D0']));
  });

  it('stands in the street for a city when the frame is clear', () => {
    const stops = quickSceneStops(sections, [0, 0, 0], probe, { street: true });
    for (const s of stops) expect(s.position[1]).toBeCloseTo(1.7, 6);
    const cramped = quickSceneStops(sections, [0, 0, 0], { ...probe, near: () => 0.5 }, { street: true });
    for (const s of cramped) expect(s.position[1]).toBeGreaterThanOrEqual(8);
  });
});

describe('cooked tour stops', () => {
  const manifest = (views: unknown): Record<string, unknown> => ({
    format: 1,
    irHash: 'a'.repeat(64),
    genVersion: 'g1',
    dir: 'abc/',
    cookedAt: '2026-11-06T00:00:00Z',
    world: { id: 'w', name: 'W', entities: 1 },
    opening: null,
    startMode: 'orbit',
    profile: 'city',
    ...(views !== undefined ? { views } : {}),
    partition: null,
    cells: [],
    packs: [],
    entries: {},
    programs: {},
    lightmap: null,
  });

  it('reads the city profile and the views, and refuses bad views', async () => {
    const { COOK_FORMAT } = await import('../src/cook/format');
    const ok = parseCookManifest({ ...manifest([{ position: [0, 1.6, 0], target: [1, 1.5, 0], name: 'Castle' }]), format: COOK_FORMAT });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.manifest.profile).toBe('city');
      expect(ok.manifest.views).toEqual([{ position: [0, 1.6, 0], target: [1, 1.5, 0], name: 'Castle' }]);
    }
    expect(parseCookManifest({ ...manifest([{ position: [0, 1], target: [1, 1, 0] }]), format: COOK_FORMAT }).ok).toBe(false);
    expect(parseCookManifest({ ...manifest(Array.from({ length: 13 }, () => ({ position: [0, 0, 0], target: [1, 0, 0] }))), format: COOK_FORMAT }).ok).toBe(false);
    const none = parseCookManifest({ ...manifest(undefined), format: COOK_FORMAT });
    expect(none.ok && none.manifest.views).toBe(undefined);
  });

  it('leaves the presentation fields out of the IR hash', async () => {
    const world = { id: 'w', name: 'W', entities: {} };
    expect(await worldIrHash({ ...world, profile: 'city', views: [{ position: [0, 0, 0], target: [1, 0, 0] }] })).toBe(await worldIrHash(world));
  });
});
