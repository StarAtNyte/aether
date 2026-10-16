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
  framingTargets,
  framingText,
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
import { executeTool, raceAbort, runVerification, type ExecutorContext } from '../executor';
import { extractJsonObject } from '../emulation/json';
import { errorMessage } from '../providers/errors';
import { StallTracker } from '../review';
import type { AgentEvent, ChatMessage, CompletionResponse, ContentBlock, PhotoAssumptionView, PhotoOptions, PhotoScoreView, ReviewViewRequest, ToolDef } from '../types';
import { imageSize } from './image-size';
import { ANALYSIS_SYSTEM, DESCRIBE_TOOL, DESCRIBE_TOOL_NAME, VERDICT_TOOL, VERDICT_TOOL_NAME, analysisUserText, compareIntroText, compareRoundText, refusalText } from './prompt';
import { restorePatches } from './revert';
import { applyGrade, estimatePhotoGrade, matchGrade, nextEnvironmentGrade, nextExposure, type PhotoGrade } from './grade';
import { compareImages, extractPalette, type Raster } from './score';

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
/** Default and hard cap of compare rounds. */
export const PHOTO_ROUNDS_DEFAULT = 6;
export const PHOTO_ROUNDS_MAX = 12;
/** A round is rolled back when its quality is this much below the best: never less than 0.03, and at least one and a half checklist items (a judge's single wavering verdict is not a regression). */
const ROLLBACK_MARGIN_MIN = 0.03;
function rollbackMargin(items: number): number {
  return Math.max(ROLLBACK_MARGIN_MIN, (1.5 * RATE_WEIGHT) / Math.max(1, items));
}
/** Pass rate that, with no structural failure, lets the model call it done. */
export const PHOTO_TARGET_RATE = 0.92;
/** Weight of the checklist pass rate in the round quality (the rest is the measured agreement: framing and similarity). */
const RATE_WEIGHT = 0.5;

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
async function ask(run: PhotoRun, messages: ChatMessage[], tools: readonly ToolDef[], useSession: boolean): Promise<CompletionResponse> {
  const { ctx } = run;
  if (ctx.signal?.aborted) throw new Error('aborted');
  if (ctx.provider.name === 'mock' || !visionOn(run.options)) throw new Unavailable();
  const res = await raceAbort(ctx.provider.complete({ role: 'planner', system: tools.some((t) => t.name === DESCRIBE_TOOL_NAME) ? ANALYSIS_SYSTEM : run.system, messages, tools: [...tools], maxTokens: run.maxTokens, ...(useSession && run.session ? { session: run.session } : {}) }, ctx.signal), ctx.signal);
  ctx.usage.calls += 1;
  ctx.usage.inputTokens += res.usage?.inputTokens ?? 0;
  ctx.usage.outputTokens += res.usage?.outputTokens ?? 0;
  noteModel(ctx.usage, res.model);
  // The connection chain may have fallen back to the offline planner inside this very call: its reply is not an answer.
  if (ctx.provider.name === 'mock') throw new Unavailable();
  return res;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

type Analysis = { ok: true; description: RoomDescription; fixes: string[]; callId?: string } | { ok: false; error: string };

/**
 * Ask for the description. `messages` is the conversation so far (empty: the first turn is made here); a later call
 * continues it, which is how a shell the builder refused is sent back to the model to correct.
 */
async function analyse(run: PhotoRun, messages: ChatMessage[] = []): Promise<Analysis> {
  if (messages.length === 0) messages.push({ role: 'user', content: [{ type: 'image', dataUrl: run.image }, { type: 'text', text: analysisUserText(run.request) }] });
  let lastError = 'the model did not describe the room';
  for (let attempt = 0; attempt < ANALYSIS_ATTEMPTS; attempt++) {
    const res = await ask(run, messages, [DESCRIBE_TOOL], false);
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

// ---------------------------------------------------------------------------
// Rendering and measuring
// ---------------------------------------------------------------------------

interface Shot {
  /** Marked images for the judge, the photo camera first. */
  images: Array<{ name: string; label: string; dataUrl: string }>;
  legend: string;
  /** Measured agreement with the photo, 0..1: framing of the described boxes and pixel similarity, whichever exist. */
  objective: number | null;
  /** The measures in words ("framing 89%, similarity 15%"), empty when none could be made. */
  measure: string;
  /** Framing of the room against the boxes the photo's description gives (null without boxes). */
  framing: FramingReport | null;
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

async function snapshot(run: PhotoRun, photo: Photo, desc0: RoomDescription, targets: readonly FramingTarget[], extraWalls: readonly string[], maxViews: number): Promise<Shot | null> {
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
  const wanted = [...views, ...(photo.raster && typeof host.decodeImage === 'function' ? [clean] : [])];
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
  const parts: Array<[number, number]> = [];
  if (framing) parts.push([framing.score, 0.6]);
  if (similarity !== null) parts.push([similarity, 0.4]);
  const wsum = parts.reduce((a, [, w]) => a + w, 0);
  const objective = wsum > 0 ? parts.reduce((a, [v, w]) => a + v * w, 0) / wsum : null;
  const measure = [framing ? `framing ${Math.round(framing.score * 100)}%` : '', similarity !== null ? `similarity ${Math.round(similarity * 100)}%` : ''].filter(Boolean).join(', ');
  return { images, legend: legendText(markIndex(world, PHOTO_BUILDING_ID), shown), objective, measure, framing };
}

function scoreView(sb: Scoreboard, objective: number | null): PhotoScoreView {
  return { passed: sb.passed, total: sb.total, rate: sb.rate, ...(objective !== null ? { objective } : {}), structuralFailed: sb.structuralFailed, failing: sb.failing.slice(0, 24).map((f) => ({ id: f.id, text: f.text.slice(0, 160), note: f.note.slice(0, 200) })) };
}

function quality(sb: Scoreboard, objective: number | null): number {
  return objective === null ? sb.rate : RATE_WEIGHT * sb.rate + (1 - RATE_WEIGHT) * objective;
}

function stripImages(messages: ChatMessage[]): void {
  for (const m of messages) {
    if (m.role !== 'user' || typeof m.content === 'string') continue;
    if (!m.content.some((b) => b.type === 'image')) continue;
    const kept = m.content.filter((b) => b.type !== 'image' && !(b.type === 'text' && /^Image \d+:/.test(b.text)));
    m.content = [...kept, { type: 'text', text: '(The images of an earlier round were removed to save space.)' }];
  }
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
  let analysis: Analysis;
  const talk: ChatMessage[] = [];
  try {
    analysis = await analyse(run, talk);
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
  let build = deriveBuild(desc);
  let checklist = buildChecklist(desc);
  let assumptions = chips(desc, build, analysis.fixes);
  yield { type: 'photo', phase: 'described', text: desc.summary || `A ${desc.roomType} of about ${desc.footprint.width} × ${desc.footprint.depth} m.`, assumptions };

  // The room is the world: whatever was there (the starter scene, an earlier room) goes, as one undo step.
  if (run.replace !== false && Object.keys(host.getWorld().entities).length > 0) {
    const cleared = host.applyPatches([{ op: 'clear' }], 'Clear the world for the room from the photo');
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
      talk.push({ role: 'user', content: [...(analysis.callId ? [{ type: 'tool_result' as const, toolUseId: analysis.callId, content: 'The description was valid, but the builder refused the shell (see below).', isError: true }] : []), { type: 'text', text: `The builder refused the shell built from your description:\n${built.shellText.slice(0, 1500)}\nCorrect the description (keep it faithful to the photo) and call describe_room again with the complete corrected description.` }] });
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
  let finalScore: Scoreboard | null = null;
  let finalObjective: number | null = null;
  try {
    const res = yield* compareLoop(run, photo, desc, framingTargets(desc, built.openings), checklist, build, refusals);
    finalScore = res.score;
    finalObjective = res.objective;
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
  if (finalScore) {
    lines.push(`Rebuilt the room from your photo: ${finalScore.passed} of ${finalScore.total} checklist items match${finalObjective !== null ? ` (objective similarity ${Math.round(finalObjective * 100)}%)` : ''}.`);
    if (finalScore.failing.length > 0) lines.push(`Still different: ${finalScore.failing.slice(0, 5).map((f) => `${f.id}${f.note && f.note !== 'not judged' ? ` (${f.note.slice(0, 80)})` : ''}`).join('; ')}.`);
  } else lines.push('Rebuilt the room from your photo (not compared with it: no renders were available).');
  if (findings.length > 0) lines.push(`The checker still reports ${findings.length} problem${findings.length === 1 ? '' : 's'}.`);
  lines.push(`I assumed ${assumptions.length} thing${assumptions.length === 1 ? '' : 's'} the photo cannot show; each one is listed with a one-tap way to change it.`);
  yield { type: 'photo', phase: 'done', text: lines.join(' '), assumptions, ...(finalScore ? { score: scoreView(finalScore, finalObjective) } : {}) };
  yield { type: 'message', text: lines.join(' ') };
}

interface LoopResult {
  score: Scoreboard | null;
  objective: number | null;
}

/** The best state seen so far. */
interface Best {
  quality: number;
  world: WorldDoc;
  score: Scoreboard;
  objective: number | null;
  round: number;
}

/** What one judged render came to. */
interface Judged {
  score: Scoreboard;
  objective: number | null;
  quality: number;
  measure: string;
}

/** The compare-and-correct loop. Returns the scoreboard of the room as it ends up. */
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

async function* compareLoop(run: PhotoRun, photo: Photo, desc: RoomDescription, targets: readonly FramingTarget[], checklist: readonly ChecklistItem[], build: PhotoBuild, firstRefusals: readonly string[]): AsyncGenerator<AgentEvent, LoopResult> {
  const { ctx } = run;
  const host = ctx.host;
  const maxRounds = Math.max(1, Math.min(PHOTO_ROUNDS_MAX, Math.floor(run.options.maxRounds ?? PHOTO_ROUNDS_DEFAULT)));
  const maxViews = Math.max(1, Math.min(4, Math.floor(run.options.maxViews ?? 3)));
  const tracker = new StallTracker(run.options.stallRounds ?? 3);
  const designTools = run.tools.filter((t) => isDesignTool(t.name));
  const tools: ToolDef[] = [VERDICT_TOOL, ...designTools, ...run.tools.filter((t) => t.name === 'finish')];
  const messages: ChatMessage[] = [];
  let best: Best | null = null;
  let last: Judged | null = null;
  let editedBefore = false;
  let refusals: string[] = [...firstRefusals];
  let extraWalls: string[] = [];
  let intro = true;

  const revertTo = (target: WorldDoc, why: string): boolean => {
    const patches = restorePatches(host.getWorld(), target);
    if (patches.length === 0) return true;
    return host.applyPatches(patches, why.slice(0, 120)).errors.length === 0;
  };
  const result = (j: Judged | null): LoopResult => ({ score: j?.score ?? null, objective: j?.objective ?? null });

  /** End of the loop: edits made after the last judged render are looked at once more, and kept only when not worse. */
  async function* conclude(j: Judged, unjudgedEdits: boolean): AsyncGenerator<AgentEvent, LoopResult> {
    if (!unjudgedEdits) return result(j);
    const fin = await finalJudgement(run, photo, desc, targets, checklist, messages).catch((e) => {
      if (ctx.signal?.aborted) throw e;
      return null;
    });
    if (!fin) return result(j);
    const q = quality(fin.score, fin.objective);
    yield { type: 'photo', phase: 'round', text: `Final check: ${scoreLine(fin.score)}${fin.measure ? `; ${fin.measure}` : ''}.`, score: scoreView(fin.score, fin.objective) };
    if (best && q < best.quality - rollbackMargin(checklist.length)) {
      revertTo(best.world, `Back to the best round (${best.round})`);
      yield { type: 'photo', phase: 'round', text: `The last changes made the room worse; back to round ${best.round}.`, score: scoreView(best.score, best.objective) };
      return { score: best.score, objective: best.objective };
    }
    return { score: fin.score, objective: fin.objective };
  }

  // Before the first look: put each piece where its box in the photo says (a few tens of centimetres along the wall are
  // the commonest error of a position read off a flat picture). The moves go through the same tools; refusals stay as they are.
  {
    const fitted = yield* layoutStep(run, photo, desc, targets);
    if (fitted.length > 0) build.notes.push(`Before this first look the builder fitted ${fitted.length} piece${fitted.length === 1 ? '' : 's'} to where the photo shows them (${fitted.slice(0, 8).join('; ')}).`);
  }
  for (let round = 1; round <= maxRounds; round++) {
    if (ctx.signal?.aborted) throw new Error('aborted');
    yield { type: 'status', text: round === 1 ? 'Comparing the render with the photo…' : `Compare round ${round}…` };
    const shot = await snapshot(run, photo, desc, targets, extraWalls, maxViews).catch((e) => {
      if (ctx.signal?.aborted) throw e;
      return null;
    });
    if (!shot) {
      yield { type: 'photo', phase: 'unavailable', text: 'No render of the room could be made here, so it was not compared with the photo.' };
      return result(last);
    }
    const judgedWorld = host.getWorld();
    stripImages(messages);
    const blocks: ContentBlock[] = [];
    if (intro) {
      blocks.push({ type: 'text', text: compareIntroText({ summary: desc.summary || desc.roomType, checklist, notes: build.notes, hasObjective: shot.objective !== null, plan: JSON.stringify(build.plan), ...(shot.framing ? { framing: framingText(shot.framing) } : {}) }) });
      intro = false;
    } else blocks.push({ type: 'text', text: compareRoundText(round, last?.score ?? null, shot.objective, shot.legend, refusals, shot.framing ? framingText(shot.framing) : '') });
    blocks.push({ type: 'text', text: 'Image 1: the PHOTO' }, { type: 'image', dataUrl: photo.dataUrl });
    shot.images.forEach((im, i) => blocks.push({ type: 'text', text: `Image ${i + 2}: RENDER, ${im.label}` }, { type: 'image', dataUrl: im.dataUrl }));
    if (round === 1) blocks.push({ type: 'text', text: `Legend of the numbers:\n${shot.legend}${firstRefusals.length > 0 ? `\nRefused while building (place these again with the right numbers, or fix the cause):\n${firstRefusals.map((r) => `- ${r}`).join('\n')}` : ''}` });
    pushUser(messages, blocks);
    refusals = [];
    extraWalls = [];
    yield { type: 'photo', phase: 'comparing', round, text: round === 1 ? 'Comparing the render with the photo, item by item.' : `Round ${round}: judging the render again.` };

    let judged: Judged | null = null;
    let edited = false;
    let declared = false;
    let rolledBack = false;
    let toolCalls = 0;
    for (let turn = 0; turn < TURNS_PER_ROUND && !declared && !(judged && (edited || rolledBack)); turn++) {
      const res = await ask(run, messages, tools, true);
      messages.push({ role: 'assistant', content: res.content });
      const calls = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
      const text = textOf(res.content);
      if (res.stopReason === 'error' && calls.length === 0) {
        yield { type: 'error', text: text || 'The model could not complete the comparison.' };
        return result(last);
      }
      if (calls.length === 0) {
        if (judged) {
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
          if (judged) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: 'Already recorded this round. Fix what fails, or call finish.' });
            continue;
          }
          const sb = scoreVerdicts(checklist, ok);
          const q = quality(sb, shot.objective);
          judged = { score: sb, objective: shot.objective, quality: q, measure: shot.measure };
          if (!best || q > best.quality) best = { quality: q, world: judgedWorld, score: sb, objective: shot.objective, round };
          let note = verdictReply(sb);
          // A render that is worse than an earlier one is rolled back before anything else is changed.
          if (best.round !== round && round > 1 && q < best.quality - rollbackMargin(checklist.length)) {
            rolledBack = revertTo(best.world, `Back to the best round (${best.round})`);
            if (rolledBack) {
              note += ` That is worse than round ${best.round} (${Math.round(q * 100)}% against ${Math.round(best.quality * 100)}%), so the room was rolled back to round ${best.round}; the changes in this reply are not applied. Look at the next render and try a different, smaller fix.`;
              yield { type: 'photo', phase: 'round', round, text: `Round ${round} was worse (${Math.round(q * 100)}% against ${Math.round(best.quality * 100)}%): back to round ${best.round}.`, score: scoreView(best.score, best.objective) };
            }
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
        if (judged === null) {
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

    if (!judged) {
      yield { type: 'photo', phase: 'unavailable', text: 'The assistant did not judge the render; stopped comparing.' };
      return result(last);
    }
    const j: Judged = judged;
    last = rolledBack && best ? { score: best.score, objective: best.objective, quality: best.quality, measure: '' } : j;
    yield { type: 'photo', phase: 'round', round, text: `Round ${round}: ${scoreLine(j.score)}${j.measure ? `; ${j.measure}` : ''}.`, score: scoreView(j.score, j.objective) };
    extraWalls = [...new Set(j.score.failing.map((f) => wallOf(desc, f)).filter((w): w is string => w !== null))].slice(0, 2);
    const verdict = tracker.observe({ keys: new Set(j.score.failing.map((f) => f.id)), score: Math.round(j.quality * 100), edited: editedBefore });
    editedBefore = edited;
    if (j.score.failing.length === 0) {
      yield { type: 'photo', phase: 'round', round, text: 'Every checklist item matches the photo.', score: scoreView(j.score, j.objective) };
      return yield* conclude(j, edited);
    }
    if (declared && !edited) {
      const good = j.score.rate >= PHOTO_TARGET_RATE && !j.score.structuralFailed;
      if (!good) yield { type: 'photo', phase: 'round', round, text: 'The assistant stopped with items still different (nothing more it could change with the tools).', score: scoreView(j.score, j.objective) };
      return yield* conclude(last, false);
    }
    if (verdict.stalled) {
      yield { type: 'photo', phase: 'round', round, text: `Stopped comparing: ${verdict.reason}.`, score: scoreView(j.score, j.objective) };
      return yield* conclude(last, edited);
    }
  }
  // Out of rounds: edits made in the last one have not been looked at.
  return yield* conclude(last ?? { score: scoreVerdicts(checklist, []), objective: null, quality: 0, measure: '' }, editedBefore);
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

/** A judge-only call on the room as it stands (no fixes), so the final numbers are measured. */
async function finalJudgement(run: PhotoRun, photo: Photo, desc: RoomDescription, targets: readonly FramingTarget[], checklist: readonly ChecklistItem[], messages: ChatMessage[]): Promise<{ score: Scoreboard; objective: number | null; measure: string } | null> {
  const shot = await snapshot(run, photo, desc, targets, [], 1);
  if (!shot) return null;
  stripImages(messages);
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
    if (ok.length > 0) return { score: scoreVerdicts(checklist, ok), objective: shot.objective, measure: shot.measure };
    messages.push({ role: 'user', content: [{ type: 'tool_result', toolUseId: call.id, content: 'No valid verdicts. Send {"verdicts":[{"id","pass","note"}]}.', isError: true }] });
  }
  return null;
}
