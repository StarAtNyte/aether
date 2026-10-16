/**
 * Palette-compressed chunk storage.
 *
 * A chunk keeps a palette of the block ids it contains and one bit-packed
 * index per cell (0, 1, 2, 4, 8 or 16 bits — powers of two, so an index
 * never straddles two 32-bit words). A typical generated chunk holds ~10
 * block types and packs into 4 bits per cell: 16 KiB instead of 64 KiB of
 * raw uint16. The palette grows (and the indices are re-packed) on demand;
 * reads are a shift and a mask.
 */
import { CHUNK_VOLUME, HEIGHT, LAYER } from './constants';
function bitsFor(n) {
    if (n <= 1)
        return 0;
    if (n <= 2)
        return 1;
    if (n <= 4)
        return 2;
    if (n <= 16)
        return 4;
    if (n <= 256)
        return 8;
    return 16;
}
function wordsFor(bits) {
    return (CHUNK_VOLUME * bits) >>> 5;
}
const VALID_BITS = new Set([0, 1, 2, 4, 8, 16]);
/** Scratch lookup id → palette slot used while packing (ids are < 65536). */
let lookup = new Int32Array(1024).fill(-1);
/** One chunk's blocks. */
export class ChunkData {
    palette;
    size;
    bitsPerCell;
    words;
    constructor(palette, size, bits, words) {
        this.palette = palette;
        this.size = size;
        this.bitsPerCell = bits;
        this.words = words;
    }
    /** A chunk filled with one block (default air). */
    static filled(block = 0) {
        const p = new Uint16Array(4);
        p[0] = block;
        return new ChunkData(p, 1, 0, new Uint32Array(0));
    }
    /** Pack a dense array of `CHUNK_VOLUME` block ids. */
    static fromDense(dense) {
        if (dense.length !== CHUNK_VOLUME)
            throw new Error(`dense chunk must have ${CHUNK_VOLUME} cells`);
        let palette = new Uint16Array(16);
        let size = 0;
        for (let i = 0; i < CHUNK_VOLUME; i++) {
            const id = dense[i];
            if (id >= lookup.length) {
                const grown = new Int32Array(Math.max(id + 1, lookup.length * 2)).fill(-1);
                grown.set(lookup);
                lookup = grown;
            }
            if (lookup[id] === -1) {
                if (size === palette.length) {
                    const p = new Uint16Array(palette.length * 2);
                    p.set(palette);
                    palette = p;
                }
                lookup[id] = size;
                palette[size++] = id;
            }
        }
        const bits = bitsFor(size);
        const words = new Uint32Array(wordsFor(bits));
        if (bits > 0) {
            const perWord = 32 / bits;
            for (let w = 0, i = 0; w < words.length; w++) {
                let word = 0;
                for (let k = 0; k < perWord; k++, i++)
                    word |= lookup[dense[i]] << (k * bits);
                words[w] = word >>> 0;
            }
        }
        for (let k = 0; k < size; k++)
            lookup[palette[k]] = -1;
        return new ChunkData(palette, size, bits, words);
    }
    /**
     * Rebuild from a packed form (e.g. a worker reply). Validates shape and
     * that every index points into the palette; returns null when malformed.
     */
    static fromPacked(p, maxId) {
        if (!(p.palette instanceof Uint16Array) || !(p.words instanceof Uint32Array) || !VALID_BITS.has(p.bits))
            return null;
        const size = p.palette.length;
        if (size < 1 || size > 65536 || bitsFor(size) > p.bits || p.words.length !== wordsFor(p.bits))
            return null;
        for (let k = 0; k < size; k++)
            if (p.palette[k] > maxId)
                return null;
        if (p.bits > 0 && size < 1 << p.bits) {
            // Indices beyond the palette would read garbage: check them once.
            const mask = (1 << p.bits) - 1;
            const perWord = 32 / p.bits;
            for (let w = 0; w < p.words.length; w++) {
                const word = p.words[w];
                for (let k = 0; k < perWord; k++)
                    if (((word >>> (k * p.bits)) & mask) >= size)
                        return null;
            }
        }
        const palette = new Uint16Array(Math.max(4, size));
        palette.set(p.palette);
        return new ChunkData(palette, size, p.bits, p.words);
    }
    /** Block id at cell index `i` (see `cellIndex`). */
    get(i) {
        const bits = this.bitsPerCell;
        if (bits === 0)
            return this.palette[0];
        const bit = i * bits;
        return this.palette[(this.words[bit >>> 5] >>> (bit & 31)) & ((1 << bits) - 1)];
    }
    /** Set the block at cell index `i`. Returns the previous id. */
    set(i, id) {
        const prev = this.get(i);
        if (prev === id)
            return prev;
        let slot = -1;
        for (let k = 0; k < this.size; k++) {
            if (this.palette[k] === id) {
                slot = k;
                break;
            }
        }
        if (slot < 0) {
            slot = this.size;
            if (slot === this.palette.length) {
                const p = new Uint16Array(this.palette.length * 2);
                p.set(this.palette);
                this.palette = p;
            }
            this.palette[this.size++] = id;
            const need = bitsFor(this.size);
            if (need > this.bitsPerCell)
                this.repack(need);
        }
        const bits = this.bitsPerCell;
        const bit = i * bits;
        const w = bit >>> 5;
        const shift = bit & 31;
        const mask = ((1 << bits) - 1) << shift;
        this.words[w] = ((this.words[w] & ~mask) | (slot << shift)) >>> 0;
        return prev;
    }
    repack(bits) {
        const old = this.bitsPerCell;
        const oldWords = this.words;
        const words = new Uint32Array(wordsFor(bits));
        if (old > 0) {
            const oldMask = (1 << old) - 1;
            for (let i = 0; i < CHUNK_VOLUME; i++) {
                const ob = i * old;
                const idx = (oldWords[ob >>> 5] >>> (ob & 31)) & oldMask;
                if (idx === 0)
                    continue;
                const nb = i * bits;
                words[nb >>> 5] = (words[nb >>> 5] | (idx << (nb & 31))) >>> 0;
            }
        }
        this.bitsPerCell = bits;
        this.words = words;
    }
    /** Expand into `out` (length `CHUNK_VOLUME`). */
    toDense(out) {
        const bits = this.bitsPerCell;
        if (bits === 0) {
            out.fill(this.palette[0], 0, CHUNK_VOLUME);
            return out;
        }
        const mask = (1 << bits) - 1;
        const perWord = 32 / bits;
        const pal = this.palette;
        for (let w = 0, i = 0; w < this.words.length; w++) {
            const word = this.words[w];
            for (let k = 0; k < perWord; k++, i++)
                out[i] = pal[(word >>> (k * bits)) & mask];
        }
        return out;
    }
    /** True when any block of the palette has a non-zero entry in `flags` (indexed by block id). */
    hasAny(flags) {
        for (let k = 0; k < this.size; k++)
            if ((flags[this.palette[k]] ?? 0) !== 0)
                return true;
        return false;
    }
    /** Expand only the first `rows` layers (y < rows) into `out`. */
    toDenseRows(out, rows) {
        const end = Math.max(0, Math.min(HEIGHT, rows)) * LAYER;
        const bits = this.bitsPerCell;
        if (bits === 0) {
            out.fill(this.palette[0], 0, end);
            return out;
        }
        const mask = (1 << bits) - 1;
        const perWord = 32 / bits;
        const pal = this.palette;
        const lastWord = (end * bits) >>> 5;
        for (let w = 0, i = 0; w < lastWord; w++) {
            const word = this.words[w];
            for (let k = 0; k < perWord; k++, i++)
                out[i] = pal[(word >>> (k * bits)) & mask];
        }
        return out;
    }
    /**
     * The packed form *without* copying the indices: `words` is this chunk's
     * live array (only the small palette is copied). For a synchronous read or
     * a `postMessage` without transfer (structured clone copies it in native
     * code, so no JavaScript buffer is allocated); never transfer or mutate it.
     */
    view() {
        return { palette: this.palette.slice(0, this.size), bits: this.bitsPerCell, words: this.words };
    }
    /** Copy into a transferable packed form (palette trimmed). */
    pack() {
        return { palette: this.palette.slice(0, this.size), bits: this.bitsPerCell, words: this.words.slice() };
    }
    /** Bits per cell. */
    get bits() {
        return this.bitsPerCell;
    }
    /** Distinct block ids. */
    get paletteSize() {
        return this.size;
    }
    /** Bytes held (palette + indices). */
    get byteLength() {
        return this.palette.byteLength + this.words.byteLength;
    }
    /** True when the palette contains `id`. */
    has(id) {
        for (let k = 0; k < this.size; k++)
            if (this.palette[k] === id)
                return true;
        return false;
    }
    /** Highest y holding a non-air block (−1 for an empty chunk). */
    topY() {
        if (this.bitsPerCell === 0)
            return this.palette[0] === 0 ? -1 : HEIGHT - 1;
        for (let y = HEIGHT - 1; y >= 0; y--) {
            const base = y * LAYER;
            for (let i = 0; i < LAYER; i++)
                if (this.get(base + i) !== 0)
                    return y;
        }
        return -1;
    }
}
