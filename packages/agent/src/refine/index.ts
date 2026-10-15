/**
 * Small, precise edits by prompt: parse → resolve → minimal patch → diff.
 * See docs/CONTRACTS.md ("Fine edits").
 */
export { planFineEdit, EMPTY_MEMORY, makeParamCatalog, makeAddable, type FineCatalogs, type FineEditInput, type FineEditResult, type RefineMemory, type DeclineReason } from './plan';
export { parseEdit, type ParsedEdit } from './parse';
export type { Command, Ref, Look, EnvIntent } from './command';
export { resolveRef, type Resolution, type ResolveContext } from './resolve';
export { sceneOf, SceneIndex, type SceneItem } from './scene';
export { worldChanges, changedEntityIds, type WorldChange } from './changes';
export { describeChanges, diffLineText, type DiffLine } from './describe';
export { classifyScope, auditPatches, UNTARGETED_LIMIT, type PatchAudit, type RequestScope } from './guard';
export type { Question } from './ops-types';
