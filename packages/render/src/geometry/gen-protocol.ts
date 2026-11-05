/**
 * Messages between the page and the generation lanes (gen.worker.ts), checked on both ends. The lanes run trusted
 * code and validate every generator output in full; the page checks only the shape of what comes back (array types
 * and lengths: no per-vertex scan on the main thread).
 */
import type { Json } from '@aether/core';
import type { GeneratorOutput, MeshPart } from '../types';

/** Page → lane. `key` is the output's normalized key (proceduralOutputKey), hashed by the lane for the cache. */
export type GenRequest =
  | { type: 'gen'; id: number; key: string | null; generator: string; params: Record<string, Json>; seed: number }
  | { type: 'post'; id: number; key: string | null; raw: unknown }
  | { type: 'lookup'; id: number; key: string };

/** Milliseconds a lane spent per step of one job (probes and the debug overlay). */
export interface LaneTimes {
  read: number;
  generate: number;
  validate: number;
  prepare: number;
  encode: number;
}

/** Lane → page. `output` null: a lookup that missed. */
export type GenReply =
  | { type: 'result'; id: number; ok: true; output: GeneratorOutput | null; hit: boolean; times?: LaneTimes }
  | { type: 'result'; id: number; ok: false; error: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const MAX_KEY = 200_000;

/** Validate a request inside the lane. */
export function parseGenRequest(v: unknown): GenRequest | null {
  if (!isObj(v) || typeof v.id !== 'number' || !Number.isSafeInteger(v.id)) return null;
  const key = typeof v.key === 'string' && v.key.length <= MAX_KEY ? v.key : null;
  if (v.type === 'gen' && typeof v.generator === 'string' && v.generator.length <= 64 && isObj(v.params) && typeof v.seed === 'number' && Number.isFinite(v.seed)) {
    return { type: 'gen', id: v.id, key, generator: v.generator, params: v.params as Record<string, Json>, seed: v.seed };
  }
  if (v.type === 'post' && 'raw' in v) return { type: 'post', id: v.id, key, raw: v.raw };
  if (v.type === 'lookup' && key) return { type: 'lookup', id: v.id, key };
  return null;
}

/** Validate a reply on the page (the output's shape is checked separately, see {@link checkOutputShape}). */
export function parseGenReply(v: unknown): GenReply | { type: 'ready' } | null {
  if (!isObj(v)) return null;
  if (v.type === 'ready') return { type: 'ready' };
  if (v.type !== 'result' || typeof v.id !== 'number') return null;
  if (v.ok === false) return { type: 'result', id: v.id, ok: false, error: typeof v.error === 'string' ? v.error.slice(0, 500) : 'unknown error' };
  if (v.ok !== true) return null;
  const t = isObj(v.times) ? v.times : null;
  const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  const times: LaneTimes | undefined = t ? { read: num(t.read), generate: num(t.generate), validate: num(t.validate), prepare: num(t.prepare), encode: num(t.encode) } : undefined;
  return { type: 'result', id: v.id, ok: true, output: (v.output ?? null) as GeneratorOutput | null, hit: v.hit === true, ...(times ? { times } : {}) };
}

function f32(a: unknown, len: number): boolean {
  return a instanceof Float32Array && a.length === len;
}

/** True when a part's prepared streams match each other in length (types and sizes only). */
export function checkPrepared(part: MeshPart): boolean {
  const r = part.prepared;
  if (!r || !isObj(r)) return false;
  if (!(r.positions instanceof Float32Array) || r.positions.length % 3 !== 0) return false;
  const n = r.positions.length / 3;
  if (!f32(r.normals, n * 3) || !f32(r.uvs, n * 2)) return false;
  if (!(r.indices instanceof Uint16Array || r.indices instanceof Uint32Array) || r.indices.length % 3 !== 0) return false;
  if (r.colors !== null && !f32(r.colors, n * 3)) return false;
  if (r.splat !== null && !f32(r.splat, n * 4)) return false;
  if (r.splitIndices !== null && !(r.splitIndices instanceof Uint32Array && r.splitIndices.length === r.indices.length)) return false;
  if (r.bounds !== null && !(r.bounds instanceof Float64Array && r.bounds.length === 10)) return false;
  const soft = r.soft;
  if (soft !== undefined) {
    if (!isObj(soft) || typeof soft.crease !== 'number') return false;
    if (soft.normals !== null && !f32(soft.normals, part.positions.length)) return false;
    if (soft.prepared !== null && !checkPrepared({ ...part, prepared: soft.prepared })) return false;
  }
  return true;
}

/** Shape check of an output from a lane (array types and lengths, O(parts)); false: do not use it. */
export function checkOutputShape(out: unknown): out is GeneratorOutput {
  if (!isObj(out) || !Array.isArray(out.parts) || !Array.isArray(out.colliders) || !isObj(out.bounds) || !isObj(out.stats)) return false;
  for (const p of out.parts as unknown[]) {
    if (!isObj(p) || !isObj(p.material)) return false;
    if (!(p.positions instanceof Float32Array) || p.positions.length % 3 !== 0) return false;
    const n = p.positions.length / 3;
    if (!f32(p.normals, n * 3) || !(p.indices instanceof Uint32Array) || p.indices.length % 3 !== 0) return false;
    if (p.uvs !== undefined && !f32(p.uvs, n * 2)) return false;
    if (p.colors !== undefined && !f32(p.colors, n * 3)) return false;
    if (p.splat !== undefined && !f32(p.splat, n * 4)) return false;
    if (p.prepared !== undefined && !checkPrepared(p as unknown as MeshPart)) return false;
  }
  return true;
}

/** Unique buffers of an output (parts, prepared streams, colliders) for a zero-copy transfer. */
export function outputTransfer(out: GeneratorOutput): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>();
  const add = (a: ArrayBufferView | null | undefined): void => {
    if (a && a.buffer instanceof ArrayBuffer) set.add(a.buffer);
  };
  for (const p of out.parts) {
    add(p.positions);
    add(p.normals);
    add(p.indices);
    add(p.uvs);
    add(p.colors);
    add(p.splat);
    const r = p.prepared;
    if (r) for (const a of [r.positions, r.normals, r.indices, r.uvs, r.colors, r.splat, r.splitIndices, r.bounds]) add(a);
    const s = r?.soft;
    if (s?.normals) add(s.normals);
    const q = s?.prepared;
    if (q) for (const a of [q.positions, q.normals, q.indices, q.uvs, q.colors, q.splat, q.splitIndices, q.bounds]) add(a);
  }
  for (const c of out.colliders) {
    if (c.kind === 'hull') add(c.points);
    else if (c.kind === 'trimesh') {
      add(c.positions);
      add(c.indices);
    } else if (c.kind === 'heightfield') add(c.heights);
  }
  return [...set];
}

/**
 * Buffers of a raw sandbox reply, for passing it on to a lane without a copy. The reply arrived through
 * `postMessage`, so it is plain data (no getters or proxies survive structured cloning): walking it is safe.
 * Only typed arrays are collected; the lane validates everything.
 */
export function rawTransfer(raw: unknown): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>();
  const visit = (o: unknown): void => {
    if (!isObj(o)) return;
    for (const v of Object.values(o)) if (ArrayBuffer.isView(v) && v.buffer instanceof ArrayBuffer) set.add(v.buffer);
  };
  if (isObj(raw)) {
    if (Array.isArray(raw.parts)) for (const p of raw.parts.slice(0, 256)) visit(p);
    if (Array.isArray(raw.colliders)) for (const c of raw.colliders.slice(0, 1024)) visit(c);
  }
  return [...set];
}
