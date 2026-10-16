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
import { CONTEXT_LIMITS, formatUserTurn, isImageDataUrl, sanitizeHistory } from './context';
import { executeTool, raceAbort, runVerification } from './executor';
import { loadCatalog } from '@aether/assets';
import { libraryDefinitions } from './library-refs';
import { EMPTY_MEMORY, sanitizeMemory, sanitizeSelection } from './refine/memory';
import { buildCoderPrompt, buildCompactSystemPrompt, buildSystemPrompt } from './prompt';
import { errorMessage, isAbortError } from './providers/errors';
import { AGENT_TOOLS, COMPACT_TOOLS, LEVEL_TOOLS } from './tools';
import { findingKey } from '@aether/arch';
import { MAX_REVIEW_VIEWS, reviewTurnText, snapshotForReview, StallTracker } from './review';
import { guardVerificationClaim } from './honesty';
import { LEVEL_SUBJECT, levelSnapshot, levelTurnText } from './level-review';
const DEFAULTS = Object.freeze({ maxRepairs: 2, maxTurns: 8, maxToolCalls: 48, maxTokens: 16_000 });
/** Limits of the compact prompt profile (small on-device models, ~4k-token context). */
export const COMPACT_LIMITS = Object.freeze({ maxTokens: 1_200, summaryEntities: 15, historyMessages: 2, historyChars: 400 });
/** Stand-in for a declined local plan when local edits are switched off. */
const NO_LOCAL_EDIT = Object.freeze({ kind: 'none', reason: 'not-understood', patches: [], summary: '', changes: [], diff: [], targets: [], scope: [], added: [], cosmetic: true, notes: [], memory: EMPTY_MEMORY, unparsed: [], ms: 0 });
/** Most entities detailed in a focused slice, and the size of each. */
const SCOPE_ENTITIES = 12;
const SCOPE_ENTITY_CHARS = 700;
/**
 * The entities a small edit may touch, in full (generated buildings fold their
 * furniture into the summary, so without this the model could not even see the
 * sofa it is asked to recolour).
 */
