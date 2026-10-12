/**
 * Child-process probe for the worker lockdown (it freezes intrinsics, so it
 * must never run inside the test runner's own process). Prints a JSON map of
 * attempt name → outcome.
 */
import { lockdown, type LockableScope } from '../../src/sandbox/lockdown';
import { compileGenerator, errorMessage, runCompiled } from '../../src/sandbox/runner';

const scope = globalThis as unknown as LockableScope & Record<string, unknown>;
scope.postMessage = () => undefined;
scope.addEventListener = () => undefined;
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
results.pollutedAfter = String(({} as Record<string, unknown>).polluted);
results.fetchType = typeof scope.fetch;
results.functionGlobal = typeof scope.Function;
process.stdout.write(JSON.stringify(results));
