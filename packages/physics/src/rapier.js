/**
 * Single place that loads the Rapier WASM module. `initPhysics()` is
 * idempotent and safe to call concurrently; everything else in this package
 * goes through {@link rapier} which fails loudly if it was never awaited.
 */
import RAPIER from '@dimforge/rapier3d-compat';
let ready = false;
let pending = null;
/**
 * Initialize the Rapier WASM runtime. Idempotent: concurrent and repeated
 * calls share one initialization. Works in Node, browsers and Web Workers.
 */
export async function initPhysics() {
    if (ready)
        return;
    pending ??= RAPIER.init().then(() => {
        ready = true;
    }, (err) => {
        pending = null;
        throw err;
    });
    await pending;
}
/** True once {@link initPhysics} has resolved. */
export function isPhysicsReady() {
    return ready;
}
/**
 * The initialized Rapier namespace.
 * @throws Error when {@link initPhysics} has not completed yet.
 */
export function rapier() {
    if (!ready)
        throw new Error('@aether/physics: call `await initPhysics()` before using the physics API');
    return RAPIER;
}
