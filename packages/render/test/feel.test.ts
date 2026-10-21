/**
 * The game-feel director (trauma shake, hit-stop, FOV kick, pulses, squash, reduce motion) and the renderer-side
 * feel layer (cues by world feel, bursts, emitters from entities).
 */
import { describe, expect, it } from 'vitest';
import { Object3D, PerspectiveCamera, Scene } from 'three';
import { createWorld, resolveFeelCue } from '@aether/core';
import { FeelDirector, HIT_STOP_SCALE, shakeNoise } from '../src/feel/director';
import { GameFeel } from '../src/feel/game-feel';
import { buildProp } from '../src/characters/props';

function camera(): PerspectiveCamera {
  const c = new PerspectiveCamera(55, 16 / 9, 0.1, 500);
  c.position.set(1, 2, 3);
  c.lookAt(0, 1, 0);
  c.updateMatrixWorld();
  return c;
}

const pose = (c: PerspectiveCamera): number[] => [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov];

describe('feel director', () => {
  it('shake noise is smooth, bounded and seeded', () => {
    for (let t = 0; t < 20; t += 0.37) {
      const v = shakeNoise(3, 1, t);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(shakeNoise(3, 1, t + 0.001) - v)).toBeLessThan(0.02);
    }
    expect(shakeNoise(3, 1, 4.2)).toBe(shakeNoise(3, 1, 4.2));
    expect(shakeNoise(3, 1, 4.2)).not.toBe(shakeNoise(4, 1, 4.2));
  });

  it('trauma adds up to 1, shakes by its square and decays to rest', () => {
    const d = new FeelDirector();
    d.setSeed(7);
    const hit = resolveFeelCue(undefined, 'hit');
    d.play(hit);
    expect(d.traumaLevel).toBeCloseTo(hit.shake, 6);
    for (let i = 0; i < 6; i++) d.play(resolveFeelCue(undefined, 'explosion'));
    expect(d.traumaLevel).toBe(1);
    const s = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
    d.update(0.016);
    d.shake(s);
    expect(Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.roll)).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) d.update(1 / 60);
    expect(d.traumaLevel).toBe(0);
    d.shake(s);
    expect(Math.abs(s.x)).toBe(0);
    expect(Math.abs(s.roll)).toBe(0);
  });

  it('the same seed and the same events shake the same way', () => {
    const run = (seed: number): number[] => {
      const d = new FeelDirector();
      d.setSeed(seed);
      const out: number[] = [];
      const s = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
      d.play(resolveFeelCue(undefined, 'damage'), { seed: 12 });
      for (let i = 0; i < 30; i++) {
        d.update(1 / 60);
        d.shake(s);
        out.push(s.x, s.yaw);
      }
      return out;
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });

  it('applies shake and FOV kick for the draw only: restore puts the camera back exactly', () => {
    const d = new FeelDirector();
    const c = camera();
    const before = pose(c);
    d.play(resolveFeelCue({ preset: 'punchy', events: {} }, 'explosion'));
    for (let i = 0; i < 3; i++) d.update(1 / 60);
    d.apply(c);
    const during = pose(c);
    expect(during).not.toEqual(before);
    expect(c.fov).toBeGreaterThan(55);
    d.restore(c);
    expect(pose(c)).toEqual(before);
    // Nothing to apply at rest: the camera is untouched.
    const rest = new FeelDirector();
    rest.apply(c);
    rest.restore(c);
    expect(pose(c)).toEqual(before);
  });

  it('hit-stop freezes game time for its duration (real time), then releases', () => {
    const d = new FeelDirector();
    const cue = resolveFeelCue({ preset: 'punchy', events: {} }, 'hit');
    expect(cue.hitStop).toBeGreaterThan(0.05);
    d.play(cue);
    expect(d.frozen).toBe(true);
    expect(d.timeScale).toBe(HIT_STOP_SCALE);
    let t = 0;
    while (d.frozen && t < 1) {
      d.update(1 / 120);
      t += 1 / 120;
    }
    expect(t).toBeCloseTo(cue.hitStop, 1);
    expect(d.timeScale).toBe(1);
  });

  it('flash and vignette pulse and fade; damage tints them red', () => {
    const d = new FeelDirector();
    d.play(resolveFeelCue(undefined, 'damage'));
    expect(d.pulse.flash).toBeGreaterThan(0.2);
    expect(d.pulse.r).toBe(1);
    expect(d.pulse.g).toBeLessThan(0.3);
    expect(d.pulse.vignette).toBeGreaterThan(0.4);
    expect(d.pulse.vr).toBeGreaterThan(d.pulse.vg);
    for (let i = 0; i < 200; i++) d.update(1 / 60);
    expect(d.pulse.flash).toBe(0);
    expect(d.pulse.vignette).toBe(0);
    expect(d.active).toBe(false);
  });

  it('reduce motion: no shake, no FOV kick, no flash; squash and a short hit-stop remain', () => {
    const d = new FeelDirector();
    d.setReducedMotion(true);
    const c = camera();
    const before = pose(c);
    d.play(resolveFeelCue({ preset: 'punchy', events: {} }, 'explosion'));
    expect(d.traumaLevel).toBe(0);
    expect(d.pulse.flash).toBe(0);
    expect(d.fovOffset).toBe(0);
    expect(d.frozenFor).toBeLessThanOrEqual(0.04);
    d.update(1 / 60);
    d.apply(c);
    expect(pose(c)).toEqual(before);
    d.restore(c);
    d.play(resolveFeelCue(undefined, 'land'));
    d.update(0.03);
    const sq = d.squash({ y: 1, xz: 1 });
    expect(sq.y).toBeLessThan(1);
    expect(sq.xz).toBeGreaterThan(1);
  });

  it('a jump stretches, a landing squashes, both spring back to 1', () => {
    const d = new FeelDirector();
    d.play(resolveFeelCue(undefined, 'jump'), { stretch: true });
    d.update(0.01);
    expect(d.squash({ y: 1, xz: 1 }).y).toBeGreaterThan(1);
    for (let i = 0; i < 120; i++) d.update(1 / 60);
    expect(d.squash({ y: 0, xz: 0 })).toEqual({ y: 1, xz: 1 });
  });

  it('a tier of off plays nothing', () => {
    const d = new FeelDirector();
    d.play(resolveFeelCue({ preset: 'off', events: {} }, 'explosion'));
    expect(d.played).toBe(0);
    expect(d.active).toBe(false);
  });
});