function scopeBlock(world, scope) {
    const lines = [];
    for (const id of [...scope.allowed].filter((x) => Object.hasOwn(world.entities, x)).slice(0, SCOPE_ENTITIES)) {
        const e = world.entities[id];
        if (!e)
            continue;
        const { arch, ...rest } = e;
        const slim = { ...rest, ...(arch ? { arch: { role: arch.role, kind: arch.kind, room: arch.room } } : {}) };
        lines.push(`${id} = ${JSON.stringify(slim).slice(0, SCOPE_ENTITY_CHARS)}`);
    }
    return lines.length > 0 ? `in scope (edit only these, with update patches):\n${lines.join('\n')}` : '';
}
/** Worlds with more entities than this send the model a focused slice for small edits. */
export const SLICE_THRESHOLD = 80;
/** Record a provider's reported model in the usage totals (at most 4, first use order). */
export function noteModel(usage, model) {
    if (!model)
        return;
    const list = (usage.models ??= []);
    const m = model.slice(0, 64);
    if (!list.includes(m) && list.length < 4)
        list.push(m);
}
/** Most model turns inside one review round (a round is one look and one batch of fixes). */
const REVIEW_TURNS_PER_ROUND = 8;
/** Hard ceiling of review rounds when no cap is set: stall detection ends the loop long before it. */
const REVIEW_ROUND_CEILING = 200;
const SESSION_RE = /^[a-z0-9][a-z0-9-]{7,79}$/;
function clampInt(v, fallback, min, max) {
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : fallback;
}
/** Keep the conversation small: the images of earlier review rounds are replaced by a note. */
function dropOldReviewImages(messages) {
    for (const m of messages) {
        if (m.role !== 'user' || typeof m.content === 'string')
            continue;
        if (!m.content.some((b) => b.type === 'image'))
            continue;
        const text = m.content.filter((b) => b.type === 'text' && !b.text.startsWith('Image ')).map((b) => b.text);
        if (text.length > 0 && text.some((t) => t.startsWith('REVIEW round')))
            m.content = [{ type: 'text', text: `${text.join('\n')}\n(The images of this round were removed to save space.)` }];
    }
}
/** A reply that says the tools are missing: models sometimes claim this before ever trying them. */
function claimsNoTools(text) {
    return /(unavailable|not available|isn'?t available|aren'?t available|can'?t|cannot|couldn'?t|could not|unable|don'?t have|do not have|no access).{0,100}(tool|build|edit|access|session|world)/i.test(text);
}
function textOf(blocks) {
    return blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}
/** Append blocks to the conversation as a user turn (merging into a trailing user turn of blocks). */
function pushUserBlocks(messages, blocks) {
    const last = messages[messages.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content))
        last.content.push(...blocks);
    else
        messages.push({ role: 'user', content: blocks });
}
/** Append text to the conversation as a user turn (merging into a trailing tool-result turn). */
function pushUserText(messages, text) {
    const last = messages[messages.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content))
        last.content.push({ type: 'text', text });
    else
        messages.push({ role: 'user', content: [{ type: 'text', text }] });
}
/** Provider-agnostic agent that edits a world through an {@link AgentHost}. */
export class WorldAgent {
    opts;
    maxRepairs;
    maxTurns;
    maxToolCalls;
    maxTokens;
    builtinGenerators;
    compact;
    fineEdit;
    localEdits;
    tools;
    systemPrompt;
    coderPrompt;
    constructor(opts) {
        this.opts = opts;
        this.maxRepairs = clampInt(opts.maxRepairs, DEFAULTS.maxRepairs, 0, 10);
        this.maxTurns = clampInt(opts.maxTurns, DEFAULTS.maxTurns, 1, 50);
        this.maxToolCalls = clampInt(opts.maxToolCalls, DEFAULTS.maxToolCalls, 1, 500);
        this.compact = opts.promptProfile === 'compact';
        this.fineEdit = opts.fineEdit !== false;
        this.localEdits = opts.localEdits ?? this.fineEdit;
        this.maxTokens = Math.min(clampInt(opts.maxTokens, DEFAULTS.maxTokens, 256, 64_000), this.compact ? COMPACT_LIMITS.maxTokens : Infinity);
        this.tools = this.compact ? COMPACT_TOOLS : opts.levelTools ? [...AGENT_TOOLS, ...LEVEL_TOOLS] : AGENT_TOOLS;
        const ids = new Set();
        for (const g of opts.catalogs.generators) {
            if (typeof g === 'object' && g !== null && 'id' in g && typeof g.id === 'string')
                ids.add(g.id);
        }
        this.builtinGenerators = ids;
    }
    /** The (cached) planner system prompt. */
    get system() {
        this.systemPrompt ??= this.compact ? buildCompactSystemPrompt(this.opts.catalogs) : buildSystemPrompt(this.opts.catalogs, { level: this.opts.levelTools !== undefined });
        return this.systemPrompt;
    }
    get coderSystem() {
        this.coderPrompt ??= buildCoderPrompt(this.opts.catalogs);
        return this.coderPrompt;
    }
    /** Run one request against `host`, streaming progress events. */
    async *run(prompt, host, opts = {}) {
        const usage = { inputTokens: 0, outputTokens: 0, calls: 0 };
        try {
            yield* this.loop(prompt, host, opts, usage);
        }
        catch (e) {
            const aborted = opts.signal?.aborted === true || isAbortError(e);
            yield { type: 'error', text: aborted ? 'Cancelled.' : `Agent failed: ${errorMessage(e).slice(0, 500)}` };
        }
        yield { type: 'done', usage: { ...usage, ...(usage.models ? { models: [...usage.models] } : {}) } };
    }
    /** Apply a locally planned small edit: no model call, a compact diff, physics only when it matters. */
    async *applyLocal(fe, ctx, host) {
        const defs = ctx.resolveGenerator ? await raceAbort(libraryDefinitions(fe.patches, host.getWorld(), ctx.builtinGenerators, ctx.resolveGenerator), ctx.signal) : [];
        // One edit is one undo step, library definitions included.
        const result = host.applyPatches([...defs, ...fe.patches], fe.summary.slice(0, 200) || 'Edit');
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
            if (!v.passed)
                yield { type: 'message', text: `Heads up: the checks flagged something after this change (${v.summary.split('\n')[0]?.slice(0, 160) ?? 'see the verification panel'}). Undo reverts it.` };
        }
    }
    async *loop(prompt, host, opts, usage) {
        const signal = opts.signal;
        const request = typeof prompt === 'string' ? prompt.trim() : '';
        if (request.length === 0)
            throw new Error('the prompt is empty');
        if (request.length > CONTEXT_LIMITS.MAX_PROMPT_CHARS)
            throw new Error(`the prompt is too long (max ${CONTEXT_LIMITS.MAX_PROMPT_CHARS} characters)`);
        const images = opts.images ?? [];
        if (images.length > CONTEXT_LIMITS.MAX_IMAGES)
            throw new Error(`at most ${CONTEXT_LIMITS.MAX_IMAGES} images are allowed`);
        if (!images.every(isImageDataUrl))
            throw new Error('images must be base64 PNG/JPEG/WebP/GIF data URLs under 5 MiB');
        const ctx = {
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
        let scope;
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
        const first = [...images.map((dataUrl) => ({ type: 'image', dataUrl })), { type: 'text', text: formatUserTurn(inScope ? `${summary}\n${inScope}` : summary, request, mode) }];
        const prior = sanitizeHistory(opts.history);
        const kept = this.compact ? prior.slice(prior.length > COMPACT_LIMITS.historyMessages ? prior.length - COMPACT_LIMITS.historyMessages : 0) : prior;
        // History must start with a user turn.
        const trimmed = this.compact ? kept.map((m) => ({ role: m.role, content: m.content.slice(0, COMPACT_LIMITS.historyChars) })) : kept;
        const history = trimmed.length > 0 && trimmed[0]?.role !== 'user' ? trimmed.slice(1) : trimmed;
        const messages = [...history, { role: 'user', content: first }];
        const startWorld = host.getWorld();
        const session = opts.session && SESSION_RE.test(opts.session) ? opts.session : undefined;
        let repairs = 0;
        let nudges = 0;
        let lastRefused = false;
        let toolCalls = 0;
        let dirty = false; // edits since the last verification
        let lastVerifyPassed;
        // A small edit that names objects (move the lamp, make the door red) is not reviewed like a whole building: only a run that
        // re-plans or rebuilds the shell is. This keeps one-property chat edits fast on a big house.
        let structural = false;
        const reviewable = () => scope === undefined || scope.kind !== 'small' || scope.allowed.size === 0 || structural;
        yield { type: 'status', text: 'Planning…' };
        for (let turn = 0; turn < this.maxTurns; turn++) {
            if (signal?.aborted)
                throw new Error('aborted');
            const res = await raceAbort(this.opts.provider.complete({ role: 'planner', system: this.system, messages, tools: this.tools, maxTokens: this.maxTokens, ...(session ? { session } : {}) }, signal), signal);
            usage.calls += 1;
            usage.inputTokens += res.usage?.inputTokens ?? 0;
            usage.outputTokens += res.usage?.outputTokens ?? 0;
            noteModel(usage, res.model);
            messages.push({ role: 'assistant', content: res.content });
            const calls = res.content.filter((b) => b.type === 'tool_use');
            const text = textOf(res.content);
            if (text)
                yield { type: calls.length > 0 ? 'plan' : 'message', text: calls.length > 0 ? text : guardVerificationClaim(text, { ran: lastVerifyPassed !== undefined, pending: dirty }) };
            if (res.stopReason === 'error' && calls.length === 0) {
                yield { type: 'error', text: text || 'The model could not complete this request.' };
                return;
            }
            let finished;
            if (calls.length > 0) {
                const results = [];
                let batchRefused = false;
                for (const call of calls) {
                    if (signal?.aborted)
                        throw new Error('aborted');
                    if (toolCalls >= this.maxToolCalls) {
                        results.push({ type: 'tool_result', toolUseId: call.id, content: 'Tool-call budget exhausted for this request. Call finish now.', isError: true });
                        continue;
                    }
                    toolCalls++;
                    const out = await executeTool(ctx, call.name, call.input);
                    for (const ev of out.events)
                        yield ev;
                    if (out.edited)
                        dirty = true;
                    if (out.edited && (call.name === 'design_plan' || call.name === 'build_architecture'))
                        structural = true;
                    lastRefused = out.isError && !out.edited;
                    if (out.isError && call.name !== 'finish')
                        batchRefused = true;
                    if (out.verified) {
                        dirty = false;
                        lastVerifyPassed = out.verified.passed;
                    }
                    if (out.finished)
                        finished = out.finished;
                    results.push({ type: 'tool_result', toolUseId: call.id, content: out.content, ...(out.isError ? { isError: true } : {}) });
                }
                if (finished && batchRefused && calls.length > 1) {
                    // finish came in the same reply as a call that was refused: it was sent before the result was read.
                    finished = undefined;
                    results.push({ type: 'text', text: 'A call in that reply was refused, so finish was ignored: read the reasons above, fix them and call the tools again, then finish.' });
                }
                messages.push({ role: 'user', content: results });
                if (finished?.message)
                    yield { type: 'message', text: guardVerificationClaim(finished.message, { ran: lastVerifyPassed !== undefined, pending: dirty }) };
            }
            else if (res.stopReason === 'max_tokens') {
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
            if (!turnEnded)
                continue;
            if (!dirty) {
                if (lastVerifyPassed === false)
                    yield { type: 'status', text: 'Finished with verification issues remaining.' };
                else if (reviewable())
                    yield* this.review(ctx, messages, host, startWorld, session, signal);
                return;
            }
            yield { type: 'status', text: 'Verifying physics and tests…' };
            const v = await runVerification(ctx);
            yield v.event;
            dirty = false;
            lastVerifyPassed = v.passed;
            if (v.passed) {
                if (reviewable())
                    yield* this.review(ctx, messages, host, startWorld, session, signal);
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
            pushUserText(messages, `Verification FAILED (repair ${repairs}/${this.maxRepairs}):\n${v.summary}\nFix these concrete problems with apply_patches (move, resize or re-body objects; fix rules; drop tests that cannot pass without player input), then call finish.`);
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
    async *review(ctx, messages, host, startWorld, session, signal) {
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
    async *reviewLoop(ctx, messages, host, startWorld, session, signal) {
        const cfg = this.opts.review;
        if (!cfg)
            return;
        const world0 = host.getWorld();
        if (world0 === startWorld)
            return;
        const rounds = cfg.maxRounds === undefined || !Number.isFinite(cfg.maxRounds) ? REVIEW_ROUND_CEILING : Math.max(1, Math.min(REVIEW_ROUND_CEILING, Math.floor(cfg.maxRounds)));
        const unlimited = cfg.maxRounds === undefined || !Number.isFinite(cfg.maxRounds);
        const maxViews = Math.max(1, Math.min(MAX_REVIEW_VIEWS, Math.floor(cfg.maxViews ?? 6)));
        const tracker = new StallTracker(cfg.stallRounds ?? 3);
        let lastEdited = false;
        const pushedBack = new Set();
        let before = startWorld;
        for (let round = 1; round <= rounds; round++) {
            if (signal?.aborted)
                throw new Error('aborted');
            const world = host.getWorld();
            // The offline planner is only a labelled fallback: it does not review.
            if (this.opts.provider.name === 'mock')
                return;
            const withViews = (typeof cfg.vision === 'function' ? cfg.vision() : cfg.vision === true) && typeof host.captureReview === 'function';
            let snap = snapshotForReview(world, before, { maxViews, withViews });
            // No building: a game or outdoor level is reviewed with the level tools, when the host has them.
            if (snap.buildings.length === 0) {
                const lvl = this.opts.levelTools ? await raceAbort(levelSnapshot(this.opts.levelTools, world, { maxViews, withViews }), signal) : null;
                if (!lvl)
                    return;
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
            if (snap.findings.length > 0)
                yield { type: 'review', round, phase: 'found', text: `Found ${snap.findings.length}: ${snap.findings.slice(0, 3).map((f) => f.message).join('; ').slice(0, 280)}`, score: snap.score, findings: snap.findings.length };
            // Renders with numbered marks (the host draws them); a failed capture only costs the images.
            const images = [];
            if (withViews && snap.views.length > 0 && host.captureReview) {
                try {
                    const got = await raceAbort(host.captureReview(snap.views, signal ? { signal } : {}), signal);
                    for (const g of got) {
                        const v = snap.views.find((x) => x.name === g.name);
                        if (v && isImageDataUrl(g.dataUrl) && images.length < MAX_REVIEW_VIEWS)
                            images.push({ name: g.name, label: v.label, dataUrl: g.dataUrl });
                    }
                }
                catch (e) {
                    if (signal?.aborted)
                        throw e;
                }
            }
            dropOldReviewImages(messages);
            const content = [];
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
                if (signal?.aborted)
                    throw new Error('aborted');
                const res = await raceAbort(this.opts.provider.complete({ role: 'planner', system: this.system, messages, tools: this.tools, maxTokens: this.maxTokens, ...(session ? { session } : {}) }, signal), signal);
                ctx.usage.calls += 1;
                ctx.usage.inputTokens += res.usage?.inputTokens ?? 0;
                ctx.usage.outputTokens += res.usage?.outputTokens ?? 0;
                noteModel(ctx.usage, res.model);
                messages.push({ role: 'assistant', content: res.content });
                const calls = res.content.filter((b) => b.type === 'tool_use');
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
                    if (text)
                        yield { type: 'message', text };
                    declared = true;
                    break;
                }
                if (text)
                    yield { type: 'plan', text };
                const results = [];
                for (const call of calls) {
                    if (signal?.aborted)
                        throw new Error('aborted');
                    if (toolCalls >= this.maxToolCalls) {
                        results.push({ type: 'tool_result', toolUseId: call.id, content: 'Tool-call budget of this review round used up. Call finish.', isError: true });
                        continue;
                    }
                    toolCalls++;
                    const out = await executeTool(ctx, call.name, call.input);
                    for (const ev of out.events)
                        yield ev;
                    if (out.edited)
                        editedThisRound = true;
                    if (out.finished) {
                        declared = true;
                        if (out.finished.message)
                            yield { type: 'message', text: out.finished.message };
                    }
                    results.push({ type: 'tool_result', toolUseId: call.id, content: out.content, ...(out.isError ? { isError: true } : {}) });
                }
                messages.push({ role: 'user', content: results });
            }
            lastEdited = editedThisRound;
            before = world;
            if (!editedThisRound && declared) {
                const after = isLevel && this.opts.levelTools ? ((await raceAbort(levelSnapshot(this.opts.levelTools, host.getWorld(), { maxViews: 1, withViews: false }), signal)) ?? snap) : snapshotForReview(host.getWorld(), null, { maxViews: 1, withViews: false });
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
        if (!unlimited)
            yield { type: 'review', round: rounds, phase: 'limit', text: `Stopped after ${rounds} review rounds.` };
        else
            yield { type: 'review', round: rounds, phase: 'limit', text: 'Stopped reviewing after the safety ceiling of rounds.' };
    }
}
