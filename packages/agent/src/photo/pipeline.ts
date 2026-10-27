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
  scaleAdvisory,
  footprintAdvisory,
  type FidelityReport,
  type FramingReport,
  type FramingTarget,
  deriveBuild,
  fitLayout,
  ItemVerdict,
  MAX_VERDICTS,
  parseRoomDescription,
  RoomDescription as RoomDescriptionSchema,
  photoCameraSpec,
  runBuild,
  sampleRegion,
  sampleSurfaces,
  surfaceColourText,
  surfaceRegions,
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
  nearestFinishes,
  partKinds,
  projectMarks,
  projectOverlays,
  readScene,
  roomAdvice,
  reviewFindings,
  reviewPoses,
  type ReviewPose,
} from '@aether/arch';
import { z } from 'zod';
import { requestView } from '../context';
import { stepLabel } from '../harness';
import { executeTool, raceAbort, runVerification, type ExecutorContext } from '../executor';
import { extractJsonObject } from '../emulation/json';
import { errorMessage } from '../providers/errors';
import type { AgentEvent, PhotoPhase, PhotoResumeState, ChatMessage, CompletionRequest, CompletionResponse, ContentBlock, PhotoAssumptionView, PhotoOptions, PhotoReadsView, PhotoScoreView, ReviewViewRequest, ToolDef } from '../types';
import { DIFFERENCES_TOOL, DIFFERENCES_TOOL_NAME, DifferenceLedger, differenceViews, type Cause, type Difference } from './differences';
import { cropRegions, regionReadout, type CropRegion } from './kit';
import { imageSize } from './image-size';
import { harnessProcedure, ANALYSIS_SYSTEM, CROSSCHECK_SEED, CROSSCHECK_SYSTEM, crossCheckText, differencesProcedure, DESCRIBE_TOOL, DESCRIBE_TOOL_NAME, SAMPLE_TOOL, SAMPLE_TOOL_NAME, VERDICT_TOOL, VERDICT_TOOL_NAME, analysisUserText, compareIntroText, compareRoundText, refusalText } from './prompt';
import { restorePatches } from './revert';
import { applyGrade, estimatePhotoGrade, lookEvidenceText, matchGrade, type PhotoGrade } from './grade';
import { JUDGES_DEFAULT, JUDGES_MAX, ProgressTracker, consensusText, decideRound, runPanel, type Consensus, type Decision, type RoundState } from './judge';
import { CLOSER_TOOL, CLOSER_TOOL_NAME, lookCloser } from './closer';
import { OBJECT_REASON_TOOL, OBJECT_REASON_TOOL_NAME, ObjectLedger, applyReasons, objectsDueText, objectsProcedure, objectsSummary } from './objects';
import { ObjectStage } from './objects-stage';
import type { DepthRaster } from './depth-model';
import type { Perceiver, PerceptionReport } from './perception/perceive';
import { APPLY_COLOUR_TOOL_NAME, PERCEIVE_TOOL_NAME } from './perception/names';
import { MEASURE_TOOL, MEASURE_TOOL_NAME, analysisDepthText, autoAnchor, measureRoom, parseMeasureInput, type Measured } from './measure';
import { compareImages, extractPalette, regionColourScore, type Raster } from './score';
import { runReconcile } from './reconcile';
import { texturePass, texturePassLine, textureSource } from './texture-pass';
import { MAKE_TEXTURE_TOOL } from '../textures';
import { AssumptionsLedger, CAMERA_TOOL, CAMERA_TOOL_NAME, GATE_TOOL, GATE_TOOL_NAME, REPAIR_TOOL, REPAIR_TOOL_NAME, RepairGuard, StageMachine, applyCameraChange, blockerText, buildProvenance, hashDataUrl, BLOCKING_SIZE, type StageSnapshot } from './stages';

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
  /** Images one request may carry (the compare kit shows more than the default); set by the compare loop. */
  imageCap?: number;
  /** The staged harness state of this run (set by the flow when `options.harness` is on). */
  harness?: HarnessState;
}

/** The depth estimate made before the photo is read, for the first message of every reading. */
const depthEvidence = new WeakMap<PhotoRun, Measured>();
/** The perception layer of a run (models and measurements of the photo), created when `options.perception` is on. */
const perceivers = new WeakMap<PhotoRun, Perceiver>();
/** What the first perception pass found, for the first message of every reading. */
const perceiveEvidence = new WeakMap<PhotoRun, { text: string; blocks: ContentBlock[]; report: PerceptionReport }>();
/** The perception layer's code: a separate chunk, loaded when a photo run starts (never on the first visit). */
type PerceptionCode = typeof import('./perception/bundle');
const perceptionCode = new WeakMap<PhotoRun, PerceptionCode>();
/** Load the perception chunk and make the run's perceiver (null: off, or the host cannot decode, or the chunk could not load). */
async function loadPerception(run: PhotoRun): Promise<void> {
  const host = run.ctx.host;
  if (run.options.perception === false || typeof host.decodeImage !== 'function' || process.env['AETHER_PERCEPTION'] === 'off' || perceivers.has(run)) return;
  try {
    const code = await import('./perception/bundle');
    perceptionCode.set(run, code);
    perceivers.set(run, new code.Perceiver({ raster: () => host.decodeImage!(run.image, 1024) }));
  } catch { /* offline with the chunk not cached: the room is built from the picture alone */ }
}
function perceiverOf(run: PhotoRun): Perceiver | null {
  return perceivers.get(run) ?? null;
}
const codeOf = (run: PhotoRun): PerceptionCode => perceptionCode.get(run) as PerceptionCode;
/** The photo as the depth network takes it, or null when depth is off or the host cannot decode. */
function depthSource(run: PhotoRun): (() => Promise<DepthRaster | null>) | null {
  const host = run.ctx.host;
  if (typeof host.decodeImage !== 'function' || process.env['AETHER_DEPTH'] === 'off') return null;
  return () => host.decodeImage!(run.image, 518);
}

/** The books of the staged harness (see stages.ts): stage states, the repair order guard, the assumptions, the round count. */
export interface HarnessState {
  stages: StageMachine;
  guard: RepairGuard;
  assume: AssumptionsLedger;
  rounds: number;
  /** The run continues an earlier one: the world was edited since the plan it was built from. */
  resumed: boolean;
}

/** Model turns allowed inside one analysis (a refused description is sent back to be fixed). */
const ANALYSIS_ATTEMPTS = 3;
/** Most model turns inside one compare round. */
const TURNS_PER_ROUND = 8;

/** Asked in a repair round while the shell size is judged different or a piece is refused for lack of space. */
const SHELL_DUE_TEXT = 'SHELL SIZE is open (judged different, or a piece is refused for lack of space). Answer it this round: resend design_plan with a changed room size, or call declare_repair with keep_shell giving the reason the size stays. Either answer is accepted; leaving it unanswered is not.';
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
const VerdictInput = z.object({ verdicts: z.array(z.unknown()).min(1).max(MAX_VERDICTS), summary: z.string().max(400).optional() });

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
    messages: requestView(messages, ...(run.imageCap ? [run.imageCap] : [])),
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
  if (messages.length === 0) {
    const depth = depthEvidence.get(run);
    const perc = perceiveEvidence.get(run);
    messages.push({ role: 'user', content: [{ type: 'image', dataUrl: run.image }, ...(depth ? [...depth.blocks.filter((b) => b.type === 'image'), { type: 'text' as const, text: analysisDepthText(depth) }] : []), ...(perc ? [...perc.blocks, { type: 'text' as const, text: `${perc.text}\nThese are measurements by detection, segmentation and depth models, not the truth: a label can be wrong and a box can cover the wrong thing. Use them as evidence for what is in the photo (an object listed here that you do not see is probably wrong; one you see that is missing here may have been missed), for colours (compare with what you see) and for sizes, and decide yourself.` }] : []), { type: 'text', text: analysisUserText(run.request) }] });
  }
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
  /** That render decoded small (null when it could not be): for the colour readout of the compare kit. */
  renderRaster: Raster | null;
  /** How the picture's brightness, white point and tone differ from the photo's, as advisory data for `tune_look` ('' when unmeasured). */
  lookEvidence: string;
  /** Standard-size sanity of the built room as advisory text ('' when unmeasured). */
  scale: string;
  /** The photo camera of this render (what the object evidence projects through). */
  cam: ReviewPose;
}

interface Photo {
  dataUrl: string;
  aspect: number;
  raster: Raster | null;
  /** Exposure, white balance and tone read off the photo (null without pixels). */
  grade: PhotoGrade | null;
}

function toRequest(p: ReviewPose, aspect: number, marks: ReviewViewRequest['marks']): ReviewViewRequest {
  return { name: p.name, label: p.label, kind: p.kind, pose: { position: p.position, target: p.target, up: p.up, fov: p.fov }, hideTops: p.hideTops, aspect, marks };
}

