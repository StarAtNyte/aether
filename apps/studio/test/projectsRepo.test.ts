import { describe, expect, it, vi } from 'vitest';
import type { WorldDoc } from '@aether/core';
import { STORAGE_KEYS } from '../src/config';
import type { ChatEntry } from '../src/lib/chat';
import { createStarterWorld } from '../src/lib/starterWorld';
import type { StorageLike } from '../src/lib/storage';
import { exportWorld } from '../src/lib/worldIO';
import { MemoryBackend } from '../src/projects/backend';
import { createBlankProject, createEmptyWorld, createFromPrompt, createFromTemplate, projectNameFromPrompt } from '../src/projects/create';
import { migrateLegacyWorld, MIGRATION_KEY } from '../src/projects/migrate';
import { cleanProjectName, MAX_PROJECT_NAME, MAX_PROJECTS, MAX_THUMBNAIL_BYTES, newProjectId, parseProjectMeta, PROJECTS_SCHEMA_VERSION } from '../src/projects/model';
import { queueRun, takeRun } from '../src/projects/pending';
import { ProjectRepo, storageErrorMessage } from '../src/projects/repo';

function repoWith(backend = new MemoryBackend()): { repo: ProjectRepo; backend: MemoryBackend; clock: { t: number } } {
  const clock = { t: 1_000 };
  let n = 0;
  const repo = new ProjectRepo(backend, () => clock.t, () => `proj${String(++n).padStart(8, '0')}`);
  return { repo, backend, clock };
}

function memStorage(init: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(init));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

const chat: ChatEntry[] = [
  { id: 1, role: 'user', text: 'make a camp' },
  { id: 2, role: 'assistant', events: [{ type: 'message', text: 'Done.' }], status: 'done' },
];

describe('project model', () => {
  it('generates 12-char base36 ids from the CSPRNG', () => {
    const id = newProjectId();
    expect(id).toMatch(/^[a-z0-9]{12}$/);
    expect(newProjectId((b) => b.fill(35))).toBe('z'.repeat(12));
    expect(new Set(Array.from({ length: 50 }, () => newProjectId())).size).toBe(50);
  });
  it('cleans names: control characters, whitespace, length', () => {
    expect(cleanProjectName('  My\u0000  world\n ')).toBe('My world');
    expect(cleanProjectName('x'.repeat(200))).toHaveLength(MAX_PROJECT_NAME);
    expect(cleanProjectName(undefined as unknown as string)).toBe('');
  });
  it('rejects malformed metadata records', () => {
    const ok = { v: PROJECTS_SCHEMA_VERSION, id: 'abcdefgh1234', name: 'A', createdAt: 1, updatedAt: 2, openedAt: 3, template: null, entityCount: 2, hasThumbnail: false };
    expect(parseProjectMeta(ok)).toEqual(ok);
    for (const bad of [null, 'x', { ...ok, id: '../x' }, { ...ok, name: '' }, { ...ok, v: 99 }, { ...ok, template: 'Bad Slug' }, { ...ok, entityCount: -1 }, { ...ok, createdAt: Number.NaN }, { ...ok, __proto__: { polluted: true }, id: 'A' }]) {
      expect(parseProjectMeta(bad)).toBeNull();
    }
  });
});

