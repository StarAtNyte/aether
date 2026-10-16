/**
 * Chunked culling and LOD selection for huge instance fields (a million
 * trees), CPU side, identical on WebGPU and WebGL2.
 *
 * Instances are stored compactly — x, y, z, s·cos(yaw), s·sin(yaw): 20
 * bytes instead of a 64-byte matrix — and sorted into spatial chunks of a
 * few hundred instances. Each update:
 *
 * 1. tests every chunk's box against the (padded) view frustum,
 * 2. picks a preferred LOD from the chunk's projected instance size (with
 *    hysteresis, so chunks do not flicker at thresholds),
 * 3. walks the visible chunks front to back and spends a triangle budget:
 *    a chunk that does not fit its preferred level is demoted to a coarser
 *    one, or dropped when even the coarsest does not fit, so far chunks
 *    degrade first and the frame cost is bounded whatever the scene holds,
 * 4. rewrites only the levels whose chunk membership changed, in stable
 *    chunk order, and only from the first chunk that differs, so unchanged
 *    levels and unchanged prefixes are never re-uploaded.
 *
 * Allocation-free after construction.
 */
import { floatKey, radixSortByKey } from './sort';
/** Floats per packed instance. */
export const FIELD_STRIDE = 5;
/** Instances per chunk (target). */
export const CHUNK_INSTANCES = 128;
/**
 * Pack column-major yaw/scale/translation matrices (as written by
 * `composeScatterMatrices`) into {@link FIELD_STRIDE} floats each.
 */
export function packMatrices(matrices, count) {
    const out = new Float32Array(count * FIELD_STRIDE);
    for (let i = 0; i < count; i++) {
        const m = i * 16;
        const o = i * FIELD_STRIDE;
        out[o] = matrices[m + 12];
        out[o + 1] = matrices[m + 13];
        out[o + 2] = matrices[m + 14];
        out[o + 3] = matrices[m]; // s·cos
        out[o + 4] = matrices[m + 8]; // s·sin
    }
    return out;
}
/**
 * Sort packed instances into a uniform XZ grid of chunks holding about
 * `perChunk` instances each. `radius` is the instance bounding radius at
 * scale 1 (around the instance origin), `heightAbove` how far the geometry
 * reaches above the origin at scale 1 (boxes are padded by both).
 */
