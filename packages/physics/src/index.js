/**
 * @aether/physics — Rapier (`@dimforge/rapier3d-compat` 0.21) simulation of
 * the Aether World IR. Headless-capable (Node, browsers, Web Workers): no
 * three.js, no DOM.
 *
 * Provides the live simulation (`PhysicsWorld`), a player capsule
 * (`CharacterController`), "drop & freeze" settling (`settle`), static scene
 * checks (`diagnose`) and headless test verification (`verify`).
 */
export { initPhysics, isPhysicsReady } from './rapier';
export { GROUND_ID, } from './types';
export { PhysicsWorld, PHYSICS_LIMITS } from './world';
export { VoxelTerrainColliders, brickBoxes, BRICK, MAX_TERRAIN_BRICKS, MAX_BRICK_BOXES } from './voxel-terrain';
export { CharacterController, CHARACTER_FEEL } from './character';
export { settle, SETTLE_LIMITS } from './settle';
export { diagnose, findOverlaps, DIAGNOSE_LIMITS } from './diagnose';
export { verify, shardIndices, VerifyAbortedError, VERIFY_LIMITS, VERIFY_SLICE_MS } from './verify';
export { summarizeReport, REPORT_LIMITS } from './report';
export { TraceRecorder, TRACE_LIMITS } from './trace';
export { scatterInstances } from './scatter';
export { clearColliderCache, colliderCacheStats, MAX_COLLIDER_CACHE_BYTES } from './source';
export { entityBounds } from './bounds';
export { yieldToHost } from './yield';
export { assetColliderDescs, assetGeneratorShape, usesAssets, ensureAssetCatalog } from './asset-colliders';
export { entityColliderBounds, entityWorldBounds } from './bounds';
