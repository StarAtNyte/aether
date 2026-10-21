/**
 * @aether/logic — deterministic gameplay runtime for Aether worlds:
 * built-in behaviors, world rules and sandboxed custom scripts.
 *
 * Headless (no three.js, no DOM): it talks to physics/render only through
 * {@link LogicHost}, so it runs in browsers, Web Workers and Node tests.
 */
export {
  EMPTY_INPUT,
  type FeedbackEvent,
  type BehaviorCatalogEntry,
  type BehaviorParamSpec,
  type InputState,
  type LogEntry,
  type LogicHost,
  type PhysicsEventLike,
  type QuatTuple,
  type ScriptDiagnostic,
  type ScriptIntent,
  type ScriptPrepared,
  type ScriptRunner,
  type ScriptSnapshot,
} from './types';
export { LogicRuntime, type LogicRuntimeOptions } from './runtime';
export type { GameStatus } from './engine';
export { MAX_LOG_ENTRIES, MAX_LIVE_SPAWNED, MAX_SCRIPT_CALLS_PER_TICK, MAX_SPAWNS_PER_TICK } from './engine';
export { MAX_EMIT_DEPTH, MAX_EVENT_QUEUE, MAX_FIRINGS_PER_TICK, describeTrigger } from './rules';
export { BEHAVIOR_CATALOG, RULE_DOCS } from './docs';
export { createScriptRunner, initScripting, isScriptingReady, scriptHeapUsage } from './scripting/lazy';
export { MAX_ABANDONED_RUNTIMES, SCRIPT_HEAP_BUDGET_BYTES, type ManagedScriptRunner, type ScriptRunnerOptions } from './scripting/config';
export { MAX_INTENTS_PER_CALL, validateIntents, type IntentValidation } from './scripting/intents';
export { SCRIPT_API_DTS } from './scripting/api';
export { normalizeKey } from './keys';
export { NpcSystem, MAX_BUBBLES, MAX_NPCS, type NpcBubble, type TalkPrompt } from './npc/system';
export type { NpcInfo } from './npc/brain';
export type { DialogueView, DialogueHost } from './npc/dialogue';
export { DialogueSession } from './npc/dialogue';
export { NavGrid, NAV_MAX_PATH, type Obstacle } from './npc/nav';
export { buildNavFor, collectObstacles, isTerrainish, terrainSampler, type BoundsProvider } from './npc/obstacles';
export { resolveNpc, defaultTransitions, evalCond, inHours, type NpcEff, type Senses } from './npc/graph';
export { analyzeNpcs, type NpcAnalysis } from './npc/analyze';
export { zoneShapeOf, insideZone, type ZoneShape } from './bounds';
