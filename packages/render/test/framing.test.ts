import { describe, expect, it } from 'vitest';
import { Group, Mesh, Object3D } from 'three';
import { contentFraming, DEFAULT_SKY_TILT, framingPose, MIN_CAMERA_CLEARANCE, type FramingItem } from '../src/view/framing';
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