describe('ProjectRepo', () => {
  it('creates, lists (newest first), opens and saves projects', async () => {
    const { repo, clock } = repoWith();
    const a = await repo.create({ world: createStarterWorld(), chat });
    clock.t = 2_000;
    const b = await repo.create({ world: createEmptyWorld('Second') });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect((await repo.list()).map((p) => p.id)).toEqual([b.value.id, a.value.id]);
    clock.t = 3_000;
    const opened = await repo.open(a.value.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.chat).toHaveLength(2);
    expect(opened.value.meta.openedAt).toBe(3_000);
    const world: WorldDoc = { ...opened.value.world, name: 'Renamed by agent' };
    clock.t = 4_000;
    const saved = await repo.save(a.value.id, world, []);
    expect(saved.ok && saved.value).toMatchObject({ name: 'Renamed by agent', updatedAt: 4_000, entityCount: Object.keys(world.entities).length });
    expect((await repo.list())[0]?.id).toBe(a.value.id);
  });

  it('validates stored worlds on open (damaged data is reported, not loaded)', async () => {
    const { repo, backend } = repoWith();
    const r = await repo.create({ world: createEmptyWorld() });
    if (!r.ok) throw new Error('create failed');
    await backend.put(r.value, { id: r.value.id, world: { entities: { 'Bad Id!': {} } }, chat: 'nonsense' });
    const opened = await repo.open(r.value.id);
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.error).toMatch(/damaged/);
    // A stored world carrying a prototype-pollution payload (own "__proto__" key, as JSON.parse makes it).
    await backend.put(r.value, { id: r.value.id, world: JSON.parse('{"name":"x","__proto__":{"evil":1}}') as unknown, chat: [] });
    expect((await repo.open(r.value.id)).ok).toBe(false);
    expect((await repo.open('doesnotexist1')).ok).toBe(false);
  });

  it('skips invalid metadata records in the list', async () => {
    const { repo, backend } = repoWith();
    await repo.create({ world: createEmptyWorld() });
    await backend.put({ v: 1, id: 'BAD', name: '' } as never);
    expect(await repo.list()).toHaveLength(1);
  });

  it('renames (project and world), duplicates with the thumbnail', async () => {
    const { repo } = repoWith();
    const r = await repo.create({ world: createEmptyWorld('Camp') });
    if (!r.ok) throw new Error('create failed');
    const thumb = new Blob([new Uint8Array(100)], { type: 'image/webp' });
    expect((await repo.setThumbnail(r.value.id, thumb)).ok).toBe(true);
    const renamed = await repo.rename(r.value.id, '  Lake   camp ');
    expect(renamed.ok && renamed.value.name).toBe('Lake camp');
    const opened = await repo.open(r.value.id);
    expect(opened.ok && opened.value.world.name).toBe('Lake camp');
    expect((await repo.rename(r.value.id, '   ')).ok).toBe(false);
    const dup = await repo.duplicate(r.value.id);
    expect(dup.ok && dup.value).toMatchObject({ name: 'Lake camp copy', hasThumbnail: true });
    if (dup.ok) expect((await repo.thumbnail(dup.value.id))?.size).toBe(100);
  });

  it('deletes and restores (undo), including data and thumbnail', async () => {
    const { repo } = repoWith();
    const r = await repo.create({ world: createStarterWorld(), chat });
    if (!r.ok) throw new Error('create failed');
    await repo.setThumbnail(r.value.id, new Blob([new Uint8Array(10)], { type: 'image/jpeg' }));
    const del = await repo.remove(r.value.id);
    expect(del.ok).toBe(true);
    expect(await repo.list()).toHaveLength(0);
    expect(await repo.thumbnail(r.value.id)).toBeNull();
    if (!del.ok) return;
    expect((await repo.restore(del.value)).ok).toBe(true);
    const back = await repo.open(r.value.id);
    expect(back.ok && back.value.chat).toHaveLength(2);
    expect((await repo.thumbnail(r.value.id))?.size).toBe(10);
    expect((await repo.remove('missing00000')).ok).toBe(false);
  });

  it('enforces thumbnail size and type limits', async () => {
    const { repo } = repoWith();
    const r = await repo.create({ world: createEmptyWorld() });
    if (!r.ok) throw new Error('create failed');
    expect((await repo.setThumbnail(r.value.id, new Blob([new Uint8Array(MAX_THUMBNAIL_BYTES + 1)], { type: 'image/webp' }))).ok).toBe(false);
    expect((await repo.setThumbnail(r.value.id, new Blob(['<svg/>'], { type: 'image/svg+xml' }))).ok).toBe(false);
    expect((await repo.setThumbnail(r.value.id, new Blob([], { type: 'image/png' }))).ok).toBe(false);
  });

  it('exports and imports (round trip), rejecting invalid files', async () => {
    const { repo } = repoWith();
    const r = await repo.create({ world: createStarterWorld() });
    if (!r.ok) throw new Error('create failed');
    const exp = await repo.exportText(r.value.id);
    expect(exp.ok).toBe(true);
    if (!exp.ok) return;
    const imported = await repo.importText(exp.value.text);
    expect(imported.ok && imported.value.entityCount).toBe(r.value.entityCount);
    expect((await repo.importText('{"not":"a world"')).ok).toBe(false);
    expect((await repo.importText('{"__proto__":{"x":1}}')).ok).toBe(false);
    expect((await repo.importText(exportWorld(createStarterWorld()))).ok).toBe(true);
  });

  it('reports quota errors with advice and caps the project count', async () => {
    const backend = new MemoryBackend();
    const { repo } = repoWith(backend);
    backend.failNextPut = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    const r = await repo.create({ world: createEmptyWorld() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/storage is full/i);
    expect(storageErrorMessage(new Error('boom'))).toMatch(/boom/);
    const big = repoWith();
    for (let i = 0; i < MAX_PROJECTS; i++) await big.repo.create({ world: createEmptyWorld() });
    const over = await big.repo.create({ world: createEmptyWorld() });
    expect(over.ok).toBe(false);
  });

  it('notifies subscribers on changes', async () => {
    const { repo } = repoWith();
    const fn = vi.fn();
    const off = repo.subscribe(fn);
    const r = await repo.create({ world: createEmptyWorld() });
    if (r.ok) await repo.rename(r.value.id, 'X');
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    await repo.create({ world: createEmptyWorld() });
    expect(fn).toHaveBeenCalledTimes(2);
    repo.dispose();
  });
});

