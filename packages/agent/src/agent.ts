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
import { Patch as PatchSchema, worldTransform, type Entity, type EntityId, type Patch, type WorldDoc } from '@aether/core';
import { CONTEXT_LIMITS, formatUserTurn, isImageDataUrl, sanitizeHistory } from './context';
import { executeTool, raceAbort, runVerification, type ExecutorContext } from './executor';
import { loadCatalog } from '@aether/assets';
import { libraryDefinitions } from './library-refs';
import type { RequestScope } from './refine/guard';
import { EMPTY_MEMORY, sanitizeMemory, sanitizeSelection, type RefineMemory } from './refine/memory';
import type { FineEditResult } from './refine/plan';
import { buildCoderPrompt, buildCompactSystemPrompt, buildSystemPrompt } from './prompt';
import { errorMessage, isAbortError } from './providers/errors';
import { AGENT_TOOLS, COMPACT_TOOLS, LEVEL_TOOLS } from './tools';
import { findingKey } from '@aether/arch';
import { MAX_REVIEW_VIEWS, reviewTurnText, snapshotForReview, StallTracker, type ReviewSnapshot } from './review';
import { guardVerificationClaim } from './honesty';
import { LEVEL_SUBJECT, levelSnapshot, levelTurnText } from './level-review';
import type { AgentEvent, AgentHost, AgentOptions, ChatMessage, CompletionResponse, ContentBlock, ReviewOptions, ToolDef, UsageTotals } from './types';

const DEFAULTS = Object.freeze({ maxRepairs: 2, maxTurns: 8, maxToolCalls: 48, maxTokens: 16_000 });
/** Limits of the compact prompt profile (small on-device models, ~4k-token context). */
export const COMPACT_LIMITS = Object.freeze({ maxTokens: 1_200, summaryEntities: 15, historyMessages: 2, historyChars: 400 });

