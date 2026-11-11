/**
 * The hosted model of a Vercel deployment: `GET /api/health` reports it and `POST /api/llm` proxies the studio's
 * `CompletionRequest` to Claude with the deployment's own key (`ANTHROPIC_API_KEY`, never sent to the browser).
 *
 * The request and response schemas and the safe error mapping are the Node server's (apps/server/src/llm); the model is
 * chosen here from the request's `role` (clients cannot pick one), output is capped, and calls are rate limited per
 * client IP and per instance. Imports carry `.js` extensions and use no workspace package: a Vercel function runs as
 * plain Node ESM.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlockParam, BetaMessage, MessageCreateParamsNonStreaming as BetaMessageCreateParamsNonStreaming, BetaMessageParam, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { mapUpstreamError } from '../../apps/server/src/llm/errors.js';
import { CompletionRequestSchema, CompletionResponseSchema, type CompletionRequest, type CompletionResponse, type ContentBlock } from '../../apps/server/src/llm/schema.js';
import { RateLimiter } from './cook-upload.js';

/** The environment variable holding the deployment's Anthropic API key. */
export const KEY_ENV = 'ANTHROPIC_API_KEY';

/** Role → model allowlist (the only models this function calls). */
export const ROLE_MODELS: Readonly<Record<CompletionRequest['role'], string>> = Object.freeze({ planner: 'claude-opus-5-5', coder: 'claude-opus-5-5', critic: 'claude-opus-5-5' });
/** Effort per role (as the agent's own Anthropic provider). */
const ROLE_EFFORT: Readonly<Record<CompletionRequest['role'], 'medium' | 'high'>> = Object.freeze({ planner: 'medium', coder: 'high', critic: 'high' });

export const LLM_CAPS = Object.freeze({
  /** Request body (bytes). */
  maxBodyBytes: 2 * 1024 * 1024,
  /** Output tokens per call (non-streaming). */
  maxOutputTokens: 16_000,
  /** Calls per client IP per window. */
  perIp: 40,
  perIpWindowMs: 10 * 60_000,
  /** Calls per instance per hour (all visitors). */
  global: 1500,
  globalWindowMs: 60 * 60_000,
  /** Upstream time limit (below the function's maxDuration). */
  timeoutMs: 280_000,
});

/** The Messages API call (injected by tests). */
export type CreateMessage = (params: BetaMessageCreateParamsNonStreaming, signal: AbortSignal) => Promise<BetaMessage>;

export interface LlmDeps {
  limiter: RateLimiter;
  create: CreateMessage;
  /** Log line sink (default console.warn). */
  log?: (msg: string, fields: Record<string, unknown>) => void;
}

/** The SDK client for `key`, as a {@link CreateMessage}. */
export function anthropicCreate(key: string): CreateMessage {
  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: LLM_CAPS.timeoutMs });
  return (params, signal) => client.beta.messages.create(params, { signal });
}

function reply(status: number, body: object, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  const ip = (fwd ? fwd.split(',')[0] : req.headers.get('x-real-ip')) ?? '';
  return ip.trim().slice(0, 64) || 'unknown';
}

/** Browsers on other sites may not spend this deployment's key (non-browser clients are held by the rate limits). */
function crossSite(req: Request): boolean {
  if (req.headers.get('sec-fetch-site') === 'cross-site') return true;
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(req.url).host;
  } catch {
    return true;
  }
}

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,(.*)$/s;

function blockToWire(b: ContentBlock): BetaContentBlockParam | null {
  switch (b.type) {
    case 'text':
      return b.text.length > 0 ? { type: 'text', text: b.text } : null;
    case 'image': {
      const m = DATA_URL_RE.exec(b.dataUrl);
      if (!m) return null;
      return { type: 'image', source: { type: 'base64', media_type: m[1] as 'image/png' | 'image/jpeg' | 'image/webp', data: m[2] ?? '' } };
    }
    case 'tool_use':
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} };
    case 'tool_result':
      return { type: 'tool_result', tool_use_id: b.toolUseId, content: b.content.length > 0 ? b.content : '(empty)', ...(b.isError ? { is_error: true } : {}) };
  }
}

