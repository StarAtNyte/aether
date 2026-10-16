import { describe, expect, it } from 'vitest';
import { AiConnection } from '../src/ai/connection';
import { Studio } from '../src/engine/Studio';
import { reviveEvent } from '../src/lib/chat';

function mem(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

function newStudio(): Studio {
  const ai = new AiConnection({ fetch: (async () => { throw new TypeError('offline'); }) as typeof fetch, session: mem() });
  return new Studio({ storage: mem(), safeMode: false, ai });
}

function lastEvents(studio: Studio): Array<Record<string, unknown> & { type: string }> {
  const chat = studio.store.getState().chat;
  const entry = chat[chat.length - 1];
  return entry?.role === 'assistant' ? (entry.events as Array<Record<string, unknown> & { type: string }>) : [];
}

describe('offline mode is honest in the studio (D1, D2, D11)', () => {
  it('a prompt it does not understand builds nothing, says so, offers examples and the connect action', async () => {
    const studio = newStudio();
    const before = studio.history.current;
    await studio.send('what is the capital of France?');
    expect(studio.history.current).toBe(before);
    const events = lastEvents(studio);
    const types = events.map((e) => e.type);
    expect(types).not.toContain('verify');
    expect(types).not.toContain('quality');
    const text = events.filter((e) => e.type === 'message').map((e) => String(e['text'])).join(' ');
    expect(text).toMatch(/did not understand/i);
    const notice = events.find((e) => e.type === 'notice' && e['offline'] !== undefined);
    expect(notice).toBeDefined();
    expect(JSON.stringify(notice)).toMatch(/examples/);
    // Revived from storage it keeps the offer.
    expect(reviveEvent(JSON.parse(JSON.stringify(notice)))).toMatchObject({ type: 'notice', offline: { examples: expect.any(Array) } });
    studio.dispose();
  }, 60_000);

  it('an offline build shows no fabricated model calls or token counts', async () => {
    const studio = newStudio();
    await studio.send('A cozy lakeside camp at sunset with a campfire, tents and fireflies');
    const done = lastEvents(studio).find((e) => e.type === 'done');
    expect(done).toMatchObject({ calls: 0, inputTokens: 0, outputTokens: 0, via: 'Offline planner' });
    studio.dispose();
  }, 60_000);
});

describe('history is locked while the agent builds (D4)', () => {
  it('undo, redo and time travel do nothing during a run', async () => {
    const studio = newStudio();
    await studio.send('A cozy lakeside camp at sunset with a campfire, tents and fireflies');
    await studio.send('make the campfire bigger');
    const afterEdit = studio.history.current;
    // Press undo and redo the instant the run starts (synchronously from the store, so timing cannot hide it).
    let pressed = 0;
    const off = studio.store.subscribe((state) => {
      if (state.agentBusy && pressed === 0) {
        pressed++;
        studio.undo();
        studio.redo();
        expect(studio.history.current).toBe(afterEdit);
      }
    });
    await studio.send('add 3 trees');
    off();
    expect(pressed).toBe(1);
    expect(studio.store.getState().agentBusy).toBe(false);
    // Idle again: undo works.
    const done = studio.history.current;
    studio.undo();
    expect(studio.history.current).not.toBe(done);
    studio.dispose();
  }, 60_000);
});

describe('a stopped build says it is partial (D12)', () => {
  it('stopping after the world changed labels the turn and keeps the world undoable', async () => {
    const studio = newStudio();
    const before = studio.history.current;
    // Stop the instant the first patches land (synchronously, so the run cannot finish first).
    const off = studio.store.subscribe(() => {
      if (studio.history.current !== before) studio.stopAgent();
    });
    await studio.send('A cozy lakeside camp at sunset with a campfire, tents and fireflies');
    off();
    expect(studio.history.current).not.toBe(before);
    const events = lastEvents(studio);
    const notes = events.filter((e) => e.type === 'notice').map((e) => String(e['text'])).join(' ');
    expect(notes).toMatch(/only the part built so far/i);
    expect(studio.store.getState().agentBusy).toBe(false);
    studio.dispose();
  }, 60_000);
});
