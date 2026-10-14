/**
 * Share links that need no server: the world travels in the URL fragment
 * (`#/view/<token>`), deflate-compressed and base64url-encoded. Fragments
 * never reach a server, so any static host serves them and nothing is
 * uploaded. A token is `z1.<base64url of deflate-raw(JSON)>`, or
 * `j1.<base64url of JSON>` where the browser lacks CompressionStream.
 *
 * Decoding treats the token as untrusted: strict charset and length caps,
 * a cap on the decompressed size (no decompression bombs), then the same
 * validation as a file import (`parseWorldImport`).
 */
import type { WorldDoc } from '@aether/core';
import { MAX_IMPORT_BYTES } from '../config';
import { parseWorldImport, type ImportResult } from './worldIO';

/** Longest token accepted or produced (characters; keeps URLs well inside every browser's limit). */
export const MAX_LINK_TOKEN = 60_000;
/** Route prefix of a viewer link. */
export const VIEW_PREFIX = '#/view/';
const TOKEN = /^(z1|j1)\.([A-Za-z0-9_-]+)$/;

/** Base64url (no padding) of bytes. */
export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Bytes of a base64url string (null when malformed). */
export function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function hasStreams(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && typeof Blob === 'function' && typeof Response === 'function';
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflate with a hard cap on the output size (throws past `maxBytes`). */
async function inflate(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
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
export async function encodeWorldToken(world: WorldDoc, maxChars = MAX_LINK_TOKEN): Promise<string | null> {
  const json = new TextEncoder().encode(JSON.stringify(world));
  let token: string;
  if (hasStreams()) token = `z1.${toBase64Url(await deflate(json))}`;
  else token = `j1.${toBase64Url(json)}`;
  return token.length <= maxChars ? token : null;
}

/** Decode and validate a link token. Never throws. */
export async function decodeWorldToken(token: string, maxBytes = MAX_IMPORT_BYTES): Promise<ImportResult> {
  if (typeof token !== 'string' || token.length > MAX_LINK_TOKEN + 3) return { ok: false, error: 'This link is too long to be a world link.' };
  const m = TOKEN.exec(token);
  if (!m) return { ok: false, error: 'This link is damaged (unexpected characters).' };
  const bytes = fromBase64Url(m[2] as string);
  if (!bytes) return { ok: false, error: 'This link is damaged (bad encoding).' };
  let raw: Uint8Array;
  if (m[1] === 'z1') {
    if (!hasStreams()) return { ok: false, error: 'This browser cannot open compressed world links. Try a current Chrome, Edge, Firefox or Safari.' };
    try {
      raw = await inflate(bytes, maxBytes);
    } catch (err) {
      return { ok: false, error: err instanceof Error && err.message === 'too large' ? 'The world in this link is too large.' : 'This link is damaged (cannot be decompressed).' };
    }
  } else {
    if (bytes.byteLength > maxBytes) return { ok: false, error: 'The world in this link is too large.' };
    raw = bytes;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return { ok: false, error: 'This link is damaged (not text).' };
  }
  return parseWorldImport(text, maxBytes);
}

/** Viewer URL for a token on this page's origin and path. */
export function viewerUrl(token: string, loc: { origin: string; pathname: string } = location): string {
  return `${loc.origin}${loc.pathname}${VIEW_PREFIX}${token}`;
}