/** Door arcs, approach zones and walking paths of the photo room, projected onto a plan image (advisory evidence). */
function planOverlays(world: WorldDoc, pose: ReviewPose, aspect: number): NonNullable<ReviewViewRequest['overlays']> {
  const scene = readScene(world, PHOTO_BUILDING_ID);
  const room = scene?.rooms.find((r) => r.key === PHOTO_ROOM_ID);
  if (!scene || !room) return [];
  return projectOverlays(world, PHOTO_BUILDING_ID, pose, roomAdvice(scene, room).overlays, room.levelId, aspect);
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
  // The room from above with the door arcs, approach zones and walking paths drawn on it: evidence for what to move or enlarge.
  if (views.length < maxViews) {
    const plan = reviewPoses(world, PHOTO_BUILDING_ID, { rooms: [PHOTO_ROOM_ID], maxViews: 12, aspect: 1.5 }).find((p) => p.kind === 'plan');
    if (plan) {
      const m = projectMarks(world, PHOTO_BUILDING_ID, plan, 1.5);
      for (const k of m) shown.add(k.n);
      const req = toRequest(plan, 1.5, m);
      const ov = planOverlays(world, plan, 1.5);
      if (ov.length > 0) req.overlays = ov;
      views.push(req);
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
  let lookEvidence = '';
  let renderRaster: Raster | null = null;
  const cleanShot = got.find((x) => x.name === clean.name);
  if (cleanShot && photo.raster && host.decodeImage) {
    const r = await host.decodeImage(cleanShot.dataUrl, 256).catch(() => null);
    if (r) {
      renderRaster = r;
      // The render is graded like the photo (white point, tone) before the pixel similarity is measured, so a correct room with
      // another exposure or light colour is not punished for it. Nothing is changed in the world here: how the look should move
      // is the assistant's decision (tune_look), made from the two pictures; the measured difference is handed over as data.
      const renderGrade = photo.grade ? estimatePhotoGrade(r) : null;
      const match = photo.grade && renderGrade ? matchGrade(photo.grade, renderGrade) : null;
      const graded = match ? applyGrade({ ...r, data: r.data.slice() }, match) : r;
      similarity = compareImages(photo.raster, graded)?.overall ?? null;
      // The surfaces the description boxes (walls, floor, ceiling) are compared at the same place in both pictures (the render is
      // taken from the photo's camera), next to the pieces the framing matched.
      const surfacePairs = surfaceRegions(desc0).map((s) => ({ want: s.box, got: s.box }));
      regionColour = regionColourScore(photo.raster, graded, [...(framing?.rows ?? []), ...surfacePairs]);
      if (photo.grade && renderGrade && match) lookEvidence = lookEvidenceText(world, photo.grade, renderGrade, match);
    }
  }
  // The deterministic measures of the room as it was rendered (the world before the grade patches above, which do not move anything).
  const fidelity = measureFidelity(world, desc0, { framing, similarity, regionColour });
  const objective = fidelity?.score ?? null;
  const measure = fidelity ? fidelityLine(fidelity) : [framing ? `framing ${Math.round(framing.score * 100)}%` : '', similarity !== null ? `similarity ${Math.round(similarity * 100)}%` : ''].filter(Boolean).join(', ');
  return { images, legend: legendText(markIndex(world, PHOTO_BUILDING_ID), shown), objective, measure, framing, fidelity, clean: cleanShot?.dataUrl ?? null, renderRaster, lookEvidence, scale: scaleAdvisory(world), cam };
}

/** The room from above for `look_closer`: the level plan with its numbered pieces, and the legend of the numbers. */
async function planShot(run: PhotoRun, aspect: number): Promise<{ dataUrl: string; legend: string } | null> {
  const { host } = run.ctx;
  if (typeof host.captureReview !== 'function') return null;
  const world = host.getWorld();
  const pose = reviewPoses(world, PHOTO_BUILDING_ID, { rooms: [PHOTO_ROOM_ID], maxViews: 12, aspect: Math.max(1, Math.min(1.5, aspect)) }).find((p) => p.kind === 'plan');
  if (!pose) return null;
  const asp = Math.max(1, Math.min(1.5, aspect));
  const marks = projectMarks(world, PHOTO_BUILDING_ID, pose, asp);
  const shown = new Set(marks.map((m) => m.n));
  const req = toRequest(pose, asp, marks);
  const overlays = planOverlays(world, pose, asp);
  if (overlays.length > 0) req.overlays = overlays;
  const got = await raceAbort(host.captureReview([req], run.ctx.signal ? { signal: run.ctx.signal } : {}), run.ctx.signal);
  const img = got[0];
  return img ? { dataUrl: img.dataUrl, legend: legendText(markIndex(world, PHOTO_BUILDING_ID), shown) } : null;
}

/** What one look at the room came to: the judgement (the panel's, or the single judge's) and the measures. */
interface Judged {
  score: Scoreboard;
  objective: number | null;
  fidelity: FidelityReport | null;
  /** Judge score 0..1: the panel's median rubric score, or the single judge's pass rate. */
  judge: number;
  measure: string;
  /** The panel's consensus (null: the model in the conversation judged). */
  panel: Consensus | null;
}

function judgedOf(sb: Scoreboard, shot: Pick<Shot, 'objective' | 'fidelity' | 'measure'>, panel: Consensus | null): Judged {
  const judge = panel ? panel.judge : sb.rate;
  return { score: sb, objective: shot.objective, fidelity: shot.fidelity, judge, measure: shot.measure, panel };
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
    judgedBy: j.panel ? 'panel' : 'assistant',
    ...(accepted !== undefined ? { accepted } : {}),
    structuralFailed: sb.structuralFailed,
    failing: sb.failing.slice(0, 24).map((f) => ({ id: f.id, text: f.text.slice(0, 160), note: f.note.slice(0, 200) })),
  };
}

/** The numbers of a look in one line, saying who judged ("3 AI judges 11/17 pass (65%), score 72%; measured (advisory) framing 75%, …"). */
function lookLine(j: Judged): string {
  return `${j.panel ? `${j.panel.samples} AI judges ${scoreLine(j.score)}, score ${Math.round(j.judge * 100)}%` : `the assistant judged ${scoreLine(j.score)}`}${j.measure ? `; measured (advisory) ${j.measure}` : ''}`;
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
  return { dataUrl: run.image, aspect: Math.max(0.5, Math.min(3, aspect)), raster, grade: raster ? estimatePhotoGrade(raster) : null };
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
  await loadPerception(run);
  const { ctx } = run;
  const host = ctx.host;
  const hs: HarnessState | null = run.options.harness === true ? { stages: new StageMachine(), guard: new RepairGuard(), assume: new AssumptionsLedger(), rounds: 0, resumed: false } : null;
  if (hs) run.harness = hs;
  const stageEv = (text: string, phase: PhotoPhase = 'stage'): AgentEvent => ({ type: 'photo', phase, text, ...(hs ? { stages: hs.stages.views() } : {}) });
  // Stage 1: what this run can do. A missing connected assistant or vision is a blocker named exactly; nothing is built behind it.
  if (hs) hs.stages.begin('capability');
  const noAssistant = ctx.provider.name === 'mock' ? 'a connected assistant (the offline planner is active; it cannot look at images)' : !visionOn(run.options) ? 'a connected assistant that can look at images' : '';
  if (noAssistant) {
    if (hs) {
      const b = { kind: 'capability' as const, stage: 'capability' as const, text: `this run needs ${noAssistant}.`, unblock: 'connect an assistant that supports images in Settings, or describe the room in words.' };
      hs.assume.block(b);
      hs.stages.block('capability', blockerText(b));
      yield stageEv(blockerText(b));
    }
    yield* offline(run, ctx.provider.name === 'mock' ? 'The offline planner is active.' : 'The connected assistant cannot look at images.');
    return;
  }
  if (hs) {
    const lacks = [typeof host.captureReview !== 'function' ? 'no renderer for the photo camera (the room is built but not compared)' : '', typeof host.composeImages !== 'function' ? 'no side-by-side or crops' : '', typeof host.decodeImage !== 'function' ? 'no pixel readout' : ''].filter(Boolean);
    hs.stages.pass('capability', `A connected assistant that sees images is available${lacks.length > 0 ? `; limits: ${lacks.join(', ')}` : '; render, crops and pixel readout are available'}.`);
    hs.stages.begin('evidence');
    yield stageEv(`Capability check passed.${lacks.length > 0 ? ` Limits: ${lacks.join('; ')}.` : ''}`);
  }
  const hash = hs ? await hashDataUrl(run.image) : null;
  const resume = hs ? validResume(run, hash) : null;
  if (hs && resume) {
    yield* resumeRun(run, hs, resume, hash);
    return;
  }
  yield { type: 'status', text: 'Reading the photo…' };
  yield { type: 'photo', phase: 'analysing', text: 'Reading the photo: room size, walls, windows, furniture, colours and light.' };
  const photo = await decodePhoto(run);
  // The depth network runs before the photo is read, so the first shell size is informed (advisory; skipped silently when it cannot run).
  const source = depthSource(run);
  if (source) {
    const m = await measureRoom({ raster: source }, undefined).catch(() => null);
    if (m?.estimate) {
      depthEvidence.set(run, m);
      yield { type: 'step', tool: MEASURE_TOOL_NAME, label: `Depth estimate before the first shell: ${m.estimate.width.value} × ${m.estimate.depth.value} × ${m.estimate.height.value} m (${m.estimate.scale.basis} scale; width a lower bound)`, ok: true };
    }
  }
  const perceiver = perceiverOf(run);
  if (perceiver) {
    const mb = await codeOf(run).perceptionDownloadMb().catch(() => 0);
    yield { type: 'status', text: mb > 0 ? `Measuring the photo. First use: fetching the measuring models (about ${mb} MB, checked and kept on this machine; offline they are skipped). To skip them: set aether.perception to off in the browser local storage (AETHER_PERCEPTION=off from the command line); the room is then built from the picture alone.` : 'Measuring the photo (detection, labels, masks, depth, room box)…' };
    const got = await codeOf(run).perceivePhoto(perceiver, { find: [] }, true).catch(() => null);
    if (got && !got.isError && got.report) {
      perceiveEvidence.set(run, { text: got.text, blocks: got.blocks, report: got.report });
      yield { type: 'step', tool: PERCEIVE_TOOL_NAME, label: `Measured the photo: ${got.report.objects.length} objects${got.report.room ? `, room about ${got.report.room.width.value} x ${got.report.room.depth.value} x ${got.report.room.height.value} m` : ''}`, ok: true };
    } else if (got) {
      yield { type: 'step', tool: PERCEIVE_TOOL_NAME, label: got.text.slice(0, 160), ok: false };
    }
  }
  let analysis: Reading;
  try {
    analysis = await readPhoto(run);
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
    if (e instanceof Unavailable) {
      yield* offline(run, ctx.provider.name === 'mock' ? 'The connected assistant is not available (the offline planner took over).' : 'The connected assistant cannot look at images.');
      return;
    }
    if (hs) hs.stages.block('evidence', `Could not read the photo: ${errorMessage(e).slice(0, 200)}`);
    yield { type: 'error', text: `Could not read the photo: ${errorMessage(e).slice(0, 400)}` };
    return;
  }
  if (!analysis.ok) {
    if (hs) {
      hs.stages.block('evidence', `The assistant could not describe the photo as a valid room (${analysis.error.slice(0, 160)}).`);
      yield stageEv('Evidence stage blocked: the photo was not described as a valid room. Nothing was built.');
    }
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
  if (hs) fillAssumptions(hs, assumptions, 'evidence');
  yield { type: 'photo', phase: 'described', text: `${desc.summary || `A ${desc.roomType} of about ${desc.footprint.width} × ${desc.footprint.depth} m.`}${readText ? ` ${readText}` : ''}`, assumptions, reads: analysis.view, ...(hs ? { stages: hs.stages.views() } : {}) };
  if (hs) for (const id of ['camera', 'shell', 'furniture'] as const) hs.stages.begin(id);

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
        if (hs) fillAssumptions(hs, assumptions, 'shell');
        built = await runBuild(host.getWorld(), build, caller);
      }
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      if (!(e instanceof Unavailable)) yield { type: 'error', text: `Could not correct the description: ${errorMessage(e).slice(0, 300)}` };
    }
  }
  for (const ev of events) yield ev;
  if (!built.shellOk) {
    if (hs) {
      hs.stages.fail('shell', `The builder refused the shell: ${built.shellText.slice(0, 200)}`);
      yield stageEv('Shell stage failed: the builder refused it.');
    }
    yield { type: 'error', text: `The shell was refused: ${built.shellText.slice(0, 600)}` };
    return;
  }
  if (hs) hs.stages.begin('lighting');
  const env = host.applyPatches([{ op: 'setEnvironment', set: build.environment }], 'Light of the photo');
  if (env.errors.length === 0 && env.applied.length > 0) yield { type: 'patches', patches: env.applied, message: 'Light of the photo', result: { applied: env.applied.length, errors: [] } };
  const refusals = built.outcomes.filter((o) => !o.ok).map((o) => `${o.id} (${o.kind}): ${o.text}`.slice(0, 1400));
  yield { type: 'photo', phase: 'built', text: `Built. ${built.outcomes.filter((o) => o.ok).length} of ${built.outcomes.length} pieces placed${refusals.length > 0 ? `; ${refusals.length} refused and handed to the compare loop: ${refusals.map((r) => r.slice(0, 200)).join(' | ')}` : ''}.` };

  if (hs) hs.stages.begin('materials');
  // Textures: the surfaces the photograph shows clearly are sampled from it before the first comparison.
  let textureLine = '';
  try {
    const source = await textureSource(ctx, run.image, desc);
    if (source) {
      ctx.textures = { ...(ctx.textures ?? {}), photo: source };
      const pass = yield* texturePass(ctx, source);
      textureLine = texturePassLine(pass);
      if (textureLine) yield { type: 'photo', phase: 'textures', text: textureLine };
    }
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
    yield { type: 'photo', phase: 'textures', text: `Textures from the photo were skipped (${errorMessage(e).slice(0, 160)}); the room keeps its procedural finishes.` };
  }

  yield* repairAndDeliver(run, photo, desc, built.openings, checklist, build, refusals, assumptions, textureLine, hash);
}

