/**
 * Messages between the main thread and the voxel workers, with validators
 * for both directions. Workers trust nothing they receive (the terrain
 * configuration is re-parsed with the World IR schemas, coordinates and
 * array shapes are bounded), and the main thread checks every reply before
 * it touches chunk storage or the GPU: packed chunks must decode
 * consistently and mesh buffers must have matching lengths with indices in
 * range.
 */
import { VoxelBlockDef, VoxelEdit, VoxelPreset, VOXEL_MAX_BLOCK_DEFS, VOXEL_MAX_EDITS } from '@aether/core';
import { z } from 'zod';
import type { PackedChunk } from './chunk';
import { MAX_CHUNK_COORD } from './constants';
import type { TerrainIdentity } from './jobs';
import type { ChunkMesh, MeshBuffers } from './mesher';

const Coord = z.number().int().min(-MAX_CHUNK_COORD).max(MAX_CHUNK_COORD);
const JobId = z.number().int().nonnegative();

/** Terrain identity as sent to a worker. */
export const TerrainIdentitySchema = z.object({
  preset: VoxelPreset,
  seed: z.number().int(),
  border: z.number().int().min(0).max(30_000),
  blocks: z.array(VoxelBlockDef).max(VOXEL_MAX_BLOCK_DEFS),
  edits: z.array(VoxelEdit).max(VOXEL_MAX_EDITS),
});

const Packed = z.object({
  palette: z.instanceof(Uint16Array),
  bits: z.number().int(),
  words: z.instanceof(Uint32Array),
});

/** Main → worker. */
export const ToWorker = z.discriminatedUnion('type', [
  z.object({ type: z.literal('config'), key: z.string().max(512), identity: TerrainIdentitySchema }),
  z.object({ type: z.literal('generate'), id: JobId, key: z.string().max(512), cx: Coord, cz: Coord }),
  z.object({
    type: z.literal('mesh'), id: JobId, key: z.string().max(512), cx: Coord, cz: Coord,
    chunks: z.array(Packed.nullable()).length(9), tops: z.array(z.number().int().min(-1).max(1024)).length(9),
  }),
]);
export type ToWorker = z.infer<typeof ToWorker>;

/** Worker → main (shape only; contents are checked by {@link checkMesh} / `ChunkData.fromPacked`). */
export const FromWorker = z.discriminatedUnion('type', [
  z.object({ type: z.literal('generated'), id: JobId, key: z.string().max(512), chunk: Packed, top: z.number().int().min(-1).max(1024), ms: z.number() }),
  z.object({ type: z.literal('meshed'), id: JobId, key: z.string().max(512), mesh: z.unknown(), ms: z.number() }),
  z.object({ type: z.literal('error'), id: JobId, message: z.string().max(2000) }),
]);
export type FromWorker = z.infer<typeof FromWorker>;

/** Most quads one pass of a chunk may have (a pathological checkerboard chunk stays far below). */
export const MAX_PASS_QUADS = 400_000;

function checkPass(p: unknown): MeshBuffers | null | false {
  if (p === null) return null;
  if (typeof p !== 'object') return false;
  const m = p as Partial<MeshBuffers>;
  const quads = m.quads;
  if (typeof quads !== 'number' || !Number.isInteger(quads) || quads <= 0 || quads > MAX_PASS_QUADS) return false;
  if (!(m.positions instanceof Float32Array) || m.positions.length !== quads * 12) return false;
  if (!(m.uvs instanceof Float32Array) || m.uvs.length !== quads * 8) return false;
  if (!(m.data instanceof Uint8Array) || m.data.length !== quads * 16) return false;
  const idx = m.indices;
  if (!(idx instanceof Uint16Array || idx instanceof Uint32Array) || idx.length !== quads * 6) return false;
  const vertices = quads * 4;
  for (let i = 0; i < idx.length; i++) if ((idx[i] as number) >= vertices) return false;
  const pos = m.positions;
  for (let i = 0; i < pos.length; i++) {
    const v = pos[i] as number;
    // Chunk-local coordinates: 0…16 horizontally, 0…1024 vertically.
    if (!(v >= -1 && v <= 1025)) return false;
  }
  return { positions: m.positions, uvs: m.uvs, data: m.data, indices: idx, quads };
}

/** Validate a mesh reply; returns the typed mesh or null when malformed. */
export function checkMesh(raw: unknown): ChunkMesh | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const opaque = checkPass(r['opaque'] ?? null);
  const cutout = checkPass(r['cutout'] ?? null);
  const liquid = checkPass(r['liquid'] ?? null);
  if (opaque === false || cutout === false || liquid === false) return null;
  const minY = r['minY'];
  const maxY = r['maxY'];
  if (typeof minY !== 'number' || typeof maxY !== 'number' || !Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
  return { opaque, cutout, liquid, minY, maxY };
}

/** Transferable buffers of a mesh (posting it moves them, no copy). */
export function meshTransfer(m: ChunkMesh): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const p of [m.opaque, m.cutout, m.liquid]) {
    if (!p) continue;
    out.push(p.positions.buffer as ArrayBuffer, p.uvs.buffer as ArrayBuffer, p.data.buffer as ArrayBuffer, p.indices.buffer as ArrayBuffer);
  }
  return out;
}

/** Transferable buffers of a packed chunk. */
export function packedTransfer(p: PackedChunk): ArrayBuffer[] {
  return [p.palette.buffer as ArrayBuffer, p.words.buffer as ArrayBuffer];
}

/** Narrow a parsed identity to the jobs type. */
export function asIdentity(i: z.infer<typeof TerrainIdentitySchema>): TerrainIdentity {
  return i as TerrainIdentity;
}
