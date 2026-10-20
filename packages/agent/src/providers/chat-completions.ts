/**
 * OpenAI-compatible Chat Completions provider (raw fetch). Serves the
 * providers that speak `POST …/chat/completions` with function tools:
 * OpenRouter (`https://openrouter.ai/api/v1`) and Google Gemini's
 * OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai`).
 * Both allow CORS, so the studio calls them straight from the browser with
 * the user's own key; it works server-side too.
 *
 * - The system prompt is the first `system` message.
 * - `tool_use` blocks become assistant `tool_calls`; `tool_result` blocks
 *   become `tool` messages (sent before any other user content of the turn).
 * - Images are `image_url` parts with the validated data URL.
 */
import type { ChatMessage, CompletionRequest, CompletionResponse, ContentBlock, Provider, ToolDef } from '../types';
import { blocksOf, parseImageDataUrl, parseToolArguments } from './content';
import { ProviderError } from './errors';
import { postJson, type RetryPolicy } from './transport';

/** Options of {@link createChatCompletionsProvider}. */
export interface ChatCompletionsProviderOptions {
  /** Provider name reported by the Provider (e.g. 'openrouter', 'gemini'). */
  name: string;
  apiKey: string;
  /** Base URL without the trailing `/chat/completions` (https only, or loopback http). */
  baseUrl: string;
  models: { planner: string; coder: string; critic: string };
  fetch?: typeof fetch;
  defaultMaxTokens?: number;
  retry?: RetryPolicy;
  /** Extra request headers (e.g. OpenRouter's `X-Title`); never credentials. */
  headers?: Readonly<Record<string, string>>;
}

const MAX_OUTPUT_TOKENS = 32_000;
const MAX_CHOICE_TOOL_CALLS = 64;

type Msg = Record<string, unknown>;

function toolsToWire(tools: readonly ToolDef[]): Msg[] {
  return tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
}

function stringifyArgs(input: unknown): string {
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return '{}';
  }
}

/** Convert normalized messages to Chat Completions messages. Exported for tests. */
export function chatMessagesToWire(system: string, messages: readonly ChatMessage[]): Msg[] {
  const out: Msg[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    const blocks = blocksOf(m);
    if (m.role === 'assistant') {
      const text = blocks
        .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      const calls = blocks
        .filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
        .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: stringifyArgs(b.input) } }));
      if (text.length === 0 && calls.length === 0) continue;
      out.push({ role: 'assistant', content: text.length > 0 ? text : null, ...(calls.length > 0 ? { tool_calls: calls } : {}) });
      continue;
    }
    const parts: Msg[] = [];
    for (const b of blocks) {
      if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.toolUseId, content: b.isError ? `ERROR: ${b.content}` : b.content || '(empty)' });
      else if (b.type === 'text' && b.text.length > 0) parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image') {
        parseImageDataUrl(b.dataUrl); // validates type and size
        parts.push({ type: 'image_url', image_url: { url: b.dataUrl } });
      }
    }
    if (parts.length > 0) out.push({ role: 'user', content: parts });
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Normalize a Chat Completions body. Exported for tests. */
export function parseChatCompletion(body: unknown): CompletionResponse {
  if (!isRecord(body) || !Array.isArray(body['choices'])) {
    // OpenRouter reports some upstream failures with HTTP 200 and an `error` object.
    if (isRecord(body) && isRecord(body['error'])) {
      const msg = typeof body['error']['message'] === 'string' ? body['error']['message'].slice(0, 300) : 'error';
      throw new ProviderError('server', `provider error: ${msg}`);
    }
    throw new ProviderError('invalid_response', 'malformed Chat Completions response');
  }
  const choice = body['choices'][0];
  if (!isRecord(choice) || !isRecord(choice['message'])) throw new ProviderError('invalid_response', 'Chat Completions response has no message');
  const msg = choice['message'];
  const content: ContentBlock[] = [];
  if (typeof msg['content'] === 'string' && msg['content'].length > 0) content.push({ type: 'text', text: msg['content'] });
  if (Array.isArray(msg['tool_calls'])) {
    const calls: unknown[] = msg['tool_calls'].slice(0, MAX_CHOICE_TOOL_CALLS);
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      if (!isRecord(call) || !isRecord(call['function'])) continue;
      const fn = call['function'];
      if (typeof fn['name'] !== 'string') continue;
      // Gemini omits ids: number them by position so tool results can refer back.
      const id = typeof call['id'] === 'string' && call['id'].length > 0 ? call['id'].slice(0, 128) : `call_${i}`;
      content.push({ type: 'tool_use', id, name: fn['name'], input: parseToolArguments(typeof fn['arguments'] === 'string' ? fn['arguments'] : '') });
    }
  }
  const reason = choice['finish_reason'];
  let stopReason: CompletionResponse['stopReason'] = 'end';
  if (content.some((b) => b.type === 'tool_use')) stopReason = 'tool_use';
  else if (reason === 'length') stopReason = 'max_tokens';
  else if (reason === 'content_filter') {
    stopReason = 'error';
    content.push({ type: 'text', text: 'The model declined this request.' });
  }
  if (typeof msg['refusal'] === 'string' && msg['refusal'].length > 0 && content.length === 0) {
    stopReason = 'error';
    content.push({ type: 'text', text: 'The model declined this request.' });
  }
  const usage = isRecord(body['usage']) ? body['usage'] : {};
  const response: CompletionResponse = { content, stopReason, usage: { inputTokens: num(usage['prompt_tokens']), outputTokens: num(usage['completion_tokens']) } };
  if (typeof body['model'] === 'string') response.model = body['model'].slice(0, 128);
  return response;
}

