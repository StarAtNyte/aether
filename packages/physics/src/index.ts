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
export {
  GROUND_ID,
  type BodyState,
  type ColliderProvider,
  type Diagnostic,
  type LogicHook,
  type PhysicsEvent,
  type PhysicsStats,
  type PhysicsWorldOptions,
  type Quat,
  type RaycastHit,
  type SettleReport,
  type TestResult,
  type VerifyReport,
  type VerifyTrace,
} from './types';
export { PhysicsWorld, PHYSICS_LIMITS } from './world';
export { VoxelTerrainColliders, brickBoxes, BRICK, MAX_TERRAIN_BRICKS, MAX_BRICK_BOXES, type VoxelSolidSource, type CellBox } from './voxel-terrain';
export { CharacterController, CHARACTER_FEEL, type CharacterFeel, type CharacterInput, type CharacterOptions } from './character';
export { settle, SETTLE_LIMITS } from './settle';
export { diagnose, findOverlaps, DIAGNOSE_LIMITS, type OverlapPair } from './diagnose';
export { verify, shardIndices, VerifyAbortedError, VERIFY_LIMITS, VERIFY_SLICE_MS, type VerifyOptions } from './verify';
export { summarizeReport, REPORT_LIMITS } from './report';
export { TraceRecorder, TRACE_LIMITS, type TraceOptions } from './trace';
export { scatterInstances, type ScatterInstance } from './scatter';
export { clearColliderCache, colliderCacheStats, MAX_COLLIDER_CACHE_BYTES } from './source';
export { entityBounds, type Aabb } from './bounds';
export { yieldToHost } from './yield';
export { checkPlayability, deriveStaticColliders, makePlayable, playedOnFoot, PLAYABILITY_LIMITS, type PlayabilityCode, type PlayabilityIssue, type PlayabilityOptions, type PlayabilityReport, type PlayableResult } from './playability';
export { assetColliderDescs, assetGeneratorShape, usesAssets, ensureAssetCatalog } from './asset-colliders';
export { entityColliderBounds, entityWorldBounds } from './bounds';