/** Record the assumption chips of the description in the harness' assumptions ledger. */
function fillAssumptions(hs: HarnessState, chipsList: readonly PhotoAssumptionView[], stage: 'evidence' | 'shell'): void {
  for (const a of chipsList) hs.assume.add({ id: a.id, text: a.text, confidence: a.confidence, stage, adjust: a.adjust, kind: AssumptionsLedger.kindOf(a.text) });
}

/** A resume state that applies to this photo and this world, or null. */
function validResume(run: PhotoRun, hash: string | null): { state: PhotoResumeState; desc: RoomDescription } | null {
  const r = run.options.resume;
  if (!r || r.version !== 1 || !hash || r.sha256 !== hash) return null;
  const parsed = RoomDescriptionSchema.safeParse(r.description);
  if (!parsed.success) return null;
  if (!Object.keys(run.ctx.host.getWorld().entities).some((id) => id.startsWith(PHOTO_BUILDING_ID))) return null;
  return { state: r, desc: parsed.data };
}

/** Continue an earlier run at the repair stage: the room is in the world, the books come back from the saved state. */
async function* resumeRun(run: PhotoRun, hs: HarnessState, resume: { state: PhotoResumeState; desc: RoomDescription }, hash: string | null): AsyncGenerator<AgentEvent> {
  const { state, desc } = resume;
  hs.stages = StageMachine.restore(state.stages as StageSnapshot);
  hs.assume = AssumptionsLedger.restore(state.assumptions as ReturnType<AssumptionsLedger['snapshot']>);
  hs.rounds = state.rounds;
  hs.resumed = true;
  hs.guard.log.push(...state.repairs.map((r) => ({ round: r.round, difference: r.difference, cause: r.cause as Cause, why: r.why })));
  for (const id of ['repair', 'crosscheck', 'delivery'] as const) hs.stages.reset(id);
  const ledger = new DifferenceLedger();
  ledger.restore(state.differences as ReturnType<DifferenceLedger['snapshot']>);
  const savedObjects = ObjectLedger.restore(state.objects);
  savedObjects?.resume();
  const build = deriveBuild(desc);
  build.notes.push('This is a continued run: the room in the world may have been edited since it was first built, so judge the renders, not the plan.');
  const photo = await decodePhoto(run);
  const assumptions = chips(desc, build, []);
  yield { type: 'photo', phase: 'stage', text: `Continuing the repair of this room at round ${state.rounds + 1}: ${ledger.ranked().length} open difference${ledger.ranked().length === 1 ? '' : 's'}, ${hs.assume.list().length} assumptions kept.`, stages: hs.stages.views() };
  yield* repairAndDeliver(run, photo, desc, state.openings, buildChecklist(desc), build, [], assumptions, '', hash, ledger, savedObjects);
}

/** The text of the repair order for the model: open differences by cause class, then size. */
function repairOrderText(open: readonly Difference[]): string {
  if (open.length === 0) return '';
  const first = RepairGuard.earliestBlocking(open);
  return `Repair order (camera, then geometry, then materials, then lighting; declare_repair before each edit):\n${RepairGuard.repairOrder(open).slice(0, 10).map((d, i) => `${i + 1}. ${d.id} [${d.cause}, size ${d.size}]`).join('\n')}${first ? `\nWork on ${first} first: a difference of size ${BLOCKING_SIZE} or more is open there.` : ''}`;
}

/** Compare, repair, cross-check, verify and close. The stages after the build; also where a continued run starts. */
async function* repairAndDeliver(run: PhotoRun, photo: Photo, desc: RoomDescription, openings: Readonly<Record<string, string>>, checklist: readonly ChecklistItem[], build: PhotoBuild, refusals: readonly string[], assumptions: PhotoAssumptionView[], textureLine: string, hash: string | null, ledger0: DifferenceLedger | null = null, objects0: ObjectLedger | null = null): AsyncGenerator<AgentEvent> {
  const { ctx } = run;
  const host = ctx.host;
  const hs = run.harness ?? null;
  const stageEv = (text: string): AgentEvent => ({ type: 'photo', phase: 'stage', text, ...(hs ? { stages: hs.stages.views() } : {}) });
  const ledger = ledger0 ?? (run.options.differences === true || hs ? new DifferenceLedger() : null);
  // A piece the first build refused for lack of space is a geometry difference until the model places it (widening the shell), not a piece to drop.
  if (ledger && !ledger0) for (const r of refusals) { const m = /^(\S+) \((\S+)\): .*Space evidence/.exec(r); if (m) ledger.seed(m[1] as string, `the ${m[2]} was refused for lack of space in the first build and is not in the room: widen the shell (see the space evidence) and place it again`); }
  const targets = framingTargets(desc, openings);
  const objects = run.options.objects === true && ledger ? makeObjects(run, photo, objects0) : null;
  let final: Judged | null = null;
  let finalNote = '';
  if (hs) {
    hs.stages.begin('repair');
    yield stageEv('Compare and repair: camera first, then geometry, materials and lighting.');
  }
  try {
    const loop = yield* compareLoop(run, photo, desc, targets, checklist, build, refusals, ledger, objects);
    final = loop.judged;
    finalNote = loop.note ?? '';
    if (hs && !hs.stages.blocker()) {
      const big = ledger?.ranked().filter((d) => d.size >= BLOCKING_SIZE) ?? [];
      if (!final) hs.stages.skip('repair', 'No render of the room could be made, so it was not compared.');
      else if (final.score.failing.length === 0 && (objects?.open() ?? 0) > 0) hs.stages.fail('repair', `The checklist passes but ${objects!.open()} object aspect${objects!.open() === 1 ? '' : 's'} still fail without a stated reason.`);
      else if (final.score.failing.length === 0) hs.stages.pass('repair', `Every checklist item matches the photo${objects && objects.ready ? (objects.ledger.waivedCount() > 0 ? ` and every inventoried object passes or is waived (${objects.ledger.waivedCount()} waived: not passes)` : ' and every inventoried object passes') : ''}.`);
      else if (big.length === 0) hs.stages.pass('repair', `No open difference of size ${BLOCKING_SIZE} or more; ${final.score.failing.length} smaller item${final.score.failing.length === 1 ? '' : 's'} left.`);
      else hs.stages.fail('repair', `${big.length} difference${big.length === 1 ? '' : 's'} of size ${BLOCKING_SIZE} or more still open: ${big.slice(0, 3).map((d) => d.id).join(', ')}.`);
      yield stageEv(`Repair stage: ${hs.stages.status('repair')}.`);
    }
    if (ledger && run.options.crossCheck === true) {
      hs?.stages.begin('crosscheck');
      const before = ledger.ranked().filter((d) => d.source === 'independent').length;
      yield* crossCheck(run, photo, desc, targets, ledger);
      const found = ledger.ranked().filter((d) => d.source === 'independent').length - before;
      if (hs) {
        hs.stages.pass('crosscheck', found > 0 ? `A fresh seat listed ${found} difference${found === 1 ? '' : 's'} that the fixing conversation did not.` : 'A fresh seat found nothing new beyond the ledger.');
        yield stageEv('Cross-check done.');
      }
    } else hs?.stages.skip('crosscheck', 'Not switched on for this run.');
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
    if (!(e instanceof Unavailable)) yield { type: 'error', text: `The compare loop stopped: ${errorMessage(e).slice(0, 300)}. The room as built so far is kept.` };
    else yield { type: 'photo', phase: 'unavailable', text: 'The assistant became unavailable during the comparison; the room as built so far is kept.' };
    if (hs) {
      if (hs.stages.status('repair') === 'active') hs.stages.fail('repair', 'The assistant stopped during the comparison; continue the run to repair further.');
      if (hs.stages.status('crosscheck') === 'active') hs.stages.fail('crosscheck', 'The assistant stopped before the cross-check finished.');
    }
  }

  // Verification of the room as it stands (the walkthrough test the shell carries).
  yield { type: 'status', text: 'Verifying the room…' };
  hs?.stages.begin('delivery');
  const v = await runVerification(ctx);
  yield v.event;
  const findings = reviewFindings(host.getWorld(), PHOTO_BUILDING_ID).filter((f) => f.severity === 'error');
  const lines: string[] = [];
  const stop = hs?.stages.blocker() ?? null;
  if (stop) lines.push(`Stopped: the ${stop.stage} stage is blocked. ${stop.text}`);
  if (final) {
    const s = final.score;
    lines.push(`Rebuilt the room from your photo: ${s.passed} of ${s.total} checklist items match${final.panel ? ` (judged by ${final.panel.samples} independent AI judges, median per item)` : ' (judged by the assistant that built it)'}${final.objective !== null ? `; the deterministic checks measure ${Math.round(final.objective * 100)}% (advisory, not the verdict)` : ''}.`);
    if (finalNote) lines.push(finalNote);
    if (s.failing.length > 0) lines.push(`Still different: ${s.failing.slice(0, 5).map((f) => `${f.id}${f.note && f.note !== 'not judged' ? ` (${f.note.slice(0, 80)})` : ''}`).join('; ')}.`);
  } else lines.push('Rebuilt the room from your photo (not compared with it: no renders were available).');
  const objLine = objects && objects.ready ? objectsSummary(objects.ledger) : '';
  if (objLine) lines.push(objLine);
  const open = ledger?.unresolvedText() ?? '';
  if (open) lines.push(open);
  if (findings.length > 0) lines.push(`The checker still reports ${findings.length} problem${findings.length === 1 ? '' : 's'}.`);
  if (textureLine) lines.push(textureLine);
  lines.push(`I assumed ${assumptions.length} thing${assumptions.length === 1 ? '' : 's'} the photo cannot show; each one is listed with a one-tap way to change it.`);
  let extra: Record<string, unknown> = {};
  if (hs) {
    if (v.passed) hs.stages.pass('delivery', `Walkthrough verification passed. ${v.summary.slice(0, 160)}`);
    else hs.stages.fail('delivery', `Verification did not pass: ${v.summary.slice(0, 200)}`);
    const unfinished = hs.stages.unfinishedText();
    if (unfinished) lines.push(unfinished);
    const size = imageSize(run.image);
    const scale = hs.assume.list().find((a) => a.kind === 'scale');
    const provenance = buildProvenance({
      hash,
      size: size ? { width: size.width, height: size.height } : null,
      ...(run.options.permission ? { permission: run.options.permission } : {}),
      footprint: desc.footprint,
      scaleBasis: scale?.text ?? 'Estimated from the photo (door, window and furniture proportions).',
      assumptions: hs.assume.list(),
      stages: hs.stages.views(),
      repairs: hs.guard.log,
      open: ledger?.ranked() ?? [],
      rounds: hs.rounds,
      models: ctx.usage.models ?? [],
      exports: ['playable project', 'GLB (portable)', 'provenance (JSON)'],
    });
    const resume: PhotoResumeState = { version: 1, sha256: hash, description: desc, openings: { ...openings }, stages: hs.stages.snapshot(), assumptions: hs.assume.snapshot(), differences: ledger?.snapshot() ?? null, ...(objects && objects.ready ? { objects: objects.ledger.snapshot() } : {}), ...(perceiveEvidence.get(run) ? { perception: perceiveEvidence.get(run)?.report } : {}), repairs: hs.guard.log.map((r) => ({ ...r })), rounds: hs.rounds };
    extra = { stages: hs.stages.views(), provenance, resume };
  }
  yield { type: 'photo', phase: 'done', text: lines.join(' '), assumptions, ...(final ? { score: scoreView(final) } : {}), ...(ledger && ledger.ranked().length > 0 ? { differences: differenceViews(ledger.ranked()) } : {}), ...(objects && objects.ready ? { objects: objects.views() } : {}), ...extra };
  yield { type: 'message', text: lines.join(' ') };
}

