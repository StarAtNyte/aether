/**
 * Allocation-light base64 for binary mesh data. Portable (no Buffer, no
 * atob), strict on input (rejects anything that is not canonical base64) and
 * chunked so no single string exceeds the untrusted-input string limit.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++)
    LOOKUP[ALPHABET.charCodeAt(i)] = i;
/** Characters per chunk (multiple of 4): 64 Ki. */
export const BASE64_CHUNK_CHARS = 65_536;
/** Bytes per chunk (3/4 of the characters). */
export const BASE64_CHUNK_BYTES = (BASE64_CHUNK_CHARS / 4) * 3;
/** Encode bytes as one base64 string (with padding). */
export function encodeBase64(bytes) {
    const parts = [];
    const n = bytes.length;
    // Build in slices so the intermediate string array stays small.
    const SLICE = 3 * 4096;
    for (let start = 0; start < n; start += SLICE) {
        const end = Math.min(n, start + SLICE);
        let s = '';
        let i = start;
        for (; i + 2 < end; i += 3) {
            const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
            s += ALPHABET[(v >> 18) & 63] + ALPHABET[(v >> 12) & 63] + ALPHABET[(v >> 6) & 63] + ALPHABET[v & 63];
        }
        const rest = end - i;
        if (rest === 1) {
            const v = bytes[i] << 16;
            s += `${ALPHABET[(v >> 18) & 63]}${ALPHABET[(v >> 12) & 63]}==`;
        }
        else if (rest === 2) {
            const v = (bytes[i] << 16) | (bytes[i + 1] << 8);
            s += `${ALPHABET[(v >> 18) & 63]}${ALPHABET[(v >> 12) & 63]}${ALPHABET[(v >> 6) & 63]}=`;
        }
        parts.push(s);
    }
    return parts.join('');
}
/** Decoded byte length of a base64 string (throws when the length is not a multiple of 4). */
export function base64ByteLength(s) {
    if (s.length % 4 !== 0)
        throw new Error('base64 length must be a multiple of 4');
    if (s.length === 0)
        return 0;
    const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
    return (s.length / 4) * 3 - pad;
}
/** Decode one base64 string into `out` at `offset`; returns the bytes written. Throws on invalid input. */
export function decodeBase64Into(s, out, offset) {
    const len = base64ByteLength(s);
    if (offset + len > out.length)
        throw new Error('base64 data longer than expected');
    let o = offset;
    for (let i = 0; i < s.length; i += 4) {
        const c0 = s.charCodeAt(i);
        const c1 = s.charCodeAt(i + 1);
        const c2 = s.charCodeAt(i + 2);
        const c3 = s.charCodeAt(i + 3);
        const a = c0 < 128 ? LOOKUP[c0] : -1;
        const b = c1 < 128 ? LOOKUP[c1] : -1;
        if (a < 0 || b < 0)
            throw new Error('invalid base64 character');
        const last = i + 4 === s.length;
        const cPad = c2 === 61;
        const dPad = c3 === 61;
        if ((cPad || dPad) && !last)
            throw new Error('base64 padding inside the data');
        if (cPad && !dPad)
            throw new Error('invalid base64 padding');
        const c = cPad ? 0 : c2 < 128 ? LOOKUP[c2] : -1;
        const d = dPad ? 0 : c3 < 128 ? LOOKUP[c3] : -1;
        if (c < 0 || d < 0)
            throw new Error('invalid base64 character');
        const v = (a << 18) | (b << 12) | (c << 6) | d;
        out[o++] = (v >> 16) & 255;
        if (!cPad)
            out[o++] = (v >> 8) & 255;
        if (!dPad)
            out[o++] = v & 255;
    }
    return o - offset;
}
/** Encode bytes as base64 chunks of at most {@link BASE64_CHUNK_CHARS} characters. */
export function encodeChunks(bytes) {
    const out = [];
    for (let start = 0; start < bytes.length; start += BASE64_CHUNK_BYTES) {
        out.push(encodeBase64(bytes.subarray(start, Math.min(bytes.length, start + BASE64_CHUNK_BYTES))));
    }
    return out;
}
/** Total decoded byte length of chunks (every chunk but the last must be unpadded). */
export function chunksByteLength(chunks) {
    let total = 0;
    for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        if (i < chunks.length - 1 && c.endsWith('='))
            throw new Error('only the last base64 chunk may be padded');
        total += base64ByteLength(c);
    }
    return total;
}
/** Decode chunks into a new byte array of exactly `expected` bytes (throws when the size differs). */
export function decodeChunks(chunks, expected) {
    const total = chunksByteLength(chunks);
    if (total !== expected)
        throw new Error(`expected ${expected} bytes, got ${total}`);
    // 4-byte aligned buffer so float32 / uint32 views need no copy.
    const buffer = new ArrayBuffer(Math.ceil(expected / 4) * 4);
    const out = new Uint8Array(buffer, 0, expected);
    let o = 0;
    for (const c of chunks)
        o += decodeBase64Into(c, out, o);
    return out;
}
