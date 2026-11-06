import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@aether/core';
import { experienceFor, keyAction, keyHint, type KeyLike, type PlayerPhase } from '../src/player/experience';
import { pickStops, roomUnderRay } from '../src/player/explore';
import { FADE_DISTANCE, forwardOf, glideDestination, glideSeconds, GLIDE_MAX_S, GLIDE_MIN_S, needsFade, STEP_UP, WALK_EYE, WALK_RADIUS, walkStep, yawPitch, type WalkProbe } from '../src/player/walk';
import { templatePublish } from '../src/showcase/publish';

const key = (code: string, extra: Partial<KeyLike> = {}): KeyLike => ({ code, key: code === 'Escape' ? 'Escape' : code.replace(/^Key/, '').toLowerCase(), ...extra });

describe('experience by kind', () => {
  it('presents each template kind its own way', () => {
    const of = (slug: string, building = false) => {
      const p = templatePublish(slug);
      return experienceFor(p.startMode, p.profile, building);
    };
    expect(of('kestrel-outpost')).toMatchObject({ kind: 'game', entry: 'title', explore: 'orbit' });
    expect(of('casa-patio', true)).toMatchObject({ kind: 'arch', entry: 'hero-tour', explore: 'walk', dollhouse: true, stopsLabel: 'Tour' });
    expect(of('photo-hotel-bedroom', false)).toMatchObject({ kind: 'arch', explore: 'walk', dollhouse: false });
    expect(of('cliff-sanctuary')).toMatchObject({ kind: 'showcase', entry: 'fly-in', explore: 'orbit', photo: true });
    expect(of('lisbon-hills')).toMatchObject({ kind: 'city', entry: 'street-drone', explore: 'drone' });
    // A city with a game goal is played from its title card and explored as a city.
    expect(of('neon-rain-city')).toMatchObject({ kind: 'game', entry: 'title', explore: 'drone', stopsLabel: 'Districts' });
  });

  it('treats a world with no start mode as a game, and a profile alone as its kind', () => {
    expect(experienceFor(undefined, undefined).kind).toBe('game');
    expect(experienceFor(undefined, 'walkthrough', true).kind).toBe('arch');
    expect(experienceFor(undefined, 'city').kind).toBe('city');
    expect(experienceFor(undefined, 'showcase').kind).toBe('showcase');
    expect(experienceFor('orbit', undefined).kind).toBe('showcase');
    expect(experienceFor('walkthrough', 'game').kind).toBe('arch');
  });
});

describe('player keys', () => {
  const arch = experienceFor('walkthrough', 'walkthrough', true);
  const show = experienceFor('orbit', 'showcase');
  const game = experienceFor('play', 'game');
  const act = (code: string, phase: PlayerPhase, exp = arch, extra: Partial<KeyLike> = {}) => keyAction(key(code, extra), phase, exp);

  it('P plays from explore mode or the title card, never mid-game', () => {
    expect(act('KeyP', 'exploring')).toBe('play');
    expect(act('KeyP', 'title', game)).toBe('play');
    expect(act('KeyP', 'playing', game)).toBe(null);
    expect(act('KeyP', 'paused', game)).toBe(null);
  });

  it('Tab and O explore from play and from the title card', () => {
    for (const code of ['Tab', 'KeyO']) {
      expect(act(code, 'playing', game)).toBe('explore');
      expect(act(code, 'title', game)).toBe('explore');
      expect(act(code, 'exploring', show)).toBe(null);
    }
  });

  it('Esc pauses play and explore mode and resumes from the menu', () => {
    expect(act('Escape', 'playing', game)).toBe('pause');
    expect(act('Escape', 'exploring')).toBe('pause');
    expect(act('Escape', 'paused')).toBe('resume');
    expect(act('Escape', 'title', game)).toBe(null);
    // A block world keeps Esc for its own inventory while playing.
    expect(keyAction(key('Escape'), 'playing', game, false, true)).toBe(null);
  });

  it('drives the tour in explore mode only', () => {
    expect(act('BracketRight', 'exploring')).toBe('next');
    expect(act('BracketLeft', 'exploring')).toBe('prev');
    expect(act('Space', 'exploring')).toBe('autoplay');
    expect(act('KeyM', 'exploring')).toBe('dollhouse');
    expect(act('KeyM', 'exploring', show)).toBe(null);
    expect(act('KeyF', 'exploring', show)).toBe('photo');
    expect(act('Digit3', 'exploring', show)).toBe('time');
    expect(act('Space', 'playing', game)).toBe(null);
    expect(act('BracketRight', 'title', game)).toBe(null);
  });

  it('leaves keys alone while typing, with modifiers and on repeat', () => {
    expect(keyAction(key('KeyP'), 'exploring', arch, true)).toBe(null);
    expect(act('KeyP', 'exploring', arch, { ctrlKey: true })).toBe(null);
    expect(act('KeyP', 'exploring', arch, { repeat: true })).toBe(null);
  });

  it('shows a short hint per phase', () => {
    expect(keyHint('exploring', arch)).toMatch(/Click the floor.*P play.*Esc/);
    expect(keyHint('exploring', show)).toMatch(/Drag to orbit.*P play/);
    expect(keyHint('exploring', arch, true)).toMatch(/Tap the floor/);
    expect(keyHint('playing', game)).toBe('Tab explore · Esc pause');
    expect(keyHint('title', game)).toBe('P play · Tab explore');
    expect(keyHint('paused', game)).toBe('');
  });
});

