/**
 * Minimal ZIP writer and reader for exported world packages. Writing uses
 * DEFLATE through the browser's `CompressionStream('deflate-raw')` when
 * available (every current browser) and STORE otherwise. Reading accepts
 * STORE and DEFLATE entries only and treats the archive as untrusted:
 * entry count, per-entry and total sizes are capped (declared sizes are
 * checked first and enforced again while inflating, so a zip bomb stops at
 * the cap), names are normalised and anything absolute, with `..`,
 * backslashes or control characters is refused. No ZIP64, no encryption.
 */

/** Reader limits. */
export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 512, maxEntryBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 };

/** One file of an archive. */
export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

let crcTable: Uint32Array | null = null;

/** CRC-32 (IEEE) of `data`. */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = (crcTable[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Windows device names (`con`, `nul`, `com1`, … with any extension): writing
 * `aux.json` on Windows talks to a device instead of creating a file.
 */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]|conin\$|conout\$)(\..*)?$/i;

/** True for a safe relative entry name (`world.json`, `assets/user-1a2b.glb`). */
export function safeEntryName(name: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (name.length === 0 || name.length > 200 || /[\u0000-\u001f\\:*?"<>|]/.test(name)) return false;
  if (name.startsWith('/') || name.endsWith('/')) return false;
  // Parts must not be empty, `.`/`..`, a Windows device, or end in a dot or space (Windows strips those, aliasing two names).
  return name.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && !WINDOWS_DEVICE.test(part) && !/[. ]$/.test(part));
}

async function pipe(data: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>, cap: number): Promise<Uint8Array | null> {
  const writer = stream.writable.getWriter();
  void writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close()).catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
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
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

const hasCompression = (): boolean => typeof CompressionStream !== 'undefined';
const hasDecompression = (): boolean => typeof DecompressionStream !== 'undefined';

/** Formats that are already compressed: stored as they are (deflating them only costs time). */
const PRECOMPRESSED = /\.(png|jpe?g|webp|gif|woff2?|mp4|webm|zip|glb)$/i;

/** Build a ZIP archive (deflate when the platform supports it, store otherwise). */
export async function writeZip(entries: readonly ZipEntry[], opts: { compress?: boolean } = {}): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    if (!safeEntryName(e.name)) throw new Error(`unsafe entry name ${e.name.slice(0, 64)}`);
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    let method = 0;
    let body = e.data;
    if (opts.compress !== false && hasCompression() && e.data.byteLength > 64 && !PRECOMPRESSED.test(e.name)) {
      const deflated = await pipe(e.data, new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>, e.data.byteLength + 1024);
      if (deflated && deflated.byteLength < e.data.byteLength) {
        method = 8;
        body = deflated;
      }
    }
    const local = new Uint8Array(30 + name.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x21, true); // 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.byteLength, true);
    lv.setUint32(22, e.data.byteLength, true);
    lv.setUint16(26, name.byteLength, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    locals.push(local, body);
    const central = new Uint8Array(46 + name.byteLength);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.byteLength, true);
    cv.setUint32(24, e.data.byteLength, true);
    cv.setUint16(28, name.byteLength, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.byteLength + body.byteLength;
  }
  const centralSize = centrals.reduce((s, c) => s + c.byteLength, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/** Result of {@link readZip}. */
export type ZipResult = { ok: true; entries: ZipEntry[] } | { ok: false; error: string };

/** Read an archive with untrusted content (see module docs). Never throws. */
export async function readZip(bytes: Uint8Array, limits: Partial<ZipLimits> = {}): Promise<ZipResult> {
  const lim = { ...DEFAULT_ZIP_LIMITS, ...limits };
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // End of central directory: scan back over a possible comment (≤ 64 KB).
    let eocd = -1;
    for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 22 - 65_535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return { ok: false, error: 'not a ZIP archive' };
    const count = dv.getUint16(eocd + 10, true);
    const cdSize = dv.getUint32(eocd + 12, true);
    const cdOffset = dv.getUint32(eocd + 16, true);
    if (count > lim.maxEntries) return { ok: false, error: `too many files in the archive (limit ${lim.maxEntries})` };
    if (cdOffset + cdSize > eocd) return { ok: false, error: 'corrupt archive (central directory)' };
    const dec = new TextDecoder('utf-8', { fatal: true });
    const entries: ZipEntry[] = [];
    let total = 0;
    let p = cdOffset;
    const seen = new Set<string>();
    for (let i = 0; i < count; i++) {
      if (p + 46 > eocd || dv.getUint32(p, true) !== 0x02014b50) return { ok: false, error: 'corrupt archive (entry header)' };
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const crc = dv.getUint32(p + 16, true);
      const csize = dv.getUint32(p + 20, true);
      const usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true);
      const xlen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue; // directory record
      if (flags & 0x1) return { ok: false, error: 'encrypted archives are not supported' };
      if (!safeEntryName(name)) return { ok: false, error: `unsafe file name in archive: ${name.slice(0, 64)}` };
      if (seen.has(name)) return { ok: false, error: `duplicate file in archive: ${name.slice(0, 64)}` };
      seen.add(name);
      if (method !== 0 && method !== 8) return { ok: false, error: 'unsupported compression in archive' };
      if (usize > lim.maxEntryBytes || csize > lim.maxEntryBytes) return { ok: false, error: `a file in the archive is too large (limit ${Math.round(lim.maxEntryBytes / 1024 / 1024)} MB)` };
      total += usize;
      if (total > lim.maxTotalBytes) return { ok: false, error: `the archive is too large when unpacked (limit ${Math.round(lim.maxTotalBytes / 1024 / 1024)} MB)` };
      if (local + 30 > bytes.byteLength || dv.getUint32(local, true) !== 0x04034b50) return { ok: false, error: 'corrupt archive (local header)' };
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      if (start + csize > bytes.byteLength) return { ok: false, error: 'corrupt archive (truncated data)' };
      const raw = bytes.subarray(start, start + csize);
      let data: Uint8Array | null;
      if (method === 0) data = raw.slice();
      else {
        if (!hasDecompression()) return { ok: false, error: 'this browser cannot unpack compressed archives' };
        data = await pipe(raw, new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>, usize);
      }
      if (!data || data.byteLength !== usize) return { ok: false, error: `corrupt archive (size mismatch in ${name.slice(0, 64)})` };
      if (crc32(data) !== crc) return { ok: false, error: `corrupt archive (checksum mismatch in ${name.slice(0, 64)})` };
      entries.push({ name, data });
    }
    return { ok: true, entries };
  } catch (err) {
    return { ok: false, error: `the archive could not be read (${err instanceof Error ? err.message.slice(0, 80) : 'error'})` };
  }
}
