/**
 * Worker-thread entry for generator dry runs (see `generator-validation.ts`).
 *
 * Runs inside a `worker_threads` Worker with V8 `resourceLimits`, so a
 * generator that loops or allocates without bound can only exhaust or stall
 * this isolate; the main thread terminates it with a watchdog and the HTTP
 * event loop keeps serving. Messages are validated before use.
 */
import { parentPort } from 'node:worker_threads';
import { z } from 'zod';
import { GeneratorDef } from '@aether/core';
import { staticCheckSource } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';

/** Upper bound on any error text sent back to the main thread. */
const MAX_ERROR_CHARS = 300;

/** Fixed seed used for the validation dry run (deterministic). */
const VALIDATION_SEED = 1;

const JobMessage = z.object({
  id: z.number().int().nonnegative(),
  def: z.unknown(),
  timeoutMs: z.number().int().min(10).max(10_000),
});

function truncate(text: string): string {
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}…` : text;
}

const port = parentPort;
if (port) {
  const sandbox = createNodeSandbox();
  port.on('message', (raw: unknown) => {
    const job = JobMessage.safeParse(raw);
    if (!job.success) return;
    const { id, timeoutMs } = job.data;
    const def = GeneratorDef.safeParse(job.data.def);
    if (!def.success) {
      port.postMessage({ type: 'result', id, ok: false, error: 'invalid generator definition' });
      return;
    }
    const report = staticCheckSource(def.data.source);
    if (!report.ok) {
      port.postMessage({ type: 'result', id, ok: false, error: truncate(`source rejected: ${report.problems.join('; ')}`) });
      return;
    }
    sandbox.run(def.data, {}, VALIDATION_SEED, { timeoutMs }).then(
      () => port.postMessage({ type: 'result', id, ok: true }),
      (err: unknown) => port.postMessage({ type: 'result', id, ok: false, error: truncate(err instanceof Error ? err.message : 'generator failed to run') }),
    );
  });
  port.postMessage({ type: 'ready' });
}
