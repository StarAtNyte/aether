/** Frozen pre-optimization scheduler for browser comparisons. */
/**
 * Runs synchronous jobs one after another without ever holding the main thread for long.
 *
 * Several continuations of the same kind (a dozen image read-backs, a photographed atlas for every kind of
 * foliage) tend to become ready in the same turn of the event loop, and the engine then runs them back to
 * back inside one task: one long stall the player feels as a hitch. Queued here, each job starts in a
 * task of its own, and when jobs are short several share a task, up to {@link TaskQueue.budgetMs} of work
 * before the queue yields, so the page stays responsive and the total delay stays small.
 *
 * Jobs run in submission order; a job that throws rejects its own promise only.
 */
export class TaskQueue {
  private readonly jobs: Array<() => void> = [];
  private scheduled = false;
  /** The longest jobs seen (label and milliseconds, longest first, at most eight), for diagnosing a stall. */
  readonly slowest: Array<{ label: string; ms: number }> = [];

  /** Milliseconds of work a task may start another job within. */
  constructor(readonly budgetMs = 6) {}

  /** Run `job` in a later task; resolves with its result. */
  run<T>(job: () => T, label = 'job'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.jobs.push(() => {
        const t0 = performance.now();
        try {
          resolve(job());
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        } finally {
          this.note(label, performance.now() - t0);
        }
      });
      this.schedule();
    });
  }

  private note(label: string, ms: number): void {
    if (ms < 20) return;
    this.slowest.push({ label, ms: Math.round(ms) });
    this.slowest.sort((a, b) => b.ms - a.ms);
    this.slowest.length = Math.min(this.slowest.length, 8);
  }

  /** Jobs waiting to run. */
  get pending(): number {
    return this.jobs.length;
  }

  private schedule(): void {
    if (this.scheduled || this.jobs.length === 0) return;
    this.scheduled = true;
    nextTask(() => {
      this.scheduled = false;
      const start = performance.now();
      do this.jobs.shift()?.();
      while (this.jobs.length > 0 && performance.now() - start < this.budgetMs);
      this.schedule();
    });
  }
}

/** A macrotask without the 4 ms clamp of nested timers (a message on a private channel; a timer where there is none). */
function nextTask(fn: () => void): void {
  if (typeof MessageChannel === 'function') {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      fn();
    };
    ch.port2.postMessage(null);
    return;
  }
  setTimeout(fn, 0);
}