/** Options of a single {@link WorldAgent.run}. */
export interface RunOptions {
  signal?: AbortSignal;
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

/** Keep the conversation small: the images of earlier review rounds are replaced by a note. */
/**
 * Keep at most `max` images in a conversation (every backend accepts {@link CONTEXT_LIMITS.MAX_IMAGES} per request):
 * the oldest images give way to a short note, the newest (this round's renders) stay. Mutates `messages`.
 */
export function capImages(messages: ChatMessage[], max: number = CONTEXT_LIMITS.MAX_IMAGES): void {
  let total = 0;
  for (const m of messages) if (typeof m.content !== 'string') for (const b of m.content) if (b.type === 'image') total++;
  for (const m of messages) {
    if (total <= max) return;
    if (typeof m.content === 'string') continue;
    const kept: ContentBlock[] = [];
    let dropped = 0;
    for (const b of m.content) {
      if (b.type === 'image' && total > max) {
        total--;
        dropped++;
        continue;
      }
      kept.push(b);
    }
    if (dropped > 0) m.content = [...kept, { type: 'text', text: `(${dropped} earlier image${dropped === 1 ? ' was' : 's were'} removed to stay within the image limit.)` }];
  }
}

function dropOldReviewImages(messages: ChatMessage[]): void {
  for (const m of messages) {
    if (m.role !== 'user' || typeof m.content === 'string') continue;
    if (!m.content.some((b) => b.type === 'image')) continue;
    const text = m.content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text' && !b.text.startsWith('Image ')).map((b) => b.text);
    if (text.length > 0 && text.some((t) => t.startsWith('REVIEW round'))) m.content = [{ type: 'text', text: `${text.join('\n')}\n(The images of this round were removed to save space.)` }];
  }
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

  constructor(opts: AgentOptions) {
    this.opts = opts;
    this.maxRepairs = clampInt(opts.maxRepairs, DEFAULTS.maxRepairs, 0, 10);
    this.maxTurns = clampInt(opts.maxTurns, DEFAULTS.maxTurns, 1, 50);
    this.maxToolCalls = clampInt(opts.maxToolCalls, DEFAULTS.maxToolCalls, 1, 500);
    this.compact = opts.promptProfile === 'compact';
    this.fineEdit = opts.fineEdit !== false;
    this.localEdits = opts.localEdits ?? this.fineEdit;
    this.maxTokens = Math.min(clampInt(opts.maxTokens, DEFAULTS.maxTokens, 256, 64_000), this.compact ? COMPACT_LIMITS.maxTokens : Infinity);
    this.tools = this.compact ? COMPACT_TOOLS : opts.levelTools ? [...AGENT_TOOLS, ...LEVEL_TOOLS] : AGENT_TOOLS;
    const ids = new Set<string>();
    for (const g of opts.catalogs.generators) {
      if (typeof g === 'object' && g !== null && 'id' in g && typeof (g as { id: unknown }).id === 'string') ids.add((g as { id: string }).id);
    }
    this.builtinGenerators = ids;
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
    try {
      yield* this.loop(prompt, host, opts, usage);
    } catch (e) {
      const aborted = opts.signal?.aborted === true || isAbortError(e);
      yield { type: 'error', text: aborted ? 'Cancelled.' : `Agent failed: ${errorMessage(e).slice(0, 500)}` };
    }
    yield { type: 'done', usage: { ...usage, ...(usage.models ? { models: [...usage.models] } : {}) } };
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
      // Untrusted: only transform updates of the moved objects are taken.
      const patches: Patch[] = [];
      let y: number | undefined;
      for (const raw of out.patches) {
        const p = PatchSchema.safeParse(raw);
        if (!p.success || p.data.op !== 'update') continue;
        const id = p.data.id;
        if (!items.some((it) => it.id === id)) continue;
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
      ...(this.opts.levelTools ? { levelTools: this.opts.levelTools } : {}),
      ...(signal ? { signal } : {}),
    };

    // Library furniture and models are resolved by name: the catalog must be in before anything is planned.
    await loadCatalog().catch(() => undefined);
    // A picture of a room with a prompt about it: rebuild THAT room from the photo (never a preset room).
    const photoMode = opts.photo ?? 'auto';
    // The room-from-photo pipeline is large and rarely used: loaded on demand so it stays out of the first-load bundle.
    const photoPipeline = photoMode !== 'off' && (this.opts.photo !== undefined || photoMode === 'recreate') && images[0] !== undefined ? await import('./photo/pipeline') : undefined;
    if (photoPipeline && photoPipeline.isRoomPhotoRequest(request, images.length, photoMode === 'recreate') && images[0] !== undefined) {
      const { reconstructRoom } = photoPipeline;
      const sessionKey = opts.session && SESSION_RE.test(opts.session) ? opts.session : undefined;
      const options = this.compact ? { ...(this.opts.photo ?? {}), vision: false } : (this.opts.photo ?? {});
      yield* reconstructRoom({ ctx, system: this.system, tools: this.tools, maxTokens: this.maxTokens, maxToolCalls: this.maxToolCalls, ...(sessionKey ? { session: sessionKey } : {}), request, image: images[0], options, replace: opts.intent !== 'refine' });
      return;
    }
    const world0 = host.getWorld();
    const hasWorld = Object.keys(world0.entities).length > 0 || world0.voxel !== undefined;
    const intent = opts.intent ?? 'auto';
    let scope: RequestScope | undefined;
    if (this.fineEdit && hasWorld && intent !== 'new' && images.length === 0) {
      const memory = sanitizeMemory(opts.memory);
      const selection = sanitizeSelection(opts.selection);
      const heading = typeof opts.heading === 'number' && Number.isFinite(opts.heading) ? opts.heading % 360 : 0;
      // The edit engine (parser, lexicon, operations) is a separate chunk, loaded on the first prompt.
      const refine = await import('./refine/runtime');
      const fe = !this.localEdits ? NO_LOCAL_EDIT : refine.planFineEdit({ world: world0, text: request, selection, memory, heading, catalogs: { generators: [...this.opts.catalogs.generators, ...(this.opts.catalogs.libraryGenerators ?? [])] } });
      if (fe.kind === 'question' && fe.question) {
        yield { type: 'clarify', text: fe.question.text, candidates: fe.question.candidates };
        yield { type: 'memory', memory: fe.memory };
        return;
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
      if (scope.kind === 'small') {
        const small = scope;
        ctx.audit = (patches) => refine.auditPatches(host.getWorld(), patches, small);
      }
    }
    const slice = scope !== undefined && scope.kind === 'small' && scope.allowed.size > 0 && Object.keys(world0.entities).length > SLICE_THRESHOLD;
    const userEdits = host.userEdits?.();
    const summary = summarizeWorldForModel(world0, {
      compact: this.compact,
      maxEntities: this.compact ? COMPACT_LIMITS.summaryEntities : slice ? SLICE_THRESHOLD : CONTEXT_LIMITS.SUMMARY_ENTITIES,
      ...(slice && scope ? { focus: [...scope.allowed].filter((id) => Object.hasOwn(world0.entities, id)).slice(0, 60) } : {}),
      ...(userEdits && userEdits.size > 0 ? { userEdits } : {}),
    });
    const inScope = slice && scope ? scopeBlock(world0, scope) : '';
    const mode = !hasWorld || !this.fineEdit ? undefined : intent === 'new' ? 'new world: replace the current world with the one described' : 'refine: change the current world as asked and keep everything the user did not mention exactly as it is; start a new world only if the user clearly asks for one';
    const first: ContentBlock[] = [...images.map((dataUrl): ContentBlock => ({ type: 'image', dataUrl })), { type: 'text', text: formatUserTurn(inScope ? `${summary}\n${inScope}` : summary, request, mode) }];
    const prior = sanitizeHistory(opts.history);
    const kept = this.compact ? prior.slice(prior.length > COMPACT_LIMITS.historyMessages ? prior.length - COMPACT_LIMITS.historyMessages : 0) : prior;
    // History must start with a user turn.
    const trimmed = this.compact ? kept.map((m): ChatMessage => ({ role: m.role, content: (m.content as string).slice(0, COMPACT_LIMITS.historyChars) })) : kept;
    const history = trimmed.length > 0 && trimmed[0]?.role !== 'user' ? trimmed.slice(1) : trimmed;
    const messages: ChatMessage[] = [...history, { role: 'user', content: first }];

    const startWorld = host.getWorld();
    const session = opts.session && SESSION_RE.test(opts.session) ? opts.session : undefined;
    let repairs = 0;
    let nudges = 0;
    let lastRefused = false;
    let toolCalls = 0;
    let dirty = false; // edits since the last verification
    let lastVerifyPassed: boolean | undefined;
    // A small edit that names objects (move the lamp, make the door red) is not reviewed like a whole building: only a run that
    // re-plans or rebuilds the shell is. This keeps one-property chat edits fast on a big house.
    let structural = false;
    const reviewable = () => scope === undefined || scope.kind !== 'small' || scope.allowed.size === 0 || structural;

    yield { type: 'status', text: 'Planning…' };
    for (let turn = 0; turn < this.maxTurns; turn++) {
      if (signal?.aborted) throw new Error('aborted');
      capImages(messages);
      const res: CompletionResponse = await raceAbort(
        this.opts.provider.complete({ role: 'planner', system: this.system, messages, tools: this.tools, maxTokens: this.maxTokens, ...(session ? { session } : {}) }, signal),
        signal,
      );
      usage.calls += 1;
      usage.inputTokens += res.usage?.inputTokens ?? 0;
      usage.outputTokens += res.usage?.outputTokens ?? 0;
      noteModel(usage, res.model);
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
        let batchRefused = false;
        for (const call of calls) {
          if (signal?.aborted) throw new Error('aborted');
          if (toolCalls >= this.maxToolCalls) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: 'Tool-call budget exhausted for this request. Call finish now.', isError: true });
            continue;
          }
          toolCalls++;
          const out = await executeTool(ctx, call.name, call.input);
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
        messages.push({ role: 'user', content: results });
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
      const turnEnded = finished !== undefined || calls.length === 0;
      if (!turnEnded) continue;

      if (!dirty) {
        if (lastVerifyPassed === false) yield { type: 'status', text: 'Finished with verification issues remaining.' };
        else if (reviewable()) yield* this.review(ctx, messages, host, startWorld, session, signal);
        return;
      }
      yield { type: 'status', text: 'Verifying physics and tests…' };
      const v = await runVerification(ctx);
      yield v.event;
      dirty = false;
      lastVerifyPassed = v.passed;
      if (v.passed) {
        if (reviewable()) yield* this.review(ctx, messages, host, startWorld, session, signal);
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
  private async *review(ctx: ExecutorContext, messages: ChatMessage[], host: AgentHost, startWorld: WorldDoc, session: string | undefined, signal: AbortSignal | undefined): AsyncGenerator<AgentEvent> {
    const entered = host.getWorld();
    yield* this.reviewLoop(ctx, messages, host, startWorld, session, signal);
    // The review fixed things after the physics run: the world that is sealed and shown as verified must be the one
    // that was checked, so verify again when the review changed anything.
    if (host.getWorld() !== entered) {
      yield { type: 'status', text: 'Verifying physics and tests after the review…' };
      const v = await runVerification(ctx);
      yield v.event;
    }
  }

  private async *reviewLoop(ctx: ExecutorContext, messages: ChatMessage[], host: AgentHost, startWorld: WorldDoc, session: string | undefined, signal: AbortSignal | undefined): AsyncGenerator<AgentEvent> {
    const cfg: ReviewOptions | undefined = this.opts.review;
    if (!cfg) return;
    const world0 = host.getWorld();
    if (world0 === startWorld) return;
    const rounds = cfg.maxRounds === undefined || !Number.isFinite(cfg.maxRounds) ? REVIEW_ROUND_CEILING : Math.max(1, Math.min(REVIEW_ROUND_CEILING, Math.floor(cfg.maxRounds)));
    const unlimited = cfg.maxRounds === undefined || !Number.isFinite(cfg.maxRounds);
    const maxViews = Math.max(1, Math.min(MAX_REVIEW_VIEWS, Math.floor(cfg.maxViews ?? 6)));
    const tracker = new StallTracker(cfg.stallRounds ?? 3);
    let lastEdited = false;
    const pushedBack = new Set<string>();
    let before: WorldDoc | null = startWorld;
    for (let round = 1; round <= rounds; round++) {
      if (signal?.aborted) throw new Error('aborted');
      const world = host.getWorld();
      // The offline planner is only a labelled fallback: it does not review.
      if (this.opts.provider.name === 'mock') return;
      const withViews = (typeof cfg.vision === 'function' ? cfg.vision() : cfg.vision === true) && typeof host.captureReview === 'function';
      let snap: ReviewSnapshot = snapshotForReview(world, before, { maxViews, withViews });
      // No building: a game or outdoor level is reviewed with the level tools, when the host has them.
      if (snap.buildings.length === 0) {
        const lvl = this.opts.levelTools ? await raceAbort(levelSnapshot(this.opts.levelTools, world, { maxViews, withViews }), signal) : null;
        if (!lvl) return;
        snap = lvl;
      }
      const isLevel = snap.buildings[0] === LEVEL_SUBJECT;
      yield { type: 'review', round, phase: 'checking', text: round === 1 ? (isLevel ? 'Checking the level…' : 'Checking the building…') : 'Checking again…', score: snap.score, findings: snap.findings.length };
      const verdict = tracker.observe({ keys: snap.keys, score: snap.score, edited: lastEdited });
      if (verdict.stalled) {
        yield { type: 'review', round, phase: 'stalled', text: `Stopped reviewing: ${verdict.reason}. ${snap.findings.length > 0 ? `${snap.findings.length} finding${snap.findings.length === 1 ? '' : 's'} remain.` : ''}`.trim(), score: snap.score, findings: snap.findings.length };
        return;
      }
      // Nothing to look at and nothing to judge: the checks are clean and the model cannot see.
      if (snap.findings.length === 0 && !withViews) {
        yield { type: 'review', round, phase: 'approved', text: lastEdited ? 'All checks pass after the fixes.' : 'All checks pass.', score: snap.score, findings: 0 };
        return;
      }
      if (snap.findings.length > 0) yield { type: 'review', round, phase: 'found', text: `Found ${snap.findings.length}: ${snap.findings.slice(0, 3).map((f) => f.message).join('; ').slice(0, 280)}`, score: snap.score, findings: snap.findings.length };
      // Renders with numbered marks (the host draws them); a failed capture only costs the images.
      const images: Array<{ name: string; label: string; dataUrl: string }> = [];
      if (withViews && snap.views.length > 0 && host.captureReview) {
        try {
          const got = await raceAbort(host.captureReview(snap.views, signal ? { signal } : {}), signal);
          for (const g of got) {
            const v = snap.views.find((x) => x.name === g.name);
            if (v && isImageDataUrl(g.dataUrl) && images.length < Math.min(MAX_REVIEW_VIEWS, CONTEXT_LIMITS.MAX_IMAGES)) images.push({ name: g.name, label: v.label, dataUrl: g.dataUrl });
          }
        } catch (e) {
          if (signal?.aborted) throw e;
        }
      }
      dropOldReviewImages(messages);
      const content: ContentBlock[] = [];
      images.forEach((im, i) => {
        content.push({ type: 'text', text: `Image ${i + 1}: ${im.name}, ${im.label}` }, { type: 'image', dataUrl: im.dataUrl });
      });
      content.push({ type: 'text', text: (isLevel ? levelTurnText : reviewTurnText)(round, snap, { hasImages: images.length > 0, lastEdited }) });
      pushUserBlocks(messages, content);
      // One round: the model works with the tools until it calls finish (or answers without a tool call).
      let editedThisRound = false;
      let declared = false;
      let toolCalls = 0;
      yield { type: 'review', round, phase: 'fixing', text: snap.findings.length > 0 ? 'Fixing what the checks found…' : 'Looking at the renders…', score: snap.score, findings: snap.findings.length };
      for (let turn = 0; turn < REVIEW_TURNS_PER_ROUND && !declared; turn++) {
        if (signal?.aborted) throw new Error('aborted');
        capImages(messages);
        const res: CompletionResponse = await raceAbort(
          this.opts.provider.complete({ role: 'planner', system: this.system, messages, tools: this.tools, maxTokens: this.maxTokens, ...(session ? { session } : {}) }, signal),
          signal,
        );
        ctx.usage.calls += 1;
        ctx.usage.inputTokens += res.usage?.inputTokens ?? 0;
        ctx.usage.outputTokens += res.usage?.outputTokens ?? 0;
        noteModel(ctx.usage, res.model);
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
        for (const call of calls) {
          if (signal?.aborted) throw new Error('aborted');
          if (toolCalls >= this.maxToolCalls) {
            results.push({ type: 'tool_result', toolUseId: call.id, content: 'Tool-call budget of this review round used up. Call finish.', isError: true });
            continue;
          }
          toolCalls++;
          const out = await executeTool(ctx, call.name, call.input);
          for (const ev of out.events) yield ev;
          if (out.edited) editedThisRound = true;
          if (out.finished) {
            declared = true;
            if (out.finished.message) yield { type: 'message', text: out.finished.message };
          }
          results.push({ type: 'tool_result', toolUseId: call.id, content: out.content, ...(out.isError ? { isError: true } : {}) });
        }
        messages.push({ role: 'user', content: results });
      }
      lastEdited = editedThisRound;
      before = world;
      if (!editedThisRound && declared) {
        const after: ReviewSnapshot = isLevel && this.opts.levelTools ? ((await raceAbort(levelSnapshot(this.opts.levelTools, host.getWorld(), { maxViews: 1, withViews: false }), signal)) ?? snap) : snapshotForReview(host.getWorld(), null, { maxViews: 1, withViews: false });
        const errors = after.findings.filter((f) => f.severity === 'error');
        // Warnings are real until the model has seen them once more and still leaves them: ask again, once per set.
        const open = after.findings.filter((f) => f.severity === 'warning');
        const signature = open.map(findingKey).sort().join('|');
        if (errors.length === 0 && open.length > 0 && !pushedBack.has(signature)) {
          pushedBack.add(signature);
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
