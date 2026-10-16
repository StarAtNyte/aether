import { rapier } from './rapier';
/** Brick edge (blocks); divides the 16-block chunk. */
export const BRICK = 8;
/** Most bricks kept at once. */
export const MAX_TERRAIN_BRICKS = 256;
/** Most boxes per brick (a pathological checkerboard is clipped). */
export const MAX_BRICK_BOXES = 256;
/** Bricks around a body: its cell's brick ± this many on each axis. */
const REACH = 1;
/** Seconds a brick survives without a body nearby. */
const BRICK_TTL = 2;
/**
 * Greedy box cover of the solid cells of a brick at (bx, by, bz) (cell
 * coordinates of its minimum corner). Cells fully enclosed by solid
 * neighbours are still covered (they keep boxes large); the result never
 * covers a non-solid cell.
 */
export function brickBoxes(src, bx, by, bz, size = BRICK, max = MAX_BRICK_BOXES) {
    const n = size;
    const solid = new Uint8Array(n * n * n);
    let any = false;
    for (let y = 0; y < n; y++) {
        for (let z = 0; z < n; z++) {
            for (let x = 0; x < n; x++) {
                if (src.isSolid(bx + x, by + y, bz + z)) {
                    solid[x + z * n + y * n * n] = 1;
                    any = true;
                }
            }
        }
    }
    const out = [];
    if (!any)
        return out;
    const at = (x, y, z) => x + z * n + y * n * n;
    for (let y = 0; y < n; y++) {
        for (let z = 0; z < n; z++) {
            for (let x = 0; x < n; x++) {
                if (solid[at(x, y, z)] !== 1)
                    continue;
                // Grow along x.
                let x1 = x + 1;
                while (x1 < n && solid[at(x1, y, z)] === 1)
                    x1++;
                // Grow along z while every cell of the row is solid.
                let z1 = z + 1;
                grow: while (z1 < n) {
                    for (let k = x; k < x1; k++)
                        if (solid[at(k, y, z1)] !== 1)
                            break grow;
                    z1++;
                }
                // Grow along y while every cell of the slab is solid.
                let y1 = y + 1;
                growY: while (y1 < n) {
                    for (let c = z; c < z1; c++)
                        for (let k = x; k < x1; k++)
                            if (solid[at(k, y1, c)] !== 1)
                                break growY;
                    y1++;
                }
                for (let yy = y; yy < y1; yy++)
                    for (let c = z; c < z1; c++)
                        for (let k = x; k < x1; k++)
                            solid[at(k, yy, c)] = 2;
                out.push({ x0: bx + x, y0: by + y, z0: bz + z, x1: bx + x1, y1: by + y1, z1: bz + z1 });
                if (out.length >= max)
                    return out;
            }
        }
    }
    return out;
}
function brickKey(bx, by, bz) {
    return ((bx + 0x8000) * 0x10000 + (bz + 0x8000)) * 32 + by;
}
/** Terrain colliders around moving bodies (see the module docs). */
export class VoxelTerrainColliders {
    world;
    source;
    bricks = new Map();
    time = 0;
    constructor(world, source) {
        this.world = world;
        this.source = source;
    }
    /** Live bricks and colliders (stats, tests). */
    get counts() {
        let c = 0;
        for (const b of this.bricks.values())
            c += b.colliders.length;
        return { bricks: this.bricks.size, colliders: c };
    }
    /**
     * Make sure bricks around each point exist and are current; age out the
     * others. `points` is a flat [x, y, z, …] list (dynamic body positions).
     */
    update(points, dt) {
        this.time += dt;
        const h = this.source.height;
        for (let i = 0; i + 2 < points.length; i += 3) {
            const px = points[i];
            const py = points[i + 1];
            const pz = points[i + 2];
            if (!Number.isFinite(px + py + pz))
                continue;
            const cbx = Math.floor(px / BRICK);
            const cby = Math.floor(py / BRICK);
            const cbz = Math.floor(pz / BRICK);
            for (let by = cby - REACH; by <= cby + REACH; by++) {
                if (by < 0 || by * BRICK >= h)
                    continue;
                for (let bz = cbz - REACH; bz <= cbz + REACH; bz++)
                    for (let bx = cbx - REACH; bx <= cbx + REACH; bx++)
                        this.ensure(bx, by, bz);
            }
        }
        for (const [key, b] of this.bricks) {
            if (this.time - b.seen > BRICK_TTL) {
                this.drop(b);
                this.bricks.delete(key);
            }
        }
    }
    ensure(bx, by, bz) {
        const key = brickKey(bx, by, bz);
        const version = this.source.chunkVersion(Math.floor((bx * BRICK) / 16), Math.floor((bz * BRICK) / 16));
        const b = this.bricks.get(key);
        if (b) {
            b.seen = this.time;
            if (b.version === version)
                return;
            this.drop(b);
            b.colliders = this.build(bx, by, bz, version);
            b.version = version;
            return;
        }
        if (this.bricks.size >= MAX_TERRAIN_BRICKS)
            return;
        this.bricks.set(key, { colliders: this.build(bx, by, bz, version), version, seen: this.time });
    }
    build(bx, by, bz, version) {
        // Unloaded chunks get no colliders (bodies there are frozen by the host).
        if (version < 0)
            return [];
        const R = rapier();
        const out = [];
        for (const box of brickBoxes(this.source, bx * BRICK, by * BRICK, bz * BRICK)) {
            const hx = (box.x1 - box.x0) / 2;
            const hy = (box.y1 - box.y0) / 2;
            const hz = (box.z1 - box.z0) / 2;
            const desc = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(box.x0 + hx, box.y0 + hy, box.z0 + hz).setFriction(0.8);
            out.push(this.world.createCollider(desc));
        }
        return out;
    }
    drop(b) {
        for (const c of b.colliders)
            this.world.removeCollider(c, false);
        b.colliders = [];
    }
    /** Remove every terrain collider. */
    dispose() {
        for (const b of this.bricks.values())
            this.drop(b);
        this.bricks.clear();
    }
}
