/**
 * Main entry points used by render/physics: built-in generators run
 * synchronously in-process; custom (LLM-written) generators from
 * `world.generators` only ever run through a {@link SandboxRunner}.
 */
import { hashString, stableStringify, type GeneratorDef, type Json, type ProceduralShape, type WorldDoc } from '@aether/core';
import type { BuiltinGenerator, GeneratorOutput, SandboxRunner } from './types';
import { createGeneratorApi } from './api';
import { DEFAULT_SEED, GeneratorCache, generatorCacheKey } from './cache';
import { ARCH_GENERATOR_IDS, getBuiltinGenerator } from './generators/index';
import { resolveParams } from './params';
import { validateOutput } from './output';

/**
 * Run a built-in generator synchronously. Params are resolved (defaults,
 * clamping, unknown keys ignored). Throws for an unknown id.
 */
export function generateBuiltinSync(generatorId: string, params: Record<string, Json>, seed: number): GeneratorOutput {
  const gen = getBuiltinGenerator(generatorId);
  if (!gen) throw new Error(`unknown built-in generator "${String(generatorId).slice(0, 64)}"`);
  return gen.generate(params ?? {}, createGeneratorApi(seed));
}

/** Hashes by definition object: a world's definitions are immutable, and every entity of a generator asks again. */
const sourceHashes = new WeakMap<object, { source: string; params: unknown; hash: number }>();

/** Content hash of a custom generator (source + param spec), used in cache keys. */
export function generatorSourceHash(def: Pick<GeneratorDef, 'source' | 'params'>): number {
  const hit = sourceHashes.get(def);
  // Checked by identity of the fields too, in case a caller mutates a definition in place.
  if (hit && hit.source === def.source && hit.params === def.params) return hit.hash;
  const hash = hashString(`${def.source}\u0000${stableStringify(def.params ?? {})}`);
  sourceHashes.set(def, { source: def.source, params: def.params, hash });
  return hash;
}

/**
 * Give the host a chance to render/handle input before a (possibly long)
 * synchronous generator run, so a world with many procedural entities does
 * not block the main thread in one uninterrupted chain of microtasks.
 */
