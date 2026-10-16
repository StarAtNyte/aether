import { CHUNK, chunkKey, keyX, keyZ } from './constants';
/** Most chunks the streamer keeps loaded whatever the view distance (memory bound). */
export const MAX_LOADED_CHUNKS = 1400;
/** Spiral of offsets within radius r, nearest first (Chebyshev rings, Euclidean order inside). */
function spiral(r) {
    const pts = [];
    for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++)
            pts.push([dx, dz, dx * dx + dz * dz]);
    pts.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
    const out = new Int16Array(pts.length * 2);
    pts.forEach((p, i) => {
        out[i * 2] = p[0];
        out[i * 2 + 1] = p[1];
    });
    return out;
}
/** See the module docs. */
export class ChunkStreamer {
    world;
    pool;
    sink;
    viewDistance;
    border;
    saved;
    isSaved;
    offsets;
    centerCx = 0;
    centerCz = 0;
    generating = new Set();
    meshes = new Map();
    neighbours = [null, null, null, null, null, null, null, null, null];
    tops = new Int32Array(9);
    epoch = 0;
    lastSweepCx = Number.NaN;
    lastSweepCz = Number.NaN;
    disposed = false;
    kickQueued = false;
    /** Main-thread milliseconds spent in the last {@link update}. */
    lastUpdateMs = 0;
    /** Longest {@link update} so far (ms; diagnostics, reset freely). */
    maxUpdateMs = 0;
    constructor(world, pool, sink, opts) {
        this.world = world;
        this.pool = pool;
        this.sink = sink;
        this.viewDistance = clampView(opts.viewDistance);
        this.border = Math.max(0, opts.border ?? 0);
        this.saved = opts.saved;
        this.isSaved = opts.isSaved;
        this.offsets = spiral(this.viewDistance + 1);
    }
    /** Chunks loaded within the view distance that have a mesh on screen. */
    get meshedCount() {
        let n = 0;
        for (const m of this.meshes.values())
            if (m.shown >= 0)
                n++;
        return n;
    }
    /** True when every chunk within the view distance is generated and meshed and nothing is pending. */
    get settled() {
        if (this.generating.size > 0)
            return false;
        const r = this.viewDistance;
        for (let i = 0; i < this.offsets.length; i += 2) {
            const dx = this.offsets[i];
            const dz = this.offsets[i + 1];
            if (Math.abs(dx) > r || Math.abs(dz) > r)
                continue;
            const cx = this.centerCx + dx;
            const cz = this.centerCz + dz;
            if (!this.inWorld(cx, cz))
                continue;
            const slot = this.world.slot(cx, cz);
            if (!slot)
                return false;
            const m = this.meshes.get(slot.key);
            if (!m || m.pending || m.shown !== slot.version)
                return false;
        }
        return this.world.dirty.size === 0;
    }
    /** Slot version of the mesh on screen for chunk `key` (−1: none). */
    shownVersion(key) {
        return this.meshes.get(key)?.shown ?? -1;
    }
    /** Current view distance (chunks). */
    get distance() {
        return this.viewDistance;
    }
    /** Change the view distance (2…16). */
    setViewDistance(n) {
        const v = clampView(n);
        if (v === this.viewDistance)
            return;
        this.viewDistance = v;
        this.offsets = spiral(v + 1);
    }
    /** Move the streaming centre to world block position (x, z). */
    setCenter(x, z) {
        if (!Number.isFinite(x) || !Number.isFinite(z))
            return;
        this.centerCx = Math.floor(x / CHUNK);
        this.centerCz = Math.floor(z / CHUNK);
    }
    /** Forget everything (new terrain configuration): every mesh is removed and chunks regenerate. */
    reset(border = this.border) {
        this.epoch++;
        this.border = Math.max(0, border);
        for (const slot of [...this.world.chunks.values()])
            this.unload(slot, false);
        this.world.dirty.clear();
        this.generating.clear();
        this.meshes.clear();
    }
    /**
     * Regenerate these loaded chunks (document edits touched them) while the
     * old meshes stay on screen until the new ones arrive. Chunks the player
     * modified are kept as they are.
     */
    regenerate(keys) {
        for (const key of keys) {
            const slot = this.world.chunks.get(key);
            if (!slot || slot.modified)
                continue;
            this.generating.delete(key);
            this.requestGenerate(slot.cx, slot.cz, true);
        }
    }
    inWorld(cx, cz) {
        const b = this.border;
        if (b <= 0)
            return true;
        return cx * CHUNK < b && cz * CHUNK < b && (cx + 1) * CHUNK > -b && (cz + 1) * CHUNK > -b;
    }
    /** Schedule work for this frame. Cheap: bounded by the pool's free capacity. */
    update() {
        if (this.disposed)
            return;
        const t0 = now();
        const pool = this.pool;
        // 1. Edits first (urgent remeshes).
        if (this.world.dirty.size > 0) {
            for (const key of this.world.dirty) {
                const slot = this.world.chunks.get(key);
                if (slot) {
                    const m = this.state(key);
                    m.requested = -1;
                    if (!m.pending)
                        this.requestMesh(slot, true);
                }
            }
            this.world.dirty.clear();
        }
        const vd = this.viewDistance;
        const offs = this.offsets;
        // 2 + 3. Walk outward, generating and meshing nearest first.
        for (let i = 0; i < offs.length && pool.pending < pool.capacity; i += 2) {
            const dx = offs[i];
            const dz = offs[i + 1];
            const cx = this.centerCx + dx;
            const cz = this.centerCz + dz;
            if (!this.inWorld(cx, cz))
                continue;
            const slot = this.world.slot(cx, cz);
            if (!slot) {
                this.requestGenerate(cx, cz);
                continue;
            }
            if (Math.abs(dx) > vd || Math.abs(dz) > vd)
                continue;
            const m = this.meshes.get(slot.key);
            if (m && (m.pending || m.requested === slot.version))
                continue;
            if (!this.neighboursReady(cx, cz))
                continue;
            this.requestMesh(slot, false);
        }
        // 4. Unload far chunks (and anything over the hard cap, farthest first).
        const keep = vd + 2;
        if (this.centerCx !== this.lastSweepCx || this.centerCz !== this.lastSweepCz || this.world.chunks.size > MAX_LOADED_CHUNKS) {
            this.lastSweepCx = this.centerCx;
            this.lastSweepCz = this.centerCz;
            for (const slot of this.world.chunks.values()) {
                const d = Math.max(Math.abs(slot.cx - this.centerCx), Math.abs(slot.cz - this.centerCz));
                if (d > keep)
                    this.unload(slot, true);
                else if (d > vd)
                    this.hide(slot.key, slot.cx, slot.cz);
            }
        }
        this.lastUpdateMs = now() - t0;
        if (this.lastUpdateMs > this.maxUpdateMs)
            this.maxUpdateMs = this.lastUpdateMs;
    }
    /** Top the workers up again soon (a job finished), in a task of its own; coalesced. */
    kick() {
        if (this.kickQueued || this.disposed)
            return;
        this.kickQueued = true;
        setTimeout(() => {
            this.kickQueued = false;
            this.update();
        }, 0);
    }
    state(key) {
        let m = this.meshes.get(key);
        if (!m) {
            m = { requested: -1, shown: -1, pending: false };
            this.meshes.set(key, m);
        }
        return m;
    }
    neighboursReady(cx, cz) {
        for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dz === 0)
                    continue;
                const nx = cx + dx;
                const nz = cz + dz;
                if (!this.inWorld(nx, nz))
                    continue;
                if (!this.world.slot(nx, nz))
                    return false;
            }
        }
        return true;
    }
    requestGenerate(cx, cz, replace = false) {
        const key = chunkKey(cx, cz);
        if (this.generating.has(key))
            return;
        this.generating.add(key);
        const epoch = this.epoch;
        const fromSave = this.saved?.(cx, cz) ?? null;
        const job = fromSave ? fromSave.then((s) => s ?? this.pool.generate(cx, cz)).then((s) => (s ? { ...s, saved: true } : null)) : this.pool.generate(cx, cz).then((g) => (g ? { chunk: g.chunk, top: g.top, saved: false } : null));
        job
            .then((g) => {
            if (this.disposed || epoch !== this.epoch)
                return;
            this.generating.delete(key);
            this.kick();
            if (!g)
                return;
            // The save index arrived while this chunk was generated from the seed: load the saved copy.
            if (!g.saved && this.isSaved?.(cx, cz)) {
                this.requestGenerate(cx, cz, replace);
                return;
            }
            // Too far by now: drop it (it will be generated again if we come back).
            const keep = this.viewDistance + 2;
            if (Math.abs(cx - this.centerCx) > keep || Math.abs(cz - this.centerCz) > keep)
                return;
            // A replacement must not clobber player changes made while it was generating.
            if (replace && this.world.chunks.get(key)?.modified)
                return;
            this.world.put(cx, cz, g.chunk, g.top, g.saved);
            // Neighbours meshed without this chunk get its light/AO border now.
            for (let dz = -1; dz <= 1; dz++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dz === 0)
                        continue;
                    const n = this.world.slot(cx + dx, cz + dz);
                    if (!n)
                        continue;
                    const m = this.meshes.get(n.key);
                    if (m && m.shown >= 0)
                        m.requested = -1;
                    if (replace)
                        this.world.markDirty(cx + dx, cz + dz);
                }
            }
        })
            .catch(() => {
            if (epoch === this.epoch)
                this.generating.delete(key);
        });
    }
    requestMesh(slot, urgent) {
        const m = this.state(slot.key);
        const version = slot.version;
        m.requested = version;
        m.pending = true;
        const nb = this.neighbours;
        const tops = this.tops;
        for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
                const k = (dz + 1) * 3 + (dx + 1);
                const n = this.world.slot(slot.cx + dx, slot.cz + dz);
                nb[k] = n ? n.data : null;
                tops[k] = n ? n.top : -1;
            }
        }
        const epoch = this.epoch;
        const { cx, cz, key } = slot;
        this.pool
            .mesh(cx, cz, nb, tops, urgent)
            .then((mesh) => {
            if (this.disposed || epoch !== this.epoch)
                return;
            m.pending = false;
            this.kick();
            const cur = this.world.chunks.get(key);
            if (!mesh || !cur || this.meshes.get(key) !== m)
                return;
            // Left the view while meshing (the sweep could not hide a mesh that was not shown yet):
            // drop it instead of installing a mesh nobody sees until the next sweep.
            if (Math.abs(cx - this.centerCx) > this.viewDistance || Math.abs(cz - this.centerCz) > this.viewDistance) {
                if (m.shown < 0)
                    this.meshes.delete(key);
                else
                    this.hide(key, cx, cz);
                return;
            }
            this.sink.onMesh(key, cx, cz, mesh);
            m.shown = version;
            // The chunk changed while meshing: ask again (urgently if it was an edit).
            if (cur.version !== version || m.requested === -1) {
                m.requested = -1;
                this.requestMesh(cur, true);
            }
        })
            .catch(() => {
            if (epoch === this.epoch)
                m.pending = false;
        });
        for (let k = 0; k < 9; k++)
            nb[k] = null;
    }
    /** Out of view but still loaded (hysteresis): drop the mesh, keep the blocks. */
    hide(key, cx, cz) {
        const m = this.meshes.get(key);
        if (!m || m.shown < 0)
            return;
        this.meshes.delete(key);
        this.sink.onUnload(key, cx, cz);
    }
    unload(slot, evict) {
        if (evict && slot.modified)
            this.sink.onEvict?.(slot);
        this.world.remove(slot.cx, slot.cz);
        this.meshes.delete(slot.key);
        this.sink.onUnload(slot.key, slot.cx, slot.cz);
    }
    /** Stop streaming (pending results are ignored). */
    dispose() {
        this.disposed = true;
        this.epoch++;
    }
}
function clampView(n) {
    return Number.isFinite(n) ? Math.max(2, Math.min(16, Math.round(n))) : 6;
}
function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
export { keyX, keyZ };
