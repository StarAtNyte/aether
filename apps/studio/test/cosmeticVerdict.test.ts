/** A colour edit keeps the physics checks current: "Checks outdated" after "make the sofa dark green" was noise. */
import { describe, expect, it } from 'vitest';
import { AiConnection } from '../src/ai/connection';
import { Studio } from '../src/engine/Studio';

function mem(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('checks after a cosmetic edit', () => {
  it('a colour change keeps the verdict, which still describes the world', async () => {
    const ai = new AiConnection({ fetch: (async () => { throw new TypeError('offline'); }) as typeof fetch, session: mem() });
    const studio = new Studio({ storage: mem(), safeMode: false, ai });
    await studio.send('A cozy lakeside camp at sunset with a campfire, tents and fireflies');
    const st = studio.store.getState();
    st.setVerify({ status: 'passed', summary: 'ok', results: [], diagnostics: [], head: studio.history.head, ms: 1 });
    const before = studio.history.head;
    await studio.send('make the campfire logs red');
    expect(studio.history.head).toBeGreaterThan(before);
    expect(studio.store.getState().verify.head).toBe(studio.history.head);
    studio.dispose();
  }, 60_000);
});
