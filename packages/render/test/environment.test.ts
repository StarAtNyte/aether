import { describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Scene, Vector3, FogExp2 } from 'three';
import { Environment } from '@aether/core';
import { computeSkyState, mixHex, NIGHT_WINDOW, normalizeHour, PRESET_HOURS, PRESET_WINDOWS, sunPosition } from '../src/environment/sky-state';
import { maxContentFogDensity, worldFogDensity } from '../src/environment/fog';
import { fitShadowCamera } from '../src/environment/shadow-fit';
import { EnvironmentRig, groundTint, MAX_FOG_DENSITY } from '../src/environment/environment-rig';
import { WeatherSystem, WEATHER_CONFIGS, writeTumble } from '../src/environment/weather';
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

  it('uses preset default hours; timeOfDay moves the sun only inside the preset window', () => {
    expect(computeSkyState(env({ sky: 'sunset' })).hour).toBe(PRESET_HOURS.sunset);
    expect(computeSkyState(env({ sky: 'day', timeOfDay: 14 })).hour).toBe(14);
    // A day sky asked for 20:00 stays a day sky (latest daylight hour of the window).
    expect(computeSkyState(env({ sky: 'day', timeOfDay: 20 })).hour).toBe(PRESET_WINDOWS.day[1]);
    expect(computeSkyState(env({ sky: 'sunset', timeOfDay: 19 })).hour).toBe(PRESET_WINDOWS.sunset[1]);
    expect(computeSkyState(env({ sky: 'dawn', timeOfDay: 3 })).hour).toBe(PRESET_WINDOWS.dawn[0]);
    expect(computeSkyState(env({ sky: 'night', timeOfDay: 12 })).hour).toBe(NIGHT_WINDOW[0]);
    expect(computeSkyState(env({ sky: 'night', timeOfDay: 1 })).hour).toBe(1);
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
    // A wall of fog is capped by the content-size policy (foggy, but the scene stays readable).
    const density = (scene.fog as FogExp2).density;
    expect(density).toBeCloseTo(worldFogDensity(0.9, 20), 10);
    expect(density).toBeLessThan(MAX_FOG_DENSITY);
    expect(density).toBeGreaterThan(maxContentFogDensity(20));
    expect(rig.fogState?.density).toBe(density);
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

  it('view-distance mode: terrain fades linearly over its last half, the scene haze stays light', () => {
    const rig = new EnvironmentRig(new MaterialCache(), true);
    const scene = new Scene();
    rig.apply(env({ sky: 'day' }), scene);
    expect(rig.terrainFog.near).toBeGreaterThan(1e4);
    rig.setFogDistance(128);
    expect(rig.terrainFog.near).toBe(64);
    expect(rig.terrainFog.far).toBe(128);
    // No explicit fog in the document: no extra exponential haze on the terrain.
    expect(rig.terrainFog.density).toBe(0);
    const fog = scene.fog as FogExp2;
    // ≈ 58 % at 0.8 of the distance (no longer 95 % at the edge, 53 % at half of it).
    expect(1 - Math.exp(-((fog.density * 64) ** 2))).toBeLessThan(0.35);
    expect(rig.terrainFog.color.equals(fog.color)).toBe(true);
    // An explicit fog (misty world) adds its haze to the terrain fade.
    rig.apply(env({ sky: 'day', fog: { color: '#aabbcc', density: 0.9 } }), scene);
    expect(rig.terrainFog.density).toBeGreaterThan(0);
    rig.setFogDistance(null);
    expect(rig.terrainFog.near).toBeGreaterThan(1e4);
    expect(rig.terrainFog.density).toBe(0);
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

  it('tumbles petals and leaves with orthonormal, double-sided rotations', () => {
    for (const kind of ['petals', 'leaves'] as const) {
      const parent = new Group();
      const w = new WeatherSystem(parent);
      w.set(kind);
      expect(w.count).toBe(WEATHER_CONFIGS[kind].count);
      const mesh = parent.children[0] as unknown as { instanceMatrix: { array: Float32Array }; material: { side: number } };
      expect(mesh.material.side).toBe(2); // DoubleSide
      const cam = new PerspectiveCamera();
      w.update(0.25, cam);
      const before = Array.from(mesh.instanceMatrix.array.slice(0, 11));
      w.update(0.25, cam);
      const m = mesh.instanceMatrix.array;
      // Rotation changes over time…
      expect(Array.from(m.slice(0, 11))).not.toEqual(before);
      // …and stays a pure rotation (unit columns, orthogonal).
      for (let i = 0; i < 20; i++) {
        const k = i * 16;
        const c0 = [m[k], m[k + 1], m[k + 2]] as number[];
        const c1 = [m[k + 4], m[k + 5], m[k + 6]] as number[];
        const c2 = [m[k + 8], m[k + 9], m[k + 10]] as number[];
        const dot = (a: number[], b: number[]): number => (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number);
        expect(dot(c0, c0)).toBeCloseTo(1, 5);
        expect(dot(c1, c1)).toBeCloseTo(1, 5);
        expect(dot(c2, c2)).toBeCloseTo(1, 5);
        expect(dot(c0, c1)).toBeCloseTo(0, 5);
        expect(dot(c1, c2)).toBeCloseTo(0, 5);
      }
      w.dispose();
      expect(parent.children.length).toBe(0);
    }
  });

  it('writeTumble writes a rotation without touching translation', () => {
    const m = new Float32Array(16);
    m[12] = 7;
    m[15] = 1;
    writeTumble(m, 0, 0, 0);
    expect(Array.from(m)).toEqual([1, 0, -0, 0, 0, 1, 0, 0, 0, -0, 1, 0, 7, 0, 0, 1]);
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

describe('EnvironmentRig shadow map budget', () => {
  it('applies a lowered cap to the current map immediately and never exceeds it when refitting', async () => {
    const { MaterialCache } = await import('../src/materials/material-cache');
    const rig = new EnvironmentRig(new MaterialCache(), true);
    expect(rig.sun.shadow.mapSize.x).toBeLessThanOrEqual(2048);
    rig.shadowMapCap = 1024;
    expect(rig.sun.shadow.mapSize.x).toBe(1024);
    rig.fitShadows(new Box3(new Vector3(-200, 0, -200), new Vector3(200, 50, 200)));
    expect(rig.sun.shadow.mapSize.x).toBe(1024);
    rig.shadowMapCap = Number.NaN;
    expect(rig.shadowMapCap).toBe(1024);
    rig.shadowMapCap = 2048;
    rig.fitShadows(new Box3(new Vector3(-200, 0, -200), new Vector3(200, 50, 200)));
    expect(rig.sun.shadow.mapSize.x).toBe(2048);
    rig.dispose();
  });
});
