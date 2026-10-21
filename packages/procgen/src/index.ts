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
export { parseCollider } from './colliders';
export { ARCH_GENERATOR_IDS, BUILTIN_GENERATORS, catalog, getBuiltinGenerator } from './generators/index';
export { generate, generateBuiltinSync, generatorSourceHash, proceduralOutputKey, resolveBuiltin, yieldToEventLoop } from './generate';
export { archToOutput } from './generators/arch';
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
export { silhouette, checkSilhouette, type SilhouetteStats, type SilhouetteVerdict, type SilhouetteView } from './silhouette';
export { GENERATOR_LIBRARY, isLibraryGenerator, loadLibraryGenerator, matchLibrary, type LibraryEntry } from './library';

export * from './mesh-edit/index';
export { ComputeClient, type ComputeClientOptions } from './compute/client';
export { finishPixels, finishAlbedoScale, FINISH_TEXTURE_SIZE, MAX_FINISH_TEXTURE_SIZE, type FinishPixels } from './finish-pixels';
export { foliagePixels, foliageAtlasSize, foliageCellUv, FOLIAGE_TEXTURE_SIZE, FOLIAGE_CELLS, MAX_FOLIAGE_TEXTURE_SIZE, FOLIAGE_ALPHA_CUT, type FoliageKind } from './foliage-pixels';
