/**
 * `POST /api/llm/byok` — optional bring-your-own-key passthrough.
 *
 * A visitor who wants a paid API model supplies their OWN key; it travels
 * in a request header (kept in the browser's sessionStorage only), is used
 * for exactly this one upstream call and is never stored, cached, logged or
 * echoed. The owner's keys are never used here and no daily budget is spent.
 * Models are the server's allowlisted role models for that provider.
 */
import type { Hono } from 'hono';
import { createAnthropicProvider, createOpenAIProvider } from '@aether/agent';
import type { AppEnv } from '../app-env';
import type { RoleModels } from '../config';
import { fail, readJsonBody, zodToIssues } from '../http';
import { mapUpstreamError } from '../llm/errors';
import { CompletionRequestSchema, CompletionResponseSchema, LLM_LIMITS, type CompletionRequest } from '../llm/schema';
import type { Logger } from '../logger';

/** Accepted key shape: printable token characters only (no whitespace, no header injection). */
export const BYOK_KEY_RE = /^[A-Za-z0-9_.-]{20,300}$/;

/** Dependencies of the BYOK route. */
export interface ByokRouteDeps {
  enabled: boolean;
  models: { anthropic: RoleModels; openai: RoleModels };
  timeoutMs: number;
  maxOutputTokens: number;
  logger: Logger;
  /** Upstream fetch (tests inject a fake). */
  fetch?: typeof fetch;
  shutdownSignal?: AbortSignal;
}

/** Register `POST /api/llm/byok`. */
export function registerByokRoutes(app: Hono<AppEnv>, deps: ByokRouteDeps): void {
  app.post('/api/llm/byok', async (c) => {
    if (!deps.enabled) return fail(c, 404, 'not-found', 'Bring-your-own-key is disabled on this server.');
    const provider = c.req.header('x-aether-provider');
    const key = c.req.header('x-aether-key');
    if (provider !== 'anthropic' && provider !== 'openai') return fail(c, 400, 'invalid-provider', 'Header X-Aether-Provider must be "anthropic" or "openai".');
    if (typeof key !== 'string' || !BYOK_KEY_RE.test(key)) return fail(c, 400, 'invalid-key', 'Header X-Aether-Key must contain your API key.');

    const body = await readJsonBody(c, { maxStringLength: LLM_LIMITS.MAX_IMAGE_DATA_URL + 64, maxNodes: 200_000, maxDepth: 64 });
    if (!body.ok) return body.response;
    const parsed = CompletionRequestSchema.safeParse(body.value);
    if (!parsed.success) return fail(c, 400, 'invalid-request', 'The completion request is invalid.', zodToIssues(parsed.error.issues));

    const models = deps.models[provider];
    const model = models[parsed.data.role];
    const upstreamReq: CompletionRequest = { ...parsed.data, model, maxTokens: Math.min(parsed.data.maxTokens ?? deps.maxOutputTokens, deps.maxOutputTokens) };
    const opts = { apiKey: key, models: { ...models }, retry: { maxRetries: 1, timeoutMs: deps.timeoutMs }, ...(deps.fetch ? { fetch: deps.fetch } : {}) };
    const upstream = provider === 'anthropic' ? createAnthropicProvider(opts) : createOpenAIProvider(opts);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, deps.timeoutMs);
    const onAbort = (): void => controller.abort();
    c.req.raw.signal.addEventListener('abort', onAbort, { once: true });
    deps.shutdownSignal?.addEventListener('abort', onAbort, { once: true });
    let raw: unknown;
    try {
      raw = await upstream.complete(upstreamReq, controller.signal);
    } catch (err) {
      if (c.req.raw.signal.aborted && !timedOut) return fail(c, 408, 'request-aborted', 'The request was cancelled.');
      const safe = mapUpstreamError(err, timedOut);
      // Never log the error text: vendor messages can quote the key.
      deps.logger.warn('byok upstream failure', { reqId: c.get('requestId'), provider, code: safe.code, upstreamStatus: safe.upstreamStatus });
      const message = safe.code === 'upstream-auth' ? 'The provider rejected your API key.' : safe.message;
      if (safe.code === 'upstream-rate-limited') c.header('Retry-After', '10');
      return fail(c, safe.status, safe.code, message);
    } finally {
      clearTimeout(timer);
      c.req.raw.signal.removeEventListener('abort', onAbort);
      deps.shutdownSignal?.removeEventListener('abort', onAbort);
    }
    const response = CompletionResponseSchema.safeParse(raw);
    if (!response.success) return fail(c, 502, 'upstream-invalid-response', 'The language model returned an unexpected response.');
    deps.logger.info('byok completion', { reqId: c.get('requestId'), provider, role: parsed.data.role, model, stopReason: response.data.stopReason });
    return c.json({ ...response.data, model }, 200);
  });
}
