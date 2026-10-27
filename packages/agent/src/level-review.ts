/**
 * The level side of the review loop. For a game or outdoor level the assistant's checker is the level tools:
 * `query_level` op "review" measures reach, the win condition, the spawn and the pacing, and names the
 * cameras of the renders to look at (an overview, the player's first view, the worst problem up close).
 * This module turns that answer into the same snapshot the building review uses, so the loop, the stall
 * detector and the events stay one thing.
 */
import { NARROW_CLAIM } from './claims';
import { z } from 'zod';
import type { WorldDoc } from '@aether/core';
import { findingKey, scoreFindings, type Finding } from '@aether/arch';
import { REVIEW_ASPECT, type ReviewSnapshot } from './review';
import type { LevelToolRunner, ReviewViewRequest } from './types';

const Num = z.number().finite().min(-100_000).max(100_000);
const Vec3 = z.tuple([Num, Num, Num]);

/** The structured answer of `query_level` op "review" (untrusted: validated before use). */
export const LevelReviewData = z.object({
  applicable: z.boolean(),
  score: z.number().finite().min(0).max(100),
  findings: z
    .array(
      z.object({
        code: z.string().min(1).max(40),
        severity: z.enum(['error', 'warning', 'info']),
        message: z.string().max(700),
        entities: z.array(z.string().max(80)).max(20),
        fix: z.string().max(500),
        at: Vec3.optional(),
      }),
    )
    .max(60),
  poses: z.array(z.object({ name: z.string().min(1).max(40), label: z.string().max(160), position: Vec3, target: Vec3, fov: z.number().finite().min(20).max(110) })).max(8),
});

/** Sentinel in `ReviewSnapshot.buildings` that marks a level (not a building) review. */
export const LEVEL_SUBJECT = 'level';

/**
 * Check the level of `world` with the host's level tools and plan the renders of a round. Null when the tools
 * are unavailable, answer something unusable, or the world has no gameplay to review.
 */
export async function levelSnapshot(run: LevelToolRunner, world: WorldDoc, opts: { maxViews: number; withViews: boolean }): Promise<ReviewSnapshot | null> {
  let out: Awaited<ReturnType<LevelToolRunner>>;
  try {
    out = await run(world, 'query_level', { op: 'review' });
  } catch {
    return null;
  }
  const parsed = LevelReviewData.safeParse(out.data);
  if (!parsed.success || !parsed.data.applicable) return null;
  const data = parsed.data;
  const findings: Finding[] = data.findings
    .filter((f) => f.severity !== 'info')
    .map((f) => ({ code: f.code, severity: f.severity === 'error' ? 'error' : 'warning', message: f.message, entities: f.entities, fix: f.fix }) as Finding);
  const views: ReviewViewRequest[] = opts.withViews
    ? data.poses.slice(0, opts.maxViews).map((p) => ({ name: p.name, label: p.label, kind: 'corner' as const, pose: { position: p.position, target: p.target, up: [0, 1, 0] as [number, number, number], fov: p.fov }, hideTops: false, aspect: REVIEW_ASPECT, marks: [] }))
    : [];
  return { buildings: [LEVEL_SUBJECT], findings, score: findings.length === 0 ? 100 : scoreFindings(findings), keys: new Set(findings.map(findingKey)), views, legend: '', advice: '' };
}

/** The text of a level review turn (the images are attached by the caller, each labelled). */
export function levelTurnText(round: number, snap: ReviewSnapshot, opts: { hasImages: boolean; lastEdited: boolean }): string {
  const errors = snap.findings.filter((f) => f.severity === 'error').length;
  const lines = [
    `LEVEL REVIEW round ${round}. ${opts.lastEdited ? 'You changed the level; this is how it measures now.' : 'Look at the level as a critical level designer before it is shown to the player.'}`,
    `The level tools measured it (advisory data, not a verdict on how it plays or looks): ${snap.findings.length} finding${snap.findings.length === 1 ? '' : 's'}${errors > 0 ? ` (${errors} error${errors === 1 ? '' : 's'}: unreachable or broken, which does need fixing)` : ''}. Whether it is good enough is your call.`,
    ...snap.findings.slice(0, 30).map((f) => `- [${f.severity}] ${f.message} Fix: ${f.fix}`),
  ];
  if (snap.findings.length === 0) lines.push('No measured problems.');
  if (opts.hasImages) lines.push('The images are the level from above, the first view the player gets and, when there is a problem, a close look at it.');
  lines.push(
    'Fix every real error and warning with place_level_items (move an item with {id,x,z}: it is snapped to the ground and re-measured) or apply_patches for terrain, platforms, ramps and lifts; check with query_level objectives. Assess what the measurements cannot from the images: pacing, a landmark the player can see from the spawn, long empty stretches, whether the terrain, vegetation, water and light look believable and consistent. Make the smallest change that works.',
    'If the light, colour, fog or mood in the images reads wrong for the setting, set the look with tune_look (exposure, white balance, fog, light and foliage tints). When YOU judge the level right, call finish with a short statement of what you checked and fixed. Do not call finish while a measured error remains.',
    NARROW_CLAIM,
  );
  return lines.join('\n');
}
