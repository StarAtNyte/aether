/**
 * Main-thread client of the DAG worker with an inline fallback (no module
 * workers, or Node tests). Builds are queued one at a time (a laptop never
 * runs several multi-second builds at once), time out, and replies are
 * validated before use. Results are cached per mesh key with a byte-capped
 * LRU, and concurrent requests for one key share a build.
 */
import { buildClusterDag } from './cluster-dag';
import { MAX_DAG_INDICES, MAX_DAG_VERTICES, validateDag } from './dag-protocol';
function defaultWorker() {
    return new Worker(new URL('./dag.worker.ts', import.meta.url), { type: 'module', name: 'aether-dag' });
}
/** Bytes held by a DAG. */
export function dagBytes(d) {
    return d.indices.byteLength + d.offsets.byteLength + d.spheres.byteLength + d.cones.byteLength + d.lod.byteLength + d.source.byteLength + d.groupOffsets.byteLength + d.groupClusters.byteLength + d.roots.byteLength;
}
/** See the module docs. */
export class DagClient {
    worker = null;
    workerFailed = false;
    factory;
    timeoutMs;
    cacheBytes;
    cache = new Map();
    cachedBytes = 0;
    inflight = new Map();
    queue = [];
    active = null;
    nextId = 1;
    disposed = false;
    constructor(opts = {}) {
        this.factory = opts.createWorker === null ? null : (opts.createWorker ?? (typeof Worker !== 'undefined' ? defaultWorker : null));
        this.timeoutMs = Math.max(100, opts.timeoutMs ?? 60_000);
        this.cacheBytes = Math.max(0, opts.cacheBytes ?? 96 * 1024 * 1024);
    }
    /** The DAG of mesh `key` (built once; concurrent calls share the build). Rejects for oversized meshes. */
    build(key, positions, indices) {
        const hit = this.cache.get(key);
        if (hit) {
            this.cache.delete(key);
            this.cache.set(key, hit);
            return Promise.resolve(hit);
        }
        const running = this.inflight.get(key);
        if (running)
            return running;
        if (this.disposed)
            return Promise.reject(new Error('DAG client disposed'));
        if (positions.length / 3 > MAX_DAG_VERTICES || indices.length > MAX_DAG_INDICES)
            return Promise.reject(new Error('mesh too large for virtual geometry'));
        const p = new Promise((resolve, reject) => {
            // Copies: the source arrays stay in use by the renderer and the generator cache.
            this.queue.push({ id: this.nextId++, vertexCount: Math.floor(positions.length / 3), positions: positions.slice(), indices: indices.slice(), resolve, reject });
            this.pump();
        }).then((dag) => {
            this.inflight.delete(key);
            this.remember(key, dag);
            return dag;
        }, (e) => {
            this.inflight.delete(key);
            throw e;
        });
        this.inflight.set(key, p);
        return p;
    }
    /** Cached DAG of `key` without building. */
    peek(key) {
        return this.cache.get(key);
    }
    remember(key, dag) {
        const bytes = dagBytes(dag);
        if (bytes > this.cacheBytes)
            return;
        this.cache.set(key, dag);
        this.cachedBytes += bytes;
        for (const [k, d] of this.cache) {
            if (this.cachedBytes <= this.cacheBytes)
                break;
            this.cache.delete(k);
            this.cachedBytes -= dagBytes(d);
        }
    }
    ensureWorker() {
        if (this.disposed || !this.factory || this.workerFailed)
            return null;
        if (this.worker)
            return this.worker;
        try {
            const w = this.factory();
            w.onmessage = (e) => this.onReply(e.data);
            w.onerror = () => this.crash(new Error('the geometry worker crashed'));
            this.worker = w;
            return w;
        }
        catch {
            this.workerFailed = true;
            return null;
        }
    }
    pump() {
        if (this.active || this.disposed)
            return;
        const job = this.queue.shift();
        if (!job)
            return;
        const w = this.ensureWorker();
        if (!w) {
            // Inline fallback, one macrotask later so the caller's frame finishes first.
            const timer = setTimeout(() => {
                this.active = null;
                try {
                    job.resolve(buildClusterDag(job.positions, job.indices));
                }
                catch (e) {
                    job.reject(e instanceof Error ? e : new Error(String(e)));
                }
                this.pump();
            }, 0);
            this.active = { job, timer };
            return;
        }
        const timer = setTimeout(() => this.crash(new Error(`virtual geometry build took longer than ${Math.round(this.timeoutMs / 1000)} s`)), this.timeoutMs);
        this.active = { job, timer };
        w.postMessage({ type: 'dag', id: job.id, positions: job.positions, indices: job.indices }, [job.positions.buffer, job.indices.buffer]);
    }
    onReply(data) {
        const a = this.active;
        const msg = data;
        if (!a || !msg || msg.type !== 'dag' || msg.id !== a.job.id)
            return;
        clearTimeout(a.timer);
        this.active = null;
        if (msg.ok === true) {
            const dag = validateDag(msg.dag, a.job.vertexCount);
            if (dag)
                a.job.resolve(dag);
            else
                a.job.reject(new Error('the geometry worker returned an invalid hierarchy'));
        }
        else {
            a.job.reject(new Error(typeof msg.error === 'string' ? msg.error.slice(0, 300) : 'virtual geometry build failed'));
        }
        this.pump();
    }
    /** Fail the running job, drop the worker (respawned for the next job). */
    crash(err) {
        const a = this.active;
        this.active = null;
        if (a) {
            clearTimeout(a.timer);
            a.job.reject(err);
        }
        if (this.worker) {
            try {
                this.worker.terminate();
            }
            catch {
                /* already gone */
            }
            this.worker = null;
        }
        this.pump();
    }
    /** Stop the worker and reject queued builds. */
    dispose() {
        this.disposed = true;
        const err = new Error('DAG client disposed');
        if (this.active) {
            clearTimeout(this.active.timer);
            this.active.job.reject(err);
            this.active = null;
        }
        for (const j of this.queue.splice(0))
            j.reject(err);
        this.worker?.terminate();
        this.worker = null;
        this.cache.clear();
        this.cachedBytes = 0;
    }
}
