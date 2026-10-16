/**
 * Top-surface height grid rasterized from triangle meshes. Used to drop
 * scatter instances onto a terrain in O(triangles + cells) instead of casting
 * one ray per instance against every triangle. Equivalent to a downward ray
 * from far above: each cell keeps the HIGHEST surface point.
 */
/** Default max cells along the longest axis. */
export const DEFAULT_GRID_RESOLUTION = 512;
/** Hard cap on total cells (memory guard: 4 MB of float32). */
const MAX_CELLS = 1 << 20;
/** Regular XZ grid of surface heights (NaN = no surface in that cell). */
export class HeightGrid {
    minX;
    minZ;
    cell;
    nx;
    nz;
    heights;
    /**
     * @param minX world x of the grid's left edge
     * @param minZ world z of the grid's near edge
     * @param cell cell size in meters (square cells)
     * @param nx cells along X
     * @param nz cells along Z
     * @param heights `nx * nz` heights, row-major by z (`heights[iz * nx + ix]`)
     */
    constructor(minX, minZ, cell, nx, nz, heights) {
        this.minX = minX;
        this.minZ = minZ;
        this.cell = cell;
        this.nx = nx;
        this.nz = nz;
        this.heights = heights;
    }
    at(ix, iz) {
        if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz)
            return Number.NaN;
        return this.heights[iz * this.nx + ix];
    }
    /**
     * Height at world (x, z): bilinear between cell centers, using only cells
     * that have a surface; NaN outside the grid or over holes.
     */
    sample(x, z) {
        const fx = (x - this.minX) / this.cell - 0.5;
        const fz = (z - this.minZ) / this.cell - 0.5;
        if (!(fx > -1 && fz > -1 && fx < this.nx && fz < this.nz))
            return Number.NaN;
        const ix = Math.floor(fx);
        const iz = Math.floor(fz);
        const tx = fx - ix;
        const tz = fz - iz;
        let sum = 0;
        let wsum = 0;
        const acc = (h, w) => {
            if (w > 0 && h === h) {
                sum += h * w;
                wsum += w;
            }
        };
        acc(this.at(ix, iz), (1 - tx) * (1 - tz));
        acc(this.at(ix + 1, iz), tx * (1 - tz));
        acc(this.at(ix, iz + 1), (1 - tx) * tz);
        acc(this.at(ix + 1, iz + 1), tx * tz);
        if (wsum > 1e-9)
            return sum / wsum;
        // Exactly on a cell center or surrounded by holes: nearest cell.
        return this.at(Math.round(fx), Math.round(fz));
    }
}
/**
 * Transform positions by a column-major 4x4 matrix (three.js `elements`).
 * Returns a new array (called once per layout, not per frame).
 */
export function transformPositions(positions, m) {
    const out = new Float32Array(positions.length);
    const e = m;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        out[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
        out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    return out;
}
/**
 * Rasterize the top surface of triangle meshes (already in the target space,
 * see {@link transformPositions}) into a {@link HeightGrid}. Returns null when
 * there is nothing to rasterize.
 */
export function buildHeightGrid(meshes, resolution = DEFAULT_GRID_RESOLUTION) {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const m of meshes) {
        const p = m.positions;
        for (let i = 0; i < p.length; i += 3) {
            const x = p[i];
            const z = p[i + 2];
            if (!Number.isFinite(x) || !Number.isFinite(z))
                continue;
            if (x < minX)
                minX = x;
            if (x > maxX)
                maxX = x;
            if (z < minZ)
                minZ = z;
            if (z > maxZ)
                maxZ = z;
        }
    }
    if (!(maxX >= minX && maxZ >= minZ))
        return null;
    const res = Math.max(4, Math.min(4096, Math.floor(resolution)));
    const extent = Math.max(maxX - minX, maxZ - minZ, 1e-3);
    let cell = extent / res;
    let nx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
    let nz = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
    if (nx * nz > MAX_CELLS) {
        const f = Math.sqrt((nx * nz) / MAX_CELLS);
        cell *= f;
        nx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
        nz = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
    }
    const heights = new Float32Array(nx * nz).fill(Number.NaN);
    const put = (ix, iz, y) => {
        const k = iz * nx + ix;
        const cur = heights[k];
        if (cur !== cur || y > cur)
            heights[k] = y;
    };
    for (const m of meshes)
        rasterize(m, minX, minZ, cell, nx, nz, put);
    return new HeightGrid(minX, minZ, cell, nx, nz, heights);
}
function rasterize(m, minX, minZ, cell, nx, nz, put) {
    const p = m.positions;
    const idx = m.indices;
    const vertexCount = p.length / 3;
    for (let t = 0; t + 2 < idx.length; t += 3) {
        const a = idx[t];
        const b = idx[t + 1];
        const c = idx[t + 2];
        if (a >= vertexCount || b >= vertexCount || c >= vertexCount)
            continue;
        const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
        const bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
        const cx = p[c * 3], cy = p[c * 3 + 1], cz = p[c * 3 + 2];
        const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (!Number.isFinite(det) || Math.abs(det) < 1e-12)
            continue; // vertical or degenerate in XZ
        const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / cell));
        const x1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - minX) / cell));
        const z0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - minZ) / cell));
        const z1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - minZ) / cell));
        let covered = false;
        for (let iz = z0; iz <= z1; iz++) {
            const pz = minZ + (iz + 0.5) * cell;
            for (let ix = x0; ix <= x1; ix++) {
                const px = minX + (ix + 0.5) * cell;
                const w0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
                const w1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
                const w2 = 1 - w0 - w1;
                if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6)
                    continue;
                put(ix, iz, w0 * ay + w1 * by + w2 * cy);
                covered = true;
            }
        }
        if (!covered) {
            // Triangle smaller than a cell: splat its centroid so thin features are not lost.
            const gx = Math.min(nx - 1, Math.max(0, Math.floor(((ax + bx + cx) / 3 - minX) / cell)));
            const gz = Math.min(nz - 1, Math.max(0, Math.floor(((az + bz + cz) / 3 - minZ) / cell)));
            put(gx, gz, Math.max(ay, by, cy));
        }
    }
}
