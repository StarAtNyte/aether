/**
 * Sandbox worker entry (module worker). Locks the worker down first, then
 * compiles and runs untrusted generator bodies on request and posts the
 * validated output back with zero-copy transfers.
 */
import { lockdown, type LockableScope, type SandboxCapabilities } from './lockdown';
import { parseRunRequest, transferables, type RunResult } from './protocol';
import { compileGenerator, errorMessage, runCompiled, type CompiledGenerator } from './runner';
import { staticCheckSource } from './static-check';

/**
 * Compiled bodies by source, so the runs of one generator (every entity of a world that uses it) share one function
 * and the engine's optimised code for it, instead of starting cold in the interpreter each time. Each run still gets
 * fresh params, a fresh API and a re-seeded Math.random; state a body could keep between runs (on unfrozen
 * intrinsics) is no different from before, since runs already share this realm.
 */
const compiled = new Map<string, CompiledGenerator>();
const MAX_COMPILED = 32;

function compiledFor(source: string, caps: SandboxCapabilities): CompiledGenerator {
  let fn = compiled.get(source);
  if (fn) return fn;
  const check = staticCheckSource(source);
  if (!check.ok) throw new Error(`source rejected: ${check.problems.join('; ')}`);
  fn = compileGenerator(source, caps.FunctionCtor);
  if (compiled.size >= MAX_COMPILED) compiled.delete(compiled.keys().next().value as string);
  compiled.set(source, fn);
  return fn;
}

function handle(e: MessageEvent, caps: SandboxCapabilities): void {
  const req = parseRunRequest(e.data);
  if (!req) return;
  let reply: RunResult;
  let transfer: Transferable[] = [];
  try {
    const started = caps.now();
    const fn = compiledFor(req.source, caps);
    caps.reseed(req.seed);
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
