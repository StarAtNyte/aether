/**
 * Message protocol of the compute worker (mesh operations, built-in
 * generator previews), validated on both ends.
 */
import type { Json, MeshData } from '@aether/core';
import type { GeneratorOutput } from '../types';
import { transferables } from '../sandbox/protocol';
import type { MeshOpInput } from '../mesh-edit/run';
import { FINISH_IDS } from '@aether/arch';
import type { MaterialFinish } from '@aether/core';
import { MAX_FINISH_TEXTURE_SIZE, type FinishPixels } from '../finish-pixels';

/** Main → worker. */
export type ComputeRequest =
  | { type: 'mesh'; id: number; op: MeshOpInput; mesh: MeshData }
  | { type: 'generate'; id: number; generator: string; params: Record<string, Json>; seed: number }
  | { type: 'finish'; id: number; finish: MaterialFinish; size: number };

/** Worker → main. */
export type ComputeReply =
  | { type: 'mesh'; id: number; ok: true; mesh: MeshData; note?: string }
  | { type: 'generate'; id: number; ok: true; output: GeneratorOutput }
  | { type: 'finish'; id: number; ok: true; pixels: FinishPixels }
  | { type: 'mesh' | 'generate' | 'finish'; id: number; ok: false; error: string };

const FINISH_SET: ReadonlySet<string> = new Set(FINISH_IDS);

/** Validate finish pixels from the worker (sizes and array types). */
export function parseFinishPixels(v: unknown, size: number): FinishPixels | null {
  if (!isObj(v) || v.size !== size) return null;
  const len = size * size * 4;
  for (const k of ['albedo', 'orm', 'normal'] as const) if (!(v[k] instanceof Uint8Array) || (v[k] as Uint8Array).length !== len) return null;
  return { size, albedo: v.albedo as Uint8Array, orm: v.orm as Uint8Array, normal: v.normal as Uint8Array };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validate a request inside the worker (the op itself is validated by `runMeshOp`). */
export function parseComputeRequest(v: unknown): ComputeRequest | null {
  if (!isObj(v) || typeof v.id !== 'number' || !Number.isSafeInteger(v.id)) return null;
  if (v.type === 'mesh' && isObj(v.op) && isObj(v.mesh)) return { type: 'mesh', id: v.id, op: v.op as MeshOpInput, mesh: v.mesh as unknown as MeshData };
  if (v.type === 'generate' && typeof v.generator === 'string' && v.generator.length <= 64 && isObj(v.params) && typeof v.seed === 'number' && Number.isFinite(v.seed)) {
    return { type: 'generate', id: v.id, generator: v.generator, params: v.params as Record<string, Json>, seed: v.seed };
  }
  if (v.type === 'finish' && typeof v.finish === 'string' && FINISH_SET.has(v.finish) && typeof v.size === 'number' && Number.isInteger(v.size) && v.size >= 16 && v.size <= MAX_FINISH_TEXTURE_SIZE) {
    return { type: 'finish', id: v.id, finish: v.finish as MaterialFinish, size: v.size };
  }
  return null;
}

/** Validate a reply on the main thread (payloads are validated by the client). */
export function parseComputeReply(v: unknown): ComputeReply | { type: 'ready' } | null {
  if (!isObj(v)) return null;
  if (v.type === 'ready') return { type: 'ready' };
  if ((v.type !== 'mesh' && v.type !== 'generate' && v.type !== 'finish') || typeof v.id !== 'number') return null;
  if (v.ok === false) return { type: v.type, id: v.id, ok: false, error: typeof v.error === 'string' ? v.error.slice(0, 500) : 'unknown error' };
  if (v.ok !== true) return null;
  if (v.type === 'mesh') return { type: 'mesh', id: v.id, ok: true, mesh: v.mesh as MeshData, ...(typeof v.note === 'string' ? { note: v.note.slice(0, 200) } : {}) };
  if (v.type === 'finish') return { type: 'finish', id: v.id, ok: true, pixels: v.pixels as FinishPixels };
  return { type: 'generate', id: v.id, ok: true, output: v.output as GeneratorOutput };
}

/** Transferable buffers of a generator output. */
export function outputTransferables(out: GeneratorOutput): ArrayBuffer[] {
  return transferables(out);
}
