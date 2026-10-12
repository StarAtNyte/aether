import { describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Scene, Vector3, FogExp2 } from 'three';
import { Environment } from '@aether/core';
import { computeSkyState, mixHex, normalizeHour, PRESET_HOURS, sunPosition } from '../src/environment/sky-state';
import { fitShadowCamera } from '../src/environment/shadow-fit';
import { EnvironmentRig, groundTint, MAX_FOG_DENSITY } from '../src/environment/environment-rig';
import { WeatherSystem, WEATHER_CONFIGS } from '../src/environment/weather';
import { MaterialCache } from '../src/materials/material-cache';
import { Group } from 'three';

const env = (input: Record<string, unknown> = {}): Environment => Environment.parse(input);

describe('sun and sky', () => {
  it('sun rises at 6, peaks at noon, sets at 18 and is below the horizon at midnight', () => {
    expect(sunPosition(6).elevation).toBeCloseTo(0, 5);
    expect(sunPosition(12).elevation).toBeCloseTo(70, 5);
    expect(sunPosition(18).elevation).toBeCloseTo(0, 5);
    expect(sunPosition(0).elevation).toBeLessThan(-60);
    const d = sunPosition(9).direction;
    expect(Math.hypot(...d)).toBeCloseTo(1, 6);
    expect(sunPosition(7).direction[0]).not.toBeCloseTo(sunPosition(17).direction[0], 1);
  });

  it('normalizes hours', () => {
    expect(normalizeHour(25)).toBe(1);
    expect(normalizeHour(-1)).toBe(23);
    expect(normalizeHour(Number.NaN)).toBe(12);
  });

  it('uses preset default hours and timeOfDay overrides', () => {
    expect(computeSkyState(env({ sky: 'sunset' })).hour).toBe(PRESET_HOURS.sunset);
    expect(computeSkyState(env({ sky: 'day', timeOfDay: 20 })).hour).toBe(20);
  });

  it('day is bright and starless, night has stars and a dim moon', () => {
    const day = computeSkyState(env({ sky: 'day' }));
    const night = computeSkyState(env({ sky: 'night' }));
    expect(day.stars).toBe(0);
    expect(day.moon).toBe(false);
    expect(day.lightDirection[1]).toBeGreaterThan(0.5);
    expect(night.stars).toBeGreaterThan(0.9);
    expect(night.moon).toBe(true);
    expect(night.lightIntensity).toBeLessThan(day.lightIntensity);
    expect(night.lightDirection[1]).toBeGreaterThan(0);
    expect(night.hemiIntensity).toBeLessThan(day.hemiIntensity);
  });

  it('sunset is warm and low', () => {
    const s = computeSkyState(env({ sky: 'sunset' }));
    const [r, , b] = [1, 3, 5].map((i) => Number.parseInt(s.lightColor.slice(i, i + 2), 16)) as [number, number, number];
    expect(r).toBeGreaterThan(b);
    expect(s.elevation).toBeLessThan(10);
  });

  it('space has stars and no ground; studio has no haze; overcast is diffuse', () => {
    const space = computeSkyState(env({ sky: 'space' }));
    expect(space.showGround).toBe(false);
    expect(space.stars).toBe(1);
    expect(space.hazeDensity).toBe(0);
    expect(computeSkyState(env({ sky: 'studio' })).hazeDensity).toBe(0);
    const overcast = computeSkyState(env({ sky: 'overcast' }));
    expect(overcast.sunGlowStrength).toBe(0);
    expect(overcast.hemiIntensity).toBeGreaterThan(computeSkyState(env({ sky: 'day' })).hemiIntensity);
  });

  it('scales with sun and ambient intensity', () => {
    const a = computeSkyState(env({ sunIntensity: 1, ambientIntensity: 0.2 }));
    const b = computeSkyState(env({ sunIntensity: 2, ambientIntensity: 0.4 }));
    expect(b.lightIntensity).toBeCloseTo(a.lightIntensity * 2);
    expect(b.hemiIntensity).toBeCloseTo(a.hemiIntensity * 2);
  });

  it('mixes colors', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#102030', '#102030', 0.3)).toBe('#102030');
    expect(mixHex('#000000', '#ffffff', 5)).toBe('#ffffff');
  });
});

