/**
 * Room from a reference photo: reconstruct, never template.
 *
 *   photo ─▶ vision model reads it into a structured, validated description (with stated assumptions)
 *         ─▶ the description becomes a design plan (shell only) and ordered placement steps, which run through the
 *            design tools: shell first, large pieces at measured positions, decor anchored to windows, pieces and walls
 *         ─▶ COMPARE AND CORRECT: the room is rendered from the photo's own camera; the vision model judges every
 *            checklist item against the photo and fixes failures with the same tools; an objective score (colour,
 *            structure, edges) keeps the best round and rolls back a round that made things worse.
 *
 * Without a vision model nothing is guessed: the palette and brightness are extracted and the user is told plainly.
 */
import type { WorldDoc } from '@aether/core';
import {
  PHOTO_BUILDING_ID,
  PHOTO_ROOM_ID,
  buildChecklist,
  calibrateCamera,
  clusterReads,
  consensusDescription,
  contested,
  type ConsensusReport,
  fidelityLine,
  fidelityText,
  framingTargets,
  framingText,
  measureFidelity,
  type FidelityReport,
  type FramingReport,
  type FramingTarget,
  deriveBuild,
  fitLayout,
  ItemVerdict,
  parseRoomDescription,
  photoCameraSpec,
  runBuild,
  scoreLine,
  scoreVerdicts,
  type ChecklistItem,
  type PhotoBuild,
  type RoomDescription,
  type Scoreboard,
  type ToolReply,
} from '@aether/arch/photo';
import {
  customPose,
  isDesignTool,
  legendText,
  markIndex,
  partKinds,
  projectMarks,
  reviewFindings,
  reviewPoses,
  type ReviewPose,
} from '@aether/arch';
import { z } from 'zod';
import { requestView } from '../context';
import { executeTool, raceAbort, runVerification, type ExecutorContext } from '../executor';
import { extractJsonObject } from '../emulation/json';
import { errorMessage } from '../providers/errors';
import type { AgentEvent, ChatMessage, CompletionRequest, CompletionResponse, ContentBlock, PhotoAssumptionView, PhotoOptions, PhotoReadsView, PhotoScoreView, ReviewViewRequest, ToolDef } from '../types';
import { imageSize } from './image-size';
import { ANALYSIS_SYSTEM, DESCRIBE_TOOL, DESCRIBE_TOOL_NAME, VERDICT_TOOL, VERDICT_TOOL_NAME, analysisUserText, compareIntroText, compareRoundText, refusalText } from './prompt';
import { restorePatches } from './revert';
import { applyGrade, estimatePhotoGrade, matchGrade, nextEnvironmentGrade, nextExposure, type PhotoGrade } from './grade';
import { JUDGES_DEFAULT, JUDGES_MAX, ProgressTracker, combinedScore, consensusText, decideRound, runPanel, type Consensus, type Decision, type RoundState } from './judge';
import { compareImages, extractPalette, regionColourScore, type Raster } from './score';
import { runReconcile } from './reconcile';

/** Everything the photo flow needs from the agent. */
export interface PhotoRun {
  ctx: ExecutorContext;
  /** The planner system prompt and tool list of the agent (the compare rounds use its design tools). */
  system: string;
  tools: readonly ToolDef[];
  maxTokens: number;
  maxToolCalls: number;
  session?: string;
  request: string;
  /** The photograph (a data URL). */
  image: string;
  options: PhotoOptions;
  /** The room replaces what is in the world (one undo step brings it back); false: it is added beside it. */
  replace?: boolean;
}

/** Model turns allowed inside one analysis (a refused description is sent back to be fixed). */
const ANALYSIS_ATTEMPTS = 3;
/** Most model turns inside one compare round. */
const TURNS_PER_ROUND = 8;
/**
 * Safety ceiling of compare rounds when no `maxRounds` is set (subscription backends): the loop is meant to end when the
 * judges and the model are satisfied or progress stalls, never on a fixed round count; this only stops a runaway.
 */
export const PHOTO_ROUNDS_CEILING = 200;
/** Default number of independent reads of the photo (merged into one description). */
export const READS_DEFAULT = 3;
/** Most reads of the photo. */
export const READS_MAX = 5;
/** Base of the advisory per-read seeds (read k uses READ_SEED + k). */
export const READ_SEED = 4421;
/**
 * Without a relative judgement (the single judge in the conversation), a round is rolled back when its combined score
 * is this much below the best: never less than 0.03, and at least one and a half checklist items (half the combined
 * score is the judge's pass rate; a single wavering verdict is not a regression).
 */
const ROLLBACK_MARGIN_MIN = 0.03;
function rollbackMargin(items: number): number {
  return Math.max(ROLLBACK_MARGIN_MIN, (1.5 * 0.5) / Math.max(1, items));
}
/** Pass rate that, with no structural failure, lets the model call it done. */
export const PHOTO_TARGET_RATE = 0.92;

const VerdictInput = z.object({ verdicts: z.array(z.unknown()).min(1).max(160), summary: z.string().max(400).optional() });

function noteModel(usage: ExecutorContext['usage'], model: string | undefined): void {
  if (!model) return;
  const list = (usage.models ??= []);
  const m = model.slice(0, 64);
  if (!list.includes(m) && list.length < 4) list.push(m);
}

function textOf(blocks: readonly ContentBlock[]): string {
  return blocks.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim();
}

/** Thrown inside the pipeline when the assistant in use cannot be asked (offline planner, no vision). */
class Unavailable extends Error {}

function visionOn(opts: PhotoOptions): boolean {
  return typeof opts.vision === 'function' ? opts.vision() : opts.vision !== false;
}

/** One model call; refuses to talk to the offline planner and keeps the usage totals. */
async function complete(run: PhotoRun, req: CompletionRequest): Promise<CompletionResponse> {
  const { ctx } = run;
  if (ctx.signal?.aborted) throw new Error('aborted');
  if (ctx.provider.name === 'mock' || !visionOn(run.options)) throw new Unavailable();
  const res = await raceAbort(ctx.provider.complete(req, ctx.signal), ctx.signal);
  ctx.usage.calls += 1;
  ctx.usage.inputTokens += res.usage?.inputTokens ?? 0;
  ctx.usage.outputTokens += res.usage?.outputTokens ?? 0;
  if (res.usage?.cachedInputTokens) ctx.usage.cachedInputTokens = (ctx.usage.cachedInputTokens ?? 0) + res.usage.cachedInputTokens;
  noteModel(ctx.usage, res.model);
  // The connection chain may have fallen back to the offline planner inside this very call: its reply is not an answer.
  if (ctx.provider.name === 'mock') throw new Unavailable();
  return res;
}

/** A turn of the analysis or of the compare conversation. `seed`: an independent read (temperature 0, its own seed). */
function ask(run: PhotoRun, messages: ChatMessage[], tools: readonly ToolDef[], useSession: boolean, seed?: number): Promise<CompletionResponse> {
  return complete(run, {
    role: 'planner',
    system: tools.some((t) => t.name === DESCRIBE_TOOL_NAME) ? ANALYSIS_SYSTEM : run.system,
    // The conversation stays append-only (a resumed thread keeps matching it); the request carries the newest images.
    messages: requestView(messages),
    tools: [...tools],
    maxTokens: run.maxTokens,
    ...(useSession && run.session ? { session: run.session } : {}),
    ...(seed !== undefined ? { temperature: 0, seed } : {}),
  });
}

