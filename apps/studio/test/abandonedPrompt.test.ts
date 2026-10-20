import { describe, expect, it } from 'vitest';
import { AiConnection } from '../src/ai/connection';
import { Studio } from '../src/engine/Studio';
import { createEmptyWorld, abandonedPromptReply, createFromPrompt } from '../src/projects/create';
import { MemoryBackend } from '../src/projects/backend';
import { ProjectRepo } from '../src/projects/repo';
import { takeRun } from '../src/projects/pending';

function mem(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

/** A project studio with no AI reachable (the offline planner answers). */
function offlineStudio(): Studio {
  const ai = new AiConnection({ fetch: (async () => { throw new TypeError('offline'); }) as typeof fetch, session: mem() });
  return new Studio({ storage: mem(), safeMode: false, ai, project: { world: createEmptyWorld('Construye un bosque'), chat: [] }, onSave: async () => null });
}

describe('a prompt project the offline planner could not build is not kept', () => {
  it('queues the prompt of a project made for it as fresh', async () => {
    const repo = new ProjectRepo(new MemoryBackend());
    const r = await createFromPrompt(repo, 'Construye un bosque de noche con lobos');
    expect(r.ok).toBe(true);
    expect(takeRun(r.ok ? r.value.id : '')).toMatchObject({ fresh: true, offline: false });
    repo.dispose();
  });

  it('recognises a non-English prompt answered offline with nothing built', async () => {
    const studio = offlineStudio();
    await studio.send('Construye un bosque de noche con lobos y una linterna', { intent: 'new' });
    const reply = abandonedPromptReply(studio.store.getState().chat, studio.history);
    expect(reply).toMatch(/only reads English/);
    studio.dispose();
  }, 60_000);

  it('keeps the project when anything was built, or after a second exchange', async () => {
    const built = offlineStudio();
    await built.send('a night forest with wolves and lanterns', { intent: 'new' });
    expect(built.history.canUndo()).toBe(true);
    expect(abandonedPromptReply(built.store.getState().chat, built.history)).toBeNull();
    built.dispose();

    const twice = offlineStudio();
    await twice.send('Construye un bosque de noche con lobos', { intent: 'new' });
    await twice.send('Haz una casa con piscina y jardín', { intent: 'new' });
    expect(abandonedPromptReply(twice.store.getState().chat, twice.history)).toBeNull();
    twice.dispose();
  }, 120_000);
});
