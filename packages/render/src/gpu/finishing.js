/** Every tier, cheapest first. */
export const RENDER_TIERS = Object.freeze(['low', 'medium', 'high', 'ultra']);
/** The effect keys, in the order they degrade when one fails (first dropped first). */
export const DEGRADE_ORDER = Object.freeze(['dof', 'gi', 'shafts', 'ssr', 'halation', 'aberration', 'taa', 'ao']);
/** Effects that need the normal / velocity pre-pass. */
export function needsPrePass(e) {
    return e.ao || e.gi || e.taa || e.ssr || e.shafts || e.dof;
}
const NONE = Object.freeze({ composite: false, ao: false, gi: false, taa: false, ssr: false, shafts: false, halation: false, aberration: false, grain: false, dof: false });
/** The effects of a tier. */
export function effectsOf(tier) {
    switch (tier) {
        case 'low':
            return NONE;
        case 'medium':
            return { ...NONE, composite: true, grain: true };
        case 'high':
            return { ...NONE, composite: true, ao: true, taa: true, grain: true };
        case 'ultra':
            return { ...NONE, composite: true, ao: true, taa: true, ssr: true, shafts: true, halation: true, aberration: true, grain: true };
    }
}
/** Effects of a still (studio / final): the ultra chain, plus depth of field for final. */
export function stillEffects(final) {
    return { ...effectsOf('ultra'), dof: final };
}
/**
 * The tier a GPU budget affords by default. Software rasterisers and low-memory mode get `low`;
 * integrated and unknown GPUs `medium` (one cheap composite pass); discrete GPUs `high`.
 * `ultra` is always an explicit choice.
 */
export function autoTier(gpu, budget) {
    if (!budget.post || gpu === 'software')
        return 'low';
    if (gpu === 'discrete')
        return 'high';
    return 'medium';
}
/** True when `value` names a tier. */
export function isRenderTier(value) {
    return typeof value === 'string' && RENDER_TIERS.includes(value);
}
/**
 * Apply user toggles and the effects that failed on this device. Dependencies are kept coherent:
 * temporal AA, reflections, shafts and depth of field cannot run without the composite pass, so
 * switching `composite` off switches the whole chain off; AO and the others stay independent.
 */
export function resolveEffects(base, overrides = {}, failed = new Set()) {
    const out = { ...base };
    for (const key of Object.keys(out)) {
        const forced = overrides[key];
        if (typeof forced === 'boolean')
            out[key] = forced;
        if (failed.has(key))
            out[key] = false;
    }
    if (!out.composite)
        return { ...NONE };
    return out;
}
/** The next effect to drop when the chain fails to build or draw (null: nothing left to drop). */
export function degrade(effects) {
    for (const key of DEGRADE_ORDER) {
        if (effects[key])
            return { effects: { ...effects, [key]: false }, dropped: key };
    }
    return null;
}
/** Stable key of an effect set (a pipeline is rebuilt when it changes). */
export function effectsKey(e) {
    return Object.keys(NONE).map((k) => (e[k] ? '1' : '0')).join('');
}
/** The preset table. Frozen. */
export const GRADE_PRESETS = Object.freeze({
    'archviz-daylight': { id: 'archviz-daylight', tone: 'agx', exposureEv: 0.15, saturation: 1.04, contrast: 1.08, temperature: 0.04, tint: 0, grain: 1, bloom: 0.85 },
    'golden-hour': { id: 'golden-hour', tone: 'agx', exposureEv: 0.1, saturation: 1.08, contrast: 1.1, temperature: 0.2, tint: 0.02, grain: 1, bloom: 1.1 },
    'dusk-interior': { id: 'dusk-interior', tone: 'agx', exposureEv: 0.25, saturation: 1.02, contrast: 1.12, temperature: 0.1, tint: -0.02, grain: 1.2, bloom: 1.25 },
    overcast: { id: 'overcast', tone: 'agx', exposureEv: 0.2, saturation: 0.96, contrast: 1.04, temperature: -0.06, tint: 0, grain: 1, bloom: 0.7 },
    night: { id: 'night', tone: 'agx', exposureEv: 0.35, saturation: 0.9, contrast: 1.1, temperature: -0.12, tint: 0, grain: 1.5, bloom: 1.3 },
    neutral: { id: 'neutral', tone: 'aces', exposureEv: 0, saturation: 1, contrast: 1, temperature: 0, tint: 0, grain: 0.6, bloom: 1 },
});
/** True when `value` names a preset. */
export function isGradePresetId(value) {
    return typeof value === 'string' && Object.hasOwn(GRADE_PRESETS, value);
}
/** The preset that matches the sky: night, golden hour, overcast or clear daylight. */
export function presetFor(sky) {
    if (sky.preset === 'studio')
        return 'neutral';
    if (sky.moon || sky.elevation < -2 || sky.preset === 'space')
        return 'night';
    if (sky.preset === 'overcast')
        return 'overcast';
    if (sky.sunGlowStrength > 0.45 || sky.elevation < 9)
        return 'golden-hour';
    return 'archviz-daylight';
}
/** Linear white-balance multipliers of a temperature / tint pair (luminance preserving, subtle). */
export function whiteBalance(temperature, tint) {
    const t = Math.max(-1, Math.min(1, Number.isFinite(temperature) ? temperature : 0));
    const g = Math.max(-1, Math.min(1, Number.isFinite(tint) ? tint : 0));
    const r = 1 + 0.16 * t;
    const b = 1 - 0.2 * t;
    const gr = 1 + 0.1 * g;
    const l = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
    return [r / l, gr / l, b / l];
}
/** Exposure multiplier of `ev` stops. */
export function evScale(ev) {
    return 2 ** (Number.isFinite(ev) ? Math.max(-6, Math.min(6, ev)) : 0);
}
/** Grain amplitude (linear display units) of the chain, scaled by the preset. */
export const GRAIN_AMPLITUDE = 0.012;
/** Chromatic aberration strength at the frame corner (UV units; well under a pixel at 1080p). */
export const ABERRATION_STRENGTH = 0.0016;