/** Number of independent reads of the photo. */
function readsOf(opts: PhotoOptions): number {
  const n = opts.reads ?? READS_DEFAULT;
  return Number.isFinite(n) ? Math.max(1, Math.min(READS_MAX, Math.floor(n))) : READS_DEFAULT;
}

/** Number of independent judges of a run (0: the model doing the fixes judges, as one call). */
function judgesOf(opts: PhotoOptions): number {
  const n = opts.judges ?? JUDGES_DEFAULT;
  return Number.isFinite(n) ? Math.max(0, Math.min(JUDGES_MAX, Math.floor(n))) : JUDGES_DEFAULT;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

type Analysis = { ok: true; description: RoomDescription; fixes: string[]; callId?: string } | { ok: false; error: string };

/**
 * Ask for the description. `messages` is the conversation so far (empty: the first turn is made here); a later call
 * continues it, which is how a shell the builder refused is sent back to the model to correct.
 */
async function analyse(run: PhotoRun, messages: ChatMessage[] = [], seed?: number): Promise<Analysis> {
  if (messages.length === 0) messages.push({ role: 'user', content: [{ type: 'image', dataUrl: run.image }, { type: 'text', text: analysisUserText(run.request) }] });
  let lastError = 'the model did not describe the room';
  for (let attempt = 0; attempt < ANALYSIS_ATTEMPTS; attempt++) {
    const res = await ask(run, messages, [DESCRIBE_TOOL], false, seed);
    messages.push({ role: 'assistant', content: res.content });
    const call = res.content.find((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use' && b.name === DESCRIBE_TOOL_NAME);
    let raw: unknown;
    if (call) {
      const input = call.input as { description?: unknown } | null;
      raw = input && typeof input === 'object' && 'description' in input ? input.description : input;
    } else {
      const text = textOf(res.content);
      raw = text ? extractJsonObject(text) : undefined;
      if (raw === undefined || raw === null) {
        lastError = res.stopReason === 'error' && text ? text.slice(0, 300) : 'no description came back';
        messages.push({ role: 'user', content: [{ type: 'text', text: 'Call the describe_room tool now with the complete description of the room in the photo.' }] });
        continue;
      }
    }
    const parsed = parseRoomDescription(raw, partKinds());
    if (parsed.ok) return { ok: true, description: parsed.value, fixes: parsed.fixes, ...(call ? { callId: call.id } : {}) };
    lastError = parsed.error;
    if (call) messages.push({ role: 'user', content: [{ type: 'tool_result', toolUseId: call.id, content: refusalText(parsed.error), isError: true }] });
    else messages.push({ role: 'user', content: [{ type: 'text', text: refusalText(parsed.error) }] });
  }
  return { ok: false, error: lastError };
}

/** The photo read N times and merged: the description the room is built from, with how it came about. */
type Reading =
  | { ok: true; description: RoomDescription; fixes: string[]; talk: ChatMessage[]; callId?: string; view: PhotoReadsView; notes: string[] }
  | { ok: false; error: string };

/**
 * Read the photo `n` times, independently and in parallel (stateless calls, temperature 0 and a seed per read where the
 * backend takes them), and merge the reads (`clusterReads` + `consensusDescription`: majority per piece, median
 * positions and sizes, medoid colours, canonical ids). With more than one valid read and something contested, one
 * reconciliation call settles the contested pieces against the photo. One valid read is used as it is.
 */
async function readPhoto(run: PhotoRun): Promise<Reading> {
  const n = readsOf(run.options);
  const talks: ChatMessage[][] = Array.from({ length: n }, () => []);
  const settled = await Promise.allSettled(talks.map((t, k) => analyse(run, t, n > 1 ? READ_SEED + k : undefined)));
  // An abort, or the assistant becoming unavailable, ends the flow as it did with one read.
  for (const s of settled) if (s.status === 'rejected' && (run.ctx.signal?.aborted || s.reason instanceof Unavailable)) throw s.reason;
  const ok: Array<{ a: Extract<Analysis, { ok: true }>; talk: ChatMessage[] }> = [];
  const errors: string[] = [];
  settled.forEach((s, k) => {
    if (s.status === 'fulfilled' && s.value.ok) ok.push({ a: s.value, talk: talks[k] as ChatMessage[] });
    else errors.push(s.status === 'fulfilled' ? (s.value.ok ? '' : s.value.error) : errorMessage(s.reason));
  });
  if (ok.length === 0) {
    const thrown = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    if (thrown && settled.every((s) => s.status === 'rejected')) throw thrown.reason;
    return { ok: false, error: errors[0] ?? 'no description came back' };
  }
  const items = ok.map((o) => o.a.description.items.length);
  const first = ok[0] as (typeof ok)[number];
  if (ok.length === 1) {
    const d = first.a.description;
    return { ok: true, description: d, fixes: first.a.fixes, talk: first.talk, ...(first.a.callId ? { callId: first.a.callId } : {}), view: { reads: 1, asked: n, items, consensus: d.items.length, checklist: buildChecklist(d).length, dropped: 0, contested: 0, reconciled: [] }, notes: [] };
  }
  const clusters = clusterReads(ok.map((o) => o.a.description));
  let merged = consensusDescription(clusters, partKinds());
  if (!merged.ok) {
    // The merge broke a rule a single read kept (rare): build from the read the others agreed with most.
    const again = parseRoomDescription(clusters.reads[0], partKinds());
    const desc = again.ok ? again.value : first.a.description;
    return { ok: true, description: desc, fixes: first.a.fixes, talk: [], view: { reads: ok.length, asked: n, items, consensus: desc.items.length, checklist: buildChecklist(desc).length, dropped: 0, contested: 0, reconciled: [] }, notes: [`The ${ok.length} readings could not be merged (${merged.error.slice(0, 160)}); the room is built from one of them.`] };
  }
  const disputed = contested(merged.report);
  let reconciled: string[] = [];
  if (run.options.reconcile !== false && disputed.add.length + disputed.remove.length > 0) {
    try {
      const choice = await runReconcile((req) => complete(run, req), run.image, merged.report, merged.description, Math.min(run.maxTokens, 6000));
      if (choice && ((choice.add?.length ?? 0) > 0 || (choice.remove?.length ?? 0) > 0)) {
        const next = consensusDescription(clusters, partKinds(), choice);
        if (next.ok) {
          merged = next;
          reconciled = choice.reasons;
        }
      }
    } catch (e) {
      if (run.ctx.signal?.aborted || e instanceof Unavailable) throw e;
      // A failed reconciliation leaves the majority as it is.
    }
  }
  const report: ConsensusReport = merged.report;
  const d = merged.description;
  const dropped = report.items.filter((c) => !c.kept).length;
  const view: PhotoReadsView = { reads: ok.length, asked: n, items, consensus: d.items.length, checklist: buildChecklist(d).length, dropped, contested: disputed.add.length + disputed.remove.length, reconciled: reconciled.slice(0, 12) };
  const notes: string[] = [];
  if (report.orphans.length > 0) notes.push(`Left out because what they stand on or hang above was not agreed on: ${report.orphans.slice(0, 6).join(', ')}.`);
  return { ok: true, description: d, fixes: [...new Set([...merged.fixes, ...ok.flatMap((o) => o.a.fixes)])].slice(0, 8), talk: [], view, notes };
}

/** One line on how the photo was read ("Read the photo 3 times independently (11, 12, 11 pieces): …"). */
function readsLine(v: PhotoReadsView): string {
  if (v.reads <= 1) return v.asked > 1 ? `Only one of ${v.asked} readings of the photo was usable.` : '';
  return `Read the photo ${v.reads} times independently (${v.items.join(', ')} pieces): ${v.consensus} pieces seen by most readings kept${v.dropped > 0 ? `, ${v.dropped} left out` : ''}${v.reconciled.length > 0 ? `; ${v.reconciled.length} disputed piece${v.reconciled.length === 1 ? '' : 's'} settled against the photo` : ''}.`;
}

// ---------------------------------------------------------------------------
// Rendering and measuring
// ---------------------------------------------------------------------------

interface Shot {
  /** Marked images for the judge, the photo camera first. */
  images: Array<{ name: string; label: string; dataUrl: string }>;
  legend: string;
  /** Measured fidelity, 0..1: the deterministic measures of the room against the description and the photo (see `measureFidelity`). */
  objective: number | null;
  /** The measures in words ("measured fidelity 81% (framing 75, …)"), empty when none could be made. */
  measure: string;
  /** Framing of the room against the boxes the photo's description gives (null without boxes). */
  framing: FramingReport | null;
  /** The fidelity report behind `objective`. */
  fidelity: FidelityReport | null;
  /** The photo-camera render without marks (what the judges look at; null when the host did not draw it). */
  clean: string | null;
}

interface Photo {
  dataUrl: string;
  aspect: number;
  raster: Raster | null;
  /** Exposure, white balance and tone read off the photo (null without pixels). */
  grade: PhotoGrade | null;
  /** How many times the environment exposure was moved towards the photo's (bounded). */
  exposureSteps: number;
  /** How many times the environment's colour grade was moved towards the photo's (bounded). */
  gradeSteps: number;
}

function toRequest(p: ReviewPose, aspect: number, marks: ReviewViewRequest['marks']): ReviewViewRequest {
  return { name: p.name, label: p.label, kind: p.kind, pose: { position: p.position, target: p.target, up: p.up, fov: p.fov }, hideTops: p.hideTops, aspect, marks };
}

async function snapshot(run: PhotoRun, photo: Photo, desc0: RoomDescription, targets: readonly FramingTarget[], extraWalls: readonly string[], maxViews: number, wantClean = false): Promise<Shot | null> {
  const { host } = run.ctx;
  if (typeof host.captureReview !== 'function') return null;
  const world = host.getWorld();
  // The camera the model reported is an estimate: refine it so the room frames like the photo, then look through it.
  const fit = calibrateCamera(world, desc0, photo.aspect, targets);
  const desc: RoomDescription = fit?.improved ? { ...desc0, camera: fit.camera } : desc0;
  const framing = fit ? (fit.improved ? fit.after : fit.before) : null;
  const cam = customPose(world, PHOTO_BUILDING_ID, photoCameraSpec(desc, photo.aspect));
  if (!cam) return null;
  const shown = new Set<number>();
  const marks = projectMarks(world, PHOTO_BUILDING_ID, cam, photo.aspect);
  for (const m of marks) shown.add(m.n);
  const views: ReviewViewRequest[] = [toRequest(cam, photo.aspect, marks)];
  // Straight-on views of the walls whose items fail: where a position or a height is easiest to judge.
  if (extraWalls.length > 0) {
    const poses = reviewPoses(world, PHOTO_BUILDING_ID, { rooms: [PHOTO_ROOM_ID], maxViews: 12, aspect: 1.5 });
    for (const w of extraWalls) {
      const p = poses.find((x) => x.kind === 'wall' && x.name.endsWith(`-wall-${w}`));
      if (!p || views.length >= maxViews) continue;
      const m = projectMarks(world, PHOTO_BUILDING_ID, p, 1.5);
      for (const k of m) shown.add(k.n);
      views.push(toRequest(p, 1.5, m));
    }
  }
  const clean = toRequest(cam, photo.aspect, []);
  clean.name = 'photo-camera-clean';
  // One capture call per image shape (a capture renders every view at the aspect of the first one).
  const wanted = [...views, ...(wantClean || (photo.raster && typeof host.decodeImage === 'function') ? [clean] : [])];
  const got: Array<{ name: string; dataUrl: string }> = [];
  for (const aspect of [...new Set(wanted.map((v) => v.aspect))]) {
    got.push(...(await raceAbort(host.captureReview(wanted.filter((v) => v.aspect === aspect), run.ctx.signal ? { signal: run.ctx.signal } : {}), run.ctx.signal)));
  }
  const images: Shot['images'] = [];
  for (const v of views) {
    const g = got.find((x) => x.name === v.name);
    if (g) images.push({ name: v.name, label: v.label, dataUrl: g.dataUrl });
  }
  if (images.length === 0) return null;
  let similarity: number | null = null;
  let regionColour: number | null = null;
  const cleanShot = got.find((x) => x.name === clean.name);
  if (cleanShot && photo.raster && host.decodeImage) {
    const r = await host.decodeImage(cleanShot.dataUrl, 256).catch(() => null);
    if (r) {
      // The render is graded like the photo (white point, tone) before it is compared, so a correct room with another
      // exposure or light colour is not punished; the exposure of the environment then moves towards the photo's.
      const renderGrade = photo.grade ? estimatePhotoGrade(r) : null;
      const match = photo.grade && renderGrade ? matchGrade(photo.grade, renderGrade) : null;
      const graded = match ? applyGrade({ ...r, data: r.data.slice() }, match) : r;
      if (match && photo.gradeSteps < 2) {
        // The white balance, saturation and contrast of the photo go into the world's own colour grade, so the room shows
        // them in the studio and in every later render (a delta below a few percent is not worth a patch).
        const cur = run.ctx.host.getWorld().environment.grade;
        const g = nextEnvironmentGrade(cur, match);
        if (Math.abs(g.temperature - (cur?.temperature ?? 0)) > 0.03 || Math.abs(g.saturation - (cur?.saturation ?? 1)) > 0.04 || Math.abs(g.contrast - (cur?.contrast ?? 1)) > 0.04) {
          photo.gradeSteps++;
          run.ctx.host.applyPatches([{ op: 'setEnvironment', set: { grade: g } }], 'Match the colour grade of the photo');
        }
      }
      similarity = compareImages(photo.raster, graded)?.overall ?? null;
      if (framing) regionColour = regionColourScore(photo.raster, graded, framing.rows);
      if (photo.grade && renderGrade && photo.exposureSteps < 3 && Math.abs(photo.grade.median - renderGrade.median) > 0.06) {
        const cur = run.ctx.host.getWorld().environment.exposure;
        const next = nextExposure(cur, photo.grade, renderGrade);
        if (Math.abs(next - cur) >= 0.05) {
          photo.exposureSteps++;
          run.ctx.host.applyPatches([{ op: 'setEnvironment', set: { exposure: next } }], 'Match the exposure of the photo');
        }
      }
    }
  }
  // The deterministic measures of the room as it was rendered (the world before the grade patches above, which do not move anything).
  const fidelity = measureFidelity(world, desc0, { framing, similarity, regionColour });
  const objective = fidelity?.score ?? null;
  const measure = fidelity ? fidelityLine(fidelity) : [framing ? `framing ${Math.round(framing.score * 100)}%` : '', similarity !== null ? `similarity ${Math.round(similarity * 100)}%` : ''].filter(Boolean).join(', ');
  return { images, legend: legendText(markIndex(world, PHOTO_BUILDING_ID), shown), objective, measure, framing, fidelity, clean: cleanShot?.dataUrl ?? null };
}

/** What one look at the room came to: the judgement (the panel's, or the single judge's) and the measures. */
interface Judged {
  score: Scoreboard;
  objective: number | null;
  fidelity: FidelityReport | null;
  /** Judge score 0..1: the panel's median rubric score, or the single judge's pass rate. */
  judge: number;
  /** {@link combinedScore}: half judge, half measured fidelity. */
  quality: number;
  measure: string;
  /** The panel's consensus (null: the model in the conversation judged). */
  panel: Consensus | null;
}

function judgedOf(sb: Scoreboard, shot: Pick<Shot, 'objective' | 'fidelity' | 'measure'>, panel: Consensus | null): Judged {
  const judge = panel ? panel.judge : sb.rate;
  return { score: sb, objective: shot.objective, fidelity: shot.fidelity, judge, quality: combinedScore({ objective: shot.objective, metrics: shot.fidelity?.metrics ?? null, judge }), measure: shot.measure, panel };
}

function stateOf(j: Judged): RoundState {
  return { objective: j.objective, metrics: j.fidelity?.metrics ?? null, judge: j.judge };
}

function scoreView(j: Judged, accepted?: boolean): PhotoScoreView {
  const sb = j.score;
  const fidelity: NonNullable<PhotoScoreView['fidelity']> = {};
  if (j.fidelity) for (const [k, v] of Object.entries(j.fidelity.metrics)) if (typeof v === 'number') fidelity[k as keyof typeof fidelity] = v;
  return {
    passed: sb.passed,
    total: sb.total,
    rate: sb.rate,
    ...(j.objective !== null ? { objective: j.objective } : {}),
    ...(Object.keys(fidelity).length > 0 ? { fidelity } : {}),
    judge: j.judge,
    ...(j.panel ? { judges: j.panel.samples, spread: j.panel.spread, ...(j.panel.preference ? { preference: j.panel.preference } : {}) } : {}),
    combined: j.quality,
    ...(accepted !== undefined ? { accepted } : {}),
    structuralFailed: sb.structuralFailed,
    failing: sb.failing.slice(0, 24).map((f) => ({ id: f.id, text: f.text.slice(0, 160), note: f.note.slice(0, 200) })),
  };
}

/** The numbers of a look in one line ("judges 11/17 pass (65%), score 72%; framing 75%, …; combined 77%"). */
function lookLine(j: Judged): string {
  return `${j.panel ? `judges ${scoreLine(j.score)}, score ${Math.round(j.judge * 100)}%` : scoreLine(j.score)}${j.measure ? `; ${j.measure}` : ''}; combined ${Math.round(j.quality * 100)}%`;
}

function pushUser(messages: ChatMessage[], blocks: ContentBlock[]): void {
  const last = messages[messages.length - 1];
  if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(...blocks);
  else messages.push({ role: 'user', content: blocks });
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

/** Words that make a prompt with a picture a request for a room (or a place) like the one shown. */
const ROOM_WORDS = /\b(room|bedroom|bed room|living|lounge|kitchen|bathroom|office|studio|apartment|flat|interior|suite|hall|hallway|dining|nursery|attic|loft|cabin|cafe|caf[eé]|lobby|space)\b/i;
const RECREATE = /\b(recreate|re-create|reconstruct|rebuild|recreate this|build (?:this|that|it|the room)|make (?:this|that|it)|3d version|in 3d|like (?:this|the)|from (?:this|the) (?:photo|image|picture)|same as|copy (?:this|the))\b/i;

/** True when a prompt with an image asks for the room in the picture. `explicit` is the composer's "Recreate this image". */
export function isRoomPhotoRequest(prompt: string, imageCount: number, explicit: boolean): boolean {
  if (imageCount < 1) return false;
  if (explicit) return true;
  const p = prompt.toLowerCase();
  return ROOM_WORDS.test(p) && (RECREATE.test(p) || p.length < 140);
}

function chips(desc: RoomDescription, build: PhotoBuild, fixes: readonly string[]): PhotoAssumptionView[] {
  const out: PhotoAssumptionView[] = desc.assumptions.map((a, i) => ({ id: a.id ?? `assumption-${i + 1}`, text: a.text, confidence: a.confidence, adjust: a.adjust }));
  const w = Math.round(desc.footprint.width * 10) / 10;
  const d = Math.round(desc.footprint.depth * 10) / 10;
  if (!desc.assumptions.some((a) => /\b(size|wide|width|deep|depth|metre|meter|\bm\b)/i.test(a.text))) {
    out.push({ id: 'room-size', text: `The room is about ${w} m wide and ${d} m deep, ${desc.footprint.ceiling} m high (estimated from the photo).`, confidence: 0.4, adjust: `make the room ${Math.round((w + 0.6) * 10) / 10} m wide` });
  }
  for (const [i, n] of build.notes.entries()) out.push({ id: `note-${i + 1}`, text: n, confidence: 0.3, adjust: n.startsWith('No door') ? 'move the door to the east wall' : '' });
  for (const [i, f] of fixes.slice(0, 4).entries()) out.push({ id: `repair-${i + 1}`, text: f, confidence: 0.5, adjust: '' });
  return out.slice(0, 24);
}

/** The pass/fail marks as a one-line answer for the model. */
function verdictReply(sb: Scoreboard): string {
  return `Recorded: ${scoreLine(sb)}.`;
}

async function decodePhoto(run: PhotoRun): Promise<Photo> {
  const size = imageSize(run.image);
  const raster = typeof run.ctx.host.decodeImage === 'function' ? await run.ctx.host.decodeImage(run.image, 256).catch(() => null) : null;
  const aspect = raster ? raster.width / raster.height : size ? size.width / size.height : 1.5;
  return { dataUrl: run.image, aspect: Math.max(0.5, Math.min(3, aspect)), raster, grade: raster ? estimatePhotoGrade(raster) : null, exposureSteps: 0, gradeSteps: 0 };
}

/** Offline notice: what can be said without a vision model. */
async function* offline(run: PhotoRun, why: string): AsyncGenerator<AgentEvent> {
  const photo = await decodePhoto(run).catch(() => null);
  const pal = photo?.raster ? extractPalette(photo.raster, 5) : null;
  const tone = pal ? `${pal.brightness > 0.62 ? 'bright' : pal.brightness < 0.35 ? 'dark' : 'moderately lit'}, ${pal.warmth > 0.08 ? 'warm' : pal.warmth < -0.05 ? 'cool' : 'neutral'}` : '';
  yield {
    type: 'photo',
    phase: 'offline',
    text: `${why} Rebuilding the layout of a room from a photograph needs a connected assistant that can see images, so nothing was built: guessing a layout would give you some other room.${pal ? ` What I can read without it: the picture is ${tone}, with dominant colours ${pal.colours.join(', ')}.` : ''} Connect an assistant that supports images (Settings), or describe the room in words (size, windows, furniture, colours) and I will build that.`,
    ...(pal ? { palette: pal.colours } : {}),
  };
}

/** Run the whole photo flow. Never throws except on abort; failures are events. */
export async function* reconstructRoom(run: PhotoRun): AsyncGenerator<AgentEvent> {
  const { ctx } = run;
  const host = ctx.host;
  if (ctx.provider.name === 'mock') {
    yield* offline(run, 'The offline planner is active.');
    return;
  }
  if (!visionOn(run.options)) {
    yield* offline(run, 'The connected assistant cannot look at images.');
    return;
  }
  yield { type: 'status', text: 'Reading the photo…' };
  yield { type: 'photo', phase: 'analysing', text: 'Reading the photo: room size, walls, windows, furniture, colours and light.' };
  const photo = await decodePhoto(run);
  let analysis: Reading;
  try {
    analysis = await readPhoto(run);
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
    if (e instanceof Unavailable) {
      yield* offline(run, ctx.provider.name === 'mock' ? 'The connected assistant is not available (the offline planner took over).' : 'The connected assistant cannot look at images.');
      return;
    }
    yield { type: 'error', text: `Could not read the photo: ${errorMessage(e).slice(0, 400)}` };
    return;
  }
  if (!analysis.ok) {
    yield { type: 'error', text: `The assistant could not describe the photo as a valid room (${analysis.error.slice(0, 300)}). Nothing was built. Try again, or describe the room in words.` };
    return;
  }
  let desc = analysis.description;
  const talk = analysis.talk;
  let build = deriveBuild(desc);
  build.notes.push(...analysis.notes);
  let checklist = buildChecklist(desc);
  let assumptions = chips(desc, build, analysis.fixes);
  const readText = readsLine(analysis.view);
  yield { type: 'photo', phase: 'described', text: `${desc.summary || `A ${desc.roomType} of about ${desc.footprint.width} × ${desc.footprint.depth} m.`}${readText ? ` ${readText}` : ''}`, assumptions, reads: analysis.view };

  // The room is the world: whatever was there (the starter scene, an earlier room) goes, as one undo step.
  if (run.replace !== false && Object.keys(host.getWorld().entities).length > 0) {
    // The project is named after the room, and the starter's outdoor weather (fireflies, rain) does not follow it inside.
    const cleared = host.applyPatches([{ op: 'clear' }, { op: 'setMeta', name: photoRoomName(desc.roomType) }, { op: 'setEnvironment', set: { weather: 'clear' } }], 'Clear the world for the room from the photo');
    if (cleared.applied.length > 0) yield { type: 'patches', patches: cleared.applied, message: 'Clear the world for the room from the photo', result: { applied: cleared.applied.length, errors: [] } };
  }
  // Build: shell first, then the pieces, each through the design tools (measured, accepted or refused with a reason).
  yield { type: 'status', text: 'Building the room from the photo…' };
  yield { type: 'photo', phase: 'building', text: `Building the shell at ${desc.footprint.width} × ${desc.footprint.depth} m and placing ${build.steps.length} pieces.` };
  const events: AgentEvent[] = [];
  const caller = async (name: 'design_plan' | 'place_items', input: Record<string, unknown>): Promise<ToolReply> => {
    const out = await executeTool(ctx, name, input);
    events.push(...out.events);
    return { world: host.getWorld(), text: out.content, ok: !out.isError || out.edited };
  };
  let built = await runBuild(host.getWorld(), build, caller);
  // A shell the builder refuses (an impossible window, rooms that do not fit) goes back to the model once, with the reason.
  if (!built.shellOk) {
    yield { type: 'photo', phase: 'building', text: 'The builder refused the shell; asking the assistant to correct the description.' };
    try {
      const reason = `The builder refused the shell built from ${talk.length > 0 ? 'your description' : 'this description'}:\n${built.shellText.slice(0, 1500)}\nCorrect the description (keep it faithful to the photo) and call describe_room again with the complete corrected description.`;
      if (talk.length > 0) talk.push({ role: 'user', content: [...(analysis.callId ? [{ type: 'tool_result' as const, toolUseId: analysis.callId, content: 'The description was valid, but the builder refused the shell (see below).', isError: true }] : []), { type: 'text', text: reason }] });
      // A merged description has no conversation of its own: the correction starts one with the photo and the description.
      else talk.push({ role: 'user', content: [{ type: 'image', dataUrl: run.image }, { type: 'text', text: `${analysisUserText(run.request)}\n\nA description of this photo (merged from independent readings):\n${JSON.stringify(desc).slice(0, 24000)}\n\n${reason}` }] });
      const again = await analyse(run, talk);
      if (again.ok) {
        desc = again.description;
        build = deriveBuild(desc);
        checklist = buildChecklist(desc);
        assumptions = chips(desc, build, [...analysis.fixes, ...again.fixes]);
        built = await runBuild(host.getWorld(), build, caller);
      }
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      if (!(e instanceof Unavailable)) yield { type: 'error', text: `Could not correct the description: ${errorMessage(e).slice(0, 300)}` };
    }
  }
  for (const ev of events) yield ev;
  if (!built.shellOk) {
    yield { type: 'error', text: `The shell was refused: ${built.shellText.slice(0, 600)}` };
    return;
  }
  const env = host.applyPatches([{ op: 'setEnvironment', set: build.environment }], 'Light of the photo');
  if (env.errors.length === 0 && env.applied.length > 0) yield { type: 'patches', patches: env.applied, message: 'Light of the photo', result: { applied: env.applied.length, errors: [] } };
  const refusals = built.outcomes.filter((o) => !o.ok).map((o) => `${o.id} (${o.kind}): ${o.text}`.slice(0, 360));
  yield { type: 'photo', phase: 'built', text: `Built. ${built.outcomes.filter((o) => o.ok).length} of ${built.outcomes.length} pieces placed${refusals.length > 0 ? `; ${refusals.length} refused and handed to the compare loop` : ''}.` };

  // Compare and correct.
  let final: Judged | null = null;
  try {
    final = (yield* compareLoop(run, photo, desc, framingTargets(desc, built.openings), checklist, build, refusals)).judged;
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
    if (!(e instanceof Unavailable)) yield { type: 'error', text: `The compare loop stopped: ${errorMessage(e).slice(0, 300)}. The room as built so far is kept.` };
    else yield { type: 'photo', phase: 'unavailable', text: 'The assistant became unavailable during the comparison; the room as built so far is kept.' };
  }

  // Verification of the room as it stands (the walkthrough test the shell carries).
  yield { type: 'status', text: 'Verifying the room…' };
  const v = await runVerification(ctx);
  yield v.event;
  const findings = reviewFindings(host.getWorld(), PHOTO_BUILDING_ID).filter((f) => f.severity === 'error');
  const lines: string[] = [];
  if (final) {
    const s = final.score;
    lines.push(`Rebuilt the room from your photo: ${s.passed} of ${s.total} checklist items match${final.panel ? ` (median of ${final.panel.samples} independent judges)` : ''}${final.objective !== null ? `; measured fidelity ${Math.round(final.objective * 100)}%` : ''}.`);
    if (s.failing.length > 0) lines.push(`Still different: ${s.failing.slice(0, 5).map((f) => `${f.id}${f.note && f.note !== 'not judged' ? ` (${f.note.slice(0, 80)})` : ''}`).join('; ')}.`);
  } else lines.push('Rebuilt the room from your photo (not compared with it: no renders were available).');
  if (findings.length > 0) lines.push(`The checker still reports ${findings.length} problem${findings.length === 1 ? '' : 's'}.`);
  lines.push(`I assumed ${assumptions.length} thing${assumptions.length === 1 ? '' : 's'} the photo cannot show; each one is listed with a one-tap way to change it.`);
  yield { type: 'photo', phase: 'done', text: lines.join(' '), assumptions, ...(final ? { score: scoreView(final) } : {}) };
  yield { type: 'message', text: lines.join(' ') };
}

interface LoopResult {
  /** The judgement of the room as it ends up (null: it was never judged). */
  judged: Judged | null;
}

/** A state the loop accepted: the room, its render and its judgement. */
interface Accepted {
  world: WorldDoc;
  round: number;
  shot: Shot;
  judged: Judged;
}

/** Fit the pieces to their boxes (see `fitLayout`); returns what was moved, in words. */
async function* layoutStep(run: PhotoRun, photo: Photo, desc: RoomDescription, targets: readonly FramingTarget[]): AsyncGenerator<AgentEvent, string[]> {
  const { ctx } = run;
  const world = ctx.host.getWorld();
  const cal = calibrateCamera(world, desc, photo.aspect, targets);
  const withCamera: RoomDescription = cal?.improved ? { ...desc, camera: cal.camera } : desc;
  const fit = fitLayout(world, withCamera, photo.aspect, targets);
  if (!fit || fit.moves.length === 0) return [];
  const done: string[] = [];
  for (const m of fit.moves) {
    if (ctx.signal?.aborted) throw new Error('aborted');
    const out = await executeTool(ctx, 'edit_items', { edits: [m.edit] });
    for (const ev of out.events) yield ev;
    if (out.edited && !out.isError && m.shift !== 0) done.push(`${m.id} ${m.shift > 0 ? '+' : ''}${m.shift} m along its wall`);
  }
  if (done.length > 0) yield { type: 'photo', phase: 'building', text: `Fitted ${done.length} piece${done.length === 1 ? '' : 's'} to where the photo shows them: ${done.slice(0, 6).join(', ')}.` };
  return done;
}

/**
 * The compare-and-correct loop. Each round: render from the photo's camera, measure (deterministic fidelity), judge
 * (an independent panel with the fixed rubric, relative to the accepted state; or, with `judges: 0`, the model in the
 * conversation), accept the new state or go back to the accepted one, then let the model fix what still differs.
 * Returns the judgement of the room as it ends up.
 */
async function* compareLoop(run: PhotoRun, photo: Photo, desc: RoomDescription, targets: readonly FramingTarget[], checklist: readonly ChecklistItem[], build: PhotoBuild, firstRefusals: readonly string[]): AsyncGenerator<AgentEvent, LoopResult> {
  const { ctx } = run;
  const host = ctx.host;
  // No fixed ceiling unless the host sets one (paid keys): the loop ends on agreement, on nothing left to change, or on a stall.
  const cap = run.options.maxRounds;
  const maxRounds = cap === undefined || !Number.isFinite(cap) ? PHOTO_ROUNDS_CEILING : Math.max(1, Math.min(PHOTO_ROUNDS_CEILING, Math.floor(cap)));
  const maxViews = Math.max(1, Math.min(4, Math.floor(run.options.maxViews ?? 3)));
  const judges = judgesOf(run.options);
  const tracker = new ProgressTracker(run.options.stallRounds ?? 3);
  const designTools = run.tools.filter((t) => isDesignTool(t.name));
  const tools: ToolDef[] = [VERDICT_TOOL, ...designTools, ...run.tools.filter((t) => t.name === 'finish')];
  const messages: ChatMessage[] = [];
  const margin = rollbackMargin(checklist.length);
  /** Where progress is measured from: with a panel, the last state the judges preferred; without, the best state. */
  // (Written through `settle`, so the declared type is spelled out: control flow would otherwise narrow it to null.)
  let accepted = null as Accepted | null;
  let last: Judged | null = null;
  /** The room changed since the accepted state (so the next look has to be judged). */
  let changed = true;
  let refusals: string[] = [...firstRefusals];
  let extraWalls: string[] = [];
  let intro = true;
  let round = 0;

  const revertTo = (target: WorldDoc, why: string): boolean => {
    const patches = restorePatches(host.getWorld(), target);
    if (patches.length === 0) return true;
    return host.applyPatches(patches, why.slice(0, 120)).errors.length === 0;
  };

  /** The panel's judgement of a render, relative to the accepted state (null: no panel, or no judge answered). */
  const askPanel = async (shot: Shot): Promise<Consensus | null> => {
    if (judges === 0) return null;
    const current = shot.clean ?? shot.images[0]?.dataUrl;
    if (!current) return null;
    const ref = accepted;
    const previous = ref ? (ref.shot.clean ?? ref.shot.images[0]?.dataUrl ?? null) : null;
    try {
      const res = await runPanel((req) => complete(run, req), { photo: photo.dataUrl, current, previous, checklist, judges, maxTokens: Math.min(run.maxTokens, 8000) });
      return res.consensus;
    } catch (e) {
      if (ctx.signal?.aborted || e instanceof Unavailable) throw e;
      return null;
    }
  };

  /** Accept a judged state, or go back to the accepted one. Returns the decision and the judgement that now stands. */
  const settle = (cand: Judged, world: WorldDoc, shot: Shot, at: number): { decision: Decision; standing: Judged; rejected: Accepted | null } => {
    const ref = accepted;
    const decision = decideRound(ref ? stateOf(ref.judged) : null, stateOf(cand), cand.panel?.preference ?? null, margin);
    if (decision.accept) {
      // Without a panel the reference stays the best state, so a slow slide of small losses is not accepted step by step.
      if (cand.panel || !ref || cand.quality >= ref.judged.quality) accepted = { world, round: at, shot, judged: cand };
      return { decision, standing: cand, rejected: null };
    }
    if (ref && revertTo(ref.world, `Back to round ${ref.round}`)) return { decision, standing: ref.judged, rejected: ref };
    return { decision: { ...decision, accept: true }, standing: cand, rejected: null };
  };

  /** End of the loop: edits made after the last judged render are judged once more, and kept only when accepted. */
  async function* conclude(j: Judged, unjudgedEdits: boolean): AsyncGenerator<AgentEvent, LoopResult> {
    if (!unjudgedEdits) return { judged: j };
    const shot = await snapshot(run, photo, desc, targets, [], 1, judges > 0).catch((e) => {
      if (ctx.signal?.aborted) throw e;
      return null;
    });
    if (!shot) return { judged: j };
    const world = host.getWorld();
    let fin: Judged | null = null;
    const panel = await askPanel(shot);
    if (panel) fin = judgedOf(panel.score, shot, panel);
    else {
      const sb = await finalJudgement(run, photo, shot, checklist, messages).catch((e) => {
        if (ctx.signal?.aborted) throw e;
        return null;
      });
      if (sb) fin = judgedOf(sb, shot, null);
    }
    if (!fin) return { judged: j };
    yield { type: 'photo', phase: 'round', text: `Final check: ${lookLine(fin)}.`, score: scoreView(fin) };
    const s = settle(fin, world, shot, round);
    if (s.rejected) {
      yield { type: 'photo', phase: 'round', text: `The last changes were not kept (${s.decision.reason}); back to round ${s.rejected.round}.`, score: scoreView(s.rejected.judged) };
      return { judged: s.rejected.judged };
    }
    return { judged: fin };
  }

  // Before the first look: put each piece where its box in the photo says (a few tens of centimetres along the wall are
  // the commonest error of a position read off a flat picture). The moves go through the same tools; refusals stay as they are.
  {
    const fitted = yield* layoutStep(run, photo, desc, targets);
    if (fitted.length > 0) build.notes.push(`Before this first look the builder fitted ${fitted.length} piece${fitted.length === 1 ? '' : 's'} to where the photo shows them (${fitted.slice(0, 8).join('; ')}).`);
  }
  for (round = 1; round <= maxRounds; round++) {
    if (ctx.signal?.aborted) throw new Error('aborted');
    yield { type: 'status', text: round === 1 ? 'Comparing the render with the photo…' : `Compare round ${round}…` };
    const shot = await snapshot(run, photo, desc, targets, extraWalls, maxViews, judges > 0).catch((e) => {
      if (ctx.signal?.aborted) throw e;
      return null;
    });
    if (!shot) {
      yield { type: 'photo', phase: 'unavailable', text: 'No render of the room could be made here, so it was not compared with the photo.' };
      return { judged: last };
    }
    const judgedWorld = host.getWorld();
    yield { type: 'photo', phase: 'comparing', round, text: round === 1 ? 'Comparing the render with the photo, item by item.' : `Round ${round}: judging the render again.` };

    // The judges look first (when there are any): the model then works on a state they accepted.
    let view: Shot = shot;
    let standing: Judged | null = null;
    let decision: Decision | null = null;
    let rejectNote = '';
    const ref0 = accepted;
    if (judges > 0 && ref0 && !changed) {
      standing = ref0.judged;
      decision = { accept: true, gain: false, reason: 'nothing changed since the accepted state' };
    } else if (judges > 0) {
      const panel = await askPanel(shot);
      if (panel) {
        const cand = judgedOf(panel.score, shot, panel);
        const s = settle(cand, judgedWorld, shot, round);
        decision = s.decision;
        standing = s.standing;
        if (s.rejected) {
          view = s.rejected.shot;
          rejectNote = `Your last changes were rolled back to the state of round ${s.rejected.round}: ${s.decision.reason}. The images below show that state. Try a different, smaller fix.`;
          yield { type: 'photo', phase: 'round', round, text: `Round ${round} was not kept (${s.decision.reason}): back to round ${s.rejected.round}.`, score: scoreView(cand, false) };
        }
        yield { type: 'photo', phase: 'round', round, text: `Round ${round}: ${lookLine(standing)}.`, score: scoreView(standing, s.rejected === null) };
      }
    }

    const notes = [rejectNote, standing?.panel ? consensusText(standing.panel) : '', view.fidelity ? fidelityText(view.fidelity) : ''].filter((l) => l.length > 0).join('\n');
    const blocks: ContentBlock[] = [];
    if (intro) {
      blocks.push({ type: 'text', text: compareIntroText({ summary: desc.summary || desc.roomType, checklist, notes: build.notes, hasObjective: view.objective !== null, plan: JSON.stringify(build.plan), ...(view.framing ? { framing: framingText(view.framing) } : {}), judged: standing !== null, measured: notes }) });
      intro = false;
    } else blocks.push({ type: 'text', text: compareRoundText(round, last?.score ?? null, view.objective, view.legend, refusals, view.framing ? framingText(view.framing) : '', notes, standing !== null) });
    blocks.push({ type: 'text', text: 'Image 1: the PHOTO' }, { type: 'image', dataUrl: photo.dataUrl });
    view.images.forEach((im, i) => blocks.push({ type: 'text', text: `Image ${i + 2}: RENDER, ${im.label}` }, { type: 'image', dataUrl: im.dataUrl }));
    if (round === 1) blocks.push({ type: 'text', text: `Legend of the numbers:\n${view.legend}${firstRefusals.length > 0 ? `\nRefused while building (place these again with the right numbers, or fix the cause):\n${firstRefusals.map((r) => `- ${r}`).join('\n')}` : ''}` });
    pushUser(messages, blocks);
    refusals = [];
    extraWalls = [];

    let workerJudged = false;
    let edited = false;
    let declared = false;
    let rolledBack = false;
    let toolCalls = 0;
    const ready = (): boolean => standing !== null || workerJudged;
    for (let turn = 0; turn < TURNS_PER_ROUND && !declared && !(ready() && (edited || rolledBack)); turn++) {
      const res = await ask(run, messages, tools, true);
      messages.push({ role: 'assistant', content: res.content });
      const calls = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
      const text = textOf(res.content);
      if (res.stopReason === 'error' && calls.length === 0) {
        yield { type: 'error', text: text || 'The model could not complete the comparison.' };
        return { judged: standing ?? last };
      }
      if (calls.length === 0) {
        if (ready()) {
          if (text) yield { type: 'message', text };
          declared = true;
          break;
        }
        pushUser(messages, [{ type: 'text', text: 'Call report_verdicts now with a verdict for every checklist id.' }]);
        continue;
      }
      if (text) yield { type: 'plan', text };
      const results: ContentBlock[] = [];
      // Verdicts first, edits next, finish last: the order the work has to happen in.
      const rank = (n: string): number => (n === VERDICT_TOOL_NAME ? 0 : n === 'finish' ? 2 : 1);
      for (const call of [...calls].sort((a, b) => rank(a.name) - rank(b.name))) {
        if (ctx.signal?.aborted) throw new Error('aborted');
        if (call.name === VERDICT_TOOL_NAME) {
          const ok = parseVerdicts(call.input);
          if (ok.length === 0) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: 'No valid verdicts: send {"verdicts":[{"id": a checklist id, "pass": true|false, "note": what differs}]}.', isError: true });
            continue;
          }
          if (workerJudged) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: 'Already recorded this round. Fix what fails, or call finish.' });
            continue;
          }
          workerJudged = true;
          const sb = scoreVerdicts(checklist, ok);
          if (standing) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: `Recorded your notes (${scoreLine(sb)}). The independent judges' scores above are what decide progress: fix what they found, or call finish.` });
            continue;
          }
          // No panel: the model's own verdicts are this round's judgement.
          const cand = judgedOf(sb, shot, null);
          const s = settle(cand, judgedWorld, shot, round);
          standing = s.standing;
          decision = s.decision;
          let note = verdictReply(sb);
          if (s.rejected) {
            rolledBack = true;
            note += ` That is worse than round ${s.rejected.round} (${s.decision.reason}), so the room was rolled back to round ${s.rejected.round}; the changes in this reply are not applied. Look at the next render and try a different, smaller fix.`;
            yield { type: 'photo', phase: 'round', round, text: `Round ${round} was worse (${s.decision.reason}): back to round ${s.rejected.round}.`, score: scoreView(s.rejected.judged) };
          }
          results.push({ type: 'tool_result', toolUseId: call.id, content: note });
          continue;
        }
        if (call.name === 'finish') {
          declared = true;
          results.push({ type: 'tool_result', toolUseId: call.id, content: 'Done.' });
          continue;
        }
        if (!isDesignTool(call.name)) {
          results.push({ type: 'tool_result', toolUseId: call.id, content: `Unknown tool "${call.name.slice(0, 40)}" here. Use report_verdicts, edit_items, place_items, query_scene, design_plan or finish.`, isError: true });
          continue;
        }
        if (rolledBack) {
          results.push({ type: 'tool_result', toolUseId: call.id, content: 'Not applied: the room was rolled back to its best state because the last round made it worse.', isError: true });
          continue;
        }
        if (!ready()) {
          results.push({ type: 'tool_result', toolUseId: call.id, content: 'Judge first: call report_verdicts for every id (in the same reply is fine), then change things.', isError: true });
          continue;
        }
        if (toolCalls >= run.maxToolCalls) {
          results.push({ type: 'tool_result', toolUseId: call.id, content: 'Tool-call budget of this round used up. Call finish or wait for the next round.', isError: true });
          continue;
        }
        toolCalls++;
        const out = await executeTool(ctx, call.name, call.input);
        for (const ev of out.events) yield ev;
        if (out.edited) edited = true;
        if (out.isError || /refused/i.test(out.content)) refusals.push(`${call.name}: ${out.content.split('\n').slice(0, 3).join(' ').slice(0, 300)}`);
        results.push({ type: 'tool_result', toolUseId: call.id, content: out.content, ...(out.isError ? { isError: true } : {}) });
      }
      messages.push({ role: 'user', content: results });
    }

    if (!standing) {
      yield { type: 'photo', phase: 'unavailable', text: 'The assistant did not judge the render; stopped comparing.' };
      return { judged: last };
    }
    const j: Judged = standing;
    last = j;
    if (!j.panel) yield { type: 'photo', phase: 'round', round, text: `Round ${round}: ${lookLine(j)}.`, score: scoreView(j, !rolledBack) };
    extraWalls = [...new Set(j.score.failing.map((f) => wallOf(desc, f)).filter((w): w is string => w !== null))].slice(0, 2);
    const verdict = tracker.observe({ gain: decision?.gain ?? false, keys: new Set(j.score.failing.map((f) => f.id)) });
    changed = edited && !rolledBack;
    if (j.score.failing.length === 0) {
      yield { type: 'photo', phase: 'round', round, text: 'Every checklist item matches the photo.', score: scoreView(j) };
      return yield* conclude(j, changed);
    }
    if (declared && !edited) {
      const good = j.score.rate >= PHOTO_TARGET_RATE && !j.score.structuralFailed;
      if (!good) yield { type: 'photo', phase: 'round', round, text: 'The assistant stopped with items still different (nothing more it could change with the tools).', score: scoreView(j) };
      return yield* conclude(j, false);
    }
    if (verdict.stalled) {
      yield { type: 'photo', phase: 'round', round, text: `Stopped comparing: ${verdict.reason}.`, score: scoreView(j) };
      return yield* conclude(j, changed);
    }
  }
  round = maxRounds;
  // Out of rounds: edits made in the last one have not been looked at.
  return yield* conclude(last ?? judgedOf(scoreVerdicts(checklist, []), { objective: null, fidelity: null, measure: '' }, null), changed);
}

