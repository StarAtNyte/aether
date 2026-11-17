/**
 * One question to the site's model: POST `/api/llm` (same origin) with the guide's request ({@link requestBody}), the reply's
 * text blocks joined. Null on any failure (no server on a static host, an error, the time limit, offline): the caller answers
 * with the keyword match instead. A 404 or 405 means there is no model on this host: later questions skip the call.
 */
import { API } from '../../config';
import type { requestBody } from './brain';

/** Longest wait for an answer (ms). */
export const ASK_TIMEOUT_MS = 25_000;

let noModel = false;

/** The model's text, or null. */
export async function askModel(body: ReturnType<typeof requestBody>, opts: { timeoutMs?: number; fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<string | null> {
  if (noModel || body.messages.length === 0) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? ASK_TIMEOUT_MS);
  const onAbort = (): void => ac.abort();
  opts.signal?.addEventListener('abort', onAbort);
  try {
    const res = await (opts.fetch ?? fetch)(API.llm, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (res.status === 404 || res.status === 405 || res.status === 501) noModel = true;
    if (!res.ok) return null;
    // A static host answers an unknown path with its page.
    if (!(res.headers.get('content-type') ?? '').includes('json')) {
      noModel = true;
      return null;
    }
    const json = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = (json.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('')
      .trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** Tests: forget a host without a model. */
export function resetAsk(): void {
  noModel = false;
}
