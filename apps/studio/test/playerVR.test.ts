/**
 * Immersive VR in the player, its pure parts (`player/xr/locomotion.ts`, `player/xr/support.ts`): the play space's
 * offset into the world, snap turn, the teleport arc and its landing checks against the walk view's floor probes, the
 * comfort fade, the pose handed back on exit, the support check and the backend a headset boots on.
 */
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@aether/core';
import type { WalkProbe } from '../src/player/walk';
import { WALK_EYE } from '../src/player/walk';
import {
  ARC_MAX_POINTS,
  FADE_HOLD_MS,
  FADE_IN_MS,
  FADE_OUT_MS,
  SnapTurn,
  TeleportFade,
  directionToWorld,
  localToWorld,
  rigAtWalk,
  rigOffset,
  stickAiming,
  teleportRig,
  teleportTarget,
  traceArc,
  turnRig,
  walkPoseOnExit,
  xrFramebufferScale,
  type ArcCast,
  type ArcHit,
  type RigidTransform,
} from '../src/player/xr/locomotion';
import { isHeadsetBrowser, vrSupported, xrBootBackend, xrReloadUrl, xrRequested, xrSystem } from '../src/player/xr/support';

const close = (a: readonly number[], b: readonly number[], eps = 1e-9): void => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs((a[i] as number) - (b[i] as number))).toBeLessThan(eps);
};

/** Rotate `v` by the unit quaternion `q`. */
function rotate(q: RigidTransform['orientation'], v: Vec3): Vec3 {
  const { x, y, z, w } = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

/** What WebXR reports for a base-space point in the offset space: inverse(offset) · p. */
function inOffsetSpace(t: RigidTransform, p: Vec3): Vec3 {
  const d: Vec3 = [p[0] - t.position.x, p[1] - t.position.y, p[2] - t.position.z];
  const inv = { x: -t.orientation.x, y: -t.orientation.y, z: -t.orientation.z, w: t.orientation.w };
  return rotate(inv, d);
}

const transform = (): RigidTransform => ({ position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });

/** A flat floor at y = 0 everywhere, optional boxes standing on it (walls, a table), as the walk tests do. */
function roomProbe(boxes: Array<{ min: Vec3; max: Vec3 }> = []): WalkProbe {
  const inBox = (b: { min: Vec3; max: Vec3 }, p: Vec3): boolean => p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1] && p[2] >= b.min[2] && p[2] <= b.max[2];
  return {
    free(from, dir, max) {
      const steps = 200;
      for (let i = 1; i <= steps; i++) {
        const t = (max * i) / steps;
        const p: Vec3 = [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t];
        if (boxes.some((b) => inBox(b, p))) return (max * (i - 1)) / steps;
      }
      return max;
    },
    floor(x, z, fromY) {
      let best: number | null = fromY >= 0 ? 0 : null;
      for (const b of boxes) if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2] && b.max[1] <= fromY && (best === null || b.max[1] > best)) best = b.max[1];
      return best;
    },
  };
}

/** The arc's straight pieces against the same flat floor and boxes. */
function roomCast(boxes: Array<{ min: Vec3; max: Vec3 }> = []): ArcCast {
  return (ox, oy, oz, dx, dy, dz, len, out) => {
    const steps = 64;
    for (let i = 1; i <= steps; i++) {
      const t = (len * i) / steps;
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      for (const b of boxes) {
        if (x >= b.min[0] && x <= b.max[0] && y >= b.min[1] && y <= b.max[1] && z >= b.min[2] && z <= b.max[2]) {
          const top = Math.abs(y - b.max[1]) < 0.15;
          Object.assign(out, { x, y: top ? b.max[1] : y, z, nx: top ? 0 : -Math.sign(dx), ny: top ? 1 : 0, nz: 0 });
          return true;
        }
      }
      if (y <= 0) {
        Object.assign(out, { x, y: 0, z, nx: 0, ny: 1, nz: 0 });
        return true;
      }
    }
    return false;
  };
}

