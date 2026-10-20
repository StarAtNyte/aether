/**
 * @aether/core — the World IR and everything needed to create, validate,
 * patch, diff, query, version and summarize worlds. Headless and dependency-
 * free apart from zod; safe to run in Node, browsers and Web Workers.
 */
import './zod-config';
export * from './schema';

export { LIMITS, type Limits } from './limits';
export { isAllowedModelUrl, MODEL_URL_HTTPS_HOSTS, MAX_MODEL_URL_LENGTH } from './urls';
export { createWorld, validateWorld, checkIntegrity, WorldValidationError, meshUsers, meshTotalBytes, scatterCount, type Issue } from './validate';
export {
  encodeMesh,
  encodeMeshUpdate,
  decodeMesh,
  decodeMeshCached,
  cloneMeshData,
  checkMeshData,
  checkMeshAssetSizes,
  meshAssetBytes,
  meshByteSize,
  meshBounds,
  srgbToLinear,
  linearToSrgb,
  MAX_MESH_COORDINATE,
  type MeshData,
  type EncodeMeshOptions,
} from './mesh/codec';
export { encodeBase64, decodeBase64Into, encodeChunks, decodeChunks, BASE64_CHUNK_CHARS } from './mesh/base64';
export { userEditMarks, updatePaths, overlappingPaths, type UserEditMarks, type CommitLike } from './edits';
export { zodIssues, issueText, issuesText, findUnknownKeys } from './issues';
export { inspectUntrusted, isForbiddenKey, FORBIDDEN_KEYS, type GuardLimits, type GuardResult } from './guard';

export { applyPatches, type PatchResult, type PatchError, type ApplyOptions } from './patch/apply';
export { invertPatches, patchesBetween } from './patch/between';
export { deepMerge, diffForMerge, type MergeConfig } from './merge';

export { isBodylessPerson, characterFor, bodilessPeople, characterPatches } from './people';
export { diffWorlds, isEmptyDiff, type WorldDiff } from './diff';
export * from './voxel-ids';
export { voxelEditsVolume, checkVoxelTerrain, type HintBudget } from './patch/voxel-ops';

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
export { riverMeander, riverHalfWidth, canyonMeander, canyonHalfWidth, streamCourse } from './river';

export { summarizeEntity, summarizeWorld, type SummaryOptions } from './summary';
export { dependencyIndex, carryPatches, isSatellite, footprintRadius, type Dependency, type DependencyIndex, type DependencyWhy, type CarriedDependent } from './dependents';
export { Emitter } from './emitter';

export { findStandIns, VOXEL_PERSON_ASSET_IDS, CUBE_PET_ASSET_IDS, type StandIn, type StandInKind } from './standins';
export * from './water-bodies';
export * from './life';
