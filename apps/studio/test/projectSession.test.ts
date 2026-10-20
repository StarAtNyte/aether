import { afterEach, describe, expect, it, vi } from 'vitest';
import { History, deepEqual, type WorldDoc } from '@aether/core';
import { hashWorld, type Proof } from '@aether/playtest/proof';
import { PERSIST_DEBOUNCE_MS } from '../src/config';
import { createStarterWorld } from '../src/lib/starterWorld';
import type { StorageLike } from '../src/lib/storage';
import { MemoryBackend } from '../src/projects/backend';
import { MAX_PROJECT_CHARS } from '../src/projects/model';
import { ProjectRepo } from '../src/projects/repo';
import { contentKey, decodeSession, encodeSession, HISTORY_BACK, type ProjectSession } from '../src/projects/session';
import { Studio } from '../src/engine/Studio';

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

const add = (id: string) => [{ op: 'add', entity: { id, transform: { position: [0, 1, 0] } } }];

function proofFor(world: WorldDoc, status: Proof['status'] = 'passed'): Proof {
  return {
    v: 1,
    bot: 1,
    kind: 'game',
    status,
    worldHash: hashWorld(world),
    seconds: 12.5,
    steps: 750,
    summary: 'Won: collected 2 of 2',
    objectives: [{ id: 'c1', label: 'Coin', kind: 'collect', status: 'done', required: true, at: 3 }],
    issues: [],
    falls: 0,
    ms: 420,
  };
}

const verdict = { status: 'passed' as const, summary: '3 of 3 checks passed', results: [{ id: 't1', kind: 'settles', passed: true, message: 'ok' }], diagnostics: [], ms: 80 };

afterEach(() => {
  vi.useRealTimers();
});

describe('project session (undo history and verdicts kept with a project)', () => {
  it('round-trips the undo history and both verdicts for the same world', () => {
    const h = new History(createStarterWorld());
    for (let i = 0; i < 5; i++) h.commit(add(`e${i}`), `add ${i}`);
    const session = JSON.parse(JSON.stringify(encodeSession({ history: h, playtest: { proof: proofFor(h.current), sentence: 'Verified playable.', repairs: ['Slowed the wolves'] }, verify: verdict }))) as unknown;
    const back = decodeSession(session, h.current);
    expect(back.history).not.toBeNull();
    expect(deepEqual(back.history!.current, h.current)).toBe(true);
    let undos = 0;
    while (back.history!.undo()) undos++;
    expect(undos).toBe(5);
    expect(back.playtest?.proof.status).toBe('passed');
    expect(back.playtest?.repairs).toEqual(['Slowed the wolves']);
    expect(back.verify).toEqual(verdict);
  });

  it('drops a history or verdict that does not describe the saved world', () => {
    const h = new History(createStarterWorld());
    h.commit(add('a'), 'a');
    const session = encodeSession({ history: h, playtest: { proof: proofFor(h.current), sentence: '', repairs: [] }, verify: verdict });
    const other = { ...h.current, entities: { ...h.current.entities, b: { ...h.current.entities['a']!, id: 'b' } } } as WorldDoc;
    const back = decodeSession(session, other);
    expect(back).toEqual({ history: null, playtest: null, verify: null });
    // A proof made for other gameplay is never saved in the first place.
    const stale = encodeSession({ history: h, playtest: { proof: proofFor(createStarterWorld()), sentence: '', repairs: [] }, verify: null });
    expect(stale?.playtest).toBeUndefined();
  });

  it('treats stored data as untrusted', () => {
    const w = createStarterWorld();
    for (const bad of [null, 1, 'x', { v: 2 }, { v: 1, verify: { key: 'nothex', status: 'passed' } }, { v: 1, history: { format: 'aether-history' } }, { v: 1, playtest: { proof: { v: 1 }, sentence: '', repairs: [] } }]) {
      expect(decodeSession(bad, w)).toEqual({ history: null, playtest: null, verify: null });
    }
    // A history whose replay fails is dropped, the rest kept.
    const h = new History(w);
    h.commit(add('a'), 'a');
    const s = JSON.parse(JSON.stringify(encodeSession({ history: h, playtest: null, verify: verdict }))) as { history: { entries: Array<{ patches: unknown[] }> } };
    s.history.entries[1]!.patches = [{ op: 'remove', id: 'ghost' }];
    const back = decodeSession(s, h.current);
    expect(back.history).toBeNull();
    expect(back.verify?.status).toBe('passed');
  });

  it('caps the history: at most the recent undo steps, fewer when the size limit asks, none when nothing fits', () => {
    const h = new History(createStarterWorld(), { maxEntries: 500 });
    h.commit(add('sign'), 'add a sign');
    // Edits whose patches outweigh the world snapshot: renaming one sign over and over.
    for (let i = 0; i < HISTORY_BACK + 30; i++) h.commit([{ op: 'update', id: 'sign', set: { name: `${'Welcome to the valley '.repeat(12)}${i}` } }], `rename ${i}`);
    const full = decodeSession(encodeSession({ history: h, playtest: null, verify: null }), h.current).history!;
    let undos = 0;
    while (full.undo()) undos++;
    expect(undos).toBe(HISTORY_BACK);
    const plain = JSON.stringify(encodeSession({ history: h, playtest: null, verify: null })).length;
    const small = encodeSession({ history: h, playtest: null, verify: null }, Math.floor(plain * 0.8))!;
    expect(JSON.stringify(small).length).toBeLessThanOrEqual(Math.floor(plain * 0.8));
    const smallBack = decodeSession(small, h.current).history!;
    undos = 0;
    while (smallBack.undo()) undos++;
    expect(undos).toBeGreaterThan(0);
    expect(undos).toBeLessThan(HISTORY_BACK);
    // Below the size of one world snapshot, the verdicts still go but the history does not.
    const tiny = encodeSession({ history: h, playtest: null, verify: verdict }, 2_000)!;
    expect(tiny.history).toBeUndefined();
    expect(tiny.verify?.key).toBe(contentKey(h.current));
  });

  it('is stored with the project only while the record fits, and comes back on open', async () => {
    const repo = new ProjectRepo(new MemoryBackend());
    const w = createStarterWorld();
    const created = await repo.create({ world: w });
    expect(created.ok).toBe(true);
    const id = created.ok ? created.value.id : '';
    const session: ProjectSession = { v: 1, verify: { key: contentKey(w), ...verdict } };
    expect((await repo.save(id, w, [], session)).ok).toBe(true);
    const opened = await repo.open(id);
    expect(opened.ok && opened.value.session).toEqual(session);
    // A session that would push the record over the limit is left out; the world and chat still save.
    const huge = { v: 1, history: 'x'.repeat(MAX_PROJECT_CHARS) };
    expect((await repo.save(id, w, [], huge)).ok).toBe(true);
    const again = await repo.open(id);
    expect(again.ok && again.value.session).toBeNull();
    repo.dispose();
  });
});

