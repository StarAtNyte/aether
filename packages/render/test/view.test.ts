import { describe, expect, it } from 'vitest';
import { Box3Helper, Group, LineSegments, Mesh, PerspectiveCamera, Vector3 } from 'three';
import { CameraRig, damp, easeInOutCubic, MIN_FOLLOW_DISTANCE, type OrbitControlsLike } from '../src/view/camera-rig';
import { captureMime, captureSize, MAX_CAPTURE_SIZE, viewPose } from '../src/view/capture';
import { FrameStats } from '../src/view/frame-stats';
import { Highlighter, MAX_HIGHLIGHTS } from '../src/view/highlighter';
import { DebugOverlay } from '../src/view/debug-overlay';
import { Avatar } from '../src/view/avatar';
import { readTransform, TransformGizmo, type TransformControlsLike } from '../src/view/transform-gizmo';
import { box, makeSync, patch, world } from './helpers';

function fakeControls(): OrbitControlsLike & { updates: number } {
  return {
    enabled: true,
    enableDamping: false,
    dampingFactor: 0,
    target: new Vector3(),
    updates: 0,
    update() {
      this.updates++;
      return true;
    },
    dispose() {},
  };
}

describe('easing', () => {
  it('eases and damps', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(2)).toBe(1);
    expect(damp(6, 0)).toBe(0);
    expect(damp(6, 10)).toBeCloseTo(1);
  });
});

describe('CameraRig', () => {
  it('orbit mode updates controls; focus flies smoothly to the target', () => {
    const cam = new PerspectiveCamera(50, 1, 0.1, 1000);
    cam.position.set(0, 0, 20);
    const controls = fakeControls();
    const rig = new CameraRig(cam, controls);
    expect(controls.enableDamping).toBe(true);
    rig.update(0.016);
    expect(controls.updates).toBe(1);
    rig.focusOn(new Vector3(10, 0, 0), 2, 1);
    expect(rig.focusing).toBe(true);
    expect(rig.update(0.5)).toBe(true); // flights always report motion (on-demand rendering)
    expect(controls.target.x).toBeGreaterThan(0);
    expect(controls.target.x).toBeLessThan(10);
    for (let i = 0; i < 10; i++) rig.update(0.1);
    expect(rig.focusing).toBe(false);
    expect(controls.target.x).toBeCloseTo(10);
    expect(cam.position.distanceTo(new Vector3(10, 0, 0))).toBeGreaterThan(2);
    rig.focusOn(new Vector3(-5, 0, 0), 1, 0);
    expect(controls.target.x).toBe(-5);
  });

  it('reports its look-at target (orbit target for placement and camera presets)', () => {
    const cam = new PerspectiveCamera(50, 1, 0.1, 1000);
    cam.position.set(0, 10, 20);
    const controls = fakeControls();
    const rig = new CameraRig(cam, controls);
    rig.flyTo(new Vector3(0, 30, 0.01), new Vector3(4, 0, -2), 0);
    const out = new Vector3();
    expect(rig.getTarget(out)).toBe(out);
    expect(out.toArray()).toEqual([4, 0, -2]);
    // A straight-down camera (top view) is allowed by flyTo (focusOn would clamp the elevation).
    expect(cam.position.y).toBe(30);
    const noControls = new CameraRig(new PerspectiveCamera(), null);
    noControls.flyTo(new Vector3(1, 2, 3), new Vector3(7, 8, 9), 0);
    expect(noControls.getTarget(new Vector3()).toArray()).toEqual([7, 8, 9]);
  });

  it('follow chases from behind the target heading; first person sits at eye height', () => {
    const cam = new PerspectiveCamera();
    const controls = fakeControls();
    const rig = new CameraRig(cam, controls);
    const target = new Vector3(5, 0, 5);
    rig.setMode('follow', (out) => {
      out.copy(target);
      return 0;
    });
    expect(controls.enabled).toBe(false);
    for (let i = 0; i < 200; i++) rig.update(1 / 60);
    expect(cam.position.x).toBeCloseTo(5, 1);
    expect(cam.position.z).toBeGreaterThan(5); // behind = +Z at yaw 0
    rig.setMode('firstPerson', (out) => {
      out.copy(target);
      return Math.PI / 2;
    });
    rig.update(0.016);
    expect(cam.position.y).toBeCloseTo(1.6);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    expect(fwd.x).toBeCloseTo(-1, 5);
    rig.setMode('follow', () => Number.NaN);
    const before = cam.position.clone();
    rig.update(0.1);
    expect(cam.position.equals(before)).toBe(true);
    rig.setMode('orbit', null);
    expect(controls.enabled).toBe(true);
    rig.dispose();
  });
});

