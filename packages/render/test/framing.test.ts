import { describe, expect, it } from 'vitest';
import { Group, Mesh, Object3D } from 'three';
import { boxSightTest, contentFraming, DEFAULT_SKY_TILT, foregroundBlockage, framingPose, frontAzimuthDeg, pickClearView, segmentHitsBox, viewCandidates, MIN_CAMERA_CLEARANCE, type FramingItem } from '../src/view/framing';
import { collectFramingItems, HUGE_EXTENT } from '../src/view/content-items';
import { easeOutBack, easeOutCubic, GROW_DURATION, GROW_MAX_DELAY, GrowIn, growDelay, growScale } from '../src/view/grow-in';
import { box, makeSync, tick, world } from './helpers';

const item = (cx: number, cz: number, half = 1, extra: Partial<FramingItem> = {}): FramingItem => ({ min: [cx - half, 0, cz - half], max: [cx + half, 2 * half, cz + half], ...extra });

/** Angle (degrees) between the camera's view direction and the direction to `p`. */
function angleTo(pose: { position: number[]; target: number[] }, p: number[]): number {
  const v = [0, 1, 2].map((i) => (pose.target[i] as number) - (pose.position[i] as number));
  const w = [0, 1, 2].map((i) => (p[i] as number) - (pose.position[i] as number));
  const dot = v[0]! * w[0]! + v[1]! * w[1]! + v[2]! * w[2]!;
  return (Math.acos(dot / (Math.hypot(...v) * Math.hypot(...w))) * 180) / Math.PI;
}

describe('contentFraming', () => {
  it('is robust to a distant outlier and returns null for nothing', () => {
    expect(contentFraming([])).toBeNull();
    const items = [item(0, 0), item(3, 2), item(-2, 4), item(1, -3), item(400, 400)];
    const f = contentFraming(items)!;
    expect(Math.hypot(f.center[0], f.center[2])).toBeLessThan(5);
    expect(f.radius).toBeLessThan(60);
  });

  it('focus items pull the center and must be in the sphere', () => {
    const items = [item(0, 0), item(2, 0), item(-2, 0), item(30, 0, 1, { focus: true })];
    const f = contentFraming(items)!;
    expect(f.center[0]).toBeGreaterThan(15);
    expect(Math.hypot(f.center[0] - 30, f.center[2]) + Math.SQRT2).toBeLessThanOrEqual(f.radius);
  });

  it('ignores non-finite boxes', () => {
    const f = contentFraming([item(0, 0), { min: [Number.NaN, 0, 0], max: [1, 1, 1] }]);
    expect(f).not.toBeNull();
  });
});

