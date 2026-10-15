/**
 * Hashing and encoding primitives of the proof format: a dependency-free
 * SHA-256 (so hashing is synchronous and works in insecure browser contexts
 * and every worker), canonical JSON, hex / base64url, and a content hash of
 * Float32 data that is independent of platform endianness.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of `data` (32 bytes). Pure JavaScript, synchronous. */
export function sha256(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = data.length;
  const total = (((len + 9 + 63) >>> 6) << 6) >>> 0;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor(len / 0x20000000), false);
  view.setUint32(total - 4, (len << 3) >>> 0, false);
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] as number;
      const b = w[i - 2] as number;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }
    let a = h[0] as number;
    let b = h[1] as number;
    let c = h[2] as number;
    let d = h[3] as number;
    let e = h[4] as number;
    let f = h[5] as number;
    let g = h[6] as number;
    let hh = h[7] as number;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + (K[i] as number) + (w[i] as number)) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = ((h[0] as number) + a) >>> 0;
    h[1] = ((h[1] as number) + b) >>> 0;
    h[2] = ((h[2] as number) + c) >>> 0;
    h[3] = ((h[3] as number) + d) >>> 0;
    h[4] = ((h[4] as number) + e) >>> 0;
    h[5] = ((h[5] as number) + f) >>> 0;
    h[6] = ((h[6] as number) + g) >>> 0;
    h[7] = ((h[7] as number) + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i] as number, false);
  return out;
}

/** Lower-case hex of `bytes`. */
export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += (b < 16 ? '0' : '') + b.toString(16);
  return s;
}

/** Unpadded base64url of `bytes`. */
export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode unpadded base64url; null when malformed. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const pad = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  try {
    const bin = atob(pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** `sha256:<hex>` digest string of bytes. */
export function digest(bytes: Uint8Array): string {
  return `sha256:${toHex(sha256(bytes))}`;
}

const encoder = new TextEncoder();

/**
 * Canonical JSON: object keys sorted by code point, no whitespace, numbers
 * in their shortest round-trip form (`-0` is `0`), `undefined` members
 * dropped. Non-finite numbers, functions and cycles throw — they cannot be
 * hashed reproducibly.
 */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  const walk = (v: unknown): string => {
    if (v === null) return 'null';
    switch (typeof v) {
      case 'boolean':
        return v ? 'true' : 'false';
      case 'number':
        if (!Number.isFinite(v)) throw new Error('canonicalJson: non-finite number');
        return Object.is(v, -0) ? '0' : JSON.stringify(v);
      case 'string':
        return JSON.stringify(v);
      case 'object': {
        if (seen.has(v)) throw new Error('canonicalJson: cyclic value');
        seen.add(v);
        let out: string;
        if (Array.isArray(v)) {
          out = `[${v.map((x) => (x === undefined ? 'null' : walk(x))).join(',')}]`;
        } else {
          const rec = v as Record<string, unknown>;
          const keys = Object.keys(rec)
            .filter((k) => rec[k] !== undefined)
            .sort();
          out = `{${keys.map((k) => `${JSON.stringify(k)}:${walk(rec[k])}`).join(',')}}`;
        }
        seen.delete(v);
        return out;
      }
      default:
        throw new Error(`canonicalJson: unsupported ${typeof v}`);
    }
  };
  return walk(value);
}

/** Content hash (`sha256:<hex>`) of the canonical JSON of `value`. */
export function hashJson(value: unknown): string {
  return digest(encoder.encode(canonicalJson(value)));
}

/**
 * Hash of float data as little-endian IEEE-754 binary32 after quantising
 * each value to `1/scale` (default 1000: one millimetre), so the digest does
 * not depend on host endianness or on sub-millimetre noise. Non-finite
 * values hash as a sentinel.
 */
export function hashQuantized(values: ArrayLike<number>, scale = 1000): string {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    view.setInt32(i * 4, Number.isFinite(v) ? Math.max(-2147483647, Math.min(2147483647, Math.round(v * scale))) : -2147483648, true);
  }
  return digest(out);
}

/** UTF-8 bytes of `text`. */
export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}
