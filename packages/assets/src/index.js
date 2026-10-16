/**
 * @aether/assets — the curated asset library and user imports.
 *
 * - {@link loadCatalog} / {@link getCatalog}: the generated catalog of CC0 models,
 *   HDRIs and procedural hero generators (lazy, ~100 KB JSON).
 * - {@link searchAssets}: synonym-aware ranked search ("couch" → sofa).
 * - {@link assetInfo}: size, collider, URLs and clips of any asset id.
 * - {@link selectLod}: level-of-detail choice by projected screen size.
 * - {@link creditsFor}: attribution for a world's assets.
 * - {@link importUserAsset}: validation of imported GLB/glTF, images and HDRIs.
 */
export * from './schema';
export { SYNONYM_GROUPS, synonymsOf, canonicalTags } from './synonyms';
export { searchAssets, bestAsset, tokenize } from './search';
export { selectLod, lodDistances, screenFraction, LOD_SCREEN_FRACTIONS } from './lod';
export { loadCatalog, getCatalog, setCatalog, catalogEntry, libraryUrl } from './registry';
export { assetInfo, assetShapeSize, effectiveAssetId, fitScale, pickRoles, registerUserAsset, unregisterUserAsset, userAsset, userAssets, onUserAssetsChanged, POSTER_WIDTH, POSTER_DEPTH, } from './info';
export { creditsFor, creditsText, worldAssetIds } from './credits';
export { catalogSummary } from './summary';
export { validateGltf, writeGlb, sanitizeName, DEFAULT_GLTF_LIMITS, SUPPORTED_GLTF_EXTENSIONS } from './import/glb';
export { validateImage, validateHdr, DEFAULT_IMAGE_LIMITS, DEFAULT_HDR_LIMITS } from './import/image';
export { importUserAsset, sniffAssetKind, sha256Hex, assetNameFromFile, isUserAssetId, USER_ASSET_ID, UserAssetMeta, UserAssetKind, } from './user';
export { createTrellisProvider, isAllowedEndpoint } from './image-to-3d';
export * from './characters';
