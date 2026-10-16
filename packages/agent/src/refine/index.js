/**
 * Small, precise edits by prompt: parse → resolve → minimal patch → diff.
 * See docs/CONTRACTS.md ("Fine edits").
 */
export { planFineEdit, EMPTY_MEMORY, makeParamCatalog, makeAddable } from './plan';
export { parseEdit } from './parse';
export { resolveRef } from './resolve';
export { sceneOf, SceneIndex } from './scene';
export { worldChanges, changedEntityIds } from './changes';
export { describeChanges, diffLineText } from './describe';
export { classifyScope, auditPatches, UNTARGETED_LIMIT } from './guard';
