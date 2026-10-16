import { blocksOf, contentKey, LruMap, parseImageDataUrl, parseToolArguments } from './content';
import { ProviderError } from './errors';
import { postJson } from './transport';
const DEFAULT_EFFORT = { planner: 'low', coder: 'medium', critic: 'medium' };
const MAX_OUTPUT_TOKENS = 64_000;
const REPLAY_CAPACITY = 128;
function toolsToWire(tools) {
    return tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.inputSchema, strict: false }));
}
function stringifyArgs(input) {
    try {
        return JSON.stringify(input ?? {});
    }
    catch {
        return '{}';
    }
}
/** Convert normalized messages to Responses API input items. */
function messagesToItems(messages, replay) {
    const items = [];
    for (const m of messages) {
        const blocks = blocksOf(m);
        if (m.role === 'assistant') {
            const raw = replay.get(contentKey(blocks));
            if (raw) {
                items.push(...raw);
                continue;
            }
            const text = blocks.filter((b) => b.type === 'text' && b.text.length > 0);
            if (text.length > 0)
                items.push({ type: 'message', role: 'assistant', content: text.map((b) => ({ type: 'output_text', text: b.text })) });
            for (const b of blocks) {
                if (b.type === 'tool_use')
                    items.push({ type: 'function_call', call_id: b.id, name: b.name, arguments: stringifyArgs(b.input) });
            }
            continue;
        }
        const parts = [];
        for (const b of blocks) {
            if (b.type === 'tool_result')
                items.push({ type: 'function_call_output', call_id: b.toolUseId, output: b.isError ? `ERROR: ${b.content}` : b.content });
            else if (b.type === 'text' && b.text.length > 0)
                parts.push({ type: 'input_text', text: b.text });
            else if (b.type === 'image') {
                parseImageDataUrl(b.dataUrl); // validates type and size
                parts.push({ type: 'input_image', image_url: b.dataUrl });
            }
        }
        if (parts.length > 0)
            items.push({ type: 'message', role: 'user', content: parts });
    }
    return items;
}
function isRecord(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
/** Normalize a Responses API body. Exported for tests. */
export function parseOpenAIResponse(body) {
    if (!isRecord(body) || !Array.isArray(body['output']))
        throw new ProviderError('invalid_response', 'malformed Responses API response');
    if (body['status'] === 'failed') {
        const err = isRecord(body['error']) && typeof body['error']['message'] === 'string' ? body['error']['message'] : 'response failed';
        throw new ProviderError('server', `OpenAI response failed: ${err.slice(0, 300)}`);
    }
    const raw = body['output'].filter(isRecord);
    const content = [];
    let refused = false;
    for (const item of raw) {
        if (item['type'] === 'message' && Array.isArray(item['content'])) {
            for (const part of item['content']) {
                if (!isRecord(part))
                    continue;
                if (part['type'] === 'output_text' && typeof part['text'] === 'string')
                    content.push({ type: 'text', text: part['text'] });
                else if (part['type'] === 'refusal')
                    refused = true;
            }
        }
        else if (item['type'] === 'function_call' && typeof item['call_id'] === 'string' && typeof item['name'] === 'string') {
            const args = typeof item['arguments'] === 'string' ? item['arguments'] : '';
            content.push({ type: 'tool_use', id: item['call_id'], name: item['name'], input: parseToolArguments(args) });
        }
    }
    let stopReason = 'end';
    if (content.some((b) => b.type === 'tool_use'))
        stopReason = 'tool_use';
    if (body['status'] === 'incomplete')
        stopReason = 'max_tokens';
    if (refused) {
        stopReason = 'error';
        content.push({ type: 'text', text: 'The model declined this request.' });
    }
    const usage = isRecord(body['usage']) ? body['usage'] : {};
    const response = { content, stopReason, usage: { inputTokens: num(usage['input_tokens']), outputTokens: num(usage['output_tokens']) } };
    if (typeof body['model'] === 'string')
        response.model = body['model'];
    return { response, raw };
}
function describeError(status, body) {
    const err = isRecord(body) && isRecord(body['error']) ? body['error'] : undefined;
    const msg = err && typeof err['message'] === 'string' ? err['message'].slice(0, 300) : '';
    return `OpenAI API error ${status}${msg ? `: ${msg}` : ''}`;
}
/** Create a provider for the OpenAI Responses API. In browser code only with the visitor's own key. */
export function createOpenAIProvider(opts) {
    if (!opts.apiKey)
        throw new ProviderError('auth', 'OpenAI API key is missing');
    const baseUrl = (opts.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '');
    const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    const effort = { ...DEFAULT_EFFORT, ...opts.effort };
    const replay = new LruMap(REPLAY_CAPACITY);
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` };
    return {
        name: 'openai',
        async complete(req, signal) {
            const body = {
                model: req.model ?? opts.models[req.role],
                instructions: req.system,
                input: messagesToItems(req.messages, replay),
                max_output_tokens: Math.max(16, Math.min(MAX_OUTPUT_TOKENS, Math.floor(req.maxTokens ?? opts.defaultMaxTokens ?? 16_000))),
                reasoning: { effort: effort[req.role] },
                include: ['reasoning.encrypted_content'],
                store: false,
            };
            if (req.tools && req.tools.length > 0)
                body['tools'] = toolsToWire(req.tools);
            const json = await postJson({
                url: `${baseUrl}/v1/responses`,
                headers,
                body,
                fetch: doFetch,
                describeError,
                ...(signal ? { signal } : {}),
                ...(opts.retry ? { policy: opts.retry } : {}),
            });
            const { response, raw } = parseOpenAIResponse(json);
            if (raw.some((i) => i['type'] === 'reasoning'))
                replay.set(contentKey(response.content), raw);
            return response;
        },
    };
}
