/**
 * Dependency-free QR Code encoder (ISO/IEC 18004 Model 2): byte mode,
 * versions 1–40, error-correction levels L/M/Q/H, Reed–Solomon over
 * GF(2⁸) with the 0x11D polynomial, block interleaving, all eight masks
 * scored with the standard penalty rules. Follows the structure of Project
 * Nayuki's reference implementation (MIT), rewritten in strict TypeScript.
 *
 * Output is a square boolean matrix (true = dark) and an SVG path for it;
 * the path contains only numbers, never user text.
 */
const ECC_INDEX = { L: 0, M: 1, Q: 2, H: 3 };
/** Format-information bits of each level. */
const ECC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };
/** Error-correction codewords per block, by level then version (index 0 unused). */
export const ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
/** Error-correction blocks, by level then version (index 0 unused). */
export const NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];
/** Modules usable for data + ECC in a version (function patterns excluded). */
export function rawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
        const numAlign = Math.floor(ver / 7) + 2;
        result -= (25 * numAlign - 10) * numAlign - 55;
        if (ver >= 7)
            result -= 36;
    }
    return result;
}
/** Data codewords (bytes) of a version at a level. */
export function dataCodewords(ver, ecc) {
    const e = ECC_INDEX[ecc];
    return Math.floor(rawDataModules(ver) / 8) - (ECC_CODEWORDS_PER_BLOCK[e]?.[ver] ?? 0) * (NUM_ERROR_CORRECTION_BLOCKS[e]?.[ver] ?? 0);
}
/** Bits of the byte-mode character count field. */
function countBits(ver) {
    return ver <= 9 ? 8 : 16;
}
/** Most bytes a version/level can hold in byte mode. */
export function byteCapacity(ver, ecc) {
    return Math.floor((dataCodewords(ver, ecc) * 8 - 4 - countBits(ver)) / 8);
}
/** Largest byte payload any QR code can carry at `ecc` (version 40). */
export function maxBytes(ecc) {
    return byteCapacity(40, ecc);
}
// ---------------------------------------------------------------------------
// Reed–Solomon over GF(2^8), polynomial 0x11D
// ---------------------------------------------------------------------------
/** Product of two field elements. */
export function gfMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
}
/** Generator polynomial coefficients of `degree` (highest term implied). */
export function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < result.length; j++) {
            result[j] = gfMultiply(result[j], root);
            if (j + 1 < result.length)
                result[j] = result[j] ^ result[j + 1];
        }
        root = gfMultiply(root, 0x02);
    }
    return result;
}
/** Reed–Solomon remainder (ECC codewords) of `data`. */
export function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) {
        const factor = b ^ result.shift();
        result.push(0);
        for (let i = 0; i < divisor.length; i++)
            result[i] = result[i] ^ gfMultiply(divisor[i], factor);
    }
    return result;
}
// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------
function appendBits(bits, value, len) {
    for (let i = len - 1; i >= 0; i--)
        bits.push((value >>> i) & 1);
}
/** Data codewords (with mode, count, terminator and padding) for `bytes` at `ver`. */
function dataCodewordsFor(bytes, ver, ecc) {
    const capacityBits = dataCodewords(ver, ecc) * 8;
    const bits = [];
    appendBits(bits, 0x4, 4);
    appendBits(bits, bytes.length, countBits(ver));
    for (const b of bytes)
        appendBits(bits, b, 8);
    appendBits(bits, 0, Math.min(4, capacityBits - bits.length));
    appendBits(bits, 0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11)
        appendBits(bits, pad, 8);
    const out = new Array(bits.length / 8).fill(0);
    bits.forEach((b, i) => {
        out[i >>> 3] = out[i >>> 3] | (b << (7 - (i & 7)));
    });
    return out;
}
/** Split into blocks, add ECC, interleave (the final codeword sequence). */
export function addEccAndInterleave(data, ver, ecc) {
    const e = ECC_INDEX[ecc];
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[e]?.[ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[e]?.[ver];
    const rawCodewords = Math.floor(rawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);
    const blocks = [];
    const divisor = rsDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
        const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
        k += dat.length;
        const eccBytes = rsRemainder(dat, divisor);
        if (i < numShortBlocks)
            dat.push(0);
        blocks.push(dat.concat(eccBytes));
    }
    const result = [];
    const len = blocks[0]?.length ?? 0;
    for (let i = 0; i < len; i++) {
        blocks.forEach((block, j) => {
            if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks)
                result.push(block[i]);
        });
    }
    return result;
}
/** Alignment pattern centre coordinates of a version. */
export function alignmentPositions(ver) {
    if (ver === 1)
        return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
    const size = ver * 4 + 17;
    const result = [6];
    for (let pos = size - 7; result.length < numAlign; pos -= step)
        result.splice(1, 0, pos);
    return result;
}
/** BCH-protected format bits for a level and mask. */
export function formatBits(ecc, mask) {
    const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++)
        rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
}
/** BCH-protected version bits (versions 7+). */
export function versionBits(ver) {
    let rem = ver;
    for (let i = 0; i < 12; i++)
        rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return (ver << 12) | rem;
}
/** True when mask `m` flips the module at (x, y). */
export function maskBit(m, x, y) {
    switch (m) {
        case 0:
            return (x + y) % 2 === 0;
        case 1:
            return y % 2 === 0;
        case 2:
            return x % 3 === 0;
        case 3:
            return (x + y) % 3 === 0;
        case 4:
            return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
        case 5:
            return ((x * y) % 2) + ((x * y) % 3) === 0;
        case 6:
            return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
        default:
            return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
}
class Grid {
    size;
    modules;
    fn;
    constructor(size) {
        this.size = size;
        this.modules = Array.from({ length: size }, () => new Array(size).fill(false));
        this.fn = Array.from({ length: size }, () => new Array(size).fill(false));
    }
    set(x, y, dark) {
        this.modules[y][x] = dark;
        this.fn[y][x] = true;
    }
}
function drawFunctionPatterns(g, ver) {
    const size = g.size;
    for (let i = 0; i < size; i++) {
        g.set(6, i, i % 2 === 0);
        g.set(i, 6, i % 2 === 0);
    }
    const finder = (cx, cy) => {
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                const dist = Math.max(Math.abs(dx), Math.abs(dy));
                const x = cx + dx;
                const y = cy + dy;
                if (x >= 0 && x < size && y >= 0 && y < size)
                    g.set(x, y, dist !== 2 && dist !== 4);
            }
        }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);
    const align = alignmentPositions(ver);
    const n = align.length;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0))
                continue;
            const cx = align[i];
            const cy = align[j];
            for (let dy = -2; dy <= 2; dy++)
                for (let dx = -2; dx <= 2; dx++)
                    g.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
    }
    drawFormat(g, 'L', 0); // reserve (overwritten later)
    if (ver >= 7) {
        const bits = versionBits(ver);
        for (let i = 0; i < 18; i++) {
            const bit = ((bits >>> i) & 1) !== 0;
            const a = size - 11 + (i % 3);
            const b = Math.floor(i / 3);
            g.set(a, b, bit);
            g.set(b, a, bit);
        }
    }
}
function drawFormat(g, ecc, mask) {
    const bits = formatBits(ecc, mask);
    const bit = (i) => ((bits >>> i) & 1) !== 0;
    const size = g.size;
    for (let i = 0; i <= 5; i++)
        g.set(8, i, bit(i));
    g.set(8, 7, bit(6));
    g.set(8, 8, bit(7));
    g.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++)
        g.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++)
        g.set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++)
        g.set(8, size - 15 + i, bit(i));
    g.set(8, size - 8, true);
}
function drawCodewords(g, data) {
    const size = g.size;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6)
            right = 5;
        for (let vert = 0; vert < size; vert++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                const upward = ((right + 1) & 2) === 0;
                const y = upward ? size - 1 - vert : vert;
                if (!g.fn[y][x] && i < data.length * 8) {
                    g.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
                    i++;
                }
            }
        }
    }
}
function applyMask(g, mask) {
    for (let y = 0; y < g.size; y++) {
        const row = g.modules[y];
        const fn = g.fn[y];
        for (let x = 0; x < g.size; x++)
            if (!fn[x] && maskBit(mask, x, y))
                row[x] = !row[x];
    }
}
/** Penalty score of a finished matrix (lower is easier to scan). */
export function penalty(modules) {
    const size = modules.length;
    let score = 0;
    const at = (x, y) => modules[y][x];
    // N1: runs of five or more same-coloured modules in a row or column.
    for (let pass = 0; pass < 2; pass++) {
        for (let a = 0; a < size; a++) {
            let run = 1;
            for (let b = 1; b < size; b++) {
                const cur = pass === 0 ? at(b, a) : at(a, b);
                const prev = pass === 0 ? at(b - 1, a) : at(a, b - 1);
                if (cur === prev) {
                    run++;
                    if (run === 5)
                        score += 3;
                    else if (run > 5)
                        score += 1;
                }
                else
                    run = 1;
            }
        }
    }
    // N2: 2×2 blocks of one colour.
    for (let y = 0; y < size - 1; y++) {
        for (let x = 0; x < size - 1; x++) {
            const c = at(x, y);
            if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1))
                score += 3;
        }
    }
    // N3: finder-like 1:1:3:1:1 patterns with four light modules on one side.
    const pattern = [true, false, true, true, true, false, true];
    for (let pass = 0; pass < 2; pass++) {
        for (let a = 0; a < size; a++) {
            for (let b = 0; b + 7 <= size; b++) {
                let match = true;
                for (let k = 0; k < 7 && match; k++)
                    match = (pass === 0 ? at(b + k, a) : at(a, b + k)) === pattern[k];
                if (!match)
                    continue;
                const light = (from, to) => {
                    for (let k = from; k < to; k++) {
                        if (k < 0 || k >= size)
                            continue;
                        if (pass === 0 ? at(k, a) : at(a, k))
                            return false;
                    }
                    return true;
                };
                if (light(b - 4, b) || light(b + 7, b + 11))
                    score += 40;
            }
        }
    }
    // N4: balance of dark and light modules.
    let dark = 0;
    for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++)
            if (at(x, y))
                dark++;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    score += Math.max(0, k) * 10;
    return score;
}
/**
 * Encode text (UTF-8, byte mode) as a QR code, choosing the smallest
 * version that fits. Returns null when the text is too long for any QR code.
 */
