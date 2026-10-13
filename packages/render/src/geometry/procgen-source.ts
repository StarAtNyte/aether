/**
 * Default {@link GeometrySource}: primitives and procedural shapes through
 * `@aether/procgen`, so render, physics and the agent all see identical
 * geometry. Custom (LLM-written) generators run only inside the sandbox
 * runner supplied by the host.
 */
import { stableStringify, type Json, type PrimitiveShape, type ProceduralShape, type WorldDoc } from '@aether/core';
import { fallbackOutput, generate, GeneratorCache, primitiveOutput, proceduralOutputKey } from '@aether/procgen';
import type { GeneratorOutput, GeometrySource, KeyedOutput, SandboxRunner } from '../types';

/** Options of {@link createProcgenGeometrySource}. */
export interface ProcgenSourceOptions {
  /** Runs custom generators from `world.generators`. Without it they fall back. */
  sandbox?: SandboxRunner;
  /** Shared generator output cache (LRU). */
  cache?: GeneratorCache;
  /** Max memoized primitive outputs (default 512). */
  maxPrimitives?: number;
  /** Off-thread runner for built-in generators (falls back to inline on failure). */
  builtin?: (generator: string, params: Record<string, Json>, seed: number) => Promise<GeneratorOutput>;
}

/** Stable key of a primitive shape's geometry. */
export function primitiveKey(shape: PrimitiveShape): string {
  return `prim|${shape.primitive}|${stableStringify(shape.size)}`;
}

/** Create the procgen-backed geometry source. */
export function createProcgenGeometrySource(opts: ProcgenSourceOptions = {}): GeometrySource {
  const cache = opts.cache ?? new GeneratorCache(256);
  const maxPrimitives = Math.max(1, opts.maxPrimitives ?? 512);
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

    async procedural(shape: ProceduralShape, world: Pick<WorldDoc, 'generators'>): Promise<KeyedOutput> {
      // Same normalization as generate(): equivalent spellings share one GPU geometry.
      const key = `proc|${proceduralOutputKey(shape, world)}`;
      const output = await generate(shape, world, { cache, ...(opts.sandbox ? { sandbox: opts.sandbox } : {}), ...(opts.builtin ? { builtin: opts.builtin } : {}) });
      return { key, output };
    },

    fallback(reason: string): KeyedOutput {
      // One shared placeholder geometry; the reason is logged by the caller.
      fallback ??= { key: 'fallback', output: fallbackOutput(reason) };
      return fallback;
    },
  };
}
