import { isUserAssetId } from '@aether/assets';
import { colliderNumbers, MAX_COLLIDER_ENTITIES, MAX_COLLIDER_FLOATS, MAX_COLLIDERS_PER_ENTITY } from './protocol';
/** True when physics cannot derive this entity's colliders from the document alone. */
export function needsRendererColliders(world, e) {
    if (e.template)
        return false;
    if (e.shape.kind === 'model')
        return true;
    // Library assets are resolved in the worker from the catalog; user imports only exist on this page.
    if (e.shape.kind === 'asset')
        return isUserAssetId(e.shape.id);
    return e.shape.kind === 'procedural' && Object.hasOwn(world.generators, e.shape.generator);
}
/** Collect `[entityId, colliders]` pairs for a worker request (never throws). */
export function workerColliders(world, provider) {
    const out = [];
    if (!provider)
        return out;
    let numbers = 0;
    for (const id of Object.keys(world.entities)) {
        if (out.length >= MAX_COLLIDER_ENTITIES)
            break;
        const e = world.entities[id];
        if (!e || !needsRendererColliders(world, e))
            continue;
        let descs;
        try {
            descs = provider(e);
        }
        catch {
            descs = undefined;
        }
        if (!Array.isArray(descs) || descs.length === 0)
            continue;
        const list = descs.slice(0, MAX_COLLIDERS_PER_ENTITY);
        const n = colliderNumbers([[id, list]]);
        if (numbers + n > MAX_COLLIDER_FLOATS)
            continue;
        numbers += n;
        out.push([id, list]);
    }
    return out;
}
