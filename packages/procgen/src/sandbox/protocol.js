function isObj(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/** Validate an incoming request inside the worker. */
export function parseRunRequest(v) {
    if (!isObj(v) || v.type !== 'run')
        return null;
    const { id, source, params, seed } = v;
    if (typeof id !== 'number' || !Number.isSafeInteger(id))
        return null;
    if (typeof source !== 'string')
        return null;
    if (typeof seed !== 'number' || !Number.isFinite(seed))
        return null;
    if (!isObj(params))
        return null;
    return { type: 'run', id, source, params: params, seed };
}
/** Validate an incoming message on the main thread (output is validated separately). */
export function parseWorkerMessage(v) {
    if (!isObj(v))
        return null;
    if (v.type === 'ready')
        return { type: 'ready' };
    if (v.type !== 'result' || typeof v.id !== 'number')
        return null;
    if (v.ok === true)
        return { type: 'result', id: v.id, ok: true, output: v.output };
    if (v.ok === false)
        return { type: 'result', id: v.id, ok: false, error: typeof v.error === 'string' ? v.error.slice(0, 1000) : 'unknown error' };
    return null;
}
/** Unique ArrayBuffers referenced by an output (for zero-copy transfer). */
export function transferables(out) {
    const set = new Set();
    const addBuf = (a) => {
        if (a && a.buffer instanceof ArrayBuffer)
            set.add(a.buffer);
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
        if (c.kind === 'hull')
            addBuf(c.points);
        else if (c.kind === 'trimesh') {
            addBuf(c.positions);
            addBuf(c.indices);
        }
        else if (c.kind === 'heightfield')
            addBuf(c.heights);
    }
    return [...set];
}