/** The object stage of a run: the inventory and the per-object judge, with the host's drawing and editing. */
function makeObjects(run: PhotoRun, photo: Photo, saved: ObjectLedger | null): ObjectStage {
  const host = run.ctx.host;
  const size = imageSize(run.image);
  const signal = run.ctx.signal;
  return new ObjectStage(
    {
      complete: (req) => complete(run, req),
      judges: Math.max(1, judgesOf(run.options)),
      photoUrl: photo.dataUrl,
      px: size ? { w: size.width, h: size.height } : { w: 1000, h: Math.round(1000 / photo.aspect) },
      compose: host.composeImages ? host.composeImages.bind(host) : undefined,
      boxesShot: typeof host.captureReview === 'function'
        ? async (pose, marks) => {
            const req = toRequest(pose, photo.aspect, marks.map((m) => ({ n: m.n, x: (m.box[0] + m.box[2]) / 2, y: (m.box[1] + m.box[3]) / 2, w: (m.box[2] - m.box[0]) / 2, h: (m.box[3] - m.box[1]) / 2 })));
            req.name = 'photo-camera-boxes';
            const got = await raceAbort(host.captureReview!([req], signal ? { signal } : {}), signal);
            return got[0]?.dataUrl ?? null;
          }
        : undefined,
      getWorld: () => host.getWorld(),
      applyPatches: (p, m) => host.applyPatches(p, m),
      ...(perceiverOf(run) ? { seed: codeOf(run).seedInventory, compare: codeOf(run).compareObjects } : {}),
      ...(perceiverOf(run) ? { perceive: async (labels: string[]) => (await perceiverOf(run)?.run({ find: labels }).catch(() => null)) ?? null } : {}),
      ...(perceiverOf(run) ? { report: () => perceiverOf(run)?.report() ?? perceiveEvidence.get(run)?.report ?? null } : {}),
      ...(perceiverOf(run) ? {
        like: async (object: string) => {
          const pc = perceiverOf(run) as Perceiver;
          const emb = pc.embeddingOf(object);
          if (!emb) return null;
          const sim = await codeOf(run).similarModelsText(emb, 3, '');
          return sim.ids.length > 0 ? `Library models that look like this crop (find_model like_crop:"${object}" for the facts): ${sim.ids.join(', ')}.` : null;
        },
      } : {}),
      ...(run.options.objectRounds !== undefined ? { maxRounds: run.options.objectRounds } : {}),
      ...(signal ? { signal } : {}),
    },
    saved,
  );
}

interface LoopResult {
  /** The judgement of the room as it ends up (null: it was never judged). */
  judged: Judged | null;
  /** What the final best-against-last comparison decided, in words for the user (absent: no such comparison was needed). */
  note?: string;
}

