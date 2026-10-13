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
   * Names of the emulated (protocol) tools. They are never native tools of the
   * backend; a backend may use the list to recognise a model that mistakenly
   * tries to call one of them directly.
   */
  toolNames?: readonly string[];
  model?: string;
  effort?: TextEffort;
  maxOutputTokens?: number;
}

/** Result of a text completion. */
export interface TextCompletionResult {
  /** Raw reply text (JSON expected). */
  text: string;
  /** Parsed structured output when the backend returns it separately. */
  structured?: unknown;
  usage?: { inputTokens: number; outputTokens: number };
  model?: string;
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
      const rendered = renderTranscript(req, backend.strictSchema, opts.compact ? { resultChars: COMPACT_RESULT_CHARS } : {});
      const schema = replyJsonSchema(tools, backend.strictSchema);
      const salt = hashString(rendered.prompt).toString(36);
      let prompt = rendered.prompt;
      const usage = { inputTokens: 0, outputTokens: 0 };
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
            ...(tools.length > 0 ? { toolNames: tools.map((t) => t.name) } : {}),
            ...(model0 ? { model: model0 } : {}),
            ...(opts.effort ? { effort: opts.effort } : {}),
            ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
          },
          signal,
        );
        usage.inputTokens += result.usage?.inputTokens ?? 0;
        usage.outputTokens += result.usage?.outputTokens ?? 0;
        model = result.model ?? model;
        const value = result.structured !== undefined ? result.structured : extractJsonObject(result.text);
        if (value === undefined) lastError = 'the reply is not a JSON object';
        else {
          const parsed = parseEmulatedReply(value, tools, `${salt}-${attempt}`);
          if (parsed.ok) return { ...parsed.response, usage, ...(model ? { model } : {}) };
          lastError = parsed.error;
        }
        prompt = `${rendered.prompt}\n\n${REASK_PREFIX}: ${lastError.slice(0, 400)}.\nReply again with ONLY the JSON object described in the system prompt.`;
      }
      throw new ProviderError('invalid_response', `${backend.name} returned an unusable reply: ${lastError.slice(0, 300)}`);
    },
  };
}