describe('tour stops source', () => {
  const s = (x: number, name?: string) => ({ position: [x, 1.6, 0] as Vec3, target: [x + 1, 1.5, 0] as Vec3, ...(name ? { name } : {}) });
  it("prefers the world's own stops, then the cook's, then computes", () => {
    let computed = 0;
    const compute = () => {
      computed++;
      return [s(9)];
    };
    expect(pickStops([s(1, 'Own')], [s(2)], compute).map((v) => v.name)).toEqual(['Own']);
    expect(pickStops(undefined, [s(2, 'Cooked')], compute).map((v) => v.name)).toEqual(['Cooked']);
    expect(computed).toBe(0);
    expect(pickStops([], [], compute)[0]!.position[0]).toBe(9);
    expect(computed).toBe(1);
  });
});

describe('dollhouse room pick', () => {
  const rooms = [
    { index: 1, min: [0, -0.2, 0] as Vec3, max: [5, 0, 4] as Vec3 },
    { index: 2, min: [5.2, -0.2, 0] as Vec3, max: [9, 0, 4] as Vec3 },
    { index: 3, min: [0, 2.8, 0] as Vec3, max: [5, 3, 4] as Vec3 },
  ];
  it('picks the floor under the pointer, the upper storey first', () => {
    const down = (x: number, z: number) => ({ origin: [x, 50, z] as Vec3, direction: [0, -1, 0] as Vec3 });
    expect(roomUnderRay(down(7, 2), rooms)?.index).toBe(2);
    expect(roomUnderRay(down(2, 2), rooms)?.index).toBe(3);
    expect(roomUnderRay(down(20, 2), rooms)).toBeNull();
    expect(roomUnderRay({ origin: [2, 50, 2], direction: [0, 1, 0] }, rooms)).toBeNull();
  });
});

/** A floor at y 0 over x, z in [-10, 10] (a raised step from x ≥ 4: 0.3 m, a platform from x ≥ 8: 1 m), and boxes. */
function scene(boxes: Array<{ min: Vec3; max: Vec3 }>): WalkProbe {
  const hitBox = (from: Readonly<Vec3>, dir: Readonly<Vec3>, max: number): number => {
    let best = max;
    for (const b of boxes) {
      let t0 = 0;
      let t1 = max;
      let ok = true;
      for (let i = 0; i < 3 && ok; i++) {
        const d = dir[i] as number;
        const a = from[i] as number;
        if (Math.abs(d) < 1e-9) {
          if (a < (b.min[i] as number) || a > (b.max[i] as number)) ok = false;
          continue;
        }
        let ta = ((b.min[i] as number) - a) / d;
        let tb = ((b.max[i] as number) - a) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) ok = false;
      }
      if (ok && t0 < best) best = t0;
    }
    return best;
  };
  const ground = (x: number): number => (x >= 8 ? 1 : x >= 4 ? 0.3 : 0);
  return {
    free: hitBox,
    floor(x, z, fromY) {
      if (Math.abs(x) > 10 || Math.abs(z) > 10) return null;
      const g = ground(x);
      return g <= fromY ? g : null;
    },
  };
}