function parseVerdicts(input: unknown): ItemVerdict[] {
  const p = VerdictInput.safeParse(input);
  if (!p.success) return [];
  const ok: ItemVerdict[] = [];
  for (const raw of p.data.verdicts) {
    const one = ItemVerdict.safeParse(raw);
    if (one.success) ok.push(one.data);
  }
  return ok;
}

/** The wall an unfulfilled checklist item is on, for the straight-on view of the next round. */
function wallOf(desc: RoomDescription, item: ChecklistItem): string | null {
  if (item.target) {
    const o = desc.openings.find((x) => x.id === item.target);
    if (o) return o.wall;
    const it = desc.items.find((x) => x.id === item.target);
    if (it?.wall) return it.wall;
    if (it?.opening) return desc.openings.find((x) => x.id === it.opening)?.wall ?? null;
    if (it?.on) return desc.items.find((x) => x.id === it.on)?.wall ?? null;
    if (it?.above) return desc.items.find((x) => x.id === it.above)?.wall ?? null;
  }
  return null;
}

/** A judge-only call of the model in the conversation on the room as it stands (no fixes), when there is no panel. */
async function finalJudgement(run: PhotoRun, photo: Photo, shot: Shot, checklist: readonly ChecklistItem[], messages: ChatMessage[]): Promise<Scoreboard | null> {
  const blocks: ContentBlock[] = [
    { type: 'text', text: `FINAL CHECK. No more changes: judge the room as it stands now. Call report_verdicts for every id.\nLegend:\n${shot.legend}` },
    { type: 'text', text: 'Image 1: the PHOTO' },
    { type: 'image', dataUrl: photo.dataUrl },
    ...shot.images.flatMap((im, i): ContentBlock[] => [{ type: 'text', text: `Image ${i + 2}: RENDER, ${im.label}` }, { type: 'image', dataUrl: im.dataUrl }]),
  ];
  pushUser(messages, blocks);
  for (let turn = 0; turn < 3; turn++) {
    const res = await ask(run, messages, [VERDICT_TOOL], true);
    messages.push({ role: 'assistant', content: res.content });
    const call = res.content.find((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use' && b.name === VERDICT_TOOL_NAME);
    if (!call) {
      pushUser(messages, [{ type: 'text', text: 'Call report_verdicts now with a verdict for every checklist id.' }]);
      continue;
    }
    const ok = parseVerdicts(call.input);
    if (ok.length > 0) return scoreVerdicts(checklist, ok);
    messages.push({ role: 'user', content: [{ type: 'tool_result', toolUseId: call.id, content: 'No valid verdicts. Send {"verdicts":[{"id","pass","note"}]}.', isError: true }] });
  }
  return null;
}

/** Project name of a room rebuilt from a photo ("Bedroom from a photo"). */
export function photoRoomName(roomType: string): string {
  const label = roomType === 'living' ? 'Living room' : roomType === 'kids' ? "Children's room" : roomType === 'office' ? 'Home office' : roomType.replace(/^./, (c) => c.toUpperCase());
  return `${label} from a photo`;
}
