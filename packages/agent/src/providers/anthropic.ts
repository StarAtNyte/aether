/**
 * Anthropic Messages API provider (raw fetch; server-side, or in the browser
 * with the user's own key).
 *
 * - `POST {baseUrl}/v1/messages` with `x-api-key` + `anthropic-version`.
 * - Prompt caching: `cache_control` breakpoints on the system prompt and on
 *   the last tool (render order is tools → system → messages, so both stay
 *   cacheable as long as they are byte-stable).
 * - Current models think adaptively and reject sampling parameters and
 *   thinking budgets, so the request only carries `output_config.effort`.
 * - Thinking blocks are opaque and must be replayed unchanged on later turns
 *   of the same conversation; they are kept in a per-provider LRU keyed by the
 *   normalized assistant content and substituted back when that turn is sent.
 */
import type { ChatMessage, CompletionRequest, CompletionResponse, ContentBlock, ModelRole, Provider, ToolDef } from '../types';
import { blocksOf, contentKey, LruMap, parseImageDataUrl } from './content';
import { ProviderError } from './errors';
import { postJson, type RetryPolicy } from './transport';

/** Effort levels accepted by `output_config.effort`. */
export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Options of {@link createAnthropicProvider}. */
export interface AnthropicProviderOptions {
  apiKey: string;
  models: { planner: string; coder: string; critic: string };
  /** Default `https://api.anthropic.com`. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Effort per role (defaults: planner medium, coder high, critic high). */
  effort?: Partial<Record<ModelRole, AnthropicEffort>>;
  /** Default output cap when the request has none (16 000; non-streaming). */
  defaultMaxTokens?: number;
  retry?: RetryPolicy;
  /**
   * Called straight from a web page with the user's own key (bring your own
   * key): sends `anthropic-dangerous-direct-browser-access: true`, which the
   * API requires for CORS. Never set it with a key that is not the user's.
   */
  browser?: boolean;
}

const API_VERSION = '2023-06-01';
const DEFAULT_EFFORT: Record<ModelRole, AnthropicEffort> = { planner: 'medium', coder: 'high', critic: 'high' };
const MAX_OUTPUT_TOKENS = 64_000;
/** Remembered assistant turns (raw content incl. thinking) for verbatim replay. */
const REPLAY_CAPACITY = 128;

type WireBlock = Record<string, unknown>;
interface WireMessage {
  role: 'user' | 'assistant';
  content: WireBlock[];
}

const EPHEMERAL = Object.freeze({ type: 'ephemeral' });

function toolsToWire(tools: readonly ToolDef[]): WireBlock[] {
  return tools.map((t, i) => {
    const wire: WireBlock = { name: t.name, description: t.description, input_schema: t.inputSchema };
    if (i === tools.length - 1) wire['cache_control'] = EPHEMERAL;
    return wire;
  });
}

function blockToWire(b: ContentBlock): WireBlock | null {
  switch (b.type) {
    case 'text':
      return b.text.length > 0 ? { type: 'text', text: b.text } : null;
    case 'image': {
      const img = parseImageDataUrl(b.dataUrl);
      return { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } };
    }
    case 'tool_use':
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} };
    case 'tool_result':
      return { type: 'tool_result', tool_use_id: b.toolUseId, content: b.content.length > 0 ? b.content : '(empty)', ...(b.isError ? { is_error: true } : {}) };
  }
}

