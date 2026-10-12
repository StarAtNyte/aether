/**
 * Compile-and-run core for untrusted generator bodies, used inside the
 * sandbox worker (which locks down its globals before calling this).
 */
import type { Json } from '@aether/core';
import type { GeneratorOutput } from '../types';
import { createGeneratorApi } from '../api';
import { validateOutput } from '../output';

/** A compiled generator body. */
export type CompiledGenerator = (params: Record<string, Json>, api: unknown) => unknown;

/**
 * Compile `source` as the strict-mode BODY of `function (params, api)`.
 * The Function constructor parses the body separately from the parameter
 * list, so the source cannot break out of the function wrapper.
 */
export function compileGenerator(source: string, FunctionCtor: FunctionConstructor): CompiledGenerator {
  return new FunctionCtor('params', 'api', `"use strict";\n${source}`) as CompiledGenerator;
}

/** Run a compiled generator with a fresh API and validate its output (throws on failure). */
export function runCompiled(fn: CompiledGenerator, params: Record<string, Json>, seed: number): GeneratorOutput {
  const api = createGeneratorApi(seed);
  const result = fn(params, api);
  const v = validateOutput(result);
  if (!v.ok) throw new Error(v.error);
  return v.output;
}

/** Best-effort, bounded message from anything thrown by untrusted code. */
export function errorMessage(err: unknown): string {
  try {
    if (err instanceof Error) return `${err.name}: ${String(err.message)}`.slice(0, 500);
    return String(err).slice(0, 500);
  } catch {
    return 'generator threw an unprintable value';
  }
}
