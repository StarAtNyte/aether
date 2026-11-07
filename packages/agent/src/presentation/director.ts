/**
 * The presentation director: the model looks at the world's points of interest and writes its short film, then
 * judges the frames a visitor meets before publish and fixes what it can through the world's own fields. The
 * deterministic parts (`story.ts`, `review.ts`) are its tools and its fallback without a model.
 */
import { applyPatches, patchesBetween, type Patch, type Story, type WorldDoc } from '@aether/core';
import { openingPictureScore, openingProbeOk } from '../opening';
import type { AgentHost, ChatMessage, ContentBlock, Provider, ReviewViewRequest, ToolDef } from '../types';
import { defaultPresentation, presentationSignals } from './kind';
import { type PointOfInterest, type PoseLike, type PresentationViews, pointsOfInterest, poiText } from './poi';
import { autoFixable, CHECKS, degenerateFrame, rankIssues, skyExpected, type FrameIssue, type ShotFix, fixPatches, frameStats, measuredIssues, parseReport, REPORT_SHOTS_TOOL, type ReviewFrame, reviewFrames, SHOT_CHECKLIST } from './review';
import { CAMERA_MOVES, checkStory, fallbackPlan, framePoi, issuesText, planToStory, repairStory, STORY_LOOKS, StoryPlan, type StoryProbe } from './story';

/** What the director needs of the host (the studio's agent bridge, a test fake). */
export type PresentHost = Pick<AgentHost, 'getWorld' | 'applyPatches' | 'captureReview' | 'probeView' | 'decodeImage' | 'presentationViews' | 'composeImages'>;

/** Images in one model request (the studio's server proxy takes at most four). */
export const MAX_IMAGES_PER_CALL = 4;
/** Renders laid side by side in one contact sheet for the director. */
const SHEET_TILES = 3;

export interface DirectorOptions {
  signal?: AbortSignal;
  /** Progress lines for the UI. */
  onStatus?: (text: string) => void;
  /** Rounds of the model writing and revising the film (default 3). */
  storyRounds?: number;
  /** Rounds of review, fix and look again (default 4). */
  reviewRounds?: number;
  /** Re-pick the opening view first (the data checks found it backlit or crowded at the walk lens). */
  forceRepick?: boolean;
  /** Size of the frames rendered for the model (px, longer side; default 640). */
  size?: number;
}

export const AUTHOR_STORY_TOOL: ToolDef = {
  name: 'author_story',
  description:
    'Write the world\'s short film (world.story) as a shot list over its points of interest. op "points": list the points of interest (established views, tour stops, hero shots, the landmark, people, the spawn) with their ids. op "write": the film from your shot list; each shot names a point ("poi") or gives a camera, a move (hold, push-in, pull-out, orbit-left/right, crane-up/down, pan-left/right, truck-left/right; "amount" 0.1-2), a duration (s) and optional caption, title, subtitle, hour (time of day for the shot), transition (cut, fade, flash) and track (an entity to keep in frame). The film runs 45-90 s. Every shot is checked (no camera in geometry or under water, nothing against the lens, the subject in frame) and repaired where it can be; what is left is reported. op "auto": the film written by film grammar without you (a starting point). The world then starts on the film (P plays, Tab explores) unless start is false.',
  inputSchema: {
    type: 'object',
    properties: {
      op: { type: 'string', enum: ['points', 'write', 'auto'] },
      title: { type: 'string' },
      look: { type: 'string', enum: [...STORY_LOOKS] },
      letterbox: { type: 'number' },
      shots: {
        type: 'array',
        maxItems: 24,
        items: {
          type: 'object',
          properties: {
            poi: { type: 'string' },
            camera: { type: 'object', properties: { position: { type: 'array', items: { type: 'number' } }, target: { type: 'array', items: { type: 'number' } }, fov: { type: 'number' } } },
            move: { type: 'string', enum: [...CAMERA_MOVES] },
            amount: { type: 'number' },
            duration: { type: 'number' },
            name: { type: 'string' },
            caption: { type: 'string' },
            title: { type: 'string' },
            subtitle: { type: 'string' },
            hour: { type: 'number' },
            transition: { type: 'string', enum: ['cut', 'fade', 'flash'] },
            fov: { type: 'number' },
            track: { type: 'string' },
          },
          required: ['duration'],
        },
      },
      endCard: { type: 'object', properties: { title: { type: 'string' }, lines: { type: 'array', items: { type: 'string' }, maxItems: 4 } }, required: ['title'] },
      start: { type: 'boolean', description: 'Make the film the way the published world starts (default true).' },
      message: { type: 'string' },
    },
    required: ['op'],
    additionalProperties: false,
  },
};

