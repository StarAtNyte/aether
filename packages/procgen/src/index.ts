/**
 * @aether/procgen — deterministic procedural geometry kernel producing plain
 * typed-array meshes (no three.js), 35 art-directed built-in generators, and
 * a sandbox for LLM-written generators.
 *
 * Browser-safe entry: never imports `node:*`. The Node sandbox lives in
 * `@aether/procgen/node`.
 */
export type {
  Bounds,
  BuiltinGenerator,
  CatalogEntry,
  ColliderDesc,
  GeneratorApi,
  GeneratorCategory,
  GeneratorOutput,
  MeshHandle,
  MeshPart,
  SandboxRunner,
} from './types';

export { createGeneratorApi, type BuildOptions } from './api';
export { BUILTIN_GENERATORS, catalog, getBuiltinGenerator } from './generators/index';
export { generate, generateBuiltinSync, generatorSourceHash, proceduralOutputKey, yieldToEventLoop } from './generate';
export { primitiveOutput, fallbackOutput, validateOutput } from './output';
export { resolveParams } from './params';
export { GeneratorCache, DEFAULT_CACHE_BYTES, DEFAULT_SEED, generatorCacheKey, outputBytes } from './cache';
export { PROCGEN_LIMITS } from './limits';
export { Noise } from './noise';
export { normalizeHex, mixHex } from './color';

export { createWorkerSandbox, type WorkerSandboxOptions, type WorkerLike } from './sandbox/worker-sandbox';
export { staticCheckSource } from './sandbox/static-check';
export { GENERATOR_API_DTS } from './sandbox/dts';
export { GENERATOR_EXAMPLES } from './sandbox/examples';
