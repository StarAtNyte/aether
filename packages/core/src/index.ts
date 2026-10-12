/**
 * @aether/core — the World IR and everything needed to create, validate,
 * patch, diff, query, version and summarize worlds. Headless and dependency-
 * free apart from zod; safe to run in Node, browsers and Web Workers.
 */
export * from './schema';

export { LIMITS, type Limits } from './limits';
export { isAllowedModelUrl, MODEL_URL_HTTPS_HOSTS, MAX_MODEL_URL_LENGTH } from './urls';
export { createWorld, validateWorld, checkIntegrity, WorldValidationError, type Issue } from './validate';
export { zodIssues, issueText, issuesText, findUnknownKeys } from './issues';
export { inspectUntrusted, isForbiddenKey, FORBIDDEN_KEYS, type GuardLimits, type GuardResult } from './guard';

export { applyPatches, type PatchResult, type PatchError, type ApplyOptions } from './patch/apply';
export { invertPatches, patchesBetween } from './patch/between';
export { deepMerge, diffForMerge, type MergeConfig } from './merge';

export { diffWorlds, isEmptyDiff, type WorldDiff } from './diff';

export {
  resolveSelector,
  isValidSelector,
  childrenOf,
  getEntity,
  worldTransform,
  readStateKey,
  compare,
  type WorldTransform,
} from './query';
export { stableStringify, deepEqual, hasOwn, isPlainObject } from './json';

export { History, type HistoryEntryInfo, type HistorySource } from './history';

export { rng, hashString } from './random';
export { eulerDegToQuat, quatToEulerDeg, quatMultiply, rotateVec3, type Quat } from './math';
export { slugify, uniqueId, isEntityId } from './ids';

export { summarizeWorld, type SummaryOptions } from './summary';
export { Emitter } from './emitter';
