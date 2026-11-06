import { workerScheduler, workerSchedulerEnabled, type WorkToken } from '@aether/core';
import { installProceduralFields, proceduralFieldsReady } from './procedural-fields';
interface FieldWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(value: unknown): void;
  terminate(): void;
}
let pending: Promise<boolean> | null = null;
/** Warm once while the GPU initializes. Failure keeps the exact synchronous fallback. */
export function warmProceduralFields(factory: (() => FieldWorker) | null = typeof Worker === 'undefined' ? null : () => new Worker(new URL('./procedural-fields.worker.ts', import.meta.url), { type: 'module' })): Promise<boolean> {
  if (proceduralFieldsReady()) return Promise.resolve(true);
  if (!factory) return Promise.resolve(false);
  // The worker runs holding a `load` slot of the page's worker budget; its 3 s clock starts once it has one.
  if (pending) return pending;
  const sched = workerSchedulerEnabled() ? workerScheduler() : null;
  const now = sched?.tryAcquire('load') ?? null;
  const run = (token: WorkToken | null): Promise<boolean> => new Promise<boolean>(resolve => {
    let worker: FieldWorker | null = null, done = false;
    const finish = (value: unknown) => {
      if (done) return;
      done = true; clearTimeout(timer); token?.release();
      if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate(); }
      resolve(installProceduralFields(value));
    };
    const timer = setTimeout(() => finish(null), 3000);
    try {
      worker = factory();
      worker.onmessage = event => finish(event.data);
      worker.onerror = event => { event.preventDefault(); finish(null); };
      worker.onmessageerror = () => finish(null);
      worker.postMessage('prepare');
    } catch { finish(null); }
  });
  pending = sched && !now ? sched.acquire('load').then(run) : run(now);
  return pending;
}
