/**
 * Message protocol of the compute worker (mesh operations, built-in
 * generator previews), validated on both ends.
 */
import type { Json, MeshData } from '@aether/core';
import type { GeneratorOutput } from '../types';
import { transferables } from '../sandbox/protocol';
import type { MeshOpInput } from '../mesh-edit/run';

/** Main → worker. */
export type ComputeRequest =
  | { type: 'mesh'; id: number; op: MeshOpInput; mesh: MeshData }
  | { type: 'generate'; id: number; generator: string; params: Record<string, Json>; seed: number };

/** Worker → main. */
export type ComputeReply =
  | { type: 'mesh'; id: number; ok: true; mesh: MeshData; note?: string }
  | { type: 'generate'; id: number; ok: true; output: GeneratorOutput }
  | { type: 'mesh' | 'generate'; id: number; ok: false; error: string };

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
  return null;
}

/** Validate a reply on the main thread (payloads are validated by the client). */
export function parseComputeReply(v: unknown): ComputeReply | { type: 'ready' } | null {
  if (!isObj(v)) return null;
  if (v.type === 'ready') return { type: 'ready' };
  if ((v.type !== 'mesh' && v.type !== 'generate') || typeof v.id !== 'number') return null;
  if (v.ok === false) return { type: v.type, id: v.id, ok: false, error: typeof v.error === 'string' ? v.error.slice(0, 500) : 'unknown error' };
  if (v.ok !== true) return null;
  if (v.type === 'mesh') return { type: 'mesh', id: v.id, ok: true, mesh: v.mesh as MeshData, ...(typeof v.note === 'string' ? { note: v.note.slice(0, 200) } : {}) };
  return { type: 'generate', id: v.id, ok: true, output: v.output as GeneratorOutput };
}

/** Transferable buffers of a generator output. */
export function outputTransferables(out: GeneratorOutput): ArrayBuffer[] {
  return transferables(out);
}
