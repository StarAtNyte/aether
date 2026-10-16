import { CHUNK, HEIGHT } from './constants';
import { REGION, REGION_LAYER } from './light';
/** Entries of {@link ChunkMesh.heights}: solid tops, then foliage tops. */
export const HEIGHTS_LENGTH = CHUNK * CHUNK * 2;
/** Height of a liquid surface inside its block. */
export const LIQUID_SURFACE = 0.875;
class QuadWriter {
    cap;
    positions;
    uvs;
    data;
    quads = 0;
    constructor(cap) {
        this.cap = cap;
        this.positions = new Float32Array(cap * 12);
        this.uvs = new Float32Array(cap * 8);
        this.data = new Uint8Array(cap * 16);
    }
    reset() {
        this.quads = 0;
    }
    ensure() {
        if (this.quads < this.cap)
            return;
        const cap = this.cap * 2;
        const p = new Float32Array(cap * 12);
        p.set(this.positions);
        const u = new Float32Array(cap * 8);
        u.set(this.uvs);
        const d = new Uint8Array(cap * 16);
        d.set(this.data);
        this.positions = p;
        this.uvs = u;
        this.data = d;
        this.cap = cap;
    }
    /** Copy out exactly-sized buffers (transferable), or null when empty. */
    finish() {
        const n = this.quads;
        if (n === 0)
            return null;
        const vertices = n * 4;
        const indices = vertices > 65535 ? new Uint32Array(n * 6) : new Uint16Array(n * 6);
        const d = this.data;
        for (let q = 0; q < n; q++) {
            const v = q * 4;
            const o = q * 6;
            // Split along the brighter diagonal (AO + light of corners 0/2 vs 1/3).
            const b0 = d[v * 4 + 1] + d[v * 4 + 2] + d[v * 4 + 3];
            const b1 = d[(v + 1) * 4 + 1] + d[(v + 1) * 4 + 2] + d[(v + 1) * 4 + 3];
            const b2 = d[(v + 2) * 4 + 1] + d[(v + 2) * 4 + 2] + d[(v + 2) * 4 + 3];
            const b3 = d[(v + 3) * 4 + 1] + d[(v + 3) * 4 + 2] + d[(v + 3) * 4 + 3];
            if (b0 + b2 >= b1 + b3) {
                indices[o] = v;
                indices[o + 1] = v + 1;
                indices[o + 2] = v + 2;
                indices[o + 3] = v;
                indices[o + 4] = v + 2;
                indices[o + 5] = v + 3;
            }
            else {
                indices[o] = v + 1;
                indices[o + 1] = v + 2;
                indices[o + 2] = v + 3;
                indices[o + 3] = v + 1;
                indices[o + 4] = v + 3;
                indices[o + 5] = v;
            }
        }
        return {
            positions: this.positions.slice(0, vertices * 3),
            uvs: this.uvs.slice(0, vertices * 2),
            data: this.data.slice(0, vertices * 4),
            indices,
            quads: n,
        };
    }
}
const DIRS = (() => {
    const raw = [
        [0, 1, 2, 1, 2], [0, -1, 2, 1, 2], [1, 1, 0, 2, 0], [1, -1, 0, 2, 1], [2, 1, 0, 1, 2], [2, -1, 0, 1, 2],
    ];
    return raw.map(([axis, sign, u, v, face]) => {
        const e = (a) => [a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 2 ? 1 : 0];
        const U = e(u);
        const V = e(v);
        const cross = [U[1] * V[2] - U[2] * V[1], U[2] * V[0] - U[0] * V[2], U[0] * V[1] - U[1] * V[0]];
        const n = e(axis).map((c) => c * sign);
        const dot = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2];
        return { axis, sign, u, v, face, ccw: dot > 0 ? 1 : -1 };
    });
})();
const STRIDE = [1, REGION_LAYER, REGION];
const PASS_OPAQUE = 0;
const PASS_CUTOUT = 1;
const PASS_LIQUID = 2;
const MASK_CELLS = CHUNK * HEIGHT;
const ORDER_CCW = [0, 1, 2, 3];
const ORDER_CW = [0, 3, 2, 1];
const EMIT_POS = [0, 0, 0];
/** Reusable chunk mesher (one per worker). */
export class ChunkMesher {
    reg;
    writers = [new QuadWriter(4096), new QuadWriter(1024), new QuadWriter(1024)];
    /** Per mask cell: visible flag | pass | tile | uniform flag. */
    maskA = new Int32Array(MASK_CELLS);
    /** Per mask cell: packed AO (4×2 bits) + light (sky 4×4 bits, block 4×4 bits) when uniform; or a cell key. */
    maskB = new Int32Array(MASK_CELLS);
    maskC = new Int32Array(MASK_CELLS);
    corner = new Uint8Array(12);
    minY = HEIGHT;
    maxY = -1;
    constructor(reg) {
        this.reg = reg;
    }
    /**
     * Mesh the centre chunk of `vol` (blocks and light must be computed).
     * `top` bounds the work: no geometry above it.
     */
    mesh(vol) {
        for (const w of this.writers)
            w.reset();
        this.minY = HEIGHT;
        this.maxY = -1;
        const y1 = Math.min(HEIGHT - 1, vol.top);
        if (y1 >= 0) {
            for (let d = 0; d < 6; d++)
                this.meshDirection(vol, DIRS[d], y1);
            this.meshCross(vol, y1);
        }
        return {
            heights: this.columnTops(vol, y1),
            opaque: this.writers[PASS_OPAQUE].finish(),
            cutout: this.writers[PASS_CUTOUT].finish(),
            liquid: this.writers[PASS_LIQUID].finish(),
            minY: this.minY,
            maxY: this.maxY,
        };
    }
    /** Column tops of the centre chunk (see {@link ChunkMesh.heights}). */
    columnTops(vol, y1) {
        const out = new Uint8Array(HEIGHTS_LENGTH);
        if (y1 < 0)
            return out;
        const blocks = vol.blocks;
        const opaque = this.reg.opaque;
        const render = this.reg.render;
        const cost = this.reg.lightCost;
        for (let z = 0; z < CHUNK; z++) {
            for (let x = 0; x < CHUNK; x++) {
                const base = x + CHUNK + (z + CHUNK) * REGION;
                let foliage = 0;
                let solid = 0;
                for (let y = y1; y >= 0; y--) {
                    const b = blocks[base + y * REGION_LAYER];
                    if (opaque[b] === 1) {
                        solid = y + 1;
                        break;
                    }
                    if (foliage === 0 && render[b] === 2 && cost[b] >= 2)
                        foliage = y + 1;
                }
                out[x + z * CHUNK] = solid;
                out[CHUNK * CHUNK + x + z * CHUNK] = foliage;
            }
        }
        return out;
    }
    meshDirection(vol, dir, y1) {
        const reg = this.reg;
        const blocks = vol.blocks;
        const render = reg.render;
        const opaque = reg.opaque;
        const tiles = reg.faceTiles;
        const { axis, sign, u: ua, v: va } = dir;
        const sn = STRIDE[axis] * sign;
        const su = STRIDE[ua];
        const sv = STRIDE[va];
        const lenA = axis === 1 ? y1 + 1 : CHUNK;
        const lenU = ua === 1 ? y1 + 1 : CHUNK;
        const lenV = va === 1 ? y1 + 1 : CHUNK;
        const maskA = this.maskA;
        const maskB = this.maskB;
        const maskC = this.maskC;
        const c = this.corner;
        const pos = [0, 0, 0];
        for (let s = 0; s < lenA; s++) {
            // Build the mask of visible faces in this slice.
            let any = false;
            for (let v = 0; v < lenV; v++) {
                for (let u = 0; u < lenU; u++) {
                    pos[axis] = s;
                    pos[ua] = u;
                    pos[va] = v;
                    const m = u + v * lenU;
                    maskA[m] = 0;
                    const ry = pos[1];
                    const i = pos[0] + CHUNK + (pos[2] + CHUNK) * REGION + ry * REGION_LAYER;
                    const b = blocks[i];
                    const r = render[b];
                    if (r === 0 || r === 3)
                        continue;
                    const ny = ry + (axis === 1 ? sign : 0);
                    let nb = 0;
                    if (ny >= 0 && ny < HEIGHT)
                        nb = blocks[i + sn];
                    else if (ny < 0)
                        continue; // never draw the underside of the world
                    if (opaque[nb] === 1)
                        continue;
                    let pass = PASS_OPAQUE;
                    if (r === 2) {
                        if (nb === b)
                            continue;
                        pass = PASS_CUTOUT;
                    }
                    else if (r === 4) {
                        if (nb === b || (render[nb] === 4 && axis === 1 && sign < 0))
                            continue;
                        pass = PASS_LIQUID;
                    }
                    const tile = tiles[b * 3 + dir.face];
                    // Corner AO + light on the outer side of the face.
                    const o = i + sn;
                    const outside = ny >= 0 && ny < HEIGHT;
                    const emit = reg.emissive[b];
                    this.corners(vol, o, outside, su, sv, ny, emit);
                    const uniform = c[0] === c[1] && c[1] === c[2] && c[2] === c[3] && c[4] === c[5] && c[5] === c[6] && c[6] === c[7] && c[8] === c[9] && c[9] === c[10] && c[10] === c[11];
                    // Liquid sides keep their own (lowered) top edge: never merged.
                    const mergeable = uniform && !(pass === PASS_LIQUID && axis !== 1);
                    maskA[m] = (1 << 30) | (mergeable ? 1 << 29 : 0) | (pass << 24) | tile;
                    maskB[m] = c[0] | (c[1] << 2) | (c[2] << 4) | (c[3] << 6) | (c[4] << 8) | (c[5] << 12) | (c[6] << 16) | (c[7] << 20);
                    maskC[m] = c[8] | (c[9] << 4) | (c[10] << 8) | (c[11] << 12) | (pass === PASS_LIQUID && axis !== 1 && !this.liquidAbove(blocks, i, ry) ? 1 << 16 : 0);
                    any = true;
                }
            }
            if (!any)
                continue;
            // Greedy merge.
            for (let v = 0; v < lenV; v++) {
                for (let u = 0; u < lenU;) {
                    const m = u + v * lenU;
                    const a = maskA[m];
                    if (a === 0) {
                        u++;
                        continue;
                    }
                    const bkey = maskB[m];
                    const ckey = maskC[m];
                    let w = 1;
                    let h = 1;
                    if (a & (1 << 29)) {
                        while (u + w < lenU && maskA[m + w] === a && maskB[m + w] === bkey && maskC[m + w] === ckey)
                            w++;
                        outer: while (v + h < lenV) {
                            const row = m + h * lenU;
                            for (let k = 0; k < w; k++)
                                if (maskA[row + k] !== a || maskB[row + k] !== bkey || maskC[row + k] !== ckey)
                                    break outer;
                            h++;
                        }
                    }
                    for (let dv = 0; dv < h; dv++)
                        for (let du = 0; du < w; du++)
                            maskA[m + du + dv * lenU] = 0;
                    this.emit(dir, s, u, v, w, h, a, bkey, ckey);
                    u += w;
                }
            }
        }
    }
    liquidAbove(blocks, i, y) {
        return y + 1 < HEIGHT && this.reg.render[blocks[i + REGION_LAYER]] === 4;
    }
    /**
     * AO (c[0..3]), sky light (c[4..7]) and block light (c[8..11]) of the four
     * face corners: c0 = (−U, −V), c1 = (+U, −V), c2 = (+U, +V), c3 = (−U, +V).
     */
    corners(vol, o, outside, su, sv, ny, emit) {
        const c = this.corner;
        if (!outside) {
            // Above the world: full sky, no occlusion.
            for (let k = 0; k < 4; k++) {
                c[k] = 3;
                c[4 + k] = 15;
                c[8 + k] = emit;
            }
            return;
        }
        const opaque = this.reg.opaque;
        const blocks = vol.blocks;
        const sky = vol.sky;
        const bl = vol.block;
        const cs = sky[o];
        const cb = bl[o];
        for (let k = 0; k < 4; k++) {
            const du = k === 1 || k === 2 ? 1 : -1;
            const dv = k >= 2 ? 1 : -1;
            const iu = o + du * su;
            const iv = o + dv * sv;
            const ic = iu + dv * sv;
            const yu = su === REGION_LAYER ? du : 0;
            const yv = sv === REGION_LAYER ? dv : 0;
            // Vertical neighbours may leave the world: treat them as open sky.
            const okU = ny + yu >= 0 && ny + yu < HEIGHT;
            const okV = ny + yv >= 0 && ny + yv < HEIGHT;
            const okC = ny + yu + yv >= 0 && ny + yu + yv < HEIGHT;
            const s1 = okU && opaque[blocks[iu]] === 1 ? 1 : 0;
            const s2 = okV && opaque[blocks[iv]] === 1 ? 1 : 0;
            const cc = okC && opaque[blocks[ic]] === 1 ? 1 : 0;
            c[k] = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
            let ss = cs;
            let sb = cb;
            let n = 1;
            if (!s1) {
                ss += okU ? sky[iu] : 15;
                sb += okU ? bl[iu] : 0;
                n++;
            }
            if (!s2) {
                ss += okV ? sky[iv] : 15;
                sb += okV ? bl[iv] : 0;
                n++;
            }
            if (!cc && !(s1 && s2)) {
                ss += okC ? sky[ic] : 15;
                sb += okC ? bl[ic] : 0;
                n++;
            }
            c[4 + k] = Math.round(ss / n);
            c[8 + k] = Math.max(emit, Math.round(sb / n));
        }
    }
    emit(dir, s, u, v, w, h, a, bkey, ckey) {
        const pass = (a >>> 24) & 3;
        const tile = a & 0xffff;
        const writer = this.writers[pass];
        writer.ensure();
        const q = writer.quads++;
        const P = writer.positions;
        const UV = writer.uvs;
        const D = writer.data;
        let plane = s + (dir.sign > 0 ? 1 : 0);
        if (pass === PASS_LIQUID && dir.axis === 1 && dir.sign > 0)
            plane = s + LIQUID_SURFACE;
        const lowered = (ckey >>> 16) & 1;
        const order = dir.ccw > 0 ? ORDER_CCW : ORDER_CW;
        const pos = EMIT_POS;
        for (let k = 0; k < 4; k++) {
            const corner = order[k];
            const cu = corner === 1 || corner === 2 ? u + w : u;
            let cv = corner >= 2 ? v + h : v;
            if (lowered && dir.v === 1 && corner >= 2)
                cv = cv - 1 + LIQUID_SURFACE;
            pos[dir.axis] = plane;
            pos[dir.u] = cu;
            pos[dir.v] = cv;
            const vi = q * 4 + k;
            P[vi * 3] = pos[0];
            P[vi * 3 + 1] = pos[1];
            P[vi * 3 + 2] = pos[2];
            UV[vi * 2] = cu * dir.ccw;
            UV[vi * 2 + 1] = cv;
            const ao = (bkey >>> (corner * 2)) & 3;
            const sky = (bkey >>> (8 + corner * 4)) & 15;
            const bl = (ckey >>> (corner * 4)) & 15;
            D[vi * 4] = tile;
            D[vi * 4 + 1] = ao * 85;
            D[vi * 4 + 2] = sky * 17;
            D[vi * 4 + 3] = bl * 17;
            const y = pos[1];
            if (y < this.minY)
                this.minY = Math.floor(y);
            if (y > this.maxY)
                this.maxY = Math.ceil(y);
        }
    }
    /** Cross sprites (flowers, grass, torches): two diagonal quads per cell, drawn double-sided. */
    meshCross(vol, y1) {
        const reg = this.reg;
        const writer = this.writers[PASS_CUTOUT];
        const blocks = vol.blocks;
        for (let y = 0; y <= y1; y++) {
            for (let z = 0; z < CHUNK; z++) {
                for (let x = 0; x < CHUNK; x++) {
                    const i = x + CHUNK + (z + CHUNK) * REGION + y * REGION_LAYER;
                    const b = blocks[i];
                    if (reg.render[b] !== 3)
                        continue;
                    const tile = reg.faceTiles[b * 3];
                    const sky = vol.sky[i];
                    const bl = Math.max(vol.block[i], reg.emissive[b]);
                    const inset = 0.15;
                    for (let d = 0; d < 2; d++) {
                        writer.ensure();
                        const q = writer.quads++;
                        const x0 = x + inset;
                        const x1 = x + 1 - inset;
                        const z0 = d === 0 ? z + inset : z + 1 - inset;
                        const z1 = d === 0 ? z + 1 - inset : z + inset;
                        for (let k = 0; k < 4; k++) {
                            const far = k === 1 || k === 2;
                            const vi = q * 4 + k;
                            writer.positions[vi * 3] = far ? x1 : x0;
                            writer.positions[vi * 3 + 1] = k >= 2 ? y + 1 : y;
                            writer.positions[vi * 3 + 2] = far ? z1 : z0;
                            writer.uvs[vi * 2] = far ? 1 : 0;
                            writer.uvs[vi * 2 + 1] = k >= 2 ? 1 : 0;
                            writer.data[vi * 4] = tile;
                            writer.data[vi * 4 + 1] = 255;
                            writer.data[vi * 4 + 2] = sky * 17;
                            writer.data[vi * 4 + 3] = bl * 17;
                        }
                        if (y < this.minY)
                            this.minY = y;
                        if (y + 1 > this.maxY)
                            this.maxY = y + 1;
                    }
                }
            }
        }
    }
}