const DIRECTOR_SYSTEM = `You are the director of a short film (45 to 90 seconds) that opens a published 3D world. You see the world's points of interest, rendered, and write the shot list with the author_story tool (op "write").
Film grammar: open on an establishing wide (with the title card), then a second view that brings the visitor in, then two to four details (textures, corners, the life of the place), then the subject (a person if there is one: keep them in frame with track; else the landmark), then a held beat (a hold of 6 to 10 s where nothing but light moves), then a closing pull-out into the end card. Vary shot sizes and moves; cut on motion; fade only at the start. Durations 4 to 12 s.
The end card is the world's name with the lines "Press P to play" and "Tab to explore" (P plays as the character after the film). Use only what the renders show: never caption something that is not there. Captions are sparse (two to four in the film), plain and specific to this world; no invented backstory unless the world's description gives one. The sun may move on through the film with "hour" (a little: an hour or two, warmer toward the end), never into darkness for a daytime scene, and never for an interior.
Prefer the established points (opening, view-N, stop-N): their cameras are clear. Points with no camera (people, the landmark) are framed by the tool. The tool checks each shot and tells you what it repaired and what is left: revise until nothing is left.`;

const isImage = (s: unknown): s is string => typeof s === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(s);

async function viewsOf(host: PresentHost, signal?: AbortSignal): Promise<PresentationViews | null> {
  if (!host.presentationViews) return null;
  try {
    return await host.presentationViews(signal ? { signal } : {});
  } catch {
    return null;
  }
}

function probeOf(host: PresentHost): StoryProbe | null {
  const probe = host.probeView?.bind(host);
  return probe ? (pose: PoseLike) => probe({ position: pose.position, target: pose.target, up: [0, 1, 0], fov: pose.fov ?? 50 }) : null;
}

function request(name: string, label: string, pose: PoseLike, aspect: number): ReviewViewRequest {
  return { name, label, kind: 'exterior', pose: { position: [...pose.position], target: [...pose.target], up: [0, 1, 0], fov: pose.fov ?? 50 }, hideTops: false, aspect, marks: [] };
}

async function render(host: PresentHost, reqs: readonly ReviewViewRequest[], size: number, signal?: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!host.captureReview || reqs.length === 0) return out;
  try {
    const got = await host.captureReview(reqs, { size, ...(signal ? { signal } : {}) });
    for (const g of got) if (isImage(g.dataUrl)) out.set(g.name, g.dataUrl);
  } catch {
    /* no renders: the director works from the data alone */
  }
  return out;
}

/** Whether a world is presented indoors (a building without open land round it). */
function indoorWorld(world: WorldDoc): boolean {
  const sig = presentationSignals(world);
  return (sig.buildings > 0 || sig.rooms > 0) && !sig.terrain && !sig.water;
}

/** The outcome of authoring a film. */
export interface AuthoredFilm {
  story: Story;
  source: 'ai' | 'fallback';
  fixed: string[];
  remaining: string[];
  notes: string[];
  /** Model calls made. */
  calls: number;
}

/** The world with `story` stored (and its start mode set to the film unless `start` is false). */
export function storyPatches(story: Story, start = true): Patch[] {
  return [{ op: 'setMeta', story, ...(start ? { startMode: 'story' as const } : {}) }];
}

/**
 * Write the world's film: the model (when there is one) sees the points of interest rendered and writes the shot list;
 * each draft is checked and repaired, and the model revises what is left. Without a model, or when it fails, the film
 * follows {@link fallbackPlan}. The film is stored in the world (one undo step).
 */