/** A state the loop accepted: the room, its render and its judgement. */
interface Accepted {
  world: WorldDoc;
  /** The photo camera at that state (the harness lets the model move it). */
  camera: RoomDescription['camera'];
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
async function* compareLoop(run: PhotoRun, photo: Photo, desc: RoomDescription, targets: readonly FramingTarget[], checklist: readonly ChecklistItem[], build: PhotoBuild, firstRefusals: readonly string[], ledger: DifferenceLedger | null = null, objects: ObjectStage | null = null): AsyncGenerator<AgentEvent, LoopResult> {
  const { ctx } = run;
  const kitOn = ledger !== null || (run.options.crops ?? 0) > 0;
  const host = ctx.host;
  // No fixed ceiling unless the host sets one (paid keys): the loop ends on agreement, on nothing left to change, or on a stall.
  const cap = run.options.maxRounds;
  const maxRounds = cap === undefined || !Number.isFinite(cap) ? PHOTO_ROUNDS_CEILING : Math.max(1, Math.min(PHOTO_ROUNDS_CEILING, Math.floor(cap)));
  const maxViews = Math.max(1, Math.min(4, Math.floor(run.options.maxViews ?? 3)));
  const judges = judgesOf(run.options);
  const tracker = new ProgressTracker(run.options.stallRounds ?? 3);
  const designTools = run.tools.filter((t) => isDesignTool(t.name));
  const hs = run.harness ?? null;
  const baseRounds = hs?.rounds ?? 0;
  /** The photo for the depth network (null without a host decoder: the measure tool is then not offered). */
  const depthRaster = depthSource(run);
  let depthFirst: Promise<Measured> | null = null;
  const tools: ToolDef[] = [VERDICT_TOOL, ...(ledger ? [DIFFERENCES_TOOL] : []), ...(hs ? [GATE_TOOL, ...(ledger ? [REPAIR_TOOL] : []), CAMERA_TOOL] : []), ...(photo.raster ? [SAMPLE_TOOL] : []), ...(objects ? [OBJECT_REASON_TOOL] : []), CLOSER_TOOL, ...(depthRaster ? [MEASURE_TOOL] : []), ...(perceiverOf(run) ? [codeOf(run).PERCEIVE_TOOL, ...(objects ? [codeOf(run).APPLY_COLOUR_TOOL] : [])] : []), ...designTools, ...(run.ctx.textures?.photo ? [MAKE_TEXTURE_TOOL] : []), ...run.tools.filter((t) => t.name === 'tune_look' || t.name === 'finish' || t.name === 'find_model')];
  const messages: ChatMessage[] = [];
  /** Where progress is measured from: with a panel, the last state the judges preferred; without, the best state. */
  // (Written through `settle`, so the declared type is spelled out: control flow would otherwise narrow it to null.)
  let accepted = null as Accepted | null;
  let last: Judged | null = null;
  /**
   * The best state by the judges' own word: the first look, then every state they found closer than the accepted one (or
   * whose median score rose). A tie is accepted, so `accepted` can drift below this; the end of the loop asks the judges.
   */
  let best = null as Accepted | null;
  /** The room changed since the accepted state (so the next look has to be judged). */
  let changed = true;
  let refusals: string[] = [...firstRefusals];
  let extraWalls: string[] = [];
  let intro = true;
  let round = 0;

  const revertTo = (target: WorldDoc, why: string, camera?: RoomDescription['camera']): boolean => {
    if (camera) Object.assign(desc.camera, camera);
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
  const settle = (cand: Judged, world: WorldDoc, shot: Shot, at: number, said: Consensus['preference'] = null): { decision: Decision; standing: Judged; rejected: Accepted | null } => {
    const ref = accepted;
    // The side-by-side verdict is the LLM's: the panel's, or the fixing model's own `closer` when it judged alone.
    let decision = decideRound(ref ? stateOf(ref.judged) : null, stateOf(cand), cand.panel?.preference ?? said);
    // With the object table a whole-frame preference for the old state does not throw away a round of repairs: it is a single noisy
    // vote on about twenty items, while the objects are judged one by one and each one that got worse is put back to its best.
    // The end of the loop still compares the last state with the best one.
    if (!decision.accept && objects && objects.ready) decision = { ...decision, accept: true, reason: `${decision.reason}; kept, because the per-object judgement decides which objects are put back` };
    if (decision.accept) {
      accepted = { world, round: at, shot, judged: cand, camera: { ...desc.camera } };
      if (decision.gain || !best) best = accepted;
      return { decision, standing: cand, rejected: null };
    }
    if (ref && revertTo(ref.world, `Back to round ${ref.round}`, ref.camera)) return { decision, standing: ref.judged, rejected: ref };
    return { decision: { ...decision, accept: true }, standing: cand, rejected: null };
  };

  /** End of the loop: edits made after the last judged render are judged once more, and kept only when accepted. */
  async function* conclude(j: Judged, unjudgedEdits: boolean): AsyncGenerator<AgentEvent, LoopResult> {
    const res = yield* concludeEdits(j, unjudgedEdits);
    return yield* pickBest(res);
  }

  /**
   * Ties are accepted, so a run of them can leave the room below the best state seen. When the state the loop ends on is
   * not the best one, the judges look at the two renders side by side (the last against the best) and the room is the
   * one they find closer; on a tie it stays as it is. The model decides; no score is compared here.
   */
  async function* pickBest(res: LoopResult): AsyncGenerator<AgentEvent, LoopResult> {
    const cur = accepted;
    const top = best;
    if (judges === 0 || !cur || !top || cur === top || res.judged === null) return res;
    const a = cur.shot.clean ?? cur.shot.images[0]?.dataUrl;
    const b = top.shot.clean ?? top.shot.images[0]?.dataUrl;
    if (!a || !b) return res;
    let pref: Consensus['preference'] = null;
    let n = 0;
    try {
      const out = await runPanel((req) => complete(run, req), { photo: photo.dataUrl, current: a, previous: b, checklist, judges, maxTokens: Math.min(run.maxTokens, 8000) });
      pref = out.consensus?.preference ?? null;
      n = out.consensus?.samples ?? 0;
    } catch (e) {
      if (ctx.signal?.aborted || e instanceof Unavailable) throw e;
    }
    if (pref === null) return res;
    const who = `${n} AI judge${n === 1 ? '' : 's'}`;
    if (pref === 'previous' && revertTo(top.world, `Back to the best state, round ${top.round}`, top.camera)) {
      accepted = top;
      const note = `At the end the ${who} compared the last state (round ${cur.round}) with the best one seen (round ${top.round}) side by side and found the best closer to the photo; the room is the best one.`;
      yield { type: 'photo', phase: 'round', text: note, score: scoreView(top.judged, true) };
      return { judged: top.judged, note };
    }
    const note = `At the end the ${who} compared the last state (round ${cur.round}) with the best one seen (round ${top.round}) side by side and ${pref === 'current' ? 'found the last closer to the photo' : 'could not tell them apart'}; the last state is kept.`;
    yield { type: 'photo', phase: 'round', text: note, score: scoreView(res.judged) };
    return { ...res, note };
  }

  async function* concludeEdits(j: Judged, unjudgedEdits: boolean): AsyncGenerator<AgentEvent, LoopResult> {
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
  // Every element the photo shows, listed twice (the second list blind) and reconciled; nothing is dropped between rounds.
  if (objects && !objects.ready) {
    try {
      yield* objects.inventory(desc.summary || desc.roomType);
    } catch (e) {
      if (ctx.signal?.aborted || e instanceof Unavailable) throw e;
      yield { type: 'photo', phase: 'round', text: `The object inventory could not be made (${errorMessage(e).slice(0, 160)}); the room is judged by the checklist alone.` };
    }
  }
  for (round = 1; round <= maxRounds; round++) {
    if (ctx.signal?.aborted) throw new Error('aborted');
    if (hs) {
      hs.guard.newRound(baseRounds + round);
      hs.rounds = baseRounds + round;
    }
    yield { type: 'status', text: round === 1 ? 'Comparing the render with the photo…' : `Compare round ${round}…` };
    const shot = await snapshot(run, photo, desc, targets, extraWalls, maxViews, judges > 0 || kitOn).catch((e) => {
      if (ctx.signal?.aborted) throw e;
      return null;
    });
    if (!shot) {
      yield { type: 'photo', phase: 'unavailable', text: 'No render of the room could be made here, so it was not compared with the photo.' };
      return yield* pickBest({ judged: last });
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
          ledger?.clearEdited();
          rejectNote = `Your last changes were rolled back to the state of round ${s.rejected.round}: ${s.decision.reason}. The images below show that state. Try a different, smaller fix.`;
          yield { type: 'photo', phase: 'round', round, text: `Round ${round} was not kept (${s.decision.reason}): back to round ${s.rejected.round}.`, score: scoreView(cand, false) };
        }
        yield { type: 'photo', phase: 'round', round, text: `Round ${round}: ${lookLine(standing)}.`, score: scoreView(standing, s.rejected === null) };
      }
    }

    // Each object on its own: the objects whose render changed (and their neighbours) are judged by the panel; what got worse is put back.
    let objGain = false;
    let objReverted = false;
    if (objects && objects.ready && view === shot && shot.clean) {
      try {
        const r = yield* objects.round({ round, world: judgedWorld, render: shot.clean, raster: shot.renderRaster, pose: shot.cam, aspect: photo.aspect, diffs: ledger, lookKey: JSON.stringify(desc.camera) });
        objGain = r.gain;
        objReverted = r.reverted.length > 0;
      } catch (e) {
        if (ctx.signal?.aborted || e instanceof Unavailable) throw e;
        yield { type: 'photo', phase: 'round', round, text: `The object judgement failed this round (${errorMessage(e).slice(0, 160)}); the checklist stands.` };
      }
    }

    // The compare kit (side by side, crops of the regions that still fail, a colour readout) of the render the model works from.
    const priority = new Set<string>();
    for (const f of last?.score.failing ?? []) {
      const it = checklist.find((c) => c.id === f.id);
      if (it?.target) priority.add(it.target);
      const w = wallOf(desc, it ?? ({ target: undefined } as unknown as ChecklistItem));
      if (w) priority.add(`wall-${w}`);
    }
    const kit = kitOn ? await buildKit(run, photo, desc, view, priority).catch((e) => {
      if (ctx.signal?.aborted) throw e;
      return null;
    }) : null;
    if (kit && kit.images.length > 0) run.imageCap = Math.max(run.imageCap ?? 0, 6 + kit.images.length + 2);
    const advisory = decision?.advisory ? `Advisory, from the deterministic checks (not a verdict; look at the render and decide): since the accepted state, ${decision.advisory}.` : '';
    let depthNote = '';
    let depthImages: ContentBlock[] = [];
    if (round === 1 && depthRaster) {
      depthFirst ??= measureRoom({ raster: depthRaster }, autoAnchor(desc), { width: desc.footprint.width, depth: desc.footprint.depth, ceiling: desc.footprint.ceiling });
      const m = await depthFirst.catch(() => null);
      if (m && m.estimate) {
        depthNote = `${m.text.replace('\nThe depth picture follows this reply.', '')}\nThe depth picture is the last image. Call measure_room with an anchor (a whole door, a bed, a table: name, size_m, axis, box) to pin the scale.`;
        depthImages = m.blocks;
        yield { type: 'step', tool: MEASURE_TOOL_NAME, label: `Depth estimate: ${m.estimate.width.value} × ${m.estimate.depth.value} × ${m.estimate.height.value} m (${m.estimate.scale.basis} scale)`, ok: true };
      } else if (m) {
        yield { type: 'step', tool: MEASURE_TOOL_NAME, label: m.text.slice(0, 160), ok: false };
      }
    }
    // A judged shell-size failure, or a piece still refused for lack of space, has to be answered this round (the gate checks that the model answered, not what it chose).
    const shellDue = !!(hs && ledger) && ((standing ?? last)?.score.failing.some((f) => f.id === 'shell-size') === true || (ledger?.ranked().some((d) => /lack of space/i.test(d.what)) ?? false));
    let shellAnswered = false;
    let finishNag = false;
    const notes = [rejectNote, standing?.panel ? consensusText(standing.panel) : '', objects && objects.ready ? objects.text() : '', advisory, view.fidelity ? fidelityText(view.fidelity) : '', view.lookEvidence, view.scale, round === 1 ? footprintAdvisory(desc) : '', depthNote, kit?.readout ?? '', ledger ? ledger.roundText() : '', hs && ledger ? repairOrderText(ledger.ranked()) : '', shellDue ? SHELL_DUE_TEXT : ''].filter((l) => l.length > 0).join('\n');
    const blocks: ContentBlock[] = [];
    if (intro) {
      const sampled = photo.raster ? surfaceColourText(sampleSurfaces(photo.raster, desc)) : '';
      blocks.push({ type: 'text', text: compareIntroText({ summary: desc.summary || desc.roomType, checklist, notes: build.notes, hasObjective: view.objective !== null, plan: hs?.resumed ? '' : JSON.stringify(build.plan), ...(view.framing ? { framing: framingText(view.framing) } : {}), judged: standing !== null, measured: [notes, sampled].filter((l) => l.length > 0).join('\n'), ledger: ledger !== null }) });
      intro = false;
    } else blocks.push({ type: 'text', text: compareRoundText(round, last?.score ?? null, view.objective, view.legend, refusals, view.framing ? framingText(view.framing) : '', notes, standing !== null, ledger !== null) });
    blocks.push({ type: 'text', text: 'Image 1: the PHOTO' }, { type: 'image', dataUrl: photo.dataUrl });
    view.images.forEach((im, i) => blocks.push({ type: 'text', text: `Image ${i + 2}: RENDER, ${im.label}` }, { type: 'image', dataUrl: im.dataUrl }));
    if (kit) kit.images.forEach((im, i) => blocks.push({ type: 'text', text: `Image ${view.images.length + 2 + i}: ${im.label}` }, { type: 'image', dataUrl: im.dataUrl }));
    blocks.push(...depthImages);
    if (ledger) blocks.push({ type: 'text', text: differencesProcedure(round, kit !== null && kit.images.length > 0) });
    if (objects && objects.ready) blocks.push({ type: 'text', text: objectsProcedure(round) });
    if (hs) blocks.push({ type: 'text', text: harnessProcedure(round, baseRounds + round) });
    // Judging alone, the model decides whether its last changes helped by looking at the best state next to the new one.
    const bestImage = ref0 ? (ref0.shot.clean ?? ref0.shot.images[0]?.dataUrl ?? null) : null;
    if (judges === 0 && ref0 && bestImage && changed && round > 1) {
      blocks.push({ type: 'text', text: `Image ${view.images.length + 2 + (kit?.images.length ?? 0)}: BEST SO FAR (round ${ref0.round}), the state your last changes started from. In report_verdicts set "closer" to "new" when the new render is closer to the photo, "best" when this one is (the room then goes back to it), or "same".` }, { type: 'image', dataUrl: bestImage });
    }
    if (round === 1) blocks.push({ type: 'text', text: `Legend of the numbers:\n${view.legend}${firstRefusals.length > 0 ? `\nRefused while building (place these again with the right numbers, or fix the cause):\n${firstRefusals.map((r) => `- ${r}`).join('\n')}` : ''}` });
    yield { type: 'step', tool: 'look', label: round === 1 ? 'Comparing the render with the photo' : `Comparing again (round ${round})`, ok: true, looked: [{ label: 'the photo', dataUrl: photo.dataUrl }, ...view.images.map((im) => ({ label: `render: ${im.label}`, dataUrl: im.dataUrl })), ...(kit?.images ?? []).map((im) => ({ label: im.label.slice(0, 60), dataUrl: im.dataUrl }))].slice(0, 8) };
    pushUser(messages, blocks);
    refusals = [];
    extraWalls = [];

    let workerJudged = false;
    const lookBlocks: ContentBlock[] = [];
    let edited = false;
    let declared = false;
    let rolledBack = false;
    let toolCalls = 0;
    // With the object table the model repairs several objects in a round (one declared repair and edit per turn); the judges see the result next round.
    let editTurns = 0;
    const maxEditTurns = objects && objects.ready ? 4 : 1;
    let listed = ledger === null;
    let objNags = 0;
    /** Finishing with objects failing and no reason given is answered twice with the list, then accepted (the model may be right). */
    const objectsOwed = (): string | null => {
      if (!objects || !objects.ready || objects.open() === 0 || objNags >= 2) return null;
      objNags++;
      return objectsDueText(objects.open());
    };
    const ready = (): boolean => standing !== null || workerJudged;
    for (let turn = 0; turn < TURNS_PER_ROUND && !declared && !(ready() && ((edited && editTurns >= maxEditTurns) || rolledBack) && !(shellDue && !shellAnswered)); turn++) {
      const callsBefore = toolCalls;
      const res = await ask(run, messages, tools, true);
      messages.push({ role: 'assistant', content: res.content });
      const calls = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
      const text = textOf(res.content);
      if (res.stopReason === 'error' && calls.length === 0) {
        yield { type: 'error', text: text || 'The model could not complete the comparison.' };
        return yield* pickBest({ judged: standing ?? last });
      }
      if (calls.length === 0) {
        if (ready() && shellDue && !shellAnswered && !finishNag) {
          finishNag = true;
          pushUser(messages, [{ type: 'text', text: SHELL_DUE_TEXT }]);
          continue;
        }
        if (ready()) {
          const owed = objectsOwed();
          if (owed && !edited) {
            pushUser(messages, [{ type: 'text', text: owed }]);
            continue;
          }
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
      const rank = (n: string): number => (n === VERDICT_TOOL_NAME || n === SAMPLE_TOOL_NAME || n === OBJECT_REASON_TOOL_NAME || n === CLOSER_TOOL_NAME || n === DIFFERENCES_TOOL_NAME || n === GATE_TOOL_NAME ? 0 : n === 'finish' ? 3 : n === REPAIR_TOOL_NAME || n === 'find_model' ? 1 : 2);
      for (const call of [...calls].sort((a, b) => rank(a.name) - rank(b.name))) {
        if (ctx.signal?.aborted) throw new Error('aborted');
        if (call.name === DIFFERENCES_TOOL_NAME) {
          if (!ledger) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: 'Unknown tool here.', isError: true });
            continue;
          }
          if (listed) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: 'Already recorded this round. Fix the largest open difference, or call finish.' });
            continue;
          }
          const rec = ledger.record(call.input);
          yield { type: 'step', tool: DIFFERENCES_TOOL_NAME, label: stepLabel(DIFFERENCES_TOOL_NAME, call.input, rec.ok), ok: rec.ok };
          if (!rec.ok) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: rec.error, isError: true });
            continue;
          }
          listed = true;
          results.push({ type: 'tool_result', toolUseId: call.id, content: rec.text });
          yield { type: 'photo', phase: 'round', round, text: rec.open === 0 ? 'No open differences from the photo.' : `${rec.open} difference${rec.open === 1 ? '' : 's'} from the photo; largest: ${rec.ranked[0]?.id} (${rec.ranked[0]?.what.slice(0, 100)}).`, differences: differenceViews(rec.ranked) };
          continue;
        }
        if (call.name === VERDICT_TOOL_NAME) {
          const ok = parseVerdicts(call.input);
          if (ok.length === 0) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: `No valid verdicts: send {"verdicts":[{"id": a checklist id, "pass": true|false, "note": what differs}]}, one per checklist id, at most ${MAX_VERDICTS}.`, isError: true });
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
          const s = settle(cand, judgedWorld, shot, round, parseCloser(call.input));
          standing = s.standing;
          decision = s.decision;
          let note = verdictReply(sb);
          if (s.rejected) {
            rolledBack = true;
            ledger?.clearEdited();
            note += ` You found the best state (round ${s.rejected.round}) closer to the photo (${s.decision.reason}), so the room was rolled back to round ${s.rejected.round}; the changes in this reply are not applied. Look at the next render and try a different, smaller fix.`;
            yield { type: 'photo', phase: 'round', round, text: `Round ${round} was worse (${s.decision.reason}): back to round ${s.rejected.round}.`, score: scoreView(s.rejected.judged) };
          }
          results.push({ type: 'tool_result', toolUseId: call.id, content: note });
          continue;
        }
        if (call.name === OBJECT_REASON_TOOL_NAME) {
          if (!objects) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: 'Unknown tool here.', isError: true });
            continue;
          }
          const r = applyReasons(objects.ledger, call.input, ledger ?? undefined, { measured: objects.measuredVerdicts() });
          yield { type: 'step', tool: OBJECT_REASON_TOOL_NAME, label: r.ok ? 'Gave reasons for objects left as they are' : 'Object reasons not recorded', ok: r.ok };
          if (r.ok) yield { type: 'photo', phase: 'round', round, text: `Objects waived with a stated reason (not passes): ${objects.ledger.waivedCount()} of ${objects.ledger.size}.`, objects: objects.views() };
          results.push({ type: 'tool_result', toolUseId: call.id, content: r.text, ...(r.ok ? {} : { isError: true }) });
          continue;
        }
        if (call.name === SAMPLE_TOOL_NAME) {
          results.push({ type: 'tool_result', toolUseId: call.id, content: samplePhotoText(photo.raster, desc, call.input) });
          continue;
        }
        if (call.name === CLOSER_TOOL_NAME) {
          const look = await lookCloser({ photoUrl: photo.dataUrl, renderUrl: shot.clean, compose: run.ctx.host.composeImages?.bind(run.ctx.host), plan: () => planShot(run, photo.aspect), roomLine: `Room ${desc.footprint.width} m (west-east) by ${desc.footprint.depth} m (north-south), ceiling ${desc.footprint.ceiling} m.` }, call.input);
          results.push({ type: 'tool_result', toolUseId: call.id, content: look.text, ...(look.isError ? { isError: true } : {}) });
          lookBlocks.push(...look.blocks);
          continue;
        }
        if (call.name === 'find_model' && perceiverOf(run) && typeof (call.input as { like_crop?: unknown } | null)?.like_crop === 'string') {
          // Appearance retrieval: the library ranked by how much each model looks like the crop of this object; the name search follows in the same reply when `what` is given.
          const like = (call.input as { like_crop: string; what?: string }).like_crop;
          const pc = perceiverOf(run) as Perceiver;
          let emb = pc.embeddingOf(like);
          const rec = objects?.ledger.items.get(like);
          if (!emb && rec) emb = await pc.embedBox(rec.item.box as [number, number, number, number]).catch(() => null);
          if (!emb) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: `find_model like_crop: no crop for "${like.slice(0, 40)}" (use a perceived id such as p3 or an inventory id), or the image labeller is unavailable; use the name search.`, isError: true });
            continue;
          }
          const sim = await codeOf(run).similarModelsText(emb, 3, `object ${like}`);
          let text = sim.text;
          const what = (call.input as { what?: unknown }).what;
          if (typeof what === 'string' && what.length > 0) {
            const named = await executeTool(run.ctx, 'find_model', { what, ...((call.input as { limit?: number }).limit ? { limit: (call.input as { limit: number }).limit } : {}) }).catch(() => null);
            if (named?.content) text += `\n\nBy name:\n${named.content}`;
          }
          results.push({ type: 'tool_result', toolUseId: call.id, content: text });
          continue;
        }
        if (call.name === APPLY_COLOUR_TOOL_NAME && perceiverOf(run)) {
          const input = codeOf(run).parseApplyColourInput(call.input);
          const fail = (t: string): void => { results.push({ type: 'tool_result', toolUseId: call.id, content: `apply_measured_colour: ${t}`, isError: true }); };
          if (!input) { fail('expected {object, ref?, source?: "seen"|"lit-like-white", param?}.'); continue; }
          const rep = (perceiverOf(run) as Perceiver).report();
          const rec = objects?.ledger.items.get(input.object);
          const pid = rec?.item.measured?.id ?? input.object;
          const po = rep.objects.find((o) => o.id === pid);
          const seen = po?.appearance?.colour.hex;
          if (!seen) { fail(`no colour was measured for "${input.object.slice(0, 40)}" (use an inventory id or a perceived id such as p3).`); continue; }
          const hex = input.source === 'lit-like-white' && rep.illuminant ? codeOf(run).normaliseHex(seen, rep.illuminant) : seen;
          const ref = input.ref ?? rec?.item.entities[0];
          const ent = ref ? run.ctx.host.getWorld().entities[ref] : undefined;
          const params = (ent && ent.shape.kind === 'procedural' ? (ent.shape.params as Record<string, unknown>) : null) ?? {};
          const key = input.param ?? codeOf(run).COLOUR_PARAMS.find((k) => typeof params[k] === 'string' && /^#[0-9a-f]{6}$/i.test(params[k] as string));
          if (!ref || !ent) { fail('give `ref`, the built entity to colour (the object has no linked piece).'); continue; }
          if (!key) { fail(`${ref} has no hex colour parameter (its colour is a named finish or a texture); use edit_items resize with params, or choose another piece.`); continue; }
          const order = hs ? hs.guard.allow(APPLY_COLOUR_TOOL_NAME, call.input) : null;
          if (order) { results.push({ type: 'tool_result', toolUseId: call.id, content: order, isError: true }); continue; }
          if (toolCalls >= run.maxToolCalls) { fail('tool-call budget of this round used up.'); continue; }
          toolCalls++;
          const linkedBefore = objects && objects.ready ? objects.snapshotLinked(host.getWorld()) : null;
          const out = await executeTool(ctx, 'edit_items', { edits: [{ op: 'resize', ref, params: { [key]: hex } }], message: `Colour ${ref} ${key} ${hex} from the photo (${pid}, ${input.source ?? 'seen'})` });
          yield { type: 'step', tool: APPLY_COLOUR_TOOL_NAME, label: `Colour ${ref} from the photo: ${hex}`, ok: !out.isError };
          for (const ev of out.events) yield ev;
          if (out.edited) { edited = true; ledger?.markEdited(); }
          const feedback = linkedBefore && out.edited && objects ? objects.afterEdit(linkedBefore) : '';
          results.push({ type: 'tool_result', toolUseId: call.id, content: `${out.isError ? 'Refused: ' : `Set ${ref}.${key} to ${hex} (measured on the photo as ${seen}${hex !== seen ? `, lit like white ${hex}` : ''}). `}${out.content}${feedback ? `\n${feedback}` : ''}`, ...(out.isError ? { isError: true } : {}) });
          continue;
        }
        if (call.name === PERCEIVE_TOOL_NAME && perceiverOf(run)) {
          const input = codeOf(run).parsePerceiveInput(call.input);
          if (!input) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: 'perceive_photo: expected {find?: string[] of object nouns, generic?: boolean}.', isError: true });
            continue;
          }
          const got = await codeOf(run).perceivePhoto(perceiverOf(run) as Perceiver, input);
          results.push({ type: 'tool_result', toolUseId: call.id, content: got.text, ...(got.isError ? { isError: true } : {}) });
          lookBlocks.push(...got.blocks);
          if (got.report) perceiveEvidence.set(run, { text: got.text, blocks: got.blocks, report: got.report });
          continue;
        }
        if (call.name === MEASURE_TOOL_NAME && depthRaster) {
          const input = parseMeasureInput(call.input);
          if (!input) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: 'measure_room: the anchor needs {name, size_m, axis: "height"|"width", box:[x0,y0,x1,y1]} with a box of at least 2% of the photo.', isError: true });
            continue;
          }
          const m = await measureRoom({ raster: depthRaster }, input.anchor ?? autoAnchor(desc), { width: desc.footprint.width, depth: desc.footprint.depth, ceiling: desc.footprint.ceiling });
          results.push({ type: 'tool_result', toolUseId: call.id, content: m.text, ...(m.isError ? { isError: true } : {}) });
          lookBlocks.push(...m.blocks);
          continue;
        }
        if (call.name === GATE_TOOL_NAME && hs) {
          const g = hs.stages.gate(call.input);
          yield { type: 'step', tool: GATE_TOOL_NAME, label: g.ok ? `Stage verdicts: ${g.changed.join(', ')}` : 'Stage verdict not recorded', ok: g.ok };
          if (g.changed.length > 0) yield { type: 'photo', phase: 'stage', round, text: g.text.split('\n').join(' '), stages: hs.stages.views() };
          const stopped = hs.stages.blocker();
          if (stopped) {
            declared = true;
            results.push({ type: 'tool_result', toolUseId: call.id, content: `${g.text}\nThe ${stopped.stage} stage is blocked, so the run stops here and tells the user: ${stopped.text}` });
          } else results.push({ type: 'tool_result', toolUseId: call.id, content: g.text, ...(g.ok ? {} : { isError: true }) });
          continue;
        }
        if (call.name === REPAIR_TOOL_NAME && hs && ledger) {
          if (!listed) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: 'List the differences first (report_differences), each with its cause, then declare what you repair.', isError: true });
            continue;
          }
          const keep = (call.input as { keep_shell?: unknown } | null)?.keep_shell;
          if (typeof keep === 'string' && keep.trim().length > 0) {
            hs.assume.add({ id: 'shell-size', text: `Shell size kept at ${desc.footprint.width} x ${desc.footprint.depth} m: ${keep.trim()}`, confidence: 0.4, stage: 'shell', adjust: `make the room ${Math.round((desc.footprint.width + 0.6) * 10) / 10} m wide`, kind: 'scale' });
            shellAnswered = true;
          }
          const d = hs.guard.declare(call.input, ledger.ranked());
          yield { type: 'step', tool: REPAIR_TOOL_NAME, label: d.ok ? `Repair: ${hs.guard.current?.cause} (${hs.guard.current?.id})` : 'Repair refused: wrong order or unknown difference', ok: d.ok };
          results.push({ type: 'tool_result', toolUseId: call.id, content: d.text, ...(d.ok ? {} : { isError: true }) });
          continue;
        }
        if (call.name === 'finish') {
          if (shellDue && !shellAnswered && !finishNag) {
            finishNag = true;
            results.push({ type: 'tool_result', toolUseId: call.id, content: SHELL_DUE_TEXT, isError: true });
            continue;
          }
          const owed = objectsOwed();
          if (owed && !edited) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: owed, isError: true });
            continue;
          }
          declared = true;
          results.push({ type: 'tool_result', toolUseId: call.id, content: 'Done.' });
          continue;
        }
        if (!isDesignTool(call.name) && call.name !== 'tune_look' && call.name !== 'make_texture' && !(hs && call.name === CAMERA_TOOL_NAME)) {
          results.push({ type: 'tool_result', toolUseId: call.id, content: `Unknown tool "${call.name.slice(0, 40)}" here. Use report_verdicts, edit_items, place_items, query_scene, design_plan, tune_look, make_texture${hs ? ', set_photo_camera, declare_repair, stage_gate' : ''} or finish.`, isError: true });
          continue;
        }
        if (rolledBack) {
          results.push({ type: 'tool_result', toolUseId: call.id, content: 'Not applied: the room was rolled back to its best state because the last round made it worse.', isError: true });
          continue;
        }
        if (!listed) {
          results.push({ type: 'tool_result', toolUseId: call.id, content: 'List the differences first: call report_differences (in the same reply is fine), ranked by size, then fix the largest.', isError: true });
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
        const order = hs ? hs.guard.allow(call.name, call.input) : null;
        if (order) {
          results.push({ type: 'tool_result', toolUseId: call.id, content: order, isError: true });
          continue;
        }
        toolCalls++;
        if (call.name === CAMERA_TOOL_NAME) {
          const cam = applyCameraChange(desc.camera, call.input);
          yield { type: 'step', tool: CAMERA_TOOL_NAME, label: cam.ok ? 'Moved the photo camera' : 'Camera change refused', ok: cam.ok };
          if (cam.ok) {
            Object.assign(desc.camera, cam.camera);
            edited = true;
            ledger?.markEdited();
          }
          results.push({ type: 'tool_result', toolUseId: call.id, content: cam.text, ...(cam.ok ? {} : { isError: true }) });
          continue;
        }
        const linkedBefore = objects && objects.ready ? objects.snapshotLinked(host.getWorld()) : null;
        const out = await executeTool(ctx, call.name, call.input);
        yield { type: 'step', tool: call.name, label: stepLabel(call.name, call.input, !out.isError), ok: !out.isError };
        for (const ev of out.events) yield ev;
        if (call.name === 'design_plan' && !out.isError) shellAnswered = true;
        if (out.edited) {
          edited = true;
          ledger?.markEdited();
        }
        if (out.isError || /refused/i.test(out.content)) refusals.push(`${call.name}: ${out.content.split('\n').slice(0, 3).join(' ').slice(0, 300)}`);
        const feedback = linkedBefore && out.edited && objects ? objects.afterEdit(linkedBefore) : '';
        results.push({ type: 'tool_result', toolUseId: call.id, content: feedback ? `${out.content}\n${feedback}` : out.content, ...(out.isError ? { isError: true } : {}) });
      }
      messages.push({ role: 'user', content: results });
      if (lookBlocks.length > 0) pushUser(messages, lookBlocks.splice(0));
      if (toolCalls > callsBefore) editTurns++;
    }

    if (!standing) {
      yield { type: 'photo', phase: 'unavailable', text: 'The assistant did not judge the render; stopped comparing.' };
      return yield* pickBest({ judged: last });
    }
    const j: Judged = standing;
    last = j;
    if (!j.panel) yield { type: 'photo', phase: 'round', round, text: `Round ${round}: ${lookLine(j)}.`, score: scoreView(j, !rolledBack) };
    extraWalls = [...new Set(j.score.failing.map((f) => wallOf(desc, f)).filter((w): w is string => w !== null))].slice(0, 2);
    const verdict = tracker.observe({ gain: (decision?.gain ?? false) || objGain, keys: new Set([...j.score.failing.map((f) => f.id), ...(objects?.openKeys() ?? [])]) });
    changed = (edited && !rolledBack) || objReverted;
    if (j.score.failing.length === 0 && (!objects || !objects.ready || objects.open() === 0)) {
      yield { type: 'photo', phase: 'round', round, text: `Every checklist item matches the photo${objects && objects.ready ? (objects.ledger.waivedCount() > 0 ? ` and every inventoried object passes or is waived (${objects.ledger.waivedCount()} waived: not passes)` : ' and every inventoried object passes') : ''}.`, score: scoreView(j) };
      return yield* conclude(j, changed);
    }
    // The object loop does not run to perfection: it ends on a plateau or at its round cap, keeps the best state of each object and says what is still off.
    const objStop = objects && objects.ready ? objects.stopCheck() : null;
    if (objects && objStop && !(declared && !edited)) {
      const n = objects.finalizeStop(objStop);
      yield { type: 'photo', phase: 'round', round, text: `Stopped refining the objects: ${objStop}. ${n} object${n === 1 ? '' : 's'} still off are marked "stopped"; the best state of each is kept (${objects.budgetLine()}). The result is not perfect; "keep refining" continues from the saved list.`, objects: objects.views(), score: scoreView(j) };
      return yield* conclude(j, changed);
    }
    if (declared && !edited) {
      if (objects && objects.ready && objects.open() > 0) objects.finalizeStop('the assistant finished while they were still off');
      yield { type: 'photo', phase: 'round', round, text: `The assistant decided it is good enough as it stands, with ${j.score.failing.length} item${j.score.failing.length === 1 ? '' : 's'} it judged still different${objects && objects.ready && objects.open() > 0 ? ` and ${objects.open()} object aspect${objects.open() === 1 ? '' : 's'} open` : ''}.`, score: scoreView(j) };
      return yield* conclude(j, false);
    }
    if (verdict.stalled) {
      if (objects && objects.ready && objects.open() > 0) objects.finalizeStop(verdict.reason);
      yield { type: 'photo', phase: 'round', round, text: `Stopped comparing: ${verdict.reason}.`, score: scoreView(j) };
      return yield* conclude(j, changed);
    }
  }
  round = maxRounds;
  // Out of rounds: edits made in the last one have not been looked at.
  return yield* conclude(last ?? judgedOf(scoreVerdicts(checklist, []), { objective: null, fidelity: null, measure: '' }, null), changed);
}

