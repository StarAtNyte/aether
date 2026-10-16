import { createGeneratorApi } from '../api';
import { validateOutput } from '../output';
/**
 * Compile `source` as the strict-mode BODY of `function (params, api)`.
 * The Function constructor parses the body separately from the parameter
 * list, so the source cannot break out of the function wrapper.
 */
export function compileGenerator(source, FunctionCtor) {
    return new FunctionCtor('params', 'api', `"use strict";\n${source}`);
}
/** Run a compiled generator with a fresh API and validate its output (throws on failure). */
export function runCompiled(fn, params, seed) {
    const api = createGeneratorApi(seed);
    const result = fn(params, api);
    const v = validateOutput(result);
    if (!v.ok)
        throw new Error(v.error);
    return v.output;
}
/** Best-effort, bounded message from anything thrown by untrusted code. */
export function errorMessage(err) {
    try {
        if (err instanceof Error)
            return `${err.name}: ${String(err.message)}`.slice(0, 500);
        return String(err).slice(0, 500);
    }
    catch {
        return 'generator threw an unprintable value';
    }
}