describe('the play space in the world', () => {
  it('the offset reference space shows the play space where the rig puts it', () => {
    for (const rig of [{ x: 0, y: 0, z: 0, yaw: 0 }, { x: 3, y: 1.2, z: -7, yaw: 0.8 }, { x: -12.5, y: -0.4, z: 4, yaw: -2.6 }]) {
      const t = rigOffset(rig, transform());
      for (const p of [[0, 0, 0], [0.3, 1.7, -0.2], [-1, 0.5, 2]] as Vec3[]) close(inOffsetSpace(t, p), localToWorld(rig, p[0], p[1], p[2], [0, 0, 0]), 1e-9);
    }
  });

  it('faces the walk: the play space forward (-Z) is the walk yaw forward, and the floor is the eye height under the eye', () => {
    const rig = rigAtWalk([2, 1.6 + 3, 5], Math.PI / 2);
    expect(rig.y).toBeCloseTo(3, 9);
    // yaw +90° looks along -X (walk.ts forwardOf).
    close(directionToWorld(rig, 0, 0, -1, [0, 0, 0]), [-1, 0, 0], 1e-9);
  });

  it('teleport stands the head over the target (yaw kept)', () => {
    const rig = { x: 1, y: 0, z: 1, yaw: 1.1 };
    teleportRig(rig, 0.4, -0.3, [10, 2, -4]);
    const head = localToWorld(rig, 0.4, 1.7, -0.3, [0, 0, 0]);
    close([head[0], rig.y, head[2]], [10, 2, -4], 1e-9);
    expect(rig.yaw).toBe(1.1);
  });

  it('snap turn turns about the head, which stays put', () => {
    const rig = { x: 2, y: 0, z: -1, yaw: 0.3 };
    const before = localToWorld(rig, 0.5, 1.6, 0.2, [0, 0, 0]);
    turnRig(rig, 0.5, 0.2, Math.PI / 6);
    const after = localToWorld(rig, 0.5, 1.6, 0.2, [0, 0, 0]);
    close(after, before, 1e-9);
    expect(rig.yaw).toBeCloseTo(0.3 + Math.PI / 6, 12);
  });

  it('hands the walk back where the head stands, facing where it looks', () => {
    const rig = { x: 4, y: 1, z: 0, yaw: Math.PI / 2 };
    const { feet, yaw } = walkPoseOnExit(rig, 0, 0, 0, -1);
    close(feet, [4, 1, 0], 1e-9);
    expect(yaw).toBeCloseTo(Math.PI / 2, 9);
    // Looking straight down keeps the rig's heading.
    expect(walkPoseOnExit(rig, 0, 0, 0, 0).yaw).toBeCloseTo(Math.PI / 2, 9);
    // Enter at a walk eye, exit without moving: the same eye.
    const r2 = rigAtWalk([1, 2.6, 3], 0.7);
    const back = walkPoseOnExit(r2, 0, 0, -Math.sin(0), -Math.cos(0));
    close([back.feet[0], back.feet[1] + WALK_EYE, back.feet[2]], [1, 2.6, 3], 1e-9);
    expect(back.yaw).toBeCloseTo(0.7, 9);
  });
});

describe('snap turn and the sticks', () => {
  it('turns 30° once per push, right turns right (negative yaw), and re-arms under the dead zone', () => {
    const s = new SnapTurn();
    expect(s.update(0.2)).toBe(0);
    expect(s.update(0.9)).toBeCloseTo(-Math.PI / 6, 12);
    expect(s.update(1)).toBe(0);
    expect(s.update(0.5)).toBe(0);
    expect(s.update(0.1)).toBe(0);
    expect(s.update(-0.8)).toBeCloseTo(Math.PI / 6, 12);
    expect(s.update(Number.NaN)).toBe(0);
  });

  it('aims a teleport while the stick is pushed forward (with hysteresis)', () => {
    expect(stickAiming(false, -0.5)).toBe(false);
    expect(stickAiming(false, -0.7)).toBe(true);
    expect(stickAiming(true, -0.4)).toBe(true);
    expect(stickAiming(true, -0.2)).toBe(false);
    expect(stickAiming(false, 0.9)).toBe(false);
  });
});

