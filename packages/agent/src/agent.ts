/**
 * WorldAgent — the plan → edit → verify → repair loop.
 *
 *   user prompt + world summary ──▶ planner model ──▶ tool calls (patches, generators, …)
 *        ▲                                                 │
 *        └──── repair turn (verification report) ◀── host.verify on finish
 *
 * `run` is an async generator of {@link AgentEvent}s. It never throws: every
 * failure (provider, host, abort) becomes an `error` event and the stream
 * always ends with exactly one `done` event carrying token usage.
 */
import { summarizeWorldForModel } from './world-text';
import { z } from 'zod';
import { Patch as PatchSchema, dependencyIndex, worldTransform, type Entity, type EntityId, type Patch, type WorldDoc } from '@aether/core';
import { CONTEXT_LIMITS, formatFollowUpTurn, formatUserTurn, isImageDataUrl, requestView, sanitizeHistory } from './context';
import { sharedConversations, type ConversationStore } from './conversation';
import { sceneChangesText } from './scene-diff';
import { executeTool, raceAbort, runVerification, type ExecutorContext } from './executor';
import { realisticWorld } from './providers/mock/realistic';
import { loadCatalog } from '@aether/assets';
import { libraryDefinitions } from './library-refs';
import type { RequestScope } from './refine/guard';
import { EMPTY_MEMORY, sanitizeMemory, sanitizeSelection, type RefineMemory } from './refine/memory';
import type { FineEditResult } from './refine/plan';
import { buildCoderPrompt, buildCompactSystemPrompt, buildSystemPrompt } from './prompt';
import { errorMessage, isAbortError } from './providers/errors';
import { AGENT_TOOLS, COMPACT_TOOLS, LEVEL_TOOLS } from './tools';
import { MAKE_TEXTURE_TOOL } from './textures';
import { findingKey, findingsText } from '@aether/arch';
import { autoRepairBuildings } from './auto-repair';
import { lumaPercentiles, targetEvidenceText, type HardcoreRun, type LumaTargets } from './hardcore';
import { isBlankFrame, lightEvidenceText, pictureStats, type PictureStats } from './picture-stats';
import { MAX_REVIEW_VIEWS, RepeatLedger, reviewTurnText, snapshotForReview, StallTracker, stallAskText, type ReviewSnapshot } from './review';
import { guardVerificationClaim } from './honesty';
import { DIFFERENCES_TOOL, DIFFERENCES_TOOL_NAME, DifferenceLedger, differenceViews } from './photo/differences';
import { READ_ONLY_TOOLS, REVIEW_CROSSCHECK_SEED, REVIEW_CROSSCHECK_SYSTEM, requirementText, reviewCrossCheckText } from './review-diff';
import { CallLedger, budgetNote, stepLabel, compactConversation, drainSteer, guardedTool, steerText, trimToAnswered } from './harness';
import { briefChecklistText, richnessShortfalls, richnessOnlyTurnText, richnessSnapshot, RICHNESS_SUBJECT, REFERENCE_TOOL, REFERENCE_TOOL_NAME, richnessReviewText } from './brief';
import { briefStage, lookReference, type BriefReviewer, type BriefStageResult } from './brief-stage';
import { LEVEL_SUBJECT, levelSnapshot, levelTurnText } from './level-review';
import { withSunk } from './sunk';
import { withFalls } from './falls';
import type { AgentEvent, AgentHost, AgentOptions, ChatMessage, CompletionResponse, ContentBlock, ReviewOptions, ToolDef, UsageTotals } from './types';

const DEFAULTS = Object.freeze({ maxRepairs: 2, maxTurns: 8, maxToolCalls: 48, maxTokens: 16_000 });
/** Limits of the compact prompt profile (small on-device models, ~4k-token context). */
export const COMPACT_LIMITS = Object.freeze({ maxTokens: 1_200, summaryEntities: 15, historyMessages: 2, historyChars: 400 });

/** Options of a single {@link WorldAgent.run}. */
export interface RunOptions {
  signal?: AbortSignal;
  /** Hardcore mode: hero shots, references (in `images`, one per shot) and the art bible the review judges against. */
  hardcore?: HardcoreRun;
  /** Base64 image data URLs (sketches, references, screenshots); at most 4. */
  images?: string[];
  /** Prior conversation (text is kept; tool traffic and images are dropped). */
  history?: ChatMessage[];
  /** Conversation key forwarded to providers that keep threads (see `CompletionRequest.session`). */
  session?: string;
  /** Entities selected in the viewport: "make this red", "delete it". */
  selection?: readonly EntityId[];
  /** Memory returned by the previous run's `memory` event ("do the same for the other one"). */
  memory?: RefineMemory;
  /** Viewer heading in degrees (0 = looking toward −Z): "left" and "back" are the viewer's. */
  heading?: number;
  /**
   * 'auto' (default): a message refines the current world; a new world only when it clearly asks for one.
   * 'new': replace the world (templates, the home prompt). 'refine': never replace.
   */
  intent?: 'auto' | 'new' | 'refine';
  /**
   * Rooms from photographs. 'recreate' (the composer's "Recreate this image") rebuilds the room in the first
   * attached picture; 'auto' (default) does it when a picture comes with a prompt about a room or interior and the
   * agent was given `photo` options; 'off' never does.
   */
  photo?: 'auto' | 'recreate' | 'off';
  /** The staged photo flow: what the user said about the right to use the photo (goes into the provenance record). */
  photoPermission?: string;
  /** The staged photo flow: continue an earlier run on the same photo at the repair stage (the state of its last `photo` event). */
  photoResume?: import('./types').PhotoResumeState;
  /**
   * Messages the user typed while this run worked. Read between model turns (and before the run would end): what
   * it returns is handed to the model as a queued message that adds to or changes the request, and a `steer`
   * event reports it. Return the new messages only (the host empties its queue as it hands them over).
   */
  steer?: () => readonly string[] | Promise<readonly string[]>;
  /**
   * The brief step (when `AgentOptions.brief` is set): called with the plan before the build. Return an edited brief and/or
   * notes to change it; return nothing to carry on. Absent: the plan is shown and the build continues at once.
   */
  reviewBrief?: BriefReviewer;
}

/** The transform an object settled with (from a level tool's update patch). */
const Settled = z.object({ transform: z.object({ position: z.tuple([z.number(), z.number(), z.number()]) }) });

/** Stand-in for a declined local plan when local edits are switched off. */
const NO_LOCAL_EDIT: FineEditResult = Object.freeze({ kind: 'none', reason: 'not-understood', patches: [], summary: '', changes: [], diff: [], targets: [], scope: [], added: [], cosmetic: true, notes: [], memory: EMPTY_MEMORY, unparsed: [], ms: 0 }) as FineEditResult;

/** Most entities detailed in a focused slice, and the size of each. */
const SCOPE_ENTITIES = 12;
const SCOPE_ENTITY_CHARS = 700;

/**
 * The entities a small edit may touch, in full (generated buildings fold their
 * furniture into the summary, so without this the model could not even see the
 * sofa it is asked to recolour).
 */
function scopeBlock(world: WorldDoc, scope: RequestScope): string {
  const lines: string[] = [];
  for (const id of [...scope.allowed].filter((x) => Object.hasOwn(world.entities, x)).slice(0, SCOPE_ENTITIES)) {
    const e = world.entities[id];
    if (!e) continue;
    const { arch, ...rest } = e;
    const slim = { ...rest, ...(arch ? { arch: { role: arch.role, kind: arch.kind, room: arch.room } } : {}) };
    lines.push(`${id} = ${JSON.stringify(slim).slice(0, SCOPE_ENTITY_CHARS)}`);
  }
  return lines.length > 0 ? `in scope (edit only these, with update patches):\n${lines.join('\n')}` : '';
}

/** Worlds with more entities than this send the model a focused slice for small edits. */
export const SLICE_THRESHOLD = 80;

/** Record a provider's reported model in the usage totals (at most 4, first use order). */
export function noteModel(usage: UsageTotals, model: string | undefined): void {
  if (!model) return;
  const list = (usage.models ??= []);
  const m = model.slice(0, 64);
  if (!list.includes(m) && list.length < 4) list.push(m);
}

/** Most model turns inside one review round (a round is one look and one batch of fixes). */
const REVIEW_TURNS_PER_ROUND = 8;
/** Hard ceiling of review rounds when no cap is set: stall detection ends the loop long before it. */
const REVIEW_ROUND_CEILING = 200;