/** The Messages API request for a validated completion request (exported for tests). */
export function toMessagesParams(req: CompletionRequest): BetaMessageCreateParamsNonStreaming {
  const messages: BetaMessageParam[] = [];
  for (const m of req.messages) {
    const blocks: ContentBlock[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    const wire = blocks.map(blockToWire).filter((b): b is BetaContentBlockParam => b !== null);
    // tool_result blocks come first in a user turn.
    if (m.role === 'user') wire.sort((a, b) => Number(b.type === 'tool_result') - Number(a.type === 'tool_result'));
    if (wire.length > 0) messages.push({ role: m.role, content: wire });
  }
  const tools: BetaToolUnion[] | undefined = req.tools?.map((t, i, all) => ({
    name: t.name,
    description: t.description,
    input_schema: { type: 'object', ...t.inputSchema } as { type: 'object' },
    ...(i === all.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }));
  return {
    model: ROLE_MODELS[req.role],
    max_tokens: Math.max(1, Math.min(LLM_CAPS.maxOutputTokens, Math.floor(req.maxTokens ?? LLM_CAPS.maxOutputTokens))),
    system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
    messages,
    thinking: { type: 'adaptive' },
    output_config: { effort: ROLE_EFFORT[req.role] },
    // On a safety decline the API reruns the request on a fallback model it picks.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    ...(tools && tools.length > 0 ? { tools } : {}),
  };
}

/** The studio's `CompletionResponse` for a Messages API response (exported for tests). */
export function fromMessage(msg: BetaMessage): CompletionResponse {
  const content: ContentBlock[] = [];
  for (const b of msg.content) {
    if (b.type === 'text') content.push({ type: 'text', text: b.text });
    else if (b.type === 'tool_use') content.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} });
    // thinking and fallback blocks stay server side.
  }
  let stopReason: CompletionResponse['stopReason'] = 'end';
  if (msg.stop_reason === 'tool_use') stopReason = 'tool_use';
  else if (msg.stop_reason === 'max_tokens' || msg.stop_reason === 'model_context_window_exceeded') stopReason = 'max_tokens';
  else if (msg.stop_reason === 'refusal') {
    stopReason = 'error';
    const category = msg.stop_details?.category ? String(msg.stop_details.category).slice(0, 40) : '';
    content.push({ type: 'text', text: `The model declined this request${category ? ` (${category})` : ''}.` });
  }
  const u = msg.usage;
  return {
    content,
    stopReason,
    usage: { inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), outputTokens: u.output_tokens ?? 0 },
    model: msg.model,
  };
}

/** `POST /api/llm`. */
export async function handleLlm(req: Request, deps: LlmDeps): Promise<Response> {
  const log = deps.log ?? ((msg, fields) => console.warn(msg, JSON.stringify(fields)));
  if (crossSite(req)) return reply(403, { error: 'forbidden', message: 'The hosted model is only available to this site.' });

  const ip = clientIp(req);
  if (!deps.limiter.take(`ip:${ip}`, 1, LLM_CAPS.perIp, LLM_CAPS.perIpWindowMs)) {
    return reply(429, { error: 'rate-limited', message: `You have used the hosted model ${LLM_CAPS.perIp} times in 10 minutes. Please wait a few minutes, or use your own key (Settings → AI connection).` }, { 'retry-after': '120' });
  }
  if (!deps.limiter.take('global', 1, LLM_CAPS.global, LLM_CAPS.globalWindowMs)) {
    return reply(429, { error: 'rate-limited', message: 'The hosted model is busy for this hour. Please try again later, or use your own key (Settings → AI connection).' }, { 'retry-after': '600' });
  }

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > LLM_CAPS.maxBodyBytes) return reply(413, { error: 'too-large', message: 'The request is too large.' });
  const text = await req.text();
  if (Buffer.byteLength(text) > LLM_CAPS.maxBodyBytes) return reply(413, { error: 'too-large', message: 'The request is too large.' });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return reply(400, { error: 'bad-json', message: 'The request body is not valid JSON.' });
  }
  const parsed = CompletionRequestSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join('.').slice(0, 200), message: i.message.slice(0, 300) }));
    log('invalid completion request', { issues: issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`).join(' | ') });
    return reply(400, { error: 'invalid-request', message: 'The completion request is invalid.', issues });
  }

  const params = toMessagesParams(parsed.data);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, LLM_CAPS.timeoutMs);
  const onClientAbort = (): void => controller.abort();
  req.signal.addEventListener('abort', onClientAbort, { once: true });
  const started = Date.now();
  let msg: BetaMessage;
  try {
    msg = await deps.create(params, controller.signal);
  } catch (err) {
    if (req.signal.aborted && !timedOut) return reply(408, { error: 'request-aborted', message: 'The request was cancelled.' });
    const safe = mapUpstreamError(err, timedOut || err instanceof Anthropic.APIConnectionTimeoutError);
    log('llm upstream failure', { role: parsed.data.role, code: safe.code, upstreamStatus: safe.upstreamStatus, errorName: err instanceof Error ? err.name : typeof err });
    return reply(safe.status, { error: safe.code, message: safe.message }, safe.code === 'upstream-rate-limited' ? { 'retry-after': '10' } : {});
  } finally {
    clearTimeout(timer);
    req.signal.removeEventListener('abort', onClientAbort);
  }

  const out = CompletionResponseSchema.safeParse(fromMessage(msg));
  if (!out.success) {
    log('llm upstream invalid response', { role: parsed.data.role });
    return reply(502, { error: 'upstream-invalid-response', message: 'The language model returned an unexpected response.' });
  }
  console.info('llm completion', JSON.stringify({ role: parsed.data.role, model: msg.model, tokens: (out.data.usage?.inputTokens ?? 0) + (out.data.usage?.outputTokens ?? 0), ms: Date.now() - started, stop: out.data.stopReason }));
  return reply(200, out.data);
}

export { RateLimiter };
