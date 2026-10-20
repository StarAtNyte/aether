/**
 * Turn a text-only {@link TextBackend} (headless Codex / Claude Code, an
 * on-device model) into a normal {@link Provider} with tool calls.
 *
 * The backend is asked for a JSON reply in the emulation protocol; an invalid
 * reply triggers exactly one automatic re-ask that quotes the problem. The
 * result is validated with zod and mapped to `tool_use` blocks, so
 * `WorldAgent` works unchanged.
 */
import { hashString } from '@aether/core';
import { ProviderError } from '../providers/errors';
import type { CompletionRequest, CompletionResponse, ModelRole, Provider } from '../types';
import { extractJsonObject } from './json';
import { parseEmulatedReply, replyJsonSchema, type JsonSchemaObject } from './protocol';
import { renderTranscript } from './transcript';

/** Reasoning effort accepted by text backends. */
export type TextEffort = 'low' | 'medium' | 'high';

/** One text completion. */
export interface TextCompletionRequest {
  role: ModelRole;
  system: string;
  prompt: string;
  /** JSON Schema the reply must satisfy (backends with structured output enforce it). */
  schema: JsonSchemaObject;
  /** Image data URLs (PNG/JPEG/WebP). */
  images: string[];
  /**
   * The key of each image as the prompt's placeholders name it (`[image <key>]`); backends label each attached
   * image with it. Absent: the 1-based position.
   */
  imageKeys?: readonly string[];
  /**
   * Names of the emulated (protocol) tools. They are never native tools of the
   * backend; a backend may use the list to recognise a model that mistakenly
   * tries to call one of them directly.
   */
  toolNames?: readonly string[];
  model?: string;
  effort?: TextEffort;
  maxOutputTokens?: number;
  /**
   * Resumable conversation (see `CompletionRequest.session`): `body` is the
   * append-only conversation and `tail` the closing instruction, so a backend
   * that resumes a thread sends only what follows the body it already sent.
   * `prompt` stays the complete prompt for backends that ignore sessions.
   */
  session?: { key: string; body: string; tail: string };
}

/** Result of a text completion. */
export interface TextCompletionResult {
  /** Raw reply text (JSON expected). */
  text: string;
  /** Parsed structured output when the backend returns it separately. */
  structured?: unknown;
  /** Tokens of this call: `inputTokens` counts everything read (cached or not), `cachedInputTokens` the cached part. */
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  model?: string;
  /** The backend continued an earlier conversation (sent only the new part). */
  resumed?: boolean;
}

/** A backend that returns text (ideally JSON) but has no native tool calling. */
export interface TextBackend {
  readonly name: string;
  /** True when the backend enforces strict JSON Schemas (needs the `input_json` reply variant). */
  readonly strictSchema: boolean;
  complete(req: TextCompletionRequest, signal?: AbortSignal): Promise<TextCompletionResult>;
}

/** Options of {@link createEmulatedProvider}. */
export interface EmulatedProviderOptions {
  backend: TextBackend;
  /** Provider name (default: the backend's). */
  name?: string;
  /** Model per call (default: backend default); `req.model` wins. */
  model?: string;
  effort?: TextEffort;
  /** Automatic re-asks after an invalid reply (default 1, max 2). */
  maxReasks?: number;
  /** Small-context backend: tool results are cut to {@link COMPACT_RESULT_CHARS} characters. */
  compact?: boolean;
}

/** Characters kept per tool result for compact (small-context) backends. */
export const COMPACT_RESULT_CHARS = 1_200;

const REASK_PREFIX = 'Your previous reply could not be used';

/** Wrap a {@link TextBackend} as a tool-calling {@link Provider}. */
export function createEmulatedProvider(opts: EmulatedProviderOptions): Provider {
  const backend = opts.backend;
  const maxReasks = Math.max(0, Math.min(2, Math.floor(opts.maxReasks ?? 1)));
  return {
    name: opts.name ?? backend.name,
    async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse> {
      const tools = req.tools ?? [];
      const rendered = renderTranscript(req, backend.strictSchema, { ...(opts.compact ? { resultChars: COMPACT_RESULT_CHARS } : {}), ...(req.session ? { stable: true } : {}) });
      const schema = replyJsonSchema(tools, backend.strictSchema);
      const salt = hashString(rendered.prompt).toString(36);
      let prompt = rendered.prompt;
      const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
      let tail = rendered.tail;
      let model: string | undefined;
      let lastError = 'no reply';
      for (let attempt = 0; attempt <= maxReasks; attempt++) {
        if (signal?.aborted) throw new ProviderError('aborted', 'request aborted');
        const model0 = req.model ?? opts.model;
        const result = await backend.complete(
          {
            role: req.role,
            system: rendered.system,
            prompt,
            schema,
            images: rendered.images,
            imageKeys: rendered.imageKeys,
            ...(tools.length > 0 ? { toolNames: tools.map((t) => t.name) } : {}),
            ...(model0 ? { model: model0 } : {}),
            ...(opts.effort ? { effort: opts.effort } : {}),
            ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
            ...(req.session ? { session: { key: req.session, body: rendered.body, tail } } : {}),
          },
          signal,
        );
        usage.inputTokens += result.usage?.inputTokens ?? 0;
        usage.outputTokens += result.usage?.outputTokens ?? 0;
        usage.cachedInputTokens += result.usage?.cachedInputTokens ?? 0;
        model = result.model ?? model;
        const value = result.structured !== undefined ? result.structured : extractJsonObject(result.text);
        if (value === undefined) lastError = 'the reply is not a JSON object';
        else {
          const parsed = parseEmulatedReply(value, tools, `${salt}-${attempt}`);
          if (parsed.ok) return { ...parsed.response, usage: usage.cachedInputTokens > 0 ? usage : { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }, ...(model ? { model } : {}) };
          lastError = parsed.error;
        }
        const reask = `${REASK_PREFIX}: ${lastError.slice(0, 400)}.\nReply again with ONLY the JSON object described in the system prompt.`;
        prompt = `${rendered.prompt}\n\n${reask}`;
        tail = `${rendered.tail}\n\n${reask}`;
      }
      throw new ProviderError('invalid_response', `${backend.name} returned an unusable reply: ${lastError.slice(0, 300)}`);
    },
  };
}
