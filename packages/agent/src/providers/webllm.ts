/**
 * On-device text backend over a WebLLM-compatible engine (OpenAI-style
 * `chat.completions.create` with JSON-Schema-constrained output). The engine
 * itself is created by the host (the studio lazy-loads `@mlc-ai/web-llm`);
 * this module only depends on the small structural interface below, so it is
 * testable with a fake engine and never pulls WebLLM into a bundle.
 */
import type { TextBackend, TextCompletionRequest, TextCompletionResult } from '../emulation/provider';
import { createEmulatedProvider } from '../emulation/provider';
import type { Provider } from '../types';
import { ProviderError } from './errors';

/** The subset of WebLLM's `MLCEngine` used here. */
export interface WebLlmEngineLike {
  chat: {
    completions: {
      create(req: {
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
        response_format?: { type: 'json_object'; schema?: string };
        max_tokens?: number;
        temperature?: number;
        stream?: false;
      }): Promise<{ choices: Array<{ message: { content: string | null }; finish_reason?: string | null }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }>;
    };
  };
  interruptGenerate?(): void;
}

/** Options of {@link createWebLlmProvider}. */
export interface WebLlmProviderOptions {
  engine: WebLlmEngineLike;
  /** Model id shown in responses (e.g. "Qwen2.5-1.5B-Instruct-q4f16_1-MLC"). */
  model: string;
  /** Output cap per call (default 1200: small models, small budgets). */
  maxTokens?: number;
  /** The model's context window in tokens, input + output (default 4096, as WebLLM configures these models). */
  contextTokens?: number;
}

/** Conservative characters-per-token estimate for prompts full of JSON (real tokenizers average 3–4). */
export const WEBLLM_CHARS_PER_TOKEN = 3;
/** Smallest useful output budget; a request that leaves less is refused before generating. */
export const WEBLLM_MIN_OUTPUT_TOKENS = 256;

/** Text backend over a WebLLM engine (exported for tests). */
export function createWebLlmBackend(opts: WebLlmProviderOptions): TextBackend {
  const maxTokens = Math.max(64, Math.min(8192, Math.floor(opts.maxTokens ?? 1200)));
  const contextTokens = Math.max(1024, Math.min(131_072, Math.floor(opts.contextTokens ?? 4096)));
  return {
    name: 'on-device',
    strictSchema: false,
    async complete(req: TextCompletionRequest, signal?: AbortSignal): Promise<TextCompletionResult> {
      if (signal?.aborted) throw new ProviderError('aborted', 'request aborted');
      // Fail fast (and fall back) instead of letting the engine reject or silently truncate.
      const inputTokens = Math.ceil((req.system.length + req.prompt.length) / WEBLLM_CHARS_PER_TOKEN) + 32;
      const room = contextTokens - inputTokens;
      if (room < WEBLLM_MIN_OUTPUT_TOKENS) {
        throw new ProviderError('too_large', `this request needs about ${inputTokens} tokens but the on-device model holds ${contextTokens}`, { reason: 'webllm_context' });
      }
      const onAbort = (): void => opts.engine.interruptGenerate?.();
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const res = await opts.engine.chat.completions.create({
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.prompt },
          ],
          response_format: { type: 'json_object', schema: JSON.stringify(req.schema) },
          max_tokens: Math.min(maxTokens, req.maxOutputTokens ?? maxTokens, room),
          temperature: 0.2,
          stream: false,
        });
        if (signal?.aborted) throw new ProviderError('aborted', 'request aborted');
        const text = res.choices[0]?.message.content ?? '';
        return {
          text,
          model: opts.model,
          usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
        };
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        if (signal?.aborted) throw new ProviderError('aborted', 'request aborted', { cause: err });
        throw new ProviderError('server', `on-device model failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown error'}`, { cause: err, reason: 'webllm_error' });
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

/** A tool-calling provider running a WebLLM model on this device. */
export function createWebLlmProvider(opts: WebLlmProviderOptions): Provider {
  return createEmulatedProvider({ backend: createWebLlmBackend(opts), name: 'on-device', model: opts.model, compact: true });
}
