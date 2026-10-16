/**
 * Shared fixtures for render tests: world builders and a controllable fake
 * geometry source (deferred procedural generation, failure injection).
 */
import { applyPatches, createWorld } from '@aether/core';
import { fallbackOutput, primitiveOutput } from '@aether/procgen';
import { primitiveKey } from '../src/geometry/procgen-source';
import { GeometryCache } from '../src/geometry/buffer-geometry';
import { MaterialCache } from '../src/materials/material-cache';
import { SceneSync } from '../src/sync/scene-sync';
/** World with the given entities (other fields default). */
export function world(entities, extra = {}) {
    const map = {};
    for (const e of entities)
        map[e.id] = e;
    return createWorld({ ...extra, entities: map });
}
/** Apply patches and fail loudly on errors. */
export function patch(w, patches) {
    const r = applyPatches(w, patches);
    if (r.errors.length > 0)
        throw new Error(JSON.stringify(r.errors));
    return r.world;
}
/** Box primitive entity. */
export function box(id, position = [0, 0.5, 0], extra = {}) {
    return { id, transform: { position }, shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, ...extra };
}
/** Three-part fake generator output (exercises multi-part materials). */
export function multiPartOutput() {
    const a = primitiveOutput({ kind: 'primitive', primitive: 'box', size: [1, 2, 1] }, { preset: 'bark' });
    const b = primitiveOutput({ kind: 'primitive', primitive: 'sphere', size: [2, 2, 2] }, { preset: 'leaf' });
    return { ...a, parts: [...a.parts, ...b.parts] };
}
/**
 * Fake geometry source. Primitives use the real procgen output. Procedural
 * shapes resolve immediately with `multiPartOutput()` unless `defer` is set,
 * fail when the generator id starts with "fail".
 */
export class FakeSource {
    defer = false;
    pending = [];
    proceduralCalls = 0;
    primitive(shape) {
        return { key: primitiveKey(shape), output: primitiveOutput(shape) };
    }
    procedural(shape) {
        this.proceduralCalls++;
        const key = `proc|${shape.generator}|${JSON.stringify(shape.params)}|${shape.seed ?? 1}`;
        if (shape.generator.startsWith('fail'))
            return Promise.reject(new Error('boom'));
        if (!this.defer)
            return Promise.resolve({ key, output: multiPartOutput() });
        return new Promise((resolve, reject) => this.pending.push({ resolve, reject })).then((output) => ({ key, output }));
    }
    fallback(reason) {
        return { key: 'fallback', output: fallbackOutput(reason) };
    }
    /** Resolve every deferred generation. */
    flush() {
        for (const d of this.pending.splice(0))
            d.resolve(multiPartOutput());
    }
}
/** SceneSync wired to fresh caches and a fake source. */
export function makeSync(opts = {}) {
    const source = new FakeSource();
    const materials = new MaterialCache();
    const geometries = new GeometryCache();
    const sync = new SceneSync({ source, materials, geometries, ...opts });
    return { sync, source, materials, geometries };
}
/** Let pending microtasks/promise chains run. */
export async function tick(times = 5) {
    for (let i = 0; i < times; i++)
        await Promise.resolve();
}
