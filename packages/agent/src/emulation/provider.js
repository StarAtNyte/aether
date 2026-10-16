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
import { extractJsonObject } from './json';
import { parseEmulatedReply, replyJsonSchema } from './protocol';
import { renderTranscript } from './transcript';
/** Characters kept per tool result for compact (small-context) backends. */
export const COMPACT_RESULT_CHARS = 1_200;
const REASK_PREFIX = 'Your previous reply could not be used';
/** Wrap a {@link TextBackend} as a tool-calling {@link Provider}. */
export function createEmulatedProvider(opts) {
    const backend = opts.backend;
    const maxReasks = Math.max(0, Math.min(2, Math.floor(opts.maxReasks ?? 1)));
    return {
        name: opts.name ?? backend.name,
        async complete(req, signal) {
            const tools = req.tools ?? [];
            const rendered = renderTranscript(req, backend.strictSchema, { ...(opts.compact ? { resultChars: COMPACT_RESULT_CHARS } : {}), ...(req.session ? { stable: true } : {}) });
            const schema = replyJsonSchema(tools, backend.strictSchema);
            const salt = hashString(rendered.prompt).toString(36);
            let prompt = rendered.prompt;
            const usage = { inputTokens: 0, outputTokens: 0 };
            let model;
            let lastError = 'no reply';
            for (let attempt = 0; attempt <= maxReasks; attempt++) {
                if (signal?.aborted)
                    throw new ProviderError('aborted', 'request aborted');
                const model0 = req.model ?? opts.model;
                const result = await backend.complete({
                    role: req.role,
                    system: rendered.system,
                    prompt,
                    schema,
                    images: rendered.images,
                    ...(tools.length > 0 ? { toolNames: tools.map((t) => t.name) } : {}),
                    ...(model0 ? { model: model0 } : {}),
                    ...(opts.effort ? { effort: opts.effort } : {}),
                    ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
                    ...(req.session ? { session: { key: req.session, body: rendered.body, tail: attempt === 0 ? rendered.tail : prompt.slice(rendered.body.length).trimStart() } } : {}),
                }, signal);
                usage.inputTokens += result.usage?.inputTokens ?? 0;
                usage.outputTokens += result.usage?.outputTokens ?? 0;
                model = result.model ?? model;
                const value = result.structured !== undefined ? result.structured : extractJsonObject(result.text);
                if (value === undefined)
                    lastError = 'the reply is not a JSON object';
                else {
                    const parsed = parseEmulatedReply(value, tools, `${salt}-${attempt}`);
                    if (parsed.ok)
                        return { ...parsed.response, usage, ...(model ? { model } : {}) };
                    lastError = parsed.error;
                }
                prompt = `${rendered.prompt}\n\n${REASK_PREFIX}: ${lastError.slice(0, 400)}.\nReply again with ONLY the JSON object described in the system prompt.`;
            }
            throw new ProviderError('invalid_response', `${backend.name} returned an unusable reply: ${lastError.slice(0, 300)}`);
        },
    };
}
