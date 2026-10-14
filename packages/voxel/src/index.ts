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
export { BlockRegistry, BUILTIN_BLOCKS, RENDER_CODE, MAX_TILES, shade, specFromDef, type BlockRender, type BlockSpec, type BlockType, type TilePattern, type TileSpec, type ToolKind } from './blocks';
export { ChunkData, type PackedChunk } from './chunk';
export { SimplexNoise, hash2, hash3, unit, smoothstep } from './noise';
export { TerrainGenerator, BIOMES, FLAT_HEIGHT, type Biome } from './terrain';
export { compileEdits, applyEdits, type CompiledEdit } from './edits';
export { buildStructure, rotateModel, KEEP, CARVE, FOUNDATION, type VoxelModel, type StructureRequest, type StructureSize } from './structures';
export { textRows, glyph } from './font';
export { LightVolume, REGION, REGION_LAYER, REGION_VOLUME, regionIndex } from './light';
export { ChunkMesher, LIQUID_SURFACE, type ChunkMesh, type MeshBuffers } from './mesher';
export { VoxelJobContext, terrainIdentity, identityKey, saveIdentity, outsideBorder, type TerrainIdentity } from './jobs';
export { buildAtlas, paintTile, tileAverage, ATLAS_SIZE, ATLAS_TILES, ATLAS_MAX_LOD, TILE_SIZE, type BlockAtlas } from './atlas';
export { VoxelWorld, chunkOf, type ChunkSlot, type UnloadedPolicy } from './world';
export { raycastVoxels, createHit, type VoxelHit } from './raycast';
export { createBody, moveBody, sweepAxis, overlapsSolid, resolvePenetration, sampleLiquid, SKIN, STEP_HEIGHT, type SolidQuery, type VoxelBody } from './collide';
export { ToWorker, FromWorker, checkMesh, MAX_PASS_QUADS } from './protocol';
export { VoxelWorkerHandler, type WorkerReply } from './worker/handler';
export { VoxelJobPool, defaultWorkerCount, IN_FLIGHT, MAX_FAILURES, type VoxelPoolOptions, type VoxelWorkerLike, type GeneratedChunk } from './pool';
export { ChunkStreamer, MAX_LOADED_CHUNKS, type StreamerOptions, type StreamerSink, type SavedChunkSource } from './streamer';
export {
  encodeSave, decodeSave, encodeSaveRaw, decodeSaveRaw, encodeChunk, decodeChunk, canCompress, SaveFormatError, SaveMeta, SavedPlayer, SavedStack,
  MAX_SAVED_CHUNKS, MAX_SAVE_BYTES, type SavedChunk, type VoxelSave,
} from './persist';
