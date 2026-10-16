/**
 * The QR encoder is checked against the standard's byte-mode capacity table
 * and by an independent reader written here from the specification: format
 * information (BCH), function-pattern layout, unmasking, the zig-zag module
 * order, block de-interleaving, Reed–Solomon syndromes (computed with their
 * own log/antilog tables) and the byte-mode segment.
 */
import { describe, expect, it } from 'vitest';
import { byteCapacity, encodeQr, maxBytes, qrPath, qrSvg } from '../src/publish/qr';
// ---------------------------------------------------------------------------
// Independent reader
// ---------------------------------------------------------------------------
const EXP = new Array(512);
const LOG = new Array(256);
{
    let x = 1;
    for (let i = 0; i < 255; i++) {
        EXP[i] = x;
        LOG[x] = i;
        x <<= 1;
        if (x & 0x100)
            x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++)
        EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
/** Syndromes of a codeword block (all zero when the block is a valid RS codeword). */
function syndromes(block, eccLen) {
    const out = [];
    for (let i = 0; i < eccLen; i++) {
        let s = 0;
        for (const c of block)
            s = mul(s, EXP[i]) ^ c;
        out.push(s);
    }
    return out;
}
// Block structure from the standard's tables (independent copy for versions used below).
// [ecc codewords per block, blocks] for versions 1..12 at L/M/Q/H.
const TABLE = {
    L: [[7, 1], [10, 1], [15, 1], [20, 1], [26, 1], [18, 2], [20, 2], [24, 2], [30, 2], [18, 4], [20, 4], [24, 4]],
    M: [[10, 1], [16, 1], [26, 1], [18, 2], [24, 2], [16, 4], [18, 4], [22, 4], [22, 5], [26, 5], [30, 5], [22, 8]],
    Q: [[13, 1], [22, 1], [18, 2], [26, 2], [18, 4], [24, 4], [18, 6], [22, 6], [20, 8], [24, 8], [28, 8], [26, 10]],
    H: [[17, 1], [28, 1], [22, 2], [16, 4], [22, 4], [28, 4], [26, 5], [26, 6], [24, 8], [28, 8], [24, 11], [28, 11]],
};
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58]];
function functionMap(ver) {
    const size = ver * 4 + 17;
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const mark = (x, y) => {
        if (x >= 0 && y >= 0 && x < size && y < size)
            fn[y][x] = true;
    };
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
        for (let dy = -4; dy <= 4; dy++)
            for (let dx = -4; dx <= 4; dx++)
                mark(cx + dx, cy + dy);
    for (let i = 0; i < size; i++) {
        mark(6, i);
        mark(i, 6);
    }
    const al = ALIGN[ver - 1];
    for (const ax of al)
        for (const ay of al) {
            if ((ax === 6 && ay === 6) || (ax === 6 && ay === al[al.length - 1]) || (ax === al[al.length - 1] && ay === 6))
                continue;
            for (let dy = -2; dy <= 2; dy++)
                for (let dx = -2; dx <= 2; dx++)
                    mark(ax + dx, ay + dy);
        }
    for (let i = 0; i < 9; i++) {
        mark(8, i);
        mark(i, 8);
    }
    for (let i = 0; i < 8; i++) {
        mark(size - 1 - i, 8);
        mark(8, size - 1 - i);
    }
    if (ver >= 7)
        for (let i = 0; i < 18; i++) {
            mark(size - 11 + (i % 3), Math.floor(i / 3));
            mark(Math.floor(i / 3), size - 11 + (i % 3));
        }
    return fn;
}
const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (_x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];
function bch15(data5) {
    let r = data5 << 10;
    for (let i = 14; i >= 10; i--)
        if (r & (1 << i))
            r ^= 0x537 << (i - 10);
    return ((data5 << 10) | r) ^ 0x5412;
}
function read(qr) {
    const size = qr.size;
    const ver = (size - 17) / 4;
    const m = (x, y) => qr.modules[y][x];
    // Format bits, copy 1: (8,0..5),(8,7),(8,8),(7,8),(5..0,8).
    const pos = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
    let raw = 0;
    pos.forEach(([x, y], i) => {
        if (m(x, y))
            raw |= 1 << i;
    });
    let format = -1;
    for (let d = 0; d < 32; d++)
        if (bch15(d) === raw)
            format = d;
    if (format < 0)
        throw new Error('format bits invalid');
    const ecc = ['M', 'L', 'H', 'Q'][format >> 3];
    const mask = format & 7;
    const fn = functionMap(ver);
    const bits = [];
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6)
            right = 5;
        for (let vert = 0; vert < size; vert++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
                if (fn[y][x])
                    continue;
                bits.push((m(x, y) !== MASKS[mask](x, y)) ? 1 : 0);
            }
        }
    }
    const codewords = [];
    for (let i = 0; i + 8 <= bits.length; i += 8)
        codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    const [eccLen, blocks] = TABLE[ecc][ver - 1];
    const total = codewords.length;
    const shortLen = Math.floor(total / blocks);
    const numShort = blocks - (total % blocks);
    const dataLens = Array.from({ length: blocks }, (_, i) => shortLen - eccLen + (i < numShort ? 0 : 1));
    const data = dataLens.map(() => []);
    const eccs = dataLens.map(() => []);
    let k = 0;
    const maxData = Math.max(...dataLens);
    for (let i = 0; i < maxData; i++)
        for (let b = 0; b < blocks; b++)
            if (i < dataLens[b])
                data[b].push(codewords[k++]);
    for (let i = 0; i < eccLen; i++)
        for (let b = 0; b < blocks; b++)
            eccs[b].push(codewords[k++]);
    const syndromesZero = data.every((d, b) => syndromes([...d, ...eccs[b]], eccLen).every((s) => s === 0));
    const stream = data.flat();
    const sbits = [];
    for (const c of stream)
        for (let i = 7; i >= 0; i--)
            sbits.push((c >> i) & 1);
    const take = (n, at) => {
        let v = 0;
        for (let i = 0; i < n; i++)
            v = (v << 1) | sbits[at.i++];
        return v;
    };
    const at = { i: 0 };
    if (take(4, at) !== 4)
        throw new Error('not byte mode');
    const len = take(ver <= 9 ? 8 : 16, at);
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++)
        out[i] = take(8, at);
    return { ecc, mask, text: new TextDecoder().decode(out), syndromesZero };
}
// ---------------------------------------------------------------------------
describe('QR encoder', () => {
    it('matches the byte-mode capacity table of the standard', () => {
        const table = [
            [1, [17, 14, 11, 7]],
            [2, [32, 26, 20, 14]],
            [5, [106, 84, 60, 44]],
            [7, [154, 122, 86, 64]],
            [10, [271, 213, 151, 119]],
            [20, [858, 666, 482, 382]],
            [27, [1465, 1125, 805, 625]],
            [40, [2953, 2331, 1663, 1273]],
        ];
        for (const [ver, caps] of table) {
            ['L', 'M', 'Q', 'H'].forEach((ecc, i) => expect(byteCapacity(ver, ecc), `${ver}-${ecc}`).toBe(caps[i]));
        }
        expect(maxBytes('L')).toBe(2953);
    });
    it('round-trips through an independent reader for many versions, levels and masks', () => {
        const masks = new Set();
        const samples = ['A', 'https://example.org/play#w=Dabc', 'Ünïcødé ✓ ' + 'x'.repeat(30), 'y'.repeat(150), 'z'.repeat(250)];
        for (const text of samples) {
            for (const ecc of ['L', 'M', 'Q', 'H']) {
                const qr = encodeQr(text, { ecc, boostEcc: false });
                expect(qr).not.toBeNull();
                if (!qr || qr.version > 12)
                    continue;
                const r = read(qr);
                expect(r.text).toBe(text);
                expect(r.ecc).toBe(ecc);
                expect(r.mask).toBe(qr.mask);
                expect(r.syndromesZero).toBe(true);
                masks.add(qr.mask);
            }
        }
        // Different payloads pick different masks (the penalty rule is doing work).
        expect(masks.size).toBeGreaterThan(1);
    });
    it('chooses the smallest version and boosts the level when free', () => {
        const qr = encodeQr('HELLO', { ecc: 'L' });
        expect(qr?.version).toBe(1);
        expect(qr?.ecc).toBe('H');
        expect(qr?.size).toBe(21);
    });
    it('refuses payloads beyond version 40', () => {
        expect(encodeQr('x'.repeat(2954), { ecc: 'L' })).toBeNull();
        expect(encodeQr('x'.repeat(2953), { ecc: 'L' })?.version).toBe(40);
    });
    it('draws an SVG with numbers only (no text from the payload)', () => {
        const qr = encodeQr('<script>alert(1)</script>');
        const svg = qrSvg(qr);
        expect(svg).not.toContain('script');
        expect(svg.startsWith('<svg')).toBe(true);
        expect(qrPath(qr)).toMatch(/^[Mhvz0-9 -]+$/);
    });
});
