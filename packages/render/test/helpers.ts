/**
 * Shared fixtures for render tests: world builders and a controllable fake
 * geometry source (deferred procedural generation, failure injection).
 */
import { applyPatches, createWorld, type EntityInput, type PatchInput, type PrimitiveShape, type ProceduralShape, type WorldDoc, type WorldDocInput } from '@aether/core';
import { fallbackOutput, primitiveOutput } from '@aether/procgen';
import type { GeneratorOutput, GeometrySource, KeyedOutput } from '../src/types';
import { primitiveKey } from '../src/geometry/procgen-source';
import { GeometryCache } from '../src/geometry/buffer-geometry';
import { MaterialCache } from '../src/materials/material-cache';
import { SceneSync, type SceneSyncOptions } from '../src/sync/scene-sync';

/** World with the given entities (other fields default). */
export function world(entities: EntityInput[], extra: WorldDocInput = {}): WorldDoc {
  const map: Record<string, EntityInput> = {};
  for (const e of entities) map[e.id] = e;
  return createWorld({ ...extra, entities: map });
}

/** Apply patches and fail loudly on errors. */
export function patch(w: WorldDoc, patches: PatchInput[]): WorldDoc {
  const r = applyPatches(w, patches);
  if (r.errors.length > 0) throw new Error(JSON.stringify(r.errors));
  return r.world;
}

/** Box primitive entity. */
export function box(id: string, position: [number, number, number] = [0, 0.5, 0], extra: Partial<EntityInput> = {}): EntityInput {
  return { id, transform: { position }, shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, ...extra };
}

/** Three-part fake generator output (exercises multi-part materials). */
export function multiPartOutput(): GeneratorOutput {
  const a = primitiveOutput({ kind: 'primitive', primitive: 'box', size: [1, 2, 1] }, { preset: 'bark' });
  const b = primitiveOutput({ kind: 'primitive', primitive: 'sphere', size: [2, 2, 2] }, { preset: 'leaf' });
  return { ...a, parts: [...a.parts, ...b.parts] };
}

interface Deferred {
  resolve: (o: GeneratorOutput) => void;
  reject: (e: Error) => void;
}

/**
 * Fake geometry source. Primitives use the real procgen output. Procedural
 * shapes resolve immediately with `multiPartOutput()` unless `defer` is set,
 * fail when the generator id starts with "fail".
 */
export class FakeSource implements GeometrySource {
  defer = false;
  readonly pending: Deferred[] = [];
  proceduralCalls = 0;

  primitive(shape: PrimitiveShape): KeyedOutput {
    return { key: primitiveKey(shape), output: primitiveOutput(shape) };
  }

  procedural(shape: ProceduralShape): Promise<KeyedOutput> {
    this.proceduralCalls++;
    const key = `proc|${shape.generator}|${JSON.stringify(shape.params)}|${shape.seed ?? 1}`;
    if (shape.generator.startsWith('fail')) return Promise.reject(new Error('boom'));
    if (!this.defer) return Promise.resolve({ key, output: multiPartOutput() });
    return new Promise<GeneratorOutput>((resolve, reject) => this.pending.push({ resolve, reject })).then((output) => ({ key, output }));
  }

  fallback(reason: string): KeyedOutput {
    return { key: 'fallback', output: fallbackOutput(reason) };
  }

  /** Resolve every deferred generation. */
  flush(): void {
    for (const d of this.pending.splice(0)) d.resolve(multiPartOutput());
  }
}

/** SceneSync wired to fresh caches and a fake source. */
export function makeSync(opts: Partial<SceneSyncOptions> = {}): { sync: SceneSync; source: FakeSource; materials: MaterialCache; geometries: GeometryCache } {
  const source = new FakeSource();
  const materials = new MaterialCache();
  const geometries = new GeometryCache();
  const sync = new SceneSync({ source, materials, geometries, ...opts });
  return { sync, source, materials, geometries };
}

/** Let pending microtasks/promise chains run. */
export async function tick(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
