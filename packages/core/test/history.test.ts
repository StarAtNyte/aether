import { describe, expect, it, vi } from 'vitest';
import { createWorld, deepEqual, History, type WorldDoc } from '../src/index';
import { sampleWorld } from './helpers';

const add = (id: string) => [{ op: 'add', entity: { id } }];

describe('History: linear undo/redo', () => {
  it('commits, undoes and redoes', () => {
    const w0 = createWorld();
    const h = new History(w0);
    expect(h.current).toBe(w0);
    expect(h.canUndo()).toBe(false);
    const r = h.commit(add('a'), 'add a', 'agent');
    expect(r.errors).toEqual([]);
    const w1 = h.current;
    h.commit(add('b'), 'add b');
    expect(Object.keys(h.current.entities)).toEqual(['a', 'b']);
    expect(h.undo()).toBe(w1);
    expect(h.undo()).toBe(w0);
    expect(h.undo()).toBeNull();
    expect(h.canRedo()).toBe(true);
    expect(h.redo()).toBe(w1);
    expect(Object.keys(h.redo()!.entities)).toEqual(['a', 'b']);
    expect(h.redo()).toBeNull();
    expect(h.entries().map((e) => [e.message, e.source, e.patchCount])).toEqual([
      ['initial', 'system', 0],
      ['add a', 'agent', 1],
      ['add b', 'user', 1],
    ]);
  });

  it('does not record failed or no-op commits', () => {
    const h = new History(sampleWorld());
    const r = h.commit([{ op: 'remove', id: 'ghost' }], 'bad');
    expect(r.errors).toHaveLength(1);
    h.commit([{ op: 'setMeta', name: 'Coin Run' }], 'noop');
    expect(h.entries()).toHaveLength(1);
  });

  it('committing after undo discards the redo tail', () => {
    const h = new History(createWorld());
    h.commit(add('a'), 'a');
    h.commit(add('b'), 'b');
    h.undo();
    h.commit(add('c'), 'c');
    expect(h.canRedo()).toBe(false);
    expect(Object.keys(h.current.entities)).toEqual(['a', 'c']);
    expect(h.entries().map((e) => e.message)).toEqual(['initial', 'a', 'c']);
  });

  it('supports atomic commits', () => {
    const h = new History(createWorld());
    const r = h.commit([...add('a'), { op: 'nope' }], 'x', 'agent', { atomic: true });
    expect(r.errors).toHaveLength(1);
    expect(h.entries()).toHaveLength(1);
  });

  it('prunes beyond maxEntries, keeping the newest', () => {
    const h = new History(createWorld(), { maxEntries: 3 });
    for (let i = 0; i < 10; i++) h.commit(add(`e${i}`), `e${i}`);
    expect(h.entries().map((e) => e.message)).toEqual(['e6', 'e7', 'e8', 'e9']);
    let steps = 0;
    while (h.undo()) steps++;
    expect(steps).toBe(3);
    expect(Object.keys(h.current.entities)).toHaveLength(7);
  });

  it('sanitizes messages and sources', () => {
    const h = new History(createWorld());
    h.commit(add('a'), 'x'.repeat(2000), 'evil' as 'user');
    const e = h.entries()[1]!;
    expect(e.message.length).toBe(500);
    expect(e.source).toBe('user');
  });
});

