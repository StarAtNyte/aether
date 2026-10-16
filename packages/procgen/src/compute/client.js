/**
 * Main-thread client of the compute worker. Runs mesh operations and
 * built-in generator previews off the main thread; falls back to running
 * them inline when module workers are unavailable. Every reply is validated
 * (mesh data re-checked, generator output re-validated); a request that
 * exceeds its time budget terminates the worker (it is respawned lazily).
 */
import { cloneMeshData } from '@aether/core';
import { generateBuiltinSync, yieldToEventLoop } from '../generate';
import { validateOutput } from '../output';
import { MeshOp, parseMeshMessage, runMeshOp } from '../mesh-edit/run';
import { parseComputeReply, parseFinishPixels } from './protocol';
import { finishPixels } from '../finish-pixels';
function defaultWorker() {
    return new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module', name: 'aether-compute' });
}
/** Off-main-thread mesh operations and generator previews. */
export class ComputeClient {
    worker = null;
    pending = new Map();
    nextId = 1;
    idleTimer = null;
    timeoutMs;
    idleTimeoutMs;
    factory;
    workerFailed = false;
    disposed = false;
    constructor(opts = {}) {
        this.timeoutMs = Math.min(120_000, Math.max(100, opts.timeoutMs ?? 20_000));
        this.idleTimeoutMs = Math.max(0, opts.idleTimeoutMs ?? 60_000);
        this.factory = opts.createWorker === null ? null : (opts.createWorker ?? (typeof Worker !== 'undefined' ? defaultWorker : null));
    }
    /** True when work runs in a worker (false: inline fallback). */
    get usesWorker() {
        return this.factory !== null && !this.workerFailed;
    }
    ensure() {
        if (this.disposed || !this.factory || this.workerFailed)
            return null;
        if (this.worker)
            return this.worker;
        try {
            const w = this.factory();
            w.onmessage = (e) => this.onMessage(e.data);
            w.onerror = () => this.fail(new Error('the compute worker crashed'), true);
            this.worker = w;
            return w;
        }
        catch {
            this.workerFailed = true;
            return null;
        }
    }
    onMessage(data) {
        const msg = parseComputeReply(data);
        if (!msg || msg.type === 'ready')
            return;
        const p = this.pending.get(msg.id);
        if (!p || p.type !== msg.type)
            return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        this.scheduleIdle();
        if (!msg.ok) {
            p.reject(new Error(msg.error));
            return;
        }
        if (msg.type === 'finish') {
            const pixels = parseFinishPixels(msg.pixels, p.size ?? -1);
            if (!pixels)
                p.reject(new Error('the compute worker returned invalid texture data'));
            else
                p.resolve(pixels);
            return;
        }
        if (msg.type === 'mesh') {
            const mesh = parseMeshMessage(msg.mesh);
            if (!mesh)
                p.reject(new Error('the compute worker returned invalid mesh data'));
            else
                p.resolve({ mesh, ...(msg.note ? { note: msg.note } : {}) });
            return;
        }
        const v = validateOutput(msg.output);
        if (!v.ok)
            p.reject(new Error(`invalid generator output: ${v.error}`));
        else
            p.resolve(v.output);
    }
    /** Reject everything in flight; with `terminate`, drop the worker (respawned on next use). */
    fail(err, terminate) {
        for (const [, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(err);
        }
        this.pending.clear();
        if (terminate && this.worker) {
            try {
                this.worker.terminate();
            }
            catch {
                /* already gone */
            }
            this.worker = null;
        }
    }
    scheduleIdle() {
        if (this.idleTimer !== null)
            clearTimeout(this.idleTimer);
        this.idleTimer = null;
        if (this.idleTimeoutMs === 0 || this.pending.size > 0)
            return;
        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            if (this.pending.size === 0 && this.worker) {
                this.worker.terminate();
                this.worker = null;
            }
        }, this.idleTimeoutMs);
    }
    send(req, transfer) {
        const w = this.ensure();
        if (!w)
            return null;
        if (this.idleTimer !== null)
            clearTimeout(this.idleTimer);
        this.idleTimer = null;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(req.id);
                reject(new Error(`the operation took longer than ${Math.round(this.timeoutMs / 1000)} s and was stopped`));
                // A runaway computation: restart the worker (other requests are retried by their callers).
                this.fail(new Error('the compute worker was restarted'), true);
            }, this.timeoutMs);
            this.pending.set(req.id, { type: req.type, ...(req.type === 'finish' ? { size: req.size } : {}), resolve: resolve, reject, timer });
            try {
                w.postMessage(req, transfer);
            }
            catch (err) {
                clearTimeout(timer);
                this.pending.delete(req.id);
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }
    /**
     * Run a mesh operation. The input mesh is copied (never transferred), so
     * cached document data stays intact. Rejects with a readable message.
     */
    async meshOp(op, mesh) {
        if (this.disposed)
            throw new Error('compute client disposed');
        const parsed = MeshOp.safeParse(op);
        if (!parsed.success)
            throw new Error(`invalid mesh operation: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
        const copy = cloneMeshData(mesh);
        const transfer = [copy.positions.buffer, copy.indices.buffer, copy.colors?.buffer, copy.uvs?.buffer, copy.faceMaterials?.buffer].filter((b) => b instanceof ArrayBuffer);
        const sent = this.send({ type: 'mesh', id: this.nextId++, op: parsed.data, mesh: copy }, transfer);
        if (sent)
            return sent;
        await yieldToEventLoop();
        return runMeshOp(parsed.data, copy);
    }
    /** Generate a built-in generator's output off the main thread (validated). */
    async generate(generator, params, seed) {
        if (this.disposed)
            throw new Error('compute client disposed');
        const sent = this.send({ type: 'generate', id: this.nextId++, generator: String(generator).slice(0, 64), params, seed }, []);
        if (sent)
            return sent;
        await yieldToEventLoop();
        return generateBuiltinSync(generator, params, seed);
    }
    /** Synthesise the texture maps of a finish off the main thread (validated; inline fallback). */
    async finish(finish, size) {
        if (this.disposed)
            throw new Error('compute client disposed');
        const n = Math.min(1024, Math.max(16, 2 ** Math.round(Math.log2(Number.isFinite(size) ? size : 256))));
        const sent = this.send({ type: 'finish', id: this.nextId++, finish, size: n }, []);
        if (sent)
            return sent;
        await yieldToEventLoop();
        return finishPixels(finish, n);
    }
    /** Stop the worker and reject pending work. */
    dispose() {
        this.disposed = true;
        if (this.idleTimer !== null)
            clearTimeout(this.idleTimer);
        this.fail(new Error('compute client disposed'), true);
    }
}