describe('eye-level walk', () => {
  const eye: Vec3 = [0, WALK_EYE, 0];

  it('walks forward along the view at a slow pace, keeping the eye over the floor', () => {
    const p = walkStep(eye, 0, { forward: 1, right: 0 }, 0.1, scene([]));
    expect(p[2]).toBeCloseTo(-0.14, 5);
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(WALK_EYE, 6);
    // A quarter turn left looks along −X.
    const [fx, fz] = forwardOf(Math.PI / 2);
    expect(fx).toBeCloseTo(-1, 6);
    expect(fz).toBeCloseTo(0, 6);
    // Right is +X when looking along −Z.
    expect(walkStep(eye, 0, { forward: 0, right: 1 }, 0.1, scene([]))[0]).toBeGreaterThan(0.1);
  });

  it('stops at a wall and slides along it', () => {
    // A wall across the path 0.36 m ahead (−Z): closer than a step and the body radius.
    const wall = { min: [-5, 0, -0.5] as Vec3, max: [5, 3, -0.36] as Vec3 };
    const blocked = walkStep(eye, 0, { forward: 1, right: 0 }, 0.1, scene([wall]));
    expect(blocked).toEqual(eye);
    // Walking diagonally into it slides sideways.
    const slid = walkStep(eye, 0, { forward: 1, right: 1 }, 0.1, scene([wall]));
    expect(slid[0]).toBeGreaterThan(0.05);
    expect(slid[2]).toBeCloseTo(0, 6);
  });

  it('climbs a step, not a platform', () => {
    const atStep: Vec3 = [3.95, WALK_EYE, 0];
    const up = walkStep(atStep, -Math.PI / 2, { forward: 1, right: 0 }, 0.1, scene([]));
    expect(up[1]).toBeCloseTo(0.3 + WALK_EYE, 6);
    const atPlatform: Vec3 = [7.95, 0.3 + WALK_EYE, 0];
    expect(1 - 0.3).toBeGreaterThan(STEP_UP);
    expect(walkStep(atPlatform, -Math.PI / 2, { forward: 1, right: 0 }, 0.1, scene([]))).toEqual(atPlatform);
  });

  it('does not walk off the edge of the world', () => {
    const edge: Vec3 = [0, WALK_EYE, -9.95];
    expect(walkStep(edge, 0, { forward: 1, right: 0 }, 0.1, scene([]))).toEqual(edge);
  });

  it('glides to a clicked floor point at eye height, short of furniture in the way', () => {
    const probe = scene([]);
    expect(glideDestination(eye, { point: [2, 0, -3], normal: [0, 1, 0] }, probe)).toEqual([2, WALK_EYE, -3]);
    // A wall clicked: a step back from it toward the viewer.
    const d = glideDestination(eye, { point: [0, 1.2, -5], normal: [0, 0, 1] }, probe)!;
    expect(d[2]).toBeCloseTo(-4.3, 6);
    expect(d[1]).toBeCloseTo(WALK_EYE, 6);
    // A sofa just before the clicked point: stop before it.
    const sofa = { min: [-1, 0, -3.6] as Vec3, max: [1, 1.2, -3] as Vec3 };
    const s = glideDestination(eye, { point: [0, 0, -3.8], normal: [0, 1, 0] }, scene([sofa]))!;
    expect(s[2]).toBeGreaterThan(-3 + WALK_RADIUS);
    // Nowhere to stand.
    expect(glideDestination(eye, { point: [0, 1, -20], normal: [0, 0, 1] }, scene([]))).toBeNull();
  });

  it('fades across walls and long distances, glides in the open', () => {
    const probe = scene([{ min: [-5, 0, -2.1], max: [5, 3, -1.9] }]);
    expect(needsFade(eye, [0, WALK_EYE, -1], probe)).toBe(false);
    expect(needsFade(eye, [0, WALK_EYE, -4], probe)).toBe(true);
    expect(needsFade(eye, [FADE_DISTANCE + 1, WALK_EYE, 0], scene([]))).toBe(true);
    expect(glideSeconds(0.1)).toBe(GLIDE_MIN_S);
    expect(glideSeconds(100)).toBe(GLIDE_MAX_S);
  });

  it('reads yaw and pitch as the camera rig does', () => {
    const { yaw, pitch } = yawPitch([0, 1.6, 0], [0, 1.6, -4]);
    expect(yaw).toBeCloseTo(0, 6);
    expect(pitch).toBeCloseTo(0, 6);
    expect(yawPitch([0, 1.6, 0], [-4, 1.6, 0]).yaw).toBeCloseTo(Math.PI / 2, 6);
    expect(yawPitch([0, 1.6, 0], [0, 0, -4]).pitch).toBeLessThan(0);
  });
});
