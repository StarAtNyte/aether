/** Quantisation step used to weld coincident vertices (metres). */
export const WELD_EPSILON = 1e-5;
/** Undirected edge key of two vertex ids (< 65 536 each, so the key is an exact integer). */
export function edgeKey(a, b) {
    return a < b ? a * 65_536 + b : b * 65_536 + a;
}
/** The two vertex ids of an edge key. */
export function edgeEnds(key) {
    const a = Math.floor(key / 65_536);
    return [a, key - a * 65_536];
}
/** Map each vertex to the smallest-index vertex at the same (quantised) position. */
export function weldMap(positions, eps = WELD_EPSILON) {
    const n = positions.length / 3;
    const out = new Uint32Array(n);
    const seen = new Map();
    const inv = 1 / eps;
    for (let v = 0; v < n; v++) {
        const key = `${Math.round(positions[v * 3] * inv)},${Math.round(positions[v * 3 + 1] * inv)},${Math.round(positions[v * 3 + 2] * inv)}`;
        const hit = seen.get(key);
        if (hit === undefined) {
            seen.set(key, v);
            out[v] = v;
        }
        else
            out[v] = hit;
    }
    return out;
}
/** Build the welded topology (O(vertices + triangles)). */
export function buildTopology(mesh) {
    const n = mesh.positions.length / 3;
    const weld = weldMap(mesh.positions);
    // copies (CSR by welded id)
    const count = new Uint32Array(n + 1);
    for (let v = 0; v < n; v++) {
        const w = weld[v] + 1;
        count[w] = count[w] + 1;
    }
    const copyStart = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++)
        copyStart[i + 1] = copyStart[i] + count[i + 1];
    const fill = copyStart.slice(0, n);
    const copies = new Uint32Array(n);
    for (let v = 0; v < n; v++) {
        const w = weld[v];
        const at = fill[w];
        copies[at] = v;
        fill[w] = at + 1;
    }
    // edges
    const idx = mesh.indices;
    const edgeFaces = new Map();
    const adj = new Map();
    const link = (a, b) => {
        let s = adj.get(a);
        if (!s)
            adj.set(a, (s = new Set()));
        s.add(b);
    };
    for (let t = 0; t < idx.length; t += 3) {
        const a = weld[idx[t]];
        const b = weld[idx[t + 1]];
        const c = weld[idx[t + 2]];
        for (const [x, y] of [[a, b], [b, c], [c, a]]) {
            if (x === y)
                continue;
            const k = edgeKey(x, y);
            edgeFaces.set(k, (edgeFaces.get(k) ?? 0) + 1);
            link(x, y);
            link(y, x);
        }
    }
    const nStart = new Uint32Array(n + 1);
    for (let w = 0; w < n; w++)
        nStart[w + 1] = nStart[w] + (adj.get(w)?.size ?? 0);
    const neighbors = new Uint32Array(nStart[n]);
    for (let w = 0; w < n; w++) {
        const s = adj.get(w);
        if (!s)
            continue;
        let o = nStart[w];
        for (const x of s)
            neighbors[o++] = x;
    }
    const repList = [];
    for (let v = 0; v < n; v++)
        if (weld[v] === v)
            repList.push(v);
    return { weld, copyStart, copies, nStart, neighbors, reps: Uint32Array.from(repList), edgeFaces };
}
/** Welded ids lying on an open boundary (an edge used by exactly one face). */
export function boundaryVertices(topo) {
    const out = new Set();
    for (const [k, c] of topo.edgeFaces) {
        if (c !== 1)
            continue;
        const [a, b] = edgeEnds(k);
        out.add(a);
        out.add(b);
    }
    return out;
}
/** Copy the position of each representative to all its split copies. */
export function syncCopies(positions, topo) {
    const { weld } = topo;
    for (let v = 0; v < weld.length; v++) {
        const w = weld[v];
        if (w === v)
            continue;
        positions[v * 3] = positions[w * 3];
        positions[v * 3 + 1] = positions[w * 3 + 1];
        positions[v * 3 + 2] = positions[w * 3 + 2];
    }
}
/** Analyse mesh health on the welded topology. */
export function meshHealth(mesh) {
    const topo = buildTopology(mesh);
    let boundary = 0;
    let nonManifold = 0;
    for (const c of topo.edgeFaces.values()) {
        if (c === 1)
            boundary++;
        else if (c > 2)
            nonManifold++;
    }
    let degenerate = 0;
    const idx = mesh.indices;
    for (let t = 0; t < idx.length; t += 3) {
        const a = topo.weld[idx[t]];
        const b = topo.weld[idx[t + 1]];
        const c = topo.weld[idx[t + 2]];
        if (a === b || b === c || c === a)
            degenerate++;
    }
    return { vertices: mesh.positions.length / 3, triangles: idx.length / 3, boundaryEdges: boundary, nonManifoldEdges: nonManifold, degenerate, closed: boundary === 0 && nonManifold === 0 };
}
/** Signed volume of a mesh (positive when faces wind counter-clockwise seen from outside). */
export function signedVolume(mesh, faces) {
    const p = mesh.positions;
    const idx = mesh.indices;
    let vol = 0;
    const one = (t) => {
        const a = idx[t * 3] * 3;
        const b = idx[t * 3 + 1] * 3;
        const c = idx[t * 3 + 2] * 3;
        const ax = p[a], ay = p[a + 1], az = p[a + 2];
        const bx = p[b], by = p[b + 1], bz = p[b + 2];
        const cx = p[c], cy = p[c + 1], cz = p[c + 2];
        vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    };
    if (faces)
        for (const t of faces)
            one(t);
    else
        for (let t = 0; t < idx.length / 3; t++)
            one(t);
    return vol;
}
/** Face normal (unnormalised, length = 2 × area) of triangle `t`, written into `out`. */
export function faceNormal(mesh, t, out) {
    const p = mesh.positions;
    const a = mesh.indices[t * 3] * 3;
    const b = mesh.indices[t * 3 + 1] * 3;
    const c = mesh.indices[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    out[0] = uy * vz - uz * vy;
    out[1] = uz * vx - ux * vz;
    out[2] = ux * vy - uy * vx;
    return out;
}
