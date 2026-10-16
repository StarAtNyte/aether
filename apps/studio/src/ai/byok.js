/**
 * Bring-your-own-key model access, straight from the browser to the
 * provider: Anthropic (Messages API with the direct-browser-access header),
 * OpenAI (Responses API), OpenRouter and Google Gemini (OpenAI-compatible
 * Chat Completions). The key never touches Aether's server.
 *
 * Every provider is wrapped in a meter that enforces the per-session call
 * cap and records token usage, so a runaway loop cannot drain the user's
 * account and the UI can show what a session cost.
 */
import { createAnthropicProvider, createChatCompletionsProvider, createOpenAIProvider, ProviderError } from '@aether/agent';
import { z } from 'zod';
import { BYOK_CATALOG, BYOK_MODEL_RE, BYOK_SESSION_CALL_CAP } from './byokCatalog';
/** Per-attempt timeout of a direct call (ms). */
export const BYOK_TIMEOUT_MS = 120_000;
/** Largest model list accepted from a provider (bytes). */
const MAX_LIST_BYTES = 8 * 1024 * 1024;
/** Most models shown in the picker. */
const MAX_LISTED_MODELS = 200;
/** Timeout of a model list request (ms). */
const LIST_TIMEOUT_MS = 15_000;
/** Base URLs of the model endpoints. */
const ENDPOINTS = {
    anthropic: 'https://api.anthropic.com',
    openai: 'https://api.openai.com',
    openrouter: 'https://openrouter.ai/api/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
};
/** The model a send will use: the saved choice when well-formed, else the provider default. */
export function byokModelFor(provider, saved) {
    return saved !== undefined && BYOK_MODEL_RE.test(saved) ? saved : BYOK_CATALOG[provider].defaultModel;
}
/** A provider that calls `provider`'s API from this page with the user's `key`. */
export function createDirectProvider(provider, key, model, fetchImpl) {
    const models = { planner: model, coder: model, critic: model };
    const retry = { maxRetries: 1, timeoutMs: BYOK_TIMEOUT_MS };
    switch (provider) {
        case 'anthropic':
            return createAnthropicProvider({ apiKey: key, models, fetch: fetchImpl, retry, browser: true });
        case 'openai':
            return createOpenAIProvider({ apiKey: key, models, fetch: fetchImpl, retry });
        case 'openrouter':
        case 'gemini':
            return createChatCompletionsProvider({ apiKey: key, baseUrl: ENDPOINTS[provider], models, name: provider, fetch: fetchImpl, retry });
    }
}
/** Rough token count of a request (about four characters per token; images count 1 000). */
export function estimateRequestTokens(req) {
    let chars = req.system.length;
    let images = 0;
    for (const m of req.messages) {
        if (typeof m.content === 'string') {
            chars += m.content.length;
            continue;
        }
        for (const b of m.content) {
            if (b.type === 'text')
                chars += b.text.length;
            else if (b.type === 'tool_result')
                chars += b.content.length;
            else if (b.type === 'tool_use')
                chars += 64;
            else
                images++;
        }
    }
    for (const t of req.tools ?? [])
        chars += t.description.length + 400;
    return Math.ceil(chars / 4) + images * 1000;
}
/**
 * Wrap a provider with the session call cap and usage accounting. A call
 * over the cap fails with a `rate_limit` ProviderError (reason
 * `session_cap`) before anything is sent.
 */
export function meteredProvider(inner, meter, cap = BYOK_SESSION_CALL_CAP) {
    return {
        name: inner.name,
        async complete(req, signal) {
            const before = meter.read();
            if (before.calls >= cap)
                throw new ProviderError('rate_limit', `This session reached its limit of ${cap} model calls with your key. Reset the counter in Settings → AI connection to continue.`, { reason: 'session_cap' });
            meter.write({ ...before, calls: before.calls + 1, inputTokens: before.inputTokens + estimateRequestTokens(req) });
            const out = await inner.complete(req, signal);
            const now = meter.read();
            // Replace the estimate with the provider's count when it reports one.
            const reported = out.usage?.inputTokens ?? 0;
            const input = reported > 0 ? now.inputTokens - estimateRequestTokens(req) + reported : now.inputTokens;
            meter.write({ ...now, inputTokens: Math.max(0, input), outputTokens: now.outputTokens + (out.usage?.outputTokens ?? 0) });
            return out;
        },
    };
}
const ModelList = z.object({
    data: z
        .array(z.object({ id: z.string().max(200), display_name: z.string().max(120).optional(), name: z.string().max(120).optional(), supported_parameters: z.array(z.string().max(64)).max(64).optional() }).loose())
        .max(5000),
});
/** Which listed models can drive the agent (tool use, text output). */
function usable(provider, m) {
    switch (provider) {
        case 'anthropic':
            return m.id.startsWith('claude-');
        case 'openai':
            return /^(gpt-[0-9]|o[0-9])/.test(m.id) && !/(audio|realtime|transcribe|tts|image|search|embedding)/.test(m.id);
        case 'openrouter':
            return !m.id.includes(':') && (m.supported_parameters?.includes('tools') ?? false);
        case 'gemini':
            return /^gemini-/.test(m.id) && !/(embedding|image|tts|live|audio)/.test(m.id);
    }
}
/**
 * Load the provider's own model list with the user's key (OpenRouter's list
 * is public). Validated, filtered to models that can call tools, capped.
 */
export async function listProviderModels(provider, key, fetchImpl, signal) {
    const url = provider === 'anthropic' ? `${ENDPOINTS.anthropic}/v1/models?limit=100` : provider === 'openai' ? `${ENDPOINTS.openai}/v1/models` : `${ENDPOINTS[provider]}/models`;
    const headers = provider === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } : provider === 'openrouter' ? {} : { authorization: `Bearer ${key}` };
    const timeout = AbortSignal.timeout(LIST_TIMEOUT_MS);
    let res;
    try {
        res = await fetchImpl(url, { headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout, credentials: 'omit', referrerPolicy: 'no-referrer' });
    }
    catch {
        throw new ProviderError('network', `${BYOK_CATALOG[provider].label} could not be reached.`);
    }
    if (res.status === 401 || res.status === 403)
        throw new ProviderError('auth', `${BYOK_CATALOG[provider].label} rejected the key.`, { status: res.status });
    if (!res.ok)
        throw new ProviderError('server', `${BYOK_CATALOG[provider].label} answered ${res.status}.`, { status: res.status });
    const text = await res.text();
    if (text.length > MAX_LIST_BYTES)
        throw new ProviderError('invalid_response', 'The model list is too large.');
    let parsed;
    try {
        parsed = ModelList.parse(JSON.parse(text));
    }
    catch {
        throw new ProviderError('invalid_response', 'The model list could not be read.');
    }
    const out = [];
    const seen = new Set();
    for (const m of parsed.data) {
        const id = provider === 'gemini' ? m.id.replace(/^models\//, '') : m.id;
        if (!BYOK_MODEL_RE.test(id) || seen.has(id) || !usable(provider, { id, supported_parameters: m.supported_parameters }))
            continue;
        seen.add(id);
        out.push({ id, label: (m.display_name ?? m.name ?? id).slice(0, 80) });
        if (out.length >= MAX_LISTED_MODELS)
            break;
    }
    return out;
}
