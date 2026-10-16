/**
 * Allocation-light sorting helpers for the geometry pipeline: an LSD radix
 * sort of indices by non-negative float keys (collapse costs) and by 32-bit
 * unsigned keys (Morton codes). Comparator sorts on million-element arrays
 * cost hundreds of milliseconds in JS; these run in a few.
 */
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
/** Bit pattern of a non-negative float32 (monotone in the value; NaN and negatives map to 0). */
export function floatKey(v) {
    if (!(v > 0))
        return 0;
    f32[0] = v;
    return u32[0];
}
/**
 * Sort `order[0..n)` (indices) by `keys[order[i]]` ascending with a stable
 * LSD radix sort (16-bit digits, 8-bit for small inputs; always an even number of passes). `scratch` must hold at least `n` entries.
 * Returns the array holding the sorted result (`order` or `scratch`).
 */
export function radixSortByKey(order, keys, n, scratch) {
    // Small inputs: 8-bit digits (a 1 KB histogram instead of 256 KB).
    const bits = n < 4096 ? 8 : 16;
    const buckets = 1 << bits;
    const mask = buckets - 1;
    const count = bits === 8 ? (_count8 ??= new Uint32Array(256)) : (_count16 ??= new Uint32Array(65536));
    let src = order;
    let dst = scratch;
    for (let shift = 0; shift < 32; shift += bits) {
        count.fill(0);
        for (let i = 0; i < n; i++) {
            const b = (keys[src[i]] >>> shift) & mask;
            count[b] = count[b] + 1;
        }
        let sum = 0;
        for (let b = 0; b < buckets; b++) {
            const c = count[b];
            count[b] = sum;
            sum += c;
        }
        for (let i = 0; i < n; i++) {
            const id = src[i];
            const b = (keys[id] >>> shift) & mask;
            dst[count[b]] = id;
            count[b] = count[b] + 1;
        }
        const t = src;
        src = dst;
        dst = t;
    }
    return src;
}
let _count8 = null;
let _count16 = null;
/** Spread the low 10 bits of `v` so they occupy every third bit. */
function part1By2(v) {
    let x = v & 0x3ff;
    x = (x | (x << 16)) & 0x030000ff;
    x = (x | (x << 8)) & 0x0300f00f;
    x = (x | (x << 4)) & 0x030c30c3;
    x = (x | (x << 2)) & 0x09249249;
    return x;
}
function quantize10(t) {
    return Math.min(1023, Math.max(0, Math.floor(t * 1024)));
}
/** 30-bit Morton code of a point normalised into [0, 1]³ (clamped). */
export function morton3(x, y, z) {
    const q = quantize10;
    return ((part1By2(q(x)) << 2) | (part1By2(q(y)) << 1) | part1By2(q(z))) >>> 0;
}