describe('project creation flows', () => {
  it('creates empty and starter scenes', async () => {
    const { repo } = repoWith();
    const empty = await createBlankProject(repo, 'empty');
    const starter = await createBlankProject(repo, 'starter');
    expect(empty.ok && empty.value.entityCount).toBe(0);
    expect(starter.ok && starter.value.entityCount).toBeGreaterThan(0);
  });
  it('creates from a template with a queued offline run', async () => {
    const { repo } = repoWith();
    const r = await createFromTemplate(repo, 'coin-island');
    expect(r.ok && r.value).toMatchObject({ name: 'Coin island', template: 'coin-island' });
    if (r.ok) expect(takeRun(r.value.id)).toMatchObject({ offline: true });
    expect((await createFromTemplate(repo, 'nope')).ok).toBe(false);
  });
  it('creates from a prompt with a queued live run and a short name', async () => {
    const { repo } = repoWith();
    const r = await createFromPrompt(repo, 'Build a lighthouse on a stormy cliff with crashing waves');
    expect(r.ok && r.value.name).toBe('Lighthouse on a stormy cliff');
    if (r.ok) expect(takeRun(r.value.id)).toEqual({ prompt: 'Build a lighthouse on a stormy cliff with crashing waves', offline: false });
    expect((await createFromPrompt(repo, '   ')).ok).toBe(false);
    expect(projectNameFromPrompt('!!!')).toBe('Untitled world');
  });
  it('hands queued runs over once and bounds the queue', () => {
    for (let i = 0; i < 20; i++) queueRun(`p${i}`, { prompt: 'x'.repeat(5000), offline: true });
    expect(takeRun('p0')).toBeNull();
    const last = takeRun('p19');
    expect(last?.prompt).toHaveLength(4000);
    expect(takeRun('p19')).toBeNull();
  });
});

describe('legacy migration', () => {
  it('moves the saved world and chat into one project, once', async () => {
    const storage = memStorage({ [STORAGE_KEYS.world]: JSON.stringify(createStarterWorld()), [STORAGE_KEYS.chat]: JSON.stringify(chat) });
    const { repo } = repoWith();
    const m = await migrateLegacyWorld(storage, repo);
    expect(m?.entityCount).toBeGreaterThan(0);
    expect(await migrateLegacyWorld(storage, repo)).toBeNull();
    expect(await repo.list()).toHaveLength(1);
    const opened = m ? await repo.open(m.id) : null;
    expect(opened?.ok && opened.value.chat).toHaveLength(2);
    expect(storage.map.has(STORAGE_KEYS.world)).toBe(true);
  });
  it('marks invalid or absent legacy worlds as migrated without creating projects', async () => {
    const { repo } = repoWith();
    const s1 = memStorage({ [STORAGE_KEYS.world]: '{"entities":{"Bad Id":{}}}' });
    expect(await migrateLegacyWorld(s1, repo)).toBeNull();
    expect(s1.map.get(MIGRATION_KEY)).toBe('true');
    expect(await migrateLegacyWorld(null, repo)).toBeNull();
    expect(await repo.list()).toHaveLength(0);
  });
  it('retries on the next visit when the write fails', async () => {
    const backend = new MemoryBackend();
    const { repo } = repoWith(backend);
    const storage = memStorage({ [STORAGE_KEYS.world]: JSON.stringify(createStarterWorld()) });
    backend.failNextPut = new Error('blocked');
    expect(await migrateLegacyWorld(storage, repo)).toBeNull();
    expect(storage.map.has(MIGRATION_KEY)).toBe(false);
    expect(await migrateLegacyWorld(storage, repo)).not.toBeNull();
  });
});
