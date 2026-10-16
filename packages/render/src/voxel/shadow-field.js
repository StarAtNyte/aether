/**
 * Column heights of the loaded chunks as a repeating texture, for the terrain's cascaded sun shadows
 * and the water depth. R holds the top of the highest opaque block of each column, G the top of the
 * highest foliage block (both in blocks, 0 when none). The texture wraps every {@link SHADOW_FIELD_SIZE}
 * blocks, so a chunk lives at `(cx·16 mod size, cz·16 mod size)` and a new chunk simply overwrites the
 * one that was there. Writing a chunk costs a 16 × 16 copy; the texture is re-uploaded at most once per
 * frame, and only when something changed.
 */
import { DataTexture, NearestFilter, RGFormat, RepeatWrapping, UnsignedByteType } from 'three';
import { SHADOW_FIELD_SIZE } from './terrain-material';
/** Chunk edge in blocks. */
const CHUNK = 16;
/** Columns per chunk. */
const COLUMNS = CHUNK * CHUNK;
/** Heights texture of the loaded chunks. */
export class SunShadowField {
    size;
    texture;
    data;
    dirty = false;
    constructor(size = SHADOW_FIELD_SIZE) {
        this.size = size;
        this.data = new Uint8Array(size * size * 2);
        this.texture = new DataTexture(this.data, size, size, RGFormat, UnsignedByteType);
        this.texture.magFilter = NearestFilter;
        this.texture.minFilter = NearestFilter;
        this.texture.wrapS = RepeatWrapping;
        this.texture.wrapT = RepeatWrapping;
        this.texture.generateMipmaps = false;
        this.texture.flipY = false;
        this.texture.unpackAlignment = 1;
        this.texture.needsUpdate = true;
    }
    origin(cx, cz) {
        const n = this.size / CHUNK;
        const x = (((cx % n) + n) % n) * CHUNK;
        const z = (((cz % n) + n) % n) * CHUNK;
        return z * this.size + x;
    }
    /** Store the 256 solid tops followed by 256 foliage tops of chunk (cx, cz); anything else clears it. */
    setChunk(cx, cz, heights) {
        const base = this.origin(cx, cz);
        const d = this.data;
        const ok = heights !== null && heights !== undefined && heights.length === COLUMNS * 2;
        for (let z = 0; z < CHUNK; z++) {
            let o = (base + z * this.size) * 2;
            for (let x = 0; x < CHUNK; x++) {
                d[o++] = ok ? heights[x + z * CHUNK] : 0;
                d[o++] = ok ? heights[COLUMNS + x + z * CHUNK] : 0;
            }
        }
        this.dirty = true;
    }
    /** The solid top of the column holding world block (x, z) (tests and debugging). */
    solidTop(x, z) {
        const n = this.size;
        return this.data[((((Math.floor(z) % n) + n) % n) * n + (((Math.floor(x) % n) + n) % n)) * 2];
    }
    /** The foliage top of a column. */
    foliageTop(x, z) {
        const n = this.size;
        return this.data[((((Math.floor(z) % n) + n) % n) * n + (((Math.floor(x) % n) + n) % n)) * 2 + 1];
    }
    /** Upload when something changed since the last call; true when it did. */
    flush() {
        if (!this.dirty)
            return false;
        this.dirty = false;
        this.texture.needsUpdate = true;
        return true;
    }
    dispose() {
        this.texture.dispose();
    }
}
