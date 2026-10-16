import { transferables } from '../sandbox/protocol';
import { FINISH_IDS } from '@aether/arch';
import { MAX_FINISH_TEXTURE_SIZE } from '../finish-pixels';
const FINISH_SET = new Set(FINISH_IDS);
/** Validate finish pixels from the worker (sizes and array types). */
export function parseFinishPixels(v, size) {
    if (!isObj(v) || v.size !== size)
        return null;
    const len = size * size * 4;
    for (const k of ['albedo', 'orm', 'normal'])
        if (!(v[k] instanceof Uint8Array) || v[k].length !== len)
            return null;
    return { size, albedo: v.albedo, orm: v.orm, normal: v.normal };
}
function isObj(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/** Validate a request inside the worker (the op itself is validated by `runMeshOp`). */
export function parseComputeRequest(v) {
    if (!isObj(v) || typeof v.id !== 'number' || !Number.isSafeInteger(v.id))
        return null;
    if (v.type === 'mesh' && isObj(v.op) && isObj(v.mesh))
        return { type: 'mesh', id: v.id, op: v.op, mesh: v.mesh };
    if (v.type === 'generate' && typeof v.generator === 'string' && v.generator.length <= 64 && isObj(v.params) && typeof v.seed === 'number' && Number.isFinite(v.seed)) {
        return { type: 'generate', id: v.id, generator: v.generator, params: v.params, seed: v.seed };
    }
    if (v.type === 'finish' && typeof v.finish === 'string' && FINISH_SET.has(v.finish) && typeof v.size === 'number' && Number.isInteger(v.size) && v.size >= 16 && v.size <= MAX_FINISH_TEXTURE_SIZE) {
        return { type: 'finish', id: v.id, finish: v.finish, size: v.size };
    }
    return null;
}
/** Validate a reply on the main thread (payloads are validated by the client). */
export function parseComputeReply(v) {
    if (!isObj(v))
        return null;
    if (v.type === 'ready')
        return { type: 'ready' };
    if ((v.type !== 'mesh' && v.type !== 'generate' && v.type !== 'finish') || typeof v.id !== 'number')
        return null;
    if (v.ok === false)
        return { type: v.type, id: v.id, ok: false, error: typeof v.error === 'string' ? v.error.slice(0, 500) : 'unknown error' };
    if (v.ok !== true)
        return null;
    if (v.type === 'mesh')
        return { type: 'mesh', id: v.id, ok: true, mesh: v.mesh, ...(typeof v.note === 'string' ? { note: v.note.slice(0, 200) } : {}) };
    if (v.type === 'finish')
        return { type: 'finish', id: v.id, ok: true, pixels: v.pixels };
    return { type: 'generate', id: v.id, ok: true, output: v.output };
}
/** Transferable buffers of a generator output. */
export function outputTransferables(out) {
    return transferables(out);
}
