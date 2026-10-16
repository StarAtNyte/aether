import { hash3 } from './noise';
/** Leave the existing block. */
export const KEEP = 0;
/** Set air. */
export const CARVE = 0xffff;
/** Fill with the foundation block where the world is not solid. */
export const FOUNDATION = 0xfffe;
/** Writable model with ground-relative coordinates (y = 0 is the first block above ground). */
class Builder {
    sx;
    sy;
    sz;
    ay;
    data;
    constructor(sx, sy, sz, ay) {
        this.sx = sx;
        this.sy = sy;
        this.sz = sz;
        this.ay = ay;
        this.data = new Uint16Array(sx * sy * sz);
    }
    set(x, y, z, v) {
        const my = y + this.ay;
        if (x < 0 || x >= this.sx || z < 0 || z >= this.sz || my < 0 || my >= this.sy)
            return;
        this.data[x + z * this.sx + my * this.sx * this.sz] = v;
    }
    get(x, y, z) {
        const my = y + this.ay;
        if (x < 0 || x >= this.sx || z < 0 || z >= this.sz || my < 0 || my >= this.sy)
            return KEEP;
        return this.data[x + z * this.sx + my * this.sx * this.sz];
    }
    box(x0, y0, z0, x1, y1, z1, v) {
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
            for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
                for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
                    this.set(x, y, z, v);
    }
    /** Walls only (no floor or ceiling) of a box. */
    walls(x0, y0, z0, x1, y1, z1, v) {
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                this.set(x, y, z0, v);
                this.set(x, y, z1, v);
            }
            for (let z = z0; z <= z1; z++) {
                this.set(x0, y, z, v);
                this.set(x1, y, z, v);
            }
        }
    }
    /** Disc (filled or ring of thickness 1) at height y. */
    disc(cx, cz, r, y, v, ring = false) {
        const ri = Math.ceil(r);
        for (let dz = -ri; dz <= ri; dz++) {
            for (let dx = -ri; dx <= ri; dx++) {
                const d = Math.hypot(dx, dz);
                if (d > r + 0.35)
                    continue;
                if (ring && d < r - 0.65)
                    continue;
                this.set(cx + dx, y, cz + dz, v);
            }
        }
    }
    /** Alternating merlons on the outer ring of a disc / the edge of a rectangle at height y. */
    crenelRing(cx, cz, r, y, v) {
        const ri = Math.ceil(r);
        for (let dz = -ri; dz <= ri; dz++) {
            for (let dx = -ri; dx <= ri; dx++) {
                const d = Math.hypot(dx, dz);
                if (d > r + 0.35 || d < r - 0.65)
                    continue;
                if (((dx + dz) & 1) === 0)
                    this.set(cx + dx, y, cz + dz, v);
            }
        }
    }
    crenelRect(x0, z0, x1, z1, y, v) {
        for (let x = x0; x <= x1; x++) {
            if (((x - x0) & 1) === 0) {
                this.set(x, y, z0, v);
                this.set(x, y, z1, v);
            }
        }
        for (let z = z0; z <= z1; z++) {
            if (((z - z0) & 1) === 0) {
                this.set(x0, y, z, v);
                this.set(x1, y, z, v);
            }
        }
    }
    /** Foundation plinth under a footprint (depth blocks below ground). */
    plinth(x0, z0, x1, z1, depth) {
        this.box(x0, -depth, z0, x1, -1, z1, FOUNDATION);
    }
    /** Pointed cone roof of radius r starting at height y. */
    cone(cx, cz, r, y, v) {
        let k = 0;
        for (let rr = r; rr >= 0; rr -= 0.75, k++)
            this.disc(cx, cz, rr, y + k, v);
        this.set(cx, y + k, cz, v);
    }
    model(ax, az, foundation) {
        return { sx: this.sx, sy: this.sy, sz: this.sz, ax, az, ay: this.ay, data: this.data, foundation };
    }
}
function palette(reg, p, d) {
    const pick = (k) => {
        const name = p[k] ?? d[k];
        return name === 'air' ? CARVE : reg.idOr(name, reg.idOr(d[k]));
    };
    return { wall: pick('wall'), roof: pick('roof'), floor: pick('floor'), trim: pick('trim'), window: pick('window'), accent: pick('accent') };
}
const DIMS = { small: 0, medium: 1, large: 2 };
function house(reg, req) {
    const p = palette(reg, req.palette, { wall: 'oak_planks', roof: 'roof_tiles', floor: 'cobblestone', trim: 'oak_log', window: 'glass', accent: 'bricks' });
    const s = DIMS[req.size];
    const w = [7, 9, 13][s];
    const d = [7, 11, 15][s];
    const h = [4, 5, 6][s];
    const roofH = Math.ceil((w + 2) / 2) + 1;
    const M = 1; // overhang margin
    const depth = 6;
    const b = new Builder(w + 2 * M, depth + h + roofH + 4, d + 2 * M + 3, depth);
    const X0 = M;
    const Z0 = M;
    const X1 = M + w - 1;
    const Z1 = M + d - 1;
    b.box(X0 - 1, 0, Z0 - 1, X1 + 1, h + roofH + 3, Z1 + 3, CARVE);
    b.plinth(X0, Z0, X1, Z1, depth);
    b.box(X0, 0, Z0, X1, 0, Z1, p.floor);
    b.walls(X0, 1, Z0, X1, h, Z1, p.wall);
    for (const [x, z] of [[X0, Z0], [X1, Z0], [X0, Z1], [X1, Z1]])
        b.box(x, 1, z, x, h, z, p.trim);
    // Beam under the roof.
    b.walls(X0, h, Z0, X1, h, Z1, p.trim);
    // Windows every third block along each wall (not at corners or the door).
    const doorX = X0 + Math.floor(w / 2);
    for (let x = X0 + 2; x <= X1 - 2; x += 2) {
        if (Math.abs(x - doorX) <= 1)
            continue;
        b.box(x, 2, Z0, x, Math.min(3, h - 1), Z0, p.window);
        b.box(x, 2, Z1, x, Math.min(3, h - 1), Z1, p.window);
    }
    for (let z = Z0 + 2; z <= Z1 - 2; z += 3) {
        b.box(X0, 2, z, X0, Math.min(3, h - 1), z, p.window);
        b.box(X1, 2, z, X1, Math.min(3, h - 1), z, p.window);
    }
    // Door and a short path.
    b.box(doorX, 1, Z1, doorX, 2, Z1, CARVE);
    const path = reg.idOr('gravel');
    for (let z = Z1 + 1; z <= Z1 + 3; z++)
        b.set(doorX, -1, z, path);
    // Gable roof: stepped layers on both sides, gables filled with the wall block.
    for (let k = 0;; k++) {
        const y = h + 1 + k;
        const xl = X0 - 1 + k;
        const xr = X1 + 1 - k;
        if (xl > xr)
            break;
        for (let z = Z0 - 1; z <= Z1 + 1; z++) {
            b.set(xl, y, z, p.roof);
            b.set(xr, y, z, p.roof);
        }
        for (let x = xl + 1; x <= xr - 1; x++) {
            b.set(x, y, Z0, p.wall);
            b.set(x, y, Z1, p.wall);
        }
    }
    // Chimney.
    b.box(X0 + 1, 1, Z0 + 1, X0 + 1, h + roofH, Z0 + 1, p.accent);
    // Interior: light, table and shelves.
    const torch = reg.idOr('torch');
    b.set(X1 - 1, 1, Z0 + 1, torch);
    b.set(X0 + 1, 1, Z1 - 1, torch);
    b.set(X1 - 1, 1, Z1 - 2, reg.idOr('crafting_table'));
    if (s > 0)
        for (let x = X0 + 3; x <= X1 - 2; x++)
            b.set(x, 1, Z0 + 1, reg.idOr('bookshelf'));
    return b.model(M + Math.floor(w / 2), M + Math.floor(d / 2), reg.idOr('cobblestone'));
}
function castle(reg, req) {
    const p = palette(reg, req.palette, { wall: 'stone_bricks', roof: 'roof_tiles', floor: 'gravel', trim: 'mossy_stone_bricks', window: 'glass', accent: 'red_wool' });
    const s = DIMS[req.size];
    const S = [21, 31, 47][s];
    const wallH = [7, 9, 11][s];
    const towerR = [3, 4, 5][s];
    const towerH = wallH + [4, 6, 8][s];
    const keep = [7, 11, 15][s];
    const keepH = wallH + [5, 8, 12][s];
    const M = towerR + 1;
    const depth = 8;
    const b = new Builder(S + 2 * M, depth + keepH + 14, S + 2 * M, depth);
    const X0 = M;
    const X1 = M + S - 1;
    b.box(X0 - M, 0, X0 - M, X1 + M, keepH + 12, X1 + M, CARVE);
    b.plinth(X0 - 1, X0 - 1, X1 + 1, X1 + 1, depth);
    b.box(X0, 0, X0, X1, 0, X1, p.floor);
    // Curtain walls (2 thick) with a walkway and merlons.
    b.walls(X0, 1, X0, X1, wallH, X1, p.wall);
    b.walls(X0 + 1, 1, X0 + 1, X1 - 1, wallH, X1 - 1, p.wall);
    b.crenelRect(X0, X0, X1, X1, wallH + 1, p.wall);
    // Mossy trim band at the base.
    b.walls(X0, 1, X0, X1, 1, X1, p.trim);
    // Gatehouse on the front (+z) wall: an arched opening.
    const gx = X0 + Math.floor(S / 2);
    b.box(gx - 2, 1, X1 - 1, gx + 2, 4, X1, CARVE);
    b.box(gx - 2, 4, X1 - 1, gx - 2, 4, X1, p.wall);
    b.box(gx + 2, 4, X1 - 1, gx + 2, 4, X1, p.wall);
    b.box(gx - 4, 1, X1 + 1, gx - 3, wallH + 3, X1 + 1, p.wall);
    b.box(gx + 3, 1, X1 + 1, gx + 4, wallH + 3, X1 + 1, p.wall);
    b.box(gx - 4, wallH + 2, X1, gx + 4, wallH + 2, X1 + 1, p.wall);
    b.crenelRect(gx - 4, X1, gx + 4, X1 + 1, wallH + 3, p.wall);
    // Banners either side of the gate.
    b.box(gx - 3, wallH - 3, X1 + 2, gx - 3, wallH, X1 + 2, p.accent);
    b.box(gx + 3, wallH - 3, X1 + 2, gx + 3, wallH, X1 + 2, p.accent);
    // Corner towers with pointed roofs.
    for (const [cx, cz] of [[X0, X0], [X1, X0], [X0, X1], [X1, X1]]) {
        for (let y = 0; y <= towerH; y++)
            b.disc(cx, cz, towerR, y, y === 0 ? p.floor : p.wall, y > 0);
        b.disc(cx, cz, towerR - 1, towerH, p.wall);
        for (let y = 3; y < towerH - 1; y += 4) {
            b.set(cx, y, cz - towerR, p.window);
            b.set(cx, y, cz + towerR, p.window);
            b.set(cx - towerR, y, cz, p.window);
            b.set(cx + towerR, y, cz, p.window);
        }
        if (s === 0)
            b.crenelRing(cx, cz, towerR, towerH + 1, p.wall);
        else
            b.cone(cx, cz, towerR + 1, towerH + 1, p.roof);
    }
    // The keep.
    const k0 = X0 + Math.floor((S - keep) / 2);
    const k1 = k0 + keep - 1;
    const kz0 = X0 + Math.floor((S - keep) / 2) - 2;
    const kz1 = kz0 + keep - 1;
    b.walls(k0, 1, kz0, k1, keepH, kz1, p.wall);
    for (let y = 0; y <= keepH; y += 5)
        b.box(k0, y, kz0, k1, y, kz1, y === 0 ? reg.idOr('smooth_stone') : p.wall);
    for (let y = 3; y < keepH - 1; y += 5) {
        for (let x = k0 + 2; x <= k1 - 2; x += 3) {
            b.box(x, y, kz0, x, y + 1, kz0, p.window);
            b.box(x, y, kz1, x, y + 1, kz1, p.window);
        }
        for (let z = kz0 + 2; z <= kz1 - 2; z += 3) {
            b.box(k0, y, z, k0, y + 1, z, p.window);
            b.box(k1, y, z, k1, y + 1, z, p.window);
        }
    }
    b.crenelRect(k0, kz0, k1, kz1, keepH + 1, p.wall);
    const kd = k0 + Math.floor(keep / 2);
    b.box(kd, 1, kz1, kd, 3, kz1, CARVE);
    b.box(kd - 1, 4, kz1 + 1, kd + 1, 4, kz1 + 1, p.trim);
    // Torches along the walkway and in the courtyard.
    const torch = reg.idOr('torch');
    for (let i = X0 + 3; i <= X1 - 3; i += 6) {
        b.set(i, wallH + 1, X0 + 1, torch);
        b.set(X0 + 1, wallH + 1, i, torch);
        b.set(X1 - 1, wallH + 1, i, torch);
    }
    b.set(kd - 2, 1, kz1 + 2, torch);
    b.set(kd + 2, 1, kz1 + 2, torch);
    b.set(kd, keepH + 1, Math.floor((kz0 + kz1) / 2), reg.idOr('glowstone'));
    return b.model(M + Math.floor(S / 2), M + Math.floor(S / 2), reg.idOr('cobblestone'));
}
function tower(reg, req) {
    const p = palette(reg, req.palette, { wall: 'stone_bricks', roof: 'roof_tiles', floor: 'smooth_stone', trim: 'mossy_stone_bricks', window: 'glass', accent: 'glowstone' });
    const s = DIMS[req.size];
    const r = [3, 4, 5][s];
    const h = [14, 22, 32][s];
    const depth = 8;
    const size = 2 * r + 5;
    const b = new Builder(size, depth + h + r + 8, size, depth);
    const c = Math.floor(size / 2);
    b.box(0, 0, 0, size - 1, h + r + 6, size - 1, CARVE);
    for (let y = -depth; y < 0; y++)
        b.disc(c, c, r + 1, y, FOUNDATION);
    for (let y = 0; y <= h; y++)
        b.disc(c, c, r, y, y === 0 ? p.floor : y < 3 ? p.trim : p.wall, y > 0);
    for (let y = 6; y < h; y += 6)
        b.disc(c, c, r - 1, y, p.floor);
    for (let y = 4; y < h - 1; y += 5) {
        b.box(c, y, c - r, c, y + 1, c - r, p.window);
        b.box(c - r, y, c, c - r, y + 1, c, p.window);
        b.box(c + r, y, c, c + r, y + 1, c, p.window);
        b.box(c, y, c + r, c, y + 1, c + r, p.window);
    }
    b.box(c, 1, c + r, c, 2, c + r, CARVE);
    // Overhanging parapet with merlons.
    b.disc(c, c, r + 1, h, p.wall);
    b.crenelRing(c, c, r + 1, h + 1, p.wall);
    if (s === 2)
        b.cone(c, c, r, h + 2, p.roof);
    else
        b.set(c, h + 1, c, p.accent);
    b.set(c + 1, 1, c, reg.idOr('torch'));
    return b.model(c, c, reg.idOr('cobblestone'));
}
function bridge(reg, req) {
    const p = palette(reg, req.palette, { wall: 'stone_bricks', roof: 'oak_planks', floor: 'oak_planks', trim: 'oak_log', window: 'glass', accent: 'glowstone' });
    const s = DIMS[req.size];
    const w = [3, 5, 7][s];
    const L = req.length ?? 24;
    const depth = 16;
    const b = new Builder(w + 2, depth + 6, L, depth);
    const x0 = 1;
    const x1 = w;
    b.box(0, 1, 0, w + 1, 4, L - 1, CARVE);
    b.box(x0, 0, 0, x1, 0, L - 1, p.floor);
    for (let z = 0; z < L; z++) {
        b.set(0, 0, z, p.trim);
        b.set(w + 1, 0, z, p.trim);
    }
    for (let z = 0; z < L; z += 4) {
        b.box(0, 1, z, 0, 1, z, p.trim);
        b.box(w + 1, 1, z, w + 1, 1, z, p.trim);
        if (z % 8 === 0) {
            b.set(0, 2, z, p.accent);
            b.set(w + 1, 2, z, p.accent);
        }
    }
    // Stone piers every 6 blocks down to the river bed, with arches between them.
    for (let z = 2; z < L - 1; z += 6) {
        for (let y = -depth; y < 0; y++)
            for (let x = 0; x <= w + 1; x++)
                b.set(x, y, z, y >= -2 ? p.wall : FOUNDATION);
    }
    for (let z = 0; z < L; z++) {
        const phase = ((z - 2) % 6 + 6) % 6;
        if (phase === 0)
            continue;
        const drop = phase === 1 || phase === 5 ? -2 : -1;
        for (let y = drop; y < 0; y++)
            for (let x = 0; x <= w + 1; x++)
                b.set(x, y, z, p.wall);
    }
    return b.model(Math.floor((w + 2) / 2), Math.floor(L / 2), reg.idOr('stone_bricks'));
}
function well(reg, req) {
    const p = palette(reg, req.palette, { wall: 'cobblestone', roof: 'oak_planks', floor: 'cobblestone', trim: 'oak_log', window: 'glass', accent: 'water' });
    const depth = 5;
    const b = new Builder(5, depth + 7, 5, depth);
    b.box(0, 0, 0, 4, 6, 4, CARVE);
    b.plinth(0, 0, 4, 4, depth);
    b.box(1, -3, 1, 3, -1, 3, p.accent);
    b.walls(0, -1, 0, 4, 1, 4, p.wall);
    b.box(1, 0, 1, 3, 0, 3, p.accent);
    b.box(0, 2, 2, 0, 3, 2, p.trim);
    b.box(4, 2, 2, 4, 3, 2, p.trim);
    b.box(0, 4, 1, 4, 4, 3, p.roof);
    b.box(1, 5, 2, 3, 5, 2, p.roof);
    return b.model(2, 2, reg.idOr('cobblestone'));
}
function pyramid(reg, req) {
    const p = palette(reg, req.palette, { wall: 'sandstone', roof: 'sandstone', floor: 'sandstone', trim: 'terracotta', window: 'glass', accent: 'gold_block' });
    const s = DIMS[req.size];
    const S = [15, 25, 41][s];
    const depth = 6;
    const H = Math.ceil(S / 2);
    const b = new Builder(S, depth + H + 2, S, depth);
    b.plinth(0, 0, S - 1, S - 1, depth);
    for (let k = 0; k < H; k++) {
        const block = k % 4 === 3 ? p.trim : p.wall;
        b.box(k, k, k, S - 1 - k, k, S - 1 - k, block);
    }
    const c = Math.floor(S / 2);
    b.set(c, H, c, p.accent);
    // Entrance tunnel on the front.
    b.box(c - 1, 0, S - 1 - Math.floor(S / 3), c + 1, 2, S - 1, CARVE);
    b.box(c - 1, 3, S - 1 - 2, c + 1, 3, S - 1 - 2, p.trim);
    b.set(c, 0, S - 1 - Math.floor(S / 3), reg.idOr('torch'));
    return b.model(c, c, reg.idOr('sandstone'));
}
function giantTree(reg, req) {
    const p = palette(reg, req.palette, { wall: 'oak_leaves', roof: 'oak_leaves', floor: 'dirt', trim: 'oak_log', window: 'glass', accent: 'glowstone' });
    const s = DIMS[req.size];
    const h = [8, 12, 18][s];
    const r = [3, 5, 7][s];
    const size = 2 * r + 3;
    const b = new Builder(size, h + r + 4, size, 1);
    const c = Math.floor(size / 2);
    const thick = s === 2 ? 1 : 0;
    b.box(c, -1, c, c + thick, -1, c + thick, p.floor);
    for (let y = 0; y <= h; y++)
        b.box(c, y, c, c + thick, y, c + thick, p.trim);
    const cy = h;
    for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
            for (let dx = -r; dx <= r; dx++) {
                const d = Math.sqrt(dx * dx + dy * dy * 1.6 + dz * dz);
                const jitter = (hash3(dx, dy, dz, req.seed) & 255) / 255;
                if (d > r - jitter * 1.4)
                    continue;
                if (b.get(c + dx, cy + dy, c + dz) === p.trim)
                    continue;
                b.set(c + dx, cy + dy, c + dz, p.wall);
            }
        }
    }
    // A few branches into the crown.
    for (let i = 0; i < 4; i++) {
        const dx = i === 0 ? 1 : i === 1 ? -1 : 0;
        const dz = i === 2 ? 1 : i === 3 ? -1 : 0;
        for (let k = 1; k <= Math.floor(r / 2); k++)
            b.set(c + dx * k, h - 2 + Math.floor(k / 2), c + dz * k, p.trim);
    }
    return b.model(c, c, reg.idOr('dirt'));
}
function lamppost(reg, req) {
    const p = palette(reg, req.palette, { wall: 'dark_planks', roof: 'dark_planks', floor: 'cobblestone', trim: 'spruce_log', window: 'glass', accent: 'glowstone' });
    const h = [3, 4, 5][DIMS[req.size]];
    const b = new Builder(3, h + 4, 3, 1);
    b.set(1, -1, 1, p.floor);
    for (let y = 0; y < h; y++)
        b.set(1, y, 1, p.trim);
    b.set(1, h, 1, p.accent);
    b.set(1, h + 1, 1, p.roof);
    return b.model(1, 1, reg.idOr('cobblestone'));
}
function wall(reg, req) {
    const p = palette(reg, req.palette, { wall: 'stone_bricks', roof: 'stone_bricks', floor: 'cobblestone', trim: 'mossy_stone_bricks', window: 'glass', accent: 'torch' });
    const L = req.length ?? 24;
    const h = [4, 6, 9][DIMS[req.size]];
    const depth = 6;
    const b = new Builder(L, depth + h + 3, 2, depth);
    b.box(0, 0, 0, L - 1, h + 2, 1, CARVE);
    b.plinth(0, 0, L - 1, 1, depth);
    b.box(0, 0, 0, L - 1, h, 1, p.wall);
    b.box(0, 0, 0, L - 1, 0, 1, p.trim);
    for (let x = 0; x < L; x += 2)
        b.set(x, h + 1, 1, p.wall);
    for (let x = 3; x < L; x += 8)
        b.set(x, h + 1, 0, p.accent);
    return b.model(Math.floor(L / 2), 1, reg.idOr('cobblestone'));
}
function arch(reg, req) {
    const p = palette(reg, req.palette, { wall: 'stone_bricks', roof: 'stone_bricks', floor: 'cobblestone', trim: 'smooth_stone', window: 'glass', accent: 'torch' });
    const s = DIMS[req.size];
    const span = [3, 5, 7][s];
    const h = [5, 7, 9][s];
    const w = span + 4;
    const depth = 5;
    const b = new Builder(w, depth + h + 4, 3, depth);
    b.plinth(0, 0, w - 1, 2, depth);
    b.box(0, 0, 0, 1, h, 2, p.wall);
    b.box(w - 2, 0, 0, w - 1, h, 2, p.wall);
    b.box(0, h + 1, 0, w - 1, h + 2, 2, p.trim);
    b.box(2, h, 0, 2, h, 2, p.wall);
    b.box(w - 3, h, 0, w - 3, h, 2, p.wall);
    b.set(1, h + 3, 1, p.accent);
    b.set(w - 2, h + 3, 1, p.accent);
    return b.model(Math.floor(w / 2), 1, reg.idOr('cobblestone'));
}
const BUILDERS = {
    house, castle, tower, bridge, well, pyramid, tree: giantTree, lamppost, wall, arch,
};
/** Rotate a south-facing model to `facing` (front side toward that direction). */
export function rotateModel(m, facing) {
    if (facing === 'south')
        return m;
    const swap = facing === 'east' || facing === 'west';
    const nsx = swap ? m.sz : m.sx;
    const nsz = swap ? m.sx : m.sz;
    const data = new Uint16Array(m.data.length);
    const map = (x, z) => facing === 'north' ? [m.sx - 1 - x, m.sz - 1 - z] : facing === 'east' ? [z, m.sx - 1 - x] : [m.sz - 1 - z, x];
    for (let y = 0; y < m.sy; y++) {
        for (let z = 0; z < m.sz; z++) {
            for (let x = 0; x < m.sx; x++) {
                const [nx, nz] = map(x, z);
                data[nx + nz * nsx + y * nsx * nsz] = m.data[x + z * m.sx + y * m.sx * m.sz];
            }
        }
    }
    const [ax, az] = map(m.ax, m.az);
    return { ...m, sx: nsx, sz: nsz, ax, az, data };
}
/** Build the voxel model of a structure request (unknown kinds build a well). */
export function buildStructure(reg, req) {
    const builder = BUILDERS[req.structure] ?? well;
    return rotateModel(builder(reg, req), req.facing);
}