describe('framingPose', () => {
  const framing = { center: [0, 2, 0] as [number, number, number], radius: 20 };

  it('looks down from an elevated three-quarter view and keeps the sphere in a portrait viewport', () => {
    const pose = framingPose(framing, { fovDeg: 55, aspect: 0.84 });
    expect(pose.position[1]).toBeGreaterThan(framing.center[1] + 10);
    // Horizontally the sphere fits the narrower half-FOV.
    const hHalf = (Math.atan(Math.tan((27.5 * Math.PI) / 180) * 0.84) * 180) / Math.PI;
    const centerAngle = angleTo(pose, framing.center);
    const d = Math.hypot(...[0, 1, 2].map((i) => (framing.center[i] as number) - (pose.position[i] as number)));
    const sphereHalf = (Math.asin(framing.radius / d) * 180) / Math.PI;
    expect(sphereHalf).toBeLessThanOrEqual(hHalf + 1e-6);
    // The view is tilted up: the content center sits below the screen center (sky in frame).
    expect(centerAngle).toBeGreaterThan(DEFAULT_SKY_TILT * 0.9);
    expect(pose.target[1]).toBeGreaterThan(framing.center[1]);
    // Orbiting pivots above the content center.
    expect(pose.target[0]).toBeCloseTo(0, 6);
    expect(pose.target[2]).toBeCloseTo(0, 6);
    expect(pose.distance).toBeCloseTo(Math.hypot(...[0, 1, 2].map((i) => (pose.position[i] as number) - (pose.target[i] as number))), 6);
  });

  it('the top edge of the frame shows sky above the horizon', () => {
    const pose = framingPose(framing, { fovDeg: 55, aspect: 1.6 });
    const pitch = (Math.atan2(pose.position[1] - pose.target[1], Math.hypot(pose.position[0] - pose.target[0], pose.position[2] - pose.target[2])) * 180) / Math.PI;
    // Top edge = pitch - vHalf above the horizon.
    expect(27.5 - pitch).toBeGreaterThan(5);
  });

  it('large scenes (a 50 m village) in a portrait viewport still keep a band of sky in frame', () => {
    for (const radius of [50, 80, 120]) {
      const pose = framingPose({ center: [0, 3, 0], radius }, { fovDeg: 55, aspect: 0.84 });
      const pitch = (Math.atan2(pose.position[1] - pose.target[1], Math.hypot(pose.position[0] - pose.target[0], pose.position[2] - pose.target[2])) * 180) / Math.PI;
      expect(27.5 - pitch).toBeGreaterThan(5);
      // Still an elevated view, not a ground-level shot.
      expect(pitch).toBeGreaterThan(15);
    }
  });

  it('never puts the camera below the ground, and wider viewports bring it closer', () => {
    const low = framingPose({ center: [0, -50, 0], radius: 5 }, { fovDeg: 55, aspect: 1, groundY: 0 });
    expect(low.position[1]).toBeGreaterThanOrEqual(MIN_CAMERA_CLEARANCE);
    const wide = framingPose(framing, { fovDeg: 55, aspect: 2 });
    const tall = framingPose(framing, { fovDeg: 55, aspect: 0.5 });
    expect(wide.distance).toBeLessThan(tall.distance);
    const noTilt = framingPose(framing, { fovDeg: 55, aspect: 1, tiltDeg: 0 });
    expect(noTilt.target[1]).toBeCloseTo(framing.center[1], 6);
  });

  it('survives garbage input', () => {
    const pose = framingPose({ center: [Number.NaN, 0, 0], radius: Number.NaN }, { fovDeg: Number.NaN, aspect: -1, tiltDeg: Number.POSITIVE_INFINITY });
    for (const v of [...pose.position, ...pose.target, pose.distance]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('collectFramingItems', () => {
  it('skips backdrop/terrain/sky tags and huge entities, marks focus and down-weights scatter', async () => {
    const { sync } = makeSync();
    await sync.setWorld(
      world([
        box('hero', [0, 0.5, 0], { tags: ['focus'] }),
        box('prop', [3, 0.5, 0]),
        box('mountain', [100, 0.5, 0], { tags: ['backdrop'] }),
        box('cloud', [0, 50, 0], { tags: ['sky'] }),
        { id: 'plate', transform: { position: [0, 0, 0] }, shape: { kind: 'primitive', primitive: 'box', size: [HUGE_EXTENT + 10, 1, 4] } },
      ]),
    );
    await tick();
    const items = collectFramingItems(sync);
    expect(items).toHaveLength(2);
    expect(items.filter((i) => i.focus)).toHaveLength(1);
    // An explicitly focused backdrop entity is framed after all.
    expect(collectFramingItems(sync, new Set(['mountain']))).toHaveLength(3);
    sync.dispose();
  });

  it('treats untagged terrain generators as scenery, but frames scenery when it is all there is', async () => {
    const { sync } = makeSync();
    const peak = { id: 'peak', transform: { position: [80, 0, -80] as [number, number, number] }, shape: { kind: 'procedural' as const, generator: 'mountain', params: {} } };
    await sync.setWorld(world([box('camp', [0, 0.5, 0]), peak]));
    await tick();
    const items = collectFramingItems(sync);
    expect(items).toHaveLength(1);
    expect(items[0]!.max[0]).toBeLessThan(5);
    await sync.setWorld(world([peak]));
    await tick();
    expect(collectFramingItems(sync)).toHaveLength(1);
    expect(collectFramingItems(sync)[0]!.min[0]).toBeGreaterThan(50);
    sync.dispose();
  });
});

describe('grow-in', () => {
  it('eases from ~0 to 1, with an optional overshoot', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutBack(1)).toBeCloseTo(1, 10);
    let peak = 0;
    for (let t = 0; t <= 1; t += 0.01) peak = Math.max(peak, easeOutBack(t));
    expect(peak).toBeGreaterThan(1.02);
    expect(peak).toBeLessThan(1.2);
    expect(growScale(0, 0.2, true)).toBeLessThan(0.01);
    expect(growScale(10, 0.2, true)).toBe(1);
  });

  it('staggers by distance from the center up to the max delay', () => {
    expect(growDelay(0)).toBe(0);
    expect(growDelay(30)).toBeGreaterThan(0);
    expect(growDelay(1e6)).toBe(GROW_MAX_DELAY);
    expect(growDelay(Number.NaN)).toBe(0);
  });

  it('hides, grows, finishes and drops detached targets', () => {
    const parent = new Group();
    const a = new Object3D();
    const b = new Object3D();
    const c = new Object3D();
    parent.add(a, b, c);
    const grow = new GrowIn();
    grow.hide(a);
    expect(a.scale.x).toBeLessThan(0.01);
    expect(grow.active).toBe(false);
    grow.start(a, 0, true);
    grow.start(b, 0.5, false);
    grow.start(c, 0, false);
    expect(grow.size).toBe(3);
    parent.remove(c);
    expect(grow.update(GROW_DURATION / 2)).toBe(true);
    expect(grow.size).toBe(2);
    expect(a.scale.x).toBeGreaterThan(0.5);
    expect(b.scale.x).toBeLessThan(0.01);
    // Bounds code sees full scale, then the animation state comes back.
    const seen = grow.withFullScale(() => [a.scale.x, b.scale.x]);
    expect(seen).toEqual([1, 1]);
    expect(b.scale.x).toBeLessThan(0.01);
    for (let i = 0; i < 40; i++) grow.update(0.05);
    expect(grow.active).toBe(false);
    expect(a.scale.x).toBe(1);
    expect(b.scale.x).toBe(1);
    // The local matrix follows the scale (content groups do not auto-update).
    expect(a.matrix.elements[0]).toBe(1);
  });

  it('finishAll jumps to the end; update never allocates targets of its own', () => {
    const parent = new Group();
    const m = new Mesh();
    parent.add(m);
    const grow = new GrowIn();
    grow.hide(m);
    grow.finishAll();
    expect(m.scale.x).toBe(1);
    expect(grow.size).toBe(0);
    expect(grow.update(Number.NaN)).toBe(false);
  });
});

describe('frontAzimuthDeg', () => {
  it('swings the camera aside of the garden direction', () => {
    expect(frontAzimuthDeg(0, 10, 0)).toBeCloseTo(0);
    expect(frontAzimuthDeg(10, 0, 0)).toBeCloseTo(90);
    expect(Math.abs(frontAzimuthDeg(0, -10, 0) ?? 0)).toBeCloseTo(180);
    expect(frontAzimuthDeg(0, 10)).toBeCloseTo(28);
  });
  it('wraps into -180..180 and refuses a missing direction', () => {
    expect(Math.abs(frontAzimuthDeg(0, -10, 28) ?? 0)).toBeLessThanOrEqual(180);
    expect(frontAzimuthDeg(0, 0)).toBeNull();
    expect(frontAzimuthDeg(Number.NaN, 3)).toBeNull();
  });
});

describe('pickClearView', () => {
  const framing = { center: [0, 2, 0] as [number, number, number], radius: 6 };
  const base = { fovDeg: 50, aspect: 16 / 9, groundY: 0 };
  /** A tree (trunk and crown as one box) on the line from the camera of azimuth `az` to the center, `at` metres out. */
  const treeOnLine = (az: number, at: number): FramingItem => {
    const a = (az * Math.PI) / 180;
    const x = Math.sin(a) * at;
    const z = Math.cos(a) * at;
    return { min: [x - 1.5, 0, z - 1.5], max: [x + 1.5, 12, z + 1.5] };
  };
  const eyeOf = (az: number, elevationDeg?: number): [number, number, number] => framingPose(framing, { ...base, azimuthDeg: az, ...(elevationDeg !== undefined ? { elevationDeg } : {}) }).position;

  it('keeps the preferred view when nothing is in the way', () => {
    const view = pickClearView(framing, base, viewCandidates(28), boxSightTest([]))!;
    expect(view.index).toBe(0);
    expect(view.blockage).toBe(0);
    expect(view.candidate.azimuthDeg).toBe(28);
    expect(view.pose).toEqual(framingPose(framing, { ...base, azimuthDeg: 28 }));
  });

  it('ignores the subject itself and what stands right next to it', () => {
    // A tent at the center, a tree just behind it and a bush at the near edge of the subject: part of the shot.
    const bush: FramingItem = { min: [-0.6, 0, -0.6], max: [0.6, 1.2, 0.6] };
    const a = (28 * Math.PI) / 180;
    const nearEdge: FramingItem = { min: [Math.sin(a) * 2.5 + bush.min[0], 0, Math.cos(a) * 2.5 + bush.min[2]], max: [Math.sin(a) * 2.5 + bush.max[0], 1.2, Math.cos(a) * 2.5 + bush.max[2]] };
    const view = pickClearView(framing, base, viewCandidates(28), boxSightTest([{ min: [-1, 0, -1], max: [1, 2, 1] }, treeOnLine(28 + 180, 2), nearEdge]))!;
    expect(view.index).toBe(0);
  });

  it('moves aside when a tree stands between the camera and the subject', () => {
    const eye = eyeOf(28);
    const tree = treeOnLine(28, Math.hypot(eye[0], eye[2]) * 0.6);
    const sight = boxSightTest([tree]);
    expect(foregroundBlockage(eye, framing, sight)).toBeGreaterThan(0.5);
    const view = pickClearView(framing, base, viewCandidates(28), sight)!;
    expect(view.index).toBeGreaterThan(0);
    expect(view.blockage).toBe(0);
    // The nearest clear swing wins over wider ones.
    expect(Math.abs(view.candidate.azimuthDeg - 28)).toBe(35);
  });

  it('scores a tree near the camera worse than one near the subject, and the camera inside a crown worst', () => {
    const eye = eyeOf(28);
    const reach = Math.hypot(eye[0], eye[2]);
    const near = foregroundBlockage(eye, framing, boxSightTest([treeOnLine(28, reach * 0.85)]));
    const far = foregroundBlockage(eye, framing, boxSightTest([treeOnLine(28, framing.radius * 0.9)]));
    expect(near).toBeGreaterThan(far);
    const crown: FramingItem = { min: [eye[0] - 2, eye[1] - 2, eye[2] - 2], max: [eye[0] + 2, eye[1] + 2, eye[2] + 2] };
    // A box holding the camera hides everything: the forward test misses it (the segment starts inside), the backward one does not.
    const inside = foregroundBlockage(eye, framing, (from, to) => {
      const d = boxSightTest([crown])(from, to);
      return d === 0 ? Number.POSITIVE_INFINITY : d;
    });
    expect(inside).toBe(1);
  });

  it('looks over a wall of trees across every direction', () => {
    // A ring of tall trees between the subject and every low camera, too low to hide a raised one.
    const ring: FramingItem[] = [];
    for (let a = 0; a < 360; a += 10) {
      const r = (a * Math.PI) / 180;
      ring.push({ min: [Math.sin(r) * 11 - 1.6, 0, Math.cos(r) * 11 - 1.6], max: [Math.sin(r) * 11 + 1.6, 9, Math.cos(r) * 11 + 1.6] });
    }
    const sight = boxSightTest(ring);
    const view = pickClearView(framing, base, viewCandidates(28), sight)!;
    expect(view.candidate.elevationDeg).toBeGreaterThan(28);
    expect(view.blockage).toBeLessThan(foregroundBlockage(eyeOf(28), framing, sight));
  });

  it('segmentHitsBox is exact for crossing and missing segments', () => {
    expect(segmentHitsBox([0, 1, 20], [0, 1, 0], [-1, 0, 9], [1, 8, 11])).toBe(true);
    expect(segmentHitsBox([10, 1, 20], [10, 1, 0], [-1, 0, 9], [1, 8, 11])).toBe(false);
    expect(segmentHitsBox([0, 1, 5], [0, 1, 0], [-1, 0, 9], [1, 8, 11])).toBe(false);
  });
});
