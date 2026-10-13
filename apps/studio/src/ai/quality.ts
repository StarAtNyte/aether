/**
 * Studio side of the 3D quality loop: render four views, measure them
 * (downscaled pixel statistics), score the world with the deterministic
 * rubric and — when a vision-capable model is connected and refinement is
 * enabled — blend in the model's critique.
 */
import { assessWorld, blendCritique, buildCriticRequest, QUALITY_CRITERIA, QUALITY_LABELS, viewStatsFromPixels, type Provider, type QualityReport, type ViewStats } from '@aether/agent';
import type { WorldDoc } from '@aether/core';
import type { Simulation } from '../engine/Simulation';
import { clip } from '../lib/format';
import type { ChatEventView } from '../lib/chat';
import { createLogger } from '../lib/log';

const log = createLogger('quality');
/** Downscale for pixel statistics (cheap: 64×64 × 4 views). */
const STATS_SIZE = 64;
/** Rendered view size sent to the critic (small: headless calls are slow). */
export const VIEW_SIZE = 384;

/** Decode a data URL and compute its statistics (null when the browser cannot). */
export async function statsOfImage(dataUrl: string): Promise<ViewStats | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob, { resizeWidth: STATS_SIZE, resizeHeight: STATS_SIZE, resizeQuality: 'medium' });
    const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(STATS_SIZE, STATS_SIZE) : Object.assign(document.createElement('canvas'), { width: STATS_SIZE, height: STATS_SIZE });
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, STATS_SIZE, STATS_SIZE);
    bitmap.close();
    const data = ctx.getImageData(0, 0, STATS_SIZE, STATS_SIZE).data;
    return viewStatsFromPixels(data, STATS_SIZE, STATS_SIZE);
  } catch (err) {
    log.warn('view statistics unavailable', err);
    return null;
  }
}

/** Inputs of one assessment. */
export interface QualityPassInput {
  world: WorldDoc;
  prompt: string;
  sim: Simulation | null;
  verifyPassed?: boolean;
  diagnostics?: ReadonlyArray<{ code: string; entities: readonly string[] }>;
  /** Vision critic (null: heuristics only). */
  critic: Provider | null;
  signal?: AbortSignal;
}

/** Score the world; the critic's failure never fails the pass. */
export async function runQualityPass(input: QualityPassInput): Promise<QualityReport> {
  const views = input.sim ? await input.sim.renderViews(VIEW_SIZE) : [];
  const stats: ViewStats[] = [];
  for (const v of views) {
    const s = await statsOfImage(v);
    if (s) stats.push(s);
  }
  const sim = input.sim;
  const heuristic = assessWorld({
    world: input.world,
    prompt: input.prompt,
    ...(sim ? { bounds: (id: string) => sim.entityBounds(id) } : {}),
    ...(stats.length > 0 ? { views: stats } : {}),
    ...(input.verifyPassed !== undefined ? { verifyPassed: input.verifyPassed } : {}),
    ...(input.diagnostics ? { diagnostics: input.diagnostics } : {}),
  });
  if (!input.critic || views.length === 0 || input.signal?.aborted) return heuristic;
  try {
    const res = await input.critic.complete(buildCriticRequest(input.prompt, heuristic, views), input.signal);
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    return blendCritique(heuristic, text);
  } catch (err) {
    log.warn('critic unavailable; using heuristics', err);
    return heuristic;
  }
}

/** Chat view of a quality report (round 0 = first assessment). */
export function toQualityView(report: QualityReport, round: number, applied: readonly string[] = []): Extract<ChatEventView, { type: 'quality' }> {
  return {
    type: 'quality',
    score: report.score,
    round,
    source: report.source,
    summary: clip(report.summary, 300),
    criteria: QUALITY_CRITERIA.map((c) => ({ id: c, label: QUALITY_LABELS[c], score: report.criteria[c].score, note: clip(report.criteria[c].notes[0] ?? '', 200) })),
    applied: applied.slice(0, 8).map((a) => clip(a, 160)),
  };
}

