/**
 * Sandbox worker entry (module worker). Locks the worker down first, then
 * compiles and runs untrusted generator bodies on request and posts the
 * validated output back with zero-copy transfers.
 */
import { lockdown, type LockableScope, type SandboxCapabilities } from './lockdown';
import { parseRunRequest, transferables, type RunResult } from './protocol';
import { compileGenerator, errorMessage, runCompiled } from './runner';
import { staticCheckSource } from './static-check';

function handle(e: MessageEvent, caps: SandboxCapabilities): void {
  const req = parseRunRequest(e.data);
  if (!req) return;
  let reply: RunResult;
  let transfer: Transferable[] = [];
  try {
    const check = staticCheckSource(req.source);
    if (!check.ok) throw new Error(`source rejected: ${check.problems.join('; ')}`);
    const started = caps.now();
    const fn = compileGenerator(req.source, caps.FunctionCtor);
    const output = runCompiled(fn, req.params, req.seed);
    output.stats.ms = Math.max(0, caps.now() - started);
    reply = { type: 'result', id: req.id, ok: true, output };
    transfer = transferables(output);
  } catch (err) {
    reply = { type: 'result', id: req.id, ok: false, error: errorMessage(err) };
  }
  caps.post(reply, transfer);
}

const caps = lockdown(self as unknown as LockableScope, handle);
caps.post({ type: 'ready' }, []);
