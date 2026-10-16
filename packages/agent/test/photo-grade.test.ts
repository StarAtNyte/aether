import { describe, expect, it } from 'vitest';
import { GRADE_RANGE, applyGrade, estimatePhotoGrade, lightFromGrade, matchGrade, nextEnvironmentGrade, nextExposure, type EnvironmentGrade } from '../src/photo/grade';
import type { Raster } from '../src/photo/score';

/** A room-like picture: wall, floor, bright white bedding and a dark picture, multiplied by a light colour and exposure. */
function room(opts: { light?: [number, number, number]; exposure?: number; wall?: [number, number, number] } = {}): Raster {
  const w = 80;
  const h = 60;
  const light = opts.light ?? [1, 1, 1];
  const e = opts.exposure ?? 1;
  const wall = opts.wall ?? [175, 170, 165];
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c: [number, number, number] = wall;
      if (y > h * 0.7) c = [90, 80, 70];
      if (x > w * 0.4 && y > h * 0.5 && y < h * 0.9) c = [235, 235, 235]; // white bedding
      if (x > w * 0.2 && x < w * 0.35 && y > h * 0.2 && y < h * 0.4) c = [35, 30, 30];
      const o = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) data[o + k] = Math.max(0, Math.min(255, Math.round(c[k]! * light[k]! * e)));
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

describe('photo grade', () => {
  it('reads a neutral picture as neutral', () => {
    const g = estimatePhotoGrade(room());
    expect(g).not.toBeNull();
    expect(Math.abs(g!.warmth)).toBeLessThan(0.08);
    expect(g!.median).toBeGreaterThan(0.2);
    expect(g!.p95).toBeGreaterThan(g!.p5);
  });

  it('reads warm tungsten light as warm and cool light as cool', () => {
    expect(estimatePhotoGrade(room({ light: [1, 0.82, 0.55] }))!.warmth).toBeGreaterThan(0.3);
    expect(estimatePhotoGrade(room({ light: [0.7, 0.85, 1] }))!.warmth).toBeLessThan(-0.2);
    expect(lightFromGrade(estimatePhotoGrade(room({ light: [1, 0.82, 0.55] }))!).warmth).toBe('warm');
  });

  it('does not read a strongly coloured wall as a cast when there are neutral highlights', () => {
    const g = estimatePhotoGrade(room({ wall: [120, 60, 130] }))!;
    expect(Math.abs(g.warmth)).toBeLessThan(0.1);
  });

  it('matching a neutral render to a warm photo warms it and the measured warmth follows', () => {
    const photo = estimatePhotoGrade(room({ light: [1, 0.85, 0.6], exposure: 0.8 }))!;
    const render = room();
    const rg = estimatePhotoGrade(render)!;
    const m = matchGrade(photo, rg);
    expect(m.gain[0]).toBeGreaterThan(1);
    expect(m.gain[2]).toBeLessThan(1);
    const graded = applyGrade({ ...render, data: render.data.slice() }, m);
    const after = estimatePhotoGrade(graded)!;
    expect(Math.abs(after.warmth - photo.warmth)).toBeLessThan(Math.abs(rg.warmth - photo.warmth) * 0.5);
    expect(Math.abs(after.median - photo.median)).toBeLessThan(Math.abs(rg.median - photo.median));
  });

  it('keeps the grade bounded for absurd mismatches and leaves alpha alone', () => {
    const dark = estimatePhotoGrade(room({ exposure: 0.1 }))!;
    const bright = estimatePhotoGrade(room({ exposure: 1.4 }))!;
    const m = matchGrade(dark, bright);
    expect(m.gamma).toBeLessThanOrEqual(1.8);
    expect(m.gamma).toBeGreaterThanOrEqual(0.55);
    expect(m.gain[0]).toBeLessThanOrEqual(1.28);
    const r = room();
    applyGrade(r, m);
    expect(r.data[3]).toBe(255);
  });

  it('proposes an exposure that moves the render towards the photo, damped and bounded', () => {
    const photo = estimatePhotoGrade(room({ exposure: 1.2 }))!;
    const dim = estimatePhotoGrade(room({ exposure: 0.4 }))!;
    const e = nextExposure(1, photo, dim);
    expect(e).toBeGreaterThan(1);
    expect(e).toBeLessThanOrEqual(1.7);
    expect(nextExposure(1, dim, photo)).toBeLessThan(1);
    expect(nextExposure(3, photo, dim)).toBeLessThanOrEqual(3);
  });

  it('keeps the environment grade and exposure in a modest range however many times and however far off it is asked', () => {
    const photo = estimatePhotoGrade(room({ light: [1, 0.78, 0.55], exposure: 1 }))!;
    const render = estimatePhotoGrade(room({ light: [0.5, 0.7, 1], exposure: 0.2 }))!;
    let g: Partial<EnvironmentGrade> | undefined;
    let e = 1;
    for (let i = 0; i < 12; i++) {
      g = nextEnvironmentGrade(g, matchGrade(photo, render));
      e = nextExposure(e, photo, render);
    }
    expect(Math.abs(g!.temperature!)).toBeLessThanOrEqual(GRADE_RANGE.temperature + 1e-9);
    expect(g!.saturation!).toBeGreaterThanOrEqual(GRADE_RANGE.saturation[0]);
    expect(g!.saturation!).toBeLessThanOrEqual(GRADE_RANGE.saturation[1]);
    expect(g!.contrast!).toBeLessThanOrEqual(GRADE_RANGE.contrast[1]);
    expect(e).toBeLessThanOrEqual(GRADE_RANGE.exposure[1]);
    expect(e).toBeGreaterThanOrEqual(GRADE_RANGE.exposure[0]);
    // The first step is half of what is measured, towards the photo (warm).
    const first = nextEnvironmentGrade(undefined, matchGrade(photo, render));
    expect(first.temperature).toBeGreaterThan(0);
  });

  it('refuses malformed rasters', () => {
    expect(estimatePhotoGrade({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toBeNull();
    expect(estimatePhotoGrade({ width: 10, height: 10, data: new Uint8ClampedArray(4) })).toBeNull();
  });
});
