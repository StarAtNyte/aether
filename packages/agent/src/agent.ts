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
import { summarizeWorld } from '@aether/core';
import { CONTEXT_LIMITS, formatUserTurn, isImageDataUrl, sanitizeHistory } from './context';
import { executeTool, raceAbort, runVerification, type ExecutorContext } from './executor';
import { buildCoderPrompt, buildCompactSystemPrompt, buildSystemPrompt } from './prompt';
import { errorMessage, isAbortError } from './providers/errors';
import { AGENT_TOOLS, COMPACT_TOOLS } from './tools';
import type { AgentEvent, AgentHost, AgentOptions, ChatMessage, CompletionResponse, ContentBlock, ToolDef, UsageTotals } from './types';

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
}

function clampInt(v: number | undefined, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : fallback;
}

function textOf(blocks: readonly ContentBlock[]): string {
  return blocks.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim();
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
  private readonly tools: ToolDef[];
  private systemPrompt: string | undefined;
  private coderPrompt: string | undefined;

  constructor(opts: AgentOptions) {
    this.opts = opts;
    this.maxRepairs = clampInt(opts.maxRepairs, DEFAULTS.maxRepairs, 0, 10);
    this.maxTurns = clampInt(opts.maxTurns, DEFAULTS.maxTurns, 1, 50);
    this.maxToolCalls = clampInt(opts.maxToolCalls, DEFAULTS.maxToolCalls, 1, 500);
    this.compact = opts.promptProfile === 'compact';
    this.maxTokens = Math.min(clampInt(opts.maxTokens, DEFAULTS.maxTokens, 256, 64_000), this.compact ? COMPACT_LIMITS.maxTokens : Infinity);
    this.tools = this.compact ? COMPACT_TOOLS : AGENT_TOOLS;
    const ids = new Set<string>();
    for (const g of opts.catalogs.generators) {
      if (typeof g === 'object' && g !== null && 'id' in g && typeof (g as { id: unknown }).id === 'string') ids.add((g as { id: string }).id);
    }
    this.builtinGenerators = ids;
  }

  /** The (cached) planner system prompt. */
  get system(): string {
    this.systemPrompt ??= this.compact ? buildCompactSystemPrompt(this.opts.catalogs) : buildSystemPrompt(this.opts.catalogs);
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
    yield { type: 'done', usage: { ...usage } };
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
      ...(signal ? { signal } : {}),
    };

    const summary = summarizeWorld(host.getWorld(), { maxEntities: this.compact ? COMPACT_LIMITS.summaryEntities : CONTEXT_LIMITS.SUMMARY_ENTITIES });
    const first: ContentBlock[] = [...images.map((dataUrl): ContentBlock => ({ type: 'image', dataUrl })), { type: 'text', text: formatUserTurn(summary, request) }];
    const prior = sanitizeHistory(opts.history);
    const kept = this.compact ? prior.slice(prior.length > COMPACT_LIMITS.historyMessages ? prior.length - COMPACT_LIMITS.historyMessages : 0) : prior;
    // History must start with a user turn.
    const trimmed = this.compact ? kept.map((m): ChatMessage => ({ role: m.role, content: (m.content as string).slice(0, COMPACT_LIMITS.historyChars) })) : kept;
    const history = trimmed.length > 0 && trimmed[0]?.role !== 'user' ? trimmed.slice(1) : trimmed;
    const messages: ChatMessage[] = [...history, { role: 'user', content: first }];

    let repairs = 0;
    let toolCalls = 0;
    let dirty = false; // edits since the last verification
    let lastVerifyPassed: boolean | undefined;

    yield { type: 'status', text: 'Planning…' };
    for (let turn = 0; turn < this.maxTurns; turn++) {
      if (signal?.aborted) throw new Error('aborted');
      const res: CompletionResponse = await raceAbort(
        this.opts.provider.complete({ role: 'planner', system: this.system, messages, tools: this.tools, maxTokens: this.maxTokens }, signal),
        signal,
      );
      usage.calls += 1;
      usage.inputTokens += res.usage?.inputTokens ?? 0;
      usage.outputTokens += res.usage?.outputTokens ?? 0;
      messages.push({ role: 'assistant', content: res.content });

      const calls = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
      const text = textOf(res.content);
      if (text) yield { type: calls.length > 0 ? 'plan' : 'message', text };

      if (res.stopReason === 'error' && calls.length === 0) {
        yield { type: 'error', text: text || 'The model could not complete this request.' };
        return;
      }

      let finished: { message: string } | undefined;
      if (calls.length > 0) {
        const results: ContentBlock[] = [];
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
          if (out.verified) {
            dirty = false;
            lastVerifyPassed = out.verified.passed;
          }
          if (out.finished) finished = out.finished;
          results.push({ type: 'tool_result', toolUseId: call.id, content: out.content, ...(out.isError ? { isError: true } : {}) });
        }
        messages.push({ role: 'user', content: results });
        if (finished?.message) yield { type: 'message', text: finished.message };
      } else if (res.stopReason === 'max_tokens') {
        pushUserText(messages, 'Your reply was cut off by the output limit. Continue with smaller apply_patches calls.');
        continue;
      }

      const turnEnded = finished !== undefined || calls.length === 0;
      if (!turnEnded) continue;

      if (!dirty) {
        if (lastVerifyPassed === false) yield { type: 'status', text: 'Finished with verification issues remaining.' };
        return;
      }
      yield { type: 'status', text: 'Verifying physics and tests…' };
      const v = await runVerification(ctx);
      yield v.event;
      dirty = false;
      lastVerifyPassed = v.passed;
      if (v.passed) return;
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
}
