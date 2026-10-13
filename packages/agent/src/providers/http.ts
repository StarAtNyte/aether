/**
 * Browser → server proxy provider. POSTs the normalized `CompletionRequest`
 * to our own endpoint (which holds the API keys and maps roles to allowlisted
 * models) and validates the returned `CompletionResponse`.
 */
import type { CompletionRequest, CompletionResponse, Provider } from '../types';
import { CompletionResponseSchema } from '../wire';
import { ProviderError } from './errors';
import { postJson, type RetryPolicy } from './transport';

/** Options of {@link createHttpProvider}. */
export interface HttpProviderOptions {
  /** e.g. "/api/llm" or "https://host/api/llm". */
  endpoint: string;
  fetch?: typeof fetch;
  retry?: RetryPolicy;
  /** Extra request headers (e.g. the visitor's own key for `/api/llm/byok`); never logged. */
  headers?: Record<string, string>;
  /** Provider name reported to the agent (default 'http'). */
  name?: string;
}

function describeError(status: number, body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const e = (body as { error: unknown }).error;
    if (typeof e === 'string') return `server error ${status}: ${e.slice(0, 300)}`;
    if (typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
      return `server error ${status}: ${(e as { message: string }).message.slice(0, 300)}`;
    }
  }
  return `server error ${status}`;
}

/** Create a provider that talks to the Aether server's `/api/llm` proxy. */
export function createHttpProvider(opts: HttpProviderOptions): Provider {
  if (!opts.endpoint) throw new ProviderError('bad_request', 'endpoint is required');
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  return {
    name: opts.name ?? 'http',
    async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse> {
      // Clients never choose models: the server maps `role` to an allowlisted model.
      const body: Omit<CompletionRequest, 'model'> & { model?: string } = { ...req };
      delete body.model;
      const json = await postJson({
        url: opts.endpoint,
        headers: { ...opts.headers, 'content-type': 'application/json' },
        body,
        fetch: doFetch,
        describeError,
        policy: { maxRetries: 2, timeoutMs: 240_000, ...opts.retry },
        ...(signal ? { signal } : {}),
      });
      const parsed = CompletionResponseSchema.safeParse(json);
      if (!parsed.success) throw new ProviderError('invalid_response', 'server returned a malformed completion');
      return parsed.data as CompletionResponse;
    },
  };
}