const SESSION_RE = /^[a-z0-9][a-z0-9-]{7,79}$/;

function clampInt(v: number | undefined, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : fallback;
}

/** Add one call's tokens to a run's totals. */
export function addUsage(usage: UsageTotals, res: Pick<CompletionResponse, 'usage' | 'model'>): void {
  usage.calls += 1;
  usage.inputTokens += res.usage?.inputTokens ?? 0;
  usage.outputTokens += res.usage?.outputTokens ?? 0;
  if (res.usage?.cachedInputTokens) usage.cachedInputTokens = (usage.cachedInputTokens ?? 0) + res.usage.cachedInputTokens;
  noteModel(usage, res.model);
}

/** A conversation to keep for the next run: images become their short placeholders (the thread already has them). */
function withoutImages(messages: readonly ChatMessage[]): ChatMessage[] {
  return requestView(messages, 0);
}

/** A reply that says the tools are missing: models sometimes claim this before ever trying them. */
function claimsNoTools(text: string): boolean {
  return /(unavailable|not available|isn'?t available|aren'?t available|can'?t|cannot|couldn'?t|could not|unable|don'?t have|do not have|no access).{0,100}(tool|build|edit|access|session|world)/i.test(text);
}

function textOf(blocks: readonly ContentBlock[]): string {
  return blocks.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim();
}

/** Append blocks to the conversation as a user turn (merging into a trailing user turn of blocks). */
function pushUserBlocks(messages: ChatMessage[], blocks: ContentBlock[]): void {
  const last = messages[messages.length - 1];
  if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(...blocks);
  else messages.push({ role: 'user', content: blocks });
}

/** Append text to the conversation as a user turn (merging into a trailing tool-result turn). */
function pushUserText(messages: ChatMessage[], text: string): void {
  const last = messages[messages.length - 1];
  if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push({ type: 'text', text });
  else messages.push({ role: 'user', content: [{ type: 'text', text }] });
}

/** Provider-agnostic agent that edits a world through an {@link AgentHost}. */
export class WorldAgent {
  private readonly opts: AgentOptions;
  /**
   * What the last run was asked to touch: 'small' for a targeted edit of named things (the host then skips any
   * scene-wide polishing afterwards, which would change what the user did not mention), 'broad' otherwise, null
   * before a run or when it was not classified (a new world, a photo).
   */
  lastScope: 'small' | 'broad' | null = null;
  private readonly maxRepairs: number;
  private readonly maxTurns: number;
  private readonly maxToolCalls: number;
  private readonly maxTokens: number;
  private readonly builtinGenerators: ReadonlySet<string>;
  private readonly compact: boolean;
  private readonly fineEdit: boolean;
  private readonly localEdits: boolean;
  private readonly tools: ToolDef[];
  private systemPrompt: string | undefined;
  private coderPrompt: string | undefined;
  /** The planner conversation of the current run (kept for the next run when it ends well). */
  private conversation: ChatMessage[] | null = null;
  /** The world as of the last complete model turn of the current run (what a cancelled run's conversation knows). */
  private seen: WorldDoc | null = null;
  /** What the user asked for and the pictures they attached (the review compares the renders with them). */
  private reviewAsk: { request: string; images: string[] } = { request: '', images: [] };
  /** The hardcore run in progress (null for a normal run). */
  private hardcore: HardcoreRun | null = null;
  /** The brief of the current run (the build's checklist and the richness review's yardstick), with its reference picture. */
  private briefState: BriefStageResult | null = null;

  constructor(opts: AgentOptions) {
    this.opts = opts;
    this.maxRepairs = clampInt(opts.maxRepairs, DEFAULTS.maxRepairs, 0, 10);
    this.maxTurns = clampInt(opts.maxTurns, DEFAULTS.maxTurns, 1, 200);
    this.maxToolCalls = clampInt(opts.maxToolCalls, DEFAULTS.maxToolCalls, 1, 2000);
    this.compact = opts.promptProfile === 'compact';
    this.fineEdit = opts.fineEdit !== false;
    this.localEdits = opts.localEdits ?? this.fineEdit;
    this.maxTokens = Math.min(clampInt(opts.maxTokens, DEFAULTS.maxTokens, 256, 64_000), this.compact ? COMPACT_LIMITS.maxTokens : Infinity);
    const extra = [...(opts.levelTools ? LEVEL_TOOLS : []), ...(opts.textures ? [MAKE_TEXTURE_TOOL] : [])];
    this.tools = this.compact ? COMPACT_TOOLS : extra.length > 0 ? [...AGENT_TOOLS, ...extra] : AGENT_TOOLS;
    const ids = new Set<string>();
    for (const g of opts.catalogs.generators) {
      if (typeof g === 'object' && g !== null && 'id' in g && typeof (g as { id: unknown }).id === 'string') ids.add((g as { id: string }).id);
    }
    this.builtinGenerators = ids;
  }

  /** The tools of the current run: the planner's, plus `look_closer` while a generated reference picture exists. */
  private get runTools(): ToolDef[] {
    return this.briefState?.reference ? [...this.tools, REFERENCE_TOOL] : this.tools;
  }

  /** The (cached) planner system prompt. */
  get system(): string {
    this.systemPrompt ??= this.compact ? buildCompactSystemPrompt(this.opts.catalogs) : buildSystemPrompt(this.opts.catalogs, { level: this.opts.levelTools !== undefined });
    return this.systemPrompt;
  }

  private get coderSystem(): string {
    this.coderPrompt ??= buildCoderPrompt(this.opts.catalogs);
    return this.coderPrompt;
  }

  /** Run one request against `host`, streaming progress events. */
  async *run(prompt: string, host: AgentHost, opts: RunOptions = {}): AsyncGenerator<AgentEvent> {
    const usage: UsageTotals = { inputTokens: 0, outputTokens: 0, calls: 0 };
    const session = opts.session && SESSION_RE.test(opts.session) ? opts.session : undefined;
    this.conversation = null;
    this.briefState = null;
    let failed = false;
    let cancelled = false;
    this.seen = null;
    try {
      for await (const ev of this.loop(prompt, host, opts, usage)) {
        if (ev.type === 'error') failed = true;
        yield ev;
      }
    } catch (e) {
      failed = true;
      const aborted = opts.signal?.aborted === true || isAbortError(e);
      cancelled = aborted;
      yield { type: 'error', text: aborted ? 'Cancelled.' : `Agent failed: ${errorMessage(e).slice(0, 500)}` };
    }
    // The planner conversation of this run is continued by the next one; a failed run starts the next one afresh.
    if (session) {
      const store = this.conversations;
      if (cancelled && this.conversation && !this.compact) {
        // A cancelled run can be continued ("no, instead do …"): keep what the model saw, up to its last answered turn.
        const kept = trimToAnswered(withoutImages(this.conversation));
        if (kept) store.save(session, this.system, kept, this.seen ?? host.getWorld());
        else store.forget(session);
      } else if (failed) store.forget(session);
      else if (this.conversation) store.save(session, this.system, withoutImages(this.conversation), host.getWorld());
    }
    this.conversation = null;
    this.briefState = null;
    yield { type: 'done', usage: { ...usage, ...(usage.models ? { models: [...usage.models] } : {}) } };
  }

  /** Where this agent keeps continued conversations. */
  private get conversations(): ConversationStore {
    return this.opts.conversations ?? sharedConversations;
  }

  /** Apply a locally planned small edit: no model call, a compact diff, physics only when it matters. */
  private async *applyLocal(planned: FineEditResult, ctx: ExecutorContext, host: AgentHost): AsyncGenerator<AgentEvent> {
    let fe = planned;
    const defs = ctx.resolveGenerator ? await raceAbort(libraryDefinitions(fe.patches, host.getWorld(), ctx.builtinGenerators, ctx.resolveGenerator), ctx.signal) : [];
    // "Onto the hill": settle what was moved on the real surface under it (measured by the level tools), in the same step.
    const settle = await this.settleOnGround(fe, ctx);
    // One edit is one undo step, library definitions included.
    const result = host.applyPatches([...defs, ...fe.patches, ...settle.patches], fe.summary.slice(0, 200) || 'Edit');
    if (settle.note) fe = { ...fe, notes: [settle.note, ...fe.notes] };
    yield { type: 'patches', patches: result.applied, message: fe.summary, result: { applied: result.applied.length, errors: result.errors } };
    if (result.applied.length === 0) {
      yield { type: 'error', text: result.errors[0]?.message ? `Could not apply that: ${result.errors[0].message.slice(0, 200)}` : 'Could not apply that change.' };
      return;
    }
    yield { type: 'edit', summary: fe.summary, diff: fe.diff, targets: fe.targets, cosmetic: fe.cosmetic, notes: fe.notes, ms: Math.round(fe.ms * 10) / 10, local: true };
    yield { type: 'memory', memory: fe.memory };
    const refused = result.errors.length;
    yield { type: 'message', text: `${fe.summary}.${fe.notes.length > 0 ? ` ${fe.notes[0]?.charAt(0).toUpperCase()}${fe.notes[0]?.slice(1)}.` : ''}${refused > 0 ? ` ${refused} part${refused === 1 ? ' was' : 's were'} refused (locked objects).` : ''}` };
    // Colours, lights, names and sky cannot break physics: only geometric edits are re-verified.
    if (!fe.cosmetic) {
      yield { type: 'status', text: 'Checking physics…' };
      const v = await runVerification(ctx);
      yield v.event;
      if (!v.passed) yield { type: 'message', text: `Heads up: the checks flagged something after this change (${v.summary.split('\n')[0]?.slice(0, 160) ?? 'see the verification panel'}). Undo reverts it.` };
    }
  }

  /**
   * Patches that put the objects of a local "onto" move on the surface under them, and a note saying where they
   * landed. Uses the host's level tools (ray casts against the real colliders); without them the move stands as
   * planned. Never throws.
   */
  private async settleOnGround(fe: FineEditResult, ctx: ExecutorContext): Promise<{ patches: Patch[]; note?: string }> {
    const run = ctx.levelTools;
    const after = fe.world;
    if (!run || !after || !fe.ground || fe.ground.length === 0) return { patches: [] };
    const items = fe.ground.filter((id) => Object.hasOwn(after.entities, id)).slice(0, 20).map((id) => {
      const p = worldTransform(after, id).position;
      return { id, x: Math.round(p[0] * 100) / 100, z: Math.round(p[2] * 100) / 100, reach: false };
    });
    if (items.length === 0) return { patches: [] };
    try {
      const out = await raceAbort(run(after, 'place_level_items', { items, message: 'Settle on the ground' }), ctx.signal);
      if (!out.ok || out.patches.length === 0) return { patches: [], note: `it may not rest on the surface there: ${out.text.split('\n').find((l) => l.startsWith('- '))?.slice(2, 200) ?? 'the ground could not be measured'}` };
      // Untrusted: only transform updates of the moved objects and of what belongs to them are taken.
      const belongs = dependencyIndex(after).closure(items.map((it) => it.id));
      const patches: Patch[] = [];
      let y: number | undefined;
      for (const raw of out.patches) {
        const p = PatchSchema.safeParse(raw);
        if (!p.success || p.data.op !== 'update') continue;
        const id = p.data.id;
        if (!belongs.has(id)) continue;
        if (!items.some((it) => it.id === id)) {
          patches.push(p.data);
          continue;
        }
        patches.push(p.data);
        const pos = Settled.safeParse(p.data.set);
        if (pos.success) y ??= pos.data.transform.position[1];
      }
      return { patches, ...(y !== undefined ? { note: `settled on the surface there (y ${Math.round(y * 100) / 100})` } : {}) };
    } catch {
      return { patches: [] };
    }
  }

  private async *loop(prompt: string, host: AgentHost, opts: RunOptions, usage: UsageTotals): AsyncGenerator<AgentEvent> {
    const signal = opts.signal;
    this.lastScope = null;
    const request = typeof prompt === 'string' ? prompt.trim() : '';
    if (request.length === 0) throw new Error('the prompt is empty');
    if (request.length > CONTEXT_LIMITS.MAX_PROMPT_CHARS) throw new Error(`the prompt is too long (max ${CONTEXT_LIMITS.MAX_PROMPT_CHARS} characters)`);
    const images = opts.images ?? [];
    if (images.length > CONTEXT_LIMITS.MAX_IMAGES) throw new Error(`at most ${CONTEXT_LIMITS.MAX_IMAGES} images are allowed`);
    if (!images.every(isImageDataUrl)) throw new Error('images must be base64 PNG/JPEG/WebP/GIF data URLs under 5 MiB');

    const ctx: ExecutorContext = {
      host,
      provider: this.opts.provider,
      coderSystem: this.coderSystem,
      builtinGenerators: this.builtinGenerators,
      usage,
      ...(this.opts.resolveGenerator ? { resolveGenerator: this.opts.resolveGenerator } : {}),
      ...(this.opts.buildAsset ? { buildAsset: this.opts.buildAsset } : {}),
      ...(this.opts.importAsset ? { importAsset: this.opts.importAsset } : {}),
      ...(this.opts.hubSearch ? { hubSearch: this.opts.hubSearch } : {}),
      ...(this.opts.levelTools ? { levelTools: this.opts.levelTools } : {}),
      ...(this.opts.textures ? { textures: this.opts.textures } : {}),
      ...(signal ? { signal } : {}),
      realistic: realisticWorld(request, host.getWorld()),
    };

    // Library furniture and models are resolved by name: the catalog must be in before anything is planned.
    await loadCatalog().catch(() => undefined);
    // A picture of a room with a prompt about it: rebuild THAT room from the photo (never a preset room).
    const photoMode = opts.hardcore ? 'off' : (opts.photo ?? 'auto');
    // The room-from-photo pipeline is large and rarely used: loaded on demand so it stays out of the first-load bundle.
    const photoPipeline = photoMode !== 'off' && (this.opts.photo !== undefined || photoMode === 'recreate') && images[0] !== undefined ? await import('./photo/pipeline') : undefined;
    if (photoPipeline && photoPipeline.isRoomPhotoRequest(request, images.length, photoMode === 'recreate') && images[0] !== undefined) {
      const { reconstructRoom } = photoPipeline;
      const sessionKey = opts.session && SESSION_RE.test(opts.session) ? opts.session : undefined;
      const base = this.compact ? { ...(this.opts.photo ?? {}), vision: false } : (this.opts.photo ?? {});
      const options = { ...base, ...(opts.photoPermission ? { permission: opts.photoPermission } : {}), ...(opts.photoResume ? { resume: opts.photoResume } : {}) };
      // The photo flow keeps its own conversation: the next planner run starts a new one.
      if (sessionKey) this.conversations.forget(sessionKey);
      yield* reconstructRoom({ ctx, system: this.system, tools: this.tools, maxTokens: this.maxTokens, maxToolCalls: this.maxToolCalls, ...(sessionKey ? { session: sessionKey } : {}), request, image: images[0], options, replace: opts.intent !== 'refine' });
      return;
    }
    const world0 = host.getWorld();
    const hasWorld = Object.keys(world0.entities).length > 0 || world0.voxel !== undefined;
    const intent = opts.intent ?? 'auto';
    let scope: RequestScope | undefined;
    let ambiguity = '';
    if (this.fineEdit && hasWorld && intent !== 'new' && images.length === 0) {
      const memory = sanitizeMemory(opts.memory);
      const selection = sanitizeSelection(opts.selection);
      const heading = typeof opts.heading === 'number' && Number.isFinite(opts.heading) ? opts.heading % 360 : 0;
      // The edit engine (parser, lexicon, operations) is a separate chunk, loaded on the first prompt.
      const refine = await import('./refine/runtime');
      const fe = !this.localEdits ? NO_LOCAL_EDIT : refine.planFineEdit({ world: world0, text: request, selection, memory, heading, catalogs: { generators: [...this.opts.catalogs.generators, ...(this.opts.catalogs.libraryGenerators ?? [])] } });
      if (fe.kind === 'question' && fe.question) {
        // Offline the question goes to the user. A model is the brain: it sees the scene and decides which one is
        // meant ("the shrine" is the landmark, not its altar), and asks only when it truly cannot tell.
        if (this.opts.provider.name === 'mock') {
          yield { type: 'clarify', text: fe.question.text, candidates: fe.question.candidates };
          yield { type: 'memory', memory: fe.memory };
          return;
        }
        const names = fe.question.candidates.slice(0, 8).map((c) => `${c.label.slice(0, 60)} (${c.id})`).join(', ');
        ambiguity = `Several things could be meant: ${names}. Decide from the scene which one the user means (the whole object over its parts) and act on it; ask only if it is genuinely unclear.`;
      }
      if (fe.kind === 'undo' || fe.kind === 'redo') {
        yield { type: 'history', action: fe.kind };
        return;
      }
      if (fe.kind === 'edit') {
        yield* this.applyLocal(fe, ctx, host);
        return;
      }
      if (fe.kind === 'none' && fe.reason === 'refused' && fe.detail) {
        yield { type: 'message', text: fe.detail };
        return;
      }
      // Offline, an edit that names something the world does not have ("move the shrine onto the hill" with no shrine)
      // is answered plainly: the offline planner can only add whole scenes, which would be a wrong guess. A model is
      // asked instead, because it can build what is missing.
      if (fe.kind === 'none' && fe.reason === 'failed' && fe.detail && this.opts.provider.name === 'mock' && nothingNamed(world0, fe.detail, refine)) {
        yield { type: 'message', text: `${fe.detail}, so I left the world as it is. Name something that is in the scene, or connect an AI model to build what is missing.` };
        return;
      }
      scope = refine.classifyScope(world0, request, { selection, focus: memory.targets, heading });
      this.lastScope = scope.kind === 'small' && scope.allowed.size > 0 ? 'small' : 'broad';
      if (scope.kind === 'small') {
        const small = scope;
        ctx.audit = (patches) => refine.auditPatches(host.getWorld(), patches, small, world0);
      }
    }
    const slice = scope !== undefined && scope.kind === 'small' && scope.allowed.size > 0 && Object.keys(world0.entities).length > SLICE_THRESHOLD;
    const session = opts.session && SESSION_RE.test(opts.session) ? opts.session : undefined;
    const fullSummary = (): string => {
      const userEdits = host.userEdits?.();
      return summarizeWorldForModel(world0, {
        compact: this.compact,
        maxEntities: this.compact ? COMPACT_LIMITS.summaryEntities : slice ? SLICE_THRESHOLD : CONTEXT_LIMITS.SUMMARY_ENTITIES,
        ...(slice && scope ? { focus: [...scope.allowed].filter((id) => Object.hasOwn(world0.entities, id)).slice(0, 60) } : {}),
        ...(userEdits && userEdits.size > 0 ? { userEdits } : {}),
      });
    };
    const inScope = slice && scope ? scopeBlock(world0, scope) : '';
    const mode = !hasWorld || !this.fineEdit ? undefined : intent === 'new' ? 'new world: replace the current world with the one described' : 'refine: change the current world as asked and keep everything the user did not mention exactly as it is; start a new world only if the user clearly asks for one';
    // A project's next run continues the conversation of its last one (a thread-keeping backend then resumes the same
    // thread and reads only this turn): it says what changed in the scene since then instead of the whole summary.
    const earlier = session && !this.compact ? this.conversations.continuable(session, this.system) : null;
    const changes = earlier ? sceneChangesText(earlier.world, world0) : null;
    const turnText = changes !== null ? formatFollowUpTurn([changes, inScope, ambiguity].filter(Boolean).join('\n'), request, mode) : formatUserTurn([fullSummary(), inScope, ambiguity].filter(Boolean).join('\n'), request, mode);
    // A world from a text prompt starts with the brief: what this kind of space must contain, and how elaborate it should be.
    this.briefState = null;
    const wantsBrief = this.opts.brief !== undefined && !this.compact && this.opts.provider.name !== 'mock' && images.length === 0 && (intent === 'new' || !hasWorld);
    const briefBlocks: ContentBlock[] = [];
    if (wantsBrief) {
      const got = yield* briefStage({
        provider: this.opts.provider,
        request,
        usage,
        maxTokens: this.maxTokens,
        ...(signal ? { signal } : {}),
        ...(this.opts.brief?.webSearch ? { webSearch: true } : {}),
        images: this.opts.textures?.images ?? null,
        ...(opts.reviewBrief ? { review: opts.reviewBrief } : {}),
      });
      this.briefState = got;
      if (got) {
        if (got.reference) briefBlocks.push({ type: 'text', text: got.reference.label }, { type: 'image', dataUrl: got.reference.dataUrl });
        briefBlocks.push({ type: 'text', text: briefChecklistText(got.brief, got.notes) });
        if (got.reference) briefBlocks.push({ type: 'text', text: 'You can study the reference image with look_closer (crops by box) to pull details worth building.' });
      }
    }
    const first: ContentBlock[] = [...images.map((dataUrl): ContentBlock => ({ type: 'image', dataUrl })), { type: 'text', text: turnText }, ...briefBlocks];
    let messages: ChatMessage[];
    if (earlier) {
      // The last run's closing tool results were never sent: the new turn joins them.
      const last = earlier.messages[earlier.messages.length - 1];
      messages = last && last.role === 'user' && Array.isArray(last.content) ? [...earlier.messages.slice(0, -1), { role: 'user', content: [...last.content, ...first] }] : [...earlier.messages, { role: 'user', content: first }];
    }
    else {
      const prior = sanitizeHistory(opts.history);
      const kept = this.compact ? prior.slice(prior.length > COMPACT_LIMITS.historyMessages ? prior.length - COMPACT_LIMITS.historyMessages : 0) : prior;
      // History must start with a user turn.
      const trimmed = this.compact ? kept.map((m): ChatMessage => ({ role: m.role, content: (m.content as string).slice(0, COMPACT_LIMITS.historyChars) })) : kept;
      const history = trimmed.length > 0 && trimmed[0]?.role !== 'user' ? trimmed.slice(1) : trimmed;
      messages = [...history, { role: 'user', content: first }];
    }
    this.conversation = messages;

    this.reviewAsk = { request, images };
    this.hardcore = opts.hardcore && opts.hardcore.shots.length > 0 ? opts.hardcore : null;
    const startWorld = host.getWorld();
    let repairs = 0;
    let nudges = 0;
    let lastRefused = false;
    let toolCalls = 0;
    const ledger = new CallLedger();
    const said = new Set<string>();
    let askedUnresolved = false;
    let dirty = false; // edits since the last verification
    let lastVerifyPassed: boolean | undefined;
    // A small edit that names objects (move the lamp, make the door red) is not reviewed like a whole building: only a run that
    // re-plans or rebuilds the shell is. This keeps one-property chat edits fast on a big house.
    let structural = false;
    const reviewable = () => scope === undefined || scope.kind !== 'small' || scope.allowed.size === 0 || structural;

    yield { type: 'status', text: 'Planning…' };
    for (let turn = 0; turn < this.maxTurns; turn++) {
      if (signal?.aborted) throw new Error('aborted');
      compactConversation(messages);
      const warn = budgetNote(this.maxTurns - turn, this.maxToolCalls - toolCalls, this.maxToolCalls, said);
      if (warn && turn > 0) pushUserText(messages, warn);
      // The conversation stays append-only; a request carries at most the newest images.
      const res: CompletionResponse = await raceAbort(
        this.opts.provider.complete({ role: 'planner', system: this.system, messages: requestView(messages), tools: this.runTools, maxTokens: this.maxTokens, ...(session ? { session } : {}) }, signal),
        signal,
      );
      addUsage(usage, res);
      messages.push({ role: 'assistant', content: res.content });

      const calls = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
      const text = textOf(res.content);
      if (text) yield { type: calls.length > 0 ? 'plan' : 'message', text: calls.length > 0 ? text : guardVerificationClaim(text, { ran: lastVerifyPassed !== undefined, pending: dirty }) };

      if (res.stopReason === 'error' && calls.length === 0) {
        yield { type: 'error', text: text || 'The model could not complete this request.' };
        return;
      }

      let finished: { message: string } | undefined;
      if (calls.length > 0) {
        const results: ContentBlock[] = [];
        const lookBlocks: ContentBlock[] = [];
        let batchRefused = false;
        for (const call of calls) {
          if (signal?.aborted) throw new Error('aborted');
          if (toolCalls >= this.maxToolCalls) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: 'Tool-call budget exhausted for this request. Call finish now.', isError: true });
            continue;
          }
          toolCalls++;
          if (call.name === REFERENCE_TOOL_NAME && this.briefState?.reference) {
            const look = await lookReference(this.briefState.reference, host, call.input);
            results.push({ type: 'tool_result', toolUseId: call.id, content: look.text, ...(look.isError ? { isError: true } : {}) });
            lookBlocks.push(...look.blocks);
            yield { type: 'step', tool: call.name, label: stepLabel(call.name, call.input, !look.isError), ok: !look.isError };
            continue;
          }
          const out = await guardedTool(ledger, ctx, call.name, call.input);
          if (call.name !== 'finish') yield { type: 'step', tool: call.name, label: stepLabel(call.name, call.input, !out.isError), ok: !out.isError };
          for (const ev of out.events) yield ev;
          if (out.edited) dirty = true;
          if (out.edited && (call.name === 'design_plan' || call.name === 'build_architecture')) structural = true;
          lastRefused = out.isError && !out.edited;
          if (out.isError && call.name !== 'finish') batchRefused = true;
          if (out.verified) {
            dirty = false;
            lastVerifyPassed = out.verified.passed;
          }
          if (out.finished) finished = out.finished;
          results.push({ type: 'tool_result', toolUseId: call.id, content: out.content, ...(out.isError ? { isError: true } : {}) });
        }
        if (finished && batchRefused && calls.length > 1) {
          // finish came in the same reply as a call that was refused: it was sent before the result was read.
          finished = undefined;
          results.push({ type: 'text', text: 'A call in that reply was refused, so finish was ignored: read the reasons above, fix them and call the tools again, then finish.' });
        }
        messages.push({ role: 'user', content: [...results, ...lookBlocks] });
        this.seen = host.getWorld();
        if (finished?.message) {
          let said = finished.message;
          // The offline planner words its answer before it runs ("Done — removed art"): when nothing you can see
          // changed (there was no art in that room), it must not claim it did.
          if (this.opts.provider.name === 'mock' && /^Done\b/.test(said) && hasWorld) {
            const { worldChanges } = await import('./refine/runtime');
            // The building's stored plan (what to omit) is bookkeeping, not something you can see.
            if (worldChanges(startWorld, host.getWorld()).every((c) => c.scope === 'entity' && c.path.startsWith('arch.plan'))) said = 'Nothing in the world matched that, so nothing changed. Name something that is in the scene (the Objects panel lists everything), or connect an AI model for open-ended edits.';
          }
          yield { type: 'message', text: guardVerificationClaim(said, { ran: lastVerifyPassed !== undefined, pending: dirty }) };
        }
      } else if (res.stopReason === 'max_tokens') {
        pushUserText(messages, 'Your reply was cut off by the output limit. Continue with smaller apply_patches calls.');
        continue;
      }

      // The model gave up in words after a refusal ("the tools are not available"): they are, and nothing is built yet.
      const gaveUp = calls.length === 0 && finished === undefined && !dirty && nudges < 3 && res.stopReason !== 'max_tokens';
      if (gaveUp && (lastRefused || (host.getWorld() === startWorld && claimsNoTools(text)))) {
        nudges++;
        const refusal = lastRefused;
        lastRefused = false;
        pushUserText(messages, refusal ? 'Your last tool call was refused, so nothing has changed yet. All the tools are still available: read the reasons in that result, fix exactly those problems and call the tool again. Only call finish if the request truly cannot be done.' : 'The tools in the tool list ARE available in this session: call them through tool_calls (design_plan, place_items, edit_items, query_scene, apply_patches, build_architecture, finish). Do the work now; do not reply that you cannot.');
        continue;
      }
      const queued = await drainSteer(opts.steer);
      if (queued.length > 0 && turn + 1 < this.maxTurns) {
        for (const t of queued) yield { type: 'steer', text: t };
        pushUserText(messages, steerText(queued));
        continue;
      }
      const turnEnded = finished !== undefined || calls.length === 0;
      if (!turnEnded) continue;
      // Finishing with refused calls nobody redid: the closing message must account for them (once).
      const open = ledger.unresolved();
      if (!askedUnresolved && open.length > 0 && toolCalls > 0 && turn + 1 < this.maxTurns) {
        askedUnresolved = true;
        pushUserText(messages, `Before you finish: these calls were refused and never succeeded afterwards:\n${open.map((o) => `- ${o}`).join('\n')}\nRedo what still matters (fixed), or call finish and say plainly what was not done.`);
        continue;
      }

      if (!dirty) {
        if (lastVerifyPassed === false) yield { type: 'status', text: 'Finished with verification issues remaining.' };
        else if (reviewable()) yield* this.review(ctx, messages, host, startWorld, session, signal, opts.steer);
        return;
      }
      yield { type: 'status', text: 'Verifying physics and tests…' };
      const v = await runVerification(ctx);
      yield v.event;
      dirty = false;
      lastVerifyPassed = v.passed;
      if (v.passed) {
        if (reviewable()) yield* this.review(ctx, messages, host, startWorld, session, signal, opts.steer);
        return;
      }
      if (repairs >= this.maxRepairs) {
        yield { type: 'status', text: `Verification still failing after ${repairs} repair attempt(s).` };
        return;
      }
      if (turn + 1 >= this.maxTurns) {
        yield { type: 'status', text: 'Turn limit reached before the world could be repaired.' };
        return;
      }
      repairs++;
      yield { type: 'repair', text: v.summary, attempt: repairs };
      pushUserText(
        messages,
        `Verification FAILED (repair ${repairs}/${this.maxRepairs}):\n${v.summary}\nFix these concrete problems with apply_patches (move, resize or re-body objects; fix rules; drop tests that cannot pass without player input), then call finish.`,
      );
    }

    yield { type: 'status', text: `Stopped after ${this.maxTurns} model turns.` };
    if (dirty) {
      const v = await runVerification(ctx);
      yield v.event;
    }
  }
  /**
   * The review-and-fix loop. After a run that left a building in the world, the model sees the checker's
   * findings (and numbered renders when it can see), fixes with the design tools, and the loop repeats until
   * the model declares the result right or progress stalls. Events report each step.
   */
  private async *review(ctx: ExecutorContext, messages: ChatMessage[], host: AgentHost, startWorld: WorldDoc, session: string | undefined, signal: AbortSignal | undefined, steer?: () => readonly string[] | Promise<readonly string[]>): AsyncGenerator<AgentEvent> {
    const entered = host.getWorld();
    const held: { diffs: DifferenceLedger | null } = { diffs: null };
    yield* this.reviewLoop(ctx, messages, host, startWorld, session, signal, steer, held);
    if (held.diffs) {
      if (this.opts.review?.crossCheck === true && this.opts.provider.name !== 'mock') yield* this.reviewCrossCheck(ctx, host, held.diffs, signal);
      // What is still open is said plainly, whether the loop approved, stalled or ran out of rounds.
      const open = held.diffs.unresolvedText();
      if (open) yield { type: 'message', text: open };
    }
    // The review fixed things after the physics run: the world that is sealed and shown as verified must be the one
    // that was checked, so verify again when the review changed anything.
    if (host.getWorld() !== entered) {
      yield { type: 'status', text: 'Verifying physics and tests after the review…' };
      const v = await runVerification(ctx);
      yield v.event;
    }
  }

  /**
   * One independent seat with fresh eyes (no conversation, a fixed seed): it sees what the user asked for, the final renders
   * and the checker's findings, and lists the gaps. It records; it never edits. Its findings join the ledger.
   */
  private async *reviewCrossCheck(ctx: ExecutorContext, host: AgentHost, diffs: DifferenceLedger, signal: AbortSignal | undefined): AsyncGenerator<AgentEvent> {
    const cfg = this.opts.review;
    const withViews = cfg && (typeof cfg.vision === 'function' ? cfg.vision() : cfg.vision === true) && typeof host.captureReview === 'function';
    if (!withViews) return;
    const world = host.getWorld();
    let snap: ReviewSnapshot = snapshotForReview(world, null, { maxViews: 4, withViews: true });
    if (snap.buildings.length === 0) {
      const lvl = this.opts.levelTools ? await raceAbort(levelSnapshot(this.opts.levelTools, world, { maxViews: 4, withViews: true }), signal).catch(() => null) : null;
      if (!lvl) return;
      snap = lvl;
    }
    if (snap.views.length === 0 || !host.captureReview) return;
    yield { type: 'status', text: 'Independent check of the final renders against the request…' };
    const blocks: ContentBlock[] = [];
    const refs = this.reviewAsk.images.slice(0, 2);
    refs.forEach((r, i) => blocks.push({ type: 'text', text: `Reference ${i + 1} from the user` }, { type: 'image', dataUrl: r }));
    try {
      const got = await raceAbort(host.captureReview(snap.views, signal ? { signal } : {}), signal);
      let n = 0;
      for (const g of got) {
        const v = snap.views.find((x) => x.name === g.name);
        if (v && isImageDataUrl(g.dataUrl) && n < 4) {
          blocks.push({ type: 'text', text: `Render: ${v.name}, ${v.label}` }, { type: 'image', dataUrl: g.dataUrl });
          n++;
        }
      }
      if (n === 0) return;
    } catch (e) {
      if (signal?.aborted) throw e;
      return;
    }
    blocks.unshift({ type: 'text', text: reviewCrossCheckText(this.reviewAsk.request, findingsText(snap.findings, 12), snap.legend, refs.length > 0) });
    const fresh = new DifferenceLedger();
    const messages: ChatMessage[] = [{ role: 'user', content: blocks }];
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: CompletionResponse;
      try {
        res = await raceAbort(this.opts.provider.complete({ role: 'critic', system: REVIEW_CROSSCHECK_SYSTEM, messages: requestView(messages, 10), tools: [DIFFERENCES_TOOL], maxTokens: Math.min(this.maxTokens, 8000), temperature: 0, seed: REVIEW_CROSSCHECK_SEED }, signal), signal);
      } catch (e) {
        if (signal?.aborted) throw e;
        return;
      }
      addUsage(ctx.usage, res);
      messages.push({ role: 'assistant', content: res.content });
      const c = res.content.find((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use' && b.name === DIFFERENCES_TOOL_NAME);
      if (!c) {
        pushUserText(messages, 'Call report_differences now (an empty list when nothing differs).');
        continue;
      }
      const rec = fresh.record(c.input, 'independent');
      if (!rec.ok) {
        messages.push({ role: 'user', content: [{ type: 'tool_result', toolUseId: c.id, content: rec.error, isError: true }] });
        continue;
      }
      for (const d of rec.ranked) diffs.record({ differences: [{ id: `check-${d.id}`.slice(0, 40), kind: d.kind, where: d.where, what: d.what, size: d.size }] }, 'independent');
      yield { type: 'review', round: 0, phase: 'crosscheck', text: rec.open === 0 ? 'Independent check, fresh eyes: the renders match the request; no gap found.' : `Independent check, fresh eyes: ${rec.open} gap${rec.open === 1 ? '' : 's'} from the request; largest: ${rec.ranked[0]?.id} (${rec.ranked[0]?.what.slice(0, 100)}).`, differences: differenceViews(rec.ranked.map((d) => ({ ...d, source: 'independent' as const }))) };
      return;
    }
  }

  private async *reviewLoop(ctx: ExecutorContext, messages: ChatMessage[], host: AgentHost, startWorld: WorldDoc, session: string | undefined, signal: AbortSignal | undefined, steer: (() => readonly string[] | Promise<readonly string[]>) | undefined, held: { diffs: DifferenceLedger | null }): AsyncGenerator<AgentEvent> {
    const cfg: ReviewOptions | undefined = this.opts.review;
    if (!cfg) return;
    const world0 = host.getWorld();
    if (world0 === startWorld) {
      yield { type: 'status', text: 'Review skipped: the run changed nothing to review.' };
      return;
    }
    const rounds = cfg.maxRounds === undefined || !Number.isFinite(cfg.maxRounds) ? REVIEW_ROUND_CEILING : Math.max(1, Math.min(REVIEW_ROUND_CEILING, Math.floor(cfg.maxRounds)));
    const unlimited = cfg.maxRounds === undefined || !Number.isFinite(cfg.maxRounds);
    const maxViews = Math.max(1, Math.min(MAX_REVIEW_VIEWS, Math.floor(cfg.maxViews ?? 6)));
    const tracker = new StallTracker(cfg.stallRounds ?? 3);
    let lastEdited = false;
    const ledger = new CallLedger();
    const diffs = cfg.differences === true ? new DifferenceLedger() : null;
    held.diffs = diffs;
    const roundTools = diffs ? [...this.runTools, DIFFERENCES_TOOL] : this.runTools;
    const imageCap = diffs ? 10 : undefined;
    const pushedBack = new Set<string>();
    const repeats = new RepeatLedger();
    let before: WorldDoc | null = startWorld;
    for (let round = 1; round <= rounds; round++) {
      if (signal?.aborted) throw new Error('aborted');
      let world = host.getWorld();
      // The offline planner is only a labelled fallback: it does not review.
      if (this.opts.provider.name === 'mock') return;
      const withViews = (typeof cfg.vision === 'function' ? cfg.vision() : cfg.vision === true) && typeof host.captureReview === 'function';
      let snap: ReviewSnapshot = snapshotForReview(world, before, { maxViews, withViews });
      // Mechanical faults (furniture clashing, poking through walls, floating) are repaired with the product's own tools before the
      // model looks: rooms furnished again by the layout solver where that helps, clashing decor taken out. The model's turns go
      // to what needs judgement.
      if (snap.buildings.length > 0 && snap.findings.some((f) => f.severity === 'error')) {
        const fix = autoRepairBuildings(world);
        if (fix.patches.length > 0) {
          const res = host.applyPatches(fix.patches, `Automatic repair: ${fix.lines.slice(0, 4).join('; ')}`.slice(0, 200));
          if (res.applied.length > 0) {
            yield { type: 'review', round, phase: 'fixing', text: `Repaired automatically: ${fix.lines.slice(0, 3).join('; ')} (${fix.before} → ${fix.after} errors).`.slice(0, 400) };
            world = host.getWorld();
            snap = snapshotForReview(world, before, { maxViews, withViews });
          }
        }
      }
      // No building: a game or outdoor level is reviewed with the level tools, when the host has them.
      if (snap.buildings.length === 0) {
        const lvl = this.opts.levelTools ? await raceAbort(levelSnapshot(this.opts.levelTools, world, { maxViews, withViews }), signal) : null;
        // A world made of free pieces with no plan and nothing to measure is still compared with its brief, or, with no brief (a refine run), judged by eye from the renders.
        const snapped = lvl ?? (this.briefState || withViews ? richnessSnapshot(world, { maxViews, withViews }) : null);
        if (!snapped) {
          yield { type: 'status', text: 'Review skipped: nothing to measure here (no building, no level snapshot, no brief to compare with).' };
          return;
        }
        snap = snapped;
      }
      // Hardcore: every round renders the hero shots, the views the references were drawn for.
      if (this.hardcore && withViews) snap = { ...snap, views: this.hardcore.shots };
      // Pieces sunk into the terrain and falls buried in the rock they pour from are checked in every round, whatever else measured the world.
      snap = withFalls(withSunk(snap, world), world);
      // Findings seen unchanged twice are folded into one unresolved line (the tracker keeps the original keys).
      snap = { ...snap, findings: repeats.apply(snap.findings) };
      const isLevel = snap.buildings[0] === LEVEL_SUBJECT;
      const richOnly = snap.buildings[0] === RICHNESS_SUBJECT;
      yield { type: 'review', round, phase: 'checking', text: round === 1 ? (isLevel ? 'Checking the level…' : 'Checking the building…') : 'Checking again…', score: snap.score, findings: snap.findings.length };
      const verdict = tracker.observe({ keys: snap.keys, score: snap.score, edited: lastEdited });
      // A stall on the checker's findings does not end a review whose brief is still short: the model is asked once about that first.
      let shortAsk: string | null = null;
      if (verdict.stalled && this.briefState) {
        const short = richnessShortfalls(host.getWorld(), this.briefState.brief);
        if (short && !pushedBack.has(short.key)) {
          pushedBack.add(short.key);
          tracker.forgive();
          shortAsk = short.text;
        }
      }
      // The same findings again: ask once for a statement per item (fix, declare or reason) before the loop gives up on them.
      let stallAsk: string | null = null;
      if (verdict.stalled && shortAsk === null && snap.findings.length > 0) {
        const sk = `stall:${[...snap.keys].sort().join('|')}`;
        if (!pushedBack.has(sk)) {
          pushedBack.add(sk);
          tracker.forgive();
          stallAsk = stallAskText(snap.findings);
        }
      }
      if (verdict.stalled && shortAsk === null && stallAsk === null) {
        yield { type: 'review', round, phase: 'stalled', text: `Stopped reviewing: ${verdict.reason}. ${snap.findings.length > 0 ? `${snap.findings.length} finding${snap.findings.length === 1 ? '' : 's'} remain.` : ''}`.trim(), score: snap.score, findings: snap.findings.length };
        return;
      }
      // Nothing to look at and nothing to judge: the checks are clean and the model cannot see.
      if (snap.findings.length === 0 && !withViews && !this.briefState) {
        yield { type: 'review', round, phase: 'approved', text: `${lastEdited ? 'The automatic checks pass after the fixes' : 'The automatic checks pass'}; no renders were shown to the assistant, so nobody has judged how it looks.`, score: snap.score, findings: 0 };
        return;
      }
      if (snap.findings.length > 0) yield { type: 'review', round, phase: 'found', text: `Found ${snap.findings.length}: ${snap.findings.slice(0, 3).map((f) => f.message).join('; ').slice(0, 280)}`, score: snap.score, findings: snap.findings.length };
      // Renders with numbered marks (the host draws them); a failed capture only costs the images.
      let images: Array<{ name: string; label: string; dataUrl: string }> = [];
      // Every render of this round is black edge to edge: the capture failed, or a camera sits inside a solid. Such a round proves nothing.
      let blind = false;
      if (withViews && snap.views.length > 0 && host.captureReview) {
        for (let attempt = 0; attempt < 2; attempt++) {
          images = [];
          try {
            const got = await raceAbort(host.captureReview(snap.views, signal ? { signal } : {}), signal);
            for (const g of got) {
              const v = snap.views.find((x) => x.name === g.name);
              if (v && isImageDataUrl(g.dataUrl) && images.length < Math.min(MAX_REVIEW_VIEWS, CONTEXT_LIMITS.MAX_IMAGES)) images.push({ name: g.name, label: v.label, dataUrl: g.dataUrl });
            }
          } catch (e) {
            if (signal?.aborted) throw e;
          }
          blind = false;
          if (images.length > 0 && host.decodeImage) {
            const stats = await Promise.all(images.map((im) => raceAbort(host.decodeImage!(im.dataUrl, 64), signal).then((px) => (px ? pictureStats(px.data) : null)).catch(() => null)));
            blind = stats.every((st) => st !== null && isBlankFrame(st));
          }
          if (!blind) break;
        }
      }
      // Hardcore: measure each render, then show it beside its reference as one picture (the image cap is four per request).
      const hc = this.hardcore;
      const lumaRows: Array<{ name: string; luma: LumaTargets }> = [];
      if (hc && images.length > 0) {
        if (hc.targets && host.decodeImage) {
          for (const im of images) {
            const px = await raceAbort(host.decodeImage(im.dataUrl, 160), signal).catch(() => null);
            const luma = px ? lumaPercentiles(px.data) : null;
            if (luma) lumaRows.push({ name: im.name, luma });
          }
        }
        if (host.composeImages) {
          for (let i = 0; i < images.length; i++) {
            const ref = this.reviewAsk.images[i];
            const im = images[i];
            if (!ref || !im) continue;
            const pair = await raceAbort(host.composeImages([{ dataUrl: ref }, { dataUrl: im.dataUrl }], { maxSide: 1600 }), signal).catch(() => null);
            if (pair) images[i] = { ...im, label: `REFERENCE (left) beside the RENDER (right): ${im.label}`, dataUrl: pair };
          }
        }
      }
      const content: ContentBlock[] = [];
      images.forEach((im, i) => {
        content.push({ type: 'text', text: `Image ${i + 1}: ${im.name}, ${im.label}` }, { type: 'image', dataUrl: im.dataUrl });
      });
      content.push({ type: 'text', text: (richOnly ? (r: number, _s: ReviewSnapshot, o: { hasImages: boolean; lastEdited: boolean }) => richnessOnlyTurnText(r, o) : isLevel ? levelTurnText : reviewTurnText)(round, snap, { hasImages: images.length > 0, lastEdited }) });
      if (diffs) {
        // The request, point by point, against the renders (and the user's reference pictures beside them).
        const refs = this.reviewAsk.images.slice(0, 2);
        let shown = 0;
        for (const [i, ref] of (hc ? [] : refs).entries()) {
          const against = images[Math.min(i, images.length - 1)];
          const pair = against && host.composeImages ? await raceAbort(host.composeImages([{ dataUrl: ref }, { dataUrl: against.dataUrl }], { maxSide: 1400 }), signal).catch(() => null) : null;
          if (pair) content.push({ type: 'text', text: `Image ${images.length + shown + 1}: REFERENCE ${i + 1} from the user (left) beside the RENDER ${against?.name ?? ''} (right)` }, { type: 'image', dataUrl: pair });
          else content.push({ type: 'text', text: `Image ${images.length + shown + 1}: REFERENCE ${i + 1} from the user` }, { type: 'image', dataUrl: ref });
          shown++;
        }
        const list = diffs.roundText();
        if (list) content.push({ type: 'text', text: list });
        content.push({ type: 'text', text: requirementText(this.reviewAsk.request, refs.length > 0, round, list.length > 0) });
      }
      // A world built from a brief is compared with it: the model lists what is missing or sparse and fixes it. The counts are
      // evidence for its judgement; nothing here passes or fails on a number.
      if (images.length > 0 && host.decodeImage) {
        const rows: Array<{ name: string; stats: PictureStats }> = [];
        for (const im of images) {
          const px = await raceAbort(host.decodeImage(im.dataUrl, 128), signal).catch(() => null);
          const stats = px ? pictureStats(px.data) : null;
          if (stats) rows.push({ name: im.name, stats });
        }
        const intent = host.getWorld().environment.look?.intent;
        const text = lightEvidenceText(rows, intent ? `${intent.key ?? 'moderate'}${intent.text ? ` (${intent.text})` : ''}` : null, intent?.key);
        if (text) content.push({ type: 'text', text });
      }
      if (blind) content.push({ type: 'text', text: 'EVERY render this round is completely black, also after a second capture. That is not a dark scene: the capture failed, or the camera sits inside an opaque solid, or a generator fails to draw. You cannot judge the look from these. Find the cause (inspect the world, test a different view, check the generators and what encloses the camera) and fix it, then look again. Do not approve this round.' });
      if (hc?.targets && lumaRows.length > 0) content.push({ type: 'text', text: targetEvidenceText(lumaRows, hc.targets) });
      if (hc) content.push({ type: 'text', text: hc.bible });
      if (this.briefState) content.push({ type: 'text', text: richnessReviewText(this.briefState.brief, host.getWorld(), round, this.briefState.notes) });
      if (stallAsk) content.push({ type: 'text', text: stallAsk });
      if (shortAsk) content.push({ type: 'text', text: `The checker keeps repeating itself, but your brief's counts are still well short: ${shortAsk.slice(0, 900)}. Build the rest in one call each (shape_land tier, grid, perimeter, wall or along, as the brief says), or say plainly why each stays short, then finish.` });
      if (images.length > 0) yield { type: 'step', tool: 'look', label: round === 1 ? 'Looking at the renders' : 'Looking at the renders again', ok: true, looked: images.map((im) => ({ label: im.label, dataUrl: im.dataUrl })) };
      pushUserBlocks(messages, content);
      // One round: the model works with the tools until it calls finish (or answers without a tool call).
      let editedThisRound = false;
      let declared = false;
      let listed = diffs === null;
      let toolCalls = 0;
      yield { type: 'review', round, phase: 'fixing', text: snap.findings.length > 0 ? 'Fixing what the checks found…' : 'Looking at the renders…', score: snap.score, findings: snap.findings.length };
      for (let turn = 0; turn < REVIEW_TURNS_PER_ROUND && !declared; turn++) {
        if (signal?.aborted) throw new Error('aborted');
        compactConversation(messages);
        const queued = await drainSteer(steer);
        if (queued.length > 0) {
          for (const t of queued) yield { type: 'steer', text: t };
          pushUserText(messages, steerText(queued));
          editedThisRound = true;
        }
        const res: CompletionResponse = await raceAbort(
          this.opts.provider.complete({ role: 'planner', system: this.system, messages: requestView(messages, ...(imageCap ? [imageCap] : [])), tools: roundTools, maxTokens: this.maxTokens, ...(session ? { session } : {}) }, signal),
          signal,
        );
        addUsage(ctx.usage, res);
        messages.push({ role: 'assistant', content: res.content });
        const calls = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
        const text = textOf(res.content);
        if (res.stopReason === 'error' && calls.length === 0) {
          yield { type: 'error', text: text || 'The model could not complete the review.' };
          return;
        }
        if (calls.length === 0) {
          if (res.stopReason === 'max_tokens') {
            pushUserText(messages, 'Your reply was cut off. Continue with smaller tool calls, then call finish.');
            continue;
          }
          if (text) yield { type: 'message', text };
          declared = true;
          break;
        }
        if (text) yield { type: 'plan', text };
        const results: ContentBlock[] = [];
        const roundLooks: ContentBlock[] = [];
        for (const call of diffs ? [...calls].sort((a, b) => Number(b.name === DIFFERENCES_TOOL_NAME) - Number(a.name === DIFFERENCES_TOOL_NAME)) : calls) {
          if (signal?.aborted) throw new Error('aborted');
          if (toolCalls >= this.maxToolCalls && call.name !== DIFFERENCES_TOOL_NAME) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: 'Tool-call budget of this review round used up. Call finish.', isError: true });
            continue;
          }
          if (diffs && call.name === DIFFERENCES_TOOL_NAME) {
            if (listed) {
              results.push({ type: 'tool_result', toolUseId: call.id, content: 'Already recorded this round. Fix the largest open difference, or call finish.' });
              continue;
            }
            const rec = diffs.record(call.input);
            yield { type: 'step', tool: DIFFERENCES_TOOL_NAME, label: stepLabel(DIFFERENCES_TOOL_NAME, call.input, true), ok: true };
            if (!rec.ok) {
              results.push({ type: 'tool_result', toolUseId: call.id, content: rec.error, isError: true });
              continue;
            }
            listed = true;
            results.push({ type: 'tool_result', toolUseId: call.id, content: rec.text });
            yield { type: 'review', round, phase: 'found', text: rec.open === 0 ? 'No gaps from the request.' : `${rec.open} gap${rec.open === 1 ? '' : 's'} from the request; largest: ${rec.ranked[0]?.id} (${rec.ranked[0]?.what.slice(0, 100)}).`, differences: differenceViews(rec.ranked) };
            continue;
          }
          if (diffs && !listed && !READ_ONLY_TOOLS.has(call.name)) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: 'List the differences first: call report_differences (in the same reply is fine), ranked by size, then fix the largest.', isError: true });
            continue;
          }
          toolCalls++;
          if (call.name === REFERENCE_TOOL_NAME && this.briefState?.reference) {
            const look = await lookReference(this.briefState.reference, host, call.input);
            results.push({ type: 'tool_result', toolUseId: call.id, content: look.text, ...(look.isError ? { isError: true } : {}) });
            roundLooks.push(...look.blocks);
            yield { type: 'step', tool: call.name, label: stepLabel(call.name, call.input, !look.isError), ok: !look.isError };
            continue;
          }
          const out = await guardedTool(ledger, ctx, call.name, call.input);
          if (call.name !== 'finish') yield { type: 'step', tool: call.name, label: stepLabel(call.name, call.input, !out.isError), ok: !out.isError };
          for (const ev of out.events) yield ev;
          if (out.edited) {
            editedThisRound = true;
            diffs?.markEdited();
          }
          if (out.finished) {
            declared = true;
            if (out.finished.message) yield { type: 'message', text: out.finished.message };
          }
          results.push({ type: 'tool_result', toolUseId: call.id, content: out.content, ...(out.isError ? { isError: true } : {}) });
        }
        messages.push({ role: 'user', content: [...results, ...roundLooks] });
        this.seen = host.getWorld();
      }
      lastEdited = editedThisRound;
      before = world;
      if (!editedThisRound && declared) {
        const after: ReviewSnapshot = withFalls(withSunk(richOnly ? richnessSnapshot(host.getWorld(), { maxViews: 1, withViews: false }) : isLevel && this.opts.levelTools ? ((await raceAbort(levelSnapshot(this.opts.levelTools, host.getWorld(), { maxViews: 1, withViews: false }), signal)) ?? snap) : snapshotForReview(host.getWorld(), null, { maxViews: 1, withViews: false }), host.getWorld()), host.getWorld());
        const errors = after.findings.filter((f) => f.severity === 'error');
        // Warnings are real until the model has seen them once more and still leaves them: ask again, once per set.
        const open = after.findings.filter((f) => f.severity === 'warning');
        const signature = open.map(findingKey).sort().join('|');
        if (errors.length === 0 && open.length > 0 && !pushedBack.has(signature)) {
          pushedBack.add(signature);
          continue;
        }
        // Approved while large gaps from the request are still open: ask once, naming them.
        const big = diffs ? diffs.ranked().filter((d) => d.size >= 4) : [];
        const bigKey = `diff:${big.map((d) => d.id).sort().join('|')}`;
        if (errors.length === 0 && big.length > 0 && !pushedBack.has(bigKey)) {
          pushedBack.add(bigKey);
          pushUserText(messages, `You approved, but these large gaps from the request are still open: ${big.slice(0, 5).map((d) => `${d.id} (${d.what.slice(0, 80)})`).join('; ')}. Fix them, or say plainly why they cannot be fixed with the tools.`);
          continue;
        }
        // Approved while the brief's repeated elements are still well short: ask once per set of shortfalls to build them
        // with the one-call layouts, or to say plainly why not. Progress changes the set, so there is no fixed number of asks.
        const short = this.briefState ? richnessShortfalls(host.getWorld(), this.briefState.brief) : null;
        if (errors.length === 0 && short && !pushedBack.has(short.key)) {
          pushedBack.add(short.key);
          tracker.forgive();
          pushUserText(messages, `You approved, but your brief's counts are still well short: ${short.text.slice(0, 900)}. Build the rest now in one call each (shape_land tier, grid, perimeter, wall or along, as the brief says), then look again. Call finish only when the checklist is met, or say plainly for each short element why it stays short.`);
          continue;
        }
        if (errors.length === 0 && blind) {
          pushUserText(messages, 'You approved, but every render of this round was black, so nothing was judged. Find why the renders are black and fix it, then look again.');
          continue;
        }
        if (errors.length === 0) {
          yield { type: 'review', round, phase: 'approved', text: after.findings.length > 0 ? `Looks right to me; ${after.findings.length} note${after.findings.length === 1 ? '' : 's'} left as they are.` : 'Looks right.', score: after.score, findings: after.findings.length };
          return;
        }
        // The model approved while the checker still reports errors: show them again (a repeat stalls).
        continue;
      }
      if (!editedThisRound && !declared) {
        yield { type: 'review', round, phase: 'stalled', text: 'The model made no changes and did not approve; stopped reviewing.', score: snap.score, findings: snap.findings.length };
        return;
      }
    }
    if (!unlimited) yield { type: 'review', round: rounds, phase: 'limit', text: `Stopped after ${rounds} review rounds.` };
    else yield { type: 'review', round: rounds, phase: 'limit', text: 'Stopped reviewing after the safety ceiling of rounds.' };
  }
}

