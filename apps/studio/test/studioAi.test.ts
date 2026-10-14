import { describe, expect, it, vi } from 'vitest';
import { COMPACT_EXAMPLE, type WebLlmEngineLike } from '@aether/agent';
import { AiConnection } from '../src/ai/connection';
import { WEBLLM_MODELS } from '../src/ai/prefs';
import type { SessionStore } from '../src/ai/session';
import { Studio } from '../src/engine/Studio';
import type { StorageLike } from '../src/lib/storage';

function mem(): StorageLike & SessionStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('Studio.send with an unreachable bridge', () => {
  it('falls back to the offline planner with a visible notice, builds and reviews the world', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const ai = new AiConnection({ fetch: failing, session: mem() });
    ai.adoptPairing({ url: 'http://127.0.0.1:8790', token: 'T'.repeat(43) });
    const studio = new Studio({ storage: mem(), safeMode: false, ai });
    studio.store.getState().setAiPrefs({ mode: 'bridge', refine: 1 });
    await studio.send('a cozy village by a lake at sunset');
    const st = studio.store.getState();
    expect(st.agentBusy).toBe(false);
    expect(st.agentRun).toBeNull();
    const entry = st.chat[st.chat.length - 1];
    expect(entry?.role).toBe('assistant');
    if (entry?.role !== 'assistant') return;
    expect(entry.status).toBe('done');
    const types = entry.events.map((e) => e.type);
    expect(types).toContain('notice');
    expect(types).toContain('patches');
    expect(types).toContain('quality');
    const notice = entry.events.find((e) => e.type === 'notice');
    expect(notice?.type === 'notice' && notice.text).toContain('npx aether start');
    const done = entry.events[entry.events.length - 1];
    expect(done?.type === 'done' && done.via).toBe('Offline planner');
    expect(Object.keys(studio.history.current.entities).length).toBeGreaterThan(5);
    studio.dispose();
  }, 60_000);

  // Regression: after a fallback the badge kept saying "Codex · …" (live) and every later prompt
  // retried the dead bridge first, waiting for it again before falling back.
  it('re-probes the bridge after a fallback so the next prompt goes straight to the offline planner', async () => {
    const calls: string[] = [];
    const failing = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const ai = new AiConnection({ fetch: failing, session: mem() });
    ai.adoptPairing({ url: 'http://127.0.0.1:8790', token: 'T'.repeat(43) });
    const studio = new Studio({ storage: mem(), safeMode: false, ai });
    studio.store.getState().setAiPrefs({ mode: 'bridge', refine: 0 });
    expect(ai.resolve(studio.store.getState().aiPrefs).ready).toBe(true);
    await studio.send('a small forest camp');
    await vi.waitFor(() => expect(ai.store.getState().bridge.state).toBe('offline'));
    expect(calls.some((u) => u.endsWith('/v1/status'))).toBe(true);
    const resolved = ai.resolve(studio.store.getState().aiPrefs);
    expect(resolved.ready).toBe(false);
    expect(resolved.reason).toContain('npx aether start');
    calls.length = 0;
    await studio.send('add a campfire');
    expect(calls.filter((u) => u.endsWith('/v1/complete'))).toEqual([]);
    const entry = studio.store.getState().chat.at(-1);
    expect(entry?.role === 'assistant' && entry.status).toBe('done');
    studio.dispose();
  }, 60_000);

  // Regression: on-device models have a 4096-token context but were sent the ~15k-token full
  // prompt, so every on-device turn silently fell back to the offline planner.
  it('runs an on-device turn with the compact prompt, within the model context', async () => {
    const seen: Array<{ system: number; total: number; maxTokens: number }> = [];
    const engine: WebLlmEngineLike = {
      chat: {
        completions: {
          create: async (req) => {
            const system = req.messages[0]?.content ?? '';
            const user = req.messages[1]?.content ?? '';
            seen.push({ system: system.length, total: system.length + user.length, maxTokens: req.max_tokens ?? 0 });
            const call = user.includes('<tool_result') ? { name: 'finish', input: { message: 'Campfire clearing.' } } : { name: 'apply_patches', input: { patches: COMPACT_EXAMPLE.patches, message: COMPACT_EXAMPLE.message } };
            return { choices: [{ message: { content: JSON.stringify({ tool_calls: [call] }) } }] };
          },
        },
      },
    };
    const model = WEBLLM_MODELS[0].id;
    const ai = new AiConnection({ session: mem(), fetch: (async () => new Response('{}', { status: 404 })) as typeof fetch, webGpu: async () => ({ ok: true, reason: '' }), loadEngine: async () => engine });
    await ai.loadWebLlm(model);
    const studio = new Studio({ storage: mem(), safeMode: false, ai });
    studio.store.getState().setAiPrefs({ mode: 'webllm', webllmModel: model, refine: 0 });
    await studio.send('a campfire in a pine forest at sunset');
    const entry = studio.store.getState().chat.at(-1);
    expect(entry?.role === 'assistant' && entry.events.filter((e) => e.type === 'notice')).toEqual([]);
    const done = entry?.role === 'assistant' ? entry.events.at(-1) : undefined;
    expect(done?.type === 'done' && done.via).toContain('On-device');
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const s of seen) {
      expect(s.system).toBeLessThan(6_000);
      expect(Math.ceil(s.total / 3) + s.maxTokens).toBeLessThanOrEqual(4096);
    }
    expect(studio.history.current.entities['campfire']).toBeDefined();
    studio.dispose();
  }, 60_000);
});