export function yieldToEventLoop(): Promise<void> {
  const g = globalThis as { scheduler?: { yield?: () => Promise<void> } };
  const scheduler = g.scheduler;
  if (scheduler && typeof scheduler.yield === 'function') return scheduler.yield();
  if (typeof setImmediate === 'function') return new Promise((resolve) => setImmediate(resolve));
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Normalized cache key of the output a procedural shape produces: params are
 * resolved against the generator spec (defaults, clamping, unknown keys
 * dropped) and the seed defaulted, so equivalent spellings share one key.
 * Render uses it to share GPU geometry exactly when `generate` shares output.
 */
export function proceduralOutputKey(shape: ProceduralShape, world: Pick<WorldDoc, 'generators'>): string {
  const seed = shape.seed ?? DEFAULT_SEED;
  const params = shape.params ?? {};
  const custom = customGenerator(world, shape.generator);
  if (custom) return generatorCacheKey({ ...shape, params: resolveParams(custom.params ?? {}, params), seed }, generatorSourceHash(custom));
  const gen = getBuiltinGenerator(shape.generator);
  return generatorCacheKey({ ...shape, params: gen ? resolveBuiltin(gen, params) : params, seed });
}

/**
 * Resolve a built-in generator's params: its own resolver when it has one
 * (nested architecture params; invalid input falls back to the raw params,
 * which the generator then rejects with a readable error), else the spec.
 */
export function resolveBuiltin(gen: BuiltinGenerator, params: Record<string, Json>): Record<string, Json> {
  if (gen.resolve) {
    try {
      return gen.resolve(params);
    } catch {
      return params;
    }
  }
  return resolveParams(gen.params, params);
}

/** Context handed to the off-thread runners of {@link generate}. */
export interface GenerateJob {
  /** Normalized output key ({@link proceduralOutputKey}): the identity of the output, for persistent caches. */
  key: string;
  /** Queue order (lower first); see {@link GenerateOptions.priority}. */
  priority: number;
}

/** Options of {@link generate}. */
export interface GenerateOptions {
  sandbox?: SandboxRunner;
  cache?: GeneratorCache;
  /**
   * Runs built-in generators elsewhere (e.g. a worker, so heavy sculptures never block the page). Its output must be
   * validated by the runner; a rejection falls back to running inline.
   */
  builtin?: (generator: string, params: Record<string, Json>, seed: number, job: GenerateJob) => Promise<GeneratorOutput>;
  /**
   * Runs custom generators instead of `sandbox.run` (e.g. through the sandbox with validation and post-processing in a
   * trusted worker, and a persistent cache). Its output must be validated by the runner. Params are resolved.
   */
  custom?: (def: GeneratorDef, params: Record<string, Json>, seed: number, job: GenerateJob) => Promise<GeneratorOutput>;
  /** Queue order of the run when it has to wait for a worker: lower first (e.g. the distance to the view). Default 0. */
  priority?: number;
}

const inflight = new WeakMap<GeneratorCache, Map<string, Promise<GeneratorOutput>>>();

function customGenerator(world: Pick<WorldDoc, 'generators'>, id: string): GeneratorDef | undefined {
  // Architecture generators are reserved: a custom generator may never shadow a building's walls.
  if (ARCH_GENERATOR_IDS.has(id)) return undefined;
  const gens = world?.generators;
  if (!gens || typeof gens !== 'object') return undefined;
  return Object.hasOwn(gens, id) ? gens[id] : undefined;
}

/**
 * Generate geometry for a procedural shape. A custom generator defined in
 * `world.generators` takes precedence over a built-in with the same id and
 * requires `opts.sandbox`. Results are cached (when a cache is given) and
 * concurrent identical requests share one run. Rejects on unknown ids,
 * sandbox failures or invalid output — callers typically fall back to
 * {@link fallbackOutput}.
 */
export async function generate(shape: ProceduralShape, world: Pick<WorldDoc, 'generators'>, opts: GenerateOptions = {}): Promise<GeneratorOutput> {
  const id = shape.generator;
  const seed = shape.seed ?? DEFAULT_SEED;
  const params = shape.params ?? {};
  const custom = customGenerator(world, id);
  const cache = opts.cache;
  const priority = typeof opts.priority === 'number' && Number.isFinite(opts.priority) ? opts.priority : 0;

  let key: string | undefined;
  let run: () => Promise<GeneratorOutput>;
  if (custom) {
    const sandbox = opts.sandbox;
    const hook = opts.custom;
    if (!sandbox && !hook) throw new Error(`custom generator "${id}" requires a sandbox runner`);
    const resolved = resolveParams(custom.params ?? {}, params);
    key = generatorCacheKey({ ...shape, params: resolved, seed }, generatorSourceHash(custom));
    const job: GenerateJob = { key, priority };
    run = async () => {
      if (hook) return hook(custom, resolved, seed, job);
      const out = await (sandbox as SandboxRunner).run(custom, resolved, seed, { priority });
      const v = validateOutput(out);
      if (!v.ok) throw new Error(`custom generator "${id}" returned invalid output: ${v.error}`);
      return v.output;
    };
  } else {
    const gen = getBuiltinGenerator(id);
    if (!gen) throw new Error(`unknown generator "${String(id).slice(0, 64)}"`);
    const resolved = resolveBuiltin(gen, params);
    key = generatorCacheKey({ ...shape, params: resolved, seed });
    const job: GenerateJob = { key, priority };
    const remote = opts.builtin;
    run = async () => {
      if (remote) {
        try {
          return await remote(gen.id, resolved, seed, job);
        } catch {
          // Worker unavailable, crashed or timed out: same result inline.
        }
      }
      await yieldToEventLoop();
      return gen.generate(resolved, createGeneratorApi(seed));
    };
  }

  if (!cache || key === undefined) return run();
  const hit = cache.get(key);
  if (hit) return hit;
  let pending = inflight.get(cache);
  if (!pending) {
    pending = new Map();
    inflight.set(cache, pending);
  }
  const existing = pending.get(key);
  if (existing) return existing;
  const k = key;
  const map = pending;
  const promise = run().then(
    (out) => {
      cache.set(k, out);
      map.delete(k);
      return out;
    },
    (err: unknown) => {
      map.delete(k);
      throw err;
    },
  );
  map.set(k, promise);
  return promise;
}
