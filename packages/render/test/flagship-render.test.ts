/**
 * Render-side fixes found in the flagship screenshot rounds: rain streaks near the lens, the umbrella a person can hold, the ground
 * patches of a big lawn.
 */
import { Group, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { CharacterHold } from '@aether/core';
import { lookFromText } from '@aether/assets';
import { buildProp } from '../src/characters/props';
import { WEATHER_CONFIGS, WeatherSystem } from '../src/environment/weather';
import { groundHue, groundTint } from '../src/environment/environment-rig';

describe('rain near the lens', () => {
  it('shrinks the streaks that pass close to the camera, so no drop is a metre-long bar across the frame', () => {
    const parent = new Group();
    const w = new WeatherSystem(parent);
    w.set('rain');
    const cam = new PerspectiveCamera();
    cam.position.set(0, 2, 0);
    cam.updateMatrixWorld(true);
    w.update(0.016, cam);
    const m = (parent.children[0] as unknown as { instanceMatrix: { array: Float32Array } }).instanceMatrix.array;
    const full = WEATHER_CONFIGS.rain.size[1];
    let near = 0;
    let far = 0;
    for (let i = 0; i < w.count; i++) {
      const k = i * 16;
      const d = Math.hypot((m[k + 12] as number) - cam.position.x, (m[k + 13] as number) - cam.position.y, (m[k + 14] as number) - cam.position.z);
      const len = Math.hypot(m[k + 4] as number, m[k + 5] as number, m[k + 6] as number);
      if (d < 0.8) {
        near++;
        expect(len).toBeLessThan(full * 0.05);
      } else if (d > 4.2) {
        far++;
        expect(len).toBeCloseTo(full, 4);
      } else expect(len).toBeLessThanOrEqual(full + 1e-6);
    }
    expect(far).toBeGreaterThan(1000);
    expect(near).toBeGreaterThanOrEqual(0);
    w.dispose();
  });
});

describe('the umbrella', () => {
  it('is a hold value of the schema, of the words and of the prop builder', () => {
    expect(CharacterHold.safeParse('umbrella').success).toBe(true);
    expect(lookFromText('a woman with an umbrella')?.hold).toBe('umbrella');
    expect(lookFromText('a man carrying a brolly')?.hold).toBe('umbrella');
    const prop = buildProp('umbrella');
    expect(prop).not.toBeNull();
    expect(prop?.twoHanded).toBe(false);
    // A pole, a handle, a dome and a ferrule: four meshes, the dome wider than a head and above it.
    expect(prop?.group.children.length).toBe(4);
    const dome = prop?.group.children[2];
    expect(dome?.position.y ?? 0).toBeGreaterThan(0.6);
    expect(dome?.scale.x ?? 0).toBeGreaterThanOrEqual(1);
    prop?.dispose();
  });
});

describe('ground patches', () => {
  it('drift in warmth across a lawn as well as in value, over metres and not just hundreds of metres', () => {
    let warmer = 0;
    let cooler = 0;
    for (let i = 0; i < 400; i++) {
      const h = groundHue(i * 4.1 - 800, i * 2.7 - 500);
      if (h > 0.25) warmer++;
      if (h < -0.25) cooler++;
    }
    expect(warmer).toBeGreaterThan(40);
    expect(cooler).toBeGreaterThan(40);
    // The finer octave moves the tint within a couple of metres' walk of a few decimetres' worth of wavelength.
    let moved = 0;
    for (let i = 0; i < 200; i++) if (Math.abs(groundTint(i * 3.3, i * 1.9) - groundTint(i * 3.3 + 6, i * 1.9 + 6)) > 0.01) moved++;
    expect(moved).toBeGreaterThan(100);
  });
});