export function buildChunks(data, count, radius, perChunk = CHUNK_INSTANCES) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
        const x = data[i * FIELD_STRIDE];
        const z = data[i * FIELD_STRIDE + 2];
        if (x < minX)
            minX = x;
        if (z < minZ)
            minZ = z;
        if (x > maxX)
            maxX = x;
        if (z > maxZ)
            maxZ = z;
    }
    if (count === 0) {
        return { count: 0, data: new Float32Array(0), chunkCount: 0, start: new Uint32Array(1), boxes: new Float32Array(0), maxScale: new Float32Array(0) };
    }
    const w = Math.max(maxX - minX, 1e-3);
    const d = Math.max(maxZ - minZ, 1e-3);
    const cells = Math.max(1, Math.round(count / Math.max(1, perChunk)));
    // Square cells: nx · nz ≈ cells with nx / nz ≈ w / d.
    const nx = Math.max(1, Math.min(4096, Math.round(Math.sqrt((cells * w) / d))));
    const nz = Math.max(1, Math.min(4096, Math.round(cells / nx)));
    const cellOf = new Uint32Array(count);
    const counts = new Uint32Array(nx * nz + 1);
    for (let i = 0; i < count; i++) {
        const cx = Math.min(nx - 1, Math.floor(((data[i * FIELD_STRIDE] - minX) / w) * nx));
        const cz = Math.min(nz - 1, Math.floor(((data[i * FIELD_STRIDE + 2] - minZ) / d) * nz));
        const c = cz * nx + cx;
        cellOf[i] = c;
        counts[c + 1] = counts[c + 1] + 1;
    }
    // Compact away empty cells.
    const remap = new Int32Array(nx * nz).fill(-1);
    let chunkCount = 0;
    for (let c = 0; c < nx * nz; c++)
        if (counts[c + 1] > 0)
            remap[c] = chunkCount++;
    const start = new Uint32Array(chunkCount + 1);
    for (let c = 0; c < nx * nz; c++) {
        const k = remap[c];
        if (k >= 0)
            start[k + 1] = counts[c + 1];
    }
    for (let k = 0; k < chunkCount; k++)
        start[k + 1] = start[k + 1] + start[k];
    const fill = new Uint32Array(chunkCount);
    const sorted = new Float32Array(count * FIELD_STRIDE);
    const boxes = new Float32Array(chunkCount * 6);
    const maxScale = new Float32Array(chunkCount);
    for (let k = 0; k < chunkCount; k++) {
        boxes[k * 6] = boxes[k * 6 + 1] = boxes[k * 6 + 2] = Infinity;
        boxes[k * 6 + 3] = boxes[k * 6 + 4] = boxes[k * 6 + 5] = -Infinity;
    }
    for (let i = 0; i < count; i++) {
        const k = remap[cellOf[i]];
        const dst = (start[k] + fill[k]) * FIELD_STRIDE;
        fill[k] = fill[k] + 1;
        for (let j = 0; j < FIELD_STRIDE; j++)
            sorted[dst + j] = data[i * FIELD_STRIDE + j];
        const s = Math.hypot(data[i * FIELD_STRIDE + 3], data[i * FIELD_STRIDE + 4]);
        const r = radius * s;
        const x = data[i * FIELD_STRIDE], y = data[i * FIELD_STRIDE + 1], z = data[i * FIELD_STRIDE + 2];
        const b = k * 6;
        if (x - r < boxes[b])
            boxes[b] = x - r;
        if (y - r < boxes[b + 1])
            boxes[b + 1] = y - r;
        if (z - r < boxes[b + 2])
            boxes[b + 2] = z - r;
        if (x + r > boxes[b + 3])
            boxes[b + 3] = x + r;
        if (y + r > boxes[b + 4])
            boxes[b + 4] = y + r;
        if (z + r > boxes[b + 5])
            boxes[b + 5] = z + r;
        if (s > maxScale[k])
            maxScale[k] = s;
    }
    return { count, data: sorted, chunkCount, start, boxes, maxScale };
}
/** Default switch points (projected instance radius in px) between consecutive levels. */
export const DEFAULT_LOD_PIXELS = [90, 30, 10, 4];
/** Hysteresis band (fraction of a threshold) before a chunk changes level. */
const HYSTERESIS = 0.15;
/** Per-frame chunk culling, LOD selection and instance-buffer assembly. */
export class FieldCuller {
    chunks;
    opts;
    levels;
    /** Instance matrices per level (column-major 4×4), written front to back. */
    buffers;
    /** Instances assigned per level by the last update (= instances to draw). */
    counts;
    /** Instances written per level buffer (equals `counts` after every update). */
    written;
    /**
     * First instance of each level whose matrix changed in the last rewrite;
     * instances before it were already uploaded (upload `[dirtyFrom, count)`).
     */
    dirtyFrom;
    /** Chunk order of each level's buffer, to find the first change. */
    sequences = [];
    seqLength;
    prevSeqLength;
    diverged;
    /** Instance capacity per level (bounded by the triangle budget). */
    capacity;
    /** Triangles the last assignment draws (per frame, instances × level triangles). */
    drawnTriangles = 0;
    /** Instances drawn by the last assignment. */
    drawnInstances = 0;
    /** Chunks visible (inside the padded frustum and large enough) in the last update. */
    visibleChunks = 0;
    /** Number of times buffers were rewritten (diagnostics, tests). */
    rewrites = 0;
    level;
    prevLevel;
    keys;
    order;
    scratch;
    thresholds;
    minPixels;
    pad;
    budget;
    constructor(chunks, opts) {
        this.chunks = chunks;
        this.opts = opts;
        this.levels = Math.max(1, opts.lodTriangles.length);
        const n = chunks.chunkCount;
        this.level = new Int8Array(n).fill(-1);
        this.prevLevel = new Int8Array(n).fill(-1);
        this.keys = new Uint32Array(n);
        this.order = new Uint32Array(n);
        this.scratch = new Uint32Array(n);
        this.budget = Math.max(0, opts.budgetTriangles);
        const t = opts.thresholds ?? DEFAULT_LOD_PIXELS;
        this.thresholds = [];
        for (let l = 0; l < this.levels - 1; l++)
            this.thresholds.push(t[l] ?? t[t.length - 1]);
        this.minPixels = opts.minPixels ?? 0.6;
        this.pad = new Float32Array(n);
        for (let c = 0; c < n; c++) {
            const b = c * 6;
            const size = Math.max(chunks.boxes[b + 3] - chunks.boxes[b], chunks.boxes[b + 5] - chunks.boxes[b + 2]);
            this.pad[c] = size * (opts.pad ?? 0.5);
        }
        this.capacity = new Uint32Array(this.levels);
        this.counts = new Uint32Array(this.levels);
        this.written = new Uint32Array(this.levels);
        this.dirtyFrom = new Uint32Array(this.levels);
        this.seqLength = new Uint32Array(this.levels);
        this.prevSeqLength = new Uint32Array(this.levels);
        this.diverged = new Uint8Array(this.levels);
        for (let l = 0; l < this.levels; l++)
            this.sequences.push(new Int32Array(n));
        this.buffers = [];
        for (let l = 0; l < this.levels; l++) {
            const tris = Math.max(1, opts.lodTriangles[l]);
            const cap = Math.min(chunks.count, Math.ceil(this.budget / tris));
            this.capacity[l] = cap;
            this.buffers.push(new Float32Array(cap * 16));
        }
    }
    /** Change the triangle budget (buffers keep their capacity; the next update re-plans). */
    setBudget(triangles) {
        this.budget = Math.max(0, Math.min(triangles, this.opts.budgetTriangles));
        this.prevLevel.fill(-2);
        this.prevSeqLength.fill(0);
    }
    /**
     * Classify chunks for `view` and rebuild the level buffers whose
     * membership changed. Returns a bit mask of the rewritten levels (0: the
     * uploaded buffers are still valid).
     */
    update(view) {
        const { chunks, level, keys, order } = this;
        const n = chunks.chunkCount;
        const boxes = chunks.boxes;
        const planes = view.planes;
        let visible = 0;
        for (let c = 0; c < n; c++) {
            const b = c * 6;
            const x0 = boxes[b], y0 = boxes[b + 1], z0 = boxes[b + 2];
            const x1 = boxes[b + 3], y1 = boxes[b + 4], z1 = boxes[b + 5];
            let inside = true;
            if (planes) {
                const pad = this.pad[c];
                for (let p = 0; p < planes.length; p += 4) {
                    const nx = planes[p], ny = planes[p + 1], nz = planes[p + 2];
                    // Box corner furthest along the plane normal (p-vertex test).
                    const px = nx >= 0 ? x1 : x0;
                    const py = ny >= 0 ? y1 : y0;
                    const pz = nz >= 0 ? z1 : z0;
                    if (nx * px + ny * py + nz * pz + planes[p + 3] < -pad) {
                        inside = false;
                        break;
                    }
                }
            }
            if (!inside) {
                level[c] = -1;
                continue;
            }
            // Distance from the camera to the box (0 inside).
            const dx = view.cx < x0 ? x0 - view.cx : view.cx > x1 ? view.cx - x1 : 0;
            const dy = view.cy < y0 ? y0 - view.cy : view.cy > y1 ? view.cy - y1 : 0;
            const dz = view.cz < z0 ? z0 - view.cz : view.cz > z1 ? view.cz - z1 : 0;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const px = (this.opts.radius * chunks.maxScale[c] * view.pixelScale) / (d > 1e-3 ? d : 1e-3);
            if (px < this.minPixels) {
                level[c] = -1;
                continue;
            }
            // Preferred level with hysteresis around the previous level's thresholds.
            const prev = this.prevLevel[c];
            let l = 0;
            while (l < this.levels - 1) {
                let t = this.thresholds[l];
                if (prev >= 0)
                    t *= prev > l ? 1 + HYSTERESIS : 1 - HYSTERESIS;
                if (px >= t)
                    break;
                l++;
            }
            level[c] = l;
            keys[c] = floatKey(d);
            order[visible] = c;
            visible++;
        }
        this.visibleChunks = visible;
        // Front to back.
        const sorted = radixSortByKey(order, keys, visible, this.scratch);
        // Spend the budget front to back, demoting (or dropping) chunks that do not fit.
        let remaining = this.budget;
        this.counts.fill(0);
        let drawn = 0;
        let tris = 0;
        for (let i = 0; i < visible; i++) {
            const c = sorted[i];
            const k = chunks.start[c + 1] - chunks.start[c];
            let l = level[c];
            while (l < this.levels) {
                const cost = k * this.opts.lodTriangles[l];
                if (cost <= remaining && this.counts[l] + k <= this.capacity[l])
                    break;
                l++;
            }
            if (l >= this.levels) {
                level[c] = -1;
                continue;
            }
            level[c] = l;
            this.counts[l] = this.counts[l] + k;
            const cost = k * this.opts.lodTriangles[l];
            remaining -= cost;
            tris += cost;
            drawn += k;
        }
        this.drawnTriangles = tris;
        this.drawnInstances = drawn;
        // Levels whose chunk membership changed; unchanged levels keep their uploaded buffers.
        let dirty = 0;
        for (let c = 0; c < n; c++) {
            const now = level[c];
            const before = this.prevLevel[c];
            if (now === before)
                continue;
            if (now >= 0)
                dirty |= 1 << now;
            if (before >= 0)
                dirty |= 1 << before;
            if (before === -2)
                dirty = (1 << this.levels) - 1;
        }
        this.prevLevel.set(level);
        if (dirty === 0)
            return 0;
        this.assemble(dirty);
        this.rewrites++;
        return dirty;
    }
    /**
     * Write the matrices of every chunk assigned to a dirty level into that
     * level's buffer, in stable chunk order (so a level's contents change only
     * when its membership does).
     */
    assemble(dirty) {
        const { chunks, level } = this;
        const data = chunks.data;
        for (let l = 0; l < this.levels; l++) {
            if (!(dirty & (1 << l)))
                continue;
            this.written[l] = 0;
            this.seqLength[l] = 0;
            this.diverged[l] = 0;
            this.dirtyFrom[l] = 0;
        }
        for (let c = 0; c < chunks.chunkCount; c++) {
            const l = level[c];
            if (l < 0 || !(dirty & (1 << l)))
                continue;
            const seq = this.sequences[l];
            const pos = this.seqLength[l];
            const start = chunks.start[c];
            const end = chunks.start[c + 1];
            // Same chunk at the same place as last time: its matrices are already uploaded.
            if (!this.diverged[l] && pos < this.prevSeqLength[l] && seq[pos] === c) {
                this.seqLength[l] = pos + 1;
                this.written[l] = this.written[l] + (end - start);
                continue;
            }
            if (!this.diverged[l]) {
                this.diverged[l] = 1;
                this.dirtyFrom[l] = this.written[l];
            }
            seq[pos] = c;
            this.seqLength[l] = pos + 1;
            const buf = this.buffers[l];
            let w = this.written[l] * 16;
            for (let j = start; j < end; j++) {
                const o = j * FIELD_STRIDE;
                const cs = data[o + 3];
                const sn = data[o + 4];
                const s = Math.sqrt(cs * cs + sn * sn);
                buf[w] = cs;
                buf[w + 1] = 0;
                buf[w + 2] = -sn;
                buf[w + 3] = 0;
                buf[w + 4] = 0;
                buf[w + 5] = s;
                buf[w + 6] = 0;
                buf[w + 7] = 0;
                buf[w + 8] = sn;
                buf[w + 9] = 0;
                buf[w + 10] = cs;
                buf[w + 11] = 0;
                buf[w + 12] = data[o];
                buf[w + 13] = data[o + 1];
                buf[w + 14] = data[o + 2];
                buf[w + 15] = 1;
                w += 16;
            }
            this.written[l] = w / 16;
        }
        for (let l = 0; l < this.levels; l++) {
            if (!(dirty & (1 << l)))
                continue;
            // A level that only lost chunks at its end needs no upload beyond its new count.
            if (!this.diverged[l])
                this.dirtyFrom[l] = this.written[l];
            this.prevSeqLength[l] = this.seqLength[l];
        }
    }
}
