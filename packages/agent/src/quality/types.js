/** Rubric criteria, in display order. */
export const QUALITY_CRITERIA = ['composition', 'materials', 'lighting', 'scale', 'detail', 'coherence', 'physical'];
/** Weight of each criterion in the overall score (sum = 1). */
export const QUALITY_WEIGHTS = Object.freeze({
    composition: 0.17,
    materials: 0.13,
    lighting: 0.13,
    scale: 0.12,
    detail: 0.15,
    coherence: 0.17,
    physical: 0.13,
});
/** Below this overall score a refinement round is worth spending. */
export const QUALITY_THRESHOLD = 72;
/** Human-readable labels. */
export const QUALITY_LABELS = Object.freeze({
    composition: 'Composition',
    materials: 'Materials & colour',
    lighting: 'Lighting & mood',
    scale: 'Scale & proportion',
    detail: 'Detail density',
    coherence: 'Matches the prompt',
    physical: 'Physical validity',
});
/** The written rubric (also the critic model's instructions). */
export const QUALITY_RUBRIC = [
    'Score each criterion from 0 (broken) to 10 (excellent, art-directed):',
    '- composition: a clear focal point, readable silhouette, content well framed and balanced in the four views (not tiny, not cropped, not scattered randomly).',
    '- materials: fitting material presets and a harmonious palette (analogous or complementary hues, a few accents; not all grey, not a clashing rainbow).',
    '- lighting: sky, time of day, fog and lights create a mood that fits the prompt; enough contrast; night scenes have light sources.',
    '- scale: objects have believable real-world sizes relative to each other and to a 1.7 m person; nothing absurdly huge or tiny.',
    '- detail: enough props, vegetation and variation to feel built-in; not empty, not cluttered.',
    '- coherence: every important noun, mood and mechanic of the prompt is visibly present.',
    '- physical: objects rest on surfaces, do not interpenetrate, nothing floats unless it should; verification passes.',
].join('\n');
/** Overall score from criteria (0–100, rounded). */
export function weightedScore(criteria) {
    let s = 0;
    for (const c of QUALITY_CRITERIA)
        s += QUALITY_WEIGHTS[c] * clamp10(criteria[c].score);
    return Math.round(s * 10);
}
/** Clamp to [0, 10] with one decimal. */
export function clamp10(v) {
    if (!Number.isFinite(v))
        return 0;
    return Math.round(Math.max(0, Math.min(10, v)) * 10) / 10;
}