describe('the teleport arc and where it lands', () => {
  const points = new Float32Array(ARC_MAX_POINTS * 3);
  const hit: ArcHit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
  const flag = { hit: false };

  it('a throw forward and a little up lands on the floor some metres ahead', () => {
    const n = traceArc([0, 1.2, 0], [0, Math.sin(0.35), -Math.cos(0.35)], roomCast(), points, hit, flag);
    expect(flag.hit).toBe(true);
    expect(n).toBeGreaterThan(3);
    expect(hit.y).toBeCloseTo(0, 6);
    expect(hit.z).toBeLessThan(-3);
    expect(hit.z).toBeGreaterThan(-12);
    // The arc starts at the controller and ends at the hit.
    close([points[0] as number, points[1] as number, points[2] as number], [0, 1.2, 0], 1e-6);
    close([points[(n - 1) * 3] as number, points[(n - 1) * 3 + 1] as number, points[(n - 1) * 3 + 2] as number], [hit.x, hit.y, hit.z], 1e-5);
  });

  it('a throw into a wall hits the wall, which is nowhere to stand', () => {
    const wall = { min: [-5, 0, -2.2] as Vec3, max: [5, 3, -2] as Vec3 };
    traceArc([0, 1.2, 0], [0, 0.2, -0.98], roomCast([wall]), points, hit, flag);
    expect(flag.hit).toBe(true);
    expect(hit.ny).toBe(0);
    expect(teleportTarget(hit, roomProbe([wall]), 0)).toBeNull();
  });

  it('stops without a hit when nothing is there (no floor, thrown up into the void)', () => {
    traceArc([0, 1.2, 0], [0, 1, 0], () => false, points, hit, flag);
    expect(flag.hit).toBe(false);
  });

  it('accepts open floor and returns the feet on it', () => {
    const t = teleportTarget({ x: 2, y: 0, z: -3, nx: 0, ny: 1, nz: 0 }, roomProbe(), 0);
    expect(t).toEqual([2, 0, -3]);
  });

  it('rejects the top of furniture, a spot without headroom and one pressed against a wall (standing on the floor)', () => {
    const table = { min: [1, 0, -1] as Vec3, max: [2, 0.75, 0] as Vec3 };
    expect(teleportTarget({ x: 1.5, y: 0.75, z: -0.5, nx: 0, ny: 1, nz: 0 }, roomProbe([table]), 0)).toBeNull();
    const shelf = { min: [-1, 1.2, -1] as Vec3, max: [1, 1.4, 1] as Vec3 };
    expect(teleportTarget({ x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 }, roomProbe([shelf]), 0)).toBeNull();
    const wall = { min: [0.05, 0, -5] as Vec3, max: [0.3, 3, 5] as Vec3 };
    expect(teleportTarget({ x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 }, roomProbe([wall]), 0)).toBeNull();
    // A steep slope (normal far from up) is not a floor.
    expect(teleportTarget({ x: 0, y: 0, z: 0, nx: 0.8, ny: 0.6, nz: 0 }, roomProbe(), 0)).toBeNull();
  });

  it('accepts a landing high above another floor (a mezzanine, the top of a stair)', () => {
    const mezzanine = { min: [-3, 2.8, -3] as Vec3, max: [3, 3, 3] as Vec3 };
    expect(teleportTarget({ x: 0, y: 3, z: 0, nx: 0, ny: 1, nz: 0 }, roomProbe([mezzanine]), 0)).toEqual([0, 3, 0]);
  });

  it('a building floor raised over the ground is a floor, not furniture (standing on it), and a table from it is furniture', () => {
    const slab = { min: [-10, 0, -10] as Vec3, max: [10, 0.45, 10] as Vec3 };
    const table = { min: [1, 0.45, -1] as Vec3, max: [2, 1.2, 0] as Vec3 };
    expect(teleportTarget({ x: 3, y: 0.45, z: 3, nx: 0, ny: 1, nz: 0 }, roomProbe([slab, table]), 0.45)).toEqual([3, 0.45, 3]);
    expect(teleportTarget({ x: 1.5, y: 1.2, z: -0.5, nx: 0, ny: 1, nz: 0 }, roomProbe([slab, table]), 0.45)).toBeNull();
    // From the ground outside, a step up onto the slab.
    expect(teleportTarget({ x: 3, y: 0.45, z: 3, nx: 0, ny: 1, nz: 0 }, roomProbe([slab]), 0)).toEqual([3, 0.45, 3]);
  });
});

describe('the teleport fade', () => {
  it('goes to black, moves exactly once while black, and comes back', () => {
    const f = new TeleportFade();
    const out = { alpha: 0, move: false };
    expect(f.step(16, out).alpha).toBe(0);
    f.start();
    expect(f.active).toBe(true);
    let moves = 0;
    let maxAlpha = 0;
    let alphaAtMove = -1;
    for (let t = 0; t < FADE_OUT_MS + FADE_HOLD_MS + FADE_IN_MS + 100; t += 11) {
      f.step(11, out);
      maxAlpha = Math.max(maxAlpha, out.alpha);
      if (out.move) {
        moves++;
        alphaAtMove = out.alpha;
      }
    }
    expect(moves).toBe(1);
    expect(alphaAtMove).toBe(1);
    expect(maxAlpha).toBe(1);
    expect(out.alpha).toBe(0);
    expect(f.active).toBe(false);
  });
});

