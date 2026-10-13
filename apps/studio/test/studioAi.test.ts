import { describe, expect, it } from 'vitest';
import { AiConnection } from '../src/ai/connection';
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
    expect(notice?.type === 'notice' && notice.text).toContain('npm run bridge');
    const done = entry.events[entry.events.length - 1];
    expect(done?.type === 'done' && done.via).toBe('Offline planner');
    expect(Object.keys(studio.history.current.entities).length).toBeGreaterThan(5);
    studio.dispose();
  }, 60_000);
});
