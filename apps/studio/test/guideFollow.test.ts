/**
 * The guided tour's following view (player/explore.ts `follow`, `safeFollowEye`) against a scene of boxes: the eye is kept
 * in sight of the guide (never inside or behind a wall, at eye height over the floor), a fade always ends, and an aim kept
 * across a wall (which faded the view again every quarter second: a black screen) ends in one fade and a glide.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vec3 } from '@aether/core';
import { ExploreController, FADE_MAX_MS, FOLLOW_CLEAR_M, FOLLOW_MIN_M, FOLLOW_REFADE_S, FOLLOW_WALL_M, safeFollowEye, type ExploreState, type FollowAim, type FollowProbe } from '../src/player/explore';

/** An axis-aligned box whose faces are met from outside only (as front faces are: a ray from inside leaves it unseen). */
interface Box {
  id: string;
  min: Vec3;
  max: Vec3;
}

function raycast(boxes: readonly Box[], o: Readonly<Vec3>, d0: Readonly<Vec3>, max: number, skip?: ReadonlySet<string>): { id: string; point: Vec3; normal: Vec3 } | null {
  const len = Math.hypot(d0[0], d0[1], d0[2]);
  if (!(len > 0)) return null;
  const d = [d0[0] / len, d0[1] / len, d0[2] / len];
  let best: { id: string; point: Vec3; normal: Vec3 } | null = null;
  let bestT = max;
  for (const b of boxes) {
    if (skip?.has(b.id)) continue;
    const inside = o[0] > b.min[0] && o[0] < b.max[0] && o[1] > b.min[1] && o[1] < b.max[1] && o[2] > b.min[2] && o[2] < b.max[2];
    if (inside) continue;
    let tmin = -Infinity;
    let tmax = Infinity;
    let axis = 0;
    for (let i = 0; i < 3; i++) {
      const di = d[i] as number;
      if (Math.abs(di) < 1e-12) {
        if ((o[i] as number) < b.min[i]! || (o[i] as number) > b.max[i]!) tmin = Infinity;
        continue;
      }
      const t1 = (b.min[i]! - (o[i] as number)) / di;
      const t2 = (b.max[i]! - (o[i] as number)) / di;
      const lo = Math.min(t1, t2);
      if (lo > tmin) {
        tmin = lo;
        axis = i;
      }
      tmax = Math.min(tmax, Math.max(t1, t2));
    }
    if (tmin > tmax || !(tmin >= 0) || tmin > bestT) continue;
    bestT = tmin;
    const normal: Vec3 = [0, 0, 0];
    normal[axis] = -Math.sign(d[axis] as number);
    best = { id: b.id, point: [o[0] + d[0]! * tmin, o[1] + d[1]! * tmin, o[2] + d[2]! * tmin], normal };
  }
  return best;
}

/** A hall: a floor at y = 0 everywhere (x in -20..20) and a wall 0.4 m thick at x = 4.8..5.2 the full depth. */
const WALL: Box = { id: 'wall', min: [4.8, 0, -20], max: [5.2, 3, 20] };
const FLOOR: Box = { id: 'floor', min: [-20, -0.2, -20], max: [20, 0, 20] };

function probeOf(boxes: readonly Box[], skip?: ReadonlySet<string>): FollowProbe {
  return {
    free(from, dir, max) {
      const h = raycast(boxes, from, dir, max, skip);
      return h ? Math.hypot(h.point[0] - from[0], h.point[1] - from[1], h.point[2] - from[2]) : max;
    },
    floor(x, z, fromY) {
      const h = raycast(boxes, [x, fromY, z], [0, -1, 0], 4.2, skip);
      return h && h.normal[1] >= 0.55 ? h.point[1] : null;
    },
  };
}

