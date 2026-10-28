import { describe, expect, it } from 'vitest';
import { getLoadPoster, loadProgress, setLoadPoster } from '../src/lib/loadPoster';

describe('load progress', () => {
  it('moves forward through the three steps as the loading text advances', () => {
    const texts = ['Loading editor…', 'Creating project…', 'Starting renderer…', 'Renderer ready (webgpu, software GPU)', 'Building the world…', 'Preparing camera…', 'Loading the sky…', 'Preparing shaders…'];
    const ps = texts.map(loadProgress);
    for (let i = 1; i < ps.length; i++) {
      expect(ps[i]!.fraction).toBeGreaterThanOrEqual(ps[i - 1]!.fraction);
      expect(ps[i]!.step).toBeGreaterThanOrEqual(ps[i - 1]!.step);
    }
    expect(ps[0]!.step).toBe(1);
    expect(ps[4]!.step).toBe(2);
    expect(ps[7]!.step).toBe(3);
  });
  it('holds the poster until cleared', () => {
    setLoadPoster('/templates/casa-patio.webp');
    expect(getLoadPoster()).toBe('/templates/casa-patio.webp');
    setLoadPoster(null);
    expect(getLoadPoster()).toBeNull();
  });
});
