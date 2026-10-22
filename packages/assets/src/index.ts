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
export { searchAssets, bestAsset, tokenize, type AssetQuery, type AssetHit } from './search';
export { selectLod, lodDistances, screenFraction, LOD_SCREEN_FRACTIONS } from './lod';
export { loadCatalog, getCatalog, setCatalog, catalogEntry, libraryUrl } from './registry';
export {
  TextureVariants,
  TextureVariant,
  VariantTexture,
  VariantPath,
  loadTextureVariants,
  getTextureVariants,
  setTextureVariants,
  textureVariantUrl,
  textureVariantPath,
} from './texture-variants';
export {
  assetInfo,
  assetShapeSize,
  effectiveAssetId,
  fitScale,
  pickRoles,
  registerUserAsset,
  unregisterUserAsset,
  userAsset,
  userAssets,
  onUserAssetsChanged,
  POSTER_WIDTH,
  POSTER_DEPTH,
  type AssetInfo,
  type UserAssetEntry,
} from './info';
export {
  TEXTURE_LIMITS,
  TEXTURE_MAPS,
  TEXTURE_PROVENANCE_LABEL,
  isTextureId,
  textureFileName,
  registerTextureSet,
  unregisterTextureSet,
  textureSet,
  textureSets,
  onTextureSetsChanged,
  clearTextureSets,
  pickTextureTier,
  registerBundledTextureSets,
  validateTextureMap,
  type TextureMapName,
  type TextureSetFiles,
  type TextureSetEntry,
} from './texture-sets';
export { creditsFor, creditsText, worldAssetIds, type Credit } from './credits';
export { catalogSummary } from './summary';
export { validateGltf, writeGlb, sanitizeName, DEFAULT_GLTF_LIMITS, SUPPORTED_GLTF_EXTENSIONS, type GltfLimits, type GltfReport, type GltfResult } from './import/glb';
export { validateImage, validateHdr, DEFAULT_IMAGE_LIMITS, DEFAULT_HDR_LIMITS, type ImageInfo, type ImageFormat, type ImageLimits, type ImageResult, type HdrResult } from './import/image';
export {
  importUserAsset,
  sniffAssetKind,
  sha256Hex,
  assetNameFromFile,
  isUserAssetId,
  USER_ASSET_ID,
  UserAssetMeta,
  UserAssetKind,
  type UserAssetImport,
  type UserAssetResult,
} from './user';
export { createTrellisProvider, isAllowedEndpoint, type ImageTo3DProvider, type TrellisOptions } from './image-to-3d';

export * from './characters';
