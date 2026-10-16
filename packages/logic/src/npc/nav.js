/**
 * Navigation grid for NPCs: a uniform XZ grid over the walkable surfaces of
 * one floor level, with agent-radius-inflated blocking cells, a sight mask,
 * A* with string-pulled output and grid line-of-sight.
 *
 * Everything the hot path touches is a preallocated typed array: building a
 * grid allocates once, searching and ray casting allocate nothing. All
 * results are deterministic (fixed neighbour order, index tie-breaks).
 */
import { hyp } from './math';
/** Hard cap of cells per axis. */
export const NAV_MAX_CELLS = 320;
/** Most node expansions of one search (bounds the worst case). */
export const NAV_MAX_EXPANSIONS = 9000;
/** Largest string-pulled path (points). */
export const NAV_MAX_PATH = 128;
const SQRT2 = Math.SQRT2;
/** A built navigation grid for one level and agent size. */
export class NavGrid {
    minX;
    minZ;
    cell;
    w;
    h;
    refY;
    step;
    /** Floor height per cell (NaN = no floor). */
    floor;
    /** 1 = an agent centre cannot be here (solid, void or too close to one). */
    blocked;
    /** 1 = blocks sight (tall solid, not inflated). */
    sight;
    // --- search scratch --------------------------------------------------------------
    g;
    f;
    parent;
    seen;
    closed;
    heap;
    heapPos;
    heapN = 0;
    stamp = 0;
    raw;
    /** Cells expanded by the last search (diagnostics / tests). */
    lastExpansions = 0;
    constructor(o, cell, w, h) {
        this.minX = o.minX;
        this.minZ = o.minZ;
        this.cell = cell;
        this.w = w;
        this.h = h;
        this.refY = o.refY;
        this.step = o.step;
        const n = w * h;
        this.floor = new Float32Array(n).fill(NaN);
        this.blocked = new Uint8Array(n);
        this.sight = new Uint8Array(n);
        this.g = new Float32Array(n);
        this.f = new Float32Array(n);
        this.parent = new Int32Array(n);
        this.seen = new Uint32Array(n);
        this.closed = new Uint32Array(n);
        this.heap = new Int32Array(n);
        this.heapPos = new Int32Array(n);
        this.raw = new Int32Array(NAV_MAX_PATH * 8);
    }
    /** Rasterize `obstacles` into a new grid. */
    static build(obstacles, o) {
        const maxCells = Math.min(o.maxCells ?? NAV_MAX_CELLS, NAV_MAX_CELLS);
        const spanX = Math.max(1, o.maxX - o.minX);
        const spanZ = Math.max(1, o.maxZ - o.minZ);
        let cell = Math.max(0.1, o.cell ?? 0.5);
        cell = Math.max(cell, spanX / maxCells, spanZ / maxCells);
        const w = Math.max(2, Math.ceil(spanX / cell));
        const h = Math.max(2, Math.ceil(spanZ / cell));
        const grid = new NavGrid(o, cell, w, h);
        grid.rasterize(obstacles, o);
        return grid;
    }
    rasterize(obstacles, o) {
        const { w, h, cell, minX, minZ } = this;
        const floor = this.floor;
        const refY = o.refY;
        const stepTop = refY + o.step;
        // Ground plane.
        if (Number.isFinite(o.ground) && o.ground <= stepTop && o.ground > refY - 0.5) {
            for (let iz = 0; iz < h; iz++) {
                const z = minZ + (iz + 0.5) * cell;
                for (let ix = 0; ix < w; ix++) {
                    const x = minX + (ix + 0.5) * cell;
                    if (Math.abs(x) <= o.groundHalf && Math.abs(z) <= o.groundHalf)
                        floor[iz * w + ix] = o.ground;
                }
            }
        }
        const r = o.radius;
        for (const ob of obstacles) {
            const reach = (ob.circle ? ob.hx : hyp(ob.hx, ob.hz)) + r + cell;
            const ix0 = Math.max(0, Math.floor((ob.cx - reach - minX) / cell));
            const ix1 = Math.min(w - 1, Math.floor((ob.cx + reach - minX) / cell));
            const iz0 = Math.max(0, Math.floor((ob.cz - reach - minZ) / cell));
            const iz1 = Math.min(h - 1, Math.floor((ob.cz + reach - minZ) / cell));
            const isFloor = ob.top <= stepTop && ob.top > refY - 0.5;
            const blocks = ob.top > stepTop && ob.bottom < refY + o.height;
            const sights = ob.top > refY + 1 && ob.bottom < refY + o.height * 0.9;
            if (!isFloor && !blocks && !sights)
                continue;
            for (let iz = iz0; iz <= iz1; iz++) {
                const z = minZ + (iz + 0.5) * cell - ob.cz;
                for (let ix = ix0; ix <= ix1; ix++) {
                    const x = minX + (ix + 0.5) * cell - ob.cx;
                    let inside;
                    let near;
                    if (ob.circle) {
                        const d2 = x * x + z * z;
                        inside = d2 <= ob.hx * ob.hx;
                        near = d2 <= (ob.hx + r) * (ob.hx + r);
                    }
                    else {
                        const lx = Math.abs(x * ob.cos + z * ob.sin);
                        const lz = Math.abs(-x * ob.sin + z * ob.cos);
                        inside = lx <= ob.hx && lz <= ob.hz;
                        near = lx <= ob.hx + r && lz <= ob.hz + r;
                    }
                    const i = iz * w + ix;
                    if (inside) {
                        if (isFloor && !(floor[i] >= ob.top))
                            floor[i] = ob.top;
                        if (sights)
                            this.sight[i] = 1;
                    }
                    if (blocks && near)
                        this.blocked[i] = 1;
                }
            }
        }
        // Void cells (no floor) are not walkable.
        for (let i = 0; i < floor.length; i++)
            if (Number.isNaN(floor[i]))
                this.blocked[i] = 1;
    }
    /** Cell index of a world point, or -1 outside the grid. */
    index(x, z) {
        const ix = Math.floor((x - this.minX) / this.cell);
        const iz = Math.floor((z - this.minZ) / this.cell);
        if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.h)
            return -1;
        return iz * this.w + ix;
    }
    /** Centre X of cell index `i`. */
    cellX(i) {
        return this.minX + ((i % this.w) + 0.5) * this.cell;
    }
    /** Centre Z of cell index `i`. */
    cellZ(i) {
        return this.minZ + (Math.floor(i / this.w) + 0.5) * this.cell;
    }
    /** True when an agent centre may stand at (x, z). */
    walkable(x, z) {
        const i = this.index(x, z);
        return i >= 0 && this.blocked[i] === 0;
    }
    /** Floor height under (x, z); `fallback` outside the grid or over a void. */
    floorAt(x, z, fallback) {
        const i = this.index(x, z);
        if (i < 0)
            return fallback;
        const f = this.floor[i];
        return Number.isNaN(f) ? fallback : f;
    }
    /**
     * Nearest walkable cell to (x, z) within `maxRing` rings (breadth by
     * ring, row-major tie-break). Returns -1 when none.
     */
    nearest(x, z, maxRing) {
        const ix = Math.floor((x - this.minX) / this.cell);
        const iz = Math.floor((z - this.minZ) / this.cell);
        if (ix >= 0 && iz >= 0 && ix < this.w && iz < this.h && this.blocked[iz * this.w + ix] === 0)
            return iz * this.w + ix;
        let best = -1;
        let bestD = Infinity;
        for (let ring = 1; ring <= maxRing; ring++) {
            for (let dz = -ring; dz <= ring; dz++) {
                for (let dx = -ring; dx <= ring; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring)
                        continue;
                    const cx = ix + dx;
                    const cz = iz + dz;
                    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h)
                        continue;
                    const i = cz * this.w + cx;
                    if (this.blocked[i] !== 0)
                        continue;
                    const d = dx * dx + dz * dz;
                    if (d < bestD) {
                        bestD = d;
                        best = i;
                    }
                }
            }
            if (best >= 0)
                return best;
        }
        return best;
    }
    /** True when the straight segment crosses no blocked cell (supercover walk). */
    lineClear(x0, z0, x1, z1) {
        return this.walk(x0, z0, x1, z1, this.blocked);
    }
    /** True when nothing tall stands between the two points (sight mask). */
    lineOfSight(x0, z0, x1, z1) {
        return this.walk(x0, z0, x1, z1, this.sight);
    }
    walk(x0, z0, x1, z1, mask) {
        const cell = this.cell;
        let ix = Math.floor((x0 - this.minX) / cell);
        let iz = Math.floor((z0 - this.minZ) / cell);
        const ex = Math.floor((x1 - this.minX) / cell);
        const ez = Math.floor((z1 - this.minZ) / cell);
        const dx = x1 - x0;
        const dz = z1 - z0;
        const sx = dx > 0 ? 1 : -1;
        const sz = dz > 0 ? 1 : -1;
        const tdx = dx !== 0 ? Math.abs(cell / dx) : Infinity;
        const tdz = dz !== 0 ? Math.abs(cell / dz) : Infinity;
        let tx = dx !== 0 ? Math.abs((this.minX + (ix + (sx > 0 ? 1 : 0)) * cell - x0) / dx) : Infinity;
        let tz = dz !== 0 ? Math.abs((this.minZ + (iz + (sz > 0 ? 1 : 0)) * cell - z0) / dz) : Infinity;
        const limit = Math.abs(ex - ix) + Math.abs(ez - iz) + 2;
        for (let n = 0; n < limit; n++) {
            if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.h)
                return false;
            const atEnd = ix === ex && iz === ez;
            // The start and end cells are the endpoints' own cells: never an obstruction.
            if (!atEnd && n > 0 && mask[iz * this.w + ix] !== 0)
                return false;
            if (atEnd)
                return true;
            if (tx < tz) {
                tx += tdx;
                ix += sx;
            }
            else if (tz < tx) {
                tz += tdz;
                iz += sz;
            }
            else {
                // Exactly through a corner: both neighbours must be open.
                if (mask[iz * this.w + ix + sx] !== 0 || mask[(iz + sz) * this.w + ix] !== 0)
                    return false;
                tx += tdx;
                tz += tdz;
                ix += sx;
                iz += sz;
            }
        }
        return true;
    }
    // --- A* ------------------------------------------------------------------------------
    heapPush(i) {
        const k = this.heapN++;
        this.heap[k] = i;
        this.heapPos[i] = k;
        this.siftUp(k);
    }
    heapLess(a, b) {
        const fa = this.f[a];
        const fb = this.f[b];
        return fa < fb || (fa === fb && a < b);
    }
    siftUp(k) {
        const heap = this.heap;
        const i = heap[k];
        while (k > 0) {
            const p = (k - 1) >> 1;
            const pi = heap[p];
            if (!this.heapLess(i, pi))
                break;
            heap[k] = pi;
            this.heapPos[pi] = k;
            k = p;
        }
        heap[k] = i;
        this.heapPos[i] = k;
    }
    heapPop() {
        const heap = this.heap;
        const top = heap[0];
        const last = heap[--this.heapN];
        if (this.heapN > 0) {
            let k = 0;
            const n = this.heapN;
            for (;;) {
                let c = 2 * k + 1;
                if (c >= n)
                    break;
                if (c + 1 < n && this.heapLess(heap[c + 1], heap[c]))
                    c++;
                const ci = heap[c];
                if (!this.heapLess(ci, last))
                    break;
                heap[k] = ci;
                this.heapPos[ci] = k;
                k = c;
            }
            heap[k] = last;
            this.heapPos[last] = k;
        }
        this.heapPos[top] = -1;
        return top;
    }
    /**
     * Shortest walkable path from (sx, sz) to (gx, gz), string-pulled, written
     * as x,z pairs into `out`. Start/goal in blocked cells snap to the nearest
     * walkable one. Returns the number of points (0 = unreachable or budget
     * exhausted). The last point is the exact goal when its cell is walkable.
     */
    findPath(sx, sz, gx, gz, out, maxExpansions = NAV_MAX_EXPANSIONS) {
        const cap = Math.min(NAV_MAX_PATH, out.length >> 1);
        const start = this.nearest(sx, sz, 6);
        const goal = this.nearest(gx, gz, 8);
        this.lastExpansions = 0;
        if (start < 0 || goal < 0 || cap < 2)
            return 0;
        const goalExact = this.index(gx, gz) === goal;
        if (start === goal) {
            out[0] = goalExact ? gx : this.cellX(goal);
            out[1] = goalExact ? gz : this.cellZ(goal);
            return 1;
        }
        const w = this.w;
        const stamp = ++this.stamp;
        this.heapN = 0;
        const gxC = goal % w;
        const gzC = Math.floor(goal / w);
        this.g[start] = 0;
        this.f[start] = this.octile(start % w, Math.floor(start / w), gxC, gzC);
        this.seen[start] = stamp;
        this.parent[start] = -1;
        this.heapPush(start);
        let expansions = 0;
        let found = false;
        while (this.heapN > 0) {
            const cur = this.heapPop();
            this.closed[cur] = stamp;
            if (cur === goal) {
                found = true;
                break;
            }
            if (++expansions > maxExpansions)
                break;
            const cx = cur % w;
            const cz = (cur - cx) / w;
            const cf = this.floor[cur];
            for (let n = 0; n < 8; n++) {
                const dx = NB_X[n];
                const dz = NB_Z[n];
                const nx = cx + dx;
                const nz = cz + dz;
                if (nx < 0 || nz < 0 || nx >= w || nz >= this.h)
                    continue;
                const ni = nz * w + nx;
                if (this.blocked[ni] !== 0 || this.closed[ni] === stamp)
                    continue;
                if (Math.abs(this.floor[ni] - cf) > this.step)
                    continue;
                if (dx !== 0 && dz !== 0 && (this.blocked[cz * w + nx] !== 0 || this.blocked[nz * w + cx] !== 0))
                    continue;
                const ng = this.g[cur] + (dx !== 0 && dz !== 0 ? SQRT2 : 1);
                if (this.seen[ni] === stamp) {
                    if (ng >= this.g[ni])
                        continue;
                    this.g[ni] = ng;
                    this.f[ni] = ng + this.octile(nx, nz, gxC, gzC);
                    this.parent[ni] = cur;
                    this.siftUp(this.heapPos[ni]);
                }
                else {
                    this.seen[ni] = stamp;
                    this.g[ni] = ng;
                    this.f[ni] = ng + this.octile(nx, nz, gxC, gzC);
                    this.parent[ni] = cur;
                    this.heapPush(ni);
                }
            }
        }
        this.lastExpansions = expansions;
        if (!found)
            return 0;
        // Walk back into `raw` (reversed), then string-pull forwards.
        let n = 0;
        const raw = this.raw;
        let c = goal;
        const maxRaw = raw.length;
        while (c >= 0 && n < maxRaw) {
            raw[n++] = c;
            c = this.parent[c];
        }
        if (c >= 0) {
            // Longer than the raw buffer: keep the tail near the goal reachable by recursing in segments.
            return this.coarsePath(sx, sz, gx, gz, out, cap, goal, goalExact);
        }
        let count = 0;
        let at = n - 1; // raw[n-1] is the start cell
        let px = sx;
        let pz = sz;
        // Anchor on the true start when it lies in the start cell.
        if (this.index(sx, sz) !== start) {
            px = this.cellX(start);
            pz = this.cellZ(start);
        }
        while (at > 0 && count < cap - 1) {
            // Farthest raw point visible from (px, pz).
            let far = at - 1;
            const limit = Math.max(0, at - 24);
            for (let j = limit; j < at; j++) {
                const cj = raw[j];
                if (this.lineClear(px, pz, this.cellX(cj), this.cellZ(cj))) {
                    far = j;
                    break;
                }
            }
            const cf2 = raw[far];
            out[count * 2] = this.cellX(cf2);
            out[count * 2 + 1] = this.cellZ(cf2);
            px = out[count * 2];
            pz = out[count * 2 + 1];
            count++;
            at = far;
        }
        if (goalExact && count > 0) {
            out[(count - 1) * 2] = gx;
            out[(count - 1) * 2 + 1] = gz;
        }
        return count;
    }
    /** Fallback for paths longer than the raw buffer: straight cell chain every few cells. */
    coarsePath(sx, sz, gx, gz, out, cap, goal, goalExact) {
        // Collect every ~k-th cell by walking the parent chain twice (length, then sample).
        let len = 0;
        for (let c = goal; c >= 0; c = this.parent[c])
            len++;
        const stride = Math.max(1, Math.ceil(len / (cap - 1)));
        let count = 0;
        let idx = 0;
        const keepFrom = len - 1;
        const total = Math.min(cap - 1, Math.ceil(len / stride));
        // Sample from the goal backwards into out, then reverse.
        for (let c = goal; c >= 0 && count < total; c = this.parent[c], idx++) {
            if (idx % stride !== 0 && idx !== keepFrom)
                continue;
            out[count * 2] = this.cellX(c);
            out[count * 2 + 1] = this.cellZ(c);
            count++;
        }
        for (let a = 0, b = count - 1; a < b; a++, b--) {
            const tx = out[a * 2];
            const tz = out[a * 2 + 1];
            out[a * 2] = out[b * 2];
            out[a * 2 + 1] = out[b * 2 + 1];
            out[b * 2] = tx;
            out[b * 2 + 1] = tz;
        }
        if (goalExact && count > 0) {
            out[(count - 1) * 2] = gx;
            out[(count - 1) * 2 + 1] = gz;
        }
        void sx;
        void sz;
        return count;
    }
    octile(ax, az, bx, bz) {
        const dx = Math.abs(ax - bx);
        const dz = Math.abs(az - bz);
        return dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
    }
    /** Number of walkable cells (diagnostics). */
    walkableCount() {
        let n = 0;
        for (let i = 0; i < this.blocked.length; i++)
            if (this.blocked[i] === 0)
                n++;
        return n;
    }
}
const NB_X = [1, -1, 0, 0, 1, 1, -1, -1];
const NB_Z = [0, 0, 1, -1, 1, -1, 1, -1];
