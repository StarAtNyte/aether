/**
 * Child-process probe for the worker lockdown (it freezes intrinsics, so it
 * must never run inside the test runner's own process). Prints a JSON map of
 * attempt name → outcome.
 */
import { lockdown, type LockableScope } from '../../src/sandbox/lockdown';
import { compileGenerator, errorMessage, runCompiled } from '../../src/sandbox/runner';

const scope = globalThis as unknown as LockableScope & Record<string, unknown>;
const out = process.stdout;
const exit = process.exit.bind(process);
scope.postMessage = () => undefined;
scope.addEventListener = () => undefined;

// Mimic a browser worker: web APIs live on the global's PROTOTYPE chain (like
// WorkerGlobalScope.prototype.fetch / the indexedDB getter) and an interface
// object exposes that prototype. WebIDL calls these with an undefined receiver
// on the global object, so reaching the descriptor is enough to escape.
const hostProto: Record<string, unknown> = {};
Object.defineProperty(hostProto, 'indexedDB', { configurable: true, enumerable: true, get: () => 'IDB-REACHED' });
Object.defineProperty(hostProto, 'fetch', { configurable: true, enumerable: true, writable: true, value: () => 'FETCH-REACHED' });
Object.setPrototypeOf(hostProto, Object.getPrototypeOf(globalThis) as object);
Object.setPrototypeOf(globalThis, hostProto);
function WorkerGlobalScope(): void {}
WorkerGlobalScope.prototype = hostProto;
Object.defineProperty(globalThis, 'WorkerGlobalScope', { configurable: true, writable: true, value: WorkerGlobalScope });
Object.defineProperty(globalThis, 'IDBFactory', { configurable: true, writable: true, value: function IDBFactory() {} });

const caps = lockdown(scope, () => undefined);

const results: Record<string, string> = {};
const attempt = (name: string, source: string): void => {
  try {
    const fn = compileGenerator(source, caps.FunctionCtor);
    const out = runCompiled(fn, {}, 1);
    results[name] = `ok:${out.parts.length}`;
  } catch (err) {
    results[name] = `blocked:${errorMessage(err)}`;
  }
};

const FINISH = "api.add(api.box(1, 1, 1), {}); return api.build();";
attempt('normal', FINISH);
attempt('fnCtor', `const k = 'constr' + 'uctor'; api.box[k]('return 1')(); ${FINISH}`);
attempt('arrowCtor', `const k = 'constr' + 'uctor'; (() => 1)[k]('return 1')(); ${FINISH}`);
attempt('asyncCtor', `const k = 'constr' + 'uctor'; (async () => 1)[k]('return 1'); ${FINISH}`);
attempt('genCtor', `const k = 'constr' + 'uctor'; (function* g() {})[k]('return 1'); ${FINISH}`);
attempt('protoPollution', `const p = 'proto' + 'type'; Object[p].polluted = 1; ${FINISH}`);
attempt('arrayPollution', `const p = 'proto' + 'type'; Array[p].push = () => 0; ${FINISH}`);
attempt('fetch', `fetch('https://example.com'); ${FINISH}`);
attempt('globalThisAccess', `const g = globalThis; g.x = 1; ${FINISH}`);
attempt('evalAccess', `eval('1'); ${FINISH}`);
attempt('timer', `setTimeout(() => 0, 1); ${FINISH}`);
attempt('protoGetterEscape', `const P = 'proto' + 'type'; const d = Object.getOwnPropertyDescriptor(WorkerGlobalScope[P], 'indexedDB'); throw new Error('LEAK:' + d.get.call(undefined));`);
attempt('protoMethodEscape', `const P = 'proto' + 'type'; const d = Object.getOwnPropertyDescriptor(WorkerGlobalScope[P], 'fetch'); throw new Error('LEAK:' + d.value.call(undefined));`);
attempt('interfaceObject', `if (typeof IDBFactory !== 'undefined') throw new Error('LEAK:IDBFactory'); ${FINISH}`);
attempt('intrinsicsKept', `const m = new Map([[1, Math.max(1, 2)]]); if (JSON.stringify([...m]) !== '[[1,2]]' || !Number.isFinite(parseFloat('1.5'))) throw new Error('intrinsics broken'); ${FINISH}`);
// Determinism: Math.random is seeded per run and the clock is frozen, so two runs of one seed are identical.
const IMPURE = "const j = Math.random() + Date.now() / 1e15 + new Date().getTime() / 1e15; api.add(api.box(1 + j, 1, 1 + Math.random()), {}); return api.build();";
const runSeeded = (seed: number): string => {
  const fn = compileGenerator(IMPURE, caps.FunctionCtor);
  caps.reseed(seed);
  return Array.from(runCompiled(fn, {}, seed).parts[0]!.positions).join(',');
};
results.deterministic = runSeeded(3) === runSeeded(3) ? 'same' : 'differs';
results.seeded = runSeeded(3) !== runSeeded(4) ? 'varies' : 'constant';
results.frozenNow = String(Date.now());
results.frozenNew = String(new Date().getTime());
results.dateCtorEscape = String(new (new Date().constructor as DateConstructor)().getTime());
results.pollutedAfter = String(({} as Record<string, unknown>).polluted);
results.fetchType = typeof scope.fetch;
results.functionGlobal = typeof scope.Function;
// Exit once the result is flushed: the lockdown removed WebAssembly from this process, and Node 22's lazily loaded fetch internals would otherwise fail at shutdown.
out.write(JSON.stringify(results), () => exit(0));