/**
 * True when a fine-edit failure ("I can't find "the shrine" ...") names a kind of thing nothing in the world is
 * called, tagged or built as: offline, that is answered plainly instead of being handed to the planner.
 */
function nothingNamed(world: WorldDoc, detail: string, refine: { parseRef(text: string): { noun: string }; singular(word: string): string }): boolean {
  const m = /^I can't find "([^"]+)"/.exec(detail);
  if (!m?.[1]) return false;
  // Every content word is tried ("the tower I just moved" still names a tower).
  const words = new Set([refine.parseRef(m[1]).noun, ...m[1].split(/\s+/)].flatMap((w) => w.split(/\s+/)).map((w) => refine.singular(w.toLowerCase()).replace(/[^a-z0-9]/g, '')).filter((w) => w.length >= 3 && !STOP_WORDS.has(w)));
  if (words.size === 0) return false;
  for (const w of words) {
    const re = new RegExp(`\\b${w}`, 'i');
    for (const id in world.entities) {
      const e = world.entities[id] as Entity;
      const gen = e.shape.kind === 'procedural' ? e.shape.generator : e.shape.kind === 'asset' ? e.shape.id : '';
      if (re.test(id) || re.test(e.name) || e.tags.some((t) => re.test(t)) || re.test(gen) || (e.npc !== undefined && re.test(e.npc.role))) return false;
    }
  }
  return true;
}

const STOP_WORDS = new Set(['the', 'that', 'this', 'those', 'these', 'just', 'one', 'big', 'small', 'left', 'right', 'top', 'side', 'all', 'every', 'new', 'old', 'moved', 'added', 'made', 'last', 'first', 'second', 'other', 'into', 'onto', 'over', 'under', 'with', 'near', 'next']);
