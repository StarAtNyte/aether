/**
 * Voxel meshing: culled faces vs classic greedy vs binary greedy (bitwise).
 *
 * Run: nice -n 15 npx tsx experiments/voxel-meshing/bench.ts
 *
 * Chunk 32³, single material, two fields: rolling terrain (heightmap) and
 * 3D-noise caves (worst case for greedy merging). Counts quads and times.
 */
import { performance } from 'node:perf_hooks';
import { median } from '../lib/meshes';
const N = 32;
const idx = (x, y, z) => (x * N + y) * N + z;
function field(kind) {
    const v = new Uint8Array(N * N * N);
    for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
            for (let z = 0; z < N; z++) {
                const h = 12 + 6 * Math.sin(x * 0.21) * Math.cos(z * 0.17) + 3 * Math.sin((x + z) * 0.53);
                const c = Math.sin(x * 0.31 + y * 0.17) + Math.sin(y * 0.29 + z * 0.23) + Math.sin(z * 0.37 + x * 0.19);
                v[idx(x, y, z)] = kind === 'terrain' ? (y < h ? 1 : 0) : c > 0.4 ? 1 : 0;
            }
    return v;
}
const solid = (v, x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < N && y < N && z < N && v[idx(x, y, z)] === 1;
/** One quad per exposed face. */
function culled(v) {
    let quads = 0;
    for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
            for (let z = 0; z < N; z++) {
                if (!solid(v, x, y, z))
                    continue;
                if (!solid(v, x + 1, y, z))
                    quads++;
                if (!solid(v, x - 1, y, z))
                    quads++;
                if (!solid(v, x, y + 1, z))
                    quads++;
                if (!solid(v, x, y - 1, z))
                    quads++;
                if (!solid(v, x, y, z + 1))
                    quads++;
                if (!solid(v, x, y, z - 1))
                    quads++;
            }
    return quads;
}
/** Classic greedy meshing (Lysenko): per axis/direction, 2D masks merged into maximal rectangles. */
function greedy(v) {
    let quads = 0;
    const mask = new Uint8Array(N * N);
    const q = [0, 0, 0];
    const p = [0, 0, 0];
    for (let d = 0; d < 3; d++) {
        const u = (d + 1) % 3, w = (d + 2) % 3;
        for (const dir of [1, -1]) {
            for (p[d] = 0; p[d] < N; p[d]++) {
                for (p[w] = 0; p[w] < N; p[w]++)
                    for (p[u] = 0; p[u] < N; p[u]++) {
                        q[0] = p[0];
                        q[1] = p[1];
                        q[2] = p[2];
                        q[d] += dir;
                        mask[p[w] * N + p[u]] = solid(v, p[0], p[1], p[2]) && !solid(v, q[0], q[1], q[2]) ? 1 : 0;
                    }
                for (let j = 0; j < N; j++)
                    for (let i = 0; i < N;) {
                        if (!mask[j * N + i]) {
                            i++;
                            continue;
                        }
                        let wdt = 1;
                        while (i + wdt < N && mask[j * N + i + wdt])
                            wdt++;
                        let h = 1;
                        outer: for (; j + h < N; h++)
                            for (let k = 0; k < wdt; k++)
                                if (!mask[(j + h) * N + i + k])
                                    break outer;
                        for (let a = 0; a < h; a++)
                            for (let k = 0; k < wdt; k++)
                                mask[(j + a) * N + i + k] = 0;
                        quads++;
                        i += wdt;
                    }
            }
        }
    }
    return quads;
}
/**
 * Binary greedy meshing: solid columns as 32-bit masks; face bits per column
 * from `col & ~(col >> 1)` style shifts; merging walks bit rows with
 * Math.clz32 / trailing-zero tricks (32 cells per op).
 */
function binaryGreedy(v) {
    // cols[axis][a*N+b] = bits along axis
    const cols = [new Uint32Array(N * N), new Uint32Array(N * N), new Uint32Array(N * N)];
    for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
            for (let z = 0; z < N; z++) {
                if (v[idx(x, y, z)] !== 1)
                    continue;
                cols[0][y * N + z] |= 1 << x;
                cols[1][x * N + z] |= 1 << y;
                cols[2][x * N + y] |= 1 << z;
            }
    let quads = 0;
    let area = 0;
    // plane[s][a] = bitmask over b of faces at slice s (axis), row a
    const plane = new Uint32Array(N * N);
    for (let axis = 0; axis < 3; axis++) {
        const c = cols[axis];
        for (const dir of [0, 1]) {
            plane.fill(0);
            for (let a = 0; a < N; a++)
                for (let b = 0; b < N; b++) {
                    const col = c[a * N + b];
                    let faces = dir === 0 ? (col & ~(col << 1)) >>> 0 : (col & ~(col >>> 1)) >>> 0;
                    while (faces !== 0) {
                        const s = 31 - Math.clz32(faces & -faces);
                        faces &= faces - 1;
                        plane[s * N + a] |= 1 << b;
                    }
                }
            for (let s = 0; s < N; s++) {
                for (let a = 0; a < N; a++) {
                    let row = plane[s * N + a];
                    while (row !== 0) {
                        const b0 = 31 - Math.clz32(row & -row);
                        const rest = ~(row >>> b0) >>> 0;
                        const len = Math.min(rest === 0 ? 32 : 31 - Math.clz32(rest & -rest), 32 - b0);
                        const m = len >= 32 ? 0xffffffff : (((1 << len) - 1) << b0) >>> 0;
                        let h = 1;
                        while (a + h < N && (plane[s * N + a + h] & m) >>> 0 === m) {
                            plane[s * N + a + h] = (plane[s * N + a + h] & ~m) >>> 0;
                            h++;
                        }
                        row = (row & ~m) >>> 0;
                        quads++;
                        area += len * h;
                    }
                }
            }
        }
    }
    lastArea = area;
    return quads;
}
let lastArea = 0;
for (const kind of ['terrain', 'caves']) {
    const v = field(kind);
    for (const [name, fn] of [['culled', culled], ['greedy', greedy], ['binary greedy', binaryGreedy]]) {
        let quads = 0;
        const times = [];
        for (let i = 0; i < 30; i++) {
            const t0 = performance.now();
            quads = fn(v);
            times.push(performance.now() - t0);
        }
        const check = name === 'binary greedy' ? `  (covers ${lastArea} faces, culled ${culled(v)})` : '';
        console.log(`${kind.padEnd(8)} ${name.padEnd(14)} ${String(quads).padStart(6)} quads  ${median(times).toFixed(3)} ms / 32³ chunk${check}`);
    }
}