/** The compare kit of one render: the images to show (side by side, then region crops) and the colour readout. */
interface Kit {
  images: Array<{ label: string; dataUrl: string }>;
  readout: string;
}

/**
 * Build the kit from the photo and the clean render (both from the photo's camera, so a region box means the same place
 * in each). Needs the host's `composeImages` for the pictures; the colour readout needs only the rasters.
 * Returns null when there is nothing to add.
 */
async function buildKit(run: PhotoRun, photo: Photo, desc: RoomDescription, shot: Shot, priority: ReadonlySet<string>): Promise<Kit | null> {
  const host = run.ctx.host;
  const clean = shot.clean;
  if (!clean) return null;
  const want = Math.max(0, Math.min(8, Math.floor(run.options.crops ?? 4)));
  const regions: CropRegion[] = cropRegions(desc, { max: 8, priority });
  const readout = photo.raster && shot.renderRaster ? regionReadout(photo.raster, shot.renderRaster, regions) : '';
  const images: Kit['images'] = [];
  if (host.composeImages) {
    const sbs = await raceAbort(host.composeImages([{ dataUrl: photo.dataUrl }, { dataUrl: clean }], { maxSide: 1400 }), run.ctx.signal).catch(() => null);
    if (sbs) images.push({ label: 'the PHOTO beside the RENDER from the same camera (left: photo, right: render)', dataUrl: sbs });
    // The same box cut out of both pictures (the render is taken from the photo's camera, so a box means the same place in each).
    for (const r of regions.slice(0, want)) {
      if (run.ctx.signal?.aborted) throw new Error('aborted');
      const pair = await raceAbort(host.composeImages([{ dataUrl: photo.dataUrl, box: r.box }, { dataUrl: clean, box: r.box }], { maxSide: 900 }), run.ctx.signal).catch(() => null);
      if (pair) images.push({ label: `zoom on ${r.label} (${r.id}): the PHOTO beside the RENDER (left: photo, right: render)`, dataUrl: pair });
    }
  }
  return images.length === 0 && readout === '' ? null : { images, readout };
}