describe('game feel layer', () => {
  it('plays the world feel: cue strengths follow the tier, bursts land in the pools', () => {
    const scene = new Scene();
    const objects = new Map<string, Object3D>();
    const fx = new GameFeel(scene, 'medium', false, { object: (id) => objects.get(id) });
    fx.setWorld(createWorld({ seed: 4, feel: { preset: 'punchy' } }));
    const punchy = fx.trigger('hit', [0, 1, 0], { seed: 3 });
    expect(punchy?.cue.tier).toBe('punchy');
    expect(fx.vfx.bursts).toBe(1);
    expect(fx.director.traumaLevel).toBeGreaterThan(0.5);
    fx.setWorld(createWorld({ seed: 4, feel: { preset: 'subtle', events: { pickup: { vfx: 'confetti' } } } }));
    fx.trigger('pickup', [0, 1, 0], { seed: 4 });
    expect(fx.vfx.pools.alpha.count).toBeGreaterThan(40); // confetti instead of the default sparkle
    // A pure effect (no feel event) bursts without a cue.
    expect(fx.trigger(null, [0, 0, 0], { seed: 1, vfx: 'smoke' })).toBeNull();
    expect(fx.vfx.bursts).toBe(3);
    fx.dispose();
  });

  it('attaches the emitters of entities with vfx once their objects exist, and drops removed ones', () => {
    const scene = new Scene();
    const objects = new Map<string, Object3D>();
    const fx = new GameFeel(scene, 'low', false, { object: (id) => objects.get(id) });
    const world = createWorld({
      entities: {
        torch: { id: 'torch', vfx: { preset: 'fire' } },
        chimney: { id: 'chimney', vfx: { preset: 'smoke', rate: 4 } },
        off: { id: 'off', vfx: { preset: 'embers', enabled: false } },
        tpl: { id: 'tpl', template: true, vfx: { preset: 'fire' } },
      },
    });
    fx.setWorld(world);
    expect(fx.vfx.emitterCount).toBe(0); // not mounted yet
    for (const id of ['torch', 'chimney', 'off', 'tpl']) {
      const o = new Object3D();
      scene.add(o);
      objects.set(id, o);
    }
    fx.syncEmitters(world);
    expect(fx.vfx.emitterCount).toBe(2);
    const { torch: _t, ...rest } = world.entities;
    fx.syncEmitters({ ...world, entities: rest });
    expect(fx.vfx.emitterCount).toBe(1);
    expect(fx.footsteps).toBe(true);
    fx.setWorld(createWorld({ feel: { preset: 'normal', events: {}, footsteps: false } }));
    expect(fx.footsteps).toBe(false);
    fx.dispose();
  });

  it('frame() scales game time by the hit-stop and squashes the avatar', () => {
    const scene = new Scene();
    const fx = new GameFeel(scene, 'low', false, { object: () => undefined });
    fx.setWorld(createWorld({}));
    const avatar = new Object3D();
    fx.trigger('damage', [0, 1, 0], { seed: 1 });
    expect(fx.frame(1 / 60, camera(), avatar)).toBe(HIT_STOP_SCALE);
    expect(avatar.scale.y).not.toBe(1);
    for (let i = 0; i < 120; i++) fx.frame(1 / 60, camera(), avatar);
    expect(fx.frame(1 / 60, camera(), avatar)).toBe(1);
    expect(avatar.scale.y).toBe(1);
    fx.dispose();
  });

  it('a torch held by a person burns: its flame anchor gets an emitter that survives world syncs', () => {
    const scene = new Scene();
    const fx = new GameFeel(scene, 'low', false, { object: () => undefined });
    const torch = buildProp('torch');
    expect(torch?.flame).toBeDefined();
    expect(buildProp('sword')?.flame).toBeUndefined();
    scene.add(torch!.group);
    fx.propEmitter('guard-1', torch!.flame ?? null);
    expect(fx.vfx.emitterCount).toBe(1);
    fx.setWorld(createWorld({ seed: 3 }));
    expect(fx.vfx.emitterCount).toBe(1);
    const cam = camera();
    cam.position.set(0, 1, 3);
    cam.updateMatrixWorld();
    for (let i = 0; i < 30; i++) fx.frame(1 / 60, cam, null);
    expect(fx.vfx.spawned).toBeGreaterThan(5);
    // Detached from the scene (the rig was removed): it stops emitting; null removes it.
    torch!.group.removeFromParent();
    const before = fx.vfx.spawned;
    for (let i = 0; i < 30; i++) fx.frame(1 / 60, cam, null);
    expect(fx.vfx.spawned).toBe(before);
    fx.propEmitter('guard-1', null);
    expect(fx.vfx.emitterCount).toBe(0);
    torch!.dispose();
    fx.dispose();
  });
});
