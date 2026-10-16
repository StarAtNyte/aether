import { describe, expect, it } from 'vitest';
import { autoTier, degrade, DEGRADE_ORDER, effectsKey, effectsOf, evScale, GRADE_PRESETS, isGradePresetId, isRenderTier, needsPrePass, presetFor, RENDER_TIERS, resolveEffects, stillEffects, whiteBalance, } from '../src/gpu/finishing';
import { gradeFor, gradeWithPreset, NEUTRAL_GRADE } from '../src/gpu/grade';
import { computeSkyState } from '../src/environment/sky-state';
import { dofParams } from '../src/gpu/post';
const count = (e) => Object.values(e).filter(Boolean).length;
describe('tiers', () => {
    it('each tier adds effects to the one below', () => {
        const counts = RENDER_TIERS.map((t) => count(effectsOf(t)));
        expect(counts).toEqual([...counts].sort((a, b) => a - b));
        expect(new Set(counts).size).toBe(counts.length);
    });
    it('low draws directly, medium is one composite pass, high adds AO and temporal AA, ultra the rest', () => {
        expect(effectsOf('low').composite).toBe(false);
        expect(needsPrePass(effectsOf('medium'))).toBe(false);
        expect(effectsOf('medium').composite).toBe(true);
        expect(effectsOf('high').ao && effectsOf('high').taa).toBe(true);
        expect(RENDER_TIERS.some((t) => effectsOf(t).gi)).toBe(false);
        expect(needsPrePass(effectsOf('high'))).toBe(true);
        const u = effectsOf('ultra');
        expect(u.ssr && u.shafts && u.halation && u.aberration).toBe(true);
        expect(u.dof).toBe(false);
    });
    it('stills run the ultra chain; only final adds depth of field', () => {
        expect(stillEffects(false)).toEqual(effectsOf('ultra'));
        expect(stillEffects(true)).toEqual({ ...effectsOf('ultra'), dof: true });
    });
    it('picks the tier from the GPU class: software and low memory low, integrated medium, discrete high', () => {
        expect(autoTier('software', { post: true })).toBe('low');
        expect(autoTier('discrete', { post: false })).toBe('low');
        expect(autoTier('integrated', { post: true })).toBe('medium');
        expect(autoTier('unknown', { post: true })).toBe('medium');
        expect(autoTier('discrete', { post: true })).toBe('high');
    });
    it('validates tier names', () => {
        expect(isRenderTier('ultra')).toBe(true);
        for (const bad of ['final', 'ULTRA', '', null, 3, undefined])
            expect(isRenderTier(bad)).toBe(false);
    });
});
describe('overrides and degradation', () => {
    it('a toggle forces an effect on or off; undefined keeps the tier', () => {
        const base = effectsOf('high');
        expect(resolveEffects(base, { ao: false }).ao).toBe(false);
        expect(resolveEffects(base, { ssr: true }).ssr).toBe(true);
        expect(resolveEffects(base, { ao: undefined })).toEqual(base);
    });
    it('failed effects stay off even when forced on', () => {
        const r = resolveEffects(effectsOf('ultra'), { shafts: true }, new Set(['shafts', 'ssr']));
        expect(r.shafts).toBe(false);
        expect(r.ssr).toBe(false);
        expect(r.ao).toBe(true);
    });
    it('switching the composite off switches the whole chain off', () => {
        expect(count(resolveEffects(effectsOf('ultra'), { composite: false }))).toBe(0);
    });
    it('degrades the costliest effect first until nothing is left', () => {
        let e = effectsOf('ultra');
        const dropped = [];
        for (let step = degrade(e); step; step = degrade(e)) {
            dropped.push(step.dropped);
            e = step.effects;
        }
        expect(dropped).toEqual(DEGRADE_ORDER.filter((k) => effectsOf('ultra')[k]));
        expect(dropped[0]).toBe('shafts');
        expect(e.composite).toBe(true);
        expect(e.ao || e.taa || e.ssr).toBe(false);
    });
    it('effect keys are stable and distinguish sets', () => {
        expect(effectsKey(effectsOf('high'))).toBe(effectsKey({ ...effectsOf('high') }));
        expect(effectsKey(effectsOf('high'))).not.toBe(effectsKey(effectsOf('ultra')));
    });
});
describe('grade presets', () => {
    it('picks the preset that matches the sky', () => {
        const at = (sky) => {
            const s = computeSkyState(sky);
            return presetFor({ elevation: s.elevation, moon: s.moon, sunGlowStrength: s.sunGlowStrength, preset: s.preset });
        };
        expect(at({ sky: 'day', timeOfDay: 12, sunIntensity: 2.5, ambientIntensity: 0.4 })).toBe('archviz-daylight');
        expect(at({ sky: 'sunset', timeOfDay: 17.5, sunIntensity: 2.5, ambientIntensity: 0.4 })).toBe('golden-hour');
        expect(at({ sky: 'dawn', sunIntensity: 2.5, ambientIntensity: 0.4 })).toBe('golden-hour');
        expect(at({ sky: 'night', sunIntensity: 2.5, ambientIntensity: 0.4 })).toBe('night');
        expect(at({ sky: 'overcast', sunIntensity: 2.5, ambientIntensity: 0.4 })).toBe('overcast');
        expect(at({ sky: 'studio', sunIntensity: 2.5, ambientIntensity: 0.4 })).toBe('neutral');
        expect(at({ sky: 'space', sunIntensity: 2.5, ambientIntensity: 0.4 })).toBe('night');
    });
    it('every preset is a sane, frozen look', () => {
        for (const [id, p] of Object.entries(GRADE_PRESETS)) {
            expect(isGradePresetId(id)).toBe(true);
            expect(p.id).toBe(id);
            expect(p.saturation).toBeGreaterThan(0.7);
            expect(p.saturation).toBeLessThan(1.3);
            expect(p.contrast).toBeGreaterThan(0.9);
            expect(p.contrast).toBeLessThan(1.3);
            expect(Math.abs(p.exposureEv)).toBeLessThan(1);
            expect(Math.abs(p.temperature)).toBeLessThanOrEqual(1);
        }
        expect(Object.isFrozen(GRADE_PRESETS)).toBe(true);
        expect(isGradePresetId('nope')).toBe(false);
        expect(isGradePresetId('__proto__')).toBe(false);
        expect(isGradePresetId(undefined)).toBe(false);
    });
    it('white balance preserves luminance and warms / cools in the right direction', () => {
        const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        for (const t of [-1, -0.3, 0, 0.5, 1])
            expect(lum(whiteBalance(t, 0))).toBeCloseTo(1, 6);
        const warm = whiteBalance(0.8, 0);
        expect(warm[0]).toBeGreaterThan(warm[2]);
        const cool = whiteBalance(-0.8, 0);
        expect(cool[2]).toBeGreaterThan(cool[0]);
        expect(whiteBalance(Number.NaN, Number.NaN)).toEqual(whiteBalance(0, 0));
    });
    it('exposure offsets are in stops and clamped', () => {
        expect(evScale(0)).toBe(1);
        expect(evScale(1)).toBe(2);
        expect(evScale(-1)).toBe(0.5);
        expect(evScale(100)).toBe(64);
        expect(evScale(Number.NaN)).toBe(1);
    });
    it('layers a preset on a sky grade without touching its tints', () => {
        const sky = computeSkyState({ sky: 'sunset', timeOfDay: 17.5, sunIntensity: 2.5, ambientIntensity: 0.4 });
        const base = gradeFor(sky);
        const g = gradeWithPreset(base, GRADE_PRESETS['golden-hour']);
        expect(g.shadowTint).toEqual(base.shadowTint);
        expect(g.highlightTint).toEqual(base.highlightTint);
        expect(g.saturation).toBeCloseTo(base.saturation * GRADE_PRESETS['golden-hour'].saturation);
        expect(g.exposure).toBeCloseTo(evScale(GRADE_PRESETS['golden-hour'].exposureEv));
        expect(g.balance?.[0]).toBeGreaterThan(g.balance?.[2] ?? 0);
        const neutral = gradeWithPreset(NEUTRAL_GRADE, GRADE_PRESETS.neutral);
        expect(neutral.exposure).toBe(1);
        expect(neutral.saturation).toBe(1);
    });
});
describe('depth of field', () => {
    it('derives a focal range from the focus distance and survives bad input', () => {
        const near = dofParams(4);
        const far = dofParams(40);
        expect(far.range).toBeGreaterThan(near.range);
        expect(near.focus).toBe(4);
        for (const d of [Number.NaN, -5, 0, Number.POSITIVE_INFINITY]) {
            const p = dofParams(d);
            expect(Number.isFinite(p.focus) && Number.isFinite(p.range) && Number.isFinite(p.bokeh)).toBe(true);
            expect(p.focus).toBeGreaterThan(0);
        }
    });
});
