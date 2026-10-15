import { describe, expect, it } from 'vitest';
import { STILL_DRAW_CAP, stillPlan } from '../src/gpu/render-quality';

describe('stillPlan', () => {
  it('draws a 1080p final render on a discrete GPU in one piece, supersampled 2x (no tile seams in bloom or halation)', () => {
    const p = stillPlan(1920, 1080, 'final', 'discrete');
    expect(p.single).toBe(true);
    expect(p.supersample).toBe(2);
    expect(p.tileSize).toBe(STILL_DRAW_CAP.discrete);
    expect(p.frames).toBe(48);
  });
  it('a 4K final render is still one draw, but not oversampled', () => {
    const p = stillPlan(3840, 2160, 'final', 'discrete');
    expect(p.single).toBe(true);
    expect(p.supersample).toBe(1);
  });
  it('images beyond one draw are tiled with a modest tile size', () => {
    const p = stillPlan(7680, 4320, 'final', 'discrete');
    expect(p.single).toBe(false);
    expect(p.supersample).toBe(1);
    expect(p.tileSize).toBeLessThanOrEqual(1024);
  });
  it('smaller GPUs get smaller draws, fewer samples and no oversampling that would not fit', () => {
    expect(stillPlan(1920, 1080, 'final', 'integrated')).toMatchObject({ single: true, supersample: 1, tileSize: 2048 });
    expect(stillPlan(2560, 1440, 'final', 'integrated')).toMatchObject({ single: false, supersample: 1, tileSize: 1024 });
    expect(stillPlan(1000, 1000, 'final', 'integrated')).toMatchObject({ single: true, supersample: 2 });
    const sw = stillPlan(1280, 720, 'final', 'software');
    expect(sw.frames).toBeLessThan(stillPlan(1280, 720, 'final', 'discrete').frames);
    expect(sw.supersample).toBe(1);
  });
  it('the studio quality never oversamples and uses fewer samples than final', () => {
    const s = stillPlan(1920, 1080, 'studio', 'discrete');
    expect(s.supersample).toBe(1);
    expect(s.frames).toBe(24);
    expect(s.frames).toBeLessThan(stillPlan(1920, 1080, 'final', 'discrete').frames);
  });
  it('survives bad sizes and unknown classes', () => {
    const p = stillPlan(Number.NaN, -5, 'final', 'discrete');
    expect(p.tileSize).toBeGreaterThanOrEqual(256);
    expect(p.frames).toBeGreaterThan(0);
    expect(stillPlan(100, 100, 'final', 'unknown').tileSize).toBe(STILL_DRAW_CAP.unknown);
  });
});