/** Wire messages; tool_result blocks are moved first in user turns as the API requires. */
function messagesToWire(messages: readonly ChatMessage[], replay: LruMap<WireBlock[]>): WireMessage[] {
  const out: WireMessage[] = [];
  for (const m of messages) {
    const blocks = blocksOf(m);
    if (m.role === 'assistant') {
      const raw = replay.get(contentKey(blocks));
      if (raw) {
        out.push({ role: 'assistant', content: raw });
        continue;
      }
    }
    const wire = blocks.map(blockToWire).filter((b): b is WireBlock => b !== null);
    if (m.role === 'user') wire.sort((a, b) => Number(b['type'] === 'tool_result') - Number(a['type'] === 'tool_result'));
    if (wire.length === 0) continue;
    out.push({ role: m.role, content: wire });
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Normalize a Messages API response body. Exported for tests. */
export function parseAnthropicResponse(body: unknown): { response: CompletionResponse; raw: WireBlock[] } {
  if (!isRecord(body) || !Array.isArray(body['content'])) throw new ProviderError('invalid_response', 'malformed Messages API response');
  const raw = body['content'].filter(isRecord);
  const content: ContentBlock[] = [];
  for (const b of raw) {
    if (b['type'] === 'text' && typeof b['text'] === 'string') content.push({ type: 'text', text: b['text'] });
    else if (b['type'] === 'tool_use' && typeof b['id'] === 'string' && typeof b['name'] === 'string') {
      content.push({ type: 'tool_use', id: b['id'], name: b['name'], input: b['input'] ?? {} });
    }
    // thinking / redacted_thinking and other provider-private blocks are kept in `raw` only.
  }
  const reason = body['stop_reason'];
  let stopReason: CompletionResponse['stopReason'];
  if (reason === 'tool_use') stopReason = 'tool_use';
  else if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') stopReason = 'max_tokens';
  else if (reason === 'refusal') {
    // `stop_details` is only populated for refusals: { type: 'refusal', category, explanation }.
    stopReason = 'error';
    const details = isRecord(body['stop_details']) ? body['stop_details'] : undefined;
    const category = details && typeof details['category'] === 'string' ? details['category'].slice(0, 40) : '';
    content.push({ type: 'text', text: `The model declined this request${category ? ` (${category})` : ''}.` });
  } else stopReason = 'end'; // end_turn, stop_sequence, pause_turn (server tools are never used here)
  const usage = isRecord(body['usage']) ? body['usage'] : {};
  const response: CompletionResponse = {
    content,
    stopReason,
    usage: {
      inputTokens: num(usage['input_tokens']) + num(usage['cache_creation_input_tokens']) + num(usage['cache_read_input_tokens']),
      outputTokens: num(usage['output_tokens']),
    },
  };
  if (typeof body['model'] === 'string') response.model = body['model'];
  return { response, raw };
}

function describeError(status: number, body: unknown): string {
  const err = isRecord(body) && isRecord(body['error']) ? body['error'] : undefined;
  const msg = err && typeof err['message'] === 'string' ? err['message'].slice(0, 300) : '';
  return `Anthropic API error ${status}${msg ? `: ${msg}` : ''}`;
}

/**
 * Create a provider for the Anthropic Messages API. In browser code only with
 * the visitor's own key and `browser: true` (never a site owner's key).
 */
export function createAnthropicProvider(opts: AnthropicProviderOptions): Provider {
  if (!opts.apiKey) throw new ProviderError('auth', 'Anthropic API key is missing');
  const baseUrl = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const effort = { ...DEFAULT_EFFORT, ...opts.effort };
  const replay = new LruMap<WireBlock[]>(REPLAY_CAPACITY);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-api-key': opts.apiKey, 'anthropic-version': API_VERSION };
  if (opts.browser) headers['anthropic-dangerous-direct-browser-access'] = 'true';

  return {
    name: 'anthropic',
    async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse> {
      const model = req.model ?? opts.models[req.role];
      const body: Record<string, unknown> = {
        model,
        max_tokens: Math.max(1, Math.min(MAX_OUTPUT_TOKENS, Math.floor(req.maxTokens ?? opts.defaultMaxTokens ?? 16_000))),
        system: [{ type: 'text', text: req.system, cache_control: EPHEMERAL }],
        messages: messagesToWire(req.messages, replay),
        output_config: { effort: effort[req.role] },
      };
      if (req.tools && req.tools.length > 0) body['tools'] = toolsToWire(req.tools);
      const json = await postJson({
        url: `${baseUrl}/v1/messages`,
        headers,
        body,
        fetch: doFetch,
        describeError,
        ...(signal ? { signal } : {}),
        ...(opts.retry ? { policy: opts.retry } : {}),
      });
      const { response, raw } = parseAnthropicResponse(json);
      if (raw.some((b) => b['type'] !== 'text' && b['type'] !== 'tool_use')) replay.set(contentKey(response.content), raw);
      return response;
    },
  };
}
