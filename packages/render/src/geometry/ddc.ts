/**
 * The generated-geometry cache (the "derived data cache"): generator outputs, with their render-ready streams,
 * kept across visits in Cache Storage and keyed by the output's normalized key (generator, resolved params, seed,
 * custom source hash) plus a code version. A hit skips generation, validation and preparation entirely.
 *
 * - Blobs live in Cache Storage (`aether-ddc-v1`) under a synthetic same-origin URL `/__ddc/<sha256>`.
 * - A small IndexedDB store (`aether-ddc-meta`) lists `{ key, bytes, lastUsed }` for least-recently-used eviction under
 *   a byte cap (1 GB, or a quarter of the origin's quota when smaller).
 * - Reads and writes happen in the trusted generation workers only (gen.worker.ts): the page never touches the bytes
 *   until they arrive as transferred typed arrays. Generator code (the locked-down sandbox) has no storage at all.
 * - The cache is an accelerator: every failure (no Cache Storage, quota, a corrupt entry) falls back to generating.
 *
 * Value format: `u32 header length | header JSON | padding | arrays`, the header being the output as JSON with every
 * typed array replaced by `{ "$a": index }` into a table of `[type, byteOffset, length]` (8-byte aligned).
 * Arrays shared by reference (a part's streams reused by its prepared streams) are stored once and stay shared.
 */
import type { GeneratorOutput } from '../types';
import { PREPARE_VERSION } from './buffer-geometry';

declare const __AETHER_GEN_VERSION__: string | undefined;

/** Code version salted into every key: the build's hash of the generator and preparation sources. */
export const DDC_CODE_VERSION = `${typeof __AETHER_GEN_VERSION__ === 'string' ? __AETHER_GEN_VERSION__ : 'dev'}.p${PREPARE_VERSION}`;

const CACHE_NAME = 'aether-ddc-v1';
const META_DB = 'aether-ddc-meta';
const META_STORE = 'entries';
const FORMAT = 1;
/** Byte cap of the whole cache (before the quota share). */
export const DDC_MAX_BYTES = 1024 * 1024 * 1024;

type ArrayCtor = Float32ArrayConstructor | Float64ArrayConstructor | Uint32ArrayConstructor | Uint16ArrayConstructor | Uint8ArrayConstructor | Int32ArrayConstructor | Int16ArrayConstructor | Int8ArrayConstructor;
const TYPES: Readonly<Record<string, ArrayCtor>> = {
  f32: Float32Array,
  f64: Float64Array,
  u32: Uint32Array,
  u16: Uint16Array,
  u8: Uint8Array,
  i32: Int32Array,
  i16: Int16Array,
  i8: Int8Array,
};

function typeTag(a: ArrayBufferView): string | null {
  if (a instanceof Float32Array) return 'f32';
  if (a instanceof Float64Array) return 'f64';
  if (a instanceof Uint32Array) return 'u32';
  if (a instanceof Uint16Array) return 'u16';
  if (a instanceof Uint8Array) return 'u8';
  if (a instanceof Int32Array) return 'i32';
  if (a instanceof Int16Array) return 'i16';
  if (a instanceof Int8Array) return 'i8';
  return null;
}

/** An encoded cache entry (the arrays are copied: the output may be transferred away afterwards). */
export interface EncodedOutput {
  blob: Blob;
  bytes: number;
}

/** Serialize an output into a Blob (typed arrays copied; the output itself is untouched). */
export function encodeOutput(out: GeneratorOutput): EncodedOutput {
  const arrays: ArrayBufferView[] = [];
  const index = new Map<ArrayBufferView, number>();
  const table: Array<[string, number, number]> = [];
  let offset = 0;
  const json = JSON.stringify({ v: FORMAT, out }, (_k, value: unknown) => {
    if (ArrayBuffer.isView(value)) {
      let i = index.get(value);
      if (i === undefined) {
        const tag = typeTag(value);
        if (!tag) throw new Error('unsupported array type');
        i = arrays.length;
        index.set(value, i);
        arrays.push(value);
        table.push([tag, offset, (value as unknown as { length: number }).length]);
        offset += Math.ceil(value.byteLength / 8) * 8;
      }
      return { $a: i };
    }
    return value;
  });
  const header = new TextEncoder().encode(JSON.stringify({ table, json }));
  const head = new Uint8Array(Math.ceil((4 + header.byteLength) / 8) * 8);
  new DataView(head.buffer).setUint32(0, header.byteLength, true);
  head.set(header, 4);
  const parts: BlobPart[] = [head];
  for (const a of arrays) {
    parts.push(new Uint8Array(a.buffer as ArrayBuffer, a.byteOffset, a.byteLength));
    const pad = (8 - (a.byteLength % 8)) % 8;
    if (pad) parts.push(new Uint8Array(pad));
  }
  return { blob: new Blob(parts), bytes: head.byteLength + offset };
}

/** Inverse of {@link encodeOutput}; every array gets a buffer of its own (safe to transfer). Throws on malformed data. */
export function decodeOutput(buf: ArrayBuffer): GeneratorOutput {
  if (buf.byteLength < 8) throw new Error('short entry');
  const len = new DataView(buf).getUint32(0, true);
  if (4 + len > buf.byteLength) throw new Error('bad header length');
  const { table, json } = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as { table: Array<[string, number, number]>; json: string };
  const base = Math.ceil((4 + len) / 8) * 8;
  const views: ArrayBufferView[] = table.map(([tag, off, n]) => {
    const Ctor = TYPES[tag];
    if (!Ctor || !Number.isInteger(off) || !Number.isInteger(n) || off < 0 || n < 0) throw new Error('bad array entry');
    const start = base + off;
    const end = start + n * Ctor.BYTES_PER_ELEMENT;
    if (end > buf.byteLength) throw new Error('array out of range');
    return new Ctor(buf.slice(start, end));
  });
  const doc = JSON.parse(json, (_k, value: unknown) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && typeof (value as { $a?: unknown }).$a === 'number' && Object.keys(value).length === 1) {
      const v = views[(value as { $a: number }).$a];
      if (!v) throw new Error('bad array reference');
      return v;
    }
    return value;
  }) as { v: number; out: GeneratorOutput };
  if (doc.v !== FORMAT || !doc.out || !Array.isArray(doc.out.parts)) throw new Error('bad entry');
  return doc.out;
}

