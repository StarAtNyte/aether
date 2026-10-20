/** A local edit says what it did once, in its card: the same sentence is not repeated as a reply under it. */
import { describe, expect, it } from 'vitest';
import { AiConnection } from '../src/ai/connection';
import { Studio } from '../src/engine/Studio';
import { assistantText } from '../src/lib/chat';

function mem(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('the reply of a local edit', () => {
  it('shows the edit card and no message that repeats it; the history still has the sentence', async () => {
    const ai = new AiConnection({ fetch: (async () => { throw new TypeError('offline'); }) as typeof fetch, session: mem() });
    const studio = new Studio({ storage: mem(), safeMode: false, ai });
    await studio.send('A cozy lakeside camp at sunset with a campfire, tents and fireflies');
    await studio.send('make the campfire logs red');
    const last = studio.store.getState().chat.at(-1);
    expect(last?.role).toBe('assistant');
    if (last?.role !== 'assistant') return;
    const card = last.events.find((e) => e.type === 'edit');
    expect(card?.type === 'edit' && card.local).toBe(true);
    const summary = card?.type === 'edit' ? card.summary.toLowerCase() : '';
    const repeats = last.events.filter((e) => (e.type === 'message' || e.type === 'plan') && e.text.toLowerCase().includes(summary));
    expect(repeats).toEqual([]);
    expect(assistantText(last).toLowerCase()).toContain(summary);
    studio.dispose();
  }, 60_000);
});
