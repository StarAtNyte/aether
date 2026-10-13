/**
 * Per-backend job queue: one job runs at a time (a headless CLI run is heavy
 * and spends the user's quota), a few may wait, everything else is refused
 * with `busy`. Waiting jobs whose caller aborts leave the queue.
 */
import { BridgeError } from './errors';

/** A FIFO with concurrency 1 and a bounded backlog. */
export class JobQueue {
  private running = false;
  private readonly waiting: Array<{ start: () => void; signal: AbortSignal | undefined; cancel: () => void }> = [];

  constructor(private readonly maxWaiting = 4) {}

  /** Jobs running + waiting. */
  get size(): number {
    return (this.running ? 1 : 0) + this.waiting.length;
  }

  /** Run `job` when it is its turn. Rejects with `busy` when the backlog is full. */
  run<T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new BridgeError('backend_error', 'cancelled'));
    if (!this.running) return this.start(job);
    if (this.waiting.length >= this.maxWaiting) return Promise.reject(new BridgeError('busy', 'The bridge is busy with other requests. Try again shortly.', { retryAfterSec: 10 }));
    return new Promise<T>((resolve, reject) => {
      const entry = {
        signal,
        start: () => {
          signal?.removeEventListener('abort', onAbort);
          this.start(job).then(resolve, reject);
        },
        cancel: () => reject(new BridgeError('backend_error', 'cancelled')),
      };
      const onAbort = (): void => {
        const i = this.waiting.indexOf(entry);
        if (i >= 0) this.waiting.splice(i, 1);
        entry.cancel();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(entry);
    });
  }

  private async start<T>(job: () => Promise<T>): Promise<T> {
    this.running = true;
    try {
      return await job();
    } finally {
      this.running = false;
      this.waiting.shift()?.start();
    }
  }
}