export function encodeQr(text, opts = {}) {
    const bytes = new TextEncoder().encode(text);
    return encodeQrBytes(bytes, opts);
}
/** {@link encodeQr} for raw bytes. */
export function encodeQrBytes(bytes, opts = {}) {
    let ecc = opts.ecc ?? 'M';
    const minV = Math.max(1, Math.min(40, opts.minVersion ?? 1));
    const maxV = Math.max(minV, Math.min(40, opts.maxVersion ?? 40));
    let ver = minV;
    for (; ver <= maxV; ver++)
        if (bytes.length <= byteCapacity(ver, ecc))
            break;
    if (ver > maxV)
        return null;
    if (opts.boostEcc !== false) {
        for (const better of ['M', 'Q', 'H'])
            if (ECC_INDEX[better] > ECC_INDEX[ecc] && bytes.length <= byteCapacity(ver, better))
                ecc = better;
    }
    const codewords = addEccAndInterleave(dataCodewordsFor(bytes, ver, ecc), ver, ecc);
    const size = ver * 4 + 17;
    let best = null;
    let bestMask = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let mask = 0; mask < 8; mask++) {
        const g = new Grid(size);
        drawFunctionPatterns(g, ver);
        drawCodewords(g, codewords);
        applyMask(g, mask);
        drawFormat(g, ecc, mask);
        const s = penalty(g.modules);
        if (s < bestScore) {
            best = g;
            bestMask = mask;
            bestScore = s;
        }
    }
    if (!best)
        return null;
    return { version: ver, ecc, mask: bestMask, size, modules: best.modules };
}
/**
 * SVG path data (`d`) drawing the dark modules of `qr`, offset by a quiet
 * zone of `border` modules. Runs of dark modules per row become one rectangle.
 */
export function qrPath(qr, border = 4) {
    const parts = [];
    for (let y = 0; y < qr.size; y++) {
        const row = qr.modules[y];
        let x = 0;
        while (x < qr.size) {
            if (!row[x]) {
                x++;
                continue;
            }
            let run = 1;
            while (x + run < qr.size && row[x + run])
                run++;
            parts.push(`M${x + border} ${y + border}h${run}v1h-${run}z`);
            x += run;
        }
    }
    return parts.join('');
}
/** A complete standalone SVG document of the code (black on white). */
export function qrSvg(qr, border = 4) {
    const n = qr.size + border * 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${qrPath(qr, border)}" fill="#000"/></svg>`;
}
