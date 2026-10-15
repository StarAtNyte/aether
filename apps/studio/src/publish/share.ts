/**
 * Share links without a server: the world (World IR, which already carries
 * its generator and script source and its block edits) is serialized,
 * DEFLATE-compressed with the platform's `CompressionStream('deflate-raw')`
 * and base64url-encoded into the URL **fragment** of the static player
 * (`https://<host>/play#w=<data>`). Browsers never send the fragment to a
 * server, so a shared world costs the host nothing and is never stored.
 *
 * Everything decoded is untrusted: the fragment length, the compressed and
 * inflated sizes (enforced while inflating, so a "zip bomb" stops at the
 * cap) and the JSON (prototype-pollution guard + `validateWorld` through
 * {@link validateImportedValue}) are all checked, and custom generator and
 * script code only ever runs in the existing sandboxes.
 *
 * Wire format: `#w=` + one format letter + base64url payload, where `D` is
 * deflate-raw and `J` is plain JSON (browsers without CompressionStream).
 * The JSON is {@link SharePayload}.
 */
import { z } from 'zod';
import type { WorldDoc } from '@aether/core';
import { validateImportedValue } from '../lib/worldIO';
import { MOODS } from './video/music';
import { SHARE_KEY } from './share-key';

export { SHARE_KEY };
/** Payload format version. */
export const SHARE_VERSION = 1;
/** Longest fragment value accepted or produced (characters ≈ bytes): about 1.5 MB. */
export const MAX_FRAGMENT_CHARS = 1_500_000;
/** Largest inflated payload (bytes). */
export const MAX_SHARE_JSON_BYTES = 8 * 1024 * 1024;
/** Above this many characters some chat apps and QR codes cannot carry the link. */
export const LONG_LINK_CHARS = 64 * 1024;

/** Text fields shown on the player's title screen. */
export const ShareMeta = z.object({
  title: z.string().max(80).optional(),
  description: z.string().max(600).optional(),
  author: z.string().max(60).optional(),
  /** Controls hint shown under the title (auto-generated when absent). */
  controls: z.string().max(300).optional(),
  /** Background music of the player. */
  music: z.enum(MOODS).optional(),
});
export type ShareMeta = z.infer<typeof ShareMeta>;

/** What a share link carries (the world is validated separately with `validateWorld`). */
export interface SharePayload {
  v: typeof SHARE_VERSION;
  world: WorldDoc;
  meta: ShareMeta;
  /** Sealed replay proof (`@aether/verifier`), untrusted until a viewer re-checks it. */
  proof?: unknown;
}

const Envelope = z.object({ v: z.literal(SHARE_VERSION), world: z.unknown(), meta: ShareMeta.optional(), proof: z.unknown().optional() }).strict();

/** Largest proof (JSON characters) a share link carries: links stay short; bigger proofs ship with downloaded games. */
export const MAX_LINK_PROOF_CHARS = 16 * 1024;

/** Result of {@link decodeShare}. */
export type ShareDecodeResult = { ok: true; payload: SharePayload } | { ok: false; error: string };

/** Result of {@link encodeShare}. */
export interface ShareEncodeResult {
  /** The fragment value (format letter + base64url), without `#w=`. */
  value: string;
  /** Characters of the value. */
  chars: number;
  /** Uncompressed JSON bytes. */
  jsonBytes: number;
  /** False when the link exceeds {@link MAX_FRAGMENT_CHARS}. */
  fits: boolean;
  /** True when the link carries the replay proof (false: none given, or too large for a link). */
  sealed: boolean;
}

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

/** base64url (RFC 4648 §5, no padding) of `bytes`. */
export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode base64url (padding optional); null when the text is not base64url. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// (De)compression with caps
// ---------------------------------------------------------------------------

