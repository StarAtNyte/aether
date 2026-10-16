/**
 * Voxel ray casting by grid traversal (Amanatides & Woo DDA): the ray
 * visits every cell it passes through, in order, so a hit is exact and the
 * cost is proportional to the distance travelled (≤ 3 × range cells), with
 * no allocation.
 */
/** A fresh, reusable hit record. */
export function createHit() {
    return { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, distance: 0, block: 0 };
}
/**
 * Cast a ray from `origin` along `dir` (need not be normalised) for at most
 * `maxDistance`. `get(x, y, z)` returns the block of a cell and `hits(id)`
 * decides whether that block stops the ray. The starting cell itself counts
 * (with a zero normal) when it is a target. Returns true and fills `out` on
 * a hit.
 */
export function raycastVoxels(get, ox, oy, oz, dx, dy, dz, maxDistance, hits, out) {
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > 1e-12) || !Number.isFinite(ox + oy + oz) || !(maxDistance > 0))
        return false;
    dx /= len;
    dy /= len;
    dz /= len;
    let x = Math.floor(ox);
    let y = Math.floor(oy);
    let z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = stepX > 0 ? (x + 1 - ox) * tDeltaX : stepX < 0 ? (ox - x) * tDeltaX : Infinity;
    let tMaxY = stepY > 0 ? (y + 1 - oy) * tDeltaY : stepY < 0 ? (oy - y) * tDeltaY : Infinity;
    let tMaxZ = stepZ > 0 ? (z + 1 - oz) * tDeltaZ : stepZ < 0 ? (oz - z) * tDeltaZ : Infinity;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let t = 0;
    // Bound the walk: never more cells than the range can cross.
    const maxSteps = Math.ceil(maxDistance) * 3 + 3;
    for (let i = 0; i <= maxSteps; i++) {
        const id = get(x, y, z);
        if (hits(id)) {
            out.x = x;
            out.y = y;
            out.z = z;
            out.nx = nx;
            out.ny = ny;
            out.nz = nz;
            out.distance = t;
            out.block = id;
            return true;
        }
        if (tMaxX < tMaxY && tMaxX < tMaxZ) {
            t = tMaxX;
            if (t > maxDistance)
                return false;
            x += stepX;
            tMaxX += tDeltaX;
            nx = -stepX;
            ny = 0;
            nz = 0;
        }
        else if (tMaxY < tMaxZ) {
            t = tMaxY;
            if (t > maxDistance)
                return false;
            y += stepY;
            tMaxY += tDeltaY;
            nx = 0;
            ny = -stepY;
            nz = 0;
        }
        else {
            t = tMaxZ;
            if (t > maxDistance)
                return false;
            z += stepZ;
            tMaxZ += tDeltaZ;
            nx = 0;
            ny = 0;
            nz = -stepZ;
        }
    }
    return false;
}
