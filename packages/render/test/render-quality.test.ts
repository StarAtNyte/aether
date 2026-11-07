import { describe, expect, it } from 'vitest';
import {
  FINAL_ACCUMULATE_FRAMES,
  FINAL_ACCUMULATE_FRAMES_SOFTWARE,
  postQualityOf,
  qualityPlan,
  Refinement,
  SHADOW_RADIUS,
  STUDIO_ACCUMULATE_FRAMES,
  STUDIO_ACCUMULATE_FRAMES_SOFTWARE,
  STUDIO_SHADOW_MAP_MAX,
  studioAvailable,
  TIER_ACCUMULATE_FRAMES,
  TIER_SHADOW_RADIUS,
} from '../src/gpu/render-quality';
import { effectsOf } from '../src/gpu/finishing';
import { renderBudget } from '../src/gpu/budget';

describe('qualityPlan', () => {
  it('realtime follows the budget and keeps adaptive resolution', () => {
    const b = renderBudget('discrete', false);
    const p = qualityPlan('realtime', b);
    expect(p).toEqual({
      quality: 'realtime',
      tier: 'medium',
      programTier: 'medium',
      effects: effectsOf('medium'),
      post: 'standard',
      shadowMapCap: b.shadowMapCap,
      shadowRadius: SHADOW_RADIUS.realtime,
      accumulateFrames: 0,
      adaptiveResolution: true,
      moveEffects: null,
      shadowTier: 'medium',
      shadowStill: false,
    });
  });
  it('the tier picks the effect set, the pipeline variant and the refinement of the realtime look', () => {
    const b = renderBudget('discrete', false);
    const low = qualityPlan('realtime', b, false, 'low');
    expect(low.post).toBeNull();
    expect(low.effects.composite).toBe(false);
    const high = qualityPlan('realtime', b, false, 'high');
    expect(high.post).toBe('studio');
    expect(high.effects.ao && !high.effects.taa && !high.effects.grain).toBe(true);
    expect(high.accumulateFrames).toBe(TIER_ACCUMULATE_FRAMES);
    expect(high.shadowRadius).toBe(TIER_SHADOW_RADIUS);
    expect(high.adaptiveResolution).toBe(true);
    const ultra = qualityPlan('realtime', b, false, 'ultra');
    expect(ultra.effects.ssr && ultra.effects.shafts && ultra.effects.halation).toBe(true);
    expect(ultra.effects.dof).toBe(false);
  });
  it("the ladder's cap lowers the tier's cost and keeps the programs of the tier asked for", () => {
    const b = renderBudget('integrated', false);
    const medium = qualityPlan('realtime', b, false, 'medium');
    const capped = qualityPlan('realtime', b, false, 'medium', { ladderCap: 'low' });
    expect(capped.tier).toBe('low');
    expect(capped.programTier).toBe('medium');
    // The scene pass keeps its output (the composite), so no material changes; the shadow technique and radius stay.
    expect(capped.effects).toEqual(medium.effects);
    expect(capped.post).toBe(medium.post);
    expect(capped.shadowTier).toBe(medium.shadowTier);
    expect(capped.shadowRadius).toBe(medium.shadowRadius);
    // From high the lower tier's post passes go (ambient occlusion, contact shadows); the composite stays.
    const high = qualityPlan('realtime', b, false, 'high', { ladderCap: 'low' });
    expect(high.tier).toBe('low');
    expect(high.programTier).toBe('high');
    expect(high.effects).toEqual({ ...effectsOf('low'), composite: true });
    expect(high.shadowRadius).toBe(TIER_SHADOW_RADIUS);
    // A cap at or above the tier changes nothing.
    expect(qualityPlan('realtime', b, false, 'medium', { ladderCap: 'high' })).toEqual(medium);
    expect(medium.programTier).toBe('medium');
  });
  it('software rasterizers default to the low tier', () => {
    expect(qualityPlan('realtime', renderBudget('software', false), true).tier).toBe('low');
  });
  it('studio asks for the ultra chain, bigger softer shadows and refinement frames', () => {
    const b = renderBudget('integrated', false);
    const p = qualityPlan('studio', b);
    expect(p.quality).toBe('studio');
    expect(p.post).toBe('studio');
    expect(p.tier).toBe('ultra');
    expect(p.effects.ssr).toBe(true);
    expect(p.effects.dof).toBe(false);
    expect(p.shadowMapCap).toBe(Math.min(STUDIO_SHADOW_MAP_MAX, b.shadowMapCap * 2));
    expect(p.shadowRadius).toBeGreaterThan(SHADOW_RADIUS.realtime);
    expect(p.accumulateFrames).toBe(STUDIO_ACCUMULATE_FRAMES);
    expect(p.adaptiveResolution).toBe(false);
  });
  it('retains studio lighting in motion while adapting resolution and keeping medium shadows', () => {
    const b = renderBudget('integrated', false);
    const p = qualityPlan('studio', b, false, undefined, { split: true });
    expect(p.effects.ssr && p.effects.ao && p.effects.taa).toBe(true);
    expect(p.moveEffects).toEqual(p.effects);
    expect(p.shadowMapCap).toBe(b.shadowMapCap);
    expect(p.shadowTier).toBe('medium');
    expect(p.shadowStill).toBe(false);
    expect(p.adaptiveResolution).toBe(true);
    const capped = qualityPlan('studio', b, false, undefined, { split: true, tierCap: 'medium' });
    expect(capped.effects).toEqual(effectsOf('medium'));
    expect(qualityPlan('final', b, false, undefined, { split: true }).moveEffects).toBeNull();
    expect(qualityPlan('studio', b, true, undefined, { split: true }).moveEffects).toBeNull();
  });
  it('final adds depth of field and refines much longer', () => {
    const b = renderBudget('discrete', false);
    const p = qualityPlan('final', b);
    expect(p.quality).toBe('final');
    expect(p.effects.dof).toBe(true);
    expect(p.accumulateFrames).toBe(FINAL_ACCUMULATE_FRAMES);
    expect(p.accumulateFrames).toBeGreaterThan(STUDIO_ACCUMULATE_FRAMES);
    expect(qualityPlan('final', renderBudget('software', false), true).accumulateFrames).toBe(FINAL_ACCUMULATE_FRAMES_SOFTWARE);
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
    for (const q of ['studio', 'final'] as const) {
      expect(qualityPlan(q, b).quality).toBe('realtime');
      expect(qualityPlan(q, b).post).toBeNull();
      expect(qualityPlan(q, b).tier).toBe('low');
    }
  });
  it('maps an effect set to its pipeline variant', () => {
    expect(postQualityOf(effectsOf('low'))).toBeNull();
    expect(postQualityOf(effectsOf('medium'))).toBe('standard');
    expect(postQualityOf(effectsOf('high'))).toBe('studio');
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