describe('History: branches and time travel', () => {
  it('branches fork at the current position and keep their own lines', () => {
    const h = new History(createWorld());
    h.commit(add('a'), 'a');
    h.commit(add('b'), 'b');
    h.undo();
    h.branch('alt');
    expect(h.currentBranch()).toBe('alt');
    h.commit(add('c'), 'c');
    expect(Object.keys(h.current.entities)).toEqual(['a', 'c']);
    const main = h.switchBranch('main');
    expect(Object.keys(main.entities)).toEqual(['a']); // main kept its own cursor
    expect(h.redo()).not.toBeNull();
    expect(Object.keys(h.current.entities)).toEqual(['a', 'b']);
    expect(h.branches()).toEqual(['main', 'alt']);
    expect(() => h.branch('alt')).toThrow(/already exists/);
    expect(() => h.branch('bad name!')).toThrow(/invalid branch name/);
    expect(() => h.switchBranch('nope')).toThrow(/unknown branch/);
  });

  it('checkout travels to any entry without discarding redo', () => {
    const h = new History(createWorld());
    h.commit(add('a'), 'a');
    const idA = h.head;
    h.commit(add('b'), 'b');
    h.commit(add('c'), 'c');
    const w = h.checkout(idA);
    expect(Object.keys(w.entities)).toEqual(['a']);
    expect(h.canRedo()).toBe(true);
    h.branch('side');
    h.commit(add('z'), 'z');
    const zId = h.head;
    h.switchBranch('main');
    h.checkout(zId); // lives on another branch → switches
    expect(h.currentBranch()).toBe('side');
    expect(Object.keys(h.current.entities)).toEqual(['a', 'z']);
    expect(() => h.checkout(9999)).toThrow(RangeError);
  });

  it('deleteBranch releases entries but protects the active branch', () => {
    const h = new History(createWorld());
    h.branch('tmp');
    h.commit(add('a'), 'a');
    expect(() => h.deleteBranch('tmp')).toThrow(/active/);
    h.switchBranch('main');
    h.deleteBranch('tmp');
    expect(h.branches()).toEqual(['main']);
    expect(() => h.deleteBranch('tmp')).toThrow(/unknown branch/);
  });

  it('notifies subscribers on every change of current', () => {
    const h = new History(createWorld());
    const seen: WorldDoc[] = [];
    const off = h.subscribe((w) => seen.push(w));
    h.commit(add('a'), 'a');
    h.undo();
    h.redo();
    h.branch('b'); // same world: no notification
    h.switchBranch('main');
    h.checkout(0);
    off();
    h.redo();
    expect(seen).toHaveLength(5);
    const bad = vi.fn(() => {
      throw new Error('listener failure');
    });
    h.subscribe(bad);
    const good = vi.fn();
    h.subscribe(good);
    expect(() => h.undo()).toThrow('listener failure');
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe('History: serialization', () => {
  function build(): History {
    const h = new History(sampleWorld(), { maxEntries: 5 });
    h.commit([{ op: 'update', id: 'car', set: { name: 'Blue' } }], 'rename', 'agent');
    h.commit(add('a'), 'a');
    h.branch('alt');
    h.commit([{ op: 'remove', id: 'car' }], 'rm');
    h.switchBranch('main');
    for (let i = 0; i < 6; i++) h.commit(add(`m${i}`), `m${i}`); // forces pruning on main
    h.undo();
    return h;
  }

  it('round-trips through JSON', () => {
    const h = build();
    const json = JSON.parse(JSON.stringify(h.toJSON()));
    const h2 = History.fromJSON(json);
    expect(h2.currentBranch()).toBe(h.currentBranch());
    expect(h2.branches()).toEqual(h.branches());
    expect(h2.entries()).toEqual(h.entries());
    expect(deepEqual(h2.current, h.current)).toBe(true);
    expect(h2.canRedo()).toBe(true);
    h2.switchBranch('alt');
    h.switchBranch('alt');
    expect(deepEqual(h2.current, h.current)).toBe(true);
    // continues numbering after restore
    h2.commit(add('after'), 'after');
    expect(h2.head).toBeGreaterThan(Math.max(...h.entries().map((e) => e.id)));
  });

  it('rejects malformed or hostile JSON', () => {
    const good = JSON.parse(JSON.stringify(build().toJSON())) as Record<string, unknown>;
    interface HistoryJson {
      format: string;
      currentBranch: string;
      nextId: number;
      branches: Array<{ name: string; ids: number[]; cursor: number }>;
      entries: Array<{ patches: unknown[]; world: { entities: { car: { physics: { body: string } } } } }>;
    }
    const mutate = (fn: (j: HistoryJson) => void): unknown => {
      const j = JSON.parse(JSON.stringify(good)) as HistoryJson;
      fn(j);
      return j;
    };
    expect(() => History.fromJSON(null)).toThrow(/History.fromJSON/);
    expect(() => History.fromJSON({})).toThrow(/History.fromJSON/);
    expect(() => History.fromJSON(mutate((j) => (j.format = 'other')))).toThrow();
    expect(() => History.fromJSON(mutate((j) => (j.currentBranch = 'ghost')))).toThrow(/unknown current branch/);
    expect(() => History.fromJSON(mutate((j) => (j.branches[0]!.cursor = 99)))).toThrow(/cursor out of range/);
    expect(() => History.fromJSON(mutate((j) => j.branches[0]!.ids.push(12345)))).toThrow(/unknown entry/);
    expect(() => History.fromJSON(mutate((j) => (j.entries[1]!.patches = [{ op: 'remove', id: 'ghost' }])))).toThrow(/replay failed|patches invalid/);
    expect(() => History.fromJSON(mutate((j) => (j.entries[0]!.world.entities.car.physics.body = 'x')))).toThrow(/snapshot invalid/);
    expect(() => History.fromJSON(mutate((j) => (j.nextId = 1)))).toThrow(/nextId/);
    expect(() => History.fromJSON(mutate((j) => j.branches.push({ ...j.branches[0]! })))).toThrow(/duplicate branch/);
    expect(() => History.fromJSON(JSON.parse(JSON.stringify(good).replace('"maxEntries"', '"__proto__":{"x":1},"maxEntries"')))).toThrow(/forbidden key/);
  });
});

describe('History: setMaxEntries (memory budget)', () => {
  it('prunes the oldest entries of every branch and keeps the newest', () => {
    const h = new History(createWorld(), { maxEntries: 50 });
    for (let i = 0; i < 20; i++) h.commit(add(`e${i}`), `add ${i}`);
    const head = h.current;
    expect(h.size).toBe(21);
    const listener = vi.fn();
    h.subscribe(listener);
    expect(h.setMaxEntries(5)).toBe(5);
    expect(h.entryLimit).toBe(5);
    expect(h.size).toBe(6);
    expect(h.current).toBe(head);
    expect(listener).toHaveBeenCalledTimes(1);
    let undos = 0;
    while (h.undo()) undos++;
    expect(undos).toBe(5);
    // Later commits respect the new cap.
    while (h.redo());
    for (let i = 0; i < 10; i++) h.commit(add(`f${i}`), `add f${i}`);
    expect(h.size).toBe(6);
  });

  it('never prunes the current position and is a silent no-op when nothing exceeds the cap', () => {
    const h = new History(createWorld(), { maxEntries: 100 });
    for (let i = 0; i < 10; i++) h.commit(add(`e${i}`), `add ${i}`);
    for (let i = 0; i < 8; i++) h.undo();
    const here = h.current;
    h.setMaxEntries(3);
    expect(h.current).toBe(here);
    // Only the 2 entries before the cursor could go; the redo tail survives.
    expect(h.canRedo()).toBe(true);
    expect(h.canUndo()).toBe(false);
    const listener = vi.fn();
    h.subscribe(listener);
    h.setMaxEntries(1000);
    expect(listener).not.toHaveBeenCalled();
  });

  it('clamps invalid caps like the constructor', () => {
    const h = new History(createWorld(), { maxEntries: 10 });
    expect(h.setMaxEntries(0)).toBe(1);
    expect(h.setMaxEntries(Number.NaN)).toBe(1);
    expect(h.setMaxEntries(1e9)).toBe(10_000);
  });
});