/**
 * The independent cross-check: one seat with fresh eyes (no conversation, a fixed seed) sees the final render beside the
 * photo, with the same crops and readout, and lists what still differs. It records; it never edits. Its findings join
 * the ledger as the independent seat's, so the closing message names them next to the model's own.
 */
async function* crossCheck(run: PhotoRun, photo: Photo, desc: RoomDescription, targets: readonly FramingTarget[], ledger: DifferenceLedger): AsyncGenerator<AgentEvent> {
  const { ctx } = run;
  yield { type: 'status', text: 'Independent check of the final render against the photo…' };
  const shot = await snapshot(run, photo, desc, targets, [], 1, true).catch((e) => {
    if (ctx.signal?.aborted) throw e;
    return null;
  });
  if (!shot || !shot.clean) return;
  const kit = await buildKit(run, photo, desc, shot, new Set()).catch((e) => {
    if (ctx.signal?.aborted) throw e;
    return null;
  });
  const blocks: ContentBlock[] = [{ type: 'text', text: crossCheckText({ summary: desc.summary || desc.roomType, readout: kit?.readout ?? '' }) }, { type: 'text', text: 'Image 1: the PHOTO' }, { type: 'image', dataUrl: photo.dataUrl }, { type: 'text', text: 'Image 2: RENDER from the same camera' }, { type: 'image', dataUrl: shot.clean }];
  (kit?.images ?? []).forEach((im, i) => blocks.push({ type: 'text', text: `Image ${3 + i}: ${im.label}` }, { type: 'image', dataUrl: im.dataUrl }));
  const fresh = new DifferenceLedger();
  const messages: ChatMessage[] = [{ role: 'user', content: blocks }];
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: CompletionResponse;
    try {
      res = await complete(run, { role: 'critic', system: CROSSCHECK_SYSTEM, messages: requestView(messages, 14), tools: [DIFFERENCES_TOOL], maxTokens: Math.min(run.maxTokens, 8000), temperature: 0, seed: CROSSCHECK_SEED });
    } catch (e) {
      if (ctx.signal?.aborted || e instanceof Unavailable) throw e;
      return;
    }
    messages.push({ role: 'assistant', content: res.content });
    const c = res.content.find((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use' && b.name === DIFFERENCES_TOOL_NAME);
    if (!c) {
      messages.push({ role: 'user', content: [{ type: 'text', text: 'Call report_differences now (an empty list when nothing differs).' }] });
      continue;
    }
    const rec = fresh.record(c.input, 'independent');
    if (!rec.ok) {
      messages.push({ role: 'user', content: [{ type: 'tool_result', toolUseId: c.id, content: rec.error, isError: true }] });
      continue;
    }
    for (const d of rec.ranked) ledger.record({ differences: [{ id: `check-${d.id}`.slice(0, 40), kind: d.kind, where: d.where, what: d.what, size: d.size }] }, 'independent');
    yield { type: 'photo', phase: 'round', text: rec.open === 0 ? 'Independent check, fresh eyes: the render matches the photo; no difference found.' : `Independent check, fresh eyes: ${rec.open} difference${rec.open === 1 ? '' : 's'} still seen; largest: ${rec.ranked[0]?.id} (${rec.ranked[0]?.what.slice(0, 100)}).`, differences: differenceViews(rec.ranked.map((d) => ({ ...d, source: 'independent' as const }))) };
    return;
  }
}

const SampleInput = z.object({
  regions: z
    .array(
      z.object({
        surface: z.string().max(60).optional(),
        box: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
        kind: z.enum(['wall', 'floor', 'ceiling', 'any']).optional(),
        hint: z.string().max(60).optional(),
      }),
    )
    .min(1)
    .max(8),
});

/** The answer of the `sample_photo` tool: for each region the pixels' colours and the nearest finishes. */
function samplePhotoText(raster: Raster | null, d: RoomDescription, input: unknown): string {
  if (!raster) return 'The photo has no pixels here (the host could not decode it), so no colours can be sampled.';
  const p = SampleInput.safeParse(input);
  if (!p.success) return 'sample_photo needs {"regions":[{"surface":"wall-north"} or {"box":[x0,y0,x1,y1]}, …]}.';
  const known = new Map(surfaceRegions(d).map((r) => [r.id, r] as const));
  const lines: string[] = [];
  for (const r of p.data.regions) {
    const named = r.surface ? known.get(r.surface) : undefined;
    const piece = r.surface ? (d.items.find((i) => i.id === r.surface)?.box ?? d.openings.find((o) => o.id === r.surface)?.box) : undefined;
    const box = r.box ?? named?.box ?? piece;
    const label = r.surface ?? `box ${JSON.stringify(r.box)}`;
    if (!box) {
      lines.push(`- ${label}: no region (the description gives no box for it; send an explicit box).`);
      continue;
    }
    const c = sampleRegion(raster, box);
    if (!c) {
      lines.push(`- ${label}: the region is empty.`);
      continue;
    }
    const surface = r.kind ?? named?.surface ?? (r.surface?.startsWith('wall') ? 'wall' : r.surface === 'floor' ? 'floor' : r.surface === 'ceiling' ? 'ceiling' : 'any');
    const fins = nearestFinishes(c.lit, { surface, hint: `${r.hint ?? ''} ${named?.hint ?? ''}`, limit: 3 });
    lines.push(`- ${label}: lit ${c.lit}, mean ${c.mean}, shadow ${c.shadow}${named?.described ? `; described ${named.described}` : ''}; nearest finishes: ${fins.map((f) => (f.tint ? `${f.finish} tinted ${f.tint}` : f.finish)).join(' | ')}`);
  }
  return lines.join('\n');
}

/** The fixing model's side-by-side answer when it judges alone: is the new render closer to the photo than the best one so far? */
function parseCloser(input: unknown): Consensus['preference'] {
  const c = input && typeof input === 'object' ? (input as { closer?: unknown }).closer : undefined;
  const v = typeof c === 'string' ? c.trim().toLowerCase() : '';
  return v === 'new' ? 'current' : v === 'best' ? 'previous' : v === 'same' ? 'tie' : null;
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
