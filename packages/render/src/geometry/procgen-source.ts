/**
 * Default {@link GeometrySource}: primitives and procedural shapes through
 * `@aether/procgen`, so render, physics and the agent all see identical
 * geometry. Custom (LLM-written) generators run only inside the sandbox
 * runner supplied by the host.
 */
import { stableStringify, type Json, type PrimitiveShape, type ProceduralShape, type WorldDoc } from '@aether/core';
import { fallbackOutput, generate, GeneratorCache, primitiveOutput, proceduralOutputKey, type GenerateJob, type GenerateOptions } from '@aether/procgen';
import type { GeneratorOutput, GeometrySource, KeyedOutput, SandboxRunner } from '../types';
import type { GenPool } from './gen-pool';

/** Options of {@link createProcgenGeometrySource}. */
export interface ProcgenSourceOptions {
  /** Runs custom generators from `world.generators`. Without it they fall back. */
  sandbox?: SandboxRunner;
  /** Shared generator output cache (LRU). */
  cache?: GeneratorCache;
  /** Max memoized primitive outputs (default 512). */
  maxPrimitives?: number;
  /** Off-thread runner for built-in generators (falls back to inline on failure). Ignored when `pool` is given. */
  builtin?: (generator: string, params: Record<string, Json>, seed: number, job: GenerateJob) => Promise<GeneratorOutput>;
  /**
   * Generation lanes with the persistent geometry cache: built-in generators run there, and custom generators'
   * output is validated and prepared there (the sandbox still runs the source).
   */
  pool?: GenPool;
}

/** Stable key of a primitive shape's geometry. */
export function primitiveKey(shape: PrimitiveShape): string {
  return `prim|${shape.primitive}|${stableStringify(shape.size)}`;
}

/** Create the procgen-backed geometry source. */
export function createProcgenGeometrySource(opts: ProcgenSourceOptions = {}): GeometrySource {
  const cache = opts.cache ?? new GeneratorCache(256);
  const maxPrimitives = Math.max(1, opts.maxPrimitives ?? 512);
  const pool = opts.pool;
  const sandbox = opts.sandbox;
  const base: GenerateOptions = {
    cache,
    ...(sandbox ? { sandbox } : {}),
    ...(pool ? { builtin: (g, p, seed, job) => pool.builtin(g, p, seed, job) } : opts.builtin ? { builtin: opts.builtin } : {}),
    ...(pool && sandbox ? { custom: (def, p, seed, job) => pool.custom(sandbox, def, p, seed, job) } : {}),
  };
  const primitives = new Map<string, KeyedOutput>();
  let fallback: KeyedOutput | undefined;

  return {
    primitive(shape: PrimitiveShape): KeyedOutput {
      const key = primitiveKey(shape);
      const hit = primitives.get(key);
      if (hit) return hit;
      const keyed: KeyedOutput = { key, output: primitiveOutput(shape) };
      if (primitives.size >= maxPrimitives) {
        const oldest = primitives.keys().next();
        if (!oldest.done) primitives.delete(oldest.value);
      }
      primitives.set(key, keyed);
      return keyed;
    },

    async procedural(shape: ProceduralShape, world: Pick<WorldDoc, 'generators'>, run?: { priority?: number }): Promise<KeyedOutput> {
      // Same normalization as generate(): equivalent spellings share one GPU geometry.
      const key = `proc|${proceduralOutputKey(shape, world)}`;
      const output = await generate(shape, world, run?.priority !== undefined ? { ...base, priority: run.priority } : base);
      return { key, output };
    },

    fallback(reason: string): KeyedOutput {
      // One shared placeholder geometry; the reason is logged by the caller.
      fallback ??= { key: 'fallback', output: fallbackOutput(reason) };
      return fallback;
    },
  };
}
