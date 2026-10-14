import { describe, expect, it } from 'vitest';
import { qualityPlan, Refinement, SHADOW_RADIUS, STUDIO_ACCUMULATE_FRAMES, STUDIO_ACCUMULATE_FRAMES_SOFTWARE, STUDIO_SHADOW_MAP_MAX, studioAvailable } from '../src/gpu/render-quality';
import { renderBudget } from '../src/gpu/budget';

describe('qualityPlan', () => {
  it('realtime follows the budget and keeps adaptive resolution', () => {
    const b = renderBudget('discrete', false);
    expect(qualityPlan('realtime', b)).toEqual({ quality: 'realtime', post: 'standard', shadowMapCap: b.shadowMapCap, shadowRadius: SHADOW_RADIUS.realtime, accumulateFrames: 0, adaptiveResolution: true });
  });
  it('studio asks for the studio pipeline, bigger softer shadows and refinement frames', () => {
    const b = renderBudget('integrated', false);
    const p = qualityPlan('studio', b);
    expect(p.quality).toBe('studio');
    expect(p.post).toBe('studio');
    expect(p.shadowMapCap).toBe(Math.min(STUDIO_SHADOW_MAP_MAX, b.shadowMapCap * 2));
    expect(p.shadowRadius).toBeGreaterThan(SHADOW_RADIUS.realtime);
    expect(p.accumulateFrames).toBe(STUDIO_ACCUMULATE_FRAMES);
    expect(p.adaptiveResolution).toBe(false);
  });
  it('software rasterizers refine fewer frames and keep their shadow map', () => {
    const b = renderBudget('software', false);
    const p = qualityPlan('studio', b, true);
    expect(p.accumulateFrames).toBe(STUDIO_ACCUMULATE_FRAMES_SOFTWARE);
    expect(p.shadowMapCap).toBe(b.shadowMapCap);
  });
  it('falls back to realtime without the post pass (low memory)', () => {
    const b = renderBudget('discrete', true);
    expect(studioAvailable(b)).toBe(false);
    expect(qualityPlan('studio', b).quality).toBe('realtime');
    expect(qualityPlan('studio', b).post).toBeNull();
  });
});

describe('Refinement', () => {
  it('counts refinement frames after a restart and reports progress', () => {
    const r = new Refinement();
    expect(r.next()).toBe(false);
    expect(r.progress).toBe(1);
    r.setFrames(3);
    r.restart();
    expect(r.active).toBe(true);
    expect(r.progress).toBe(0);
    expect([r.next(), r.next(), r.next(), r.next()]).toEqual([true, true, true, false]);
    expect(r.progress).toBe(1);
    r.restart();
    r.next();
    expect(r.progress).toBeCloseTo(1 / 3);
    r.setFrames(0);
    expect(r.next()).toBe(false);
    r.setFrames(Number.NaN);
    r.restart();
    expect(r.active).toBe(false);
  });
});
