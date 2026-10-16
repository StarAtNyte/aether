import { ChunkData as Chunk } from './chunk';
import { identityKey } from './jobs';
import { checkMesh, FromWorker } from './protocol';
import { VoxelWorkerHandler } from './worker/handler';
/** Jobs a worker may have in flight. */
export const IN_FLIGHT = 2;
/** Worker failures after which the pool runs jobs inline. */
export const MAX_FAILURES = 3;
/** Workers the device can afford (1 or 2). */
export function defaultWorkerCount() {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const mem = typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : 8;
    const cores = typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 4;
    return mem <= 4 || cores <= 2 ? 1 : 2;
}
function defaultWorker() {
    return new Worker(new URL('./worker/voxel.worker.ts', import.meta.url), { type: 'module', name: 'aether-voxel' });
}
/** See the module docs. */
export class VoxelJobPool {
    factory;
    laneCount;
    timeoutMs;
    lanes = [];
    queue = [];
    inline = new VoxelWorkerHandler();
    inlineBusy = false;
    failures = 0;
    nextId = 1;
    disposed = false;
    identity = null;
    maxId = 0;
    /** Current terrain key ('' before {@link configure}). */
    key = '';
    /** Counters (tests, stats overlay). */
    stats = { generated: 0, meshed: 0, genMs: 0, meshMs: 0, dropped: 0, errors: 0, maxReplyMs: 0 };
    constructor(opts = {}) {
        this.factory = opts.createWorker === null ? null : (opts.createWorker ?? (typeof Worker !== 'undefined' ? defaultWorker : null));
        this.laneCount = Math.max(1, Math.min(2, Math.floor(opts.workers ?? defaultWorkerCount())));
        this.timeoutMs = Math.max(100, opts.timeoutMs ?? 20_000);
    }
    /** True while jobs run on the main thread (no usable workers). */
    get inlineMode() {
        return this.factory === null || this.failures >= MAX_FAILURES;
    }
    /** Queued + running jobs. */
    get pending() {
        let n = this.queue.length;
        for (const l of this.lanes)
            n += l ? l.jobs.size : 0;
        return n + (this.inlineBusy ? 1 : 0);
    }
    /** Jobs the pool can usefully hold before callers should wait (keeps queues short). */
    get capacity() {
        return (this.inlineMode ? 1 : this.laneCount * IN_FLIGHT) + 2;
    }
    /**
     * Set the terrain configuration (registry size bounds decoded block ids).
     * Queued jobs of an older configuration resolve to null.
     */
    configure(identity, maxBlockId) {
        const key = identityKey(identity);
        this.identity = identity;
        this.maxId = maxBlockId;
        if (key === this.key)
            return key;
        this.key = key;
        for (let i = this.queue.length - 1; i >= 0; i--) {
            const j = this.queue[i];
            if (j.key !== key) {
                this.queue.splice(i, 1);
                this.stats.dropped++;
                j.resolve(null);
            }
        }
        this.inline.handle({ type: 'config', key, identity });
        this.pump();
        return key;
    }
    /** Generate chunk (cx, cz). Resolves null when the configuration changed meanwhile. */
    generate(cx, cz, urgent = false) {
        return this.submit('generate', { type: 'generate', id: 0, key: this.key, cx, cz }, [], urgent);
    }
    /**
     * Mesh chunk (cx, cz) from its 3 × 3 neighbourhood (`chunks[(dz+1)*3+(dx+1)]`,
     * null = air) and their top heights. Resolves null when outdated.
     */
    mesh(cx, cz, chunks, tops, urgent = false) {
        const t = [];
        for (let i = 0; i < 9; i++)
            t.push(Math.max(-1, Math.min(1024, Math.floor(tops[i] ?? -1))));
        // The chunks are packed when the job is sent: the snapshot is the chunks at that moment, and the
        // structured clone of postMessage copies their indices natively (no per-request buffer copies to
        // collect on this thread; streaming a view of 8 sent ~2 600 of them).
        return this.submit('mesh', { type: 'mesh', id: 0, key: this.key, cx, cz, chunks: [], tops: t }, [], urgent, chunks.slice(0, 9));
    }
    /** Fill a mesh job's chunks into its message (just before it is posted or run inline). */
    prepare(job) {
        const m = job.message;
        if (m.type === 'mesh' && job.chunks)
            m.chunks = job.chunks.map((c) => (c ? c.view() : null));
        return m;
    }
    submit(kind, message, transfer, urgent, chunks) {
        if (this.disposed)
            return Promise.resolve(null);
        if (!this.key)
            return Promise.reject(new Error('voxel pool not configured'));
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            message.id = id;
            const job = { id, key: this.key, message, transfer, resolve, reject, kind, urgent, ...(chunks ? { chunks } : {}) };
            if (urgent) {
                // After the urgent jobs already queued (first come, first served), before all others.
                let at = 0;
                while (at < this.queue.length && this.queue[at].urgent)
                    at++;
                this.queue.splice(at, 0, job);
            }
            else
                this.queue.push(job);
            this.pump();
        });
    }
    pump() {
        if (this.disposed)
            return;
        if (this.inlineMode) {
            this.pumpInline();
            return;
        }
        for (let i = 0; i < this.laneCount && this.queue.length > 0; i++) {
            let lane = this.lanes[i] ?? null;
            if (!lane) {
                lane = this.startLane(i);
                if (!lane) {
                    if (this.inlineMode)
                        this.pumpInline();
                    return;
                }
            }
            while (lane.jobs.size < IN_FLIGHT && this.queue.length > 0) {
                const job = this.queue.shift();
                if (job.key !== this.key) {
                    this.stats.dropped++;
                    job.resolve(null);
                    continue;
                }
                this.send(i, lane, job);
            }
        }
    }
    startLane(i) {
        if (!this.factory)
            return null;
        let worker;
        try {
            worker = this.factory();
        }
        catch {
            this.failures = MAX_FAILURES;
            return null;
        }
        const lane = { worker, jobs: new Map(), configured: '' };
        worker.onmessage = (e) => this.onReply(i, lane, e.data);
        worker.onerror = () => this.killLane(i, lane, 'the voxel worker crashed');
        this.lanes[i] = lane;
        return lane;
    }
    send(i, lane, job) {
        try {
            if (lane.configured !== this.key && this.identity) {
                lane.worker.postMessage({ type: 'config', key: this.key, identity: this.identity });
                lane.configured = this.key;
            }
            lane.worker.postMessage(this.prepare(job), job.transfer);
            // Sent: the clone holds the data now; drop the references (they would pin unloaded chunks).
            if (job.message.type === 'mesh')
                job.message.chunks = [];
        }
        catch {
            this.queue.unshift(job);
            this.killLane(i, lane, 'could not post to the voxel worker');
            return;
        }
        const timer = setTimeout(() => this.killLane(i, lane, 'voxel job timed out'), this.timeoutMs);
        lane.jobs.set(job.id, { job, timer });
    }
    killLane(i, lane, reason) {
        if (this.lanes[i] !== lane)
            return;
        this.lanes[i] = null;
        this.failures++;
        try {
            lane.worker.terminate();
        }
        catch {
            /* already gone */
        }
        // Requeue its jobs at the front (they will run on a fresh lane or inline).
        const jobs = [...lane.jobs.values()];
        for (const { timer } of jobs)
            clearTimeout(timer);
        for (let k = jobs.length - 1; k >= 0; k--)
            this.queue.unshift(jobs[k].job);
        this.stats.errors++;
        if (this.failures >= MAX_FAILURES) {
            // eslint-disable-next-line no-console
            if (typeof console !== 'undefined')
                console.warn(`[voxel] ${reason}; running voxel jobs on the main thread`);
        }
        queueMicrotask(() => this.pump());
    }
    onReply(i, lane, raw) {
        if (this.lanes[i] !== lane)
            return;
        const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
        this.handleReply(i, lane, raw);
        const ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
        if (ms > this.stats.maxReplyMs)
            this.stats.maxReplyMs = ms;
    }
    /** Validate and settle one worker reply (main-thread cost is measured by {@link onReply}). */
    handleReply(i, lane, raw) {
        const parsed = FromWorker.safeParse(raw);
        if (!parsed.success) {
            this.killLane(i, lane, 'malformed voxel worker reply');
            return;
        }
        const msg = parsed.data;
        const entry = lane.jobs.get(msg.id);
        if (!entry)
            return;
        clearTimeout(entry.timer);
        lane.jobs.delete(msg.id);
        this.settle(entry.job, msg);
        this.pump();
    }
    settle(job, msg) {
        if (msg.type === 'error') {
            this.stats.errors++;
            job.reject(new Error(msg.message));
            return;
        }
        if (msg.key !== this.key || job.key !== this.key) {
            this.stats.dropped++;
            job.resolve(null);
            return;
        }
        if (msg.type === 'generated') {
            const chunk = Chunk.fromPacked(msg.chunk, this.maxId);
            if (!chunk) {
                this.stats.errors++;
                job.reject(new Error('malformed generated chunk'));
                return;
            }
            this.stats.generated++;
            this.stats.genMs += msg.ms;
            job.resolve({ chunk, top: msg.top, ms: msg.ms });
            return;
        }
        const mesh = checkMesh(msg.mesh);
        if (!mesh) {
            this.stats.errors++;
            job.reject(new Error('malformed chunk mesh'));
            return;
        }
        this.stats.meshed++;
        this.stats.meshMs += msg.ms;
        job.resolve(mesh);
    }
    /** Inline mode: one job per macrotask, so the page stays responsive between jobs. */
    pumpInline() {
        if (this.inlineBusy || this.queue.length === 0 || this.disposed)
            return;
        this.inlineBusy = true;
        setTimeout(() => {
            this.inlineBusy = false;
            if (this.disposed)
                return;
            const job = this.queue.shift();
            if (job) {
                if (job.key !== this.key) {
                    this.stats.dropped++;
                    job.resolve(null);
                }
                else {
                    const reply = this.inline.handle(this.prepare(job));
                    if (job.message.type === 'mesh')
                        job.message.chunks = [];
                    if (reply)
                        this.settle(job, reply.message);
                    else
                        job.resolve(null);
                }
            }
            this.pumpInline();
        }, 0);
    }
    /** Stop the workers; pending jobs resolve to null. */
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        for (let i = 0; i < this.lanes.length; i++) {
            const lane = this.lanes[i];
            if (!lane)
                continue;
            for (const { job, timer } of lane.jobs.values()) {
                clearTimeout(timer);
                job.resolve(null);
            }
            try {
                lane.worker.terminate();
            }
            catch {
                /* ignore */
            }
            this.lanes[i] = null;
        }
        for (const j of this.queue.splice(0))
            j.resolve(null);
    }
}
