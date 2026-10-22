/**
 * Pieces of the review-and-fix loop that do not need a model: stall
 * detection, choosing which rooms to look at, and the text of a review turn.
 */
import { bodilessPeople, hasOwn, type EntityId, type WorldDoc } from '@aether/core';
import { findingKey, findingsText, legendText, markIndex, projectMarks, projectOverlays, roomAdvice, readScene, reviewFindings, reviewPoses, scoreFindings, buildingIdsOf, type Finding, type ReviewPose } from '@aether/arch';
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
  /** Advisory circulation evidence (door swings, approach zones, walking paths, clutter) of the rooms in focus, as text. */
  advice: string;
}

/** Check the buildings of `world` and plan the views of a round. */
export function snapshotForReview(world: WorldDoc, before: WorldDoc | null, opts: { maxViews: number; withViews: boolean }): ReviewSnapshot {
  const buildings = buildingIdsOf(world);
  const findings: Finding[] = [];
  for (const b of buildings.slice(0, 4)) findings.push(...reviewFindings(world, b));
  const bodiless = bodilessPeople(world);
  if (bodiless.length > 0) {
    findings.push({
      code: 'person-without-character',
      severity: 'warning',
      message: `${bodiless.length} ${bodiless.length === 1 ? 'entity stands' : 'entities stand'} for people but ${bodiless.length === 1 ? 'has' : 'have'} no character, so ${bodiless.length === 1 ? 'it shows' : 'they show'} as a capsule or box: ${bodiless.slice(0, 6).join(', ')}.`,
      entities: bodiless.slice(0, 12),
      fix: 'Update each with character {wardrobe, gender?, age?} (a rigged, animated person replaces the shape; the shape stays the collider).',
    });
  }
  const worst = buildings.slice(0, 4).sort((a, b) => countFor(findings, world, b) - countFor(findings, world, a))[0];
  const views: ReviewViewRequest[] = [];
  let legend = '';
  let advice = '';
  if (opts.withViews && worst) {
    const poses = reviewPoses(world, worst, { rooms: focusRooms(world, worst, findings, before), maxViews: Math.min(MAX_REVIEW_VIEWS, opts.maxViews), aspect: REVIEW_ASPECT });
    const shown = new Set<number>();
    for (const p of poses) {
      const marks = projectMarks(world, worst, p, REVIEW_ASPECT);
      for (const m of marks) shown.add(m.n);
      const req = toRequest(p, marks);
      if (p.kind === 'plan') {
        const ov = planOverlays(world, worst, p);
        if (ov.length > 0) req.overlays = ov;
      }
      views.push(req);
    }
    advice = adviceText(world, worst, focusRooms(world, worst, findings, before));
    legend = legendText(markIndex(world, worst), shown);
  }
  return { buildings, findings, score: scoreFindings(findings), keys: new Set(findings.map(findingKey)), views, legend, advice };
}

/** Door swings, approach zones and walking paths of every room of the plan's level, projected onto the plan image (advisory). */
function planOverlays(world: WorldDoc, building: EntityId, pose: ReviewPose): NonNullable<ReviewViewRequest['overlays']> {
  const scene = readScene(world, building);
  if (!scene) return [];
  const out: NonNullable<ReviewViewRequest['overlays']> = [];
  for (const room of scene.rooms) out.push(...projectOverlays(world, building, pose, roomAdvice(scene, room).overlays, room.levelId, REVIEW_ASPECT));
  return out;
}

function adviceText(world: WorldDoc, building: EntityId, rooms: readonly string[]): string {
  const scene = readScene(world, building);
  if (!scene) return '';
  const out: string[] = [];
  for (const r of scene.rooms.filter((x) => rooms.includes(x.key))) {
    const a = roomAdvice(scene, r).lines;
    if (a.length > 0) out.push(`${r.key}: ${a.join(' ')}`);
  }
  return out.length > 0 ? `Circulation and size evidence (advisory; on the plan image green arcs are door swings, amber boxes the 0.9 m approach, dashed blue lines walking paths, red boxes pieces nobody can walk up to). Compare with standard sizes (bedroom at least 3.5 x 4 m, double door 0.9 m, 0.9 m round a door, 0.7 m between beds), decide what to move, remove or enlarge, and render again to check:\n${out.join('\n')}` : '';
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
    `The checker measured it (advisory data about geometry and rules, not a verdict on how it looks): ${snap.findings.length} finding${snap.findings.length === 1 ? '' : 's'}${errors > 0 ? ` (${errors} error${errors === 1 ? '' : 's'}: impossible geometry, which does need fixing)` : ''}. Whether it is good enough is your call, made from the images.`,
    findingsText(snap.findings, 30),
  ];
  if (snap.advice) lines.push(snap.advice);
  if (opts.hasImages) lines.push(`Numbers drawn on the images are pieces of the building. Use them to say exactly what you mean:\n${snap.legend}`);
  lines.push(
    'Fix every real error and warning with edit_items / place_items (measure first with query_scene; make the smallest change that works; never rebuild a room to move one piece). Judge what the checker cannot: scale and proportion, clutter or emptiness, furniture facing the right way, pieces floating or crossing walls, style and colour consistency, lighting and mood, whether a person could live here. If the light or colour reads wrong (too cold, too dark, flat, washed out, green foliage that does not suit the season), set the look with tune_look rather than repainting surfaces. If a finding is a false alarm, say why in your final message.',
    'When YOU judge the building right from the images, call finish with one sentence on what you checked and fixed. Do not call finish while a measured error (impossible geometry) remains.',
  );
  return lines.join('\n');
}