describe('capture helpers', () => {
  it('sanitizes sizes and mime types', () => {
    expect(captureSize(1e9, 100)).toBe(MAX_CAPTURE_SIZE);
    expect(captureSize(undefined, 300)).toBe(300);
    expect(captureSize(Number.NaN, 2)).toBe(16);
    expect(captureMime('image/png')).toBe('image/png');
    expect(captureMime('text/html')).toBe('image/jpeg');
    expect(captureMime(undefined)).toBe('image/jpeg');
  });

  it('frames views around the bounds', () => {
    const b = { min: [-2, 0, -2] as [number, number, number], max: [2, 4, 2] as [number, number, number] };
    const top = viewPose(b, 'top');
    expect(top.position[1]).toBeGreaterThan(4);
    expect(top.up).toEqual([0, 0, -1]);
    expect(viewPose(b, 'front').position[2]).toBeGreaterThan(2);
    expect(viewPose(b, 'side').position[0]).toBeGreaterThan(2);
    const iso = viewPose(b, 'iso');
    expect(iso.position.every((v, i) => v > (iso.target[i] as number))).toBe(true);
    expect(iso.halfSize).toBeGreaterThan(Math.hypot(4, 4, 4) / 2);
    expect(viewPose(null, 'top').target).toEqual([0, 0, 0]);
  });
});

describe('FrameStats', () => {
  it('smooths fps and ignores invalid frames', () => {
    const s = new FrameStats();
    s.record(1 / 60, 2);
    expect(s.fps).toBeCloseTo(60);
    for (let i = 0; i < 200; i++) s.record(1 / 30, 4);
    expect(s.fps).toBeCloseTo(30, 0);
    expect(s.frameMs).toBeCloseTo(4, 1);
    s.record(0, 1);
    s.record(Number.NaN, 1);
    expect(s.fps).toBeCloseTo(30, 0);
  });
});

describe('Highlighter', () => {
  it('adds, keeps, removes and caps highlight boxes', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world([box('a'), box('b', [3, 0.5, 0])]));
    const h = new Highlighter();
    h.set(['a', 'b', 'missing'], (id) => sync.object(id));
    expect(h.ids.sort()).toEqual(['a', 'b']);
    h.update();
    h.set(['b'], (id) => sync.object(id));
    expect(h.ids).toEqual(['b']);
    sync.clear();
    h.update();
    expect(h.ids).toEqual([]);
    const many = Array.from({ length: MAX_HIGHLIGHTS + 10 }, (_, i) => `x-${i}`);
    const g = new Group();
    h.set(many, () => g);
    expect(h.ids.length).toBe(MAX_HIGHLIGHTS);
    h.dispose();
    expect(h.group.children.length).toBe(0);
  });
});

describe('DebugOverlay', () => {
  it('draws collider wireframes, bounds and diagnostic markers, and clears them', async () => {
    const { sync } = makeSync();
    await sync.setWorld(
      world([
        box('a'),
        { id: 'ball', transform: { position: [3, 1, 0] }, shape: { kind: 'primitive', primitive: 'sphere', size: [1, 1, 1] } },
        { id: 'pill', shape: { kind: 'primitive', primitive: 'capsule', size: [1, 2, 1] } },
        { id: 'cone', shape: { kind: 'primitive', primitive: 'cone', size: [1, 2, 1] } },
        { id: 'ghosty', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, physics: { collider: 'none' } },
      ]),
    );
    const d = new DebugOverlay();
    expect(d.active).toBe(false);
    d.show({ colliders: true, bounds: true, diagnostics: [{ severity: 'error', code: 'overlap', entities: ['a', 'ball', 'nope'], message: 'x' }] }, sync);
    expect(d.active).toBe(true);
    const collidersOf = (id: string) => sync.object(id)!.children.filter((c) => c.name === 'debug:colliders');
    expect(collidersOf('a')).toHaveLength(1);
    expect(collidersOf('ghosty')).toHaveLength(0);
    expect(collidersOf('a')[0]!.children[0]).toBeInstanceOf(LineSegments);
    const helpers = d.group.children.filter((c) => c instanceof Box3Helper);
    expect(helpers.length).toBe(5 + 2);
    expect(d.group.children.filter((c) => c instanceof Mesh)).toHaveLength(2);
    // Debug objects are not pickable.
    expect(collidersOf('a')[0]!.children[0]!.raycast(undefined as never, [])).toBeUndefined();
    d.show({}, sync);
    expect(d.active).toBe(false);
    expect(collidersOf('a')).toHaveLength(0);
    expect(d.group.children).toHaveLength(0);
    d.dispose();
  });

  it('rebuilds incrementally: unchanged entities keep their collider holder, removed ones lose it', async () => {
    const { sync } = makeSync();
    const w1 = world([box('a'), box('b', [3, 0.5, 0])]);
    await sync.setWorld(w1);
    const d = new DebugOverlay();
    d.show({ colliders: true }, sync);
    const holderOf = (id: string) => sync.object(id)?.children.find((c) => c.name === 'debug:colliders');
    const a1 = holderOf('a');
    const b1 = holderOf('b');
    expect(a1).toBeDefined();
    await sync.setWorld(patch(w1, [{ op: 'update', id: 'b', set: { shape: { kind: 'primitive', primitive: 'sphere', size: [1, 1, 1] } } }]));
    d.rebuild(sync);
    expect(holderOf('a')).toBe(a1);
    expect(holderOf('b')).not.toBe(b1);
    await sync.setWorld(world([box('a')]));
    d.rebuild(sync);
    expect(holderOf('a')).toBe(a1);
    expect(sync.object('b')).toBeUndefined();
    d.dispose();
    expect(d.cachedWireCount).toBe(0);
  });
});

