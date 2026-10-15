/**
 * Pieces of the review-and-fix loop that do not need a model: stall
 * detection, choosing which rooms to look at, and the text of a review turn.
 */
import { hasOwn, type EntityId, type WorldDoc } from '@aether/core';
import { findingKey, findingsText, legendText, markIndex, projectMarks, readScene, reviewFindings, reviewPoses, scoreFindings, buildingIdsOf, type Finding, type ReviewPose } from '@aether/arch';
import type { ReviewViewRequest } from './types';

/** Image aspect the review views are projected for. */
export const REVIEW_ASPECT = 1.5;
/** Largest number of images in one round. */
export const MAX_REVIEW_VIEWS = 8;

/** What one round showed, for stall detection. */
export interface RoundObservation {
  /** Identities of the findings still open at the start of the round. */
  keys: ReadonlySet<string>;
  score: number;
  /** The model changed the world during the round. */
  edited: boolean;
}

/** Verdict of the stall detector. */
export type StallVerdict = { stalled: false } | { stalled: true; reason: string };

/**
 * Detects a loop that is going nowhere: the same findings for several rounds
 * in a row, no better score over several rounds, or endless cosmetic edits on
 * a building the checker has nothing left to say about.
 */
export class StallTracker {
  private readonly limit: number;
  private prevKeys: string | null = null;
  private same = 0;
  private best = -1;
  private noGain = 0;
  private cleanEdits = 0;

  constructor(stallRounds = 3) {
    this.limit = Math.max(2, Math.min(20, Math.floor(stallRounds)));
  }

  /** Record one finished round. */
  observe(o: RoundObservation): StallVerdict {
    const k = [...o.keys].sort().join('|');
    this.same = k === this.prevKeys && k.length > 0 ? this.same + 1 : 0;
    this.prevKeys = k;
    if (o.score > this.best) {
      this.best = o.score;
      this.noGain = 0;
    } else this.noGain += 1;
    this.cleanEdits = o.keys.size === 0 && o.edited ? this.cleanEdits + 1 : 0;
    if (this.same + 1 >= this.limit) return { stalled: true, reason: `the same ${o.keys.size} finding${o.keys.size === 1 ? '' : 's'} came back ${this.same + 1} rounds in a row` };
    if (this.noGain >= this.limit + 1) return { stalled: true, reason: `no better result in the last ${this.noGain} rounds` };
    if (this.cleanEdits >= this.limit * 2) return { stalled: true, reason: 'the checks are clean and further changes are only cosmetic' };
    return { stalled: false };
  }
}

/** Plan ids of the rooms worth looking at: those with findings, those the run touched, else the first few. */
export function focusRooms(world: WorldDoc, building: EntityId, findings: readonly Finding[], before: WorldDoc | null): string[] {
  const scene = readScene(world, building);
  if (!scene) return [];
  const keys: string[] = [];
  const add = (k: string | undefined): void => {
    if (k && !keys.includes(k) && scene.rooms.some((r) => r.key === k)) keys.push(k);
  };
  for (const f of findings) add(f.room);
  if (before) {
    for (const it of scene.items) {
      const old = hasOwn(before.entities, it.id) ? before.entities[it.id] : undefined;
      if (old !== world.entities[it.id]) add(scene.rooms.find((r) => r.id === it.room)?.key);
    }
  }
  if (keys.length === 0) for (const r of scene.rooms.slice(0, 3)) add(r.key);
  return keys.slice(0, 4);
}

/** Everything of one review round that is computed without a model. */
export interface ReviewSnapshot {
  buildings: EntityId[];
  findings: Finding[];
  score: number;
  keys: Set<string>;
  /** Views to render (empty when there is no building). */
  views: ReviewViewRequest[];
  /** Number → fact lines for the marks that appear in the views. */
  legend: string;
}

/** Check the buildings of `world` and plan the views of a round. */
export function snapshotForReview(world: WorldDoc, before: WorldDoc | null, opts: { maxViews: number; withViews: boolean }): ReviewSnapshot {
  const buildings = buildingIdsOf(world);
  const findings: Finding[] = [];
  for (const b of buildings.slice(0, 4)) findings.push(...reviewFindings(world, b));
  const worst = buildings.slice(0, 4).sort((a, b) => countFor(findings, world, b) - countFor(findings, world, a))[0];
  const views: ReviewViewRequest[] = [];
  let legend = '';
  if (opts.withViews && worst) {
    const poses = reviewPoses(world, worst, { rooms: focusRooms(world, worst, findings, before), maxViews: Math.min(MAX_REVIEW_VIEWS, opts.maxViews), aspect: REVIEW_ASPECT });
    const shown = new Set<number>();
    for (const p of poses) {
      const marks = projectMarks(world, worst, p, REVIEW_ASPECT);
      for (const m of marks) shown.add(m.n);
      views.push(toRequest(p, marks));
    }
    legend = legendText(markIndex(world, worst), shown);
  }
  return { buildings, findings, score: scoreFindings(findings), keys: new Set(findings.map(findingKey)), views, legend };
}

function countFor(findings: readonly Finding[], _world: WorldDoc, building: EntityId): number {
  return findings.filter((f) => f.entities.some((e) => e.startsWith(`${building}-`))).length;
}

function toRequest(p: ReviewPose, marks: ReviewViewRequest['marks']): ReviewViewRequest {
  return { name: p.name, label: p.label, kind: p.kind, pose: { position: p.position, target: p.target, up: p.up, fov: p.fov }, hideTops: p.hideTops, aspect: REVIEW_ASPECT, marks };
}

/** The text of a review turn (the images are attached by the caller, each labelled). */
export function reviewTurnText(round: number, snap: ReviewSnapshot, opts: { hasImages: boolean; lastEdited: boolean }): string {
  const errors = snap.findings.filter((f) => f.severity === 'error').length;
  const lines = [
    `REVIEW round ${round}. ${opts.lastEdited ? 'You changed the building; this is how it looks now.' : 'Look at the building as a critical designer before it is shown to the user.'}`,
    `The checker measured it: score ${snap.score}/100, ${snap.findings.length} finding${snap.findings.length === 1 ? '' : 's'}${errors > 0 ? ` (${errors} error${errors === 1 ? '' : 's'})` : ''}.`,
    findingsText(snap.findings, 30),
  ];
  if (opts.hasImages) lines.push(`Numbers drawn on the images are pieces of the building. Use them to say exactly what you mean:\n${snap.legend}`);
  lines.push(
    'Fix every real error and warning with edit_items / place_items (measure first with query_scene; make the smallest change that works; never rebuild a room to move one piece). Judge what the checker cannot: scale and proportion, clutter or emptiness, furniture facing the right way, pieces floating or crossing walls, style and colour consistency, lighting, whether a person could live here. If a finding is a false alarm, say why in your final message.',
    'When the building is right, call finish with one sentence on what you checked and fixed. Do not call finish while a real error remains.',
  );
  return lines.join('\n');
}
