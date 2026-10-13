/**
 * The 3D quality rubric shared by the deterministic heuristics, the vision
 * critic and the UI: seven criteria scored 0–10, weighted into a 0–100 score.
 */
import type { EntityId, WorldDoc } from '@aether/core';

/** Rubric criteria, in display order. */
export const QUALITY_CRITERIA = ['composition', 'materials', 'lighting', 'scale', 'detail', 'coherence', 'physical'] as const;
/** One rubric criterion. */
export type QualityCriterion = (typeof QUALITY_CRITERIA)[number];

/** Weight of each criterion in the overall score (sum = 1). */
export const QUALITY_WEIGHTS: Readonly<Record<QualityCriterion, number>> = Object.freeze({
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
export const QUALITY_LABELS: Readonly<Record<QualityCriterion, string>> = Object.freeze({
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

/** Score of one criterion. */
export interface CriterionScore {
  /** 0–10. */
  score: number;
  /** Short observations (most important first). */
  notes: string[];
}

/** Deterministic fixes the offline refiner can apply. */
export type QualityFix = 'ground' | 'separate' | 'densify' | 'light-night' | 'golden-hour' | 'palette';

/** A concrete problem found by the assessment. */
export interface QualityIssue {
  criterion: QualityCriterion;
  severity: 'minor' | 'major';
  message: string;
  entities?: EntityId[];
  fix?: QualityFix;
}

/** Outcome of a quality assessment. */
export interface QualityReport {
  /** 0–100 weighted score. */
  score: number;
  criteria: Record<QualityCriterion, CriterionScore>;
  issues: QualityIssue[];
  /** Who scored it. */
  source: 'heuristic' | 'critic' | 'blend';
  /** One-sentence summary. */
  summary: string;
}

/** Statistics of one rendered view (computed by the host from pixels). */
export interface ViewStats {
  /** Fraction of pixels that are content (not sky/background), 0–1. */
  coverage: number;
  /** Fraction of strong-gradient pixels (silhouette/detail complexity), 0–1. */
  edgeDensity: number;
  /** Mean luminance, 0–1. */
  luminance: number;
  /** Luminance standard deviation (contrast), 0–0.5. */
  contrast: number;
  /** Mean colourfulness (Hasler–Süsstrunk, scaled 0–1). */
  colorfulness: number;
}

/** An axis-aligned box in world space. */
export interface Bounds3 {
  min: [number, number, number];
  max: [number, number, number];
}

/** Input of {@link import('./heuristics').assessWorld}. */
export interface QualityInput {
  world: WorldDoc;
  /** The user's request (coherence). */
  prompt: string;
  /** World-space bounds from the renderer (better than the built-in estimate). */
  bounds?: (id: EntityId) => Bounds3 | null;
  /** Statistics of rendered views (top, front, side, iso). */
  views?: readonly ViewStats[];
  /** Result of the last physics verification, when known. */
  verifyPassed?: boolean;
  /** Physics diagnostics from the last verification. */
  diagnostics?: ReadonlyArray<{ code: string; entities: readonly string[] }>;
}

/** Overall score from criteria (0–100, rounded). */
export function weightedScore(criteria: Record<QualityCriterion, CriterionScore>): number {
  let s = 0;
  for (const c of QUALITY_CRITERIA) s += QUALITY_WEIGHTS[c] * clamp10(criteria[c].score);
  return Math.round(s * 10);
}

/** Clamp to [0, 10] with one decimal. */
export function clamp10(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(Math.max(0, Math.min(10, v)) * 10) / 10;
}