describe('Studio keeps Undo and the verdicts across a reload', () => {
  it('saves the session with each autosave and restores undo, the checks and the bot verdict from it', async () => {
    vi.useFakeTimers();
    let saved: { world: WorldDoc; session: ProjectSession | null } | null = null;
    const studio = new Studio({ storage: memoryStorage(), safeMode: false, project: { world: createStarterWorld(), chat: [] }, onSave: async (world, _chat, session) => ((saved = { world, session }), null) });
    studio.history.commit(add('crate'), 'add a crate');
    studio.history.commit(add('barrel'), 'add a barrel');
    // The checks and the bot both passed on the head world.
    studio.store.getState().setVerify({ ...verdict, head: studio.history.head, live: null });
    studio.playtest.restore({ proof: proofFor(studio.history.current), sentence: 'Verified playable: won in 12.5 s.', repairs: [] });
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS + 10);
    expect(saved).not.toBeNull();
    const { world, session } = saved as unknown as { world: WorldDoc; session: ProjectSession | null };
    expect(session?.history).toBeDefined();
    expect(session?.verify?.status).toBe('passed');
    expect(session?.playtest).toBeDefined();
    studio.dispose();

    // "Reload": a new studio from what was stored (through JSON, like IndexedDB's structured clone).
    const reopened = new Studio({ storage: memoryStorage(), safeMode: false, project: { world: JSON.parse(JSON.stringify(world)) as WorldDoc, chat: [], session: JSON.parse(JSON.stringify(session)) as unknown }, onSave: async () => null });
    expect(reopened.history.canUndo()).toBe(true);
    const st = reopened.store.getState();
    expect(st.verify.status).toBe('passed');
    expect(st.verify.head).toBe(reopened.history.head);
    expect(st.playtest.status).toBe('passed');
    expect(st.playtest.proven).toBe(true);
    expect(reopened.playtest.verified).toBe(true);
    expect((await reopened.playtest.proof())?.worldHash).toBe(hashWorld(reopened.history.current));
    reopened.history.undo();
    expect(Object.keys(reopened.history.current.entities)).not.toContain('barrel');
    // An undo makes both verdicts describe another world: they are no longer current.
    expect(reopened.playtest.verified).toBe(false);
    reopened.dispose();
  });
});