describe('Avatar', () => {
  it('places at the feet with yaw and hides in first person', () => {
    const a = new Avatar();
    expect(a.group.visible).toBe(false);
    a.set(1, 2, 3, 90);
    expect(a.isPlaced).toBe(true);
    expect(a.group.visible).toBe(true);
    expect(a.yaw).toBeCloseTo(Math.PI / 2);
    a.setHidden(true);
    expect(a.group.visible).toBe(false);
    a.set(Number.NaN, 0, 0, 0);
    expect(a.group.position.x).toBe(1);
    a.dispose();
  });
});

describe('CameraRig chase occlusion', () => {
  it('moves in front of an obstacle between the target and the camera, and back out when clear', () => {
    const cam = new PerspectiveCamera();
    const rig = new CameraRig(cam, fakeControls());
    const target = new Vector3(0, 0, 0);
    let blocked = true;
    rig.occlusion = (from, to) => {
      expect(Number.isFinite(from.x + to.x)).toBe(true);
      return blocked ? 2 : Number.POSITIVE_INFINITY;
    };
    rig.setMode('follow', (out) => {
      out.copy(target);
      return 0;
    });
    for (let i = 0; i < 200; i++) rig.update(1 / 60);
    const near = cam.position.distanceTo(new Vector3(0, 1.3, 0));
    expect(near).toBeLessThan(2);
    expect(near).toBeGreaterThanOrEqual(MIN_FOLLOW_DISTANCE - 1e-6);
    blocked = false;
    for (let i = 0; i < 200; i++) rig.update(1 / 60);
    expect(cam.position.distanceTo(new Vector3(0, 1.3, 0))).toBeGreaterThan(5);
    rig.dispose();
  });
});

describe('TransformGizmo', () => {
  function fakeTc(): TransformControlsLike & { emit(type: string, value?: unknown): void; helperObj: Group; attached: number } {
    const listeners = new Map<string, Array<(e: { value?: unknown }) => void>>();
    const helperObj = new Group();
    return {
      object: undefined,
      dragging: false,
      axis: null,
      enabled: true,
      helperObj,
      attached: 0,
      setMode() {},
      setSize() {},
      attach(o) {
        this.object = o;
        this.attached++;
      },
      detach() {
        this.object = undefined;
      },
      getHelper: () => helperObj,
      addEventListener(type, fn) {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
      emit(type, value) {
        for (const fn of listeners.get(type) ?? []) fn({ value });
      },
      dispose() {},
    };
  }

  it('reads document transforms from an object (degrees, rounded, positive scale)', () => {
    const o = new Group();
    o.position.set(1.23456, 0, -2);
    o.rotation.set(Math.PI / 2, 0, -Math.PI / 4);
    o.scale.set(2, 0, 1);
    expect(readTransform(o, 'rotate')).toEqual({ position: [1.235, 0, -2], rotation: [90, 0, -45], scale: [2, 0.001, 1], mode: 'rotate' });
  });

  it('attaches lazily, disables orbit while dragging, commits once per drag and hides on detach', async () => {
    const tc = fakeTc();
    const scene = new Group();
    const controls = fakeControls();
    let renders = 0;
    const gizmo = new TransformGizmo(async () => tc, (h) => scene.add(h), controls, () => void renders++);
    expect(gizmo.busy).toBe(false);
    const target = new Group();
    const commits: unknown[] = [];
    await gizmo.attach(target, 'translate', (c) => commits.push(c));
    expect(scene.children).toContain(tc.helperObj);
    expect(gizmo.object).toBe(target);
    tc.axis = 'X';
    expect(gizmo.busy).toBe(true);
    tc.emit('dragging-changed', true);
    expect(controls.enabled).toBe(false);
    target.position.x = 3;
    tc.emit('dragging-changed', false);
    tc.emit('mouseUp');
    expect(controls.enabled).toBe(true);
    expect(commits).toEqual([{ position: [3, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], mode: 'translate' }]);
    await gizmo.attach(target, 'scale', (c) => commits.push(c));
    expect(tc.attached).toBe(1);
    gizmo.detach();
    expect(tc.helperObj.visible).toBe(false);
    tc.emit('mouseUp');
    expect(commits).toHaveLength(1);
    expect(renders).toBeGreaterThan(0);
    gizmo.dispose();
    expect(scene.children).not.toContain(tc.helperObj);
  });
});
