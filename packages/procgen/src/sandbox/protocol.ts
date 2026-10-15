/**
 * Message protocol between the main thread and the sandbox worker, with
 * structural validation on both ends (never trust the other side's shape).
 */
import type { Json } from '@aether/core';
import type { GeneratorOutput } from '../types';

/** Main → worker: run a generator body. */
export interface RunRequest {
  type: 'run';
  id: number;
  source: string;
  params: Record<string, Json>;
  seed: number;
}

/** Worker → main: the worker finished locking down and is ready. */
export interface ReadyMessage {
  type: 'ready';
}

/** Worker → main: result of a run. */
export type RunResult =
  | { type: 'result'; id: number; ok: true; output: GeneratorOutput }
  | { type: 'result'; id: number; ok: false; error: string };

/** Any worker → main message. */
export type WorkerMessage = ReadyMessage | RunResult;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validate an incoming request inside the worker. */
export function parseRunRequest(v: unknown): RunRequest | null {
  if (!isObj(v) || v.type !== 'run') return null;
  const { id, source, params, seed } = v;
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) return null;
  if (typeof source !== 'string') return null;
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return null;
  if (!isObj(params)) return null;
  return { type: 'run', id, source, params: params as Record<string, Json>, seed };
}

/** Validate an incoming message on the main thread (output is validated separately). */
export function parseWorkerMessage(v: unknown): WorkerMessage | null {
  if (!isObj(v)) return null;
  if (v.type === 'ready') return { type: 'ready' };
  if (v.type !== 'result' || typeof v.id !== 'number') return null;
  if (v.ok === true) return { type: 'result', id: v.id, ok: true, output: v.output as GeneratorOutput };
  if (v.ok === false) return { type: 'result', id: v.id, ok: false, error: typeof v.error === 'string' ? v.error.slice(0, 1000) : 'unknown error' };
  return null;
}

/** Unique ArrayBuffers referenced by an output (for zero-copy transfer). */
export function transferables(out: GeneratorOutput): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>();
  const addBuf = (a: ArrayBufferView | undefined): void => {
    if (a && a.buffer instanceof ArrayBuffer) set.add(a.buffer);
  };
  for (const p of out.parts) {
    addBuf(p.positions);
    addBuf(p.normals);
    addBuf(p.indices);
    addBuf(p.uvs);
    addBuf(p.colors);
    addBuf(p.splat);
  }
  for (const c of out.colliders) {
    if (c.kind === 'hull') addBuf(c.points);
    else if (c.kind === 'trimesh') {
      addBuf(c.positions);
      addBuf(c.indices);
    } else if (c.kind === 'heightfield') addBuf(c.heights);
  }
  return [...set];
}
