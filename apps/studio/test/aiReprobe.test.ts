/**
 * A status read while the local server was restarting is stale: the next prompt looks again before settling for
 * the offline planner (acceptance: after a server restart the open studio built offline with "local AI is not
 * available" while Codex was ready).
 */
import { describe, expect, it } from 'vitest';
import { AiConnection } from '../src/ai/connection';
import { Studio } from '../src/engine/Studio';

function mem(init: Record<string, string> = {}): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  const m = new Map<string, string>(Object.entries(init));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const STATUS = {
  ok: true,
  name: 'aether-local',
  version: '1',
  backends: [
    { id: 'codex', label: 'Codex', installed: true, loggedIn: true, detail: 'Logged in using ChatGPT', models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', vision: true }], defaultModel: 'gpt-6.1-sol', busy: 0 },
    { id: 'claude-code', label: 'Claude Code', installed: false, loggedIn: false, detail: 'not found', models: [], busy: 0 },
  ],
  account: null,
  jobs: 0,
  login: null,
};

describe('a restarted local server is used again', () => {
  it('re-probes before falling back when the last status read failed', async () => {
    let up = false;
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (!up) throw new TypeError('fetch failed');
      if (url.endsWith('/api/health')) return json({ ok: true, mode: 'mock', providers: [], byok: false, local: true });
      if (url.endsWith('/api/local/status')) return json(STATUS);
      // The model call itself: refused, so the turn falls back with a notice (what matters is that it was tried).
      if (url.endsWith('/api/local/complete')) return json({ error: { code: 'unavailable', message: 'busy' } }, 503);
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const ai = new AiConnection({ fetch: fetchImpl, session: mem() });
    await ai.refresh();
    expect(ai.store.getState().server.state).toBe('offline');
    up = true;
    const studio = new Studio({ storage: mem({ 'aether.ai.prefs.v1': JSON.stringify({ mode: 'local', backend: 'codex' }) }), safeMode: false, ai });
    await studio.send('a campfire');
    const chat = studio.store.getState().chat;
    const events = chat[chat.length - 1]?.role === 'assistant' ? (chat[chat.length - 1] as { events: Array<{ type: string; text?: string }> }).events : [];
    expect(events.some((e) => e.type === 'notice' && /is unavailable \(/.test(e.text ?? ''))).toBe(false);
    expect(urls.some((u) => u.endsWith('/api/local/complete'))).toBe(true);
    studio.dispose();
  }, 60_000);
});
