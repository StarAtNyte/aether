/**
 * @aether/logic — deterministic gameplay runtime for Aether worlds:
 * built-in behaviors, world rules and sandboxed custom scripts.
 *
 * Headless (no three.js, no DOM): it talks to physics/render only through
 * {@link LogicHost}, so it runs in browsers, Web Workers and Node tests.
 */
export { EMPTY_INPUT, } from './types';
export { LogicRuntime } from './runtime';
export { MAX_LOG_ENTRIES, MAX_LIVE_SPAWNED, MAX_SCRIPT_CALLS_PER_TICK, MAX_SPAWNS_PER_TICK } from './engine';
export { MAX_EMIT_DEPTH, MAX_EVENT_QUEUE, MAX_FIRINGS_PER_TICK, describeTrigger } from './rules';
export { BEHAVIOR_CATALOG, RULE_DOCS } from './docs';
export { createScriptRunner, initScripting, isScriptingReady, scriptHeapUsage } from './scripting/lazy';
export { MAX_ABANDONED_RUNTIMES, SCRIPT_HEAP_BUDGET_BYTES } from './scripting/config';
export { MAX_INTENTS_PER_CALL, validateIntents } from './scripting/intents';
export { SCRIPT_API_DTS } from './scripting/api';
export { normalizeKey } from './keys';
export { NpcSystem, MAX_BUBBLES, MAX_NPCS } from './npc/system';
export { DialogueSession } from './npc/dialogue';
export { NavGrid, NAV_MAX_PATH } from './npc/nav';
export { buildNavFor, collectObstacles } from './npc/obstacles';
export { resolveNpc, defaultTransitions, evalCond, inHours } from './npc/graph';
export { analyzeNpcs } from './npc/analyze';
export { zoneShapeOf, insideZone } from './bounds';
