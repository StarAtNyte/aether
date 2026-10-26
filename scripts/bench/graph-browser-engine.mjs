// Canonical Vite resolution keeps Three and TSL on the same module instance.
export * as T from 'three/webgpu';
export * as C from 'three';
export * as S from 'three/tsl';
export { parallelPrograms } from '../../packages/render/src/gpu/parallel-programs';
export { preparePresentation } from '../../packages/render/src/gpu/presentation';

export { deferRenderPreparation } from '../../packages/render/src/gpu/render-preparation';

export { prepareCompileTextures } from '../../packages/render/src/gpu/compile-textures';

export { setPositionBounds } from '../../packages/render/src/geometry/position-bounds';

export { AssetSkinCache } from '../../packages/render/src/gpu/asset-skin-cache';