/** The storage key of an output key: SHA-256 hex of the code version and the output key. */
export async function ddcKey(outputKey: string, kind = 'gen'): Promise<string> {
  const bytes = new TextEncoder().encode(`${kind}\u0000${DDC_CODE_VERSION}\u0000${outputKey}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

interface MetaEntry {
  key: string;
  bytes: number;
  lastUsed: number;
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** One worker's handle on the cache. Every method resolves (never rejects): failures read as misses. */
export class Ddc {
  private cache: Cache | null = null;
  private db: IDBDatabase | null = null;
  /** Keys known to be stored (loaded once): a lookup of anything else is a miss without touching storage. */
  private readonly known = new Set<string>();
  private ready: Promise<boolean> | null = null;
  private trimTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly touched = new Map<string, number>();
  private touchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly base: string) {}

  /** True when Cache Storage and IndexedDB are both usable here. */
  static available(): boolean {
    return typeof caches !== 'undefined' && typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle;
  }

  private open(): Promise<boolean> {
    this.ready ??= (async () => {
      try {
        if (!Ddc.available()) return false;
        this.cache = await caches.open(CACHE_NAME);
        const req = indexedDB.open(META_DB, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
        };
        this.db = await request(req);
        const keys = (await request(this.db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAllKeys())) as string[];
        for (const k of keys) this.known.add(k);
        return true;
      } catch {
        this.cache = null;
        this.db = null;
        return false;
      }
    })();
    return this.ready;
  }

  private url(key: string): string {
    return new URL(`/__ddc/${key}`, this.base).href;
  }

  /** The stored output of `key` (a {@link ddcKey}), or null. A corrupt entry is deleted. */
  async get(key: string): Promise<GeneratorOutput | null> {
    if (!(await this.open()) || !this.known.has(key) || !this.cache) return null;
    try {
      const res = await this.cache.match(this.url(key));
      if (!res) {
        this.known.delete(key);
        return null;
      }
      const out = decodeOutput(await res.arrayBuffer());
      this.touch(key);
      return out;
    } catch {
      void this.remove(key);
      return null;
    }
  }

  /** Store an encoded output under `key`. */
  async put(key: string, encoded: EncodedOutput): Promise<void> {
    if (!(await this.open()) || !this.cache || !this.db) return;
    try {
      await this.cache.put(this.url(key), new Response(encoded.blob, { headers: { 'content-type': 'application/octet-stream' } }));
      const tx = this.db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).put({ key, bytes: encoded.bytes, lastUsed: Date.now() } satisfies MetaEntry);
      await done(tx);
      this.known.add(key);
      this.scheduleTrim();
    } catch {
      // Quota or storage failure: the cache is only an accelerator.
    }
  }

  /** Delete one entry. */
  async remove(key: string): Promise<void> {
    this.known.delete(key);
    try {
      await this.cache?.delete(this.url(key));
      if (this.db) {
        const tx = this.db.transaction(META_STORE, 'readwrite');
        tx.objectStore(META_STORE).delete(key);
        await done(tx);
      }
    } catch {
      // gone already
    }
  }

  /** Remember hits; their `lastUsed` is written in one batch a little later. */
  private touch(key: string): void {
    this.touched.set(key, Date.now());
    if (this.touchTimer !== null) return;
    this.touchTimer = setTimeout(() => {
      this.touchTimer = null;
      void this.flushTouches();
    }, 2000);
  }

  private async flushTouches(): Promise<void> {
    const db = this.db;
    if (!db || this.touched.size === 0) return;
    const batch = [...this.touched];
    this.touched.clear();
    try {
      const tx = db.transaction(META_STORE, 'readwrite');
      const store = tx.objectStore(META_STORE);
      for (const [key, at] of batch) {
        const r = store.get(key);
        r.onsuccess = () => {
          const e = r.result as MetaEntry | undefined;
          if (e) store.put({ ...e, lastUsed: at });
        };
      }
      await done(tx);
    } catch {
      // best effort
    }
  }

  private scheduleTrim(): void {
    if (this.trimTimer !== null) return;
    this.trimTimer = setTimeout(() => {
      this.trimTimer = null;
      void this.trim();
    }, 3000);
  }

  /** Evict the least recently used entries above the byte cap. */
  async trim(): Promise<void> {
    const db = this.db;
    if (!db) return;
    try {
      let cap = DDC_MAX_BYTES;
      const est = await (navigator as Navigator & { storage?: StorageManager }).storage?.estimate?.();
      if (est?.quota) cap = Math.min(cap, est.quota * 0.25);
      const all = (await request(db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll())) as MetaEntry[];
      let total = all.reduce((s, e) => s + (e.bytes || 0), 0);
      if (total <= cap) return;
      all.sort((a, b) => a.lastUsed - b.lastUsed);
      for (const e of all) {
        if (total <= cap * 0.9) break;
        await this.remove(e.key);
        total -= e.bytes || 0;
      }
    } catch {
      // best effort
    }
  }
}