function describeError(status: number, body: unknown): string {
  const err = isRecord(body) && isRecord(body['error']) ? body['error'] : Array.isArray(body) && isRecord(body[0]) && isRecord(body[0]['error']) ? body[0]['error'] : undefined;
  const msg = err && typeof err['message'] === 'string' ? err['message'].slice(0, 300) : '';
  return `API error ${status}${msg ? `: ${msg}` : ''}`;
}

/** True for an https URL, or http on loopback (tests and local gateways). */
function isAllowedBase(url: string): boolean {
  return /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s]*)?$/.test(url);
}

/** Create a provider for an OpenAI-compatible Chat Completions endpoint. In browser code only with the visitor's own key. */
export function createChatCompletionsProvider(opts: ChatCompletionsProviderOptions): Provider {
  if (!opts.apiKey) throw new ProviderError('auth', 'API key is missing');
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  if (!isAllowedBase(baseUrl)) throw new ProviderError('bad_request', 'the API base URL must use https');
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const headers: Record<string, string> = { ...(opts.headers ?? {}), 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` };
  let samplingRefused = false;
  return {
    name: opts.name,
    async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse> {
      const body: Record<string, unknown> = {
        model: req.model ?? opts.models[req.role],
        messages: chatMessagesToWire(req.system, req.messages),
        max_tokens: Math.max(16, Math.min(MAX_OUTPUT_TOKENS, Math.floor(req.maxTokens ?? opts.defaultMaxTokens ?? 16_000))),
      };
      if (req.tools && req.tools.length > 0) body['tools'] = toolsToWire(req.tools);
      // Sampling parameters (the judges ask for temperature 0 and a fixed seed): sent while the endpoint accepts them;
      // a model that refuses them is asked again without, and they are not sent to this provider again.
      const sampling = !samplingRefused && (req.temperature !== undefined || req.seed !== undefined);
      if (sampling) {
        if (req.temperature !== undefined) body['temperature'] = req.temperature;
        if (req.seed !== undefined) body['seed'] = req.seed;
      }
      const send = (b: Record<string, unknown>): Promise<unknown> =>
        postJson({
          url: `${baseUrl}/chat/completions`,
          headers,
          body: b,
          fetch: doFetch,
          describeError,
          ...(signal ? { signal } : {}),
          ...(opts.retry ? { policy: opts.retry } : {}),
        });
      let json: unknown;
      try {
        json = await send(body);
      } catch (e) {
        if (!sampling || !(e instanceof ProviderError) || e.status !== 400 || !/temperature|seed|sampling|unsupported/i.test(e.message)) throw e;
        samplingRefused = true;
        delete body['temperature'];
        delete body['seed'];
        json = await send(body);
      }
      return parseChatCompletion(json);
    },
  };
}
