import { createEmulatedProvider } from '../emulation/provider';
import { ProviderError } from './errors';
/** Conservative characters-per-token estimate for prompts full of JSON (real tokenizers average 3–4). */
export const WEBLLM_CHARS_PER_TOKEN = 3;
/** Smallest useful output budget; a request that leaves less is refused before generating. */
export const WEBLLM_MIN_OUTPUT_TOKENS = 256;
/** Text backend over a WebLLM engine (exported for tests). */
export function createWebLlmBackend(opts) {
    const maxTokens = Math.max(64, Math.min(8192, Math.floor(opts.maxTokens ?? 1200)));
    const contextTokens = Math.max(1024, Math.min(131_072, Math.floor(opts.contextTokens ?? 4096)));
    return {
        name: 'on-device',
        strictSchema: false,
        async complete(req, signal) {
            if (signal?.aborted)
                throw new ProviderError('aborted', 'request aborted');
            // Fail fast (and fall back) instead of letting the engine reject or silently truncate.
            const inputTokens = Math.ceil((req.system.length + req.prompt.length) / WEBLLM_CHARS_PER_TOKEN) + 32;
            const room = contextTokens - inputTokens;
            if (room < WEBLLM_MIN_OUTPUT_TOKENS) {
                throw new ProviderError('too_large', `this request needs about ${inputTokens} tokens but the on-device model holds ${contextTokens}`, { reason: 'webllm_context' });
            }
            const onAbort = () => opts.engine.interruptGenerate?.();
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
                if (signal?.aborted)
                    throw new ProviderError('aborted', 'request aborted');
                const text = res.choices[0]?.message.content ?? '';
                return {
                    text,
                    model: opts.model,
                    usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
                };
            }
            catch (err) {
                if (err instanceof ProviderError)
                    throw err;
                if (signal?.aborted)
                    throw new ProviderError('aborted', 'request aborted', { cause: err });
                throw new ProviderError('server', `on-device model failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown error'}`, { cause: err, reason: 'webllm_error' });
            }
            finally {
                signal?.removeEventListener('abort', onAbort);
            }
        },
    };
}
/** A tool-calling provider running a WebLLM model on this device. */
export function createWebLlmProvider(opts) {
    return createEmulatedProvider({ backend: createWebLlmBackend(opts), name: 'on-device', model: opts.model, compact: true });
}
