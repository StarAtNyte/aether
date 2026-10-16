import { MAX_IMPORT_BYTES } from '../config';
import { parseWorldImport } from './worldIO';
/** Longest token accepted or produced (characters; keeps URLs well inside every browser's limit). */
export const MAX_LINK_TOKEN = 60_000;
/** Route prefix of a viewer link. */
export const VIEW_PREFIX = '#/view/';
const TOKEN = /^(z1|j1)\.([A-Za-z0-9_-]+)$/;
/** Base64url (no padding) of bytes. */
export function toBase64Url(bytes) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK)
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** Bytes of a base64url string (null when malformed). */
export function fromBase64Url(s) {
    if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1)
        return null;
    try {
        const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++)
            out[i] = bin.charCodeAt(i);
        return out;
    }
    catch {
        return null;
    }
}
function hasStreams() {
    return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && typeof Blob === 'function' && typeof Response === 'function';
}
async function deflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** Inflate with a hard cap on the output size (throws past `maxBytes`). */
async function inflate(bytes, maxBytes) {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const parts = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new Error('too large');
        }
        parts.push(value);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.byteLength;
    }
    return out;
}
/** Encode a world as a link token (null when it would exceed {@link MAX_LINK_TOKEN}). */
export async function encodeWorldToken(world, maxChars = MAX_LINK_TOKEN) {
    const json = new TextEncoder().encode(JSON.stringify(world));
    let token;
    if (hasStreams())
        token = `z1.${toBase64Url(await deflate(json))}`;
    else
        token = `j1.${toBase64Url(json)}`;
    return token.length <= maxChars ? token : null;
}
/** Decode and validate a link token. Never throws. */
export async function decodeWorldToken(token, maxBytes = MAX_IMPORT_BYTES) {
    if (typeof token !== 'string' || token.length > MAX_LINK_TOKEN + 3)
        return { ok: false, error: 'This link is too long to be a world link.' };
    const m = TOKEN.exec(token);
    if (!m)
        return { ok: false, error: 'This link is damaged (unexpected characters).' };
    const bytes = fromBase64Url(m[2]);
    if (!bytes)
        return { ok: false, error: 'This link is damaged (bad encoding).' };
    let raw;
    if (m[1] === 'z1') {
        if (!hasStreams())
            return { ok: false, error: 'This browser cannot open compressed world links. Try a current Chrome, Edge, Firefox or Safari.' };
        try {
            raw = await inflate(bytes, maxBytes);
        }
        catch (err) {
            return { ok: false, error: err instanceof Error && err.message === 'too large' ? 'The world in this link is too large.' : 'This link is damaged (cannot be decompressed).' };
        }
    }
    else {
        if (bytes.byteLength > maxBytes)
            return { ok: false, error: 'The world in this link is too large.' };
        raw = bytes;
    }
    let text;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    }
    catch {
        return { ok: false, error: 'This link is damaged (not text).' };
    }
    return parseWorldImport(text, maxBytes);
}
/** Viewer URL for a token on this page's origin and path. */
export function viewerUrl(token, loc = location) {
    return `${loc.origin}${loc.pathname}${VIEW_PREFIX}${token}`;
}
