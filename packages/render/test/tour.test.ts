import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { CameraTour, tourKeys, droneTourKeys, tourSections } from '../src/view/tour';
import { CameraRig } from '../src/view/camera-rig';
import { describeSites, probeAllocations } from '../../../tests/unit/alloc-probe';

const from = { pos: [30, 20, 40] as [number, number, number], target: [0, 1, 0] as [number, number, number] };

describe('camera tour', () => {
  it('loops around the content from and back to the current pose, above the floor', () => {
    const keys = tourKeys(from, [0, 0, 0], 20, [[5, 2, 5]], 1);
    expect(keys[0]).toBe(from);
    expect(keys[keys.length - 1]!.pos).toEqual(from.pos);
    for (const k of keys) expect(k.pos[1]).toBeGreaterThanOrEqual(1);
    // Low passes look at the focus point.
    expect(keys.some((k) => k.target[0] === 5 && k.target[2] === 5)).toBe(true);
    // Keys circle the centre: their bearings cover more than half a turn.
    const bearings = keys.map((k) => Math.atan2(k.pos[0], k.pos[2]));
    expect(Math.max(...bearings) - Math.min(...bearings)).toBeGreaterThan(Math.PI);
  });

  it('plays smoothly from start to end and then stops', () => {
    const tour = new CameraTour(tourKeys(from, [0, 0, 0], 20), 10);
    const cam = new PerspectiveCamera();
    const target = new Vector3();
    let steps = 0;
    let prev = cam.position.clone();
    let maxJump = 0;
    while (tour.update(1 / 30, cam, target, 0.5)) {
      if (steps > 0) maxJump = Math.max(maxJump, cam.position.distanceTo(prev));
      prev = cam.position.clone();
      steps++;
    }
    expect(steps).toBeGreaterThanOrEqual(300);
    expect(steps).toBeLessThanOrEqual(301);
    expect(tour.active).toBe(false);
    expect(cam.position.distanceTo(new Vector3(...from.pos))).toBeLessThan(1e-3);
    expect(maxJump).toBeLessThan(2);
  });

  it('is stopped by camera commands on the rig and allocates nothing per frame', async () => {
    const cam = new PerspectiveCamera();
    const rig = new CameraRig(cam, null);
    rig.startTour(new CameraTour(tourKeys(from, [0, 0, 0], 20), 1000));
    expect(rig.touring).toBe(true);
    expect(rig.update(0.016)).toBe(true);
    const r = await probeAllocations(() => rig.update(0.016), { iterations: 300, warmup: 20_000, match: /packages\/render\/src\// });
    expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(16);
    rig.flyTo(new Vector3(1, 2, 3), new Vector3(), 0);
    expect(rig.touring).toBe(false);
    rig.startTour(new CameraTour(tourKeys(from, [0, 0, 0], 20), 1000));
    rig.setMode('orbit', null);
    expect(rig.touring).toBe(false);
  });
});

describe('drone tour of a large scene', () => {
  const box = (x: number, z: number, w: number, h: number) => ({ min: [x - w / 2, 0, z - w / 2] as [number, number, number], max: [x + w / 2, h, z + w / 2] as [number, number, number] });
  // Three villages far apart, each a few houses, and a road too flat to count.
  const items = [box(-100, 0, 8, 7), box(-92, 6, 8, 7), box(-104, 10, 6, 6), box(100, 0, 10, 12), box(108, -4, 8, 9), box(0, 110, 20, 18), { min: [-150, 0, -2] as [number, number, number], max: [150, 0.2, 2] as [number, number, number] }];

  it('finds one section per cluster, heaviest first, and leaves flat pieces out', () => {
    const s = tourSections(items, 150);
    expect(s.length).toBe(3);
    expect(Math.hypot(s[0]!.center[0], s[0]!.center[2] - 110)).toBeLessThan(5);
  });

  it('visits every section close up, keeps clear of the ground and paces the keys by time', () => {
    const ground = (x: number) => (x > 0 ? 20 : 0);
    const sections = tourSections(items, 150);
    const from = { pos: [0, 60, -200] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    const { keys, times } = droneTourKeys(from, sections, [0, 5, 0], 150, { ground, clear: () => true });
    expect(keys.length).toBe(times.length);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    for (const k of keys.slice(1, -1)) expect(k.pos[1]).toBeGreaterThanOrEqual(ground(k.pos[0]) + 2.5 - 1e-6);
    for (const s of sections) {
      const nearest = Math.min(...keys.map((k) => Math.hypot(k.pos[0] - s.center[0], k.pos[2] - s.center[2])));
      expect(nearest).toBeLessThan(Math.max(7, s.size * 1.25) + 1);
    }
    expect(keys[keys.length - 1]!.pos).toEqual(from.pos);
    const tour = new CameraTour(keys, 26, times);
    expect(tour.seconds).toBeCloseTo(times[times.length - 1]!, 6);
  });
});