async function pipeThrough(data: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>, cap: number): Promise<Uint8Array | null> {
  const writer = stream.writable.getWriter();
  void writer
    .write(data as Uint8Array<ArrayBuffer>)
    .then(() => writer.close())
    .catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** True when the platform can deflate (every current browser, Node 18+). */
export function canCompress(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

/** Remove characters that have no business in a one-line title (control chars, bidi overrides). */
export function cleanLine(text: string | undefined, max: number): string | undefined {
  if (typeof text !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const t = text.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return t === '' ? undefined : t;
}

/** Same for multi-line text (keeps line breaks). */
export function cleanText(text: string | undefined, max: number): string | undefined {
  if (typeof text !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const t = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
  return t === '' ? undefined : t;
}

/** Normalize title-screen fields (drops empty ones). */
export function cleanMeta(meta: ShareMeta): ShareMeta {
  const out: ShareMeta = {};
  const title = cleanLine(meta.title, 80);
  const description = cleanText(meta.description, 600);
  const author = cleanLine(meta.author, 60);
  const controls = cleanLine(meta.controls, 300);
  if (title) out.title = title;
  if (description) out.description = description;
  if (author) out.author = author;
  if (controls) out.controls = controls;
  if (meta.music && (MOODS as readonly string[]).includes(meta.music)) out.music = meta.music;
  return out;
}

/** Serialize, compress and encode a world for a share link. */
export async function encodeShare(world: WorldDoc, meta: ShareMeta = {}, proof?: object | null): Promise<ShareEncodeResult> {
  const payload: SharePayload = { v: SHARE_VERSION, world, meta: cleanMeta(meta) };
  if (proof && JSON.stringify(proof).length <= MAX_LINK_PROOF_CHARS) payload.proof = proof;
  const json = new TextEncoder().encode(JSON.stringify(payload));
  let value: string;
  if (canCompress()) {
    const deflated = await pipeThrough(json, new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>, json.byteLength + 1024);
    value = deflated ? `D${toBase64Url(deflated)}` : `J${toBase64Url(json)}`;
  } else {
    value = `J${toBase64Url(json)}`;
  }
  return { value, chars: value.length, jsonBytes: json.byteLength, fits: value.length <= MAX_FRAGMENT_CHARS, sealed: payload.proof !== undefined };
}

/**
 * The share value of a URL fragment (`#w=…`, possibly with other `&`-joined
 * keys), or null when there is none. The fragment is read as given (never
 * percent-decoded beyond what base64url allows).
 */
export function shareValueFromHash(hash: string): string | null {
  if (typeof hash !== 'string' || hash.length < 3) return null;
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of body.split('&')) {
    if (part.startsWith(`${SHARE_KEY}=`)) return part.slice(SHARE_KEY.length + 1);
  }
  return null;
}

/** Decode and validate a share value (see module docs). Never throws. */
export async function decodeShare(value: string): Promise<ShareDecodeResult> {
  if (typeof value !== 'string' || value.length < 2) return { ok: false, error: 'This link does not contain a world.' };
  if (value.length > MAX_FRAGMENT_CHARS) return { ok: false, error: 'This link is too long to open (more than 1.5 MB).' };
  const format = value[0];
  const bytes = fromBase64Url(value.slice(1));
  if (!bytes) return { ok: false, error: 'This link is damaged (it is not valid base64url). Copy the whole link and try again.' };
  let json: Uint8Array | null;
  if (format === 'D') {
    if (!canCompress()) return { ok: false, error: 'This browser cannot open compressed links. Update it and try again.' };
    json = await pipeThrough(bytes, new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>, MAX_SHARE_JSON_BYTES);
    if (!json) return { ok: false, error: 'This link is damaged or unpacks to more than 8 MB.' };
  } else if (format === 'J') {
    if (bytes.byteLength > MAX_SHARE_JSON_BYTES) return { ok: false, error: 'This link is too large.' };
    json = bytes;
  } else {
    return { ok: false, error: 'This link uses an unknown format. It may come from a newer version.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json));
  } catch {
    return { ok: false, error: 'This link is damaged (its contents are not valid JSON).' };
  }
  const env = Envelope.safeParse(parsed);
  if (!env.success) return { ok: false, error: 'This link does not contain an Aether world.' };
  const world = validateImportedValue(env.data.world);
  if (!world.ok) return { ok: false, error: world.error };
  const payload: SharePayload = { v: SHARE_VERSION, world: world.world, meta: cleanMeta(env.data.meta ?? {}) };
  if (typeof env.data.proof === 'object' && env.data.proof !== null && JSON.stringify(env.data.proof).length <= MAX_LINK_PROOF_CHARS * 4) payload.proof = env.data.proof;
  return { ok: true, payload };
}

/** Full share URL for a player page (`base` like `https://host/play`). */
export function shareUrl(base: string, value: string): string {
  return `${base.replace(/#.*$/, '')}#${SHARE_KEY}=${value}`;
}

/** Human size of a link ("38 KB"). */
export function linkSizeLabel(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${Math.round(chars / 1024)} KB`;
  return `${(chars / 1024 / 1024).toFixed(1)} MB`;
}
