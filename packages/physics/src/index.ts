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
} from './types';
export { PhysicsWorld, PHYSICS_LIMITS } from './world';
export { CharacterController, type CharacterInput, type CharacterOptions } from './character';
export { settle, SETTLE_LIMITS } from './settle';
export { diagnose, findOverlaps, DIAGNOSE_LIMITS, type OverlapPair } from './diagnose';
export { verify, VERIFY_LIMITS, VERIFY_SLICE_MS, type VerifyOptions } from './verify';
export { summarizeReport, REPORT_LIMITS } from './report';
export { scatterInstances, type ScatterInstance } from './scatter';
export { clearColliderCache } from './source';