describe('safeFollowEye', () => {
  const probe = probeOf([WALL, FLOOR]);
  const head: Vec3 = [2, 1.5, 0];
  it('keeps an eye with a clear line to the guide where it is, at eye height over the floor', () => {
    const out: Vec3 = [0, 0, 0];
    expect(safeFollowEye([0.5, 1.7, 0], head, probe, out)).toBe(Number.POSITIVE_INFINITY);
    expect(out[0]).toBeCloseTo(0.5);
    expect(out[1]).toBeCloseTo(1.6);
  });
  it('pulls an eye behind a wall back to the guide side, short of the wall', () => {
    const out: Vec3 = [0, 0, 0];
    const reach = safeFollowEye([7, 1.6, 0], head, probe, out);
    expect(reach).toBeGreaterThan(FOLLOW_MIN_M);
    expect(out[0]).toBeLessThan(WALL.min[0] - FOLLOW_WALL_M + 0.01);
    expect(out[0]).toBeGreaterThan(head[0]);
    expect(out[1]).toBeCloseTo(1.6);
  });
  it('pulls an eye inside the wall out of it (its own rays would see nothing there)', () => {
    const inside: Vec3 = [5, 1.6, 0];
    // From inside the wall nothing is met: a check from the eye calls it free.
    expect(probe.free(inside, [1, 0, 0], 0.35)).toBeCloseTo(0.35);
    expect(probe.free(inside, [-1, 0, 0], 0.35)).toBeCloseTo(0.35);
    const out: Vec3 = [0, 0, 0];
    expect(safeFollowEye(inside, head, probe, out)).toBeGreaterThan(0);
    expect(out[0]).toBeLessThan(WALL.min[0]);
  });
  it('has no spot when the guide stands against the wall, over no floor, or over a table; never passes a NaN', () => {
    const out: Vec3 = [0, 0, 0];
    expect(safeFollowEye([7, 1.6, 0], [4.5, 1.5, 0], probe, out)).toBe(-1);
    expect(safeFollowEye([30, 1.6, 0], [29, 1.5, 0], probe, out)).toBe(-1);
    const table: Box = { id: 'table', min: [-1, 0, -1], max: [1, 0.75, 1] };
    expect(safeFollowEye([0, 1.6, 0], [3, 1.5, 0], probeOf([WALL, FLOOR, table]), out)).toBe(-1);
    expect(safeFollowEye([Number.NaN, 1.6, 0], head, probe, out)).toBe(-1);
    expect(safeFollowEye([0, 1.6, 0], [2, Number.NaN, 0], probe, out)).toBe(-1);
  });
});

/** An explore controller on a fake simulation whose scene is `boxes` (no DOM: listeners are stubs). */
function controller(boxes: readonly Box[]) {
  const g = globalThis as unknown as { window?: unknown };
  if (!g.window) g.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true };
  const poses: Array<{ eye: Vec3; yaw: number; pitch: number }> = [];
  const renderer = {
    domElement: { addEventListener() {}, removeEventListener() {} },
    camera: { fov: 50, updateProjectionMatrix() {}, position: { x: 0, y: 0, z: 0 } },
    cameraFloorY: 0,
    raycastWorld: (o: Vec3, d: Vec3, max: number, skip?: ReadonlySet<string>) => raycast(boxes, o, d, max, skip),
    setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number) {
      poses.push({ eye: [x, y, z], yaw, pitch });
    },
    stopTour() {},
    setLeftDragNavigation() {},
    setArchView() {},
    setCameraMode() {},
  };
  const holds = new Set<string>();
  const sim = { renderer, touch() {}, setClickHandler() {}, entityBounds: () => null, syncedWorld: null, setQualityHold: (r: string, on: boolean) => (on ? holds.add(r) : holds.delete(r)) };
  let state: ExploreState | null = null;
  const ctrl = new ExploreController(sim as never, { kind: 'arch', entry: 'hero-tour', explore: 'walk', dollhouse: false, photo: false, stopsLabel: 'Viewpoints', guided: true } as never, [], (s) => (state = s));
  const inner = ctrl as unknown as { placeWalk(p: { eye: Vec3; yaw: number; pitch: number }): void; step(dt: number): void };
  inner.placeWalk({ eye: [2, 1.6, 0], yaw: 0, pitch: 0 });
  /** Run `seconds` of frames at 60 Hz (timers too); returns the share of frames under the fade, and the longest fade (s). */
  const run = (seconds: number): { faded: number; longest: number; starts: number } => {
    let faded = 0;
    let run = 0;
    let longest = 0;
    let starts = 0;
    let was = false;
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) {
      vi.advanceTimersByTime(1000 / 60);
      inner.step(1 / 60);
      const on = !!state?.fading;
      if (on) {
        faded++;
        run++;
        longest = Math.max(longest, run / 60);
        if (!was) starts++;
      } else run = 0;
      was = on;
    }
    return { faded: faded / n, longest, starts };
  };
  return { ctrl, run, poses, state: () => state, holds };
}

