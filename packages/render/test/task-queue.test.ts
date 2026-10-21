import { describe, expect, it } from 'vitest';
import { TaskQueue } from '../src/gpu/task-queue';

describe('task queue', () => {
  it('runs jobs in order, never inside the caller\'s turn, and resolves with results', async () => {
    const q = new TaskQueue(1000);
    const order: number[] = [];
    const a = q.run(() => (order.push(1), 'a'));
    const b = q.run(() => (order.push(2), 'b'));
    expect(order).toEqual([]);
    expect(q.pending).toBe(2);
    expect(await Promise.all([a, b])).toEqual(['a', 'b']);
    expect(order).toEqual([1, 2]);
    expect(q.pending).toBe(0);
  });

  it('gives up the thread once a task has used its budget', async () => {
    const q = new TaskQueue(0);
    const ran: number[] = [];
    let seenAtEndOfFirstTask = -1;
    const jobs = [1, 2, 3].map((n) =>
      q.run(() => {
        ran.push(n);
        // A microtask runs when the task that is running this job ends.
        if (n === 1) queueMicrotask(() => (seenAtEndOfFirstTask = ran.length));
      }),
    );
    await Promise.all(jobs);
    expect(ran).toEqual([1, 2, 3]);
    expect(seenAtEndOfFirstTask).toBe(1);
  });

  it('shares a task between short jobs while there is budget', async () => {
    const q = new TaskQueue(1000);
    const ran: number[] = [];
    let seenAtEndOfFirstTask = -1;
    const jobs = [1, 2, 3].map((n) =>
      q.run(() => {
        ran.push(n);
        if (n === 1) queueMicrotask(() => (seenAtEndOfFirstTask = ran.length));
      }),
    );
    await Promise.all(jobs);
    expect(seenAtEndOfFirstTask).toBe(3);
  });

  it('a job that throws rejects only itself', async () => {
    const q = new TaskQueue();
    const bad = q.run(() => {
      throw new Error('boom');
    });
    const good = q.run(() => 7);
    await expect(bad).rejects.toThrow('boom');
    expect(await good).toBe(7);
  });
});
