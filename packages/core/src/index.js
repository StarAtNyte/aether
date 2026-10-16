/**
 * @aether/core — the World IR and everything needed to create, validate,
 * patch, diff, query, version and summarize worlds. Headless and dependency-
 * free apart from zod; safe to run in Node, browsers and Web Workers.
 */
import './zod-config';
export * from './schema';
export { LIMITS } from './limits';
export { isAllowedModelUrl, MODEL_URL_HTTPS_HOSTS, MAX_MODEL_URL_LENGTH } from './urls';
export { createWorld, validateWorld, checkIntegrity, WorldValidationError, meshUsers, meshTotalBytes, scatterCount } from './validate';
export { encodeMesh, encodeMeshUpdate, decodeMesh, decodeMeshCached, cloneMeshData, checkMeshData, checkMeshAssetSizes, meshAssetBytes, meshByteSize, meshBounds, srgbToLinear, linearToSrgb, MAX_MESH_COORDINATE, } from './mesh/codec';
export { encodeBase64, decodeBase64Into, encodeChunks, decodeChunks, BASE64_CHUNK_CHARS } from './mesh/base64';
export { userEditMarks, updatePaths, overlappingPaths } from './edits';
export { zodIssues, issueText, issuesText, findUnknownKeys } from './issues';
export { inspectUntrusted, isForbiddenKey, FORBIDDEN_KEYS } from './guard';
export { applyPatches } from './patch/apply';
export { invertPatches, patchesBetween } from './patch/between';
export { deepMerge, diffForMerge } from './merge';
export { isBodylessPerson, characterFor, bodilessPeople, characterPatches } from './people';
export { diffWorlds, isEmptyDiff } from './diff';
export * from './voxel-ids';
export { voxelEditsVolume, checkVoxelTerrain } from './patch/voxel-ops';
export { resolveSelector, isValidSelector, childrenOf, getEntity, worldTransform, readStateKey, compare, } from './query';
export { stableStringify, deepEqual, hasOwn, isPlainObject } from './json';
export { History } from './history';
export { rng, hashString } from './random';
export { eulerDegToQuat, quatToEulerDeg, quatMultiply, rotateVec3 } from './math';
export { slugify, uniqueId, isEntityId } from './ids';
export { riverMeander, riverHalfWidth, canyonMeander, canyonHalfWidth } from './river';
export { summarizeWorld } from './summary';
export { Emitter } from './emitter';
export { findStandIns, VOXEL_PERSON_ASSET_IDS, CUBE_PET_ASSET_IDS } from './standins';