describe('framebuffer scale', () => {
  it('scales the eye buffers with the render tier, lowest on a software GPU', () => {
    expect(xrFramebufferScale('high', 'discrete')).toBe(1);
    expect(xrFramebufferScale('medium', 'integrated')).toBeLessThan(1);
    expect(xrFramebufferScale('low', 'integrated')).toBeLessThan(xrFramebufferScale('medium', 'integrated'));
    expect(xrFramebufferScale('high', 'software')).toBe(0.5);
  });
});

describe('VR support and the backend', () => {
  it('is supported only when navigator.xr says immersive-vr is', async () => {
    expect(await vrSupported(undefined)).toBe(false);
    expect(await vrSupported({})).toBe(false);
    const xr = (ok: boolean | Error) => ({ xr: { isSessionSupported: (m: string) => (ok instanceof Error ? Promise.reject(ok) : Promise.resolve(ok && m === 'immersive-vr')), requestSession: () => Promise.resolve({}) } });
    expect(await vrSupported(xr(true))).toBe(true);
    expect(await vrSupported(xr(false))).toBe(false);
    expect(await vrSupported(xr(new Error('SecurityError')))).toBe(false);
    expect(await vrSupported({ xr: { isSessionSupported: () => new Promise(() => undefined), requestSession: () => Promise.resolve({}) } }, 20)).toBe(false);
    expect(xrSystem({ xr: { isSessionSupported: 1 } })).toBeNull();
  });

  it('boots on WebGL2 on a headset browser or with ?xr=1, else on the automatic backend', () => {
    const quest = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/37.1.0.4.62 Chrome/132.0.6834.163 VR Safari/537.36';
    const desktop = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
    expect(isHeadsetBrowser(quest)).toBe(true);
    expect(isHeadsetBrowser(desktop)).toBe(false);
    expect(xrBootBackend('', quest)).toBe('webgl2');
    expect(xrBootBackend('', desktop)).toBe('auto');
    expect(xrBootBackend('?xr=1', desktop)).toBe('webgl2');
    expect(xrRequested('?a=b&xr=1')).toBe(true);
    expect(xrRequested('?xr=0')).toBe(false);
  });

  it('reloads with xr=1, keeping the world in the fragment', () => {
    expect(xrReloadUrl('https://example.test/play.html#t=rug-exhibition-hall')).toBe('https://example.test/play.html?xr=1#t=rug-exhibition-hall');
    expect(xrReloadUrl('https://example.test/play?x=2#c=a.b')).toBe('https://example.test/play?x=2&xr=1#c=a.b');
  });
});

describe('the XR default framebuffer (three WebGL2 draw-buffer cache)', () => {
  it('answers for the null (default) framebuffer without writing it, and passes other framebuffers through', async () => {
    const { allowDefaultXRFramebuffer } = await import('../../../packages/render/src/gpu/xr-framebuffer');
    const inner = new WeakMap<object, number[]>();
    const backend = { state: { currentDrawbuffers: inner as unknown as { get(k: object): number[] | undefined; set(k: object, v: number[]): unknown } } };
    expect(allowDefaultXRFramebuffer(backend, 0x8ce0)).toBe(true);
    expect(allowDefaultXRFramebuffer(backend, 0x8ce0)).toBe(false);
    const map = backend.state.currentDrawbuffers;
    // WeakMap.set(null) would throw; the wrapper keeps the default framebuffer as "already [COLOR_ATTACHMENT0]".
    expect(() => map.set(null as unknown as object, [0x8ce0])).not.toThrow();
    expect(map.get(null as unknown as object)).toEqual([0x8ce0]);
    const fb = {};
    expect(map.get(fb)).toBeUndefined();
    map.set(fb, [0x8ce0, 0x8ce1]);
    expect(inner.get(fb)).toEqual([0x8ce0, 0x8ce1]);
    expect(allowDefaultXRFramebuffer({}, 0x8ce0)).toBe(false);
  });
});
