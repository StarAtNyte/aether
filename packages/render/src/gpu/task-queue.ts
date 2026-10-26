/**
 * Runs synchronous jobs one after another with a bounded budget between jobs. An individual synchronous job cannot be interrupted.
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
  private readonly jobs: Array<(() => void) | undefined> = [];
  private head = 0;
  private scheduled = false;
  private running = false;
  private channel: MessageChannel | null = null;
  /** The longest jobs seen (label and milliseconds, longest first, at most eight), for diagnosing a stall. */
  readonly slowest: Array<{ label: string; ms: number }> = [];

  /** Milliseconds of work a task may start another job within. */
  constructor(readonly budgetMs = 6, private readonly channelFactory: (() => MessageChannel) | null = typeof MessageChannel === 'function' ? () => new MessageChannel() : null) {}

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
    return this.jobs.length - this.head;
  }

  private schedule(): void {
    if (this.scheduled || this.running || this.pending === 0) return;
    this.scheduled = true;
    if (this.channelFactory) {
      if (!this.channel) {
        this.channel = this.channelFactory();
        this.channel.port1.onmessage = () => this.pump();
      }
      this.channel.port2.postMessage(null);
    } else setTimeout(() => this.pump(), 0);
  }

  private pump(): void {
    this.scheduled = false;
    if (this.pending === 0) {
      this.channel?.port1.close(); this.channel?.port2.close(); this.channel = null;
      return;
    }
    this.running = true;
    const start = performance.now();
    do {
      const job = this.jobs[this.head];
      if (!job) break;
      // Release consumed closures immediately without removing the front of the array.
      this.jobs[this.head++] = undefined;
      job();
    } while (this.pending > 0 && performance.now() - start < this.budgetMs);
    this.running = false;
    if (this.pending === 0) { this.jobs.length = 0; this.head = 0; }
    else if (this.head >= 1024 && this.head * 2 >= this.jobs.length) {
      // Bound storage even when producers keep a queue alive indefinitely.
      this.jobs.copyWithin(0, this.head); this.jobs.length -= this.head; this.head = 0;
    }
    if (this.pending > 0) this.schedule();
    else if (this.channel) {
      // Reserve one final message: promise continuations can add their next upload
      // before it arrives. It drains that work or closes both ports if still idle.
      this.scheduled = true;
      this.channel.port2.postMessage(null);
    }
  }
}

/** The queue the texture read-backs and photographed atlases of a page share. */
export const textureWork = new TaskQueue();
(globalThis as { __aetherTextureWork?: TaskQueue }).__aetherTextureWork = textureWork;