describe('the following view against walls', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not fade again and again when its aim keeps landing across a wall (the black view of the tour)', () => {
    const { ctrl, run, poses } = controller([WALL, FLOOR]);
    let arrived = 0;
    // An aim that keeps landing on the other side of the wall from wherever the view is: each fade took the view there
    // and the next check, a quarter second on, found the wall again.
    const aim = (out: FollowAim): boolean => {
      const p = poses[poses.length - 1] as { eye: Vec3 };
      const across = p.eye[0] < 5 ? 7 : 3;
      out.eye[0] = across;
      out.eye[1] = 1.6;
      out.eye[2] = 0;
      out.look[0] = across;
      out.look[1] = 1.5;
      out.look[2] = -3;
      out.final = false;
      return true;
    };
    expect(ctrl.follow(aim, () => arrived++, new Set(['guide']), { eye: [3, 1.6, 2], look: [3, 1.5, -3] })).toBe(true);
    const r = run(10);
    // One fade, then the follow gives up and goes to its end pose (one more fade here: it is across the wall), and the
    // stop begins. Before, the view faded again every check: black most of the time.
    expect(r.starts).toBeLessThanOrEqual(2);
    expect(r.faded).toBeLessThan(0.12);
    expect(ctrl.following).toBe(false);
    expect(arrived).toBe(1);
    const last = poses[poses.length - 1] as { eye: Vec3 };
    expect(last.eye[0]).toBeCloseTo(3, 1);
    expect(last.eye[2]).toBeCloseTo(2, 1);
    expect(FOLLOW_REFADE_S).toBeGreaterThan(1);
  });

  it('keeps the eye on the guide side of a wall when the way behind her is across it, never fading', () => {
    const { ctrl, run, poses } = controller([WALL, FLOOR]);
    const head: Vec3 = [3.5, 1.5, 0];
    // Her trail point lies across the wall (her way turned round its end): the eye is held on her side of it.
    const aim = (out: FollowAim): boolean => {
      out.eye[0] = 6.5;
      out.eye[1] = 1.6;
      out.eye[2] = 0.5;
      out.look[0] = head[0];
      out.look[1] = head[1];
      out.look[2] = head[2] - 2;
      out.final = false;
      out.subject = head;
      return true;
    };
    ctrl.follow(aim, undefined, new Set(['guide']));
    const r = run(4);
    expect(r.starts).toBe(0);
    for (const p of poses) {
      expect(p.eye[0]).toBeLessThan(WALL.min[0]);
      expect(Number.isFinite(p.eye[0] + p.eye[1] + p.eye[2])).toBe(true);
    }
    const last = poses[poses.length - 1] as { eye: Vec3 };
    expect(last.eye[0]).toBeGreaterThan(head[0]);
    expect(last.eye[1]).toBeCloseTo(1.6, 1);
  });

  it('never puts the eye inside the guide: a glide through her goes round her, and a waiting view steps aside as she passes', () => {
    // The tour's first stop as recorded in the Rug Exhibition Hall (Chromium, before): the view glided from the door to the
    // reception viewpoint straight through her (0.64 m from her at head height), and at the next stop she walked through
    // the waiting view (0.35 m): the near plane inside her head, her hair and jacket filling the view, black.
    const { ctrl, run, poses } = controller([FLOOR]);
    const her: Vec3 = [3.5, 0, 0.2];
    const aim = (out: FollowAim): boolean => {
      out.eye[0] = 6;
      out.eye[1] = 1.6;
      out.eye[2] = 0;
      out.look[0] = 8;
      out.look[1] = 1.4;
      out.look[2] = 0;
      out.final = false;
      out.avoid = her;
      return true;
    };
    ctrl.follow(aim, undefined, new Set(['guide']));
    run(4);
    for (const p of poses) expect(Math.hypot(p.eye[0] - her[0], p.eye[2] - her[2])).toBeGreaterThan(FOLLOW_CLEAR_M - 0.05);
    expect((poses[poses.length - 1] as { eye: Vec3 }).eye[0]).toBeCloseTo(6, 1);
    // She walks through a view that waits (its aim is where it stands).
    const w = controller([FLOOR]);
    const walker: Vec3 = [0, 0, 0];
    let t = 0;
    let nearest = Infinity;
    let frames = 0;
    const stay = (out: FollowAim): boolean => {
      const p = w.poses[w.poses.length - 1] as { eye: Vec3 };
      // Where the view stood last frame, from where she was then.
      if (frames++ > 0) nearest = Math.min(nearest, Math.hypot(p.eye[0] - walker[0], p.eye[2] - walker[2]));
      t += 1 / 60;
      walker[0] = -2 + t * 1.3;
      walker[2] = 0.1;
      out.eye[0] = p.eye[0];
      out.eye[1] = p.eye[1];
      out.eye[2] = p.eye[2];
      out.look[0] = walker[0];
      out.look[1] = 1.4;
      out.look[2] = walker[2] + 2;
      out.final = false;
      out.avoid = walker;
      return true;
    };
    w.ctrl.follow(stay, undefined, new Set(['guide']));
    w.run(4);
    expect(frames).toBeGreaterThan(200);
    expect(nearest).toBeGreaterThan(FOLLOW_CLEAR_M - 0.05);
  });

  it('holds the quality ladder still while the view moves on its own, and lets it go at rest', () => {
    const { ctrl, run, holds } = controller([FLOOR]);
    let left = 90;
    const aim = (out: FollowAim): boolean => {
      out.eye[0] = 3;
      out.eye[1] = 1.6;
      out.eye[2] = 0;
      out.look[0] = 3;
      out.look[1] = 1.5;
      out.look[2] = -3;
      out.final = true;
      out.subject = null;
      return --left > 0;
    };
    ctrl.follow(aim);
    run(0.5);
    expect(holds.has('explore-move')).toBe(true);
    run(2);
    expect(ctrl.following).toBe(false);
    expect(holds.size).toBe(0);
  });

  it('holds the view on a NaN aim instead of passing it to the camera', () => {
    const { ctrl, run, poses } = controller([WALL, FLOOR]);
    let k = 0;
    const aim = (out: FollowAim): boolean => {
      k++;
      out.eye[0] = k % 3 === 0 ? Number.NaN : 2.5;
      out.eye[1] = 1.6;
      out.eye[2] = 0;
      out.look[0] = 2.5;
      out.look[1] = 1.5;
      out.look[2] = -3;
      out.final = false;
      return true;
    };
    ctrl.follow(aim);
    run(2);
    expect(poses.length).toBeGreaterThan(10);
    for (const p of poses) expect(Number.isFinite(p.eye[0] + p.eye[1] + p.eye[2] + p.yaw + p.pitch)).toBe(true);
  });

  it('never leaves a fade on: the cover lifts within its bound', () => {
    const { ctrl, run, state } = controller([WALL, FLOOR]);
    // A glide across the wall fades; the fade lifts on its own.
    ctrl.lookAt([7, 1.5, -3], [7, 1.6, 0]);
    expect(state()?.fading).toBe(true);
    const r = run(3);
    expect(state()?.fading).toBe(false);
    expect(r.longest * 1000).toBeLessThanOrEqual(FADE_MAX_MS);
  });
});