describe('fitShadowCamera', () => {
  it('fits the frustum around the bounds with the light along its direction', () => {
    const fit = fitShadowCamera({ min: [-10, 0, -10], max: [10, 5, 10] }, [0, 1, 0]);
    expect(fit.center).toEqual([0, 2.5, 0]);
    expect(fit.halfSize).toBeGreaterThanOrEqual(Math.hypot(20, 5, 20) / 2);
    expect(fit.position[1]).toBeGreaterThan(fit.center[1]);
    expect(fit.far).toBeGreaterThan(fit.position[1] - fit.center[1]);
  });

  it('clamps tiny and huge scenes; empty bounds give a default', () => {
    expect(fitShadowCamera({ min: [0, 0, 0], max: [0.1, 0.1, 0.1] }, [0, 1, 0]).halfSize).toBe(12);
    const huge = fitShadowCamera({ min: [-5000, 0, -5000], max: [5000, 10, 5000] }, [0, 1, 0]);
    expect(huge.halfSize).toBe(160);
    expect(huge.mapSize).toBe(4096);
    expect(fitShadowCamera(null, [1, 1, 0]).center).toEqual([0, 0, 0]);
  });
});

describe('EnvironmentRig', () => {
  it('applies sky, lights, fog and ground; fits shadows', () => {
    const materials = new MaterialCache();
    const rig = new EnvironmentRig(materials, true);
    const scene = new Scene();
    scene.add(rig.group);
    rig.apply(env({ sky: 'day', fog: { color: '#aabbcc', density: 0.9 } }), scene);
    expect(scene.fog).toBeInstanceOf(FogExp2);
    expect((scene.fog as FogExp2).density).toBe(MAX_FOG_DENSITY);
    expect(rig.groundMesh).not.toBeNull();
    expect(rig.sun.castShadow).toBe(true);
    const groundMat = rig.groundMesh!.material;

    // Same ground → same mesh; different → replaced and old material released.
    rig.apply(env({ sky: 'day' }), scene);
    expect(rig.groundMesh!.material).toBe(groundMat);
    rig.apply(env({ sky: 'space' }), scene);
    expect(rig.groundMesh).toBeNull();
    expect(scene.fog).toBeNull();
    expect(materials.size).toBe(0);

    rig.apply(env({ sky: 'day', ground: null }), scene);
    expect(rig.groundMesh).toBeNull();

    rig.fitShadows(new Box3(new Vector3(-50, 0, -50), new Vector3(50, 10, 50)));
    expect(rig.sun.shadow.camera.right).toBeGreaterThanOrEqual(70);
    rig.fitShadows(new Box3());
    expect(rig.sun.shadow.camera.right).toBe(12);

    const cam = new PerspectiveCamera();
    cam.position.set(100, 5, 0);
    rig.update(0.016, cam);
    expect(rig.sky.group.position.x).toBe(100);
    rig.dispose();
  });

  it('ground tint stays subtle', () => {
    for (let i = 0; i < 100; i++) {
      const t = groundTint(i * 13.7 - 500, i * 7.1 - 300);
      expect(t).toBeGreaterThan(0.85);
      expect(t).toBeLessThan(1.1);
    }
  });
});

describe('WeatherSystem', () => {
  it('creates one instanced mesh per kind, wraps around the camera and clears', () => {
    const parent = new Group();
    const w = new WeatherSystem(parent);
    w.set('rain');
    expect(w.count).toBe(WEATHER_CONFIGS.rain.count);
    expect(parent.children.length).toBe(1);
    const cam = new PerspectiveCamera();
    cam.position.set(1000, 50, -1000);
    w.update(0.016, cam);
    const mesh = parent.children[0] as unknown as { instanceMatrix: { array: Float32Array } };
    const m = mesh.instanceMatrix.array;
    const [hx, hy, hz] = WEATHER_CONFIGS.rain.half;
    for (let i = 0; i < 50; i++) {
      expect(Math.abs((m[i * 16 + 12] as number) - 1000)).toBeLessThanOrEqual(hx + 1e-3);
      expect(Math.abs((m[i * 16 + 13] as number) - 50)).toBeLessThanOrEqual(hy + 1e-3);
      expect(Math.abs((m[i * 16 + 14] as number) + 1000)).toBeLessThanOrEqual(hz + 1e-3);
    }
    w.set('rain');
    expect(parent.children.length).toBe(1);
    w.set('fireflies');
    expect(w.count).toBe(WEATHER_CONFIGS.fireflies.count);
    w.update(0.5, cam);
    w.set('clear');
    expect(parent.children.length).toBe(0);
    expect(w.count).toBe(0);
    w.update(0.016, cam);
    w.dispose();
  });

  it('updates 5000 particles quickly', () => {
    const w = new WeatherSystem(new Group());
    w.set('rain');
    const cam = new PerspectiveCamera();
    const t0 = performance.now();
    for (let f = 0; f < 120; f++) w.update(1 / 60, cam);
    expect((performance.now() - t0) / 120).toBeLessThan(5);
    w.dispose();
  });
});
