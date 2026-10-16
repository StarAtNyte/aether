/**
 * @aether/voxel — block worlds for Aether: data-driven block registry,
 * palette-compressed chunks, seeded terrain (biomes, caves, ores, trees),
 * document edits (boxes, structures, pixel art …), sky/block light, greedy
 * meshing with ambient occlusion, worker pool + chunk streaming, swept
 * voxel collision, ray casting and compact saves. Pure TypeScript: meshes
 * are typed arrays; three.js integration lives in `@aether/render`.
 * The game kit (items, inventory, crafting, survival, mobs) is
 * `@aether/voxel/game`.
 */
export * from './constants';
export { BlockRegistry, BUILTIN_BLOCKS, RENDER_CODE, MAX_TILES, shade, specFromDef } from './blocks';
export { ChunkData } from './chunk';
export { SimplexNoise, hash2, hash3, unit, smoothstep } from './noise';
export { TerrainGenerator, BIOMES, FLAT_HEIGHT } from './terrain';
export { compileEdits, applyEdits } from './edits';
export { buildStructure, rotateModel, KEEP, CARVE, FOUNDATION } from './structures';
export { textRows, glyph } from './font';
export { LightVolume, REGION, REGION_LAYER, REGION_VOLUME, regionIndex } from './light';
export { ChunkMesher, HEIGHTS_LENGTH, LIQUID_SURFACE } from './mesher';
export { VoxelJobContext, terrainIdentity, identityKey, saveIdentity, outsideBorder } from './jobs';
export { pbrBinding, buildTileTable, hexLinear, srgbToLinear, PBR_CLASS, TILE_TABLE_ROWS } from './pbr';
export { buildAtlas, paintTile, tileAverage, ATLAS_SIZE, ATLAS_TILES, ATLAS_MAX_LOD, TILE_SIZE } from './atlas';
export { VoxelWorld, chunkOf } from './world';
export { raycastVoxels, createHit } from './raycast';
export { createBody, moveBody, sweepAxis, overlapsSolid, resolvePenetration, sampleLiquid, SKIN, STEP_HEIGHT } from './collide';
export { ToWorker, FromWorker, checkMesh, MAX_PASS_QUADS } from './protocol';
export { VoxelWorkerHandler } from './worker/handler';
export { VoxelJobPool, defaultWorkerCount, IN_FLIGHT, MAX_FAILURES } from './pool';
export { ChunkStreamer, MAX_LOADED_CHUNKS } from './streamer';
export { encodeSave, decodeSave, encodeSaveRaw, decodeSaveRaw, encodeChunk, decodeChunk, canCompress, SaveFormatError, SaveMeta, SavedPlayer, SavedStack, MAX_SAVED_CHUNKS, MAX_SAVE_BYTES, } from './persist';
