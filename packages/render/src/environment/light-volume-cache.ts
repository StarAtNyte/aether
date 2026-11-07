/**
 * A persistent cache of baked light volumes, so a world opened again shows its room light as soon as the
 * building is built, without waiting for the bake.
 *
 * The key is a content hash of everything the bake reads (the trace triangles, their albedo and sidedness,
 * the probe grid, the sun, the ambient, the ground and the lamps) plus {@link VOLUME_BAKE_VERSION}, so an
 * edit, a lamp switched, another time of day, or a changed bake all miss and bake as before; a hit is the
 * exact data the bake would have produced. Entries live in IndexedDB (least recently used first out, a
 * byte cap), every operation is best effort: a missing or blocked database, a full quota or a malformed
 * entry means "no cache", never an error.
 */
import { FLOATS_PER_PROBE, type VolumeGrid } from './light-volume';

/** Bump when the bake's algorithm, its constants or its output layout change: older entries stop matching. */
export const VOLUME_BAKE_VERSION = 2;
/** Most entries kept. */
export const CACHE_MAX_ENTRIES = 12;
/** Most bytes of probe data kept. */
export const CACHE_MAX_BYTES = 48 * 1024 * 1024;
/** Bakes quicker than this (ms of wall time) are not worth storing: the cache would only fill up. */
export const CACHE_MIN_BAKE_MS = 400;

/** What the controller needs of a cache. Tests inject a fake. */
export interface VolumeCache {
  /** The stored probe data for `key`, or null (absent, unreadable, wrong size). Never rejects. */
  get(key: string, expectedFloats: number): Promise<Float32Array | null>;
  /** Store `data` under `key` (best effort, never rejects). */
  put(key: string, data: Float32Array): Promise<void>;
}

/** Two 32-bit FNV-1a style hashes over the 32-bit words of a typed array, as 16 hex digits. */
export function hashWords(view: ArrayBufferView, seed = 0): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const whole = bytes.byteLength >> 2;
  // Aligned copy only when the view is not 4-byte aligned (typed arrays over a fresh buffer always are).
  const words = view.byteOffset % 4 === 0 ? new Uint32Array(view.buffer, view.byteOffset, whole) : new Uint32Array(bytes.slice(0, whole * 4).buffer);
  let a = (0x811c9dc5 ^ seed) >>> 0;
  let b = (0x9747b28c + seed) >>> 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as number;
    a = Math.imul(a ^ w, 0x01000193) >>> 0;
    b = Math.imul(b + w + ((b << 13) | (b >>> 19)), 0x85ebca6b) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  }
  for (let i = whole * 4; i < bytes.length; i++) {
    a = Math.imul(a ^ (bytes[i] as number), 0x01000193) >>> 0;
    b = Math.imul(b + (bytes[i] as number), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** The cache key of a bake. `scalars` is everything small that the bake reads, as plain JSON-able values. */
export function volumeKey(grid: VolumeGrid, arrays: { positions: Float32Array; albedo: Float32Array; twoSided: Uint8Array }, scalars: unknown): string {
  const small = hashWords(new TextEncoder().encode(JSON.stringify([VOLUME_BAKE_VERSION, FLOATS_PER_PROBE, grid, scalars])));
  return `v${VOLUME_BAKE_VERSION}:${grid.nx}x${grid.ny}x${grid.nz}:${small}:${hashWords(arrays.positions)}${hashWords(arrays.albedo)}${hashWords(arrays.twoSided)}`;
}

/** Numbers as integers in steps of 1 / `perUnit` (two builds that differ by less than a step hash the same). */
function quantize(values: Float32Array, perUnit: number): Int32Array {
  const out = new Int32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = Math.round((values[i] as number) * perUnit);
  return out;
}

/**
 * The key of a re-lightable bake, file-safe (`lv<version>-<32 hex digits>`): the trace scene rounded (2 cm, 1 % albedo, as the
 * lightmap's key: two backends build the same building a fraction of a millimetre apart, and a cooked file must match on both),
 * the grid and `scalars` (the ground, the lamps at full strength, the sun keys). No light: the hour never changes it.
 */
export function volumeFileKey(grid: VolumeGrid, arrays: { positions: Float32Array; albedo: Float32Array; twoSided: Uint8Array }, scalars: unknown): string {
  const small = hashWords(new TextEncoder().encode(JSON.stringify([VOLUME_BAKE_VERSION, FLOATS_PER_PROBE, grid, scalars])));
  const big = hashWords(quantize(arrays.positions, 50)) + hashWords(quantize(arrays.albedo, 100), 1) + hashWords(arrays.twoSided, 2);
  return `lv${VOLUME_BAKE_VERSION}-${hashWords(new TextEncoder().encode(small + big))}${small}`;
}

const DB = 'aether-light-volumes';
/** Probe data by key, and (small) their sizes and last use, so trimming never reads the data. */
const DATA = 'data';
const META = 'meta';
const TIMEOUT_MS = 4000;

interface Meta {
  key: string;
  bytes: number;
  used: number;
}

/** IndexedDB-backed cache; null when IndexedDB is not available. */
export function createIdbVolumeCache(): VolumeCache | null {
  if (typeof indexedDB === 'undefined') return null;
  let opened: Promise<IDBDatabase | null> | null = null;
  const open = (): Promise<IDBDatabase | null> => {
    opened ??= new Promise<IDBDatabase | null>((resolve) => {
      let done = false;
      const finish = (db: IDBDatabase | null): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(db);
      };
      const timer = setTimeout(() => finish(null), TIMEOUT_MS);
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(DATA)) req.result.createObjectStore(DATA);
          if (!req.result.objectStoreNames.contains(META)) req.result.createObjectStore(META, { keyPath: 'key' });
        };
        req.onsuccess = () => finish(req.result);
        req.onerror = () => finish(null);
        req.onblocked = () => finish(null);
      } catch {
        finish(null);
      }
    });
    return opened;
  };
  const wrap = <T>(req: IDBRequest<T>): Promise<T | null> =>
    new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  return {
    async get(key, expectedFloats) {
      try {
        const db = await open();
        if (!db) return null;
        const tx = db.transaction([DATA, META], 'readwrite');
        const data = (await wrap(tx.objectStore(DATA).get(key))) as unknown;
        if (!(data instanceof Float32Array) || data.length !== expectedFloats) return null;
        // Recently used: it survives the next trim.
        tx.objectStore(META).put({ key, bytes: data.byteLength, used: Date.now() } satisfies Meta);
        return data;
      } catch {
        return null;
      }
    },
    async put(key, data) {
      try {
        const db = await open();
        if (!db) return;
        const tx = db.transaction([DATA, META], 'readwrite');
        const done = new Promise<void>((resolve) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        });
        tx.objectStore(DATA).put(data, key);
        tx.objectStore(META).put({ key, bytes: data.byteLength, used: Date.now() } satisfies Meta);
        const metas = ((await wrap(tx.objectStore(META).getAll())) ?? []) as Meta[];
        metas.sort((p, q) => q.used - p.used);
        let bytes = 0;
        for (const [i, m] of metas.entries()) {
          bytes += m.bytes;
          if ((i >= CACHE_MAX_ENTRIES || bytes > CACHE_MAX_BYTES) && m.key !== key) {
            tx.objectStore(DATA).delete(m.key);
            tx.objectStore(META).delete(m.key);
          }
        }
        await done;
      } catch {
        /* a full quota or a closed database: the bake simply is not cached */
      }
    },
  };
}