export async function authorStory(host: PresentHost, provider: Provider | null, opts: DirectorOptions & { start?: boolean } = {}): Promise<AuthoredFilm> {
  const { signal } = opts;
  const status = opts.onStatus ?? (() => undefined);
  const world = host.getWorld();
  const views = await viewsOf(host, signal);
  const pois = pointsOfInterest(world, views);
  const probe = probeOf(host);
  const indoor = indoorWorld(world);
  let calls = 0;
  let film: { story: Story; source: 'ai' | 'fallback'; fixed: string[]; remaining: string[]; notes: string[] } | null = null;
  if (provider) {
    status('Rendering the points of interest for the director…');
    const from = pois.find((p) => p.kind === 'opening')?.pose?.position ?? world.player.spawn;
    const shown = pois.filter((p) => p.kind !== 'spawn').slice(0, 10);
    const imgs = await render(host, shown.map((p) => request(p.id, p.label, framePoi(p, from), 16 / 9)), Math.min(512, opts.size ?? 512), signal);
    const blocks: ContentBlock[] = [{ type: 'text', text: `World "${world.name}": ${world.description.slice(0, 600) || '(no description)'}\nTime of day: ${world.environment.timeOfDay ?? 'default'} h. ${indoor ? 'An interior: keep the hour.' : ''}\nPoints of interest:\n${poiText(pois)}` }];
    blocks.push(...(await sheets(host, shown.filter((p) => imgs.has(p.id)).map((p) => ({ id: p.id, label: p.label, image: imgs.get(p.id) as string })))));
    blocks.push({ type: 'text', text: 'Write the film now with author_story op "write".' });
    const messages: ChatMessage[] = [{ role: 'user', content: blocks }];
    const rounds = Math.max(1, opts.storyRounds ?? 3);
    for (let round = 0; round < rounds && !signal?.aborted; round++) {
      status(round === 0 ? 'The director is writing the film…' : `The director is revising the film (round ${round + 1})…`);
      let res;
      try {
        res = await provider.complete({ role: 'planner', system: DIRECTOR_SYSTEM, messages, tools: [AUTHOR_STORY_TOOL], maxTokens: 8000, temperature: 0.4 });
        calls++;
      } catch {
        break;
      }
      messages.push({ role: 'assistant', content: res.content });
      const call = res.content.find((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use' && b.name === AUTHOR_STORY_TOOL.name);
      if (!call) {
        if (round + 1 < rounds) messages.push({ role: 'user', content: 'Call author_story with op "write" and the shot list.' });
        continue;
      }
      const parsed = StoryPlan.safeParse(stripOp(call.input));
      if (!parsed.success) {
        messages.push({ role: 'user', content: [{ type: 'tool_result', toolUseId: call.id, content: `Invalid shot list: ${parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, isError: true }] });
        continue;
      }
      const draft = planToStory(world, parsed.data, pois);
      const repaired = await repairStory(draft, probe, pois);
      film = { story: repaired.story, source: 'ai', fixed: repaired.fixed, remaining: repaired.remaining.map((r) => issuesText([r])), notes: draft.notes };
      const left = [...draft.notes, ...repaired.remaining.map((r) => issuesText([r]))];
      if (left.length === 0 || round + 1 >= rounds) break;
      messages.push({ role: 'user', content: [{ type: 'tool_result', toolUseId: call.id, content: `Checked. Repaired: ${repaired.fixed.join('; ') || 'nothing'}.\nStill wrong:\n${left.join('\n')}\nRevise the shot list (op "write", the whole list).` }] });
    }
  }
  if (!film) {
    status('Writing the film by film grammar (no model)…');
    const draft = planToStory(world, fallbackPlan(world, pois, { indoor }), pois);
    const repaired = await repairStory(draft, probe, pois);
    film = { story: repaired.story, source: 'fallback', fixed: repaired.fixed, remaining: repaired.remaining.map((r) => issuesText([r])), notes: draft.notes };
  }
  host.applyPatches(storyPatches(film.story, opts.start !== false), 'Short film');
  return { ...film, calls };
}

/** A tool input without its `op` and `start`/`message` keys (the plan itself). */
export function stripOp(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  const { op: _op, start: _start, message: _message, ...rest } = input as Record<string, unknown>;
  return rest;
}

// ---------------------------------------------------------------------------
// The pre-publish review
// ---------------------------------------------------------------------------

/** One frame's outcome. */
export interface FrameResult {
  name: string;
  label: string;
  kind: ReviewFrame['kind'];
  /** The last render of the frame (after the fixes). */
  image: string | null;
  /** The first render, when a fix changed the frame. */
  before: string | null;
  issues: FrameIssue[];
  fixed: string[];
  /** Fixes tried and undone (the frame was not better). */
  undone: string[];
}

/** The outcome of the review. */
export interface ShotReview {
  frames: FrameResult[];
  fixed: string[];
  /** Fixes tried and undone because the frame was not judged better. */
  undone: string[];
  /** Problems left for the user (shown in the publish dialog). */
  remaining: FrameIssue[];
  summary: string;
  judgedBy: 'model' | 'measured';
  rounds: number;
  calls: number;
}

const JUDGE_SYSTEM = `You review the frames a visitor sees when a 3D world is published, before it goes out, the way a careful cinematographer checks a reel. ${SHOT_CHECKLIST}
Be strict about what a visitor would notice in the first seconds; do not report matters of taste. Measured evidence (from the pixels and a depth probe) is given with each frame: weigh it, it is not the verdict. Call report_shots once with every frame.`;

/**
 * Render the opening view, a few frames of the film or the tour and the play spawn; judge them (the model with the
 * checklist, else the measurements alone); apply the fixes that can be applied (re-pick the opening, move, re-aim or drop
 * a shot, set a shot's hour, turn the spawn toward the landmark); render again and judge again, up to `reviewRounds`.
 */
export async function reviewShots(host: PresentHost, provider: Provider | null, opts: DirectorOptions = {}): Promise<ShotReview> {
  const { signal } = opts;
  const status = opts.onStatus ?? (() => undefined);
  const size = opts.size ?? 640;
  const rounds = Math.max(1, opts.reviewRounds ?? 4);
  const results = new Map<string, FrameResult>();
  const fixedAll: string[] = [];
  let summary = '';
  let calls = 0;
  let round = 0;
  let open: FrameIssue[] = [];
  let modelJudged = false;
  const failedFrames = new Set<string>();
  const triedOpening = new Set<string>();
  /** Fixes already applied per frame: a fix that did not cure the frame is not repeated, the next one is tried. */
  const applied = new Map<string, ShotFix[]>();
  /** Frames fixed in the last round (their fixes were applied but, at the round limit, not looked at again). */
  const fixedLast = new Set<string>();
  /** The fix each frame got this round, to be kept or undone when the frame is judged again. */
  const trial = new Map<string, { before: WorldDoc; after: WorldDoc; issues: number; done: string }>();
  const undoneAll: string[] = [];
  let views = await viewsOf(host, signal);
  const building = (() => {
    const sig = presentationSignals(host.getWorld());
    return sig.buildings > 0 || sig.rooms > 0;
  })();
  if (opts.forceRepick) {
    status('Choosing a better opening view…');
    // The opening as it was, kept as the frame's "before".
    const first = reviewFrames(host.getWorld(), views, building ? { walkLens: 70, detail: false } : { detail: false }).find((f) => f.kind === 'opening');
    if (first) {
      const img = (await render(host, [request(first.name, first.label, first.pose, first.aspect)], size, signal)).get(first.name) ?? null;
      results.set(first.name, { name: first.name, label: first.label, kind: first.kind, image: img, before: null, issues: [], fixed: [], undone: [] });
    }
    const done = await repickOpening(host, provider, views, triedOpening, size, signal, () => calls++);
    if (done) {
      fixedAll.push(done);
      results.get('opening')?.fixed.push(done);
      views = await viewsOf(host, signal);
    }
  }
  for (; round < rounds && !signal?.aborted; round++) {
    const world = host.getWorld();
    const frames = reviewFrames(world, views, building ? { walkLens: 70 } : {});
    if (frames.length === 0) break;
    status(round === 0 ? `Rendering ${frames.length} frames for the shot review…` : `Rendering the fixed frames (round ${round + 1})…`);
    const imgs = await render(host, frames.map((f) => request(f.name, f.label, f.pose, f.aspect)), size, signal);
    // A degenerate frame (near-black, one flat tone, a daytime sky come out black) is rendered again on its own first: a
    // capture can lose its frame to another render in flight, and a lost frame is not the world's fault.
    if (host.decodeImage) {
      for (const f of frames) {
        const img = imgs.get(f.name);
        const px = img ? await host.decodeImage(img, 48).catch(() => null) : null;
        const st = px ? frameStats(px) : null;
        if (!degenerateFrame(st, { skyExpected: skyExpected(world, f.pose, f.kind) })) continue;
        const again = await render(host, [request(f.name, f.label, f.pose, f.aspect)], size, signal);
        const img2 = again.get(f.name);
        if (img2) imgs.set(f.name, img2);
      }
    }
    const evidence: FrameIssue[] = [];
    const blocks: ContentBlock[] = [{ type: 'text', text: `World "${world.name}" (${world.profile ?? defaultPresentation(world).profile}, starts in ${world.startMode ?? 'the default mode'}). Frames:` }];
    for (const f of frames) {
      const img = imgs.get(f.name) ?? null;
      const px = img && host.decodeImage ? await host.decodeImage(img, 96).catch(() => null) : null;
      const pr = host.probeView ? await host.probeView({ position: f.pose.position, target: f.pose.target, up: [0, 1, 0], fov: f.pose.fov ?? 50 }).catch(() => null) : null;
      const st = px ? frameStats(px) : null;
      // Still degenerate after a render of its own: the render failed (a lost frame, a lost context, a missing sky), and a
      // failed render says nothing about the world. It is reported, never judged or fixed.
      const why = degenerateFrame(st, { skyExpected: skyExpected(world, f.pose, f.kind) });
      const failed = why !== null;
      const m = failed ? [{ frame: f.name, check: 'other' as const, note: `the render of this frame failed (${why}): not judged`, fix: 'none' as const, by: 'measured' as const }] : measuredIssues(f, st, pr);
      evidence.push(...m);
      if (failed) failedFrames.add(f.name);
      else failedFrames.delete(f.name);
      const prev = results.get(f.name);
      results.set(f.name, { name: f.name, label: f.label, kind: f.kind, image: img ?? prev?.image ?? null, before: prev ? (prev.before ?? prev.image) : null, issues: [], fixed: prev?.fixed ?? [], undone: prev?.undone ?? [] });
      blocks.push({ type: 'text', text: `Frame "${f.name}": ${f.label}. Camera ${JSON.stringify(f.pose.position.map((v) => Math.round(v * 10) / 10))} looking at ${JSON.stringify(f.pose.target.map((v) => Math.round(v * 10) / 10))}. Measured: ${m.length ? m.map((x) => x.note).join('; ') : 'nothing wrong'}.` });
      if (img && !failed) blocks.push({ type: 'image', dataUrl: img });
    }
    let issues: FrameIssue[] = evidence;
    if (failedFrames.size === frames.length) {
      summary = 'Every render failed (black, flat or without its sky): nothing was judged or changed. Review again once the view draws.';
      open = evidence;
      break;
    }
    if (provider && imgs.size > failedFrames.size) {
      status(round === 0 ? 'Judging the frames against the checklist…' : `Judging the fixed frames (round ${round + 1})…`);
      // At most four images a request: the frames are judged in batches, each with the whole world's header.
      const groups = batches(blocks.slice(1), MAX_IMAGES_PER_CALL);
      const found: FrameIssue[] = [];
      const summaries: string[] = [];
      let answered = 0;
      // The batches are judged at once (each is independent).
      const answers = await Promise.all(
        groups.map((g) =>
          provider
            .complete({ role: 'critic', system: JUDGE_SYSTEM, messages: [{ role: 'user', content: [blocks[0] as ContentBlock, ...g] }], tools: [REPORT_SHOTS_TOOL], maxTokens: 6000, temperature: 0 })
            .catch(() => null),
        ),
      );
      for (const res of answers) {
        if (!res) continue;
        calls++;
        const call = res.content.find((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use' && b.name === REPORT_SHOTS_TOOL.name);
        if (!call) continue;
        const rep = parseReport(call.input, frames);
        // A batch reports only on its own frames; a judge that repeats another batch's frame is not counted twice.
        for (const x of rep.issues) if (!found.some((y) => y.frame === x.frame && y.check === x.check && y.note === x.note)) found.push(x);
        if (rep.summary) summaries.push(rep.summary);
        answered++;
      }
      if (answered > 0) {
        modelJudged = true;
        // The measurements are facts, not taste: a camera in geometry or a black frame stands even when the judge missed it.
        issues = [...found, ...evidence.filter((e) => (e.by === 'probe' || e.check === 'exposure') && !found.some((x) => x.frame === e.frame && x.check === e.check))];
        summary = summaries.join(' ') || summary;
      }
    }
    for (const r of results.values()) r.issues = issues.filter((x) => x.frame === r.name);
    // A fix is kept only when the frame it was made for is judged better (fewer problems) than before it; else it is
    // undone, so a hand-made view is never left worse than it was. Undone in reverse order of application.
    for (const t of [...trial.entries()].reverse()) {
      const [name, tr] = t;
      const now = issues.filter((x) => x.frame === name && autoFixable(x)).length;
      if (now < tr.issues) continue;
      const undo = patchesBetween(tr.after, tr.before);
      if (undo.length > 0) host.applyPatches(undo, `Shot review: undo ${tr.done} (not better)`);
      const r = results.get(name);
      if (r) {
        r.fixed = r.fixed.filter((d) => d !== tr.done);
        r.undone.push(tr.done);
      }
      const k = fixedAll.lastIndexOf(tr.done);
      if (k >= 0) fixedAll.splice(k, 1);
      undoneAll.push(tr.done);
      if (tr.done.startsWith('re-picked')) views = await viewsOf(host, signal);
    }
    trial.clear();
    open = issues;
    // Only measured facts and the judge's sure, high-severity findings are fixed on their own; the rest are suggestions.
    const fixable = rankIssues(issues.filter(autoFixable));
    if (fixable.length === 0) {
      if (!summary) summary = modelJudged ? 'The frames pass the checklist.' : 'The measurements find nothing wrong.';
      break;
    }
    // The last round only looks: every fix that stays was judged after it was made.
    if (round + 1 >= rounds) break;
    // Apply at most one fix per frame per round, then look again.
    let changed = false;
    fixedLast.clear();
    for (const f of frames) {
      const found = fixable.find((x) => x.frame === f.name);
      if (!found) continue;
      // A building's opening keeps standing eye height: the judge's raise or lower becomes a re-pick.
      const firm = f.kind === 'opening' && building && (found.fix === 'raise' || found.fix === 'lower') ? { ...found, fix: 'repick-opening' as const } : found;
      const issue = escalate(firm, applied.get(f.name) ?? [], f.kind);
      if (!issue) continue;
      applied.set(f.name, [...(applied.get(f.name) ?? []), issue.fix]);
      const world = host.getWorld();
      const before = world;
      const count = fixable.filter((x) => x.frame === f.name).length;
      let done: string | null = null;
      const plan = fixPatches(world, f, issue, views);
      if ('patches' in plan) {
        const res = host.applyPatches(plan.patches, `Shot review: ${plan.done}`);
        if (res.applied.length > 0) done = plan.done;
      } else if (plan.reason === 'repick') {
        done = await repickOpening(host, provider, views, triedOpening, size, signal, () => calls++);
        if (done) views = await viewsOf(host, signal);
      }
      if (done) {
        changed = true;
        trial.set(f.name, { before, after: host.getWorld(), issues: count, done });
        fixedLast.add(f.name);
        fixedAll.push(done);
        const r = results.get(f.name);
        if (r) r.fixed.push(done);
      }
    }
    if (!changed) break;
  }
  // Left for the user: what the last look found, worst first.
  const remaining = rankIssues(open);
  if (undoneAll.length > 0) summary = `${summary ? `${summary} ` : ''}Undone (not better when judged again): ${undoneAll.join('; ')}.`;
  return { frames: [...results.values()], fixed: fixedAll, undone: undoneAll, remaining, summary, judgedBy: modelJudged ? 'model' : 'measured', rounds: Math.min(round + 1, rounds), calls };
}

/**
 * Choose another opening view: the renderer's ranked views (and the established tour stops) that are not the current one
 * and not tried before, probed, rendered and measured; the model picks among the good ones (else the best measured).
 */
async function repickOpening(host: PresentHost, provider: Provider | null, views: PresentationViews | null, tried: Set<string>, size: number, signal: AbortSignal | undefined, counted: () => void): Promise<string | null> {
  const world = host.getWorld();
  const cur = world.opening ?? views?.opening ?? null;
  if (cur) tried.add(key(cur));
  const pool: PoseLike[] = [...(views?.ranked ?? []), ...(world.views ?? views?.stops ?? [])].filter((p) => !tried.has(key(p))).slice(0, 6);
  const ok: PoseLike[] = [];
  for (const p of pool) {
    tried.add(key(p));
    const pr = host.probeView ? await host.probeView({ position: p.position, target: p.target, up: [0, 1, 0], fov: p.fov ?? 55 }).catch(() => null) : null;
    if (openingProbeOk(pr)) ok.push(p);
  }
  if (ok.length === 0) return null;
  const imgs = await render(host, ok.map((p, i) => request(`candidate-${i + 1}`, 'opening candidate', p, 16 / 9)), size, signal);
  const scored: Array<{ i: number; score: number }> = [];
  for (const [i] of ok.entries()) {
    const img = imgs.get(`candidate-${i + 1}`);
    const px = img && host.decodeImage ? await host.decodeImage(img, 96).catch(() => null) : null;
    const s = px ? openingPictureScore(px) : imgs.size === 0 ? 0 : null;
    if (s !== null) scored.push({ i, score: s });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  let pick = scored[0]?.i ?? 0;
  if (provider && scored.length > 1) {
    const blocks: ContentBlock[] = [{ type: 'text', text: 'Pick the best first view of this world for a visitor: the place clearly framed, nothing against the lens, well exposed, no missing geometry. Answer with the tool.' }];
    for (const s of scored.slice(0, MAX_IMAGES_PER_CALL)) {
      const img = imgs.get(`candidate-${s.i + 1}`);
      if (img) blocks.push({ type: 'text', text: `Candidate ${s.i + 1}` }, { type: 'image', dataUrl: img });
    }
    try {
      const res = await provider.complete({ role: 'critic', system: 'You choose opening views for published 3D worlds.', messages: [{ role: 'user', content: blocks }], tools: [PICK_TOOL], maxTokens: 800, temperature: 0 });
      counted();
      const call = res.content.find((b) => b.type === 'tool_use' && b.name === PICK_TOOL.name);
      const n = call && call.type === 'tool_use' ? Number((call.input as { candidate?: unknown }).candidate) : NaN;
      if (Number.isInteger(n) && scored.some((s) => s.i === n - 1)) pick = n - 1;
    } catch {
      /* the best measured one */
    }
  }
  const chosen = ok[pick];
  if (!chosen) return null;
  const res = host.applyPatches([{ op: 'setMeta', opening: { position: [...chosen.position], target: [...chosen.target], ...(chosen.fov !== undefined ? { fov: chosen.fov } : {}) } }], 'Shot review: a new opening view');
  return res.applied.length > 0 ? `re-picked the opening view (candidate ${pick + 1} of ${ok.length})` : null;
}

/**
 * The fix to apply for `issue` given those already applied to the frame: the judge's fix the first time; when the same
 * fix was applied and the frame still fails, the next camera fix in line (pull back, raise, push in), then dropping a
 * film shot or a tour stop; null when nothing is left to try.
 */
export function escalate(issue: FrameIssue, done: readonly ShotFix[], kind: ReviewFrame['kind']): FrameIssue | null {
  if (!done.includes(issue.fix)) return issue;
  if (issue.fix === 'time-of-day' || issue.fix === 'face-landmark' || issue.fix === 'repick-opening') return kind === 'opening' && issue.fix !== 'repick-opening' ? { ...issue, fix: 'repick-opening' } : issue.fix === 'repick-opening' && done.filter((d) => d === 'repick-opening').length < 2 ? issue : null;
  const order: ShotFix[] = kind === 'opening' ? ['pull-back', 'raise', 'repick-opening'] : kind === 'spawn' ? [] : ['pull-back', 'raise', 'drop-shot'];
  const next = order.find((f) => !done.includes(f));
  return next ? { ...issue, fix: next, note: `${issue.note} (${done.at(-1)} did not cure it)` } : null;
}

/** Split blocks (text, image, text, image …) into groups with at most `max` images, keeping a frame's text with its image. */
function batches(blocks: readonly ContentBlock[], max: number): ContentBlock[][] {
  const out: ContentBlock[][] = [];
  let cur: ContentBlock[] = [];
  let n = 0;
  for (const b of blocks) {
    if (b.type === 'text' && n >= max) {
      out.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(b);
    if (b.type === 'image') n++;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/**
 * The director's renders as at most four images: contact sheets of three renders side by side (left to right, named in
 * the text before each), or the first four renders alone when the host cannot lay sheets.
 */
async function sheets(host: PresentHost, items: ReadonlyArray<{ id: string; label: string; image: string }>): Promise<ContentBlock[]> {
  const out: ContentBlock[] = [];
  if (items.length <= MAX_IMAGES_PER_CALL || !host.composeImages) {
    for (const it of items.slice(0, MAX_IMAGES_PER_CALL)) out.push({ type: 'text', text: `Render of ${it.id}: ${it.label}` }, { type: 'image', dataUrl: it.image });
    return out;
  }
  for (let i = 0; i < items.length && out.length < MAX_IMAGES_PER_CALL * 2; i += SHEET_TILES) {
    const group = items.slice(i, i + SHEET_TILES);
    const sheet = await host.composeImages(group.map((g) => ({ dataUrl: g.image })), { maxSide: 1800 }).catch(() => null);
    if (!sheet) continue;
    out.push({ type: 'text', text: `Renders, left to right: ${group.map((g) => `${g.id} (${g.label})`).join('; ')}` }, { type: 'image', dataUrl: sheet });
  }
  return out;
}

const PICK_TOOL: ToolDef = {
  name: 'pick_view',
  description: 'The candidate number of the best opening view.',
  inputSchema: { type: 'object', properties: { candidate: { type: 'integer' }, why: { type: 'string' } }, required: ['candidate'], additionalProperties: false },
};

function key(p: PoseLike): string {
  return p.position.map((v) => Math.round(v * 2)).join(',');
}

/** Checks the film in `world` would fail, with no renders (the tool's report and the tests). */
export async function storyProblems(world: WorldDoc, host: Pick<PresentHost, 'probeView'>): Promise<string[]> {
  if (!world.story) return ['the world has no film'];
  const probe = host.probeView?.bind(host);
  return (await checkStory(world.story, probe ? (pose) => probe({ position: pose.position, target: pose.target, up: [0, 1, 0], fov: pose.fov ?? 50 }) : null)).map((i) => issuesText([i]));
}

/** Points of interest the author_story tool lists (op "points"). */
export async function storyPoints(host: PresentHost, signal?: AbortSignal): Promise<PointOfInterest[]> {
  return pointsOfInterest(host.getWorld(), await viewsOf(host, signal));
}

/** For tests: apply patches to a plain world (the in-memory host). */
export function applyTo(world: WorldDoc, patches: readonly Patch[]): WorldDoc {
  return applyPatches(world, patches as Patch[]).world;
}

export { CHECKS };
