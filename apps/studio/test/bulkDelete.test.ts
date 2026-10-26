import { describe, expect, it } from 'vitest';
import { createStarterWorld } from '../src/lib/starterWorld';
import { MemoryBackend } from '../src/projects/backend';
import { describeProjects, isDeletable, removeMany, removeMessage, restoreMany, restoreMessage, type DeleteRepo } from '../src/projects/bulkDelete';
import { ProjectRepo } from '../src/projects/repo';

function repoWith(): ProjectRepo {
  let n = 0;
  return new ProjectRepo(new MemoryBackend(), () => 1_000, () => `proj${String(++n).padStart(8, '0')}`);
}

async function seed(repo: ProjectRepo, names: string[]) {
  const out = [];
  for (const name of names) {
    const r = await repo.create({ world: { ...createStarterWorld(), name } });
    if (!r.ok) throw new Error(r.error);
    out.push(r.value);
  }
  return out;
}

describe('bulk delete', () => {
  it('deletes every project and one undo restores all of them', async () => {
    const repo = repoWith();
    const ps = await seed(repo, ['A', 'B', 'C']);
    const res = await removeMany(repo, ps);
    expect(res.removed).toHaveLength(3);
    expect(res.failed).toHaveLength(0);
    expect((await repo.list()).length).toBe(0);
    const back = await restoreMany(repo, res.removed);
    expect(back.restored.map((m) => m.name)).toEqual(['A', 'B', 'C']);
    expect((await repo.list()).length).toBe(3);
    expect(removeMessage(res, ps).text).toBe('Deleted 3 projects');
    expect(restoreMessage(back).text).toBe('Restored 3 projects');
  });

  it('reports a partial failure and still deletes the rest', async () => {
    const repo = repoWith();
    const ps = await seed(repo, ['A', 'B', 'C']);
    const flaky: DeleteRepo = {
      remove: (id) => (id === ps[1]?.id ? Promise.resolve({ ok: false, error: 'Browser storage is full.' }) : repo.remove(id)),
      restore: (d) => repo.restore(d),
    };
    const res = await removeMany(flaky, ps);
    expect(res.removed.map((d) => d.meta.name)).toEqual(['A', 'C']);
    expect(res.failed).toEqual([{ project: ps[1], error: 'Browser storage is full.' }]);
    const msg = removeMessage(res, ps);
    expect(msg.kind).toBe('error');
    expect(msg.text).toContain('Deleted 2 projects; 1 could not be deleted. Browser storage is full.');
    expect((await repo.list()).map((m) => m.name)).toEqual(['B']);
  });

  it('survives a thrown error and reports total failure', async () => {
    const repo = repoWith();
    const ps = await seed(repo, ['A']);
    const broken: DeleteRepo = { remove: () => Promise.reject(new Error('boom')), restore: (d) => repo.restore(d) };
    const res = await removeMany(broken, ps);
    expect(res.removed).toHaveLength(0);
    expect(removeMessage(res, ps)).toEqual({ text: 'Could not delete “A”. boom', kind: 'error' });
  });

  it('undo reports which projects could not be restored', async () => {
    const repo = repoWith();
    const ps = await seed(repo, ['A', 'B']);
    const res = await removeMany(repo, ps);
    const full: DeleteRepo = {
      remove: (id) => repo.remove(id),
      restore: (d) => (d.meta.name === 'B' ? Promise.resolve({ ok: false, error: 'Browser storage is full.' }) : repo.restore(d)),
    };
    const back = await restoreMany(full, res.removed);
    expect(back.restored.map((m) => m.name)).toEqual(['A']);
    const msg = restoreMessage(back);
    expect(msg.kind).toBe('error');
    expect(msg.text).toBe('Restored 1 of 2 projects. Could not restore “B”. Browser storage is full.');
  });

  it('never deletes example worlds and ignores duplicates', async () => {
    const repo = repoWith();
    const [a] = await seed(repo, ['A']);
    if (!a) throw new Error('seed');
    const example = { ...a, id: 'example12345' };
    expect(isDeletable(example, new Set(['example12345']))).toBe(false);
    const calls: string[] = [];
    const spy: DeleteRepo = { remove: (id) => (calls.push(id), repo.remove(id)), restore: (d) => repo.restore(d) };
    const res = await removeMany(spy, [a, a, example], new Set(['example12345']));
    expect(calls).toEqual([a.id]);
    expect(res.skipped).toEqual([example]);
    expect(res.removed).toHaveLength(1);
  });

  it('names a single project and counts several', () => {
    const m = { name: 'Camp' } as never;
    expect(describeProjects([m])).toBe('“Camp”');
    expect(describeProjects([m, m])).toBe('2 projects');
  });
});
